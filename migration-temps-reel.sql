-- ============================================================================
--  Outil de planification — mises à jour en direct
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Quand un collègue enregistre, les pages ouvertes de l'outil se mettent à
--  jour d'elles-mêmes (docs/planif/assets/direct.js). Elles écoutent pour cela
--  le service « Realtime » de Supabase, qui ne diffuse que les changements des
--  tables inscrites dans la publication « supabase_realtime ». Ce fichier les
--  y inscrit.
--
--  Sécurité : rien ne change. Le service n'envoie à chaque personne que les
--  lignes que la RLS lui laisse lire — son bureau, et rien d'autre — et la
--  page s'abonne en plus au seul bureau affiché. Les tables fermées (acces,
--  bureaux, presences…) ne sont pas publiées.
--
--  Sans cette migration, l'outil se rabat sur une relecture discrète toutes
--  les minutes.
-- ============================================================================

begin;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['taches', 'affaires', 'affaire_membres', 'membres', 'absences', 'contacts', 'reglages'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

-- ==================================================================== rapport ==
-- Les tables publiées : on doit y lire les sept tables du planning.
select tablename as table_publiee
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
 order by tablename;
