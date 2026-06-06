-- 1. Create push_subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- 2. Owner-scoped index
CREATE INDEX IF NOT EXISTS push_subscriptions_owner_idx
  ON public.push_subscriptions (owner_id);
--> statement-breakpoint

-- 3. Enable RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 4. Owner can read own subscriptions
CREATE POLICY "owners read own subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = owner_id);
--> statement-breakpoint

-- 5. Owner can insert own subscriptions
CREATE POLICY "owners insert own subscriptions"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
--> statement-breakpoint

-- 6. Owner can delete own subscriptions
CREATE POLICY "owners delete own subscriptions"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = owner_id);
--> statement-breakpoint
