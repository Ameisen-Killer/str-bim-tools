-- ============================================================================
--  Migration : demandes de congé à valider (espace AB, 06.10.2026)
-- ----------------------------------------------------------------------------
--  Ajoute la table conges et les fonctions peut_valider_conge et decide_conge.
--  On demande un congé pour soi ; un chef de secteur de la même discipline ou
--  un administrateur l'accepte ou le refuse ; accepté, il devient une absence
--  du planning. Il se relance sans dommage.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

-- Demandes de congé (espace AB, module Communication) : la personne demande,
-- un chef de son secteur (même discipline) ou un administrateur décide. Une
-- demande acceptée devient une absence du planning (decide_conge).
create table if not exists public.conges (
  id          uuid primary key default gen_random_uuid(),
  bureau_id   uuid not null default public.bureau_par_defaut()
              constraint conges_bureau_fk references public.bureaux (id) on delete cascade,
  membre_id   uuid not null,
  debut       date not null,
  fin         date not null,
  motif       text not null default 'Vacances' check (char_length(motif) between 1 and 100),
  commentaire text not null default '',
  statut      text not null default 'en_attente'
              check (statut in ('en_attente', 'acceptee', 'refusee', 'annulee')),
  valide_par  uuid,                       -- fiche de la personne qui a décidé
  valide_le   timestamptz,
  reponse     text not null default '',
  absence_id  uuid references public.absences (id) on delete set null,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  constraint conges_ordonne check (fin >= debut),
  constraint conges_membre_bureau_fk foreign key (membre_id, bureau_id)
    references public.membres (id, bureau_id) on delete cascade
);
create index if not exists conges_bureau on public.conges (bureau_id, statut, debut);

alter table public.conges enable row level security;
drop policy if exists "bureau courant (lecture)"           on public.conges;
drop policy if exists "ma demande ou le droit (création)"  on public.conges;
drop policy if exists "ma demande en attente (annulation)" on public.conges;
-- Demandes de congé : tout le bureau les voit (qui part quand) ; on demande
-- pour soi (ou pour un autre avec le droit sur ses absences), on annule sa
-- demande tant qu'elle attend. La décision passe par decide_conge.
create policy "bureau courant (lecture)" on public.conges for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "ma demande ou le droit (création)" on public.conges for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()) and statut = 'en_attente'
              and valide_par is null and absence_id is null
              and (membre_id = (select public.mon_membre()) or (select public.a_droit('absences_autrui'))));
create policy "ma demande en attente (annulation)" on public.conges for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and statut = 'en_attente'
         and (membre_id = (select public.mon_membre()) or (select public.a_droit('absences_autrui'))))
  with check (bureau_id = (select public.bureau_courant()) and statut in ('en_attente', 'annulee')
              and valide_par is null and absence_id is null);

-- Qui décide d'un congé : un administrateur du bureau, ou un chef de secteur
-- de la même discipline — jamais pour soi-même ; le super admin, toujours.
create or replace function public.peut_valider_conge(p_membre uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_super_admin() or exists (
    select 1
      from public.membres moi
      join public.membres lui on lui.id = p_membre and lui.bureau_id = moi.bureau_id
     where moi.id = public.mon_membre()
       and moi.id <> lui.id
       and ('administrateur' = any (moi.statuts)
            or ('chef_secteur' = any (moi.statuts) and moi.discipline is not null
                and moi.discipline = lui.discipline)));
$$;

-- Accepter ou refuser une demande. Acceptée, elle devient une absence du
-- planning : la personne qui décide n'a pas forcément le droit d'écrire les
-- absences des autres, d'où cette fonction plutôt qu'une écriture directe.
create or replace function public.decide_conge(p_demande uuid, p_accepte boolean, p_reponse text default '')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_d   public.conges%rowtype;
  v_abs uuid;
begin
  if not public.est_autorise() then
    raise exception 'Accès refusé. Ton adresse est-elle bien dans la liste des accès ?';
  end if;
  select * into v_d from public.conges c
   where c.id = p_demande and c.bureau_id = public.bureau_courant()
   for update;
  if not found then
    raise exception 'Cette demande de congé n''existe plus.';
  end if;
  if v_d.statut <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;
  if not public.peut_valider_conge(v_d.membre_id) then
    raise exception 'Tu ne décides que des congés de ton secteur (chef de secteur de la même discipline, ou administrateur).';
  end if;
  if p_accepte then
    insert into public.absences (bureau_id, membre_id, debut, fin, motif)
    values (v_d.bureau_id, v_d.membre_id, v_d.debut, v_d.fin, v_d.motif)
    returning id into v_abs;
  end if;
  update public.conges c
     set statut = case when p_accepte then 'acceptee' else 'refusee' end,
         valide_par = public.mon_membre(), valide_le = now(),
         reponse = coalesce(p_reponse, ''), absence_id = v_abs
   where c.id = v_d.id;
end $$;

revoke all on function public.peut_valider_conge(uuid) from public, anon;
grant execute on function public.peut_valider_conge(uuid) to authenticated;
revoke all on function public.decide_conge(uuid, boolean, text) from public, anon;
grant execute on function public.decide_conge(uuid, boolean, text) to authenticated;

drop trigger if exists maj_le on public.conges;
create trigger maj_le before update on public.conges
  for each row execute function public.touche_maj_le();

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conges') then
    alter publication supabase_realtime add table public.conges;
  end if;
end $$;

commit;

-- L'API relit la forme des tables et des fonctions
notify pgrst, 'reload schema';
