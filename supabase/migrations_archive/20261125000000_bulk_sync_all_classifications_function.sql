-- High-Performance Database Function to Classify and Synchronize All Clients and Payables in Postgres

CREATE OR REPLACE FUNCTION public.sync_all_classifications_and_taxes()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clients_updated int := 0;
  v_interest_updated int := 0;
  v_dividend_updated int := 0;
BEGIN
  -- 1. Correct any Tax-Exempt Funds in Clients table
  UPDATE public.clients
  SET 
    payee_classification = 'TAX_EXEMPT',
    holder_type = (CASE 
      WHEN full_name ~* '\y(MUTUAL\s*FUND|MF|80[-/:]?20|HIMALAYAN\s*80[-/:]?20|FOCUS\s*(40|30|25|20|\d+)?|SELECT\s*(FUND|SCHEME|30|40|50|\d+)?|SUPER\s*(FUND|SCHEME|30|40|50|\d+)?|NMB\s*(50|FIFTY|HYBRID|SARAL|SULAV|SAMRIDDHI)|50|SAMRIDDHI\s*(FUND|YOJANA|SCHEME)|SAMUNNAT\s*(SCHEME|FUND|YOJANA)|PRAGATI\s*(FUND|SCHEME|YOJANA)|SAHABHAGITA\s*(FUND|SCHEME|YOJANA)|DHANABRIDDHI\s*(YOJANA|FUND)|SABAL\s*(FUND|YOJANA|SCHEME)|UNNATI\s*(FUND|KOSH|SCHEME)|SARAL\s*(BACHAT|FUND|YOJANA)|SHUBHA\s*LAXMI\s*(KOSH|FUND)|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME|YOJANA)|BALANCED\s*(FUND|SCHEME|YOJANA)|BLUECHIP\s*(FUND|SCHEME)|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*(FUND|SCHEME)|DEBT\s*(FUND|SCHEME)|FIXED\s*INCOME|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|DIVIDEND\s*YIELD|MONEY\s*MARKET|INDEX\s*(FUND|SCHEME)|CWEDA\s*EQUITY|STABLE\s*(FUND|SCHEME)|RESOURCE\s*(FUND|SCHEME)|HYBRID\s*(FUND|SCHEME)|SMART\s*(FUND|SCHEME)|YOJANA|SSIS|SIGS|GIMES|SFMF|SBF|LVF|LUK|SLK|KDY|KSY)\y' THEN 'Mutual Fund'
      ELSE 'Tax Exempt'
    END)::public.holder_type,
    classification_status = 'CONFIRMED'
  WHERE 
    full_name !~* '\y(ARMY\s*WELFARE|NEPALESE\s*ARMY\s*WELFARE|SAINIK\s*KALYAN|POLICE\s*WELFARE|PRAHARI\s*KALYAN)\y'
    AND full_name ~* '\y(MUTUAL\s*FUND|MF|80[-/:]?20|HIMALAYAN\s*80[-/:]?20|FOCUS\s*(40|30|25|20|\d+)?|SELECT\s*(FUND|SCHEME|30|40|50|\d+)?|SUPER\s*(FUND|SCHEME|30|40|50|\d+)?|NMB\s*(50|FIFTY|HYBRID|SARAL|SULAV|SAMRIDDHI)|50|SAMRIDDHI\s*(FUND|YOJANA|SCHEME)|SAMUNNAT\s*(SCHEME|FUND|YOJANA)|PRAGATI\s*(FUND|SCHEME|YOJANA)|SAHABHAGITA\s*(FUND|SCHEME|YOJANA)|DHANABRIDDHI\s*(YOJANA|FUND)|SABAL\s*(FUND|YOJANA|SCHEME)|UNNATI\s*(FUND|KOSH|SCHEME)|SARAL\s*(BACHAT|FUND|YOJANA)|SHUBHA\s*LAXMI\s*(KOSH|FUND)|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME|YOJANA)|BALANCED\s*(FUND|SCHEME|YOJANA)|BLUECHIP\s*(FUND|SCHEME)|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*(FUND|SCHEME)|DEBT\s*(FUND|SCHEME)|FIXED\s*INCOME|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|DIVIDEND\s*YIELD|MONEY\s*MARKET|INDEX\s*(FUND|SCHEME)|CWEDA\s*EQUITY|STABLE\s*(FUND|SCHEME)|RESOURCE\s*(FUND|SCHEME)|HYBRID\s*(FUND|SCHEME)|SMART\s*(FUND|SCHEME)|YOJANA|SSIS|SIGS|GIMES|SFMF|SBF|LVF|LUK|SLK|KDY|KSY|NAGARIK\s*LAGANI\s*KOSH|CITIZEN\s*INVESTMENT\s*TRUST|CIT|CIT\s*-\s*CITIZEN|CIT\s*RETIREMENT|KARMACHARI\s*SANCHAYA\s*KOSH|EMPLOYEES?\s*PROVIDENT\s*FUND|EPF|SAMAJIK\s*SURAKSHA\s*KOSH|SOCIAL\s*SECURITY\s*FUND|SSF|AWAKASH\s*(KOSH|FUND|SCHEME)|UPADAN\s*(KOSH|FUND)|GRATUITY\s*(FUND|KOSH|TRUST|SCHEME)|PENSION\s*(FUND|KOSH|SCHEME|TRUST)|PROVIDENT\s*(FUND|KOSH)|RETIREMENT\s*(SCHEME|FUND|TRUST|KOSH)|TEACHERS?\s*(PROVIDENT|PENSION|WELFARE)\s*(FUND|KOSH)?|SHIKSHAK\s*KOSH|RED\s*CROSS|NEPAL\s*RED\s*CROSS)\y';

  -- 2. Correct any Corporate / Institutional Entities in Clients table
  UPDATE public.clients
  SET 
    payee_classification = 'COMPANY_INSTITUTION',
    holder_type = 'Legal Person'::public.holder_type,
    classification_status = 'CONFIRMED'
  WHERE 
    payee_classification != 'TAX_EXEMPT'
    AND (
      full_name ~* '\y(PVT\.?\s*LTD|PRIVATE\s*LIMITED|P\.?\s*LTD|LIMITED|LTD\.?|COMPANY|CORP|CORPORATION|INC\.?|LLC|PLC|PARTNERS|PARTNERSHIP|HOLDINGS\s*COMPANY)\y'
      OR full_name ~* '\y(ARMY\s*WELFARE|NEPALESE\s*ARMY\s*WELFARE|SAINIK\s*KALYAN|POLICE\s*WELFARE|PRAHARI\s*KALYAN|WELFARE\s*FUND)\y'
      OR (
        full_name ~* '\y(BANK|BIKAS\s*BANK|DEVELOPMENT\s*BANK|FINANCE|MICROFINANCE|MICRO\s*INSURANCE|MICRO|LAGHUBITTA|BITTIYA|BITTIYA\s*SANSTHA|BIMA|BEEMA|INSURANCE|REINSURANCE|RE\s*INSURANCE|RE-INSURANCE|NIRJIBAN\s*BIMA|JIBAN\s*BIMA|HYDROPOWER|HYDRO\s*POWER|HYDRO|JALABIDHYUT|DOORSANCHAR|TELECOM|CLEARING\s*HOUSE|STOCK\s*EXCHANGE|STOCK\s*DEALER|STOCK\s*BROKER|STOCK\s*MARKET|CDS\s*(AND|&)?\s*CLEARING|PHARMA|PHARMACEUTICALS|HOSPITAL|COLLEGE|UNIVERSITY|ACADEMY|COOPERATIVE|CO-OPERATIVE|ENTERPRISES|TRADING|TRADERS|SUPPLIERS|DISTRIBUTORS|INDUSTRIES|VENTURES|SECURITIES|BROKER|MERCHANT(\s*BANKING)?|CAPITAL|INVESTMENT|HOLDINGS|ASSET\s*MANAGEMENT|GOVERNMENT|SARKAR|MINISTRY|DEPARTMENT|PRADHIKARAN|SANSTHAN|NIGAM|MUNICIPALITY|NAGARPALIKA|GAUNPALIKA|EMBASSY|GUTHI)\y'
        OR (full_name ~* '\ySAHAKARI\y' AND full_name !~* '\y(BAHADUR|KUMAR|PRASAD|LAL|KUMARI|DEVI|RAJ|MAYA)\y' AND father_name IS NULL)
      )
    );

  -- 3. Correct all Natural Persons in Clients table
  UPDATE public.clients
  SET 
    payee_classification = 'NATURAL_PERSON',
    holder_type = (CASE 
      WHEN holder_type::text ILIKE '%Promoter%' THEN 'Natural Person - Promoter'
      ELSE 'Natural Person - Public'
    END)::public.holder_type,
    classification_status = 'CONFIRMED'
  WHERE 
    payee_classification NOT IN ('TAX_EXEMPT', 'COMPANY_INSTITUTION');

  GET DIAGNOSTICS v_clients_updated = ROW_COUNT;

  -- 4. Sync and enforce tax calculations for all Interest / Debenture payables
  UPDATE public.interest_payables ip
  SET 
    payee_classification = c.payee_classification,
    payee_segment = c.payee_segment,
    tds_rate = CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      WHEN c.payee_classification = 'COMPANY_INSTITUTION' THEN 0.15
      ELSE 0.06
    END,
    tax_amount = CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      WHEN c.payee_classification = 'COMPANY_INSTITUTION' THEN round(COALESCE(ip.gross_interest, 0) * 0.15, 2)
      ELSE round(COALESCE(ip.gross_interest, 0) * 0.06, 2)
    END,
    net_interest = round(COALESCE(ip.gross_interest, 0) - CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      WHEN c.payee_classification = 'COMPANY_INSTITUTION' THEN round(COALESCE(ip.gross_interest, 0) * 0.15, 2)
      ELSE round(COALESCE(ip.gross_interest, 0) * 0.06, 2)
    END, 2),
    net_payable = round(COALESCE(ip.gross_interest, 0) - CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      WHEN c.payee_classification = 'COMPANY_INSTITUTION' THEN round(COALESCE(ip.gross_interest, 0) * 0.15, 2)
      ELSE round(COALESCE(ip.gross_interest, 0) * 0.06, 2)
    END, 2),
    classification_status = 'CONFIRMED'
  FROM public.clients c
  WHERE ip.client_id = c.id;

  GET DIAGNOSTICS v_interest_updated = ROW_COUNT;

  -- 5. Sync and enforce tax calculations for all Dividend payables
  UPDATE public.dividend_payables dp
  SET 
    payee_classification = c.payee_classification,
    payee_segment = c.payee_segment,
    tds_rate = CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      ELSE 0.05
    END,
    tax_amount = CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      ELSE round(COALESCE(dp.gross_dividend, 0) * 0.05, 2)
    END,
    net_payable = round(COALESCE(dp.gross_dividend, 0) - CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      ELSE round(COALESCE(dp.gross_dividend, 0) * 0.05, 2)
    END, 2),
    classification_status = 'CONFIRMED'
  FROM public.clients c
  WHERE dp.client_id = c.id;

  GET DIAGNOSTICS v_dividend_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'clients_updated', v_clients_updated,
    'interest_payables_updated', v_interest_updated,
    'dividend_payables_updated', v_dividend_updated,
    'status', 'SUCCESS'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_all_classifications_and_taxes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_all_classifications_and_taxes() TO service_role;
