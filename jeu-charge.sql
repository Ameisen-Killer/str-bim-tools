-- ============================================================================
--  Outil de planification — JEU DE CHARGE (données fictives, gros volume)
-- ----------------------------------------------------------------------------
--  Sert à éprouver la tenue de l'outil sur un bureau chargé :
--    80 membres (36 ingénieurs, 44 dessinateurs, temps partiels, 5 inactifs)
--    400 affaires (actives, suspendues, terminées), ~1 900 liens d'équipe
--    6 000 tâches étalées de -4 à +8 mois, 300 absences.
--  Valeurs pseudo-aléatoires mais déterministes : deux exécutions donnent le
--  même jeu (à la date du jour près).
--
--  Marquage, indépendant du jeu d'essai :
--    membres  : adresse en @charge.exemple.ch
--    affaires : note commençant par [jeu de charge]
--  Retrait complet : purge-jeu-charge.sql. Les données réelles et le jeu
--  d'essai ne sont pas touchés.
-- ============================================================================

begin;

do $$
begin
  if exists (select 1 from public.membres where email like '%@charge.exemple.ch') then
    raise exception 'Le jeu de charge est déjà présent. Lancer d''abord purge-jeu-charge.sql.';
  end if;
end $$;

-- ------------------------------------------------------------------ membres
-- 80 membres pour 40 prénoms et 40 noms : le second tour décale les noms de
-- sept rangs, sinon chaque nom ressortirait tel quel au tour suivant et le
-- bureau compterait quarante homonymes.
insert into public.membres (prenom, nom, email, role, capacite, actif)
select
  (array['Alice','Bastien','Chloé','Damien','Elsa','Fabien','Gaëlle','Hugo','Inès','Jonas',
         'Karine','Luca','Maëlle','Nathan','Océane','Pierre','Quentin','Rachel','Simon','Tania',
         'Ulysse','Valérie','William','Xavier','Yasmine','Zoé','Arnaud','Béatrice','Cédric','Delphine',
         'Étienne','Florence','Grégoire','Hélène','Igor','Julie','Kilian','Laure','Mathis','Noémie'])[(g % 40) + 1],
  (array['Aebischer','Blanc','Chollet','Dupraz','Égger','Favre','Gay','Huguenin','Imhof','Jaccard',
         'Kohler','Liechti','Martin','Nicolet','Oberson','Perrin','Quartier','Rey','Savoy','Thévenaz',
         'Udry','Vionnet','Wenger','Yerly','Zufferey','Amstutz','Brunner','Cretton','Dubey','Emery',
         'Fournier','Genoud','Hofer','Jordan','Kaeser','Lambiel','Meyer','Nussbaum','Pasche','Roulin'])[((g * 17 + ((g - 1) / 40) * 7) % 40) + 1],
  'charge.m' || g || '@charge.exemple.ch',
  case when g <= 36 then 'ingenieur' else 'dessinateur' end,
  case g % 10 when 3 then 4 when 7 then 3 else 5 end,
  g % 16 <> 0
from generate_series(1, 80) g;

-- ----------------------------------------------------------------- affaires
insert into public.affaires (code, nom, note, teinte, statut, echeance)
select
  'C-' || lpad(g::text, 4, '0'),
  (array['Immeuble de logements','Halle industrielle','École','Parking souterrain','Passerelle',
         'Villa individuelle','EMS','Bâtiment administratif','Station d''épuration','Centre sportif',
         'Pont routier','Mur de soutènement'])[(g % 12) + 1]
    || ' — ' ||
  (array['gros œuvre','surélévation','dalle sur sol','radier et murs','renforcement','transformation',
         'agrandissement','expertise','étude de variantes','exécution'])[((g * 7) % 10) + 1]
    || ' · lot ' || g,
  '[jeu de charge] Affaire générée pour les essais de volume.',
  (g % 8) + 1,
  case g % 20 when 0 then 'terminee' when 1 then 'suspendue' else 'active' end,
  current_date + ((g * 37) % 360 - 60)
from generate_series(1, 400) g;

-- ------------------------------------------------------- équipes d'affaire
-- 2 ingénieurs et 3 dessinateurs par affaire (doublons écartés)
insert into public.affaire_membres (affaire_id, membre_id)
select distinct a.id, m.id
from generate_series(1, 400) g
cross join generate_series(0, 4) k
join public.affaires a on a.code = 'C-' || lpad(g::text, 4, '0')
join public.membres  m on m.email = 'charge.m' ||
  case when k < 2 then ((g * 31 + k * 11) % 36) + 1          -- ingénieurs 1..36
       else          ((g * 29 + k * 13) % 44) + 37 end        -- dessinateurs 37..80
  || '@charge.exemple.ch'
on conflict do nothing;

-- ----------------------------------------------------------------- absences
insert into public.absences (membre_id, debut, fin, motif)
select m.id,
       current_date + ((g * 53) % 300 - 60),
       current_date + ((g * 53) % 300 - 60) + (g % 10),
       (array['Vacances','Formation','Service militaire','Congé'])[(g % 4) + 1]
from generate_series(1, 300) g
join public.membres m on m.email = 'charge.m' || (((g * 29) % 80) + 1) || '@charge.exemple.ch';

-- ------------------------------------------------------------------- tâches
with base as (
  select g,
         ((g * 97) % 360) - 120                                   as dec,
         case g % 5 when 0 then 0 when 1 then 0.5 when 2 then 1 when 3 then 2 else 3 end as ci0,
         case g % 6 when 0 then 0 else (g % 7) + 1 end            as cd
  from generate_series(1, 6000) g
), t as (
  select g, dec, cd,
         case when ci0 = 0 and cd = 0 then 1 else ci0 end         as ci   -- jamais de tâche sans charge
  from base
)
insert into public.taches (affaire_id, titre, note, charge_inge, charge_dessin, echeance,
                           ingenieur_id, dessinateur_id, statut, avancement)
select a.id,
       (array['Plans de coffrage','Plans d''armature','Note de calcul','Descente de charges','Métré',
              'Détails de ferraillage','Plans de réservations','Contrôle des plans d''entreprise',
              'Modèle BIM','Coordination CVSE','Dossier d''appel d''offres','Réception d''armature'])[(t.g % 12) + 1]
         || ' — ' ||
       (array['radier','sous-sol','rez-de-chaussée','niveau 1','niveau 2','niveau 3','toiture','murs','dalles'])[((t.g * 5) % 9) + 1],
       '',
       t.ci, t.cd,
       (current_date + t.dec) - case extract(isodow from current_date + t.dec)::int when 6 then 1 when 7 then 2 else 0 end,
       case when t.ci > 0 then i.id end,
       case when t.cd > 0 then d.id end,
       case when t.dec < -10 and t.g % 11 <> 0 then 'termine'
            when t.dec <= 10                    then 'en_cours'
            when t.g % 23 = 0                   then 'attente'
            else 'a_faire' end,
       case when t.dec < -10 and t.g % 11 <> 0 then 100
            when t.dec <= 10                    then (t.g % 10) * 10
            else 0 end
from t
join public.affaires a on a.code = 'C-' || lpad((((t.g * 7919) % 400) + 1)::text, 4, '0')
join public.membres  i on i.email = 'charge.m' || (((t.g * 13) % 36) + 1)  || '@charge.exemple.ch'
join public.membres  d on d.email = 'charge.m' || (((t.g * 17) % 44) + 37) || '@charge.exemple.ch';

commit;

-- Contrôle : 80 / 400 / 6000 / 300
select
  (select count(*) from public.membres  where email like '%@charge.exemple.ch')                  as membres,
  (select count(*) from public.affaires where note like '[jeu de charge]%')                        as affaires,
  (select count(*) from public.taches t join public.affaires a on a.id = t.affaire_id
     where a.note like '[jeu de charge]%')                                                         as taches,
  (select count(*) from public.absences b join public.membres m on m.id = b.membre_id
     where m.email like '%@charge.exemple.ch')                                                     as absences,
  (select count(*) from public.affaire_membres l join public.affaires a on a.id = l.affaire_id
     where a.note like '[jeu de charge]%')                                                         as liens_equipe;
