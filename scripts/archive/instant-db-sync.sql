-- Ultra-Fast Instant DB Sync with Correct Postgres POSIX Boundaries

-- 1. Correct Tax-Exempt Funds in Clients
UPDATE public.clients
SET 
  payee_classification = 'TAX_EXEMPT',
  holder_type = (CASE 
    WHEN full_name ~* '\m(MUTUAL\s*FUND|MF|FOCUS\s*(40|30|25|\d+)|SELECT\s*(30|40|\d+)|SUPER\s*(30|40|\d+)|NMB\s*(50|HYBRID|SARAL|SULAV|SAMRIDDHI)|\y50\y|SAMRIDDHI\s*FUND|SAMUNNAT\s*SCHEME|PRAGATI\s*FUND|SAHABHAGITA\s*FUND|DHANABRIDDHI\s*YOJANA|SABAL\s*FUND|UNNATI\s*FUND|SARAL\s*(BACHAT|FUND)|SHUBHA\s*LAXMI\s*KOSH|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP\s*(FUND|SCHEME)|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*FUND|DEBT\s*FUND|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|YOJANA)\M' THEN 'Mutual Fund'
    ELSE 'Tax Exempt'
  END)::public.holder_type,
  classification_status = 'CONFIRMED'
WHERE 
  full_name ~* '\m(MUTUAL\s*FUND|MF|FOCUS\s*(40|30|25|\d+)|SELECT\s*(30|40|\d+)|SUPER\s*(30|40|\d+)|NMB\s*(50|HYBRID|SARAL|SULAV|SAMRIDDHI)|\y50\y|SAMRIDDHI\s*FUND|SAMUNNAT\s*SCHEME|PRAGATI\s*FUND|SAHABHAGITA\s*FUND|DHANABRIDDHI\s*YOJANA|SABAL\s*FUND|UNNATI\s*FUND|SARAL\s*(BACHAT|FUND)|SHUBHA\s*LAXMI\s*KOSH|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP\s*(FUND|SCHEME)|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*FUND|DEBT\s*FUND|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|YOJANA|NAGARIK\s*LAGANI\s*KOSH|CITIZEN\s*INVESTMENT\s*TRUST|CIT|CIT\s*-\s*CITIZEN|CIT\s*RETIREMENT|KARMACHARI\s*SANCHAYA\s*KOSH|EMPLOYEES\s*PROVIDENT\s*FUND|EPF|SAMAJIK\s*SURAKSHA\s*KOSH|SOCIAL\s*SECURITY\s*FUND|SSF|ARMY\s*WELFARE|NEPALESE\s*ARMY\s*WELFARE|SAINIK\s*KALYAN|POLICE\s*WELFARE|PRAHARI\s*KALYAN|AWAKASH\s*KOSH|PENSION\s*(FUND|KOSH)|KALYAN\s*KOSH|RETIREMENT\s*SCHEME|RETIREMENT\s*FUND)\M';

-- 2. Correct Corporate / Institutional Entities in Clients
UPDATE public.clients
SET 
  payee_classification = 'COMPANY_INSTITUTION',
  holder_type = 'Legal Person'::public.holder_type,
  classification_status = 'CONFIRMED'
WHERE 
  payee_classification != 'TAX_EXEMPT'
  AND (
    full_name ~* '(PVT|P|PRIVATE)\.?\s*(LTD|LIMITED)|\m(LIMITED|LTD|COMPANY|CORP|CORPORATION|INC|LLC|PLC|PARTNERS|PARTNERSHIP|HOLDINGS|SECURITIES)\M'
    OR full_name ~* '\m(BANK|BIKAS\s*BANK|DEVELOPMENT\s*BANK|FINANCE|MICROFINANCE|LAGHUBITTA|BITTIYA|BITTIYA\s*SANSTHA|BIMA|BEEMA|INSURANCE|REINSURANCE|RE\s*INSURANCE|RE-INSURANCE|NIRJIBAN\s*BIMA|JIBAN\s*BIMA|HYDROPOWER|HYDRO\s*POWER|JALABIDHYUT|DOORSANCHAR|TELECOM|CLEARING\s*HOUSE|STOCK\s*EXCHANGE|CDS\s*(AND|&)?\s*CLEARING|PHARMA|PHARMACEUTICALS|HOSPITAL|COLLEGE|UNIVERSITY|ACADEMY|COOPERATIVE|CO-OPERATIVE|SAHAKARI|ENTERPRISES|TRADING|TRADERS|SUPPLIERS|DISTRIBUTORS|INDUSTRIES|VENTURES|BROKER|MERCHANT\s*BANKING|GOVERNMENT|SARKAR|MINISTRY|DEPARTMENT|PRADHIKARAN|SANSTHAN|NIGAM|MUNICIPALITY|NAGARPALIKA|GAUNPALIKA|EMBASSY|GUTHI)\M'
  );

-- 3. Correct Natural Persons in Clients
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

-- 4. Fast Update Interest / Debenture Payables
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
