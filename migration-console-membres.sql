-- ============================================================================
--  Migration — les membres se gèrent dans la console
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans Supabase > SQL Editor > New query > Run.
--  Sans effet si elle a déjà été passée : chaque étape se rejoue sans dégât.
--
--  AVANT D'EXÉCUTER : remplacer le domaine d'exemple de la ligne « domaine »
--  ci-dessous par celui des adresses du bureau. Ne pas l'enregistrer dans le
--  dépôt : ce fichier est public.
--
--  Ce qu'elle fait :
--    1. relie un accès à un membre (acces.membre_id) ;
--    2. ferme l'écriture de la table membres à l'outil : seule la console
--       (fonctions security definer) crée, modifie et supprime un membre ;
--    3. remplace console_enregistre_utilisateur par console_enregistre_personne,
--       qui enregistre d'un coup la fiche du membre et son accès ;
--    4. donne à chaque membre actif une adresse et un accès SUSPENDU. Aucun
--       courriel ne part : les liens de bienvenue s'envoient un par un depuis
--       la console, quand tu ouvres l'accès.
--
--  Le rapport de fin de script liste, membre par membre, ce qui a été fait.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- domaine ---
-- ↓↓↓ Remplacer par le domaine des adresses du bureau ↓↓↓
select set_config('planif.domaine', 'exemple.ch', true);

do $$
begin
  if current_setting('planif.domaine') ilike 'exemple.ch' then
    raise exception 'Remplace d''abord le domaine en tête du fichier (ligne set_config), puis relance.';
  end if;
end $$;

-- ================================================ 1. le lien membre ↔ accès ==

alter table public.acces add column if not exists membre_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acces_membre_fk') then
    alter table public.acces add constraint acces_membre_fk
      foreign key (membre_id, bureau_id) references public.membres (id, bureau_id)
      on delete set null (membre_id);
  end if;
end $$;

-- Un membre a au plus un accès. Les accès sans membre (super admin, externe)
-- ne sont pas concernés : l'index ne porte que sur les lignes renseignées.
create unique index if not exists acces_membre_unique
  on public.acces (membre_id) where membre_id is not null;

comment on column public.acces.membre_id is
  'Membre planifié derrière cette adresse. Vide : accès sans fiche au planning (super admin, externe).';

-- ==================================== 2. la table membres passe en lecture ==
-- L'outil lit les membres ; il ne les écrit plus. Créer, modifier, supprimer
-- un membre passe par les fonctions de la console, qui contournent la RLS.

drop policy if exists "bureau courant" on public.membres;
drop policy if exists "bureau courant (lecture)" on public.membres;
create policy "bureau courant (lecture)" on public.membres for select to authenticated
  using (bureau_id = (select public.bureau_courant()));

-- ============================================ 3. fabrication d'une adresse ==

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

-- ==================================== 4. la console enregistre une personne ==

drop function if exists public.console_enregistre_utilisateur(jsonb);

-- Fiche du membre et accès en une fois. Renvoie l'id du membre (nul si la
-- ligne n'est qu'un accès, sans fiche au planning).
--   { id, bureauId, prenom, nom, role, succursale, discipline, capacite,
--     actif, avecFiche, email, avecAcces, accesActif }
create or replace function public.console_enregistre_personne(p jsonb)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id        uuid    := nullif(p ->> 'id', '')::uuid;
  v_bureau    uuid    := nullif(p ->> 'bureauId', '')::uuid;
  v_prenom    text    := btrim(coalesce(p ->> 'prenom', ''));
  v_nom       text    := btrim(coalesce(p ->> 'nom', ''));
  v_role      text    := nullif(btrim(coalesce(p ->> 'role', '')), '');
  v_succ      text    := nullif(btrim(coalesce(p ->> 'succursale', '')), '');
  v_disc      text    := nullif(btrim(coalesce(p ->> 'discipline', '')), '');
  v_capacite  numeric := coalesce(nullif(p ->> 'capacite', '')::numeric, 5);
  v_actif     boolean := coalesce((p ->> 'actif')::boolean, true);
  v_fiche     boolean := coalesce((p ->> 'avecFiche')::boolean, true);
  v_email     text    := lower(btrim(coalesce(p ->> 'email', '')));
  v_acces     boolean := coalesce((p ->> 'avecAcces')::boolean, false);
  v_ac_actif  boolean := coalesce((p ->> 'accesActif')::boolean, false);
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

  -- ------------------------------------------------------------ la fiche ---
  if v_fiche then
    if v_prenom = '' then raise exception 'Le prénom est obligatoire.'; end if;
    if v_nom    = '' then raise exception 'Le nom est obligatoire.';    end if;
    if v_role is not null and v_role not in ('ingenieur', 'dessinateur', 'administrateur', 'administratif') then
      raise exception 'Rôle inconnu.';
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
      insert into public.membres (bureau_id, prenom, nom, role, succursale, discipline, capacite, actif)
      values (v_bureau, v_prenom, v_nom, v_role, v_succ, v_disc, round(v_capacite, 1), v_actif)
      returning id into v_id;
    else
      update public.membres m
         set bureau_id = v_bureau, prenom = v_prenom, nom = v_nom, role = v_role,
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

-- ==================================== 5. la console voit aussi les membres ==

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
    -- Les fiches du planning, avec l'accès de chacune s'il existe
    'membres', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'bureauId', m.bureau_id, 'prenom', m.prenom, 'nom', m.nom,
          'role', m.role, 'succursale', m.succursale, 'discipline', m.discipline,
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

-- ------------------------------------------------------------------ droits ---
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.console_enregistre_personne(jsonb)', 'public.console_supprime_membre(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function public.simplifie_nom(text) from public, anon;
revoke all on function public.adresse_depuis_nom(text, text, text) from public, anon;

-- ================================== 6. les membres d'aujourd'hui deviennent ==
-- ============================================== des personnes de la console ==

-- 6a. Un accès déjà inscrit sous l'adresse d'un membre lui est rattaché.
--     C'est le cas du super admin, dont l'adresse est aussi celle de sa fiche.
update public.acces a
   set membre_id = m.id
  from public.membres m
 where a.membre_id is null
   and m.bureau_id = a.bureau_id
   and lower(btrim(coalesce(m.email, ''))) = a.email
   and not exists (select 1 from public.acces x where x.membre_id = m.id);

-- 6b. Chaque membre actif encore sans accès en reçoit un, SUSPENDU.
--     Adresse : celle de sa fiche si elle est remplie, sinon t.varin@domaine.
--     Sautés : les membres des jeux d'essai (adresses en .exemple.ch), ceux
--     dont l'adresse est déjà prise, et les homonymes qui tomberaient sur la
--     même adresse — le rapport les signale, tu leur en donnes une à la main
--     dans la console.
insert into public.acces (email, bureau_id, membre_id, actif)
select x.adresse, x.bureau_id, x.id, false
  from (
    select m.id, m.bureau_id,
           coalesce(
             nullif(lower(btrim(coalesce(m.email, ''))), ''),
             public.adresse_depuis_nom(m.prenom, m.nom, current_setting('planif.domaine'))
           ) as adresse
      from public.membres m
     where m.actif
       and lower(btrim(coalesce(m.email, ''))) not like '%.exemple.ch'
       and not exists (select 1 from public.acces a where a.membre_id = m.id)
  ) x
 where x.adresse is not null
   and x.adresse ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
   and not exists (select 1 from public.acces a where a.email = x.adresse)
   and 1 = (select count(*)
              from public.membres m2
             where m2.actif
               and lower(btrim(coalesce(m2.email, ''))) not like '%.exemple.ch'
               and not exists (select 1 from public.acces a2 where a2.membre_id = m2.id)
               and coalesce(
                     nullif(lower(btrim(coalesce(m2.email, ''))), ''),
                     public.adresse_depuis_nom(m2.prenom, m2.nom, current_setting('planif.domaine'))
                   ) = x.adresse);

-- La colonne membres.email reste : elle sert de repère aux jeux d'essai, qui
-- s'y retrouvent pour se purger. Ce n'est PAS l'adresse de connexion — celle-ci
-- vit dans acces, et c'est la seule que la console montre.

commit;

-- ================================================================= rapport ==
-- Ce que la console affichera, personne par personne. Aucun courriel n'est
-- parti : les accès créés ici sont suspendus, à ouvrir un par un.
select m.prenom || ' ' || m.nom            as personne,
       coalesce(m.role, '—')               as role,
       case when not m.actif      then 'inactif — pas d''accès'
            when lower(btrim(coalesce(m.email, ''))) like '%.exemple.ch'
                                   then 'jeu d''essai — laissé de côté'
            when a.email is null  then 'AUCUNE ADRESSE : à saisir dans la console'
            else a.email end               as adresse,
       case when a.email is null  then '—'
            when a.super_admin    then 'super admin'
            when a.actif          then 'accès ouvert'
            else 'accès suspendu — à ouvrir quand tu envoies le lien' end as acces
  from public.membres m
  left join public.acces a on a.membre_id = m.id
 order by m.actif desc, lower(m.prenom), lower(m.nom);
