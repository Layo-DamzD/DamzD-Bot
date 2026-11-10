/**
 * damzd-bot — src/canvas.js
 *
 * Programmatic meme-style image renderer (WhatsApp chat screenshots, quote
 * cards, Nokia 3310 screens, image macros, Free Fire lobby cards, Nigerian
 * payment receipts). Everything is drawn with @napi-rs/canvas — no external
 * images, no font files (generic families only).
 *
 * Every exported function returns a Promise<Buffer> containing a PNG.
 */

import { createCanvas } from "@napi-rs/canvas";

/* ------------------------------------------------------------------ */
/*  shared helpers                                                     */
/* ------------------------------------------------------------------ */

const W = 720; // every canvas is 720px wide (well under the 1080px cap)

function fail(msg) {
  throw new Error(msg);
}

/** required string-ish param → trimmed string, else friendly error */
function asText(value, label) {
  if (value === undefined || value === null) fail(`${label} is required`);
  const s = String(value).trim();
  if (!s) fail(`${label} is required`);
  return s;
}

/** optional string-ish param → trimmed string or "" */
function optText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

async function toPNG(canvas) {
  return Buffer.from(await canvas.encode("png"));
}

/** rounded rect — `r` is a number or [topLeft, topRight, bottomRight, bottomLeft] */
function roundRect(ctx, x, y, w, h, r) {
  const R = Array.isArray(r) ? r : [r, r, r, r];
  const clamp = (v) => Math.max(0, Math.min(v, w / 2, h / 2));
  const tl = clamp(R[0]);
  const tr = clamp(R[1]);
  const br = clamp(R[2]);
  const bl = clamp(R[3]);
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/**
 * Word-wrap `text` into lines no wider than maxWidth (uses current font).
 * Hard-breaks single words that are too long. Never returns more than
 * maxLines lines — overflow is truncated with an ellipsis.
 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const paragraphs = String(text).replace(/\r/g, "").split("\n");
  const lines = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let cur = "";
    for (let wi = 0; wi < words.length; wi++) {
      let word = words[wi];
      if (ctx.measureText(word).width > maxWidth) {
        if (cur) {
          lines.push(cur);
          cur = "";
        }
        let piece = "";
        for (const ch of word) {
          if (piece && ctx.measureText(piece + ch).width > maxWidth) {
            lines.push(piece);
            piece = ch;
          } else {
            piece += ch;
          }
        }
        word = piece;
        if (!word) continue;
      }
      const cand = cur ? `${cur} ${word}` : word;
      if (!cur || ctx.measureText(cand).width <= maxWidth) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
  }
  if (!lines.length) lines.push(String(text).slice(0, 1) || " ");
  let truncated = false;
  if (lines.length > maxLines) {
    truncated = true;
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return { lines, truncated };
}

/** shrink the font until `text` fits inside maxLines lines at maxWidth */
function fitLines(ctx, text, maxWidth, maxLines, startSize, minSize, toFont) {
  const font = toFont || ((s) => `bold ${s}px sans-serif`);
  for (let size = startSize; size >= minSize; size -= 2) {
    ctx.font = font(size);
    if (!wrapText(ctx, text, maxWidth, maxLines).truncated) {
      return { size, lines: wrapText(ctx, text, maxWidth, maxLines).lines };
    }
  }
  ctx.font = font(minSize);
  return { size: minSize, lines: wrapText(ctx, text, maxWidth, maxLines).lines };
}

/** truncate a string to pixel width with an ellipsis (uses current font) */
function ellipsize(ctx, text, maxWidth) {
  let s = String(text);
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

/** hand-rolled dashed horizontal rule (no reliance on setLineDash) */
function dashedRule(ctx, x1, x2, y, color = "#a7acb3", dash = 9, gap = 8, lw = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let x = x1; x < x2; x += dash + gap) {
    ctx.moveTo(x, y);
    ctx.lineTo(Math.min(x + dash, x2), y);
  }
  ctx.stroke();
}

/** five-pointed star */
function drawStar(ctx, x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function initialOf(name) {
  for (const ch of String(name).trim()) {
    if (/[a-z0-9]/i.test(ch)) return ch.toUpperCase();
  }
  return "?";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** WhatsApp-style per-sender label colour */
function nameColor(name) {
  const palette = ["#53bdeb", "#f7b34c", "#7ad48b", "#e573b6", "#c792ea", "#f28b82"];
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return palette[h % palette.length];
}

/** 12500 → "12,500.00" */
function fmtAmount(n) {
  const fixed = Math.abs(Number(n)).toFixed(2);
  const [int, dec] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${grouped}.${dec}`;
}

/** "OFFICIAL" → "O F F I C I A L" (poor-man's letter spacing) */
function spaced(s) {
  return String(s).split("").join(" ");
}

function drawTicks(ctx, x, y) {
  ctx.strokeStyle = "#53bdeb";
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x + 3.5, y + 6.5);
  ctx.lineTo(x + 10, y - 1);
  ctx.moveTo(x + 6, y + 3);
  ctx.lineTo(x + 9.5, y + 6.5);
  ctx.lineTo(x + 16, y - 1);
  ctx.stroke();
}

/* Naira-sign support is probed once: ₦ must paint pixels AND differ from the
 * tofu box painted for an unassigned code point, otherwise we fall back to
 * the literal "NGN " prefix. */
let nairaSupport = null;
function nairaPrefix() {
  if (nairaSupport !== null) return nairaSupport ? "₦" : "NGN ";
  try {
    const probe = (ch) => {
      const c = createCanvas(64, 64);
      const x = c.getContext("2d");
      x.fillStyle = "#000";
      x.fillRect(0, 0, 64, 64);
      x.fillStyle = "#fff";
      x.font = "bold 40px sans-serif";
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(ch, 32, 34);
      const d = x.getImageData(0, 0, 64, 64).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 40) lit++;
      return { lit, px: Buffer.from(d) };
    };
    const a = probe("\u{20A6}"); // ₦ naira sign
    const b = probe("\u{0378}"); // unassigned code point → tofu or blank
    nairaSupport = a.lit > 0 && !a.px.equals(b.px);
  } catch {
    nairaSupport = false;
  }
  return nairaSupport ? "₦" : "NGN ";
}

/* ------------------------------------------------------------------ */
/*  1. renderChat — fake WhatsApp dark-theme screenshot                */
/* ------------------------------------------------------------------ */

export async function renderChat({ title, messages } = {}) {
  if (typeof title !== "string" && typeof title !== "number") {
    fail("renderChat needs a chat title");
  }
  const chatTitle = String(title).trim();
  if (!chatTitle) fail("renderChat needs a chat title");
  if (!Array.isArray(messages) || !messages.length) {
    fail("renderChat needs at least one message");
  }

  const norm = messages.map((m, i) => {
    if (!m || typeof m !== "object") fail(`Message ${i + 1} must be an object with text`);
    const text = optText(m.text);
    if (!text) fail(`Message ${i + 1} needs some text`);
    const mine = Boolean(m.mine);
    return { text, mine, name: mine ? "" : optText(m.name) || "Unknown" };
  });

  /* ---- layout pass on a scratch context ---- */
  const scratch = createCanvas(8, 8).getContext("2d");
  const FS = 17;
  const LINE_H = 24;
  const PAD_X = 14;
  const PAD_Y = 10;
  const GAP = 10;
  const BUBBLE_MAX = Math.round(W * 0.6); // ≈60% of canvas width
  const NAME_H = 18;
  const TIME_H = 15;
  const MAX_LINES = 6;
  const HEAD = 100; // status bar + header bar
  const INPUT = 64;
  const TOP_PAD = 14;
  const BOTTOM_PAD = 16;

  scratch.font = `${FS}px sans-serif`;
  const laid = norm.map((m, idx) => {
    const inner = BUBBLE_MAX - PAD_X * 2;
    const { lines } = wrapText(scratch, m.text, inner, MAX_LINES);
    let longest = 0;
    for (const ln of lines) longest = Math.max(longest, scratch.measureText(ln).width);
    const bw = Math.min(BUBBLE_MAX, Math.ceil(longest) + PAD_X * 2);
    const bh = PAD_Y * 2 + (m.name ? NAME_H : 0) + lines.length * LINE_H + TIME_H;
    return { ...m, idx, lines, bw, bh };
  });

  const budget = 1800 - HEAD - TOP_PAD - BOTTOM_PAD - INPUT - GAP;
  const shown = [];
  let used = 0;
  for (const m of laid) {
    const need = m.bh + (shown.length ? GAP : 0);
    if (used + need > budget) break;
    shown.push(m);
    used += need;
  }
  if (!shown.length) shown.push(laid[0]); // always show at least one

  const H = Math.max(420, Math.min(1800, HEAD + TOP_PAD + used + BOTTOM_PAD + INPUT));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  /* ---- page background ---- */
  ctx.fillStyle = "#0b141a";
  ctx.fillRect(0, 0, W, H);

  /* ---- status bar ---- */
  ctx.fillStyle = "#e9edef";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("9:41", 26, 11);
  ctx.fillStyle = "rgba(233,237,239,0.9)";
  for (let i = 0; i < 4; i++) ctx.fillRect(W - 148 + i * 7, 24 - (5 + i * 3), 4, 5 + i * 3);
  ctx.strokeStyle = "rgba(233,237,239,0.9)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, W - 72, 11, 28, 14, 4);
  ctx.stroke();
  ctx.fillStyle = "rgba(233,237,239,0.9)";
  roundRect(ctx, W - 41, 15, 3, 6, 1.5);
  ctx.fill();
  ctx.fillStyle = "#e9edef";
  roundRect(ctx, W - 70, 13, 19, 10, 2);
  ctx.fill();

  /* ---- header bar with back chevron ---- */
  ctx.fillStyle = "#202c33";
  ctx.fillRect(0, 36, W, 64);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(0, 99, W, 1);
  ctx.strokeStyle = "#e9edef";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(34, 56);
  ctx.lineTo(22, 68);
  ctx.lineTo(34, 80);
  ctx.stroke();
  ctx.fillStyle = "#e9edef";
  ctx.font = "bold 19px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, chatTitle, W - 54 - 40), 54, 69);

  /* ---- message bubbles ---- */
  const timeFor = (idx) => {
    const mins = 9 * 60 + 41 + idx;
    return `${Math.floor(mins / 60)}:${pad2(mins % 60)}`;
  };

  let y = HEAD + TOP_PAD;
  for (const m of shown) {
    const bx = m.mine ? W - 16 - m.bw : 16;
    roundRect(ctx, bx, y, m.bw, m.bh, m.mine ? [14, 14, 4, 14] : [14, 14, 14, 4]);
    ctx.fillStyle = m.mine ? "#005c4b" : "#202c33";
    ctx.fill();

    const tx = bx + PAD_X;
    let ty = y + PAD_Y;
    ctx.textAlign = "left";
    if (m.name) {
      ctx.font = "bold 13px sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = nameColor(m.name);
      ctx.fillText(m.name, tx, ty + 12);
      ty += NAME_H;
    }
    ctx.font = `${FS}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#e9edef";
    m.lines.forEach((ln, li) => ctx.fillText(ln, tx, ty + li * LINE_H));

    const timeY = ty + m.lines.length * LINE_H + 2;
    const label = timeFor(m.idx);
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "top";
    if (m.mine) {
      const tw = ctx.measureText(label).width;
      drawTicks(ctx, bx + m.bw - PAD_X - tw - 22, timeY + 4);
    }
    ctx.fillStyle = "rgba(233,237,239,0.45)";
    ctx.textAlign = "right";
    ctx.fillText(label, bx + m.bw - PAD_X, timeY);
    y += m.bh + GAP;
  }

  /* ---- message input bar ---- */
  const iy = H - INPUT;
  ctx.fillStyle = "#111b21";
  ctx.fillRect(0, iy, W, INPUT);
  roundRect(ctx, 16, iy + 12, W - 16 - 88, 40, 20);
  ctx.fillStyle = "#2a3942";
  ctx.fill();
  ctx.fillStyle = "#8696a0";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Message", 36, iy + 32);
  const scx = W - 52;
  const scy = iy + 32;
  ctx.beginPath();
  ctx.arc(scx, scy, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#00a884";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(scx - 9, scy + 8);
  ctx.lineTo(scx + 10, scy);
  ctx.lineTo(scx - 9, scy - 8);
  ctx.lineTo(scx - 4, scy);
  ctx.closePath();
  ctx.fill();

  return toPNG(canvas);
}

/* ------------------------------------------------------------------ */
/*  2. renderQuote — iphone / window / plain quote cards               */
/* ------------------------------------------------------------------ */

export async function renderQuote({ text, author, style } = {}) {
  const quote = asText(text, "renderQuote needs some quote text");
  const who = optText(author);
  const s = String(style || "plain").toLowerCase();
  if (s === "iphone") return quoteIphone(quote, who);
  if (s === "window") return quoteWindow(quote, who);
  return quotePlain(quote, who); // unknown style → plain fallback
}

async function quoteIphone(q, who) {
  const H = 920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#151326");
  bg.addColorStop(1, "#1e1433");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* soft colour "blur" circles (layered translucent discs) */
  const blob = (x, y, r, rgb) => {
    const layers = [
      [r, 0.1],
      [r * 0.78, 0.1],
      [r * 0.55, 0.12],
    ];
    for (const [rad, a] of layers) {
      ctx.fillStyle = `rgba(${rgb},${a})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  blob(140, 210, 240, "255,93,162");
  blob(620, 730, 260, "124,92,255");
  blob(70, 770, 190, "45,212,191");
  blob(640, 150, 170, "255,177,78");

  /* big decorative open-quote */
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.font = "bold 170px serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("\u201C", 40, 48);

  const fit = fitLines(ctx, q, 600, 8, 52, 28);
  const lh = Math.round(fit.size * 1.42);
  const blockH = fit.lines.length * lh;
  const ty = Math.round((H - blockH) / 2) - 20;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f5f5f7";
  fit.lines.forEach((ln, i) => ctx.fillText(ln, W / 2, ty + i * lh));

  if (who) {
    ctx.font = "bold 22px sans-serif";
    ctx.fillStyle = "#8e8e99";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(who.startsWith("@") ? who : `@${who}`, 52, H - 60);
  }
  return toPNG(canvas);
}

async function quoteWindow(q, who) {
  const scratch = createCanvas(8, 8).getContext("2d");
  scratch.font = "17px sans-serif";

  const DW = 560;
  const TITLE_H = 36;
  const LH = 26;
  const MAX_LINES = 16;
  const { lines, truncated } = wrapText(scratch, q, DW - 60, MAX_LINES);
  const extra = (who ? 30 : 0) + (truncated ? 8 : 0);
  const dh = TITLE_H + 24 + lines.length * LH + extra + 18 + 40 + 24;
  const H = Math.max(680, Math.min(1020, dh + 150));

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  /* teal desktop */
  ctx.fillStyle = "#01786f";
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, "rgba(255,255,255,0.07)");
  vg.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const dx = Math.round((W - DW) / 2);
  const dy = Math.round((H - dh) / 2);

  /* dialog shadow + chassis */
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.fillRect(dx + 10, dy + 12, DW, dh);
  ctx.fillStyle = "#d6d3ce";
  ctx.fillRect(dx, dy, DW, dh);
  ctx.strokeStyle = "#6d6d6d";
  ctx.lineWidth = 2;
  ctx.strokeRect(dx + 1, dy + 1, DW - 2, dh - 2);

  /* grey title bar */
  ctx.fillStyle = "#d9d9d9";
  ctx.fillRect(dx + 4, dy + 4, DW - 8, 28);
  ctx.strokeStyle = "#8a8a8a";
  ctx.lineWidth = 1;
  ctx.strokeRect(dx + 4.5, dy + 4.5, DW - 9, 27);
  ctx.fillStyle = "#1f1f1f";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, "quote.txt - Notepad", DW - 130), dx + 14, dy + 18);

  /* min / max / close boxes */
  const boxY = dy + 9;
  for (let i = 0; i < 3; i++) {
    const bx = dx + DW - 4 - (3 - i) * 26;
    ctx.strokeStyle = "#6a6a6a";
    ctx.strokeRect(bx + 0.5, boxY + 0.5, 20, 18);
    ctx.beginPath();
    if (i === 0) {
      ctx.moveTo(bx + 5, boxY + 13);
      ctx.lineTo(bx + 15, boxY + 13);
    } else if (i === 1) {
      ctx.rect(bx + 5.5, boxY + 5.5, 10, 8);
    } else {
      ctx.moveTo(bx + 6, boxY + 5);
      ctx.lineTo(bx + 15, boxY + 14);
      ctx.moveTo(bx + 15, boxY + 5);
      ctx.lineTo(bx + 6, boxY + 14);
    }
    ctx.stroke();
  }

  /* white body */
  const bodyY = dy + TITLE_H;
  const bodyH = dh - TITLE_H - 6;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(dx + 6, bodyY, DW - 12, bodyH);
  ctx.strokeStyle = "#a8a8a8";
  ctx.lineWidth = 1;
  ctx.strokeRect(dx + 6.5, bodyY + 0.5, DW - 13, bodyH - 1);

  ctx.fillStyle = "#202020";
  ctx.font = "17px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let ty = bodyY + 22;
  lines.forEach((ln) => {
    ctx.fillText(ln, dx + 30, ty);
    ty += LH;
  });
  if (who) {
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "#666666";
    ctx.fillText(`— ${who}`, dx + 30, ty + 6);
  }

  /* [ OK ] button with bevel */
  const bw = 120;
  const bh = 38;
  const bx = dx + Math.round((DW - bw) / 2);
  const by = dy + dh - 24 - bh;
  ctx.fillStyle = "#e4e2de";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#6a6a6a";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx + 2, by + bh - 3);
  ctx.lineTo(bx + 2, by + 2);
  ctx.lineTo(bx + bw - 3, by + 2);
  ctx.stroke();
  ctx.strokeStyle = "#808080";
  ctx.beginPath();
  ctx.moveTo(bx + bw - 2, by + 3);
  ctx.lineTo(bx + bw - 2, by + bh - 2);
  ctx.lineTo(bx + 3, by + bh - 2);
  ctx.stroke();
  ctx.fillStyle = "#1c1c1c";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("OK", bx + bw / 2, by + bh / 2 + 1);

  return toPNG(canvas);
}

async function quotePlain(q, who) {
  const H = 760;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#15151b");
  bg.addColorStop(1, "#0b0b0f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, 330, 40, W / 2, 330, 430);
  glow.addColorStop(0, "rgba(255,255,255,0.06)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(24.5, 24.5, W - 49, H - 49);

  const fit = fitLines(ctx, q, 620, 7, 54, 30, (s) => `${s}px sans-serif`);
  const lh = Math.round(fit.size * 1.45);
  const blockH = fit.lines.length * lh;
  const midY = Math.round(H * 0.42);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f2f2f4";
  fit.lines.forEach((ln, i) => ctx.fillText(ln, W / 2, midY - Math.round(blockH / 2) + i * lh));

  const divY = midY + Math.round(blockH / 2) + 46;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 70, divY);
  ctx.lineTo(W / 2 + 70, divY);
  ctx.stroke();

  if (who) {
    ctx.font = "21px sans-serif";
    ctx.fillStyle = "#8f8f98";
    ctx.fillText(`— ${who}`, W / 2, divY + 26);
  }
  return toPNG(canvas);
}

/* ------------------------------------------------------------------ */
/*  3. renderNokia — Nokia 3310 with green LCD                         */
/* ------------------------------------------------------------------ */

export async function renderNokia({ text } = {}) {
  const msg = asText(text, "renderNokia needs some text").toUpperCase();
  const H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const cx = W / 2;

  /* backdrop */
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#22262b");
  bg.addColorStop(1, "#14171b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* phone body */
  const bx = 140;
  const by = 24;
  const bw = 440;
  const bh = 952;
  const body = ctx.createLinearGradient(bx, by, bx, by + bh);
  body.addColorStop(0, "#4d5359");
  body.addColorStop(0.5, "#3a4046");
  body.addColorStop(1, "#2b3036");
  roundRect(ctx, bx, by, bw, bh, 54);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "#1d2126";
  ctx.lineWidth = 3;
  ctx.stroke();
  roundRect(ctx, bx + 6, by + 6, bw - 12, bh - 12, 48);
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 2;
  ctx.stroke();

  /* speaker dot + brand */
  ctx.fillStyle = "#20242a";
  ctx.beginPath();
  ctx.arc(cx, 62, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 18px monospace";
  ctx.fillStyle = "#cdd2d8";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("NOKIA", cx, 98);

  /* green LCD */
  const sx = 170;
  const sy = 112;
  const sw = 380;
  const sh = 310;
  roundRect(ctx, sx, sy, sw, sh, 12);
  ctx.fillStyle = "#9bbc0f";
  ctx.fill();
  ctx.strokeStyle = "#7e990c";
  ctx.lineWidth = 4;
  ctx.stroke();

  /* LCD status glyphs */
  ctx.fillStyle = "#332f2b";
  for (let i = 0; i < 4; i++) ctx.fillRect(sx + 20 + i * 7, sy + 27 - (5 + i * 3), 4, 5 + i * 3);
  ctx.strokeStyle = "#332f2b";
  ctx.lineWidth = 2;
  roundRect(ctx, sx + sw - 56, sy + 12, 30, 15, 3);
  ctx.stroke();
  ctx.fillStyle = "#332f2b";
  ctx.fillRect(sx + sw - 54, sy + 14, 20, 11);
  ctx.strokeStyle = "rgba(51,47,43,0.35)";
  ctx.beginPath();
  ctx.moveTo(sx + 16, sy + 40);
  ctx.lineTo(sx + sw - 16, sy + 40);
  ctx.stroke();

  /* LCD message text — uppercase monospace, truncated with … */
  ctx.font = "bold 22px monospace";
  const { lines } = wrapText(ctx, msg, sw - 40, Math.floor((sh - 52 - 14) / 30));
  ctx.fillStyle = "#332f2b";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((ln, i) => ctx.fillText(ln, sx + 20, sy + 52 + i * 30));

  /* soft keys + navi key */
  ctx.fillStyle = "#22262b";
  roundRect(ctx, 169, 448, 118, 30, 15);
  ctx.fill();
  roundRect(ctx, 433, 448, 118, 30, 15);
  ctx.fill();
  roundRect(ctx, cx - 42, 440, 84, 46, 14);
  ctx.fill();
  roundRect(ctx, cx - 26, 448, 52, 8, 4);
  ctx.fillStyle = "#3f7fd9";
  ctx.fill();

  /* keypad — 12 buttons, 3 x 4 */
  const labels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  const sub = { 2: "abc", 3: "def", 4: "ghi", 5: "jkl", 6: "mno", 7: "pqrs", 8: "tuv", 9: "wxyz" };
  const kw = 118;
  const kh = 84;
  const gx = 14;
  const gy = 16;
  const x0 = cx - (kw * 3 + gx * 2) / 2;
  const y0 = 510;
  labels.forEach((lab, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const kx = x0 + col * (kw + gx);
    const ky = y0 + row * (kh + gy);
    const kg = ctx.createLinearGradient(kx, ky, kx, ky + kh);
    kg.addColorStop(0, "#31363c");
    kg.addColorStop(1, "#24282d");
    roundRect(ctx, kx, ky, kw, kh, 18);
    ctx.fillStyle = kg;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#d6dade";
    ctx.font = "bold 24px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(lab, kx + kw / 2, ky + 18);
    if (sub[lab]) {
      ctx.font = "11px monospace";
      ctx.fillStyle = "#7d858d";
      ctx.fillText(sub[lab], kx + kw / 2, ky + 52);
    }
  });

  /* mic hole */
  ctx.fillStyle = "#20242a";
  ctx.beginPath();
  ctx.arc(cx, 938, 6, 0, Math.PI * 2);
  ctx.fill();

  return toPNG(canvas);
}

/* ------------------------------------------------------------------ */
/*  4. renderMeme — classic image macro                                */
/* ------------------------------------------------------------------ */

export async function renderMeme({ top, bottom } = {}) {
  const t = optText(top);
  const b = optText(bottom);
  if (!t && !b) fail("renderMeme needs top and/or bottom text");

  const H = 780;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  /* dark gradient + diagonal stripes */
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#191c22");
  bg.addColorStop(1, "#0f1116");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.028)";
  ctx.lineWidth = 34;
  ctx.beginPath();
  for (let x = -H; x < W + H; x += 88) {
    ctx.moveTo(x, -20);
    ctx.lineTo(x + H + 40, H + 20);
  }
  ctx.stroke();

  /* vignette */
  const vg = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 620);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  /* pick a font size where both blocks fit in ≤ 3 lines */
  const maxWidth = W - 90;
  const fits = (s, size) => {
    if (!s) return true;
    ctx.font = `bold ${size}px sans-serif`;
    return !wrapText(ctx, s, maxWidth, 3).truncated;
  };
  let size = 68;
  for (; size >= 34; size -= 2) {
    if (fits(t, size) && fits(b, size)) break;
  }
  size = Math.max(size, 34);
  ctx.font = `bold ${size}px sans-serif`;
  const lh = Math.round(size * 1.18);

  const drawBlock = (s, yTop) => {
    if (!s) return;
    const { lines } = wrapText(ctx, s, maxWidth, 3);
    lines.forEach((ln, i) => {
      const ly = yTop + i * lh;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(8, Math.min(12, size / 6));
      ctx.strokeStyle = "#000000";
      ctx.strokeText(ln, W / 2, ly);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(ln, W / 2, ly);
    });
  };

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (t) drawBlock(t.toUpperCase(), 54);
  if (b) {
    ctx.font = `bold ${size}px sans-serif`;
    const bl = wrapText(ctx, b.toUpperCase(), maxWidth, 3).lines.length;
    drawBlock(b.toUpperCase(), H - 54 - bl * lh);
  }

  return toPNG(canvas);
}

/* ------------------------------------------------------------------ */
/*  5. renderFfLobby — battle-lobby squad card                         */
/* ------------------------------------------------------------------ */

export async function renderFfLobby({ player } = {}) {
  const name = asText(player, "renderFfLobby needs a player name");
  const H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#181b21");
  bg.addColorStop(1, "#0f1115");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(90, 70, 20, 90, 70, 460);
  glow.addColorStop(0, "rgba(255,107,0,0.20)");
  glow.addColorStop(1, "rgba(255,107,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  /* header */
  ctx.fillStyle = "#ff6b00";
  roundRect(ctx, 48, 62, 8, 36, 3);
  ctx.fill();
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("BATTLE LOBBY", 70, 60);
  roundRect(ctx, 70, 112, 132, 6, 3);
  ctx.fill();

  /* SQUAD • 1/4 counter */
  ctx.font = "bold 17px sans-serif";
  const c1 = "SQUAD • ";
  const c2 = "1/4";
  const cw1 = ctx.measureText(c1).width;
  const cw2 = ctx.measureText(c2).width;
  const pillW = cw1 + cw2 + 28;
  const pillX = W - 48 - pillW;
  roundRect(ctx, pillX, 66, pillW, 32, 16);
  ctx.fillStyle = "#1d222b";
  ctx.fill();
  ctx.strokeStyle = "#2a313d";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#cbd2da";
  ctx.fillText(c1, pillX + 14, 83);
  ctx.fillStyle = "#ff6b00";
  ctx.fillText(c2, pillX + 14 + cw1, 83);

  /* 4 team slots */
  const S = 296;
  const SX = [44, 380];
  const SY = [158, 494];
  for (let i = 0; i < 4; i++) {
    const x = SX[i % 2];
    const y = SY[Math.floor(i / 2)];
    const filled = i === 0;
    roundRect(ctx, x, y, S, S, 22);
    ctx.fillStyle = filled ? "#20262f" : "#161a20";
    ctx.fill();
    ctx.strokeStyle = filled ? "#ff6b00" : "#262d38";
    ctx.lineWidth = filled ? 2.5 : 2;
    ctx.stroke();

    ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = "#8b93a1";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`SLOT ${i + 1}`, x + 18, y + 16);
    if (filled) {
      ctx.fillStyle = "#ff6b00";
      ctx.beginPath();
      ctx.arc(x + 76, y + 22, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (filled) {
      const acx = x + S / 2;
      const acy = y + 118;
      const ag = ctx.createLinearGradient(acx, acy - 58, acx, acy + 58);
      ag.addColorStop(0, "#ffb14e");
      ag.addColorStop(1, "#ff6b00");
      ctx.beginPath();
      ctx.arc(acx, acy, 56, 0, Math.PI * 2);
      ctx.fillStyle = ag;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.font = "bold 46px sans-serif";
      ctx.fillStyle = "#241303";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initialOf(name), acx, acy + 2);
      ctx.font = "bold 22px sans-serif";
      ctx.fillStyle = "#f4f6f8";
      ctx.textBaseline = "top";
      ctx.fillText(ellipsize(ctx, name, S - 40), acx, y + 194);
      roundRect(ctx, acx - 34, y + 230, 68, 24, 12);
      ctx.fillStyle = "rgba(255,107,0,0.14)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,107,0,0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "#ff9d3f";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("YOU", acx, y + 243);
    } else {
      ctx.font = "bold 18px sans-serif";
      ctx.fillStyle = "#5c6673";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("EMPTY", x + S / 2, y + S / 2 + 4);
    }
  }

  /* big orange START button, bottom-right */
  const bX = W - 44 - 300;
  const bY = H - 44 - 92;
  const bW = 300;
  const bH = 92;
  ctx.save();
  ctx.shadowColor = "rgba(255,107,0,0.45)";
  ctx.shadowBlur = 28;
  const bgd = ctx.createLinearGradient(bX, bY, bX, bY + bH);
  bgd.addColorStop(0, "#ff9d3f");
  bgd.addColorStop(1, "#ff6b00");
  roundRect(ctx, bX, bY, bW, bH, 20);
  ctx.fillStyle = bgd;
  ctx.fill();
  ctx.restore();
  ctx.font = "bold 30px sans-serif";
  ctx.textBaseline = "middle";
  const label = "START";
  const lw = ctx.measureText(label).width;
  const tx = bX + (bW - (lw + 26 + 16)) / 2;
  const tyc = bY + bH / 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(tx, tyc - 10);
  ctx.lineTo(tx + 16, tyc);
  ctx.lineTo(tx, tyc + 10);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillText(label, tx + 26, tyc + 1);

  return toPNG(canvas);
}

/* ------------------------------------------------------------------ */
/*  6. renderFfDuo — duo-mode versus card                              */
/* ------------------------------------------------------------------ */

export async function renderFfDuo({ p1, p2 } = {}) {
  const n1 = asText(p1, "renderFfDuo needs player 1's name");
  const n2 = asText(p2, "renderFfDuo needs player 2's name");
  const H = 880;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#181b21");
  bg.addColorStop(1, "#0f1115");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 120, 30, W / 2, 120, 480);
  glow.addColorStop(0, "rgba(255,107,0,0.16)");
  glow.addColorStop(1, "rgba(255,107,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  /* header */
  ctx.font = "bold 46px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ff6b00";
  ctx.fillText("DUO MODE", W / 2, 56);
  const hw = ctx.measureText("DUO MODE").width;
  ctx.strokeStyle = "rgba(255,107,0,0.55)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(W / 2 + hw / 2 + 26, 84);
  ctx.lineTo(W / 2 + hw / 2 + 106, 84);
  ctx.moveTo(W / 2 - hw / 2 - 26, 84);
  ctx.lineTo(W / 2 - hw / 2 - 106, 84);
  ctx.stroke();
  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = "#9aa3ae";
  ctx.fillText("TEAM UP • 2 PLAYERS", W / 2, 120);

  /* VS divider */
  const cy = 400;
  const r = 112;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2, cy - 150);
  ctx.lineTo(W / 2, cy + 150);
  ctx.stroke();

  const avatar = (ax, c1, c2, label, tag) => {
    const g = ctx.createLinearGradient(ax, cy - r, ax, cy + r);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.beginPath();
    ctx.arc(ax, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,107,0,0.5)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(ax, cy, r + 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ax, cy, r + 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 62px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#241303";
    ctx.fillText(initialOf(label), ax, cy + 2);
    ctx.font = "bold 26px sans-serif";
    ctx.fillStyle = "#f4f6f8";
    ctx.textBaseline = "top";
    ctx.fillText(ellipsize(ctx, label, 250), ax, cy + r + 34);
    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "#8f98a3";
    ctx.fillText(tag, ax, cy + r + 74);
  };

  avatar(216, "#ffb14e", "#ff6b00", n1, "PLAYER 1");
  avatar(504, "#ffd08a", "#ff8a1e", n2, "PLAYER 2");

  /* VS badge on top of the divider */
  ctx.beginPath();
  ctx.arc(W / 2, cy, 42, 0, Math.PI * 2);
  ctx.fillStyle = "#15181d";
  ctx.fill();
  ctx.strokeStyle = "#ff6b00";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = "#ff6b00";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VS", W / 2, cy + 1);

  /* bottom banner */
  roundRect(ctx, 44, 710, W - 88, 88, 20);
  ctx.fillStyle = "rgba(255,107,0,0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,107,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = "#ff9d3f";
  ctx.fillText("SQUAD READY • 2/2", W / 2, 710 + 44);

  return toPNG(canvas);
}

/* ------------------------------------------------------------------ */
/*  7. renderFfGirl — character card                                   */
/* ------------------------------------------------------------------ */

export async function renderFfGirl({ name } = {}) {
  const nm = asText(name, "renderFfGirl needs a character name").toUpperCase();
  const H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  /* vertical purple → pink gradient */
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#7b2ff7");
  bg.addColorStop(1, "#f107a3");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* sparkle dots */
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  const dots = [
    [80, 120, 3],
    [660, 90, 2.5],
    [620, 240, 2],
    [110, 300, 2.5],
    [680, 540, 2.5],
    [60, 640, 2],
    [640, 960, 3],
    [90, 1010, 2.5],
    [520, 80, 2],
  ];
  for (const [dx, dy, dr] of dots) {
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, Math.PI * 2);
    ctx.fill();
  }

  /* decorative stars */
  drawStar(ctx, 96, 170, 24, "rgba(255,255,255,0.9)");
  drawStar(ctx, 628, 150, 18, "rgba(255,209,102,0.95)");
  drawStar(ctx, 664, 330, 13, "rgba(255,255,255,0.8)");
  drawStar(ctx, 66, 420, 15, "rgba(255,209,102,0.9)");
  drawStar(ctx, 612, 880, 20, "rgba(255,255,255,0.85)");
  drawStar(ctx, 104, 940, 16, "rgba(255,209,102,0.9)");

  /* big central avatar */
  const acx = W / 2;
  const acy = 440;
  const r = 180;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(acx, acy, r + 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(acx, acy, r + 40, 0, Math.PI * 2);
  ctx.stroke();

  const face = ctx.createLinearGradient(0, acy - r, 0, acy + r);
  face.addColorStop(0, "#ffe3cf");
  face.addColorStop(1, "#f3bd93");
  ctx.beginPath();
  ctx.arc(acx, acy, r, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.stroke();

  /* simple face: two eyes + smile (+ blush) */
  ctx.fillStyle = "rgba(255,111,156,0.4)";
  ctx.beginPath();
  ctx.arc(acx - 100, acy + 35, 18, 0, Math.PI * 2);
  ctx.arc(acx + 100, acy + 35, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#332746";
  roundRect(ctx, acx - 66 - 8, acy - 25 - 15, 16, 30, 8);
  ctx.fill();
  roundRect(ctx, acx + 66 - 8, acy - 25 - 15, 16, 30, 8);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(acx - 66 + 3, acy - 32, 4.5, 0, Math.PI * 2);
  ctx.arc(acx + 66 + 3, acy - 32, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#332746";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(acx, acy + 18, 48, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();

  /* name banner ribbon across the lower third */
  ctx.fillStyle = "rgba(24,10,38,0.88)";
  ctx.fillRect(0, 700, W, 104);
  ctx.fillStyle = "#ff9d3f";
  ctx.fillRect(0, 700, W, 4);
  ctx.fillRect(0, 800, W, 4);
  drawStar(ctx, 46, 752, 16, "#ffd166");
  drawStar(ctx, 674, 752, 16, "#ffd166");

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 46px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(ellipsize(ctx, nm, 560), acx, 742);
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = "#ffb14e";
  ctx.fillText(spaced("CHARACTER CARD"), acx, 780);

  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(spaced("GIRL SQUAD"), acx, 880);

  return toPNG(canvas);
}

/* ------------------------------------------------------------------ */
/*  8. renderReceipt — Nigerian payment receipt                        */
/* ------------------------------------------------------------------ */

export async function renderReceipt({ shop, customer, items, total, ref, date } = {}) {
  const shopName = asText(shop, "renderReceipt needs a shop name");
  if (!Array.isArray(items) || !items.length) fail("renderReceipt needs an items array");
  const rows = items.map((it, i) => {
    if (!it || typeof it !== "object") {
      fail(`Item ${i + 1} must be an object like { name, amount }`);
    }
    const nm = optText(it.name) || `Item ${i + 1}`;
    const raw = it.amount !== undefined ? it.amount : it.price;
    if (raw === undefined || raw === null || raw === "") {
      fail(`Item ${i + 1} ("${nm}") needs a numeric amount`);
    }
    const amt = Number(raw);
    if (!Number.isFinite(amt)) fail(`Item ${i + 1} ("${nm}") needs a numeric amount`);
    return { nm, amt };
  });
  if (total === undefined || total === null || total === "") {
    fail("renderReceipt needs a total amount");
  }
  const totalNum = Number(total);
  if (!Number.isFinite(totalNum)) fail("renderReceipt needs a total amount (number)");
  const cust = optText(customer) || "—";
  const refNo = optText(ref) || "—";
  const when = optText(date) || "—";
  const cur = nairaPrefix();

  /* paper with a light grey edge shadow */
  const PW = W - 16;
  const MAX_ROWS = 14;
  const hidden = Math.max(0, rows.length - MAX_ROWS);
  const visible = rows.slice(0, MAX_ROWS);
  const HEADER = 196;
  const ROW_H = 42;
  const TOTAL_H = 88;
  const FOOT_H = 214;
  const contentH = HEADER + visible.length * ROW_H + (hidden ? 34 : 0) + TOTAL_H + FOOT_H;
  const H = Math.max(950, Math.min(2200, contentH + 48));
  const PH = H - 16;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#d8dbdf";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(60,64,72,0.12)";
  ctx.fillRect(8, 8, PW + 8, PH + 8);
  ctx.fillStyle = "rgba(60,64,72,0.16)";
  ctx.fillRect(12, 12, PW + 4, PH + 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PW, PH);
  ctx.strokeStyle = "#e3e5e9";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, PW - 1, PH - 1);

  const ML = 46;
  const MR = PW - 46;

  /* header */
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "bold 42px sans-serif";
  ctx.fillStyle = "#111111";
  ctx.fillText(ellipsize(ctx, shopName, 560), PW / 2, 56);
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#5f6368";
  ctx.fillText(spaced("OFFICIAL RECEIPT"), PW / 2, 114);
  dashedRule(ctx, ML, MR, 150, "#b8bcc2", 8, 7, 2);
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = "#8a8f96";
  ctx.textAlign = "left";
  ctx.fillText("ITEM", ML, 168);
  ctx.textAlign = "right";
  ctx.fillText(cur === "₦" ? "AMOUNT" : "AMOUNT (NGN)", MR, 168);

  /* item rows */
  let y = HEADER;
  for (const r of visible) {
    ctx.textAlign = "left";
    ctx.font = "19px sans-serif";
    ctx.fillStyle = "#1c1c1c";
    ctx.fillText(ellipsize(ctx, r.nm, 400), ML, y + 8);
    ctx.textAlign = "right";
    ctx.font = "bold 19px sans-serif";
    ctx.fillText(`${cur}${fmtAmount(r.amt)}`, MR, y + 8);
    y += ROW_H;
  }
  if (hidden) {
    ctx.textAlign = "left";
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#8a8f96";
    ctx.fillText(`+ ${hidden} more item(s) not shown`, ML, y + 10);
    y += 34;
  }

  /* TOTAL with double border above */
  y += 18;
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ML, y);
  ctx.lineTo(MR, y);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ML, y + 5);
  ctx.lineTo(MR, y + 5);
  ctx.stroke();
  y += 18;
  ctx.fillStyle = "#111111";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("TOTAL", ML, y);
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${cur}${fmtAmount(totalNum)}`, MR, y - 3);

  /* footer block anchored to the bottom of the paper */
  const footerTop = PH - 48 - 26 - 3 * 40;
  dashedRule(ctx, ML, MR, footerTop - 18, "#b8bcc2");
  const foot = [
    ["CUSTOMER", cust],
    ["REF", refNo],
    ["DATE", when],
  ];
  let fy = footerTop;
  for (const [k, v] of foot) {
    ctx.textAlign = "left";
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#8a8f96";
    ctx.fillText(k, ML, fy + 5);
    ctx.font = "bold 19px sans-serif";
    ctx.fillStyle = "#111111";
    ctx.fillText(ellipsize(ctx, v, MR - ML - 160), ML + 150, fy);
    fy += 40;
  }
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#6f747b";
  ctx.textAlign = "center";
  ctx.fillText("Thank you for your patronage!", PW / 2, PH - 52);

  return toPNG(canvas);
}
