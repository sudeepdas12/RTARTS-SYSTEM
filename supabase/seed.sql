-- =========================================================
-- RTARTS System: Database Seed Script
-- Seeds initial admin users with full GoTrue compatibility.
-- =========================================================

DO $$
DECLARE
  v_admin_id uuid;
  v_sudeep_id uuid;
BEGIN
  -- 1. Seed admin@rbbmbl.com.np
  -- If old admin@rtarts.local exists, migrate its email to admin@rbbmbl.com.np
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
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change_token_current,
      email_change,
      phone_change,
      phone_change_token,
      reauthentication_token,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      is_anonymous
    )
    VALUES (
      v_admin_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      'admin@rbbmbl.com.np',
      crypt('Admin123!', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"System Administrator"}'::jsonb,
      true,
      false
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('Admin123!', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
        raw_user_meta_data = '{"full_name":"System Administrator"}'::jsonb,
        confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        email_change = COALESCE(email_change, ''),
        phone_change = COALESCE(phone_change, ''),
        phone_change_token = COALESCE(phone_change_token, ''),
        reauthentication_token = COALESCE(reauthentication_token, ''),
        updated_at = now()
    WHERE id = v_admin_id;
  END IF;

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    v_admin_id,
    v_admin_id,
    v_admin_id::text,
    jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@rbbmbl.com.np', 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  )
  ON CONFLICT (provider_id, provider) DO UPDATE
  SET identity_data = EXCLUDED.identity_data,
      updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_admin_id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_admin_id, 'System Administrator', 'admin@rbbmbl.com.np')
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now();

  -- 2. Seed sudeep.das@rbbmbl.com.np
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
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change_token_current,
      email_change,
      phone_change,
      phone_change_token,
      reauthentication_token,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      is_anonymous
    )
    VALUES (
      v_sudeep_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      'sudeep.das@rbbmbl.com.np',
      crypt('Admin123!', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Sudeep Das"}'::jsonb,
      true,
      false
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('Admin123!', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
        raw_user_meta_data = '{"full_name":"Sudeep Das"}'::jsonb,
        confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        email_change = COALESCE(email_change, ''),
        phone_change = COALESCE(phone_change, ''),
        phone_change_token = COALESCE(phone_change_token, ''),
        reauthentication_token = COALESCE(reauthentication_token, ''),
        updated_at = now()
    WHERE id = v_sudeep_id;
  END IF;

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    v_sudeep_id,
    v_sudeep_id,
    v_sudeep_id::text,
    jsonb_build_object('sub', v_sudeep_id::text, 'email', 'sudeep.das@rbbmbl.com.np', 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  )
  ON CONFLICT (provider_id, provider) DO UPDATE
  SET identity_data = EXCLUDED.identity_data,
      updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_sudeep_id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_sudeep_id, 'Sudeep Das', 'sudeep.das@rbbmbl.com.np')
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now();
END $$;
