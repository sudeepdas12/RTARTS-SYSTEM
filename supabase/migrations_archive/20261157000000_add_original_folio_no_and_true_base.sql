-- Migration: 20261157000000_add_original_folio_no_and_true_base.sql
-- Description: Add original_folio_no, true_initial_kitta_2075, imported_base_kitta to agm_historical_shareholders
--              and converted_from_folio to agm_yearly_snapshots.

ALTER TABLE public.agm_historical_shareholders
  ADD COLUMN IF NOT EXISTS original_folio_no TEXT,
  ADD COLUMN IF NOT EXISTS true_initial_kitta_2075 NUMERIC(15,4),
  ADD COLUMN IF NOT EXISTS imported_base_kitta NUMERIC(15,4);

CREATE INDEX IF NOT EXISTS idx_agm_shareholders_folio
  ON public.agm_historical_shareholders(original_folio_no)
  WHERE original_folio_no IS NOT NULL;

ALTER TABLE public.agm_yearly_snapshots
  ADD COLUMN IF NOT EXISTS converted_from_folio TEXT;

CREATE INDEX IF NOT EXISTS idx_agm_snapshots_conv_folio
  ON public.agm_yearly_snapshots(converted_from_folio)
  WHERE converted_from_folio IS NOT NULL;
