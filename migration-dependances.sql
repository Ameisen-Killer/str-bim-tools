-- ============================================================================
--  Migration du 11.11.2026 : dépendances entre tâches.
--  À exécuter une fois dans Supabase › SQL Editor (rejouable).
--  Une tâche n'a plus « un calcul et un dessin » : elle a une personne
--  désignée et, au besoin, une ou plusieurs dépendances. Une dépendance est
--  une tâche ordinaire (sa personne, sa charge) qui doit être rendue avant
--  le début de la tâche principale ; la colonne « avant » la rattache à
--  cette tâche principale.
--    - supprimer la tâche principale supprime ses dépendances ;
--    - qui tient la tâche principale peut créer, modifier et supprimer ses
--      dépendances, même sans le droit « créer des tâches pour les autres ».
-- ============================================================================

begin;

-- 1. La colonne : la tâche principale que cette tâche-ci doit précéder
alter table public.taches
  add column if not exists avant uuid references public.taches (id) on delete cascade;
create index if not exists taches_avant on public.taches (avant);
comment on column public.taches.avant is
  'Dépendance : la tâche principale qu''elle doit précéder (rendue la veille de son début). Vide : tâche principale.';

-- 2. Est-ce que je tiens cette tâche (une part chargée à mon nom) ?
create or replace function public.tient_tache(p_tache uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.taches t
     where t.id = p_tache
       and t.bureau_id = public.bureau_courant()
       and ((t.ingenieur_id   = public.mon_membre() and t.charge_inge   > 0)
         or (t.dessinateur_id = public.mon_membre() and t.charge_dessin > 0)));
$$;
revoke all on function public.tient_tache(uuid) from public, anon;
grant execute on function public.tient_tache(uuid) to authenticated;

-- 3. Les règles d'écriture des tâches, avec les dépendances de mes tâches
drop policy if exists "droit ou ma tâche (création)" on public.taches;
create policy "droit ou ma tâche (création)" on public.taches for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)
    or (avant is not null and public.tient_tache(avant))));

drop policy if exists "droit ou ma tâche (modification)" on public.taches;
create policy "droit ou ma tâche (modification)" on public.taches for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)
    or (ingenieur_id   is null and charge_inge   > 0)
    or (dessinateur_id is null and charge_dessin > 0)
    or (avant is not null and public.tient_tache(avant))))
  with check (bureau_id = (select public.bureau_courant()));

drop policy if exists "droit ou ma tâche (suppression)" on public.taches;
create policy "droit ou ma tâche (suppression)" on public.taches for delete to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)
    or (avant is not null and public.tient_tache(avant))));

commit;

-- L'API relit le schéma : la colonne est visible tout de suite
notify pgrst, 'reload schema';
