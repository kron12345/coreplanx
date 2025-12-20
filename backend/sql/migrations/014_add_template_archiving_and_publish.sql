-- Add archiving + publish metadata for base planning templates.
-- Used by "Publish/Promote" workflow to protect productive data while keeping history.

ALTER TABLE activity_template_set
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT,
  ADD COLUMN IF NOT EXISTS published_from_variant_id TEXT,
  ADD COLUMN IF NOT EXISTS published_from_template_id TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_activity_template_set_variant_active
  ON activity_template_set (variant_id, is_archived, name);

CREATE INDEX IF NOT EXISTS idx_activity_template_set_published_from
  ON activity_template_set (published_from_variant_id, published_from_template_id);
