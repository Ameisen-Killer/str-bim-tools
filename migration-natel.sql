-- Planification — trois téléphones par fiche (11.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run, après
-- migration-profil.sql. Relançable sans risque. Ajoute le natel aux fiches :
-- tel_interne (numéro interne), tel_externe (ligne directe), tel_natel.
-- regle_profil prend désormais le natel (cinq paramètres).
-- ---------------------------------------------------------------------------
begin;

alter table public.membres add column if not exists tel_natel text not null default '';
alter table public.membres drop constraint if exists membres_tel_natel_check;
alter table public.membres add constraint membres_tel_natel_check check (char_length(tel_natel) <= 40);

-- Mon profil : chacun règle ses téléphones et sa photo (le super admin, ceux
-- de tous). Le compte de démonstration, public, ne change pas la photo.
-- p_tel_externe est la ligne directe ; le natel a son propre champ (11.10.2026).
drop function if exists public.regle_profil(uuid, text, text, text);
create or replace function public.regle_profil(p_membre uuid, p_tel_interne text, p_tel_externe text, p_tel_natel text, p_photo text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m     public.membres%rowtype;
  v_int   text := btrim(coalesce(p_tel_interne, ''));
  v_ext   text := btrim(coalesce(p_tel_externe, ''));
  v_nat   text := btrim(coalesce(p_tel_natel, ''));
  v_photo text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if not public.est_autorise() then
    raise exception 'Accès refusé. Ton adresse est-elle bien dans la liste des accès ?';
  end if;
  select * into v_m from public.membres m
   where m.id = p_membre and m.bureau_id = public.bureau_courant();
  if not found then
    raise exception 'Cette personne n''existe plus dans ce bureau.';
  end if;
  if p_membre is distinct from public.mon_membre() and not coalesce(public.est_super_admin(), false) then
    raise exception 'Tu ne règles que ton propre profil.';
  end if;
  if char_length(v_int) > 40 or char_length(v_ext) > 40 or char_length(v_nat) > 40 then
    raise exception 'Numéro de téléphone trop long (40 caractères au plus).';
  end if;
  if v_photo is not null and (v_photo not like 'data:image/%' or char_length(v_photo) > 120000) then
    raise exception 'Photo refusée : image trop lourde ou d''un format inconnu.';
  end if;
  if v_photo is distinct from v_m.photo
     and lower(coalesce(auth.jwt() ->> 'email', '')) = 'demo@str-bim-tools.com' then
    raise exception 'La photo ne se change pas dans la démonstration.';
  end if;

  update public.membres m
     set tel_interne = v_int, tel_externe = v_ext, tel_natel = v_nat, photo = v_photo
   where m.id = p_membre;

  return jsonb_build_object('tel_interne', v_int, 'tel_externe', v_ext, 'tel_natel', v_nat, 'photo', v_photo);
end $$;

revoke all on function public.regle_profil(uuid, text, text, text, text) from public, anon;
grant execute on function public.regle_profil(uuid, text, text, text, text) to authenticated;

commit;
