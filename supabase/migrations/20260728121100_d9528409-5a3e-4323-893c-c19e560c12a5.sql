
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('super_admin', 'org_admin');
CREATE TYPE public.org_plan AS ENUM ('free', 'basic', 'pro');
CREATE TYPE public.org_status AS ENUM ('active', 'inactive', 'suspended');

-- =========================================================
-- UPDATED_AT HELPER
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- ORGANIZATIONS
-- =========================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  logo_url TEXT,
  plan public.org_plan NOT NULL DEFAULT 'free',
  status public.org_status NOT NULL DEFAULT 'active',
  expiry_date DATE,
  ai_daily_quota INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- USER ROLES (separate table — never trust roles on profiles)
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- SECURITY DEFINER FUNCTIONS
-- =========================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.super_admin_exists()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin');
$$;

-- Anonymous callers may check whether a super admin exists (used by bootstrap page)
GRANT EXECUTE ON FUNCTION public.super_admin_exists() TO anon, authenticated;

-- =========================================================
-- POLICIES: organizations
-- =========================================================
CREATE POLICY "org_admins read own org"
ON public.organizations FOR SELECT TO authenticated
USING (id = public.current_org_id() OR public.is_super_admin());

CREATE POLICY "org_admins update own org"
ON public.organizations FOR UPDATE TO authenticated
USING (id = public.current_org_id() OR public.is_super_admin())
WITH CHECK (id = public.current_org_id() OR public.is_super_admin());

CREATE POLICY "super admins insert orgs"
ON public.organizations FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin());

CREATE POLICY "super admins delete orgs"
ON public.organizations FOR DELETE TO authenticated
USING (public.is_super_admin());

-- =========================================================
-- POLICIES: profiles
-- =========================================================
CREATE POLICY "users read own profile"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_super_admin());

CREATE POLICY "users update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.is_super_admin())
WITH CHECK (id = auth.uid() OR public.is_super_admin());

CREATE POLICY "super admins insert profiles"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin() OR id = auth.uid());

CREATE POLICY "super admins delete profiles"
ON public.profiles FOR DELETE TO authenticated
USING (public.is_super_admin());

-- =========================================================
-- POLICIES: user_roles (only super admins manage; users see their own row)
-- =========================================================
CREATE POLICY "users see own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_super_admin());

-- No INSERT/UPDATE/DELETE policies — service role only (from server functions).

-- =========================================================
-- ORG-SCOPED TABLES
-- =========================================================

CREATE TABLE public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.boards_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boards_exams TO authenticated;
GRANT ALL ON public.boards_exams TO service_role;
ALTER TABLE public.boards_exams ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates TO authenticated;
GRANT ALL ON public.templates TO service_role;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER templates_updated_at
BEFORE UPDATE ON public.templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.uploaded_syllabi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploaded_syllabi TO authenticated;
GRANT ALL ON public.uploaded_syllabi TO service_role;
ALTER TABLE public.uploaded_syllabi ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.generated_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  syllabus_id UUID REFERENCES public.uploaded_syllabi(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  paper_pdf_path TEXT,
  answer_key_pdf_path TEXT,
  omr_pdf_path TEXT,
  ai_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_papers TO authenticated;
GRANT ALL ON public.generated_papers TO service_role;
ALTER TABLE public.generated_papers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER generated_papers_updated_at
BEFORE UPDATE ON public.generated_papers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (organization_id, user_id, usage_date)
);
GRANT SELECT, INSERT, UPDATE ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Org-scoped RLS policies (identical shape for each table)
-- =========================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['subjects','boards_exams','classes','templates','uploaded_syllabi','generated_papers','ai_usage']
  LOOP
    EXECUTE format($fmt$
      CREATE POLICY "%1$s_org_select" ON public.%1$I FOR SELECT TO authenticated
        USING (organization_id = public.current_org_id() OR public.is_super_admin());
      CREATE POLICY "%1$s_org_insert" ON public.%1$I FOR INSERT TO authenticated
        WITH CHECK (organization_id = public.current_org_id() OR public.is_super_admin());
      CREATE POLICY "%1$s_org_update" ON public.%1$I FOR UPDATE TO authenticated
        USING (organization_id = public.current_org_id() OR public.is_super_admin())
        WITH CHECK (organization_id = public.current_org_id() OR public.is_super_admin());
      CREATE POLICY "%1$s_org_delete" ON public.%1$I FOR DELETE TO authenticated
        USING (organization_id = public.current_org_id() OR public.is_super_admin());
    $fmt$, t);
  END LOOP;
END$$;

-- audit_logs: everyone in an org can read their org's logs; super admin sees all; inserts always allowed for the caller's org
CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT TO authenticated
USING (organization_id = public.current_org_id() OR public.is_super_admin() OR actor_user_id = auth.uid());

CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (actor_user_id = auth.uid());
