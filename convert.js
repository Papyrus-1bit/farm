#!/usr/bin/env node
/*
 * convert.js — конвертер банка тестовых заданий в формат Фарм-Тренажёра.
 *
 * Превращает текстовый/CSV/DOCX-файл с вопросами в JSON-массив, который можно
 * импортировать на вкладке «Импорт». Прогресс в тренажёре привязан к id вопроса,
 * поэтому id вычисляется как стабильный хеш текста вопроса — повторный прогон
 * того же банка не сбросит статистику.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   node convert.js <вход> [выход.json] [опции]
 *
 * ФОРМАТЫ ВХОДА (--format, по умолчанию auto):
 *   marker  Текст: каждый вариант ответа на отдельной строке с префиксом
 *           "+" (правильный) или "-" (неправильный). Вопросы разделяются
 *           пустой строкой или начинаются с номера ("12." / "12)" / "Вопрос 12").
 *               Пример:
 *               1. Антидот при отравлении опиоидами?
 *               + Налоксон
 *               - Атропин
 *               - Флумазенил
 *   csv     CSV с заголовком. Колонки (любой регистр):
 *           question; option1..optionN; correct; topic; explanation; hard
 *           correct — номер(а) правильного варианта (1-based, через запятую/точку с зап.).
 *   docx    .docx — текст извлекается через системный `unzip`, далее разбор как marker.
 *
 * ОПЦИИ:
 *   --topic "Фармация"     Тема по умолчанию (если в данных её нет).
 *   --format marker|csv|docx|auto
 *   --filter "<regex>"     Оставить только вопросы, чей текст совпадает с regex (i).
 *   --exclude "<regex>"    Выбросить вопросы, чей текст совпадает с regex (i).
 *   --hard-if "<regex>"    Пометить вопрос как сложный (hard:true), если текст
 *                          совпадает с regex (i). Можно указывать несколько раз.
 *   --csv-sep ";"          Разделитель CSV (по умолчанию ";").
 *
 * ПРИМЕРЫ:
 *   node convert.js bank.txt farm-bank.json --topic "Фармация"
 *   node convert.js bank.csv --format csv --csv-sep ","
 *   node convert.js bank.txt out.json --filter "фармаколог|рецепт" --hard-if "QT|антидот"
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---------------- разбор аргументов ----------------
function parseArgs(argv) {
  const opts = { _: [], hardIf: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--topic") opts.topic = argv[++i];
    else if (a === "--format") opts.format = argv[++i];
    else if (a === "--filter") opts.filter = argv[++i];
    else if (a === "--exclude") opts.exclude = argv[++i];
    else if (a === "--hard-if") opts.hardIf.push(argv[++i]);
    else if (a === "--csv-sep") opts.csvSep = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

function fail(msg) {
  console.error("Ошибка: " + msg);
  process.exit(1);
}

// Стабильный короткий хеш (djb2) → base36, для устойчивых id.
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return "q" + h.toString(36);
}

function normalize(s) {
  return String(s).replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

// ---------------- извлечение текста из DOCX ----------------
function docxToText(file) {
  let xml;
  try {
    xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { maxBuffer: 1 << 28 }).toString("utf8");
  } catch (e) {
    fail("не удалось распаковать .docx (нужна утилита `unzip`). Сохраните файл как .txt и используйте --format marker.");
  }
  // </w:p> → перенос строки, <w:tab/> → пробел, остальные теги убираем
  let txt = xml
    .replace(/<w:tab[^>]*\/?>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  // декодируем базовые XML-сущности
  txt = txt
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  return txt;
}

// ---------------- парсер marker-формата ----------------
const OPTION_RE = /^\s*([+\-*])\s+(.*\S)\s*$/;        // "+ текст" / "- текст"
const QNUM_RE = /^\s*(?:вопрос\s*)?\d{1,4}\s*[.)]\s*(.*)$/i; // "12. текст" / "12) текст"

function parseMarker(text, defaultTopic) {
  const lines = text.split("\n");
  const questions = [];
  let cur = null;

  const pushCur = () => {
    if (cur && cur.q && cur.options.length >= 2 && cur.correct.length) {
      questions.push(cur);
    }
    cur = null;
  };

  for (let raw of lines) {
    const line = normalize(raw);
    if (!line) { // пустая строка — граница блока
      pushCur();
      continue;
    }
    const optM = line.match(OPTION_RE);
    if (optM) {
      if (!cur) { cur = { q: "", options: [], correct: [], topic: defaultTopic }; }
      const isCorrect = optM[1] === "+" || optM[1] === "*";
      cur.options.push(optM[2]);
      if (isCorrect) cur.correct.push(cur.options.length - 1);
      continue;
    }
    // не вариант ответа → часть вопроса
    const numM = line.match(QNUM_RE);
    if (numM && (!cur || cur.options.length)) {
      // новый вопрос (нумерованный), закрываем предыдущий
      pushCur();
      cur = { q: numM[1].trim(), options: [], correct: [], topic: defaultTopic };
    } else if (cur && !cur.options.length) {
      cur.q += (cur.q ? " " : "") + line; // продолжение текста вопроса
    } else {
      // строка после вариантов без пустой строки — считаем новым вопросом
      pushCur();
      cur = { q: numM ? numM[1].trim() : line, options: [], correct: [], topic: defaultTopic };
    }
  }
  pushCur();
  return questions;
}

// ---------------- парсер CSV ----------------
function parseCsvLine(line, sep) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === sep) { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text, sep, defaultTopic) {
  const rows = text.split("\n").filter((r) => r.trim().length);
  if (!rows.length) return [];
  const header = parseCsvLine(rows[0], sep).map((h) => h.toLowerCase());
  const idx = (name) => header.indexOf(name);
  const qi = idx("question") >= 0 ? idx("question") : idx("вопрос");
  const ci = idx("correct") >= 0 ? idx("correct") : idx("правильный");
  const ti = idx("topic") >= 0 ? idx("topic") : idx("тема");
  const ei = idx("explanation") >= 0 ? idx("explanation") : idx("пояснение");
  const hi = idx("hard") >= 0 ? idx("hard") : idx("сложный");
  const optCols = header
    .map((h, i) => ({ h, i }))
    .filter((o) => /^option\d+|^вариант\d+/.test(o.h))
    .map((o) => o.i);

  if (qi < 0 || !optCols.length || ci < 0) {
    fail("в CSV нужны колонки question, option1..N и correct (или их русские аналоги).");
  }

  const questions = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = parseCsvLine(rows[r], sep);
    const options = optCols.map((i) => cells[i]).filter((v) => v && v.length);
    if (!cells[qi] || options.length < 2) continue;
    const correct = String(cells[ci] || "")
      .split(/[;,]/)
      .map((n) => parseInt(n, 10) - 1) // в CSV 1-based
      .filter((n) => n >= 0 && n < options.length);
    if (!correct.length) continue;
    questions.push({
      q: cells[qi],
      options,
      correct,
      topic: (ti >= 0 && cells[ti]) ? cells[ti] : defaultTopic,
      explanation: ei >= 0 ? (cells[ei] || "") : "",
      hard: hi >= 0 ? /^(1|true|да|yes|hard)$/i.test(cells[hi] || "") : false,
    });
  }
  return questions;
}

// ---------------- основной поток ----------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts._.length) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^[\s\S]*?\*/, ""));
    process.exit(opts.help ? 0 : 1);
  }

  const input = opts._[0];
  const output = opts._[1] || "farm-bank.json";
  const defaultTopic = opts.topic || "Фармация";
  const sep = opts.csvSep || ";";
  if (!fs.existsSync(input)) fail("файл не найден: " + input);

  let format = opts.format || "auto";
  const ext = path.extname(input).toLowerCase();
  if (format === "auto") {
    if (ext === ".csv") format = "csv";
    else if (ext === ".docx") format = "docx";
    else format = "marker";
  }

  let text;
  if (format === "docx") { text = docxToText(input); format = "marker"; }
  else text = fs.readFileSync(input, "utf8");
  text = text.replace(/\r\n/g, "\n").replace(/\uFEFF/g, "");

  let questions = format === "csv"
    ? parseCsv(text, sep, defaultTopic)
    : parseMarker(text, defaultTopic);

  // фильтры
  const filterRe = opts.filter ? new RegExp(opts.filter, "i") : null;
  const excludeRe = opts.exclude ? new RegExp(opts.exclude, "i") : null;
  const hardRes = opts.hardIf.map((p) => new RegExp(p, "i"));

  const seen = new Set();
  const out = [];
  for (const q of questions) {
    const qText = normalize(q.q);
    if (filterRe && !filterRe.test(qText)) continue;
    if (excludeRe && excludeRe.test(qText)) continue;
    const id = hashId(qText);
    if (seen.has(id)) continue; // дубликаты по тексту
    seen.add(id);
    const isHard = q.hard || hardRes.some((re) => re.test(qText));
    out.push({
      id,
      topic: q.topic || defaultTopic,
      q: qText,
      options: q.options.map((o) => normalize(o)),
      correct: q.correct,
      explanation: q.explanation ? normalize(q.explanation) : "",
      hard: !!isHard,
    });
  }

  if (!out.length) fail("не удалось распознать ни одного вопроса. Проверьте формат (--format) и пример в README.");

  fs.writeFileSync(output, JSON.stringify(out, null, 2), "utf8");
  const hardCount = out.filter((q) => q.hard).length;
  const topicsCount = new Set(out.map((q) => q.topic)).size;
  console.log(`Готово: ${out.length} вопрос(ов) → ${output}`);
  console.log(`  тем: ${topicsCount}, помечено сложными: ${hardCount}`);
}

main();
