-- ============================================================================
--  Planification — JEU DE DÉMONSTRATION POUR LES ADMINISTRATEURS
-- ----------------------------------------------------------------------------
--  À coller dans Supabase : SQL Editor > New query > Run. Une seule fois.
--
--  Charge dans le bureau AB Ingénieurs, sur ses VRAIS membres actifs, des
--  données fictives sur quatre semaines (semaine en cours + trois suivantes) :
--    - 20 affaires 26-801 … 26-817 et trois appels d'offres AO-2026-91 … 93
--      (phases SIA variées, une affaire suspendue, AO public / privé / gagné) ;
--    - environ 90 tâches réparties sur les ingénieurs et les dessinateurs
--      selon leur capacité réelle (charge déjà planifiée comprise) : priorités,
--      retards, tâches en attente, parts enchaînées, tâches « à affecter »,
--      quelques surcharges et quelques personnes disponibles ;
--    - cinq affaires qui mêlent des personnes de succursales différentes ;
--    - des absences (vacances, formation, service militaire, congé le jour J),
--      des demandes de congé (trois à valider, une acceptée, une refusée) ;
--    - l'agenda interne (dont la démonstration elle-même), l'agenda des AO,
--      des avis à l'heure près, six fiches d'annuaire (demandeurs des AO…).
--  Les personnes ne sont jamais nommées ici : le script les lit dans la base.
--  Le tchat n'est pas rempli : on n'écrit pas de messages au nom de collègues.
--
--  Jour J : le mercredi de la semaine en cours (ou aujourd'hui, si on est
--  déjà plus tard dans la semaine ; lancé un week-end, la semaine suivante).
--  Les statuts des tâches (terminée, en cours, en retard) sont calés dessus.
--
--  Tout ce qui est créé est noté dans le schéma privé demo_admins (invisible
--  depuis l'outil) : purge-demo-admins.sql retire exactement ces lignes, et
--  ce qui en découle (tâches, équipes, agenda des AO, absences nées d'un congé
--  accepté pendant la démo). Les données réelles ne sont pas touchées.
-- ============================================================================

begin;

create schema if not exists demo_admins;
revoke all on schema demo_admins from public;
create table if not exists demo_admins.traces (
  tab text not null,
  id  uuid not null,
  primary key (tab, id)
);
revoke all on demo_admins.traces from public;

-- Recule d'un nombre de jours ouvrés (samedi et dimanche sautés)
create or replace function pg_temp.recule(p_jour date, p_n int)
returns date language plpgsql immutable as $f$
declare d date := p_jour; n int := p_n;
begin
  while n > 0 loop
    d := d - 1;
    if extract(isodow from d) < 6 then n := n - 1; end if;
  end loop;
  return d;
end $f$;

-- Un samedi ou un dimanche est ramené au vendredi
create or replace function pg_temp.ouvre(p_jour date)
returns date language sql immutable as $f$
  select p_jour - case extract(isodow from p_jour)::int when 6 then 1 when 7 then 2 else 0 end;
$f$;

do $$
declare
  -- Nom exact du bureau, si la recherche automatique (« AB … Ingénieurs ») échoue
  v_nom_bureau text := '';

  v_b      uuid;
  v_lundi  date;
  v_j      date;           -- jour de la démonstration
  v_oj     int;            -- son décalage depuis le lundi
  v_n      int;
  v_disc1  text;           -- discipline principale (Structure, en général)
  v_disc2  text;           -- une autre discipline, pour les AO transversaux
  v_nomd1  text;
  v_f_i    numeric;        -- mise à l'échelle des charges, ingénieurs
  v_f_d    numeric;        -- … et dessinateurs
  v_cpt    int;
  r        record;
  t        record;
  v_ing    uuid;
  v_des    uuid;
  v_abs    uuid;
  v_cg     uuid;
  v_admin  uuid;           -- un administrateur, pour les congés déjà décidés
  v_admins uuid[];
begin
  -- ---------------------------------------------------------------- bureau
  if exists (select 1 from demo_admins.traces) then
    raise exception 'Le jeu de démonstration est déjà chargé. Lance d''abord purge-demo-admins.sql.';
  end if;

  if btrim(v_nom_bureau) <> '' then
    select b.id into v_b from public.bureaux b where lower(btrim(b.nom)) = lower(btrim(v_nom_bureau));
  else
    select count(*), min(b.id::text)::uuid into v_n, v_b
      from public.bureaux b
     where translate(lower(b.nom), 'éèêëàâäîïôöûüç', 'eeeeaaaiioouuc') ~ '\mab\M.*ingenieur';
    if v_n <> 1 then
      raise exception 'Bureau AB introuvable ou ambigu (% trouvés) : écris son nom exact dans v_nom_bureau, en tête du bloc.', v_n;
    end if;
  end if;
  if v_b is null then
    raise exception 'Bureau introuvable : vérifie v_nom_bureau.';
  end if;

  if exists (select 1 from public.affaires a
              where a.bureau_id = v_b
                and (a.code between '26-801' and '26-817' or a.code in ('AO-2026-91', 'AO-2026-92', 'AO-2026-93'))) then
    raise exception 'Une affaire 26-801 … 26-817 ou AO-2026-91 … 93 existe déjà dans ce bureau : codes à changer dans le script.';
  end if;

  -- ----------------------------------------------------------------- dates
  v_lundi := date_trunc('week', current_date)::date;
  if extract(isodow from current_date) >= 6 then
    v_lundi := v_lundi + 7;
  end if;
  v_j  := greatest(current_date, v_lundi + 2);
  v_oj := v_j - v_lundi;

  -- ------------------------------------------------------------ disciplines
  select d.code, d.nom into v_disc1, v_nomd1
    from public.disciplines d
   where d.bureau_id = v_b and d.nom !~* '^administr'
   order by (d.nom ~* '^structure') desc, d.ordre, d.nom
   limit 1;
  select d.code into v_disc2
    from public.disciplines d
   where d.bureau_id = v_b and d.nom !~* '^administr' and d.code is distinct from v_disc1
   order by d.ordre, d.nom
   limit 1;

  -- ---------------------------------------------------------------- membres
  -- Ceux qui portent des tâches : ingénieurs et dessinateurs actifs. rang :
  -- leur place dans leur métier, par succursale puis prénom ; cible : la part
  -- de leur capacité que le jeu cherche à remplir (des pleins, des surchargés,
  -- des disponibles ; les associés, peu : contrôles et séances surtout).
  create temp table _m on commit drop as
  select m.id, m.metier, coalesce(m.succursale, '') as succ, coalesce(m.discipline, '') as disc,
         m.capacite, 'administrateur' = any (m.statuts) as admin,
         'chef_projet' = any (m.statuts) as chef_projet,
         'chef_secteur' = any (m.statuts) as chef_secteur,
         row_number() over (partition by m.metier order by m.succursale nulls last, m.prenom, m.nom)::int as rang,
         m.capacite * 4 as cap,
         0::numeric as charge,
         0::numeric as cible
    from public.membres m
   where m.bureau_id = v_b and m.actif and m.metier in ('ingenieur', 'dessinateur');

  if (select count(*) from _m where metier = 'ingenieur') = 0
     or (select count(*) from _m where metier = 'dessinateur') = 0 then
    raise exception 'Il faut au moins un ingénieur et un dessinateur actifs dans le bureau.';
  end if;

  update _m set cible = case
    when admin then 0.35
    else (array[0.85, 1.15, 0.70, 0.90, 0.55, 0.95, 1.10, 0.80])[((rang - 1) % 8) + 1] end;

  v_admins := array(select m.id from public.membres m
                     where m.bureau_id = v_b and m.actif and 'administrateur' = any (m.statuts)
                     order by m.prenom, m.nom);
  v_admin := v_admins[1];

  -- --------------------------------------------------------------- absences
  -- d1, d2 : jours depuis le lundi ; qui : métier et rang (ignoré si absent)
  create temp table _abs on commit drop as
  select * from (values
    ('ingenieur',   2,  7, 11, 'Vacances',          true),   -- née d'une demande acceptée
    ('dessinateur', 3, 14, 25, 'Vacances',          false),
    ('ingenieur',   5,  9, 10, 'Formation',         false),
    ('dessinateur', 1, 21, 25, 'Service militaire', false),
    ('dessinateur', 5, -1, -1, 'Congé',             false),   -- le jour J (-1 : remplacé plus bas)
    ('ingenieur',   7, 17, 18, 'Vacances',          false)
  ) as v(metier, rang, d1, d2, motif, via_conge);

  for r in select a.*, m.id as membre_id
             from _abs a join _m m on m.metier = a.metier and m.rang = a.rang and not m.admin loop
    insert into public.absences (bureau_id, membre_id, debut, fin, motif)
    values (v_b, r.membre_id,
            case when r.d1 < 0 then v_j else v_lundi + r.d1 end,
            case when r.d2 < 0 then v_j else v_lundi + r.d2 end,
            r.motif)
    returning id into v_abs;
    insert into demo_admins.traces values ('absences', v_abs);

    if r.via_conge then
      insert into public.conges (bureau_id, membre_id, debut, fin, motif, commentaire, statut,
                                 valide_par, valide_le, reponse, absence_id, cree_le)
      values (v_b, r.membre_id, v_lundi + r.d1, v_lundi + r.d2, 'Vacances', 'Vacances d''automne.',
              'acceptee', v_admin, now() - interval '9 days', 'Bonnes vacances !', v_abs, now() - interval '12 days')
      returning id into v_cg;
      insert into demo_admins.traces values ('conges', v_cg);
    end if;

    -- La capacité sur les quatre semaines baisse d'autant
    update _m set cap = greatest(0, cap - _m.capacite / 5.0 * (
             select count(*) from generate_series(greatest(case when r.d1 < 0 then v_j else v_lundi + r.d1 end, v_lundi),
                                                  least(case when r.d2 < 0 then v_j else v_lundi + r.d2 end, v_lundi + 25),
                                                  interval '1 day') g
              where extract(isodow from g) < 6))
     where _m.id = r.membre_id;
  end loop;

  -- ------------------------------------------------------ demandes de congé
  -- Trois à valider pendant la démonstration, une refusée
  for r in select v.*, m.id as membre_id
             from (values
               ('ingenieur',   4, 28, 32, 'Vacances',     'Semaine de vacances en famille.',             'en_attente', ''),
               ('dessinateur', 2, 18, 18, 'Récupération', 'Heures supplémentaires du dernier rendu.',     'en_attente', ''),
               ('dessinateur', 6, 23, 24, 'Formation',    'Cours d''armature dans Revit.',                'en_attente', ''),
               ('dessinateur', 4, 10, 11, 'Vacances',     'Pont prolongé.',                                'refusee',
                'Rendu des plans de soumission ces jours-là : on en reparle pour la semaine suivante ?')
             ) as v(metier, rang, d1, d2, motif, commentaire, statut, reponse)
             join _m m on m.metier = v.metier and m.rang = v.rang and not m.admin loop
    insert into public.conges (bureau_id, membre_id, debut, fin, motif, commentaire, statut,
                               valide_par, valide_le, reponse, cree_le)
    values (v_b, r.membre_id, v_lundi + r.d1, v_lundi + r.d2, r.motif, r.commentaire, r.statut,
            case when r.statut = 'refusee' then v_admin end,
            case when r.statut = 'refusee' then now() - interval '2 days' end,
            r.reponse, now() - interval '3 days')
    returning id into v_cg;
    insert into demo_admins.traces values ('conges', v_cg);
  end loop;

  -- ---------------------------------------------------- charge déjà prévue
  -- Les tâches réelles ouvertes sur les quatre semaines comptent : le jeu
  -- complète la charge de chacun, il ne l'empile pas à l'aveugle.
  update _m set charge = coalesce((
    select sum(case when x.ingenieur_id = _m.id and not x.fini_inge then x.charge_inge else 0 end
             + case when x.dessinateur_id = _m.id and not x.fini_dessin then x.charge_dessin else 0 end)
      from public.taches x
     where x.bureau_id = v_b and x.statut <> 'termine'
       and x.echeance between v_lundi and v_lundi + 25
       and (x.ingenieur_id = _m.id or x.dessinateur_id = _m.id)), 0);

  -- ------------------------------------------------------------- annuaire
  create temp table _c (cle text primary key, id uuid) on commit drop;
  for r in select * from (values
    ('hautlac',  'Jaccoud',   'Martine',     'Office intercommunal des écoles du Haut-Lac', 'Maître d''ouvrage public — cheffe de projet',
                 'Rue du Collège 4', '1815', 'Clarens', 'VD', 'm.jaccoud@haut-lac.example.ch', 'Appel d''offres du groupe scolaire.'),
    ('grandpre', 'Rochat',    'Pierre-Alain','Coopérative d''habitation Le Grand Pré',      'Maître d''ouvrage — président',
                 'Chemin du Grand-Pré 2', '1213', 'Onex', 'GE', 'pa.rochat@grandpre.example.ch', ''),
    ('glycines', 'Favre',     'Isabelle',    'Fondation Les Glycines',                      'Maître d''ouvrage — directrice',
                 'Avenue des Glycines 11', '1110', 'Morges', 'VD', 'direction@glycines.example.ch', 'Mandat gagné : rénovation de l''EMS.'),
    ('archi',    'Delacrétaz','Julien',      'Delacrétaz & Monnet architectes',             'Architecte',
                 'Rue de Lausanne 64', '1202', 'Genève', 'GE', 'j.delacretaz@dm-archi.example.ch', 'Architecte des Marronniers et de la rue de Lyon.'),
    ('entreprise','Bersier',  'Marc',        'Bersier Génie Civil SA',                      'Entreprise de gros œuvre — conducteur de travaux',
                 'Route de Meyrin 210', '1217', 'Meyrin', 'GE', 'm.bersier@bersier-gc.example.ch', ''),
    ('geotech',  'Zufferey',  'Nathalie',    'GéoTerrain Conseils Sàrl',                    'Géotechnicienne',
                 'Avenue de la Gare 25', '1950', 'Sion', 'VS', 'n.zufferey@geoterrain.example.ch', 'Rapport géotechnique du parking de la Gare.')
  ) as v(cle, nom, prenom, societe, role, adresse, npa, localite, canton, email, obs) loop
    insert into public.contacts (bureau_id, nom, prenom, societe, role, adresse, npa, localite, canton, pays, email, observations)
    values (v_b, r.nom, r.prenom, r.societe, r.role, r.adresse, r.npa, r.localite, r.canton, 'Suisse', r.email, r.obs)
    returning id into v_ing;
    insert into _c values (r.cle, v_ing);
    insert into demo_admins.traces values ('contacts', v_ing);
  end loop;

  -- ------------------------------------------------------------- affaires
  -- k : ordre ; mixte : ingénieurs et dessinateurs de succursales différentes ;
  -- dec : échéance de l'affaire, en jours depuis le lundi (AO : la remise).
  -- Rues réelles, numéros et projets inventés.
  create temp table _a on commit drop as
  select v.*, ''::text as succ, ''::text as disc, null::uuid as id
    from (values
    ( 1, '26-801', 'Immeuble de logements Les Marronniers', 'Deux sous-sols, rez et cinq étages. Exécution en cours, dalles d''étage.', '52', 'Route de Chêne 85, 1224 Chêne-Bougeries', 'active', 210, false, null::text),
    ( 2, '26-802', 'Surélévation bois-béton, rue de Lyon', 'Deux niveaux en bois sur dalle mixte, immeuble des années 1960.', '51', 'Rue de Lyon 74, 1203 Genève', 'active', 140, false, null),
    ( 3, '26-803', 'École primaire de Tivoli — agrandissement', 'Salle de gymnastique semi-enterrée et préau couvert.', '32', 'Avenue de Tivoli 30, 1007 Lausanne', 'active', 280, false, null),
    ( 4, '26-804', 'Parking souterrain de la Gare', 'Deux niveaux, paroi moulée, nappe phréatique haute.', '51', 'Avenue de la Gare 40, 1950 Sion', 'active', 190, true, null),
    ( 5, '26-805', 'Halle artisanale des Acacias', 'Halle de 3 500 m², dalle industrielle, charpente métallique.', '52', 'Route des Acacias 50, 1227 Les Acacias', 'active', 90, false, null),
    ( 6, '26-806', 'Passerelle piétonne sur la Vièze', 'Passerelle de 38 m : trois variantes à comparer (acier, bois, béton).', '31', 'Avenue de la Gare 15, 1870 Monthey', 'active', 120, true, null),
    ( 7, '26-807', 'EMS de Beaulieu — extension', 'Extension de trente-six lits, liaison avec le bâtiment existant.', '33', 'Avenue de Beaulieu 12, 1004 Lausanne', 'active', 330, false, null),
    ( 8, '26-808', 'Immeuble rue de Monthoux — renforcement parasismique', 'Voiles du rez et fondations à renforcer ; soumissions en cours.', '41', 'Rue de Monthoux 33, 1201 Genève', 'active', 160, false, null),
    ( 9, '26-809', 'Villas mitoyennes Le Clos', 'Quatre villas sur sous-sol commun.', '52', 'Route de Genève 120, 1260 Nyon', 'active', 75, false, null),
    (10, '26-810', 'Centre sportif — tribune couverte', 'Tribune de 900 places, gradins préfabriqués, toiture en porte-à-faux.', '32', 'Avenue du Grand-Saint-Bernard 60, 1920 Martigny', 'active', 300, true, null),
    (11, '26-811', 'Pont routier — remise en état', 'Pont en béton armé de 1958 : inspection, recalcul, remise en état.', '31', 'Route du Simplon 12, 1890 Saint-Maurice', 'active', 150, false, null),
    (12, '26-812', 'Immeuble administratif Rumine — transformation', 'Nouvelles ouvertures dans les voiles, nouvelle cage d''ascenseur.', '51', 'Avenue de Rumine 20, 1005 Lausanne', 'active', 130, false, null),
    (13, '26-813', 'Bâtiment mixte Les Deux-Ponts', 'Commerces au rez, logements, porte-à-faux sur rue.', '33', 'Rue des Deux-Ponts 18, 1205 Genève', 'active', 260, false, null),
    (14, '26-814', 'Mur de soutènement — route de Suisse', 'Mur en L de 60 m, ancrages, drainage.', '51', 'Route de Suisse 90, 1290 Versoix', 'active', 45, false, null),
    (15, '26-815', 'Crèche de Cortot — étude de faisabilité', 'Structure bois sur deux niveaux, sous-sol partiel.', '21', 'Avenue Alfred-Cortot 10, 1260 Nyon', 'active', 60, false, null),
    (16, '26-816', 'Bassin de rétention de Meyrin', 'Bassin enterré de 2 400 m³, ouvrage étanche.', '52', 'Route de Meyrin 300, 1217 Meyrin', 'active', 110, true, null),
    (17, '26-817', 'Immeuble de logements Le Rhône', 'En attente du permis de construire.', '32', 'Avenue de France 60, 1004 Lausanne', 'suspendue', null, false, null),
    (18, 'AO-2026-91', 'Groupe scolaire du Haut-Lac — mandat d''ingénieur civil', 'Procédure ouverte. Seize classes, salle triple, parking souterrain.', 'AO', 'Rue du Collège 4, 1815 Clarens', 'active', 16, true, 'hautlac'),
    (19, 'AO-2026-92', 'Coopérative Le Grand Pré — soixante logements', 'Invitation privée, variante bois-béton demandée.', 'AO', 'Chemin du Grand-Pré 2, 1213 Onex', 'active', 24, false, 'grandpre'),
    (20, 'AO-2026-93', 'Fondation Les Glycines — rénovation de l''EMS', 'Offre gagnée : phase SIA à donner au démarrage.', 'AO', 'Avenue des Glycines 11, 1110 Morges', 'active', 200, false, 'glycines')
  ) as v(k, code, nom, note, phase, adresse, statut, dec, mixte, demandeur);

  -- Succursale et discipline de chaque affaire : celles d'un ingénieur pris à
  -- tour de rôle (hors associés), pour que chaque succursale ait ses affaires.
  select count(*) into v_n from _m where metier = 'ingenieur' and not admin;
  if v_n = 0 then
    select count(*) into v_n from _m where metier = 'ingenieur';
    update _a set succ = m.succ, disc = m.disc
      from _m m where m.metier = 'ingenieur' and m.rang = ((_a.k * 3 - 1) % v_n) + 1;
  else
    update _a set succ = x.succ, disc = x.disc
      from (select m.succ, m.disc, row_number() over (order by m.rang) as n
              from _m m where m.metier = 'ingenieur' and not m.admin) x
     where x.n = ((_a.k * 3 - 1) % v_n) + 1;
  end if;
  update _a set disc = coalesce(v_disc1, '') where disc = '';

  for r in select * from _a order by k loop
    insert into public.affaires (bureau_id, code, nom, note, teinte, phase, adresse, statut, echeance,
                                 ao_type, demandeur_id, ao_resultat, ao_montant, secteurs)
    values (v_b, r.code, r.nom, r.note, ((r.k - 1) % 8) + 1, r.phase, r.adresse, r.statut,
            case when r.dec is null then null else pg_temp.ouvre(v_lundi + r.dec) end,
            case r.code when 'AO-2026-91' then 'public' when 'AO-2026-92' then 'prive' when 'AO-2026-93' then 'prive' end,
            (select c.id from _c c where c.cle = r.demandeur),
            case r.code when 'AO-2026-93' then 'gagne' when 'AO-2026-91' then 'en_cours' when 'AO-2026-92' then 'en_cours' end,
            case r.code when 'AO-2026-91' then 480000 when 'AO-2026-92' then 320000 when 'AO-2026-93' then 210000 end,
            case when r.phase = 'AO' then
                   array(select distinct x from unnest(array[nullif(r.disc, ''),
                          case when r.mixte then v_disc2 end]) as x where x is not null)
                 else '{}' end)
    returning id into v_ing;
    update _a set id = v_ing where k = r.k;
    insert into demo_admins.traces values ('affaires', v_ing);
  end loop;

  -- ------------------------------------------------------------------ tâches
  -- e : échéance en jours depuis le lundi (négatif : semaine passée) ;
  -- g : n normal, r en retard (reste en cours), w en attente,
  --     x à affecter (personne), xd dessin à affecter ; a : contrôle ou séance,
  --     confié de préférence à un associé ou à un chef de projet ;
  -- p : priorité (1 la plus forte, 5 par défaut).
  create temp table _t on commit drop as
  select v.*, row_number() over ()::int as n
    from (values
    ('26-801', 'Plans d''armature — dalle sur 2e étage',               1.0, 3.0,  1, 'n', 2, ''),
    ('26-801', 'Listes de fers — dalle sur 2e étage',                  0.0, 1.0, -3, 'n', 5, ''),
    ('26-801', 'Contrôle des plans d''armature — cage d''escalier',    1.0, 0.0, -1, 'ra',1, 'Remarques de l''entreprise à intégrer avant envoi.'),
    ('26-801', 'Réception d''armature — dalle sur 2e étage',           0.5, 0.0,  3, 'n', 3, ''),
    ('26-801', 'Plans de coffrage — dalle sur 3e étage',               1.0, 3.0,  8, 'n', 3, ''),
    ('26-801', 'Plans d''armature — dalle sur 3e étage',               1.5, 3.5, 15, 'n', 3, ''),
    ('26-801', 'Plans de coffrage — attique',                          1.0, 3.0, 22, 'n', 4, ''),
    ('26-802', 'Note de calcul — dalle mixte bois-béton',              3.0, 0.0,  2, 'n', 1, ''),
    ('26-802', 'Plans d''exécution — appuis sur l''existant',          1.0, 3.0,  9, 'n', 2, ''),
    ('26-802', 'Coordination avec le charpentier',                     1.0, 0.0, 11, 'w', 3, 'En attente des plans d''atelier du charpentier.'),
    ('26-802', 'Détails des connecteurs bois-béton',                   0.5, 2.0, 16, 'n', 4, ''),
    ('26-802', 'Plans d''armature — renforcement des sommiers',        1.0, 3.0, 23, 'xd',5, ''),
    ('26-803', 'Descente de charges — préau couvert',                  1.5, 0.0, -2, 'n', 5, ''),
    ('26-803', 'Note de prédimensionnement — salle de gymnastique',    3.0, 0.0,  4, 'n', 2, ''),
    ('26-803', 'Plans de principe — salle de gymnastique',             1.0, 3.0, 11, 'n', 3, ''),
    ('26-803', 'Modèle BIM — liaison avec l''existant',                0.5, 3.0, 18, 'n', 4, ''),
    ('26-803', 'Estimation des quantités pour le devis',               1.0, 1.5, 25, 'n', 5, ''),
    ('26-804', 'Note de calcul — paroi moulée',                        4.0, 0.0,  1, 'n', 1, ''),
    ('26-804', 'Plans de coffrage — radier',                           1.0, 3.5,  8, 'n', 2, ''),
    ('26-804', 'Étude des sous-pressions et du lestage',               2.0, 0.0, 10, 'n', 3, 'Selon le rapport géotechnique de GéoTerrain.'),
    ('26-804', 'Plans d''armature — paroi moulée',                     1.5, 4.0, 15, 'n', 3, ''),
    ('26-804', 'Plans d''armature — radier',                           1.0, 4.0, 22, 'n', 4, ''),
    ('26-804', 'Réservations CVSE — niveau -1',                        0.5, 1.5, 25, 'x', 5, ''),
    ('26-805', 'Plans de joints et calepinage',                        0.5, 2.0, -4, 'n', 5, ''),
    ('26-805', 'Réception d''armature — dalle industrielle',           0.5, 0.0,  2, 'n', 2, ''),
    ('26-805', 'Plans d''armature — quais de chargement',              1.0, 2.5,  7, 'n', 3, ''),
    ('26-805', 'Détails des fosses',                                   0.5, 2.0, 14, 'n', 4, ''),
    ('26-805', 'Contrôle des plans d''atelier — charpente métallique', 1.5, 0.0, 18, 'a', 4, ''),
    ('26-806', 'Visuels pour la séance maître d''ouvrage',             0.0, 1.5,  3, 'n', 2, ''),
    ('26-806', 'Étude de trois variantes (acier, bois, béton)',        4.0, 1.0,  9, 'n', 2, ''),
    ('26-806', 'Modèle BIM — variante retenue',                        0.5, 3.0, 17, 'n', 3, ''),
    ('26-806', 'Note de prédimensionnement — culées',                  2.0, 0.0, 21, 'n', 4, ''),
    ('26-806', 'Estimation du coût de l''ouvrage',                     1.5, 0.0, 24, 'n', 5, ''),
    ('26-807', 'Plans pour la demande d''autorisation — sous-sol',     0.5, 2.5,  3, 'n', 1, ''),
    ('26-807', 'Rapport de sécurité parasismique (formulaire)',        1.5, 0.0,  8, 'n', 2, ''),
    ('26-807', 'Plans pour la demande d''autorisation — étages',       0.5, 3.0, 10, 'n', 2, ''),
    ('26-807', 'Coordination CVSE — percements',                       1.0, 1.0, 17, 'n', 4, ''),
    ('26-807', 'Plans de principe — fondations',                       1.0, 2.0, 24, 'n', 5, ''),
    ('26-808', 'Plans de soumission — voiles du rez',                  0.5, 3.0,  2, 'n', 2, ''),
    ('26-808', 'Descriptif et métré — renforcement des voiles',        2.0, 1.0,  4, 'n', 3, ''),
    ('26-808', 'Plans de soumission — fondations',                     0.5, 2.0,  9, 'n', 3, ''),
    ('26-808', 'Réponses aux questions des entreprises',               1.0, 0.0, 12, 'n', 3, ''),
    ('26-808', 'Comparatif des offres',                                2.0, 0.0, 22, 'a', 4, ''),
    ('26-809', 'Réception d''armature — radier',                       0.5, 0.0, -1, 'n', 5, ''),
    ('26-809', 'Plans d''armature — murs du sous-sol',                 1.0, 3.0,  2, 'n', 2, ''),
    ('26-809', 'Listes de fers — murs du sous-sol',                    0.0, 1.0,  4, 'x', 2, ''),
    ('26-809', 'Plans de coffrage — dalles sur rez',                   0.5, 2.5,  9, 'n', 3, ''),
    ('26-809', 'Plans d''armature — dalles sur rez',                   1.0, 2.5, 16, 'n', 4, ''),
    ('26-810', 'Séance maître d''ouvrage — variantes de la tribune',   0.5, 0.0,  2, 'a', 2, ''),
    ('26-810', 'Note de prédimensionnement — toiture en porte-à-faux', 3.0, 0.0,  5, 'n', 2, ''),
    ('26-810', 'Plans de principe — gradins préfabriqués',             1.0, 3.0, 12, 'n', 3, ''),
    ('26-810', 'Modèle BIM — tribune',                                 0.5, 3.0, 19, 'n', 4, ''),
    ('26-810', 'Plans de principe — vestiaires',                       1.0, 2.5, 25, 'n', 5, ''),
    ('26-811', 'Inspection et relevé des dégâts',                      2.0, 1.0, -2, 'n', 5, ''),
    ('26-811', 'Rapport d''état et recommandations',                   3.0, 0.0,  8, 'n', 2, ''),
    ('26-811', 'Recalcul de la capacité portante',                     3.0, 0.0, 15, 'n', 3, ''),
    ('26-811', 'Plans de principe — remise en état',                   0.5, 2.5, 22, 'n', 4, ''),
    ('26-812', 'Plans de démolition et d''étayage',                    1.0, 2.5, -1, 'r', 1, 'Remarques de l''entreprise de démolition à intégrer.'),
    ('26-812', 'Note de calcul — nouvelles ouvertures dans les voiles',2.0, 0.0,  4, 'n', 2, ''),
    ('26-812', 'Plans d''exécution — linteaux et renforts',            1.0, 3.0, 11, 'n', 3, ''),
    ('26-812', 'Réservations CVSE — dalles des étages',                0.5, 2.0, 18, 'n', 4, ''),
    ('26-812', 'Plans d''armature — nouvelle cage d''ascenseur',       1.0, 3.0, 25, 'n', 5, ''),
    ('26-813', 'Note de prédimensionnement — porte-à-faux sur rue',    2.5, 0.0, -3, 'n', 5, ''),
    ('26-813', 'Plans pour la demande d''autorisation',                0.5, 3.0,  4, 'n', 2, ''),
    ('26-813', 'Concept parasismique',                                 2.0, 0.0, 10, 'n', 3, ''),
    ('26-813', 'Plans de principe — sous-sol',                         0.5, 2.0, 17, 'n', 4, ''),
    ('26-814', 'Note de calcul — mur en L et ancrages',                2.0, 0.0,  3, 'n', 2, ''),
    ('26-814', 'Plans de coffrage et d''armature du mur',              0.5, 3.0, 10, 'n', 3, ''),
    ('26-814', 'Plans du drainage et des joints',                      0.0, 1.5, 15, 'x', 4, ''),
    ('26-814', 'Visite de réception de l''armature',                   0.5, 0.0, 18, 'n', 4, ''),
    ('26-815', 'Étude de faisabilité — structure bois',                3.0, 0.0,  8, 'n', 3, ''),
    ('26-815', 'Croquis de principe pour l''architecte',               0.5, 1.5, 11, 'n', 3, ''),
    ('26-815', 'Estimation des coûts (± 25 %)',                        1.0, 0.0, 15, 'n', 4, ''),
    ('26-816', 'Note de calcul — étanchéité et fissuration',           2.0, 0.0, -3, 'n', 5, ''),
    ('26-816', 'Plans d''armature — parois du bassin',                 1.5, 3.5,  3, 'n', 1, ''),
    ('26-816', 'Réception d''armature — parois',                       0.5, 0.0,  7, 'n', 2, ''),
    ('26-816', 'Plans d''armature — dalle de couverture',              1.0, 3.0, 10, 'n', 3, ''),
    ('26-816', 'Plans des réservations et pièces à sceller',           0.0, 2.0, 17, 'x', 4, ''),
    ('26-817', 'Note de prédimensionnement — dalles',                  2.0, 0.0, -5, 'n', 5, ''),
    ('26-817', 'Plans de principe — sous-sols',                        1.0, 3.0, 20, 'w', 5, 'Affaire suspendue : en attente du permis de construire.'),
    ('AO-2026-91', 'Analyse du cahier des charges',                    1.0, 0.0, -2, 'n', 5, ''),
    ('AO-2026-91', 'Prédimensionnement pour l''offre',                 2.0, 0.0,  8, 'n', 2, ''),
    ('AO-2026-91', 'Calcul des honoraires (SIA 103)',                  1.5, 0.0, 11, 'a', 1, ''),
    ('AO-2026-91', 'Références et CV de l''équipe',                    0.0, 1.0, 12, 'n', 3, 'Mise en page des références.'),
    ('AO-2026-91', 'Rédaction de l''offre',                            1.5, 0.5, 15, 'a', 1, 'Remise le lendemain, avant midi.'),
    ('AO-2026-92', 'Visite des lieux et relevé',                       1.0, 0.0,  4, 'n', 3, ''),
    ('AO-2026-92', 'Variante de structure bois-béton',                 2.0, 1.0, 16, 'n', 2, ''),
    ('AO-2026-92', 'Offre d''honoraires',                              1.0, 0.0, 23, 'a', 2, ''),
    ('AO-2026-93', 'Séance de lancement avec la fondation',            0.5, 0.0,  9, 'a', 2, ''),
    ('AO-2026-93', 'Planning des études',                              1.0, 0.0, 12, 'n', 3, ''),
    ('AO-2026-93', 'Relevé de l''existant',                            1.0, 2.0, 18, 'n', 4, '')
  ) as v(code, titre, ci, cd, e, g, p, note);

  alter table _t add column ech date, add column statut text, add column ing uuid, add column des uuid,
                 add column ci2 numeric, add column cd2 numeric;
  update _t set ech = pg_temp.ouvre(v_lundi + e);
  update _t set statut = case
      when g = 'w' then 'attente'
      when g in ('r', 'ra') then 'en_cours'
      when ech < v_j then 'termine'
      when ech < v_j + 5 then 'en_cours'
      else 'a_faire' end;

  -- Mise à l'échelle : la charge du jeu remplit la place qui reste dans
  -- l'équipe (cible de chacun moins sa charge réelle), dans des limites
  -- raisonnables — une petite équipe ne reçoit pas des tâches de trois jours
  -- de dessin multipliées par quatre.
  select greatest(0.6, least(2.0,
           greatest(1, (select sum(cap * cible - charge) from _m where metier = 'ingenieur' and not admin))
           / greatest(1, (select sum(ci) from _t where statut <> 'termine' and g not in ('x', 'a', 'ra')))))
    into v_f_i;
  select greatest(0.6, least(2.0,
           greatest(1, (select sum(cap * cible - charge) from _m where metier = 'dessinateur'))
           / greatest(1, (select sum(cd) from _t where statut <> 'termine' and g not in ('x', 'xd')))))
    into v_f_d;
  update _t set
    ci2 = case when ci = 0 then 0 when g in ('a', 'ra') then ci else greatest(0.5, round(ci * v_f_i * 2) / 2) end,
    cd2 = case when cd = 0 then 0 else greatest(0.5, round(cd * v_f_d * 2) / 2) end;

  -- Affectation : pour chaque part, la personne la moins chargée au regard de
  -- sa cible, de la succursale de l'affaire (d'une autre pour le dessin des
  -- affaires mixtes), de préférence déjà dans l'équipe et du même secteur.
  create temp table _eq (affaire text, membre uuid, primary key (affaire, membre)) on commit drop;

  for t in select _t.*, a.succ as a_succ, a.disc as a_disc, a.mixte
             from _t join _a a on a.code = _t.code
            order by _t.ech, _t.n loop
    v_ing := null; v_des := null;

    if t.ci > 0 and t.g <> 'x' then
      select m.id into v_ing
        from _m m
       where m.metier = 'ingenieur'
         and (case when t.g in ('a', 'ra') then (m.admin or m.chef_projet) else not m.admin end)
       order by
         case when t.g in ('a', 'ra') then 0
              when t.mixte and t.n % 2 = 0 then (m.succ = t.a_succ)::int
              else (m.succ <> t.a_succ)::int end,
         (m.charge + case when t.statut = 'termine' then 0 else t.ci2 end) / greatest(0.5, m.cap * m.cible)
           - case when exists (select 1 from _eq q where q.affaire = t.code and q.membre = m.id) then 0.35 else 0 end
           + case when m.disc <> '' and m.disc <> t.a_disc then 0.30 else 0 end,
         m.rang
       limit 1;
      if v_ing is null then   -- aucun candidat de ce profil : n'importe quel ingénieur
        select m.id into v_ing from _m m where m.metier = 'ingenieur'
         order by (m.charge + t.ci2) / greatest(0.5, m.cap * m.cible), m.rang limit 1;
      end if;
    end if;

    if t.cd > 0 and t.g not in ('x', 'xd') then
      select m.id into v_des
        from _m m
       where m.metier = 'dessinateur'
       order by
         case when t.mixte then (m.succ = t.a_succ)::int else (m.succ <> t.a_succ)::int end,
         (m.charge + case when t.statut = 'termine' then 0 else t.cd2 end) / greatest(0.5, m.cap * m.cible)
           - case when exists (select 1 from _eq q where q.affaire = t.code and q.membre = m.id) then 0.35 else 0 end
           + case when m.disc <> '' and m.disc <> t.a_disc then 0.30 else 0 end,
         m.rang
       limit 1;
    end if;

    update _t set ing = v_ing, des = v_des where n = t.n;
    if t.statut <> 'termine' then
      update _m set charge = charge + t.ci2 where id = v_ing;
      update _m set charge = charge + t.cd2 where id = v_des;
    end if;
    insert into _eq select t.code, x from unnest(array[v_ing, v_des]) as x where x is not null on conflict do nothing;
  end loop;

  -- Part calcul déjà bouclée : le dessin enchaîné a commencé (la part calcul
  -- se termine la veille du début du dessin). La tâche est alors en cours.
  alter table _t add column fi boolean;
  update _t set fi = ci2 > 0 and (statut = 'termine'
                     or (cd2 > 0 and ing is not null and statut <> 'attente'
                         and pg_temp.recule(ech, ceil(cd2)::int) <= v_j));
  update _t set statut = 'en_cours' where statut = 'a_faire' and fi;

  -- Écriture. Parts enchaînées : le dessin attend le calcul.
  insert into public.taches (bureau_id, affaire_id, titre, note, charge_inge, charge_dessin, echeance,
                             ingenieur_id, dessinateur_id, statut, avancement, priorite,
                             fini_inge, fini_dessin, enchaine)
  select v_b, a.id, s.titre, s.note, s.ci2, s.cd2, s.ech, s.ing, s.des, s.statut,
         case s.statut
           when 'termine'  then 100
           when 'en_cours' then case when s.g in ('r', 'ra') then 80
                                     else greatest(10, least(90, 90 - (s.ech - v_j) * 15)) / 5 * 5 end
           else 0 end,
         s.p,
         s.fi,
         s.cd2 > 0 and s.statut = 'termine',
         s.ci2 > 0 and s.cd2 > 0
    from _t s
    join _a a on a.code = s.code;

  -- Équipes d'affaire : tous ceux qui y ont une tâche, plus un associé sur
  -- chaque appel d'offres
  insert into public.affaire_membres (bureau_id, affaire_id, membre_id)
  select v_b, a.id, q.membre from _eq q join _a a on a.code = q.affaire
  on conflict do nothing;
  if v_admin is not null then
    insert into public.affaire_membres (bureau_id, affaire_id, membre_id)
    select v_b, a.id, v_admins[1 + (a.k % cardinality(v_admins))]
      from _a a where a.phase = 'AO'
    on conflict do nothing;
  end if;

  -- -------------------------------------------------------- agenda des AO
  insert into public.ao_agenda (bureau_id, affaire_id, jour, heure, genre, titre, lieu, note)
  select v_b, a.id, pg_temp.ouvre(v_lundi + v.e), v.h::time, v.genre, v.titre, v.lieu, v.note
    from (values
      ('AO-2026-91', v_oj, '10:00', 'visite',    'Visite des lieux',                       'Rue du Collège 4, Clarens', 'Visite obligatoire, une personne au plus par bureau.'),
      ('AO-2026-91',    6, null,    'questions', 'Délai pour les questions',               '',                          'Questions par la plateforme simap.ch.'),
      ('AO-2026-91',   16, '12:00', 'remise',    'Remise de l''offre',                     'Greffe de l''Office intercommunal', 'Deux exemplaires papier et une clé USB.'),
      ('AO-2026-91',   17, '10:00', 'ouverture', 'Ouverture des offres',                   '',                          ''),
      ('AO-2026-92',    4, '14:00', 'visite',    'Visite du terrain avec la coopérative',  'Chemin du Grand-Pré 2, Onex', ''),
      ('AO-2026-92',   24, '17:00', 'remise',    'Remise de l''offre',                     'Par courriel',              ''),
      ('AO-2026-93',    9, '09:00', 'seance',    'Séance de lancement',                    'Fondation Les Glycines, Morges', 'Présenter l''équipe et le planning des études.')
    ) as v(code, e, h, genre, titre, lieu, note)
    join _a a on a.code = v.code;

  -- ------------------------------------------------- agenda interne du bureau
  for r in select * from (values
    ('Démonstration du planificateur aux administrateurs', v_oj, '14:00', '15:30', 'Salle de conférence', 'Tour des modules : communication, planning, charge, secteurs, AO.', 'admins'),
    ('Revue des charges du mois',                         v_oj, '08:30', '09:15', 'Salle de conférence', '', 'chefs'),
    ('Séance de chantier — Les Marronniers',              v_oj + 1, '10:00', '11:30', 'Chantier, Route de Chêne 85', 'Contrôle de l''armature de la dalle sur 2e étage.', '26-801'),
    ('Point hebdomadaire — ' || coalesce(v_nomd1, 'secteur'), 7, '08:30', '09:00', 'Salle de conférence', '', 'secteur'),
    ('Point hebdomadaire — ' || coalesce(v_nomd1, 'secteur'), 14, '08:30', '09:00', 'Salle de conférence', '', 'secteur'),
    ('Point hebdomadaire — ' || coalesce(v_nomd1, 'secteur'), 21, '08:30', '09:00', 'Salle de conférence', '', 'secteur'),
    ('Coordination CVSE — EMS de Beaulieu',               9, '14:00', '16:00', 'Visioconférence', 'Percements des dalles et des voiles.', '26-807'),
    ('Séance maître d''ouvrage — passerelle sur la Vièze', 10, '09:30', '11:00', 'Commune de Monthey', 'Présentation des trois variantes.', '26-806'),
    ('Séance de coordination — parking de la Gare',       15, '13:30', '15:00', 'Avenue de la Gare 25, Sion', 'Avec la géotechnicienne : sous-pressions et lestage.', '26-804'),
    ('Formation interne — armature dans Revit',           16, '13:30', '17:00', 'Salle de formation', 'Familles d''armature, listes de fers, nomenclatures.', 'dessin')
  ) as v(titre, e, h1, h2, lieu, note, qui) loop
    insert into public.rendez_vous (bureau_id, titre, jour, debut, fin, lieu, note, participants, cree_par)
    values (v_b, r.titre, pg_temp.ouvre(v_lundi + r.e), r.h1::time, r.h2::time, r.lieu, r.note,
            case r.qui
              when 'admins' then array(select x from (
                       select unnest(v_admins) as x
                       union select a.membre_id from public.acces a
                              where a.bureau_id = v_b and a.super_admin and a.actif and a.membre_id is not null) y)
              when 'chefs' then array(select m.id from public.membres m
                       where m.bureau_id = v_b and m.actif
                         and ('chef_secteur' = any (m.statuts) or 'administrateur' = any (m.statuts))
                       order by m.prenom limit 12)
              when 'secteur' then array(select m.id from public.membres m
                       where m.bureau_id = v_b and m.actif and m.discipline is not distinct from v_disc1
                         and m.metier in ('ingenieur', 'dessinateur')
                       order by m.metier, m.prenom limit 15)
              when 'dessin' then array(select m.id from _m m where m.metier = 'dessinateur' order by m.rang limit 12)
              else array(select q.membre from _eq q where q.affaire = r.qui)
            end,
            v_admin)
    returning id into v_ing;
    insert into demo_admins.traces values ('rendez_vous', v_ing);
  end loop;

  -- ------------------------------------------------- avis à l'heure près
  for r in select v.*, m.id as membre_id
             from (values
               ('ingenieur',   3, 0, '08:00', '10:30', 'Séance de chantier, arrivée vers 11 h'),
               ('dessinateur', 2, 0, '15:30', '18:00', 'Rendez-vous à l''extérieur'),
               ('ingenieur',   4, 1, '13:30', '17:30', 'Visite de chantier l''après-midi')
             ) as v(metier, rang, dj, h1, h2, motif)
             join _m m on m.metier = v.metier and m.rang = v.rang and not m.admin loop
    insert into public.avis (bureau_id, membre_id, debut, fin, motif)
    values (v_b, r.membre_id,
            ((v_j + r.dj) + r.h1::time) at time zone 'Europe/Zurich',
            ((v_j + r.dj) + r.h2::time) at time zone 'Europe/Zurich',
            r.motif)
    returning id into v_ing;
    insert into demo_admins.traces values ('avis', v_ing);
  end loop;

  select count(*) into v_cpt from _t;
  raise notice 'Jeu de démonstration chargé : jour J le %, % tâches, échelle ingénieurs × %, dessinateurs × %.',
    to_char(v_j, 'DD.MM.YYYY'), v_cpt, round(v_f_i, 2), round(v_f_d, 2);
end $$;

commit;

-- Contrôle : 20 affaires, environ 90 tâches ; puis la charge de chacun sur les
-- quatre semaines (jours prévus, tâches réelles comprises, et capacité).
select
  (select count(*) from demo_admins.traces where tab = 'affaires')                        as affaires,
  (select count(*) from public.taches where affaire_id in
     (select id from demo_admins.traces where tab = 'affaires'))                           as taches,
  (select count(*) from demo_admins.traces where tab = 'absences')                         as absences,
  (select count(*) from demo_admins.traces where tab = 'conges')                           as conges,
  (select count(*) from demo_admins.traces where tab = 'rendez_vous')                      as rendez_vous;

select m.prenom || ' ' || m.nom as personne, m.metier, m.succursale,
       sum(case when t.ingenieur_id = m.id and not t.fini_inge then t.charge_inge else 0 end
         + case when t.dessinateur_id = m.id and not t.fini_dessin then t.charge_dessin else 0 end) as jours_prevus,
       m.capacite * 4 as capacite_4_semaines
  from public.membres m
  join public.taches t on (t.ingenieur_id = m.id or t.dessinateur_id = m.id)
                      and t.bureau_id = m.bureau_id
                      and t.statut <> 'termine'
                      and t.echeance between date_trunc('week', current_date)::date
                                         and date_trunc('week', current_date)::date + 25
 where m.id in (select membre_id from public.affaire_membres
                 where affaire_id in (select id from demo_admins.traces where tab = 'affaires'))
 group by m.id
 order by m.metier, m.succursale, personne;
