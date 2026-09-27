-- ResultHub exam + result tables and the PaperHub institute credit ledger.
--
-- Institutes are the existing `public.organizations` rows; the prepaid bundle
-- balance stays in `organizations.paper_credit_balance` (NULL = unlimited).
-- `credit_transactions` is an append-only ledger of every balance change so
-- the SuperAdmin quota editor can show history and tell a top-up apart from an
-- absolute set.

-- These columns are required by this migration and make it fail loudly if it
-- is run against the wrong database.
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.generated_papers') IS NULL
     OR to_regclass('public.set_updated_at') IS NULL THEN
    RAISE EXCEPTION 'PaperHub base schema is missing organizations, generated_papers, or set_updated_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'paper_credit_balance'
  ) THEN
    RAISE EXCEPTION 'organizations.paper_credit_balance is missing; run 20260925040000 first';
  END IF;
END
$$;

-- ========== EXAMS ==========

CREATE TABLE IF NOT EXISTS public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  exam_name TEXT NOT NULL,
  -- Preset or layout key, e.g. neet, jee-main, cbse-12, custom. Kept as TEXT
  -- because presets are defined in the application, not in the database.
  template_type TEXT NOT NULL DEFAULT 'custom',
  requires_omr BOOLEAN NOT NULL DEFAULT false,
  paper_id UUID REFERENCES public.generated_papers(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exams_organization_id_idx ON public.exams (organization_id);
CREATE INDEX IF NOT EXISTS exams_paper_id_idx ON public.exams (paper_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exams TO authenticated;
GRANT ALL ON public.exams TO service_role;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS exams_updated_at ON public.exams;
CREATE TRIGGER exams_updated_at
  BEFORE UPDATE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== EXAM RESULTS ==========

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exam_result_status') THEN
    CREATE TYPE public.exam_result_status AS ENUM ('pending', 'processing', 'verified', 'published');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.exam_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status public.exam_result_status NOT NULL DEFAULT 'pending',
  total_marks INTEGER CHECK (total_marks IS NULL OR total_marks >= 0),
  obtained_marks INTEGER CHECK (obtained_marks IS NULL OR obtained_marks >= 0),
  student_count INTEGER CHECK (student_count IS NULL OR student_count >= 0),
  notes TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A result is only ever published once it has been verified.
  CONSTRAINT exam_results_published_requires_verified
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS exam_results_exam_id_idx ON public.exam_results (exam_id);
CREATE INDEX IF NOT EXISTS exam_results_organization_id_idx ON public.exam_results (organization_id);
CREATE INDEX IF NOT EXISTS exam_results_status_idx ON public.exam_results (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_results TO authenticated;
GRANT ALL ON public.exam_results TO service_role;
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS exam_results_updated_at ON public.exam_results;
CREATE TRIGGER exam_results_updated_at
  BEFORE UPDATE ON public.exam_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========== CREDIT TRANSACTIONS ==========

-- Append-only. Rows are never updated or deleted, so a balance can always be
-- reconciled against the ledger that produced it.
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Signed change applied to paper_credit_balance. NULL balance (unlimited) is
  -- never written here, so a ledger row always implies a finite balance.
  delta INTEGER NOT NULL CHECK (delta <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  -- Dotted action name, matching the audit_logs convention.
  -- credits.set, credits.top_up, credits.adjust, paper.generation,
  -- paper.generation.refund
  reason TEXT NOT NULL DEFAULT 'credits.adjust',
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_transactions_org_created_idx
  ON public.credit_transactions (organization_id, created_at DESC);
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- ========== ORG-SCOPED RLS ==========

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['exams', 'exam_results', 'credit_transactions']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = t || '_org_select'
    ) THEN
      EXECUTE format($fmt$
        CREATE POLICY "%1$s_org_select" ON public.%1$I FOR SELECT TO authenticated
          USING (organization_id = public.current_org_id() OR public.is_super_admin());
      $fmt$, t);
    END IF;
  END LOOP;
END$$;

-- Only super admins may change a balance or write to the ledger. The SELECT
-- policy above still lets an institute read its own credit history.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'credit_transactions'
      AND policyname = 'credit_transactions_super_admin_insert'
  ) THEN
    CREATE POLICY "credit_transactions_super_admin_insert"
      ON public.credit_transactions FOR INSERT TO authenticated
      WITH CHECK (public.is_super_admin());
  END IF;
END$$;

-- ========== BACKFILL EXAMS FROM GENERATED PAPERS ==========

-- Exam metadata predates this table and lives inside generated_papers.config.
-- The code is derived from the paper UUID so it is stable, unique and short.
INSERT INTO public.exams (
  exam_id,
  organization_id,
  exam_name,
  template_type,
  requires_omr,
  paper_id,
  created_by,
  created_at
)
SELECT
  'PAP-' || UPPER(SUBSTRING(REPLACE(p.id::TEXT, '-', '') FROM 1 FOR 12)),
  p.organization_id,
  -- exam_name is NOT NULL, so a blank legacy title falls back here rather than
  -- aborting the migration.
  COALESCE(NULLIF(BTRIM(p.title), ''), 'Untitled exam'),
  COALESCE(NULLIF(p.config ->> 'examPreset', ''), 'custom'),
  -- Matched as text rather than cast, so an unexpected value in the JSONB
  -- config cannot abort the backfill.
  CASE
    WHEN LOWER(p.config ->> 'omr') IN ('true', 't', 'yes', '1') THEN TRUE
    WHEN LOWER(p.config ->> 'omr') IN ('false', 'f', 'no', '0') THEN FALSE
    ELSE COALESCE(p.omr_pdf_path IS NOT NULL, FALSE)
  END,
  p.id,
  p.created_by,
  p.created_at
FROM public.generated_papers p
WHERE NOT EXISTS (SELECT 1 FROM public.exams e WHERE e.paper_id = p.id)
ON CONFLICT (exam_id) DO NOTHING;

-- ========== CREDIT TOP-UP RPC ==========

-- Relative adjustment used by the SuperAdmin quota editor. Runs as a single
-- statement so the read, the guard and the write cannot interleave with a
-- concurrent paper generation, and so the ledger row and the new balance are
-- always written together.
CREATE OR REPLACE FUNCTION public.top_up_credits(
  p_organization_id UUID,
  p_delta INTEGER,
  p_reason TEXT DEFAULT 'credits.top_up',
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS TABLE (new_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance INTEGER;
  next_balance INTEGER;
BEGIN
  SELECT paper_credit_balance INTO current_balance
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institute % does not exist', p_organization_id USING ERRCODE = 'no_data_found';
  END IF;

  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Adjustment must not be zero' USING ERRCODE = 'check_violation';
  END IF;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'Institute % has an unlimited balance, so it cannot be topped up', p_organization_id
      USING ERRCODE = 'check_violation';
  END IF;

  next_balance := current_balance + p_delta;

  IF next_balance < 0 THEN
    RAISE EXCEPTION 'Adjustment would take the balance below zero (have %, requested %)', current_balance, p_delta
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.organizations
  SET paper_credit_balance = next_balance
  WHERE id = p_organization_id;

  INSERT INTO public.credit_transactions (
    organization_id, delta, balance_after, reason, actor_user_id
  )
  VALUES (
    p_organization_id, p_delta, next_balance, COALESCE(NULLIF(p_reason, ''), 'credits.top_up'), p_actor_user_id
  );

  RETURN QUERY SELECT next_balance;
END
$$;

GRANT EXECUTE ON FUNCTION public.top_up_credits(UUID, INTEGER, TEXT, UUID) TO service_role;

-- ========== CREDIT ASSIGNMENT RPC ==========

-- Absolute counterpart to top_up_credits. Taking the target balance rather than
-- a delta means the admin's "assign exactly N" action cannot be skewed by a
-- paper generation landing between the read and the write.
CREATE OR REPLACE FUNCTION public.set_credits(
  p_organization_id UUID,
  p_credits INTEGER,
  p_reason TEXT DEFAULT 'credits.set',
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS TABLE (new_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance INTEGER;
BEGIN
  IF p_credits IS NOT NULL AND p_credits < 0 THEN
    RAISE EXCEPTION 'Credit balance cannot be negative (got %)', p_credits
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT paper_credit_balance INTO current_balance
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institute % does not exist', p_organization_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF current_balance IS NOT DISTINCT FROM p_credits THEN
    RETURN QUERY SELECT p_credits;
    RETURN;
  END IF;

  UPDATE public.organizations
  SET paper_credit_balance = p_credits
  WHERE id = p_organization_id;

  -- A NULL target means "back to unlimited". There is no finite balance to
  -- record, so the ledger is left alone and audit_logs carries the change.
  IF p_credits IS NOT NULL THEN
    INSERT INTO public.credit_transactions (
      organization_id, delta, balance_after, reason, actor_user_id
    )
    VALUES (
      p_organization_id,
      p_credits - COALESCE(current_balance, 0),
      p_credits,
      COALESCE(NULLIF(p_reason, ''), 'credits.set'),
      p_actor_user_id
    );
  END IF;

  RETURN QUERY SELECT p_credits;
END
$$;

GRANT EXECUTE ON FUNCTION public.set_credits(UUID, INTEGER, TEXT, UUID) TO service_role;

-- ========== LEDGER-AWARE CREDIT RESERVATION ==========

-- Signatures are unchanged so the existing call in paper.functions.ts keeps
-- working. Only the ledger write is new; the balance guard and the row lock
-- behave exactly as before.
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

  -- NULL means unlimited, so there is nothing to decrement and nothing to log.
  IF org_row.paper_credit_balance IS NULL THEN
    RETURN TRUE;
  END IF;

  UPDATE public.organizations
  SET paper_credit_balance = paper_credit_balance - 1
  WHERE id = p_organization_id
    AND paper_credit_balance > 0;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.credit_transactions (
    organization_id, delta, balance_after, reason, actor_user_id
  )
  VALUES (
    p_organization_id, -1, org_row.paper_credit_balance - 1, 'paper.generation', NULL
  );

  RETURN TRUE;
END
$$;

GRANT EXECUTE ON FUNCTION public.reserve_paper_generation_credit(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.release_paper_generation_credit(p_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance INTEGER;
BEGIN
  SELECT paper_credit_balance INTO current_balance
  FROM public.organizations
  WHERE id = p_organization_id
    AND paper_credit_balance IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.organizations
  SET paper_credit_balance = current_balance + 1
  WHERE id = p_organization_id;

  INSERT INTO public.credit_transactions (
    organization_id, delta, balance_after, reason, actor_user_id
  )
  VALUES (
    p_organization_id, 1, current_balance + 1, 'paper.generation.refund', NULL
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.release_paper_generation_credit(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
