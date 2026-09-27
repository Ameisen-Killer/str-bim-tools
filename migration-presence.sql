-- ============================================================================
--  Outil de planification — qui est en ligne en ce moment
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Ajoute la table des présences et la fonction qui la tient. Chaque page
--  ouverte de l'outil signale sa présence toutes les 45 secondes ; la barre du
--  haut affiche le nombre de personnes en ligne, et leurs noms au survol.
--
--  Une présence appartient à un bureau, comme le reste : on ne voit que les
--  collègues du bureau affiché. La table n'a AUCUNE règle RLS, comme acces et
--  bureaux : elle ne se lit ni ne s'écrit depuis l'outil, seule la fonction
--  public.presence() y touche (security definer). Rien ne fuite donc de
--  l'adresse des uns aux autres bureaux.
--
--  La fonction fait tout en un appel : elle inscrit l'heure de passage de la
--  personne connectée, puis renvoie la liste de celles vues depuis moins de
--  150 secondes — deux battements de 45 s ratés restent tolérés, un onglet
--  fermé disparaît en deux minutes et demie. Le nom vient de la fiche d'équipe
--  rattachée à l'adresse (table acces) ; sans fiche, c'est l'adresse qui
--  s'affiche (super admin, accès externe).
--
--  ORDRE À RESPECTER
--    migration-multi-bureaux.sql d'abord (c'est elle qui pose bureau_par_defaut
--    et bureau_courant).
-- ============================================================================

begin;

-- ------------------------------------------------------------- garde-fou ---
do $$
begin
  if to_regprocedure('public.bureau_courant()') is null then
    raise exception 'Exécute d''abord migration-multi-bureaux.sql : les bureaux n''existent pas encore.';
  end if;
end $$;

-- ---------------------------------------------------------------- table ---
-- Une ligne par adresse connectée, remplacée à chaque battement : la table
-- reste de la taille de l'équipe, jamais un journal qui gonfle.
create table if not exists public.presences (
  email     text primary key
            constraint presences_email_minuscules check (email = lower(btrim(email))),
  bureau_id uuid not null
            constraint presences_bureau_fk references public.bureaux (id) on delete cascade,
  vu_le     timestamptz not null default now()
);
create index if not exists presences_bureau on public.presences (bureau_id, vu_le desc);

comment on table public.presences is
  'Dernier signe de vie de chaque adresse connectée, par bureau. Tenue par public.presence() seule ; aucune règle RLS, donc invisible depuis l''API.';
comment on column public.presences.vu_le is
  'Heure du dernier battement. En ligne = moins de 150 secondes (les pages battent toutes les 45 s).';

-- -------------------------------------------------------------- fonction ---
-- p_partir : la page se ferme ou l'on se déconnecte — la ligne s'en va tout de
-- suite plutôt que d'attendre l'oubli.
create or replace function public.presence(p_partir boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_bureau uuid := public.bureau_courant();
begin
  if v_email = '' or v_bureau is null then
    return jsonb_build_object('enLigne', '[]'::jsonb);
  end if;

  if p_partir then
    delete from public.presences p where p.email = v_email;
  else
    insert into public.presences (email, bureau_id, vu_le)
    values (v_email, v_bureau, now())
    on conflict (email) do update
      set bureau_id = excluded.bureau_id, vu_le = excluded.vu_le;
  end if;

  -- Ménage : une ligne d'hier ne dit plus rien, et personne d'autre ne l'effacera.
  delete from public.presences p where p.vu_le < now() - interval '1 day';

  return jsonb_build_object('enLigne', coalesce((
    select jsonb_agg(jsonb_build_object('nom', x.nom, 'moi', x.moi) order by lower(x.nom))
      from (
        select case when m.id is not null then btrim(m.prenom || ' ' || m.nom) else p.email end as nom,
               p.email = v_email as moi
          from public.presences p
          left join public.acces a on a.email = p.email and a.actif
          left join public.membres m on m.id = a.membre_id
         where p.bureau_id = v_bureau
           and p.vu_le > now() - interval '150 seconds'
      ) x), '[]'::jsonb));
end $$;

comment on function public.presence(boolean) is
  'Inscrit le passage de la personne connectée et renvoie qui est en ligne dans son bureau : { enLigne: [{ nom, moi }] }.';

-- ---------------------------------------------------------------- droits ---
-- La table se ferme (RLS sans aucune règle) ; seule la fonction y accède.
alter table public.presences enable row level security;

revoke all on function public.presence(boolean) from public, anon;
grant execute on function public.presence(boolean) to authenticated;

commit;

-- L'API relit la forme des tables et des fonctions
notify pgrst, 'reload schema';

-- ==================================================================== rapport ==
-- La table est bien fermée : aucune règle, donc rien ne se lit depuis l'API.
select count(*) as regles_rls_sur_presences
  from pg_policies where schemaname = 'public' and tablename = 'presences';

-- La fonction est en place et réservée aux personnes connectées.
select p.proname as fonction, p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as executable_par_connecte,
       has_function_privilege('anon', p.oid, 'execute')          as executable_sans_connexion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'presence';
