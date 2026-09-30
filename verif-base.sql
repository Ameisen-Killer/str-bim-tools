-- ============================================================================
--  Outil de planification — la base a-t-elle reçu toutes les migrations ?
-- ----------------------------------------------------------------------------
--  Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  LECTURE SEULE : rien n'est créé, modifié ni effacé.
--
--  Une ligne par migration, avec ce qui la signe dans la base. Toutes à « oui » :
--  les fichiers migration-*.sql et les garde-fous du code qui les attendaient
--  peuvent partir (base-supabase.sql reste la référence pour une base neuve).
-- ============================================================================

with col(t, c) as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
), fn(n) as (
  select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
), pub(t) as (
  select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
), verif(ordre, migration, signe, ok) as (values
  (1,  'succursales',       'membres.succursale, membres.discipline',
        exists (select 1 from col where t = 'membres' and c = 'succursale')
    and exists (select 1 from col where t = 'membres' and c = 'discipline')),
  (2,  'taches-a-affecter', 'plus de contrainte inge_si_charge / dess_si_charge',
        not exists (select 1 from pg_constraint where conname in ('inge_si_charge', 'dess_si_charge'))),
  (3,  'multi-bureaux',     'table bureaux, acces.bureau_id, bureau_courant()',
        exists (select 1 from col where t = 'bureaux')
    and exists (select 1 from col where t = 'acces' and c = 'bureau_id')
    and exists (select 1 from fn where n = 'bureau_courant')),
  (4,  'console-membres',   'acces.membre_id, console_enregistre_personne()',
        exists (select 1 from col where t = 'acces' and c = 'membre_id')
    and exists (select 1 from fn where n = 'console_enregistre_personne')
    and not exists (select 1 from fn where n = 'console_enregistre_utilisateur')),
  (5,  'profil-membre',     'mon_profil() rend la fiche rattachée',
        exists (select 1 from pg_proc where proname = 'mon_profil' and prosrc like '%membreId%')),
  (6,  'parts-taches',      'taches.fini_inge, taches.fini_dessin',
        exists (select 1 from col where t = 'taches' and c = 'fini_inge')
    and exists (select 1 from col where t = 'taches' and c = 'fini_dessin')),
  (7,  'roles-statuts',     'membres.metier, membres.statuts',
        exists (select 1 from col where t = 'membres' and c = 'metier')
    and exists (select 1 from col where t = 'membres' and c = 'statuts')),
  (8,  'droits-groupes',    'table droits_groupes, a_droit()',
        exists (select 1 from col where t = 'droits_groupes')
    and exists (select 1 from fn where n = 'a_droit')),
  (9,  'passer-la-main',    'modification d''une tâche : contrôle d''arrivée sur le seul bureau',
        exists (select 1 from pg_policies where tablename = 'taches'
                  and policyname = 'droit ou ma tâche (modification)'
                  and with_check not like '%mon_membre%')),
  (10, 'annuaire',          'table contacts avec adresse et site',
        exists (select 1 from col where t = 'contacts' and c = 'site')
    and exists (select 1 from col where t = 'contacts' and c = 'npa')),
  (11, 'presence',          'table presences par onglet, presence()',
        exists (select 1 from col where t = 'presences' and c = 'onglet')
    and exists (select 1 from col where t = 'presences' and c = 'horloge')
    and exists (select 1 from fn where n = 'presence')),
  (12, 'temps-reel',        'tables du planning dans supabase_realtime',
        (select count(*) from pub where t in ('taches', 'affaires', 'affaire_membres', 'membres',
                                              'absences', 'contacts', 'reglages')) = 7),
  (13, 'enchainement',      'taches.enchaine',
        exists (select 1 from col where t = 'taches' and c = 'enchaine')),
  (14, 'phase-affaires',    'affaires.phase',
        exists (select 1 from col where t = 'affaires' and c = 'phase')),
  (15, 'adresse-affaires',  'affaires.adresse',
        exists (select 1 from col where t = 'affaires' and c = 'adresse')),
  (16, 'visas',             'tables exports_visas et visas_traites, seau « visas »',
        exists (select 1 from col where t = 'exports_visas')
    and exists (select 1 from col where t = 'visas_traites')
    and exists (select 1 from storage.buckets where id = 'visas')),
  (17, 'demo-console',      'console_reinitialise_demo(), remplit_demo()',
        exists (select 1 from fn where n = 'console_reinitialise_demo')
    and exists (select 1 from fn where n = 'remplit_demo')),
  (18, 'jours-travailles',  'membres.jours, regle_jours()',
        exists (select 1 from col where t = 'membres' and c = 'jours')
    and exists (select 1 from fn where n = 'regle_jours'))
)
select ordre, 'migration-' || migration || '.sql' as fichier, signe,
       case when ok then 'oui' else 'NON' end as en_place
  from verif
 order by ok, ordre;
