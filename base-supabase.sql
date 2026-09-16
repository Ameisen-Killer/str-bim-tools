-- ============================================================================
--  Outil de planification STR Bim Tools — schéma PostgreSQL pour Supabase
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--
--  Ce fichier ne contient aucune donnée et aucun secret : il décrit seulement
--  la forme des tables. Il double le modèle utilisé aujourd'hui par le mode
--  local (docs/planif/assets/donnees.js) : mêmes champs, mêmes contraintes.
--
--  Sécurité : la RLS est activée partout et n'ouvre l'accès qu'aux personnes
--  authentifiées. Sans connexion, la clé publique du projet ne donne accès à
--  rien — c'est ce qui permet de publier cette clé dans un dépôt public.
-- ============================================================================

-- ---------------------------------------------------------------- membres ---
create table if not exists public.membres (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  prenom     text not null,
  email      text not null unique,
  role       text not null check (role in ('ingenieur', 'dessinateur')),
  capacite   numeric(3,1) not null default 5 check (capacite > 0 and capacite <= 7),
  actif      boolean not null default true,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now()
);
comment on column public.membres.capacite is 'Jours travaillés par semaine : 5 pour un plein temps.';

-- --------------------------------------------------------------- absences ---
create table if not exists public.absences (
  id         uuid primary key default gen_random_uuid(),
  membre_id  uuid not null references public.membres (id) on delete cascade,
  debut      date not null,
  fin        date not null,
  motif      text not null default 'Absence',
  constraint absence_ordonnee check (fin >= debut)
);
create index if not exists absences_membre on public.absences (membre_id, debut);

-- --------------------------------------------------------------- affaires ---
create table if not exists public.affaires (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  nom        text not null,
  note       text not null default '',
  teinte     smallint not null default 1 check (teinte between 1 and 8),
  statut     text not null default 'active' check (statut in ('active', 'suspendue', 'terminee')),
  echeance   date,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now()
);
comment on column public.affaires.teinte is 'Index 1..8 dans la palette du site : la couleur reste définie côté interface.';

-- Équipe d'une affaire. Le rôle n'est pas répété ici : il est porté par le membre.
create table if not exists public.affaire_membres (
  affaire_id uuid not null references public.affaires (id) on delete cascade,
  membre_id  uuid not null references public.membres  (id) on delete cascade,
  primary key (affaire_id, membre_id)
);

-- ----------------------------------------------------------------- tâches ---
create table if not exists public.taches (
  id             uuid primary key default gen_random_uuid(),
  affaire_id     uuid not null references public.affaires (id) on delete cascade,
  titre          text not null,
  note           text not null default '',
  charge_inge    numeric(4,1) not null default 0 check (charge_inge >= 0),
  charge_dessin  numeric(4,1) not null default 0 check (charge_dessin >= 0),
  debut          date,
  echeance       date not null,
  ingenieur_id   uuid references public.membres (id) on delete set null,
  dessinateur_id uuid references public.membres (id) on delete set null,
  statut         text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'attente', 'termine')),
  avancement     smallint not null default 0 check (avancement between 0 and 100),
  cree_le        timestamptz not null default now(),
  maj_le         timestamptz not null default now(),
  constraint charge_non_nulle check (charge_inge + charge_dessin > 0),
  constraint periode_ordonnee check (debut is null or debut <= echeance),
  constraint inge_si_charge  check (charge_inge   = 0 or ingenieur_id   is not null),
  constraint dess_si_charge  check (charge_dessin = 0 or dessinateur_id is not null)
);
create index if not exists taches_affaire   on public.taches (affaire_id);
create index if not exists taches_echeance  on public.taches (echeance);
create index if not exists taches_ingenieur on public.taches (ingenieur_id);
create index if not exists taches_dessin    on public.taches (dessinateur_id);

comment on column public.taches.debut is
  'Facultatif. Vide, l''interface cale la tâche au plus tard avant son échéance.';
comment on column public.taches.charge_inge is
  'Jours d''ingénieur. Distincte de la charge dessin : les deux métiers ne pèsent pas pareil sur une même tâche.';

-- --------------------------------------------------------------- réglages ---
-- Une seule ligne, verrouillée par une contrainte.
create table if not exists public.reglages (
  id               boolean primary key default true check (id),
  canton           text not null default 'VD',
  capacite_defaut  numeric(3,1) not null default 5,
  maj_le           timestamptz not null default now()
);
insert into public.reglages (id) values (true) on conflict do nothing;

-- -------------------------------------------------------- date de mise à jour
create or replace function public.touche_maj_le()
returns trigger language plpgsql as $$
begin
  new.maj_le := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['membres', 'affaires', 'taches', 'reglages'] loop
    execute format('drop trigger if exists maj_le on public.%I', t);
    execute format(
      'create trigger maj_le before update on public.%I
         for each row execute function public.touche_maj_le()', t);
  end loop;
end $$;

-- =========================================================== sécurité (RLS) ==
-- Tout est fermé par défaut ; seules les personnes connectées lisent et écrivent.
-- Quand chaque membre aura son compte, c'est ici qu'on restreindra l'écriture
-- (par exemple : chacun modifie l'avancement de ses tâches, toi seul le reste).

alter table public.membres         enable row level security;
alter table public.absences        enable row level security;
alter table public.affaires        enable row level security;
alter table public.affaire_membres enable row level security;
alter table public.taches          enable row level security;
alter table public.reglages        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['membres', 'absences', 'affaires', 'affaire_membres', 'taches', 'reglages'] loop
    execute format('drop policy if exists "equipe connectee" on public.%I', t);
    execute format(
      'create policy "equipe connectee" on public.%I
         for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
