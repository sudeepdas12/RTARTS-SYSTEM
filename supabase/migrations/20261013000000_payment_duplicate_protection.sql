-- Migration: 20261013000000_payment_duplicate_protection.sql
-- Description: Hardens payment duplicate protections with comprehensive partial unique indexes.

-- 1. Ensure payable records cannot be duplicate-paid across any active or completed payment status
DROP INDEX IF EXISTS public.uq_active_payments_payable_id;
CREATE UNIQUE INDEX uq_active_payments_payable_id
ON public.payments USING btree (payable_id)
WHERE (status NOT IN ('Failed', 'Reversed', 'Cancelled') AND payable_id IS NOT NULL);

-- 2. Ensure payment reference numbers (UTR / bank ref) are globally unique across active/completed payments
DROP INDEX IF EXISTS public.uq_active_payments_reference;
CREATE UNIQUE INDEX uq_active_payments_reference
ON public.payments USING btree (payment_reference)
WHERE (status NOT IN ('Failed', 'Reversed', 'Cancelled') AND payment_reference IS NOT NULL AND payment_reference <> '');

-- 3. Comment on index for audit trail
COMMENT ON INDEX public.uq_active_payments_payable_id IS 'Guards against duplicate payout attempts for the same payable row across all active, pending, approved, and completed payments.';
COMMENT ON INDEX public.uq_active_payments_reference IS 'Guards against duplicate payment reference numbers across active bank settlement transactions.';
