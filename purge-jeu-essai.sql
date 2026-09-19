-- ============================================================================
--  Outil de planification — retrait du JEU D'ESSAI
-- ----------------------------------------------------------------------------
--  Supprime uniquement ce qu'a créé jeu-essai.sql :
--    - le « Bureau d'essai (fictif) », avec tout ce qu'il contient (membres,
--      affaires, tâches, absences, listes : tout part par cascade) ;
--    - par sécurité, les restes d'une version plus ancienne du jeu, chargée
--      avant les bureaux dans le bureau réel : affaires dont la note commence
--      par [jeu d'essai], membres dont l'adresse est en @essai.exemple.ch.
--  Les données réelles ne sont pas touchées.
-- ============================================================================

begin;

delete from public.bureaux  where id = 'e55a1000-0000-4000-8000-000000000001';
delete from public.affaires where note like '[jeu d''essai]%';
delete from public.membres  where email like '%@essai.exemple.ch';

commit;

select
  (select count(*) from public.bureaux  where id = 'e55a1000-0000-4000-8000-000000000001') as bureau_restant,
  (select count(*) from public.membres  where email like '%@essai.exemple.ch')            as membres_restants,
  (select count(*) from public.affaires where note like '[jeu d''essai]%')                 as affaires_restantes;
