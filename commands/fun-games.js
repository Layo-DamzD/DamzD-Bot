import { randomInt } from "node:crypto";
import { calculateExpression } from "../lib/math-expression.js";

const eightBallAnswers = [
  "Yes, definitely. ✅",
  "It looks promising. ✨",
  "Ask again later. 🔄",
  "Hard to tell right now. 🤔",
  "Probably not. 🌧️",
  "The signs point to yes. 🌟",
  "Absolutely! 🎉",
  "I wouldn't count on it. 🙃"
];

const triviaQuestions = [
  { q: "Which planet is known as the Red Planet?", a: "mars" },
  { q: "What is the largest ocean on Earth?", a: "pacific ocean" },
  { q: "How many sides does a hexagon have?", a: "6" },
  { q: "Which gas do plants absorb from the atmosphere?", a: "carbon dioxide" },
  { q: "What is the capital of Japan?", a: "tokyo" },
  { q: "What is the fastest land animal?", a: "cheetah" },
  { q: "How many colours are traditionally listed in a rainbow?", a: "7" },
  { q: "Which organ pumps blood around the human body?", a: "heart" },
  { q: "What is the chemical symbol for gold?", a: "au" },
  { q: "Which continent is the Sahara Desert in?", a: "africa" }
];

const riddles = [
  { q: "What has keys but cannot open locks?", a: "piano" },
  { q: "What gets wetter the more it dries?", a: "towel" },
  { q: "What has a face and two hands but no arms or legs?", a: "clock" },
  { q: "What has to be broken before you can use it?", a: "egg" },
  { q: "What goes up but never comes down?", a: "age" },
  { q: "What has one eye but cannot see?", a: "needle" },
  { q: "What has many teeth but cannot bite?", a: "comb" },
  { q: "What can travel around the world while staying in one corner?", a: "stamp" }
];

const activities = [
  "Share one skill you would love to learn this year.",
  "Name three songs that always improve your mood.",
  "Describe your perfect weekend in one sentence.",
  "Tell the group one surprising fact about yourself.",
  "Pick a random object nearby and invent a new use for it.",
  "Give someone in the group a genuine compliment.",
  "Name a place you would visit if travel were free.",
  "Share a small goal you want to complete this week.",
  "Describe your day using only three emojis.",
  "Name one book, film or show you would recommend."
];

const pending = new Map();

function pick(items) {
  return items[randomInt(items.length)];
}

function normalizeAnswer(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function challengeCommand(name, label, bank) {
  return {
    name,
    category: "Games",
    description: "Play a quick " + label.toLowerCase() + " challenge.",
    run: async ctx => {
      const key = ctx.jid;
      const answer = String(ctx.args || "").trim();
      const current = pending.get(key);

      if (answer && current && current.type === name && current.expiresAt > Date.now()) {
        pending.delete(key);
        if (normalizeAnswer(answer) === normalizeAnswer(current.answer)) {
          await ctx.reply("✅ Correct! Nice one.");
        } else {
          await ctx.reply("Not quite. The answer was *" + current.answer + "*.");
        }
        return;
      }

      const question = pick(bank);
      pending.set(key, {
        type: name,
        answer: question.a,
        expiresAt: Date.now() + 120000
      });
      await ctx.reply(
        "🧠 *" + label.toUpperCase() + "*\n\n" + question.q +
        "\n\nReply with " + ctx.config.prefix + name + " your answer within 2 minutes."
      );
    }
  };
}

export default [
  {
    name: "calc",
    category: "Games",
    description: "Safely calculate a basic arithmetic expression.",
    run: async ctx => {
      const expression = String(ctx.args || "").trim();
      if (!expression) throw new Error("Usage: " + ctx.config.prefix + "calc (12 + 8) * 3");
      const result = calculateExpression(expression);
      await ctx.reply("🧮 " + expression + " = *" + result + "*");
    }
  },
  {
    name: "poll",
    category: "Games",
    description: "Create a WhatsApp poll with 2–12 options.",
    run: async ctx => {
      const parts = String(ctx.args || "").split("|").map(value => value.trim()).filter(Boolean);
      if (parts.length < 3) {
        throw new Error("Usage: " + ctx.config.prefix + "poll Question | Option 1 | Option 2");
      }
      const [question, ...values] = parts;
      if (question.length > 250 || values.length > 12 || values.some(value => value.length > 100)) {
        throw new Error("Keep the question under 250 characters and use 2–12 options (100 characters each).");
      }
      await ctx.reply({ poll: { name: question, values, selectableCount: 1 } });
    }
  },
  {
    name: "coinflip",
    aliases: ["flip"],
    category: "Games",
    description: "Flip a virtual coin.",
    run: async ctx => ctx.reply("🪙 " + (randomInt(2) === 0 ? "Heads" : "Tails"))
  },
  {
    name: "dice",
    aliases: ["roll"],
    category: "Games",
    description: "Roll a six-sided die.",
    run: async ctx => ctx.reply("🎲 You rolled: *" + (randomInt(6) + 1) + "*")
  },
  {
    name: "8ball",
    category: "Games",
    description: "Get a playful answer to a yes-or-no question.",
    run: async ctx => {
      if (!String(ctx.args || "").trim()) throw new Error("Ask a question. Example: " + ctx.config.prefix + "8ball Will today be a good day?");
      await ctx.reply("🎱 " + pick(eightBallAnswers));
    }
  },
  {
    name: "choose",
    category: "Games",
    description: "Choose randomly between options separated by |.",
    run: async ctx => {
      const options = String(ctx.args || "").split("|").map(value => value.trim()).filter(Boolean);
      if (options.length < 2 || options.length > 20) {
        throw new Error("Usage: " + ctx.config.prefix + "choose tea | coffee (2–20 options).");
      }
      await ctx.reply("🎯 My choice: *" + pick(options) + "*");
    }
  },
  challengeCommand("trivia", "Trivia", triviaQuestions),
  challengeCommand("riddle", "Riddle", riddles),
  {
    name: "activity",
    category: "Games",
    description: "Get a light group activity or conversation starter.",
    run: async ctx => ctx.reply("🎉 *ACTIVITY IDEA*\n\n" + pick(activities))
  }
];
