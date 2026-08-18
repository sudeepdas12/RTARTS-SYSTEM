-- Method 1: Set user role directly (Supabase v2+)
UPDATE auth.users 
SET role = 'admin'  -- This is the built-in role field
WHERE email = 'sudeep.das@rbbmbl.com.np';

-- OR if using app_metadata:
UPDATE auth.users 
SET app_metadata = '{"role": "admin"}'
WHERE email = 'sudeep.das@rbbmbl.com.np';

