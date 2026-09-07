-- Migration: 20261154000000_add_agm_indexes.sql
-- Description: Add critical foreign key and sorting indexes to AGM historical tables

CREATE INDEX IF NOT EXISTS idx_agm_snapshots_shareholder_id ON public.agm_yearly_snapshots(shareholder_id);
CREATE INDEX IF NOT EXISTS idx_agm_shareholders_current_kitta ON public.agm_historical_shareholders(current_kitta_2081 DESC);
CREATE INDEX IF NOT EXISTS idx_agm_shareholders_holder_type ON public.agm_historical_shareholders(holder_type);
