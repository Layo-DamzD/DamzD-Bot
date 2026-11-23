import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadCommands, resolveCommandInput } from "../handlers/command-loader.js";

test("an empty command directory is a valid foundation state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-commands-"));
  try {
    const result = await loadCommands(directory);
    assert.equal(result.commands.length, 0);
    assert.equal(result.lookup.size, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a missing command directory returns an empty registry", async () => {
  const result = await loadCommands(path.join(os.tmpdir(), "fei-xmd-does-not-exist"));
  assert.equal(result.commands.length, 0);
});

test("command input resolves names, aliases and remaining arguments", () => {
  const command = { name: "group info", run() {} };
  const lookup = new Map([
    ["group info", command],
    ["gi", command]
  ]);

  assert.deepEqual(resolveCommandInput("GROUP INFO Abuja group", lookup), {
    commandName: "group info",
    args: "Abuja group",
    definition: command
  });
  assert.equal(resolveCommandInput("gi now", lookup).commandName, "gi");
  assert.equal(resolveCommandInput("unknown", lookup), null);
});
