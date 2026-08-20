-- Migration: Add business profile fields to tenants table
-- Non-destructive: only adds new columns, creates services_v2 for migration

-- New columns for business profile
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_area text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_lead_time_minutes integer;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lead_handoff_email text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_tone text DEFAULT 'casual';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phrases_to_avoid text[];
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS must_use_phrases text[];
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS topics_to_avoid text[];

-- New services_v2 column (jsonb) for enhanced service objects
-- Will be populated from existing text[] services column in a separate step
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS services_v2 jsonb;

-- Comment for documentation
COMMENT ON COLUMN tenants.service_area IS 'Geographic area where services are provided (zip codes, cities, radius, etc.)';
COMMENT ON COLUMN tenants.booking_lead_time_minutes IS 'Minimum advance notice required for bookings (in minutes)';
COMMENT ON COLUMN tenants.lead_handoff_email IS 'Email address where qualified leads should be sent (separate from tenant email)';
COMMENT ON COLUMN tenants.brand_tone IS 'Brand voice preference: formal | casual | playful';
COMMENT ON COLUMN tenants.phrases_to_avoid IS 'Phrases/words the AI should never use in responses';
COMMENT ON COLUMN tenants.must_use_phrases IS 'Phrases/words the AI must include when relevant';
COMMENT ON COLUMN tenants.topics_to_avoid IS 'Topics the AI should never discuss or engage with';
COMMENT ON COLUMN tenants.services_v2 IS 'Enhanced services: [{name, description, priceRange?}] - will replace services text[] after migration';