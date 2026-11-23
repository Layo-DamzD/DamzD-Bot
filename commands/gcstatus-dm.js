import {
  listGroupStatusColors,
  parseGroupStatusColor,
  postQuotedGroupStatus
} from "../lib/group-status.js";

const GROUPS_PER_PAGE = 20;

function safeGroupName(value) {
  return String(value || "Unnamed group")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 70) || "Unnamed group";
}

async function fetchJoinedGroups(sock) {
  if (typeof sock.groupFetchAllParticipating !== "function") {
    throw new Error("This WhatsApp connection cannot list joined groups.");
  }
  const result = await sock.groupFetchAllParticipating();
  return Object.entries(result || {})
    .map(([key, value]) => ({
      id: String(value?.id || key || "").trim(),
      subject: safeGroupName(value?.subject)
    }))
    .filter(group => group.id.endsWith("@g.us"))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
}

async function replyWithGroups(ctx, groups, requestedPage = 1) {
  const pageCount = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  const start = (page - 1) * GROUPS_PER_PAGE;
  const lines = groups.slice(start, start + GROUPS_PER_PAGE).map((group, index) =>
    (start + index + 1) + ". " + group.subject + "\n   " + group.id
  );

  if (!groups.length) {
    await ctx.reply("No WhatsApp groups were found for this connected account.");
    return;
  }

  await ctx.reply(
    "📋 *GCSTATUS DM — YOUR GROUPS*\n" +
    "Joined groups: " + groups.length + "\n" +
    "Page " + page + "/" + pageCount + "\n\n" +
    lines.join("\n\n") +
    "\n\nPost text: " + ctx.config.prefix + "gcstatusdm <number> <text>" +
    "\nPost replied media: reply to media with " + ctx.config.prefix + "gcstatusdm <number> [caption]" +
    "\nNext page: " + ctx.config.prefix + "gcstatusdm list " + Math.min(page + 1, pageCount) +
    "\n\nUse a group number or the group JID shown above."
  );
}

export default {
  name: "gcstatusdm",
  aliases: ["dmgcstatus"],
  category: "Status",
  description: "Post a group status from a private chat with FEI XMD.",
  run: async ctx => {
    if (String(ctx.jid || "").endsWith("@g.us")) {
      await ctx.reply("Use " + ctx.config.prefix + "gcstatusdm in a private chat with FEI XMD.");
      return;
    }
    if (!ctx.owner) {
      await ctx.reply("⛔ Only the configured bot owner can use this command.");
      return;
    }

    const raw = String(ctx.args || "").trim();
    if (!raw || /^(help|--help)$/i.test(raw)) {
      await ctx.reply(
        "📣 *GCSTATUS DM*\n\n" +
        "1. List joined groups: " + ctx.config.prefix + "gcstatusdm list\n" +
        "2. Post text: " + ctx.config.prefix + "gcstatusdm 1 Hello everyone!\n" +
        "3. Choose a background: " + ctx.config.prefix + "gcstatusdm 1 --color blue Hello!\n" +
        "4. Show colors: " + ctx.config.prefix + "gcstatusdm colors\n" +
        "5. Post replied media: reply to regular image/video/audio/sticker with " +
        ctx.config.prefix + "gcstatusdm 1 [caption]\n\n" +
        "Text statuses use a different random background by default. View-once media is not reposted."
      );
      return;
    }

    const selector = raw.split(/\s+/)[0];
    const rest = raw.slice(selector.length).trim();

    if (selector.toLowerCase() === "colors") {
      await ctx.reply("🎨 *GROUP STATUS BACKGROUND COLORS*\n\n" + listGroupStatusColors());
      return;
    }

    let groups;
    try {
      groups = await fetchJoinedGroups(ctx.sock);
    } catch (error) {
      await ctx.reply("⚠️ Could not fetch your groups: " +
        String(error?.message || error).slice(0, 200));
      return;
    }

    if (selector.toLowerCase() === "list") {
      const page = rest ? rest.split(/\s+/)[0] : 1;
      await replyWithGroups(ctx, groups, page);
      return;
    }

    let target;
    if (/^\d+$/.test(selector)) {
      const index = Number(selector) - 1;
      if (index < 0 || index >= groups.length) {
        await ctx.reply("That group number is not in the list. Run " + ctx.config.prefix + "gcstatusdm list.");
        return;
      }
      target = groups[index];
    } else if (selector.endsWith("@g.us")) {
      target = groups.find(group => group.id === selector);
      if (!target) {
        await ctx.reply("That group JID is not in this account's joined groups. Run " +
          ctx.config.prefix + "gcstatusdm list.");
        return;
      }
    } else {
      await ctx.reply("Invalid group selector. Run " + ctx.config.prefix +
        "gcstatusdm list, then use a group number or JID.");
      return;
    }

    const parsed = parseGroupStatusColor(rest);
    if (parsed.error) {
      await ctx.reply("⚠️ " + parsed.error + "\nRun " +
        ctx.config.prefix + "gcstatusdm colors to see the palette.");
      return;
    }

    try {
      const posted = await postQuotedGroupStatus(ctx, target.id, parsed.text, parsed);
      const background = posted.color
        ? "\nBackground: " + posted.color.name + " (" + posted.color.hex + ")"
        : "";
      await ctx.reply("✅ Group status posted successfully.\nGroup: " + target.subject +
        background + "\n\n⚡ *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴇɴꜰᴇɪ ᴛᴇᴄʜ*");
    } catch (error) {
      await ctx.reply("⚠️ Failed to post status to " + target.subject + ": " +
        String(error?.message || error).slice(0, 220));
    }
  }
};
