-- Seed test organization for local development
-- This migration creates a test organization that will be used by test users

-- Create the test organization
INSERT INTO public.organizations (id, name, plan, status, ai_daily_quota)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Test Organization',
  'pro',
  'active',
  100
) ON CONFLICT (id) DO NOTHING;
