-- Migration: Add automated payment batch completion trigger

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_fn_sync_payment_batch_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When a batch status changes to Completed, atomically complete all payments and underlying payables
  IF NEW.status = 'Completed' AND (OLD.status IS NULL OR OLD.status != 'Completed') THEN
    PERFORM public.complete_payment_batch_atomic(NEW.id, NEW.approved_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_batch_completed ON public.payment_batches;
CREATE TRIGGER trg_payment_batch_completed
AFTER UPDATE OF status ON public.payment_batches
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_sync_payment_batch_completion();

COMMIT;
