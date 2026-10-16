CREATE TABLE channel_deliveries (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY(event_id, channel, external_id)
);
