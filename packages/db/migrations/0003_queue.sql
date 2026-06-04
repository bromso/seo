-- Enable pgmq extension
CREATE EXTENSION IF NOT EXISTS pgmq;
--> statement-breakpoint

-- Create the audit_runs queue (idempotent: pgmq.create is a no-op if exists)
SELECT pgmq.create('audit_runs');
--> statement-breakpoint

-- Trigger: publish to pgmq whenever a new audit_run row is inserted with status='queued'
CREATE OR REPLACE FUNCTION public.enqueue_audit_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pgmq AS $$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pgmq.send(
      'audit_runs',
      json_build_object(
        'runId', NEW.id,
        'siteId', NEW.site_id,
        'ownerId', NEW.owner_id,
        'requestedUrl', NEW.requested_url
      )::jsonb
    );
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_runs_enqueue ON public.audit_runs;
--> statement-breakpoint
CREATE TRIGGER audit_runs_enqueue
  AFTER INSERT ON public.audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_audit_run();
--> statement-breakpoint

-- Add Realtime publication for audit_runs + audit_results
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_runs;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_results;
