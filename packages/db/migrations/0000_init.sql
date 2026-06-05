CREATE TYPE "public"."category" AS ENUM('performance', 'seo', 'best-practices', 'pwa', 'on-page');--> statement-breakpoint
CREATE TYPE "public"."result_status" AS ENUM('success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "audit_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"category" "category" NOT NULL,
	"status" "result_status" NOT NULL,
	"score" integer,
	"issues" jsonb,
	"raw" jsonb,
	"partial_reasons" text[],
	"error_code" text,
	"error_message" text,
	"error_retryable" boolean,
	"package_name" text NOT NULL,
	"package_version" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_results_score_range" CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);
--> statement-breakpoint
CREATE TABLE "audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"triggered_by" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"label" text,
	"is_competitor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_results" ADD CONSTRAINT "audit_results_run_id_audit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_results" ADD CONSTRAINT "audit_results_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_results_run_category_idx" ON "audit_results" USING btree ("run_id","category");--> statement-breakpoint
CREATE INDEX "audit_results_owner_category_started_idx" ON "audit_results" USING btree ("owner_id","category","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_runs_site_started_idx" ON "audit_runs" USING btree ("site_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_runs_owner_idx" ON "audit_runs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "audit_runs_status_idx" ON "audit_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_owner_normalized_url_idx" ON "sites" USING btree ("owner_id","normalized_url");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_one_self_per_owner_idx" ON "sites" USING btree ("owner_id") WHERE is_competitor = false;--> statement-breakpoint
CREATE INDEX "sites_owner_idx" ON "sites" USING btree ("owner_id");