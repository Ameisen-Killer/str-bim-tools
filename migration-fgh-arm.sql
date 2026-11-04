-- ============================================================================
-- FGH ARM : fiches de contrôle d'armatures et photos en ligne (03.11.2026)
-- Rejouable. À coller dans Supabase > SQL Editor > Run.
-- Comme les autres outils FGH : pas de connexion, ouvert au rôle anon (clé publiable).
-- ============================================================================

create table if not exists public.fgh_controles (
  id          text primary key check (char_length(id) between 1 and 64),
  projet      text not null default '' check (char_length(projet) <= 40),
  numero      text not null default '' check (char_length(numero) <= 20),
  date_ctrl   text not null default '' check (char_length(date_ctrl) <= 20),
  auteur      text not null default '' check (char_length(auteur) <= 100),
  maj         bigint not null default 0,
  supprime    boolean not null default false,
  data        jsonb not null default '{}'::jsonb,
  modifie_le  timestamptz not null default now()
);
create index if not exists fgh_controles_modifie on public.fgh_controles (modifie_le);

create table if not exists public.fgh_controles_photos (
  id          text primary key check (char_length(id) between 1 and 64),
  ctrl_id     text not null default '' check (char_length(ctrl_id) <= 64),
  ord         integer not null default 0,
  w           integer not null default 0,
  h           integer not null default 0,
  statut      text not null default '' check (char_length(statut) <= 20),
  commentaire text not null default '' check (char_length(commentaire) <= 4000),
  item text not null default '' check (char_length(item) <= 60),
  shapes      jsonb not null default '[]'::jsonb,
  chemin_o    text not null default '' check (char_length(chemin_o) <= 200),
  chemin_a    text not null default '' check (char_length(chemin_a) <= 200),
  maj         bigint not null default 0,
  supprime    boolean not null default false,
  modifie_le  timestamptz not null default now()
);
create index if not exists fgh_controles_photos_modifie on public.fgh_controles_photos (modifie_le);
create index if not exists fgh_controles_photos_ctrl on public.fgh_controles_photos (ctrl_id);

-- heure du serveur à chaque écriture : c'est elle qui dit aux autres appareils ce qui a changé
create or replace function public.fgh_arm_horodate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;
revoke all on function public.fgh_arm_horodate() from public, anon, authenticated;
drop trigger if exists fgh_controles_horodate on public.fgh_controles;
create trigger fgh_controles_horodate before insert or update on public.fgh_controles
  for each row execute function public.fgh_arm_horodate();
drop trigger if exists fgh_controles_photos_horodate on public.fgh_controles_photos;
create trigger fgh_controles_photos_horodate before insert or update on public.fgh_controles_photos
  for each row execute function public.fgh_arm_horodate();

alter table public.fgh_controles enable row level security;
alter table public.fgh_controles_photos enable row level security;
revoke all on public.fgh_controles, public.fgh_controles_photos from anon, authenticated;
grant select, insert, update on public.fgh_controles, public.fgh_controles_photos to anon, authenticated;

drop policy if exists "fgh arm : lecture" on public.fgh_controles;
drop policy if exists "fgh arm : ajout" on public.fgh_controles;
drop policy if exists "fgh arm : modif" on public.fgh_controles;
create policy "fgh arm : lecture" on public.fgh_controles for select to anon, authenticated using (true);
create policy "fgh arm : ajout" on public.fgh_controles for insert to anon, authenticated with check (true);
create policy "fgh arm : modif" on public.fgh_controles for update to anon, authenticated using (true) with check (true);

drop policy if exists "fgh arm : lecture" on public.fgh_controles_photos;
drop policy if exists "fgh arm : ajout" on public.fgh_controles_photos;
drop policy if exists "fgh arm : modif" on public.fgh_controles_photos;
create policy "fgh arm : lecture" on public.fgh_controles_photos for select to anon, authenticated using (true);
create policy "fgh arm : ajout" on public.fgh_controles_photos for insert to anon, authenticated with check (true);
create policy "fgh arm : modif" on public.fgh_controles_photos for update to anon, authenticated using (true) with check (true);

-- photos (JPEG/PNG) et fiches PDF à envoyer par mail : seau privé, 40 Mo au plus par fichier
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fgh-arm', 'fgh-arm', false, 41943040, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fgh arm : lecture" on storage.objects;
drop policy if exists "fgh arm : dépôt" on storage.objects;
drop policy if exists "fgh arm : remplacement" on storage.objects;
drop policy if exists "fgh arm : retrait" on storage.objects;
create policy "fgh arm : lecture" on storage.objects for select to anon, authenticated using (bucket_id = 'fgh-arm');
create policy "fgh arm : dépôt" on storage.objects for insert to anon, authenticated with check (bucket_id = 'fgh-arm');
create policy "fgh arm : remplacement" on storage.objects for update to anon, authenticated using (bucket_id = 'fgh-arm') with check (bucket_id = 'fgh-arm');
create policy "fgh arm : retrait" on storage.objects for delete to anon, authenticated using (bucket_id = 'fgh-arm');

notify pgrst, 'reload schema';

-- 04.11.2026 : photo rattachée à un point de contrôle (fond de coffrage, enrobage, incorporés…)
alter table public.fgh_controles_photos add column if not exists item text not null default '' check (char_length(item) <= 60);
