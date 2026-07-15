#!/usr/bin/env node
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8765/index.sim.html";
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push("PAGE: " + e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push("CON: " + msg.text());
});

await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);

const state = await page.evaluate(() => ({
  pddReady: !!window.PDD?.isReady?.(),
  topics: document.querySelectorAll(".rm-topic-card").length,
  hubDriveDisplay: getComputedStyle(document.getElementById("rm-hub-drive")).display,
  hubScenariosDisplay: getComputedStyle(document.getElementById("rm-hub-scenarios")).display,
  pixi: typeof window.PIXI,
  cityGen: typeof window.CityGen,
}));

console.log("STATE", state);

await page.click('.rm-mode-tab[data-mode="drive"]');
await page.waitForTimeout(400);
const afterTab = await page.evaluate(() => ({
  hubDriveDisplay: getComputedStyle(document.getElementById("rm-hub-drive")).display,
  hubScenariosDisplay: getComputedStyle(document.getElementById("rm-hub-scenarios")).display,
}));
console.log("TAB", afterTab);

page.on("dialog", async (d) => {
  console.log("ALERT:", d.message());
  await d.dismiss();
});
await page.click("#rm-drive-start");
await page.waitForTimeout(2500);

const drive = await page.evaluate(() => ({
  driveHidden: document.getElementById("rm-drive")?.classList.contains("hidden"),
  hasCanvas: !!document.querySelector("#rm-drive-canvas-host canvas"),
}));
console.log("DRIVE", drive);
if (errors.length) console.log("ERRORS", errors);

await browser.close();
process.exit(errors.length || !state.pddReady || !drive.hasCanvas ? 1 : 0);
