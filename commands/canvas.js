import {
  renderChat, renderQuote, renderNokia, renderMeme,
  renderFfLobby, renderFfDuo, renderFfGirl, renderReceipt
} from "../src/canvas.js";

function splitArgs(args, parts) {
  const segments = String(args || "").split("|").map(value => value.trim()).filter(Boolean);
  return segments;
}

function naira(value) {
  return "₦" + Number(value || 0).toLocaleString("en-NG");
}

export default [
  {
    name: "fakettc",
    aliases: ["fakechat"],
    category: "Canvas",
    description: "fake chat screenshot: Title | them: text | you: text",
    run: async ctx => {
      const segments = splitArgs(ctx.args);
      if (segments.length < 2) {
        throw new Error("usage: " + ctx.config.prefix + "fakettc Chats | ada: good morning | me: morning! how was your night");
      }
      const title = segments[0].slice(0, 40);
      const messages = segments.slice(1).slice(0, 14).map(segment => {
        const colon = segment.indexOf(":");
        if (colon > 0 && colon < 20) {
          const name = segment.slice(0, colon).trim();
          const lower = name.toLowerCase();
          const mine = lower === "me" || lower === "you" || lower === "mine";
          return { name: mine ? "" : name.slice(0, 18), text: segment.slice(colon + 1).trim().slice(0, 240), mine };
        }
        return { name: "", text: segment.slice(0, 240), mine: false };
      });
      await ctx.typing(1200);
      const buffer = await renderChat({ title, messages });
      await ctx.send({ image: buffer, caption: "Generated chat screenshot." });
    }
  },
  {
    name: "canvasquote",
    category: "Canvas",
    description: "quote card: text | author",
    run: async ctx => {
      const [text, author] = splitArgs(ctx.args);
      if (!text) throw new Error("usage: " + ctx.config.prefix + "canvasquote stay consistent | DamzD");
      await ctx.typing(1200);
      const buffer = await renderQuote({ text: text.slice(0, 400), author: (author || "").slice(0, 40), style: "plain" });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "iqc",
    category: "Canvas",
    description: "iPhone-style quote: text | author",
    run: async ctx => {
      const [text, author] = splitArgs(ctx.args);
      if (!text) throw new Error("usage: " + ctx.config.prefix + "iqc do it scared | unknown");
      await ctx.typing(1200);
      const buffer = await renderQuote({ text: text.slice(0, 400), author: (author || "").slice(0, 40), style: "iphone" });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "wndwqute",
    aliases: ["windowquote"],
    category: "Canvas",
    description: "Windows-style quote box",
    run: async ctx => {
      const [text, author] = splitArgs(ctx.args);
      if (!text) throw new Error("usage: " + ctx.config.prefix + "wndwqute hello world | DamzD");
      await ctx.typing(1200);
      const buffer = await renderQuote({ text: text.slice(0, 400), author: (author || "").slice(0, 40), style: "window" });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "nokiamsg",
    category: "Canvas",
    description: "old Nokia message screen",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("give me the message text for the Nokia screen");
      await ctx.typing(1200);
      const buffer = await renderNokia({ text: text.slice(0, 300) });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "meme2",
    category: "Canvas",
    description: "classic meme: top text | bottom text",
    run: async ctx => {
      const [top, bottom] = splitArgs(ctx.args);
      if (!top) throw new Error("usage: " + ctx.config.prefix + "meme2 when the wifi returns | everybody rushes");
      await ctx.typing(1200);
      const buffer = await renderMeme({ top: top.slice(0, 120), bottom: (bottom || "").slice(0, 120) });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "fakeff",
    category: "Canvas",
    description: "Free Fire style lobby card",
    run: async ctx => {
      const player = String(ctx.args || "").trim().slice(0, 24);
      if (!player) throw new Error("give me a player name for the lobby");
      await ctx.typing(1200);
      const buffer = await renderFfLobby({ player });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "fakeffduo",
    category: "Canvas",
    description: "duo lobby: player 1 | player 2",
    run: async ctx => {
      const [p1, p2] = splitArgs(ctx.args);
      if (!p1 || !p2) throw new Error("usage: " + ctx.config.prefix + "fakeffduo DamzD | Ada");
      await ctx.typing(1200);
      const buffer = await renderFfDuo({ p1: p1.slice(0, 24), p2: p2.slice(0, 24) });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "ffgirl",
    category: "Canvas",
    description: "game-style character card",
    run: async ctx => {
      const name = String(ctx.args || "").trim().slice(0, 24);
      if (!name) throw new Error("give me the character name");
      await ctx.typing(1200);
      const buffer = await renderFfGirl({ name });
      await ctx.send({ image: buffer });
    }
  },
  {
    name: "receipt",
    category: "Canvas",
    description: "payment receipt: Shop | Customer | item:amount | ...",
    run: async ctx => {
      const segments = splitArgs(ctx.args);
      if (segments.length < 3) {
        throw new Error("usage: " + ctx.config.prefix + "receipt Mama T Shop | DamzD | rice:3500 | chicken:6000");
      }
      const shop = segments[0].slice(0, 40);
      const customer = segments[1].slice(0, 40);
      const items = [];
      for (const segment of segments.slice(2, 22)) {
        const colon = segment.lastIndexOf(":");
        const amount = colon > -1 ? Number(segment.slice(colon + 1).replace(/[^0-9.]/g, "")) : NaN;
        const name = (colon > -1 ? segment.slice(0, colon) : segment).trim();
        if (!name || !Number.isFinite(amount)) throw new Error("each item looks like item:amount, e.g. rice:3500");
        items.push({ name: name.slice(0, 40), amount });
      }
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      const ref = "DZ" + Date.now().toString().slice(-8);
      await ctx.typing(1200);
      const buffer = await renderReceipt({
        shop,
        customer,
        items,
        total,
        ref,
        date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos" })
      });
      await ctx.send({ image: buffer, caption: "Receipt " + ref + " — total " + naira(total) });
    }
  }
];
