-- Migration du 16.10.2026 : nom réseau (DNS inverse de l'adresse IP) des visites
-- du site, affiché dans l'historique de /stats/.
-- À exécuter une fois dans Supabase (SQL Editor > New query > coller > Run),
-- puis déployer la fonction « reseau » (reglages-supabase.md, « Nom réseau des visites »).
-- Sans risque : ajoute une colonne vide et réécrit stats_site, aucune donnée effacée.

alter table public.visites add column if not exists reseau text;
do $$ begin
  alter table public.visites add constraint visites_reseau_forme
    check (reseau is null or reseau ~ '^[a-z0-9._-]{0,253}$');
exception when duplicate_object then null;
end $$;

comment on table public.visites is
  'Audience du site vitrine : une page vue par ligne, empreinte du jour hachée, nom DNS inverse de l''adresse IP (reseau), ni IP ni navigateur gardés. Écrite par note_visite / fin_visite et la fonction Supabase reseau, lue par stats_site (super admin). Aucune règle RLS.';

create or replace function public.stats_site(p_jours integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_depuis timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 800)));
begin
  if not public.est_super_admin() then
    raise exception 'Statistiques réservées au super admin.';
  end if;
  return jsonb_build_object(
    'maintenant', now(),
    'visites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'le', v.le, 'page', v.page, 'precedent', v.precedent, 'referent', v.referent,
               'appareil', v.appareil, 'langue', v.langue, 'pays', v.pays,
               'visiteur', left(v.visiteur, 12), 'duree', v.duree, 'reseau', v.reseau,
               'present', v.present_le is not null and v.present_le > now() - interval '75 seconds')
             order by v.le desc)
        from public.visites v
       where v.le >= v_depuis), '[]'::jsonb)
  );
end $$;

revoke all on function public.stats_site(integer) from public, anon;
grant execute on function public.stats_site(integer) to authenticated;
