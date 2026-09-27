import path from "path";
import { mkdirSync } from "fs";
import "./quiet-sqlite";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { migrations } from "./migrations";

/**
 * SQLite 访问入口（node:sqlite）。web 与 worker 两个进程共用一个文件，WAL 模式下可并发读写。
 * 所有数据库调用都经过这里，将来需要可替换为 better-sqlite3。
 */

export type Db = DatabaseSync;
export type Param = SQLInputValue;

export function dataDir() {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
}

export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const done = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id));
  const pending = migrations.filter((m) => !done.has(m.id));
  if (pending.length === 0) return;
  transaction(db, () => {
    // 事务内再查一次，防止另一个进程已经执行
    const again = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id));
    for (const m of pending) {
      if (again.has(m.id)) continue;
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, Date.now());
    }
  });
}

const g = globalThis as unknown as { __doVedioDb?: { file: string; db: Db; migrations: number } };

/** 进程内单例；开发模式热更新时复用同一个连接，新增了迁移就补跑 */
export function db(): Db {
  const file = path.join(dataDir(), "app.db");
  if (g.__doVedioDb?.file !== file) {
    g.__doVedioDb?.db.close();
    g.__doVedioDb = { file, db: openDb(file), migrations: migrations.length };
  } else if (g.__doVedioDb.migrations !== migrations.length) {
    migrate(g.__doVedioDb.db);
    g.__doVedioDb.migrations = migrations.length;
  }
  return g.__doVedioDb.db;
}

/** 关闭当前连接（测试用） */
export function closeDb() {
  g.__doVedioDb?.db.close();
  g.__doVedioDb = undefined;
}

/** 写事务：BEGIN IMMEDIATE 立即拿写锁，避免两个进程读后写冲突 */
export function transaction<T>(d: Db, fn: () => T): T {
  d.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  return transaction(db(), fn);
}

export const json = (v: unknown) => JSON.stringify(v ?? null);
export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
