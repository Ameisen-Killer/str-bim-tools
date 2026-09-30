-- ============================================================================
--  Outil de planification — jours travaillés de chacun
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Jusqu'ici, la capacité d'un membre (4 j/sem. pour un 80 %) se répartissait
--  à parts égales sur les cinq jours : 0,8 j chaque jour. Quelqu'un qui ne
--  vient jamais le mercredi voyait donc des tâches posées ce jour-là.
--  Chaque fiche porte maintenant sa semaine type, du lundi au vendredi :
--  1 jour plein, 0.5 demi-journée, 0 jour non travaillé. La capacité se répartit
--  sur ces jours, au poids de chacun, et les tâches se calent dessus.
--
--  Les fiches existantes gardent une semaine pleine (colonne nulle) : rien ne
--  bouge à l'écran tant qu'on ne règle pas les jours.
--
--  Chacun règle ses propres jours depuis l'outil (page Équipe, palette) grâce
--  à regle_jours() ; ceux d'un collègue demandent le droit « Poser les absences
--  des autres ». Le super admin les règle aussi depuis la console.
--  Déjà exécutée avant l'arrivée de regle_jours() (30.09.2026) ? La relancer.
-- ============================================================================

alter table public.membres add column if not exists jours numeric(2,1)[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membres_jours_check') then
    alter table public.membres add constraint membres_jours_check
      check (jours is null
             or (cardinality(jours) = 5
                 and array_position(jours, null::numeric) is null
                 and jours <@ array[0, 0.5, 1]::numeric[]
                 and jours && array[0.5, 1]::numeric[]));
  end if;
end $$;

comment on column public.membres.jours is
  'Semaine type du lundi au vendredi (1 plein, 0.5 demi-journée, 0 non travaillé). La capacité se répartit sur ces jours, au poids de chacun. Nul : les cinq jours se valent.';

-- La console lit et enregistre la semaine type
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

revoke all on function public.console_etat() from public, anon;
grant execute on function public.console_etat() to authenticated;
revoke all on function public.console_enregistre_personne(jsonb) from public, anon;
grant execute on function public.console_enregistre_personne(jsonb) to authenticated;
revoke all on function public.regle_jours(uuid, jsonb) from public, anon;
grant execute on function public.regle_jours(uuid, jsonb) to authenticated;

-- Vérification : la colonne existe (toutes les fiches en semaine pleine au premier passage)
select count(*) as membres, count(jours) as avec_semaine_type
  from public.membres;
