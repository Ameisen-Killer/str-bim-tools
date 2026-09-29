-- ============================================================================
--  Outil de planification — exports Kairnial de la page Visas
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  La page /planif/visas/ analyse l'export « Tableau de suivi » de la GED
--  Kairnial (.xlsx). Avec cette migration, un export déposé est gardé : le
--  fichier va dans le seau privé « visas » de Supabase Storage, et la table
--  exports_visas le décrit — heure du dépôt, qui l'a déposé, date d'édition
--  écrite par Kairnial, projet, nombres de plans, d'indices et de visas —
--  pour que la page en affiche la liste sans télécharger les fichiers.
--
--  Un export appartient à un bureau, comme le reste : ses fichiers sont rangés
--  dans un dossier au nom du bureau (<bureau>/<export>.xlsx), et chacun ne voit
--  que ceux du sien. Tout le bureau peut déposer, rouvrir et retirer un export,
--  comme pour l'annuaire. Un export ne se modifie pas : on en dépose un autre.
--  L'heure du dépôt et l'adresse de la personne qui dépose sont posées par la
--  base, pas par la page.
--
--  Sans cette migration, la page analyse l'export qu'on y glisse, sans le garder.
--
--  ORDRE À RESPECTER
--    migration-multi-bureaux.sql d'abord (c'est elle qui pose bureau_par_defaut
--    et bureau_courant).
-- ============================================================================

begin;

-- ------------------------------------------------------------- garde-fou ---
do $$
begin
  if to_regprocedure('public.bureau_par_defaut()') is null then
    raise exception 'Exécute d''abord migration-multi-bureaux.sql : les bureaux n''existent pas encore.';
  end if;
end $$;

-- ---------------------------------------------------------------- table ---
create table if not exists public.exports_visas (
  id          uuid primary key default gen_random_uuid(),
  bureau_id   uuid not null default public.bureau_par_defaut()
              constraint exports_visas_bureau_fk references public.bureaux (id) on delete cascade,
  chemin      text not null unique,
  nom         text not null default '',
  taille      bigint not null default 0,
  depose_le   timestamptz not null default now(),
  depose_par  text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  depose_nom  text not null default '',
  edition     timestamp,
  projet      text not null default '',
  nb_plans    integer not null default 0,
  nb_indices  integer not null default 0,
  nb_visas    integer not null default 0
);
create index if not exists exports_visas_bureau on public.exports_visas (bureau_id, depose_le desc);

comment on table  public.exports_visas is
  'Exports « Tableau de suivi » de la GED Kairnial déposés dans la page Visas. Le fichier est dans le seau « visas ».';
comment on column public.exports_visas.chemin is
  'Emplacement du fichier dans le seau « visas » : <bureau>/<export>.xlsx.';
comment on column public.exports_visas.depose_le is
  'Heure du dépôt, posée par la base.';
comment on column public.exports_visas.depose_par is
  'Adresse de la personne qui a déposé, posée par la base (contrôlée à l''arrivée).';
comment on column public.exports_visas.depose_nom is
  'Nom affiché de la personne qui a déposé, tiré de sa fiche d''équipe.';
comment on column public.exports_visas.edition is
  '« Date édition » écrite par Kairnial dans le fichier : l''heure à laquelle l''export a été tiré, heure locale.';

-- ----------------------------------------------------------------- accès ---
-- Lire, déposer et retirer les exports de son bureau. Pas de modification :
-- un export est une photo de Kairnial à un instant donné.
alter table public.exports_visas enable row level security;

drop policy if exists "bureau courant (lecture)"    on public.exports_visas;
drop policy if exists "bureau courant (dépôt)"      on public.exports_visas;
drop policy if exists "bureau courant (suppression)" on public.exports_visas;

create policy "bureau courant (lecture)" on public.exports_visas for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (dépôt)" on public.exports_visas for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and depose_par = lower(coalesce(auth.jwt() ->> 'email', ''))
              and split_part(chemin, '/', 1) = (select public.bureau_courant())::text);
create policy "bureau courant (suppression)" on public.exports_visas for delete to authenticated
  using (bureau_id = (select public.bureau_courant()));

-- ------------------------------------------------------ seau des fichiers ---
-- Privé : un fichier ne se lit qu'avec une session autorisée, jamais par un lien
-- public. 25 Mo au plus, et seulement des classeurs Excel.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visas', 'visas', false, 26214400,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Le premier dossier du chemin est le bureau : chacun ne touche qu'au sien.
drop policy if exists "visas : lecture du bureau"     on storage.objects;
drop policy if exists "visas : dépôt dans le bureau"  on storage.objects;
drop policy if exists "visas : retrait dans le bureau" on storage.objects;

create policy "visas : lecture du bureau" on storage.objects for select to authenticated
  using (bucket_id = 'visas'
         and (storage.foldername(name))[1] = (select public.bureau_courant())::text);
create policy "visas : dépôt dans le bureau" on storage.objects for insert to authenticated
  with check (bucket_id = 'visas'
              and (storage.foldername(name))[1] = (select public.bureau_courant())::text);
create policy "visas : retrait dans le bureau" on storage.objects for delete to authenticated
  using (bucket_id = 'visas'
         and (storage.foldername(name))[1] = (select public.bureau_courant())::text);

commit;

-- ==================================================================== rapport ==
-- Le seau, tel que la base le connaît désormais.
select id as seau, public as public, file_size_limit as taille_max_octets
  from storage.buckets where id = 'visas';

-- Ce que la base applique sur les exports et sur leurs fichiers.
select p.tablename                                        as sur,
       p.cmd                                              as commande,
       p.policyname                                       as regle
  from pg_policies p
 where (p.schemaname = 'public' and p.tablename = 'exports_visas')
    or (p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname like 'visas :%')
 order by p.tablename, p.cmd, p.policyname;
