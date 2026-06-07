#!/usr/bin/env node
// fetch-geetest.js — сборщик открытого банка вопросов с GeeTest в формат
// Фарм-Тренажёра (JSON для вкладки «Импорт»).
//
// Источник: открытые страницы-списки "вопросы с ответами":
//   https://geetest.ru/tests/<slug>/list/<тема>/<страница>
// Эти страницы явно разрешены в robots.txt сайта (раздел list) и содержат
// официальную базу ФМЗА (оцифровка приложения MedEdTech), опубликованную
// в открытом доступе для подготовки.
//
// Скрипт ходит вежливо: последовательно, с паузой между запросами.
//
// Использование:
//   node fetch-geetest.js [опции]
// Опции — см. строку USAGE ниже или флаг --help.

"use strict";

const https = require("https");
const fs = require("fs");

const USAGE = [
  "fetch-geetest.js — сбор открытого банка вопросов в JSON для Фарм-Тренажёра.",
  "",
  "Использование: node fetch-geetest.js [опции]",
  "  --slug <slug>     тест в URL (по умолчанию farmaciya_spo_2025 — фармация, СПО)",
  "  --out <файл>      выходной JSON (по умолчанию farm-bank.json)",
  "  --topics <N>      число тем (по умолчанию 10)",
  "  --delay <мс>      пауза между запросами (по умолчанию 700)",
  "  --max-pages <N>   лимит страниц на тему (по умолчанию 50)",
  '  --hard-if "<re>"  пометить сложными по регулярке (можно несколько раз)',
  "",
  "Пример:",
  '  node fetch-geetest.js --out farm-bank.json --hard-if "QT|антидот|противопоказан"',
  "",
  "Slug нужного теста виден в адресной строке его страницы на geetest.ru.",
].join("\n");

// ---------------- аргументы ----------------
function parseArgs(argv) {
  const o = { slug: "farmaciya_spo_2025", out: "farm-bank.json", topics: 10, delay: 700, maxPages: 50, hardIf: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug") o.slug = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--topics") o.topics = parseInt(argv[++i], 10);
    else if (a === "--delay") o.delay = parseInt(argv[++i], 10);
    else if (a === "--max-pages") o.maxPages = parseInt(argv[++i], 10);
    else if (a === "--hard-if") o.hardIf.push(argv[++i]);
    else if (a === "-h" || a === "--help") o.help = true;
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) FarmTrainer/1.0", "Accept": "text/html" } },
      (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location && redirects > 0) {
          res.resume();
          const next = headers.location.startsWith("http") ? headers.location : new URL(headers.location, url).href;
          return resolve(get(next, redirects - 1));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
  });
}

// ---------------- утилиты текста ----------------
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<\s*br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return "gt" + h.toString(36);
}

// Достаёт человекочитаемое имя темы из <title> страницы.
function topicNameFromHtml(html, fallback) {
  const m = html.match(/тема\s*\d+\s*:\s*([^<]*?)(?:,\s*страница[^<]*)?<\/title>/i);
  if (m) {
    const name = m[1].replace(/\s+/g, " ").trim();
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : fallback;
  }
  return fallback;
}

// ---------------- парсинг одной страницы списка ----------------
function parseListPage(html) {
  const out = [];
  const artRe = /<article\b[^>]*\bid="question-(\d+)"[^>]*>([\s\S]*?)<\/article>/g;
  let am;
  while ((am = artRe.exec(html))) {
    const qid = am[1];
    const block = am[2];

    const qm = block.match(/<div class="question">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/);
    if (!qm) continue;
    const qText = stripTags(qm[1]);
    if (!qText) continue;

    const ansRe = /<div\s+class="answer([^"]*)"\s*>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g;
    const options = [];
    const correct = [];
    let an;
    while ((an = ansRe.exec(block))) {
      const isCorrect = /\bcorrect\b/.test(an[1]);
      const text = stripTags(an[2]);
      if (!text) continue;
      options.push(text);
      if (isCorrect) correct.push(options.length - 1);
    }
    if (options.length < 2 || correct.length === 0) continue;
    out.push({ qid, qText, options, correct });
  }
  return out;
}

function hasNextPage(html) {
  return /<link[^>]*rel="next"/i.test(html);
}

// ---------------- основной поток ----------------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(USAGE);
    return;
  }
  const hardRes = o.hardIf.map((p) => new RegExp(p, "i"));
  const base = "https://geetest.ru/tests/" + o.slug;

  const seen = new Set();
  const bank = [];
  let skipped = 0;

  for (let topic = 1; topic <= o.topics; topic++) {
    let topicName = "Тема " + topic;
    let gotAny = false;
    for (let page = 1; page <= o.maxPages; page++) {
      const url = page === 1 ? base + "/list/" + topic : base + "/list/" + topic + "/" + page;
      let res;
      try {
        res = await get(url);
      } catch (e) {
        process.stderr.write("\n  [тема " + topic + " стр " + page + "] ошибка сети: " + e.message + "\n");
        break;
      }
      if (res.status === 404) break;
      if (res.status !== 200) {
        process.stderr.write("\n  [тема " + topic + " стр " + page + "] HTTP " + res.status + "\n");
        break;
      }
      if (page === 1) topicName = topicNameFromHtml(res.body, topicName);

      const items = parseListPage(res.body);
      if (!items.length && page > 1) break;
      gotAny = gotAny || items.length > 0;

      for (const it of items) {
        // Ключ дедупликации = текст вопроса + набор вариантов (без учёта порядка),
        // чтобы вопросы с одинаковой формулировкой, но разными ответами не схлопывались.
        const key = it.qText + "||" + it.options.slice().sort().join("|");
        const id = hashId(key);
        if (seen.has(id)) { skipped++; continue; }
        seen.add(id);
        bank.push({
          id,
          topic: topicName,
          q: it.qText,
          options: it.options,
          correct: it.correct,
          explanation: "",
          hard: hardRes.some((re) => re.test(it.qText)),
        });
      }

      process.stdout.write("\r  тема " + topic + "/" + o.topics + " «" + topicName + "» · стр " + page + " · всего " + bank.length + "        ");
      const more = hasNextPage(res.body);
      await sleep(o.delay);
      if (!more) break;
    }
    if (!gotAny) process.stderr.write("\n  тема " + topic + ": вопросов не найдено\n");
    process.stdout.write("\n");
  }

  if (!bank.length) {
    console.error("Не удалось собрать ни одного вопроса. Проверьте --slug (см. URL теста на geetest.ru).");
    process.exit(1);
  }

  fs.writeFileSync(o.out, JSON.stringify(bank, null, 2), "utf8");
  const topics = new Set(bank.map((q) => q.topic));
  const hardCount = bank.filter((q) => q.hard).length;
  console.log("\nГотово.");
  console.log("  собрано вопросов: " + bank.length);
  console.log("  тем: " + topics.size);
  console.log("  пропущено дубликатов: " + skipped);
  if (hardCount) console.log("  помечено сложными: " + hardCount);
  console.log("  файл: " + o.out);
  console.log("\nДалее: откройте тренажёр → вкладка «Импорт» → выберите этот файл.");
}

main().catch((e) => {
  console.error("\nОшибка:", e.message);
  process.exit(1);
});
