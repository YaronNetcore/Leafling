import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { displayName, STATUS_LABEL } from "../../shared/domain.ts";
import type { Plant } from "../../shared/types.ts";
import { speciesOf, useLocations, usePlants } from "../data/store.ts";
import { Icon } from "./icons.tsx";
import { Button, Input, PlantImage, Sheet, cx } from "./ui.tsx";

// "Which of MY plants?" — the one picker for every action about an existing personal plant (locations, light
// readings, AI Botanist, moves). Options come ONLY from this user's own plant records (their IndexedDB, synced from
// their own server rows) — never from the general species catalog. Every option is one plant instance (its id):
// two plants of the same species stay two separate, distinguishable choices.

const norm = (s: string) => s.toLowerCase().replace(/[֑-ׇ'"׳״\-\s.]/g, "");

/** Name line + species line for a personal plant: the personal name first, then what it is. */
export function plantLines(p: Plant): { title: string; species: string; sci: string } {
  const title = displayName(p);
  const species = p.nickname?.trim() ? (p.ordinal > 1 ? `${p.commonName} #${p.ordinal}` : p.commonName) : "";
  return { title, species, sci: p.scientificName ?? "" };
}

export function PersonalPlantPicker({ open, onClose, title, onPick, currentLocationId, pickLabel, testid = "plant-picker" }: {
  open: boolean; onClose: () => void; title: string; onPick: (p: Plant) => void;
  /** When picking for a location: plants already there are marked, others show where they are now. */
  currentLocationId?: string | null;
  pickLabel?: (p: Plant) => string | null;
  testid?: string;
}) {
  const nav = useNavigate();
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt && !p.deletedAt);
  const locations = useLocations() ?? [];
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = norm(q);
    const list = [...plants].sort((a, b) => displayName(a).localeCompare(displayName(b), "he"));
    return n ? list.filter((p) => [displayName(p), p.nickname ?? "", p.commonName, p.scientificName ?? ""].some((s) => norm(s).includes(n))) : list;
  }, [plants, q]);
  const locName = (id?: string | null) => locations.find((l) => l.id === id)?.name;
  return (
    <Sheet open={open} onClose={() => { setQ(""); onClose(); }} title={title}>
      <div data-testid={testid}>
        {!plants.length ? (
          <div className="space-y-3 py-4 text-center" data-testid="plant-picker-empty">
            <p className="text-[17px] font-semibold text-ink">אין עדיין צמחים ב'הצמחים שלי' 🌱</p>
            <p className="text-[14px] text-muted">כאן מופיעים רק הצמחים שלך — אחרי שמוסיפים צמח אפשר לבחור אותו.</p>
            <Button icon="plus" className="w-full" onClick={() => { onClose(); nav("/plants/new"); }}>הוספת צמח</Button>
          </div>
        ) : (
          <>
            {plants.length > 6 && <Input icon="search" placeholder="חיפוש בצמחים שלי…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />}
            {!shown.length && <p className="py-6 text-center text-[15px] text-muted">לא נמצא צמח כזה בצמחים שלך.</p>}
            <div className="space-y-2">
              {shown.map((p) => {
                const l = plantLines(p);
                const here = currentLocationId != null && p.locationId === currentLocationId;
                const where = p.locationId ? locName(p.locationId) : null;
                const extra = pickLabel?.(p);
                return (
                  <button key={p.id} type="button" data-plant-id={p.id} data-testid="plant-option" onClick={() => onPick(p)}
                    className={cx("pressable flex w-full items-center gap-3 rounded-2xl p-2.5 text-start shadow-soft", here ? "bg-sage" : "bg-surface")}>
                    <PlantImage plant={p} species={speciesOf(p)} className="size-14 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-bold text-ink">{l.title}</div>
                      {(l.species || l.sci) && <div className="truncate text-[13px] text-muted">{l.species}{l.species && l.sci ? " · " : ""}{l.sci && <span className="sci">{l.sci}</span>}</div>}
                      <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                        <Icon name="pin" size={13} />
                        <span className="truncate">{here ? "כבר כאן" : where ? `כרגע: ${where}` : "ללא מיקום"}</span>
                        {p.status !== "plant" && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px]">{STATUS_LABEL[p.status]}</span>}
                      </div>
                      {extra && <div className="mt-0.5 text-[12px] font-semibold text-green">{extra}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
