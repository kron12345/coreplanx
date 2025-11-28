CREATE TABLE IF NOT EXISTS plan_week_template (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  base_week_start DATE NOT NULL,
  variant TEXT,
  version TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_week_slice (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES plan_week_template(id) ON DELETE CASCADE,
  label TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_week_slice_template
  ON plan_week_slice(template_id);

CREATE TABLE IF NOT EXISTS plan_week_validity (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES plan_week_template(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  include_week_numbers INTEGER[],
  exclude_week_numbers INTEGER[],
  status TEXT NOT NULL DEFAULT 'draft',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_week_validity_template
  ON plan_week_validity(template_id);

CREATE TABLE IF NOT EXISTS plan_week_activity (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES plan_week_template(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  type TEXT,
  remark TEXT,
  attributes JSONB,
  participants JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_week_activity_template
  ON plan_week_activity(template_id);

CREATE TABLE IF NOT EXISTS week_instance (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES plan_week_template(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  template_version TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_week_instance_template_week UNIQUE (template_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_week_instance_template
  ON week_instance(template_id);

CREATE INDEX IF NOT EXISTS idx_week_instance_week_start
  ON week_instance(week_start);

CREATE TABLE IF NOT EXISTS scheduled_service (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES week_instance(id) ON DELETE CASCADE,
  slice_id TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  attributes JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_service_instance
  ON scheduled_service(instance_id);

CREATE TABLE IF NOT EXISTS service_assignment (
  id TEXT PRIMARY KEY,
  scheduled_service_id TEXT NOT NULL REFERENCES scheduled_service(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  assigned_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_assignment_scheduled_service
  ON service_assignment(scheduled_service_id);
