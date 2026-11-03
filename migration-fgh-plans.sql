-- ============================================================================
--  Migration du 03.11.2026 : table de la liste des plans Fairmont (/fgh/pln/).
--  À exécuter une fois dans Supabase › SQL Editor. Sans risque pour le reste :
--  ne crée que la table fgh_plans et sa sécurité (rejouable).
-- ============================================================================

begin;

-- ============================================================ Plans FGH ==
-- L'outil /fgh/pln/ : la liste des plans du chantier Fairmont (03.11.2026).
-- Comme Visas, ouvert SANS CONNEXION à toute personne qui a l'adresse : le rôle
-- anon (la clé publiable seule) lit, crée, modifie et supprime des plans.
-- Une ligne = un livrable à son indice en cours. Les champs suivent le code
-- Kairnial FGH-STR-ABI-51-<type>-<niveau>-<zone>-<n°> ; les bornes limitent ce
-- qu'un inconnu peut y glisser. La base pose elle-même l'heure de modification.
create table if not exists public.fgh_plans (
  id          uuid primary key default gen_random_uuid(),
  projet      text not null default 'FGH' check (char_length(projet) between 1 and 10),
  discipline  text not null default 'STR' check (char_length(discipline) between 1 and 10),
  emetteur    text not null default 'ABI' check (char_length(emetteur) between 1 and 10),
  phase       text not null default '51'  check (char_length(phase) between 1 and 10),
  type        text not null check (char_length(type) between 1 and 10),
  niveau      text not null default '000' check (char_length(niveau) between 1 and 10),
  zone        text not null default 'TTZ' check (char_length(zone) between 1 and 10),
  numero      text not null check (char_length(numero) between 1 and 10),
  indice      text not null default '00' check (char_length(indice) <= 10),
  titre       text not null default '' check (char_length(titre) <= 300),
  date_indice date,
  auteur      text not null default '' check (char_length(auteur) <= 100),
  statut      text not null default '' check (char_length(statut) <= 40),
  remarque    text not null default '' check (char_length(remarque) <= 2000),
  source      text not null default 'manuel' check (source in ('manuel', 'kairnial')),
  controle_n  text not null default '' check (char_length(controle_n) <= 20),
  date_controle date,
  controle_par text not null default '' check (char_length(controle_par) <= 100),
  cree_le     timestamptz not null default now(),
  modifie_le  timestamptz not null default now(),
  modifie_par text not null default '' check (char_length(modifie_par) <= 100)
);
create index if not exists fgh_plans_code on public.fgh_plans (type, niveau, zone, numero);
-- Contrôle d'armatures (/fgh/arm/) : n°, date et auteur du dernier contrôle avant bétonnage
-- (colonnes ajoutées le 03.11.2026 ; « if not exists » pour une base qui a déjà la table)
alter table public.fgh_plans add column if not exists controle_n text not null default '' check (char_length(controle_n) <= 20);
alter table public.fgh_plans add column if not exists date_controle date;
alter table public.fgh_plans add column if not exists controle_par text not null default '' check (char_length(controle_par) <= 100);
-- 03.11.2026 : résumé et lien PDF du contrôle ARM, liste associée à un plan d'armatures
alter table public.fgh_plans add column if not exists controle_info text not null default '' check (char_length(controle_info) <= 200);
alter table public.fgh_plans add column if not exists controle_lien text not null default '' check (char_length(controle_lien) <= 1000);
alter table public.fgh_plans add column if not exists liste_assoc text not null default '' check (char_length(liste_assoc) <= 60);

create or replace function public.fgh_plans_horodate()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.modifie_le := now();
  if tg_op = 'INSERT' then new.cree_le := now(); end if;
  return new;
end $$;
revoke all on function public.fgh_plans_horodate() from public, anon, authenticated;
drop trigger if exists fgh_plans_horodate on public.fgh_plans;
create trigger fgh_plans_horodate before insert or update on public.fgh_plans
  for each row execute function public.fgh_plans_horodate();

alter table public.fgh_plans enable row level security;
revoke all on public.fgh_plans from anon, authenticated;
grant select, insert, update, delete on public.fgh_plans to anon, authenticated;
drop policy if exists "fgh plans : lecture"      on public.fgh_plans;
drop policy if exists "fgh plans : création"     on public.fgh_plans;
drop policy if exists "fgh plans : modification" on public.fgh_plans;
drop policy if exists "fgh plans : suppression"  on public.fgh_plans;
create policy "fgh plans : lecture"      on public.fgh_plans for select to anon, authenticated using (true);
create policy "fgh plans : création"     on public.fgh_plans for insert to anon, authenticated with check (true);
create policy "fgh plans : modification" on public.fgh_plans for update to anon, authenticated using (true) with check (true);
create policy "fgh plans : suppression"  on public.fgh_plans for delete to anon, authenticated using (true);

commit;

notify pgrst, 'reload schema';
