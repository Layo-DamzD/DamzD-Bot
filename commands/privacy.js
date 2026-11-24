export default {
  name: "privacy",
  category: "Chat & Privacy",
  description: "Explain the privacy safeguards in this public DamzD build.",
  run: async ctx => {
    await ctx.reply([
      "🔒 *DamzD PRIVACY*",
      "",
      "• This public build does not collect group-chat history or produce member activity rankings.",
      "• Message-specific commands run only when someone invokes them on a message.",
      "• Anti-delete is OFF by default. When enabled, each chat uses a bounded, short-lived in-memory cache.",
      "• Anti-delete never caches view-once messages.",
      "• Welcome and goodbye greetings are OFF by default.",
      "• Automatic status viewing and reactions are owner-controlled; read-receipt controls are not included.",
      "• View-once recovery runs only when explicitly invoked: .ggs / the 🔓 reaction, plus the .vv/.vv2 test extractors."
    ].join("\n"));
  }
};
