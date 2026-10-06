-- ============================================================================
--  Migration : veille des appels d'offres simap.ch (06.10.2026)
-- ----------------------------------------------------------------------------
--  Ajoute les tables veille_ao (publications retenues chaque matin par la
--  tâche planifiée du dépôt) et veille_suivi (ce que le bureau en fait). Il se
--  relance sans dommage.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

-- Veille des appels d'offres (module Inter-secteurs) : les publications de
-- simap.ch retenues chaque matin par la tâche planifiée du dépôt
-- (.github/workflows/veille-simap.yml). Données publiques, communes à tous
-- les bureaux ; seule la tâche y écrit (clé de service, qui passe la RLS).
create table if not exists public.veille_ao (
  id               text primary key,          -- identifiant du projet simap
  publication_id   text not null,
  titre            text not null,
  description      text not null default '',
  adjudicateur     text not null default '',
  canton           text not null default '',
  lieu             text not null default '',
  procedure        text not null default '',  -- open, selective, invitation…
  type_publication text not null default '',  -- tender, competition…
  sous_type        text not null default '',  -- service, project_competition…
  cpv              text[] not null default '{}',
  bkp              text[] not null default '{}',
  publie_le        date,
  delai_remise     timestamptz,
  lien             text not null default '',
  motifs           text[] not null default '{}',  -- pourquoi elle a été retenue
  recu_le          timestamptz not null default now(),
  maj_le           timestamptz not null default now()
);
create index if not exists veille_ao_publie on public.veille_ao (publie_le desc);

-- Ce que chaque bureau fait d'une publication : écartée, ou transformée en
-- appel d'offres (affaire en phase AO).
create table if not exists public.veille_suivi (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint veille_suivi_bureau_fk references public.bureaux (id) on delete cascade,
  ao_id      text not null references public.veille_ao (id) on delete cascade,
  etat       text not null check (etat in ('ecartee', 'retenue')),
  affaire_id uuid,
  par        uuid,
  le         timestamptz not null default now(),
  constraint veille_suivi_unique unique (bureau_id, ao_id)
);
create index if not exists veille_suivi_bureau on public.veille_suivi (bureau_id);

alter table public.veille_ao enable row level security;
alter table public.veille_suivi enable row level security;
drop policy if exists "autorisés (lecture)"           on public.veille_ao;
drop policy if exists "bureau courant (lecture)"      on public.veille_suivi;
drop policy if exists "bureau courant (création)"     on public.veille_suivi;
drop policy if exists "bureau courant (modification)" on public.veille_suivi;
drop policy if exists "bureau courant (suppression)"  on public.veille_suivi;
-- Veille : toute personne autorisée lit les publications ; seule la tâche
-- planifiée (clé de service) les écrit. Le suivi est celui du bureau.
create policy "autorisés (lecture)" on public.veille_ao for select to authenticated
  using ((select public.est_autorise()));
create policy "bureau courant (lecture)" on public.veille_suivi for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.veille_suivi for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.veille_suivi for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (suppression)" on public.veille_suivi for delete to authenticated
  using (bureau_id = (select public.bureau_courant()));

drop trigger if exists maj_le on public.veille_ao;
create trigger maj_le before update on public.veille_ao
  for each row execute function public.touche_maj_le();

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'veille_suivi') then
    alter publication supabase_realtime add table public.veille_suivi;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
