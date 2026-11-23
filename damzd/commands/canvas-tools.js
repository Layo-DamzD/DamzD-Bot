import { requestXrinaImage } from "../lib/xrina-api.js";
import { unicodeBox, withPoweredFooter } from "../lib/api-client.js";

function cleanField(value, label, limit = 650) {
  const text = String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim();
  if (!text) throw new Error("Please provide " + label + ".");
  if (text.length > limit) throw new Error(label + " must be " + limit + " characters or fewer.");
  return text;
}

function readPair(ctx, usage) {
  const parts = String(ctx.args || "").split("|").map(value => value.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Usage: " + ctx.config.prefix + ctx.commandName + " " + usage);
  }
  return parts;
}

async function createCanvas(ctx, title, route, values, description) {
  const image = await requestXrinaImage("canvas/" + route, values);
  await ctx.send({
    image,
    caption: withPoweredFooter(unicodeBox(title, description, { footer: false }), 1000)
  });
}

export default [
  {
    name: "wndwqute",
    category: "Canvas",
    description: "Create a Windows-style quote canvas.",
    run: async ctx => {
      const quote = cleanField(ctx.args, "a quote");
      await createCanvas(ctx, "🪟 WINDOWS QUOTE", "windows", { text: quote }, quote);
    }
  },
  {
    name: "canvasquote",
    category: "Canvas",
    description: "Create a quote canvas with an author name.",
    run: async ctx => {
      const [quote, author] = readPair(ctx, "quote text | author name");
      await createCanvas(
        ctx,
        "✨ CANVAS QUOTE",
        "quotes",
        { text: cleanField(quote, "the quote"), name: cleanField(author, "the author name", 100) },
        "“" + quote + "”\n— " + author
      );
    }
  }
];
