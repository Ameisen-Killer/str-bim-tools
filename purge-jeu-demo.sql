-- ============================================================================
--  Outil de planification — retrait du JEU DE DÉMONSTRATION
-- ----------------------------------------------------------------------------
--  Supprime uniquement ce qu'a créé jeu-demo.sql dans le « Bureau de test » :
--    - les affaires dont la note commence par [démo] (leurs tâches et leurs
--      équipes partent avec elles, par cascade) ;
--    - les membres en @demo.exemple.ch (leurs absences partent avec eux).
--  Le bureau, ses réglages, ses disciplines et tout ce qui a été saisi à la
--  main restent.
-- ============================================================================

begin;

delete from public.affaires a
 using public.bureaux b
 where b.id = a.bureau_id and b.nom = 'Bureau de test' and a.note like '[démo]%';

delete from public.membres m
 using public.bureaux b
 where b.id = m.bureau_id and b.nom = 'Bureau de test' and m.email like '%@demo.exemple.ch';

commit;

select
  (select count(*) from public.membres  where email like '%@demo.exemple.ch') as membres_restants,
  (select count(*) from public.affaires where note like '[démo]%')             as affaires_restantes;
