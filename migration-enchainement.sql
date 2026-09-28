-- ============================================================================
--  Outil de planification — le dessin attend le calcul
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Jusqu'ici, les deux parts d'une tâche finissaient toutes deux à l'échéance,
--  en parallèle. Au bureau, le dessinateur attend souvent la note de calcul.
--  Une tâche « enchaînée » fait rendre le calcul la veille du jour où le dessin
--  commence ; le dessin garde l'échéance de la tâche.
--
--  Les tâches existantes ne sont pas enchaînées : rien ne bouge à l'écran après
--  la migration. Les tâches créées ensuite le sont d'office (case à décocher
--  dans le formulaire).
-- ============================================================================

alter table public.taches add column if not exists enchaine boolean not null default false;

comment on column public.taches.enchaine is
  'Le dessin commence quand le calcul est rendu : la part calcul finit la veille du début du dessin.';

-- Vérification : la colonne existe, et combien de tâches sont enchaînées
select count(*) as taches, count(*) filter (where enchaine) as enchainees
  from public.taches;
