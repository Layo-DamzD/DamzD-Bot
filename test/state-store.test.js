import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createJsonStateStore } from "../lib/state-store.js";

test("loads defaults and persists state atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-state-"));
  const filePath = path.join(directory, "nested", "state.json");
  try {
    const store = createJsonStateStore({
      filePath,
      defaults: { prefix: ".", mode: "public" }
    });

    assert.deepEqual(await store.load(), { prefix: ".", mode: "public" });
    await store.set("prefix", "!");
    await store.update(draft => {
      draft.mode = "private";
    });
    await store.flush();

    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(saved, { prefix: "!", mode: "private" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects invalid updates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-state-"));
  try {
    const store = createJsonStateStore({
      filePath: path.join(directory, "state.json"),
      defaults: {}
    });
    await assert.rejects(() => store.update(null), /update function is required/);
    await assert.rejects(() => store.set("", true), /state key is required/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
