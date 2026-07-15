#!/usr/bin/env node
/**
 * Текст ПДД РФ по главам (pdd1–pdd26) с avto-russia.ru/pdd/
 * Запуск: node scripts/scrape-pdd-rules.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/pdd-ref/rules");
const CHAPTERS_DIR = join(OUT, "chapters");
const IMG = join(ROOT, "data/pdd-ref/img");
const BASE = "https://avto-russia.ru/pdd";

const CHAPTER_TITLES = [
  "Общие положения",
  "Общие обязанности водителей",
  "Применение специальных сигналов",
  "Обязанности пешеходов",
  "Обязанности пассажиров",
  "Сигналы светофора и регулировщика",
  "Применение аварийной сигнализации и знака аварийной остановки",
  "Начало движения, маневрирование",
  "Расположение транспортных средств на проезжей части",
  "Скорость движения",
  "Обгон, опережение, встречный разъезд",
  "Остановка и стоянка",
  "Проезд перекрестков",
  "Пешеходные переходы и места остановок маршрутных транспортных средств",
  "Движение через железнодорожные пути",
  "Движение по автомагистралям",
  "Движение в жилых зонах",
  "Приоритет маршрутных транспортных средств",
  "Пользование внешними световыми приборами и звуковыми сигналами",
  "Буксировка механических транспортных средств",
  "Учебная езда",
  "Перевозка людей",
  "Перевозка грузов",
  "Дополнительные требования к движению велосипедистов, водителей мопедов и лиц, использующих для передвижения средства индивидуальной мобильности",
  "Дополнительные требования к движению гужевых повозок, а также к прогону животных",
  "Нормы времени управления транспортным средством и отдыха",
];

function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizePddHtml(raw) {
  let html = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<div class="row">[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<div style="text-align:center">/gi, '<div class="pdd-figure">');

  html = html.replace(/src="img\/([^"]+)"/gi, (_, file) => `src="data/pdd-ref/img/${file}"`);
  html = html.replace(/src="znaki\/([^"]+)"/gi, (_, file) => `src="data/pdd-ref/img/extra/${file}"`);

  html = html.replace(/<a\s+href="pdd(\d+)\.html[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (_, num, text) => {
    const label = stripHtml(text);
    return `<span class="pdd-ref" data-chapter="${num}">${label}</span>`;
  });
  html = html.replace(/<a\s+href="znaki\d+\.html[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (_, text) => {
    return `<span class="pdd-sign-ref">${stripHtml(text)}</span>`;
  });
  html = html.replace(/<a\s+href="razmetka\d+\.html[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (_, text) => {
    return `<span class="pdd-mark-ref">${stripHtml(text)}</span>`;
  });
  html = html.replace(/<a\s+[^>]*>([\s\S]*?)<\/a>/gi, (_, text) => stripHtml(text));

  html = html.replace(/\sclass="img-responsive center-block"/gi, ' class="pdd-img"');
  html = html.replace(/\sclass="inline-sign"/gi, ' class="pdd-inline-sign"');

  return html.trim();
}

function parseChapter(html, num) {
  const titleM = html.match(/<h1 class="ai"><b>([^<]+)<\/b>/i);
  const title = titleM ? stripHtml(titleM[1]) : `${num}. ${CHAPTER_TITLES[num - 1] || ""}`;

  const listM = html.match(/<ul class="list-group" id="sign-list">([\s\S]*?)<\/ul>/i);
  if (!listM) return { num, id: `pdd-${num}`, title, blocks: [] };

  const blocks = [];
  const itemRe = /<li class="list-group-item">([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = itemRe.exec(listM[1]))) {
    const innerM = m[1].match(/<div class="col-xs-12"[^>]*>([\s\S]*?)<\/div>\s*<div class="clearfix"/i);
    if (!innerM) continue;
    const content = sanitizePddHtml(innerM[1]);
    if (!content) continue;
    const codeM = content.match(/<strong>([\d.]+)\.<\/strong>/i);
    blocks.push({
      code: codeM ? codeM[1] : "",
      html: content,
      text: stripHtml(content),
    });
  }

  return { num, id: `pdd-${num}`, title, blocks };
}

async function download(url, dest) {
  if (existsSync(dest)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function collectExtraImages(html) {
  const seen = new Set();
  const re = /src="znaki\/([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    seen.add(m[1]);
  }
  await mkdir(join(IMG, "extra"), { recursive: true });
  for (const file of seen) {
    try {
      await download(`${BASE}/znaki/${file}`, join(IMG, "extra", file));
    } catch (e) {
      console.warn("  skip extra img", file, e.message);
    }
  }
}

async function main() {
  await mkdir(CHAPTERS_DIR, { recursive: true });
  const chaptersMeta = [];

  for (let num = 1; num <= 26; num++) {
    const url = `${BASE}/pdd${num}.html`;
    console.log(`Parse ${num}/26 ${url}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(url);
    const html = await res.text();
    await collectExtraImages(html);
    const chapter = parseChapter(html, num);
    console.log(`  ${chapter.blocks.length} blocks`);
    await writeFile(join(CHAPTERS_DIR, `${num}.json`), JSON.stringify(chapter, null, 2));
    chaptersMeta.push({
      num,
      id: chapter.id,
      title: chapter.title,
      codes: chapter.blocks.map((b) => b.code).filter(Boolean),
    });
    await new Promise((r) => setTimeout(r, 350));
  }

  const index = {
    version: 1,
    source: "https://avto-russia.ru/pdd/pdd_rf.html",
    license: "Справочные материалы avto-russia.ru — только для личного обучения",
    effectiveFrom: "2026-01-01",
    chapters: chaptersMeta,
  };

  await writeFile(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nDone → data/pdd-ref/rules/index.json (${chaptersMeta.length} chapters)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
