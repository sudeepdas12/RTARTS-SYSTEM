-- Normalize staged upload rows before the approval commit RPC consumes them.
-- The commit RPC historically accepted dividend-shaped keys only, while the
-- parser emits canonical interest keys such as gross_interest and net_payable.
CREATE OR REPLACE FUNCTION public.normalize_import_staging_rows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_row jsonb;
    v_rows jsonb := '[]'::jsonb;
    v_gross text;
    v_tax text;
    v_net text;
BEGIN
    FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.staged_rows, '[]'::jsonb))
    LOOP
        IF NOT (v_row ? 'name') THEN
            v_row := jsonb_set(
                v_row,
                '{name}',
                to_jsonb(COALESCE(
                    NULLIF(v_row->>'full_name', ''),
                    NULLIF(v_row->>'fullName', ''),
                    NULLIF(v_row->>'investor_name', ''),
                    NULLIF(v_row->>'shareholder_name', ''),
                    ''
                )),
                true
            );
        END IF;

        IF NOT (v_row ? 'bank_account_number') THEN
            v_row := jsonb_set(
                v_row,
                '{bank_account_number}',
                to_jsonb(COALESCE(
                    NULLIF(v_row->>'bank_account_no', ''),
                    NULLIF(v_row->>'account_number', ''),
                    NULLIF(v_row->>'account_no', ''),
                    ''
                )),
                true
            );
        END IF;

        IF NEW.target_table = 'interest_payables' THEN
            v_gross := COALESCE(
                NULLIF(v_row->>'gross_interest', ''),
                NULLIF(v_row->>'interest_amount', ''),
                NULLIF(v_row->>'interest', ''),
                NULLIF(v_row->>'gross_amount', ''),
                NULLIF(v_row->>'gross', '')
            );
            v_tax := COALESCE(
                NULLIF(v_row->>'tax_amount', ''),
                NULLIF(v_row->>'tax', ''),
                NULLIF(v_row->>'tds', ''),
                NULLIF(v_row->>'tds_amount', '')
            );
            v_net := COALESCE(
                NULLIF(v_row->>'net_interest', ''),
                NULLIF(v_row->>'net_interest_payable', ''),
                NULLIF(v_row->>'net_amount', ''),
                NULLIF(v_row->>'net_payable', ''),
                NULLIF(v_row->>'net', '')
            );

            IF v_gross IS NOT NULL AND NOT (v_row ? 'gross_dividend') THEN
                v_row := jsonb_set(v_row, '{gross_dividend}', to_jsonb(v_gross), true);
            END IF;
            IF v_tax IS NOT NULL AND NOT (v_row ? 'tax_amount') THEN
                v_row := jsonb_set(v_row, '{tax_amount}', to_jsonb(v_tax), true);
            END IF;
            IF v_net IS NOT NULL AND NOT (v_row ? 'net_payable') THEN
                v_row := jsonb_set(v_row, '{net_payable}', to_jsonb(v_net), true);
            END IF;
        END IF;

        v_rows := v_rows || jsonb_build_array(v_row);
    END LOOP;

    NEW.staged_rows := v_rows;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_import_staging_rows ON public.import_staging;
CREATE TRIGGER trg_normalize_import_staging_rows
BEFORE INSERT OR UPDATE OF staged_rows, target_table ON public.import_staging
FOR EACH ROW
EXECUTE FUNCTION public.normalize_import_staging_rows();

-- The staged commit RPC inserts interest rows without the NOT NULL due_date
-- column and does not persist instrument/date fields emitted by the parser.
-- Supply those values in a BEFORE trigger so the existing atomic RPC remains
-- compatible while preserving the complete interest section data.
CREATE OR REPLACE FUNCTION public.populate_staged_interest_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_boid text;
    v_row jsonb;
    v_due_date text;
BEGIN
    IF NEW.due_date IS NULL THEN
        SELECT c.boid
        INTO v_boid
        FROM public.clients c
        WHERE c.id = NEW.client_id
        LIMIT 1;

        SELECT r.value
        INTO v_row
        FROM public.import_staging s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.staged_rows, '[]'::jsonb)) r(value)
        WHERE s.upload_id = NEW.upload_id
          AND COALESCE(
              r.value->>'boid',
              r.value->>'BOID',
              r.value->>'client_code',
              r.value->>'folio',
              r.value->>'FOLIO'
          ) = v_boid
        LIMIT 1;

        v_due_date := COALESCE(
            NULLIF(v_row->>'due_date', ''),
            NULLIF(v_row->>'dueDate', ''),
            NULLIF(v_row->>'DUE DATE', ''),
            NULLIF(v_row->>'maturity_date', ''),
            NULLIF(v_row->>'payment_date', ''),
            NULLIF(v_row->>'interest_date', '')
        );

        IF v_due_date IS NOT NULL AND v_due_date ~ '^\d{4}-\d{2}-\d{2}$' THEN
            NEW.due_date := v_due_date::date;
        ELSE
            NEW.due_date := CURRENT_DATE;
        END IF;

    END IF;

    IF NEW.instrument_ref IS NULL THEN
        NEW.instrument_ref := COALESCE(
            NULLIF(v_row->>'instrument_ref', ''),
            NULLIF(v_row->>'instrument', ''),
            NULLIF(v_row->>'instrument_no', ''),
            NULLIF(v_row->>'security', ''),
            NULLIF(v_row->>'series', '')
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_staged_interest_metadata ON public.interest_payables;
CREATE TRIGGER trg_populate_staged_interest_metadata
BEFORE INSERT ON public.interest_payables
FOR EACH ROW
EXECUTE FUNCTION public.populate_staged_interest_metadata();

REVOKE ALL ON FUNCTION public.normalize_import_staging_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.populate_staged_interest_metadata() FROM PUBLIC;