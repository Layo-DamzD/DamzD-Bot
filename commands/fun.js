import { pick, randomInt } from "../src/utils.js";

const eightBall = [
  "Yes, definitely. ✅",
  "It looks promising. ✨",
  "Ask me again a little later. 🔄",
  "Hard to say right now. 🤔",
  "Probably not. 🌧️",
  "All the signs point to yes. 🌟",
  "Absolutely. 🎉",
  "I would not count on it. 🙃"
];

const triviaBank = [
  { q: "Which planet is known as the Red Planet?", a: "mars" },
  { q: "What is the largest ocean on Earth?", a: "pacific ocean" },
  { q: "How many sides does a hexagon have?", a: "6" },
  { q: "What is the capital of Japan?", a: "tokyo" },
  { q: "What is the fastest land animal?", a: "cheetah" },
  { q: "How many colours are traditionally listed in a rainbow?", a: "7" },
  { q: "Which organ pumps blood around the human body?", a: "heart" },
  { q: "What is the chemical symbol for gold?", a: "au" },
  { q: "Which continent is the Sahara Desert in?", a: "africa" },
  { q: "What is the tallest mountain in the world?", a: "mount everest" }
];

const riddleBank = [
  { q: "What has keys but cannot open locks?", a: "piano" },
  { q: "What gets wetter the more it dries?", a: "towel" },
  { q: "What has a face and two hands but no arms or legs?", a: "clock" },
  { q: "What has to be broken before you can use it?", a: "egg" },
  { q: "What goes up but never comes down?", a: "age" },
  { q: "What has one eye but cannot see?", a: "needle" },
  { q: "What has many teeth but cannot bite?", a: "comb" },
  { q: "What can travel around the world while staying in one corner?", a: "stamp" }
];

const quotes = [
  "Discipline is choosing between what you want now and what you want most.",
  "You do not have to be great to start, but you have to start to be great.",
  "Slow progress is still progress. Keep going.",
  "The best time to plant a tree was twenty years ago. The second best time is now.",
  "You owe yourself the love you so freely give to others.",
  "Small steps every day beat a perfect plan you never start.",
  "Peace begins the moment you stop needing everyone to understand you."
];

const jokes = [
  "Why do we tell actors to break a leg? Because every play has a cast. 😄",
  "I told my computer I needed a break, and it said no problem — I will go to sleep.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "Parallel lines have so much in common. It is a shame they will never meet.",
  "I would tell you a chemistry joke, but I know I would not get a reaction.",
  "My bed and I love each other, but my alarm clock keeps trying to break us up."
];

const activities = [
  "Share one skill you would love to learn this year.",
  "Name three songs that always lift your mood.",
  "Describe your perfect weekend in one sentence.",
  "Tell everyone one surprising fact about yourself.",
  "Give someone in this chat a genuine compliment.",
  "Name a place you would visit if travel were free.",
  "Describe your day using only three emojis.",
  "Recommend one book, film or show worth people's time."
];

const pending = new Map();

function normalizeAnswer(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function challengeCommand(name, label, bank) {
  return {
    name,
    category: "Games",
    description: "play a quick " + label.toLowerCase() + " round",
    run: async ctx => {
      const key = ctx.jid;
      const guess = String(ctx.args || "").trim();
      const current = pending.get(key);
      if (guess && current && current.type === name && current.expiresAt > Date.now()) {
        pending.delete(key);
        if (normalizeAnswer(guess) === normalizeAnswer(current.answer)) {
          await ctx.reply("Correct. Nice one. ✅");
        } else {
          await ctx.reply("Not quite — the answer was *" + current.answer + "*.");
        }
        return;
      }
      const question = pick(bank);
      pending.set(key, { type: name, answer: question.a, expiresAt: Date.now() + 120000 });
      await ctx.reply(
        "*" + label + " time.* 🧠\n\n" + question.q +
        "\n\nSend " + ctx.config.prefix + name + " followed by your answer. You have two minutes."
      );
    }
  };
}

function calculateExpression(raw) {
  const expression = String(raw || "").replace(/\^/g, "**").trim();
  if (!expression || expression.length > 80) throw new Error("give me a shorter expression to calculate");
  if (!/^[0-9+\-*/().% ]+(\*\*)?[0-9+\-*/().% ]*$/.test(expression.replace(/\*\*/g, ""))) {
    throw new Error("I only handle numbers with + - * / % ( ) and ^");
  }
  if (!/^[0-9+\-*/().%*\s]+$/.test(expression)) {
    throw new Error("I only handle numbers with + - * / % ( ) and ^");
  }
  try {
    const value = Function("\"use strict\"; return (" + expression + ")")();
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("bad result");
    return Math.round(value * 1e10) / 1e10;
  } catch {
    throw new Error("I could not work that one out — check the expression");
  }
}

export default [
  {
    name: "8ball",
    category: "Games",
    description: "a playful answer to a yes-or-no question",
    run: async ctx => {
      if (!String(ctx.args || "").trim()) {
        throw new Error("ask me a yes-or-no question, e.g. " + ctx.config.prefix + "8ball will today be good");
      }
      await ctx.reply(pick(eightBall));
    }
  },
  {
    name: "coinflip",
    aliases: ["flip"],
    category: "Games",
    description: "flip a coin",
    run: async ctx => ctx.reply("It lands on *" + (randomInt(2) === 0 ? "Heads" : "Tails") + "*. 🪙")
  },
  {
    name: "dice",
    aliases: ["roll"],
    category: "Games",
    description: "roll a six-sided die",
    run: async ctx => ctx.reply("You rolled a *" + (randomInt(6) + 1) + "*. 🎲")
  },
  {
    name: "choose",
    category: "Games",
    description: "let me pick between options, separated by |",
    run: async ctx => {
      const options = String(ctx.args || "").split("|").map(value => value.trim()).filter(Boolean);
      if (options.length < 2) throw new Error("give me at least two options, e.g. " + ctx.config.prefix + "choose tea | coffee");
      await ctx.reply("I would go with *" + pick(options) + "*.");
    }
  },
  {
    name: "calc",
    category: "Games",
    description: "quick maths, e.g. (12+8)*3",
    run: async ctx => {
      const expression = String(ctx.args || "").trim();
      if (!expression) throw new Error("give me something to calculate, e.g. " + ctx.config.prefix + "calc (12+8)*3");
      await ctx.reply(expression + " = *" + calculateExpression(expression) + "*");
    }
  },
  challengeCommand("trivia", "Trivia", triviaBank),
  challengeCommand("riddle", "Riddle", riddleBank),
  {
    name: "poll",
    category: "Games",
    description: "create a poll: Question | Option 1 | Option 2",
    run: async ctx => {
      const parts = String(ctx.args || "").split("|").map(value => value.trim()).filter(Boolean);
      if (parts.length < 3) throw new Error("use the format: " + ctx.config.prefix + "poll Question | Option 1 | Option 2");
      const [question, ...values] = parts;
      if (question.length > 250 || values.length > 12 || values.some(value => value.length > 100)) {
        throw new Error("keep the question under 250 characters and use 2 to 12 options");
      }
      await ctx.send({ poll: { name: question, values, selectableCount: 1 } });
    }
  },
  {
    name: "quote",
    category: "Games",
    description: "a short thought for the day",
    run: async ctx => ctx.reply("❝ " + pick(quotes) + " ❞")
  },
  {
    name: "joke",
    category: "Games",
    description: "a light joke",
    run: async ctx => ctx.reply(pick(jokes))
  },
  {
    name: "activity",
    category: "Games",
    description: "a conversation starter for the group",
    run: async ctx => ctx.reply("🎉 " + pick(activities))
  },
  {
    name: "rate",
    category: "Games",
    description: "rate anything out of ten",
    run: async ctx => {
      const thing = String(ctx.args || "").trim();
      if (!thing) throw new Error("tell me what to rate");
      await ctx.reply("I would give *" + thing + "* a solid " + (randomInt(10) + 1) + "/10.");
    }
  },
  {
    name: "love",
    category: "Games",
    description: "match two names, separated by |",
    run: async ctx => {
      const names = String(ctx.args || "").split("|").map(value => value.trim()).filter(Boolean);
      if (names.length !== 2) throw new Error("give me two names, e.g. " + ctx.config.prefix + "love Ada | David");
      const score = randomInt(56) + 45;
      await ctx.reply(
        "*" + names[0] + "* and *" + names[1] + "* score " + score + "%." +
        (score > 80 ? " That is something special. 💞" : score > 60 ? " There is real potential there. 😊" : " It could work, with effort. 🙂")
      );
    }
  }
];
