-- Align nullable array columns with Prisma non-null list requirements.

ALTER TABLE business_templates
  ADD COLUMN IF NOT EXISTS parameter_hints TEXT[];

UPDATE business_templates
SET parameter_hints = '{}'::text[]
WHERE parameter_hints IS NULL;

ALTER TABLE business_templates
  ALTER COLUMN parameter_hints SET DEFAULT '{}'::text[],
  ALTER COLUMN parameter_hints SET NOT NULL;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS version_path INTEGER[];

UPDATE order_items
SET version_path = '{}'::integer[]
WHERE version_path IS NULL;

ALTER TABLE order_items
  ALTER COLUMN version_path SET DEFAULT '{}'::integer[],
  ALTER COLUMN version_path SET NOT NULL;
