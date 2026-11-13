-- ============================================================================
--  Migration du 13.11.2026 : outils du chantier FGH réservés aux personnes
--  connectées (/fgh/, /fgh/arm/, /fgh/pln/, /fgh/vis/, /fgh/rsv/).
--  À exécuter une fois dans Supabase › SQL Editor › New query › Run (rejouable).
--
--  Avant : Visas, Plans FGH et Fiches ARM étaient ouverts au rôle anon, c'est-à-
--  dire à quiconque lit la clé publiable dans le dépôt public (lecture, écriture,
--  suppression, photos comprises).
--  Après : il faut être connecté avec les identifiants de la planification ET
--  avoir accès au chantier, c'est-à-dire :
--    - être super admin, ou
--    - avoir un accès actif (console › Accès) rattaché au bureau du chantier,
--      repéré ci-dessous et rangé dans fgh_reglages.
--  Le compte « demo » (Bureau de test) n'y entre donc pas.
--
--  Effet immédiat : sans connexion, ces tables et ces deux seaux ne rendent plus
--  rien. Les pages publiées le 13.11.2026 demandent déjà la connexion.
-- ============================================================================

begin;

-- ------------------------------------------------- bureau du chantier FGH ---
-- Une seule ligne. Fermée à tous : seules les fonctions de la base la lisent.
create table if not exists public.fgh_reglages (
  id         boolean primary key default true constraint fgh_reglages_une_ligne check (id),
  bureau_id  uuid not null references public.bureaux (id) on delete cascade
);
comment on table public.fgh_reglages is
  'Bureau dont les accès actifs ouvrent les outils du chantier FGH (/fgh/). Une seule ligne.';
alter table public.fgh_reglages enable row level security;
revoke all on public.fgh_reglages from public, anon, authenticated;

do $$
declare
  -- Nom exact du bureau, si la recherche automatique (« AB … Ingénieurs ») échoue
  v_nom_bureau text := '';
  v_b uuid;
  v_n int;
begin
  if btrim(v_nom_bureau) <> '' then
    select b.id into v_b from public.bureaux b where lower(btrim(b.nom)) = lower(btrim(v_nom_bureau));
  else
    select count(*), min(b.id::text)::uuid into v_n, v_b
      from public.bureaux b
     where translate(lower(b.nom), 'éèêëàâäîïôöûüç', 'eeeeaaaiioouuc') ~ '\mab\M.*ingenieur';
    if v_n <> 1 then
      raise exception 'Bureau AB introuvable ou ambigu (% trouvés) : écris son nom exact dans v_nom_bureau, en tête du bloc.', v_n;
    end if;
  end if;
  if v_b is null then
    raise exception 'Bureau introuvable : vérifie v_nom_bureau.';
  end if;
  insert into public.fgh_reglages (id, bureau_id) values (true, v_b)
  on conflict (id) do update set bureau_id = excluded.bureau_id;
end $$;

-- ----------------------------------------------- qui entre dans les outils ---
create or replace function public.acces_fgh()
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.est_super_admin() or exists (
    select 1
      from public.acces a
      join public.fgh_reglages r on r.bureau_id = a.bureau_id
      join public.bureaux b on b.id = a.bureau_id
     where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and a.actif
       and b.actif
  );
$$;
comment on function public.acces_fgh() is
  'Vrai si la personne connectée peut utiliser les outils du chantier FGH : super admin, ou accès actif du bureau de fgh_reglages.';
revoke all on function public.acces_fgh() from public, anon;
grant execute on function public.acces_fgh() to authenticated;

-- ---------------------------------------------------------------- Visas ---
revoke all on public.visas_exports, public.visas_coches, public.visas_notes from anon, authenticated;
grant select, insert, delete on public.visas_exports, public.visas_coches to authenticated;
grant select, insert, update, delete on public.visas_notes to authenticated;

drop policy if exists "visas : lecture" on public.visas_exports;
drop policy if exists "visas : dépôt"   on public.visas_exports;
drop policy if exists "visas : retrait" on public.visas_exports;
create policy "visas : lecture" on public.visas_exports for select to authenticated using ((select public.acces_fgh()));
create policy "visas : dépôt"   on public.visas_exports for insert to authenticated
  with check ((select public.acces_fgh()) and depose_le between now() - interval '5 minutes' and now() + interval '5 minutes');
create policy "visas : retrait" on public.visas_exports for delete to authenticated using ((select public.acces_fgh()));

drop policy if exists "visas : lecture" on public.visas_coches;
drop policy if exists "visas : coche"   on public.visas_coches;
drop policy if exists "visas : retrait" on public.visas_coches;
create policy "visas : lecture" on public.visas_coches for select to authenticated using ((select public.acces_fgh()));
create policy "visas : coche"   on public.visas_coches for insert to authenticated
  with check ((select public.acces_fgh()) and traite_le between now() - interval '5 minutes' and now() + interval '5 minutes');
create policy "visas : retrait" on public.visas_coches for delete to authenticated using ((select public.acces_fgh()));

drop policy if exists "visas : lecture"      on public.visas_notes;
drop policy if exists "visas : écriture"     on public.visas_notes;
drop policy if exists "visas : modification" on public.visas_notes;
drop policy if exists "visas : retrait"      on public.visas_notes;
create policy "visas : lecture"      on public.visas_notes for select to authenticated using ((select public.acces_fgh()));
create policy "visas : écriture"     on public.visas_notes for insert to authenticated with check ((select public.acces_fgh()));
create policy "visas : modification" on public.visas_notes for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));
create policy "visas : retrait"      on public.visas_notes for delete to authenticated using ((select public.acces_fgh()));

drop policy if exists "visas : lecture" on storage.objects;
drop policy if exists "visas : dépôt"   on storage.objects;
drop policy if exists "visas : retrait" on storage.objects;
create policy "visas : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'visas' and (select public.acces_fgh()));
create policy "visas : dépôt"   on storage.objects for insert to authenticated
  with check (bucket_id = 'visas' and (select public.acces_fgh()));
create policy "visas : retrait" on storage.objects for delete to authenticated
  using (bucket_id = 'visas' and (select public.acces_fgh()));

-- ------------------------------------------------------------ Plans FGH ---
revoke all on public.fgh_plans from anon, authenticated;
grant select, insert, update, delete on public.fgh_plans to authenticated;

drop policy if exists "fgh plans : lecture"      on public.fgh_plans;
drop policy if exists "fgh plans : création"     on public.fgh_plans;
drop policy if exists "fgh plans : modification" on public.fgh_plans;
drop policy if exists "fgh plans : suppression"  on public.fgh_plans;
create policy "fgh plans : lecture"      on public.fgh_plans for select to authenticated using ((select public.acces_fgh()));
create policy "fgh plans : création"     on public.fgh_plans for insert to authenticated with check ((select public.acces_fgh()));
create policy "fgh plans : modification" on public.fgh_plans for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));
create policy "fgh plans : suppression"  on public.fgh_plans for delete to authenticated using ((select public.acces_fgh()));

-- -------------------------------------------------------- Fiches ARM FGH ---
revoke all on public.fgh_controles, public.fgh_controles_photos from anon, authenticated;
grant select, insert, update on public.fgh_controles, public.fgh_controles_photos to authenticated;

drop policy if exists "fgh arm : lecture" on public.fgh_controles;
drop policy if exists "fgh arm : ajout"   on public.fgh_controles;
drop policy if exists "fgh arm : modif"   on public.fgh_controles;
create policy "fgh arm : lecture" on public.fgh_controles for select to authenticated using ((select public.acces_fgh()));
create policy "fgh arm : ajout"   on public.fgh_controles for insert to authenticated with check ((select public.acces_fgh()));
create policy "fgh arm : modif"   on public.fgh_controles for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));

drop policy if exists "fgh arm : lecture" on public.fgh_controles_photos;
drop policy if exists "fgh arm : ajout"   on public.fgh_controles_photos;
drop policy if exists "fgh arm : modif"   on public.fgh_controles_photos;
create policy "fgh arm : lecture" on public.fgh_controles_photos for select to authenticated using ((select public.acces_fgh()));
create policy "fgh arm : ajout"   on public.fgh_controles_photos for insert to authenticated with check ((select public.acces_fgh()));
create policy "fgh arm : modif"   on public.fgh_controles_photos for update to authenticated
  using ((select public.acces_fgh())) with check ((select public.acces_fgh()));

drop policy if exists "fgh arm : lecture"      on storage.objects;
drop policy if exists "fgh arm : dépôt"        on storage.objects;
drop policy if exists "fgh arm : remplacement" on storage.objects;
drop policy if exists "fgh arm : retrait"      on storage.objects;
create policy "fgh arm : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'fgh-arm' and (select public.acces_fgh()));
create policy "fgh arm : dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'fgh-arm' and (select public.acces_fgh()));
create policy "fgh arm : remplacement" on storage.objects for update to authenticated
  using (bucket_id = 'fgh-arm' and (select public.acces_fgh())) with check (bucket_id = 'fgh-arm' and (select public.acces_fgh()));
create policy "fgh arm : retrait" on storage.objects for delete to authenticated
  using (bucket_id = 'fgh-arm' and (select public.acces_fgh()));

commit;

notify pgrst, 'reload schema';

-- Contrôle : doit afficher le nom du bureau du chantier
select b.nom as "Outils FGH ouverts au bureau" from public.fgh_reglages r join public.bureaux b on b.id = r.bureau_id;
