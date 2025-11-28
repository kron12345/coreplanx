ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'base';

UPDATE activities
SET stage = COALESCE(NULLIF(stage, ''), 'base');

CREATE INDEX IF NOT EXISTS idx_activities_stage_timerange
  ON activities (stage, start_time, end_time)
  WHERE deleted = FALSE;
