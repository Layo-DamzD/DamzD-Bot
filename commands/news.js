import { fetchHeadlines, newsSourceList } from "../src/apis.js";

async function sendHeadlines(ctx, sourceKey) {
  await ctx.typing(1200);
  const { label, items } = await fetchHeadlines(sourceKey);
  const lines = items.map((item, index) =>
    "*" + (index + 1) + ". " + item.title + "*" +
    (item.date ? "\n   " + item.date : "") +
    (item.link ? "\n   " + item.link : "")
  );
  await ctx.reply("📰 *" + label + "* — latest\n\n" + lines.join("\n\n"));
}

function sourceCommand(name, aliases, key) {
  return {
    name,
    aliases,
    category: "News",
    description: "headlines from " + key,
    run: async ctx => sendHeadlines(ctx, key)
  };
}

export default [
  {
    name: "news",
    aliases: ["n"],
    category: "News",
    description: "headlines — pick a source, e.g. .news bbc",
    run: async ctx => {
      const wanted = String(ctx.args || "").trim().toLowerCase().replace(/\s+/g, "");
      if (!wanted) {
        await ctx.reply(
          "Which desk should I open? Send one of:\n\n" +
          newsSourceList().map(item => "✦ " + item).join("\n") +
          "\n\nExample: " + ctx.config.prefix + "news punch"
        );
        return;
      }
      const available = ["aljazeera", "bbc", "cnn", "guardian", "npr", "nytimes", "foxnews", "skynews", "dw", "france24", "washingtonpost", "timesofindia", "punch", "abc"];
      if (!available.includes(wanted)) {
        throw new Error("I do not have that desk — try " + ctx.config.prefix + "news to see the list");
      }
      await sendHeadlines(ctx, wanted);
    }
  },
  sourceCommand("aljazeera", ["aj", "al-jazeera"], "aljazeera"),
  sourceCommand("bbc", [], "bbc"),
  sourceCommand("cnn", [], "cnn"),
  sourceCommand("guardian", ["gd"], "guardian"),
  sourceCommand("npr", [], "npr"),
  sourceCommand("nytimes", ["nyt"], "nytimes"),
  sourceCommand("foxnews", [], "foxnews"),
  sourceCommand("skynews", ["sky"], "skynews"),
  sourceCommand("dw", [], "dw"),
  sourceCommand("france24", ["f24"], "france24"),
  sourceCommand("washingtonpost", ["wapo", "wp"], "washingtonpost"),
  sourceCommand("timesofindia", ["toi"], "timesofindia"),
  sourceCommand("punchnews", ["punchng"], "punch"),
  sourceCommand("abcnews", ["abc"], "abc")
];
