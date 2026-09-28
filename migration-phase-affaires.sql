-- ============================================================================
--  Outil de planification — phase de l'affaire
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Chaque affaire peut porter sa phase SIA 112, rangée par son numéro
--  (« 32 » pour le projet de l'ouvrage) ; l'interface en donne le libellé.
--  Vide : phase non renseignée. Les affaires existantes restent sans phase.
-- ============================================================================

alter table public.affaires add column if not exists phase text;

comment on column public.affaires.phase is
  'Phase SIA 112 en cours, par son numéro (31, 32, 33, 41, 51…). Vide : non renseignée.';

-- Vérification : la colonne existe
select count(*) as affaires, count(phase) as avec_phase from public.affaires;
