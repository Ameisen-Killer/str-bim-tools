-- ============================================================================
--  Outil de planification — retrait du JEU DE CHARGE
-- ----------------------------------------------------------------------------
--  Supprime uniquement les données créées par jeu-charge.sql. Les tâches,
--  liens d'équipe et absences partent par cascade. Données réelles et jeu
--  d'essai intacts.
-- ============================================================================

begin;

delete from public.affaires where note like '[jeu de charge]%';
delete from public.membres  where email like '%@charge.exemple.ch';

commit;

select
  (select count(*) from public.membres  where email like '%@charge.exemple.ch') as membres_restants,
  (select count(*) from public.affaires where note like '[jeu de charge]%')      as affaires_restantes;
