-- Planification — fin propre de la part calcul (12.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute à chaque tâche la date de fin de sa part
-- calcul quand le dessin en dépend (tâche enchaînée) : avancer le calcul au
-- tableau de bord ne fait plus bouger le dessin. Vide (toutes les tâches
-- existantes) : le calcul finit, comme avant, le dernier jour travaillé avant
-- le début du dessin.
-- ---------------------------------------------------------------------------
begin;

alter table public.taches add column if not exists fin_calcul date;
comment on column public.taches.fin_calcul is
  'Tâche enchaînée : fin propre de la part calcul, jamais après la veille du dessin (l''outil s''en charge). Vide : le dernier jour travaillé avant le début du dessin.';

commit;

-- Contrôle : doit afficher « fin_calcul »
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'taches' and column_name = 'fin_calcul';
