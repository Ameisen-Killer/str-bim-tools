-- ============================================================================
--  Migration du 04.11.2026 : organiseur de documents (/organiseur/).
--  À exécuter une fois dans Supabase › SQL Editor. Sans risque pour le reste :
--  ne crée que les tables doc_chantiers et doc_reservations et leur sécurité
--  (rejouable).
-- ============================================================================

begin;

-- ===================================================== Organiseur de documents ==
-- L'outil /organiseur/ (04.11.2026) : numérotation des documents par chantier et
-- réservation de plages de numéros à l'avance. Comme la liste des plans FGH,
-- ouvert SANS CONNEXION à toute personne qui a l'adresse (rôle anon).
-- doc_chantiers.config (jsonb) porte les référentiels du chantier : gabarit du
-- code, disciplines, phases, types de document, bâtiments avec niveaux et zones,
-- arbre des plages (lots et sous-lots). doc_reservations = un bloc de n° (de–à)
-- réservé pour un type ; deux réservations actives de la même suite de numéros ne
-- peuvent pas se chevaucher dans un chantier (vérifié par la base, verrou par chantier).
create table if not exists public.doc_chantiers (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (char_length(code) between 1 and 20),
  nom         text not null default '' check (char_length(nom) <= 200),
  config      jsonb not null default '{}'::jsonb check (pg_column_size(config) <= 200000),
  cree_le     timestamptz not null default now(),
  modifie_le  timestamptz not null default now(),
  modifie_par text not null default '' check (char_length(modifie_par) <= 100)
);
create unique index if not exists doc_chantiers_code on public.doc_chantiers (upper(code));

create table if not exists public.doc_reservations (
  id          uuid primary key default gen_random_uuid(),
  chantier    uuid not null references public.doc_chantiers (id) on delete cascade,
  de          integer not null check (de between 0 and 999999),
  a           integer not null check (a between 0 and 999999),
  type        text not null check (char_length(type) between 1 and 10),
  discipline  text not null default '' check (char_length(discipline) <= 10),
  phase       text not null default '' check (char_length(phase) <= 10),
  batiment    text not null default '' check (char_length(batiment) <= 10),
  niveau      text not null default '' check (char_length(niveau) <= 10),
  zone        text not null default '' check (char_length(zone) <= 10),
  titre       text not null default '' check (char_length(titre) <= 300),
  par         text not null default '' check (char_length(par) <= 100),
  echeance    date,
  statut      text not null default 'reserve' check (statut in ('reserve', 'emis', 'annule')),
  remarque    text not null default '' check (char_length(remarque) <= 2000),
  cree_le     timestamptz not null default now(),
  modifie_le  timestamptz not null default now(),
  modifie_par text not null default '' check (char_length(modifie_par) <= 100),
  check (a >= de and a - de < 1000)
);
create index if not exists doc_reservations_chantier on public.doc_reservations (chantier, type, de);

create or replace function public.doc_horodate()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.modifie_le := now();
  if tg_op = 'INSERT' then new.cree_le := now(); end if;
  return new;
end $$;
revoke all on function public.doc_horodate() from public, anon, authenticated;
drop trigger if exists doc_chantiers_horodate on public.doc_chantiers;
create trigger doc_chantiers_horodate before insert or update on public.doc_chantiers
  for each row execute function public.doc_horodate();
drop trigger if exists doc_reservations_horodate on public.doc_reservations;
create trigger doc_reservations_horodate before insert or update on public.doc_reservations
  for each row execute function public.doc_horodate();

-- deux personnes qui réservent en même temps : la seconde est refusée (verrou par chantier)
create or replace function public.doc_reservations_chevauche()
returns trigger
language plpgsql set search_path = '' as $$
declare autre record; propres text[]; esp text;
begin
  if new.statut = 'annule' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('doc_res:' || new.chantier::text));
  -- les types « à numérotation propre » (config.types[].propre, ex. ARM et LIS qui reprennent
  -- le n° de l'ouvrage) ont chacun leur suite ; tous les autres partagent la numérotation commune
  select coalesce(array_agg(upper(x->>'c')), '{}') into propres
    from public.doc_chantiers c,
         jsonb_array_elements(case when jsonb_typeof(c.config->'types') = 'array' then c.config->'types' else '[]'::jsonb end) x
   where c.id = new.chantier and x->>'propre' = 'true';
  esp := case when upper(new.type) = any(propres) then upper(new.type) else '*' end;
  select de, a, titre into autre from public.doc_reservations r
   where r.chantier = new.chantier and r.id <> new.id and r.statut <> 'annule'
     and (case when upper(r.type) = any(propres) then upper(r.type) else '*' end) = esp
     and r.de <= new.a and new.de <= r.a
   limit 1;
  if found then
    raise exception 'Numéros déjà réservés : % à % (%)', autre.de, autre.a, autre.titre using errcode = '23P01';
  end if;
  return new;
end $$;
revoke all on function public.doc_reservations_chevauche() from public, anon, authenticated;
drop trigger if exists doc_reservations_chevauche on public.doc_reservations;
create trigger doc_reservations_chevauche before insert or update on public.doc_reservations
  for each row execute function public.doc_reservations_chevauche();

alter table public.doc_chantiers enable row level security;
alter table public.doc_reservations enable row level security;
revoke all on public.doc_chantiers, public.doc_reservations from anon, authenticated;
grant select, insert, update, delete on public.doc_chantiers, public.doc_reservations to anon, authenticated;
drop policy if exists "doc chantiers : lecture"      on public.doc_chantiers;
drop policy if exists "doc chantiers : création"     on public.doc_chantiers;
drop policy if exists "doc chantiers : modification" on public.doc_chantiers;
drop policy if exists "doc chantiers : suppression"  on public.doc_chantiers;
create policy "doc chantiers : lecture"      on public.doc_chantiers for select to anon, authenticated using (true);
create policy "doc chantiers : création"     on public.doc_chantiers for insert to anon, authenticated with check (true);
create policy "doc chantiers : modification" on public.doc_chantiers for update to anon, authenticated using (true) with check (true);
create policy "doc chantiers : suppression"  on public.doc_chantiers for delete to anon, authenticated using (true);
drop policy if exists "doc réservations : lecture"      on public.doc_reservations;
drop policy if exists "doc réservations : création"     on public.doc_reservations;
drop policy if exists "doc réservations : modification" on public.doc_reservations;
drop policy if exists "doc réservations : suppression"  on public.doc_reservations;
create policy "doc réservations : lecture"      on public.doc_reservations for select to anon, authenticated using (true);
create policy "doc réservations : création"     on public.doc_reservations for insert to anon, authenticated with check (true);
create policy "doc réservations : modification" on public.doc_reservations for update to anon, authenticated using (true) with check (true);
create policy "doc réservations : suppression"  on public.doc_reservations for delete to anon, authenticated using (true);

commit;

notify pgrst, 'reload schema';
