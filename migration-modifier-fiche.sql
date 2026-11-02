-- Migration du 02.11.2026 : modifier la fiche d'un membre depuis la page Équipe.
-- À exécuter une fois dans Supabase (SQL Editor). Ne touche à aucune donnée :
-- elle crée seulement la fonction modifie_fiche et l'ouvre aux personnes connectées
-- (la fonction vérifie elle-même le droit « membres_modifier »).
-- Ensuite, dans la console › Droits, cocher « Modifier les fiches des membres »
-- pour le groupe Administratif (et ceux qui doivent l'avoir).

-- Modifier la fiche d'un membre depuis la page Équipe (02.11.2026, demande de
-- Tony) : le droit « membres_modifier », coché dans la console pour un groupe
-- (Administratif, par exemple). Seulement la fiche : nom, métier, rattachement,
-- capacité et téléphones. Les groupes (qui donnent des droits), l'accès,
-- l'adresse et l'état actif restent à la console du super admin.
--   p : { prenom, nom, metier, succursale, discipline, capacite,
--         telInterne, telExterne, telNatel }
create or replace function public.modifie_fiche(p_membre uuid, p jsonb)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m        public.membres%rowtype;
  v_prenom   text    := btrim(coalesce(p ->> 'prenom', ''));
  v_nom      text    := btrim(coalesce(p ->> 'nom', ''));
  v_metier   text    := nullif(btrim(coalesce(p ->> 'metier', '')), '');
  v_succ     text    := nullif(btrim(coalesce(p ->> 'succursale', '')), '');
  v_disc     text    := nullif(btrim(coalesce(p ->> 'discipline', '')), '');
  v_capacite numeric := coalesce(nullif(replace(p ->> 'capacite', ',', '.'), '')::numeric, 5);
  v_int      text    := btrim(coalesce(p ->> 'telInterne', ''));
  v_ext      text    := btrim(coalesce(p ->> 'telExterne', ''));
  v_nat      text    := btrim(coalesce(p ->> 'telNatel', ''));
begin
  if not public.est_autorise() then
    raise exception 'Accès refusé. Ton adresse est-elle bien dans la liste des accès ?';
  end if;
  if not public.a_droit('membres_modifier') then
    raise exception 'Modifier la fiche d''un membre demande le droit « Modifier les fiches des membres ».';
  end if;
  select * into v_m from public.membres m
   where m.id = p_membre and m.bureau_id = public.bureau_courant();
  if not found then
    raise exception 'Cette personne n''existe plus dans ce bureau.';
  end if;
  if v_prenom = '' then raise exception 'Le prénom est obligatoire.'; end if;
  if v_nom    = '' then raise exception 'Le nom est obligatoire.';    end if;
  if char_length(v_prenom) > 80 or char_length(v_nom) > 80 then
    raise exception 'Prénom ou nom trop long (80 caractères au plus).';
  end if;
  if v_metier is not null and v_metier not in ('ingenieur', 'dessinateur', 'administratif') then
    raise exception 'Métier inconnu.';
  end if;
  if not (v_capacite >= 0.5 and v_capacite <= 7) then
    raise exception 'La capacité doit être comprise entre 0,5 et 7 jours par semaine.';
  end if;
  if v_m.jours is not null and v_capacite > (select sum(x) from unnest(v_m.jours) as x) then
    raise exception 'La capacité dépasse les jours travaillés.';
  end if;
  if v_succ is not null and not exists (
       select 1 from public.succursales s where s.bureau_id = v_m.bureau_id and s.code = v_succ) then
    raise exception 'Cette succursale n''existe pas dans ce bureau.';
  end if;
  if v_disc is not null and not exists (
       select 1 from public.disciplines d where d.bureau_id = v_m.bureau_id and d.code = v_disc) then
    raise exception 'Cette discipline n''existe pas dans ce bureau.';
  end if;
  if char_length(v_int) > 40 or char_length(v_ext) > 40 or char_length(v_nat) > 40 then
    raise exception 'Numéro de téléphone trop long (40 caractères au plus).';
  end if;

  update public.membres m
     set prenom = v_prenom, nom = v_nom, metier = v_metier, succursale = v_succ, discipline = v_disc,
         capacite = round(v_capacite, 1), tel_interne = v_int, tel_externe = v_ext, tel_natel = v_nat
   where m.id = p_membre;
end $$;

revoke all on function public.modifie_fiche(uuid, jsonb) from public, anon;
grant execute on function public.modifie_fiche(uuid, jsonb) to authenticated;
