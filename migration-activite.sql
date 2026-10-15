-- Planification — journal d'activité pour la console (15.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute :
--   - la table activite : une ligne par séance (une personne, un bureau, un
--     appareil), avec son début, son dernier signe de vie et le temps passé
--     l'outil sous les yeux ;
--   - presence(), même signature, qui tient ce journal à chaque battement ;
--   - console_activite(p_jours), lue par la page Console › Activité (super
--     admin seulement).
-- Avant le passage de ce script, la page Activité affiche « Base à mettre à
-- jour » ; le reste de l'outil n'en dépend pas.
-- ---------------------------------------------------------------------------
begin;

-- ---------------------------------------------------- journal d'activité ---
-- Une séance : une personne, dans un bureau, sur un appareil. Elle s'ouvre au
-- premier battement d'un onglet visible et se prolonge tant que des signes de
-- vie arrivent à moins de 15 minutes d'intervalle ; au-delà, la suivante est
-- une nouvelle séance. « actif » ne compte que le temps où un onglet de l'outil
-- était sous les yeux (battements de 45 s, au plus 60 s comptées par message).
-- Aucune règle RLS, comme presences : seules presence() et console_activite()
-- y touchent. Gardé 400 jours.
create table if not exists public.activite (
  id        bigint generated always as identity primary key,
  email     text not null
            constraint activite_email_minuscules check (email = lower(btrim(email))),
  bureau_id uuid not null
            constraint activite_bureau_fk references public.bureaux (id) on delete cascade,
  appareil  text not null default 'ordinateur'
            constraint activite_appareil_check check (appareil in ('ordinateur', 'mobile', 'tablette')),
  debut     timestamptz not null default now(),
  fin       timestamptz not null default now(),
  actif     integer not null default 0 constraint activite_actif_positif check (actif >= 0)
);
create index if not exists activite_personne on public.activite (email, bureau_id, appareil, fin desc);
create index if not exists activite_fin on public.activite (fin desc);
alter table public.activite enable row level security;

comment on table public.activite is
  'Journal des séances de l''outil : qui, dans quel bureau, sur quel appareil, de quand à quand, et combien de secondes sous les yeux. Tenue par public.presence() ; lue par public.console_activite() (super admin). Aucune règle RLS.';
comment on column public.activite.fin is
  'Dernier signe de vie de la séance (battement ou onglet passé derrière). Plus de 15 minutes sans signe : la séance est close.';
comment on column public.activite.actif is
  'Secondes passées avec un onglet de l''outil visible pendant la séance.';

-- p_visible : l'onglet est sous les yeux (battement) ou vient de passer derrière.
-- p_quitter : déconnexion — tous les onglets de l'adresse s'effacent.
create or replace function public.presence(p_onglet text, p_horloge bigint,
                                           p_visible boolean default true,
                                           p_quitter boolean default false)
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
      update public.activite a
         set actif = a.actif + case when coalesce(v_vu, false)
                                    then least(60, greatest(0, floor(extract(epoch from
                                           now() - greatest(v_fin, v_vu_le)))))::integer
                                    else 0 end,
             fin = now()
       where a.id = v_seance;
    elsif coalesce(p_visible, true) then
      insert into public.activite (email, bureau_id, appareil) values (v_email, v_bureau, v_appareil);
    end if;
    delete from public.activite a where a.fin < now() - interval '400 days';
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

comment on function public.presence(text, bigint, boolean, boolean) is
  'Inscrit l''état d''un onglet de la personne connectée, tient le journal d''activité et renvoie qui a l''outil sous les yeux dans son bureau : { enLigne: [{ nom, moi }] }.';

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
    'enLigne', coalesce((
      select jsonb_agg(jsonb_build_object('email', x.email, 'bureauId', x.bureau_id))
        from (select distinct on (p.email) p.email, p.bureau_id
                from public.presences p
               where p.visible and p.vu_le > now() - interval '100 seconds'
               order by p.email, p.vu_le desc) x), '[]'::jsonb)
  );
end $$;

revoke all on function public.console_activite(integer) from public, anon;
grant execute on function public.console_activite(integer) to authenticated;

commit;
