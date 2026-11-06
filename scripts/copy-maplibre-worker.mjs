// Self-host the MapLibre GL worker (same origin → CSP-friendly, no CDN).
// Runs on postinstall / predev / prebuild.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const outDir = path.join(process.cwd(), "public", "vendor");
mkdirSync(outDir, { recursive: true });
copyFileSync(path.join(pkgDir, "dist", "maplibre-gl-worker.mjs"), path.join(outDir, `maplibre-gl-worker-${version}.mjs`));
console.log(`maplibre worker ${version} → public/vendor/`);
