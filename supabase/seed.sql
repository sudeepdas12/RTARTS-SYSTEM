-- =========================================================
-- RTARTS System: Database Seed Script
-- Seeds initial admin users with full GoTrue compatibility.
-- =========================================================

DO $$
DECLARE
  v_admin_id uuid;
  v_sudeep_id uuid;
  v_admin_password text;
  v_has_users boolean;
  v_has_identities boolean;
  v_has_email_confirmed boolean;
  v_has_confirmed boolean;
BEGIN
  -- Dynamic password with safe fallback:
  -- In production or CI, set `app.settings.admin_seed_password` via session variable to override.
  -- Defaults to 'Admin123!' for developer setup consistency as requested.
  v_admin_password := COALESCE(NULLIF(current_setting('app.settings.admin_seed_password', true), ''), 'Admin123!');

  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') INTO v_has_users;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'identities') INTO v_has_identities;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_confirmed_at') INTO v_has_email_confirmed;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmed_at') INTO v_has_confirmed;

  -- 1. Seed admin@rbbmbl.com.np
  IF v_has_users THEN
    UPDATE auth.users
    SET email = 'admin@rbbmbl.com.np'
    WHERE email = 'admin@rtarts.local';

    SELECT id INTO v_admin_id
    FROM auth.users
    WHERE email = 'admin@rbbmbl.com.np';

    IF v_admin_id IS NULL THEN
      v_admin_id := gen_random_uuid();
      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data
      )
      VALUES (
        v_admin_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated',
        'authenticated',
        'admin@rbbmbl.com.np',
        crypt(v_admin_password, gen_salt('bf')),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"System Administrator","bootstrap_credential":true,"requires_password_change_notice":true}'::jsonb
      );
    ELSE
      UPDATE auth.users
      SET encrypted_password = crypt(v_admin_password, gen_salt('bf')),
          raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
          raw_user_meta_data = '{"full_name":"System Administrator","bootstrap_credential":true,"requires_password_change_notice":true}'::jsonb,
          updated_at = now()
      WHERE id = v_admin_id;
    END IF;

    IF v_has_email_confirmed THEN
      EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id = $1' USING v_admin_id;
    END IF;
  ELSE
    v_admin_id := 'a0000000-0000-0000-0000-000000000001'::uuid;
  END IF;

  IF v_has_identities AND v_admin_id IS NOT NULL THEN
    EXECUTE 'INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
             VALUES ($1, $1, $2, jsonb_build_object(''sub'', $2, ''email'', ''admin@rbbmbl.com.np'', ''email_verified'', true), ''email'', now(), now(), now())
             ON CONFLICT (provider_id, provider) DO UPDATE SET identity_data = EXCLUDED.identity_data, updated_at = now()'
    USING v_admin_id, v_admin_id::text;
  END IF;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin_id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (v_admin_id, 'System Administrator', 'admin@rbbmbl.com.np')
    ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        updated_at = now();
  END IF;

  -- 2. Seed sudeep.das@rbbmbl.com.np
  IF v_has_users THEN
    SELECT id INTO v_sudeep_id
    FROM auth.users
    WHERE email = 'sudeep.das@rbbmbl.com.np';

    IF v_sudeep_id IS NULL THEN
      v_sudeep_id := gen_random_uuid();
      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data
      )
      VALUES (
        v_sudeep_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated',
        'authenticated',
        'sudeep.das@rbbmbl.com.np',
        crypt(v_admin_password, gen_salt('bf')),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Sudeep Das","bootstrap_credential":true,"requires_password_change_notice":true}'::jsonb
      );
    ELSE
      UPDATE auth.users
      SET encrypted_password = crypt(v_admin_password, gen_salt('bf')),
          raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
          raw_user_meta_data = '{"full_name":"Sudeep Das","bootstrap_credential":true,"requires_password_change_notice":true}'::jsonb,
          updated_at = now()
      WHERE id = v_sudeep_id;
    END IF;

    IF v_has_email_confirmed THEN
      EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id = $1' USING v_sudeep_id;
    END IF;
  ELSE
    v_sudeep_id := 'a0000000-0000-0000-0000-000000000002'::uuid;
  END IF;

  IF v_has_identities AND v_sudeep_id IS NOT NULL THEN
    EXECUTE 'INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
             VALUES ($1, $1, $2, jsonb_build_object(''sub'', $2, ''email'', ''sudeep.das@rbbmbl.com.np'', ''email_verified'', true), ''email'', now(), now(), now())
             ON CONFLICT (provider_id, provider) DO UPDATE SET identity_data = EXCLUDED.identity_data, updated_at = now()'
    USING v_sudeep_id, v_sudeep_id::text;
  END IF;

  IF v_sudeep_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_sudeep_id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (v_sudeep_id, 'Sudeep Das', 'sudeep.das@rbbmbl.com.np')
    ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        updated_at = now();
  END IF;

  -- 3. Seed baseline master company if empty
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'companies') THEN
    INSERT INTO public.companies (id, company_code, company_name, status)
    VALUES ('c0000000-0000-0000-0000-000000000001'::uuid, 'RBBMBL', 'RBB Merchant Banking Limited', 'Active')
    ON CONFLICT (company_code) DO NOTHING;
  END IF;

  -- 4. Seed baseline active fiscal year if empty
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fiscal_years') THEN
    INSERT INTO public.fiscal_years (fiscal_year, start_date, end_date, is_active)
    VALUES ('2081/82', '2024-07-16', '2025-07-15', true)
    ON CONFLICT (fiscal_year) DO NOTHING;
  END IF;

  -- 5. Seed authoritative Nepal TDS tax rules if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payable_tax_rules') THEN
    INSERT INTO public.payable_tax_rules (payable_category, payee_classification, tax_rate, is_active)
    VALUES
      ('DIVIDEND', 'NATURAL_PERSON', 0.05, true),
      ('DIVIDEND', 'PUBLIC_LEGAL_PERSON', 0.05, true),
      ('DIVIDEND', 'COMPANY_INSTITUTION', 0.05, true),
      ('DIVIDEND', 'FOREIGN_INVESTOR', 0.05, true),
      ('DIVIDEND', 'TAX_EXEMPT', 0.00, true),
      ('INTEREST', 'NATURAL_PERSON', 0.06, true),
      ('INTEREST', 'PUBLIC_LEGAL_PERSON', 0.06, true),
      ('INTEREST', 'COMPANY_INSTITUTION', 0.15, true),
      ('INTEREST', 'FOREIGN_INVESTOR', 0.15, true),
      ('INTEREST', 'TAX_EXEMPT', 0.00, true),
      ('MUTUAL_FUND', 'NATURAL_PERSON', 0.05, true),
      ('MUTUAL_FUND', 'PUBLIC_LEGAL_PERSON', 0.05, true),
      ('MUTUAL_FUND', 'COMPANY_INSTITUTION', 0.15, true),
      ('MUTUAL_FUND', 'FOREIGN_INVESTOR', 0.00, true),
      ('MUTUAL_FUND', 'TAX_EXEMPT', 0.00, true)
    ON CONFLICT (payable_category, payee_classification) DO NOTHING;
  END IF;
END $$;
