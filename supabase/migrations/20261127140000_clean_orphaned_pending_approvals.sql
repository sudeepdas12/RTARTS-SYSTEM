-- =============================================================================
-- Migration: Auto-close Pending Approvals when Payment Batches are Deleted
-- =============================================================================
-- Prevents orphaned status='Pending' tickets in public.pending_approvals when
-- a parent row in public.payment_batches is reverted or deleted, which
-- previously caused PostgREST .single() 406 errors ("Cannot coerce the result to
-- a single JSON object") during Approval Review.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.close_pending_approvals_on_batch_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.pending_approvals
  SET status = 'Rejected',
      review_notes = COALESCE(
        NULLIF(trim(review_notes), ''),
        'Parent payment batch (' || COALESCE(OLD.batch_name, OLD.id::text) || ') was reverted or deleted.'
      ),
      reviewed_at = COALESCE(reviewed_at, now())
  WHERE entity_type = 'payment_batches'
    AND entity_id = OLD.id
    AND status = 'Pending';

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_batches_close_pending_approvals ON public.payment_batches;
CREATE TRIGGER trg_payment_batches_close_pending_approvals
  BEFORE DELETE ON public.payment_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.close_pending_approvals_on_batch_delete();

-- Close any existing orphaned Pending payment_batches approval tickets
UPDATE public.pending_approvals pa
SET status = 'Rejected',
    review_notes = COALESCE(
      NULLIF(trim(pa.review_notes), ''),
      'Parent payment batch no longer exists (closed automatically during cleanup).'
    ),
    reviewed_at = COALESCE(pa.reviewed_at, now())
WHERE pa.entity_type = 'payment_batches'
  AND pa.status = 'Pending'
  AND (
    pa.entity_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.payment_batches pb WHERE pb.id = pa.entity_id
    )
  );
