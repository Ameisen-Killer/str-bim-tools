-- ============================================================================
--  Outil de planification — des droits accordés à des groupes
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  AVANT : toute personne autorisée pouvait tout faire dans son bureau.
--
--  APRÈS : trois groupes — administrateurs, chefs de secteur, chefs de projet —
--  reçoivent des droits, cochés depuis la console (section « Droits »). Qui ne
--  porte aucun de ces statuts est un utilisateur « lambda » : il travaille sur
--  ce qui le concerne, et rien d'autre.
--
--  Les trois premiers droits :
--    · affaires_creer   — ouvrir une nouvelle affaire (et la retirer) ;
--    · taches_autrui    — créer et modifier une tâche qui ne le concerne pas ;
--    · absences_autrui  — poser une absence pour quelqu'un d'autre.
--
--  Sans droit, un lambda peut quand même :
--    · créer et modifier une tâche dont une part chargée est la sienne — il y
--      désigne librement qui tient l'autre part (un ingénieur confie le dessin,
--      un dessinateur nomme son ingénieur) ;
--    · gérer ses propres absences ;
--    · travailler normalement sur les affaires existantes.
--
--  Les droits ne sont pas qu'un habillage de l'interface : ils sont appliqués
--  par la base (RLS). Une requête directe hors de l'outil se heurte aux mêmes
--  règles. Le super admin, lui, passe partout.
--
--  ORDRE À RESPECTER
--    1. migration-roles-statuts.sql (métier et statuts) ;
--    2. cocher les statuts dans la console — au moins les associés ;
--    3. ce fichier.
--  Les deux garde-fous en tête refusent de continuer si l'ordre n'est pas tenu :
--  sans statut coché, tout le bureau deviendrait lambda d'un coup.
--
--  À l'installation, les trois groupes reçoivent les trois droits : c'est un
--  point de départ, tu décoches ce que tu veux depuis la console.
-- ============================================================================

begin;

-- ------------------------------------------------------------ garde-fous ---
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'membres' and column_name = 'statuts') then
    raise exception 'Exécute d''abord migration-roles-statuts.sql : les statuts n''existent pas encore.';
  end if;
  -- Relance après coup : la table est déjà là, on ne redemande pas de cocher.
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'droits_groupes')
     and not exists (select 1 from public.membres m where cardinality(m.statuts) > 0) then
    raise exception 'Personne ne porte encore de statut : coche au moins les administrateurs dans la console (colonne « Statuts »), puis relance ce fichier. Sans cela, tout le bureau deviendrait utilisateur lambda.';
  end if;
end $$;

-- -------------------------------------------------- les droits d'un groupe ---
-- Une ligne par bureau et par groupe ; la liste des droits est ouverte, pour
-- qu'un nouveau droit n'oblige pas à repasser par une migration. L'outil ne
-- connaît que les codes qu'il sait appliquer, un code inconnu ne fait rien.
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
  'Ce que chaque groupe a le droit de faire, bureau par bureau. Lue par tous les membres du bureau, écrite seulement par la console du super admin.';

-- Point de départ : les trois groupes reçoivent les trois droits.
insert into public.droits_groupes (bureau_id, statut, droits)
select b.id, s, array['affaires_creer', 'taches_autrui', 'absences_autrui']
  from public.bureaux b,
       unnest(array['administrateur', 'chef_secteur', 'chef_projet']) as s
on conflict (bureau_id, statut) do nothing;

-- Un bureau créé plus tard part avec les mêmes droits que les autres.
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

-- ------------------------------------------------- qui suis-je, que puis-je ---

-- La fiche d'équipe derrière l'adresse connectée (vide : accès sans fiche).
create or replace function public.mon_membre()
returns uuid
language sql stable security definer set search_path = '' as $$
  select a.membre_id
    from public.acces a
   where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
     and a.actif;
$$;

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

-- ============================================================ sécurité (RLS) ==
-- Les politiques « for all » des trois tables se scindent : lire reste ouvert
-- à tout le bureau, écrire dépend du droit ou de ce qui me concerne.

alter table public.droits_groupes enable row level security;
drop policy if exists "bureau courant (lecture)" on public.droits_groupes;
create policy "bureau courant (lecture)" on public.droits_groupes for select to authenticated
  using (bureau_id = (select public.bureau_courant()));

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname from pg_policies
     where schemaname = 'public' and tablename in ('affaires', 'taches', 'absences')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- ---- affaires : lire et travailler dessus pour tous, ouvrir et retirer non ---
create policy "bureau courant (lecture)" on public.affaires for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "bureau courant (modification)" on public.affaires for update to authenticated
  using (bureau_id = (select public.bureau_courant()))
  with check (bureau_id = (select public.bureau_courant()));
-- Retirer une affaire emporte ses tâches : le même droit que pour l'ouvrir.
create policy "droit de créer" on public.affaires for insert to authenticated
  with check (bureau_id = (select public.bureau_courant())
              and (select public.a_droit('affaires_creer')));
create policy "droit de retirer" on public.affaires for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (select public.a_droit('affaires_creer')));

-- ---- tâches : celles qui me concernent, ou le droit -------------------------
-- « Me concerner », c'est tenir une part chargée de la tâche : l'ingénieur
-- d'une tâche qui a du calcul, le dessinateur d'une tâche qui a du dessin.
-- Se mettre au calcul d'une tâche sans calcul ne serait pas s'y mettre.
create policy "bureau courant (lecture)" on public.taches for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "droit ou ma tâche (création)" on public.taches for insert to authenticated
  with check (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)));
-- Une part chargée que personne ne tient reste prenable par tout le monde :
-- c'est le geste du tableau de bord, « glisser une barre à affecter sur un
-- membre ». Le WITH CHECK impose qu'à l'arrivée on soit bien dessus — on prend
-- du travail, on n'en donne pas.
create policy "droit ou ma tâche (modification)" on public.taches for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)
    or (ingenieur_id   is null and charge_inge   > 0)
    or (dessinateur_id is null and charge_dessin > 0)))
  with check (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)));
create policy "droit ou ma tâche (suppression)" on public.taches for delete to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)));

-- ---- absences : les miennes, ou le droit ------------------------------------
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

-- ==================================================================== profil ==
-- Les droits de la personne connectée voyagent avec son profil : l'outil sait
-- quoi lui proposer. La base, elle, revérifie tout.
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

-- =================================================================== console ==
-- Les droits de chaque bureau rejoignent l'état de la console.
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
          'droits', coalesce((
              select jsonb_object_agg(g.statut, to_jsonb(g.droits))
              from public.droits_groupes g where g.bureau_id = b.id), '{}'::jsonb),
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

-- ==================================================================== droits ==
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.mon_membre()', 'public.mes_droits()', 'public.a_droit(text)',
    'public.mon_profil()', 'public.console_etat()', 'public.console_enregistre_droits(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function public.bureau_cree_reglages() from public, anon, authenticated;

commit;

-- ================================================================= rapport ==
-- Qui reçoit quoi, et combien de personnes chaque groupe compte.
select b.nom                                       as bureau,
       g.statut                                    as groupe,
       case when cardinality(g.droits) = 0 then 'aucun droit'
            else array_to_string(g.droits, ', ') end as droits,
       (select count(*) from public.membres m
         where m.bureau_id = g.bureau_id and g.statut = any (m.statuts) and m.actif) as personnes
  from public.droits_groupes g
  join public.bureaux b on b.id = g.bureau_id
 order by lower(b.nom),
          array_position(array['administrateur', 'chef_secteur', 'chef_projet'], g.statut);
