import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { LIGHT_LABEL, lightFit, SPECIES, speciesById } from "../../shared/species.ts";
import type { LightCat, Location } from "../../shared/types.ts";
import { addLightReading, createLocation, luxToCategory, moveTo, speciesOf, updateLocation, useLights, useLocation, useLocations, usePlants, useWishlist } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Button, Card, Chip, EmptyState, Field, IconButton, InfoNote, Input, PageHeader, PlantImage, SectionTitle, Select, Sheet, cx, useToast } from "../ui/ui.tsx";

export function placeImage(l: Pick<Location, "name" | "kind">): string {
  const n = l.name;
  if (/מרפסת/.test(n)) return "/img/places/balcony.webp";
  if (/חלון|אדן/.test(n)) return "/img/places/windowsill.webp";
  if (/גינה|חצר/.test(n)) return "/img/places/garden.webp";
  if (/מדף/.test(n)) return "/img/places/other.webp";
  return l.kind === "outdoor" ? "/img/places/outdoors.webp" : "/img/places/indoors.webp";
}

const LIGHT_TONE: Record<LightCat, string> = { low: "bg-surface-2 text-muted", medium: "bg-sage text-green", bright_indirect: "bg-sun-bg text-soil", direct: "bg-sun-bg text-sun" };
export function LightBadge({ cat }: { cat?: LightCat | null }) {
  return cat ? <span className={cx("inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold", LIGHT_TONE[cat])}><Icon name="sun" size={14} />{LIGHT_LABEL[cat]}</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-[13px] text-muted"><Icon name="sun" size={14} />אור לא נמדד</span>;
}

function LocationForm({ initial, onSave }: { initial?: Location; onSave: (l: Partial<Location> & { name: string }) => void }) {
  const [l, setL] = useState<Partial<Location>>(initial ?? { kind: "indoor" });
  return (
    <div className="space-y-3">
      <Field label="שם המיקום"><Input autoFocus value={l.name ?? ""} onChange={(e) => setL({ ...l, name: e.target.value })} placeholder='למשל: "סלון — ליד החלון", "מדף", "מרפסת"' /></Field>
      <div className="flex gap-2"><Chip selected={l.kind === "indoor"} onClick={() => setL({ ...l, kind: "indoor" })} icon="home">בפנים</Chip><Chip selected={l.kind === "outdoor"} onClick={() => setL({ ...l, kind: "outdoor" })} icon="sun">בחוץ</Chip></div>
      {l.kind === "indoor" ? (
        <>
          <Field label="כיוון החלון" optional><Select value={l.windowDirection ?? ""} onChange={(e) => setL({ ...l, windowDirection: (e.target.value || null) as Location["windowDirection"] })}><option value="">לא ידוע</option><option value="north">צפון</option><option value="south">דרום</option><option value="east">מזרח</option><option value="west">מערב</option></Select></Field>
          <Field label="מרחק מהחלון" optional><Select value={l.windowDistance ?? ""} onChange={(e) => setL({ ...l, windowDistance: (e.target.value || null) as Location["windowDistance"] })}><option value="">לא ידוע</option><option value="on_sill">על אדן החלון</option><option value="near">עד מטר</option><option value="middle">1–2 מטר</option><option value="far">רחוק יותר</option></Select></Field>
          <Field label="שמש ישירה" optional><Select value={l.directSun ?? ""} onChange={(e) => setL({ ...l, directSun: (e.target.value || null) as Location["directSun"] })}><option value="">לא ידוע</option><option value="none">אין</option><option value="morning">בבוקר</option><option value="afternoon">אחר הצהריים</option><option value="most_day">רוב היום</option></Select></Field>
          <label className="flex items-center gap-2 px-1 text-[15px] text-ink"><input type="checkbox" className="size-5 accent-[var(--green)]" checked={!!l.ac} onChange={(e) => setL({ ...l, ac: e.target.checked })} />יש מזגן קרוב</label>
        </>
      ) : (
        <Field label="חשיפה" optional><div className="flex flex-wrap gap-2">{([["full_sun", "שמש מלאה"], ["partial", "שמש חלקית"], ["shade", "צל"]] as const).map(([k, t]) => <Chip key={k} selected={l.outdoorExposure === k} onClick={() => setL({ ...l, outdoorExposure: k })}>{t}</Chip>)}</div></Field>
      )}
      <Button className="w-full" disabled={!l.name?.trim()} onClick={() => onSave({ ...l, name: l.name!.trim() })}>שמירה</Button>
    </div>
  );
}

export default function Locations() {
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const locations = useLocations();
  const plants = usePlants() ?? [];
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (params.get("new") === "1") setAdding(true); }, [params]);
  return (
    <div>
      <PageHeader title="המיקומים שלי" subtitle="איפה הצמחים שלך גרים — ואיך האור שם"
        start={<IconButton icon="plus" label="מיקום חדש" filled onClick={() => setAdding(true)} />} />
      <div className="px-4">
        {locations === undefined ? <div className="skeleton mt-4 h-40 rounded-card" /> : !locations.length ? (
          <EmptyState title="עוד אין מיקומים" text="מיקום הוא רק שם — למשל 'סלון ליד החלון'. פרטים על אור אפשר להוסיף אחר כך." action={<Button icon="plus" onClick={() => setAdding(true)} className="w-full">הוספת מיקום</Button>} />
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-3">
            {locations.map((l) => {
              const here = plants.filter((p) => p.locationId === l.id && !p.archivedAt);
              return (
                <Card key={l.id} as="button" onClick={() => nav(`/locations/${l.id}`)} className="rise flex gap-3 p-2.5">
                  <img src={placeImage(l)} alt="" className="h-24 w-32 shrink-0 rounded-2xl object-cover" />
                  <div className="min-w-0 flex-1 py-1">
                    <div className="truncate text-[18px] font-bold text-ink">{l.name}</div>
                    <div className="mt-1"><LightBadge cat={l.lightCategory} /></div>
                    <div className="mt-2 flex items-center gap-1">
                      {here.slice(0, 4).map((p) => <PlantImage key={p.id} plant={p} species={speciesOf(p)} className="size-8 rounded-full ring-2 ring-surface" rounded="rounded-full" />)}
                      <span className="ms-1 text-[13px] text-muted">{here.length ? `${here.length} צמחים` : "אין צמחים עדיין"}</span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <Sheet open={adding} onClose={() => { setAdding(false); params.delete("new"); setParams(params, { replace: true }); }} title="מיקום חדש">
        <LocationForm onSave={async (l) => {
          const loc = await createLocation(l);
          setAdding(false); toast("המיקום נשמר");
          const ret = params.get("return");
          nav(ret ?? `/locations/${loc.id}`, { replace: !!ret });
        }} />
      </Sheet>
    </div>
  );
}

const QUESTIONS: { q: string; a: { t: string; v: number }[] }[] = [
  { q: "בצהריים, אפשר לקרוא כאן ספר בנוחות בלי מנורה?", a: [{ t: "בקושי", v: 0 }, { t: "כן", v: 1 }, { t: "בקלות, מואר מאוד", v: 2 }] },
  { q: "יד מעל משטח לבן בצהריים — איך הצל?", a: [{ t: "כמעט אין צל", v: 0 }, { t: "צל רך ומטושטש", v: 1 }, { t: "צל חד וברור", v: 3 }] },
  { q: "כמה זמן שמש ישירה מגיעה לנקודה?", a: [{ t: "אף פעם", v: 0 }, { t: "עד שעתיים", v: 1 }, { t: "2–5 שעות", v: 2 }, { t: "יותר מ־5 שעות", v: 3 }] },
];
function scoreToCat(s: number): LightCat { return s <= 1 ? "low" : s <= 3 ? "medium" : s <= 6 ? "bright_indirect" : "direct"; }

export function LightReadingSheet({ locationId, open, onClose }: { locationId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"q" | "lux">("q");
  const [ans, setAns] = useState<number[]>([]);
  const [lux, setLux] = useState("");
  const [tod, setTod] = useState<"morning" | "noon" | "afternoon">("noon");
  useEffect(() => { if (open) { setAns([]); setLux(""); } }, [open]);
  const save = async (category: LightCat, method: "questionnaire" | "manual_lux", luxVal?: number) => {
    await addLightReading(locationId, { method, category, lux: luxVal ?? null, timeOfDay: tod });
    toast("המדידה נשמרה"); onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="מדידת אור">
      <div className="mb-3 flex justify-center gap-2"><Chip selected={mode === "q"} onClick={() => setMode("q")}>שאלון קצר</Chip><Chip selected={mode === "lux"} onClick={() => setMode("lux")}>יש לי מד לוקס</Chip></div>
      <div className="mb-3 flex justify-center gap-2">{([["morning", "בוקר"], ["noon", "צהריים"], ["afternoon", "אחה״צ"]] as const).map(([k, t]) => <Chip key={k} selected={tod === k} onClick={() => setTod(k)}>{t}</Chip>)}</div>
      {mode === "q" ? (
        <div className="space-y-4">
          {QUESTIONS.map((qq, i) => (
            <div key={i}><div className="mb-2 text-[16px] font-semibold text-ink">{qq.q}</div><div className="flex flex-wrap gap-2">{qq.a.map((a) => <Chip key={a.t} selected={ans[i] === a.v} onClick={() => { const n = [...ans]; n[i] = a.v; setAns(n); }}>{a.t}</Chip>)}</div></div>
          ))}
          {ans.filter((x) => x !== undefined).length === QUESTIONS.length && (
            <div className="rounded-card bg-sage/70 p-4 text-center">
              <div className="text-[14px] text-muted">הערכה</div>
              <div className="mt-1 text-[20px] font-bold text-ink">{LIGHT_LABEL[scoreToCat(ans.reduce((a, b) => a + b, 0))]}</div>
              <Button className="mt-3 w-full" onClick={() => save(scoreToCat(ans.reduce((a, b) => a + b, 0)), "questionnaire")}>שמירת המדידה</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="ערך לוקס" hint="ממד אור חיצוני או מאפליקציית מדידה. Leafling לא ממציאה ערכי לוקס."><Input type="number" inputMode="numeric" value={lux} onChange={(e) => setLux(e.target.value)} /></Field>
          {lux && <p className="text-center text-[15px] text-ink">≈ {LIGHT_LABEL[luxToCategory(Number(lux))]}</p>}
          <Button className="w-full" disabled={!lux} onClick={() => save(luxToCategory(Number(lux)), "manual_lux", Number(lux))}>שמירה</Button>
        </div>
      )}
    </Sheet>
  );
}

const FIT_TEXT = { fit: ["מתאים", "bg-sage text-green"], tolerated: ["סביר — לא אידיאלי", "bg-sun-bg text-soil"], poor: ["פחות מתאים", "bg-heat-bg text-heat"] } as const;

export function LocationPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const l = useLocation(id);
  const lights = useLights(id) ?? [];
  const plants = (usePlants() ?? []).filter((p) => p.locationId === id && !p.archivedAt);
  const allPlants = usePlants() ?? [];
  const wishlist = useWishlist() ?? [];
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState("");
  const options = useMemo(() => [
    ...allPlants.filter((p) => p.speciesId).map((p) => ({ key: `p:${p.id}`, label: `${displayName(p)} (שלי)`, sp: speciesById(p.speciesId) })),
    ...wishlist.map((w) => ({ key: `w:${w.id}`, label: `${speciesById(w.speciesId)?.he ?? ""} (חלומות)`, sp: speciesById(w.speciesId) })),
    ...SPECIES.map((s) => ({ key: `s:${s.id}`, label: s.he, sp: s })),
  ], [allPlants, wishlist]);
  if (l === undefined) return <div className="p-6"><div className="skeleton h-60 rounded-card" /></div>;
  if (!l || l.deletedAt) return <EmptyState title="המיקום לא נמצא" action={<Button onClick={() => nav("/locations")} className="w-full">למיקומים</Button>} />;
  const chosen = options.find((o) => o.key === check);
  const fit = chosen ? lightFit(chosen.sp, l.lightCategory) : null;
  return (
    <div>
      <div className="relative h-60 overflow-hidden">
        <img src={placeImage(l)} alt="" className="size-full object-cover" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="safe-top absolute inset-x-0 top-0 flex justify-between px-4"><BackButton to="/locations" /><IconButton icon="edit" label="עריכת מיקום" onClick={() => setEditing(true)} /></div>
        <h1 className="absolute bottom-8 start-5 text-[30px] font-bold text-white drop-shadow">{l.name}</h1>
      </div>
      <div className="relative -mt-6 space-y-3 rounded-t-[28px] bg-bg px-4 pt-5">
        <Card className="p-4">
          <div className="flex items-center justify-between"><h2 className="text-[18px] font-bold text-ink">פרופיל אור</h2><LightBadge cat={l.lightCategory} /></div>
          <p className="mt-1 text-[14px] text-muted">{lights.length ? `מבוסס על ${lights.length} מדידות בזמנים שונים — לא מדידה אחת קבועה.` : "עוד אין מדידות. אפשר לענות על 3 שאלות קצרות או להזין ערך ממד לוקס."}</p>
          <div className="mt-3 space-y-1.5">{[...lights].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)).slice(0, 5).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl bg-bg-soft px-3 py-2 text-[14px]"><span className="text-ink">{LIGHT_LABEL[r.category]}{r.lux ? <span className="ltr ms-1 text-muted">({r.lux} lux)</span> : ""}</span><span className="text-muted">{new Date(r.measuredAt).toLocaleDateString("he-IL")} · {r.method === "manual_lux" ? "מד לוקס" : "שאלון"}</span></div>
          ))}</div>
          <Button variant="secondary" icon="sun" className="mt-3 w-full" onClick={() => setReading(true)}>מדידה חדשה</Button>
        </Card>
        <Card className="p-4">
          <h2 className="text-[18px] font-bold text-ink">האם צמח יתאים לכאן?</h2>
          <Select value={check} onChange={(e) => setCheck(e.target.value)} aria-label="בחירת צמח"><option value="">בחירת צמח…</option>{options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</Select>
          {chosen?.sp && (
            <div className="mt-3 rounded-2xl bg-bg-soft p-3 text-[15px]">
              {fit ? <span className={cx("rounded-full px-3 py-1 text-[13px] font-semibold", FIT_TEXT[fit][1])}>{FIT_TEXT[fit][0]}</span> : <span className="text-muted">צריך קודם מדידת אור כדי להשוות.</span>}
              <p className="mt-2 leading-relaxed text-text">{chosen.sp.he} מעדיף/ה: {chosen.sp.light.text}</p>
              <p className="mt-1 text-[13px] text-muted">זו המלצה בלבד — אפשר למקם בכל מקום, ונעקוב יחד.</p>
            </div>
          )}
        </Card>
        <SectionTitle>הצמחים כאן</SectionTitle>
        {!plants.length ? <p className="px-1 text-muted">אין כאן צמחים עדיין.</p> : (
          <div className="grid grid-cols-3 gap-2">{plants.map((p) => <button key={p.id} onClick={() => nav(`/plants/${p.id}`)} className="pressable text-center"><PlantImage plant={p} species={speciesOf(p)} className="aspect-square w-full" /><div className="mt-1 truncate text-[13px] text-ink">{displayName(p)}</div></button>)}</div>
        )}
        <InfoNote icon="info" className="mt-4">{l.kind === "indoor" ? `בפנים${l.windowDirection ? ` · חלון ${({ north: "צפוני", south: "דרומי", east: "מזרחי", west: "מערבי" } as const)[l.windowDirection]}` : ""}${l.ac ? " · ליד מזגן" : ""}` : "בחוץ"}</InfoNote>
        <div className="h-6" />
      </div>
      <LightReadingSheet locationId={l.id} open={reading} onClose={() => setReading(false)} />
      <Sheet open={editing} onClose={() => setEditing(false)} title="עריכת מיקום">
        <LocationForm initial={l} onSave={async (patch) => { await updateLocation(l.id, patch); setEditing(false); toast("נשמר"); }} />
        <Button variant="danger" icon="trash" className="mt-3 w-full" onClick={async () => {
          if (!confirm("למחוק את המיקום? הצמחים יישארו ויסומנו 'ללא מיקום'.")) return;
          for (const p of plants) await moveTo(p, null);
          await updateLocation(l.id, { deletedAt: new Date().toISOString() }); nav("/locations");
        }}>מחיקת המיקום</Button>
      </Sheet>
    </div>
  );
}
