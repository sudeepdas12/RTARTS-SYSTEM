-- ============================================================================
-- Migration: 20261005000006_schema_seed_reference_data.sql
-- Description: System reference data: tax rules, fiscal years, settings, admin users
-- ============================================================================

BEGIN;

SET LOCAL app.skip_audit = 'on';

-- 1. Authoritative Payable Tax Rules (FY 2083/84)
INSERT INTO public.payable_tax_rules (payable_category, payee_classification, tax_rate, is_active)
VALUES
  ('DIVIDEND',    'NATURAL_PERSON',      0.05, true),
  ('DIVIDEND',    'PUBLIC_LEGAL_PERSON', 0.05, true),
  ('DIVIDEND',    'COMPANY_INSTITUTION', 0.05, true),
  ('DIVIDEND',    'FOREIGN_INVESTOR',    0.05, true),
  ('DIVIDEND',    'BANK_FI',             0.05, true),
  ('DIVIDEND',    'TAX_EXEMPT',          0.00, true),
  ('INTEREST',    'NATURAL_PERSON',      0.06, true),
  ('INTEREST',    'PUBLIC_LEGAL_PERSON', 0.06, true),
  ('INTEREST',    'COMPANY_INSTITUTION', 0.15, true),
  ('INTEREST',    'FOREIGN_INVESTOR',    0.15, true),
  ('INTEREST',    'BANK_FI',             0.00, true),
  ('INTEREST',    'TAX_EXEMPT',          0.00, true),
  ('MUTUAL_FUND', 'NATURAL_PERSON',      0.05, true),
  ('MUTUAL_FUND', 'PUBLIC_LEGAL_PERSON', 0.15, true),
  ('MUTUAL_FUND', 'COMPANY_INSTITUTION', 0.15, true),
  ('MUTUAL_FUND', 'FOREIGN_INVESTOR',    0.15, true),
  ('MUTUAL_FUND', 'BANK_FI',             0.15, true),
  ('MUTUAL_FUND', 'TAX_EXEMPT',          0.00, true)
ON CONFLICT (payable_category, payee_classification)
DO UPDATE SET tax_rate = EXCLUDED.tax_rate, is_active = EXCLUDED.is_active, updated_at = now();

-- 2. Reference Fiscal Years
INSERT INTO public.fiscal_years (fiscal_year, start_date, end_date, is_active)
VALUES
  ('2079/80', '2022-07-17', '2023-07-16', false),
  ('2080/81', '2023-07-17', '2024-07-15', false),
  ('2081/82', '2024-07-16', '2025-07-15', true),
  ('2082/83', '2025-07-16', '2026-07-15', false),
  ('2083/84', '2026-07-16', '2027-07-15', false)
ON CONFLICT (fiscal_year) DO NOTHING;

-- 3. System Settings
INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES
  ('approval_levels', '{"levels": 1, "maker_checker": true}'::jsonb, 'Approval workflows and maker-checker requirements'),
  ('date_format', '{"format": "YYYY-MM-DD", "nepali_date_enabled": false}'::jsonb, 'System display date format'),
  ('interest_rates', '{"fixed_6": 6, "fixed_7": 7, "fixed_7_5": 7.5, "fixed_6_25": 6.25, "floating_base": 5}'::jsonb, 'Standard debenture coupon rates'),
  ('number_format', '{"decimal_places": 2, "thousands_separator": true}'::jsonb, 'Currency and numeric formatting'),
  ('tax_rate', '{"tds_dividend": 5, "tds_interest": 6, "corporate_tax": 25}'::jsonb, 'Legacy fallback tax rate summary')
ON CONFLICT (setting_key) DO NOTHING;

-- 4. Initial Administrator Accounts (auth.users, profiles, user_roles)
DO $$
DECLARE
  v_admin_id uuid;
  v_sudeep_id uuid;
  v_has_users boolean;
  v_has_instance_id boolean;
  v_has_password boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') INTO v_has_users;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'instance_id') INTO v_has_instance_id;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'encrypted_password') INTO v_has_password;

  IF v_has_users THEN
    -- Admin Account: admin@rbbmbl.com.np
    SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@rbbmbl.com.np';
    IF v_admin_id IS NULL THEN
      v_admin_id := gen_random_uuid();
      IF v_has_password THEN
        IF v_has_instance_id THEN
          EXECUTE 'INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
                   VALUES ($1, ''00000000-0000-0000-0000-000000000000''::uuid, ''authenticated'', ''authenticated'', ''admin@rbbmbl.com.np'', crypt(''Admin123!'', gen_salt(''bf'')), now(), now(), now(), ''{"provider":"email","providers":["email"]}''::jsonb, ''{"full_name":"System Administrator"}''::jsonb)'
          USING v_admin_id;
        ELSE
          EXECUTE 'INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
                   VALUES ($1, ''admin@rbbmbl.com.np'', crypt(''Admin123!'', gen_salt(''bf'')), now(), now(), now(), ''{"provider":"email","providers":["email"]}''::jsonb, ''{"full_name":"System Administrator"}''::jsonb)'
          USING v_admin_id;
        END IF;
      ELSE
        EXECUTE 'INSERT INTO auth.users (id, email) VALUES ($1, ''admin@rbbmbl.com.np'')' USING v_admin_id;
      END IF;
    ELSE
      IF v_has_password THEN
        EXECUTE 'UPDATE auth.users SET encrypted_password = crypt(''Admin123!'', gen_salt(''bf'')), email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = $1'
        USING v_admin_id;
      END IF;
    END IF;

    -- Developer / Lead Account: sudeep.das@rbbmbl.com.np
    SELECT id INTO v_sudeep_id FROM auth.users WHERE email = 'sudeep.das@rbbmbl.com.np';
    IF v_sudeep_id IS NULL THEN
      v_sudeep_id := gen_random_uuid();
      IF v_has_password THEN
        IF v_has_instance_id THEN
          EXECUTE 'INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
                   VALUES ($1, ''00000000-0000-0000-0000-000000000000''::uuid, ''authenticated'', ''authenticated'', ''sudeep.das@rbbmbl.com.np'', crypt(''Admin123!'', gen_salt(''bf'')), now(), now(), now(), ''{"provider":"email","providers":["email"]}''::jsonb, ''{"full_name":"Sudeep Das"}''::jsonb)'
          USING v_sudeep_id;
        ELSE
          EXECUTE 'INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
                   VALUES ($1, ''sudeep.das@rbbmbl.com.np'', crypt(''Admin123!'', gen_salt(''bf'')), now(), now(), now(), ''{"provider":"email","providers":["email"]}''::jsonb, ''{"full_name":"Sudeep Das"}''::jsonb)'
          USING v_sudeep_id;
        END IF;
      ELSE
        EXECUTE 'INSERT INTO auth.users (id, email) VALUES ($1, ''sudeep.das@rbbmbl.com.np'')' USING v_sudeep_id;
      END IF;
    ELSE
      IF v_has_password THEN
        EXECUTE 'UPDATE auth.users SET encrypted_password = crypt(''Admin123!'', gen_salt(''bf'')), email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = $1'
        USING v_sudeep_id;
      END IF;
    END IF;
  ELSE
    v_admin_id := 'a0000000-0000-0000-0000-000000000001'::uuid;
    v_sudeep_id := 'a0000000-0000-0000-0000-000000000002'::uuid;
  END IF;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin_id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (v_admin_id, 'System Administrator', 'admin@rbbmbl.com.np')
    ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, updated_at = now();
  END IF;

  IF v_sudeep_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_sudeep_id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (v_sudeep_id, 'Sudeep Das', 'sudeep.das@rbbmbl.com.np')
    ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, updated_at = now();
  END IF;
END $$;

COMMIT;
