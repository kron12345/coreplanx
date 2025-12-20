-- Introduce variant/year scoping for planning + timeline data.
-- The default scope is "default" to remain backward compatible.

-- -----------------------------
-- Planning stage metadata
-- -----------------------------
ALTER TABLE planning_stage
  ADD COLUMN IF NOT EXISTS variant_id TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS timetable_year_label TEXT;

UPDATE planning_stage
SET variant_id = 'default'
WHERE variant_id IS NULL OR variant_id = '';

ALTER TABLE planning_stage
  DROP CONSTRAINT IF EXISTS planning_stage_pkey CASCADE;

ALTER TABLE planning_stage
  ADD CONSTRAINT planning_stage_pkey PRIMARY KEY (stage_id, variant_id);

-- -----------------------------
-- Planning resources
-- -----------------------------
ALTER TABLE planning_resource
  ADD COLUMN IF NOT EXISTS variant_id TEXT NOT NULL DEFAULT 'default';

UPDATE planning_resource
SET variant_id = 'default'
WHERE variant_id IS NULL OR variant_id = '';

ALTER TABLE planning_resource
  DROP CONSTRAINT IF EXISTS planning_resource_stage_id_fkey;

ALTER TABLE planning_resource
  DROP CONSTRAINT IF EXISTS planning_resource_stage_variant_fkey;

ALTER TABLE planning_resource
  ADD CONSTRAINT planning_resource_stage_variant_fkey
  FOREIGN KEY (stage_id, variant_id)
  REFERENCES planning_stage(stage_id, variant_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_planning_resource_stage_variant
  ON planning_resource(stage_id, variant_id);

-- -----------------------------
-- Planning activities
-- -----------------------------
ALTER TABLE planning_activity
  ADD COLUMN IF NOT EXISTS variant_id TEXT NOT NULL DEFAULT 'default';

UPDATE planning_activity
SET variant_id = 'default'
WHERE variant_id IS NULL OR variant_id = '';

ALTER TABLE planning_activity
  DROP CONSTRAINT IF EXISTS planning_activity_stage_id_fkey;

ALTER TABLE planning_activity
  DROP CONSTRAINT IF EXISTS planning_activity_stage_variant_fkey;

ALTER TABLE planning_activity
  ADD CONSTRAINT planning_activity_stage_variant_fkey
  FOREIGN KEY (stage_id, variant_id)
  REFERENCES planning_stage(stage_id, variant_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_planning_activity_stage_variant
  ON planning_activity(stage_id, variant_id);

-- -----------------------------
-- Timetable data (train runs/segments)
-- -----------------------------
ALTER TABLE train_run
  ADD COLUMN IF NOT EXISTS variant_id TEXT NOT NULL DEFAULT 'default';

UPDATE train_run
SET variant_id = 'default'
WHERE variant_id IS NULL OR variant_id = '';

ALTER TABLE train_run
  DROP CONSTRAINT IF EXISTS train_run_stage_id_fkey;

ALTER TABLE train_run
  DROP CONSTRAINT IF EXISTS train_run_stage_variant_fkey;

ALTER TABLE train_run
  ADD CONSTRAINT train_run_stage_variant_fkey
  FOREIGN KEY (stage_id, variant_id)
  REFERENCES planning_stage(stage_id, variant_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_train_run_stage_variant
  ON train_run(stage_id, variant_id);

ALTER TABLE train_segment
  ADD COLUMN IF NOT EXISTS variant_id TEXT NOT NULL DEFAULT 'default';

UPDATE train_segment
SET variant_id = 'default'
WHERE variant_id IS NULL OR variant_id = '';

ALTER TABLE train_segment
  DROP CONSTRAINT IF EXISTS train_segment_stage_id_fkey;

ALTER TABLE train_segment
  DROP CONSTRAINT IF EXISTS train_segment_stage_variant_fkey;

ALTER TABLE train_segment
  ADD CONSTRAINT train_segment_stage_variant_fkey
  FOREIGN KEY (stage_id, variant_id)
  REFERENCES planning_stage(stage_id, variant_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_train_segment_stage_variant
  ON train_segment(stage_id, variant_id);

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
