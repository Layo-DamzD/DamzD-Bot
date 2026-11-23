import { MENU_SECTIONS } from "../src/damzd/menu-plan.js";

// DamzD skin on the FEI-XMD engine. The menu layout follows the deployed
// v1.4.45 DamzD menu (src/damzd/menu-plan.js); every command in the build
// is shown — the user chose the full list over a curated subset. Sections
// select by category, so new commands appear automatically.
export default Object.freeze({
  botTitle: "🤖 ᴅᴀᴍᴢᴅ ʙᴏᴛ",
  menu: {
    top: "╭──〔 ",
    titleEnd: " 〕",
    infoLine: "│  ◇ ",
    itemLine: "│  › ",
    blankLine: "│",
    bottom: "╰────────────────"
  },
  sections: Object.freeze(
    MENU_SECTIONS.map(section =>
      Object.freeze({
        key: section.title,
        title: section.title,
        categories: Object.freeze([...(section.categories || [])]),
        commandNames: Object.freeze([...(section.commandNames || [])])
      })
    )
  )
});
