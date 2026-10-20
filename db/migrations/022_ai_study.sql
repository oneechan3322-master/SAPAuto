-- Migration 022: AI live study & analysis on obligations, messages, and documents
ALTER TABLE obligations ADD COLUMN ai_study TEXT NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN ai_risk_score TEXT NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN ai_studied_at TEXT;

ALTER TABLE messages ADD COLUMN ai_study TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN ai_action_required TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN ai_studied_at TEXT;

ALTER TABLE tasks ADD COLUMN ai_study TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN ai_studied_at TEXT;
