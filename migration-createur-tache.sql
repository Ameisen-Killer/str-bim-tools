-- ============================================================================
--  Migration du 16.11.2026 : qui a créé une tâche.
--  À exécuter une fois dans Supabase › SQL Editor (rejouable).
--  - colonne taches.cree_par : la fiche de la personne qui a créé la tâche ;
--  - posée par la base à la création (la page ne peut pas la choisir), puis
--    jamais modifiée ;
--  - les tâches existantes restent sans créateur : la page n'affiche alors
--    que la date de création.
-- ============================================================================

begin;

-- 1. La colonne
alter table public.taches
  add column if not exists cree_par uuid
    constraint taches_cree_par_fk references public.membres (id) on delete set null;
comment on column public.taches.cree_par is
  'Fiche de la personne qui a créé la tâche (posée par la base). Vide : tâche d''avant le 16.11.2026, ou créée hors session.';

-- 2. Posée à la création, figée ensuite
create or replace function public.garde_createur_tache()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Une session : la personne connectée. Sans session (tâche planifiée), ce qui est envoyé.
    new.cree_par := coalesce(public.mon_membre(), new.cree_par);
  else
    new.cree_par := old.cree_par;
  end if;
  return new;
end $$;
revoke all on function public.garde_createur_tache() from public, anon, authenticated;
drop trigger if exists garde_createur on public.taches;
create trigger garde_createur before insert or update on public.taches
  for each row execute function public.garde_createur_tache();

commit;

-- Contrôle : doit renvoyer une ligne « cree_par »
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'taches' and column_name = 'cree_par';
