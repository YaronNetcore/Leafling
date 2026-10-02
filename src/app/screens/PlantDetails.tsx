import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { daysBetween, displayName, fertilizePlan, relativeDays, soilCheckPlan, STATUS_LABEL } from "../../shared/domain.ts";
import type { HealthCase, Photo, Plant, PlantEvent, Status } from "../../shared/types.ts";
import { addPhoto, usePhotoUrl } from "../data/media.ts";
import {
  addReminder, archivePlant, deletePlant, moveTo, openHealthCase, postpone, recordEvent, recordSoilCheck, resolveHealthCase,
  setStatus, speciesOf, updatePlant, useEvents, useHealth, useLocation, useLocations, usePhotos, usePlant, useReminders,
} from "../data/store.ts";
import { mutate } from "../data/sync.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import {
  ActionRow, BackButton, Button, Card, Chip, ConfidenceBadge, EmptyState, Field, IconButton, InfoNote, Input, PlantImage,
  SectionTitle, Select, Sheet, StatusBadge, TabRow, Textarea, cx, useToast,
} from "../ui/ui.tsx";
import { CareSummary, ProblemsPanel, PropagationPanel, SafetyPanel } from "./SpeciesCare.tsx";

type Tab = "care" | "journal" | "history" | "health" | "about";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "care", label: "טיפול", icon: "leaf" }, { id: "journal", label: "יומן", icon: "book" },
  { id: "history", label: "היסטוריה", icon: "clock" }, { id: "health", label: "בריאות", icon: "steth" }, { id: "about", label: "על הזן", icon: "info" },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });

// ---------- Hero ----------
function Hero({ p, photos, onAddPhoto, onMenu, onOpenPhoto }: { p: Plant; photos: Photo[]; onAddPhoto: () => void; onMenu: () => void; onOpenPhoto: () => void }) {
  const sp = speciesOf(p);
  const loc = useLocation(p.locationId);
  return (
    <div className="relative h-[46vh] min-h-[320px] overflow-hidden">
      <button onClick={onOpenPhoto} className="absolute inset-0" aria-label="פתיחת התמונה">
        <PlantImage plant={p} species={sp} variant="display" rounded="rounded-none" className="size-full" />
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />
      <div className="safe-top absolute inset-x-0 top-0 flex justify-between px-4">
        <BackButton to="/plants" />
        <IconButton icon="edit" label="פעולות ועריכה" onClick={onMenu} />
      </div>
      <div className="absolute inset-x-0 bottom-9 flex items-end justify-between gap-3 px-5">
        <div className="min-w-0 text-white">
          <h1 className="text-[34px] font-bold leading-tight drop-shadow">{displayName(p)}</h1>
          {p.scientificName && <div className="sci text-[16px] opacity-95 drop-shadow">{p.scientificName}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={p.status} />
            <span className="rounded-full bg-surface/90 px-3 py-1 text-[13px] font-semibold text-ink">{loc?.name ?? "ללא מיקום"}</span>
          </div>
        </div>
        <button onClick={onAddPhoto} className="pressable flex shrink-0 items-center gap-2 rounded-full bg-surface/90 px-3 py-2 text-[13px] font-medium text-ink shadow-soft">
          <Icon name="camera" size={18} />הוספת תמונות{photos.length ? ` (${photos.length})` : ""}
        </button>
      </div>
    </div>
  );
}

// ---------- Soil check flow ----------
export function SoilCheckSheet({ p, open, onClose }: { p: Plant; open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"result" | "watered">("result");
  const toast = useToast();
  const nav = useNavigate();
  useEffect(() => { if (open) setStep("result"); }, [open]);
  const done = (msg: string) => { toast(msg); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title={step === "result" ? "איך האדמה?" : "השקית?"}>
      {step === "result" ? (
        <div className="space-y-2">
          <ActionRow icon="sun" tone="soil" title="יבשה" subtitle="השכבה העליונה יבשה למגע" onClick={() => setStep("watered")} />
          <ActionRow icon="drop" tone="water" title="קצת לחה" subtitle="לא צריך להשקות עכשיו" onClick={async () => { await recordSoilCheck(p.id, "slightly_moist", false); done("נרשם. נבדוק שוב בקרוב 🌿"); }} />
          <ActionRow icon="cloud" tone="water" title="לחה מאוד" subtitle="נבדוק שוב בעוד כמה ימים" onClick={async () => { await recordSoilCheck(p.id, "very_moist", false); done("נרשם 🌿"); }} />
          <ActionRow icon="steth" tone="heat" title="משהו לא בסדר" subtitle="לפתוח אבחון עם ההקשר של הצמח" onClick={() => { onClose(); nav(`/diagnose/${p.id}`); }} />
          <Button variant="text" className="w-full" onClick={async () => { await postpone(p.id, "soil_check", 1); done("נזכיר מחר"); }}>לא בדקתי — להזכיר מחר</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button icon="drop" className="w-full" onClick={async () => { await recordSoilCheck(p.id, "dry", true); done("נרשמה השקיה 💧"); }}>כן, השקיתי</Button>
          <Button variant="outline" className="w-full" onClick={async () => { await recordSoilCheck(p.id, "dry", false); done("נרשם — נבדוק שוב מחר"); }}>עדיין לא</Button>
          <p className="text-center text-[13px] text-muted">רק "כן, השקיתי" נרשם כהשקיה.</p>
        </div>
      )}
    </Sheet>
  );
}

// ---------- Care tab ----------
function CareTab({ p, events, onSoil, onNote, onMove, onReminder }: { p: Plant; events: PlantEvent[]; onSoil: () => void; onNote: () => void; onMove: () => void; onReminder: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const sp = speciesOf(p);
  const now = Date.now();
  const plan = soilCheckPlan(p, events, sp, now);
  const fert = fertilizePlan(p, events, sp, now);
  const dd = plan.dry;
  const nextIn = daysBetween(now, plan.nextCheckAt);
  const since = p.acquiredAt ? daysBetween(Date.parse(p.acquiredAt), now) : null;
  const showSoil = p.status === "plant" || p.status === "sick" || (p.status === "seedling" && (p.germinatedCount ?? 0) > 0);
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <h3 className="text-[20px] font-bold text-ink">תוכנית טיפול</h3>
        <div className="mt-3 space-y-2">
          {showSoil && (
            <div className="flex items-center gap-3 rounded-2xl bg-water-bg/70 p-3">
              <div className="grid size-12 place-items-center rounded-full bg-surface text-water"><Icon name="drop" size={24} /></div>
              <div className="flex-1">
                <div className="text-[16px] font-semibold text-ink">בדיקת אדמה {nextIn <= 0 ? "— הגיע הזמן לבדוק" : relativeDays(plan.nextCheckAt, now)}</div>
                <div className="text-[13px] text-muted">{plan.lastWateringAt ? `השקיה אחרונה: ${relativeDays(plan.lastWateringAt, now)}` : "עוד לא נרשמה השקיה"}</div>
              </div>
              <Button size="sm" variant={nextIn <= 0 ? "primary" : "secondary"} onClick={onSoil}>לבדוק</Button>
            </div>
          )}
          {p.status === "rooting" && (
            <div className="flex items-center gap-3 rounded-2xl bg-water-bg/70 p-3">
              <div className="grid size-12 place-items-center rounded-full bg-surface text-water"><Icon name="root" size={24} /></div>
              <div className="flex-1"><div className="text-[16px] font-semibold text-ink">השרשה · יום {Math.max(1, daysBetween(Date.parse(p.propagationStart ?? p.createdAt), now) + 1)}</div><div className="text-[13px] text-muted">שיטה: {p.propagationMethod ?? "לא צוינה"}</div></div>
              <Button size="sm" variant="secondary" onClick={() => nav(`/plants/${p.id}/rooting-check`)}>בדיקה</Button>
            </div>
          )}
          {p.status === "seedling" && !(p.germinatedCount ?? 0) && (
            <div className="flex items-center gap-3 rounded-2xl bg-sun-bg/70 p-3">
              <div className="grid size-12 place-items-center rounded-full bg-surface text-soil"><Icon name="seed" size={24} /></div>
              <div className="flex-1"><div className="text-[16px] font-semibold text-ink">מחכים לנביטה · יום {Math.max(1, daysBetween(Date.parse(p.sowDate ?? p.createdAt), now) + 1)}</div><div className="text-[13px] text-muted">{p.seedCount ? `${p.seedCount} זרעים` : "מספר זרעים לא ידוע"}</div></div>
              <Button size="sm" variant="secondary" onClick={() => nav(`/plants/${p.id}/germination`)}>עדכון</Button>
            </div>
          )}
          {fert.applicable && (
            <div className="flex items-center gap-3 rounded-2xl bg-sage/70 p-3">
              <div className="grid size-12 place-items-center rounded-full bg-surface text-green"><Icon name="flask" size={24} /></div>
              <div className="flex-1">
                <div className="text-[16px] font-semibold text-ink">{!fert.inSeason ? "דישון — לא בעונה כרגע" : fert.nextWindowAt && fert.nextWindowAt <= now ? "חלון דישון פתוח" : `חלון דישון ${relativeDays(fert.nextWindowAt!, now)}`}</div>
                <div className="text-[13px] text-muted">{fert.lastAt ? `דישון אחרון: ${relativeDays(fert.lastAt, now)}` : "עוד לא נרשם דישון"}</div>
              </div>
              {fert.inSeason && <Button size="sm" variant="secondary" onClick={async () => { await recordEvent(p.id, "fertilizing", {}); toast("נרשם דישון 🌱"); }}>דישנתי</Button>}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: "drop" as const, label: "בדיקת אדמה", on: onSoil },
          { icon: "edit" as const, label: "הוספת עדכון", on: onNote },
          { icon: "pin" as const, label: "העברת מיקום", on: onMove },
          { icon: "bell" as const, label: "תזכורת", on: onReminder },
          { icon: "sparkles" as const, label: "לשאול את הבוטנאי", on: () => nav(`/botanist?plant=${p.id}`) },
          { icon: "steth" as const, label: "אבחון", on: () => nav(`/diagnose/${p.id}`) },
        ].map((a) => (
          <button key={a.label} onClick={a.on} className="pressable flex flex-col items-center gap-1.5 rounded-2xl bg-surface p-3 text-center shadow-soft">
            <span className="grid size-11 place-items-center rounded-full bg-sage text-green"><Icon name={a.icon} /></span>
            <span className="text-[13px] font-medium leading-tight text-ink">{a.label}</span>
          </button>
        ))}
      </div>

      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-[18px] font-bold text-ink"><Icon name="chart" className="text-green" />מה למדנו על הצמח הזה</h3>
        {dd.cycles.length >= 3 ? (
          <div className="mt-2 space-y-1 text-[15px] leading-relaxed">
            <p className="text-ink">האדמה מתייבשת בדרך כלל תוך <b className="ltr">{dd.typicalMin}–{dd.typicalMax}</b> ימים אחרי השקיה.</p>
            <p className="text-muted">על סמך {dd.cycles.length} מחזורים שתיעדת. ההיסטוריה האישית מקבלת {Math.round(plan.personalWeight * 100)}% משקל בתזמון הבדיקה.</p>
            <ConfidenceBadge value={dd.confidence} />
          </div>
        ) : (
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            {dd.cycles.length === 0 ? "עוד אין מספיק נתונים. " : `תועדו ${dd.cycles.length} מחזורי התייבשות — עוד לא מספיק כדי לזהות דפוס. `}
            אחרי 3 מחזורים לפחות של "השקיתי" ← "יבשה" נתחיל ללמוד את הקצב של הצמח הזה. עד אז התזמון מבוסס על ידע כללי על הזן{sp ? "" : " וברירת מחדל"}.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-[18px] font-bold text-ink">פרטים</h3>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-[15px]">
          <div><dt className="text-muted">אצלי מאז</dt><dd className="font-semibold text-ink">{p.acquiredAt ? `${fmtDate(p.acquiredAt)}${since != null ? ` · ${since} ימים` : ""}` : "לא ידוע"}</dd></div>
          <div><dt className="text-muted">עציץ</dt><dd className="font-semibold text-ink">{p.potDiameterCm ? <span className="ltr">{p.potDiameterCm} ס״מ</span> : "לא צוין"}{p.potMaterial ? ` · ${p.potMaterial}` : ""}</dd></div>
          <div><dt className="text-muted">מצע</dt><dd className="font-semibold text-ink">{p.substrate || "לא צוין"}</dd></div>
          <div><dt className="text-muted">ניקוז</dt><dd className="font-semibold text-ink">{p.drainage == null ? "לא צוין" : p.drainage ? "יש" : "אין"}</dd></div>
        </dl>
      </Card>

      {sp ? <CareSummary sp={sp} /> : <InfoNote title="אין מידע כללי על הזן">הצמח לא משויך לזן מהמאגר, לכן ההמלצות יתבססו על ההיסטוריה שלו בלבד.</InfoNote>}
    </div>
  );
}

// ---------- Journal ----------
const MILESTONES: { id: string; label: string; emoji: string }[] = [
  { id: "first_sprout", label: "נבט ראשון", emoji: "🌱" }, { id: "new_leaf", label: "עלה חדש", emoji: "🍃" }, { id: "first_flower", label: "פרח ראשון", emoji: "🌸" },
  { id: "new_growth", label: "צמיחה חדשה", emoji: "🌿" }, { id: "first_root", label: "שורש ראשון", emoji: "🌱" }, { id: "repotted", label: "הועבר עציץ", emoji: "🪴" },
  { id: "recovered", label: "התאושש", emoji: "💚" }, { id: "other", label: "אחר", emoji: "✨" },
];

function PhotoThumb({ id, className, onClick }: { id: string; className?: string; onClick?: () => void }) {
  const url = usePhotoUrl(id, "thumb");
  return <button onClick={onClick} className={cx("pressable overflow-hidden rounded-2xl bg-sage", className)}>{url && <img src={url} alt="" className="size-full object-cover" loading="lazy" />}</button>;
}

function JournalTab({ p, events, photos, onAdd, onOpenPhoto, onCompare, onTimelapse }: { p: Plant; events: PlantEvent[]; photos: Photo[]; onAdd: () => void; onOpenPhoto: (id: string) => void; onCompare: () => void; onTimelapse: () => void }) {
  const items = events.filter((e) => e.inJournal).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const sprouting = p.status === "seedling" || p.status === "rooting";
  return (
    <div className="space-y-3">
      <Button icon="plus" onClick={onAdd} className="w-full">הוספת עדכון</Button>
      {photos.length >= 2 && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="md" icon="image" onClick={onCompare}>השוואה</Button>
          <Button variant="secondary" size="md" icon="clock" onClick={onTimelapse}>טיימלאפס</Button>
        </div>
      )}
      {!items.length && <EmptyState title="היומן עוד ריק" text="תמונות, הערות ואבני דרך יופיעו כאן — הסיפור האישי של הצמח." />}
      <ol className="relative space-y-3 border-s-2 border-sage ps-4">
        {items.map((e) => {
          const ms = e.type === "milestone" ? MILESTONES.find((m) => m.id === e.payload.kind) : null;
          const day = sprouting ? daysBetween(Date.parse(p.sowDate ?? p.propagationStart ?? p.createdAt), Date.parse(e.occurredAt)) + 1 : null;
          return (
            <li key={e.id} className="relative">
              <span className="absolute -start-[25px] top-4 size-3 rounded-full bg-green ring-4 ring-bg" />
              <Card className={cx("p-3", ms && "bg-sage/70")}>
                <div className="text-[13px] text-muted">{e.precision === "unknown" ? "תאריך לא ידוע" : fmtDate(e.occurredAt)}{day ? ` · יום ${day}` : ""}</div>
                {e.type === "photo_added" && typeof e.payload.photoId === "string" && <PhotoThumb id={e.payload.photoId} onClick={() => onOpenPhoto(e.payload.photoId as string)} className="mt-2 aspect-[4/3] w-full" />}
                {ms && <div className="mt-1 text-[18px] font-bold text-ink">{ms.emoji} {ms.label}</div>}
                {e.type === "sowing" && <div className="mt-1 text-[16px] font-semibold text-ink">🌱 זריעה{e.payload.seedCount ? ` · ${e.payload.seedCount} זרעים` : ""}</div>}
                {e.type === "propagation_started" && <div className="mt-1 text-[16px] font-semibold text-ink">✂️ התחלת השרשה</div>}
                {e.type === "germination_update" && <div className="mt-1 text-[16px] font-semibold text-ink">🌱 נבטו {String(e.payload.germinated ?? "")}</div>}
                {typeof e.payload.text === "string" && e.payload.text && <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-text">{e.payload.text}</p>}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- History ----------
const HIST: { id: string; label: string; types: string[] }[] = [
  { id: "all", label: "הכול", types: [] }, { id: "water", label: "השקיה", types: ["watering", "soil_check"] },
  { id: "fert", label: "דישון", types: ["fertilizing", "fertilizer_skipped"] }, { id: "pot", label: "עציץ", types: ["repot", "pot_changed", "substrate_changed"] },
  { id: "loc", label: "מיקום", types: ["location_changed"] }, { id: "health", label: "בריאות", types: ["diagnosis", "treatment_started", "treatment_ended"] },
  { id: "dev", label: "התפתחות", types: ["status_changed", "milestone", "sowing", "germination_update", "propagation_started", "root_check", "water_change", "measurement"] },
];
const EV_LABEL: Record<string, [string, IconName]> = {
  soil_check: ["בדיקת אדמה", "drop"], watering: ["השקיה", "drop"], fertilizing: ["דישון", "flask"], fertilizer_skipped: ["דילוג על דישון", "flask"],
  repot: ["העברת עציץ", "pot"], pot_changed: ["שינוי עציץ", "pot"], substrate_changed: ["שינוי מצע", "layers"], location_changed: ["שינוי מיקום", "pin"],
  status_changed: ["שינוי סטטוס", "leaf"], pruning: ["גיזום", "scissors"], milestone: ["אבן דרך", "sparkles"], photo_added: ["תמונה", "camera"],
  sowing: ["זריעה", "seed"], germination_update: ["עדכון נביטה", "seed"], propagation_started: ["התחלת השרשה", "root"], root_check: ["בדיקת שורשים", "root"],
  water_change: ["החלפת מים", "drop"], diagnosis: ["אבחון", "steth"], treatment_started: ["התחלת טיפול", "steth"], treatment_ended: ["סיום טיפול", "steth"],
  task_postponed: ["דחייה", "clock"], measurement: ["מדידה", "ruler"], plant_created: ["נוסף ל-Leafling", "plus"], reminder_done: ["תזכורת בוצעה", "bell"], note: ["הערה", "edit"],
};
const SOIL: Record<string, string> = { dry: "יבשה", slightly_moist: "קצת לחה", very_moist: "לחה מאוד" };
function describe(e: PlantEvent, locName: (id: unknown) => string): string {
  const pl = e.payload;
  if (e.type === "soil_check") return `${SOIL[String(pl.result)] ?? ""}${pl.result === "dry" ? (pl.watered ? " · הושקה" : " · לא הושקה") : ""}`;
  if (e.type === "location_changed") return `${locName(pl.from)} ← ${locName(pl.to)}`;
  if (e.type === "status_changed") return `${STATUS_LABEL[pl.from as Status] ?? "—"} ← ${STATUS_LABEL[pl.to as Status] ?? "—"}`;
  if (e.type === "pot_changed") return `${pl.from ?? "—"} ← ${pl.to ?? "—"} ס״מ`;
  if (e.type === "task_postponed") return `עד ${new Date(String(pl.until)).toLocaleDateString("he-IL")}`;
  if (e.type === "diagnosis") return String(pl.title ?? "");
  return "";
}

function HistoryTab({ events }: { events: PlantEvent[] }) {
  const [f, setF] = useState("all");
  const locations = useLocations();
  const locName = (id: unknown) => (id ? locations?.find((l) => l.id === id)?.name ?? "מיקום שנמחק" : "ללא מיקום");
  const types = HIST.find((h) => h.id === f)!.types;
  const items = events.filter((e) => e.inHistory && (!types.length || types.includes(e.type))).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return (
    <div>
      <TabRow tabs={HIST.map((h) => ({ id: h.id, label: h.label }))} value={f} onChange={setF} />
      <ul className="mt-3 space-y-2">
        {!items.length && <li className="p-6 text-center text-muted">אין אירועים בסינון הזה.</li>}
        {items.map((e) => {
          const [label, icon] = EV_LABEL[e.type] ?? [e.type, "info" as IconName];
          return (
            <li key={e.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-soft">
              <span className="grid size-10 place-items-center rounded-full bg-sage text-green"><Icon name={icon} size={20} /></span>
              <div className="flex-1"><div className="text-[15px] font-semibold text-ink">{label}</div><div className="text-[13px] text-muted">{describe(e, locName)}</div></div>
              <div className="text-[12px] text-muted">{e.precision === "unknown" ? "?" : new Date(e.occurredAt).toLocaleDateString("he-IL")}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Health ----------
function HealthTab({ p, cases }: { p: Plant; cases: HealthCase[] }) {
  const nav = useNavigate();
  const toast = useToast();
  const [pro, setPro] = useState(false);
  const [form, setForm] = useState({ title: "", who: "", notes: "" });
  const [askStatus, setAskStatus] = useState(false);
  const active = cases.filter((c) => c.state !== "resolved");
  const past = cases.filter((c) => c.state === "resolved");
  return (
    <div className="space-y-3">
      {!active.length ? (
        <div className="rounded-card bg-sage/70 p-5 text-center">
          <div className="text-[18px] font-bold text-ink">💚 אין כרגע בעיה פעילה במעקב</div>
        </div>
      ) : active.map((c) => (
        <Card key={c.id} className="p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="text-[18px] font-bold text-ink">{c.title}</h3><span className="text-[12px] text-muted">{c.source === "ai" ? "אבחון AI" : c.source === "professional" ? "איש/אשת מקצוע" : "שלי"}</span></div>
          {c.likelyCause && <p className="mt-1 text-[15px] text-text">{c.likelyCause}</p>}
          {c.confidence && <div className="mt-2"><ConfidenceBadge value={c.confidence} /></div>}
          {c.notes && <p className="mt-2 whitespace-pre-wrap text-[14px] text-muted">{c.notes}</p>}
          <Button size="md" variant="secondary" icon="check" className="mt-3 w-full" onClick={async () => { if (confirm("לסיים את המעקב אחרי הבעיה הזו?")) { await resolveHealthCase(c); if (p.status === "sick") setAskStatus(true); toast("המעקב הסתיים 💚"); } }}>הצמח התאושש — לסיים מעקב</Button>
        </Card>
      ))}
      <Button icon="camera" onClick={() => nav(`/diagnose/${p.id}`)} className="w-full">📷 אבחני את הצמח שלי</Button>
      <Button variant="outline" icon="steth" onClick={() => setPro(true)} className="w-full">🏥 קיבלתי אבחנה מאיש מקצוע</Button>
      {past.length > 0 && (
        <>
          <SectionTitle>טיפולים קודמים</SectionTitle>
          {past.map((c) => <div key={c.id} className="rounded-2xl bg-surface p-3 text-[15px] shadow-soft"><b className="text-ink">{c.title}</b><span className="text-muted"> · {c.resolvedAt ? fmtDate(c.resolvedAt) : ""}</span></div>)}
        </>
      )}
      <Sheet open={pro} onClose={() => setPro(false)} title="אבחנה מאיש/אשת מקצוע">
        <div className="space-y-3">
          <Field label="האבחנה"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="למשל: ריקבון שורשים" /></Field>
          <Field label="מי אבחן/ה" optional><Input value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} /></Field>
          <Field label="הוראות והערות" optional><Textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <Button className="w-full" disabled={!form.title.trim()} onClick={async () => { await openHealthCase(p.id, { title: form.title.trim(), source: "professional", notes: [form.who && `אבחנה: ${form.who}`, form.notes].filter(Boolean).join("\n") || null }); setPro(false); setForm({ title: "", who: "", notes: "" }); toast("נפתח מעקב בריאות"); }}>שמירה</Button>
        </div>
      </Sheet>
      <Sheet open={askStatus} onClose={() => setAskStatus(false)} title="לעדכן סטטוס?">
        <p className="mb-4 text-center text-muted">הצמח מסומן כ"חולה". להחזיר אותו לסטטוס "צמח"?</p>
        <div className="space-y-2"><Button className="w-full" onClick={async () => { await setStatus(p, "plant"); setAskStatus(false); }}>כן, לעדכן ל"צמח"</Button><Button variant="text" className="w-full" onClick={() => setAskStatus(false)}>לא עכשיו</Button></div>
      </Sheet>
    </div>
  );
}

// ---------- Photo viewer / compare / timelapse ----------
function FullPhoto({ id }: { id: string }) {
  const url = usePhotoUrl(id, "display");
  return url ? <img src={url} alt="" className="max-h-[70vh] w-full rounded-2xl object-contain" /> : <div className="skeleton h-80 rounded-2xl" />;
}

function PhotoSheet({ p, photoId, onClose }: { p: Plant; photoId: string | null; onClose: () => void }) {
  const toast = useToast();
  if (!photoId) return null;
  return (
    <Sheet open onClose={onClose}>
      <FullPhoto id={photoId} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="md" variant="secondary" icon="heart" onClick={async () => { await mutate<Plant>("plant", p.id, { mainPhotoId: photoId }); toast("נקבעה כתמונה ראשית"); onClose(); }}>תמונה ראשית</Button>
        <Button size="md" variant="danger" icon="trash" onClick={async () => { if (confirm("למחוק את התמונה? אפשר לשחזר במשך 30 יום.")) { await mutate<Photo>("photo", photoId, { deletedAt: new Date().toISOString() }); if (p.mainPhotoId === photoId) await mutate<Plant>("plant", p.id, { mainPhotoId: null }); onClose(); } }}>מחיקה</Button>
      </div>
      <p className="mt-2 text-center text-[13px] text-muted">התמונה המקורית נשמרת כפי שצולמה, בלי עריכה.</p>
    </Sheet>
  );
}

function CompareSheet({ photos, open, onClose }: { photos: Photo[]; open: boolean; onClose: () => void }) {
  const sorted = [...photos].sort((a, b) => (a.capturedAt ?? a.createdAt).localeCompare(b.capturedAt ?? b.createdAt));
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.max(0, sorted.length - 1));
  const [split, setSplit] = useState(50);
  const ua = usePhotoUrl(sorted[a]?.id, "display");
  const ub = usePhotoUrl(sorted[b]?.id, "display");
  return (
    <Sheet open={open} onClose={onClose} title="השוואה">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-sage">
        {ub && <img src={ub} alt="" className="absolute inset-0 size-full object-cover" />}
        {ua && <img src={ua} alt="" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 0 0 ${100 - split}%)` }} />}
        <div className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ insetInlineStart: `${split}%` }} />
      </div>
      <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="mt-3 w-full accent-[var(--green)]" aria-label="מחוון השוואה" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Select value={a} onChange={(e) => setA(Number(e.target.value))} aria-label="תמונה ראשונה">{sorted.map((ph, i) => <option key={ph.id} value={i}>{new Date(ph.capturedAt ?? ph.createdAt).toLocaleDateString("he-IL")}</option>)}</Select>
        <Select value={b} onChange={(e) => setB(Number(e.target.value))} aria-label="תמונה שנייה">{sorted.map((ph, i) => <option key={ph.id} value={i}>{new Date(ph.capturedAt ?? ph.createdAt).toLocaleDateString("he-IL")}</option>)}</Select>
      </div>
      <p className="mt-2 text-center text-[13px] text-muted">תמונות מקוריות, בלי חיתוך או יישור.</p>
    </Sheet>
  );
}

function TimelapseSheet({ photos, open, onClose }: { photos: Photo[]; open: boolean; onClose: () => void }) {
  const sorted = [...photos].sort((a, b) => (a.capturedAt ?? a.createdAt).localeCompare(b.capturedAt ?? b.createdAt));
  const [i, setI] = useState(0);
  const [speed, setSpeed] = useState(700);
  const [playing, setPlaying] = useState(true);
  const t = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    if (!open || !playing || sorted.length < 2) return;
    t.current = setInterval(() => setI((x) => (x + 1) % sorted.length), speed);
    return () => clearInterval(t.current);
  }, [open, playing, speed, sorted.length]);
  const cur = sorted[i];
  return (
    <Sheet open={open} onClose={onClose} title="טיימלאפס">
      {cur && <><FullPhoto id={cur.id} /><div className="mt-2 text-center text-[14px] text-muted">{new Date(cur.capturedAt ?? cur.createdAt).toLocaleDateString("he-IL")} · {i + 1}/{sorted.length}</div></>}
      <div className="mt-3 flex items-center gap-2">
        <Button size="md" variant="secondary" onClick={() => setPlaying((x) => !x)} className="flex-1">{playing ? "השהיה" : "ניגון"}</Button>
        <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="מהירות"><option value={1200}>איטי</option><option value={700}>רגיל</option><option value={350}>מהיר</option></Select>
      </div>
      <p className="mt-2 text-center text-[13px] text-muted">עותקים בגודל תצוגה של התמונות המקוריות — בלי חיתוך, יישור או שכבות.</p>
    </Sheet>
  );
}

// ---------- Screen ----------
export default function PlantDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const p = usePlant(id);
  const events = useEvents(id) ?? [];
  const photos = (usePhotos(id) ?? []);
  const cases = useHealth(id) ?? [];
  const reminders = useReminders(id) ?? [];
  const locations = useLocations() ?? [];
  const [tab, setTab] = useState<Tab>("care");
  const [sheet, setSheet] = useState<null | "soil" | "note" | "move" | "edit" | "reminder" | "compare" | "timelapse" | "status" | "photo-source">(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [aboutTab, setAboutTab] = useState<"propagation" | "safety" | "problems">("propagation");
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState({ text: "", milestone: "" });
  const [edit, setEdit] = useState<Partial<Plant>>({});
  const [rem, setRem] = useState({ kind: "rotate" as const as "rotate" | "support" | "inspect" | "custom", text: "לסובב את העציץ", every: 14 });

  useEffect(() => { if (params.get("photo") === "1") { setSheet("photo-source"); params.delete("photo"); setParams(params, { replace: true }); } }, [params, setParams]);
  const journalPhotos = useMemo(() => photos.filter((x) => x.inJournal), [photos]);

  if (p === undefined) return <div className="p-6"><div className="skeleton h-80 rounded-card" /></div>;
  if (!p || p.deletedAt) return <EmptyState title="הצמח לא נמצא" text="ייתכן שהוא נמחק." action={<Button onClick={() => nav("/plants")} className="w-full">לצמחים שלי</Button>} />;
  const sp = speciesOf(p);

  const onFiles = async (files: FileList | null) => {
    setSheet(null);
    for (const f of Array.from(files ?? [])) {
      try { await addPhoto(p.id, f); } catch { toast("לא הצלחנו לקרוא את התמונה"); }
    }
    if (files?.length) toast(files.length > 1 ? `${files.length} תמונות נוספו ליומן` : "התמונה נוספה ליומן");
  };

  return (
    <div>
      <Hero p={p} photos={photos} onAddPhoto={() => setSheet("photo-source")} onMenu={() => { setEdit(p); setSheet("edit"); }} onOpenPhoto={() => p.mainPhotoId && setPhotoId(p.mainPhotoId)} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={libRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <div className="relative -mt-6 rounded-t-[28px] bg-bg px-4 pt-4">
        {photos.length > 1 && (
          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {[...photos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((ph) => <PhotoThumb key={ph.id} id={ph.id} className="size-16 shrink-0" onClick={() => setPhotoId(ph.id)} />)}
          </div>
        )}
        <TabRow tabs={TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          {tab === "care" && <CareTab p={p} events={events} onSoil={() => setSheet("soil")} onNote={() => { setNote({ text: "", milestone: "" }); setSheet("note"); }} onMove={() => setSheet("move")} onReminder={() => setSheet("reminder")} />}
          {tab === "journal" && <JournalTab p={p} events={events} photos={journalPhotos} onAdd={() => { setNote({ text: "", milestone: "" }); setSheet("note"); }} onOpenPhoto={setPhotoId} onCompare={() => setSheet("compare")} onTimelapse={() => setSheet("timelapse")} />}
          {tab === "history" && <HistoryTab events={events} />}
          {tab === "health" && <HealthTab p={p} cases={cases} />}
          {tab === "about" && (sp ? (
            <div>
              <TabRow tabs={[{ id: "propagation" as const, label: "ריבוי", icon: "sprout" as const }, { id: "safety" as const, label: "בטיחות", icon: "paw" as const }, { id: "problems" as const, label: "בעיות נפוצות", icon: "steth" as const }]} value={aboutTab} onChange={setAboutTab} />
              <div className="mt-4">{aboutTab === "propagation" ? <PropagationPanel sp={sp} /> : aboutTab === "safety" ? <SafetyPanel sp={sp} /> : <ProblemsPanel sp={sp} plantId={p.id} />}</div>
              <Button variant="text" className="mt-2 w-full" onClick={() => nav(`/find/species/${sp.id}`)}>לעמוד הזן המלא</Button>
            </div>
          ) : <InfoNote title="אין מידע על הזן">אפשר לשייך את הצמח לזן דרך עריכה.</InfoNote>)}
        </div>
        {reminders.filter((r) => r.active).length > 0 && tab === "care" && (
          <>
            <SectionTitle>תזכורות</SectionTitle>
            {reminders.filter((r) => r.active).map((r) => <div key={r.id} className="mb-2 flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-soft"><Icon name="bell" className="text-green" /><span className="flex-1 text-[15px] text-ink">{r.text}</span><span className="text-[13px] text-muted">{relativeDays(Date.parse(r.nextAt), Date.now())}{r.everyDays ? ` · כל ${r.everyDays} ימים` : ""}</span></div>)}
          </>
        )}
        <div className="h-6" />
      </div>

      <SoilCheckSheet p={p} open={sheet === "soil"} onClose={() => setSheet(null)} />
      <Sheet open={sheet === "photo-source"} onClose={() => setSheet(null)} title="הוספת תמונה">
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" icon="camera" onClick={() => camRef.current?.click()}>מצלמה</Button>
          <Button variant="secondary" icon="image" onClick={() => libRef.current?.click()}>גלריה</Button>
        </div>
        <p className="mt-3 text-center text-[13px] text-muted">התמונה נשמרת כפי שהיא. תאריך הצילום נלקח מהתמונה כשהוא קיים.</p>
      </Sheet>
      <Sheet open={sheet === "note"} onClose={() => setSheet(null)} title="הוספת עדכון">
        <div className="space-y-3">
          <Textarea rows={4} placeholder="מה חדש אצל הצמח?" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
          <div className="text-[15px] font-semibold text-ink">אבן דרך <span className="font-normal text-muted">(אופציונלי)</span></div>
          <div className="flex flex-wrap gap-2">{MILESTONES.map((m) => <Chip key={m.id} selected={note.milestone === m.id} onClick={() => setNote({ ...note, milestone: note.milestone === m.id ? "" : m.id })}>{m.emoji} {m.label}</Chip>)}</div>
          <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="md" icon="camera" onClick={() => camRef.current?.click()}>צילום</Button><Button variant="secondary" size="md" icon="image" onClick={() => libRef.current?.click()}>גלריה</Button></div>
          <Button className="w-full" disabled={!note.text.trim() && !note.milestone} onClick={async () => {
            if (note.milestone) await recordEvent(p.id, "milestone", { kind: note.milestone, text: note.text.trim() || null }, { inJournal: true });
            else await recordEvent(p.id, "note", { text: note.text.trim() }, { inJournal: true });
            setSheet(null); toast(note.milestone ? `${MILESTONES.find((m) => m.id === note.milestone)?.emoji} נשמר ביומן` : "נשמר ביומן");
          }}>שמירה</Button>
        </div>
      </Sheet>
      <Sheet open={sheet === "move"} onClose={() => setSheet(null)} title="העברת מיקום">
        <div className="space-y-2">
          {locations.map((l) => <ActionRow key={l.id} icon="pin" title={l.name} subtitle={l.id === p.locationId ? "המיקום הנוכחי" : undefined} trailing={false} onClick={async () => { await moveTo(p, l.id); setSheet(null); toast(`הועבר ל${l.name}`); }} />)}
          <Button variant="secondary" icon="plus" className="w-full" onClick={() => nav(`/locations?new=1&return=/plants/${p.id}`)}>מיקום חדש</Button>
        </div>
      </Sheet>
      <Sheet open={sheet === "reminder"} onClose={() => setSheet(null)} title="תזכורת חדשה">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {([["rotate", "לסובב את העציץ"], ["support", "לבדוק תמיכה"], ["inspect", "לבדוק עלים ומזיקים"], ["custom", ""]] as const).map(([k, t]) => <Chip key={k} selected={rem.kind === k} onClick={() => setRem({ ...rem, kind: k, text: t })}>{k === "custom" ? "אחר" : t}</Chip>)}
          </div>
          <Input value={rem.text} onChange={(e) => setRem({ ...rem, text: e.target.value })} placeholder="מה להזכיר?" />
          <Field label="לחזור כל (ימים)" hint="0 = פעם אחת"><Input type="number" min={0} inputMode="numeric" value={rem.every} onChange={(e) => setRem({ ...rem, every: Number(e.target.value) })} /></Field>
          <Button className="w-full" disabled={!rem.text.trim()} onClick={async () => { await addReminder(p.id, { kind: rem.kind, text: rem.text.trim(), everyDays: rem.every || null, firstInDays: rem.every || 7 }); setSheet(null); toast("התזכורת נשמרה"); }}>שמירה</Button>
        </div>
      </Sheet>
      <Sheet open={sheet === "edit"} onClose={() => setSheet(null)} title="עריכת הצמח">
        <div className="space-y-3">
          <Field label="כינוי" optional hint="הכינוי מחליף את שם התצוגה בלבד."><Input value={edit.nickname ?? ""} onChange={(e) => setEdit({ ...edit, nickname: e.target.value })} /></Field>
          <Field label="סטטוס"><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Status })}>{(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
          <Field label="אצלי מאז" optional><Input type="date" value={edit.acquiredAt?.slice(0, 10) ?? ""} onChange={(e) => setEdit({ ...edit, acquiredAt: e.target.value || null })} /></Field>
          <Field label="קוטר עציץ (ס״מ)" optional><Input type="number" inputMode="decimal" value={edit.potDiameterCm ?? ""} onChange={(e) => setEdit({ ...edit, potDiameterCm: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="חומר העציץ" optional><Input value={edit.potMaterial ?? ""} onChange={(e) => setEdit({ ...edit, potMaterial: e.target.value || null })} placeholder="פלסטיק, חרס, קרמיקה…" /></Field>
          <Field label="מצע" optional><Input value={edit.substrate ?? ""} onChange={(e) => setEdit({ ...edit, substrate: e.target.value || null })} /></Field>
          <Button className="w-full" onClick={async () => {
            const patch: Partial<Plant> = {};
            for (const k of ["nickname", "status", "acquiredAt", "potDiameterCm", "potMaterial", "substrate"] as const) if (edit[k] !== p[k]) (patch as Record<string, unknown>)[k] = edit[k] ?? null;
            if (Object.keys(patch).length) await updatePlant(p, patch);
            setSheet(null); toast("נשמר");
          }}>שמירה</Button>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button size="md" variant="outline" icon="archive" onClick={async () => { await archivePlant(p); setSheet(null); toast(p.archivedAt ? "הוחזר מהארכיון" : "הועבר לארכיון"); }}>{p.archivedAt ? "החזרה" : "ארכיון"}</Button>
            <Button size="md" variant="danger" icon="trash" onClick={async () => { if (confirm("למחוק את הצמח? אפשר לשחזר במשך 30 יום.")) { await deletePlant(p); nav("/plants"); } }}>מחיקה</Button>
          </div>
        </div>
      </Sheet>
      <PhotoSheet p={p} photoId={photoId} onClose={() => setPhotoId(null)} />
      <CompareSheet photos={journalPhotos} open={sheet === "compare"} onClose={() => setSheet(null)} />
      <TimelapseSheet photos={journalPhotos} open={sheet === "timelapse"} onClose={() => setSheet(null)} />
    </div>
  );
}

