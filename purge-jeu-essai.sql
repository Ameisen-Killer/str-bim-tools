-- ============================================================================
--  Outil de planification — retrait du JEU D'ESSAI
-- ----------------------------------------------------------------------------
--  Supprime uniquement les données créées par jeu-essai.sql :
--    - affaires dont la note commence par [jeu d'essai] (leurs tâches et leurs
--      liens d'équipe partent avec, par cascade) ;
--    - membres dont l'adresse est en @essai.exemple.ch (leurs absences partent
--      avec ; une tâche réelle qui leur aurait été confiée perd son affectation
--      mais reste en place).
--  Les données réelles ne sont pas touchées.
-- ============================================================================

begin;

delete from public.affaires where note like '[jeu d''essai]%';
delete from public.membres  where email like '%@essai.exemple.ch';

commit;

select
  (select count(*) from public.membres  where email like '%@essai.exemple.ch') as membres_restants,
  (select count(*) from public.affaires where note like '[jeu d''essai]%')      as affaires_restantes;
