-- Migration: 20261214000000_seed_company_defaults_and_cleanup.sql
-- Seeds face_value, issue_size, clean names, and registrar for companies

-- 1. Update RBBD8.5
UPDATE public.companies
SET
  company_name = '8.5% RBB Debentures 2083',
  face_value = 1000,
  issue_size = 2500000,
  coupon_rate = 8.5,
  debenture_rate = 8.5,
  fiscal_year = COALESCE(fiscal_year, '2082/83'),
  registrar = 'RBB Merchant Banking Limited'
WHERE company_code = 'RBBD8.5';

-- 2. Update NECO
UPDATE public.companies
SET
  company_name = 'NECO INSURANCE COMPANY LIMITED',
  face_value = 100,
  issue_size = 2012450,
  dividend_rate = 10,
  fiscal_year = COALESCE(fiscal_year, '2082/83'),
  isin = COALESCE(isin, 'NPE207A00008'),
  registrar = 'RBB Merchant Banking Limited'
WHERE company_code = 'NECO';

-- 3. Backfill any existing companies with default face_value and registrar
UPDATE public.companies
SET face_value = CASE 
      WHEN company_type = 'Debenture' THEN 1000
      WHEN company_type = 'Mutual Fund' THEN 10
      ELSE 100
    END
WHERE face_value IS NULL;

UPDATE public.companies
SET registrar = 'RBB Merchant Banking Limited'
WHERE registrar IS NULL OR registrar = '';
