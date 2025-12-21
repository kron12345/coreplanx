-- Fahrplanmanager revisions + TrainServicePart decomposition.

-- -----------------------------
-- Timetable revisions (productive Fahrplanmanager is revisioned)
-- -----------------------------
CREATE TABLE IF NOT EXISTS timetable_revision (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  stage_id TEXT NOT NULL DEFAULT 'base',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  message TEXT,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timetable_revision_variant_stage_created
  ON timetable_revision (variant_id, stage_id, created_at DESC);

-- -----------------------------
-- TrainServicePart (Zugleistung)
-- -----------------------------
CREATE TABLE IF NOT EXISTS train_service_part (
  id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT 'default',
  stage_id TEXT NOT NULL DEFAULT 'base',
  timetable_year_label TEXT,
  train_run_id TEXT NOT NULL,
  from_location_id TEXT NOT NULL,
  to_location_id TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  attributes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, variant_id),
  CONSTRAINT train_service_part_train_run_variant_fkey
    FOREIGN KEY (train_run_id, variant_id)
    REFERENCES train_run(id, variant_id)
    ON DELETE CASCADE
) PARTITION BY LIST (variant_id);

CREATE TABLE IF NOT EXISTS train_service_part_default
  PARTITION OF train_service_part
  FOR VALUES IN ('default');

CREATE INDEX IF NOT EXISTS idx_train_service_part_variant_stage_start
  ON train_service_part(variant_id, stage_id, start_time);

CREATE TABLE IF NOT EXISTS train_service_part_segment (
  part_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT 'default',
  segment_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (part_id, variant_id, segment_id),
  CONSTRAINT uniq_train_service_part_segment_order UNIQUE (part_id, variant_id, order_index),
  CONSTRAINT train_service_part_segment_part_fkey
    FOREIGN KEY (part_id, variant_id)
    REFERENCES train_service_part(id, variant_id)
    ON DELETE CASCADE,
  CONSTRAINT train_service_part_segment_segment_fkey
    FOREIGN KEY (segment_id, variant_id)
    REFERENCES train_segment(id, variant_id)
    ON DELETE CASCADE
) PARTITION BY LIST (variant_id);

CREATE TABLE IF NOT EXISTS train_service_part_segment_default
  PARTITION OF train_service_part_segment
  FOR VALUES IN ('default');

CREATE INDEX IF NOT EXISTS idx_train_service_part_segment_variant_segment
  ON train_service_part_segment(variant_id, segment_id);

CREATE TABLE IF NOT EXISTS train_service_part_link (
  variant_id TEXT NOT NULL DEFAULT 'default',
  from_part_id TEXT NOT NULL,
  to_part_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'circulation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, from_part_id, kind),
  CONSTRAINT train_service_part_link_from_fkey
    FOREIGN KEY (from_part_id, variant_id)
    REFERENCES train_service_part(id, variant_id)
    ON DELETE CASCADE,
  CONSTRAINT train_service_part_link_to_fkey
    FOREIGN KEY (to_part_id, variant_id)
    REFERENCES train_service_part(id, variant_id)
    ON DELETE CASCADE
) PARTITION BY LIST (variant_id);

CREATE TABLE IF NOT EXISTS train_service_part_link_default
  PARTITION OF train_service_part_link
  FOR VALUES IN ('default');

CREATE INDEX IF NOT EXISTS idx_train_service_part_link_variant_to
  ON train_service_part_link(variant_id, to_part_id);

