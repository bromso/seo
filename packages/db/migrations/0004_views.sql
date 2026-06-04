-- 1. Latest completed/partial run per site (one row per site)
CREATE OR REPLACE VIEW public.latest_run_per_site
WITH (security_invoker = true) AS
SELECT DISTINCT ON (site_id)
  site_id,
  id AS run_id,
  status,
  started_at,
  finished_at,
  owner_id
FROM public.audit_runs
WHERE status IN ('completed', 'partial')
ORDER BY site_id, started_at DESC;
--> statement-breakpoint

-- 2. Latest 5 category scores per site, joined to site metadata
CREATE OR REPLACE VIEW public.latest_scores_per_site
WITH (security_invoker = true) AS
SELECT
  s.id           AS site_id,
  s.owner_id,
  s.url,
  s.label,
  s.is_competitor,
  lr.run_id,
  lr.status      AS run_status,
  lr.started_at  AS run_started_at,
  ar.category,
  ar.status      AS result_status,
  ar.score
FROM public.sites s
LEFT JOIN public.latest_run_per_site lr ON lr.site_id = s.id
LEFT JOIN public.audit_results ar      ON ar.run_id  = lr.run_id;
--> statement-breakpoint

-- 3. Score time series per (site, category)
CREATE OR REPLACE VIEW public.score_trends
WITH (security_invoker = true) AS
SELECT
  s.id           AS site_id,
  s.owner_id,
  s.label,
  s.is_competitor,
  ar.category,
  ar.score,
  ar.started_at  AS measured_at
FROM public.sites s
JOIN public.audit_runs r        ON r.site_id  = s.id
JOIN public.audit_results ar    ON ar.run_id  = r.id
WHERE r.status IN ('completed', 'partial')
  AND ar.status IN ('success', 'partial')
  AND ar.score IS NOT NULL;
