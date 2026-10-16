CREATE TABLE setup_bootstrap (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  lease_until TEXT NOT NULL
);

INSERT INTO setup_bootstrap(id, lease_until)
VALUES(1, '1970-01-01T00:00:00.000Z');
