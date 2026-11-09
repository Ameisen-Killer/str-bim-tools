-- ============================================================================
--  Migration du 09.11.2026 : nouveau droit « Modifier les affaires ».
--  À exécuter une fois dans Supabase › SQL Editor (rejouable).
--  Jusqu'ici, tout le bureau pouvait modifier une affaire existante. Désormais :
--    - modifier une affaire (et son équipe) demande le droit affaires_modifier,
--      ou d'être le responsable de l'affaire ;
--    - le droit est ajouté aux groupes qui ont déjà « Ouvrir une affaire »
--      (Administrateur, Chef de secteur, Chef de projet…), rien ne change pour eux ;
--    - les autres (Tout le monde) voient les affaires en consultation.
--  Ensuite, le droit se coche ou se décoche groupe par groupe dans la console.
-- ============================================================================

begin;

-- 1. Puis-je modifier cette affaire (et son équipe) ?
create or replace function public.peut_modifier_affaire(p_affaire uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.a_droit('affaires_modifier') or public.a_droit('affaires_creer')
      or exists (select 1 from public.affaires a
                  where a.id = p_affaire and a.responsable_id is not null
                    and a.responsable_id = public.mon_membre());
$$;
revoke all on function public.peut_modifier_affaire(uuid) from public, anon;
grant execute on function public.peut_modifier_affaire(uuid) to authenticated;

-- 2. Affaires : la modification passe par le droit ou la responsabilité
drop policy if exists "bureau courant (modification)" on public.affaires;
drop policy if exists "droit de modifier" on public.affaires;
create policy "droit de modifier" on public.affaires for update to authenticated
  using (bureau_id = (select public.bureau_courant())
         and ((select public.a_droit('affaires_modifier'))
              or (responsable_id is not null and responsable_id = (select public.mon_membre()))))
  with check (bureau_id = (select public.bureau_courant()));

-- 3. Équipe d'une affaire : lue par le bureau, écrite par qui peut modifier l'affaire
drop policy if exists "bureau courant" on public.affaire_membres;
drop policy if exists "bureau courant (lecture)" on public.affaire_membres;
drop policy if exists "droit de modifier" on public.affaire_membres;
create policy "bureau courant (lecture)" on public.affaire_membres for select to authenticated
  using (bureau_id = (select public.bureau_courant()));
create policy "droit de modifier" on public.affaire_membres for all to authenticated
  using (bureau_id = (select public.bureau_courant()) and public.peut_modifier_affaire(affaire_id))
  with check (bureau_id = (select public.bureau_courant()) and public.peut_modifier_affaire(affaire_id));

-- 4. Le droit aux groupes qui ouvrent déjà des affaires
update public.droits_groupes
   set droits = array_append(droits, 'affaires_modifier')
 where 'affaires_creer' = any (droits)
   and not ('affaires_modifier' = any (droits));

-- 5. Les groupes d'un bureau neuf partent avec ce droit
create or replace function public.groupes_par_defaut(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'tous', 'Tout le monde', null, 0,
     array['page_tableau', 'page_equipe', 'page_absences', 'page_annuaire', 'page_affaires', 'voir_conges_equipe', 'voir_absences_avenir']),
    (p_bureau, 'administrateur', 'Administrateur', null, 0,
     array['affaires_creer', 'affaires_modifier', 'taches_autrui', 'absences_autrui', 'page_inter', 'conges_tous',
           'news_rediger', 'news_archiver', 'news_supprimer',
           'page_facturation', 'facturation_saisir', 'avancement_tous'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_secteur', 'Chef de secteur', 'administrateur', 0,
     array['affaires_creer', 'affaires_modifier', 'taches_autrui', 'absences_autrui', 'page_affaires', 'page_charge',
           'planning_equipe', 'taches_a_affecter', 'conges_secteur', 'avancement_secteur'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_projet', 'Chef de projet', 'chef_secteur', 0,
     array['affaires_creer', 'affaires_modifier', 'taches_autrui', 'absences_autrui'])
  on conflict (bureau_id, statut) do nothing;
end $$;
revoke all on function public.groupes_par_defaut(uuid) from public, anon, authenticated;

commit;
