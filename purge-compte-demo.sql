-- ============================================================================
--  Outil de planification — retrait du COMPTE DE DÉMONSTRATION
-- ----------------------------------------------------------------------------
--  Défait compte-demo.sql : supprime le compte « demo », son accès et la garde
--  qui figeait son mot de passe. Les sessions ouvertes tombent à leur
--  prochain renouvellement. Le Bureau de test et ses données restent.
-- ============================================================================

begin;

drop trigger if exists garde_compte_demo on auth.users;
drop function if exists public.garde_compte_demo();

delete from public.acces where email = 'demo@str-bim-tools.com';
delete from auth.users   where email = 'demo@str-bim-tools.com';   -- identités et sessions partent avec

commit;

select
  (select count(*) from public.acces where email = 'demo@str-bim-tools.com') as acces_restants,
  (select count(*) from auth.users   where email = 'demo@str-bim-tools.com') as comptes_restants;
