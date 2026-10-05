-- ============================================================================
-- Migration: 20261181000000_agm_staging_atomic_import_and_promotion.sql
-- Description:
-- 1. Add imported_opening_fraction and imported_base_fiscal_year to agm_historical_shareholders
-- 2. Create agm_import_staging table with RLS
-- 3. Provide commit_agm_fiscal_year_import stored procedure for transactional import replacement
-- 4. Provide promote_agm_clients_and_payables stored procedure for atomic promotion
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add missing historical base columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.agm_historical_shareholders
  ADD COLUMN IF NOT EXISTS imported_opening_fraction NUMERIC(10, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS imported_base_fiscal_year TEXT;

-- ----------------------------------------------------------------------------
-- 2. Create agm_import_staging table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agm_import_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year TEXT NOT NULL,
  boid TEXT NOT NULL,
  shareholder_row JSONB NOT NULL,
  snapshot_row JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agm_staging_lookup ON public.agm_import_staging(company_id, fiscal_year, batch_id);

ALTER TABLE public.agm_import_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agm_import_staging_select" ON public.agm_import_staging;
CREATE POLICY "agm_import_staging_select" ON public.agm_import_staging
  FOR SELECT TO authenticated
  USING (
    public.has_company_access(auth.uid(), company_id)
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

DROP POLICY IF EXISTS "agm_import_staging_insert" ON public.agm_import_staging;
CREATE POLICY "agm_import_staging_insert" ON public.agm_import_staging
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_access(auth.uid(), company_id)
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

DROP POLICY IF EXISTS "agm_import_staging_delete" ON public.agm_import_staging;
CREATE POLICY "agm_import_staging_delete" ON public.agm_import_staging
  FOR DELETE TO authenticated
  USING (
    public.has_company_access(auth.uid(), company_id)
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- ----------------------------------------------------------------------------
-- 3. Stored Procedure: commit_agm_fiscal_year_import
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_agm_fiscal_year_import(
  p_company_id UUID,
  p_fiscal_year TEXT,
  p_batch_id UUID,
  p_event_name TEXT,
  p_report JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staged_count INT := 0;
  v_deleted_snapshots INT := 0;
  v_archived_shareholders INT := 0;
  v_upserted_shareholders INT := 0;
  v_upserted_snapshots INT := 0;
  v_total_kitta NUMERIC := 0;
  v_total_bonus NUMERIC := 0;
  v_total_cash NUMERIC := 0;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND NOT public.has_company_access(v_user_id, p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_staged_count
  FROM public.agm_import_staging
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year
    AND batch_id = p_batch_id;

  IF v_staged_count = 0 THEN
    RAISE EXCEPTION 'No staged records found for batch % and fiscal year %', p_batch_id, p_fiscal_year USING ERRCODE = 'P0002';
  END IF;

  -- 1. Transactional replacement: remove stale snapshots for (company_id, fiscal_year) not in staging
  DELETE FROM public.agm_yearly_snapshots s
  WHERE s.company_id = p_company_id
    AND s.fiscal_year = p_fiscal_year
    AND NOT EXISTS (
      SELECT 1 FROM public.agm_import_staging st
      WHERE st.company_id = p_company_id
        AND st.fiscal_year = p_fiscal_year
        AND st.batch_id = p_batch_id
        AND st.boid = s.boid
    );
  GET DIAGNOSTICS v_deleted_snapshots = ROW_COUNT;

  -- 2. Prune orphaned shareholders with zero snapshots remaining across all fiscal years
  DELETE FROM public.agm_historical_shareholders h
  WHERE h.company_id = p_company_id
    AND h.boid NOT IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
    AND NOT EXISTS (
      SELECT 1 FROM public.agm_import_staging st
      WHERE st.company_id = p_company_id
        AND st.batch_id = p_batch_id
        AND st.boid = h.boid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.agm_yearly_snapshots s
      WHERE s.company_id = p_company_id
        AND s.boid = h.boid
    );
  GET DIAGNOSTICS v_archived_shareholders = ROW_COUNT;

  -- 3. Upsert master shareholders from staging
  INSERT INTO public.agm_historical_shareholders (
    company_id,
    boid,
    shareholder_name,
    father_name,
    grandfather_name,
    guardian_name,
    spouse_name,
    citizenship_no,
    address,
    district,
    contact_no,
    email,
    bank_name,
    bank_account_no,
    pan_no,
    original_folio_no,
    holder_type,
    initial_kitta_2075,
    initial_fraction_2075,
    imported_base_kitta,
    imported_opening_fraction,
    imported_base_fiscal_year,
    converted_shares,
    current_kitta_2081,
    current_fraction_2081,
    total_bonus_shares,
    total_cash_dividend,
    total_tax_withheld,
    reconciliation_status,
    has_discrepancy,
    anomalies,
    updated_at
  )
  SELECT
    p_company_id,
    st.boid,
    COALESCE(st.shareholder_row->>'shareholder_name', 'Unknown Shareholder'),
    (st.shareholder_row->>'father_name'),
    (st.shareholder_row->>'grandfather_name'),
    (st.shareholder_row->>'guardian_name'),
    (st.shareholder_row->>'spouse_name'),
    (st.shareholder_row->>'citizenship_no'),
    (st.shareholder_row->>'address'),
    (st.shareholder_row->>'district'),
    (st.shareholder_row->>'contact_no'),
    (st.shareholder_row->>'email'),
    (st.shareholder_row->>'bank_name'),
    (st.shareholder_row->>'bank_account_no'),
    (st.shareholder_row->>'pan_no'),
    (st.shareholder_row->>'original_folio_no'),
    COALESCE(st.shareholder_row->>'holder_type', 'PUBLIC'),
    COALESCE((st.shareholder_row->>'initial_kitta_2075')::numeric, 0),
    COALESCE((st.shareholder_row->>'initial_fraction_2075')::numeric, 0),
    (st.shareholder_row->>'imported_base_kitta')::numeric,
    COALESCE((st.shareholder_row->>'imported_opening_fraction')::numeric, 0),
    (st.shareholder_row->>'imported_base_fiscal_year'),
    (st.shareholder_row->>'converted_shares')::numeric,
    COALESCE((st.shareholder_row->>'current_kitta_2081')::numeric, 0),
    COALESCE((st.shareholder_row->>'current_fraction_2081')::numeric, 0),
    COALESCE((st.shareholder_row->>'total_bonus_shares')::numeric, 0),
    COALESCE((st.shareholder_row->>'total_cash_dividend')::numeric, 0),
    COALESCE((st.shareholder_row->>'total_tax_withheld')::numeric, 0),
    COALESCE(st.shareholder_row->>'reconciliation_status', 'RECONCILED'),
    COALESCE((st.shareholder_row->>'has_discrepancy')::boolean, false),
    COALESCE((SELECT array_agg(x::text) FROM jsonb_array_elements_text(st.shareholder_row->'anomalies') x), ARRAY[]::TEXT[]),
    now()
  FROM public.agm_import_staging st
  WHERE st.company_id = p_company_id
    AND st.fiscal_year = p_fiscal_year
    AND st.batch_id = p_batch_id
  ON CONFLICT (company_id, boid) DO UPDATE
  SET shareholder_name = COALESCE(EXCLUDED.shareholder_name, public.agm_historical_shareholders.shareholder_name),
      father_name = COALESCE(EXCLUDED.father_name, public.agm_historical_shareholders.father_name),
      grandfather_name = COALESCE(EXCLUDED.grandfather_name, public.agm_historical_shareholders.grandfather_name),
      guardian_name = COALESCE(EXCLUDED.guardian_name, public.agm_historical_shareholders.guardian_name),
      spouse_name = COALESCE(EXCLUDED.spouse_name, public.agm_historical_shareholders.spouse_name),
      citizenship_no = COALESCE(EXCLUDED.citizenship_no, public.agm_historical_shareholders.citizenship_no),
      address = COALESCE(EXCLUDED.address, public.agm_historical_shareholders.address),
      district = COALESCE(EXCLUDED.district, public.agm_historical_shareholders.district),
      contact_no = COALESCE(EXCLUDED.contact_no, public.agm_historical_shareholders.contact_no),
      email = COALESCE(EXCLUDED.email, public.agm_historical_shareholders.email),
      bank_name = COALESCE(EXCLUDED.bank_name, public.agm_historical_shareholders.bank_name),
      bank_account_no = COALESCE(EXCLUDED.bank_account_no, public.agm_historical_shareholders.bank_account_no),
      pan_no = COALESCE(EXCLUDED.pan_no, public.agm_historical_shareholders.pan_no),
      original_folio_no = COALESCE(EXCLUDED.original_folio_no, public.agm_historical_shareholders.original_folio_no),
      holder_type = EXCLUDED.holder_type,
      imported_base_kitta = COALESCE(EXCLUDED.imported_base_kitta, public.agm_historical_shareholders.imported_base_kitta),
      imported_opening_fraction = COALESCE(EXCLUDED.imported_opening_fraction, public.agm_historical_shareholders.imported_opening_fraction),
      imported_base_fiscal_year = COALESCE(EXCLUDED.imported_base_fiscal_year, public.agm_historical_shareholders.imported_base_fiscal_year),
      converted_shares = COALESCE(EXCLUDED.converted_shares, public.agm_historical_shareholders.converted_shares),
      current_kitta_2081 = EXCLUDED.current_kitta_2081,
      current_fraction_2081 = EXCLUDED.current_fraction_2081,
      total_bonus_shares = EXCLUDED.total_bonus_shares,
      total_cash_dividend = EXCLUDED.total_cash_dividend,
      total_tax_withheld = EXCLUDED.total_tax_withheld,
      reconciliation_status = EXCLUDED.reconciliation_status,
      has_discrepancy = EXCLUDED.has_discrepancy,
      anomalies = EXCLUDED.anomalies,
      updated_at = now();
  GET DIAGNOSTICS v_upserted_shareholders = ROW_COUNT;

  -- 4. Upsert yearly snapshots from staging (JOINing with agm_historical_shareholders to guarantee shareholder_id FK)
  INSERT INTO public.agm_yearly_snapshots (
    company_id,
    shareholder_id,
    boid,
    fiscal_year,
    event_name,
    base_kitta,
    previous_fraction,
    gross_bonus_entitlement,
    issued_whole_bonus,
    carried_new_fraction,
    gross_cash_dividend,
    bonus_tax_withheld,
    cash_tax_withheld,
    net_cash_payable,
    post_event_kitta,
    excel_discrepancy_flag,
    is_locked,
    discrepancy_details,
    remarks
  )
  SELECT
    p_company_id,
    sh.id,
    st.boid,
    p_fiscal_year,
    p_event_name,
    COALESCE((st.snapshot_row->>'base_kitta')::numeric, 0),
    COALESCE((st.snapshot_row->>'previous_fraction')::numeric, 0),
    COALESCE((st.snapshot_row->>'gross_bonus_entitlement')::numeric, 0),
    COALESCE((st.snapshot_row->>'issued_whole_bonus')::numeric, 0),
    COALESCE((st.snapshot_row->>'carried_new_fraction')::numeric, 0),
    COALESCE((st.snapshot_row->>'gross_cash_dividend')::numeric, 0),
    COALESCE((st.snapshot_row->>'bonus_tax_withheld')::numeric, 0),
    COALESCE((st.snapshot_row->>'cash_tax_withheld')::numeric, 0),
    COALESCE((st.snapshot_row->>'net_cash_payable')::numeric, 0),
    COALESCE((st.snapshot_row->>'post_event_kitta')::numeric, 0),
    COALESCE((st.snapshot_row->>'excel_discrepancy_flag')::boolean, false),
    true,
    (st.snapshot_row->>'discrepancy_details'),
    (st.snapshot_row->>'remarks')
  FROM public.agm_import_staging st
  JOIN public.agm_historical_shareholders sh
    ON sh.company_id = p_company_id
   AND sh.boid = st.boid
  WHERE st.company_id = p_company_id
    AND st.fiscal_year = p_fiscal_year
    AND st.batch_id = p_batch_id
  ON CONFLICT (company_id, boid, fiscal_year) DO UPDATE
  SET shareholder_id = COALESCE(EXCLUDED.shareholder_id, public.agm_yearly_snapshots.shareholder_id),
      event_name = EXCLUDED.event_name,
      base_kitta = EXCLUDED.base_kitta,
      previous_fraction = EXCLUDED.previous_fraction,
      gross_bonus_entitlement = EXCLUDED.gross_bonus_entitlement,
      issued_whole_bonus = EXCLUDED.issued_whole_bonus,
      carried_new_fraction = EXCLUDED.carried_new_fraction,
      gross_cash_dividend = EXCLUDED.gross_cash_dividend,
      bonus_tax_withheld = EXCLUDED.bonus_tax_withheld,
      cash_tax_withheld = EXCLUDED.cash_tax_withheld,
      net_cash_payable = EXCLUDED.net_cash_payable,
      post_event_kitta = EXCLUDED.post_event_kitta,
      excel_discrepancy_flag = EXCLUDED.excel_discrepancy_flag,
      is_locked = true,
      discrepancy_details = EXCLUDED.discrepancy_details,
      remarks = EXCLUDED.remarks;
  GET DIAGNOSTICS v_upserted_snapshots = ROW_COUNT;

  -- 5. Calculate meta summary and upsert agm_fiscal_year_meta
  SELECT
    COALESCE(SUM((st.snapshot_row->>'base_kitta')::numeric), 0),
    COALESCE(SUM((st.snapshot_row->>'issued_whole_bonus')::numeric), 0),
    COALESCE(SUM((st.snapshot_row->>'gross_cash_dividend')::numeric), 0)
  INTO v_total_kitta, v_total_bonus, v_total_cash
  FROM public.agm_import_staging st
  WHERE st.company_id = p_company_id
    AND st.fiscal_year = p_fiscal_year
    AND st.batch_id = p_batch_id;

  INSERT INTO public.agm_fiscal_year_meta (
    company_id,
    fiscal_year,
    event_name,
    total_shareholders,
    total_kitta,
    total_bonus_kitta,
    total_cash_npr,
    is_locked,
    imported_by,
    imported_at,
    import_report
  ) VALUES (
    p_company_id,
    p_fiscal_year,
    p_event_name,
    v_staged_count,
    v_total_kitta,
    v_total_bonus,
    v_total_cash,
    true,
    v_user_id,
    now(),
    p_report
  )
  ON CONFLICT (company_id, fiscal_year) DO UPDATE
  SET event_name = EXCLUDED.event_name,
      total_shareholders = EXCLUDED.total_shareholders,
      total_kitta = EXCLUDED.total_kitta,
      total_bonus_kitta = EXCLUDED.total_bonus_kitta,
      total_cash_npr = EXCLUDED.total_cash_npr,
      is_locked = true,
      imported_by = EXCLUDED.imported_by,
      imported_at = now(),
      import_report = EXCLUDED.import_report;

  -- 6. Purge staging rows for this batch
  DELETE FROM public.agm_import_staging
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year
    AND batch_id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'isLocked', true,
    'savedCount', v_upserted_shareholders,
    'snapshotsSaved', v_upserted_snapshots,
    'deletedSnapshotsCount', v_deleted_snapshots,
    'archivedShareholdersCount', v_archived_shareholders,
    'totalKitta', v_total_kitta,
    'totalBonus', v_total_bonus,
    'totalCash', v_total_cash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_agm_fiscal_year_import(UUID, TEXT, UUID, TEXT, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.commit_agm_fiscal_year_import(UUID, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Stored Procedure: promote_agm_clients_and_payables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_agm_clients_and_payables(
  p_company_id UUID,
  p_clients JSONB,
  p_payables JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_rec JSONB;
  v_pay_rec JSONB;
  v_upserted_clients INT := 0;
  v_inserted_payables INT := 0;
  v_target_fiscal_year TEXT;
  v_client_id UUID;
  v_boid_to_id_map JSONB := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND NOT public.has_company_access(v_user_id, p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  -- 1. Upsert all clients in the batch
  FOR v_client_rec IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    INSERT INTO public.clients (
      company_id,
      boid,
      name,
      father_name,
      grandfather_name,
      citizenship_no,
      pan_no,
      address,
      contact_number,
      bank_name,
      bank_account_number,
      holder_type,
      total_kitta,
      fraction_kitta,
      status
    ) VALUES (
      p_company_id,
      v_client_rec->>'boid',
      v_client_rec->>'name',
      v_client_rec->>'father_name',
      v_client_rec->>'grandfather_name',
      v_client_rec->>'citizenship_no',
      v_client_rec->>'pan_no',
      v_client_rec->>'address',
      v_client_rec->>'contact_number',
      v_client_rec->>'bank_name',
      v_client_rec->>'bank_account_number',
      COALESCE(v_client_rec->>'holder_type', 'Individual'),
      COALESCE((v_client_rec->>'total_kitta')::numeric, 0),
      COALESCE((v_client_rec->>'fraction_kitta')::numeric, 0),
      'Active'
    )
    ON CONFLICT (company_id, boid) DO UPDATE
    SET name = EXCLUDED.name,
        father_name = COALESCE(EXCLUDED.father_name, public.clients.father_name),
        grandfather_name = COALESCE(EXCLUDED.grandfather_name, public.clients.grandfather_name),
        citizenship_no = COALESCE(EXCLUDED.citizenship_no, public.clients.citizenship_no),
        pan_no = COALESCE(EXCLUDED.pan_no, public.clients.pan_no),
        address = COALESCE(EXCLUDED.address, public.clients.address),
        contact_number = COALESCE(EXCLUDED.contact_number, public.clients.contact_number),
        bank_name = COALESCE(EXCLUDED.bank_name, public.clients.bank_name),
        bank_account_number = COALESCE(EXCLUDED.bank_account_number, public.clients.bank_account_number),
        total_kitta = EXCLUDED.total_kitta,
        fraction_kitta = EXCLUDED.fraction_kitta,
        status = 'Active',
        updated_at = now()
    RETURNING id INTO v_client_id;

    v_upserted_clients := v_upserted_clients + 1;
    v_boid_to_id_map := jsonb_set(v_boid_to_id_map, ARRAY[v_client_rec->>'boid'], to_jsonb(v_client_id::text));
  END LOOP;

  -- 2. Handle fraction dividend payables atomically if present
  IF jsonb_array_length(p_payables) > 0 THEN
    v_target_fiscal_year := (p_payables->0)->>'fiscal_year';

    -- Clear prior fraction payables for these clients and fiscal year
    DELETE FROM public.dividend_payables dp
    WHERE dp.company_id = p_company_id
      AND dp.fiscal_year = v_target_fiscal_year
      AND dp.remarks ILIKE '%fraction remainder%'
      AND dp.client_id IN (
        SELECT (v_boid_to_id_map->>c_boid)::uuid
        FROM (SELECT DISTINCT value->>'boid' AS c_boid FROM jsonb_array_elements(p_payables)) t
        WHERE v_boid_to_id_map ? c_boid
      );

    -- Insert new fraction payables
    FOR v_pay_rec IN SELECT * FROM jsonb_array_elements(p_payables)
    LOOP
      v_client_id := (v_boid_to_id_map->>(v_pay_rec->>'boid'))::uuid;
      IF v_client_id IS NOT NULL THEN
        INSERT INTO public.dividend_payables (
          company_id,
          client_id,
          fiscal_year,
          shares_held,
          fraction_shares,
          gross_dividend,
          tax_amount,
          net_payable,
          payment_status,
          remarks
        ) VALUES (
          p_company_id,
          v_client_id,
          v_pay_rec->>'fiscal_year',
          COALESCE((v_pay_rec->>'shares_held')::numeric, 0),
          COALESCE((v_pay_rec->>'fraction_shares')::numeric, 0),
          COALESCE((v_pay_rec->>'gross_dividend')::numeric, 0),
          COALESCE((v_pay_rec->>'tax_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'net_payable')::numeric, 0),
          'Pending',
          v_pay_rec->>'remarks'
        );
        v_inserted_payables := v_inserted_payables + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'clientsUpserted', v_upserted_clients,
    'payablesInserted', v_inserted_payables
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_agm_clients_and_payables(UUID, JSONB, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.promote_agm_clients_and_payables(UUID, JSONB, JSONB) TO authenticated, service_role;
