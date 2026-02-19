-- Ensure idempotent inbound/outbound message handling per case.

CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_ordering_message_case_external_id
  ON timetable_ordering_message(case_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
