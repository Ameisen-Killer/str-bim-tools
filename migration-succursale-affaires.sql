-- Planification — succursale des affaires, retrait du module Secteurs (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque.
--  1. Les affaires reçoivent une succursale (facultative). À la création de la
--     colonne seulement, chaque affaire prend celle de son responsable
--     d'affaire (vide s'il n'y en a pas) : une relance ne remet donc rien
--     dans une succursale vidée à la main entre-temps.
--  2. Le droit « page_secteurs » (module Secteurs, retiré) quitte les groupes.
-- ---------------------------------------------------------------------------
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'affaires' and column_name = 'succursale') then
    alter table public.affaires add column succursale text;
    update public.affaires a
       set succursale = m.succursale
      from public.membres m
     where m.id = a.responsable_id
       and m.bureau_id = a.bureau_id
       and m.succursale is not null;
  end if;
end $$;

alter table public.affaires drop constraint if exists affaires_succursale_fk;
alter table public.affaires add constraint affaires_succursale_fk
  foreign key (bureau_id, succursale) references public.succursales (bureau_id, code)
  on delete set null (succursale);
comment on column public.affaires.succursale is 'Code d''une succursale du bureau (table succursales). Vide : non renseignée.';

-- Module Secteurs retiré : son droit n'ouvre plus rien
update public.droits_groupes
   set droits = array_remove(droits, 'page_secteurs')
 where 'page_secteurs' = any (droits);

-- Les groupes d'un bureau neuf, avec leurs droits d'origine
create or replace function public.groupes_par_defaut(p_bureau uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.droits_groupes (bureau_id, statut, nom, parent, ordre, droits) values
    (p_bureau, 'tous', 'Tout le monde', null, 0,
     array['page_tableau', 'page_equipe', 'page_absences', 'page_annuaire', 'voir_conges_equipe', 'voir_absences_avenir']),
    (p_bureau, 'administrateur', 'Administrateur', null, 0,
     array['affaires_creer', 'taches_autrui', 'absences_autrui', 'page_inter', 'page_transversales', 'conges_tous',
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
