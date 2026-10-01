-- ============================================================================
--  Migration : Visas partagé sans connexion (01.10.2026)
-- ----------------------------------------------------------------------------
--  L'outil /visas/ est sorti de la planification. Les exports Kairnial déposés
--  et les coches « Traité » restent en ligne, communs à toute personne qui a
--  l'adresse de l'outil, sans connexion (rôle anon).
--
--  Ce script :
--    - crée visas_exports et visas_coches, sans bureau ;
--    - y recopie les exports et coches des anciennes tables exports_visas et
--      visas_traites s'il y en a encore (les fichiers du seau ne bougent pas),
--      puis retire ces anciennes tables et leurs règles ;
--    - ouvre le seau « visas » au rôle anon (lecture, dépôt, retrait) ;
--    - met à jour « Réinitialiser la démo », qui effaçait visas_traites.
--  Il marche que migration-retrait-visas.sql ait été exécuté ou non (si le
--  seau avait été supprimé, il est recréé, vide).
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

-- ===================================================================== Visas ==
-- L'outil /visas/, à part de la planification : les exports « Tableau de suivi »
-- de la GED Kairnial et les plans cochés « Traité ». Il est ouvert à toute
-- personne qui a l'adresse de l'outil, SANS CONNEXION : le rôle anon (la clé
-- publiable seule) lit, dépose, coche et retire. C'est la seule exception à
-- « la clé publiable n'ouvre rien » : ces deux tables et le seau « visas ».
-- Rien ne se modifie (pas d'update) : un export se dépose ou se retire, une
-- coche se pose ou s'enlève. Les bornes des colonnes limitent ce qu'un inconnu
-- peut y glisser ; le seau n'accepte que des classeurs .xlsx de 25 Mo au plus.
create table if not exists public.visas_exports (
  id          uuid primary key default gen_random_uuid(),
  chemin      text not null unique
              check (char_length(chemin) <= 200 and chemin ~ '^[A-Za-z0-9/_-]+\.xlsx$'),
  nom         text not null default '' check (char_length(nom) <= 255),
  taille      bigint not null default 0 check (taille between 0 and 26214400),
  depose_le   timestamptz not null default now(),
  edition     timestamp,
  projet      text not null default '' check (char_length(projet) <= 100),
  nb_plans    integer not null default 0 check (nb_plans >= 0),
  nb_indices  integer not null default 0 check (nb_indices >= 0),
  nb_visas    integer not null default 0 check (nb_visas >= 0)
);
create index if not exists visas_exports_depose on public.visas_exports (depose_le desc);
comment on column public.visas_exports.edition is
  '« Date édition » écrite par Kairnial dans le fichier : l''heure à laquelle l''export a été tiré, heure locale.';

-- Plans cochés « Traité », par numéro et indice : un nouvel indice redevient
-- « à traiter ». Décocher efface la ligne.
create table if not exists public.visas_coches (
  code        text not null check (char_length(code) between 1 and 200),
  indice      integer not null default 0 check (indice between 0 and 9999),
  traite_le   timestamptz not null default now(),
  primary key (code, indice)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visas', 'visas', false, 26214400,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.visas_exports enable row level security;
alter table public.visas_coches  enable row level security;
revoke all on public.visas_exports, public.visas_coches from anon, authenticated;
grant select, insert, delete on public.visas_exports, public.visas_coches to anon, authenticated;

drop policy if exists "visas : lecture" on public.visas_exports;
drop policy if exists "visas : dépôt"   on public.visas_exports;
drop policy if exists "visas : retrait" on public.visas_exports;
create policy "visas : lecture" on public.visas_exports for select to anon, authenticated using (true);
create policy "visas : dépôt"   on public.visas_exports for insert to anon, authenticated
  with check (depose_le between now() - interval '5 minutes' and now() + interval '5 minutes');
create policy "visas : retrait" on public.visas_exports for delete to anon, authenticated using (true);

drop policy if exists "visas : lecture" on public.visas_coches;
drop policy if exists "visas : coche"   on public.visas_coches;
drop policy if exists "visas : retrait" on public.visas_coches;
create policy "visas : lecture" on public.visas_coches for select to anon, authenticated using (true);
create policy "visas : coche"   on public.visas_coches for insert to anon, authenticated
  with check (traite_le between now() - interval '5 minutes' and now() + interval '5 minutes');
create policy "visas : retrait" on public.visas_coches for delete to anon, authenticated using (true);

-- Les fichiers du seau : mêmes droits, sans connexion
drop policy if exists "visas : lecture" on storage.objects;
drop policy if exists "visas : dépôt"   on storage.objects;
drop policy if exists "visas : retrait" on storage.objects;
create policy "visas : lecture" on storage.objects for select to anon, authenticated using (bucket_id = 'visas');
create policy "visas : dépôt"   on storage.objects for insert to anon, authenticated with check (bucket_id = 'visas');
create policy "visas : retrait" on storage.objects for delete to anon, authenticated using (bucket_id = 'visas');

-- Reprise de l'ancienne page Visas de la planification
do $$
begin
  if to_regclass('public.exports_visas') is not null then
    insert into public.visas_exports (id, chemin, nom, taille, depose_le, edition, projet, nb_plans, nb_indices, nb_visas)
    select id, chemin, left(nom, 255), taille, depose_le, edition, left(projet, 100), nb_plans, nb_indices, nb_visas
      from public.exports_visas
    on conflict do nothing;
    drop table public.exports_visas;
  end if;
  if to_regclass('public.visas_traites') is not null then
    insert into public.visas_coches (code, indice, traite_le)
    select code, indice, min(traite_le) from public.visas_traites group by code, indice
    on conflict do nothing;
    drop table public.visas_traites;
  end if;
end $$;

drop policy if exists "visas : lecture du bureau"      on storage.objects;
drop policy if exists "visas : dépôt dans le bureau"   on storage.objects;
drop policy if exists "visas : retrait dans le bureau" on storage.objects;

-- La réinitialisation du bureau de test n'efface plus de coches « Traité »
create or replace function public.console_reinitialise_demo()
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  n        int;
  v_bureau uuid;
  v_membre uuid;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;

  select count(*), min(b.id::text)::uuid into n, v_bureau from public.bureaux b where b.nom = 'Bureau de test';
  if n = 0 then
    raise exception 'Aucun bureau nommé « Bureau de test ».';
  elsif n > 1 then
    raise exception 'Plusieurs bureaux s''appellent « Bureau de test » : en renommer un.';
  end if;

  -- Tout ce qu'un testeur a pu toucher
  delete from public.affaires where bureau_id = v_bureau;   -- tâches et équipes suivent
  delete from public.absences where bureau_id = v_bureau;
  delete from public.contacts where bureau_id = v_bureau;
  delete from public.membres  where bureau_id = v_bureau and email like '%@demo.exemple.ch';

  perform public.remplit_demo(v_bureau);

  -- Le compte de démonstration retrouve sa fiche
  select m.id into v_membre from public.membres m
   where m.bureau_id = v_bureau and m.email = 'laurent.mercier@demo.exemple.ch';
  update public.acces set membre_id = v_membre
   where email = 'demo@str-bim-tools.com' and bureau_id = v_bureau;

  return jsonb_build_object(
    'membres',  (select count(*) from public.membres  where bureau_id = v_bureau),
    'affaires', (select count(*) from public.affaires where bureau_id = v_bureau),
    'taches',   (select count(*) from public.taches   where bureau_id = v_bureau),
    'absences', (select count(*) from public.absences where bureau_id = v_bureau));
end $$;
revoke execute on function public.console_reinitialise_demo() from public, anon;
grant execute on function public.console_reinitialise_demo() to authenticated;

commit;

-- L'API relit la forme des tables
notify pgrst, 'reload schema';
