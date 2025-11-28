CREATE TABLE IF NOT EXISTS activity_type_definition (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  applies_to TEXT[] NOT NULL,
  relevant_for TEXT[] NOT NULL,
  category TEXT NOT NULL,
  time_mode TEXT NOT NULL,
  fields TEXT[] NOT NULL,
  default_duration_minutes INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_template (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  activity_type TEXT,
  default_duration_minutes INTEGER,
  attributes JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_definition (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  activity_type TEXT NOT NULL,
  template_id TEXT,
  default_duration_minutes INTEGER,
  relevant_for TEXT[],
  attributes JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_layer_group (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 50,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_translation (
  locale TEXT NOT NULL,
  translation_key TEXT NOT NULL,
  label TEXT,
  abbreviation TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (locale, translation_key)
);
