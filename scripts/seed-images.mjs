#!/usr/bin/env node
// Upload the licensed demo photos in seed-assets/tools into Convex storage and
// attach them (with attribution) to the seed tools.
//
//   npx convex run seed:run        # first create the seed data
//   node scripts/seed-images.mjs   # then attach photos (safe to re-run)
//   node scripts/seed-images.mjs --prod   # same, against the production deployment
//
// Uses the Convex CLI, so it works against whichever deployment `npx convex`
// is configured for (local or cloud dev). Requires SEED_ENABLED=true there.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const assets = path.join(root, "seed-assets");
const dir = path.join(assets, "tools");
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
// Manifest paths are relative to seed-assets/ ("tools/drill.jpg"); accept bare names too.
const fileOf = (entry) => path.join(entry.file.includes("/") ? assets : dir, entry.file);

const target = process.argv.includes("--prod") ? ["--prod"] : [];

function convexRun(fn, args = {}) {
  const out = execFileSync("npx", ["convex", "run", ...target, fn, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out.trim());
}

const byKey = new Map();
for (const entry of manifest) {
  const list = byKey.get(entry.key) ?? [];
  list.push(entry);
  byKey.set(entry.key, list);
}

for (const [key, entries] of byKey) {
  // Hero photo (key.jpg) first, then key-2.jpg, …
  entries.sort((a, b) => a.file.replace(/\.jpg$/, "").length - b.file.replace(/\.jpg$/, "").length || a.file.localeCompare(b.file));
  const storageIds = [];
  for (const entry of entries) {
    const uploadUrl = convexRun("seed:imageUploadUrl");
    const body = readFileSync(fileOf(entry));
    const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body });
    if (!res.ok) throw new Error(`Upload failed for ${entry.file}: HTTP ${res.status}`);
    const { storageId } = await res.json();
    storageIds.push(storageId);
  }
  const credits = entries.map((e) => ({ creator: e.creator || "Unknown", license: e.license, sourceUrl: e.sourceUrl }));
  const result = convexRun("seed:attachImages", { key, storageIds, credits });
  console.log(`✓ ${result.tool}: ${result.images} photo(s)`);
}
