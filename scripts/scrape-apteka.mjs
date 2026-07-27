#!/usr/bin/env node
/**
 * Тренажёр названий лекарств — данные с apteka.by (Беларусь).
 * Категории повторяют структуру каталога аптек (см. скрин пользователя):
 * Лекарства / БАД / ИМН / Лечебное питание / Тонометры / Глюкометры /
 * Тест-полоски / Тесты на беременность / Контактные линзы / Аптечки.
 *
 * Только справочные данные (название, фото упаковки, производитель) —
 * для личного заучивания названий, без цен и заказа.
 *
 * Запуск: node scripts/scrape-apteka.mjs [--pages=N] [--only=id1,id2]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/meds");
const IMG_DIR = join(OUT, "img");
const BASE = "https://apteka.by";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const PAGE_LIMIT_OVERRIDE = args.pages ? parseInt(args.pages, 10) : null;
const ONLY = args.only ? String(args.only).split(",") : null;

// Форма выпуска — оставляем только твёрдые пероральные формы ("именно таблетки"),
// это фильтруется для больших категорий (лекарства/БАД).
const TABLET_RE = /таблет|капсул|драже|пастилк/i;

// Продукты лечебного (энтерального/клинического) питания встречаются вперемешку
// с обычными лекарствами и БАД — вылавливаем их по бренду/ключевым словам.
const NUTRITION_RE =
  /нутридринк|nutridrink|нутризон|nutrison|фрезубин|fresubin|пептамен|peptamen|нутриэн|nutrien|клинутрен|clinutren|диазон|diazon|нутрикомп|nutricomp|модулен|modulen|энтеральн|смесь.*питани/i;

const CATEGORIES = [
  { id: "lekarstva", title: "Лекарства от А до Я", path: "drugs", maxPages: 18, tabletOnly: true },
  { id: "bad", title: "БАД от А до Я", path: "bads", maxPages: 12, tabletOnly: true },
  { id: "imn", title: "ИМН от А до Я", path: "medicinskie-izdeliya", maxPages: 3 },
  { id: "tonometry", title: "Тонометры", path: "medicinskaya-tehnika/tonometry-i-prinadlezhnosti-b5b41fac", maxPages: 2 },
  { id: "glyukometry", title: "Глюкометры", path: "medicinskaya-tehnika/glyukometry-i-prinadlezhnosti-05f971b5", maxPages: 2 },
  {
    id: "test-poloski",
    title: "Тест-полоски",
    path: "medicinskie-izdeliya/ekspress-testy-aa942ab2/testy-diagnosticheskiye-e7b24b11",
    maxPages: 2,
  },
  {
    id: "testy-beremennost",
    title: "Тесты на беременность",
    path: "medicinskie-izdeliya/ekspress-testy-aa942ab2/testy-na-beremennost-i-ovulyatsiyu-c058f544",
    maxPages: 2,
  },
  { id: "linzy", title: "Контактные линзы", path: "optika/kontaktnyye-linzy-ab817c93", maxPages: 2 },
  { id: "aptechki", title: "Аптечки", path: "medicinskie-izdeliya/aptechki-i-tabletnitsy-32072254", maxPages: 2 },
  // lechebnoe-pitanie заполняется по ключевым словам из lekarstva/bad — см. ниже.
  { id: "lechebnoe-pitanie", title: "Лечебное питание", path: null, maxPages: 0 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function parseCards(html) {
  const slugRe = /href="\/goods\/([a-z0-9-]+)"/g;
  const positions = [];
  let m;
  while ((m = slugRe.exec(html))) positions.push({ slug: m[1], index: m.index });

  const bySlug = new Map();
  for (let i = 0; i < positions.length; i++) {
    const { slug, index } = positions[i];
    if (bySlug.has(slug)) continue;
    const end = i + 1 < positions.length ? positions[i + 1].index : index + 4000;
    const window = html.slice(index, end);
    const img = window.match(/ProductsImg\/[a-zA-Z0-9/_.-]+\.(?:webp|jpg|jpeg|png)/);
    const name = window.match(/line-clamp-3">([^<]+)</);
    if (!img || !name) continue;
    const manuf = window.match(/text-grayText line-clamp-1">([^<]+)</);
    bySlug.set(slug, {
      slug,
      name: name[1].trim(),
      manufacturer: manuf ? manuf[1].trim() : "",
      imageUrl: `${BASE}/${img[0]}`,
      sourceUrl: `${BASE}/goods/${slug}`,
    });
  }
  return [...bySlug.values()];
}

async function scrapeCategoryPages(path, maxPages) {
  const all = [];
  const seen = new Set();
  const limit = PAGE_LIMIT_OVERRIDE ?? maxPages;
  for (let page = 1; page <= Math.max(limit, 1); page++) {
    const url = page === 1 ? `${BASE}/${path}` : `${BASE}/${path}?page=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      console.warn(`  ✗ ${url}: ${e.message}`);
      break;
    }
    const items = parseCards(html).filter((it) => !seen.has(it.slug));
    console.log(`  ${path} page ${page}: ${items.length} new items`);
    if (!items.length) break;
    items.forEach((it) => seen.add(it.slug));
    all.push(...items);
    await sleep(300);
  }
  return all;
}

async function downloadImage(url, dest) {
  if (existsSync(dest)) return true;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(dest));
    return true;
  } catch (e) {
    console.warn(`  ✗ img ${url}: ${e.message}`);
    return false;
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

function extOf(url) {
  const m = url.match(/\.(webp|jpg|jpeg|png)(?:\?|$)/i);
  return m ? m[1].toLowerCase() : "jpg";
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const buckets = new Map(CATEGORIES.map((c) => [c.id, []]));
  const nutrition = [];
  const nutritionSeen = new Set();

  for (const cat of CATEGORIES) {
    if (!cat.path) continue;
    if (ONLY && !ONLY.includes(cat.id)) continue;
    console.log(`\n=== ${cat.title} (${cat.id}) ===`);
    const raw = await scrapeCategoryPages(cat.path, cat.maxPages);

    for (const item of raw) {
      if (NUTRITION_RE.test(item.name) && (cat.id === "lekarstva" || cat.id === "bad")) {
        if (!nutritionSeen.has(item.slug)) {
          nutritionSeen.add(item.slug);
          nutrition.push(item);
        }
        continue;
      }
      if (cat.tabletOnly && !TABLET_RE.test(item.name)) continue;
      buckets.get(cat.id).push(item);
    }
    console.log(`  → сохранено: ${buckets.get(cat.id).length}${cat.id === "lekarstva" || cat.id === "bad" ? ` (+ ${nutrition.length} в «Лечебное питание»)` : ""}`);
  }

  if (!ONLY || ONLY.includes("lechebnoe-pitanie")) {
    buckets.set("lechebnoe-pitanie", nutrition);
  }

  const categories = [];
  for (const cat of CATEGORIES) {
    const items = buckets.get(cat.id) || [];
    if (!items.length) {
      categories.push({ id: cat.id, title: cat.title, items: [] });
      continue;
    }
    await mkdir(join(IMG_DIR, cat.id), { recursive: true });
    console.log(`\nСкачивание фото: ${cat.title} (${items.length})…`);
    const results = await mapLimit(items, 8, async (item) => {
      const ext = extOf(item.imageUrl);
      const file = `${item.slug}.${ext}`;
      const dest = join(IMG_DIR, cat.id, file);
      const ok = await downloadImage(item.imageUrl, dest);
      return ok ? `img/${cat.id}/${file}` : null;
    });

    const finalItems = items
      .map((item, i) => ({
        id: `${cat.id}-${item.slug}`,
        name: item.name,
        manufacturer: item.manufacturer,
        image: results[i],
        sourceUrl: item.sourceUrl,
      }))
      .filter((it) => it.image);

    categories.push({ id: cat.id, title: cat.title, items: finalItems });
  }

  const index = {
    version: 1,
    source: "https://apteka.by/",
    license: "Данные каталога apteka.by — только для личного заучивания названий, без коммерческого использования",
    generatedAt: new Date().toISOString(),
    categories: categories.map((c) => ({ id: c.id, title: c.title, count: c.items.length })),
  };
  await writeFile(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  for (const c of categories) {
    await writeFile(join(OUT, `${c.id}.json`), JSON.stringify({ id: c.id, title: c.title, items: c.items }, null, 2));
  }

  console.log("\nГотово:");
  for (const c of categories) console.log(`  ${c.title}: ${c.items.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
