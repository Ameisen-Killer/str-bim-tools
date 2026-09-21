-- ============================================================================
--  Outil de planification — la fiche d'équipe derrière l'adresse connectée
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  mon_profil() renvoyait le bureau et les droits, mais pas la fiche du
--  planning rattachée à l'accès (acces.membre_id, posé par la console). Sans
--  elle, l'outil devait deviner « qui suis-je » en comparant l'adresse de
--  connexion à celle de la fiche — ce qui échoue dès qu'elles diffèrent, cas
--  courant : on se connecte avec une adresse et la fiche en porte une autre.
--
--  Après cette migration, les pages Tâches et Tableau de bord s'ouvrent sur
--  les tâches de la personne connectée. Une adresse encore rattachée à aucune
--  fiche garde la vue sur toute l'équipe : le rattachement se fait dans la
--  console, sur la ligne de la personne.
-- ============================================================================

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
    'membreId', v_acces.membre_id,
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
