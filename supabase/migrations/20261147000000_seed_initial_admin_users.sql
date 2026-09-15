-- ============================================================================
-- Migration: 20261147000000_seed_initial_admin_users.sql
-- Description:
-- Idempotently seeds initial system administrator accounts into auth.users,
-- public.profiles, and public.user_roles.
-- ============================================================================

DO $$
DECLARE
  v_admin_id uuid;
  v_sudeep_id uuid;
  v_has_users boolean;
  v_has_identities boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') INTO v_has_users;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'identities') INTO v_has_identities;

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
        email_confirmed_at,
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
        crypt('Admin123!', gen_salt('bf')),
        now(),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"System Administrator"}'::jsonb
      );
    ELSE
      UPDATE auth.users
      SET encrypted_password = crypt('Admin123!', gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
          raw_user_meta_data = '{"full_name":"System Administrator"}'::jsonb,
          updated_at = now()
      WHERE id = v_admin_id;
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
        email_confirmed_at,
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
        crypt('Admin123!', gen_salt('bf')),
        now(),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Sudeep Das"}'::jsonb
      );
    ELSE
      UPDATE auth.users
      SET encrypted_password = crypt('Admin123!', gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
          raw_user_meta_data = '{"full_name":"Sudeep Das"}'::jsonb,
          updated_at = now()
      WHERE id = v_sudeep_id;
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
END $$;
