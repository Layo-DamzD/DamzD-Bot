import {
  POWERED_FOOTER,
  unicodeBox,
  withPoweredFooter,
  validateHttpUrl
} from "../lib/api-client.js";

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent": "FEI-XMD-Fun/2.0 (+https://github.com/Benfeitech/FEI-XMD)"
};
const TIMEOUT_MS = 15000;

export const FUN_V2_NAMES = Object.freeze([
  "joke", "dadjoke", "progjoke", "chuck", "fact2", "catfact", "dog", "cat",
  "fox", "advice", "quote2", "trivia", "meme", "numfact", "activity",
  "pokemon", "history", "riddle", "wiki", "nasa"
]);

function shorten(value, limit = 1000) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}

export function decodeFunHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => {
      const point = Number.parseInt(digits, 16);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&#(\d+);/g, (_, digits) => {
      const point = Number.parseInt(digits, 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

async function getJson(url, extraHeaders = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { ...HEADERS, ...extraHeaders },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow"
    });
  } catch (error) {
    throw new Error(error && error.name === "TimeoutError" ? "The service timed out." : "The service could not be reached.");
  }
  if (!response.ok) throw new Error("The service returned HTTP " + response.status + ".");
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The service returned unreadable data.");
  }
  if (data && (data.error === true || data.success === false || data.status === false)) {
    throw new Error("The service reported that the request failed.");
  }
  return data;
}

async function getText(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { ...HEADERS, accept: "text/plain, */*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow"
    });
  } catch (error) {
    throw new Error(error && error.name === "TimeoutError" ? "The service timed out." : "The service could not be reached.");
  }
  if (!response.ok) throw new Error("The service returned HTTP " + response.status + ".");
  const text = (await response.text()).trim();
  if (!text) throw new Error("The service returned an empty result.");
  return text;
}

function requiredText(value, label, limit = 2000) {
  if (typeof value !== "string" || !value.trim()) throw new Error("The service did not return " + label + ".");
  return shorten(value, limit);
}

function imageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(validateHttpUrl(value, "image"));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function shuffled(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function makeFunCommand(name, description, title, loadResult) {
  return {
    name,
    category: "Fun",
    description,
    run: async ctx => {
      await ctx.reply("⏳ _" + title + " — please wait while the service responds._", false);
      try {
        const result = await loadResult();
        const resultTitle = shorten(result.title || title, 120);
        const text = shorten(result.text || "", 2700);
        if (!text && !result.image) throw new Error("The service returned no displayable result.");

        if (result.image) {
          const photo = imageUrl(result.image);
          if (photo) {
            const caption = withPoweredFooter(unicodeBox(resultTitle, text || "Here is your result.", { footer: false }), 1000);
            await ctx.send({ image: { url: photo }, caption }, false);
          } else if (text) {
            await ctx.reply(unicodeBox(resultTitle, text, { footer: !result.answer }), false);
          } else {
            throw new Error("The service returned an unsupported image URL.");
          }
        } else {
          await ctx.reply(unicodeBox(resultTitle, text, { footer: !result.answer }), false);
        }

        if (result.answer) {
          await delay(1800);
          await ctx.reply(unicodeBox(result.answerTitle || "✅ ᴀɴsᴡᴇʀ", shorten(result.answer, 1000), { footer: true }), false);
        }
      } catch (error) {
        console.warn("Fun v2 command ." + name + " failed:", error && error.message ? error.message : error);
        await ctx.reply("⚠️ _" + title + " is temporarily unavailable. Please try again later._\n" + POWERED_FOOTER, false);
      }
    }
  };
}

const commands = [
  makeFunCommand("joke", "Get a random joke.", "😂 ʀᴀɴᴅᴏᴍ ᴊᴏᴋᴇ", async () => {
    const d = await getJson("https://official-joke-api.appspot.com/random_joke");
    return { text: requiredText(d.setup, "a joke setup", 800) + "\n\n👉 " + requiredText(d.punchline, "a punchline", 800) };
  }),
  makeFunCommand("dadjoke", "Get a random dad joke.", "👨 ᴅᴀᴅ ᴊᴏᴋᴇ", async () => {
    const d = await getJson("https://icanhazdadjoke.com/", { accept: "application/json" });
    return { text: requiredText(d.joke, "a dad joke", 1800) };
  }),
  makeFunCommand("progjoke", "Get a programming joke.", "💻 ᴘʀᴏɢʀᴀᴍᴍɪɴɢ ᴊᴏᴋᴇ", async () => {
    const d = await getJson("https://v2.jokeapi.dev/joke/Programming?safe-mode");
    if (d.type === "single") return { text: requiredText(d.joke, "a programming joke", 1800) };
    if (d.type === "twopart") return { text: requiredText(d.setup, "a joke setup", 800) + "\n\n👉 " + requiredText(d.delivery, "a punchline", 800) };
    throw new Error("Unsupported joke response.");
  }),
  makeFunCommand("chuck", "Get a Chuck Norris joke.", "🥋 ᴄʜᴜᴄᴋ ɴᴏʀʀɪs", async () => {
    const d = await getJson("https://api.chucknorris.io/jokes/random");
    return { text: requiredText(d.value, "a joke", 1800) };
  }),
  makeFunCommand("fact2", "Get a random fact (version 2).", "🧠 ᴜsᴇʟᴇss ғᴀᴄᴛ 2", async () => {
    const d = await getJson("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
    return { text: requiredText(d.text, "a fact", 1800) };
  }),
  makeFunCommand("catfact", "Get a random cat fact.", "🐱 ᴄᴀᴛ ғᴀᴄᴛ", async () => {
    const d = await getJson("https://catfact.ninja/fact");
    return { text: requiredText(d.fact, "a cat fact", 1800) };
  }),
  makeFunCommand("dog", "Send a random dog photo.", "🐶 ʀᴀɴᴅᴏᴍ ᴅᴏɢ", async () => {
    const d = await getJson("https://dog.ceo/api/breeds/image/random");
    const photo = imageUrl(d.message);
    if (!photo) throw new Error("No supported dog photo was returned.");
    const match = new URL(photo).pathname.match(/\/breeds\/([^/]+)\//i);
    const breed = match ? match[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Unknown";
    return { text: "🐾 Breed: *" + breed + "*", image: photo };
  }),
  makeFunCommand("cat", "Send a random cat photo.", "😺 ʀᴀɴᴅᴏᴍ ᴄᴀᴛ", async () => {
    const d = await getJson("https://api.thecatapi.com/v1/images/search");
    const photo = Array.isArray(d) && d[0] ? imageUrl(d[0].url) : null;
    if (!photo) throw new Error("No supported cat photo was returned.");
    return { text: "Here's a cat. You're welcome. 😺", image: photo };
  }),
  makeFunCommand("fox", "Send a random fox photo.", "🦊 ʀᴀɴᴅᴏᴍ ғᴏx", async () => {
    const d = await getJson("https://randomfox.ca/floof/");
    const photo = imageUrl(d.image);
    if (!photo) throw new Error("No supported fox photo was returned.");
    return { text: "What does the fox say? 🦊", image: photo };
  }),
  makeFunCommand("advice", "Get a random piece of advice.", "💡 ᴀᴅᴠɪᴄᴇ", async () => {
    const d = await getJson("https://api.adviceslip.com/advice");
    return { text: requiredText(d.slip && d.slip.advice, "a piece of advice", 1800) };
  }),
  makeFunCommand("quote2", "Get an inspirational quote (version 2).", "✨ ǫᴜᴏᴛᴇ 2", async () => {
    const d = await getJson("https://zenquotes.io/api/random");
    const q = Array.isArray(d) ? d[0] : null;
    return { text: "“" + requiredText(q && q.q, "a quote", 1200) + "”\n— " + requiredText(q && q.a, "an author", 160) };
  }),
  makeFunCommand("trivia", "Ask a multiple-choice trivia question and reveal the answer separately.", "🎯 ᴛʀɪᴠɪᴀ", async () => {
    const d = await getJson("https://opentdb.com/api.php?amount=1&type=multiple");
    const q = d && Array.isArray(d.results) ? d.results[0] : null;
    if (!q || d.response_code !== 0) throw new Error("No trivia question was returned.");
    const correct = decodeFunHtml(q.correct_answer);
    const options = shuffled((q.incorrect_answers || []).map(decodeFunHtml).concat([correct]));
    const letters = ["A", "B", "C", "D"];
    return {
      title: "🎯 ᴛʀɪᴠɪᴀ",
      text: "[" + decodeFunHtml(q.category) + " • " + q.difficulty + "]\n\n" +
        requiredText(decodeFunHtml(q.question), "a trivia question", 1400) + "\n\n" +
        options.map((option, i) => letters[i] + ") " + option).join("\n"),
      answer: letters[options.indexOf(correct)] + ") " + correct,
      answerTitle: "✅ ᴛʀɪᴠɪᴀ ᴀɴsᴡᴇʀ"
    };
  }),
  makeFunCommand("meme", "Send a random meme, skipping items marked NSFW or spoiler.", "🤣 ʀᴀɴᴅᴏᴍ ᴍᴇᴍᴇ", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const d = await getJson("https://meme-api.com/gimme");
      if (d.nsfw === true || d.spoiler === true || d.over18 === true) continue;
      const photo = imageUrl(d.url);
      if (!photo || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(photo)) continue;
      return {
        title: "🤣 ᴍᴇᴍᴇ" + (d.subreddit ? " • r/" + shorten(d.subreddit, 80) : ""),
        text: requiredText(d.title, "a meme title", 700),
        image: photo
      };
    }
    throw new Error("No suitable meme was found.");
  }),
  makeFunCommand("numfact", "Get a random number fact.", "🔢 ɴᴜᴍʙᴇʀ ғᴀᴄᴛ", async () => {
    return { text: requiredText(await getText("https://numbersapi.com/random/trivia"), "a number fact", 1800) };
  }),
  makeFunCommand("activity", "Get a suggestion for something to do.", "🥱 ʙᴏʀᴇᴅ? ᴛʀʏ ᴛʜɪs", async () => {
    const d = await getJson("https://bored-api.appbrewery.com/random");
    const activity = requiredText(d.activity, "an activity suggestion", 1000);
    const type = shorten(d.type || "General", 100);
    const people = Number.isFinite(Number(d.participants)) ? Number(d.participants) : null;
    return { text: activity + "\n\nType: " + type.charAt(0).toUpperCase() + type.slice(1) + (people === null ? "" : " • People: " + people) };
  }),
  makeFunCommand("pokemon", "Show a random Pokémon and its details.", "⚡ ʀᴀɴᴅᴏᴍ ᴘᴏᴋᴇᴍᴏɴ", async () => {
    const d = await getJson("https://pokeapi.co/api/v2/pokemon/" + (Math.floor(Math.random() * 1025) + 1));
    const types = (d.types || []).map(x => x.type && x.type.name).filter(Boolean)
      .map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(", ");
    const abilities = (d.abilities || []).map(x => x.ability && x.ability.name).filter(Boolean)
      .map(x => x.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(", ");
    const sprites = d.sprites || {};
    const art = sprites.other && sprites.other["official-artwork"] && sprites.other["official-artwork"].front_default;
    return {
      title: "⚡ ʀᴀɴᴅᴏᴍ ᴘᴏᴋᴇᴍᴏɴ",
      text: "#" + d.id + "  " + requiredText(d.name, "a Pokémon name", 100).toUpperCase() +
        "\nType: " + (types || "Unknown") + "\nAbilities: " + (abilities || "Unknown") +
        "\nHeight: " + (Number(d.height) / 10) + " m • Weight: " + (Number(d.weight) / 10) + " kg",
      image: imageUrl(art || sprites.front_default)
    };
  }),
  makeFunCommand("history", "Get historical events from this date.", "📜 ᴏɴ ᴛʜɪs ᴅᴀʏ", async () => {
    const now = new Date();
    const d = await getJson("https://history.muffinlabs.com/date/" + (now.getMonth() + 1) + "/" + now.getDate());
    const events = d && d.data && Array.isArray(d.data.Events) ? d.data.Events : [];
    if (!events.length) throw new Error("No history events were returned.");
    const selected = shuffled(events).slice(0, 3);
    return {
      title: "📜 ᴏɴ ᴛʜɪs ᴅᴀʏ (" + now.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) + ")",
      text: selected.map(e => "• " + e.year + ": " + shorten(decodeFunHtml(e.text), 220)).join("\n\n")
    };
  }),
  makeFunCommand("riddle", "Get a riddle and reveal the answer separately.", "🧩 ʀɪᴅᴅʟᴇ", async () => {
    const d = await getJson("https://riddles-api.vercel.app/random");
    return {
      text: requiredText(d.riddle, "a riddle", 1800),
      answer: requiredText(d.answer, "the riddle answer", 800),
      answerTitle: "✅ ʀɪᴅᴅʟᴇ ᴀɴsᴡᴇʀ"
    };
  }),
  makeFunCommand("wiki", "Discover a random Wikipedia article.", "📚 ʀᴀɴᴅᴏᴍ ᴡɪᴋɪᴘᴇᴅɪᴀ", async () => {
    const d = await getJson("https://en.wikipedia.org/api/rest_v1/page/random/summary", { accept: "application/json" });
    const link = d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page;
    const safeLink = typeof link === "string" && /^https:\/\/en\.wikipedia\.org\//i.test(link) ? link : "";
    const summary = shorten(d.extract || "", 1200);
    return {
      text: requiredText(d.title, "a Wikipedia title", 220) + (summary ? "\n\n" + summary : "") + (safeLink ? "\n\n🔗 " + safeLink : ""),
      image: d.thumbnail && imageUrl(d.thumbnail.source)
    };
  }),
  makeFunCommand("nasa", "Show NASA's Picture of the Day when an image is available.", "🚀 ɴᴀsᴀ ᴘɪᴄᴛᴜʀᴇ ᴏғ ᴛʜᴇ ᴅᴀʏ", async () => {
    const d = await getJson("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY");
    const text = requiredText(d.title, "the NASA title", 240) +
      (d.date ? " (" + shorten(d.date, 30) + ")" : "") +
      "\n\n" + shorten(requiredText(d.explanation, "the NASA explanation", 1500), 900);
    if (d.media_type === "image") {
      const photo = imageUrl(d.url || d.hdurl);
      if (photo) return { text, image: photo };
    }
    const link = typeof d.url === "string" && /^https:\/\//i.test(d.url) ? d.url : "";
    return { text: text + (link ? "\n\n🎬 " + link : "") };
  })
];

export default commands.filter(command => !["trivia", "activity", "riddle"].includes(command.name));
