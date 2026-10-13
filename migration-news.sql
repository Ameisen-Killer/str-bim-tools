-- Planification — News du bureau (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Crée la table des news (module Communication), ses
-- règles et trois droits du tableau des groupes, donnés aux administrateurs :
--   · news_rediger   : « Rédiger les news » (créer, modifier les siennes)
--   · news_archiver  : « Archiver les news »
--   · news_supprimer : « Supprimer les news »
-- ---------------------------------------------------------------------------
begin;

-- ------------------------------------------------------------------- news ---
-- News du bureau (13.10.2026) : des articles mis en forme (gras, listes,
-- liens, images…) en tête de Communication. Tout le bureau les lit ; les
-- écrire, les archiver et les supprimer sont des droits du tableau des
-- groupes (news_rediger, news_archiver, news_supprimer). Le contenu est du
-- HTML que l'outil nettoie à l'écriture et à l'affichage (liste blanche de
-- balises). archive_le : date d'archivage, nul tant que la news est en ligne.
create table if not exists public.news (
  id          uuid primary key default gen_random_uuid(),
  bureau_id   uuid not null default public.bureau_par_defaut()
              constraint news_bureau_fk references public.bureaux (id) on delete cascade,
  auteur_id   uuid default public.mon_membre()
              constraint news_auteur_fk references public.membres (id) on delete set null,
  titre       text not null constraint news_titre_check check (char_length(btrim(titre)) between 1 and 200),
  contenu     text not null default '' constraint news_contenu_check check (char_length(contenu) <= 3000000),
  archive_le  timestamptz,
  archive_par uuid constraint news_archive_par_fk references public.membres (id) on delete set null,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now()
);
create index if not exists news_bureau on public.news (bureau_id, cree_le desc);
comment on table public.news is
  'News du bureau (module Communication). Lecture : le bureau. Écriture selon les droits news_rediger (créer, modifier les siennes), news_archiver, news_supprimer.';

-- Ce qu'une modification a le droit de changer : le titre et le texte pour
-- l'auteur qui a le droit de rédiger (le super admin, toujours) ; l'archivage
-- pour le droit d'archiver. L'auteur, le bureau et la date de création ne
-- bougent jamais.
create or replace function public.garde_news()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.titre is distinct from old.titre or new.contenu is distinct from old.contenu)
     and not (public.est_super_admin()
              or (public.a_droit('news_rediger') and old.auteur_id is not null and old.auteur_id = public.mon_membre())) then
    raise exception 'Tu ne modifies que tes propres news (droit « Rédiger les news »).';
  end if;
  if new.archive_le is distinct from old.archive_le then
    if not public.a_droit('news_archiver') then
      raise exception 'Archiver une news demande le droit « Archiver les news ».';
    end if;
    new.archive_par := case when new.archive_le is null then null else public.mon_membre() end;
  else
    new.archive_par := old.archive_par;
  end if;
  new.auteur_id := old.auteur_id;
  new.bureau_id := old.bureau_id;
  new.cree_le := old.cree_le;
  return new;
end $$;
drop trigger if exists garde on public.news;
create trigger garde before update on public.news
  for each row execute function public.garde_news();
drop trigger if exists maj_le on public.news;
create trigger maj_le before update on public.news
  for each row execute function public.touche_maj_le();

alter table public.news enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'news' loop
    execute format('drop policy %I on public.news', p.policyname);
  end loop;
end $$;
-- News : tout le bureau lit ; écrire, archiver, supprimer selon les droits.
-- Jamais le compte de démonstration, partagé et public (ses news restent dans
-- son navigateur).
create policy "bureau courant (lecture)" on public.news for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "droit de rédiger (création)" on public.news for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and (select public.a_droit('news_rediger'))
              and auteur_id is not null and auteur_id = (select public.mon_membre())
              and archive_le is null
              and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');
create policy "rédiger ou archiver (modification)" on public.news for update to authenticated
  using (bureau_id = (select public.bureau_courant())
         and ((select public.a_droit('news_rediger')) or (select public.a_droit('news_archiver'))))
  with check (bureau_id = (select public.bureau_courant())
              and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');
create policy "droit de supprimer (suppression)" on public.news for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (select public.a_droit('news_supprimer'))
         and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');

-- Les trois droits, aux administrateurs (une fois : s'ils n'en ont aucun)
update public.droits_groupes g
   set droits = array(select distinct x from unnest(g.droits || array['news_rediger', 'news_archiver', 'news_supprimer']) as x order by x),
       maj_le = now()
 where g.statut = 'administrateur'
   and not (g.droits && array['news_rediger', 'news_archiver', 'news_supprimer']);

-- Les groupes d'un bureau neuf, avec leurs droits d'origine
create or replace function public.groupes_par_defaut(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'tous', 'Tout le monde', null, 0,
     array['page_tableau', 'page_equipe', 'page_absences', 'page_annuaire', 'voir_conges_equipe', 'voir_absences_avenir']),
    (p_bureau, 'administrateur', 'Administrateur', null, 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_inter', 'page_transversales', 'conges_tous',
           'news_rediger', 'news_archiver', 'news_supprimer'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_secteur', 'Chef de secteur', 'administrateur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_affaires', 'page_charge', 'page_secteurs',
           'planning_equipe', 'taches_a_affecter', 'conges_secteur'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_projet', 'Chef de projet', 'chef_secteur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui'])
  on conflict (bureau_id, statut) do nothing;
end $$;
revoke all on function public.groupes_par_defaut(uuid) from public, anon, authenticated;

commit;
