#!/usr/bin/env node
/**
 * Справочник ПДД: знаки 1–8, разметка — тексты и PNG с avto-russia.ru/pdd/
 * Запуск: node scripts/scrape-pdd-ref.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/pdd-ref");
const IMG = join(OUT, "img");
const BASE = "https://avto-russia.ru/pdd";

const PAGES = [
  { id: "signs-1", title: "1. Предупреждающие знаки", url: `${BASE}/znaki1.html`, kind: "sign" },
  { id: "signs-2", title: "2. Знаки приоритета", url: `${BASE}/znaki2.html`, kind: "sign" },
  { id: "signs-3", title: "3. Запрещающие знаки", url: `${BASE}/znaki3.html`, kind: "sign" },
  { id: "signs-4", title: "4. Предписывающие знаки", url: `${BASE}/znaki4.html`, kind: "sign" },
  { id: "signs-5", title: "5. Знаки особых предписаний", url: `${BASE}/znaki5.html`, kind: "sign" },
  { id: "signs-6", title: "6. Информационные знаки", url: `${BASE}/znaki6.html`, kind: "sign" },
  { id: "signs-7", title: "7. Знаки сервиса", url: `${BASE}/znaki7.html`, kind: "sign" },
  { id: "signs-8", title: "8. Знаки доп. информации (таблички)", url: `${BASE}/znaki8.html`, kind: "sign" },
  { id: "mark-h", title: "1. Горизонтальная разметка", url: `${BASE}/razmetka1.html`, kind: "marking" },
  { id: "mark-v", title: "2. Вертикальная разметка", url: `${BASE}/razmetka2.html`, kind: "marking" },
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

function parseItems(html, kind) {
  const items = [];
  const re = /<li class="list-group-item"[\s\S]*?<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[0];
    const imgM = block.match(/src="img\/([^"]+\.png)"/i);
    if (!imgM) continue;
    const file = imgM[1];
    const codeM = block.match(/<span><b>([^<]+)<\/b><\/span>/i) || block.match(/alt="[^"]*?\s([\d.]+)"/i);
    const code = codeM ? codeM[1].trim() : file.replace(/\.png$/i, "").replace(/^h/, "");
    const nameM = block.match(/<h3 class="name">([^<]+)<\/h3>/i);
    const name = nameM ? stripHtml(nameM[1]) : code;
    const descM = block.match(/<div class="col-xs-12 col-sm-10">([\s\S]*?)<\/div>/i);
    let desc = "";
    if (descM) {
      desc = stripHtml(descM[1].replace(/<h3[^>]*>[\s\S]*?<\/h3>/i, ""));
    }
    items.push({
      id: `${kind}-${code}`,
      code,
      name,
      desc,
      image: `img/${file}`,
      kind,
    });
  }
  return items;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function main() {
  await mkdir(IMG, { recursive: true });
  const sections = [];
  const seen = new Set();

  for (const page of PAGES) {
    console.log(`Parse ${page.title}…`);
    const res = await fetch(page.url);
    if (!res.ok) throw new Error(page.url);
    const html = await res.text();
    const items = parseItems(html, page.kind);
    console.log(`  ${items.length} items`);

    for (const item of items) {
      const imgUrl = `${BASE}/${item.image}`;
      const local = join(OUT, item.image);
      if (!seen.has(item.image)) {
        seen.add(item.image);
        try {
          await download(imgUrl, local);
        } catch (e) {
          console.warn("  skip img", item.image, e.message);
        }
      }
    }

    sections.push({ ...page, items });
    await new Promise((r) => setTimeout(r, 400));
  }

  const index = {
    version: 1,
    source: "https://avto-russia.ru/pdd/",
    license: "Справочные материалы avto-russia.ru — только для личного обучения",
    pddRulesUrl: "https://avto-russia.ru/pdd/pdd_rf.html",
    sections,
  };

  await writeFile(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nDone → data/pdd-ref/index.json (${seen.size} images)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
