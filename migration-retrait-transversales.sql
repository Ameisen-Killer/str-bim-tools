-- Planification — retrait de la page « Affaires transversales » (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Rien ne presse : un droit inconnu est ignoré par
-- l'outil. Le droit « page_transversales » quitte les groupes, et un bureau
-- neuf ne le reçoit plus.
-- ---------------------------------------------------------------------------
begin;

update public.droits_groupes
   set droits = array_remove(droits, 'page_transversales')
 where 'page_transversales' = any (droits);

-- Les groupes d'un bureau neuf, avec leurs droits d'origine
create or replace function public.groupes_par_defaut(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'tous', 'Tout le monde', null, 0,
     array['page_tableau', 'page_equipe', 'page_absences', 'page_annuaire', 'voir_conges_equipe', 'voir_absences_avenir']),
    (p_bureau, 'administrateur', 'Administrateur', null, 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_inter', 'conges_tous',
           'news_rediger', 'news_archiver', 'news_supprimer',
           'page_facturation', 'facturation_saisir', 'avancement_tous'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_secteur', 'Chef de secteur', 'administrateur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_affaires', 'page_charge',
           'planning_equipe', 'taches_a_affecter', 'conges_secteur', 'avancement_secteur'])
  on conflict (bureau_id, statut) do nothing;
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'chef_projet', 'Chef de projet', 'chef_secteur', 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui'])
  on conflict (bureau_id, statut) do nothing;
end $$;
revoke all on function public.groupes_par_defaut(uuid) from public, anon, authenticated;

commit;
