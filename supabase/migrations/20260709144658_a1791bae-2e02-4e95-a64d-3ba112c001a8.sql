
-- Deduplicate any existing drafts first
DELETE FROM public.listing_drafts a
USING public.listing_drafts b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.cj_product_id IS NOT NULL
  AND a.cj_product_id = b.cj_product_id;

ALTER TABLE public.listing_drafts
  ADD CONSTRAINT listing_drafts_user_cj_unique UNIQUE (user_id, cj_product_id);

ALTER TABLE public.ebay_listings
  ADD COLUMN IF NOT EXISTS image_url TEXT;
