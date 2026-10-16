ALTER TABLE companies ADD COLUMN portal_name TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN portal_name_english TEXT NOT NULL DEFAULT '';

UPDATE companies SET portal_name = COALESCE(
  (SELECT NULLIF(TRIM(json_extract(t.raw_json,'$.company')),'')
     FROM tasks t
    WHERE t.company_id = companies.id AND json_valid(t.raw_json)
      AND NULLIF(TRIM(json_extract(t.raw_json,'$.company')),'') IS NOT NULL
    LIMIT 1),
  (SELECT NULLIF(TRIM(json_extract(o.raw_json,'$.company')),'')
     FROM obligations o
    WHERE o.company_id = companies.id AND json_valid(o.raw_json)
      AND NULLIF(TRIM(json_extract(o.raw_json,'$.company')),'') IS NOT NULL
    LIMIT 1),
  (SELECT NULLIF(TRIM(json_extract(p.raw_json,'$.companyName')),'')
     FROM payments p
    WHERE p.company_id = companies.id AND json_valid(p.raw_json)
      AND NULLIF(TRIM(json_extract(p.raw_json,'$.companyName')),'') IS NOT NULL
    LIMIT 1),
  (SELECT NULLIF(TRIM(json_extract(m.raw_json,'$.company')),'')
     FROM messages m
    WHERE m.company_id = companies.id AND json_valid(m.raw_json)
      AND NULLIF(TRIM(json_extract(m.raw_json,'$.company')),'') IS NOT NULL
    LIMIT 1)
) WHERE portal_name = '';

UPDATE companies SET name = portal_name
 WHERE portal_name <> '' AND name_source = 'source' AND name <> portal_name;