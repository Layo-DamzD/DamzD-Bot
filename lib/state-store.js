import fs from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return structuredClone(value);
}

export function createJsonStateStore({ filePath, defaults = {} } = {}) {
  if (!filePath) throw new TypeError("A state file path is required.");

  const resolvedPath = path.resolve(String(filePath));
  const initialState = clone(defaults);
  let state = null;
  let writeQueue = Promise.resolve();

  async function load() {
    if (state !== null) return clone(state);

    try {
      const parsed = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
      state = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...clone(initialState), ...parsed }
        : clone(initialState);
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        console.warn("Could not read FEI XMD state file; starting with defaults.");
      }
      state = clone(initialState);
    }
    return clone(state);
  }

  async function persist() {
    if (state === null) return;
    const snapshot = JSON.stringify(state, null, 2);
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
      const temporaryPath = resolvedPath + ".tmp";
      await fs.writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, resolvedPath);
    });
    await writeQueue;
  }

  async function get(key) {
    await load();
    return clone(state[key]);
  }

  async function set(key, value) {
    if (typeof key !== "string" || !key.trim()) {
      throw new TypeError("A non-empty state key is required.");
    }
    await load();
    state[key] = clone(value);
    await persist();
    return clone(state[key]);
  }

  async function update(mutator) {
    if (typeof mutator !== "function") throw new TypeError("A state update function is required.");
    await load();
    const draft = clone(state);
    const result = await mutator(draft);
    state = draft;
    await persist();
    return result === undefined ? clone(state) : result;
  }

  return {
    load,
    get,
    set,
    update,
    save: persist,
    flush: () => writeQueue,
    filePath: resolvedPath
  };
}
