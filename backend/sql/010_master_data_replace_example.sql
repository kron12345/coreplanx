-- Example statement for whole-collection replacement of personnel_service_pool.
-- Bind :items_json to a JSON array of pools (each with id, name, service_ids, ...).

WITH incoming AS (
  SELECT *
  FROM jsonb_to_recordset(:items_json::jsonb)
       AS t(
         id TEXT,
         name TEXT,
         description TEXT,
         service_ids TEXT[],
         shift_coordinator TEXT,
         contact_email TEXT,
         attributes JSONB
       )
)
-- delete pools that are no longer present
DELETE FROM personnel_service_pool p
WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.id = p.id);

-- upsert the new collection
INSERT INTO personnel_service_pool (
  id, name, description, service_ids, shift_coordinator, contact_email, attributes
)
SELECT id, name, description, service_ids, shift_coordinator, contact_email, attributes
FROM incoming
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    service_ids = EXCLUDED.service_ids,
    shift_coordinator = EXCLUDED.shift_coordinator,
    contact_email = EXCLUDED.contact_email,
    attributes = EXCLUDED.attributes,
    updated_at = now();
