import { readFile } from "node:fs/promises";
import { connectNote } from "../commands/general.js";
import { botImagePayload } from "./utils.js";

// Ship upload-ready bytes so the greeting can be sent during a cold start.
async function bundledPicture() {
  const [image, jpegThumbnail] = await Promise.all([
    readFile(new URL("../assets/connection-card.jpg", import.meta.url)),
    readFile(new URL("../assets/connection-thumbnail.jpg", import.meta.url))
  ]);
  return { image, jpegThumbnail, mimetype: "image/jpeg" };
}

export async function sendConnectionCard(sock, jid, config, commands) {
  const caption = connectNote(config, commands);
  const custom = config.botImage && config.botImage !== "assets/bot-image.png"
    ? botImagePayload(config) : null;
  if (custom) {
    try {
      return await sock.sendMessage(jid, { ...custom, caption });
    } catch {
      // A failed custom upload can still use the picture shipped with the bot.
    }
  }
  return sock.sendMessage(jid, { ...await bundledPicture(), caption });
}
