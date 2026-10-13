-- Planification — Mandat, avancement et facturation (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute :
--   · aux affaires, leur mandat : les phases SIA pour lesquelles le bureau est
--     mandaté et les disciplines de chaque phase (colonne mandat) ;
--   · la table mandat_saisies : chaque saisie d'avancement ou de facturation
--     (en %), par phase et par discipline, gardée pour l'historique ;
--   · quatre droits du tableau des groupes :
--       page_facturation   « Facturation » (la page, dans Inter-secteurs)
--       facturation_saisir « Saisir la facturation »
--       avancement_secteur « Avancement de son secteur » (chefs de secteur)
--       avancement_tous    « Avancement de toutes les affaires » (administrateurs)
--     Le responsable d'une affaire saisit toujours l'avancement de son affaire.
-- ---------------------------------------------------------------------------
begin;

-- ------------------------------------------------------------- le mandat ---
alter table public.affaires add column if not exists mandat jsonb not null default '{}'::jsonb;
alter table public.affaires drop constraint if exists affaires_mandat_check;
alter table public.affaires add constraint affaires_mandat_check check (jsonb_typeof(mandat) = 'object');
comment on column public.affaires.mandat is
  'Phases SIA du mandat et disciplines de chacune : {"31": ["structure", "geotechnique"], …}. Vide : mandat pas encore décrit.';

-- ----------------------------------------- avancement et facturation ---
-- Une ligne par saisie, jamais modifiée : la valeur en cours d'une case
-- (affaire, phase, discipline, genre) est la plus récente ; les autres font
-- l'historique. Qui et quand sont posés par la base, pas par l'outil.
create table if not exists public.mandat_saisies (
  id          uuid primary key default gen_random_uuid(),
  bureau_id   uuid not null default public.bureau_par_defaut()
              constraint mandat_saisies_bureau_fk references public.bureaux (id) on delete cascade,
  affaire_id  uuid not null,
  phase       text not null constraint mandat_saisies_phase_check check (phase ~ '^[0-9]{2}$'),
  discipline  text not null constraint mandat_saisies_discipline_check check (discipline ~ '^[a-z][a-z0-9_]{0,39}$'),
  genre       text not null constraint mandat_saisies_genre_check check (genre in ('avancement', 'facturation')),
  valeur      smallint not null constraint mandat_saisies_valeur_check check (valeur between 0 and 100),
  par         uuid constraint mandat_saisies_par_fk references public.membres (id) on delete set null,
  le          timestamptz not null default now(),
  constraint mandat_saisies_affaire_fk foreign key (affaire_id, bureau_id)
    references public.affaires (id, bureau_id) on delete cascade
);
create index if not exists mandat_saisies_affaire on public.mandat_saisies (affaire_id, phase, discipline, genre, le desc);
create index if not exists mandat_saisies_bureau on public.mandat_saisies (bureau_id);
comment on table public.mandat_saisies is
  'Avancement et facturation (%) de chaque phase du mandat, par discipline. Une ligne par saisie : la plus récente fait foi, les autres font l''historique.';

create or replace function public.garde_mandat_saisie()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.par := public.mon_membre();
  new.le := now();
  return new;
end $$;
revoke all on function public.garde_mandat_saisie() from public, anon, authenticated;
drop trigger if exists garde on public.mandat_saisies;
create trigger garde before insert on public.mandat_saisies
  for each row execute function public.garde_mandat_saisie();

-- Qui saisit : la facturation, le droit « Saisir la facturation » ;
-- l'avancement, le responsable de l'affaire, le chef du secteur (droit
-- « Avancement de son secteur », pour sa discipline) ou le droit
-- « Avancement de toutes les affaires ». Toujours sur une case du mandat.
create or replace function public.peut_saisir_mandat(p_affaire uuid, p_phase text, p_discipline text, p_genre text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.affaires a
     where a.id = p_affaire
       and a.bureau_id = public.bureau_courant()
       and jsonb_typeof(a.mandat -> p_phase) = 'array'
       and (a.mandat -> p_phase) ? p_discipline
       and case p_genre
             when 'facturation' then public.a_droit('facturation_saisir')
             when 'avancement' then
               public.a_droit('avancement_tous')
               or (a.responsable_id is not null and a.responsable_id = public.mon_membre())
               or (public.a_droit('avancement_secteur') and exists (
                     select 1 from public.membres moi
                      where moi.id = public.mon_membre() and moi.discipline = p_discipline))
             else false
           end);
$$;
revoke all on function public.peut_saisir_mandat(uuid, text, text, text) from public, anon;
grant execute on function public.peut_saisir_mandat(uuid, text, text, text) to authenticated;

alter table public.mandat_saisies enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'mandat_saisies' loop
    execute format('drop policy %I on public.mandat_saisies', p.policyname);
  end loop;
end $$;
-- L'avancement, tout le bureau le lit ; la facturation, ceux qui ont la page
-- ou le droit de la saisir. Pas de modification : une correction est une
-- nouvelle saisie. Retirer une saisie : le super admin seul.
create policy "bureau courant (lecture)" on public.mandat_saisies for select to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (genre = 'avancement'
              or (select public.a_droit('page_facturation'))
              or (select public.a_droit('facturation_saisir'))));
create policy "droit de saisir (création)" on public.mandat_saisies for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and public.peut_saisir_mandat(affaire_id, phase, discipline, genre));
create policy "super admin (suppression)" on public.mandat_saisies for delete to authenticated
  using (bureau_id = (select public.bureau_courant()) and (select public.est_super_admin()));

-- ------------------------------------------------------------ les droits ---
-- Aux administrateurs : la page, la facturation, l'avancement de tout ;
-- aux chefs de secteur : l'avancement de leur secteur (une fois : s'ils n'en
-- ont encore aucun).
update public.droits_groupes g
   set droits = array(select distinct x from unnest(g.droits || array['page_facturation', 'facturation_saisir', 'avancement_tous']) as x order by x),
       maj_le = now()
 where g.statut = 'administrateur'
   and not (g.droits && array['page_facturation', 'facturation_saisir', 'avancement_tous']);
update public.droits_groupes g
   set droits = array(select distinct x from unnest(g.droits || array['avancement_secteur']) as x order by x),
       maj_le = now()
 where g.statut = 'chef_secteur'
   and not (g.droits && array['avancement_secteur']);

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
           'news_rediger', 'news_archiver', 'news_supprimer',
           'page_facturation', 'facturation_saisir', 'avancement_tous'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_secteur', 'Chef de secteur', 'administrateur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_affaires', 'page_charge', 'page_secteurs',
           'planning_equipe', 'taches_a_affecter', 'conges_secteur', 'avancement_secteur'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_projet', 'Chef de projet', 'chef_secteur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui'])
  on conflict (bureau_id, statut) do nothing;
end $$;
revoke all on function public.groupes_par_defaut(uuid) from public, anon, authenticated;

-- --------------------------------------------- mises à jour en direct ---
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mandat_saisies') then
    alter publication supabase_realtime add table public.mandat_saisies;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
