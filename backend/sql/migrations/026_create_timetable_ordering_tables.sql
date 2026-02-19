-- Generic timetable ordering cases, events and transitions for FM-owned TTT process handling.

CREATE TABLE IF NOT EXISTS timetable_ordering_case (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  train_plan_id TEXT REFERENCES train_plans(id) ON DELETE SET NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  path_request_id TEXT,
  path_id TEXT,
  current_state TEXT NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  required_attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  provided_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocking_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  operational_contexts JSONB NOT NULL DEFAULT '[]'::jsonb,
  aggregated_phase JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_timetable_ordering_case_validity
    CHECK (valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_case_profile
  ON timetable_ordering_case(profile_id);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_case_state
  ON timetable_ordering_case(current_state);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_case_updated
  ON timetable_ordering_case(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_case_train_plan
  ON timetable_ordering_case(train_plan_id);

CREATE TABLE IF NOT EXISTS timetable_ordering_message (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES timetable_ordering_case(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  source TEXT NOT NULL,
  actor TEXT NOT NULL,
  message_type INTEGER,
  message_status INTEGER,
  type_of_request INTEGER,
  type_of_information INTEGER,
  event_key TEXT NOT NULL,
  external_message_id TEXT,
  correlation_key TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_message_case
  ON timetable_ordering_message(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_message_event
  ON timetable_ordering_message(event_key);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_message_external_id
  ON timetable_ordering_message(external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS timetable_ordering_transition (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES timetable_ordering_case(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  event_key TEXT NOT NULL,
  source TEXT NOT NULL,
  action_id TEXT,
  rejected BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_transition_case
  ON timetable_ordering_transition(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_transition_event
  ON timetable_ordering_transition(event_key);

CREATE INDEX IF NOT EXISTS idx_timetable_ordering_transition_rejected
  ON timetable_ordering_transition(rejected);
