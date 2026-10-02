import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

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
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), serviceWorker()],
  build: { outDir: "dist", sourcemap: false, target: "safari16" },
  server: { proxy: { "/api": "http://localhost:8799" } },
});
