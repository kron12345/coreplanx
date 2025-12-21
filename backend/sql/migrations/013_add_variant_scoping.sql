-- Introduce variant/year scoping for planning + timeline data.
-- The default scope is "default" to remain backward compatible.

-- -----------------------------
-- Timeline activities (used by /timeline)
-- -----------------------------
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS variant_id TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS timetable_year_label TEXT;

UPDATE activities
SET variant_id = 'default'
WHERE variant_id IS NULL OR variant_id = '';

CREATE INDEX IF NOT EXISTS idx_activities_variant_stage_timerange
  ON activities (variant_id, stage, start_time, end_time)
  WHERE deleted = FALSE;

-- -----------------------------
-- Template sets (used by /templates/*)
-- -----------------------------
ALTER TABLE activity_template_set
  ADD COLUMN IF NOT EXISTS variant_id TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS timetable_year_label TEXT;

UPDATE activity_template_set
SET variant_id = 'default'
WHERE variant_id IS NULL OR variant_id = '';

CREATE INDEX IF NOT EXISTS idx_activity_template_set_variant
  ON activity_template_set(variant_id, name);
