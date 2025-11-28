-- Core activities table for timeline/service aggregation with versioned JSONB payload.
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  is_open_ended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attributes JSONB NOT NULL,
  audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activities_timerange
  ON activities (start_time, end_time)
  WHERE deleted = FALSE;
