-- ============================================================================
--  Buro — Amicale de Douvaine : schéma PostgreSQL pour Supabase
-- ----------------------------------------------------------------------------
--  Installation neuve, en une fois, dans le projet Supabase DÉDIÉ à Buro :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--
--  AVANT D'EXÉCUTER : remplacer l'adresse d'exemple de la ligne « super admin »
--  (set_config juste en dessous) par l'adresse du compte qui administrera Buro.
--  Ne pas l'enregistrer dans le dépôt : ce fichier est public.
--
--  Principe de sécurité (même logique que l'outil de planification) :
--    - la table members est la liste blanche : seule une adresse active qui y
--      figure peut créer son compte (hook « Before User Created ») et lire ou
--      écrire quoi que ce soit (RLS sur toutes les tables) ;
--    - la clé publiable du projet peut donc vivre dans le code du site.
--  Les règles du prototype sont reprises côté base :
--    - le Président (et le super admin) crée et modifie les projets ;
--    - projet privé : visible du Président, du responsable, de l'adjoint et
--      des personnes autorisées ; ses tâches et sa discussion suivent ;
--    - une tâche : l'attributaire la déclare faite, le responsable, l'adjoint
--      ou le Président la valide ou la renvoie (trigger taches_garde) ;
--    - feedbacks d'événement : Président seulement ;
--    - membres : gérés par le Président et le super admin ; seul un super
--      admin nomme ou modifie un super admin.
--
--  Après exécution, réglages du tableau de bord : voir kevin/README.md.
-- ============================================================================

begin;

-- ------------------------------------------------------------ super admin ---
-- ↓↓↓ Remplacer l'adresse d'exemple par ton adresse de connexion ↓↓↓
select set_config('buro.super_admin', 'prenom.nom@exemple.ch', true);
select set_config('buro.super_admin_nom', 'Super admin', true);

do $$
begin
  if current_setting('buro.super_admin') ilike '%@exemple.ch' then
    raise exception 'Remplace d''abord l''adresse du super admin en tête du fichier (ligne set_config), puis relance.';
  end if;
end $$;

-- ================================================================ tables ===

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  email       text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role        text not null default 'bureau' check (role in ('superadmin', 'president', 'etat_major', 'bureau')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists members_email_unique on public.members (email);
comment on table public.members is
  'Membres du bureau ET liste blanche de connexion : seule une adresse active de cette table peut se connecter.';

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (btrim(name) <> ''),
  description   text not null default '',
  owner_id      uuid references public.members (id) on delete set null,
  manager_id    uuid not null references public.members (id),
  deputy_id     uuid references public.members (id) on delete set null,
  budget        numeric(12, 2) not null default 0 check (budget >= 0),
  is_private    boolean not null default false,
  visible_to    uuid[] not null default '{}',
  chat_enabled  boolean not null default false,
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  title             text not null check (btrim(title) <> ''),
  due               date not null,
  assignee_ids      uuid[] not null default '{}',
  status            text not null default 'todo' check (status in ('todo', 'pending_validation', 'done')),
  hidden_from_list  boolean not null default false,
  created_by        uuid references public.members (id) on delete set null,
  completed_by      uuid references public.members (id) on delete set null,
  completed_at      date,
  validated_by      uuid references public.members (id) on delete set null,
  validated_at      timestamptz,
  parent_task_id    uuid references public.tasks (id) on delete cascade,   -- réservé aux futures sous-tâches
  created_at        timestamptz not null default now()
);
create index if not exists tasks_project on public.tasks (project_id);

-- project_id vide = discussion générale
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects (id) on delete cascade,
  author_id   uuid not null references public.members (id),
  body        text not null check (btrim(body) <> ''),
  created_at  timestamptz not null default now()
);
create index if not exists messages_project on public.messages (project_id, created_at);

create table if not exists public.ideas (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (btrim(title) <> ''),
  body        text not null default '',
  author_id   uuid not null references public.members (id),
  created_at  timestamptz not null default now()
);

create table if not exists public.idea_reactions (
  idea_id    uuid not null references public.ideas (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '🔥', '💡', '❤️')),
  primary key (idea_id, member_id, emoji)
);

create table if not exists public.idea_comments (
  id          uuid primary key default gen_random_uuid(),
  idea_id     uuid not null references public.ideas (id) on delete cascade,
  author_id   uuid not null references public.members (id),
  body        text not null check (btrim(body) <> ''),
  created_at  timestamptz not null default now()
);

create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  category    text not null default '',
  quantity    integer not null default 1 check (quantity > 0),
  notes       text not null default '',
  created_at  timestamptz not null default now()
);

-- photos : liste de { name, path } (fichiers du bucket « buro ») ;
-- signatures : images PNG en data URL, dessinées au doigt.
create table if not exists public.rentals (
  id                   uuid primary key default gen_random_uuid(),
  renter               text not null check (btrim(renter) <> ''),
  material_id          uuid not null references public.materials (id),
  quantity             integer not null default 1 check (quantity > 0),
  start_date           date not null,
  end_date             date not null,
  departure_state      text not null default '',
  return_state         text not null default '',
  remarks              text not null default '',
  photos               jsonb not null default '[]',
  status               text not null default 'planned' check (status in ('planned', 'out', 'returned')),
  signature_departure  text not null default '',
  signature_return     text not null default '',
  created_by           uuid references public.members (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.feedbacks (
  id               uuid primary key default gen_random_uuid(),
  event_name       text not null check (btrim(event_name) <> ''),
  event_date       date not null,
  global_score     integer not null check (global_score between 0 and 10),
  attendance       integer not null default 0 check (attendance >= 0),
  budget_actual    numeric(12, 2) not null default 0,
  schedule_score   integer check (schedule_score between 0 and 10),
  volunteer_score  integer check (volunteer_score between 0 and 10),
  org_score        integer check (org_score between 0 and 10),
  positives        text not null default '',
  improvements     text not null default '',
  incidents        text not null default '',
  next_actions     text not null default '',
  created_by       uuid references public.members (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (btrim(name) <> ''),
  type          text not null check (type in ('folder', 'file')),
  parent_id     uuid references public.documents (id) on delete cascade,
  storage_path  text,
  mime          text,
  size          bigint,
  created_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Demandes d'envoi de courriel (fiche de location, feedback) : file d'attente
-- qu'un futur service d'envoi videra.
create table if not exists public.mail_queue (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('location', 'feedback')),
  ref_id      uuid not null,
  created_by  uuid references public.members (id) on delete set null,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ============================================================= fonctions ===
-- security definer : elles lisent members, que la RLS protège.

create or replace function public.buro_moi()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.members m
  where m.active and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.buro_role()
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.members m
  where m.active and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.buro_membre()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.buro_moi() is not null
$$;

create or replace function public.buro_president()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.buro_role() in ('president', 'superadmin'), false)
$$;

create or replace function public.buro_voit_projet(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects x
    where x.id = p and public.buro_membre() and (
      not x.is_private or public.buro_president()
      or x.manager_id = public.buro_moi() or x.deputy_id = public.buro_moi()
      or public.buro_moi() = any (x.visible_to)))
$$;

create or replace function public.buro_gere_projet(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.buro_president() or exists (
    select 1 from public.projects x
    where x.id = p and public.buro_membre()
      and (x.manager_id = public.buro_moi() or x.deputy_id = public.buro_moi()))
$$;

-- Tâche modifiée par quelqu'un qui ne gère pas le projet : seules deux
-- choses sont permises — la déclarer faite (s'il en est attributaire) et la
-- retirer de la liste globale ou l'y remettre.
create or replace function public.taches_garde()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := public.buro_moi();
begin
  if public.buro_gere_projet(old.project_id) and public.buro_gere_projet(new.project_id) then
    return new;
  end if;
  if (new.project_id, new.title, new.due, new.assignee_ids, new.created_by, new.validated_by,
      new.validated_at, new.parent_task_id, new.created_at)
     is distinct from
     (old.project_id, old.title, old.due, old.assignee_ids, old.created_by, old.validated_by,
      old.validated_at, old.parent_task_id, old.created_at) then
    raise exception 'Seul le responsable du projet, son adjoint ou le président modifie cette tâche.' using errcode = '42501';
  end if;
  if (new.status, new.completed_by, new.completed_at) is distinct from (old.status, old.completed_by, old.completed_at) then
    if not (old.status = 'todo' and new.status = 'pending_validation'
            and v_moi = any (old.assignee_ids) and new.completed_by = v_moi) then
      raise exception 'Seul un attributaire déclare la tâche faite ; la validation revient au responsable.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists taches_garde on public.tasks;
create trigger taches_garde before update on public.tasks
  for each row execute function public.taches_garde();

-- Membres : le Président gère le bureau, seul un super admin touche un super
-- admin, et personne ne change son propre rôle ni ne ferme son propre accès.
create or replace function public.membres_garde()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sa boolean := coalesce(public.buro_role() = 'superadmin', false);
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'superadmin' and not v_sa then
    raise exception 'Seul un super admin modifie un super admin.' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'superadmin' and not v_sa then
    raise exception 'Seul un super admin nomme un super admin.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.id = public.buro_moi()
     and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'Tu ne peux pas changer ton propre rôle ni fermer ton propre accès.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.id = public.buro_moi() then
      raise exception 'Tu ne peux pas te retirer toi-même.' using errcode = '42501';
    end if;
    return old;
  end if;
  return new;
end $$;

drop trigger if exists membres_garde on public.members;
create trigger membres_garde before insert or update or delete on public.members
  for each row execute function public.membres_garde();

-- =================================================================== RLS ===

alter table public.members        enable row level security;
alter table public.projects       enable row level security;
alter table public.tasks          enable row level security;
alter table public.messages       enable row level security;
alter table public.ideas          enable row level security;
alter table public.idea_reactions enable row level security;
alter table public.idea_comments  enable row level security;
alter table public.materials      enable row level security;
alter table public.rentals        enable row level security;
alter table public.feedbacks      enable row level security;
alter table public.documents      enable row level security;
alter table public.mail_queue     enable row level security;

-- Relance sans erreur : on repart de politiques propres
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- members
create policy "membres lisent le bureau"  on public.members for select to authenticated using (public.buro_membre());
create policy "president ajoute"          on public.members for insert to authenticated with check (public.buro_president());
create policy "president modifie"         on public.members for update to authenticated using (public.buro_president()) with check (public.buro_president());
create policy "president retire"          on public.members for delete to authenticated using (public.buro_president());

-- projects
create policy "projets visibles"          on public.projects for select to authenticated using (public.buro_voit_projet(id));
create policy "president cree"            on public.projects for insert to authenticated with check (public.buro_president());
create policy "president modifie"         on public.projects for update to authenticated using (public.buro_president()) with check (public.buro_president());
create policy "president supprime"        on public.projects for delete to authenticated using (public.buro_president());

-- tasks (le détail des changements permis est dans le trigger taches_garde)
create policy "taches du projet visibles" on public.tasks for select to authenticated using (public.buro_voit_projet(project_id));
create policy "membre cree une tache"     on public.tasks for insert to authenticated
  with check (public.buro_voit_projet(project_id) and created_by = public.buro_moi() and status = 'todo');
create policy "membre fait evoluer"       on public.tasks for update to authenticated
  using (public.buro_voit_projet(project_id)) with check (public.buro_voit_projet(project_id));
create policy "responsable supprime"      on public.tasks for delete to authenticated using (public.buro_gere_projet(project_id));

-- messages
create policy "discussions visibles"      on public.messages for select to authenticated using (
  public.buro_membre() and (project_id is null or (public.buro_voit_projet(project_id)
    and exists (select 1 from public.projects p where p.id = project_id and p.chat_enabled))));
create policy "membre ecrit"              on public.messages for insert to authenticated with check (
  author_id = public.buro_moi() and (project_id is null or (public.buro_voit_projet(project_id)
    and exists (select 1 from public.projects p where p.id = project_id and p.chat_enabled))));
create policy "auteur retire"             on public.messages for delete to authenticated
  using (author_id = public.buro_moi() or public.buro_president());

-- ideas, reactions, comments
create policy "idees lues"                on public.ideas for select to authenticated using (public.buro_membre());
create policy "idee publiee"              on public.ideas for insert to authenticated with check (author_id = public.buro_moi());
create policy "auteur modifie"            on public.ideas for update to authenticated
  using (author_id = public.buro_moi() or public.buro_president()) with check (public.buro_membre());
create policy "auteur retire"             on public.ideas for delete to authenticated
  using (author_id = public.buro_moi() or public.buro_president());
create policy "reactions lues"            on public.idea_reactions for select to authenticated using (public.buro_membre());
create policy "sa reaction"               on public.idea_reactions for insert to authenticated with check (member_id = public.buro_moi());
create policy "retire sa reaction"        on public.idea_reactions for delete to authenticated using (member_id = public.buro_moi());
create policy "commentaires lus"          on public.idea_comments for select to authenticated using (public.buro_membre());
create policy "commente"                  on public.idea_comments for insert to authenticated with check (author_id = public.buro_moi());
create policy "auteur retire"             on public.idea_comments for delete to authenticated
  using (author_id = public.buro_moi() or public.buro_president());

-- materials, rentals : tout le bureau
create policy "materiel lu"               on public.materials for select to authenticated using (public.buro_membre());
create policy "materiel ajoute"           on public.materials for insert to authenticated with check (public.buro_membre());
create policy "materiel modifie"          on public.materials for update to authenticated using (public.buro_membre()) with check (public.buro_membre());
create policy "president retire"          on public.materials for delete to authenticated using (public.buro_president());
create policy "locations lues"            on public.rentals for select to authenticated using (public.buro_membre());
create policy "location creee"            on public.rentals for insert to authenticated with check (public.buro_membre() and created_by = public.buro_moi());
create policy "location suivie"           on public.rentals for update to authenticated using (public.buro_membre()) with check (public.buro_membre());
create policy "president retire"          on public.rentals for delete to authenticated using (public.buro_president());

-- feedbacks : Président
create policy "president lit"             on public.feedbacks for select to authenticated using (public.buro_president());
create policy "president archive"         on public.feedbacks for insert to authenticated with check (public.buro_president() and created_by = public.buro_moi());
create policy "president modifie"         on public.feedbacks for update to authenticated using (public.buro_president()) with check (public.buro_president());
create policy "president retire"          on public.feedbacks for delete to authenticated using (public.buro_president());

-- documents
create policy "documents lus"             on public.documents for select to authenticated using (public.buro_membre());
create policy "document ajoute"           on public.documents for insert to authenticated with check (public.buro_membre() and created_by = public.buro_moi());
create policy "auteur modifie"            on public.documents for update to authenticated
  using (created_by = public.buro_moi() or public.buro_president()) with check (public.buro_membre());
create policy "auteur retire"             on public.documents for delete to authenticated
  using (created_by = public.buro_moi() or public.buro_president());

-- mail_queue : on dépose une demande, le Président voit la file
create policy "demande deposee"           on public.mail_queue for insert to authenticated with check (created_by = public.buro_moi());
create policy "president lit"             on public.mail_queue for select to authenticated
  using (public.buro_president() or created_by = public.buro_moi());

-- ============================================== garde des comptes (hook) ==
-- Appelée par Supabase Auth avant de créer un compte : seules les adresses
-- actives de members passent. À activer dans Authentication > Auth Hooks >
-- Before User Created (Postgres, schéma public, fonction garde_creation_compte).
create or replace function public.garde_creation_compte(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.members m
    where m.active and m.email = lower(btrim(coalesce(event -> 'user' ->> 'email', '')))
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Adresse non autorisée : demande l''accès au président du bureau.'));
end $$;

-- ============================================================== fichiers ==
-- Bucket privé « buro » : documents et photos des locations. Lecture et dépôt
-- pour les membres ; suppression par le Président.
insert into storage.buckets (id, name, public, file_size_limit)
values ('buro', 'buro', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "buro lecture" on storage.objects;
drop policy if exists "buro depot" on storage.objects;
drop policy if exists "buro suppression" on storage.objects;
create policy "buro lecture" on storage.objects for select to authenticated
  using (bucket_id = 'buro' and public.buro_membre());
create policy "buro depot" on storage.objects for insert to authenticated
  with check (bucket_id = 'buro' and public.buro_membre());
create policy "buro suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'buro' and public.buro_president());

-- ================================================================= droits ==
revoke all on all tables in schema public from anon;
revoke all on function public.garde_creation_compte(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.garde_creation_compte(jsonb) to supabase_auth_admin;
grant select on public.members to supabase_auth_admin;
revoke all on function public.taches_garde() from public, anon, authenticated;
revoke all on function public.membres_garde() from public, anon, authenticated;

-- ============================================================ super admin ==
-- Le trigger membres_garde ne s'applique pas ici : l'éditeur SQL n'a pas de
-- session, et sans session buro_role() est vide. On le coupe le temps de l'insertion.
alter table public.members disable trigger membres_garde;
insert into public.members (name, email, role, active)
values (current_setting('buro.super_admin_nom'), lower(btrim(current_setting('buro.super_admin'))), 'superadmin', true)
on conflict (email) do update set role = 'superadmin', active = true;
alter table public.members enable trigger membres_garde;

commit;

notify pgrst, 'reload schema';

-- Contrôle : ton adresse doit apparaître en super admin
select name, email, role, active from public.members;
