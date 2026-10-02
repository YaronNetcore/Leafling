import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { daysBetween, displayName, relativeDays, soilCheckPlan, STATUS_LABEL } from "../../shared/domain.ts";
import { lightFit, speciesById } from "../../shared/species.ts";
import type { Location, Plant, PlantEvent, Status } from "../../shared/types.ts";
import { archivePlant, deletePlant, removeFromWishlist, speciesOf, toggleFavorite, useEvents, useLocations, usePlants, useWishlist } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { Button, Card, EmptyState, IconButton, Input, PageHeader, PlantImage, Sheet, SpeciesImage, TabRow, cx, useToast } from "../ui/ui.tsx";

type Tab = "all" | Status | "wishlist";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "הכול" }, { id: "rooting", label: "בהשרשה" }, { id: "seedling", label: "שתילים" },
  { id: "plant", label: "צמחים" }, { id: "sick", label: "חולים" }, { id: "wishlist", label: "♡ צמחי החלומות שלי" },
];
type Sort = "recent" | "name" | "location" | "acquired" | "next_check";
const SORTS: { id: Sort; label: string }[] = [
  { id: "recent", label: "אחרון שנוסף" }, { id: "next_check", label: "בדיקה הבאה" }, { id: "name", label: "שם" },
  { id: "location", label: "מיקום" }, { id: "acquired", label: "תאריך הגעה" },
];

export function careLine(p: Plant, events: PlantEvent[], now: number): { label: string; value: string; urgent: boolean } {
  if (p.status === "rooting") return { label: "בהשרשה", value: `יום ${Math.max(1, daysBetween(Date.parse(p.propagationStart ?? p.createdAt), now) + 1)}`, urgent: false };
  if (p.status === "seedling" && !(p.germinatedCount ?? 0)) return { label: "מאז הזריעה", value: `יום ${Math.max(1, daysBetween(Date.parse(p.sowDate ?? p.createdAt), now) + 1)}`, urgent: false };
  const plan = soilCheckPlan(p, events, speciesOf(p), now);
  const d = daysBetween(now, plan.nextCheckAt);
  return { label: "בדיקת אדמה", value: d <= 0 ? "היום" : d === 1 ? "מחר" : `עוד ${d} ימים`, urgent: d <= 0 };
}

const FIT_LABEL = { fit: "מתאים", tolerated: "סביר", poor: "פחות מתאים" } as const;

export function PlantCard({ p, events, location, onMenu, list }: { p: Plant; events: PlantEvent[]; location?: Location; onMenu: () => void; list?: boolean }) {
  const nav = useNavigate();
  const sp = speciesOf(p);
  const care = careLine(p, events, Date.now());
  const fit = lightFit(sp, location?.lightCategory);
  const open = () => nav(`/plants/${p.id}`);
  const heart = (
    <button aria-label={p.favorite ? "הסרה מהמועדפים" : "הוספה למועדפים"} onClick={(e) => { e.stopPropagation(); void toggleFavorite(p); }}
      className="pressable grid size-10 place-items-center rounded-full text-white drop-shadow">
      <Icon name="heart" size={26} fill={p.favorite ? "currentColor" : "none"} className={p.favorite ? "text-[#f1a3a3]" : ""} />
    </button>
  );
  const info = (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-water-bg text-water"><Icon name={care.label === "בדיקת אדמה" ? "drop" : p.status === "rooting" ? "root" : "seed"} size={16} /></span>
        <span className="truncate text-[13px] text-muted">{care.label}</span>
        <span className={cx("ms-auto whitespace-nowrap text-[13px] font-semibold", care.urgent ? "text-green" : "text-ink")}>{care.value}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sun-bg text-sun"><Icon name="sun" size={16} /></span>
        <span className="text-[13px] text-muted">אור</span>
        <span className="ms-auto flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold text-ink">
          {fit ? <><span className={cx("size-2 rounded-full", fit === "fit" ? "bg-ok" : fit === "tolerated" ? "bg-attention" : "bg-problem")} />{FIT_LABEL[fit]}</> : <span className="font-normal text-muted">לא נמדד</span>}
        </span>
      </div>
    </div>
  );
  if (list) {
    return (
      <Card className="flex items-center gap-3 p-2.5" onClick={open} as="button">
        <PlantImage plant={p} species={sp} className="size-20 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-bold text-ink">{displayName(p)}</div>
          <div className="truncate text-[14px] text-muted">{location?.name ?? "ללא מיקום"} · {STATUS_LABEL[p.status]}</div>
          {info}
        </div>
      </Card>
    );
  }
  return (
    <Card className="rise flex flex-col p-2" onClick={open} as="button">
      <div className="relative">
        <PlantImage plant={p} species={sp} className="aspect-[7/5] w-full" />
        <div className="absolute start-1 top-1">{heart}</div>
        <button aria-label="פעולות" onClick={(e) => { e.stopPropagation(); onMenu(); }} className="pressable absolute end-2 top-2 grid size-9 place-items-center rounded-xl bg-surface/90 text-ink shadow-soft">
          <span className="text-[18px] leading-none tracking-widest">•••</span>
        </button>
        {p.status !== "plant" && <span className="absolute bottom-2 start-2 rounded-full bg-surface/90 px-2.5 py-0.5 text-[12px] font-semibold text-ink">{STATUS_LABEL[p.status]}</span>}
      </div>
      <div className="px-1.5 pb-1 pt-2">
        <div className="truncate text-[18px] font-bold text-ink">{displayName(p)}</div>
        <div className="truncate text-[14px] text-muted">{location?.name ?? "ללא מיקום"}</div>
        {info}
      </div>
    </Card>
  );
}

export default function MyPlants() {
  const nav = useNavigate();
  const toast = useToast();
  const plants = usePlants();
  const events = useEvents();
  const locations = useLocations();
  const wishlist = useWishlist();
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<Plant | null>(null);

  const locById = useMemo(() => new Map((locations ?? []).map((l) => [l.id, l])), [locations]);
  const evByPlant = useMemo(() => {
    const m = new Map<string, PlantEvent[]>();
    for (const e of events ?? []) { if (!m.has(e.plantId)) m.set(e.plantId, []); m.get(e.plantId)!.push(e); }
    return m;
  }, [events]);

  const list = useMemo(() => {
    const now = Date.now();
    const q = query.trim().toLowerCase();
    let xs = (plants ?? []).filter((p) => (showArchived ? !!p.archivedAt : !p.archivedAt));
    if (tab !== "all" && tab !== "wishlist") xs = xs.filter((p) => p.status === tab);
    if (q) xs = xs.filter((p) => [displayName(p), p.commonName, p.scientificName, ...(speciesById(p.speciesId)?.aliases ?? [])].some((s) => s?.toLowerCase().includes(q)));
    const name = (p: Plant) => displayName(p);
    const cmp: Record<Sort, (a: Plant, b: Plant) => number> = {
      recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => name(a).localeCompare(name(b), "he"),
      location: (a, b) => (locById.get(a.locationId ?? "")?.name ?? "תתת").localeCompare(locById.get(b.locationId ?? "")?.name ?? "תתת", "he"),
      acquired: (a, b) => (b.acquiredAt ?? b.createdAt).localeCompare(a.acquiredAt ?? a.createdAt),
      next_check: (a, b) => soilCheckPlan(a, evByPlant.get(a.id) ?? [], speciesOf(a), now).nextCheckAt - soilCheckPlan(b, evByPlant.get(b.id) ?? [], speciesOf(b), now).nextCheckAt,
    };
    return xs.sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || cmp[sort](a, b));
  }, [plants, tab, query, sort, locById, evByPlant, showArchived]);

  const archivedCount = (plants ?? []).filter((p) => p.archivedAt).length;
  const loading = plants === undefined;

  return (
    <div>
      <img src="/img/deco/leaves-bottom-left.webp" alt="" aria-hidden className="deco pointer-events-none absolute end-0 top-0 w-36 -scale-y-100 opacity-70" />
      <PageHeader title="הצמחים שלי" subtitle="כל הצמחים שלך במקום אחד"
        start={<IconButton icon="plus" label="הוספת צמח" filled onClick={() => nav("/plants/new")} />}
        end={<IconButton icon="search" label="חיפוש בצמחים שלי" onClick={() => setSearching((s) => !s)} />} />
      <div className="px-4">
        {searching && <div className="mb-3"><Input icon="search" autoFocus placeholder="שם, זן או כינוי" value={query} onChange={(e) => setQuery(e.target.value)} /></div>}
        <TabRow tabs={TABS} value={tab} onChange={setTab} />
        {tab !== "wishlist" && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <label className="flex min-h-11 items-center gap-2 rounded-full bg-surface ps-2 pe-3 shadow-soft">
              <span className="grid size-8 place-items-center rounded-full bg-sage text-green"><Icon name="sort" size={18} /></span>
              <span className="text-[15px] text-muted">מיון:</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="appearance-none bg-transparent text-[15px] font-medium text-ink outline-none" aria-label="מיון">
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <Icon name="down" size={16} className="text-muted" />
            </label>
            <div className="flex gap-2">
              <IconButton icon="list" label="תצוגת רשימה" className={view === "list" ? "!bg-sage !text-green" : ""} onClick={() => setView("list")} />
              <IconButton icon="grid" label="תצוגת רשת" className={view === "grid" ? "!bg-sage !text-green" : ""} onClick={() => setView("grid")} />
            </div>
          </div>
        )}

        {tab === "wishlist" ? (
          <div className="mt-4">
            {!wishlist?.length ? (
              <EmptyState title="עוד אין צמחי חלומות" text="בעמוד של כל זן אפשר ללחוץ על ♡ כדי לשמור אותו כאן." action={<Button variant="secondary" icon="search" onClick={() => nav("/find")} className="w-full">לחפש צמחים</Button>} />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {wishlist.map((w) => {
                  const sp = speciesById(w.speciesId);
                  return (
                    <Card key={w.id} className="flex flex-col p-2">
                      <button onClick={() => nav(`/find/species/${w.speciesId}`)} className="pressable text-start">
                        <SpeciesImage species={sp} className="aspect-[7/5] w-full" />
                        <div className="px-1.5 pt-2 text-[17px] font-bold text-ink">{sp?.he ?? w.speciesId}</div>
                        <div className="px-1.5 text-[13px]"><span className="sci text-muted">{sp?.scientific}</span></div>
                      </button>
                      <div className="mt-2 flex gap-1.5 px-1 pb-1">
                        <Button size="sm" className="flex-1 !px-2" onClick={() => nav(`/plants/new?species=${w.speciesId}&wishlist=${w.id}`)}>🌱 קניתי!</Button>
                        <IconButton icon="trash" label="הסרה מצמחי החלומות" onClick={() => { void removeFromWishlist(w); toast("הוסר מצמחי החלומות"); }} />
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="mt-4 grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-60 rounded-card" />)}</div>
        ) : !list.length ? (
          (plants ?? []).length === 0 ? (
            <EmptyState title="עוד אין כאן צמחים" text="נתחיל מהצמח הראשון שלך — אפשר לצלם, לבחור זן או לדלג על פרטים." action={<Button icon="plus" onClick={() => nav("/plants/new")} className="w-full">הוספת הצמח הראשון שלי</Button>} />
          ) : <EmptyState title="לא מצאנו צמחים כאן" text={query ? "נסי שם אחר או נקי את החיפוש." : "אין צמחים בקטגוריה הזו כרגע."} />
        ) : (
          <div className={cx("mt-4", view === "grid" ? "grid grid-cols-2 gap-3" : "space-y-3")}>
            {list.map((p) => <PlantCard key={p.id} p={p} list={view === "list"} events={evByPlant.get(p.id) ?? []} location={locById.get(p.locationId ?? "")} onMenu={() => setMenuFor(p)} />)}
          </div>
        )}
        {tab !== "wishlist" && archivedCount > 0 && (
          <button className="pressable mx-auto mt-6 block min-h-11 text-[15px] font-medium text-green" onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "חזרה לצמחים הפעילים" : `צמחים בארכיון (${archivedCount})`}
          </button>
        )}
      </div>

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? displayName(menuFor) : ""}>
        {menuFor && (
          <div className="space-y-2">
            <Button variant="outline" icon="leaf" className="w-full" onClick={() => { nav(`/plants/${menuFor.id}`); setMenuFor(null); }}>פתיחת הכרטיס</Button>
            <Button variant="outline" icon="camera" className="w-full" onClick={() => { nav(`/plants/${menuFor.id}?photo=1`); setMenuFor(null); }}>הוספת תמונה</Button>
            <Button variant="outline" icon="archive" className="w-full" onClick={() => { void archivePlant(menuFor); toast(menuFor.archivedAt ? "הוחזר מהארכיון" : "הועבר לארכיון"); setMenuFor(null); }}>{menuFor.archivedAt ? "החזרה מהארכיון" : "העברה לארכיון"}</Button>
            <Button variant="danger" icon="trash" className="w-full" onClick={() => { if (confirm("למחוק את הצמח? אפשר לשחזר מהאשפה במשך 30 יום.")) { void deletePlant(menuFor); toast("הצמח הועבר לאשפה ל־30 יום"); } setMenuFor(null); }}>מחיקה</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
