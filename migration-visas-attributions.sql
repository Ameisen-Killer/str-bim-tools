-- Visas FGH : qui doit reprendre le plan (17.11.2026). Une ligne par plan. Rejouable.
create table if not exists public.visas_attributions (
  code       text primary key check (char_length(code) between 1 and 200),
  qui        text not null check (char_length(qui) between 1 and 100),
  modifie_le timestamptz not null default now()
);
drop trigger if exists visas_attributions_horodate on public.visas_attributions;
create trigger visas_attributions_horodate before insert or update on public.visas_attributions
  for each row execute function public.visas_note_horodate();
alter table public.visas_attributions enable row level security;
revoke all on public.visas_attributions from anon, authenticated;
grant select, insert, update, delete on public.visas_attributions to authenticated;
drop policy if exists "visas : lecture"      on public.visas_attributions;
drop policy if exists "visas : écriture"     on public.visas_attributions;
drop policy if exists "visas : modification" on public.visas_attributions;
drop policy if exists "visas : retrait"      on public.visas_attributions;
create policy "visas : lecture"      on public.visas_attributions for select to authenticated using ((select public.acces_fgh()));
create policy "visas : écriture"     on public.visas_attributions for insert to authenticated with check ((select public.acces_fgh()));
create policy "visas : modification" on public.visas_attributions for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));
create policy "visas : retrait"      on public.visas_attributions for delete to authenticated using ((select public.acces_fgh()));
