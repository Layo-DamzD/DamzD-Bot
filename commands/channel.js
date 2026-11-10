function extractChannelCode(input) {
  const match = String(input || "").match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : "";
}

async function resolveChannel(ctx, input) {
  let code = extractChannelCode(input);
  if (!code) code = String(input || "").trim();
  if (!code) throw new Error("send a channel link like https://whatsapp.com/channel/0029Va…");
  if (code.endsWith("@newsletter")) return { jid: code, name: "channel" };
  const meta = await ctx.sock.newsletterMetadata("invite", code);
  if (!meta?.id) throw new Error("I could not resolve that channel link");
  const name = meta?.thread_metadata?.name?.text || meta?.name || "channel";
  return { jid: meta.id, name };
}

function followedList(ctx) {
  return ctx.store.get("channels:followed", []);
}

function rememberChannel(ctx, jid, name) {
  const list = followedList(ctx).filter(item => item.jid !== jid);
  list.push({ jid, name: String(name || "channel").slice(0, 60) });
  ctx.store.set("channels:followed", list);
  ctx.store.set("channels:last", jid);
}

async function latestServerId(ctx, jid) {
  const payload = await ctx.sock.newsletterFetchMessages(jid, 1, 0, 0);
  const messages = payload?.messages || payload?.result?.messages || [];
  const first = Array.isArray(messages) ? messages[0] : null;
  if (!first) throw new Error("I could not see any post on that channel");
  return String(first.server_id || first.serverId || String(first.id || "").split("_").pop() || "");
}

export default [
  {
    name: "cfollow",
    aliases: ["chfollow"],
    category: "Channel",
    description: "follow a WhatsApp channel from its link",
    run: async ctx => {
      const arg = String(ctx.args || "").trim();
      const { jid, name } = await resolveChannel(ctx, arg);
      await ctx.sock.newsletterFollow(jid);
      rememberChannel(ctx, jid, name);
      await ctx.reply("Following *" + name + "* now. ✅");
    }
  },
  {
    name: "cunfollow",
    category: "Channel",
    description: "unfollow a channel, or all with 'all'",
    run: async ctx => {
      const arg = String(ctx.args || "").trim();
      if (arg.toLowerCase() === "all") {
        const list = followedList(ctx);
        for (const channel of list) {
          try { await ctx.sock.newsletterUnfollow(channel.jid); } catch { /* keep going */ }
        }
        ctx.store.set("channels:followed", []);
        await ctx.reply("Unfollowed " + list.length + " channel" + (list.length === 1 ? "" : "s") + ".");
        return;
      }
      const { jid, name } = await resolveChannel(ctx, arg);
      await ctx.sock.newsletterUnfollow(jid);
      ctx.store.set("channels:followed", followedList(ctx).filter(item => item.jid !== jid));
      await ctx.reply("Unfollowed *" + name + "*.");
    }
  },
  {
    name: "channels",
    aliases: ["chlist"],
    category: "Channel",
    description: "list the channels I follow",
    run: async ctx => {
      const list = followedList(ctx);
      if (!list.length) {
        await ctx.reply("I am not following any channels. Send " + ctx.config.prefix + "cfollow with a channel link to add one.");
        return;
      }
      await ctx.reply(
        "📢 Channels I follow:\n" +
        list.map((channel, index) => (index + 1) + ". " + channel.name + " (`" + channel.jid + "`)").join("\n")
      );
    }
  },
  {
    name: "cstatus",
    category: "Channel",
    description: "channel automation state for this account",
    run: async ctx => {
      const list = followedList(ctx);
      await ctx.reply(
        "📢 *Channel status*\n" +
        "Following: " + list.length + " channel" + (list.length === 1 ? "" : "s") + "\n" +
        "Session: 1 (this linked device)"
      );
    }
  },
  {
    name: "cpost",
    category: "Channel",
    description: "post to a channel you own: link | text",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      const [link, ...rest] = raw.split("|");
      const text = rest.join("|").trim();
      if (!link || !text) throw new Error("usage: " + ctx.config.prefix + "cpost <channel link> | your message");
      const { jid, name } = await resolveChannel(ctx, link);
      try {
        await ctx.sock.sendMessage(jid, { text });
        await ctx.reply("Posted to *" + name + "*. ✅");
      } catch {
        throw new Error("I could not post there — you need to own or admin that channel");
      }
    }
  },
  {
    name: "creact",
    aliases: ["chreact", "massreact", "mreact", "reactall"],
    category: "Channel",
    description: "react to a channel's latest post: link | emoji",
    run: async ctx => {
      const raw = String(ctx.args || "").trim();
      const [target, ...rest] = raw.split(/\s+/);
      const emoji = (rest.join(" ").match(/^\p{Extended_Pictographic}/u) || [rest.join(" ").trim()])[0] || "👍";
      let jid = "";
      let name = "channel";
      if (target && (extractChannelCode(target) || target.endsWith("@newsletter"))) {
        const resolved = await resolveChannel(ctx, target);
        jid = resolved.jid;
        name = resolved.name;
      } else {
        const stored = ctx.store.get("channels:last", "");
        const list = followedList(ctx);
        jid = target.endsWith("@newsletter") ? target : (stored || list[list.length - 1]?.jid || "");
        name = list.find(item => item.jid === jid)?.name || name;
        if (!jid) throw new Error("send the channel link, e.g. " + ctx.config.prefix + "creact <link> 🔥");
      }
      const serverId = await latestServerId(ctx, jid);
      await ctx.sock.newsletterReactMessage(jid, serverId, emoji);
      await ctx.reply("Reacted " + emoji + " to the latest post on *" + name + "*. (One account — this device.)");
    }
  },
  {
    name: "cvote",
    aliases: ["chvote", "pollvote", "massvote", "mvote", "voteall"],
    category: "Channel",
    description: "channel poll voting info",
    run: async ctx => {
      await ctx.reply(
        "Channel polls are encrypted in a way my library cannot vote on reliably yet — WhatsApp only exposes poll votes to the official apps for now.\n" +
        "Everything else channel-side works: " + ctx.config.prefix + "cfollow, " + ctx.config.prefix + "creact, " + ctx.config.prefix + "cpost."
      );
    }
  },
  {
    name: "msessions",
    aliases: ["msess", "sessioncount"],
    category: "Channel",
    description: "how many sessions are live",
    run: async ctx => {
      await ctx.reply("1 session is live — this linked device (" + ctx.config.name + ").");
    }
  }
];
