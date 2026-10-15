-- Site vitrine — remise à zéro des statistiques (15.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute stats_remise_a_zero(), appelée par le bouton
-- « Remettre à zéro » de /stats/ : efface toutes les pages vues (super admin
-- seulement) et renvoie leur nombre.
-- ---------------------------------------------------------------------------
begin;

-- Efface toutes les pages vues du site (bouton de /stats/). Renvoie leur nombre.
create or replace function public.stats_remise_a_zero()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not public.est_super_admin() then
    raise exception 'Statistiques réservées au super admin.';
  end if;
  delete from public.visites v where v.id is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.stats_remise_a_zero() from public, anon;
grant execute on function public.stats_remise_a_zero() to authenticated;

commit;
