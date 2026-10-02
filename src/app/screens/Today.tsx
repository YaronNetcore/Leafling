import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { daysBetween, displayName, todayTasks, type Task } from "../../shared/domain.ts";
import type { Plant } from "../../shared/types.ts";
import { db, getMeta, setMeta } from "../data/db.ts";
import { completeReminder, postpone, recordEvent, speciesOf, useEvents, useLights, useLocations, usePhotos, usePlants, useProfile, useReminders } from "../data/store.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Button, Card, EmptyState, IconButton, PlantImage, SectionTitle, Wordmark, cx, useToast } from "../ui/ui.tsx";
import { SoilCheckSheet } from "./PlantDetails.tsx";

const TASK_META: Record<Task["kind"], { label: string; icon: IconName; tone: string }> = {
  soil_check: { label: "הגיע הזמן לבדוק את האדמה", icon: "drop", tone: "bg-water-bg text-water" },
  fertilize: { label: "חלון דישון פתוח", icon: "flask", tone: "bg-sage text-green" },
  rooting_check: { label: "בדיקת השרשה", icon: "root", tone: "bg-water-bg text-water" },
  seedling_check: { label: "לבדוק את השתילים", icon: "seed", tone: "bg-sun-bg text-soil" },
  reminder: { label: "תזכורת", icon: "bell", tone: "bg-sage text-green" },
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "לילה טוב" : h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 21 ? "ערב טוב" : "לילה טוב";
}

function TaskCard({ t, plant, onSoil }: { t: Task; plant: Plant; onSoil: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const m = TASK_META[t.kind];
  const sp = speciesOf(plant);
  const primary = () => {
    if (t.kind === "soil_check") onSoil();
    else if (t.kind === "rooting_check") nav(`/plants/${plant.id}/rooting-check`);
    else if (t.kind === "seedling_check") nav(`/plants/${plant.id}/germination`);
  };
  return (
    <Card className="rise p-3">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(`/plants/${plant.id}`)} className="pressable shrink-0"><PlantImage plant={plant} species={sp} className="size-16" /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-bold text-ink">{displayName(plant)}</div>
          <div className="flex items-center gap-1.5 text-[14px] text-muted">
            <span className={cx("grid size-6 place-items-center rounded-full", m.tone)}><Icon name={m.icon} size={14} /></span>
            {t.kind === "reminder" ? t.text : m.label}
          </div>
          {t.overdueDays > 1 && t.kind === "soil_check" && <div className="mt-0.5 text-[12px] text-muted">הבדיקה חיכתה כמה ימים — זה בסדר, בודקים עכשיו.</div>}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {t.kind === "fertilize" ? (
          <>
            <Button size="sm" className="flex-1" onClick={async () => { await recordEvent(plant.id, "fertilizing", {}); toast("נרשם דישון 🌱"); }}>דישנתי</Button>
            <Button size="sm" variant="secondary" onClick={async () => { await postpone(plant.id, "fertilize", 3); toast("נזכיר בעוד כמה ימים"); }}>אחר כך</Button>
            <Button size="sm" variant="text" onClick={async () => { await recordEvent(plant.id, "fertilizer_skipped", {}); toast("דילגנו הפעם"); }}>דילוג</Button>
          </>
        ) : t.kind === "reminder" ? (
          <>
            <Button size="sm" className="flex-1" icon="check" onClick={async () => { const rec = await db.reminders.get(t.reminderId!); if (rec) await completeReminder(rec); toast("בוצע"); }}>בוצע</Button>
          </>
        ) : (
          <>
            <Button size="sm" className="flex-1" onClick={primary}>{t.kind === "soil_check" ? "בדקתי את האדמה" : "לעדכן"}</Button>
            <Button size="sm" variant="secondary" onClick={async () => { await postpone(plant.id, t.kind, 1); toast("נזכיר מחר"); }}>מחר</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function PhotoSuggestion({ plant, onDismiss }: { plant: Plant; onDismiss: () => void }) {
  const nav = useNavigate();
  return (
    <div className="rise flex items-center gap-3 rounded-card border-2 border-dashed border-sage-strong bg-bg-soft p-3">
      <PlantImage plant={plant} species={speciesOf(plant)} className="size-14 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-ink">בא לך לראות כמה {displayName(plant)} השתנה?</div>
        <div className="mt-2 flex gap-2">
          <button className="pressable rounded-full bg-sage px-3 py-1.5 text-[14px] font-semibold text-green" onClick={() => nav(`/plants/${plant.id}?photo=1`)}>📷 צלמי</button>
          <button className="pressable rounded-full px-3 py-1.5 text-[14px] text-muted" onClick={onDismiss}>לא עכשיו</button>
        </div>
      </div>
    </div>
  );
}

function LightSuggestion({ locId, name }: { locId: string; name: string }) {
  const nav = useNavigate();
  const lights = useLights(locId);
  if (lights === undefined || lights.length) return null;
  return (
    <button onClick={() => nav(`/locations/${locId}`)} className="pressable flex w-full items-center gap-3 rounded-card border-2 border-dashed border-sage-strong bg-bg-soft p-3 text-start">
      <span className="grid size-12 place-items-center rounded-full bg-sun-bg text-sun"><Icon name="sun" /></span>
      <div className="flex-1"><div className="text-[15px] font-semibold text-ink">חסרה מדידת אור ב{name}</div><div className="text-[13px] text-muted">לא חובה — עוזר להתאים את ההמלצות.</div></div>
    </button>
  );
}

export default function Today() {
  const nav = useNavigate();
  const plants = usePlants();
  const events = useEvents();
  const reminders = useReminders();
  const photos = usePhotos();
  const locations = useLocations();
  const profile = useProfile();
  const [soilFor, setSoilFor] = useState<Plant | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  useEffect(() => { void getMeta<Record<string, number>>("dismissedSuggestions").then((d) => setDismissed(d ?? {})); }, []);

  const now = Date.now();
  const active = (plants ?? []).filter((p) => !p.archivedAt);
  const tasks = useMemo(() => todayTasks(active, events ?? [], reminders ?? [], speciesOf, Date.now()), [active, events, reminders]);
  const byId = new Map(active.map((p) => [p.id, p]));
  const busy = new Set(tasks.map((t) => t.plantId));
  const calm = active.filter((p) => !busy.has(p.id));

  const suggestions = useMemo(() => {
    const out: Plant[] = [];
    for (const p of active) {
      const every = p.status === "seedling" || p.status === "rooting" ? 7 : p.status === "sick" ? 10 : 30;
      const last = (photos ?? []).filter((x) => x.plantId === p.id).map((x) => Date.parse(x.createdAt)).sort((a, b) => b - a)[0] ?? Date.parse(p.createdAt);
      if (daysBetween(last, now) >= every && (dismissed[p.id] ?? 0) < now) out.push(p);
    }
    return out.slice(0, 2);
  }, [active, photos, dismissed, now]);
  const dismiss = async (id: string) => { const d = { ...dismissed, [id]: now + 14 * 86_400_000 }; setDismissed(d); await setMeta("dismissedSuggestions", d); };
  const lightLoc = (locations ?? []).find((l) => active.some((p) => p.locationId === l.id));

  const loading = plants === undefined || events === undefined;
  return (
    <div className="relative">
      <header className="safe-top px-4">
        <div className="flex items-center justify-between">
          <IconButton icon="settings" label="הגדרות" onClick={() => nav("/settings")} />
          <Wordmark />
          <div className="w-11" />
        </div>
        <h1 className="mt-4 text-[28px] font-bold text-ink">{greeting()}</h1>
        <p className="text-[16px] text-muted">{new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}{profile?.city ? ` · ${profile.city}` : ""}</p>
      </header>
      <div className="px-4">
        {loading ? <div className="mt-6 space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-32 rounded-card" />)}</div>
          : !active.length ? (
            <EmptyState title="ברוכה הבאה ל-Leafling 🌱" text="ברגע שתוסיפי צמחים, כאן יופיע מה דורש תשומת לב היום — בלי לחץ ובלי אשמה."
              action={<Button icon="plus" onClick={() => nav("/plants/new")} className="w-full">הוספת הצמח הראשון שלי</Button>} />
          ) : (
            <>
              {tasks.length ? (
                <>
                  <SectionTitle>מה דורש תשומת לב <span className="ms-1 rounded-full bg-green px-2.5 py-0.5 text-[14px] text-on-green">{tasks.length}</span></SectionTitle>
                  <div className="space-y-3">{tasks.map((t) => byId.get(t.plantId) && <TaskCard key={t.key} t={t} plant={byId.get(t.plantId)!} onSoil={() => setSoilFor(byId.get(t.plantId)!)} />)}</div>
                </>
              ) : (
                <div className="rise mt-6 rounded-card bg-sage/70 p-6 text-center">
                  <div className="text-[22px] font-bold text-ink">הכול רגוע להיום 🌿</div>
                  <p className="mt-1 text-[16px] text-muted">אין צמחים שדורשים טיפול כרגע.</p>
                </div>
              )}
              {(suggestions.length > 0 || lightLoc) && (
                <>
                  <SectionTitle>הצעות <span className="text-[14px] font-normal text-muted">· לא חובה</span></SectionTitle>
                  <div className="space-y-2">
                    {suggestions.map((p) => <PhotoSuggestion key={p.id} plant={p} onDismiss={() => void dismiss(p.id)} />)}
                    {lightLoc && <LightSuggestion locId={lightLoc.id} name={lightLoc.name} />}
                  </div>
                </>
              )}
              {calm.length > 0 && (
                <Card className="mt-6 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[16px] font-semibold text-ink">🌿 לא דורשים טיפול היום — {calm.length} צמחים</div>
                    <button className="pressable text-[15px] font-medium text-green" onClick={() => nav("/plants")}>הצג הכל</button>
                  </div>
                  <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1">
                    {calm.slice(0, 12).map((p) => (
                      <button key={p.id} onClick={() => nav(`/plants/${p.id}`)} className="pressable w-16 shrink-0 text-center">
                        <PlantImage plant={p} species={speciesOf(p)} className="size-16" />
                        <div className="mt-1 truncate text-[12px] text-muted">{displayName(p)}</div>
                      </button>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
      </div>
      {soilFor && <SoilCheckSheet p={soilFor} open onClose={() => setSoilFor(null)} />}
    </div>
  );
}
