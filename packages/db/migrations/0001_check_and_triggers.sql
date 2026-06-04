-- Discriminated-union CHECK constraint
ALTER TABLE audit_results ADD CONSTRAINT audit_results_status_fields_consistent
  CHECK (
    (status = 'failed'
     AND score IS NULL AND issues IS NULL AND raw IS NULL
     AND error_code IS NOT NULL AND error_message IS NOT NULL
     AND error_retryable IS NOT NULL)
    OR
    (status IN ('success','partial')
     AND score IS NOT NULL AND issues IS NOT NULL
     AND error_code IS NULL AND error_message IS NULL
     AND error_retryable IS NULL
     AND (status = 'success' OR partial_reasons IS NOT NULL))
  );
--> statement-breakpoint

-- Trigger 1: auto-create profiles row on auth.users INSERT
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- Trigger 2: denorm owner_id from site_id on audit_runs INSERT
CREATE OR REPLACE FUNCTION public.set_run_owner_from_site() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    SELECT owner_id INTO NEW.owner_id FROM public.sites WHERE id = NEW.site_id;
    IF NEW.owner_id IS NULL THEN
      RAISE EXCEPTION 'audit_runs.site_id % does not exist', NEW.site_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_runs_set_owner ON public.audit_runs;
--> statement-breakpoint
CREATE TRIGGER audit_runs_set_owner
  BEFORE INSERT ON public.audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_run_owner_from_site();
--> statement-breakpoint

-- Trigger 3: denorm owner_id from run_id on audit_results INSERT
CREATE OR REPLACE FUNCTION public.set_result_owner_from_run() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    SELECT owner_id INTO NEW.owner_id FROM public.audit_runs WHERE id = NEW.run_id;
    IF NEW.owner_id IS NULL THEN
      RAISE EXCEPTION 'audit_results.run_id % does not exist', NEW.run_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_results_set_owner ON public.audit_results;
--> statement-breakpoint
CREATE TRIGGER audit_results_set_owner
  BEFORE INSERT ON public.audit_results
  FOR EACH ROW EXECUTE FUNCTION public.set_result_owner_from_run();
--> statement-breakpoint

-- Trigger 4: roll up audit_runs.status from audit_results
CREATE OR REPLACE FUNCTION public.rollup_run_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total int;
  failed int;
  partial int;
  expected int := 5;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'failed'),
         COUNT(*) FILTER (WHERE status = 'partial')
    INTO total, failed, partial
    FROM public.audit_results WHERE run_id = NEW.run_id;

  UPDATE public.audit_runs SET
    status = CASE
      WHEN total < expected THEN 'running'
      WHEN failed > 0 THEN 'failed'
      WHEN partial > 0 THEN 'partial'
      ELSE 'completed'
    END,
    finished_at = CASE WHEN total >= expected THEN now() ELSE finished_at END,
    final_url = COALESCE(audit_runs.final_url, (NEW.raw->>'finalUrl')::text)
  WHERE id = NEW.run_id;

  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_results_rollup ON public.audit_results;
--> statement-breakpoint
CREATE TRIGGER audit_results_rollup
  AFTER INSERT ON public.audit_results
  FOR EACH ROW EXECUTE FUNCTION public.rollup_run_status();
