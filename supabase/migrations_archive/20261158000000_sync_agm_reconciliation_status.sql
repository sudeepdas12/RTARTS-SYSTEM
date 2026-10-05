-- Migration: 20261158000000_sync_agm_reconciliation_status.sql
-- Description: Align reconciliation_status to RECONCILED when has_discrepancy is false and statutory corrections applied

UPDATE public.agm_historical_shareholders
SET reconciliation_status = 'RECONCILED',
    updated_at = now()
WHERE has_discrepancy = false
  AND reconciliation_status = 'DISCREPANCY';
