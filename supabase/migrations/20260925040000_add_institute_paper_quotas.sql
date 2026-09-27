-- PaperHub institute quotas and credits.
-- Run after the base migrations in this repository.

-- Keep platform settings extensible for future JSON configuration values.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '0'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  value_type TEXT;
BEGIN
  SELECT data_type
  INTO value_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'platform_settings'
    AND column_name = 'value';

  IF value_type = 'integer' THEN
    ALTER TABLE public.platform_settings ALTER COLUMN value DROP DEFAULT;
    ALTER TABLE public.platform_settings
      ALTER COLUMN value TYPE JSONB USING to_jsonb(value);
    ALTER TABLE public.platform_settings
      ALTER COLUMN value SET DEFAULT '0'::jsonb;
  END IF;
END
$$;

INSERT INTO public.platform_settings (key, value)
VALUES
  ('max_daily_papers', '0'::jsonb),
  ('max_active_college_admins', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

GRANT SELECT ON public.platform_settings TO service_role;
GRANT INSERT, UPDATE ON public.platform_settings TO service_role;
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_settings'
      AND policyname = 'super admins read platform settings'
  ) THEN
    CREATE POLICY "super admins read platform settings"
      ON public.platform_settings FOR SELECT TO authenticated
      USING (public.is_super_admin());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_settings'
      AND policyname = 'super admins update platform settings'
  ) THEN
    CREATE POLICY "super admins update platform settings"
      ON public.platform_settings FOR UPDATE TO authenticated
      USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'platform_settings_updated_at'
      AND tgrelid = 'public.platform_settings'::regclass
  ) THEN
    CREATE TRIGGER platform_settings_updated_at
      BEFORE UPDATE ON public.platform_settings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- NULL credits means unlimited. A non-null value is the remaining balance.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS paper_credit_balance INTEGER
    CHECK (paper_credit_balance IS NULL OR paper_credit_balance >= 0);

-- 0 means no daily limit. This limit is independent of the credit balance.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS paper_daily_limit INTEGER NOT NULL DEFAULT 0
    CHECK (paper_daily_limit >= 0);

-- These columns are required by the application base schema and make this
-- migration fail loudly if it is run against the wrong database.
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.generated_papers') IS NULL THEN
    RAISE EXCEPTION 'PaperHub base schema is missing organizations, profiles, or generated_papers';
  END IF;
END
$$;

-- Serialize reservations per institute so concurrent requests cannot overspend
-- credits or exceed the institute daily limit.
CREATE OR REPLACE FUNCTION public.reserve_paper_generation_credit(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_row public.organizations%ROWTYPE;
  papers_today INTEGER;
BEGIN
  SELECT * INTO org_row
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND OR org_row.status <> 'active' THEN
    RETURN FALSE;
  END IF;

  IF org_row.paper_daily_limit > 0 THEN
    SELECT COUNT(*)::INTEGER INTO papers_today
    FROM public.generated_papers
    WHERE organization_id = p_organization_id
      AND created_at >= CURRENT_DATE
      AND created_at < CURRENT_DATE + INTERVAL '1 day';

    IF papers_today >= org_row.paper_daily_limit THEN
      RETURN FALSE;
    END IF;
  END IF;

  IF org_row.paper_credit_balance IS NULL THEN
    RETURN TRUE;
  END IF;

  UPDATE public.organizations
  SET paper_credit_balance = paper_credit_balance - 1
  WHERE id = p_organization_id
    AND paper_credit_balance > 0;

  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION public.release_paper_generation_credit(p_organization_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.organizations
  SET paper_credit_balance = paper_credit_balance + 1
  WHERE id = p_organization_id
    AND paper_credit_balance IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_paper_generation_credit(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_paper_generation_credit(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
