ALTER TABLE companies ADD COLUMN english_name TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN tax_registration_number TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN name_source TEXT NOT NULL DEFAULT 'source'
  CHECK(name_source IN ('source', 'manual'));
CREATE UNIQUE INDEX companies_tax_registration_number_idx
  ON companies(tax_registration_number)
  WHERE tax_registration_number <> '';
