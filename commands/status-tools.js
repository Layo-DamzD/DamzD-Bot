import { randomInt } from "node:crypto";

const ideas = Object.freeze({
  general: [
    "One step at a time. Progress is still progress.",
    "Protect your peace and keep building.",
    "A little consistency goes a long way."
  ],
  motivation: [
    "Your future is shaped by what you do today.",
    "Keep showing up, even when progress feels quiet.",
    "Small wins are still wins. Celebrate them."
  ],
  gratitude: [
    "Grateful for the lessons, the growth and another chance.",
    "A thankful heart sees value in the little things.",
    "Today, I choose to notice the good."
  ],
  weekend: [
    "Rest is part of the plan, not a distraction from it.",
    "Slow down, recharge and enjoy the little moments.",
    "A fresh weekend, a fresh chance to reset."
  ]
});

export default [
  {
    name: "statusdraft",
    category: "Status",
    description: "Format your own text as a WhatsApp status draft.",
    run: async ctx => {
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("Usage: " + ctx.config.prefix + "statusdraft your status text");
      if (text.length > 700) throw new Error("Keep your status draft under 700 characters.");
      const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
      if (!clean) throw new Error("Please provide readable status text.");
      await ctx.reply("📱 *STATUS DRAFT*\n\n" + clean + "\n\n_Ready to copy into your WhatsApp status._");
    }
  },
  {
    name: "statusideas",
    category: "Status",
    description: "Get a few safe WhatsApp status ideas by theme.",
    run: async ctx => {
      const theme = String(ctx.args || "general").trim().toLowerCase();
      const list = ideas[theme];
      if (!list) throw new Error("Choose a theme: general, motivation, gratitude or weekend.");
      const selected = [];
      const pool = list.slice();
      while (pool.length && selected.length < 3) selected.push(pool.splice(randomInt(pool.length), 1)[0]);
      await ctx.reply("💡 *STATUS IDEAS — " + theme.toUpperCase() + "*\n\n" +
        selected.map((line, index) => (index + 1) + ". " + line).join("\n"));
    }
  }
];
