-- ============================================================================
--  Outil de planification STR Bim Tools — schéma PostgreSQL pour Supabase
-- ----------------------------------------------------------------------------
--  Installation neuve, en une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Une base déjà en service reçoit les évolutions par un fichier
--  migration-<sujet>.sql, retiré du dépôt une fois passé (l'historique Git le
--  garde). Ce fichier-ci reste la référence : tenir les deux alignés.
--
--  AVANT D'EXÉCUTER : remplacer l'adresse d'exemple de la ligne « super admin »
--  par celle du compte qui administrera l'outil. Ne pas l'enregistrer dans le
--  dépôt : ce fichier est public.
--
--  Ce fichier ne contient aucune donnée et aucun secret : il décrit la forme
--  des tables, les fonctions et la sécurité. Il double le modèle du mode local
--  (docs/planif/assets/donnees.js) : mêmes champs, mêmes contraintes.
--
--  Organisation : plusieurs bureaux d'études dans une même base. Chaque ligne
--  appartient à un bureau ; la RLS cloisonne les bureaux, et chaque adresse
--  autorisée (table acces) ne voit que le sien. Le super admin gère bureaux,
--  personnes et accès depuis la console (/planif/console/), par des fonctions
--  réservées. L'outil lui-même ne crée ni ne modifie de membre : la table
--  membres y est en lecture seule.
--  Sans connexion, la clé publique du projet ne donne accès à rien : c'est ce
--  qui permet de publier cette clé dans un dépôt public. Seule exception, voulue :
--  l'outil Visas (/visas/), ouvert sans connexion — voir la section « Visas ».
--
--  Après exécution, dans le tableau de bord Supabase (voir reglages-supabase.md) :
--    - Authentication > Auth Hooks : « Before User Created », fonction
--      public.garde_creation_compte ;
--    - Authentication > Sign In / Providers : inscriptions autorisées et
--      confirmation de l'adresse obligatoire ;
--    - serveur d'envoi (SMTP) et modèles de courriels en français.
-- ============================================================================

begin;

-- ------------------------------------------------------------ super admin ---
-- ↓↓↓ Remplacer l'adresse d'exemple par ton adresse de connexion ↓↓↓
select set_config('planif.super_admin', 'prenom.nom@exemple.ch', true);

do $$
begin
  if current_setting('planif.super_admin') ilike '%@exemple.ch' then
    raise exception 'Remplace d''abord l''adresse du super admin en tête du fichier (ligne set_config), puis relance.';
  end if;
end $$;

-- ---------------------------------------------------------------- bureaux ---
create table if not exists public.bureaux (
  id       uuid primary key default gen_random_uuid(),
  nom      text not null constraint bureaux_nom_rempli check (btrim(nom) <> ''),
  actif    boolean not null default true,
  cree_le  timestamptz not null default now(),
  maj_le   timestamptz not null default now()
);
create unique index if not exists bureaux_nom_unique on public.bureaux (lower(btrim(nom)));
comment on table public.bureaux is
  'Bureaux d''études. Toute ligne des autres tables appartient à un bureau. Un bureau suspendu ferme l''accès de ses utilisateurs.';

-- ------------------------------------------- succursales et disciplines ---
-- Le code est l'identifiant stable (celui que portent les membres) ; le nom
-- peut changer. Il commence par une lettre : l'outil range ces listes dans des
-- objets JavaScript, où une clé numérique changerait l'ordre d'affichage.
create table if not exists public.succursales (
  bureau_id  uuid not null references public.bureaux (id) on delete cascade,
  code       text not null constraint succursales_code_forme check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  nom        text not null constraint succursales_nom_rempli check (btrim(nom) <> ''),
  ordre      smallint not null default 0,
  primary key (bureau_id, code)
);

create table if not exists public.disciplines (
  bureau_id  uuid not null references public.bureaux (id) on delete cascade,
  code       text not null constraint disciplines_code_forme check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  nom        text not null constraint disciplines_nom_rempli check (btrim(nom) <> ''),
  ordre      smallint not null default 0,
  primary key (bureau_id, code)
);

-- Disciplines présentes dans chaque succursale. Aucune ligne pour une
-- succursale : l'outil y propose toutes les disciplines du bureau.
create table if not exists public.succursale_disciplines (
  bureau_id  uuid not null,
  succursale text not null,
  discipline text not null,
  primary key (bureau_id, succursale, discipline),
  foreign key (bureau_id, succursale) references public.succursales (bureau_id, code) on delete cascade,
  foreign key (bureau_id, discipline) references public.disciplines (bureau_id, code) on delete cascade
);

-- ----------------------------------------------------------------- accès ---
-- Une ligne par adresse autorisée : son bureau, son état, et pour le super
-- admin le bureau qu'il consulte en ce moment (bureau_actif).
-- membre_id : la fiche du planning derrière cette adresse. La contrainte vers
-- membres est posée plus bas, une fois cette table-là créée.
create table if not exists public.acces (
  email        text primary key constraint acces_email_minuscules check (email = lower(btrim(email))),
  bureau_id    uuid not null constraint acces_bureau_fk references public.bureaux (id) on delete cascade,
  droit        text not null default 'utilisateur'
               constraint acces_droit_check check (droit in ('utilisateur', 'responsable')),
  super_admin  boolean not null default false,
  bureau_actif uuid constraint acces_bureau_actif_fk references public.bureaux (id) on delete set null,
  membre_id    uuid,
  actif        boolean not null default true,
  ajoute_le    timestamptz not null default now()
);
comment on table public.acces is
  'Adresses autorisées à se connecter, chacune rattachée à un bureau. Lue et écrite uniquement par les fonctions de la base (console du super admin).';
comment on column public.acces.droit is
  '« utilisateur » pour tous ; « responsable » est réservé à une délégation future (gérer les accès de son propre bureau).';
comment on column public.acces.bureau_actif is
  'Super admin seulement : bureau affiché dans le planning. Vide : son propre bureau.';
comment on column public.acces.membre_id is
  'Membre planifié derrière cette adresse. Vide : accès sans fiche au planning (super admin, externe).';

-- --------------------------------------------------- qui est connecté ? ---
-- security definer : ces fonctions lisent acces et bureaux, fermés à tous.

create or replace function public.est_super_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.acces a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and a.actif and a.super_admin
  );
$$;

-- Le bureau dont la personne connectée voit les données. Nul si elle n'est
-- pas autorisée, si son accès est suspendu, ou si son bureau l'est (sauf pour
-- le super admin, qui peut entrer dans un bureau suspendu).
create or replace function public.bureau_courant()
returns uuid
language sql stable security definer set search_path = '' as $$
  select b.id
  from public.acces a
  join public.bureaux b
    on b.id = case when a.super_admin then coalesce(a.bureau_actif, a.bureau_id) else a.bureau_id end
  where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and a.actif
    and (b.actif or a.super_admin);
$$;

-- Valeur par défaut de bureau_id : le bureau courant. Hors connexion (SQL
-- Editor, jeux d'essai), le réglage de session planif.bureau en tient lieu.
create or replace function public.bureau_par_defaut()
returns uuid
language sql stable set search_path = '' as $$
  select coalesce(public.bureau_courant(), nullif(current_setting('planif.bureau', true), '')::uuid);
$$;

-- Conservée pour les anciennes politiques et requêtes : autorisé = rattaché à un bureau ouvert.
create or replace function public.est_autorise()
returns boolean
language sql stable set search_path = '' as $$
  select public.bureau_courant() is not null;
$$;

-- --------------------------------------------- qui suis-je, que puis-je ? ---
-- La fiche d'équipe derrière l'adresse connectée (vide : accès sans fiche).
create or replace function public.mon_membre()
returns uuid
language sql stable security definer set search_path = '' as $$
  select a.membre_id
    from public.acces a
   where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and a.actif;
$$;

-- mes_droits() et a_droit() lisent membres et droits_groupes : elles sont
-- déclarées plus bas, une fois ces tables créées.

-- ------------------------------------------------- date de mise à jour ---
create or replace function public.touche_maj_le()
returns trigger language plpgsql as $$
begin
  new.maj_le := now();
  return new;
end $$;

-- ---------------------------------------------------------------- membres ---
create table if not exists public.membres (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint membres_bureau_fk references public.bureaux (id) on delete cascade,
  nom        text not null,
  prenom     text not null,
  email      text,
  -- Le métier d'un côté, les statuts de l'autre : on est ingénieur OU
  -- dessinateur OU administratif, et on peut en plus être associé, chef de
  -- secteur, chef de projet — ou rien de tout cela.
  metier     text constraint membres_metier_check
               check (metier is null or metier in ('ingenieur', 'dessinateur', 'administratif')),
  statuts    text[] not null default '{}' constraint membres_statuts_check
               check (statuts is not null
                      and array_position(statuts, null::text) is null
                      and statuts <@ array['administrateur', 'chef_secteur', 'chef_projet']::text[]),
  succursale text,
  discipline text,
  capacite   numeric(3,1) not null default 5 check (capacite > 0 and capacite <= 7),
  -- Semaine type, du lundi au vendredi : 1 jour plein, 0.5 demi-journée, 0 jour
  -- non travaillé. Nul : les cinq jours se valent.
  jours      numeric(2,1)[] constraint membres_jours_check
               check (jours is null
                      or (cardinality(jours) = 5
                          and array_position(jours, null::numeric) is null
                          and jours <@ array[0, 0.5, 1]::numeric[]
                          and jours && array[0.5, 1]::numeric[])),
  actif      boolean not null default true,
  -- Mon profil (10.10.2026) : téléphones et photo (petite image JPEG en
  -- data URL, 160 × 160), réglés par regle_profil
  tel_interne text not null default '' constraint membres_tel_interne_check check (char_length(tel_interne) <= 40),
  tel_externe text not null default '' constraint membres_tel_externe_check check (char_length(tel_externe) <= 40),
  photo      text constraint membres_photo_check
               check (photo is null or (photo like 'data:image/%' and char_length(photo) <= 120000)),
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now(),
  constraint membres_id_bureau_key    unique (id, bureau_id),
  constraint membres_email_bureau_key unique (bureau_id, email),
  constraint membres_succursale_fk foreign key (bureau_id, succursale)
    references public.succursales (bureau_id, code) on delete set null (succursale),
  constraint membres_discipline_fk foreign key (bureau_id, discipline)
    references public.disciplines (bureau_id, code) on delete set null (discipline)
);
create index if not exists membres_bureau on public.membres (bureau_id);
-- Retrouver « tous les chefs de projet » sans parcourir la table
create index if not exists membres_statuts on public.membres using gin (statuts);

-- Le lien accès → membre, maintenant que les deux tables existent. Un membre a
-- au plus un accès ; un accès peut n'avoir aucune fiche (super admin, externe).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acces_membre_fk') then
    alter table public.acces add constraint acces_membre_fk
      foreign key (membre_id, bureau_id) references public.membres (id, bureau_id)
      on delete set null (membre_id);
  end if;
end $$;
create unique index if not exists acces_membre_unique
  on public.acces (membre_id) where membre_id is not null;

comment on column public.membres.capacite is 'Jours travaillés par semaine : 5 pour un plein temps.';
comment on column public.membres.jours is
  'Semaine type du lundi au vendredi (1 plein, 0.5 demi-journée, 0 non travaillé). La capacité se répartit sur ces jours, au poids de chacun. Nul : les cinq jours se valent.';
comment on column public.membres.email is
  'Adresse d''annuaire, facultative. Ce n''est PAS l''adresse de connexion (elle vit dans acces) : elle sert de repère aux jeux d''essai.';
comment on column public.membres.metier is
  'Le métier exercé : ingenieur, dessinateur ou administratif. Vide : membre pas encore désigné. Seuls ingénieurs et dessinateurs portent des tâches.';
comment on column public.membres.statuts is
  'Place dans la société, cumulable avec le métier et entre eux : administrateur (associé), chef_secteur, chef_projet. Tableau vide : aucune de ces casquettes.';
comment on column public.membres.succursale is 'Code d''une succursale du bureau (table succursales).';
comment on column public.membres.discipline is 'Code d''une discipline du bureau (table disciplines).';

-- --------------------------------------------------------------- absences ---
create table if not exists public.absences (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint absences_bureau_fk references public.bureaux (id) on delete cascade,
  membre_id  uuid not null references public.membres (id) on delete cascade,
  debut      date not null,
  fin        date not null,
  motif      text not null default 'Absence',
  constraint absence_ordonnee check (fin >= debut),
  constraint absences_membre_bureau_fk foreign key (membre_id, bureau_id)
    references public.membres (id, bureau_id) on delete cascade
);
create index if not exists absences_membre on public.absences (membre_id, debut);
create index if not exists absences_bureau on public.absences (bureau_id);

-- ------------------------------------------------------------------- avis ---
-- Avis d'absence à l'heure près, affichés sur l'accueil de la planification :
-- un rendez-vous, un après-midi sur un chantier, une arrivée tardive. Ils
-- informent l'équipe et ne comptent pas dans le planning (les absences, en
-- jours entiers, s'en chargent).
create table if not exists public.avis (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint avis_bureau_fk references public.bureaux (id) on delete cascade,
  membre_id  uuid not null,
  debut      timestamptz not null,
  fin        timestamptz not null,
  motif      text not null default 'Absence' check (char_length(motif) <= 200),
  cree_le    timestamptz not null default now(),
  constraint avis_ordonne check (fin > debut),
  constraint avis_membre_bureau_fk foreign key (membre_id, bureau_id)
    references public.membres (id, bureau_id) on delete cascade
);
create index if not exists avis_bureau on public.avis (bureau_id, fin);
comment on table public.avis is
  'Avis d''absence à l''heure près, affichés sur l''accueil de la planification. Ne comptent pas dans le planning (les absences, en jours, s''en chargent).';

-- --------------------------------------------------------------- affaires ---
create table if not exists public.affaires (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint affaires_bureau_fk references public.bureaux (id) on delete cascade,
  code       text not null,
  nom        text not null,
  note       text not null default '',
  teinte     smallint not null default 1 check (teinte between 1 and 8),
  statut     text not null default 'active' check (statut in ('active', 'suspendue', 'terminee')),
  echeance   date,
  phase      text,          -- phase SIA 112 par son numéro (31, 32…), « AO » : appel d'offres ; vide : non renseignée
  adresse    text not null default '',   -- adresse du chantier, en un seul champ
  -- Appel d'offres (espace AB, module Inter-secteurs) : la date de remise est l'échéance
  ao_type      text check (ao_type is null or ao_type in ('public', 'prive')),
  demandeur_id uuid,       -- fiche de l'annuaire (contrainte posée après la table contacts)
  ao_resultat  text check (ao_resultat is null or ao_resultat in ('en_cours', 'gagne', 'perdu', 'abandonne')),
  ao_montant   numeric(12,0) check (ao_montant is null or ao_montant >= 0),
  -- Secteurs (disciplines) qui interviennent : affaires et AO transversaux
  secteurs     text[] not null default '{}',
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now(),
  constraint affaires_id_bureau_key   unique (id, bureau_id),
  constraint affaires_code_bureau_key unique (bureau_id, code)
);
create index if not exists affaires_bureau on public.affaires (bureau_id);
comment on column public.affaires.teinte is 'Index 1..8 dans la palette du site : la couleur reste définie côté interface.';

-- Équipe d'une affaire. Le rôle n'est pas répété ici : il est porté par le membre.
create table if not exists public.affaire_membres (
  affaire_id uuid not null references public.affaires (id) on delete cascade,
  membre_id  uuid not null references public.membres  (id) on delete cascade,
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint affaire_membres_bureau_fk references public.bureaux (id) on delete cascade,
  primary key (affaire_id, membre_id),
  constraint affaire_membres_affaire_fk foreign key (affaire_id, bureau_id)
    references public.affaires (id, bureau_id) on delete cascade,
  constraint affaire_membres_membre_fk foreign key (membre_id, bureau_id)
    references public.membres (id, bureau_id) on delete cascade
);
create index if not exists affaire_membres_bureau on public.affaire_membres (bureau_id);

-- ----------------------------------------------------------------- tâches ---
create table if not exists public.taches (
  id             uuid primary key default gen_random_uuid(),
  bureau_id      uuid not null default public.bureau_par_defaut()
                 constraint taches_bureau_fk references public.bureaux (id) on delete cascade,
  affaire_id     uuid not null references public.affaires (id) on delete cascade,
  titre          text not null,
  note           text not null default '',
  charge_inge    numeric(4,1) not null default 0 check (charge_inge >= 0),
  charge_dessin  numeric(4,1) not null default 0 check (charge_dessin >= 0),
  debut          date,
  echeance       date not null,
  ingenieur_id   uuid references public.membres (id) on delete set null,
  dessinateur_id uuid references public.membres (id) on delete set null,
  statut         text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'attente', 'termine')),
  avancement     smallint not null default 0 check (avancement between 0 and 100),
  -- Les deux parts d'une tâche se terminent séparément : l'ingénieur qui boucle
  -- son calcul libère sa charge sans fermer le dessin. Le statut ci-dessus en
  -- est la synthèse : « termine » quand toutes les parts existantes le sont.
  fini_inge      boolean not null default false,
  fini_dessin    boolean not null default false,
  -- Le dessin attend le calcul : la part calcul finit la veille du début du dessin.
  enchaine       boolean not null default false,
  -- Priorité entre tâches de même échéance : 1 la plus importante, 5 par défaut.
  priorite       smallint not null default 5 check (priorite between 1 and 5),
  cree_le        timestamptz not null default now(),
  maj_le         timestamptz not null default now(),
  constraint charge_non_nulle check (charge_inge + charge_dessin > 0),
  constraint periode_ordonnee check (debut is null or debut <= echeance),
  -- Une charge sans personne est permise : elle attend son affectation (« À affecter »).
  -- Affaire et personnes : forcément du même bureau que la tâche.
  constraint taches_affaire_bureau_fk foreign key (affaire_id, bureau_id)
    references public.affaires (id, bureau_id) on delete cascade,
  constraint taches_ingenieur_bureau_fk foreign key (ingenieur_id, bureau_id)
    references public.membres (id, bureau_id) on delete set null (ingenieur_id),
  constraint taches_dessinateur_bureau_fk foreign key (dessinateur_id, bureau_id)
    references public.membres (id, bureau_id) on delete set null (dessinateur_id)
);
create index if not exists taches_bureau    on public.taches (bureau_id);
create index if not exists taches_affaire   on public.taches (affaire_id);
create index if not exists taches_echeance  on public.taches (echeance);
create index if not exists taches_ingenieur on public.taches (ingenieur_id);
create index if not exists taches_dessin    on public.taches (dessinateur_id);

comment on column public.taches.debut is
  'Facultatif. Vide, l''interface cale la tâche au plus tard avant son échéance.';
comment on column public.taches.charge_inge is
  'Jours d''ingénieur. Distincte de la charge dessin : les deux métiers ne pèsent pas pareil sur une même tâche.';

-- --------------------------------------------------------------- annuaire ---
-- Carnet d'adresses du bureau : clients, architectes, entreprises, partenaires.
-- Sans lien avec les affaires : on y cherche une personne, on l'appelle.
create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  bureau_id    uuid not null default public.bureau_par_defaut()
               constraint contacts_bureau_fk references public.bureaux (id) on delete cascade,
  nom          text not null default '',
  prenom       text not null default '',
  societe      text not null default '',
  telephone    text not null default '',
  natel        text not null default '',
  email        text not null default '',
  site         text not null default '',
  role         text not null default '',
  adresse      text not null default '',
  npa          text not null default '',
  localite     text not null default '',
  canton       text not null default '',
  pays         text not null default '',
  observations text not null default '',
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now(),
  constraint contacts_nom_ou_societe
    check (char_length(trim(nom)) > 0 or char_length(trim(societe)) > 0)
);
create index if not exists contacts_bureau on public.contacts (bureau_id);

-- Le demandeur d'un appel d'offres est une fiche de l'annuaire
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'affaires_demandeur_fk') then
    alter table public.affaires add constraint affaires_demandeur_fk
      foreign key (demandeur_id) references public.contacts (id) on delete set null;
  end if;
end $$;

-- Agenda d'un appel d'offres : attaché à l'affaire, non à une personne
create table if not exists public.ao_agenda (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint ao_agenda_bureau_fk references public.bureaux (id) on delete cascade,
  affaire_id uuid not null,
  jour       date not null,
  heure      time,
  genre      text not null default 'autre'
             check (genre in ('visite', 'questions', 'remise', 'ouverture', 'presentation', 'seance', 'autre')),
  titre      text not null check (char_length(titre) between 1 and 200),
  lieu       text not null default '' check (char_length(lieu) <= 200),
  note       text not null default '',
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now(),
  constraint ao_agenda_affaire_fk foreign key (affaire_id, bureau_id)
    references public.affaires (id, bureau_id) on delete cascade
);
create index if not exists ao_agenda_bureau on public.ao_agenda (bureau_id, jour);

-- Agenda interne du bureau (espace AB, module Communication) : rendez-vous
-- d'une ou plusieurs personnes. externe_id et source préparent la réplication
-- avec Outlook (identifiant de l'événement de l'autre côté), encore à venir.
create table if not exists public.rendez_vous (
  id           uuid primary key default gen_random_uuid(),
  bureau_id    uuid not null default public.bureau_par_defaut()
               constraint rendez_vous_bureau_fk references public.bureaux (id) on delete cascade,
  titre        text not null check (char_length(titre) between 1 and 200),
  jour         date not null,
  debut        time,                     -- vide : toute la journée
  fin          time,
  lieu         text not null default '' check (char_length(lieu) <= 200),
  note         text not null default '',
  participants uuid[] not null default '{}',   -- fiches d'équipe (membres)
  cree_par     uuid,                     -- fiche de la personne qui l'a noté
  source       text not null default 'planif' check (source in ('planif', 'outlook')),
  externe_id   text,
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now(),
  constraint rendez_vous_heures check (debut is null or fin is null or fin > debut)
);
create index if not exists rendez_vous_bureau on public.rendez_vous (bureau_id, jour);

-- Demandes de congé (espace AB, module Communication) : la personne demande,
-- un chef de son secteur (même discipline) ou un administrateur décide. Une
-- demande acceptée devient une absence du planning (decide_conge).
create table if not exists public.conges (
  id          uuid primary key default gen_random_uuid(),
  bureau_id   uuid not null default public.bureau_par_defaut()
              constraint conges_bureau_fk references public.bureaux (id) on delete cascade,
  membre_id   uuid not null,
  debut       date not null,
  fin         date not null,
  motif       text not null default 'Vacances' check (char_length(motif) between 1 and 100),
  commentaire text not null default '',
  statut      text not null default 'en_attente'
              check (statut in ('en_attente', 'acceptee', 'refusee', 'annulee')),
  valide_par  uuid,                       -- fiche de la personne qui a décidé
  valide_le   timestamptz,
  reponse     text not null default '',
  absence_id  uuid references public.absences (id) on delete set null,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  constraint conges_ordonne check (fin >= debut),
  constraint conges_membre_bureau_fk foreign key (membre_id, bureau_id)
    references public.membres (id, bureau_id) on delete cascade
);
create index if not exists conges_bureau on public.conges (bureau_id, statut, debut);

-- Veille des appels d'offres (module Inter-secteurs) : les publications de
-- simap.ch retenues chaque matin par la tâche planifiée du dépôt
-- (.github/workflows/veille-simap.yml). Données publiques, communes à tous
-- les bureaux ; seule la tâche y écrit (clé de service, qui passe la RLS).
create table if not exists public.veille_ao (
  id               text primary key,          -- identifiant du projet simap
  publication_id   text not null,
  titre            text not null,
  description      text not null default '',
  adjudicateur     text not null default '',
  canton           text not null default '',
  lieu             text not null default '',
  procedure        text not null default '',  -- open, selective, invitation…
  type_publication text not null default '',  -- tender, competition…
  sous_type        text not null default '',  -- service, project_competition…
  cpv              text[] not null default '{}',
  bkp              text[] not null default '{}',
  publie_le        date,
  delai_remise     timestamptz,
  lien             text not null default '',
  motifs           text[] not null default '{}',  -- pourquoi elle a été retenue
  recu_le          timestamptz not null default now(),
  maj_le           timestamptz not null default now()
);
create index if not exists veille_ao_publie on public.veille_ao (publie_le desc);

-- Ce que chaque bureau fait d'une publication : écartée, ou transformée en
-- appel d'offres (affaire en phase AO).
create table if not exists public.veille_suivi (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint veille_suivi_bureau_fk references public.bureaux (id) on delete cascade,
  ao_id      text not null references public.veille_ao (id) on delete cascade,
  etat       text not null check (etat in ('ecartee', 'retenue')),
  affaire_id uuid,
  par        uuid,
  le         timestamptz not null default now(),
  constraint veille_suivi_unique unique (bureau_id, ao_id)
);
create index if not exists veille_suivi_bureau on public.veille_suivi (bureau_id);

-- Tchat du bureau (module Communication, 06.10.2026) : les messages, lus par
-- tout le bureau, écrits par chacun en son nom.
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  bureau_id  uuid not null default public.bureau_par_defaut()
             constraint messages_bureau_fk references public.bureaux (id) on delete cascade,
  auteur_id  uuid default public.mon_membre()
             constraint messages_auteur_fk references public.membres (id) on delete set null,
  texte      text not null check (char_length(btrim(texte)) between 1 and 2000),
  cree_le    timestamptz not null default now()
);
create index if not exists messages_bureau on public.messages (bureau_id, cree_le desc);
comment on column public.contacts.role is
  'Rôle dans les projets — architecte, maître d''ouvrage, entreprise… Texte libre.';
comment on column public.contacts.natel is
  'Téléphone mobile (suisse romand pour « portable »).';
comment on column public.contacts.npa is
  'Code postal. Texte et non nombre : les NPA étrangers ont des lettres et des zéros en tête.';

-- -------------------------------------------------------------- présences ---
-- Qui a l'outil sous les yeux : la barre du haut en annonce le nombre, et les
-- noms au survol. Une ligne par onglet ouvert ; un onglet visible bat toutes
-- les 45 s, un onglet qui passe derrière le dit aussitôt. Chaque message porte
-- l'heure de l'onglet : un message arrivé en retard (le « je passe derrière »
-- d'une page quittée, après le « je suis là » de la suivante) est ignoré.
-- Aucune règle RLS, comme acces et bureaux : seule public.presence() y touche.
create table if not exists public.presences (
  email     text not null
            constraint presences_email_minuscules check (email = lower(btrim(email))),
  onglet    text not null
            constraint presences_onglet_forme check (char_length(onglet) between 1 and 64),
  bureau_id uuid not null
            constraint presences_bureau_fk references public.bureaux (id) on delete cascade,
  visible   boolean not null default true,
  horloge   bigint not null default 0,
  vu_le     timestamptz not null default now(),
  primary key (email, onglet)
);
create index if not exists presences_bureau on public.presences (bureau_id, vu_le desc);

comment on table public.presences is
  'Un onglet ouvert de l''outil par ligne : visible ou non, et son dernier battement. Tenue par public.presence() seule ; aucune règle RLS, donc invisible depuis l''API.';
comment on column public.presences.horloge is
  'Heure de l''onglet (ms) du dernier message retenu : un message plus ancien, arrivé en retard, est ignoré.';
comment on column public.presences.vu_le is
  'Heure du dernier battement. En ligne = visible et moins de 100 secondes (les onglets visibles battent toutes les 45 s).';

-- p_visible : l'onglet est sous les yeux (battement) ou vient de passer derrière.
-- p_quitter : déconnexion — tous les onglets de l'adresse s'effacent.
create or replace function public.presence(p_onglet text, p_horloge bigint,
                                           p_visible boolean default true,
                                           p_quitter boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_bureau uuid := public.bureau_courant();
  v_onglet text := left(btrim(coalesce(p_onglet, '')), 64);
begin
  if v_email = '' or v_bureau is null then
    return jsonb_build_object('enLigne', '[]'::jsonb);
  end if;

  if p_quitter then
    delete from public.presences p where p.email = v_email;
  elsif v_onglet <> '' then
    insert into public.presences as p (email, onglet, bureau_id, visible, horloge, vu_le)
    values (v_email, v_onglet, v_bureau, coalesce(p_visible, true), coalesce(p_horloge, 0), now())
    on conflict (email, onglet) do update
      set bureau_id = excluded.bureau_id, visible = excluded.visible,
          horloge = excluded.horloge, vu_le = excluded.vu_le
      where p.horloge <= excluded.horloge;
  end if;

  -- Ménage : une ligne d'hier ne dit plus rien, et personne d'autre ne l'effacera.
  delete from public.presences p where p.vu_le < now() - interval '1 day';

  -- Une personne, une fois, même avec plusieurs onglets visibles.
  return jsonb_build_object('enLigne', coalesce((
    select jsonb_agg(jsonb_build_object('nom', x.nom, 'moi', x.moi) order by lower(x.nom))
      from (
        select distinct on (p.email)
               case when m.id is not null then btrim(m.prenom || ' ' || m.nom) else p.email end as nom,
               p.email = v_email as moi
          from public.presences p
          left join public.acces a on a.email = p.email and a.actif
          left join public.membres m on m.id = a.membre_id
         where p.bureau_id = v_bureau
           and p.visible
           and p.vu_le > now() - interval '100 seconds'
         order by p.email
      ) x), '[]'::jsonb));
end $$;

comment on function public.presence(text, bigint, boolean, boolean) is
  'Inscrit l''état d''un onglet de la personne connectée et renvoie qui a l''outil sous les yeux dans son bureau : { enLigne: [{ nom, moi }] }.';

-- --------------------------------------------------------------- réglages ---
-- Une ligne par bureau, créée avec lui (déclencheur plus bas).
create table if not exists public.reglages (
  bureau_id        uuid primary key default public.bureau_par_defaut()
                   constraint reglages_bureau_fk references public.bureaux (id) on delete cascade,
  id               boolean not null default true check (id),
  canton           text not null default 'VD',
  capacite_defaut  numeric(3,1) not null default 5,
  maj_le           timestamptz not null default now()
);
comment on column public.reglages.id is 'Historique (une seule ligne avant les bureaux) : toujours vrai.';

-- ------------------------------------------------- droits d'un groupe ---
-- Ce que chaque groupe a le droit de faire, bureau par bureau. Les groupes
-- sont les statuts portés par les membres ; qui n'en porte aucun est un
-- utilisateur « lambda » et travaille sur ce qui le concerne, rien d'autre.
-- La liste des droits est ouverte : un droit ajouté plus tard à l'outil
-- n'oblige pas à toucher au schéma. Un code inconnu de l'outil ne fait rien.
create table if not exists public.droits_groupes (
  bureau_id uuid not null references public.bureaux (id) on delete cascade,
  statut    text not null constraint droits_groupes_statut_check
            check (statut in ('administrateur', 'chef_secteur', 'chef_projet')),
  droits    text[] not null default '{}' constraint droits_groupes_droits_check
            check (droits is not null and array_position(droits, null::text) is null),
  maj_le    timestamptz not null default now(),
  primary key (bureau_id, statut)
);
comment on table public.droits_groupes is
  'Droits accordés à chaque groupe, bureau par bureau. Lue par les membres du bureau, écrite seulement par la console du super admin.';

-- Tous les droits que mes statuts m'accordent, réunis. Aucun statut : rien.
create or replace function public.mes_droits()
returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select array_agg(distinct d)
      from public.acces a
      join public.membres m on m.id = a.membre_id
      join public.droits_groupes g
        on g.bureau_id = m.bureau_id and g.statut = any (m.statuts)
      cross join lateral unnest(g.droits) as d
     where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and a.actif), '{}'::text[]);
$$;

-- Le super admin passe partout : c'est lui qui distribue les droits.
create or replace function public.a_droit(p_droit text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_super_admin() or p_droit = any (public.mes_droits());
$$;

do $$
declare t text;
begin
  foreach t in array array['membres', 'affaires', 'taches', 'contacts', 'reglages', 'ao_agenda', 'rendez_vous', 'conges', 'veille_ao'] loop
    execute format('drop trigger if exists maj_le on public.%I', t);
    execute format(
      'create trigger maj_le before update on public.%I
         for each row execute function public.touche_maj_le()', t);
  end loop;
end $$;

-- Un bureau naît avec sa ligne de réglages (canton, capacité par défaut)
-- Un bureau neuf part avec ses réglages et les droits d'origine : les trois
-- groupes reçoivent les trois droits, à ajuster ensuite depuis la console.
create or replace function public.bureau_cree_reglages()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reglages (bureau_id) values (new.id) on conflict (bureau_id) do nothing;
  insert into public.droits_groupes (bureau_id, statut, droits)
  select new.id, s, array['affaires_creer', 'taches_autrui', 'absences_autrui']
    from unnest(array['administrateur', 'chef_secteur', 'chef_projet']) as s
  on conflict (bureau_id, statut) do nothing;
  return new;
end $$;

drop trigger if exists cree_reglages on public.bureaux;
create trigger cree_reglages after insert on public.bureaux
  for each row execute function public.bureau_cree_reglages();

drop trigger if exists maj_le on public.bureaux;
create trigger maj_le before update on public.bureaux
  for each row execute function public.touche_maj_le();

-- -------------------------------------------- bureau n° 1 et super admin ---
do $$
declare
  v_b uuid;
begin
  select id into v_b from public.bureaux order by cree_le, id limit 1;
  if v_b is null then
    insert into public.bureaux (nom) values ('Mon bureau') returning id into v_b;
  end if;
  insert into public.acces (email, bureau_id, super_admin)
  values (lower(btrim(current_setting('planif.super_admin'))), v_b, true)
  on conflict (email) do update set super_admin = true, actif = true;
end $$;

-- Droits d'origine des bureaux déjà là (le déclencheur ne couvre que les neufs)
insert into public.droits_groupes (bureau_id, statut, droits)
select b.id, s, array['affaires_creer', 'taches_autrui', 'absences_autrui']
  from public.bureaux b,
       unnest(array['administrateur', 'chef_secteur', 'chef_projet']) as s
on conflict (bureau_id, statut) do nothing;

-- =========================================================== sécurité (RLS) ==
-- On repart de zéro : les politiques existantes de ces tables sont retirées.
-- Les tables de planification ne montrent que le bureau courant. Bureaux,
-- accès, succursales, disciplines et présences n'ont aucune politique : seules
-- les fonctions (security definer) les lisent et les écrivent.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['membres', 'absences', 'avis', 'affaires', 'affaire_membres', 'taches', 'contacts',
                           'ao_agenda', 'rendez_vous', 'conges', 'veille_ao', 'veille_suivi', 'messages', 'reglages', 'droits_groupes', 'acces', 'bureaux', 'succursales', 'disciplines',
                           'succursale_disciplines', 'presences'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('membres', 'absences', 'avis', 'affaires', 'affaire_membres', 'taches', 'contacts', 'ao_agenda', 'rendez_vous', 'conges', 'veille_ao', 'veille_suivi', 'messages', 'reglages',
                        'droits_groupes', 'acces', 'bureaux', 'succursales', 'disciplines',
                        'succursale_disciplines', 'presences')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;

  -- L'équipe d'une affaire suit l'affaire : rien de plus que le bureau.
  execute
    'create policy "bureau courant" on public.affaire_membres for all to authenticated
       using (bureau_id = (select public.bureau_courant()))
       with check (bureau_id = (select public.bureau_courant()))';
end $$;

-- ------------------------------------------------ ce que chacun peut écrire ---
-- Lire, tout le bureau le peut. Écrire dépend du droit accordé au groupe, ou
-- de ce qui nous concerne. Qui ne porte aucun statut est un utilisateur
-- « lambda » : il mène son travail, pas celui des autres.

-- Affaires : travailler sur les existantes pour tous ; en ouvrir une — ou la
-- retirer, ce qui emporte ses tâches — demande le droit.
create policy "bureau courant (lecture)" on public.affaires for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.affaires for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
create policy "droit de créer" on public.affaires for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and (select public.a_droit('affaires_creer')));
create policy "droit de retirer" on public.affaires for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (select public.a_droit('affaires_creer')));

-- Tâches : « me concerner », c'est tenir une part chargée — l'ingénieur d'une
-- tâche qui a du calcul, le dessinateur d'une tâche qui a du dessin. Se mettre
-- au calcul d'une tâche sans calcul ne serait pas s'y mettre.
create policy "bureau courant (lecture)" on public.taches for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "droit ou ma tâche (création)" on public.taches for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)));
-- Une part chargée que personne ne tient reste prenable par tout le monde :
-- c'est le geste du tableau de bord, « glisser une barre à affecter sur un
-- membre ». Le USING dit ce qu'on peut toucher ; le WITH CHECK ne garde que le
-- bureau, pour qu'on puisse aussi passer la main — confier sa part à quelqu'un
-- d'autre, ou la remettre à affecter. La tâche quitte alors son planning.
create policy "droit ou ma tâche (modification)" on public.taches for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)
    or (ingenieur_id   is null and charge_inge   > 0)
    or (dessinateur_id is null and charge_dessin > 0)))
  with check (bureau_id = (select public.bureau_courant()));
create policy "droit ou ma tâche (suppression)" on public.taches for delete to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)));

-- Absences : les siennes, ou le droit d'en poser pour les autres.
create policy "bureau courant (lecture)" on public.absences for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "droit ou mes absences (création)" on public.absences for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and (membre_id = (select public.mon_membre())
                   or (select public.a_droit('absences_autrui'))));
create policy "droit ou mes absences (modification)" on public.absences for update to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (membre_id = (select public.mon_membre())
              or (select public.a_droit('absences_autrui'))))
  with check (bureau_id = (select public.bureau_courant())
              and (membre_id = (select public.mon_membre())
                   or (select public.a_droit('absences_autrui'))));
create policy "droit ou mes absences (suppression)" on public.absences for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (membre_id = (select public.mon_membre())
              or (select public.a_droit('absences_autrui'))));

-- Avis d'absence : la même règle que les absences.
create policy "bureau courant (lecture)" on public.avis for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "droit ou mes avis (création)" on public.avis for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and (membre_id = (select public.mon_membre())
                   or (select public.a_droit('absences_autrui'))));
create policy "droit ou mes avis (modification)" on public.avis for update to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (membre_id = (select public.mon_membre())
              or (select public.a_droit('absences_autrui'))))
  with check (bureau_id = (select public.bureau_courant())
              and (membre_id = (select public.mon_membre())
                   or (select public.a_droit('absences_autrui'))));
create policy "droit ou mes avis (suppression)" on public.avis for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (membre_id = (select public.mon_membre())
              or (select public.a_droit('absences_autrui'))));

-- Annuaire : tout le bureau le lit et le tient. Un carnet d'adresses est un
-- outil commun, pas le travail de quelqu'un : les quatre règles portent la
-- même condition, celle des affaires en modification.
create policy "bureau courant (lecture)" on public.contacts for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.contacts for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.contacts for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (suppression)" on public.contacts for delete to authenticated
  using (bureau_id = (select public.bureau_courant()));

-- Agenda des appels d'offres : comme l'annuaire, tout le bureau le lit et le tient.
create policy "bureau courant (lecture)" on public.ao_agenda for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.ao_agenda for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.ao_agenda for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (suppression)" on public.ao_agenda for delete to authenticated
  using (bureau_id = (select public.bureau_courant()));

-- Rendez-vous : tout le bureau les voit et en note ; seuls celui qui l'a
-- noté, ses participants et qui a le droit de poser les absences des autres
-- les modifient ou les retirent.
create policy "bureau courant (lecture)" on public.rendez_vous for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.rendez_vous for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "les siens ou le droit (modification)" on public.rendez_vous for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    cree_par = (select public.mon_membre())
    or (select public.mon_membre()) = any (participants)
    or (select public.a_droit('absences_autrui'))))
  with check (bureau_id = (select public.bureau_courant()));
create policy "les siens ou le droit (suppression)" on public.rendez_vous for delete to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    cree_par = (select public.mon_membre())
    or (select public.mon_membre()) = any (participants)
    or (select public.a_droit('absences_autrui'))));

-- Demandes de congé : tout le bureau les voit (qui part quand) ; on demande
-- pour soi (ou pour un autre avec le droit sur ses absences), on annule sa
-- demande tant qu'elle attend. La décision passe par decide_conge.
create policy "bureau courant (lecture)" on public.conges for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "ma demande ou le droit (création)" on public.conges for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()) and statut = 'en_attente'
              and valide_par is null and absence_id is null
              and (membre_id = (select public.mon_membre()) or (select public.a_droit('absences_autrui'))));
create policy "ma demande en attente (annulation)" on public.conges for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and statut = 'en_attente'
         and (membre_id = (select public.mon_membre()) or (select public.a_droit('absences_autrui'))))
  with check (bureau_id = (select public.bureau_courant()) and statut in ('en_attente', 'annulee')
              and valide_par is null and absence_id is null);

-- Veille : toute personne autorisée lit les publications ; seule la tâche
-- planifiée (clé de service) les écrit. Le suivi est celui du bureau.
create policy "autorisés (lecture)" on public.veille_ao for select to authenticated
  using ((select public.est_autorise()));
create policy "bureau courant (lecture)" on public.veille_suivi for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (création)" on public.veille_suivi for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.veille_suivi for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (suppression)" on public.veille_suivi for delete to authenticated
  using (bureau_id = (select public.bureau_courant()));
-- Tchat : tout le bureau lit ; chacun écrit en son nom (jamais le compte de
-- démonstration, partagé et public : ses messages restent sur son écran) ;
-- on retire les siens, le super admin tous. Pas de modification.
create policy "bureau courant (lecture)" on public.messages for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "en son nom (création)" on public.messages for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and auteur_id is not null and auteur_id = (select public.mon_membre())
              and lower(coalesce(auth.jwt() ->> 'email', '')) <> 'demo@str-bim-tools.com');
create policy "les siens (suppression)" on public.messages for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (auteur_id = (select public.mon_membre()) or (select public.est_super_admin())));

-- Droits des groupes : chacun voit ce que son bureau accorde (l'outil s'en
-- sert pour ne pas proposer l'impossible) ; seule la console les écrit.
create policy "bureau courant (lecture)" on public.droits_groupes for select to authenticated
  using (bureau_id = (select public.bureau_courant()));

-- Membres : l'outil les lit, il ne les écrit pas. Créer, modifier, supprimer
-- une personne passe par la console (fonctions security definer, plus bas).
create policy "bureau courant (lecture)" on public.membres for select to authenticated
  using (bureau_id = (select public.bureau_courant()));

-- Réglages : lus et modifiés (canton, capacité), jamais créés ni supprimés depuis l'outil
create policy "bureau courant (lecture)" on public.reglages for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.reglages for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));

-- ======================================================= profil connecté ==

-- Qui suis-je, dans quel bureau, avec quelles listes. Appelée au chargement
-- de chaque page ; « autorise » à faux dit pourquoi l'accès est fermé.
create or replace function public.mon_profil()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_acces   public.acces%rowtype;
  v_bureau  public.bureaux%rowtype;
  v_membre  public.membres%rowtype;
  v_courant uuid;
begin
  select * into v_acces from public.acces x where x.email = v_email;
  if not found then
    return jsonb_build_object('autorise', false, 'motif', 'inconnu', 'email', v_email);
  end if;
  if not v_acces.actif then
    return jsonb_build_object('autorise', false, 'motif', 'suspendu', 'email', v_email);
  end if;

  v_courant := case when v_acces.super_admin then coalesce(v_acces.bureau_actif, v_acces.bureau_id)
                    else v_acces.bureau_id end;
  select * into v_bureau from public.bureaux x where x.id = v_courant;
  if not found then
    return jsonb_build_object('autorise', false, 'motif', 'sans_bureau', 'email', v_email);
  end if;
  if not v_bureau.actif and not v_acces.super_admin then
    return jsonb_build_object('autorise', false, 'motif', 'bureau_suspendu', 'email', v_email);
  end if;

  if v_acces.membre_id is not null then
    select * into v_membre from public.membres m where m.id = v_acces.membre_id;
  end if;

  -- Le métier et les statuts voyagent avec le profil : c'est sur eux que
  -- s'appuient les droits d'accès.
  return jsonb_build_object(
    'autorise', true,
    'email', v_email,
    'membreId', v_acces.membre_id,
    'metier', v_membre.metier,
    'statuts', to_jsonb(coalesce(v_membre.statuts, '{}'::text[])),
    'droits', to_jsonb(public.mes_droits()),
    'superAdmin', v_acces.super_admin,
    'droit', v_acces.droit,
    'bureau', jsonb_build_object('id', v_bureau.id, 'nom', v_bureau.nom, 'actif', v_bureau.actif),
    'bureaux', case when v_acces.super_admin then coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'nom', x.nom, 'actif', x.actif) order by lower(x.nom))
        from public.bureaux x), '[]'::jsonb) end,
    'succursales', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'code', s.code, 'nom', s.nom,
                 'disciplines', coalesce((
                    select jsonb_agg(sd.discipline order by d.ordre, d.nom)
                    from public.succursale_disciplines sd
                    join public.disciplines d on d.bureau_id = sd.bureau_id and d.code = sd.discipline
                    where sd.bureau_id = s.bureau_id and sd.succursale = s.code), '[]'::jsonb))
               order by s.ordre, s.nom)
        from public.succursales s where s.bureau_id = v_bureau.id), '[]'::jsonb),
    'disciplines', coalesce((
        select jsonb_agg(jsonb_build_object('code', d.code, 'nom', d.nom) order by d.ordre, d.nom)
        from public.disciplines d where d.bureau_id = v_bureau.id), '[]'::jsonb)
  );
end $$;

-- Le super admin change de bureau dans le planning
create or replace function public.choisit_bureau(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.est_super_admin() then
    raise exception 'Réservé au super admin.';
  end if;
  if not exists (select 1 from public.bureaux x where x.id = p_bureau) then
    raise exception 'Ce bureau n''existe plus.';
  end if;
  update public.acces x set bureau_actif = p_bureau
   where x.email = lower(coalesce(auth.jwt() ->> 'email', ''));
end $$;

-- ========================================================= jours travaillés ==
-- Chacun règle sa semaine type depuis l'outil ; celle d'un collègue demande le
-- droit « Poser les absences des autres » (la même question : quand est-il là ?).
-- Les membres ne s'écrivent pas depuis l'outil (règles plus haut) : cette
-- fonction ne touche que les jours, et la capacité qui en découle.
--   p_jours : cinq poids du lundi au vendredi (1, 0.5 ou 0), ou nul pour une
--   semaine pleine.
-- La capacité suit les jours quand elle les suivait déjà (4 j sur 4 jours
-- restent 4 j sur 4 jours, 5 j passent à 4 j si l'on retire le mercredi) ;
-- un temps partiel sans jour fixe (4 j sur 5 jours) ne monte jamais seul :
-- elle ne fait que redescendre sous les jours travaillés. Changer de taux
-- d'activité reste l'affaire de la console.
-- Renvoie { jours, capacite }.
create or replace function public.regle_jours(p_membre uuid, p_jours jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m      public.membres%rowtype;
  v_jours  numeric[];
  v_avant  numeric;
  v_apres  numeric;
  v_cap    numeric;
begin
  if not public.est_autorise() then
    raise exception 'Accès refusé. Ton adresse est-elle bien dans la liste des accès ?';
  end if;
  select * into v_m from public.membres m
   where m.id = p_membre and m.bureau_id = public.bureau_courant();
  if not found then
    raise exception 'Cette personne n''existe plus dans ce bureau.';
  end if;
  if p_membre is distinct from public.mon_membre() and not public.a_droit('absences_autrui') then
    raise exception 'Tu ne règles que tes propres jours : ceux d''un collègue demandent le droit « Poser les absences des autres ».';
  end if;

  if jsonb_typeof(p_jours) = 'array' then
    select array_agg(case when x.v::numeric >= 0.75 then 1 when x.v::numeric >= 0.25 then 0.5 else 0 end
                     order by x.n)
      into v_jours
      from jsonb_array_elements_text(p_jours) with ordinality as x(v, n);
    if cardinality(v_jours) <> 5 then
      raise exception 'La semaine type compte cinq jours, du lundi au vendredi.';
    end if;
    if v_jours <@ array[1]::numeric[] then
      v_jours := null;
    elsif not v_jours && array[0.5, 1]::numeric[] then
      raise exception 'Garde au moins un jour travaillé.';
    end if;
  end if;

  v_avant := coalesce((select sum(x) from unnest(v_m.jours) as x), 5);
  v_apres := coalesce((select sum(x) from unnest(v_jours) as x), 5);
  v_cap := case when abs(v_m.capacite - v_avant) < 0.05 then v_apres
                else least(v_m.capacite, v_apres) end;

  update public.membres m
     set jours = v_jours, capacite = round(v_cap, 1)
   where m.id = p_membre;

  return jsonb_build_object('jours', to_jsonb(v_jours), 'capacite', round(v_cap, 1));
end $$;

-- Mon profil : chacun règle ses téléphones et sa photo (le super admin, ceux
-- de tous). Le compte de démonstration, public, ne change pas la photo.
create or replace function public.regle_profil(p_membre uuid, p_tel_interne text, p_tel_externe text, p_photo text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m     public.membres%rowtype;
  v_int   text := btrim(coalesce(p_tel_interne, ''));
  v_ext   text := btrim(coalesce(p_tel_externe, ''));
  v_photo text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if not public.est_autorise() then
    raise exception 'Accès refusé. Ton adresse est-elle bien dans la liste des accès ?';
  end if;
  select * into v_m from public.membres m
   where m.id = p_membre and m.bureau_id = public.bureau_courant();
  if not found then
    raise exception 'Cette personne n''existe plus dans ce bureau.';
  end if;
  if p_membre is distinct from public.mon_membre() and not public.est_super_admin() then
    raise exception 'Tu ne règles que ton propre profil.';
  end if;
  if char_length(v_int) > 40 or char_length(v_ext) > 40 then
    raise exception 'Numéro de téléphone trop long (40 caractères au plus).';
  end if;
  if v_photo is not null and (v_photo not like 'data:image/%' or char_length(v_photo) > 120000) then
    raise exception 'Photo refusée : image trop lourde ou d''un format inconnu.';
  end if;
  if v_photo is distinct from v_m.photo
     and lower(coalesce(auth.jwt() ->> 'email', '')) = 'demo@str-bim-tools.com' then
    raise exception 'La photo ne se change pas dans la démonstration.';
  end if;

  update public.membres m
     set tel_interne = v_int, tel_externe = v_ext, photo = v_photo
   where m.id = p_membre;

  return jsonb_build_object('tel_interne', v_int, 'tel_externe', v_ext, 'photo', v_photo);
end $$;

-- Qui décide d'un congé : un administrateur du bureau, ou un chef de secteur
-- de la même discipline — jamais pour soi-même ; le super admin, toujours.
create or replace function public.peut_valider_conge(p_membre uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_super_admin() or exists (
    select 1
      from public.membres moi
      join public.membres lui on lui.id = p_membre and lui.bureau_id = moi.bureau_id
     where moi.id = public.mon_membre()
       and moi.id <> lui.id
       and ('administrateur' = any (moi.statuts)
            or ('chef_secteur' = any (moi.statuts) and moi.discipline is not null
                and moi.discipline = lui.discipline)));
$$;

-- Accepter ou refuser une demande. Acceptée, elle devient une absence du
-- planning : la personne qui décide n'a pas forcément le droit d'écrire les
-- absences des autres, d'où cette fonction plutôt qu'une écriture directe.
create or replace function public.decide_conge(p_demande uuid, p_accepte boolean, p_reponse text default '')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_d   public.conges%rowtype;
  v_abs uuid;
begin
  if not public.est_autorise() then
    raise exception 'Accès refusé. Ton adresse est-elle bien dans la liste des accès ?';
  end if;
  select * into v_d from public.conges c
   where c.id = p_demande and c.bureau_id = public.bureau_courant()
   for update;
  if not found then
    raise exception 'Cette demande de congé n''existe plus.';
  end if;
  if v_d.statut <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;
  if not public.peut_valider_conge(v_d.membre_id) then
    raise exception 'Tu ne décides que des congés de ton secteur (chef de secteur de la même discipline, ou administrateur).';
  end if;
  if p_accepte then
    insert into public.absences (bureau_id, membre_id, debut, fin, motif)
    values (v_d.bureau_id, v_d.membre_id, v_d.debut, v_d.fin, v_d.motif)
    returning id into v_abs;
  end if;
  update public.conges c
     set statut = case when p_accepte then 'acceptee' else 'refusee' end,
         valide_par = public.mon_membre(), valide_le = now(),
         reponse = coalesce(p_reponse, ''), absence_id = v_abs
   where c.id = v_d.id;
end $$;

-- ================================================================ console ==
-- Toutes réservées au super admin : la page de la console est publique comme
-- le reste du site, c'est ici que se trouve la serrure.

-- Tout ce que la console affiche, en un seul appel
create or replace function public.console_etat()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  return jsonb_build_object(
    'moi', lower(coalesce(auth.jwt() ->> 'email', '')),
    'bureaux', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'nom', b.nom, 'actif', b.actif, 'cree', b.cree_le,
          'canton', coalesce(r.canton, 'VD'), 'capaciteDefaut', coalesce(r.capacite_defaut, 5),
          'membres',  (select count(*) from public.membres  m where m.bureau_id = b.id),
          'affaires', (select count(*) from public.affaires x where x.bureau_id = b.id),
          'taches',   (select count(*) from public.taches   t where t.bureau_id = b.id),
          'droits', coalesce((
              select jsonb_object_agg(g.statut, to_jsonb(g.droits))
              from public.droits_groupes g where g.bureau_id = b.id), '{}'::jsonb),
          'activite', greatest(
              (select max(t.maj_le) from public.taches   t where t.bureau_id = b.id),
              (select max(x.maj_le) from public.affaires x where x.bureau_id = b.id),
              (select max(m.maj_le) from public.membres  m where m.bureau_id = b.id)),
          'succursales', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'code', s.code, 'nom', s.nom,
                       'disciplines', coalesce((
                          select jsonb_agg(sd.discipline)
                          from public.succursale_disciplines sd
                          where sd.bureau_id = s.bureau_id and sd.succursale = s.code), '[]'::jsonb),
                       'membres', (select count(*) from public.membres m
                                   where m.bureau_id = s.bureau_id and m.succursale = s.code))
                     order by s.ordre, s.nom)
              from public.succursales s where s.bureau_id = b.id), '[]'::jsonb),
          'disciplines', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'code', d.code, 'nom', d.nom,
                       'membres', (select count(*) from public.membres m
                                   where m.bureau_id = d.bureau_id and m.discipline = d.code))
                     order by d.ordre, d.nom)
              from public.disciplines d where d.bureau_id = b.id), '[]'::jsonb))
        order by lower(b.nom))
      from public.bureaux b
      left join public.reglages r on r.bureau_id = b.id), '[]'::jsonb),
    -- Les fiches du planning, avec l'accès de chacune s'il existe
    'membres', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'bureauId', m.bureau_id, 'prenom', m.prenom, 'nom', m.nom,
          'metier', m.metier, 'statuts', to_jsonb(m.statuts),
          'succursale', m.succursale, 'discipline', m.discipline,
          'capacite', m.capacite, 'jours', to_jsonb(m.jours), 'actif', m.actif,
          'email', a.email, 'accesActif', a.actif, 'superAdmin', coalesce(a.super_admin, false),
          'compte', u.id is not null,
          'confirme', u.email_confirmed_at is not null,
          'derniereConnexion', u.last_sign_in_at,
          'taches', (select count(*) from public.taches t
                      where t.ingenieur_id = m.id or t.dessinateur_id = m.id))
        order by lower(m.prenom), lower(m.nom))
      from public.membres m
      left join public.acces a on a.membre_id = m.id
      left join auth.users u on lower(u.email) = a.email), '[]'::jsonb),
    -- Les accès, y compris ceux qui n'ont pas de fiche au planning
    'utilisateurs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'email', a.email, 'bureauId', a.bureau_id, 'superAdmin', a.super_admin,
          'actif', a.actif, 'droit', a.droit, 'ajoute', a.ajoute_le, 'membreId', a.membre_id,
          'compte', u.id is not null,
          'confirme', u.email_confirmed_at is not null,
          'derniereConnexion', u.last_sign_in_at)
        order by a.email)
      from public.acces a
      left join auth.users u on lower(u.email) = a.email), '[]'::jsonb)
  );
end $$;

-- Crée ou modifie un bureau : nom, état, réglages, disciplines, succursales.
-- Les listes reçues remplacent les anciennes ; leur ordre fait foi. Une
-- succursale ou une discipline retirée est effacée des membres qui la portaient.
create or replace function public.console_enregistre_bureau(p jsonb)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id       uuid := nullif(p ->> 'id', '')::uuid;
  v_nom      text := btrim(coalesce(p ->> 'nom', ''));
  v_canton   text := upper(btrim(coalesce(p ->> 'canton', 'VD')));
  v_capacite numeric := coalesce(nullif(p ->> 'capaciteDefaut', '')::numeric, 5);
  v_el       jsonb;
  v_rang     int;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if v_nom = '' then
    raise exception 'Le nom du bureau est obligatoire.';
  end if;
  if exists (select 1 from public.bureaux x where lower(btrim(x.nom)) = lower(v_nom) and x.id is distinct from v_id) then
    raise exception 'Un bureau porte déjà le nom « % ».', v_nom;
  end if;
  if v_canton !~ '^[A-Z]{2}$' then
    raise exception 'Canton inconnu.';
  end if;
  if v_capacite < 0.5 or v_capacite > 7 then
    raise exception 'La capacité par défaut doit être comprise entre 0,5 et 7 jours par semaine.';
  end if;

  -- Contrôle des listes avant toute écriture
  foreach v_el in array array[coalesce(p -> 'disciplines', '[]'::jsonb), coalesce(p -> 'succursales', '[]'::jsonb)] loop
    if jsonb_typeof(v_el) <> 'array' then
      raise exception 'Liste mal formée.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_el) e
               where coalesce(e.value ->> 'code', '') !~ '^[a-z][a-z0-9_]{0,39}$') then
      raise exception 'Code de succursale ou de discipline invalide.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_el) e where btrim(coalesce(e.value ->> 'nom', '')) = '') then
      raise exception 'Chaque succursale et chaque discipline doit avoir un nom.';
    end if;
    if (select count(distinct e.value ->> 'code') from jsonb_array_elements(v_el) e) < jsonb_array_length(v_el) then
      raise exception 'Code en double dans une liste.';
    end if;
    if (select count(distinct lower(btrim(e.value ->> 'nom'))) from jsonb_array_elements(v_el) e) < jsonb_array_length(v_el) then
      raise exception 'Deux succursales, ou deux disciplines, portent le même nom.';
    end if;
  end loop;

  if v_id is null then
    insert into public.bureaux (nom, actif) values (v_nom, coalesce((p ->> 'actif')::boolean, true))
    returning id into v_id;
  else
    update public.bureaux x set nom = v_nom, actif = coalesce((p ->> 'actif')::boolean, x.actif)
     where x.id = v_id;
    if not found then
      raise exception 'Ce bureau n''existe plus.';
    end if;
  end if;

  insert into public.reglages (bureau_id, canton, capacite_defaut)
  values (v_id, v_canton, round(v_capacite * 10) / 10)
  on conflict (bureau_id) do update set canton = excluded.canton, capacite_defaut = excluded.capacite_defaut;

  if p ? 'disciplines' then
    delete from public.disciplines x
     where x.bureau_id = v_id
       and x.code not in (select e.value ->> 'code' from jsonb_array_elements(p -> 'disciplines') e);
    v_rang := 0;
    for v_el in select e.value from jsonb_array_elements(p -> 'disciplines') e loop
      v_rang := v_rang + 1;
      insert into public.disciplines (bureau_id, code, nom, ordre)
      values (v_id, v_el ->> 'code', btrim(v_el ->> 'nom'), v_rang)
      on conflict (bureau_id, code) do update set nom = excluded.nom, ordre = excluded.ordre;
    end loop;
  end if;

  if p ? 'succursales' then
    delete from public.succursales x
     where x.bureau_id = v_id
       and x.code not in (select e.value ->> 'code' from jsonb_array_elements(p -> 'succursales') e);
    v_rang := 0;
    for v_el in select e.value from jsonb_array_elements(p -> 'succursales') e loop
      v_rang := v_rang + 1;
      insert into public.succursales (bureau_id, code, nom, ordre)
      values (v_id, v_el ->> 'code', btrim(v_el ->> 'nom'), v_rang)
      on conflict (bureau_id, code) do update set nom = excluded.nom, ordre = excluded.ordre;

      delete from public.succursale_disciplines x
       where x.bureau_id = v_id and x.succursale = v_el ->> 'code';
      insert into public.succursale_disciplines (bureau_id, succursale, discipline)
      select v_id, v_el ->> 'code', d.code
      from public.disciplines d
      where d.bureau_id = v_id
        and d.code in (select t.value from jsonb_array_elements_text(coalesce(v_el -> 'disciplines', '[]'::jsonb)) t);
    end loop;
  end if;

  return v_id;
end $$;

-- Supprime un bureau et TOUTES ses données (membres, affaires, tâches,
-- absences, réglages, listes, accès de ses utilisateurs).
create or replace function public.console_supprime_bureau(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if exists (select 1 from public.acces a where a.bureau_id = p_bureau and a.super_admin) then
    raise exception 'Le super admin est rattaché à ce bureau : rattache-le d''abord à un autre bureau.';
  end if;
  delete from public.bureaux x where x.id = p_bureau;
  if not found then
    raise exception 'Ce bureau n''existe plus.';
  end if;
end $$;

-- ------------------------------------------ une adresse depuis le nom ---

-- Minuscules, sans accent, sans espace ni ponctuation (le trait d'union reste).
create or replace function public.simplifie_nom(p text)
returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
           translate(
             replace(replace(replace(replace(
               lower(btrim(coalesce(p, ''))),
               'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'), 'ø', 'o'),
             'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
             'aaaaaaceeeeiiiinooooouuuuyy'),
           '[^a-z0-9-]', '', 'g');
$$;

-- Tony Varin → t.varin@<domaine>. Nul si le nom ou le prénom ne donne rien.
create or replace function public.adresse_depuis_nom(p_prenom text, p_nom text, p_domaine text)
returns text
language sql immutable set search_path = '' as $$
  select case
           when public.simplifie_nom(p_prenom) = '' or public.simplifie_nom(p_nom) = ''
             or btrim(coalesce(p_domaine, '')) = '' then null
           else left(public.simplifie_nom(p_prenom), 1) || '.' ||
                public.simplifie_nom(p_nom) || '@' || lower(btrim(p_domaine))
         end;
$$;

-- ------------------------------------------ enregistrer une personne ---


-- Fiche du membre et accès en une fois. Renvoie l'id du membre (nul si la
-- ligne n'est qu'un accès, sans fiche au planning).
--   { id, bureauId, prenom, nom, metier, statuts, succursale, discipline,
--     capacite, jours, actif, avecFiche, email, avecAcces, accesActif }
-- « jours » : cinq poids du lundi au vendredi (1, 0.5 ou 0), ou nul pour une
-- semaine pleine. Sans la clé, la semaine type reste en place.
-- « metier » est accepté sous son ancien nom « role » : une console restée en
-- cache dans un navigateur continue d'enregistrer sans rien effacer. De même,
-- l'absence de la clé « statuts » laisse les statuts en place ; une liste vide
-- les retire.
create or replace function public.console_enregistre_personne(p jsonb)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id        uuid    := nullif(p ->> 'id', '')::uuid;
  v_bureau    uuid    := nullif(p ->> 'bureauId', '')::uuid;
  v_prenom    text    := btrim(coalesce(p ->> 'prenom', ''));
  v_nom       text    := btrim(coalesce(p ->> 'nom', ''));
  v_metier    text    := nullif(btrim(coalesce(p ->> 'metier', p ->> 'role', '')), '');
  v_succ      text    := nullif(btrim(coalesce(p ->> 'succursale', '')), '');
  v_disc      text    := nullif(btrim(coalesce(p ->> 'discipline', '')), '');
  v_capacite  numeric := coalesce(nullif(p ->> 'capacite', '')::numeric, 5);
  v_actif     boolean := coalesce((p ->> 'actif')::boolean, true);
  v_fiche     boolean := coalesce((p ->> 'avecFiche')::boolean, true);
  v_email     text    := lower(btrim(coalesce(p ->> 'email', '')));
  v_acces     boolean := coalesce((p ->> 'avecAcces')::boolean, false);
  v_ac_actif  boolean := coalesce((p ->> 'accesActif')::boolean, false);
  v_statuts   text[];
  v_jours     numeric[];
  v_ancien    text;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if v_bureau is null or not exists (select 1 from public.bureaux x where x.id = v_bureau) then
    raise exception 'Choisis le bureau de cette personne.';
  end if;
  if not v_fiche and not v_acces then
    raise exception 'Une personne sans fiche au planning et sans accès n''a rien à enregistrer.';
  end if;

  -- L'ancien rôle « administrateur » arrive encore d'une console en cache :
  -- il vaut ingénieur, et il ajoute le statut.
  if v_metier = 'administrateur' then
    v_metier := 'ingenieur';
    if not p ? 'statuts' then
      v_statuts := array['administrateur'];
    end if;
  end if;

  -- Les statuts : nettoyés, dédoublonnés, rangés dans l'ordre de la hiérarchie.
  if v_statuts is null and p ? 'statuts' then
    select coalesce(array_agg(d.s order by array_position(
             array['administrateur', 'chef_secteur', 'chef_projet']::text[], d.s)), '{}')
      into v_statuts
      from (select distinct btrim(x.valeur) as s
              from jsonb_array_elements_text(
                     case when jsonb_typeof(p -> 'statuts') = 'array' then p -> 'statuts' else '[]'::jsonb end
                   ) as x(valeur)) d
     where d.s in ('administrateur', 'chef_secteur', 'chef_projet');
  end if;

  -- ------------------------------------------------------------ la fiche ---
  if v_fiche then
    if v_prenom = '' then raise exception 'Le prénom est obligatoire.'; end if;
    if v_nom    = '' then raise exception 'Le nom est obligatoire.';    end if;
    if v_metier is not null and v_metier not in ('ingenieur', 'dessinateur', 'administratif') then
      raise exception 'Métier inconnu.';
    end if;
    if not (v_capacite >= 0.5 and v_capacite <= 7) then
      raise exception 'La capacité doit être comprise entre 0,5 et 7 jours par semaine.';
    end if;
    -- La semaine type : cinq poids, une semaine pleine ne se retient pas
    if jsonb_typeof(p -> 'jours') = 'array' then
      select array_agg(case when x.v::numeric >= 0.75 then 1 when x.v::numeric >= 0.25 then 0.5 else 0 end
                       order by x.n)
        into v_jours
        from jsonb_array_elements_text(p -> 'jours') with ordinality as x(v, n);
      if cardinality(v_jours) <> 5 then
        raise exception 'La semaine type compte cinq jours, du lundi au vendredi.';
      end if;
      if v_jours <@ array[1]::numeric[] then
        v_jours := null;
      elsif not v_jours && array[0.5, 1]::numeric[] then
        raise exception 'Coche au moins un jour travaillé.';
      end if;
    end if;
    if v_jours is not null
       and v_capacite > (select sum(x) from unnest(v_jours) as x) then
      raise exception 'La capacité dépasse les jours travaillés.';
    end if;
    if v_succ is not null and not exists (
         select 1 from public.succursales s where s.bureau_id = v_bureau and s.code = v_succ) then
      raise exception 'Cette succursale n''existe pas dans ce bureau.';
    end if;
    if v_disc is not null and not exists (
         select 1 from public.disciplines d where d.bureau_id = v_bureau and d.code = v_disc) then
      raise exception 'Cette discipline n''existe pas dans ce bureau.';
    end if;

    if v_id is null then
      insert into public.membres (bureau_id, prenom, nom, metier, statuts, succursale, discipline, capacite, jours, actif)
      values (v_bureau, v_prenom, v_nom, v_metier, coalesce(v_statuts, '{}'),
              v_succ, v_disc, round(v_capacite, 1), v_jours, v_actif)
      returning id into v_id;
    else
      update public.membres m
         set bureau_id = v_bureau, prenom = v_prenom, nom = v_nom, metier = v_metier,
             statuts = coalesce(v_statuts, m.statuts),
             succursale = v_succ, discipline = v_disc, capacite = round(v_capacite, 1),
             jours = case when p ? 'jours' then v_jours else m.jours end,
             actif = v_actif
       where m.id = v_id;
      if not found then
        raise exception 'Cette personne n''existe plus.';
      end if;
    end if;
  end if;

  -- ------------------------------------------------------------- l'accès ---
  if v_id is not null then
    select a.email into v_ancien from public.acces a where a.membre_id = v_id;
  end if;

  if not v_acces then
    -- L'accès est retiré : la fiche reste, la personne ne se connecte plus.
    if v_ancien is not null then
      if exists (select 1 from public.acces a where a.email = v_ancien and a.super_admin) then
        raise exception 'Le super admin ne peut pas perdre son accès depuis la console.';
      end if;
      delete from public.acces a where a.email = v_ancien;
    end if;
    return v_id;
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'Cette adresse e-mail n''est pas valide.';
  end if;

  -- L'adresse est la clé du compte de connexion : elle ne peut plus bouger
  -- une fois le compte créé, sinon la personne ne se reconnaîtrait plus.
  if v_ancien is not null and v_ancien is distinct from v_email
     and exists (select 1 from auth.users u where lower(u.email) = v_ancien) then
    raise exception 'Le compte de % est déjà créé : son adresse ne peut plus changer. Retire son accès, puis crée-lui-en un autre.', v_ancien;
  end if;

  -- L'adresse appartient-elle déjà à quelqu'un d'autre ?
  if exists (select 1 from public.acces a
              where a.email = v_email
                and a.membre_id is not null
                and (v_id is null or a.membre_id <> v_id)) then
    raise exception 'L''adresse % est déjà celle d''une autre personne.', v_email;
  end if;

  if v_ancien is not null and v_ancien is distinct from v_email then
    delete from public.acces a where a.email = v_ancien;
  end if;

  if not v_ac_actif and exists (select 1 from public.acces a where a.email = v_email and a.super_admin) then
    raise exception 'Le super admin ne peut pas être suspendu.';
  end if;

  -- Une adresse déjà inscrite sans fiche (accès créé avant la fiche) est
  -- rattachée à ce membre plutôt que refusée.
  insert into public.acces (email, bureau_id, membre_id, actif)
  values (v_email, v_bureau, v_id, v_ac_actif)
  on conflict (email) do update
    set bureau_id = excluded.bureau_id,
        membre_id = excluded.membre_id,
        actif     = excluded.actif;

  return v_id;
end $$;

-- Les droits d'un groupe, dans un bureau. { bureauId, statut, droits: [...] }
-- La liste reçue remplace l'ancienne. Les codes sont acceptés tels quels
-- (lettres, chiffres, souligné) : un droit ajouté plus tard à l'outil n'oblige
-- pas à repasser ici.
create or replace function public.console_enregistre_droits(p jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_bureau uuid := nullif(p ->> 'bureauId', '')::uuid;
  v_statut text := btrim(coalesce(p ->> 'statut', ''));
  v_droits text[];
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if v_bureau is null or not exists (select 1 from public.bureaux x where x.id = v_bureau) then
    raise exception 'Ce bureau n''existe pas.';
  end if;
  if v_statut not in ('administrateur', 'chef_secteur', 'chef_projet') then
    raise exception 'Groupe inconnu.';
  end if;

  select coalesce(array_agg(distinct d.code), '{}'::text[])
    into v_droits
    from (select btrim(x.valeur) as code
            from jsonb_array_elements_text(
                   case when jsonb_typeof(p -> 'droits') = 'array' then p -> 'droits' else '[]'::jsonb end
                 ) as x(valeur)) d
   where d.code ~ '^[a-z][a-z0-9_]{0,39}$';

  insert into public.droits_groupes (bureau_id, statut, droits)
  values (v_bureau, v_statut, v_droits)
  on conflict (bureau_id, statut) do update
    set droits = excluded.droits, maj_le = now();
end $$;

-- Supprime une personne : sa fiche, son accès, ses absences, ses équipes.
-- Ses tâches restent, sans affectation.
create or replace function public.console_supprime_membre(p_membre uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if exists (select 1 from public.acces a where a.membre_id = p_membre and a.super_admin) then
    raise exception 'Le super admin ne peut pas être supprimé depuis la console.';
  end if;
  delete from public.acces  a where a.membre_id = p_membre;
  delete from public.membres m where m.id = p_membre;
  if not found then
    raise exception 'Cette personne n''existe plus.';
  end if;
end $$;

-- Retire un accès. Le compte de connexion reste, mais n'ouvre plus rien.
create or replace function public.console_supprime_utilisateur(p_email text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if exists (select 1 from public.acces a where a.email = v_email and a.super_admin) then
    raise exception 'Le super admin ne peut pas être retiré depuis la console.';
  end if;
  delete from public.acces a where a.email = v_email;
  if not found then
    raise exception 'Cet accès n''existe plus.';
  end if;
end $$;

-- ============================================== garde des comptes (hook) ==
-- Appelée par Supabase Auth avant de créer un compte (inscription, lien par
-- courriel) : seules les adresses de la liste des accès passent. À activer
-- dans Authentication > Auth Hooks > Before User Created (Postgres,
-- schéma public, fonction garde_creation_compte).
create or replace function public.garde_creation_compte(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (
    select 1
    from public.acces a
    join public.bureaux b on b.id = a.bureau_id
    where a.email = lower(btrim(coalesce(event -> 'user' ->> 'email', '')))
      and a.actif
      and (b.actif or a.super_admin)
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Adresse non autorisée : demande l''accès à l''administrateur de l''outil.'));
end $$;

-- ================================================================= droits ==
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.est_super_admin()', 'public.bureau_courant()', 'public.bureau_par_defaut()', 'public.est_autorise()',
    'public.mon_membre()', 'public.mes_droits()', 'public.a_droit(text)',
    'public.mon_profil()', 'public.choisit_bureau(uuid)', 'public.presence(text, bigint, boolean, boolean)',
    'public.regle_jours(uuid, jsonb)', 'public.regle_profil(uuid, text, text, text)', 'public.peut_valider_conge(uuid)', 'public.decide_conge(uuid, boolean, text)',
    'public.console_etat()', 'public.console_enregistre_bureau(jsonb)', 'public.console_supprime_bureau(uuid)',
    'public.console_enregistre_personne(jsonb)', 'public.console_supprime_membre(uuid)',
    'public.console_supprime_utilisateur(text)', 'public.console_enregistre_droits(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function public.simplifie_nom(text) from public, anon;
revoke all on function public.adresse_depuis_nom(text, text, text) from public, anon;

revoke all on function public.bureau_cree_reglages() from public, anon, authenticated;
revoke all on function public.garde_creation_compte(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.garde_creation_compte(jsonb) to supabase_auth_admin;

-- ================================================ démo : réinitialisation ===
-- Bouton « Réinitialiser la démo » de la console.
-- ------------------------------------------------ remplissage du jeu de démo --
-- Interne : appelée par console_reinitialise_demo, jamais par l'API.
-- bureau_id est donné partout : la valeur par défaut suivrait le bureau
-- affiché par le super admin, pas le Bureau de test.
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

-- ------------------------------------------------------- réinitialisation --
create or replace function public.console_reinitialise_demo()
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  n        int;
  v_bureau uuid;
  v_membre uuid;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;

  select count(*), min(b.id::text)::uuid into n, v_bureau from public.bureaux b where b.nom = 'Bureau de test';
  if n = 0 then
    raise exception 'Aucun bureau nommé « Bureau de test ».';
  elsif n > 1 then
    raise exception 'Plusieurs bureaux s''appellent « Bureau de test » : en renommer un.';
  end if;

  -- Tout ce qu'un testeur a pu toucher
  delete from public.affaires where bureau_id = v_bureau;   -- tâches et équipes suivent
  delete from public.absences where bureau_id = v_bureau;
  delete from public.avis     where bureau_id = v_bureau;
  delete from public.contacts where bureau_id = v_bureau;
  delete from public.membres  where bureau_id = v_bureau and email like '%@demo.exemple.ch';

  perform public.remplit_demo(v_bureau);

  -- Le compte de démonstration retrouve sa fiche
  select m.id into v_membre from public.membres m
   where m.bureau_id = v_bureau and m.email = 'laurent.mercier@demo.exemple.ch';
  update public.acces set membre_id = v_membre
   where email = 'demo@str-bim-tools.com' and bureau_id = v_bureau;

  return jsonb_build_object(
    'membres',  (select count(*) from public.membres  where bureau_id = v_bureau),
    'affaires', (select count(*) from public.affaires where bureau_id = v_bureau),
    'taches',   (select count(*) from public.taches   where bureau_id = v_bureau),
    'absences', (select count(*) from public.absences where bureau_id = v_bureau));
end $$;
revoke execute on function public.console_reinitialise_demo() from public, anon;
grant execute on function public.console_reinitialise_demo() to authenticated;


-- ===================================================================== Visas ==
-- L'outil /visas/, à part de la planification : les exports « Tableau de suivi »
-- de la GED Kairnial et les plans cochés « Traité ». Il est ouvert à toute
-- personne qui a l'adresse de l'outil, SANS CONNEXION : le rôle anon (la clé
-- publiable seule) lit, dépose, coche et retire. C'est la seule exception à
-- « la clé publiable n'ouvre rien » : ces trois tables et le seau « visas ».
-- Exports et coches ne se modifient pas (pas d'update) : un export se dépose
-- ou se retire, une coche se pose ou s'enlève. Les bornes des colonnes limitent ce qu'un inconnu
-- peut y glisser ; le seau n'accepte que des classeurs .xlsx de 25 Mo au plus.
create table if not exists public.visas_exports (
  id          uuid primary key default gen_random_uuid(),
  chemin      text not null unique
              check (char_length(chemin) <= 200 and chemin ~ '^[A-Za-z0-9/_-]+\.xlsx$'),
  nom         text not null default '' check (char_length(nom) <= 255),
  taille      bigint not null default 0 check (taille between 0 and 26214400),
  depose_le   timestamptz not null default now(),
  edition     timestamp,
  projet      text not null default '' check (char_length(projet) <= 100),
  nb_plans    integer not null default 0 check (nb_plans >= 0),
  nb_indices  integer not null default 0 check (nb_indices >= 0),
  nb_visas    integer not null default 0 check (nb_visas >= 0)
);
create index if not exists visas_exports_depose on public.visas_exports (depose_le desc);
comment on column public.visas_exports.edition is
  '« Date édition » écrite par Kairnial dans le fichier : l''heure à laquelle l''export a été tiré, heure locale.';

-- Plans cochés « Traité », par numéro et indice : un nouvel indice redevient
-- « à traiter ». Décocher efface la ligne.
create table if not exists public.visas_coches (
  code        text not null check (char_length(code) between 1 and 200),
  indice      integer not null default 0 check (indice between 0 and 9999),
  traite_le   timestamptz not null default now(),
  primary key (code, indice)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visas', 'visas', false, 26214400,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.visas_exports enable row level security;
alter table public.visas_coches  enable row level security;
revoke all on public.visas_exports, public.visas_coches from anon, authenticated;
grant select, insert, delete on public.visas_exports, public.visas_coches to anon, authenticated;

drop policy if exists "visas : lecture" on public.visas_exports;
drop policy if exists "visas : dépôt"   on public.visas_exports;
drop policy if exists "visas : retrait" on public.visas_exports;
create policy "visas : lecture" on public.visas_exports for select to anon, authenticated using (true);
create policy "visas : dépôt"   on public.visas_exports for insert to anon, authenticated
  with check (depose_le between now() - interval '5 minutes' and now() + interval '5 minutes');
create policy "visas : retrait" on public.visas_exports for delete to anon, authenticated using (true);

drop policy if exists "visas : lecture" on public.visas_coches;
drop policy if exists "visas : coche"   on public.visas_coches;
drop policy if exists "visas : retrait" on public.visas_coches;
create policy "visas : lecture" on public.visas_coches for select to anon, authenticated using (true);
create policy "visas : coche"   on public.visas_coches for insert to anon, authenticated
  with check (traite_le between now() - interval '5 minutes' and now() + interval '5 minutes');
create policy "visas : retrait" on public.visas_coches for delete to anon, authenticated using (true);

-- Les fichiers du seau : mêmes droits, sans connexion
drop policy if exists "visas : lecture" on storage.objects;
drop policy if exists "visas : dépôt"   on storage.objects;
drop policy if exists "visas : retrait" on storage.objects;
create policy "visas : lecture" on storage.objects for select to anon, authenticated using (bucket_id = 'visas');
create policy "visas : dépôt"   on storage.objects for insert to anon, authenticated with check (bucket_id = 'visas');
create policy "visas : retrait" on storage.objects for delete to anon, authenticated using (bucket_id = 'visas');

-- Annotations : une zone de texte libre par plan (numéro), commune à tous et
-- gardée d'un indice et d'un export à l'autre. Vider la zone efface la ligne.
-- Ici, une annotation se modifie : la dernière écriture l'emporte, et la base
-- pose elle-même l'heure de la modification.
create table if not exists public.visas_notes (
  code        text primary key check (char_length(code) between 1 and 200),
  texte       text not null check (char_length(texte) between 1 and 4000),
  modifie_le  timestamptz not null default now()
);

create or replace function public.visas_note_horodate()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.modifie_le := now();
  return new;
end $$;
revoke all on function public.visas_note_horodate() from public, anon, authenticated;
drop trigger if exists visas_note_horodate on public.visas_notes;
create trigger visas_note_horodate before insert or update on public.visas_notes
  for each row execute function public.visas_note_horodate();

alter table public.visas_notes enable row level security;
revoke all on public.visas_notes from anon, authenticated;
grant select, insert, update, delete on public.visas_notes to anon, authenticated;
drop policy if exists "visas : lecture"      on public.visas_notes;
drop policy if exists "visas : écriture"     on public.visas_notes;
drop policy if exists "visas : modification" on public.visas_notes;
drop policy if exists "visas : retrait"      on public.visas_notes;
create policy "visas : lecture"      on public.visas_notes for select to anon, authenticated using (true);
create policy "visas : écriture"     on public.visas_notes for insert to anon, authenticated with check (true);
create policy "visas : modification" on public.visas_notes for update to anon, authenticated using (true) with check (true);
create policy "visas : retrait"      on public.visas_notes for delete to anon, authenticated using (true);


-- ==================================================== mises à jour en direct ==
-- Les pages ouvertes se mettent à jour quand un collègue enregistre
-- (docs/planif/assets/direct.js) : le service Realtime ne diffuse que les
-- tables de cette publication, et à chacun seulement ce que la RLS lui laisse lire.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['taches', 'affaires', 'affaire_membres', 'membres', 'absences', 'avis', 'contacts', 'ao_agenda', 'rendez_vous', 'conges', 'veille_suivi', 'messages', 'reglages'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

-- L'API relit la forme des tables et des fonctions
notify pgrst, 'reload schema';

-- À vérifier en ligne après exécution, avec la clé publiable et sans connexion :
--   lecture  -> 200 et [] (rien ne fuite ; sauf visas_exports, visas_coches et visas_notes, ouvertes)
--   écriture -> 401 « new row violates row-level security policy »
