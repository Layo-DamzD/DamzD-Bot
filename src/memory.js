import fs from "node:fs";
import path from "node:path";

const MAX_TURNS = 16;

export class ChatMemory {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "memory.json");
    this.chats = new Map();
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        for (const [key, value] of Object.entries(parsed || {})) {
          if (Array.isArray(value)) this.chats.set(key, value);
        }
      }
    } catch {
      this.chats = new Map();
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 1500);
  }

  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const object = Object.fromEntries(this.chats.entries());
      fs.writeFileSync(this.filePath, JSON.stringify(object, null, 1));
    } catch {
      /* keep running even if disk write fails */
    }
  }

  history(jid) {
    return this.chats.get(jid) || [];
  }

  remember(jid, role, content) {
    const text = String(content || "").trim();
    if (!jid || !text) return;
    const list = this.chats.get(jid) || [];
    list.push({ role, content: text.slice(0, 1500), at: Date.now() });
    while (list.length > MAX_TURNS) list.shift();
    this.chats.set(jid, list);
    this.scheduleSave();
  }

  forget(jid) {
    this.chats.delete(jid);
    this.saveNow();
  }

  forgetAll() {
    this.chats.clear();
    this.saveNow();
  }

  knownChats() {
    return [...this.chats.keys()];
  }
}
