-- Planification — groupes et tableau des droits (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque : ce que la console a réglé entre-temps reste en place.
--
-- Les groupes ne sont plus figés à trois : la console en crée, les renomme,
-- les range sous un groupe supérieur et les supprime. Chaque groupe reçoit
-- ses droits case par case ; un groupe a aussi tous les droits des groupes
-- placés sous lui. « Tout le monde » (code tous) est le socle : chaque membre
-- en fait partie, et ses droits passent à tous les groupes.
--
-- Ce qui était écrit en dur devient un droit, distribué comme avant :
--   · pages Tableau de bord, Équipe, Absences, Annuaire → Tout le monde ;
--   · pages Affaires, Charge, Secteurs, planning de toute l'équipe, tâches à
--     affecter, congés de son secteur → Chef de secteur ;
--   · pages Appels d'offres et Affaires transversales, tous les congés →
--     Administrateur ;
--   · retirer les messages des autres au tchat → personne (le super admin
--     passe partout, comme avant).
-- Hiérarchie de départ : Administrateur > Chef de secteur > Chef de projet.
-- ---------------------------------------------------------------------------
begin;

-- ----------------------------------------------------- groupes du bureau ---
alter table public.droits_groupes drop constraint if exists droits_groupes_statut_check;
alter table public.droits_groupes add constraint droits_groupes_statut_check
  check (statut ~ '^[a-z][a-z0-9_]{0,39}$');
alter table public.droits_groupes add column if not exists nom text not null default '';
alter table public.droits_groupes add column if not exists parent text;
alter table public.droits_groupes add column if not exists ordre integer not null default 0;
alter table public.droits_groupes drop constraint if exists droits_groupes_parent_fk;
alter table public.droits_groupes add constraint droits_groupes_parent_fk
  foreign key (bureau_id, parent) references public.droits_groupes (bureau_id, statut)
  on delete set null (parent);
alter table public.droits_groupes drop constraint if exists droits_groupes_parent_check;
alter table public.droits_groupes add constraint droits_groupes_parent_check
  check (parent is distinct from statut and (statut <> 'tous' or parent is null) and parent is distinct from 'tous');
comment on table public.droits_groupes is
  'Groupes de chaque bureau et leurs droits : nom, groupe supérieur (parent), rang parmi ses voisins. Un groupe a aussi les droits des groupes placés sous lui ; « tous » est le socle commun à chaque membre. Lue par les membres du bureau, écrite seulement par la console du super admin.';
comment on column public.droits_groupes.statut is
  'Code du groupe, porté dans membres.statuts. tous : Tout le monde.';

-- Les statuts d'un membre sont les codes de ses groupes (plus de liste figée)
alter table public.membres drop constraint if exists membres_statuts_check;
alter table public.membres add constraint membres_statuts_check
  check (statuts is not null
         and array_position(statuts, null::text) is null
         and array_to_string(statuts, ' ') ~ '^([a-z][a-z0-9_]{0,39}( |$))*$'
         and not ('tous' = any (statuts)));
comment on column public.membres.statuts is
  'Groupes de la personne (codes de droits_groupes), cumulables avec le métier et entre eux. Tableau vide : Tout le monde seulement.';

-- Les groupes d'un bureau neuf, avec leurs droits d'origine
create or replace function public.groupes_par_defaut(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'tous', 'Tout le monde', null, 0,
     array['page_tableau', 'page_equipe', 'page_absences', 'page_annuaire']),
    (p_bureau, 'administrateur', 'Administrateur', null, 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_inter', 'page_transversales', 'conges_tous'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_secteur', 'Chef de secteur', 'administrateur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_affaires', 'page_charge', 'page_secteurs',
           'planning_equipe', 'taches_a_affecter', 'conges_secteur'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_projet', 'Chef de projet', 'chef_secteur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui'])
  on conflict (bureau_id, statut) do nothing;
end $$;
revoke all on function public.groupes_par_defaut(uuid) from public, anon, authenticated;

-- Les trois groupes déjà là : nom, place dans la hiérarchie et droits venus
-- de ce qui était écrit en dur. Seulement au premier passage (nom encore vide) :
-- relancée, la migration ne touche plus aux réglages de la console.
update public.droits_groupes g
   set nom = case g.statut when 'administrateur' then 'Administrateur'
                           when 'chef_secteur' then 'Chef de secteur'
                           when 'chef_projet' then 'Chef de projet' else g.statut end,
       parent = case g.statut when 'chef_secteur' then 'administrateur'
                              when 'chef_projet' then 'chef_secteur' end,
       droits = array(select distinct x from unnest(g.droits || case g.statut
                  when 'administrateur' then array['page_inter', 'page_transversales', 'conges_tous']
                  when 'chef_secteur' then array['page_affaires', 'page_charge', 'page_secteurs',
                                                 'planning_equipe', 'taches_a_affecter', 'conges_secteur']
                  else '{}'::text[] end) as x order by x),
       maj_le = now()
 where g.nom = ''
   and (g.statut <> 'chef_secteur' or exists (select 1 from public.droits_groupes p
                                              where p.bureau_id = g.bureau_id and p.statut = 'administrateur'))
   and (g.statut <> 'chef_projet' or exists (select 1 from public.droits_groupes p
                                             where p.bureau_id = g.bureau_id and p.statut = 'chef_secteur'));
update public.droits_groupes g set nom = g.statut where btrim(g.nom) = '';

-- Ce qui manque encore (bureau sans ses groupes, « Tout le monde »)
select public.groupes_par_defaut(b.id) from public.bureaux b;

alter table public.droits_groupes drop constraint if exists droits_groupes_nom_check;
alter table public.droits_groupes add constraint droits_groupes_nom_check
  check (char_length(btrim(nom)) between 1 and 40);

-- Un bureau neuf part avec ses réglages et ses groupes d'origine
create or replace function public.bureau_cree_reglages()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reglages (bureau_id) values (new.id) on conflict (bureau_id) do nothing;
  perform public.groupes_par_defaut(new.id);
  return new;
end $$;

-- ---------------------------------------------------------- mes droits ---
-- Tous les droits que mes groupes m'accordent : ceux de Tout le monde, ceux de
-- chacun de mes groupes et ceux des groupes placés sous eux, à toute profondeur.
create or replace function public.mes_droits()
returns text[]
language sql stable security definer set search_path = '' as $$
  with recursive moi as (
    select m.bureau_id, m.statuts
      from public.acces a
      join public.membres m on m.id = a.membre_id
     where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and a.actif
  ), portee (bureau_id, statut) as (
    select g.bureau_id, g.statut
      from public.droits_groupes g
      join moi on g.bureau_id = moi.bureau_id
     where g.statut = 'tous' or g.statut = any (moi.statuts)
    union
    select g.bureau_id, g.statut
      from public.droits_groupes g
      join portee p on g.bureau_id = p.bureau_id and g.parent = p.statut
  )
  select coalesce(array_agg(distinct d), '{}'::text[])
    from portee p
    join public.droits_groupes g on g.bureau_id = p.bureau_id and g.statut = p.statut
    cross join lateral unnest(g.droits) as d;
$$;

-- ----------------------------------------------------------------- congés ---
-- Qui décide d'un congé : le droit « tous les congés », ou « les congés de son
-- secteur » pour une personne de la même discipline — jamais pour soi-même ;
-- le super admin, toujours.
create or replace function public.peut_valider_conge(p_membre uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_super_admin() or exists (
    select 1
      from public.membres moi
      join public.membres lui on lui.id = p_membre and lui.bureau_id = moi.bureau_id
     where moi.id = public.mon_membre()
       and moi.id <> lui.id
       and (public.a_droit('conges_tous')
            or (public.a_droit('conges_secteur') and moi.discipline is not null
                and moi.discipline = lui.discipline)));
$$;

-- ------------------------------------------------------------------ tchat ---
drop policy if exists "les siens (suppression)" on public.messages;
create policy "les siens (suppression)" on public.messages for delete to authenticated
  using (bureau_id = (select public.bureau_courant())
         and (auteur_id = (select public.mon_membre()) or (select public.a_droit('tchat_moderer'))));

-- ---------------------------------------------------------- profil connecté ---
-- Les groupes du bureau voyagent avec le profil : noms, hiérarchie, droits.
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
    'groupes', coalesce((
        select jsonb_agg(jsonb_build_object('code', g.statut, 'nom', g.nom, 'parent', g.parent,
                                            'ordre', g.ordre, 'droits', to_jsonb(g.droits))
               order by g.ordre, g.nom)
        from public.droits_groupes g where g.bureau_id = v_bureau.id), '[]'::jsonb),
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

-- ---------------------------------------------------------------- console ---
-- Les groupes de chaque bureau, en plus de leurs droits
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
          'groupes', coalesce((
              select jsonb_agg(jsonb_build_object('code', g.statut, 'nom', g.nom, 'parent', g.parent,
                                                  'ordre', g.ordre, 'droits', to_jsonb(g.droits))
                     order by g.ordre, g.nom)
              from public.droits_groupes g where g.bureau_id = b.id), '[]'::jsonb),
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

-- ----------------------------------------------------- console : groupes ---
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
  if not exists (select 1 from public.droits_groupes g where g.bureau_id = v_bureau and g.statut = v_statut) then
    raise exception 'Ce groupe n''existe plus.';
  end if;

  select coalesce(array_agg(distinct d.code), '{}'::text[])
    into v_droits
    from (select btrim(x.valeur) as code
            from jsonb_array_elements_text(
                   case when jsonb_typeof(p -> 'droits') = 'array' then p -> 'droits' else '[]'::jsonb end
                 ) as x(valeur)) d
   where d.code ~ '^[a-z][a-z0-9_]{0,39}$';

  update public.droits_groupes g
     set droits = v_droits, maj_le = now()
   where g.bureau_id = v_bureau and g.statut = v_statut;
end $$;

-- Crée ou modifie un groupe. { bureauId, code, nom, parent }
-- Sans code : un groupe neuf, sans droits, rangé en dernier sous son
-- supérieur. « parent » : code du groupe supérieur, vide pour un groupe de
-- tête ; absent, la place ne change pas. Renvoie le code du groupe.
create or replace function public.console_enregistre_groupe(p jsonb)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_bureau uuid := nullif(p ->> 'bureauId', '')::uuid;
  v_code   text := nullif(btrim(coalesce(p ->> 'code', '')), '');
  v_nom    text := regexp_replace(btrim(coalesce(p ->> 'nom', '')), '\s+', ' ', 'g');
  v_parent text := nullif(btrim(coalesce(p ->> 'parent', '')), '');
  v_place  boolean := p ? 'parent';
  v_g      public.droits_groupes%rowtype;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if v_bureau is null or not exists (select 1 from public.bureaux x where x.id = v_bureau) then
    raise exception 'Ce bureau n''existe pas.';
  end if;
  if v_nom = '' then
    raise exception 'Donne un nom au groupe.';
  end if;
  if char_length(v_nom) > 40 then
    raise exception 'Nom trop long (40 caractères au plus).';
  end if;
  if exists (select 1 from public.droits_groupes g
              where g.bureau_id = v_bureau and lower(g.nom) = lower(v_nom)
                and g.statut is distinct from v_code) then
    raise exception 'Un groupe porte déjà ce nom.';
  end if;

  if v_code is not null then
    select * into v_g from public.droits_groupes g where g.bureau_id = v_bureau and g.statut = v_code;
    if not found then
      raise exception 'Ce groupe n''existe plus.';
    end if;
  end if;

  if v_place and v_parent is not null then
    if v_code = 'tous' then
      raise exception '« Tout le monde » reste le socle : il ne se range sous aucun groupe.';
    end if;
    if v_parent = 'tous' then
      raise exception 'Aucun groupe ne se range sous « Tout le monde » : tous en héritent déjà.';
    end if;
    if not exists (select 1 from public.droits_groupes g where g.bureau_id = v_bureau and g.statut = v_parent) then
      raise exception 'Le groupe supérieur n''existe plus.';
    end if;
    -- Pas de boucle : le supérieur ne peut pas être le groupe lui-même ni l'un de ses subordonnés
    if v_code is not null and exists (
      with recursive sous (statut) as (
        select v_code
        union
        select g.statut from public.droits_groupes g join sous s on g.parent = s.statut
         where g.bureau_id = v_bureau)
      select 1 from sous where statut = v_parent) then
      raise exception 'Un groupe ne se range ni sous lui-même ni sous l''un de ses subordonnés.';
    end if;
  end if;

  if v_code is null then
    v_code := 'g_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits)
    values (v_bureau, v_code, v_nom, v_parent,
            coalesce((select max(g.ordre) + 1 from public.droits_groupes g
                       where g.bureau_id = v_bureau and g.parent is not distinct from v_parent
                         and g.statut <> 'tous'), 0),
            '{}');
  else
    update public.droits_groupes g
       set nom = v_nom,
           parent = case when v_place then v_parent else g.parent end,
           ordre = case when v_place and v_parent is distinct from g.parent
                        then coalesce((select max(x.ordre) + 1 from public.droits_groupes x
                                        where x.bureau_id = v_bureau and x.parent is not distinct from v_parent
                                          and x.statut <> 'tous'), 0)
                        else g.ordre end,
           maj_le = now()
     where g.bureau_id = v_bureau and g.statut = v_code;
  end if;
  return v_code;
end $$;

-- Range des groupes voisins. { bureauId, codes: [...] } : chacun prend le rang
-- de sa place dans la liste.
create or replace function public.console_ordonne_groupes(p jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_bureau uuid := nullif(p ->> 'bureauId', '')::uuid;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  update public.droits_groupes g
     set ordre = x.rang - 1, maj_le = now()
    from jsonb_array_elements_text(
           case when jsonb_typeof(p -> 'codes') = 'array' then p -> 'codes' else '[]'::jsonb end
         ) with ordinality as x(code, rang)
   where g.bureau_id = v_bureau and g.statut = x.code;
end $$;

-- Supprime un groupe. Ses membres le quittent (ils gardent leurs autres
-- groupes) ; les groupes rangés sous lui remontent d'un cran.
create or replace function public.console_supprime_groupe(p_bureau uuid, p_code text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_g public.droits_groupes%rowtype;
begin
  if not public.est_super_admin() then
    raise exception 'Console réservée au super admin.';
  end if;
  if p_code = 'tous' then
    raise exception '« Tout le monde » ne se supprime pas : c''est le socle de chaque membre.';
  end if;
  select * into v_g from public.droits_groupes g where g.bureau_id = p_bureau and g.statut = p_code;
  if not found then
    raise exception 'Ce groupe n''existe plus.';
  end if;
  update public.droits_groupes g set parent = v_g.parent, maj_le = now()
   where g.bureau_id = p_bureau and g.parent = p_code;
  update public.membres m set statuts = array_remove(m.statuts, p_code), maj_le = now()
   where m.bureau_id = p_bureau and p_code = any (m.statuts);
  delete from public.droits_groupes g where g.bureau_id = p_bureau and g.statut = p_code;
end $$;

-- Une personne : ses groupes doivent exister dans son bureau
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

  -- Les groupes : nettoyés, dédoublonnés, seulement ceux du bureau (Tout le
  -- monde n'a pas à être coché : chacun en fait partie).
  if v_statuts is null and p ? 'statuts' then
    select coalesce(array_agg(d.s order by g.ordre, g.nom), '{}')
      into v_statuts
      from (select distinct btrim(x.valeur) as s
              from jsonb_array_elements_text(
                     case when jsonb_typeof(p -> 'statuts') = 'array' then p -> 'statuts' else '[]'::jsonb end
                   ) as x(valeur)) d
      join public.droits_groupes g on g.bureau_id = v_bureau and g.statut = d.s
     where d.s <> 'tous';
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.console_enregistre_groupe(jsonb)', 'public.console_ordonne_groupes(jsonb)',
    'public.console_supprime_groupe(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
