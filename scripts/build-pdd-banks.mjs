#!/usr/bin/env node
/**
 * Собирает банки вопросов ПДД из открытых источников:
 * - РФ: https://github.com/etspring/pdd_russia
 * - РБ: https://github.com/lehaSVV2009/traffic-laws-belarus (демо-набор)
 *
 * Картинки РФ отдаются через jsDelivr (репозиторий etspring/pdd_russia).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CACHE = path.join(ROOT, ".cache", "pdd-sources");
const IMG_BASE = "https://cdn.jsdelivr.net/gh/etspring/pdd_russia@master";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cloneIfNeeded(url, folder) {
  const target = path.join(CACHE, folder);
  if (!fs.existsSync(path.join(target, ".git"))) {
    ensureDir(CACHE);
    console.log("Cloning", url);
    execSync(`git clone --depth 1 ${url} ${target}`, { stdio: "inherit" });
  }
  return target;
}

function resolveImage(image) {
  if (!image || String(image).includes("no_image")) return null;
  let p = String(image).replace(/^\.\//, "").replace(/^tmp\//, "");
  if (p.startsWith("images/")) return `${IMG_BASE}/${p}`;
  const tail = p.split("/").pop();
  if (p.includes("A_B/") || p.includes("C_D/")) {
    const seg = p.includes("C_D/") ? "C_D" : "A_B";
    return `${IMG_BASE}/images/${seg}/${tail}`;
  }
  return `${IMG_BASE}/images/${tail}`;
}

function convertRussiaQuestion(raw, category) {
  const correctIdx = (raw.answers || []).findIndex((a) => a.is_correct);
  const ticketMatch = String(raw.ticket_number || "").match(/(\d+)/);
  const topics = Array.isArray(raw.topic) ? raw.topic : raw.topic ? [raw.topic] : [];
  return {
    id: `ru-${category}-${raw.id}`,
    country: "ru",
    category,
    ticket: ticketMatch ? parseInt(ticketMatch[1], 10) : null,
    ticketTitle: raw.ticket_number || null,
    topic: topics.length ? topics.join(" · ") : "Разное",
    topics,
    q: raw.question,
    options: (raw.answers || []).map((a) => a.answer_text),
    correct: correctIdx >= 0 ? [correctIdx] : [],
    explanation: raw.answer_tip || raw.correct_answer || "",
    image: resolveImage(raw.image),
  };
}

function loadRussiaCategory(srcRoot, category) {
  const folder = category === "cd" ? "C_D" : "A_B";
  const ticketsDir = path.join(srcRoot, "questions", folder, "tickets");
  const topicsDir = path.join(srcRoot, "questions", folder, "topics");
  const byId = new Map();

  if (fs.existsSync(ticketsDir)) {
    for (const file of fs.readdirSync(ticketsDir).filter((f) => f.endsWith(".json"))) {
      const arr = JSON.parse(fs.readFileSync(path.join(ticketsDir, file), "utf8"));
      arr.forEach((raw, i) => {
        const q = convertRussiaQuestion(raw, category);
        q.ticketIndex = i + 1;
        if (!byId.has(q.id)) byId.set(q.id, q);
      });
    }
  }
  if (fs.existsSync(topicsDir)) {
    for (const file of fs.readdirSync(topicsDir).filter((f) => f.endsWith(".json"))) {
      const arr = JSON.parse(fs.readFileSync(path.join(topicsDir, file), "utf8"));
      for (const raw of arr) {
        const q = convertRussiaQuestion(raw, category);
        if (!byId.has(q.id)) byId.set(q.id, q);
      }
    }
  }
  return [...byId.values()];
}

function buildRussiaManifest(questions, category) {
  const tickets = {};
  const topics = {};
  for (const q of questions) {
    if (q.ticket) {
      if (!tickets[q.ticket]) tickets[q.ticket] = [];
      tickets[q.ticket].push(q.id);
    }
    for (const t of q.topics || [q.topic]) {
      const key = t || "Разное";
      if (!topics[key]) topics[key] = [];
      topics[key].push(q.id);
    }
  }
  for (const list of Object.values(tickets)) list.sort();
  return {
    country: "ru",
    category,
    label: category === "cd" ? "РФ · категории C/D" : "РФ · категории A/B",
    questionCount: questions.length,
    ticketCount: Object.keys(tickets).length,
    tickets: Object.fromEntries(
      Object.entries(tickets)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([n, ids]) => [n, ids.length])
    ),
    topics: Object.fromEntries(
      Object.entries(topics)
        .sort((a, b) => a[0].localeCompare(b[0], "ru"))
        .map(([name, ids]) => [name, ids.length])
    ),
    exam: {
      count: 20,
      minutes: 20,
      maxErrors: 2,
      extraOn1Error: 5,
      extraOn2Errors: 10,
      hideFeedbackDuringExam: true,
    },
  };
}

function loadBelarus(srcRoot) {
  const questionsPath = path.join(srcRoot, "json", "questions.json");
  const chaptersPath = path.join(srcRoot, "json", "chapters.json");
  const questions = JSON.parse(fs.readFileSync(questionsPath, "utf8"));
  const chapters = JSON.parse(fs.readFileSync(chaptersPath, "utf8"));
  const chapterMap = Object.fromEntries(chapters.map((c) => [c.id, c.name]));

  return questions.map((q) => ({
    id: `by-ab-${q.id}`,
    country: "by",
    category: "ab",
    ticket: null,
    ticketTitle: null,
    topic: chapterMap[q.chapterId] || "Разное",
    topics: [chapterMap[q.chapterId] || "Разное"],
    q: q.name,
    options: q.variants || [],
    correct: typeof q.correct === "number" ? [q.correct] : [],
    explanation: q.comment || "",
    image: null,
  }));
}

function buildBelarusManifest(questions) {
  const topics = {};
  for (const q of questions) {
    const key = q.topic || "Разное";
    if (!topics[key]) topics[key] = 0;
    topics[key]++;
  }
  return {
    country: "by",
    category: "ab",
    label: "Беларусь · категория B",
    questionCount: questions.length,
    ticketCount: 0,
    tickets: {},
    topics,
    exam: {
      count: 20,
      minutes: 20,
      maxErrors: 2,
      extraOn1Error: 5,
      extraOn2Errors: 10,
      hideFeedbackDuringExam: true,
    },
    note: "Демо-банк из открытого репозитория (51 вопрос). Полный банк можно импортировать вручную.",
  };
}

function writeBank(name, questions, manifest) {
  const out = {
    manifest,
    questions,
  };
  const file = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`Wrote ${file} (${questions.length} questions)`);
}

function main() {
  ensureDir(DATA_DIR);
  const ruRoot = cloneIfNeeded("https://github.com/etspring/pdd_russia.git", "pdd_russia");

  const ruAb = loadRussiaCategory(ruRoot, "ab");
  const ruCd = loadRussiaCategory(ruRoot, "cd");

  writeBank("pdd-ru-ab", ruAb, buildRussiaManifest(ruAb, "ab"));
  writeBank("pdd-ru-cd", ruCd, buildRussiaManifest(ruCd, "cd"));

  // Важно: банк Беларуси генерируется отдельным скриптом `scripts/scrape-pdd-by.mjs`.
  // Этот билд-скрипт не должен перетирать `data/pdd-by-ab.json`.
  let byManifest = null;
  try {
    const scrapedBy = path.join(DATA_DIR, "pdd-by-ab.json");
    if (fs.existsSync(scrapedBy)) {
      const parsed = JSON.parse(fs.readFileSync(scrapedBy, "utf8"));
      byManifest = parsed?.manifest || null;
    }
  } catch (e) {}

  const index = {
    banks: [
      { id: "pdd-ru-ab", ...buildRussiaManifest(ruAb, "ab") },
      { id: "pdd-ru-cd", ...buildRussiaManifest(ruCd, "cd") },
      ...(byManifest ? [{ id: "pdd-by-ab", ...byManifest }] : []),
    ],
    imageCdn: IMG_BASE,
    sources: [
      "https://github.com/etspring/pdd_russia",
      "https://pdd.auto-cargo.com/test-pdd.html",
    ],
  };
  fs.writeFileSync(path.join(DATA_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log("Done.");
}

main();
