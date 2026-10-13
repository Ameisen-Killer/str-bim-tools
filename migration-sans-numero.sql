-- Planification — affaires sans numéro (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Le numéro d'affaire devient facultatif : une affaire
-- sans numéro le porte vide (null). L'unicité du numéro dans un bureau reste,
-- pour les affaires qui en ont un (plusieurs affaires sans numéro passent).
-- ---------------------------------------------------------------------------
begin;

alter table public.affaires alter column code drop not null;
update public.affaires set code = null where btrim(code) = '';

commit;
