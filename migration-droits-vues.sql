-- Planification — deux droits de vue dans Communication (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute au tableau des droits :
--   · voir_conges_equipe   : « Demandes de l'équipe en attente »
--   · voir_absences_avenir : « Absences à venir »
-- Tout le monde les voyait jusqu'ici : ils sont donnés à « Tout le monde »,
-- à retirer ensuite dans la console si besoin. Un bureau neuf les reçoit aussi.
-- ---------------------------------------------------------------------------
begin;

update public.droits_groupes g
   set droits = array(select distinct x from unnest(g.droits || array['voir_conges_equipe', 'voir_absences_avenir']) as x order by x),
       maj_le = now()
 where g.statut = 'tous'
   and not (g.droits && array['voir_conges_equipe', 'voir_absences_avenir']);

-- Les groupes d'un bureau neuf, avec leurs droits d'origine
create or replace function public.groupes_par_defaut(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'tous', 'Tout le monde', null, 0,
     array['page_tableau', 'page_equipe', 'page_absences', 'page_annuaire', 'voir_conges_equipe', 'voir_absences_avenir']),
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

commit;
