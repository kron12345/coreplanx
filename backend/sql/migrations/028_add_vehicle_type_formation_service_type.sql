ALTER TABLE vehicle_type
  ADD COLUMN IF NOT EXISTS formation_service_type TEXT;

ALTER TABLE vehicle_type
  DROP CONSTRAINT IF EXISTS chk_vehicle_type_formation_service_type;

ALTER TABLE vehicle_type
  ADD CONSTRAINT chk_vehicle_type_formation_service_type
  CHECK (
    formation_service_type IS NULL
    OR formation_service_type IN ('tractive_unit', 'wagon')
  );
