-- Allow arbitrary string IDs for resource entities (previously UUID).
-- This adjusts all resource-related tables and their membership tables to use TEXT IDs.

-- Personnel + services + pools
ALTER TABLE personnel
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text;

ALTER TABLE personnel_services
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN pool_id TYPE TEXT USING pool_id::text;

ALTER TABLE personnel_pools
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text;

ALTER TABLE personnel_pool_members
  ALTER COLUMN pool_id TYPE TEXT USING pool_id::text,
  ALTER COLUMN personnel_id TYPE TEXT USING personnel_id::text;

ALTER TABLE personnel_service_pools
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text;

ALTER TABLE personnel_service_pool_members
  ALTER COLUMN pool_id TYPE TEXT USING pool_id::text,
  ALTER COLUMN service_id TYPE TEXT USING service_id::text;

-- Vehicles + services + pools
ALTER TABLE vehicles
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN type_id TYPE TEXT USING type_id::text;

ALTER TABLE vehicle_services
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN pool_id TYPE TEXT USING pool_id::text;

ALTER TABLE vehicle_pools
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text;

ALTER TABLE vehicle_pool_members
  ALTER COLUMN pool_id TYPE TEXT USING pool_id::text,
  ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;

ALTER TABLE vehicle_service_pools
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::text;

ALTER TABLE vehicle_service_pool_members
  ALTER COLUMN pool_id TYPE TEXT USING pool_id::text,
  ALTER COLUMN service_id TYPE TEXT USING service_id::text;
