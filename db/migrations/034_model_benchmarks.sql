CREATE TABLE model_benchmarks (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  threads INTEGER NOT NULL,
  context_tokens INTEGER NOT NULL,
  n_prompt INTEGER NOT NULL,
  prompt_tok_per_s REAL NOT NULL,
  n_gen INTEGER NOT NULL,
  gen_tok_per_s REAL NOT NULL,
  observed_rss_mb INTEGER NOT NULL DEFAULT 0,
  measured_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX model_benchmarks_model_idx ON model_benchmarks(model, threads, measured_at);
