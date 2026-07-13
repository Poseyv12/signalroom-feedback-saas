CREATE TABLE IF NOT EXISTS marketing_leads (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  company TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_events (
  id UUID PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (event_name IN (
    'primary_cta_clicked',
    'demo_clicked',
    'pricing_cta_clicked',
    'lead_form_started',
    'lead_form_succeeded',
    'lead_form_failed'
  )),
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_events_name_created_at_idx
  ON marketing_events(event_name, created_at DESC);

ALTER TABLE marketing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE marketing_leads, marketing_events FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE marketing_leads, marketing_events FROM authenticated;
  END IF;
END
$$;
