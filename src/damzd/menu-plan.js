// The DamzD command list — EVERY command in the build is shown on .menu.
// Sections follow the deployed v1.4.45 DamzD menu layout first (AI & Chat,
// Channel, Downloads, …, Tools), then our anime and canvas extras. Nothing
// is hidden: applyMenuPlan() only hides a command if its category is not
// covered by any section, which should never happen.
export const MENU_SECTIONS = [
  { title: "💬 ᴀɪ & ᴄʜᴀᴛ", categories: ["AI & Chat"] },
  { title: "📢 ᴄʜᴀɴɴᴇʟ", categories: ["Channel"] },
  { title: "📥 ᴅᴏᴡɴʟᴏᴀᴅs", categories: ["Downloads"] },
  { title: "🎮 ɢᴀᴍᴇs", categories: ["Games"] },
  { title: "🎉 ғᴜɴ", categories: ["Fun"] },
  { title: "🤖 ɢᴇɴᴇʀᴀʟ", categories: ["General"] },
  { title: "👥 ɢʀᴏᴜᴘ", categories: ["Group"] },
  { title: "🎨 ᴀɪ ᴍᴇᴅɪᴀ", categories: ["AI Media", "Canvas"] },
  { title: "📰 ɴᴇᴡs", categories: ["News"] },
  { title: "👑 ᴏᴡɴᴇʀ", categories: ["Owner"] },
  { title: "🔒 ᴘʀɪᴠᴀᴄʏ", categories: ["Privacy", "Chat & Privacy"] },
  { title: "📱 sᴛᴀᴛᴜs", categories: ["Status"] },
  { title: "🛠 ᴛᴏᴏʟs", categories: ["Tools", "Media & Tools"] },
  // Anime sections removed in v2.2.0 — the owner pulled the whole anime
  // category (anime-v2.js deleted).
];

// Hide anything not covered by a section (currently nothing). Kept for
// compatibility with local.js and the dashboard count.
export function applyMenuPlan(commands) {
  const covered = new Set(MENU_SECTIONS.flatMap(section => section.categories || []));
  let hiddenCount = 0;
  for (const command of commands) {
    if (!covered.has(String(command.category || "").trim())) {
      command.hidden = true;
      hiddenCount += 1;
    }
  }
  return hiddenCount;
}
