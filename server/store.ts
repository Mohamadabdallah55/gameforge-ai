import { blockedImageOrigin } from "./image-policy";
import type { Fingerprint, QualityRejection } from "../shared/quality";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Asset, Profile, Job, Question } from "../shared/contracts";

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
  if (a.length !== b.length) return 0;
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
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "forge.sqlite"));
    this.db.exec(`
 PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,meta TEXT NOT NULL,png BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,profile TEXT REFERENCES profiles(id),body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quality_references(job TEXT NOT NULL REFERENCES jobs(id), url TEXT NOT NULL, PRIMARY KEY(job,url));
 CREATE TABLE IF NOT EXISTS quality_research(job TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quality_fingerprints(question TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quality_accepted(job TEXT NOT NULL,fact TEXT NOT NULL,question TEXT NOT NULL,PRIMARY KEY(job,fact));
 CREATE TABLE IF NOT EXISTS quality_audit(id INTEGER PRIMARY KEY,job TEXT NOT NULL,fact TEXT NOT NULL,stage TEXT NOT NULL,body TEXT NOT NULL,consumed INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS quality_audit_job ON quality_audit(job,stage);
 CREATE TABLE IF NOT EXISTS search_cache(key TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS embedding_models(id TEXT PRIMARY KEY,model TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,profile TEXT REFERENCES profiles(id),norm TEXT NOT NULL,body TEXT NOT NULL,vector TEXT NOT NULL,UNIQUE(profile,norm));`);
    if (!this.profile("default"))
      this.saveProfile("default", {
        name: "لعبة المسابقات",
        rules: "",
        mapping: {},
      });
  }
  fingerprint(id: string): Fingerprint | undefined {
    const row = this.db
      .prepare("SELECT body FROM quality_fingerprints WHERE question=?")
      .get(id);
    return row && JSON.parse(String(row.body));
  }
  saveFingerprint(id: string, fp: Fingerprint) {
    this.db
      .prepare("INSERT OR REPLACE INTO quality_fingerprints VALUES(?,?)")
      .run(id, JSON.stringify(fp));
  }
  references(id: string) {
    return this.db
      .prepare(
        "SELECT url FROM quality_references WHERE job=? ORDER BY rowid LIMIT 4",
      )
      .all(id)
      .map((row) => String(row.url));
  }
  addReference(id: string, value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw Error("يلزم رابط HTTPS عام للمصدر");
    url.hash = "";
    this.db
      .prepare("INSERT OR IGNORE INTO quality_references(job,url) VALUES(?,?)")
      .run(id, url.href);
  }
  researchState<T>(id: string): T | undefined {
    const row = this.db
      .prepare("SELECT body FROM quality_research WHERE job=?")
      .get(id);
    return row && JSON.parse(String(row.body));
  }
  saveResearchState(id: string, body: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO quality_research VALUES(?,?)")
      .run(id, JSON.stringify(body));
  }
  audit(id: string, fact: string, value: QualityRejection, consume = true) {
    this.db
      .prepare(
        "INSERT INTO quality_audit(job,fact,stage,body,consumed) VALUES(?,?,?,?,?)",
      )
      .run(id, fact, value.stage, JSON.stringify(value), Number(consume));
  }
  usedFacts(id: string) {
    return new Set(
      this.db
        .prepare(
          "SELECT fact FROM quality_accepted WHERE job=? UNION SELECT fact FROM quality_audit WHERE job=? AND consumed=1",
        )
        .all(id, id)
        .map((row) => String(row.fact)),
    );
  }
  acceptFact(id: string, fact: string, question: string) {
    this.db
      .prepare("INSERT INTO quality_accepted VALUES(?,?,?)")
      .run(id, fact, question);
  }
  acceptedQuestions(id: string) {
    return this.db
      .prepare(
        "SELECT q.body FROM quality_accepted a JOIN questions q ON q.id=a.question WHERE a.job=?",
      )
      .all(id)
      .map((row) => JSON.parse(String(row.body)) as Question);
  }
  qualityReport(id: string) {
    const questions = this.acceptedQuestions(id);
    const stages = this.db
      .prepare(
        "SELECT stage,COUNT(*) AS count FROM quality_audit WHERE job=? GROUP BY stage",
      )
      .all(id);
    const counts = Object.fromEntries(
      stages.map((row) => [String(row.stage), Number(row.count)]),
    );
    const rejected = Object.entries(counts).reduce(
      (sum, [stage, count]) => sum + (stage === "image" ? 0 : count),
      0,
    );
    const distribution = (values: string[]) => {
      const counts: Record<string, number> = Object.create(null);
      for (const value of values) counts[value] = (counts[value] || 0) + 1;
      return counts;
    };
    return {
      accepted: questions.length,
      rejected,
      retries: this.job(id)?.qualityRetries || 0,
      intellectualRepeatRate:
        rejected + questions.length
          ? (counts.intellectual || 0) / (rejected + questions.length)
          : 0,
      rejectedByStage: counts,
      difficulty: distribution(questions.map((q) => q.difficulty)),
      types: distribution(
        questions.map((q) => q.quality?.fingerprint.type || "unknown"),
      ),
      facets: distribution(questions.map((q) => q.quality?.facet || "unknown")),
      sources: distribution(
        questions.map((q) => q.quality?.sourceLabel || "unknown"),
      ),
      reasons: this.db
        .prepare(
          "SELECT body FROM quality_audit WHERE job=? ORDER BY id DESC LIMIT 60",
        )
        .all(id)
        .map((row) => JSON.parse(String(row.body)) as QualityRejection),
    };
  }
  profile(id: string): Profile | undefined {
    const row = this.db.prepare("SELECT body FROM profiles WHERE id=?").get(id);
    return row && JSON.parse(String(row.body));
  }
  profiles() {
    return this.db
      .prepare("SELECT * FROM profiles")
      .all()
      .map((r) => ({ id: r.id, ...JSON.parse(String(r.body)) }));
  }
  saveProfile(id: string, p: Profile) {
    this.db
      .prepare(
        "INSERT INTO profiles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(id, JSON.stringify(p));
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
  async reindex(
    profile: string,
    model: string,
    embed: (s: string) => Promise<number[]>,
  ) {
    const rows = this.db
      .prepare(
        "SELECT q.id,q.body FROM questions q LEFT JOIN embedding_models m ON q.id=m.id WHERE profile=? AND (m.model IS NULL OR m.model<>?)",
      )
      .all(profile, model);
    for (const row of rows) {
      const vector = await embed(JSON.parse(String(row.body)).question);
      this.transaction(() => {
        this.db
          .prepare("UPDATE questions SET vector=? WHERE id=?")
          .run(JSON.stringify(vector), row.id);
        this.db
          .prepare("INSERT OR REPLACE INTO embedding_models VALUES(?,?)")
          .run(row.id, model);
      });
    }
  }
  question(id: string, profile: string): Question | undefined {
    const row = this.db
      .prepare("SELECT body FROM questions WHERE id=? AND profile=?")
      .get(id, profile);
    return row && JSON.parse(String(row.body));
  }
  setQuestionImage(q: Question, image: string) {
    this.db
      .prepare("UPDATE questions SET body=? WHERE id=? AND profile=?")
      .run(JSON.stringify({ ...q, image }), q.id, q.profileId);
  }
  recentQuestions(profile: string) {
    return this.db
      .prepare(
        "SELECT body FROM questions WHERE profile=? ORDER BY rowid DESC LIMIT 25",
      )
      .all(profile)
      .map((row) => String(JSON.parse(String(row.body)).question));
  }
  duplicateIndex(profile: string) {
    const names = new Set<string>();
    const vectors: Float32Array[] = [];
    const unit = (values: number[]) => {
      const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;
      return Float32Array.from(values, (v) => v / norm);
    };
    for (const row of this.db
      .prepare("SELECT norm,vector FROM questions WHERE profile=?")
      .iterate(profile)) {
      names.add(String(row.norm));
      vectors.push(unit(JSON.parse(String(row.vector))));
    }
    return {
      has(text: string, values: number[]) {
        if (names.has(normalize(text))) return true;
        const next = unit(values);
        return vectors.some((v) => {
          if (v.length !== next.length) return false;
          let dot = 0;
          for (let i = 0; i < v.length; i++) dot += v[i] * next[i];
          return dot >= 0.92;
        });
      },
      add(text: string, values: number[]) {
        names.add(normalize(text));
        vectors.push(unit(values));
      },
    };
  }
  duplicate(profile: string, text: string, v: number[]) {
    return this.db
      .prepare("SELECT norm,vector FROM questions WHERE profile=?")
      .all(profile)
      .some(
        (r) =>
          r.norm === normalize(text) ||
          cosine(v, JSON.parse(String(r.vector))) >= 0.92,
      );
  }
  add(q: Question, v: number[], model?: string) {
    this.db
      .prepare("INSERT INTO questions VALUES(?,?,?,?,?)")
      .run(
        q.id,
        q.profileId,
        normalize(q.question),
        JSON.stringify(q),
        JSON.stringify(v),
      );
    if (model)
      this.db
        .prepare("INSERT INTO embedding_models VALUES(?,?)")
        .run(q.id, model);
  }
  assets(): Asset[] {
    return this.db
      .prepare("SELECT meta FROM assets")
      .all()
      .map((r) => JSON.parse(String(r.meta)));
  }
  canUseAsset(id: string) {
    const row = this.db.prepare("SELECT meta FROM assets WHERE id=?").get(id);
    if (!row) return false;
    const asset = JSON.parse(String(row.meta)) as Asset;
    return !blockedImageOrigin(asset.origin, asset.credit);
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
  updateQuestion(
    id: string,
    profileId: string,
    next: Question,
    vector?: number[],
    model?: string,
  ) {
    const existing = this.question(id, profileId);
    if (!existing) throw Error("السؤال غير موجود");
    const nextNorm = normalize(next.question);
    const conflict = this.db
      .prepare("SELECT id FROM questions WHERE profile=? AND norm=? AND id<>?")
      .get(profileId, nextNorm, id);
    if (conflict) throw Error("يوجد سؤال مطابق بالفعل في هذا الملف.");
    this.transaction(() => {
      if (vector) {
        this.db
          .prepare(
            "UPDATE questions SET norm=?, body=?, vector=? WHERE id=? AND profile=?",
          )
          .run(nextNorm, JSON.stringify(next), JSON.stringify(vector), id, profileId);
        if (model) {
          this.db
            .prepare("INSERT OR REPLACE INTO embedding_models VALUES(?,?)")
            .run(id, model);
        }
      } else {
        this.db
          .prepare("UPDATE questions SET norm=?, body=? WHERE id=? AND profile=?")
          .run(nextNorm, JSON.stringify(next), id, profileId);
      }
    });
    return next;
  }
  deleteQuestion(id: string, profileId: string) {
    const existing = this.question(id, profileId);
    if (!existing) return false;
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM quality_accepted WHERE question=?")
        .run(id);
      this.db
        .prepare("DELETE FROM quality_fingerprints WHERE question=?")
        .run(id);
      this.db.prepare("DELETE FROM embedding_models WHERE id=?").run(id);
      this.db
        .prepare("DELETE FROM questions WHERE id=? AND profile=?")
        .run(id, profileId);
    });
    return true;
  }
  bulkDeleteQuestions(ids: string[], profileId: string) {
    let removed = 0;
    this.transaction(() => {
      for (const id of ids) {
        const res = this.db
          .prepare("DELETE FROM questions WHERE id=? AND profile=?")
          .run(id, profileId);
        if (res.changes) {
          removed++;
          this.db
            .prepare("DELETE FROM quality_accepted WHERE question=?")
            .run(id);
          this.db
            .prepare("DELETE FROM quality_fingerprints WHERE question=?")
            .run(id);
          this.db.prepare("DELETE FROM embedding_models WHERE id=?").run(id);
        }
      }
    });
    return removed;
  }
  profileAudits(profileId: string, limit = 120) {
    const rows = this.db
      .prepare(
        "SELECT a.id, a.job, a.stage, a.body FROM quality_audit a JOIN jobs j ON j.id=a.job WHERE j.profile=? ORDER BY a.id DESC LIMIT ?",
      )
      .all(profileId, limit);
    return rows.map((r) => {
      const parsed = JSON.parse(String(r.body)) as QualityRejection;
      return {
        ...parsed,
        id: Number(r.id),
        jobId: String(r.job),
        stage: parsed.stage || String(r.stage),
      };
    });
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

export type QualityReport = ReturnType<Store["qualityReport"]>;
