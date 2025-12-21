-- Persistent timetable years + planning variants.

CREATE TABLE IF NOT EXISTS timetable_year (
  label TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planning_variant (
  id TEXT PRIMARY KEY,
  timetable_year_label TEXT NOT NULL REFERENCES timetable_year(label) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'productive' CHECK (kind IN ('productive', 'simulation')),
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planning_variant_year
  ON planning_variant(timetable_year_label);

-- Seed one productive year/variant so the app works out-of-the-box.
INSERT INTO timetable_year (label)
VALUES ('2025/26')
ON CONFLICT (label) DO NOTHING;

INSERT INTO planning_variant (id, timetable_year_label, kind, label)
VALUES ('PROD-2025/26', '2025/26', 'productive', 'Produktiv 2025/26')
ON CONFLICT (id) DO NOTHING;

