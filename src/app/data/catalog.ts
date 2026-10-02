import { useEffect, useState } from "react";
import { validateEntry, type CatalogEntry, type CatalogPack } from "../../shared/catalog.ts";

// Loads the general plant catalog packs listed in /catalog/index.json (static data, same for every user — no
// personal data). Loaded lazily (not in the main bundle), once per session, validated entry by entry; the
// service worker keeps a copy for offline use. Adding species = adding entries/packs, no code change.

export interface Catalog { entries: CatalogEntry[]; byId: Map<string, CatalogEntry>; provenance: string; toxicity: string; skipped: number }
let loading: Promise<Catalog> | null = null;
let loaded: Catalog | null = null;

export function loadCatalog(): Promise<Catalog> {
  if (!loading) {
    loading = (async () => {
      const idx = (await (await fetch("/catalog/index.json", { cache: "no-cache" })).json()) as { packs: string[] };
      const packs = await Promise.all(idx.packs.filter((p) => /^[a-z0-9-]+\.json$/.test(p)).map(async (p) => (await (await fetch(`/catalog/${p}`)).json()) as CatalogPack));
      const entries: CatalogEntry[] = [];
      const byId = new Map<string, CatalogEntry>();
      let skipped = 0;
      for (const pack of packs) for (const e of pack.entries) {
        if (!validateEntry(e) || byId.has(e.id)) { skipped++; continue; }
        entries.push(e); byId.set(e.id, e);
      }
      loaded = { entries, byId, provenance: packs[0]?.provenance.he ?? "", toxicity: packs[0]?.provenance.toxicity_he ?? "", skipped };
      return loaded;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** The catalog once loaded (null while loading or offline without a cached copy). */
export function useCatalog(): Catalog | null {
  const [c, setC] = useState<Catalog | null>(loaded);
  useEffect(() => { if (!loaded) loadCatalog().then(setC, () => setC(null)); }, []);
  return c;
}
