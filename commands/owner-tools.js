function duration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return (days ? days + "d " : "") + hours + "h " + minutes + "m " + rest + "s";
}

export default {
  name: "runtime",
  category: "Owner",
  description: "Show a read-only FEI XMD process uptime summary.",
  run: async ctx => {
    await ctx.reply(
      "⏱️ *FEI XMD RUNTIME*\n" +
      "Uptime: " + duration(process.uptime()) + "\n" +
      "WhatsApp connection: " + (ctx.connectionOpen ? "Connected" : "Not connected")
    );
  }
};
