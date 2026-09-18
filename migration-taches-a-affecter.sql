-- ============================================================================
--  Outil de planification — tâches à affecter
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Une charge ingénieur ou dessin peut désormais attendre sa personne : la
--  tâche est créée sans affectation et paraît en tête du tableau de bord, sur
--  les lignes « À affecter ». Les deux contraintes qui l'interdisaient tombent.
--  Une tâche garde au moins une charge (contrainte charge_non_nulle).
-- ============================================================================

alter table public.taches drop constraint if exists inge_si_charge;
alter table public.taches drop constraint if exists dess_si_charge;
