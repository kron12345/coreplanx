-- Drops planning tables in dependency order so migrations can be rerun safely.
-- Execute only if you really want to rebuild the schema.

DROP TABLE IF EXISTS vehicle_composition_entry CASCADE;
DROP TABLE IF EXISTS vehicle_composition CASCADE;
DROP TABLE IF EXISTS vehicle_type CASCADE;
DROP TABLE IF EXISTS vehicle_pool CASCADE;
DROP TABLE IF EXISTS vehicle_service_pool CASCADE;
DROP TABLE IF EXISTS personnel_pool CASCADE;
DROP TABLE IF EXISTS personnel_service_pool CASCADE;
DROP TABLE IF EXISTS planning_activity CASCADE;
DROP TABLE IF EXISTS planning_resource CASCADE;
DROP TABLE IF EXISTS planning_stage CASCADE;
