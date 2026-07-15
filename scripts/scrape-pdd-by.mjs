#!/usr/bin/env node
/**
 * Парсинг билетов ПДД Беларуси с https://pdd.auto-cargo.com
 * Источник: test-pdd.html?ticket=N&q=M
 * Проверка ответов: POST /exam/check.php
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const IMG_DIR = path.join(DATA_DIR, "by-images");
const BASE = "https://pdd.auto-cargo.com";
const MAX_TICKET = 132;
const QUESTIONS_PER_TICKET = 10;
const CONCURRENCY = 8;
const DELAY_MS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuestionPage(html, ticket, qIndex) {
  const textMatch = html.match(/class="question-text">\s*([\s\S]*?)<\/div>/i);
  const qText = textMatch ? decodeHtml(textMatch[1].replace(/<[^>]+>/g, "")) : "";

  const imgMatch = html.match(/class="question-image">[\s\S]*?<img\s+src="([^"]+)"/i);
  let image = null;
  if (imgMatch) {
    image = imgMatch[1].startsWith("http") ? imgMatch[1] : BASE + imgMatch[1];
  }

  const metaMatch = html.match(/data-question="(\d+)"[^>]*data-rule="([^"]*)"/i);
  const questionId = metaMatch ? metaMatch[1] : `${ticket}-${qIndex}`;
  const rule = metaMatch ? metaMatch[2] : "";

  const answers = [];
  const re = /class="answer"\s+data-answer="(\d+)">\s*([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html))) {
    answers.push({
      id: m[1],
      text: decodeHtml(m[2].replace(/<[^>]+>/g, "")),
    });
  }

  return { questionId, qText, image, rule, answers, ticket, qIndex };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "PDD-Trainer-Local/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function findCorrectAnswer(questionId, answers) {
  if (!answers.length) return { correctAnswerId: null, rule: "" };
  await sleep(DELAY_MS);
  const body = `question=${encodeURIComponent(questionId)}&answer=${encodeURIComponent(answers[0].id)}`;
  const res = await fetch(BASE + "/exam/check.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "PDD-Trainer-Local/1.0" },
    body,
  });
  const data = await res.json();
  if (data.correct) return { correctAnswerId: answers[0].id, rule: data.rule || "" };
  if (data.correct_answer) return { correctAnswerId: String(data.correct_answer), rule: data.rule || "" };
  return { correctAnswerId: null, rule: data.rule || "" };
}

async function downloadImage(url) {
  if (!url) return null;
  const name = path.basename(url.split("?")[0]);
  const localPath = path.join(IMG_DIR, name);
  if (fs.existsSync(localPath)) return `data/by-images/${name}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "PDD-Trainer-Local/1.0" } });
    if (!res.ok) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(localPath, buf);
    return `data/by-images/${name}`;
  } catch {
    return url;
  }
}

async function processOne(ticket, qIndex) {
  const url = `${BASE}/test-pdd.html?ticket=${ticket}&q=${qIndex}`;
  await sleep(DELAY_MS);
  const html = await fetchText(url);
  if (!html.includes("question-text")) return null;

  const parsed = parseQuestionPage(html, ticket, qIndex);
  if (!parsed.qText || !parsed.answers.length) return null;

  const { correctAnswerId, rule } = await findCorrectAnswer(parsed.questionId, parsed.answers);
  const correctIdx = parsed.answers.findIndex((a) => a.id == correctAnswerId);
  const image = await downloadImage(parsed.image);

  return {
    id: `by-ab-${parsed.questionId}`,
    country: "by",
    category: "ab",
    ticket,
    ticketIndex: qIndex,
    ticketTitle: `Билет ${ticket}`,
    topic: rule ? `ПДД п. ${rule}` : "ПДД Беларусь",
    topics: rule ? [`ПДД п. ${rule}`] : ["ПДД Беларусь"],
    q: parsed.qText,
    options: parsed.answers.map((a) => a.text),
    correct: correctIdx >= 0 ? [correctIdx] : [],
    explanation: rule ? `См. п. ${rule} ПДД Республики Беларусь.` : "",
    image,
    sourceQuestionId: parsed.questionId,
  };
}

async function runPool(tasks, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await fn(tasks[idx]);
      } catch (e) {
        console.error("Error", tasks[idx], e.message);
        results[idx] = null;
      }
      if (idx % 20 === 0) console.log(`Progress: ${idx + 1}/${tasks.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results.filter(Boolean);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const outPath = path.join(DATA_DIR, "pdd-by-ab.json");
  const retry = process.argv.includes("--retry");
  let existing = [];
  if (retry && fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, "utf8")).questions || [];
  }

  const have = new Set(existing.map((q) => `${q.ticket}-${q.ticketIndex}`));
  const tasks = [];
  for (let t = 1; t <= MAX_TICKET; t++) {
    for (let q = 1; q <= QUESTIONS_PER_TICKET; q++) {
      if (!retry || !have.has(`${t}-${q}`)) tasks.push([t, q]);
    }
  }

  if (!tasks.length) {
    console.log("Nothing to scrape.");
    return;
  }

  console.log(`${retry ? "Retrying" : "Scraping"} ${tasks.length} questions from ${BASE}…`);
  const fresh = await runPool(tasks, ([t, q]) => processOne(t, q));
  const merged = retry ? [...existing, ...fresh] : fresh;
  merged.sort((a, b) => a.ticket - b.ticket || a.ticketIndex - b.ticketIndex);
  console.log(`Got ${merged.length} questions total`);

  const manifest = {
    country: "by",
    category: "ab",
    label: "Беларусь · категория B",
    questionCount: merged.length,
    ticketCount: MAX_TICKET,
    tickets: Object.fromEntries(
      Array.from({ length: MAX_TICKET }, (_, i) => [String(i + 1), QUESTIONS_PER_TICKET])
    ),
    topics: {},
    exam: {
      count: 10,
      minutes: 20,
      maxErrors: 1,
      extraOn1Error: 0,
      extraOn2Errors: 0,
      hideFeedbackDuringExam: true,
    },
    source: BASE,
  };

  for (const q of merged) {
    const key = q.topic;
    manifest.topics[key] = (manifest.topics[key] || 0) + 1;
  }

  fs.writeFileSync(outPath, JSON.stringify({ manifest, questions: merged }));
  console.log("Wrote data/pdd-by-ab.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
