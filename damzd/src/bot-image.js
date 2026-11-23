// The bot's own picture — DamzD's asset, not FEI's. Sent with .menu, .help
// and the connect note as ONE captioned message, the way the big menus
// deliver. The shipped asset is pre-compressed (assets/bot-image.jpg,
// ~130 KB inline JPEG), so no runtime conversion is needed. A BOT_IMAGE env
// override (URL or local path) wins when set. Null when nothing usable is
// set, so callers simply skip the picture.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE = path.join(here, "../assets/bot-image.jpg");

let cachedBuffer = null;
let cachedFor = "";

export function botImagePayload(config) {
  const source = String(config?.botImage || "").trim() || DEFAULT_IMAGE;
  if (/^https?:\/\//i.test(source)) return { image: { url: source } };
  try {
    if (cachedFor !== source) {
      const buffer = fs.readFileSync(path.resolve(source));
      if (!buffer.length || buffer.length < 500) return null;
      cachedBuffer = buffer;
      cachedFor = source;
    }
    return cachedBuffer ? { image: cachedBuffer } : null;
  } catch {
    return null;
  }
}
