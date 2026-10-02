-- ============================================================================
--  Migration : avis d'absence (02.10.2026)
-- ----------------------------------------------------------------------------
--  La page d'accueil de la planification (/planif/) permet de prévenir le
--  bureau d'une absence à l'heure près — un rendez-vous, un après-midi sur un
--  chantier, une arrivée tardive. Ces avis ne sont pas des absences du
--  planning (qui comptent en jours entiers) : ils informent l'équipe.
--
--  Ce script :
--    - crée la table avis (une ligne par avis, début et fin en date + heure) ;
--    - lui pose les mêmes règles que les absences : tout le bureau lit, chacun
--      écrit les siens, le droit « Poser les absences des autres » écrit ceux
--      des collègues ;
--    - l'ajoute à la publication temps réel (mises à jour en direct) ;
--    - met à jour « Réinitialiser la démo », qui efface aussi les avis.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Relançable sans dommage. Une fois passé, ce fichier sort du dépôt
--  (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

-- ------------------------------------------------------------------- avis ---
create table if not exists public.avis (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint avis_bureau_fk references public.bureaux (id) on delete cascade,
  membre_id  uuid not null,
  debut      timestamptz not null,
  fin        timestamptz not null,
  motif      text not null default 'Absence' check (char_length(motif) <= 200),
  cree_le    timestamptz not null default now(),
  constraint avis_ordonne check (fin > debut),
  constraint avis_membre_bureau_fk foreign key (membre_id, bureau_id)
    references public.membres (id, bureau_id) on delete cascade
);
create index if not exists avis_bureau on public.avis (bureau_id, fin);
comment on table public.avis is
  'Avis d''absence à l''heure près, affichés sur l''accueil de la planification. Ne comptent pas dans le planning (les absences, en jours, s''en chargent).';

alter table public.avis enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'avis' loop
    execute format('drop policy %I on public.avis', p.policyname);
  end loop;
end $$;

create policy "bureau courant (lecture)" on public.avis for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "droit ou mes avis (création)" on public.avis for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and (membre_id = (select public.mon_membre())
                   or (select public.a_droit('absences_autrui'))));
create policy "droit ou mes avis (modification)" on public.avis for update to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (membre_id = (select public.mon_membre())
              or (select public.a_droit('absences_autrui'))))
  with check (bureau_id = (select public.bureau_courant())
              and (membre_id = (select public.mon_membre())
                   or (select public.a_droit('absences_autrui'))));
create policy "droit ou mes avis (suppression)" on public.avis for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (membre_id = (select public.mon_membre())
              or (select public.a_droit('absences_autrui'))));

-- Mises à jour en direct
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'avis'
  ) then
    alter publication supabase_realtime add table public.avis;
  end if;
end $$;

-- Réinitialiser la démo : les avis du Bureau de test partent avec le reste
create or replace function public.console_reinitialise_demo()
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  n        int;
  v_bureau uuid;
  v_membre uuid;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;

  select count(*), min(b.id::text)::uuid into n, v_bureau from public.bureaux b where b.nom = 'Bureau de test';
  if n = 0 then
    raise exception 'Aucun bureau nommé « Bureau de test ».';
  elsif n > 1 then
    raise exception 'Plusieurs bureaux s''appellent « Bureau de test » : en renommer un.';
  end if;

  -- Tout ce qu'un testeur a pu toucher
  delete from public.affaires where bureau_id = v_bureau;   -- tâches et équipes suivent
  delete from public.absences where bureau_id = v_bureau;
  delete from public.avis     where bureau_id = v_bureau;
  delete from public.contacts where bureau_id = v_bureau;
  delete from public.membres  where bureau_id = v_bureau and email like '%@demo.exemple.ch';

  perform public.remplit_demo(v_bureau);

  -- Le compte de démonstration retrouve sa fiche
  select m.id into v_membre from public.membres m
   where m.bureau_id = v_bureau and m.email = 'laurent.mercier@demo.exemple.ch';
  update public.acces set membre_id = v_membre
   where email = 'demo@str-bim-tools.com' and bureau_id = v_bureau;

  return jsonb_build_object(
    'membres',  (select count(*) from public.membres  where bureau_id = v_bureau),
    'affaires', (select count(*) from public.affaires where bureau_id = v_bureau),
    'taches',   (select count(*) from public.taches   where bureau_id = v_bureau),
    'absences', (select count(*) from public.absences where bureau_id = v_bureau));
end $$;
revoke execute on function public.console_reinitialise_demo() from public, anon;
grant execute on function public.console_reinitialise_demo() to authenticated;

commit;

-- L'API relit la forme des tables
notify pgrst, 'reload schema';
