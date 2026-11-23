import { MENU_SECTIONS } from "../src/damzd/menu-plan.js";

// DamzD skin on the FEI-XMD engine. The menu layout follows the DamzD
// command list (src/damzd/menu-plan.js — generated from the v1.4.45 command
// set). Commands outside the plan stay functional in the base but are
// hidden from .menu by applyMenuPlan() at boot; their files are never
// touched.
export default Object.freeze({
  botTitle: "🤖 ᴅᴀᴍᴢᴅ ʙᴏᴛ",
  menu: {
    top: "╭━━〔 ",
    titleEnd: " 〕━━┈⊷",
    infoLine: "┃ ✫ ",
    itemLine: "┃ ✫✧│ ",
    blankLine: "┃",
    bottom: "╰━━━━━━━━━━━━┈⊷"
  },
  sections: Object.freeze(
    MENU_SECTIONS.map(section =>
      Object.freeze({
        key: section.title,
        title: section.title,
        commandNames: Object.freeze([...section.commandNames])
      })
    )
  )
});
