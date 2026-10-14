-- ============================================================================
--  Planification — retrait de la fiche « Tony Admin » du bureau AB Ingénieurs
-- ----------------------------------------------------------------------------
--  À coller dans Supabase : SQL Editor > New query > Run. Une seule fois.
--
--  Le super admin passe désormais par t.varin@absa.ch : la fiche « Tony
--  Admin » ne sert plus. La console refuse de supprimer une fiche de super
--  admin, d'où ce script. Il retire, dans le bureau AB Ingénieurs :
--    - l'accès (ou les accès) rattaché(s) à la fiche « Tony Admin » ;
--    - la fiche elle-même, avec ses absences, ses demandes de congé et ses
--      équipes d'affaire (suppression en cascade, comme depuis la console).
--  Ses tâches restent, sans affectation ; ses messages et ses news restent,
--  sans auteur.
--
--  Garde-fous : rien n'est fait si t.varin@absa.ch n'est pas un super admin
--  actif, si aucune fiche « Tony Admin » n'est trouvée ou s'il y en a
--  plusieurs, ou si la fiche trouvée est celle de t.varin@absa.ch.
--
--  Le compte de connexion (Authentication > Users) n'est pas touché : sans
--  accès, il n'ouvre plus rien. On peut le supprimer à la main ensuite.
-- ============================================================================

begin;

do $$
declare
  v_bureau uuid;
  v_membre uuid;
  v_nb     int;
  v_acces  int;
begin
  if not exists (select 1 from public.acces
                  where email = 't.varin@absa.ch' and actif and super_admin) then
    raise exception 't.varin@absa.ch n''est pas un super admin actif : rien n''est retiré.';
  end if;

  select id into v_bureau from public.bureaux where lower(btrim(nom)) = 'ab ingénieurs';
  if v_bureau is null then
    raise exception 'Bureau « AB Ingénieurs » introuvable.';
  end if;

  select count(*), min(id::text)::uuid into v_nb, v_membre
    from public.membres
   where bureau_id = v_bureau
     and lower(btrim(prenom)) = 'tony' and lower(btrim(nom)) = 'admin';
  if v_nb = 0 then
    raise exception 'Aucune fiche « Tony Admin » dans AB Ingénieurs (déjà retirée ?).';
  elsif v_nb > 1 then
    raise exception '% fiches « Tony Admin » dans AB Ingénieurs : rien n''est retiré, à voir à la main.', v_nb;
  end if;

  if exists (select 1 from public.acces where email = 't.varin@absa.ch' and membre_id = v_membre) then
    raise exception 'La fiche « Tony Admin » est celle de t.varin@absa.ch : rien n''est retiré.';
  end if;

  delete from public.acces where membre_id = v_membre and email <> 't.varin@absa.ch';
  get diagnostics v_acces = row_count;
  delete from public.membres where id = v_membre;

  raise notice 'Fiche « Tony Admin » retirée, avec % accès.', v_acces;
end $$;

commit;

-- Contrôle : 0 fiche « Tony Admin », et t.varin@absa.ch toujours super admin (true)
select
  (select count(*) from public.membres m join public.bureaux b on b.id = m.bureau_id
    where lower(btrim(b.nom)) = 'ab ingénieurs'
      and lower(btrim(m.prenom)) = 'tony' and lower(btrim(m.nom)) = 'admin')              as fiches_tony_admin,
  (select bool_or(super_admin and actif) from public.acces where email = 't.varin@absa.ch') as super_admin_absa;
