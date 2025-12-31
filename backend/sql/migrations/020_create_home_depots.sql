CREATE TABLE IF NOT EXISTS master_home_depot (
  home_depot_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

