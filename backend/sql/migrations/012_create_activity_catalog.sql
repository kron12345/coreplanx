CREATE TABLE IF NOT EXISTS activity_catalog_entry (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  applies_to TEXT[] NOT NULL DEFAULT '{}',
  relevant_for TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL,
  time_mode TEXT NOT NULL,
  fields TEXT[] NOT NULL DEFAULT '{}',
  default_duration_minutes INTEGER NOT NULL DEFAULT 0,
  attributes JSONB,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_catalog_entry_label
  ON activity_catalog_entry(label);
