-- Configurable planning rules (stored as YAML/JSON, evaluated in backend).

CREATE TABLE IF NOT EXISTS planning_rule (
  id TEXT NOT NULL,
  stage_id TEXT NOT NULL DEFAULT 'base',
  variant_id TEXT NOT NULL DEFAULT 'default',
  timetable_year_label TEXT,
  kind TEXT NOT NULL DEFAULT 'constraint' CHECK (kind IN ('generator', 'constraint')),
  executor TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  format TEXT NOT NULL DEFAULT 'yaml' CHECK (format IN ('yaml', 'json')),
  raw TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, variant_id, stage_id),
  CONSTRAINT planning_rule_stage_variant_fkey
    FOREIGN KEY (stage_id, variant_id)
    REFERENCES planning_stage(stage_id, variant_id)
    ON DELETE CASCADE
) PARTITION BY LIST (variant_id);

CREATE TABLE IF NOT EXISTS planning_rule_default
  PARTITION OF planning_rule
  FOR VALUES IN ('default');

CREATE INDEX IF NOT EXISTS idx_planning_rule_variant_stage
  ON planning_rule(variant_id, stage_id);

