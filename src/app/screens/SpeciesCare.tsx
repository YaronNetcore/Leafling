import { normalizePets, petDisplayName, petSafety } from "../../shared/pets.ts";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LIGHT_LABEL, type Species, type Toxicity } from "../../shared/species.ts";
import type { PetKind } from "../../shared/types.ts";
import { useProfile } from "../data/store.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Button, IconBubble, TabRow, cx } from "../ui/ui.tsx";

export type SpeciesTab = "care" | "propagation" | "safety" | "problems";
export const SPECIES_TABS: { id: SpeciesTab; label: string; icon: IconName }[] = [
  { id: "care", label: "טיפול", icon: "leaf" }, { id: "propagation", label: "ריבוי", icon: "sprout" },
  { id: "safety", label: "בטיחות", icon: "paw" }, { id: "problems", label: "בעיות נפוצות", icon: "steth" },
];

export function GeneralInfoLabel() {
  return (
    <p className="flex items-center gap-1.5 px-1 text-[13px] text-muted">
      <Icon name="info" size={15} /> מידע כללי על הזן — נקודת פתיחה, לא אומת עבור הצמח שלך.
    </p>
  );
}

function CareRow({ icon, tone, title, text, more }: { icon: IconName; tone: "sun" | "water" | "soil" | "heat" | "sage"; title: string; text: string; more?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => more && setOpen((o) => !o)} aria-expanded={more ? open : undefined}
      className="pressable flex w-full items-start gap-3 rounded-2xl bg-surface p-3 text-start shadow-soft">
      <IconBubble icon={icon} tone={tone} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-[17px] font-semibold text-ink">{title}</div>
        <div className="text-[15px] leading-snug text-muted">{text}</div>
        {open && more && <div className="fade-in mt-2 text-[14px] leading-relaxed text-text">{more}</div>}
      </div>
      {more && <Icon name={open ? "down" : "forward"} size={20} className="mt-3 shrink-0 text-muted" />}
    </button>
  );
}

export function CareSummary({ sp }: { sp: Species }) {
  return (
    <div className="space-y-3">
      <div className="rounded-card bg-sage/60 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h3 className="text-[20px] font-bold text-ink">סיכום טיפול</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted">{sp.summary}</p>
          </div>
          <div className="grid size-20 shrink-0 place-items-center rounded-full bg-surface/70 text-green"><Icon name="leaf" size={40} strokeWidth={1.4} /></div>
        </div>
        <div className="mt-3 space-y-2">
          <CareRow icon="sun" tone="sun" title="תאורה" text={sp.light.text} more={`אידיאלי: ${sp.light.ideal.map((c) => LIGHT_LABEL[c]).join(", ")}${sp.light.tolerated.length ? ` · נסבל: ${sp.light.tolerated.map((c) => LIGHT_LABEL[c]).join(", ")}` : ""}. ${sp.light.signs}`} />
          <CareRow icon="drop" tone="water" title="השקיה" text={sp.water.text} more={`Leafling לא קובעת השקיה לפי ימים — בודקים את האדמה. עודף מים: ${sp.water.over} מחסור: ${sp.water.under}`} />
          <CareRow icon="pot" tone="soil" title="מצע" text={sp.substrate} />
          <CareRow icon="thermo" tone="heat" title="טמפרטורה" text={sp.temp.text} more={`לחות: ${sp.humidity}`} />
          <CareRow icon="leaf" tone="sage" title="דישון" text={sp.fertilize.text} more={`מתי לא: ${sp.fertilize.avoid} הוראות היצרן על אריזת הדשן הן הקובעות.`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-start gap-3 rounded-card bg-sage/60 p-4">
          <div className="flex-1"><div className="text-[17px] font-bold text-ink">קצב צמיחה</div><div className="mt-1 text-[14px] leading-snug text-muted">{sp.growth.rate}</div></div>
          <IconBubble icon="chart" />
        </div>
        <div className="flex items-start gap-3 rounded-card bg-sage/60 p-4">
          <div className="flex-1"><div className="text-[17px] font-bold text-ink">גודל</div><div className="mt-1 text-[14px] leading-snug text-muted">{sp.growth.size}</div></div>
          <IconBubble icon="sprout" />
        </div>
      </div>
      <GeneralInfoLabel />
    </div>
  );
}

const PET_LABEL: Record<PetKind, string> = { dog: "כלבים", cat: "חתולים", bird: "ציפורים", rabbit: "ארנבים", rodent: "מכרסמים", reptile: "זוחלים", other: "חיות אחרות" };
const TOX: Record<Toxicity, { label: string; cls: string; icon: IconName }> = {
  toxic: { label: "רעיל לפי המקור", cls: "bg-heat-bg text-heat", icon: "info" },
  non_toxic: { label: "לא רעיל לפי המקור", cls: "bg-sage text-green", icon: "check" },
  unknown: { label: "לא ידוע / לא נבדק", cls: "bg-surface-2 text-muted", icon: "help" },
};

export function SafetyPanel({ sp }: { sp: Species }) {
  const profile = useProfile();
  const pets = normalizePets(profile?.pets);
  const mine = new Set(pets.map((p) => p.kind));
  const personal = petSafety(sp.safety, pets);
  const rows: { kind: PetKind; tox: Toxicity }[] = (["cat", "dog", "bird", "rabbit", "rodent", "reptile"] as PetKind[]).map((k) => ({
    kind: k, tox: k === "cat" ? sp.safety.cats : k === "dog" ? sp.safety.dogs : "unknown",
  }));
  rows.sort((a, b) => Number(mine.has(b.kind)) - Number(mine.has(a.kind)));
  return (
    <div className="space-y-3">
      {personal.warning && (
        <div className="flex gap-3 rounded-card bg-heat-bg p-4 text-heat" data-testid="pet-warning"><Icon name="paw" /><div className="text-[15px] font-medium">{personal.warning}. הצמח מסומן כרעיל לפי המקור — כדאי למקם אותו מחוץ להישג יד.</div></div>
      )}
      {personal.unknownNote && <div className="rounded-card bg-surface-2 p-3 text-[14px] text-muted" data-testid="pet-unknown">{personal.unknownNote}</div>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.kind} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-soft">
            <div className="grid size-11 place-items-center rounded-full bg-sage text-green"><Icon name="paw" /></div>
            <div className="flex-1 text-[16px] font-semibold text-ink">{PET_LABEL[r.kind]}{mine.has(r.kind) && <span className="ms-2 rounded-full bg-sage px-2 py-0.5 text-[12px] font-medium text-green">בבית: {pets.filter((x) => x.kind === r.kind).map((x) => petDisplayName(x, pets)).join(", ")}</span>}</div>
            <span className={cx("inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold", TOX[r.tox].cls)}><Icon name={TOX[r.tox].icon} size={14} />{TOX[r.tox].label}</span>
          </div>
        ))}
      </div>
      <div className="rounded-card bg-sage/60 p-4 text-[15px] leading-relaxed text-muted">
        <p>{sp.safety.note}</p>
        <p className="mt-2 text-[13px]">מקור: {sp.safety.source ?? "אין מקור מאומת — לכן לא נקבע שהצמח בטוח."}</p>
        <p className="mt-1 text-[13px]">אם חיה אכלה מהצמח ומופיעים תסמינים — לפנות לווטרינר.</p>
      </div>
    </div>
  );
}

export function PropagationPanel({ sp }: { sp: Species }) {
  const nav = useNavigate();
  if (!sp.propagation.possible) return <p className="p-4 text-muted">לזן הזה אין שיטת ריבוי ביתית מומלצת.</p>;
  return (
    <div className="space-y-3">
      <div className="rounded-card bg-sage/60 p-4">
        <h3 className="text-[18px] font-bold text-ink">שיטות מתאימות</h3>
        <ul className="mt-2 flex flex-wrap gap-2">{sp.propagation.methods.map((m) => <li key={m} className="rounded-full bg-surface px-3 py-1.5 text-[14px] text-ink shadow-soft">{m}</li>)}</ul>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{sp.propagation.text}</p>
        {sp.propagation.rooting && <p className="mt-2 text-[15px] text-ink"><b>הערכת השרשה:</b> {sp.propagation.rooting}</p>}
        <p className="mt-2 text-[13px] text-muted">אין כלל אורך שורש אחיד — מוכנות תלויה בזן, בשיטה ובמערכת השורשים.</p>
      </div>
      <Button icon="scissors" onClick={() => nav(`/plants/new?species=${sp.id}&status=rooting`)} className="w-full">✂️ התחלתי ייחור</Button>
      <GeneralInfoLabel />
    </div>
  );
}

export function ProblemsPanel({ sp, plantId }: { sp: Species; plantId?: string }) {
  const nav = useNavigate();
  return (
    <div className="space-y-2">
      {sp.problems.map((pr) => (
        <div key={pr.title} className="rounded-2xl bg-surface p-4 shadow-soft">
          <div className="text-[17px] font-semibold text-ink">{pr.title}</div>
          <div className="mt-1 text-[14px] text-muted"><b>סימנים:</b> {pr.signs}</div>
          <div className="mt-1 text-[14px] text-text"><b>מה עושים:</b> {pr.fix}</div>
        </div>
      ))}
      <Button variant="secondary" icon="camera" onClick={() => nav(plantId ? `/diagnose/${plantId}` : "/diagnose")} className="mt-2 w-full">📷 אבחני את הצמח שלי</Button>
      <GeneralInfoLabel />
    </div>
  );
}

export function SpeciesTabs({ sp, plantId }: { sp: Species; plantId?: string }) {
  const [tab, setTab] = useState<SpeciesTab>("care");
  return (
    <div>
      <TabRow tabs={SPECIES_TABS} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === "care" && <CareSummary sp={sp} />}
        {tab === "propagation" && <PropagationPanel sp={sp} />}
        {tab === "safety" && <SafetyPanel sp={sp} />}
        {tab === "problems" && <ProblemsPanel sp={sp} plantId={plantId} />}
      </div>
    </div>
  );
}
