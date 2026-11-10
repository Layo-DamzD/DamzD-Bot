import fs from "node:fs";
import path from "node:path";

export class JsonStore {
  constructor(dataDirectory, fileName) {
    this.filePath = path.join(dataDirectory, fileName);
    this.data = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) || {};
      }
    } catch {
      this.data = {};
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 1));
    } catch {
      /* ignore write failures */
    }
  }

  get(key, fallback) {
    const value = this.data[key];
    return value === undefined ? fallback : value;
  }

  set(key, value) {
    if (value === undefined) delete this.data[key];
    else this.data[key] = value;
    this.save();
  }
}

export const WELCOME_ON = "welcomeOn";
export const GOODBYE_ON = "goodbyeOn";
export const ANTILINK_ON = "antilinkOn";
