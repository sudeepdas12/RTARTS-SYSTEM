DO $$
DECLARE
  v_user_exists boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE email = 'admin@rtarts.local'
  ) INTO v_user_exists;

  IF v_user_exists THEN
    RETURN;
  END IF;

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
    raw_user_meta_data,
    is_super_admin,
    is_anonymous
  )
  VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'admin@rtarts.local',
    crypt('Admin123!', gen_salt('bf')),
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{"full_name":"System Administrator"}'::jsonb,
    true,
    false
  );
END $$;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE u.email = 'admin@rtarts.local'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.profiles (id, full_name, email)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', u.email), u.email
FROM auth.users u
WHERE u.email = 'admin@rtarts.local'
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    updated_at = now();

-- =========================================================
-- Admin user: Sudeep Das (sudeep.das@rbbmbl.com.np)
-- Assigned the 'admin' role which grants every permission
-- in the application RBAC model (see src/lib/rbac-service.ts).
-- =========================================================
DO $$
DECLARE
  v_user_exists boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE email = 'sudeep.das@rbbmbl.com.np'
  ) INTO v_user_exists;

  IF v_user_exists THEN
    RETURN;
  END IF;

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
    raw_user_meta_data,
    is_super_admin,
    is_anonymous
  )
  VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'sudeep.das@rbbmbl.com.np',
    crypt('Admin123!', gen_salt('bf')),
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{"full_name":"Sudeep Das"}'::jsonb,
    true,
    false
  );
END $$;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE u.email = 'sudeep.das@rbbmbl.com.np'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.profiles (id, full_name, email)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', u.email), u.email
FROM auth.users u
WHERE u.email = 'sudeep.das@rbbmbl.com.np'
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    updated_at = now();
