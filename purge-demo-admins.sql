-- ============================================================================
--  Planification — retrait du JEU DE DÉMONSTRATION POUR LES ADMINISTRATEURS
-- ----------------------------------------------------------------------------
--  À coller dans Supabase : SQL Editor > New query > Run, après la démo.
--
--  Retire exactement ce que demo-admins.sql a créé (liste tenue dans le
--  schéma privé demo_admins) :
--    - les 20 affaires, avec leurs tâches, leurs équipes et l'agenda des AO —
--      y compris les tâches ajoutées sur ces affaires pendant la démo ;
--    - les absences, demandes de congé, rendez-vous, avis et fiches
--      d'annuaire du jeu ; l'absence née d'un congé du jeu accepté pendant
--      la démo part avec lui ;
--    - le suivi de veille rattaché à un AO du jeu (la publication redevient
--      « nouvelle »).
--  Puis le schéma demo_admins lui-même. Rien d'autre n'est touché : ce qui a
--  été créé à la main pendant la démo, hors de ces affaires, reste en place.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'demo_admins' and table_name = 'traces') then
    raise exception 'Aucun jeu de démonstration à retirer (schéma demo_admins absent).';
  end if;
end $$;

delete from public.veille_suivi
 where affaire_id in (select id from demo_admins.traces where tab = 'affaires');

delete from public.absences
 where id in (select c.absence_id from public.conges c
               where c.id in (select id from demo_admins.traces where tab = 'conges')
                 and c.absence_id is not null);

delete from public.conges      where id in (select id from demo_admins.traces where tab = 'conges');
delete from public.absences    where id in (select id from demo_admins.traces where tab = 'absences');
delete from public.rendez_vous where id in (select id from demo_admins.traces where tab = 'rendez_vous');
delete from public.avis        where id in (select id from demo_admins.traces where tab = 'avis');
delete from public.affaires    where id in (select id from demo_admins.traces where tab = 'affaires');
delete from public.contacts    where id in (select id from demo_admins.traces where tab = 'contacts');

drop schema demo_admins cascade;

commit;

-- Contrôle : doit afficher 0 / 0
select
  (select count(*) from public.affaires
    where code between '26-801' and '26-817' or code in ('AO-2026-91', 'AO-2026-92', 'AO-2026-93')) as affaires_restantes,
  (select count(*) from information_schema.schemata where schema_name = 'demo_admins')              as schema_restant;
