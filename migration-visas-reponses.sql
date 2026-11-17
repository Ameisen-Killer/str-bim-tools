-- Visas FGH : réponse aux questions des visas, par plan (17.11.2026).
-- Texte écrit dans l'outil Visas, à pousser ensuite dans Kairnial (envoye_le). Rejouable.
create table if not exists public.visas_reponses (
  code       text primary key check (char_length(code) between 1 and 200),
  texte      text not null check (char_length(texte) between 1 and 4000),
  indice     integer check (indice between 0 and 999),
  envoye_le  timestamptz,
  modifie_le timestamptz not null default now()
);
drop trigger if exists visas_reponses_horodate on public.visas_reponses;
create trigger visas_reponses_horodate before insert or update on public.visas_reponses
  for each row execute function public.visas_note_horodate();
alter table public.visas_reponses enable row level security;
revoke all on public.visas_reponses from anon, authenticated;
grant select, insert, update, delete on public.visas_reponses to authenticated;
drop policy if exists "visas : lecture"      on public.visas_reponses;
drop policy if exists "visas : écriture"     on public.visas_reponses;
drop policy if exists "visas : modification" on public.visas_reponses;
drop policy if exists "visas : retrait"      on public.visas_reponses;
create policy "visas : lecture"      on public.visas_reponses for select to authenticated using ((select public.acces_fgh()));
create policy "visas : écriture"     on public.visas_reponses for insert to authenticated with check ((select public.acces_fgh()));
create policy "visas : modification" on public.visas_reponses for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));
create policy "visas : retrait"      on public.visas_reponses for delete to authenticated using ((select public.acces_fgh()));
