-- ============================================================================
--  Outil de planification — qui est en ligne en ce moment
-- ----------------------------------------------------------------------------
--  À exécuter dans le projet Supabase :
--    Dashboard > SQL Editor > New query > coller ce fichier > Run.
--  Peut être relancé sans dommage.
--
--  Ajoute la table des présences et la fonction qui la tient. La barre du haut
--  affiche le nombre de personnes qui ont l'outil SOUS LES YEUX — un onglet
--  passé derrière, un téléphone en veille ne comptent pas —, et leurs noms au
--  survol.
--
--  Une ligne par onglet ouvert : quelqu'un qui a l'outil ouvert sur son PC et
--  sur son téléphone en veille reste en ligne grâce au PC. Chaque onglet visible
--  bat toutes les 45 secondes ; un onglet qui passe derrière le dit tout de
--  suite ; un onglet qui disparaît sans rien dire (navigateur tué) s'efface
--  après 100 secondes sans battement.
--
--  Les messages d'un même onglet arrivent parfois dans le désordre : en
--  passant d'une page de l'outil à une autre, le « je passe derrière » de
--  l'ancienne page peut arriver après le « je suis là » de la nouvelle. Chaque
--  message porte donc l'heure de l'onglet (p_horloge), et un message plus
--  ancien que celui déjà enregistré est ignoré.
--
--  Une présence appartient à un bureau, comme le reste : on ne voit que les
--  collègues du bureau affiché. La table n'a AUCUNE règle RLS, comme acces et
--  bureaux : seule la fonction public.presence() y touche (security definer).
--
--  DÉJÀ LANCÉE UNE FOIS (première version, qui comptait aussi les onglets en
--  arrière-plan) ? Relance-la : l'ancienne table et l'ancienne fonction sont
--  remplacées. Rien n'est perdu, ces lignes ne vivent que quelques minutes.
--
--  ORDRE À RESPECTER
--    migration-multi-bureaux.sql d'abord (c'est elle qui pose bureau_courant).
-- ============================================================================

begin;

-- ------------------------------------------------------------- garde-fou ---
do $$
begin
  if to_regprocedure('public.bureau_courant()') is null then
    raise exception 'Exécute d''abord migration-multi-bureaux.sql : les bureaux n''existent pas encore.';
  end if;
end $$;

-- ------------------------------------------------ première version, retirée ---
drop function if exists public.presence(boolean);
do $$
begin
  if to_regclass('public.presences') is not null and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'presences' and column_name = 'onglet'
  ) then
    drop table public.presences;
  end if;
end $$;

-- ---------------------------------------------------------------- table ---
create table if not exists public.presences (
  email     text not null
            constraint presences_email_minuscules check (email = lower(btrim(email))),
  onglet    text not null
            constraint presences_onglet_forme check (char_length(onglet) between 1 and 64),
  bureau_id uuid not null
            constraint presences_bureau_fk references public.bureaux (id) on delete cascade,
  visible   boolean not null default true,
  horloge   bigint not null default 0,
  vu_le     timestamptz not null default now(),
  primary key (email, onglet)
);
create index if not exists presences_bureau on public.presences (bureau_id, vu_le desc);

comment on table public.presences is
  'Un onglet ouvert de l''outil par ligne : visible ou non, et son dernier battement. Tenue par public.presence() seule ; aucune règle RLS, donc invisible depuis l''API.';
comment on column public.presences.horloge is
  'Heure de l''onglet (ms) du dernier message retenu : un message plus ancien, arrivé en retard, est ignoré.';
comment on column public.presences.vu_le is
  'Heure du dernier battement. En ligne = visible et moins de 100 secondes (les onglets visibles battent toutes les 45 s).';

-- -------------------------------------------------------------- fonction ---
-- p_visible : l'onglet est sous les yeux (battement) ou vient de passer derrière.
-- p_quitter : déconnexion — tous les onglets de l'adresse s'effacent.
create or replace function public.presence(p_onglet text, p_horloge bigint,
                                           p_visible boolean default true,
                                           p_quitter boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_bureau uuid := public.bureau_courant();
  v_onglet text := left(btrim(coalesce(p_onglet, '')), 64);
begin
  if v_email = '' or v_bureau is null then
    return jsonb_build_object('enLigne', '[]'::jsonb);
  end if;

  if p_quitter then
    delete from public.presences p where p.email = v_email;
  elsif v_onglet <> '' then
    insert into public.presences as p (email, onglet, bureau_id, visible, horloge, vu_le)
    values (v_email, v_onglet, v_bureau, coalesce(p_visible, true), coalesce(p_horloge, 0), now())
    on conflict (email, onglet) do update
      set bureau_id = excluded.bureau_id, visible = excluded.visible,
          horloge = excluded.horloge, vu_le = excluded.vu_le
      where p.horloge <= excluded.horloge;
  end if;

  -- Ménage : une ligne d'hier ne dit plus rien, et personne d'autre ne l'effacera.
  delete from public.presences p where p.vu_le < now() - interval '1 day';

  -- Une personne, une fois, même avec plusieurs onglets visibles.
  return jsonb_build_object('enLigne', coalesce((
    select jsonb_agg(jsonb_build_object('nom', x.nom, 'moi', x.moi) order by lower(x.nom))
      from (
        select distinct on (p.email)
               case when m.id is not null then btrim(m.prenom || ' ' || m.nom) else p.email end as nom,
               p.email = v_email as moi
          from public.presences p
          left join public.acces a on a.email = p.email and a.actif
          left join public.membres m on m.id = a.membre_id
         where p.bureau_id = v_bureau
           and p.visible
           and p.vu_le > now() - interval '100 seconds'
         order by p.email
      ) x), '[]'::jsonb));
end $$;

comment on function public.presence(text, bigint, boolean, boolean) is
  'Inscrit l''état d''un onglet de la personne connectée et renvoie qui a l''outil sous les yeux dans son bureau : { enLigne: [{ nom, moi }] }.';

-- ---------------------------------------------------------------- droits ---
-- La table se ferme (RLS sans aucune règle) ; seule la fonction y accède.
alter table public.presences enable row level security;

revoke all on function public.presence(text, bigint, boolean, boolean) from public, anon;
grant execute on function public.presence(text, bigint, boolean, boolean) to authenticated;

commit;

-- L'API relit la forme des tables et des fonctions
notify pgrst, 'reload schema';

-- ==================================================================== rapport ==
-- La table est bien fermée : aucune règle, donc rien ne se lit depuis l'API.
select count(*) as regles_rls_sur_presences
  from pg_policies where schemaname = 'public' and tablename = 'presences';

-- La fonction est en place (une seule version) et réservée aux personnes connectées.
select p.oid::regprocedure as fonction, p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as executable_par_connecte,
       has_function_privilege('anon', p.oid, 'execute')          as executable_sans_connexion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'presence';
