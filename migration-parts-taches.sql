-- ============================================================================
--  Outil de planification — parts de tâche terminées séparément
-- ----------------------------------------------------------------------------
--  À exécuter une fois, dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Une tâche porte deux parts : le calcul (charge ingénieur) et le dessin.
--  Jusqu'ici un seul statut valait pour les deux : l'ingénieur qui bouclait
--  sa note fermait aussi le dessin, et la charge du dessinateur disparaissait
--  du planning alors que le travail restait à faire.
--  Chaque part reçoit son propre drapeau ; le statut global reste leur
--  synthèse : « Terminé » quand toutes les parts existantes le sont.
--
--  Les tâches déjà terminées voient leurs deux parts fermées, pour que rien
--  ne change à l'écran après la migration.
-- ============================================================================

alter table public.taches add column if not exists fini_inge   boolean not null default false;
alter table public.taches add column if not exists fini_dessin boolean not null default false;

comment on column public.taches.fini_inge   is 'Part calcul terminée (charge ingénieur bouclée)';
comment on column public.taches.fini_dessin is 'Part dessin terminée';

-- Reprise de l'existant : une tâche terminée a ses deux parts terminées,
-- une part sans charge ne peut pas être terminée.
update public.taches
   set fini_inge   = (statut = 'termine' and charge_inge   > 0),
       fini_dessin = (statut = 'termine' and charge_dessin > 0)
 where fini_inge <> (statut = 'termine' and charge_inge   > 0)
    or fini_dessin <> (statut = 'termine' and charge_dessin > 0);

-- Vérification : aucune part terminée sans charge, et les tâches terminées
-- ont bien toutes leurs parts fermées.
select count(*) filter (where fini_inge   and charge_inge   <= 0) as part_calcul_sans_charge,
       count(*) filter (where fini_dessin and charge_dessin <= 0) as part_dessin_sans_charge,
       count(*) filter (where statut = 'termine'
                          and ((charge_inge   > 0 and not fini_inge)
                            or (charge_dessin > 0 and not fini_dessin))) as terminees_incompletes
  from public.taches;
