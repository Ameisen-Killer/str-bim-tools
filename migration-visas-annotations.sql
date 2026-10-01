-- ============================================================================
--  Migration : annotations par plan dans Visas (01.10.2026)
-- ----------------------------------------------------------------------------
--  Une zone de texte par plan dans la liste de /visas/, commune à toute
--  personne qui a l'adresse de l'outil, sans connexion (rôle anon).
--  Crée la table visas_notes et ses droits. Indépendant de
--  migration-visas-partage.sql : les deux peuvent passer dans n'importe quel
--  ordre, et chacun peut être relancé sans dommage.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

-- Annotations : une zone de texte libre par plan (numéro), commune à tous et
-- gardée d'un indice et d'un export à l'autre. Vider la zone efface la ligne.
-- Ici, une annotation se modifie : la dernière écriture l'emporte, et la base
-- pose elle-même l'heure de la modification.
create table if not exists public.visas_notes (
  code        text primary key check (char_length(code) between 1 and 200),
  texte       text not null check (char_length(texte) between 1 and 4000),
  modifie_le  timestamptz not null default now()
);

create or replace function public.visas_note_horodate()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.modifie_le := now();
  return new;
end $$;
revoke all on function public.visas_note_horodate() from public, anon, authenticated;
drop trigger if exists visas_note_horodate on public.visas_notes;
create trigger visas_note_horodate before insert or update on public.visas_notes
  for each row execute function public.visas_note_horodate();

alter table public.visas_notes enable row level security;
revoke all on public.visas_notes from anon, authenticated;
grant select, insert, update, delete on public.visas_notes to anon, authenticated;
drop policy if exists "visas : lecture"      on public.visas_notes;
drop policy if exists "visas : écriture"     on public.visas_notes;
drop policy if exists "visas : modification" on public.visas_notes;
drop policy if exists "visas : retrait"      on public.visas_notes;
create policy "visas : lecture"      on public.visas_notes for select to anon, authenticated using (true);
create policy "visas : écriture"     on public.visas_notes for insert to anon, authenticated with check (true);
create policy "visas : modification" on public.visas_notes for update to anon, authenticated using (true) with check (true);
create policy "visas : retrait"      on public.visas_notes for delete to anon, authenticated using (true);

commit;

-- L'API relit la forme des tables
notify pgrst, 'reload schema';
