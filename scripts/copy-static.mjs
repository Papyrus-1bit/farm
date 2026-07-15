import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "..", "dist");

const copyFiles = [
  "citygen.js",
  "sprites.js",
  "scenario-gen.js",
  "drive.js",
  "roadmind.js",
  "app.js",
  "styles.css",
  "index.legacy.html",
];

const copyDirs = ["data", "scenarios", "vendor", "assets"];

for (const f of copyFiles) {
  fs.copyFileSync(path.join(root, "..", f), path.join(dist, f));
}
for (const d of copyDirs) {
  const src = path.join(root, "..", d);
  const dst = path.join(dist, d);
  fs.cpSync(src, dst, { recursive: true });
}

console.log("Static assets copied to dist/");
