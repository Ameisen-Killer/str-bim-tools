-- ============================================================================
--  Outil de planification — import de fiches dans l'annuaire
--  Cas d'usage : les régies immobilières du canton de Genève
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--
--  Le fichier est RELANÇABLE : une société déjà présente dans l'annuaire du
--  bureau visé n'est pas réinsérée (comparaison sur la société, sans tenir
--  compte de la casse ni des espaces). Compléter la liste et relancer ajoute
--  donc seulement les nouvelles.
--
--  ORDRE À RESPECTER
--    migration-annuaire.sql d'abord : c'est elle qui crée la table contacts.
--
--  ATTENTION — LES LIGNES SONT À REMPLIR.
--  Claude n'a pas pu constituer la liste depuis cette session : le proxy
--  réseau bloque l'accès aux annuaires (uspi-ge.ch, regiegeneve.ch). Aucune
--  adresse ni aucun numéro n'est inventé ici : mieux vaut un fichier vide
--  qu'un carnet d'adresses faux. Voir « Pour remplir » en bas du fichier.
-- ============================================================================

begin;

-- ------------------------------------------------------------- garde-fou ---
do $$
begin
  if to_regclass('public.contacts') is null then
    raise exception 'Exécute d''abord migration-annuaire.sql : la table des fiches n''existe pas.';
  end if;
end $$;

-- ---------------------------------------------------------- bureau visé ---
-- Les fiches appartiennent à un bureau. L'éditeur SQL n'étant connecté à
-- aucun compte, bureau_courant() ne répond rien ici : il faut le nommer.
create temp table _cible(bureau uuid) on commit drop;

-- ➜ Base à un seul bureau : laisse la ligne ci-dessous telle quelle.
insert into _cible select id from public.bureaux;

-- ➜ Plusieurs bureaux : commente la ligne du dessus, décommente celle-ci et
--    écris le nom exact du bureau (celui de la console).
-- insert into _cible select id from public.bureaux where nom = 'AB Ingénieurs';

do $$
declare n int;
begin
  select count(*) into n from _cible;
  if n = 0 then raise exception 'Aucun bureau trouvé : vérifie le nom écrit plus haut.';
  elsif n > 1 then raise exception 'La base compte % bureaux : nomme celui qui reçoit les fiches.', n;
  end if;
end $$;

-- ------------------------------------------------------------- les fiches ---
-- Une ligne par régie, dans cet ordre :
--   société | rôle | rue et numéro | NPA | localité | téléphone | e-mail | observations
-- Le canton et le pays sont posés plus bas, identiques pour toute la liste.
-- Les apostrophes se doublent : 'Régie de l''Arve SA'.
insert into public.contacts
  (bureau_id, nom, prenom, societe, role, adresse, npa, localite, canton, pays,
   telephone, natel, email, observations)
select (select bureau from _cible),
       '', '', s.societe, s.role, s.adresse, s.npa, s.localite, 'GE', 'Suisse',
       s.telephone, '', s.email, s.observations
  from (values
    -- ➜ COLLE OU COMPLÈTE TES LIGNES ICI, sur le modèle des deux exemples
    --    ci-dessous, puis retire les deux « -- » qui les commentent.
    --
    -- ('Régie Exemple SA',        'Régie', 'Rue du Rhône 1',      '1204', 'Genève',  '022 000 00 00', 'info@exemple.ch', ''),
    -- ('Gérance Exemple & Cie',   'Régie', 'Avenue de Champel 5', '1206', 'Genève',  '022 000 00 01', '',                'Contact : M. Untel'),
    --
    -- Ligne neutre : elle ne crée rien et permet au fichier de s'exécuter tel
    -- quel, sans être modifié. À supprimer dès que la liste est remplie.
    (null, null, null, null, null, null, null, null)
  ) as s(societe, role, adresse, npa, localite, telephone, email, observations)
 where s.societe is not null
   and not exists (
     select 1 from public.contacts c
      where c.bureau_id = (select bureau from _cible)
        and lower(btrim(c.societe)) = lower(btrim(s.societe))
   );

commit;

-- ==================================================================== rapport ==
-- Ce que l'annuaire contient maintenant, côté régies genevoises.
select count(*) filter (where lower(role) like '%régie%')        as fiches_regie,
       count(*) filter (where canton = 'GE')                     as fiches_geneve,
       count(*)                                                  as fiches_en_tout
  from public.contacts;

-- ============================================================================
--  POUR REMPLIR LA LISTE
-- ----------------------------------------------------------------------------
--  Deux chemins, au choix :
--
--  1. OUVRIR LE RÉSEAU. Dans les réglages de l'environnement Claude (menu de
--     l'environnement, « Edit » > Network access) : élargir l'accès, ou
--     ajouter www.uspi-ge.ch et regiegeneve.ch aux domaines autorisés. Claude
--     lit alors le répertoire des membres et remplit ce fichier lui-même.
--
--  2. FOURNIR LA SOURCE. Copier-coller la liste (page USPI, export Excel,
--     annuaire interne) dans la conversation : Claude la met en forme ici,
--     adresses et numéros repris tels quels, sans rien réécrire.
--
--  Dans les deux cas, le fichier reste relançable : ce qui est déjà dans
--  l'annuaire n'est pas dupliqué.
-- ============================================================================
