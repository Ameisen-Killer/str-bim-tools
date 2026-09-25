-- ============================================================================
--  Outil de planification — annuaire des contacts
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Ajoute la table des fiches de contact — clients, architectes, entreprises,
--  bureaux spécialisés — que la page /planif/annuaire/ affiche et tient à jour.
--
--  Une fiche appartient à un bureau, comme les affaires et les tâches : chacun
--  voit l'annuaire du sien, et lui seul. Tout le bureau peut lire, créer,
--  modifier et retirer une fiche : un carnet d'adresses est un outil commun,
--  pas le travail de quelqu'un. Si un jour cela doit se restreindre, c'est un
--  droit à ajouter dans droits_groupes, sur le modèle de « affaires_creer ».
--
--  Une fiche porte au moins un nom ou une société : une ligne sans l'un ni
--  l'autre ne se retrouverait pas. Elle porte aussi son adresse postale :
--  rue, NPA, localité, canton, pays.
--
--  DÉJÀ LANCÉE UNE FOIS ? Relance-la : l'adresse postale est arrivée après,
--  et les colonnes manquantes s'ajoutent sans toucher aux fiches existantes.
--
--  ORDRE À RESPECTER
--    migration-multi-bureaux.sql d'abord (c'est elle qui pose bureau_par_defaut
--    et bureau_courant).
-- ============================================================================

begin;

-- ------------------------------------------------------------- garde-fou ---
do $$
begin
  if to_regprocedure('public.bureau_par_defaut()') is null then
    raise exception 'Exécute d''abord migration-multi-bureaux.sql : les bureaux n''existent pas encore.';
  end if;
end $$;

-- ---------------------------------------------------------------- table ---
create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  bureau_id    uuid not null default public.bureau_par_defaut()
               constraint contacts_bureau_fk references public.bureaux (id) on delete cascade,
  nom          text not null default '',
  prenom       text not null default '',
  societe      text not null default '',
  telephone    text not null default '',
  natel        text not null default '',
  email        text not null default '',
  role         text not null default '',
  adresse      text not null default '',
  npa          text not null default '',
  localite     text not null default '',
  canton       text not null default '',
  pays         text not null default '',
  observations text not null default '',
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now(),
  constraint contacts_nom_ou_societe
    check (char_length(trim(nom)) > 0 or char_length(trim(societe)) > 0)
);
create index if not exists contacts_bureau on public.contacts (bureau_id);

-- Table déjà créée par une version précédente de ce fichier : l'adresse postale
-- s'y ajoute ici. C'est ce qui permet de relancer ce script sans y penser.
alter table public.contacts add column if not exists adresse  text not null default '';
alter table public.contacts add column if not exists npa      text not null default '';
alter table public.contacts add column if not exists localite text not null default '';
alter table public.contacts add column if not exists canton   text not null default '';
alter table public.contacts add column if not exists pays     text not null default '';

comment on table  public.contacts is
  'Annuaire du bureau : clients, architectes, entreprises et partenaires.';
comment on column public.contacts.role is
  'Rôle dans les projets — architecte, maître d''ouvrage, entreprise… Texte libre.';
comment on column public.contacts.natel is
  'Téléphone mobile (suisse romand pour « portable »).';
comment on column public.contacts.npa is
  'Code postal. Texte et non nombre : les NPA étrangers ont des lettres et des zéros en tête.';
comment on column public.contacts.canton is
  'Canton, en abrégé (VD, GE, VS…). Vide pour une adresse hors de Suisse.';

-- ------------------------------------------------------- date de mise à jour ---
drop trigger if exists maj_le on public.contacts;
create trigger maj_le before update on public.contacts
  for each row execute function public.touche_maj_le();

-- ----------------------------------------------------------------- accès ---
-- Lire et tenir l'annuaire de son bureau, rien de plus : les quatre règles
-- portent la même condition, celle des affaires en modification.
alter table public.contacts enable row level security;

drop policy if exists "bureau courant (lecture)"      on public.contacts;
drop policy if exists "bureau courant (création)"     on public.contacts;
drop policy if exists "bureau courant (modification)" on public.contacts;
drop policy if exists "bureau courant (suppression)"  on public.contacts;

create policy "bureau courant (lecture)" on public.contacts for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.contacts for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.contacts for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (suppression)" on public.contacts for delete to authenticated
  using (bureau_id = (select public.bureau_courant()));

commit;

-- ==================================================================== rapport ==
-- Les colonnes en place, adresse postale comprise.
select string_agg(column_name, ', ' order by ordinal_position) as colonnes
  from information_schema.columns
 where table_schema = 'public' and table_name = 'contacts';

-- Ce que la base applique désormais sur l'annuaire.
select p.cmd                                            as commande,
       p.policyname                                     as regle,
       case when p.with_check is null then '—' else 'oui' end as controle_a_l_arrivee
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'contacts'
 order by p.cmd, p.policyname;
