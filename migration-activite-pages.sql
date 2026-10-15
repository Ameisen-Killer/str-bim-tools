-- Planification — temps passé par page de l'outil (15.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute la table activite_pages (temps actif par
-- personne, jour et page de l'outil), un paramètre p_page à presence() pour la
-- tenir, et la lecture de ce temps dans console_activite().
-- En attendant ce script, l'outil appelle presence() sans p_page (repli dans
-- supabase.js) : le compteur « en ligne » et le journal continuent de marcher.
-- ---------------------------------------------------------------------------
begin;

-- Temps actif par page de l'outil (15.10.2026) : une ligne par personne,
-- bureau, jour (heure suisse) et page (/planif/taches/, /planif/inter-secteurs/?vue=…).
-- Tenue par presence(), lue par console_activite(). Aucune règle RLS. 400 jours.
create table if not exists public.activite_pages (
  email     text not null
            constraint activite_pages_email_minuscules check (email = lower(btrim(email))),
  bureau_id uuid not null
            constraint activite_pages_bureau_fk references public.bureaux (id) on delete cascade,
  jour      date not null,
  page      text not null constraint activite_pages_page_forme check (page ~ '^/planif/[a-z0-9/_?=-]{0,90}$'),
  actif     integer not null default 0 constraint activite_pages_actif_positif check (actif >= 0),
  primary key (email, bureau_id, jour, page)
);
create index if not exists activite_pages_jour on public.activite_pages (jour desc);
alter table public.activite_pages enable row level security;

-- L'ancienne signature (sans p_page) laisse la place : deux versions côte à
-- côte rendraient l'appel ambigu pour l'API.
drop function if exists public.presence(text, bigint, boolean, boolean);

-- p_visible : l'onglet est sous les yeux (battement) ou vient de passer derrière.
-- p_quitter : déconnexion — tous les onglets de l'adresse s'effacent.
-- p_page    : la page de l'outil ouverte dans l'onglet (/planif/taches/…) :
--             le temps actif s'y ajoute, jour par jour (activite_pages).
create or replace function public.presence(p_onglet text, p_horloge bigint,
                                           p_visible boolean default true,
                                           p_quitter boolean default false,
                                           p_page text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email    text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_bureau   uuid := public.bureau_courant();
  v_onglet   text := left(btrim(coalesce(p_onglet, '')), 64);
  v_agent    text;
  v_appareil text;
  v_vu       boolean;
  v_vu_le    timestamptz;
  v_seance   bigint;
  v_fin      timestamptz;
  v_page     text := lower(left(btrim(coalesce(p_page, '')), 100));
  v_ajout    integer := 0;
begin
  if v_email = '' or v_bureau is null then
    return jsonb_build_object('enLigne', '[]'::jsonb);
  end if;

  -- Journal d'activité, AVANT de noter l'onglet : il faut savoir s'il était
  -- sous les yeux jusqu'ici. Le temps écoulé depuis le dernier signe de vie
  -- de la séance (ou de l'onglet, s'il est plus récent) compte comme actif,
  -- 60 s au plus : deux onglets visibles ne comptent pas double, et un
  -- ordinateur mis en veille ne compte pas sa nuit.
  if not coalesce(p_quitter, false) and v_onglet <> '' then
    v_agent := lower(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', ''));
    v_appareil := case when v_agent ~ '(ipad|tablet)' then 'tablette'
                       when v_agent ~ '(mobi|iphone)' then 'mobile'
                       when v_agent ~ 'android' then 'tablette'
                       else 'ordinateur' end;
    select p.visible and p.vu_le > now() - interval '100 seconds', p.vu_le
      into v_vu, v_vu_le
      from public.presences p
     where p.email = v_email and p.onglet = v_onglet;
    select a.id, a.fin into v_seance, v_fin
      from public.activite a
     where a.email = v_email and a.bureau_id = v_bureau and a.appareil = v_appareil
       and a.fin > now() - interval '15 minutes'
     order by a.fin desc
     limit 1;
    if v_seance is not null then
      if coalesce(v_vu, false) then
        v_ajout := least(60, greatest(0, floor(extract(epoch from now() - greatest(v_fin, v_vu_le)))))::integer;
      end if;
      update public.activite a
         set actif = a.actif + v_ajout,
             fin = now()
       where a.id = v_seance;
      -- Le même temps, rangé sous la page de l'outil qui l'a eu sous les yeux
      if v_ajout > 0 and v_page ~ '^/planif/[a-z0-9/_?=-]{0,90}$' then
        insert into public.activite_pages as x (email, bureau_id, jour, page, actif)
        values (v_email, v_bureau, (now() at time zone 'Europe/Zurich')::date, v_page, v_ajout)
        on conflict (email, bureau_id, jour, page) do update set actif = x.actif + excluded.actif;
      end if;
    elsif coalesce(p_visible, true) then
      insert into public.activite (email, bureau_id, appareil) values (v_email, v_bureau, v_appareil);
    end if;
    delete from public.activite a where a.fin < now() - interval '400 days';
    delete from public.activite_pages x where x.jour < current_date - 400;
  end if;

  if p_quitter then
    delete from public.presences p where p.email = v_email;
  elsif v_onglet <> '' then
    insert into public.presences as p (email, onglet, bureau_id, visible, horloge, vu_le)
    values (v_email, v_onglet, v_bureau, coalesce(p_visible, true), coalesce(p_horloge, 0), now())
    on conflict (email, onglet) do update
      set bureau_id = excluded.bureau_id, visible = excluded.visible,
          horloge = excluded.horloge, vu_le = excluded.vu_le
      where p.horloge <= excluded.horloge;
  end if;

  -- Ménage : une ligne d'hier ne dit plus rien, et personne d'autre ne l'effacera.
  delete from public.presences p where p.vu_le < now() - interval '1 day';

  -- Une personne, une fois, même avec plusieurs onglets visibles.
  return jsonb_build_object('enLigne', coalesce((
    select jsonb_agg(jsonb_build_object('nom', x.nom, 'moi', x.moi) order by lower(x.nom))
      from (
        select distinct on (p.email)
               case when m.id is not null then btrim(m.prenom || ' ' || m.nom) else p.email end as nom,
               p.email = v_email as moi
          from public.presences p
          left join public.acces a on a.email = p.email and a.actif
          left join public.membres m on m.id = a.membre_id
         where p.bureau_id = v_bureau
           and p.visible
           and p.vu_le > now() - interval '100 seconds'
         order by p.email
      ) x), '[]'::jsonb));
end $$;

comment on function public.presence(text, bigint, boolean, boolean, text) is
  'Inscrit l''état d''un onglet de la personne connectée, tient le journal d''activité (et le temps par page) et renvoie qui a l''outil sous les yeux dans son bureau : { enLigne: [{ nom, moi }] }.';

revoke all on function public.presence(text, bigint, boolean, boolean, text) from public, anon;
grant execute on function public.presence(text, bigint, boolean, boolean, text) to authenticated;

-- La page Console › Activité : les séances des p_jours derniers jours (1 à
-- 400), toutes les adresses autorisées (avec leur fiche et leur dernière
-- connexion), les bureaux, et qui a l'outil sous les yeux en ce moment.
create or replace function public.console_activite(p_jours integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_depuis timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 400)));
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  return jsonb_build_object(
    'maintenant', now(),
    'bureaux', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'nom', b.nom) order by lower(b.nom))
        from public.bureaux b), '[]'::jsonb),
    'personnes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', a.email, 'bureauId', a.bureau_id, 'actif', a.actif, 'superAdmin', a.super_admin,
               'prenom', m.prenom, 'nom', m.nom, 'photo', m.photo,
               'derniereConnexion', u.last_sign_in_at)
             order by a.email)
        from public.acces a
        left join public.membres m on m.id = a.membre_id
        left join auth.users u on lower(u.email) = a.email), '[]'::jsonb),
    'seances', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'email', s.email, 'bureauId', s.bureau_id, 'appareil', s.appareil,
               'debut', s.debut, 'fin', s.fin, 'actif', s.actif)
             order by s.debut desc)
        from public.activite s
       where s.fin >= v_depuis), '[]'::jsonb),
    -- Le temps actif par page de l'outil, jour par jour
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('email', x.email, 'bureauId', x.bureau_id, 'jour', x.jour,
                                          'page', x.page, 'actif', x.actif))
        from public.activite_pages x
       where x.jour >= (v_depuis at time zone 'Europe/Zurich')::date), '[]'::jsonb),
    'enLigne', coalesce((
      select jsonb_agg(jsonb_build_object('email', x.email, 'bureauId', x.bureau_id))
        from (select distinct on (p.email) p.email, p.bureau_id
                from public.presences p
               where p.visible and p.vu_le > now() - interval '100 seconds'
               order by p.email, p.vu_le desc) x), '[]'::jsonb)
  );
end $$;

commit;
