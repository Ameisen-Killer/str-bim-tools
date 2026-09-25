-- ============================================================================
--  Outil de planification STR Bim Tools — schéma PostgreSQL pour Supabase
-- ----------------------------------------------------------------------------
--  Installation neuve, en une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Une base déjà en service se met à jour par les fichiers migration-*.sql.
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
--  qui permet de publier cette clé dans un dépôt public.
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
  actif      boolean not null default true,
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
comment on column public.contacts.role is
  'Rôle dans les projets — architecte, maître d''ouvrage, entreprise… Texte libre.';
comment on column public.contacts.natel is
  'Téléphone mobile (suisse romand pour « portable »).';
comment on column public.contacts.npa is
  'Code postal. Texte et non nombre : les NPA étrangers ont des lettres et des zéros en tête.';

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
  foreach t in array array['membres', 'affaires', 'taches', 'contacts', 'reglages'] loop
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
-- accès, succursales et disciplines n'ont aucune politique : seules les
-- fonctions ci-dessous (security definer) les lisent et les écrivent.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['membres', 'absences', 'affaires', 'affaire_membres', 'taches', 'contacts',
                           'reglages', 'droits_groupes', 'acces', 'bureaux', 'succursales', 'disciplines',
                           'succursale_disciplines'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('membres', 'absences', 'affaires', 'affaire_membres', 'taches', 'reglages',
                        'droits_groupes', 'acces', 'bureaux', 'succursales', 'disciplines',
                        'succursale_disciplines')
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
          'capacite', m.capacite, 'actif', m.actif,
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
--     capacite, actif, avecFiche, email, avecAcces, accesActif }
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
    if v_succ is not null and not exists (
         select 1 from public.succursales s where s.bureau_id = v_bureau and s.code = v_succ) then
      raise exception 'Cette succursale n''existe pas dans ce bureau.';
    end if;
    if v_disc is not null and not exists (
         select 1 from public.disciplines d where d.bureau_id = v_bureau and d.code = v_disc) then
      raise exception 'Cette discipline n''existe pas dans ce bureau.';
    end if;

    if v_id is null then
      insert into public.membres (bureau_id, prenom, nom, metier, statuts, succursale, discipline, capacite, actif)
      values (v_bureau, v_prenom, v_nom, v_metier, coalesce(v_statuts, '{}'),
              v_succ, v_disc, round(v_capacite, 1), v_actif)
      returning id into v_id;
    else
      update public.membres m
         set bureau_id = v_bureau, prenom = v_prenom, nom = v_nom, metier = v_metier,
             statuts = coalesce(v_statuts, m.statuts),
             succursale = v_succ, discipline = v_disc, capacite = round(v_capacite, 1), actif = v_actif
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
    'public.mon_profil()', 'public.choisit_bureau(uuid)',
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

commit;

-- L'API relit la forme des tables et des fonctions
notify pgrst, 'reload schema';

-- À vérifier en ligne après exécution, avec la clé publiable et sans connexion :
--   lecture  -> 200 et [] (rien ne fuite)
--   écriture -> 401 « new row violates row-level security policy »
