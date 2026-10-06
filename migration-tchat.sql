-- Planification — tchat du bureau (module Communication, 06.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute la table messages : les messages du tchat,
-- lus par tout le bureau, écrits par chacun en son nom, retirés par leur
-- auteur (ou le super admin). Le compte de démonstration, partagé et public,
-- n'écrit pas dans la base : ses messages restent sur son écran.
-- ---------------------------------------------------------------------------
begin;

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint messages_bureau_fk references public.bureaux (id) on delete cascade,
  auteur_id  uuid default public.mon_membre()
             constraint messages_auteur_fk references public.membres (id) on delete set null,
  texte      text not null check (char_length(btrim(texte)) between 1 and 2000),
  cree_le    timestamptz not null default now()
);
create index if not exists messages_bureau on public.messages (bureau_id, cree_le desc);

alter table public.messages enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'messages' loop
    execute format('drop policy %I on public.messages', p.policyname);
  end loop;
end $$;

create policy "bureau courant (lecture)" on public.messages for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "en son nom (création)" on public.messages for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and auteur_id is not null and auteur_id = (select public.mon_membre())
              and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');
create policy "les siens (suppression)" on public.messages for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (auteur_id = (select public.mon_membre()) or (select public.est_super_admin())));

-- En direct : les pages ouvertes reçoivent les messages dès qu'ils partent
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

commit;

-- L'API relit la forme des tables
notify pgrst, 'reload schema';
