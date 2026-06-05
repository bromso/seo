-- Enable RLS on all user-data tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- profiles policies
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
--> statement-breakpoint

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
--> statement-breakpoint

-- sites policies (full CRUD on own rows)
CREATE POLICY "sites_select_own" ON public.sites
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint

CREATE POLICY "sites_insert_own" ON public.sites
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint

CREATE POLICY "sites_update_own" ON public.sites
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint

CREATE POLICY "sites_delete_own" ON public.sites
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint

-- audit_runs policies (read + insert by owner; runner uses service_role to bypass)
CREATE POLICY "audit_runs_select_own" ON public.audit_runs
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
--> statement-breakpoint

CREATE POLICY "audit_runs_insert_own" ON public.audit_runs
  FOR INSERT TO authenticated
  WITH CHECK (owner_id IS NULL OR owner_id = (SELECT auth.uid()));
--> statement-breakpoint

-- audit_results: read-only for owners (writes locked to service_role)
CREATE POLICY "audit_results_select_own" ON public.audit_results
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
