
-- 1. ebay_accounts
CREATE TABLE public.ebay_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  ebay_user_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  region TEXT NOT NULL DEFAULT 'US',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ebay_accounts TO authenticated;
GRANT ALL ON public.ebay_accounts TO service_role;
ALTER TABLE public.ebay_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ebay accounts" ON public.ebay_accounts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_ebay_accounts_updated BEFORE UPDATE ON public.ebay_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX ebay_accounts_user_idx ON public.ebay_accounts(user_id);

-- 2. account_rules
CREATE TABLE public.account_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.ebay_accounts(id) ON DELETE CASCADE,
  cj_category TEXT NOT NULL,
  region TEXT,
  is_preferred BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_rules TO authenticated;
GRANT ALL ON public.account_rules TO service_role;
ALTER TABLE public.account_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own account rules" ON public.account_rules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_account_rules_updated BEFORE UPDATE ON public.account_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX account_rules_account_idx ON public.account_rules(account_id);
CREATE INDEX account_rules_user_idx ON public.account_rules(user_id);

-- 3. listing_queue
CREATE TABLE public.listing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.ebay_accounts(id) ON DELETE CASCADE,
  draft_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_queue TO authenticated;
GRANT ALL ON public.listing_queue TO service_role;
ALTER TABLE public.listing_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own listing queue" ON public.listing_queue FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_listing_queue_updated BEFORE UPDATE ON public.listing_queue FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX listing_queue_account_status_idx ON public.listing_queue(account_id, status);
CREATE INDEX listing_queue_user_idx ON public.listing_queue(user_id);

-- 4. account_id FK on existing tables
ALTER TABLE public.ebay_listings ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.ebay_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.listing_drafts ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.ebay_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.ebay_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ebay_listings_account_idx ON public.ebay_listings(account_id);
CREATE INDEX IF NOT EXISTS listing_drafts_account_idx ON public.listing_drafts(account_id);
CREATE INDEX IF NOT EXISTS activity_logs_account_idx ON public.activity_logs(account_id);

-- 5. Backfill: create a Default account per user with an active eBay integration
INSERT INTO public.ebay_accounts (user_id, account_name, access_token, refresh_token, token_expires_at, is_active)
SELECT
  ic.user_id,
  'Default',
  NULLIF(ic.credentials->>'access_token',''),
  NULLIF(ic.credentials->>'refresh_token',''),
  CASE
    WHEN (ic.credentials->>'expires_at') ~ '^[0-9]+$'
      THEN to_timestamp((ic.credentials->>'expires_at')::bigint / 1000.0)
    ELSE NULL
  END,
  COALESCE(ic.is_active, true)
FROM public.integration_credentials ic
WHERE ic.provider::text = 'ebay'
  AND NOT EXISTS (SELECT 1 FROM public.ebay_accounts a WHERE a.user_id = ic.user_id);

-- 6. Backfill account_id on existing rows to that Default account
UPDATE public.ebay_listings l
SET account_id = a.id
FROM public.ebay_accounts a
WHERE l.account_id IS NULL AND a.user_id = l.user_id AND a.account_name = 'Default';

UPDATE public.listing_drafts d
SET account_id = a.id
FROM public.ebay_accounts a
WHERE d.account_id IS NULL AND a.user_id = d.user_id AND a.account_name = 'Default';

UPDATE public.activity_logs g
SET account_id = a.id
FROM public.ebay_accounts a
WHERE g.account_id IS NULL AND a.user_id = g.user_id AND a.account_name = 'Default';
