import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * 数据库迁移，按顺序执行，执行过的记录在 schema_migrations。
 * 只追加，不修改已发布的迁移。
 */
export const migrations: { id: number; name: string; sql: string; apply?: (db: DatabaseSync) => void }[] = [
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
  {
    id: 12,
    name: "job_lock_tokens",
    sql: `
ALTER TABLE jobs ADD COLUMN lock_token TEXT;
CREATE INDEX jobs_lock_token ON jobs(id, lock_token);
    `,
  },
  {
    id: 13,
    name: "tts_takes_and_started_at",
    sql: `
-- 重录归档：同 key 覆盖前把旧的配音结果存一份，让重录可以撤销
CREATE TABLE IF NOT EXISTS tts_takes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  result TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_tts_takes_key ON tts_takes(project_id, cache_key, archived_at DESC);
    `,
    // SQLite 没有通用的 ALTER TABLE ... ADD COLUMN IF NOT EXISTS。已有安装
    // 可能被手工补过 started_at，因此先 introspect 再添加，迁移可安全重放。
    apply: (db) => {
      db.exec(`
CREATE TABLE IF NOT EXISTS tts_takes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  result TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_tts_takes_key ON tts_takes(project_id, cache_key, archived_at DESC);
      `);
      const columns = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
      if (!columns.some((column) => column.name === "started_at")) db.exec("ALTER TABLE jobs ADD COLUMN started_at INTEGER");
    },
  },
  {
    id: 14,
    name: "render_content_animation_hashes",
    sql: "",
    apply: (db) => {
      const columns = db.prepare("PRAGMA table_info(renders)").all() as { name: string }[];
      if (!columns.some((column) => column.name === "content_hash")) db.exec("ALTER TABLE renders ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''");
      if (!columns.some((column) => column.name === "animation_hash")) db.exec("ALTER TABLE renders ADD COLUMN animation_hash TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE renders SET content_hash = timeline_hash WHERE content_hash = ''");
    },
  },
  {
    id: 15,
    name: "production_presets",
    sql: `
CREATE TABLE IF NOT EXISTS production_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    id: 16,
    name: "music_library_rights",
    sql: "",
    // 可审计曲库字段：授权、来源、哈希、节奏与质检信息。逐列 introspect 后添加，
    // 迁移可安全重放（已有安装可能被手工补过部分列）。
    apply: (db) => {
      const columns = db.prepare("PRAGMA table_info(music_tracks)").all() as { name: string }[];
      const ensure = (name: string, ddl: string) => {
        if (!columns.some((c) => c.name === name)) db.exec(`ALTER TABLE music_tracks ADD COLUMN ${ddl}`);
      };
      ensure("author", "author TEXT NOT NULL DEFAULT ''");
      ensure("license_url", "license_url TEXT NOT NULL DEFAULT ''");
      ensure("source_page", "source_page TEXT NOT NULL DEFAULT ''");
      ensure("download_url", "download_url TEXT NOT NULL DEFAULT ''");
      ensure("attribution", "attribution TEXT NOT NULL DEFAULT ''");
      ensure("commercial_use", "commercial_use INTEGER");
      ensure("rights_status", "rights_status TEXT NOT NULL DEFAULT 'pending'");
      ensure("rights_checked_at", "rights_checked_at TEXT NOT NULL DEFAULT ''");
      ensure("sha256", "sha256 TEXT NOT NULL DEFAULT ''");
      ensure("normalized_sha256", "normalized_sha256 TEXT NOT NULL DEFAULT ''");
      ensure("bpm", "bpm REAL");
      ensure("energy", "energy TEXT");
      ensure("instrumental", "instrumental INTEGER");
      ensure("tags", "tags TEXT NOT NULL DEFAULT '[]'");
      ensure("disabled_reason", "disabled_reason TEXT NOT NULL DEFAULT ''");
      ensure("evidence", "evidence TEXT NOT NULL DEFAULT '{}'");
      db.exec("CREATE INDEX IF NOT EXISTS music_tracks_rights ON music_tracks(rights_status, disabled_reason)");
      db.exec("CREATE INDEX IF NOT EXISTS music_tracks_sha ON music_tracks(sha256)");
      db.exec("CREATE INDEX IF NOT EXISTS music_tracks_normalized ON music_tracks(normalized_sha256)");
      // 旧数据没有授权证据，统一保守标记为待核实，避免继续作为已核实曲目参与生产选曲。
      db.exec("UPDATE music_tracks SET rights_status = 'pending' WHERE rights_status = '' OR rights_status IS NULL");
    },
  },
  {
    id: 17,
    name: "grounded_expression_categories",
    sql: "",
    apply: (db) => {
      const columns = db.prepare("PRAGMA table_info(memes)").all() as { name: string }[];
      if (!columns.some((column) => column.name === "category")) db.exec("ALTER TABLE memes ADD COLUMN category TEXT NOT NULL DEFAULT 'hot'");

      const insert = db.prepare(`
        INSERT OR IGNORE INTO memes (id, term, variants, kind, meaning, usage, example, tone, platform, since, heat, risk, say, circle, trust, since_month, source, verified_at, created_at, updated_at, category)
        VALUES (?, ?, '[]', 'word', ?, ?, ?, ?, '用户词库', '', 'peak', 'safe', '', '生活日常', 'verified', '', 'import', ?, ?, ?, ?)
      `);
      const now = Date.now();
      const seeds: [string, string, string, string, string][] = [
        ["打工人", "daily", "以普通上班族的身份自称，带一点自嘲。", "适合聊工作和城市生活，不用于贬低观众。", "对很多打工人来说，通勤本身就够耗一天了。"],
        ["牛马", "daily", "对忙碌打工状态的自嘲说法。", "只对自己或工作状态自嘲，避免拿来称呼观众。", "活还没干完，牛马先得喘口气。"],
        ["社畜", "daily", "形容工作忙、被工作牵着走的状态。", "适合自嘲，不把它当成对人的标签。", "忙到最后，社畜连晚饭都顾不上。"],
        ["摆烂", "daily", "暂时不再硬撑或投入，常带无奈和自嘲。", "用于描述选择或状态，不鼓励放弃必要责任。", "今天先不跟自己较劲，别把摆烂说成解决方案。"],
        ["躺平", "daily", "降低竞争和消耗，选择少折腾一点。", "适合讨论生活选择，不替别人下结论。", "有人想躺平，可能只是想把日子过慢一点。"],
        ["内卷", "daily", "投入越来越多，结果却没有相应改善的竞争状态。", "用于描述现象，尽量说明具体场景。", "大家都在加班，最后只是把下班时间卷没了。"],
        ["房租刺客", "daily", "对房租支出突然带来压力的调侃说法。", "接具体生活开销时使用。", "工资刚到账，房租刺客已经在门口等着了。"],
        ["通勤地狱", "daily", "形容通勤耗时、拥挤或折腾。", "只用于确有长通勤的情境。", "每天两小时的通勤，确实有点通勤地狱。"],
        ["钱包在流血", "daily", "夸张表达花钱带来的心疼。", "只用于轻松的消费吐槽。", "搬一次家，感觉钱包又在流血。"],
        ["电量见底", "daily", "形容精力快耗尽。", "适合疲惫、忙碌后的口语表达。", "开完一整天的会，人已经电量见底。"],
        ["精神内耗", "daily", "反复纠结、消耗精力的状态。", "适合描述感受，不用于替他人诊断。", "事情还没开始，先在脑子里内耗了半天。"],
        ["我去", "emotion", "表达惊讶或意外，语气较轻。", "放在确有意外的反应处，少量使用。", "我去，最后一个细节居然把前面的事都串起来了。"],
        ["天塌了", "emotion", "夸张表达突发打击或计划落空。", "用于轻松语境，不弱化真实灾难或伤痛。", "临出门发现钥匙没带，天塌了。"],
        ["离谱", "emotion", "表达不合理、出乎意料或让人无语。", "最好紧跟具体原因，避免空泛重复。", "更离谱的是，改完之后问题还在。"],
        ["绷不住了", "emotion", "表达忍不住笑、无奈或情绪失守。", "明确情绪来源，不要每段都用。", "看到这个结果，我是真有点绷不住了。"],
        ["真的服了", "emotion", "表达无奈或被某件事弄得没脾气。", "对事不对人，避免攻击具体群体。", "来回改了三次，最后发现是开关没打开，真的服了。"],
        ["人麻了", "emotion", "表达一时无奈、疲惫或反应不过来。", "用于轻微生活挫折，不描述严重身心状况。", "看到这张账单，我人都麻了。"],
        ["气笑了", "emotion", "表达无奈到发笑。", "用于轻松吐槽，后面接清楚事情本身。", "这个安排把所有人时间都撞上了，真是气笑了。"],
        ["说白了", "rhythm", "引出更直白的解释或观点。", "只在确实需要换成直白说法时使用。", "说白了，问题就是时间不够。"],
        ["讲真", "rhythm", "引出个人判断或坦率表达。", "适合观点转折，不要句句起手都用。", "讲真，这个方案看着省事，后面反而更费劲。"],
        ["你想啊", "rhythm", "邀请听众跟着看一个推理或生活场景。", "后面紧接具体推理，不单独填充句子。", "你想啊，早上少睡半小时，整天都得补回来。"],
        ["但是吧", "rhythm", "引出让步或实际情况。", "后面补充真实的转折，不用来凑口语感。", "但是吧，搬走也不代表所有问题都解决了。"],
        ["最离谱的是", "rhythm", "引出一个更出乎意料的细节。", "后面必须有具体事实或场景。", "最离谱的是，折腾半天还得回到原点。"],
        ["更要命的是", "rhythm", "引出让问题变得更难的因素。", "用于轻松或评论语境，避免消费真实伤痛。", "更要命的是，第二天还得照常早起。"],
        ["反正吧", "rhythm", "收束一段不确定或个人化的表达。", "只有确实在总结个人判断时使用。", "反正吧，这笔账最后还是得自己算清楚。"],
        ["怎么说呢", "rhythm", "引出需要斟酌的个人感受或判断。", "后面尽快说具体内容，避免空转。", "怎么说呢，轻松了一点，但也没到彻底放心。"],
      ];
      for (const [term, category, meaning, usage, example] of seeds) insert.run(randomUUID(), term, meaning, usage, example, "", now, now, now, category);
    },
  },
  {
    id: 18,
    name: "render_output_version",
    sql: "",
    apply: (db) => {
      const columns = db.prepare("PRAGMA table_info(renders)").all() as { name: string }[];
      if (!columns.some((column) => column.name === "output_version")) db.exec("ALTER TABLE renders ADD COLUMN output_version INTEGER NOT NULL DEFAULT 0");
    },
  },
];
