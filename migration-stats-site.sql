-- Site vitrine — mesure d'audience pour la page cachée /stats/ (15.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute :
--   - la table visites : une ligne par page vue (page, provenance, appareil,
--     langue, pays si l'hébergeur le donne, temps passé page visible) ;
--   - note_visite() et fin_visite(), appelées par /assets/mesure.js depuis les
--     pages du site, sans connexion ;
--   - stats_site(p_jours), lue par /stats/ (super admin seulement).
-- Ni cookie ni stockage chez le visiteur, ni adresse IP conservée : un
-- visiteur n'est reconnu que le temps d'une journée, par une empreinte hachée
-- avec un sel du jour, effacé le lendemain.
-- Avant le passage de ce script, les pages du site n'enregistrent rien (les
-- appels échouent sans bruit) et /stats/ affiche « Base à mettre à jour ».
-- ---------------------------------------------------------------------------
begin;

-- ------------------------------------------------------- audience du site ---
-- Une page vue par ligne. « visiteur » : empreinte du jour (md5 du sel du jour,
-- de l'adresse IP et du navigateur) — ni l'adresse ni le navigateur ne sont
-- gardés, et le sel disparaît le lendemain : on ne peut ni remonter à une
-- personne, ni suivre quelqu'un d'un jour à l'autre.
-- « duree » : secondes passées la page visible à l'écran (point d'étape toutes
-- les 30 s, et au départ). « present_le » : dernier point d'étape d'une page
-- encore visible (qui est sur le site en ce moment). Gardé 25 mois.
-- Aucune règle RLS : seules les fonctions ci-dessous y touchent.
create table if not exists public.visites (
  id         uuid primary key default gen_random_uuid(),
  le         timestamptz not null default now(),
  page       text not null constraint visites_page_forme check (page ~ '^/[a-z0-9/_-]{0,119}$'),
  precedent  text constraint visites_precedent_forme check (precedent is null or precedent ~ '^/[a-z0-9/_-]{0,119}$'),
  referent   text constraint visites_referent_forme check (referent is null or referent ~ '^[a-z0-9.-]{1,120}$'),
  appareil   text not null default 'ordinateur'
             constraint visites_appareil_check check (appareil in ('ordinateur', 'mobile', 'tablette')),
  langue     text constraint visites_langue_forme check (langue is null or langue ~ '^[a-z]{2}$'),
  pays       text constraint visites_pays_forme check (pays is null or pays ~ '^[A-Z]{2}$'),
  visiteur   text,
  duree      integer not null default 0 constraint visites_duree_bornes check (duree between 0 and 7200),
  present_le timestamptz
);
create index if not exists visites_le on public.visites (le desc);
alter table public.visites enable row level security;

comment on table public.visites is
  'Audience du site vitrine : une page vue par ligne, sans donnée personnelle (empreinte du jour hachée, ni IP ni navigateur gardés). Écrite par note_visite / fin_visite, lue par stats_site (super admin). Aucune règle RLS.';

-- Le sel du jour : renouvelé chaque jour, l'ancien effacé.
create table if not exists public.visites_sel (
  jour date primary key,
  sel  text not null
);
alter table public.visites_sel enable row level security;

-- Une page vue : renvoie son identifiant (à repasser à fin_visite), ou rien
-- pour un robot ou une adresse de page invalide.
create or replace function public.note_visite(p_page text, p_referent text default null,
                                              p_precedent text default null, p_langue text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_entetes  jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_agent    text  := lower(coalesce(v_entetes ->> 'user-agent', ''));
  v_ip       text  := btrim(split_part(coalesce(v_entetes ->> 'x-forwarded-for', v_entetes ->> 'cf-connecting-ip',
                                                v_entetes ->> 'x-real-ip', ''), ',', 1));
  v_pays     text  := upper(coalesce(v_entetes ->> 'cf-ipcountry', ''));
  v_page     text  := lower(left(btrim(coalesce(p_page, '')), 120));
  v_prec     text  := lower(left(btrim(coalesce(p_precedent, '')), 120));
  v_ref      text  := regexp_replace(lower(left(btrim(coalesce(p_referent, '')), 120)), '^www\.', '');
  v_langue   text  := lower(left(btrim(coalesce(p_langue, '')), 2));
  v_appareil text;
  v_sel      text;
  v_visiteur text;
  v_id       uuid;
begin
  -- Robots, aperçus de liens, navigateurs sans tête : pas comptés
  if v_agent = '' or v_agent ~ '(bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python|httpclient|facebookexternalhit)' then
    return null;
  end if;
  if v_page !~ '^/[a-z0-9/_-]{0,119}$' or v_page like '/planif/%' or v_page like '/stats/%' then
    return null;
  end if;
  if v_prec !~ '^/[a-z0-9/_-]{0,119}$' then v_prec := null; end if;
  if v_ref !~ '^[a-z0-9.-]{1,120}$' or v_ref like '%str-bim-tools.com' then v_ref := null; end if;
  if v_langue !~ '^[a-z]{2}$' then v_langue := null; end if;
  if v_pays !~ '^[A-Z]{2}$' or v_pays in ('XX', 'T1') then v_pays := null; end if;
  v_appareil := case when v_agent ~ '(ipad|tablet)' then 'tablette'
                     when v_agent ~ '(mobi|iphone)' then 'mobile'
                     when v_agent ~ 'android' then 'tablette'
                     else 'ordinateur' end;

  insert into public.visites_sel (jour, sel) values (current_date, gen_random_uuid()::text)
  on conflict (jour) do nothing;
  delete from public.visites_sel s where s.jour < current_date;
  select s.sel into v_sel from public.visites_sel s where s.jour = current_date;
  v_visiteur := case when v_ip <> '' then md5(v_sel || '|' || v_ip || '|' || v_agent) end;

  -- Garde-fou : plus de 60 pages vues en 10 minutes pour une même empreinte, on n'écrit plus
  if v_visiteur is not null and (select count(*) from public.visites v
                                  where v.visiteur = v_visiteur and v.le > now() - interval '10 minutes') >= 60 then
    return null;
  end if;

  insert into public.visites (page, precedent, referent, appareil, langue, pays, visiteur, present_le)
  values (v_page, v_prec, v_ref, v_appareil, v_langue, v_pays, v_visiteur, now())
  returning id into v_id;

  delete from public.visites v where v.le < now() - interval '25 months';
  return v_id;
end $$;

-- Point d'étape d'une page vue : le temps passé page visible (il ne fait que
-- croître, 2 heures au plus) ; p_present faux quand la page passe derrière ou
-- se ferme. Une page vue de plus de 12 heures n'est plus modifiable.
create or replace function public.fin_visite(p_id uuid, p_duree integer, p_present boolean default false)
returns void
language sql security definer set search_path = '' as $$
  update public.visites v
     set duree = greatest(v.duree, least(greatest(coalesce(p_duree, 0), 0), 7200)),
         present_le = case when coalesce(p_present, false) then now() else null end
   where v.id = p_id
     and v.le > now() - interval '12 hours';
$$;

-- La page /stats/ : les pages vues des p_jours derniers jours (1 à 800).
create or replace function public.stats_site(p_jours integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_depuis timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 800)));
begin
  if not public.est_super_admin() then
    raise exception 'Statistiques réservées au super admin.';
  end if;
  return jsonb_build_object(
    'maintenant', now(),
    'visites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'le', v.le, 'page', v.page, 'precedent', v.precedent, 'referent', v.referent,
               'appareil', v.appareil, 'langue', v.langue, 'pays', v.pays,
               'visiteur', left(v.visiteur, 12), 'duree', v.duree,
               'present', v.present_le is not null and v.present_le > now() - interval '75 seconds')
             order by v.le desc)
        from public.visites v
       where v.le >= v_depuis), '[]'::jsonb)
  );
end $$;

revoke all on function public.note_visite(text, text, text, text) from public;
grant execute on function public.note_visite(text, text, text, text) to anon, authenticated;
revoke all on function public.fin_visite(uuid, integer, boolean) from public;
grant execute on function public.fin_visite(uuid, integer, boolean) to anon, authenticated;
revoke all on function public.stats_site(integer) from public, anon;
grant execute on function public.stats_site(integer) to authenticated;

commit;
