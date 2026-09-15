-- ============================================================================
-- Migration: 20261182000000_fix_agm_atomic_import_lock_and_shareholder_fk.sql
-- Description:
-- 1. Updates commit_agm_fiscal_year_import to join agm_historical_shareholders
--    to populate shareholder_id on agm_yearly_snapshots.
-- 2. Sets is_locked = true in agm_fiscal_year_meta on import.
-- ============================================================================

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
  v_user_id UUID := auth.uid();
  v_staged_count INT := 0;
  v_upserted_shareholders INT := 0;
  v_upserted_snapshots INT := 0;
  v_deleted_snapshots INT := 0;
  v_archived_shareholders INT := 0;
  v_total_kitta NUMERIC(15, 4) := 0;
  v_total_bonus NUMERIC(15, 4) := 0;
  v_total_cash NUMERIC(15, 2) := 0;
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

  -- 5. Calculate meta summary and upsert agm_fiscal_year_meta (setting is_locked = true)
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
