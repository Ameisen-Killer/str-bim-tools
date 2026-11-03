-- =========================================================================
-- Migration : boîte à idées de l'accueil (03.11.2026)
-- Table idees, seau « idees » du stockage (captures d'écran). Lecture
-- réservée aux administrateurs du site (super admin), tous bureaux.
-- Relançable. À exécuter dans Supabase > SQL Editor > New query > Run.
-- =========================================================================

-- --------------------------------------------------------- boîte à idées ---
-- Boîte à idées de l'accueil (03.11.2026) : chacun propose une idée, une
-- remarque, avec des captures d'écran (seau « idees » du stockage, rangées
-- sous <bureau>/<idée>/). Le nom de l'auteur est posé par la base, d'après
-- le compte connecté : impossible d'écrire au nom d'un autre. Seuls les
-- administrateurs du site (super admin) lisent les idées, de tous les
-- bureaux, changent leur état et les suppriment. Jamais le compte de
-- démonstration, partagé et public (ses idées restent dans son navigateur).
create table if not exists public.idees (
  id           uuid primary key default gen_random_uuid(),
  bureau_id    uuid not null default public.bureau_par_defaut()
               constraint idees_bureau_fk references public.bureaux (id) on delete cascade,
  auteur_id    uuid default public.mon_membre()
               constraint idees_auteur_fk references public.membres (id) on delete set null,
  auteur_nom   text not null default '',
  auteur_email text not null default '',
  bureau_nom   text not null default '',
  texte        text not null constraint idees_texte_check check (char_length(btrim(texte)) between 1 and 4000),
  captures     text[] not null default '{}' constraint idees_captures_check
               check (array_position(captures, null::text) is null and cardinality(captures) <= 6),
  statut       text not null default 'nouvelle' constraint idees_statut_check
               check (statut in ('nouvelle', 'lue', 'retenue', 'faite', 'ecartee')),
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now()
);
alter table public.idees add column if not exists bureau_nom text not null default '';
create index if not exists idees_bureau on public.idees (bureau_id, cree_le desc);
comment on table public.idees is
  'Boîte à idées de l''accueil. Dépôt : tout le bureau (sauf le compte démo), au nom du compte connecté. Lecture, état et suppression : les administrateurs du site (super admin), tous bureaux.';
comment on column public.idees.captures is
  'Chemins des captures d''écran dans le seau « idees » du stockage : <bureau>/<idée>/<n>.jpg.';

-- L'auteur, le bureau et la date viennent de la base ; une modification ne
-- touche que l'état.
create or replace function public.garde_idee()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_nom text;
begin
  if tg_op = 'INSERT' then
    new.bureau_id := public.bureau_courant();
    if new.bureau_id is null then
      raise exception 'Connexion requise pour proposer une idée.';
    end if;
    select b.nom into new.bureau_nom from public.bureaux b where b.id = new.bureau_id;
    new.bureau_nom := coalesce(new.bureau_nom, '');
    new.auteur_id := public.mon_membre();
    new.auteur_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    select nullif(btrim(coalesce(m.prenom, '') || ' ' || coalesce(m.nom, '')), '') into v_nom
      from public.membres m where m.id = new.auteur_id;
    new.auteur_nom := coalesce(v_nom, new.auteur_email);
    new.statut := 'nouvelle';
    new.cree_le := now();
    new.maj_le := now();
    if exists (select 1 from unnest(new.captures) c
                where c not like new.bureau_id::text || '/' || new.id::text || '/%') then
      raise exception 'Capture rangée au mauvais endroit.';
    end if;
    return new;
  end if;
  new.id := old.id;
  new.bureau_id := old.bureau_id;
  new.bureau_nom := old.bureau_nom;
  new.auteur_id := old.auteur_id;
  new.auteur_nom := old.auteur_nom;
  new.auteur_email := old.auteur_email;
  new.texte := old.texte;
  new.captures := old.captures;
  new.cree_le := old.cree_le;
  new.maj_le := now();
  return new;
end $$;
revoke all on function public.garde_idee() from public, anon, authenticated;
drop trigger if exists garde on public.idees;
create trigger garde before insert or update on public.idees
  for each row execute function public.garde_idee();

revoke all on public.idees from anon;
grant select, insert, update, delete on public.idees to authenticated;

alter table public.idees enable row level security;
drop policy if exists "bureau courant (dépôt)"      on public.idees;
drop policy if exists "droit de lire (lecture)"     on public.idees;
drop policy if exists "droit de lire (état)"        on public.idees;
drop policy if exists "droit de lire (suppression)" on public.idees;
drop policy if exists "admin du site (lecture)"     on public.idees;
drop policy if exists "admin du site (état)"        on public.idees;
drop policy if exists "admin du site (suppression)" on public.idees;
-- Boîte à idées : tout le bureau dépose (sauf le compte démo) ; lire, changer
-- l'état et supprimer : les administrateurs du site (super admin), tous bureaux.
create policy "bureau courant (dépôt)" on public.idees for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');
create policy "admin du site (lecture)" on public.idees for select to authenticated
  using ((select public.est_super_admin()));
create policy "admin du site (état)" on public.idees for update to authenticated
  using ((select public.est_super_admin())) with check ((select public.est_super_admin()));
create policy "admin du site (suppression)" on public.idees for delete to authenticated
  using ((select public.est_super_admin()));

-- Captures de la boîte à idées : seau privé, images de 5 Mo au plus, rangées
-- sous <bureau>/<idée>/. Tout le bureau en dépose (sauf le compte démo) ;
-- seuls les administrateurs du site (super admin) les voient et les retirent.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('idees', 'idees', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "idees : dépôt"   on storage.objects;
drop policy if exists "idees : lecture" on storage.objects;
drop policy if exists "idees : retrait" on storage.objects;
create policy "idees : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'idees'
              and (storage.foldername(name))[1] = (select public.bureau_courant())::text
              and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');
create policy "idees : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'idees' and (select public.est_super_admin()));
create policy "idees : retrait" on storage.objects for delete to authenticated
  using (bucket_id = 'idees' and (select public.est_super_admin()));

-- Première version (droit « Lire la boîte à idées » des groupes) : retiré.
update public.droits_groupes
   set droits = array_remove(droits, 'idees_lire'), maj_le = now()
 where 'idees_lire' = any (droits);

-- Contrôle : « oui » attendu sur chaque ligne.
select 'table idees' as element, case when to_regclass('public.idees') is not null then 'oui' else 'NON' end as present
union all
select 'seau idees', case when exists (select 1 from storage.buckets where id = 'idees') then 'oui' else 'NON' end
union all
select 'lecture admin du site', case when exists (select 1 from pg_policies where tablename = 'idees' and policyname = 'admin du site (lecture)') then 'oui' else 'NON' end;
