-- ============================================================================
--  Migration : module Communication de l'espace AB (06.10.2026)
-- ----------------------------------------------------------------------------
--  Ajoute la table rendez_vous : l'agenda interne du bureau (un rendez-vous,
--  ses participants, son lieu). Les colonnes source et externe_id préparent la
--  réplication avec Outlook, à venir. Il se relance sans dommage.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

-- Agenda interne du bureau (espace AB, module Communication) : rendez-vous
-- d'une ou plusieurs personnes. externe_id et source préparent la réplication
-- avec Outlook (identifiant de l'événement de l'autre côté), encore à venir.
create table if not exists public.rendez_vous (
  id           uuid primary key default gen_random_uuid(),
  bureau_id    uuid not null default public.bureau_par_defaut()
               constraint rendez_vous_bureau_fk references public.bureaux (id) on delete cascade,
  titre        text not null check (char_length(titre) between 1 and 200),
  jour         date not null,
  debut        time,                     -- vide : toute la journée
  fin          time,
  lieu         text not null default '' check (char_length(lieu) <= 200),
  note         text not null default '',
  participants uuid[] not null default '{}',   -- fiches d'équipe (membres)
  cree_par     uuid,                     -- fiche de la personne qui l'a noté
  source       text not null default 'planif' check (source in ('planif', 'outlook')),
  externe_id   text,
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now(),
  constraint rendez_vous_heures check (debut is null or fin is null or fin > debut)
);
create index if not exists rendez_vous_bureau on public.rendez_vous (bureau_id, jour);

alter table public.rendez_vous enable row level security;
drop policy if exists "bureau courant (lecture)"             on public.rendez_vous;
drop policy if exists "bureau courant (création)"            on public.rendez_vous;
drop policy if exists "les siens ou le droit (modification)" on public.rendez_vous;
drop policy if exists "les siens ou le droit (suppression)"  on public.rendez_vous;
-- Rendez-vous : tout le bureau les voit et en note ; seuls celui qui l'a
-- noté, ses participants et qui a le droit de poser les absences des autres
-- les modifient ou les retirent.
create policy "bureau courant (lecture)" on public.rendez_vous for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.rendez_vous for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "les siens ou le droit (modification)" on public.rendez_vous for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    cree_par = (select public.mon_membre())
    or (select public.mon_membre()) = any (participants)
    or (select public.a_droit('absences_autrui'))))
  with check (bureau_id = (select public.bureau_courant()));
create policy "les siens ou le droit (suppression)" on public.rendez_vous for delete to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    cree_par = (select public.mon_membre())
    or (select public.mon_membre()) = any (participants)
    or (select public.a_droit('absences_autrui'))));

drop trigger if exists maj_le on public.rendez_vous;
create trigger maj_le before update on public.rendez_vous
  for each row execute function public.touche_maj_le();

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rendez_vous') then
    alter publication supabase_realtime add table public.rendez_vous;
  end if;
end $$;

commit;

-- L'API relit la forme des tables
notify pgrst, 'reload schema';
