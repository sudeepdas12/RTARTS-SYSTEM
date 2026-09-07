-- Migration: 20261152000000_add_columns_to_agm_snapshots.sql
-- Description: Add right_shares_allotted and converted_shares columns to agm_yearly_snapshots

ALTER TABLE public.agm_yearly_snapshots
  ADD COLUMN IF NOT EXISTS right_shares_allotted NUMERIC(15, 4),
  ADD COLUMN IF NOT EXISTS converted_shares NUMERIC(15, 4);
