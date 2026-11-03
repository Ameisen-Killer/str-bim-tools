-- =========================================================================
-- Migration : boîte à idées de l'accueil (03.11.2026)
-- Table idees, seau « idees » du stockage (captures d'écran), droit
-- idees_lire donné aux groupes « administrateur » de chaque bureau.
-- Relançable. À exécuter dans Supabase > SQL Editor > New query > Run.
-- =========================================================================

-- --------------------------------------------------------- boîte à idées ---
-- Boîte à idées de l'accueil (03.11.2026) : chacun propose une idée, une
-- remarque, avec des captures d'écran (seau « idees » du stockage, rangées
-- sous <bureau>/<idée>/). Le nom de l'auteur est posé par la base, d'après
-- le compte connecté : impossible d'écrire au nom d'un autre. Seuls les
-- titulaires du droit idees_lire (les administrateurs au départ) lisent les
-- idées, changent leur état et les suppriment. Jamais le compte de
-- démonstration, partagé et public (ses idées restent dans son navigateur).
create table if not exists public.idees (
  id           uuid primary key default gen_random_uuid(),
  bureau_id    uuid not null default public.bureau_par_defaut()
               constraint idees_bureau_fk references public.bureaux (id) on delete cascade,
  auteur_id    uuid default public.mon_membre()
               constraint idees_auteur_fk references public.membres (id) on delete set null,
  auteur_nom   text not null default '',
  auteur_email text not null default '',
  texte        text not null constraint idees_texte_check check (char_length(btrim(texte)) between 1 and 4000),
  captures     text[] not null default '{}' constraint idees_captures_check
               check (array_position(captures, null::text) is null and cardinality(captures) <= 6),
  statut       text not null default 'nouvelle' constraint idees_statut_check
               check (statut in ('nouvelle', 'lue', 'retenue', 'faite', 'ecartee')),
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now()
);
create index if not exists idees_bureau on public.idees (bureau_id, cree_le desc);
comment on table public.idees is
  'Boîte à idées de l''accueil. Dépôt : tout le bureau (sauf le compte démo), au nom du compte connecté. Lecture, état et suppression : droit idees_lire.';
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
-- Boîte à idées : tout le bureau dépose (sauf le compte démo) ; lire, changer
-- l'état et supprimer demandent le droit « Lire la boîte à idées ».
create policy "bureau courant (dépôt)" on public.idees for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');
create policy "droit de lire (lecture)" on public.idees for select to authenticated
  using (bureau_id = (select public.bureau_courant()) and (select public.a_droit('idees_lire')));
create policy "droit de lire (état)" on public.idees for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and (select public.a_droit('idees_lire')))
  with check (bureau_id = (select public.bureau_courant()));
create policy "droit de lire (suppression)" on public.idees for delete to authenticated
  using (bureau_id = (select public.bureau_courant()) and (select public.a_droit('idees_lire')));

-- Captures de la boîte à idées : seau privé, images de 5 Mo au plus, rangées
-- sous <bureau>/<idée>/. Tout le bureau en dépose (sauf le compte démo) ;
-- seuls les titulaires du droit idees_lire les voient et les retirent.
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
  using (bucket_id = 'idees'
         and (storage.foldername(name))[1] = (select public.bureau_courant())::text
         and (select public.a_droit('idees_lire')));
create policy "idees : retrait" on storage.objects for delete to authenticated
  using (bucket_id = 'idees'
         and (storage.foldername(name))[1] = (select public.bureau_courant())::text
         and (select public.a_droit('idees_lire')));

-- Le droit « Lire la boîte à idées » : aux groupes administrateur existants
-- (les autres groupes se cochent dans la console, Groupes et droits).
update public.droits_groupes
   set droits = array_append(droits, 'idees_lire'), maj_le = now()
 where statut = 'administrateur' and not ('idees_lire' = any (droits));

-- Contrôle : une ligne par bureau, « oui » attendu partout.
select b.nom as bureau,
       case when exists (select 1 from public.droits_groupes g
                          where g.bureau_id = b.id and 'idees_lire' = any (g.droits))
            then 'oui' else 'NON (cocher le droit dans la console)' end as droit_idees_lire
  from public.bureaux b order by b.nom;
