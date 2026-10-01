-- ============================================================================
--  Migration : Visas sort de la planification (01.10.2026)
-- ----------------------------------------------------------------------------
--  Visas est devenu un outil à part, sans connexion, à str-bim-tools.com/visas/ :
--  l'export Kairnial y est analysé et gardé dans le navigateur, plus dans la
--  base. Ce script retire ce que la page Visas de /planif/ utilisait.
--
--  ATTENTION : il efface définitivement les exports Kairnial déposés et les
--  coches « Traité ». Pour garder un export, le télécharger avant : Storage >
--  seau « visas » > le fichier > Download.
--
--  À exécuter une fois : Dashboard > SQL Editor > New query > coller > Run.
--  Puis, à la main (une requête SQL ne peut pas effacer de fichier du
--  stockage) : Storage > seau « visas » > « Empty bucket », puis « Delete bucket ».
--  Une fois passé, ce fichier sort du dépôt (base-supabase.sql est déjà à jour).
-- ============================================================================

begin;

-- La réinitialisation du bureau de test n'efface plus les coches « Traité »
-- (sans quoi elle échouerait une fois la table retirée).
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

-- Les règles d'accès aux fichiers du seau « visas »
drop policy if exists "visas : lecture du bureau"      on storage.objects;
drop policy if exists "visas : dépôt dans le bureau"   on storage.objects;
drop policy if exists "visas : retrait dans le bureau" on storage.objects;

-- Les deux tables (leurs règles et index partent avec elles)
drop table if exists public.exports_visas;
drop table if exists public.visas_traites;

commit;
