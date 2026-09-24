-- ============================================================================
--  Outil de planification — passer la main sur une tâche
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  AVANT : un utilisateur « lambda » (sans statut, donc sans le droit
--  « taches_autrui ») pouvait mener les tâches dont une part chargée était la
--  sienne, mais pas s'en défaire : le WITH CHECK de la modification exigeait
--  qu'à l'arrivée il tienne encore une part. Un dessinateur qui confiait sa
--  tâche à un collègue se heurtait à « Tu n'as pas le droit de faire cela ».
--
--  APRÈS : ce qu'on peut toucher ne change pas — une tâche qui me concerne, ou
--  dont une part chargée n'attend personne. Mais ce qu'on écrit n'a plus à
--  rester sien : on peut passer la main, c'est-à-dire confier sa part à
--  quelqu'un d'autre, ou la remettre à affecter. La tâche quitte alors le
--  planning de celui qui la lâche — et, sans le droit, il n'y revient plus.
--
--  Le reste ne bouge pas : créer une tâche pour quelqu'un d'autre, ou
--  supprimer la tâche d'un collègue, demande toujours « taches_autrui ».
--
--  ORDRE À RESPECTER
--    migration-droits-groupes.sql d'abord (c'est elle qui pose ces règles).
-- ============================================================================

begin;

-- ------------------------------------------------------------- garde-fou ---
do $$
begin
  if to_regprocedure('public.a_droit(text)') is null then
    raise exception 'Exécute d''abord migration-droits-groupes.sql : les droits n''existent pas encore.';
  end if;
end $$;

-- ---- tâches : celles qui me concernent, ou le droit -------------------------
-- « Me concerner », c'est tenir une part chargée de la tâche : l'ingénieur
-- d'une tâche qui a du calcul, le dessinateur d'une tâche qui a du dessin.
-- Une part chargée que personne ne tient reste prenable par tout le monde :
-- c'est le geste du tableau de bord, « glisser une barre à affecter sur un
-- membre ».
-- Le USING dit ce qu'on peut toucher ; le WITH CHECK ne garde plus que le
-- bureau, pour qu'on puisse aussi passer la main.
drop policy if exists "droit ou ma tâche (modification)" on public.taches;
create policy "droit ou ma tâche (modification)" on public.taches for update to authenticated
  using (bureau_id = (select public.bureau_courant()) and (
    (select public.a_droit('taches_autrui'))
    or (ingenieur_id   = (select public.mon_membre()) and charge_inge   > 0)
    or (dessinateur_id = (select public.mon_membre()) and charge_dessin > 0)
    or (ingenieur_id   is null and charge_inge   > 0)
    or (dessinateur_id is null and charge_dessin > 0)))
  with check (bureau_id = (select public.bureau_courant()));

commit;

-- ==================================================================== rapport ==
-- Les règles d'écriture des tâches, telles que la base les applique maintenant.
select p.policyname                                as regle,
       p.cmd                                       as commande,
       case when p.with_check is null then '—' else 'oui' end as controle_a_l_arrivee
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'taches'
 order by p.cmd, p.policyname;
