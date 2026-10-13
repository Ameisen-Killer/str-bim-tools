-- Planification — responsable d'affaire (13.10.2026)
-- ---------------------------------------------------------------------------
-- À lancer une fois dans Supabase › SQL Editor › New query › Run.
-- Relançable sans risque. Ajoute aux affaires leur responsable : une fiche
-- de l'équipe, qui redevient vide si la fiche est supprimée.
-- ---------------------------------------------------------------------------
begin;

alter table public.affaires add column if not exists responsable_id uuid;
alter table public.affaires drop constraint if exists affaires_responsable_fk;
alter table public.affaires add constraint affaires_responsable_fk
  foreign key (responsable_id) references public.membres (id) on delete set null;
comment on column public.affaires.responsable_id is 'Responsable d''affaire : une fiche de l''équipe (membres).';

commit;
