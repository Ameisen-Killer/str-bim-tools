-- ============================================================================
--  Outil de planification — COMPTE DE DÉMONSTRATION
-- ----------------------------------------------------------------------------
--  À coller dans Supabase : SQL Editor > New query > Run.
--
--  Crée le compte « demo » (mot de passe « demo ») dans le « Bureau de test » :
--    - l'adresse demo@str-bim-tools.com entre dans la liste des accès ;
--      la page de connexion la complète toute seule quand on tape « demo » ;
--    - le compte Supabase est créé ici, adresse déjà confirmée, sans courriel ;
--      Supabase exige six caractères quand on choisit un mot de passe depuis
--      l'outil, mais un compte créé par SQL n'y est pas soumis ;
--    - il est rattaché à Laurent Mercier, associé fictif du jeu de
--      démonstration (jeu-demo.sql) : il a donc tous les droits du bureau ;
--    - son mot de passe et son adresse sont figés : un visiteur connecté ne
--      peut pas les changer et fermer la démonstration aux suivants.
--
--  Relançable : remet le mot de passe « demo » et refait le rattachement.
--  À relancer après purge-jeu-demo.sql + jeu-demo.sql (la purge supprime la
--  fiche de Laurent Mercier, l'accès se retrouve alors sans fiche).
--
--  Attention : « demo / demo » se devine. Le compte ne voit que le Bureau de
--  test, mais il peut y tout modifier. En cas de dégâts : purge-jeu-demo.sql,
--  jeu-demo.sql, puis ce script.
--  Retrait : purge-compte-demo.sql.
-- ============================================================================

begin;

-- Laisse ce script modifier le compte malgré la garde posée plus bas
select set_config('planif.compte_demo', 'reglage', true);

do $$
declare
  v_email  text := 'demo@str-bim-tools.com';
  v_bureau uuid;
  v_membre uuid;
  v_user   uuid;
begin
  select b.id into v_bureau from public.bureaux b where b.nom = 'Bureau de test';
  if v_bureau is null then
    raise exception 'Bureau « Bureau de test » introuvable : crée-le depuis la console, puis relance.';
  end if;

  -- La fiche de Laurent Mercier, si le jeu de démonstration est chargé et
  -- qu'aucun autre accès ne la porte déjà
  select m.id into v_membre
    from public.membres m
   where m.bureau_id = v_bureau
     and m.email = 'laurent.mercier@demo.exemple.ch'
     and not exists (select 1 from public.acces a where a.membre_id = m.id and a.email <> v_email);

  insert into public.acces (email, bureau_id, membre_id, actif)
  values (v_email, v_bureau, v_membre, true)
  on conflict (email) do update
    set bureau_id = excluded.bureau_id,
        membre_id = excluded.membre_id,
        actif     = true;

  -- Le compte Supabase
  select u.id into v_user from auth.users u where u.email = v_email;
  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt('demo', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_user, v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now());
  else
    update auth.users
       set encrypted_password = extensions.crypt('demo', extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           banned_until       = null,
           updated_at         = now()
     where id = v_user;
  end if;

  if v_membre is null then
    raise notice 'Compte créé sans fiche : charge jeu-demo.sql puis relance ce script pour le rattacher à Laurent Mercier.';
  end if;
end $$;

-- Garde : le mot de passe et l'adresse du compte de démonstration ne bougent
-- que par ce script
create or replace function public.garde_compte_demo()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.email = 'demo@str-bim-tools.com'
     and coalesce(current_setting('planif.compte_demo', true), '') <> 'reglage' then
    new.encrypted_password     := old.encrypted_password;
    new.email                  := old.email;
    new.email_change           := '';
    new.email_change_token_new := '';
  end if;
  return new;
end $$;
revoke execute on function public.garde_compte_demo() from public, anon, authenticated;

drop trigger if exists garde_compte_demo on auth.users;
create trigger garde_compte_demo
  before update on auth.users
  for each row execute function public.garde_compte_demo();

commit;

select a.email, b.nom as bureau, m.prenom || ' ' || m.nom as fiche, a.actif,
       (select u.email_confirmed_at is not null from auth.users u where u.email = a.email) as compte_pret
  from public.acces a
  join public.bureaux b on b.id = a.bureau_id
  left join public.membres m on m.id = a.membre_id
 where a.email = 'demo@str-bim-tools.com';
