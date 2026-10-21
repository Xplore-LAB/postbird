import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getCollection, scanCollection, updateCollection } from "../lib/collection.js";

async function temporaryStore(t) {
  const storeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "postbird-collection-"));
  t.after(() => fsp.rm(storeDir, { recursive: true, force: true }));
  return storeDir;
}

function scan(storeDir, collectionId, title = collectionId) {
  return scanCollection({
    storeDir, collectionId, title, messages: [],
    participants: [{ name: "Synthetic participant", email: "synthetic@example.com" }]
  });
}

test("valid collection IDs keep separate ledgers and preserve manual corrections", async (t) => {
  const storeDir = await temporaryStore(t);
  await scan(storeDir, "project-a", "First ledger");
  await scan(storeDir, "project_a", "Second ledger");
  await updateCollection({
    storeDir, collectionId: "project-a", participantEmail: "synthetic@example.com",
    status: "exempt", note: "Reviewed locally"
  });
  const first = await getCollection({ storeDir, collectionId: "project-a" });
  const second = await getCollection({ storeDir, collectionId: "project_a" });
  assert.equal(first.title, "First ledger");
  assert.equal(first.participants[0].status, "exempt");
  assert.equal(first.participants[0].note, "Reviewed locally");
  assert.equal(second.title, "Second ledger");
  assert.equal(second.participants[0].status, "pending");
});

test("unsafe IDs cannot alias an existing ledger during scan, read, or update", async (t) => {
  const storeDir = await temporaryStore(t);
  await scan(storeDir, "project_a", "Original ledger");
  const file = path.join(storeDir, "project_a.json");
  const original = await fsp.readFile(file, "utf8");
  for (const collectionId of ["project:a", "project/a", "project\\a", "", "@@@", "奖学金"]) {
    await assert.rejects(scan(storeDir, collectionId, "Other ledger"), /collectionId must be 1-80/);
    await assert.rejects(getCollection({ storeDir, collectionId }), /collectionId must be 1-80/);
    await assert.rejects(updateCollection({
      storeDir, collectionId, participantEmail: "synthetic@example.com", status: "complete"
    }), /collectionId must be 1-80/);
  }
  assert.equal(await fsp.readFile(file, "utf8"), original);
  assert.deepEqual(await fsp.readdir(storeDir), ["project_a.json"]);
});

test("overlong IDs are rejected instead of truncating onto an existing ledger", async (t) => {
  const storeDir = await temporaryStore(t);
  const collectionId = "a".repeat(80);
  await scan(storeDir, collectionId, "Original ledger");
  const file = path.join(storeDir, `${collectionId}.json`);
  const original = await fsp.readFile(file, "utf8");
  await assert.rejects(scan(storeDir, `${collectionId}b`, "Other ledger"), /collectionId must be 1-80/);
  assert.equal(await fsp.readFile(file, "utf8"), original);
  assert.equal((await getCollection({ storeDir, collectionId })).title, "Original ledger");
});
