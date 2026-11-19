import { DatabaseSync } from "node:sqlite";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Asset,
  AssistantActionLog,
  AssistantMessage,
  Job,
  Profile,
  Question,
} from "../shared/contracts";

export const uid = randomUUID;

export function normalize(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670ـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    x += a[i] ** 2;
    y += b[i] ** 2;
  }
  return dot / (Math.sqrt(x * y) || 1);
}

export class Store {
  db: DatabaseSync;
  dbPath: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.dbPath = path.join(dir, "forge.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, meta TEXT NOT NULL, png BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, profile TEXT REFERENCES profiles(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, profile TEXT REFERENCES profiles(id), norm TEXT NOT NULL, body TEXT NOT NULL, vector TEXT NOT NULL, UNIQUE(profile, norm));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS image_cache(url TEXT PRIMARY KEY, asset_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_messages(id TEXT PRIMARY KEY, profile TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, actions TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    if (!this.profile("default")) {
      this.saveProfile("default", {
        name: "لعبة المسابقات",
        rules: "",
        mapping: {},
      });
    }
  }

  profile(id: string): Profile | undefined {
    const row = this.db.prepare("SELECT body FROM profiles WHERE id=?").get(id);
    return row && JSON.parse(String(row.body));
  }

  profiles(): (Profile & { id: string })[] {
    return this.db
      .prepare("SELECT * FROM profiles")
      .all()
      .map((r) => ({ id: String(r.id), ...JSON.parse(String(r.body)) }));
  }

  saveProfile(id: string, p: Profile) {
    this.db
      .prepare(
        "INSERT INTO profiles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(id, JSON.stringify(p));
  }

  deleteProfile(id: string) {
    if (id === "default") throw new Error("لا يمكن حذف ملف اللعبة الافتراضي");
    this.transaction(() => {
      this.db.prepare("DELETE FROM questions WHERE profile=?").run(id);
      this.db.prepare("DELETE FROM jobs WHERE profile=?").run(id);
      this.db.prepare("DELETE FROM assistant_messages WHERE profile=?").run(id);
      this.db.prepare("DELETE FROM profiles WHERE id=?").run(id);
    });
  }

  job(id: string): Job | undefined {
    const row = this.db.prepare("SELECT body FROM jobs WHERE id=?").get(id);
    return row && JSON.parse(String(row.body));
  }

  jobs(): Job[] {
    return this.db
      .prepare("SELECT body FROM jobs ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }

  saveJob(j: Job) {
    this.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(j.id, j.profileId, JSON.stringify(j));
  }

  questions(id: string): Question[] {
    return this.db
      .prepare("SELECT body FROM questions WHERE profile=? ORDER BY rowid")
      .all(id)
      .map((r) => JSON.parse(String(r.body)));
  }

  question(profileId: string, questionId: string): Question | undefined {
    const row = this.db
      .prepare("SELECT body FROM questions WHERE id=? AND profile=?")
      .get(questionId, profileId);
    return row && JSON.parse(String(row.body));
  }

  questionsWithVectors(
    profileId: string,
  ): { question: Question; norm: string; vector: number[] }[] {
    return this.db
      .prepare("SELECT norm, body, vector FROM questions WHERE profile=? ORDER BY rowid")
      .all(profileId)
      .map((r) => ({
        question: JSON.parse(String(r.body)) as Question,
        norm: String(r.norm),
        vector: JSON.parse(String(r.vector)) as number[],
      }));
  }

  duplicate(profile: string, text: string, v: number[], excludeId?: string) {
    const targetNorm = normalize(text);
    return this.db
      .prepare("SELECT id, norm, vector FROM questions WHERE profile=?")
      .all(profile)
      .some((r) => {
        if (excludeId && String(r.id) === excludeId) return false;
        if (r.norm === targetNorm) return true;
        const stored = JSON.parse(String(r.vector)) as number[];
        return stored.length === v.length && cosine(v, stored) >= 0.92;
      });
  }

  add(q: Question, v: number[]) {
    this.db
      .prepare("INSERT INTO questions VALUES(?,?,?,?,?)")
      .run(
        q.id,
        q.profileId,
        normalize(q.question),
        JSON.stringify(q),
        JSON.stringify(v),
      );
  }

  updateQuestion(profileId: string, q: Question, vector?: number[]) {
    const norm = normalize(q.question);
    const conflict = this.db
      .prepare("SELECT id FROM questions WHERE profile=? AND norm=? AND id!=?")
      .get(profileId, norm, q.id);
    if (conflict) throw new Error("يوجد سؤال مطابق في نفس الملف");
    if (vector) {
      this.db
        .prepare(
          "UPDATE questions SET norm=?, body=?, vector=? WHERE id=? AND profile=?",
        )
        .run(norm, JSON.stringify(q), JSON.stringify(vector), q.id, profileId);
    } else {
      this.db
        .prepare("UPDATE questions SET norm=?, body=? WHERE id=? AND profile=?")
        .run(norm, JSON.stringify(q), q.id, profileId);
    }
  }

  updateQuestionVector(profileId: string, questionId: string, vector: number[]) {
    this.db
      .prepare("UPDATE questions SET vector=? WHERE id=? AND profile=?")
      .run(JSON.stringify(vector), questionId, profileId);
  }

  deleteQuestion(profileId: string, questionId: string) {
    return (
      this.db
        .prepare("DELETE FROM questions WHERE id=? AND profile=?")
        .run(questionId, profileId).changes > 0
    );
  }

  assets(): Asset[] {
    return this.db
      .prepare("SELECT meta FROM assets ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r.meta)));
  }

  assetMeta(id: string): Asset | undefined {
    const r = this.db.prepare("SELECT meta FROM assets WHERE id=?").get(id);
    return r && JSON.parse(String(r.meta));
  }

  asset(id: string) {
    const r = this.db.prepare("SELECT png FROM assets WHERE id=?").get(id);
    return r && Buffer.from(r.png as Uint8Array);
  }

  putAsset(meta: Asset, png: Buffer) {
    this.db
      .prepare("INSERT INTO assets VALUES(?,?,?)")
      .run(meta.id, JSON.stringify(meta), png);
  }

  getCachedAssetByUrl(url: string): Asset | undefined {
    const row = this.db
      .prepare("SELECT asset_id FROM image_cache WHERE url=?")
      .get(url);
    if (!row) return undefined;
    const meta = this.assetMeta(String(row.asset_id));
    return meta;
  }

  cacheAssetUrl(url: string, assetId: string) {
    this.db
      .prepare(
        "INSERT INTO image_cache VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET asset_id=excluded.asset_id, created_at=excluded.created_at",
      )
      .run(url, assetId, new Date().toISOString());
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? String(row.value) : undefined;
  }

  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }

  assistantHistory(profileId: string): AssistantMessage[] {
    return this.db
      .prepare(
        "SELECT id, profile, role, content, actions, created_at FROM assistant_messages WHERE profile=? ORDER BY rowid ASC LIMIT 60",
      )
      .all(profileId)
      .map((r) => ({
        id: String(r.id),
        profileId: String(r.profile),
        role: String(r.role) as "user" | "assistant",
        content: String(r.content),
        actions: JSON.parse(String(r.actions)) as AssistantActionLog[],
        createdAt: String(r.created_at),
      }));
  }

  addAssistantMessage(
    profileId: string,
    role: "user" | "assistant",
    content: string,
    actions: AssistantActionLog[] = [],
  ): AssistantMessage {
    const msg: AssistantMessage = {
      id: uid(),
      profileId,
      role,
      content,
      actions,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?)")
      .run(
        msg.id,
        profileId,
        role,
        content,
        JSON.stringify(actions),
        msg.createdAt,
      );
    return msg;
  }

  clearAssistantHistory(profileId: string) {
    this.db
      .prepare("DELETE FROM assistant_messages WHERE profile=?")
      .run(profileId);
  }

  healthCheck() {
    const check = this.db.prepare("PRAGMA quick_check").get() as
      | Record<string, unknown>
      | undefined;
    const integrity = check ? Object.values(check)[0] === "ok" : false;
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(this.dbPath).size;
    } catch {
      sizeBytes = 0;
    }
    const counts = {
      profiles: Number(
        (this.db.prepare("SELECT COUNT(*) as c FROM profiles").get() as any)?.c ?? 0,
      ),
      questions: Number(
        (this.db.prepare("SELECT COUNT(*) as c FROM questions").get() as any)?.c ?? 0,
      ),
      assets: Number(
        (this.db.prepare("SELECT COUNT(*) as c FROM assets").get() as any)?.c ?? 0,
      ),
      jobs: Number(
        (this.db.prepare("SELECT COUNT(*) as c FROM jobs").get() as any)?.c ?? 0,
      ),
    };
    return {
      integrity,
      sizeBytes,
      embedModel: this.getMeta("embed_model") || null,
      counts,
    };
  }

  transaction(fn: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
