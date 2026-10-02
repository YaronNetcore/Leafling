import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

// Build stamp: the Git commit this build was made from (Workers Builds sets WORKERS_CI_COMMIT_SHA).
// Shown in Settings and served as /version.json so a live deployment can be matched to a commit.
const COMMIT = (() => {
  if (process.env.WORKERS_CI_COMMIT_SHA) return process.env.WORKERS_CI_COMMIT_SHA;
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; }
})();
const BUILT_AT = new Date().toISOString();

/** Emits dist/sw.js with a per-build id and the hashed asset list (no extra dependency). */
function serviceWorker(): Plugin {
  let files: string[] = [];
  return {
    name: "leafling-sw",
    apply: "build",
    generateBundle(_, bundle) { files = Object.keys(bundle).map((f) => `/${f}`); },
    writeBundle(opts) {
      const id = Date.now().toString(36);
      const precache = ["/", "/index.html", "/manifest.webmanifest", "/icons/apple-touch-icon.png", "/icons/icon-192.png", ...files.filter((f) => f.startsWith("/assets/") && (!f.endsWith(".woff2") || /rubik-(hebrew|latin)-wght/.test(f)))];
      const src = readFileSync("src/app/sw-template.js", "utf8").replaceAll("__BUILD_ID__", id).replaceAll("__PRECACHE__", JSON.stringify(precache));
      writeFileSync(`${opts.dir}/sw.js`, src);
      writeFileSync(`${opts.dir}/version.json`, JSON.stringify({ app: "leafling", commit: COMMIT, builtAt: BUILT_AT, multiUser: true }));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), serviceWorker()],
  define: { __BUILD_COMMIT__: JSON.stringify(COMMIT) },
  build: { outDir: "dist", sourcemap: false, target: "safari16" },
  server: { proxy: { "/api": "http://localhost:8799" } },
});
