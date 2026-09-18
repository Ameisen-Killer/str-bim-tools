-- ============================================================================
--  Outil de planification — succursales, disciplines et nouveaux rôles
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  - Chaque membre porte sa succursale et sa discipline (facultatives).
--  - Rôles : ingénieur, dessinateur, administrateur, administratif.
--    Un rôle vide signifie « à désigner ».
--  - L'adresse e-mail devient facultative ; elle reste unique quand elle est saisie.
--
--  Les listes de valeurs doublent celles de docs/planif/assets/donnees.js
--  (SUCCURSALES, DISCIPLINES, ROLES) : les changer ici ET là-bas.
-- ============================================================================

begin;

alter table public.membres alter column email drop not null;
alter table public.membres alter column role  drop not null;

alter table public.membres drop constraint if exists membres_role_check;
alter table public.membres add constraint membres_role_check
  check (role is null or role in ('ingenieur', 'dessinateur', 'administrateur', 'administratif'));

alter table public.membres add column if not exists succursale text;
alter table public.membres add column if not exists discipline text;

alter table public.membres drop constraint if exists membres_succursale_check;
alter table public.membres add constraint membres_succursale_check
  check (succursale is null or succursale in ('geneve', 'lausanne', 'nyon'));

alter table public.membres drop constraint if exists membres_discipline_check;
alter table public.membres add constraint membres_discipline_check
  check (discipline is null or discipline in ('administrateurs', 'structure', 'geotechnique',
         'environnement', 'investigation', 'genie_civil', 'administration'));

comment on column public.membres.role is 'Vide : membre pas encore désigné. Seuls ingénieurs et dessinateurs portent des tâches.';
comment on column public.membres.succursale is 'geneve, lausanne ou nyon.';

commit;

-- L'API relit la forme des tables, pour que les nouvelles colonnes soient visibles tout de suite
notify pgrst, 'reload schema';
