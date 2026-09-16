-- ============================================================================
--  Outil de planification — JEU D'ESSAI (données entièrement fictives)
-- ----------------------------------------------------------------------------
--  À coller dans Supabase : SQL Editor > New query > Run.
--
--  12 membres, 12 affaires, 61 tâches, 6 absences. Toutes les dates sont
--  calculées à partir du jour d'exécution : le jeu reste pertinent quel que
--  soit le moment où on le lance.
--
--  Ce qu'il permet d'éprouver :
--    - retards (tâches en cours dont l'échéance est passée) ;
--    - surcharges (Kevin Monnier et Julien Pittet dans les deux semaines) ;
--    - temps partiels (Sara Meylan 80 %, Nora Baeriswyl 60 %, Inès Bovet 80 %) ;
--    - absences (vacances, service militaire, formation, congé) ;
--    - statuts : à faire, en cours, en attente, terminé ;
--    - affaires active, suspendue, terminée ; un membre inactif ;
--    - tâches ingénieur seul, dessin seul, et mixtes ;
--    - les huit teintes d'affaire.
--
--  Marquage, pour pouvoir tout retirer d'un coup (purge-jeu-essai.sql) :
--    - membres : adresse en @essai.exemple.ch
--    - affaires : note contenant [jeu d'essai]
--  Les données réelles déjà saisies ne sont jamais touchées.
-- ============================================================================

begin;

-- Garde-fou : pas de doublon si le script est relancé
do $$
begin
  if exists (select 1 from public.membres where email like '%@essai.exemple.ch') then
    raise exception 'Le jeu d''essai est déjà présent. Lancer d''abord purge-jeu-essai.sql.';
  end if;
end $$;

-- ------------------------------------------------------------------ membres
insert into public.membres (prenom, nom, email, role, capacite, actif) values
  ('Anne',   'Rochat',      'anne.rochat@essai.exemple.ch',       'ingenieur',   5, true),
  ('Julien', 'Pittet',      'julien.pittet@essai.exemple.ch',     'ingenieur',   5, true),
  ('Sara',   'Meylan',      'sara.meylan@essai.exemple.ch',       'ingenieur',   4, true),
  ('David',  'Cuendet',     'david.cuendet@essai.exemple.ch',     'ingenieur',   5, true),
  ('Nora',   'Baeriswyl',   'nora.baeriswyl@essai.exemple.ch',    'ingenieur',   3, true),
  ('Kevin',  'Monnier',     'kevin.monnier@essai.exemple.ch',     'dessinateur', 5, true),
  ('Lucie',  'Jaquier',     'lucie.jaquier@essai.exemple.ch',     'dessinateur', 5, true),
  ('Tiago',  'Ferreira',    'tiago.ferreira@essai.exemple.ch',    'dessinateur', 5, true),
  ('Inès',   'Bovet',       'ines.bovet@essai.exemple.ch',        'dessinateur', 4, true),
  ('Marco',  'Gianoli',     'marco.gianoli@essai.exemple.ch',     'dessinateur', 5, true),
  ('Emma',   'Chappuis',    'emma.chappuis@essai.exemple.ch',     'dessinateur', 5, true),
  ('Loris',  'Vuilleumier', 'loris.vuilleumier@essai.exemple.ch', 'dessinateur', 5, false);

-- ----------------------------------------------------------------- affaires
insert into public.affaires (code, nom, note, teinte, statut, echeance)
select v.code, v.nom, '[jeu d''essai] ' || v.note, v.teinte, v.statut,
       case when v.dec is null then null else current_date + v.dec end
from (values
  ('26-901', 'Immeuble de logements Les Tilleuls — gros œuvre', 'Quatre niveaux sur deux sous-sols.',        1, 'active',    70),
  ('26-902', 'École primaire — surélévation bois-béton',         'Dalle mixte sur bâtiment existant.',        2, 'active',    50),
  ('26-903', 'Halle de stockage — dalle industrielle',           'Dalle sur sol, joints sciés.',              3, 'active',    30),
  ('26-904', 'Parking souterrain sur deux niveaux',              'Fouille blindée, nappe proche.',            4, 'active',    90),
  ('26-905', 'Passerelle piétonne — étude de variantes',         'Trois variantes à comparer.',               5, 'active',    40),
  ('26-906', 'Villa individuelle — radier et murs',              'Petite affaire, délais courts.',            6, 'active',    15),
  ('26-907', 'EMS — agrandissement',                             'Longue durée, démarrage progressif.',       7, 'active',   120),
  ('26-908', 'Bâtiment administratif — renforcement parasismique','Diagnostic puis renforcement des voiles.',  8, 'active',    60),
  ('26-909', 'Station d''épuration — bassins',                   'Ouvrages étanches.',                        5, 'active',    35),
  ('26-910', 'Centre sportif — tribune',                         'En attente du crédit communal.',            4, 'suspendue', null),
  ('26-911', 'Immeuble mixte — expertise de dalle',              'Rapport rendu.',                            6, 'terminee', -30),
  ('26-912', 'Mur de soutènement — route communale',             'Mur en L, drainage.',                       7, 'active',    25)
) as v(code, nom, note, teinte, statut, dec)
on conflict (code) do nothing;

-- ------------------------------------------------------- équipes d'affaire
insert into public.affaire_membres (affaire_id, membre_id)
select a.id, m.id
from (values
  ('26-901','anne.rochat'), ('26-901','julien.pittet'), ('26-901','kevin.monnier'), ('26-901','lucie.jaquier'), ('26-901','tiago.ferreira'),
  ('26-902','sara.meylan'), ('26-902','ines.bovet'), ('26-902','marco.gianoli'),
  ('26-903','david.cuendet'), ('26-903','emma.chappuis'), ('26-903','kevin.monnier'),
  ('26-904','julien.pittet'), ('26-904','nora.baeriswyl'), ('26-904','tiago.ferreira'), ('26-904','marco.gianoli'),
  ('26-905','anne.rochat'), ('26-905','ines.bovet'),
  ('26-906','david.cuendet'), ('26-906','lucie.jaquier'),
  ('26-907','nora.baeriswyl'), ('26-907','sara.meylan'), ('26-907','marco.gianoli'), ('26-907','emma.chappuis'),
  ('26-908','julien.pittet'), ('26-908','kevin.monnier'), ('26-908','tiago.ferreira'),
  ('26-909','david.cuendet'), ('26-909','marco.gianoli'),
  ('26-910','sara.meylan'), ('26-910','ines.bovet'),
  ('26-911','anne.rochat'), ('26-911','tiago.ferreira'),
  ('26-912','nora.baeriswyl'), ('26-912','kevin.monnier')
) as v(code, login)
join public.affaires a on a.code = v.code and a.note like '[jeu d''essai]%'
join public.membres  m on m.email = v.login || '@essai.exemple.ch';

-- ----------------------------------------------------------------- absences
insert into public.absences (membre_id, debut, fin, motif)
select m.id, current_date + v.d1, current_date + v.d2, v.motif
from (values
  ('sara.meylan',    -3,  1, 'Vacances'),
  ('kevin.monnier',   2,  3, 'Formation'),
  ('emma.chappuis',   5,  5, 'Congé'),
  ('lucie.jaquier',  12, 23, 'Vacances'),
  ('julien.pittet',  26, 37, 'Service militaire'),
  ('tiago.ferreira', 40, 49, 'Vacances')
) as v(login, d1, d2, motif)
join public.membres m on m.email = v.login || '@essai.exemple.ch';

-- ------------------------------------------------------------------- tâches
-- dec : décalage de l'échéance en jours depuis aujourd'hui, ramené au vendredi
-- précédent s'il tombe un week-end. Début : déduit par l'outil.
insert into public.taches (affaire_id, titre, charge_inge, charge_dessin, echeance,
                           ingenieur_id, dessinateur_id, statut, avancement)
select a.id, v.titre, v.ci, v.cd,
       (current_date + v.dec) - case extract(isodow from current_date + v.dec)::int
                                  when 6 then 1 when 7 then 2 else 0 end,
       i.id, d.id, v.statut, v.av
from (values
  -- 26-901 Immeuble Les Tilleuls
  ('26-901', 'Descente de charges',                      3.0, 0.0, 'anne.rochat',    null,              -20, 'termine',  100),
  ('26-901', 'Plans de coffrage du radier',              0.5, 5.0, 'anne.rochat',    'kevin.monnier',    -9, 'termine',  100),
  ('26-901', 'Plans d''armature du radier',              1.0, 6.0, 'anne.rochat',    'kevin.monnier',    -2, 'en_cours',  80),
  ('26-901', 'Plans de coffrage du sous-sol',            0.5, 6.0, 'anne.rochat',    'lucie.jaquier',     6, 'en_cours',  40),
  ('26-901', 'Plans d''armature des murs du sous-sol',   1.0, 7.0, 'julien.pittet',  'kevin.monnier',    13, 'a_faire',    0),
  ('26-901', 'Plans de coffrage du rez-de-chaussée',     0.5, 5.0, 'anne.rochat',    'tiago.ferreira',   20, 'a_faire',    0),
  ('26-901', 'Plans d''armature de la dalle sur rez',    1.0, 6.0, 'julien.pittet',  'tiago.ferreira',   30, 'a_faire',    0),
  ('26-901', 'Plans de coffrage des étages types',       1.0, 8.0, 'anne.rochat',    'lucie.jaquier',    44, 'a_faire',    0),
  ('26-901', 'Métré béton et armature',                  0.0, 3.0, null,             'kevin.monnier',    51, 'a_faire',    0),
  ('26-901', 'Contrôle des plans d''entreprise',         2.0, 0.0, 'julien.pittet',  null,               58, 'a_faire',    0),
  -- 26-902 École, surélévation
  ('26-902', 'Relevé de l''existant et hypothèses',      3.0, 1.0, 'sara.meylan',    'marco.gianoli',   -15, 'termine',  100),
  ('26-902', 'Note de calcul de la dalle mixte',         4.0, 0.0, 'sara.meylan',    null,                2, 'en_cours',  60),
  ('26-902', 'Plans de principe des connecteurs',        1.0, 3.0, 'sara.meylan',    'ines.bovet',        8, 'a_faire',    0),
  ('26-902', 'Détails d''appuis et ancrages',            1.0, 4.0, 'sara.meylan',    'marco.gianoli',    16, 'a_faire',    0),
  ('26-902', 'Plans d''exécution de la surélévation',    1.5, 8.0, 'sara.meylan',    'ines.bovet',       34, 'a_faire',    0),
  ('26-902', 'Coordination avec le charpentier',         1.0, 0.0, 'sara.meylan',    null,               41, 'attente',    0),
  -- 26-903 Halle de stockage
  ('26-903', 'Note de calcul de la dalle industrielle',  3.0, 0.0, 'david.cuendet',  null,               -6, 'termine',  100),
  ('26-903', 'Plan de joints et calepinage',             0.5, 3.0, 'david.cuendet',  'emma.chappuis',     1, 'en_cours',  70),
  ('26-903', 'Plans d''armature de la dalle',            1.0, 5.0, 'david.cuendet',  'kevin.monnier',     9, 'a_faire',    0),
  ('26-903', 'Détails des fosses et quais',              0.5, 4.0, 'david.cuendet',  'emma.chappuis',    15, 'a_faire',    0),
  ('26-903', 'Métré',                                    0.0, 2.0, null,             'emma.chappuis',    22, 'a_faire',    0),
  -- 26-904 Parking souterrain
  ('26-904', 'Avant-projet de structure',                4.0, 2.0, 'julien.pittet',  'tiago.ferreira',  -30, 'termine',  100),
  ('26-904', 'Étude de variantes de soutènement',        3.0, 0.0, 'nora.baeriswyl', null,                3, 'en_cours',  50),
  ('26-904', 'Plans de fouille et d''étayage',           1.0, 5.0, 'julien.pittet',  'tiago.ferreira',   10, 'a_faire',    0),
  ('26-904', 'Note de calcul du radier et des murs',     5.0, 0.0, 'julien.pittet',  null,               12, 'a_faire',    0),
  ('26-904', 'Plans de coffrage du niveau -2',           1.0, 7.0, 'nora.baeriswyl', 'marco.gianoli',    38, 'a_faire',    0),
  ('26-904', 'Plans de coffrage du niveau -1',           1.0, 7.0, 'nora.baeriswyl', 'marco.gianoli',    55, 'a_faire',    0),
  ('26-904', 'Plans d''armature',                        2.0,12.0, 'julien.pittet',  'tiago.ferreira',   75, 'a_faire',    0),
  -- 26-905 Passerelle
  ('26-905', 'Étude de trois variantes',                 5.0, 2.0, 'anne.rochat',    'ines.bovet',       -1, 'en_cours',  85),
  ('26-905', 'Modèle BIM de la variante retenue',        1.0, 5.0, 'anne.rochat',    'ines.bovet',       19, 'a_faire',    0),
  ('26-905', 'Dossier d''appel d''offres',               2.0, 4.0, 'anne.rochat',    'ines.bovet',       37, 'a_faire',    0),
  -- 26-906 Villa
  ('26-906', 'Plans de coffrage du radier',              0.5, 2.0, 'david.cuendet',  'lucie.jaquier',    -8, 'termine',  100),
  ('26-906', 'Plans d''armature du radier et des murs',  1.0, 4.0, 'david.cuendet',  'lucie.jaquier',     4, 'en_cours',  30),
  ('26-906', 'Réception d''armature sur chantier',       0.5, 0.0, 'david.cuendet',  null,                7, 'a_faire',    0),
  ('26-906', 'Plans des réservations',                   0.0, 2.0, null,             'lucie.jaquier',     9, 'a_faire',    0),
  -- 26-907 EMS
  ('26-907', 'Descente de charges de l''agrandissement', 2.0, 0.0, 'nora.baeriswyl', null,                5, 'a_faire',    0),
  ('26-907', 'Plans de principe',                        1.0, 4.0, 'nora.baeriswyl', 'emma.chappuis',    25, 'a_faire',    0),
  ('26-907', 'Coordination CVSE',                        1.0, 1.0, 'sara.meylan',    'emma.chappuis',    45, 'a_faire',    0),
  ('26-907', 'Plans d''exécution',                       3.0,15.0, 'nora.baeriswyl', 'marco.gianoli',   100, 'a_faire',    0),
  -- 26-908 Renforcement parasismique
  ('26-908', 'Diagnostic de l''existant',                4.0, 1.0, 'julien.pittet',  'kevin.monnier',   -18, 'termine',  100),
  ('26-908', 'Modèle de calcul sismique',                5.0, 0.0, 'julien.pittet',  null,               20, 'a_faire',    0),
  ('26-908', 'Plans de renforcement des voiles',         1.5, 6.0, 'julien.pittet',  'kevin.monnier',    42, 'a_faire',    0),
  ('26-908', 'Détails des ancrages',                     1.0, 3.0, 'julien.pittet',  'tiago.ferreira',   48, 'a_faire',    0),
  -- 26-909 Station d'épuration
  ('26-909', 'Plans de coffrage des bassins',            1.0, 6.0, 'david.cuendet',  'marco.gianoli',     6, 'en_cours',  20),
  ('26-909', 'Plans d''armature des bassins',            2.0, 8.0, 'david.cuendet',  'marco.gianoli',    27, 'a_faire',    0),
  ('26-909', 'Note de calcul d''étanchéité',             2.0, 0.0, 'david.cuendet',  null,               32, 'a_faire',    0),
  -- 26-910 Tribune (suspendue)
  ('26-910', 'Étude de faisabilité de la tribune',       3.0, 1.0, 'sara.meylan',    'ines.bovet',      -40, 'termine',  100),
  ('26-910', 'Plans de principe de la tribune',          1.0, 5.0, 'sara.meylan',    'ines.bovet',       60, 'attente',    0),
  -- 26-911 Expertise (terminée)
  ('26-911', 'Sondages et relevé de la dalle',           1.0, 1.0, 'anne.rochat',    'tiago.ferreira',  -45, 'termine',  100),
  ('26-911', 'Rapport d''expertise',                     3.0, 0.0, 'anne.rochat',    null,              -35, 'termine',  100),
  -- 26-912 Mur de soutènement
  ('26-912', 'Note de calcul du mur en L',               2.0, 0.0, 'nora.baeriswyl', null,               -4, 'termine',  100),
  ('26-912', 'Plans de coffrage et d''armature du mur',  0.5, 4.0, 'nora.baeriswyl', 'kevin.monnier',     7, 'en_cours',  25),
  ('26-912', 'Plans des joints et du drainage',          0.0, 2.0, null,             'kevin.monnier',    11, 'a_faire',    0),
  ('26-912', 'Visite de réception',                      0.5, 0.0, 'nora.baeriswyl', null,               23, 'a_faire',    0),
  -- Tâches courtes pour peupler la semaine en cours
  ('26-901', 'Réponse aux remarques de l''architecte',   1.0, 1.0, 'julien.pittet',  'lucie.jaquier',     1, 'en_cours',  50),
  ('26-903', 'Mise à jour des plans indice B',           0.0, 1.5, null,             'emma.chappuis',     2, 'a_faire',    0),
  ('26-904', 'Séance de coordination géotechnicien',     0.5, 0.0, 'nora.baeriswyl', null,                0, 'a_faire',    0),
  ('26-905', 'Visuels pour la séance maître d''ouvrage', 0.0, 1.0, null,             'ines.bovet',        2, 'en_cours',  40),
  ('26-908', 'Relevé complémentaire sur site',           1.0, 1.0, 'julien.pittet',  'tiago.ferreira',    3, 'a_faire',    0),
  ('26-909', 'Plans de réservations des conduites',      0.0, 2.0, null,             'marco.gianoli',     8, 'a_faire',    0),
  ('26-912', 'Contrôle des plans de l''entreprise',      1.0, 0.0, 'david.cuendet',  null,               -3, 'en_cours',  60)
) as v(code, titre, ci, cd, ing, des, dec, statut, av)
join public.affaires a on a.code = v.code and a.note like '[jeu d''essai]%'
left join public.membres i on i.email = v.ing || '@essai.exemple.ch'
left join public.membres d on d.email = v.des || '@essai.exemple.ch';

commit;

-- Contrôle : doit afficher 12 / 12 / 61 / 6
select
  (select count(*) from public.membres  where email like '%@essai.exemple.ch')                 as membres,
  (select count(*) from public.affaires where note like '[jeu d''essai]%')                      as affaires,
  (select count(*) from public.taches t join public.affaires a on a.id = t.affaire_id
     where a.note like '[jeu d''essai]%')                                                      as taches,
  (select count(*) from public.absences b join public.membres m on m.id = b.membre_id
     where m.email like '%@essai.exemple.ch')                                                  as absences;
