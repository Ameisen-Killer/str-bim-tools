-- ============================================================================
--  Migration : priorité des tâches (06.10.2026)
-- ----------------------------------------------------------------------------
--  Entre deux tâches de même échéance, la priorité les départage : de 1 (la
--  plus importante) à 5 (par défaut). Elle sert d'abord à l'accueil du bureau
--  AB (/ab/, « Mes tâches prioritaires ») ; le curseur de saisie suivra.
--
--  Ce script ajoute la colonne taches.priorite (toutes les tâches existantes
--  prennent 5). Il se relance sans dommage.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

alter table public.taches
  add column if not exists priorite smallint not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'taches_priorite_check' and conrelid = 'public.taches'::regclass) then
    alter table public.taches
      add constraint taches_priorite_check check (priorite between 1 and 5);
  end if;
end $$;

commit;

-- PostgREST relit le schéma : la colonne est visible tout de suite
notify pgrst, 'reload schema';
