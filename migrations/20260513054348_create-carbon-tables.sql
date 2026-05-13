ALTER TABLE emission_entries ADD COLUMN factor NUMERIC;
ALTER TABLE emission_entries ADD COLUMN method TEXT;
ALTER TABLE emission_entries ADD COLUMN confidence NUMERIC DEFAULT 1.0;

CREATE INDEX idx_emission_entries_scope ON emission_entries(scope);
CREATE INDEX idx_emission_entries_category ON emission_entries(category);
CREATE INDEX idx_emission_entries_facility ON emission_entries(facility_id);

CREATE TABLE emission_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  scope1_total NUMERIC DEFAULT 0,
  scope2_total NUMERIC DEFAULT 0,
  scope3_total NUMERIC DEFAULT 0,
  total_co2e NUMERIC DEFAULT 0,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_emission_reports_company ON emission_reports(company_id);
CREATE INDEX idx_emission_reports_period ON emission_reports(period_start, period_end);

ALTER TABLE emission_reports ENABLE ROW LEVEL SECURITY;
