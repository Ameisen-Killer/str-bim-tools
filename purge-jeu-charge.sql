-- ============================================================================
--  Outil de planification — retrait du JEU DE CHARGE
-- ----------------------------------------------------------------------------
--  Supprime uniquement ce qu'a créé jeu-charge.sql : le « Bureau de charge
--  (fictif) » et tout ce qu'il contient (cascade), plus, par sécurité, les
--  restes d'une version plus ancienne du jeu chargée avant les bureaux
--  (affaires [jeu de charge], membres en @charge.exemple.ch).
--  Données réelles et jeu d'essai intacts.
-- ============================================================================

begin;

delete from public.bureaux  where id = 'c4a26e00-0000-4000-8000-000000000002';
delete from public.affaires where note like '[jeu de charge]%';
delete from public.membres  where email like '%@charge.exemple.ch';

commit;

select
  (select count(*) from public.bureaux  where id = 'c4a26e00-0000-4000-8000-000000000002') as bureau_restant,
  (select count(*) from public.membres  where email like '%@charge.exemple.ch')            as membres_restants,
  (select count(*) from public.affaires where note like '[jeu de charge]%')                 as affaires_restantes;
