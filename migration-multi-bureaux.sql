-- ============================================================================
--  Outil de planification — plusieurs bureaux d'études et console du super admin
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--
--  AVANT D'EXÉCUTER : remplacer l'adresse d'exemple de la ligne « super admin »
--  ci-dessous par celle avec laquelle tu te connectes à l'outil. Ne pas
--  l'enregistrer dans le dépôt : ce fichier est public. Tant que l'adresse
--  d'exemple est là, le script s'arrête sans rien modifier.
--
--  Ce que fait la migration :
--    - crée la table des bureaux ; toutes les données actuelles rejoignent le
--      bureau n° 1, « Mon bureau », à renommer dans la console ;
--    - chaque membre, absence, affaire, lien d'équipe, tâche et réglage porte
--      son bureau, rempli par la base elle-même : l'outil n'a rien à envoyer ;
--    - la liste des accès devient « adresse → bureau », avec le super admin ;
--    - succursales et disciplines deviennent propres à chaque bureau ; celles
--      d'aujourd'hui sont reprises pour le bureau n° 1 ;
--    - la RLS cloisonne les bureaux : chacun ne voit et ne modifie que le sien ;
--    - la console passe par des fonctions réservées au super admin ;
--    - une garde refuse la création d'un compte de connexion pour une adresse
--      absente de la liste des accès (à activer ensuite dans Authentication >
--      Auth Hooks > « Before User Created », fonction garde_creation_compte).
--
--  L'outil en ligne continue de fonctionner pendant et après l'exécution.
--  Tout se fait dans une transaction : à la moindre erreur, rien n'est modifié.
--  Peut être relancé sans dommage.
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

-- ------------------------------------------------------------ bureau n° 1 ---
-- Première exécution : le bureau d'aujourd'hui est créé, avec les succursales
-- et disciplines que l'outil connaissait jusqu'ici. Exécutions suivantes : on
-- reprend le plus ancien bureau, sans rien réécrire.
do $$
declare
  v_b uuid;
begin
  select id into v_b from public.bureaux order by cree_le, id limit 1;
  if v_b is null then
    insert into public.bureaux (nom) values ('Mon bureau') returning id into v_b;

    insert into public.succursales (bureau_id, code, nom, ordre) values
      (v_b, 'geneve',   'Genève',   1),
      (v_b, 'lausanne', 'Lausanne', 2),
      (v_b, 'nyon',     'Nyon',     3);

    insert into public.disciplines (bureau_id, code, nom, ordre) values
      (v_b, 'administrateurs', 'Administrateurs',                          1),
      (v_b, 'structure',       'Structure et ouvrages d''art',             2),
      (v_b, 'geotechnique',    'Géotechnique / travaux spéciaux',          3),
      (v_b, 'environnement',   'Environnement et développement durable',   4),
      (v_b, 'investigation',   'Investigation géotechnique',               5),
      (v_b, 'genie_civil',     'Génie civil et infrastructures',           6),
      (v_b, 'administration',  'Administration',                           7);

    insert into public.succursale_disciplines (bureau_id, succursale, discipline)
    select v_b, s, d
    from (values
      ('geneve', 'administrateurs'), ('geneve', 'structure'), ('geneve', 'geotechnique'),
      ('geneve', 'environnement'), ('geneve', 'investigation'), ('geneve', 'genie_civil'),
      ('geneve', 'administration'),
      ('lausanne', 'administrateurs'), ('lausanne', 'structure'),
      ('nyon', 'structure')
    ) as v(s, d);
  end if;
  perform set_config('planif.bureau_1', v_b::text, true);
end $$;

-- ----------------------------------------------------------------- accès ---
-- Une ligne par adresse autorisée : son bureau, son état, et pour le super
-- admin le bureau qu'il consulte en ce moment (bureau_actif).
alter table public.acces add column if not exists droit        text not null default 'utilisateur';
alter table public.acces add column if not exists ajoute_le    timestamptz not null default now();
alter table public.acces add column if not exists bureau_id    uuid;
alter table public.acces add column if not exists super_admin  boolean not null default false;
alter table public.acces add column if not exists bureau_actif uuid;
alter table public.acces add column if not exists actif        boolean not null default true;

update public.acces set email = lower(btrim(email)) where email <> lower(btrim(email));
update public.acces set bureau_id = current_setting('planif.bureau_1')::uuid where bureau_id is null;
alter table public.acces alter column bureau_id set not null;

-- Droits : « utilisateur » pour tous ; « responsable » est réservé à une
-- délégation future (gérer les accès de son propre bureau).
alter table public.acces drop constraint if exists acces_droit_check;
update public.acces set droit = 'utilisateur' where droit not in ('utilisateur', 'responsable');
alter table public.acces alter column droit set default 'utilisateur';
alter table public.acces add constraint acces_droit_check check (droit in ('utilisateur', 'responsable'));

alter table public.acces drop constraint if exists acces_email_minuscules;
alter table public.acces add constraint acces_email_minuscules check (email = lower(btrim(email)));

comment on table public.acces is
  'Adresses autorisées à se connecter, chacune rattachée à un bureau. Lue et écrite uniquement par les fonctions de la base (console du super admin).';
comment on column public.acces.bureau_actif is
  'Super admin seulement : bureau affiché dans le planning. Vide : son propre bureau.';

do $$
declare
  n int;
begin
  update public.acces set super_admin = true, actif = true
   where email = lower(btrim(current_setting('planif.super_admin')));
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'L''adresse % n''est pas dans la liste des accès : vérifie son orthographe (c''est celle avec laquelle tu te connectes à l''outil).',
      current_setting('planif.super_admin');
  end if;
end $$;

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

-- ------------------------------------------------ tables de planification ---
-- Chaque ligne reçoit son bureau. La mise à jour de masse ne touche pas aux
-- dates de modification (déclencheurs suspendus le temps du remplissage).
do $$
declare
  t text;
  v_b uuid := current_setting('planif.bureau_1')::uuid;
begin
  foreach t in array array['membres', 'absences', 'affaires', 'affaire_membres', 'taches'] loop
    execute format('alter table public.%I add column if not exists bureau_id uuid', t);
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I set bureau_id = $1 where bureau_id is null', t) using v_b;
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column bureau_id set default public.bureau_par_defaut()', t);
    execute format('alter table public.%I alter column bureau_id set not null', t);
    execute format('create index if not exists %I on public.%I (bureau_id)', t || '_bureau', t);
  end loop;
end $$;

-- Colonnes ajoutées par migration-succursales.sql : présentes, par sécurité
alter table public.membres add column if not exists succursale text;
alter table public.membres add column if not exists discipline text;

-- Les listes figées d'hier cèdent la place aux listes de chaque bureau
alter table public.membres drop constraint if exists membres_succursale_check;
alter table public.membres drop constraint if exists membres_discipline_check;

-- Unicité par bureau : deux bureaux peuvent avoir chacun une affaire « 26-001 »
alter table public.affaires drop constraint if exists affaires_code_key;
alter table public.membres  drop constraint if exists membres_email_key;

-- Réglages : une ligne par bureau
alter table public.reglages add column if not exists bureau_id uuid;
alter table public.reglages disable trigger user;
update public.reglages set bureau_id = current_setting('planif.bureau_1')::uuid where bureau_id is null;
alter table public.reglages enable trigger user;
alter table public.reglages alter column bureau_id set not null;
alter table public.reglages drop constraint if exists reglages_pkey;
alter table public.reglages add constraint reglages_pkey primary key (bureau_id);
alter table public.reglages alter column bureau_id set default public.bureau_par_defaut();
comment on column public.reglages.id is 'Historique (une seule ligne avant les bureaux) : toujours vrai.';

-- Clés étrangères et unicités, ajoutées une seule fois. Les références entre
-- tables incluent le bureau : une tâche ne peut viser que l'affaire et les
-- personnes de son propre bureau.
do $$
declare
  c text[];
begin
  foreach c slice 1 in array array[
    ['acces',           'acces_bureau_fk',               'foreign key (bureau_id) references public.bureaux (id) on delete cascade'],
    ['acces',           'acces_bureau_actif_fk',         'foreign key (bureau_actif) references public.bureaux (id) on delete set null'],
    ['reglages',        'reglages_bureau_fk',            'foreign key (bureau_id) references public.bureaux (id) on delete cascade'],
    ['membres',         'membres_bureau_fk',             'foreign key (bureau_id) references public.bureaux (id) on delete cascade'],
    ['membres',         'membres_id_bureau_key',         'unique (id, bureau_id)'],
    ['membres',         'membres_email_bureau_key',      'unique (bureau_id, email)'],
    ['membres',         'membres_succursale_fk',         'foreign key (bureau_id, succursale) references public.succursales (bureau_id, code) on delete set null (succursale)'],
    ['membres',         'membres_discipline_fk',         'foreign key (bureau_id, discipline) references public.disciplines (bureau_id, code) on delete set null (discipline)'],
    ['affaires',        'affaires_bureau_fk',            'foreign key (bureau_id) references public.bureaux (id) on delete cascade'],
    ['affaires',        'affaires_id_bureau_key',        'unique (id, bureau_id)'],
    ['affaires',        'affaires_code_bureau_key',      'unique (bureau_id, code)'],
    ['absences',        'absences_bureau_fk',            'foreign key (bureau_id) references public.bureaux (id) on delete cascade'],
    ['absences',        'absences_membre_bureau_fk',     'foreign key (membre_id, bureau_id) references public.membres (id, bureau_id) on delete cascade'],
    ['affaire_membres', 'affaire_membres_bureau_fk',     'foreign key (bureau_id) references public.bureaux (id) on delete cascade'],
    ['affaire_membres', 'affaire_membres_affaire_fk',    'foreign key (affaire_id, bureau_id) references public.affaires (id, bureau_id) on delete cascade'],
    ['affaire_membres', 'affaire_membres_membre_fk',     'foreign key (membre_id, bureau_id) references public.membres (id, bureau_id) on delete cascade'],
    ['taches',          'taches_bureau_fk',              'foreign key (bureau_id) references public.bureaux (id) on delete cascade'],
    ['taches',          'taches_affaire_bureau_fk',      'foreign key (affaire_id, bureau_id) references public.affaires (id, bureau_id) on delete cascade'],
    ['taches',          'taches_ingenieur_bureau_fk',    'foreign key (ingenieur_id, bureau_id) references public.membres (id, bureau_id) on delete set null (ingenieur_id)'],
    ['taches',          'taches_dessinateur_bureau_fk',  'foreign key (dessinateur_id, bureau_id) references public.membres (id, bureau_id) on delete set null (dessinateur_id)']
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', c[1])::regclass and conname = c[2]
    ) then
      execute format('alter table public.%I add constraint %I %s', c[1], c[2], c[3]);
    end if;
  end loop;
end $$;

-- Un bureau naît avec sa ligne de réglages (canton, capacité par défaut)
insert into public.reglages (bureau_id) select b.id from public.bureaux b on conflict (bureau_id) do nothing;

create or replace function public.bureau_cree_reglages()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reglages (bureau_id) values (new.id) on conflict (bureau_id) do nothing;
  return new;
end $$;

drop trigger if exists cree_reglages on public.bureaux;
create trigger cree_reglages after insert on public.bureaux
  for each row execute function public.bureau_cree_reglages();

drop trigger if exists maj_le on public.bureaux;
create trigger maj_le before update on public.bureaux
  for each row execute function public.touche_maj_le();

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
  foreach t in array array['membres', 'absences', 'affaires', 'affaire_membres', 'taches', 'reglages',
                           'acces', 'bureaux', 'succursales', 'disciplines', 'succursale_disciplines'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('membres', 'absences', 'affaires', 'affaire_membres', 'taches', 'reglages',
                        'acces', 'bureaux', 'succursales', 'disciplines', 'succursale_disciplines')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;

  foreach t in array array['membres', 'absences', 'affaires', 'affaire_membres', 'taches'] loop
    execute format(
      'create policy "bureau courant" on public.%I for all to authenticated
         using (bureau_id = (select public.bureau_courant()))
         with check (bureau_id = (select public.bureau_courant()))', t);
  end loop;
end $$;

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

  return jsonb_build_object(
    'autorise', true,
    'email', v_email,
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
    'utilisateurs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'email', a.email, 'bureauId', a.bureau_id, 'superAdmin', a.super_admin,
          'actif', a.actif, 'droit', a.droit, 'ajoute', a.ajoute_le,
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

-- Ajoute ou modifie un accès : adresse, bureau, actif ou suspendu
create or replace function public.console_enregistre_utilisateur(p jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email   text := lower(btrim(coalesce(p ->> 'email', '')));
  v_bureau  uuid := nullif(p ->> 'bureauId', '')::uuid;
  v_actif   boolean := coalesce((p ->> 'actif')::boolean, true);
  v_nouveau boolean := coalesce((p ->> 'nouveau')::boolean, false);
  v_nom     text;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'Cette adresse e-mail n''est pas valide.';
  end if;
  if v_bureau is null or not exists (select 1 from public.bureaux x where x.id = v_bureau) then
    raise exception 'Choisis le bureau de cet utilisateur.';
  end if;
  if not v_actif and exists (select 1 from public.acces a where a.email = v_email and a.super_admin) then
    raise exception 'Le super admin ne peut pas être suspendu.';
  end if;
  if v_nouveau then
    select x.nom into v_nom
    from public.acces a join public.bureaux x on x.id = a.bureau_id
    where a.email = v_email;
    if found then
      raise exception 'Cette adresse a déjà un accès, au bureau « % ».', v_nom;
    end if;
  end if;

  insert into public.acces (email, bureau_id, actif) values (v_email, v_bureau, v_actif)
  on conflict (email) do update set bureau_id = excluded.bureau_id, actif = excluded.actif;
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
    'public.mon_profil()', 'public.choisit_bureau(uuid)',
    'public.console_etat()', 'public.console_enregistre_bureau(jsonb)', 'public.console_supprime_bureau(uuid)',
    'public.console_enregistre_utilisateur(jsonb)', 'public.console_supprime_utilisateur(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function public.bureau_cree_reglages() from public, anon, authenticated;
revoke all on function public.garde_creation_compte(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.garde_creation_compte(jsonb) to supabase_auth_admin;

commit;

-- L'API relit la forme des tables et des fonctions, pour que tout soit visible tout de suite
notify pgrst, 'reload schema';

-- Contrôle : bureaux, accès, super admin
select
  (select count(*) from public.bureaux)                         as bureaux,
  (select count(*) from public.acces)                           as acces,
  (select string_agg(email, ', ') from public.acces where super_admin) as super_admin,
  (select count(*) from public.membres  where bureau_id is null) as membres_sans_bureau,
  (select count(*) from public.taches   where bureau_id is null) as taches_sans_bureau;
