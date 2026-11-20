import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store";
import { planSchema, slots } from "../shared/contracts";

test("reindex resumes after failure and preserves the saved questions", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-index-"));
  const db = new Store(dir);
  try {
    for (const id of ["a", "b"])
      db.add(
        {
          id,
          profileId: "default",
          question: "سؤال " + id,
          answer: id,
          difficulty: "easy",
          source: "https://example.org",
          quote: "source",
          image: null,
        },
        [1, 0],
      );
    const before = db.questions("default");
    await assert.rejects(
      db.reindex("default", "new", async (q) => {
        if (q.endsWith("b")) throw Error("interrupted");
        return [0, 1, 0];
      }),
    );
    const calls: string[] = [];
    await db.reindex("default", "new", async (q) => {
      calls.push(q);
      return [0, 1, 0];
    });
    assert.deepEqual(calls, ["سؤال b"]);
    assert.deepEqual(db.questions("default"), before);
    assert.equal(db.duplicate("default", "سؤال مختلف", [0, 1, 0]), true);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("thousand-item plans preserve image percentage and explicit no-image mode", () => {
  const plan = planSchema.parse({
    topic: "World Cup",
    easy: 1000,
    medium: 2000,
    hard: 3000,
    imagePercent: 33,
  });
  assert.equal(slots(plan).length, 6000);
  assert.equal(slots(plan).filter((slot) => slot.image).length, 1980);
  assert.equal(
    slots({ ...plan, imageMode: "none" }).some((slot) => slot.image),
    false,
  );
});
