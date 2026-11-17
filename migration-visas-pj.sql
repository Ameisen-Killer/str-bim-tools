-- Migration : table visas_pj (liens vers les réponses Kairnial des plans), rejouable.
begin;

-- Réponses Kairnial des plans (17.11.2026) : pour chaque plan (numéro), les pièces
-- jointes des visas (PDF « -reponse »…) avec un lien vers le fichier sur le serveur
-- de Kairnial. Seulement des liens, pas les fichiers. Mêmes droits que les annotations.
create table if not exists public.visas_pj (
  code      text not null check (char_length(code) between 1 and 200),
  url       text not null check (char_length(url) between 20 and 500 and url like 'https://ws-eu-1.kairnial.com/%'),
  indice    integer check (indice between 0 and 999),
  visa      text not null default '' check (char_length(visa) <= 100),
  date_visa timestamptz,
  nom       text not null default '' check (char_length(nom) <= 300),
  ajoute_le timestamptz not null default now(),
  primary key (code, url)
);
alter table public.visas_pj enable row level security;
revoke all on public.visas_pj from anon, authenticated;
grant select, insert, update, delete on public.visas_pj to authenticated;
drop policy if exists "visas : lecture"      on public.visas_pj;
drop policy if exists "visas : écriture"     on public.visas_pj;
drop policy if exists "visas : modification" on public.visas_pj;
drop policy if exists "visas : retrait"      on public.visas_pj;
create policy "visas : lecture"      on public.visas_pj for select to authenticated using ((select public.acces_fgh()));
create policy "visas : écriture"     on public.visas_pj for insert to authenticated with check ((select public.acces_fgh()));
create policy "visas : modification" on public.visas_pj for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));
create policy "visas : retrait"      on public.visas_pj for delete to authenticated using ((select public.acces_fgh()));

commit;
