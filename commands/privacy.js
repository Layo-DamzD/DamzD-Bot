export default {
  name: "privacy",
  category: "Chat & Privacy",
  description: "Explain the privacy safeguards in this public FEI XMD build.",
  run: async ctx => {
    await ctx.reply([
      "🔒 *FEI XMD PRIVACY*",
      "",
      "• This public build does not collect group-chat history or produce member activity rankings.",
      "• Message-specific commands run only when someone invokes them on a message.",
      "• Anti-delete is OFF by default. When enabled, each chat uses a bounded, short-lived in-memory cache.",
      "• Anti-delete never caches view-once messages.",
      "• Welcome and goodbye greetings are OFF by default.",
      "• Automatic status viewing and reactions are owner-controlled; read-receipt controls are not included.",
      "• The .vv and .vv2 commands run only when explicitly invoked as a reply to view-once media."
    ].join("\n"));
  }
};
