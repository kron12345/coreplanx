-- Store full rule documents as jsonb (parsed from YAML/JSON).

ALTER TABLE planning_rule
  ADD COLUMN IF NOT EXISTS definition JSONB NOT NULL DEFAULT '{}'::jsonb;

