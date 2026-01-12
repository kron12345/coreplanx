CREATE TABLE IF NOT EXISTS activity_category (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER,
  icon TEXT,
  description TEXT
);
