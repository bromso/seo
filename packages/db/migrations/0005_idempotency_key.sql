-- 1. Add nullable idempotency_key column to audit_runs
ALTER TABLE public.audit_runs
  ADD COLUMN idempotency_key TEXT;
--> statement-breakpoint

-- 2. Partial unique index — enforce uniqueness only when key is present.
-- NULL keys (legacy clients, in-flight rows from before this slice) are not
-- subject to the constraint.
CREATE UNIQUE INDEX audit_runs_owner_idempotency_uq
  ON public.audit_runs (owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
