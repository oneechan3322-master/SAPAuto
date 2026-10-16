INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES
  ('automation_enabled','false',CURRENT_TIMESTAMP),
  ('assistant_manager_enabled','true',CURRENT_TIMESTAMP),
  ('assistant_manager_interval_ms','30000',CURRENT_TIMESTAMP),
  ('message_mode','dry-run',CURRENT_TIMESTAMP),
  ('ai_provider','gemma4',CURRENT_TIMESTAMP),
  ('ai_allow_cloud','false',CURRENT_TIMESTAMP),
  ('opencode_proposals_enabled','false',CURRENT_TIMESTAMP);
