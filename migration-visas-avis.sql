-- Visas FGH : avis sur les remarques des visas (17.11.2026).
-- Une ligne = une remarque (clé = texte réduit, sans accents ni ponctuation, 80 car.)
-- et l'avis retenu : nous concerne / ne nous concerne pas / doute. Rejouable.
create table if not exists public.visas_avis (
  cle        text primary key check (char_length(cle) between 1 and 120),
  avis       text not null check (avis in ('nous', 'pas', 'doute')),
  texte      text not null default '' check (char_length(texte) <= 600),
  modifie_le timestamptz not null default now()
);
create or replace function public.visas_avis_horodate()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.modifie_le := now();
  return new;
end $$;
drop trigger if exists visas_avis_horodate on public.visas_avis;
create trigger visas_avis_horodate before update on public.visas_avis
  for each row execute function public.visas_avis_horodate();
alter table public.visas_avis enable row level security;
revoke all on public.visas_avis from anon, authenticated;
grant select, insert, update, delete on public.visas_avis to authenticated;
drop policy if exists "visas : lecture"      on public.visas_avis;
drop policy if exists "visas : écriture"     on public.visas_avis;
drop policy if exists "visas : modification" on public.visas_avis;
drop policy if exists "visas : retrait"      on public.visas_avis;
create policy "visas : lecture"      on public.visas_avis for select to authenticated using ((select public.acces_fgh()));
create policy "visas : écriture"     on public.visas_avis for insert to authenticated with check ((select public.acces_fgh()));
create policy "visas : modification" on public.visas_avis for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));
create policy "visas : retrait"      on public.visas_avis for delete to authenticated using ((select public.acces_fgh()));
