-- Order management schema (orders, items, business, customers, templates, archive).

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer_number TEXT NOT NULL,
  project_number TEXT,
  address TEXT,
  contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_name
  ON customers(name);

CREATE INDEX IF NOT EXISTS idx_customers_customer_number
  ON customers(customer_number);

CREATE INDEX IF NOT EXISTS idx_customers_search
  ON customers
  USING GIN (to_tsvector('simple',
    coalesce(id, '') || ' ' ||
    coalesce(name, '') || ' ' ||
    coalesce(customer_number, '') || ' ' ||
    coalesce(project_number, '') || ' ' ||
    coalesce(address, '')
  ));

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_label TEXT,
  comment TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  timetable_year_label TEXT,
  process_status TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_label TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_customer
  ON orders(customer_id);

CREATE INDEX IF NOT EXISTS idx_orders_process_status
  ON orders(process_status);

CREATE INDEX IF NOT EXISTS idx_orders_timetable_year
  ON orders(timetable_year_label);

CREATE INDEX IF NOT EXISTS idx_orders_tags
  ON orders USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_orders_search
  ON orders
  USING GIN (to_tsvector('simple',
    coalesce(id, '') || ' ' ||
    coalesce(name, '') || ' ' ||
    coalesce(customer_label, '') || ' ' ||
    coalesce(comment, '')
  ));

CREATE TABLE IF NOT EXISTS schedule_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  train_number TEXT NOT NULL,
  responsible_ru TEXT NOT NULL,
  status TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  validity_start DATE NOT NULL,
  validity_end DATE,
  recurrence JSONB,
  composition JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_templates_status
  ON schedule_templates(status);

CREATE INDEX IF NOT EXISTS idx_schedule_templates_category
  ON schedule_templates(category);

CREATE INDEX IF NOT EXISTS idx_schedule_templates_tags
  ON schedule_templates USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_schedule_templates_search
  ON schedule_templates
  USING GIN (to_tsvector('simple',
    coalesce(id, '') || ' ' ||
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(train_number, '') || ' ' ||
    coalesce(responsible_ru, '')
  ));

CREATE TABLE IF NOT EXISTS schedule_template_stops (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  location_code TEXT NOT NULL,
  location_name TEXT NOT NULL,
  country_code TEXT,
  arrival_earliest TEXT,
  arrival_latest TEXT,
  departure_earliest TEXT,
  departure_latest TEXT,
  offset_days INTEGER,
  dwell_minutes INTEGER,
  activities TEXT[] NOT NULL DEFAULT '{}',
  platform_wish TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_template_stops_template
  ON schedule_template_stops(template_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_template_stops_sequence
  ON schedule_template_stops(template_id, sequence);

CREATE TABLE IF NOT EXISTS business_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL,
  recommended_assignment_type TEXT NOT NULL,
  recommended_assignment_name TEXT NOT NULL,
  due_rule_anchor TEXT NOT NULL,
  due_rule_offset_days INTEGER NOT NULL,
  due_rule_label TEXT NOT NULL,
  default_lead_time_days INTEGER NOT NULL,
  automation_hint TEXT,
  steps JSONB,
  parameter_hints TEXT[],
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_templates_category
  ON business_templates(category);

CREATE INDEX IF NOT EXISTS idx_business_templates_tags
  ON business_templates USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_business_templates_search
  ON business_templates
  USING GIN (to_tsvector('simple',
    coalesce(id, '') || ' ' ||
    coalesce(title, '') || ' ' ||
    coalesce(description, '')
  ));

CREATE TABLE IF NOT EXISTS business_phase_templates (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES business_templates(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  summary TEXT NOT NULL,
  timeline_reference TEXT NOT NULL,
  window_unit TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  window_bucket TEXT NOT NULL,
  window_label TEXT NOT NULL,
  source_phase TEXT,
  auto_create BOOLEAN NOT NULL DEFAULT false,
  automation_enabled BOOLEAN NOT NULL DEFAULT true,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_phase_templates_template
  ON business_phase_templates(template_id);

CREATE INDEX IF NOT EXISTS idx_business_phase_templates_source_phase
  ON business_phase_templates(source_phase);

CREATE TABLE IF NOT EXISTS business_phase_conditions (
  id TEXT PRIMARY KEY,
  phase_id TEXT NOT NULL REFERENCES business_phase_templates(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  operator TEXT NOT NULL,
  value TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_business_phase_conditions_phase
  ON business_phase_conditions(phase_id);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  assignment_type TEXT NOT NULL,
  assignment_name TEXT NOT NULL,
  due_date TIMESTAMPTZ,
  documents JSONB,
  tags TEXT[] NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_businesses_status
  ON businesses(status);

CREATE INDEX IF NOT EXISTS idx_businesses_due_date
  ON businesses(due_date);

CREATE INDEX IF NOT EXISTS idx_businesses_assignment
  ON businesses(assignment_name);

CREATE INDEX IF NOT EXISTS idx_businesses_tags
  ON businesses USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_businesses_search
  ON businesses
  USING GIN (to_tsvector('simple',
    coalesce(id, '') || ' ' ||
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(assignment_name, '') || ' ' ||
    coalesce(status, '')
  ));

CREATE TABLE IF NOT EXISTS traffic_periods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  responsible TEXT,
  timetable_year_label TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traffic_periods_type
  ON traffic_periods(type);

CREATE INDEX IF NOT EXISTS idx_traffic_periods_year
  ON traffic_periods(timetable_year_label);

CREATE INDEX IF NOT EXISTS idx_traffic_periods_tags
  ON traffic_periods USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_traffic_periods_search
  ON traffic_periods
  USING GIN (to_tsvector('simple',
    coalesce(id, '') || ' ' ||
    coalesce(name, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(responsible, '')
  ));

CREATE TABLE IF NOT EXISTS traffic_period_rules (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES traffic_periods(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  days_bitmap TEXT NOT NULL,
  validity_start DATE NOT NULL,
  validity_end DATE,
  includes_holidays BOOLEAN,
  excludes_dates JSONB,
  includes_dates JSONB,
  variant_type TEXT,
  applies_to TEXT,
  variant_number TEXT,
  reason TEXT,
  is_primary BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_traffic_period_rules_period
  ON traffic_period_rules(period_id);

CREATE TABLE IF NOT EXISTS train_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  train_number TEXT NOT NULL,
  path_request_id TEXT NOT NULL,
  path_id TEXT,
  case_reference JSONB,
  status TEXT NOT NULL,
  responsible_ru TEXT NOT NULL,
  participants JSONB,
  calendar_valid_from DATE NOT NULL,
  calendar_valid_to DATE,
  calendar_days_bitmap TEXT NOT NULL,
  traffic_period_id TEXT REFERENCES traffic_periods(id) ON DELETE SET NULL,
  reference_plan_id TEXT,
  stops JSONB NOT NULL DEFAULT '[]'::jsonb,
  technical JSONB,
  route_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_template_id TEXT,
  source_system_id TEXT,
  linked_order_item_id TEXT,
  notes TEXT,
  rolling_stock JSONB,
  plan_variant_type TEXT,
  variant_of_plan_id TEXT,
  variant_label TEXT,
  simulation_id TEXT,
  simulation_label TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_train_plans_status
  ON train_plans(status);

CREATE INDEX IF NOT EXISTS idx_train_plans_train_number
  ON train_plans(train_number);

CREATE INDEX IF NOT EXISTS idx_train_plans_calendar
  ON train_plans(calendar_valid_from, calendar_valid_to);

CREATE INDEX IF NOT EXISTS idx_train_plans_linked_item
  ON train_plans(linked_order_item_id);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  start TIMESTAMPTZ,
  "end" TIMESTAMPTZ,
  responsible TEXT,
  deviation TEXT,
  service_type TEXT,
  from_location TEXT,
  to_location TEXT,
  validity JSONB,
  parent_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  version_path INTEGER[],
  generated_timetable_ref_id TEXT,
  timetable_phase TEXT,
  internal_status TEXT,
  timetable_year_label TEXT,
  traffic_period_id TEXT REFERENCES traffic_periods(id) ON DELETE SET NULL,
  linked_template_id TEXT REFERENCES schedule_templates(id) ON DELETE SET NULL,
  linked_train_plan_id TEXT REFERENCES train_plans(id) ON DELETE SET NULL,
  variant_type TEXT,
  variant_of_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  variant_group_id TEXT,
  variant_label TEXT,
  simulation_id TEXT,
  simulation_label TEXT,
  merge_status TEXT,
  merge_target_id TEXT,
  original_timetable JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "end" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_order_items_order
  ON order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_type
  ON order_items(type);

CREATE INDEX IF NOT EXISTS idx_order_items_tags
  ON order_items USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_order_items_time
  ON order_items(start, "end");

CREATE INDEX IF NOT EXISTS idx_order_items_timetable_year
  ON order_items(timetable_year_label);

CREATE INDEX IF NOT EXISTS idx_order_items_phase
  ON order_items(timetable_phase);

CREATE INDEX IF NOT EXISTS idx_order_items_internal_status
  ON order_items(internal_status);

CREATE INDEX IF NOT EXISTS idx_order_items_variant_type
  ON order_items(variant_type);

CREATE INDEX IF NOT EXISTS idx_order_items_links
  ON order_items(traffic_period_id, linked_template_id, linked_train_plan_id);

CREATE INDEX IF NOT EXISTS idx_order_items_search
  ON order_items
  USING GIN (to_tsvector('simple',
    coalesce(id, '') || ' ' ||
    coalesce(name, '') || ' ' ||
    coalesce(service_type, '') || ' ' ||
    coalesce(from_location, '') || ' ' ||
    coalesce(to_location, '') || ' ' ||
    coalesce(responsible, '')
  ));

CREATE TABLE IF NOT EXISTS business_order_items (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_business_order_items_item
  ON business_order_items(order_item_id);

CREATE TABLE IF NOT EXISTS train_plan_versions (
  id TEXT PRIMARY KEY,
  train_plan_id TEXT NOT NULL REFERENCES train_plans(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  reason TEXT,
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_train_plan_versions_plan
  ON train_plan_versions(train_plan_id);

CREATE TABLE IF NOT EXISTS traffic_period_versions (
  id TEXT PRIMARY KEY,
  traffic_period_id TEXT NOT NULL REFERENCES traffic_periods(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  reason TEXT,
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traffic_period_versions_period
  ON traffic_period_versions(traffic_period_id);

CREATE TABLE IF NOT EXISTS business_automation_executions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES business_templates(id) ON DELETE CASCADE,
  business_id TEXT,
  status TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_business_automation_executions_rule
  ON business_automation_executions(rule_id);

CREATE INDEX IF NOT EXISTS idx_business_automation_executions_template
  ON business_automation_executions(template_id);

ALTER TABLE train_plans
  ADD CONSTRAINT train_plans_order_item_fkey
  FOREIGN KEY (linked_order_item_id)
  REFERENCES order_items(id)
  ON DELETE SET NULL;
