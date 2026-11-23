// The Channel section: WhatsApp channel (newsletter) management — follow,
// unfollow, list, post, react and session overview — on top of the Baileys
// newsletter APIs.
import { unicodeBox, withPoweredFooter } from "../lib/api-client.js";

const CHANNEL_LINK = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i;

function inviteCode(value) {
  const match = String(value || "").trim().match(CHANNEL_LINK);
  if (!match) throw new Error("Send a channel link like https://whatsapp.com/channel/0029VaBcDeFgHi");
  return match[1];
}

function newsletterJids(sock) {
  const chats = sock?.chats;
  const jids = [];
  if (chats && typeof chats.forEach === "function") {
    chats.forEach((chat, key) => jids.push(String(key)));
  } else if (chats && typeof chats === "object") {
    jids.push(...Object.keys(chats));
  }
  return [...new Set(jids.filter(jid => jid.endsWith("@newsletter")))];
}

async function resolveNewsletter(ctx, value, label = "channel") {
  const code = inviteCode(value);
  const meta = await ctx.sock.newsletterMetadata("invite", code);
  if (!meta?.id) throw new Error("WhatsApp did not recognise that " + label + " link.");
  return meta;
}

function channelLine(meta) {
  const name = String(meta?.name || meta?.thread?.name || "Unnamed channel").slice(0, 60);
  const followers = meta?.thread?.subscribersCount ?? meta?.subscribersCount;
  return [
    "📣 " + name,
    "🆔 " + meta.id,
    meta?.thread?.description ? "📝 " + String(meta.thread.description).slice(0, 160) : "",
    Number.isFinite(Number(followers)) ? "👥 " + followers + " follower(s)" : ""
  ].filter(Boolean).join("\n");
}

const commands = [
  {
    name: "cfollow",
    category: "Channel",
    description: "Follow a WhatsApp channel from its link.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      if (!raw) throw new Error("Usage: " + ctx.config.prefix + "cfollow https://whatsapp.com/channel/...");
      const meta = await resolveNewsletter(ctx, raw);
      await ctx.sock.newsletterFollow(meta.id);
      await ctx.reply("✅ Now following *" + String(meta.name || meta.id).slice(0, 60) + "*\n🆔 " + meta.id);
    }
  },
  {
    name: "cunfollow",
    category: "Channel",
    description: "Unfollow a channel, or all with 'all'.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim().toLowerCase();
      if (!raw) throw new Error("Usage: " + ctx.config.prefix + "cunfollow <link-or-jid>\nOr unfollow everything: " +
        ctx.config.prefix + "cunfollow all");
      if (raw === "all") {
        const jids = newsletterJids(ctx.sock);
        if (!jids.length) throw new Error("No followed channels were found in this account's chat list.");
        let count = 0;
        for (const jid of jids) {
          try {
            await ctx.sock.newsletterUnfollow(jid);
            count += 1;
          } catch { /* keep unfollowing the rest */ }
        }
        await ctx.reply("👋 Unfollowed " + count + " channel(s).");
        return;
      }
      const jid = raw.endsWith("@newsletter") ? raw : (await resolveNewsletter(ctx, raw)).id;
      await ctx.sock.newsletterUnfollow(jid);
      await ctx.reply("👋 Unfollowed " + jid + ".");
    }
  },
  {
    name: "channels",
    category: "Channel",
    description: "List the channels I follow.",
    run: async ctx => {
      const jids = newsletterJids(ctx.sock);
      if (!jids.length) {
        await ctx.reply("No followed channels appear in this account's chat list yet. Follow one with " +
          ctx.config.prefix + "cfollow <link>.");
        return;
      }
      const lines = [];
      for (const jid of jids.slice(0, 25)) {
        const chat = ctx.sock?.chats?.[jid];
        const name = String(chat?.name || jid).slice(0, 60);
        lines.push("• " + name + " — " + jid);
      }
      if (jids.length > 25) lines.push("… and " + (jids.length - 25) + " more.");
      await ctx.reply(withPoweredFooter(unicodeBox("📢 FOLLOWED CHANNELS", lines.join("\n"), { footer: false }), 2500));
    }
  },
  {
    name: "cstatus",
    category: "Channel",
    description: "Channel automation state for this account.",
    run: async ctx => {
      const jids = newsletterJids(ctx.sock);
      await ctx.reply([
        "📢 *CHANNEL STATE*",
        "Followed channels visible: " + jids.length,
        "Owner posting: available with " + ctx.config.prefix + "cpost <link> <text>",
        "Reactions: " + ctx.config.prefix + "creact <link> <emoji>",
        "",
        "_DamzD stays passive with channels: nothing is auto-posted or auto-reacted._"
      ].join("\n"));
    }
  },
  {
    name: "cpost",
    category: "Channel",
    description: "Post to a channel you own: link | text",
    run: async ctx => {
      const raw = String(ctx.args || "");
      const separator = raw.indexOf("|");
      const link = raw.slice(0, separator < 0 ? raw.length : separator).trim();
      const body = separator >= 0 ? raw.slice(separator + 1).trim() : "";
      if (!body) throw new Error("Usage: " + ctx.config.prefix + "cpost <channel link> | the announcement text");
      if (body.length > 2000) throw new Error("Keep the channel post under 2000 characters.");
      const meta = await resolveNewsletter(ctx, link);
      await ctx.sock.sendMessage(meta.id, { text: body });
      await ctx.reply("🚀 Posted to *" + String(meta.name || meta.id).slice(0, 60) + "*.");
    }
  },
  {
    name: "creact",
    category: "Channel",
    description: "React to a channel's latest post: link | emoji",
    run: async ctx => {
      const raw = String(ctx.args || "");
      const separator = raw.indexOf("|");
      const link = raw.slice(0, separator < 0 ? raw.length : separator).trim();
      const emoji = separator >= 0 ? raw.slice(separator + 1).trim() : "";
      if (!emoji) throw new Error("Usage: " + ctx.config.prefix + "creact <channel link> | 🔥");
      if ([...emoji].length > 8 || !/\p{Extended_Pictographic}/u.test(emoji)) {
        throw new Error("Send a single emoji to react with, e.g. 🔥");
      }
      const meta = await resolveNewsletter(ctx, link);
      const feed = await ctx.sock.newsletterFetchMessages(meta.id, 1, 0, 0);
      const posts = feed?.posts ?? feed?.messages ?? feed?.items ?? [];
      const latest = Array.isArray(posts) ? posts[0] : null;
      const serverId = latest?.server_id || latest?.serverId || latest?.id;
      if (!serverId) throw new Error("No channel message was returned to react to. Try again later.");
      await ctx.sock.newsletterReactMessage(meta.id, String(serverId), emoji);
      await ctx.reply("🔥 Reacted " + emoji + " to the latest post in *" +
        String(meta.name || meta.id).slice(0, 60) + "*.");
    }
  },
  {
    name: "cvote",
    category: "Channel",
    description: "Channel poll voting info.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      if (!raw) throw new Error("Usage: " + ctx.config.prefix + "cvote <channel link>");
      const meta = await resolveNewsletter(ctx, raw);
      const feed = await ctx.sock.newsletterFetchMessages(meta.id, 5, 0, 0);
      const posts = feed?.posts ?? feed?.messages ?? feed?.items ?? [];
      const withPolls = (Array.isArray(posts) ? posts : [])
        .filter(post => post?.message?.pollCreationMessage || post?.pollCreationMessage)
        .slice(0, 5);
      if (!withPolls.length) {
        await ctx.reply("📊 No polls were found among the latest channel posts.");
        return;
      }
      const lines = withPolls.map((post, index) => {
        const poll = post?.message?.pollCreationMessage || post?.pollCreationMessage;
        return (index + 1) + ". " + String(poll?.name || "(untitled poll)").slice(0, 120) +
          "\n   Server ID: " + (post?.server_id || post?.serverId || "?") +
          "\n   _Votes stay on the channel owner's side; DamzD can send votes via the channel UI._";
      });
      await ctx.reply(withPoweredFooter(unicodeBox("📊 CHANNEL POLLS — " + String(meta.name || "").slice(0, 40), lines.join("\n\n"), { footer: false }), 2500));
    }
  },
  {
    name: "msessions",
    category: "Channel",
    description: "How many sessions are live.",
    run: async ctx => {
      const connected = Boolean(ctx.sock?.user);
      await ctx.reply([
        "🔌 *WHATSAPP SESSIONS*",
        "Live WhatsApp session: 1 (" + (connected ? "connected ✅" : "not connected ⛔") + ")",
        connected ? "Logged in as: +" + String(ctx.sock.user.id || "").split("@")[0].replace(/\D/g, "") : "",
        "",
        "_This build runs one primary WhatsApp session; the pairing dashboard shares its state._"
      ].filter(Boolean).join("\n"));
    }
  }
];

export default commands;
