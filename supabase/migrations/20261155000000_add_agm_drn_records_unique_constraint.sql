-- Migration: 20261155000000_add_agm_drn_records_unique_constraint.sql
-- Description: Adds unique constraint on folio_no to enable ON CONFLICT (folio_no) upserts

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'agm_drn_records_folio_no_key' 
    AND conrelid = 'public.agm_drn_records'::regclass
  ) THEN
    ALTER TABLE public.agm_drn_records ADD CONSTRAINT agm_drn_records_folio_no_key UNIQUE (folio_no);
  END IF;
END $$;
