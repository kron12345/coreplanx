ALTER TABLE activity_type_definition
  ADD COLUMN IF NOT EXISTS attributes JSONB,
  ADD COLUMN IF NOT EXISTS meta JSONB;

CREATE TABLE IF NOT EXISTS custom_attribute_definition (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  temporal BOOLEAN NOT NULL DEFAULT false,
  required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_custom_attribute_definition_entity_key
  ON custom_attribute_definition(entity_id, key);

CREATE INDEX IF NOT EXISTS idx_custom_attribute_definition_entity
  ON custom_attribute_definition(entity_id);
