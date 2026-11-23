import { randomBytes } from "node:crypto";
import {
  downloadMediaMessage,
  generateWAMessageContent,
  generateWAMessageFromContent,
  proto
} from "@whiskeysockets/baileys";
import {
  getContextInfo,
  normalizeJid,
  unwrapMessage
} from "./message-utils.js";

export const GROUP_STATUS_COLORS = Object.freeze([
  { name: "purple", hex: "#7C3AED", argb: 0xFF7C3AED },
  { name: "blue", hex: "#2563EB", argb: 0xFF2563EB },
  { name: "teal", hex: "#0F766E", argb: 0xFF0F766E },
  { name: "green", hex: "#166534", argb: 0xFF166534 },
  { name: "orange", hex: "#C2410C", argb: 0xFFC2410C },
  { name: "pink", hex: "#BE185D", argb: 0xFFBE185D },
  { name: "red", hex: "#B91C1C", argb: 0xFFB91C1C },
  { name: "indigo", hex: "#4338CA", argb: 0xFF4338CA },
  { name: "cyan", hex: "#0E7490", argb: 0xFF0E7490 },
  { name: "emerald", hex: "#047857", argb: 0xFF047857 },
  { name: "dark", hex: "#1F2937", argb: 0xFF1F2937 }
]);

const STATUS_AUDIENCE_NAME = "Benfei Tech";
const STATUS_AUDIENCE_EMOJI = "🧑‍💻";
const lastStatusColorBySession = new Map();
const PATCH_MARKER = Symbol.for("fei-xmd.statusAudienceMetadataWireFields.v1");

function patchStatusAudienceEncoder() {
  const audienceType = proto?.ContextInfo?.StatusAudienceMetadata;
  if (!audienceType?.encode || !audienceType?.fromObject) {
    throw new Error("This Baileys version does not expose StatusAudienceMetadata.");
  }
  if (audienceType.encode[PATCH_MARKER]) return audienceType;

  const originalEncode = audienceType.encode;
  const encodeWithAudienceLabels = function (message, writer) {
    const output = originalEncode.call(this, message, writer);
    if (typeof message?.listName === "string" && message.listName.length) {
      output.uint32(18).string(message.listName);
    }
    if (typeof message?.listEmoji === "string" && message.listEmoji.length) {
      output.uint32(26).string(message.listEmoji);
    }
    return output;
  };
  Object.defineProperty(encodeWithAudienceLabels, PATCH_MARKER, { value: true });
  audienceType.encode = encodeWithAudienceLabels;
  return audienceType;
}

export function attachCustomStatusAudience(message) {
  const StatusAudienceMetadata = patchStatusAudienceEncoder();
  const inner = message?.groupStatusMessageV2?.message || message;
  const contentKey = [
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "stickerMessage"
  ].find(key => inner?.[key]);

  if (!contentKey) throw new Error("Could not attach the group-status audience metadata.");

  const content = inner[contentKey];
  content.contextInfo ||= {};
  const audience = content.contextInfo.statusAudienceMetadata ||
    StatusAudienceMetadata.fromObject({ audienceType: 1 });
  audience.audienceType = 1;
  audience.listName = STATUS_AUDIENCE_NAME;
  audience.listEmoji = STATUS_AUDIENCE_EMOJI;
  content.contextInfo.statusAudienceMetadata = audience;
  return message;
}

function statusContextInfo(kind) {
  const sourceType = kind === "video" ? 1 : kind === "audio" ? 3 : kind === "text" ? 4 : 0;
  return {
    forwardingScore: 0,
    featureEligibilities: { canBeReshared: true, canReceiveMultiReact: true },
    pairedMediaType: 0,
    isGroupStatus: true,
    statusSourceType: sourceType,
    statusAttributions: [{ type: 10 }],
    statusAudienceMetadata: { audienceType: 1 }
  };
}

export function buildGroupStatusRelayMessage(kind, innerMessage, messageSecret) {
  if (kind !== "text") return innerMessage;
  innerMessage.messageContextInfo = {
    ...(innerMessage.messageContextInfo || {}),
    messageSecret
  };
  return proto.Message.fromObject({
    messageContextInfo: { messageSecret },
    groupStatusMessageV2: { message: innerMessage }
  });
}

export function parseGroupStatusColorOption(value) {
  const raw = String(value || "").trim();
  if (!/^--color(?:=|\s|$)/i.test(raw)) {
    return { text: raw, color: null, provided: false, error: "" };
  }

  const match = raw.match(/^--color(?:=|\s+)([^\s]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return { text: "", color: null, provided: true, error: "Usage: --color <name|#RRGGBB> <text>" };

  const token = match[1];
  const text = String(match[2] || "").trim();
  if (token.toLowerCase() === "random") return { text, color: null, provided: true, error: "" };

  const normalized = token.toLowerCase();
  const named = GROUP_STATUS_COLORS.find(color => color.name === normalized);
  if (named) return { text, color: named, provided: true, error: "" };

  const hex = normalized.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return { text, color: null, provided: true, error: "Unknown background color: " + token };
  }
  const upperHex = "#" + hex.toUpperCase();
  const color = GROUP_STATUS_COLORS.find(item => item.hex === upperHex) || {
    name: "custom",
    hex: upperHex,
    argb: 0xFF000000 + Number.parseInt(hex, 16)
  };
  return { text, color, provided: true, error: "" };
}

function pickStatusColor(sessionId, requestedColor = null) {
  const key = String(sessionId || "default-session");
  if (requestedColor) {
    lastStatusColorBySession.set(key, requestedColor.hex);
    return requestedColor;
  }
  const previous = lastStatusColorBySession.get(key);
  const options = GROUP_STATUS_COLORS.filter(color => color.hex !== previous);
  const pool = options.length ? options : GROUP_STATUS_COLORS;
  const selected = pool[Math.floor(Math.random() * pool.length)];
  lastStatusColorBySession.set(key, selected.hex);
  if (lastStatusColorBySession.size > 500) {
    lastStatusColorBySession.delete(lastStatusColorBySession.keys().next().value);
  }
  return selected;
}

function getQuoted(ctx) {
  const info = getContextInfo(ctx.msg?.message);
  const message = info?.quotedMessage || null;
  if (!info?.stanzaId || !message) return null;

  const participant = normalizeJid(info.participant || "");
  const selfJids = [ctx.sock?.user?.id, ctx.sock?.user?.lid].map(normalizeJid).filter(Boolean);
  const key = {
    remoteJid: ctx.jid,
    id: String(info.stanzaId),
    fromMe: Boolean(participant && selfJids.includes(participant))
  };
  if (participant && String(ctx.jid || "").endsWith("@g.us")) key.participant = participant;

  return {
    message,
    wrapped: { key, message, messageTimestamp: ctx.msg?.messageTimestamp }
  };
}

function hasViewOnceWrapper(message) {
  let current = message;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (Object.keys(current).some(key => /viewOnceMessage/i.test(key))) return true;
    current = current.ephemeralMessage?.message || current.documentWithCaptionMessage?.message;
  }
  return false;
}

function mediaKind(message) {
  if (hasViewOnceWrapper(message)) return "";
  const body = unwrapMessage(message);
  if (body.imageMessage) return "image";
  if (body.videoMessage) return "video";
  if (body.audioMessage) return "audio";
  if (body.stickerMessage) return "sticker";
  return "";
}

export async function postGroupStatus(ctx, groupJid, kind, content, backgroundColor = null) {
  const target = String(groupJid || "");
  if (!target.endsWith("@g.us")) throw new Error("A valid WhatsApp group JID is required.");
  if (typeof ctx.sock.groupMetadata !== "function") throw new Error("This WhatsApp connection cannot verify the target group.");
  await ctx.sock.groupMetadata(target);

  const senderJid = normalizeJid(ctx.sock?.user?.id || ctx.sock?.user?.lid || "");
  if (!senderJid) throw new Error("Could not determine the connected WhatsApp account JID.");

  let innerMessage;
  if (kind === "text") {
    const text = String(content.text || "").trim();
    if (!text) throw new Error("Add text before posting the group status.");
    innerMessage = proto.Message.fromObject({
      extendedTextMessage: {
        text,
        font: 1,
        backgroundArgb: backgroundColor?.argb ?? 0xFF7C3AED,
        textArgb: 0xFFFFFFFF,
        contextInfo: statusContextInfo("text")
      }
    });
  } else {
    if (typeof ctx.sock.waUploadToServer !== "function") {
      throw new Error("This Baileys connection cannot upload group-status media.");
    }
    const prepared = await generateWAMessageContent({
      ...content,
      contextInfo: statusContextInfo(kind)
    }, {
      upload: ctx.sock.waUploadToServer,
      logger: ctx.sock.logger,
      mediaCache: ctx.sock.mediaCache,
      options: {},
      jid: target
    });

    const mediaKey = kind + "Message";
    if (!prepared?.[mediaKey]) throw new Error("Baileys did not prepare the requested media.");
    const media = prepared[mediaKey];
    if (!media.url || !media.mediaKey || !media.mimetype) {
      throw new Error("Baileys returned incomplete media upload metadata.");
    }
    if (kind === "audio" && !media.backgroundArgb) media.backgroundArgb = 0xFF23313A;
    innerMessage = proto.Message.fromObject(prepared);
  }

  const messageSecret = randomBytes(32);
  const relayContent = buildGroupStatusRelayMessage(kind, innerMessage, messageSecret);
  const generated = generateWAMessageFromContent(target, relayContent, { userJid: senderJid });
  const mediaKey = kind + "Message";

  if (kind === "text") {
    if (!generated.message?.groupStatusMessageV2?.message?.extendedTextMessage) {
      throw new Error("Baileys did not preserve the group-status text envelope.");
    }
  } else {
    const media = generated.message?.[mediaKey];
    if (!media?.url || !media?.mediaKey || !media?.mimetype ||
        !media.contextInfo?.isGroupStatus ||
        media.contextInfo.statusSourceType === undefined) {
      throw new Error("Baileys did not preserve the required group-status media fields.");
    }
  }

  attachCustomStatusAudience(generated.message);
  if (typeof ctx.sock.relayMessage !== "function") throw new Error("This Baileys connection cannot relay group statuses.");

  const relayOptions = {
    messageId: generated.key.id,
    useCachedGroupMetadata: false
  };
  if (kind === "text") {
    relayOptions.additionalNodes = [{ tag: "meta", attrs: { is_group_status: "true" } }];
  }
  await ctx.sock.relayMessage(target, generated.message, relayOptions);
  return { messageId: generated.key.id, groupJid: target };
}

export async function postQuotedGroupStatus(ctx, groupJid, rawText, colorOption = null) {
  const quoted = getQuoted(ctx);
  const kind = quoted ? mediaKind(quoted.message) : "";
  if (quoted && hasViewOnceWrapper(quoted.message)) {
    throw new Error("View-once media is not reposted. Reply to a regular image, video, audio or sticker.");
  }

  const text = String(rawText || "").trim();
  if (!kind && !text) throw new Error("Add text or reply to an image, video, audio or sticker.");
  if (!kind && text.length > 1024) throw new Error("Text group statuses are limited to 1,024 characters.");
  if (kind && colorOption?.provided) throw new Error("Background colors apply to text statuses only.");

  const selectedColor = kind ? null : pickStatusColor(ctx.sessionId || ctx.sock?.user?.id, colorOption?.color || null);

  if (!kind) {
    return {
      result: await postGroupStatus(ctx, groupJid, "text", { text }, selectedColor),
      kind: "text",
      color: selectedColor
    };
  }

  const body = unwrapMessage(quoted.message);
  const buffer = await downloadMediaMessage(quoted.wrapped, "buffer", {}, {
    reuploadRequest: ctx.sock.updateMediaMessage
  });
  if (!buffer?.length) throw new Error("The replied media could not be downloaded.");

  const caption = (text || body.imageMessage?.caption || body.videoMessage?.caption || "").slice(0, 4000);
  const content = kind === "audio"
    ? {
        audio: buffer,
        mimetype: body.audioMessage?.mimetype || "audio/ogg; codecs=opus",
        ptt: Boolean(body.audioMessage?.ptt)
      }
    : kind === "sticker"
      ? { sticker: buffer }
      : { [kind]: buffer, caption };

  return {
    result: await postGroupStatus(ctx, groupJid, kind, content),
    kind,
    color: null
  };
}

export function listGroupStatusColors() {
  return GROUP_STATUS_COLORS.map(color => "• " + color.name + " — " + color.hex).join("\n");
}

export function parseGroupStatusColor(value) {
  return parseGroupStatusColorOption(value);
}
