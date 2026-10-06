-- ============================================================================
--  Migration : module Inter-secteurs de l'espace AB (06.10.2026)
-- ----------------------------------------------------------------------------
--  Un appel d'offres (AO) est une affaire en phase « AO ». Ce script ajoute :
--    - sur les affaires : ao_type (public / privé), demandeur_id (une fiche de
--      l'annuaire), ao_resultat (en cours, gagné, perdu, abandonné),
--      ao_montant (honoraires offerts, CHF) et secteurs (disciplines qui
--      interviennent, pour les affaires comme pour les AO) ;
--    - la table ao_agenda : l'agenda d'un AO (visite, questions, remise,
--      ouverture des offres, présentation…), attaché à l'affaire et non à une
--      personne. Tout le bureau le lit et le tient, comme l'annuaire.
--  La date de remise d'une offre est l'échéance de l'affaire (colonne echeance).
--  Il se relance sans dommage.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

alter table public.affaires
  add column if not exists ao_type      text,
  add column if not exists demandeur_id uuid,
  add column if not exists ao_resultat  text,
  add column if not exists ao_montant   numeric(12,0),
  add column if not exists secteurs     text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'affaires_ao_type_check') then
    alter table public.affaires add constraint affaires_ao_type_check
      check (ao_type is null or ao_type in ('public', 'prive'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'affaires_ao_resultat_check') then
    alter table public.affaires add constraint affaires_ao_resultat_check
      check (ao_resultat is null or ao_resultat in ('en_cours', 'gagne', 'perdu', 'abandonne'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'affaires_ao_montant_check') then
    alter table public.affaires add constraint affaires_ao_montant_check
      check (ao_montant is null or ao_montant >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'affaires_demandeur_fk') then
    alter table public.affaires add constraint affaires_demandeur_fk
      foreign key (demandeur_id) references public.contacts (id) on delete set null;
  end if;
end $$;

create table if not exists public.ao_agenda (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint ao_agenda_bureau_fk references public.bureaux (id) on delete cascade,
  affaire_id uuid not null,
  jour       date not null,
  heure      time,
  genre      text not null default 'autre'
             check (genre in ('visite', 'questions', 'remise', 'ouverture', 'presentation', 'seance', 'autre')),
  titre      text not null check (char_length(titre) between 1 and 200),
  lieu       text not null default '' check (char_length(lieu) <= 200),
  note       text not null default '',
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now(),
  constraint ao_agenda_affaire_fk foreign key (affaire_id, bureau_id)
    references public.affaires (id, bureau_id) on delete cascade
);
create index if not exists ao_agenda_bureau on public.ao_agenda (bureau_id, jour);

alter table public.ao_agenda enable row level security;
drop policy if exists "bureau courant (lecture)"      on public.ao_agenda;
drop policy if exists "bureau courant (création)"     on public.ao_agenda;
drop policy if exists "bureau courant (modification)" on public.ao_agenda;
drop policy if exists "bureau courant (suppression)"  on public.ao_agenda;
create policy "bureau courant (lecture)" on public.ao_agenda for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.ao_agenda for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.ao_agenda for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (suppression)" on public.ao_agenda for delete to authenticated
  using (bureau_id = (select public.bureau_courant()));

drop trigger if exists maj_le on public.ao_agenda;
create trigger maj_le before update on public.ao_agenda
  for each row execute function public.touche_maj_le();

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ao_agenda') then
    alter publication supabase_realtime add table public.ao_agenda;
  end if;
end $$;

commit;

-- L'API relit la forme des tables
notify pgrst, 'reload schema';
