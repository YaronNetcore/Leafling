import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { LIGHT_SOURCE_LABEL } from "../../shared/light.ts";
import { LIGHT_LABEL, lightFit } from "../../shared/species.ts";
import type { LightCat, Location, Plant } from "../../shared/types.ts";
import { useCatalog } from "../data/catalog.ts";
import { createLocation, moveTo, speciesOf, updateLocation, useLights, useLocation, useLocations, usePlants } from "../data/store.ts";
import { PersonalPlantPicker, plantLines } from "../ui/PersonalPlantPicker.tsx";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Button, Card, Chip, EmptyState, Field, IconButton, InfoNote, Input, PageHeader, PlantImage, SectionTitle, Select, Sheet, StatusBadge, cx, useToast } from "../ui/ui.tsx";

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

const FIT_TEXT = { fit: ["מתאים", "bg-sage text-green"], tolerated: ["סביר — לא אידיאלי", "bg-sun-bg text-soil"], poor: ["פחות מתאים", "bg-heat-bg text-heat"] } as const;

const RANK: LightCat[] = ["low", "medium", "bright_indirect", "direct"];

/** Light needs of ONE personal plant, from its species (curated page or catalog entry) — null when unknown. */
function usePlantLightNeeds(p: Plant | undefined): { text: string; fit: (cat: LightCat) => "fit" | "tolerated" | "poor" } | null {
  const catalog = useCatalog();
  if (!p) return null;
  const sp = speciesOf(p);
  if (sp) return { text: sp.light.text, fit: (cat) => lightFit(sp, cat) ?? "poor" };
  const e = p.speciesId ? catalog?.byId.get(p.speciesId) : undefined;
  if (e?.care.light?.length) {
    const ideal = e.care.light;
    return {
      text: ideal.map((c) => LIGHT_LABEL[c]).join(" · "),
      fit: (cat) => (ideal.includes(cat) ? "fit" : ideal.some((c) => Math.abs(RANK.indexOf(c) - RANK.indexOf(cat)) === 1) ? "tolerated" : "poor"),
    };
  }
  return null;
}

export function LocationPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const l = useLocation(id);
  const lights = useLights(id) ?? [];
  const allPlants = (usePlants() ?? []).filter((p) => !p.archivedAt && !p.deletedAt);
  const plants = allPlants.filter((p) => p.locationId === id);
  const locations = useLocations() ?? [];
  const [editing, setEditing] = useState(false);
  // "Will it fit?" and "add a plant here" pick from MY plants only (never the general catalog).
  const [checkId, setCheckId] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<"check" | "add" | null>(null);
  const [moving, setMoving] = useState<Plant | null>(null);
  const checked = allPlants.find((p) => p.id === checkId);
  const needs = usePlantLightNeeds(checked);
  if (l === undefined) return <div className="p-6"><div className="skeleton h-60 rounded-card" /></div>;
  if (!l || l.deletedAt) return <EmptyState title="המיקום לא נמצא" action={<Button onClick={() => nav("/locations")} className="w-full">למיקומים</Button>} />;
  const fit = checked && needs && l.lightCategory ? needs.fit(l.lightCategory) : null;
  const locName = (lid?: string | null) => locations.find((x) => x.id === lid)?.name;
  const doMove = async (p: Plant) => {
    // Moving = updating the existing plant record (its history records the move); never a new plant.
    await moveTo(p, l.id);
    setMoving(null);
    toast(`${displayName(p)} עבר/ה ל${l.name}`);
  };
  const onPickAdd = (p: Plant) => {
    setPickFor(null);
    if (p.locationId === l.id) { toast(`${displayName(p)} כבר כאן`); return; }
    if (p.locationId && locName(p.locationId)) setMoving(p); else void doMove(p);
  };
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
          <p className="mt-1 text-[14px] text-muted">{lights.length ? `מבוסס על ${lights.length} הערכות בזמנים שונים — לא מדידה אחת קבועה, ולא מד אור מכויל.` : "עוד אין מדידות. אפשר למדוד עם מצלמת הטלפון — מקבלים הערכה גסה של עוצמת האור."}</p>
          <div className="mt-3 space-y-1.5">{[...lights].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)).slice(0, 5).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl bg-bg-soft px-3 py-2 text-[14px]"><span className="text-ink">{LIGHT_LABEL[r.category]}</span><span className="text-muted">{new Date(r.measuredAt).toLocaleDateString("he-IL")} · {LIGHT_SOURCE_LABEL[r.method] ?? "הערכה"}</span></div>
          ))}</div>
          <Button variant="secondary" icon="sun" className="mt-3 w-full" onClick={() => nav(`/tools/light?location=${l.id}`)}>מדידת אור</Button>
        </Card>
        <SectionTitle>הצמחים כאן</SectionTitle>
        {!plants.length ? <p className="px-1 text-muted" data-testid="location-no-plants">אין כאן צמחים עדיין.</p> : (
          <div className="space-y-2" data-testid="location-plants">
            {plants.map((p) => {
              const ln = plantLines(p);
              return (
                <button key={p.id} data-plant-id={p.id} data-testid="location-plant" onClick={() => nav(`/plants/${p.id}`)} className="pressable flex w-full items-center gap-3 rounded-2xl bg-surface p-2.5 text-start shadow-soft">
                  <PlantImage plant={p} species={speciesOf(p)} className="size-14 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-bold text-ink">{ln.title}</div>
                    {(ln.species || ln.sci) && <div className="truncate text-[13px] text-muted">{ln.species}{ln.species && ln.sci ? " · " : ""}{ln.sci && <span className="sci">{ln.sci}</span>}</div>}
                  </div>
                  {p.status !== "plant" && <StatusBadge status={p.status} />}
                </button>
              );
            })}
          </div>
        )}
        <Button variant="secondary" icon="plus" className="w-full" data-testid="location-add-plant" onClick={() => setPickFor("add")}>הוספת צמח למיקום</Button>
        <Card className="p-4">
          <h2 className="text-[18px] font-bold text-ink">האם צמח שלי יתאים לכאן?</h2>
          <button type="button" data-testid="location-fit-pick" onClick={() => setPickFor("check")} className="pressable mt-2 flex min-h-12 w-full items-center gap-3 rounded-2xl bg-bg-soft px-3 py-2 text-start">
            {checked ? <PlantImage plant={checked} species={speciesOf(checked)} className="size-9 shrink-0" rounded="rounded-full" /> : <Icon name="pot" className="text-green" />}
            <span className="flex-1 text-[15px] text-ink">{checked ? displayName(checked) : "בחירה מהצמחים שלי…"}</span>
            <Icon name="down" size={18} className="text-muted" />
          </button>
          {checked && (
            <div className="mt-3 rounded-2xl bg-bg-soft p-3 text-[15px]" data-testid="location-fit">
              {!needs ? <span className="text-muted">אין מידע כללי על צרכי האור של הזן של הצמח הזה.</span>
                : fit ? <span className={cx("rounded-full px-3 py-1 text-[13px] font-semibold", FIT_TEXT[fit][1])}>{FIT_TEXT[fit][0]}</span> : <span className="text-muted">צריך קודם מדידת אור כדי להשוות.</span>}
              {needs && <p className="mt-2 leading-relaxed text-text">{displayName(checked)} ({checked.commonName}) מעדיף/ה: {needs.text}</p>}
              <p className="mt-1 text-[13px] text-muted">זו המלצה בלבד — אפשר למקם בכל מקום, ונעקוב יחד.</p>
            </div>
          )}
        </Card>
        <InfoNote icon="info" className="mt-4">{l.kind === "indoor" ? `בפנים${l.windowDirection ? ` · חלון ${({ north: "צפוני", south: "דרומי", east: "מזרחי", west: "מערבי" } as const)[l.windowDirection]}` : ""}${l.ac ? " · ליד מזגן" : ""}` : "בחוץ"}</InfoNote>
        <div className="h-6" />
      </div>
      <PersonalPlantPicker open={pickFor !== null} onClose={() => setPickFor(null)} currentLocationId={l.id} testid="location-plant-picker"
        title={pickFor === "add" ? `איזה צמח שלך להעביר ל${l.name}?` : "איזה צמח שלך לבדוק?"}
        onPick={(p) => { if (pickFor === "check") { setCheckId(p.id); setPickFor(null); } else onPickAdd(p); }} />
      <Sheet open={moving !== null} onClose={() => setMoving(null)} title="להעביר את הצמח?">
        {moving && (
          <div className="space-y-3" data-testid="location-move-confirm">
            <p className="text-center text-[15px] text-ink">{displayName(moving)} נמצא/ת כרגע ב"{locName(moving.locationId)}". להעביר ל"{l.name}"? זה אותו צמח — רק המיקום שלו משתנה, וההעברה נרשמת בהיסטוריה שלו.</p>
            <Button className="w-full" icon="move" onClick={() => void doMove(moving)}>להעביר ל{l.name}</Button>
            <Button variant="text" className="w-full" onClick={() => setMoving(null)}>ביטול</Button>
          </div>
        )}
      </Sheet>
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
