-- ============================================================================
--  Outil de planification — adresse de l'affaire
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  L'adresse du chantier, en un seul champ (« Rue du Lac 12, 1201 Genève ») :
--  c'est elle que l'interface envoie à Google Maps.
-- ============================================================================

alter table public.affaires add column if not exists adresse text not null default '';

comment on column public.affaires.adresse is
  'Adresse de l''affaire en texte libre, telle qu''on la chercherait sur une carte.';

-- Vérification : la colonne existe
select count(*) as affaires, count(*) filter (where adresse <> '') as avec_adresse from public.affaires;
