CREATE TABLE IF NOT EXISTS activity_template_set (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  table_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_activity_template_set_table
  ON activity_template_set(table_name);
