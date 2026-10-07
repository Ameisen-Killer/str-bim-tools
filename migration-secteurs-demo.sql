-- Planification — migration du 07.10.2026 : secteurs dans la démo.
-- Les membres fictifs du Bureau de test se répartissent entre les disciplines
-- déclarées dans la console (Structure en tête, puis la deuxième et la
-- troisième), avec un chef de secteur chacune.
-- À exécuter une fois dans Supabase (SQL Editor), puis cliquer sur
-- « Réinitialiser la démo » dans la console. Fichier à retirer ensuite.

create or replace function public.remplit_demo(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  -- Disciplines du Bureau de test, Structure en tête ; celles de l'administration
  -- ne portent pas de projets. Le jeu se plie à ce que la console y a déclaré.
  v_discs text[] := array(select d.code from public.disciplines d
                           where d.bureau_id = p_bureau and d.nom !~* '^administr'
                           order by (d.nom ~* '^structure') desc, d.ordre, d.nom);
begin
  -- ------------------------------------------------------------------ membres
  -- Les administrateurs sont des ingénieurs associés : ils peuvent recevoir des
  -- tâches. Les administratifs ne portent aucune charge.
  -- s : secteur — 1 la première discipline (Structure), 2 la deuxième, 3 la
  -- troisième ; s'il en manque, le secteur se replie sur la dernière. Plusieurs
  -- affaires mêlent ainsi des personnes de deux secteurs (affaires transversales).
  insert into public.membres (bureau_id, prenom, nom, email, metier, statuts, capacite, actif, discipline)
  select p_bureau, v.prenom, v.nom, v.email, v.metier, v.statuts::text[], v.capacite, true,
         case when v.metier = 'administratif' or cardinality(v_discs) = 0 then null
              else v_discs[least(v.s, cardinality(v_discs))] end
  from (values
    ('Laurent', 'Mercier', 'laurent.mercier@demo.exemple.ch', 'ingenieur', '{administrateur}', 5, 1),
    ('Claire', 'Dufour', 'claire.dufour@demo.exemple.ch', 'ingenieur', '{administrateur}', 5, 1),
    ('Sandrine', 'Rey', 'sandrine.rey@demo.exemple.ch', 'administratif', '{}', 5, 1),
    ('Patrick', 'Gilliéron', 'patrick.gillieron@demo.exemple.ch', 'administratif', '{}', 4, 1),
    ('Mélanie', 'Constantin', 'melanie.constantin@demo.exemple.ch', 'administratif', '{}', 3, 1),
    ('Olivier', 'Berthoud', 'olivier.berthoud@demo.exemple.ch', 'ingenieur', '{chef_secteur}', 5, 1),
    ('Camille', 'Rossier', 'camille.rossier@demo.exemple.ch', 'ingenieur', '{chef_projet}', 5, 1),
    ('Thomas', 'Jaquet', 'thomas.jaquet@demo.exemple.ch', 'ingenieur', '{chef_projet}', 5, 1),
    ('Aurélie', 'Fontannaz', 'aurelie.fontannaz@demo.exemple.ch', 'ingenieur', '{chef_secteur,chef_projet}', 4, 3),
    ('Nicolas', 'Perroud', 'nicolas.perroud@demo.exemple.ch', 'ingenieur', '{chef_secteur,chef_projet}', 5, 2),
    ('Jérémie', 'Brodard', 'jeremie.brodard@demo.exemple.ch', 'ingenieur', '{}', 5, 2),
    ('Léa', 'Cattin', 'lea.cattin@demo.exemple.ch', 'ingenieur', '{}', 5, 1),
    ('Mathieu', 'Pidoux', 'mathieu.pidoux@demo.exemple.ch', 'ingenieur', '{}', 5, 3),
    ('Sofia', 'Marques', 'sofia.marques@demo.exemple.ch', 'ingenieur', '{}', 4, 1),
    ('Adrien', 'Chevalley', 'adrien.chevalley@demo.exemple.ch', 'ingenieur', '{}', 5, 2),
    ('Yannick', 'Pasquier', 'yannick.pasquier@demo.exemple.ch', 'dessinateur', '{}', 5, 1),
    ('Céline', 'Burnier', 'celine.burnier@demo.exemple.ch', 'dessinateur', '{}', 5, 1),
    ('Romain', 'Tissot', 'romain.tissot@demo.exemple.ch', 'dessinateur', '{}', 5, 1),
    ('Laetitia', 'Mottier', 'laetitia.mottier@demo.exemple.ch', 'dessinateur', '{}', 4, 1),
    ('Fabio', 'Russo', 'fabio.russo@demo.exemple.ch', 'dessinateur', '{}', 5, 3),
    ('Nadia', 'Haddad', 'nadia.haddad@demo.exemple.ch', 'dessinateur', '{}', 5, 1),
    ('Steve', 'Monney', 'steve.monney@demo.exemple.ch', 'dessinateur', '{}', 5, 2),
    ('Justine', 'Rouiller', 'justine.rouiller@demo.exemple.ch', 'dessinateur', '{}', 3, 2),
    ('Bruno', 'Teixeira', 'bruno.teixeira@demo.exemple.ch', 'dessinateur', '{}', 5, 2),
    ('Manon', 'Dériaz', 'manon.deriaz@demo.exemple.ch', 'dessinateur', '{}', 5, 3)
  ) as v(prenom, nom, email, metier, statuts, capacite, s);

  -- ----------------------------------------------------------------- affaires
  -- Rues réelles, numéros et projets inventés.
  insert into public.affaires (bureau_id, code, nom, note, teinte, phase, adresse, statut, echeance)
  select p_bureau, v.code, v.nom, '[démo] ' || v.note, v.teinte, v.phase, v.adresse, 'active', current_date + v.dec
  from (values
    ('26-101', 'Immeuble de logements Les Ormeaux', 'Deux sous-sols, rez et cinq étages, attique. Exécution en cours.', 1, '52', 'Route de Chêne 120, 1224 Chêne-Bougeries', 240),
    ('26-102', 'Surélévation bois-béton, rue de Carouge', 'Deux niveaux en bois sur dalle mixte, immeuble des années 1960.', 2, '51', 'Rue de Carouge 58, 1205 Genève', 150),
    ('26-103', 'École primaire des Palettes — agrandissement', 'Salle de gymnastique enterrée et préau, liaison avec le bâtiment existant.', 3, '32', 'Chemin des Palettes 20, 1212 Grand-Lancy', 300),
    ('26-104', 'Parking souterrain de Montelly', 'Trois cents places sur deux niveaux, paroi berlinoise, nappe proche.', 4, '51', 'Avenue de Morges 60, 1004 Lausanne', 200),
    ('26-105', 'Halle logistique du Closel', 'Halle de 6 000 m², dalle industrielle sans joints, quais de chargement.', 5, '51', 'Chemin du Closel 5, 1020 Renens', 120),
    ('26-106', 'Passerelle piétonne sur la Versoix', 'Passerelle de 42 m, trois variantes à comparer (acier, bois, béton).', 6, '31', 'Route de Suisse 30, 1290 Versoix', 90),
    ('26-107', 'EMS de Chailly — extension', 'Extension de quarante lits, liaison avec le bâtiment existant.', 7, '32', 'Avenue de Chailly 40, 1012 Lausanne', 360),
    ('26-108', 'Immeuble rue du Stand — renforcement parasismique', 'Mise en conformité parasismique, voiles et fondations à renforcer.', 8, '51', 'Rue du Stand 45, 1204 Genève', 180),
    ('26-109', 'Villas mitoyennes Les Vergers', 'Quatre villas mitoyennes sur sous-sol commun.', 2, '52', 'Chemin de la Gravière 8, 1196 Gland', 100),
    ('26-110', 'Centre sportif de la Blécherette — tribune', 'Tribune de 1 200 places, gradins préfabriqués, toiture en porte-à-faux.', 3, '33', 'Route de Romanel 50, 1018 Lausanne', 270)
  ) as v(code, nom, note, teinte, phase, adresse, dec);

  -- ----------------------------------------------------------------- absences
  -- Décalages en jours depuis le lundi de la semaine en cours
  insert into public.absences (bureau_id, membre_id, debut, fin, motif)
  select p_bureau, m.id, date_trunc('week', current_date)::date + v.d1, date_trunc('week', current_date)::date + v.d2, v.motif
  from (values
    ('celine.burnier', 14, 18, 'Vacances'),
    ('jeremie.brodard', 9, 10, 'Formation'),
    ('steve.monney', 21, 25, 'Service militaire'),
    ('claire.dufour', 17, 18, 'Congé')
  ) as v(login, d1, d2, motif)
  join public.membres m on m.email = v.login || '@demo.exemple.ch'
                       and m.bureau_id = p_bureau;

  -- ------------------------------------------------------------------- tâches
  -- e  : échéance, en jours depuis le lundi de la semaine en cours (jours ouvrés) ;
  -- fi : fin de la part calcul d'une tâche enchaînée (la veille du début du dessin) ;
  -- p  : n normal, r reste en cours même échue (retard), w en attente.
  -- Le début de chaque part est déduit par l'outil.
  with v(code, titre, ci, cd, ing, des, e, fi, p) as (values
    ('26-101', 'Plans de coffrage — murs du 2e sous-sol', 1.0, 2.5, 'camille.rossier', 'yannick.pasquier', 4, 1, 'n'),
    ('26-101', 'Plans d''armature — radier', 1.5, 2.5, 'lea.cattin', 'romain.tissot', 8, 3, 'n'),
    ('26-101', 'Réception d''armature — radier', 0.5, 0.0, 'lea.cattin', null, 10, 10, 'n'),
    ('26-101', 'Plans de coffrage — dalle sur 1er sous-sol', 1.5, 2.0, 'lea.cattin', 'yannick.pasquier', 11, 9, 'n'),
    ('26-101', 'Note de calcul — dalle sur rez', 2.0, 0.0, 'lea.cattin', null, 16, 16, 'n'),
    ('26-101', 'Plans d''armature — murs du 2e sous-sol', 2.0, 3.5, 'camille.rossier', 'yannick.pasquier', 18, 14, 'n'),
    ('26-101', 'Plans de coffrage — dalle sur rez', 1.5, 3.0, 'lea.cattin', 'romain.tissot', 22, 17, 'n'),
    ('26-101', 'Contrôle des plans d''armature de l''attique', 1.0, 0.0, 'claire.dufour', null, 23, 23, 'n'),
    ('26-101', 'Réservations CVSE — dalle sur 1er sous-sol', 0.5, 1.5, 'lea.cattin', 'yannick.pasquier', 23, 21, 'n'),
    ('26-101', 'Note de calcul — étages types', 1.5, 0.0, 'lea.cattin', null, 24, 24, 'n'),
    ('26-101', 'Détails constructifs — murs du 2e sous-sol', 1.0, 1.0, 'camille.rossier', 'romain.tissot', 25, 24, 'n'),
    ('26-102', 'Note de calcul — toiture', 2.5, 0.0, 'thomas.jaquet', null, 2, 2, 'n'),
    ('26-102', 'Plans de coffrage — appuis sur l''existant', 1.0, 3.0, 'sofia.marques', 'celine.burnier', 4, 1, 'n'),
    ('26-102', 'Plans de coffrage — toiture', 1.0, 1.5, 'thomas.jaquet', 'nadia.haddad', 7, 3, 'n'),
    ('26-102', 'Note de calcul — reprise des charges de la surélévation', 3.0, 0.0, 'thomas.jaquet', null, 11, 11, 'n'),
    ('26-102', 'Plans de coffrage — noyau de contreventement', 2.0, 1.5, 'sofia.marques', 'celine.burnier', 11, 9, 'n'),
    ('26-102', 'Réservations CVSE — noyau de contreventement', 1.0, 1.5, 'sofia.marques', 'nadia.haddad', 14, 10, 'n'),
    ('26-102', 'Plans d''armature — dalle mixte', 2.0, 3.0, 'thomas.jaquet', 'nadia.haddad', 16, 11, 'n'),
    ('26-102', 'Plans d''armature — noyau de contreventement', 1.5, 2.0, 'thomas.jaquet', 'nadia.haddad', 18, 16, 'n'),
    ('26-102', 'Détails constructifs — dalle mixte', 1.0, 1.5, 'thomas.jaquet', 'nadia.haddad', 23, 21, 'n'),
    ('26-102', 'Listes de fers — dalle mixte', 0.0, 1.0, null, 'nadia.haddad', 25, 25, 'n'),
    ('26-102', 'Plans d''armature — appuis sur l''existant', 2.5, 3.5, 'sofia.marques', 'celine.burnier', 25, 21, 'n'),
    ('26-103', 'Note de prédimensionnement — préau couvert', 3.0, 0.0, 'mathieu.pidoux', null, 3, 3, 'n'),
    ('26-103', 'Plans de principe — salle de gymnastique', 2.0, 2.0, 'aurelie.fontannaz', 'manon.deriaz', 4, 2, 'n'),
    ('26-103', 'Modèle BIM — salle de gymnastique', 1.0, 3.0, 'mathieu.pidoux', 'manon.deriaz', 11, 8, 'n'),
    ('26-103', 'Descente de charges — dalle sur sous-sol', 1.0, 0.0, 'mathieu.pidoux', null, 15, 15, 'n'),
    ('26-103', 'Plans de présentation — salle de gymnastique', 0.0, 1.0, null, 'manon.deriaz', 16, 16, 'n'),
    ('26-103', 'Note de prédimensionnement — dalle sur sous-sol', 3.0, 0.0, 'mathieu.pidoux', null, 17, 17, 'n'),
    ('26-103', 'Plans de principe — préau couvert, variante bois', 0.5, 2.0, null, null, 22, 22, 'n'),
    ('26-103', 'Plans de principe — préau couvert', 2.0, 1.5, 'mathieu.pidoux', 'fabio.russo', 23, 21, 'n'),
    ('26-103', 'Note de prédimensionnement — liaison avec l''existant', 3.0, 0.0, 'mathieu.pidoux', null, 25, 25, 'n'),
    ('26-104', 'Note de calcul — niveau -2', 2.5, 0.0, 'jeremie.brodard', null, 0, 0, 'r'),
    ('26-104', 'Plans de coffrage — radier', 1.0, 1.5, 'jeremie.brodard', 'romain.tissot', 1, -3, 'n'),
    ('26-104', 'Contrôle de la note de calcul du radier', 1.0, 0.0, 'laurent.mercier', null, 8, 8, 'n'),
    ('26-104', 'Plans d''armature — paroi berlinoise', 1.5, 3.5, 'jeremie.brodard', 'romain.tissot', 15, 9, 'w'),
    ('26-104', 'Plans de coffrage — niveau -2', 1.0, 3.0, 'nicolas.perroud', 'steve.monney', 18, 15, 'n'),
    ('26-104', 'Détails constructifs — paroi berlinoise', 0.5, 1.5, 'nicolas.perroud', 'romain.tissot', 21, 17, 'n'),
    ('26-104', 'Listes de fers — paroi berlinoise', 0.0, 0.5, null, 'romain.tissot', 22, 22, 'n'),
    ('26-104', 'Réservations CVSE — radier', 1.0, 1.0, 'nicolas.perroud', 'romain.tissot', 23, 22, 'n'),
    ('26-104', 'Plans d''armature — radier', 1.0, 2.5, 'nicolas.perroud', 'romain.tissot', 24, 21, 'n'),
    ('26-104', 'Note de calcul — rampe d''accès', 3.0, 0.0, 'nicolas.perroud', null, 25, 25, 'n'),
    ('26-105', 'Plans de coffrage — quais de chargement', 2.0, 2.5, 'adrien.chevalley', 'bruno.teixeira', 8, 3, 'n'),
    ('26-105', 'Note de calcul — fondations des cadres', 3.0, 0.0, 'jeremie.brodard', null, 15, 15, 'n'),
    ('26-105', 'Plans d''armature — dalle industrielle', 2.0, 2.5, 'jeremie.brodard', 'justine.rouiller', 15, 8, 'n'),
    ('26-105', 'Vérification de la mezzanine pour un rayonnage lourd', 2.0, 0.0, null, null, 18, 18, 'n'),
    ('26-105', 'Détails constructifs — dalle industrielle', 0.5, 1.0, 'jeremie.brodard', 'justine.rouiller', 22, 18, 'n'),
    ('26-105', 'Plans d''armature — quais de chargement', 1.0, 2.5, 'adrien.chevalley', 'bruno.teixeira', 22, 17, 'n'),
    ('26-105', 'Plans de coffrage — fondations des cadres', 1.5, 1.5, 'jeremie.brodard', 'justine.rouiller', 22, 17, 'n'),
    ('26-105', 'Détails constructifs — quais de chargement', 0.5, 2.0, 'adrien.chevalley', 'bruno.teixeira', 25, 23, 'w'),
    ('26-105', 'Note de calcul — fosses', 3.0, 0.0, 'jeremie.brodard', null, 25, 25, 'n'),
    ('26-105', 'Réservations CVSE — fondations des cadres', 0.5, 1.0, 'adrien.chevalley', 'justine.rouiller', 25, 23, 'n'),
    ('26-106', 'Plans de principe — culées', 1.5, 1.5, 'sofia.marques', 'laetitia.mottier', 7, 3, 'n'),
    ('26-106', 'Plans de principe — tablier', 2.0, 2.0, 'olivier.berthoud', 'laetitia.mottier', 9, 4, 'n'),
    ('26-106', 'Descente de charges — variantes', 1.5, 0.0, 'olivier.berthoud', null, 16, 16, 'n'),
    ('26-106', 'Modèle BIM — tablier', 1.0, 3.5, 'olivier.berthoud', 'laetitia.mottier', 16, 9, 'n'),
    ('26-106', 'Modèle BIM — culées', 1.0, 2.0, 'sofia.marques', 'laetitia.mottier', 23, 18, 'n'),
    ('26-106', 'Plans de principe — garde-corps', 1.5, 2.0, 'olivier.berthoud', 'laetitia.mottier', 23, 18, 'n'),
    ('26-106', 'Modèle BIM — garde-corps', 1.5, 2.5, 'sofia.marques', 'laetitia.mottier', 25, 21, 'n'),
    ('26-106', 'Note de prédimensionnement — variantes', 2.0, 0.0, 'olivier.berthoud', null, 25, 25, 'n'),
    ('26-107', 'Plans de principe — sous-sol', 1.0, 2.5, 'camille.rossier', 'nadia.haddad', 8, 3, 'n'),
    ('26-107', 'Note de prédimensionnement — dalle sur rez', 3.0, 0.0, 'camille.rossier', null, 10, 10, 'n'),
    ('26-107', 'Note de prédimensionnement — étages', 2.5, 0.0, 'mathieu.pidoux', null, 10, 10, 'n'),
    ('26-107', 'Métré estimatif pour le devis général', 0.0, 1.5, null, null, 16, 16, 'n'),
    ('26-107', 'Plans de principe — étages', 1.0, 2.5, 'camille.rossier', 'manon.deriaz', 18, 15, 'n'),
    ('26-107', 'Modèle BIM — sous-sol', 0.5, 3.0, 'camille.rossier', 'nadia.haddad', 21, 16, 'n'),
    ('26-107', 'Plans de principe — dalle sur rez', 2.0, 2.5, 'camille.rossier', 'manon.deriaz', 21, 16, 'n'),
    ('26-107', 'Modèle BIM — dalle sur rez', 1.0, 2.0, 'camille.rossier', 'manon.deriaz', 23, 21, 'n'),
    ('26-107', 'Note de prédimensionnement — liaison avec l''existant', 2.5, 0.0, 'camille.rossier', null, 23, 23, 'n'),
    ('26-107', 'Plans de présentation — dalle sur rez', 0.0, 1.0, null, 'nadia.haddad', 24, 24, 'n'),
    ('26-107', 'Plans de présentation — sous-sol', 0.0, 2.0, null, 'manon.deriaz', 25, 25, 'n'),
    ('26-108', 'Note de calcul — fondations', 1.5, 0.0, 'lea.cattin', null, 0, 0, 'r'),
    ('26-108', 'Plans de coffrage — voiles des étages', 1.5, 1.5, 'thomas.jaquet', 'yannick.pasquier', 1, -3, 'n'),
    ('26-108', 'Réservations CVSE — voiles des étages', 0.5, 1.0, 'thomas.jaquet', 'yannick.pasquier', 8, 7, 'n'),
    ('26-108', 'Plans d''exécution — renforts métalliques du rez', 1.0, 3.0, 'thomas.jaquet', 'yannick.pasquier', 10, 7, 'n'),
    ('26-108', 'Plans de coffrage — ancrages des dalles', 1.0, 2.5, 'lea.cattin', 'celine.burnier', 10, 7, 'n'),
    ('26-108', 'Plans de coffrage — fondations', 1.0, 2.0, 'lea.cattin', 'yannick.pasquier', 10, 8, 'n'),
    ('26-108', 'Revue du concept parasismique', 1.0, 0.0, 'claire.dufour', null, 11, 11, 'n'),
    ('26-108', 'Plans d''armature — voiles des étages', 2.0, 2.5, 'thomas.jaquet', 'yannick.pasquier', 21, 16, 'n'),
    ('26-108', 'Plans d''armature — voiles du rez', 1.5, 2.5, 'thomas.jaquet', 'celine.burnier', 21, 9, 'n'),
    ('26-108', 'Note de calcul — cage d''ascenseur', 3.0, 0.0, 'thomas.jaquet', null, 22, 22, 'n'),
    ('26-108', 'Détails constructifs — voiles du rez', 1.0, 2.0, 'thomas.jaquet', 'yannick.pasquier', 25, 23, 'n'),
    ('26-109', 'Note de calcul — escaliers', 2.0, 0.0, 'adrien.chevalley', null, 9, 9, 'n'),
    ('26-109', 'Plans de coffrage — murs du sous-sol', 2.0, 3.0, 'aurelie.fontannaz', 'fabio.russo', 10, 7, 'n'),
    ('26-109', 'Note de calcul — dalles', 2.5, 0.0, 'aurelie.fontannaz', null, 14, 14, 'n'),
    ('26-109', 'Plans d''armature — radiers', 2.5, 2.0, 'adrien.chevalley', 'fabio.russo', 17, 15, 'n'),
    ('26-109', 'Plans de coffrage — dalles', 1.0, 2.5, 'aurelie.fontannaz', 'fabio.russo', 21, 16, 'w'),
    ('26-109', 'Réservations CVSE — murs du sous-sol', 0.5, 1.0, 'aurelie.fontannaz', 'fabio.russo', 24, 23, 'n'),
    ('26-109', 'Plans d''armature — dalles', 1.0, 3.5, 'aurelie.fontannaz', 'justine.rouiller', 25, 17, 'n'),
    ('26-109', 'Plans d''armature — murs du sous-sol', 2.0, 3.5, 'aurelie.fontannaz', 'fabio.russo', 25, 21, 'n'),
    ('26-110', 'Descente de charges — fondations', 1.0, 0.0, 'nicolas.perroud', null, 2, 2, 'n'),
    ('26-110', 'Séance maître d''ouvrage — variantes de la tribune', 0.5, 0.0, 'laurent.mercier', null, 3, 3, 'n'),
    ('26-110', 'Plans de principe — gradins préfabriqués', 1.5, 3.0, 'nicolas.perroud', 'steve.monney', 4, 1, 'n'),
    ('26-110', 'Note de prédimensionnement — porte-à-faux de la toiture', 3.0, 0.0, 'nicolas.perroud', null, 8, 8, 'n'),
    ('26-110', 'Note de prédimensionnement — vestiaires', 2.5, 0.0, 'olivier.berthoud', null, 11, 11, 'n'),
    ('26-110', 'Plans pour la demande d''autorisation — gradins préfabriqués', 0.0, 1.5, null, 'steve.monney', 11, 11, 'n'),
    ('26-110', 'Plans de principe — porte-à-faux de la toiture', 1.5, 2.5, 'nicolas.perroud', 'bruno.teixeira', 15, 10, 'n'),
    ('26-110', 'Plans de principe — vestiaires', 1.5, 2.5, 'nicolas.perroud', 'steve.monney', 17, 14, 'n'),
    ('26-110', 'Plans de principe — fondations', 1.5, 1.5, 'nicolas.perroud', 'steve.monney', 18, 16, 'n'),
    ('26-110', 'Plans pour la demande d''autorisation — fondations', 0.0, 1.0, null, 'steve.monney', 21, 21, 'n'),
    ('26-110', 'Plans pour la demande d''autorisation — vestiaires', 0.0, 2.0, null, null, 24, 24, 'n')
  ), t as (
    select v.*, date_trunc('week', current_date)::date + v.e  as ech,
                date_trunc('week', current_date)::date + v.fi as fin_calc
    from v
  ), s as (
    select t.*,
      case
        when p = 'w' then 'attente'
        when ech < current_date and p <> 'r' then 'termine'
        when p = 'r' or ech < current_date + 5
             or (ci > 0 and cd > 0 and ing is not null and fin_calc < current_date) then 'en_cours'
        else 'a_faire'
      end as statut
    from t
  )
  insert into public.taches (bureau_id, affaire_id, titre, note, charge_inge, charge_dessin, echeance,
                             ingenieur_id, dessinateur_id, statut, avancement,
                             fini_inge, fini_dessin, enchaine)
  select p_bureau, a.id, s.titre,
         case s.p when 'w' then 'En attente des plans de l''architecte (indice C).'
                  when 'r' then 'Remarques du contrôleur à intégrer avant envoi.'
                  else '' end,
         s.ci, s.cd, s.ech, i.id, d.id, s.statut,
         case s.statut
           when 'termine'  then 100
           when 'en_cours' then case when s.p = 'r' then 80
                                     else greatest(10, least(90, 90 - (s.ech - current_date) * 10)) / 5 * 5 end
           else 0 end,
         s.ci > 0 and (s.statut = 'termine' or (s.cd > 0 and s.ing is not null and s.fin_calc < current_date)),
         s.cd > 0 and s.statut = 'termine',
         s.ci > 0 and s.cd > 0
  from s
  join public.affaires a on a.code = s.code and a.bureau_id = p_bureau
  left join public.membres i on i.email = s.ing || '@demo.exemple.ch' and i.bureau_id = a.bureau_id
  left join public.membres d on d.email = s.des || '@demo.exemple.ch' and d.bureau_id = a.bureau_id;

  -- ------------------------------------------------------- équipes d'affaire
  -- Tous ceux qui ont une tâche sur l'affaire
  insert into public.affaire_membres (bureau_id, affaire_id, membre_id)
  select distinct p_bureau, t.affaire_id, x.membre_id
  from public.taches t
  join public.affaires a on a.id = t.affaire_id
  cross join lateral (values (t.ingenieur_id), (t.dessinateur_id)) as x(membre_id)
  where a.bureau_id = p_bureau
    and a.note like '[démo]%'
    and x.membre_id is not null
  on conflict do nothing;
end $$;
revoke execute on function public.remplit_demo(uuid) from public, anon, authenticated;
