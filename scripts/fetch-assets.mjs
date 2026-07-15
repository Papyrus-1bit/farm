#!/usr/bin/env node
/**
 * Скачивает ассеты для RoadMind-сима: ГОСТ-знаки (Wikimedia), CC0-машины, разметка.
 * Запуск: node scripts/fetch-assets.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOST_DIR = join(ROOT, "assets/svg/gost");
const PACKS_DIR = join(ROOT, "assets/packs");

const GOST_SIGNS = [
  ["2.4", "RU_road_sign_2.4.svg"],
  ["2.5", "RU_road_sign_2.5.svg"],
  ["2.1", "RU_road_sign_2.1.svg"],
  ["2.6", "RU_road_sign_2.6.svg"],
  ["2.7", "RU_road_sign_2.7.svg"],
  ["3.1", "RU_road_sign_3.1.svg"],
  ["3.24-60", "RU_road_sign_3.24-60.svg"],
  ["3.24-40", "RU_road_sign_3.24-40.svg"],
  ["3.28", "RU_road_sign_3.28.svg"],
  ["3.27", "RU_road_sign_3.27.svg"],
  ["5.19.1", "RU_road_sign_5.19.1.svg"],
  ["1.23", "RU_road_sign_1.23.svg"],
  ["1.1", "RU_road_sign_1.1.svg"],
  ["4.1.1", "RU_road_sign_4.1.1.svg"],
  ["6.4", "RU_road_sign_6.4.svg"],
  ["4.1.2", "RU_road_sign_4.1.2.svg"],
];

const PACKS = [
  {
    name: "tiny-cars-cc0",
    url: "https://opengameart.org/sites/default/files/tiny-cars-cc0.zip",
    unzipTo: "tiny-cars",
  },
  {
    name: "street-lines",
    url: "https://opengameart.org/sites/default/files/street_lines.zip",
    unzipTo: "street-lines",
    note: "Крупные PNG (~512px), накладываются поверх асфальта",
  },
];

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function fetchGost() {
  await mkdir(GOST_DIR, { recursive: true });
  let ok = 0;
  for (const [code, file] of GOST_SIGNS) {
    const dest = join(GOST_DIR, `${code}.svg`);
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`;
    try {
      await download(url, dest);
      console.log(`  ✓ ${code}.svg`);
      ok++;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.warn(`  ✗ ${code}: ${e.message}`);
    }
  }
  return ok;
}

async function fetchPacks() {
  await mkdir(PACKS_DIR, { recursive: true });
  for (const pack of PACKS) {
    const zipPath = join(PACKS_DIR, `${pack.name}.zip`);
    const outDir = join(PACKS_DIR, pack.unzipTo);
    try {
      console.log(`\nPack: ${pack.name}`);
      await download(pack.url, zipPath);
      execSync(`unzip -qo "${zipPath}" -d "${outDir}"`, { stdio: "inherit" });
      console.log(`  ✓ → assets/packs/${pack.unzipTo}/`);
    } catch (e) {
      console.warn(`  ✗ ${pack.name}: ${e.message}`);
    }
  }
}

console.log("ГОСТ-знаки (Wikimedia Commons, CC BY-SA 3.0)…");
const n = await fetchGost();
console.log(`\nЗнаков: ${n}/${GOST_SIGNS.length}`);

console.log("\nCC0-паки (OpenGameArt)…");
await fetchPacks();

console.log("\nГотово. См. assets/ASSETS.md");
