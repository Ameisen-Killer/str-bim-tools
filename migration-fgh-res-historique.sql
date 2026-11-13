-- ============================================================================
--  Migration du 13.11.2026 : historique des réservations FGH (/fgh/his/).
--  À exécuter une fois dans Supabase › SQL Editor › New query › Run (rejouable).
--  Ne crée que deux tables et leur sécurité, rien d'autre n'est touché.
--
--  fgh_res_historique : chaque décision écrite par le valideur /fgh/rsv/ dans ses
--    fichiers JSON (format STR_FGH_RES_VALIDATION), une ligne par réservation,
--    paramètre (Statut, Date, Commentaire), heure et auteur. Un même fichier
--    importé deux fois, ou deux fichiers qui se recoupent, ne créent pas de
--    doublon : la clé est (réservation, paramètre, heure, auteur).
--  fgh_res_fichiers : la liste des fichiers JSON importés.
--
--  Réservé aux personnes qui ont accès au chantier (acces_fgh) : lire et
--  importer. Rien ne se modifie ; seul un super admin peut retirer des lignes.
--  Les données des JSON ne sont PAS dans ce fichier (le dépôt est public) :
--  elles s'importent depuis la page, ou par le fichier de reprise donné à part.
-- ============================================================================

begin;

create table if not exists public.fgh_res_historique (
  k           text not null check (char_length(k) between 1 and 300),
  parametre   text not null check (parametre in ('PVA_RES_VAL_Statut', 'PVA_RES_VAL_Date', 'PVA_RES_VAL_Commentaire')),
  quand       text not null check (char_length(quand) <= 40),
  par         text not null default '' check (char_length(par) <= 100),
  cle         text not null default '' check (char_length(cle) <= 300),
  unique_id   text not null default '' check (char_length(unique_id) <= 100),
  element_id  text not null default '' check (char_length(element_id) <= 40),
  numero      text not null default '' check (char_length(numero) <= 60),
  famille     text not null default '' check (char_length(famille) <= 200),
  niveau      text not null default '' check (char_length(niveau) <= 60),
  ancien      text not null default '' check (char_length(ancien) <= 4000),
  nouveau     text not null default '' check (char_length(nouveau) <= 4000),
  retire      boolean not null default false,
  fichier     text not null default '' check (char_length(fichier) <= 255),
  importe_le  timestamptz not null default now(),
  importe_par text not null default coalesce(auth.jwt() ->> 'email', '') check (char_length(importe_par) <= 200),
  primary key (k, parametre, quand, par)
);
create index if not exists fgh_res_historique_quand on public.fgh_res_historique (quand);
comment on table public.fgh_res_historique is
  'Historique des décisions du valideur de réservations FGH (/fgh/rsv/), repris des fichiers JSON STR_FGH_RES_VALIDATION.';

create table if not exists public.fgh_res_fichiers (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null default '' check (char_length(nom) <= 255),
  auteur       text not null default '' check (char_length(auteur) <= 100),
  date_fichier text not null default '' check (char_length(date_fichier) <= 40),
  version_page text not null default '' check (char_length(version_page) <= 20),
  maquette     text not null default '' check (char_length(maquette) <= 200),
  export_du    text not null default '' check (char_length(export_du) <= 40),
  nb_entrees   integer not null default 0 check (nb_entrees >= 0),
  nb_nouvelles integer not null default 0 check (nb_nouvelles >= 0),
  importe_le   timestamptz not null default now(),
  importe_par  text not null default coalesce(auth.jwt() ->> 'email', '') check (char_length(importe_par) <= 200)
);

alter table public.fgh_res_historique enable row level security;
alter table public.fgh_res_fichiers   enable row level security;
revoke all on public.fgh_res_historique, public.fgh_res_fichiers from public, anon, authenticated;
grant select, insert, delete on public.fgh_res_historique, public.fgh_res_fichiers to authenticated;

drop policy if exists "fgh historique : lecture" on public.fgh_res_historique;
drop policy if exists "fgh historique : import"  on public.fgh_res_historique;
drop policy if exists "fgh historique : retrait" on public.fgh_res_historique;
create policy "fgh historique : lecture" on public.fgh_res_historique for select to authenticated using ((select public.acces_fgh()));
create policy "fgh historique : import"  on public.fgh_res_historique for insert to authenticated
  with check ((select public.acces_fgh()) and importe_le between now() - interval '5 minutes' and now() + interval '5 minutes'
              and importe_par = coalesce(auth.jwt() ->> 'email', ''));
create policy "fgh historique : retrait" on public.fgh_res_historique for delete to authenticated using ((select public.est_super_admin()));

drop policy if exists "fgh fichiers : lecture" on public.fgh_res_fichiers;
drop policy if exists "fgh fichiers : import"  on public.fgh_res_fichiers;
drop policy if exists "fgh fichiers : retrait" on public.fgh_res_fichiers;
create policy "fgh fichiers : lecture" on public.fgh_res_fichiers for select to authenticated using ((select public.acces_fgh()));
create policy "fgh fichiers : import"  on public.fgh_res_fichiers for insert to authenticated
  with check ((select public.acces_fgh()) and importe_le between now() - interval '5 minutes' and now() + interval '5 minutes'
              and importe_par = coalesce(auth.jwt() ->> 'email', ''));
create policy "fgh fichiers : retrait" on public.fgh_res_fichiers for delete to authenticated using ((select public.est_super_admin()));

commit;

notify pgrst, 'reload schema';
