-- ============================================================================
--  Migration du 05.11.2026 : la page Affaires ouverte à Tout le monde.
--  À exécuter une fois dans Supabase › SQL Editor (rejouable). Ajoute le droit
--  page_affaires au groupe « Tout le monde » de chaque bureau : un collaborateur
--  voit la page Affaires et y arrive sur « Mes affaires ».
--  Même effet que cocher « Affaires » pour Tout le monde dans la console.
-- ============================================================================

begin;

update public.droits_groupes
   set droits = array_append(droits, 'page_affaires')
 where statut = 'tous'
   and not ('page_affaires' = any (droits));

commit;
