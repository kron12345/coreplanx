-- Example resource mutation (upserts + deletes) for a single stage.

-- :stage_id    text
-- :upserts     json array of resources (id, name, kind, dailyServiceCapacity, attributes)
-- :delete_ids  json array of resource IDs to delete

WITH payload AS (
  SELECT *
  FROM jsonb_to_recordset(:upserts::jsonb)
       AS r(
         id TEXT,
         name TEXT,
         kind TEXT,
         daily_service_capacity INTEGER,
         attributes JSONB
       )
)
INSERT INTO planning_resource (
  id, stage_id, name, kind, daily_service_capacity, attributes
)
SELECT id, :stage_id, name, kind, daily_service_capacity, attributes
FROM payload
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    kind = EXCLUDED.kind,
    daily_service_capacity = EXCLUDED.daily_service_capacity,
    attributes = EXCLUDED.attributes,
    updated_at = now();

DELETE FROM planning_resource
WHERE stage_id = :stage_id
  AND id = ANY (SELECT jsonb_array_elements_text(:delete_ids::jsonb));

-- Example activity mutation (similar approach, truncated columns for brevity)

WITH payload AS (
  SELECT *
  FROM jsonb_to_recordset(:activity_upserts::jsonb)
       AS a(
         id TEXT,
         resource_id TEXT,
         title TEXT,
         start TIMESTAMPTZ,
         "end" TIMESTAMPTZ,
         type TEXT,
         attributes JSONB
       )
)
INSERT INTO planning_activity (
  id, stage_id, resource_id, title, start, "end", type, attributes
)
SELECT id, :stage_id, resource_id, title, start, "end", type, attributes
FROM payload
ON CONFLICT (id) DO UPDATE
SET resource_id = EXCLUDED.resource_id,
    title = EXCLUDED.title,
    start = EXCLUDED.start,
    "end" = EXCLUDED."end",
    type = EXCLUDED.type,
    attributes = EXCLUDED.attributes,
    updated_at = now();

DELETE FROM planning_activity
WHERE stage_id = :stage_id
  AND id = ANY (SELECT jsonb_array_elements_text(:activity_delete_ids::jsonb));
