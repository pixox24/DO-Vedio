/**
 * 数据库迁移，按顺序执行，执行过的记录在 schema_migrations。
 * 只追加，不修改已发布的迁移。
 */
export const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX projects_updated ON projects(deleted_at, updated_at DESC);

CREATE TABLE assets (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  stage TEXT NOT NULL,
  key TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  priority INTEGER NOT NULL DEFAULT 5,
  run_after INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT,
  lease_until INTEGER,
  cost_estimate REAL NOT NULL DEFAULT 0,
  cost_actual REAL NOT NULL DEFAULT 0,
  error TEXT,
  input TEXT NOT NULL DEFAULT 'null',
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_claim ON jobs(status, stage, run_after);
CREATE INDEX jobs_project ON jobs(project_id, updated_at);
CREATE INDEX jobs_key ON jobs(key, status);

CREATE TABLE renders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  aspect TEXT NOT NULL,
  quality TEXT NOT NULL,
  timeline_hash TEXT NOT NULL,
  video_hash TEXT NOT NULL,
  srt_hash TEXT,
  duration_ms INTEGER NOT NULL,
  loudness REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX renders_project ON renders(project_id, created_at DESC);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  job_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  cost_yuan REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ledger_project ON ledger(project_id);

CREATE TABLE lexicon (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  word TEXT NOT NULL,
  say TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(scope, word)
);

CREATE TABLE voice_stats (
  voice_key TEXT PRIMARY KEY,
  chars INTEGER NOT NULL DEFAULT 0,
  speech_ms INTEGER NOT NULL DEFAULT 0,
  samples INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  host TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);
`,
  },
  {
    id: 2,
    name: "music_library",
    sql: `
CREATE TABLE music_tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  moods TEXT NOT NULL,
  loopable INTEGER NOT NULL DEFAULT 1,
  license TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_sig TEXT NOT NULL,
  asset_hash TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  loudness REAL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE app_assets (
  name TEXT PRIMARY KEY,
  asset_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    id: 3,
    name: "project_goals",
    sql: `
CREATE TABLE project_goals (
  project_id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  confirm_budget INTEGER NOT NULL DEFAULT 0,
  blocked TEXT,
  updated_at INTEGER NOT NULL
      );
`,
  },
  {
    id: 4,
    name: "model_provider_center",
    sql: `
CREATE TABLE model_profiles (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  price TEXT NOT NULL DEFAULT '{}',
  defaults TEXT NOT NULL DEFAULT '{}',
  limits TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);

CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  job_id TEXT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  latency_ms INTEGER,
  cost_yuan REAL NOT NULL DEFAULT 0,
  output_assets TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX generation_runs_project ON generation_runs(project_id, created_at DESC);
CREATE INDEX generation_runs_input ON generation_runs(input_hash);
    `,
  },
  {
    id: 5,
    name: "generation_run_ledger_link",
    sql: `
ALTER TABLE generation_runs ADD COLUMN ledger_id INTEGER;
CREATE INDEX generation_runs_ledger ON generation_runs(ledger_id);
    `,
  },
  {
    id: 6,
    name: "custom_model_providers",
    sql: `
CREATE TABLE custom_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  interface_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  key_hint TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE custom_provider_models (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id),
  FOREIGN KEY (provider_id) REFERENCES custom_providers(id) ON DELETE CASCADE
);
CREATE INDEX custom_provider_models_enabled ON custom_provider_models(enabled, kind);
`,
  },
  {
    id: 7,
    name: "project_versions",
    sql: `
CREATE TABLE project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  label TEXT NOT NULL,
  doc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX project_versions_project ON project_versions(project_id, created_at DESC);
`,
  },
  {
    id: 8,
    name: "memes",
    sql: `
CREATE TABLE memes (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  variants TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL,
  meaning TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  since TEXT NOT NULL DEFAULT '',
  heat TEXT NOT NULL,
  risk TEXT NOT NULL,
  say TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE meme_fetches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  dropped INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX meme_fetches_kind ON meme_fetches(kind, created_at DESC);
`,
  },
  {
    id: 9,
    name: "meme_circles_blocks",
    sql: `
ALTER TABLE memes ADD COLUMN circle TEXT NOT NULL DEFAULT '';
ALTER TABLE meme_fetches ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
CREATE TABLE meme_blocks (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  term TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    id: 10,
    name: "meme_trust",
    sql: `
ALTER TABLE memes ADD COLUMN trust TEXT NOT NULL DEFAULT 'unchecked';
ALTER TABLE memes ADD COLUMN since_month TEXT NOT NULL DEFAULT '';
ALTER TABLE meme_fetches ADD COLUMN unverified INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    id: 11,
    name: "voice_changes",
    sql: `
CREATE TABLE voice_changes (
  project_id TEXT PRIMARY KEY,
  voice TEXT NOT NULL,
  previous_voice TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
];
