-- Contrôle en lecture seule (16.11.2026) : quelles migrations du dépôt sont déjà
-- passées dans la base ? Ne modifie rien. Retiré du dépôt après lecture.
select m.migration, m.faite from (values
  ('affaires-pour-tous',      exists (select 1 from public.droits_groupes where statut = 'tous' and 'page_affaires' = any (droits))),
  ('dependances',             exists (select 1 from information_schema.columns where table_schema='public' and table_name='taches' and column_name='avant')
                              and to_regprocedure('public.tient_tache(uuid)') is not null),
  ('droit-modifier-affaires', to_regprocedure('public.peut_modifier_affaire(uuid)') is not null),
  ('fgh-arm',                 to_regclass('public.fgh_controles_photos') is not null),
  ('fgh-connexion',           to_regclass('public.fgh_reglages') is not null and to_regprocedure('public.acces_fgh()') is not null),
  ('fgh-plans',               exists (select 1 from information_schema.columns where table_schema='public' and table_name='fgh_plans' and column_name='controle_lien')),
  ('fgh-res-historique',      to_regclass('public.fgh_res_fichiers') is not null),
  ('modifier-fiche',          to_regprocedure('public.modifie_fiche(uuid,jsonb)') is not null),
  ('organiseur',              to_regclass('public.doc_reservations') is not null)
) as m(migration, faite);
