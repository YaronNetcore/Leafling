import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { displayName, relativeDays, soilCheckPlan } from "../../shared/domain.ts";
import { LIGHT_LABEL, SPECIES, speciesById } from "../../shared/species.ts";
import { recordEvent, speciesOf, updatePlant, useEvents, useLocations, usePlants } from "../data/store.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { BackButton, Button, Card, Chip, Field, InfoNote, Input, PageHeader, Select, cx, useToast } from "../ui/ui.tsx";
import LightMeter from "./LightMeter.tsx";
import { PropagationPanel } from "./SpeciesCare.tsx";

// Exactly the ten core tools (PRODUCT_SPEC §35).
const TOOLS: { id: string; label: string; sub: string; icon: IconName; to: string; tone: string }[] = [
  { id: "light", label: "מד אור", sub: "הערכת אור עם המצלמה", icon: "sun", to: "/tools/light", tone: "bg-sun-bg text-sun" },
  { id: "watering", label: "עוזר השקיה", sub: "מתי לבדוק אדמה", icon: "drop", to: "/tools/watering", tone: "bg-water-bg text-water" },
  { id: "fertilizer", label: "מחשבון דישון", sub: "כמות לפי התווית", icon: "flask", to: "/tools/fertilizer", tone: "bg-sage text-green" },
  { id: "pot", label: "גודל עציץ", sub: "לאיזה עציץ לעבור", icon: "pot", to: "/tools/pot", tone: "bg-soil-bg text-soil" },
  { id: "sowing", label: "עוזר זריעה", sub: "איך ומתי לזרוע", icon: "seed", to: "/tools/sowing", tone: "bg-sun-bg text-soil" },
  { id: "propagation", label: "עוזר השרשה", sub: "ייחורים צעד־צעד", icon: "scissors", to: "/tools/propagation", tone: "bg-water-bg text-water" },
  { id: "repot", label: "מדריך העברת עציץ", sub: "לפי הסיבה", icon: "move", to: "/tools/repot", tone: "bg-soil-bg text-soil" },
  { id: "pest", label: "זיהוי מזיקים", sub: "לפי תמונה", icon: "bug", to: "/identify?mode=pest", tone: "bg-heat-bg text-heat" },
  { id: "what", label: "מה זה הדבר הזה?", sub: "כשלא בטוחים מה רואים", icon: "help", to: "/identify?mode=what", tone: "bg-sage text-green" },
  { id: "soil", label: "בונה תערובת מצע", sub: "מהחומרים שיש לך", icon: "layers", to: "/tools/soil", tone: "bg-soil-bg text-soil" },
];

export default function Tools() {
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="כלים" subtitle="עזרה מעשית לגידול — בלי רשימות קניות מיותרות" />
      <div className="grid grid-cols-2 gap-3 px-4">
        {TOOLS.map((t) => (
          <Card key={t.id} as="button" onClick={() => nav(t.to)} className="rise flex flex-col items-start gap-3 p-4">
            <span className={cx("grid size-12 place-items-center rounded-2xl", t.tone)}><Icon name={t.icon} size={26} /></span>
            <div><div className="text-[17px] font-bold leading-tight text-ink">{t.label}</div><div className="mt-0.5 text-[13px] text-muted">{t.sub}</div></div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ToolFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="safe-top min-h-dvh px-4 pb-10">
      <BackButton to="/tools" />
      <h1 className="mt-3 text-center text-[28px] font-bold text-ink">{title}</h1>
      {subtitle && <p className="mx-auto mt-1 max-w-sm text-center text-[16px] text-muted">{subtitle}</p>}
      <div className="rise mt-5 space-y-4">{children}</div>
    </main>
  );
}

function WateringAssistant() {
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt && (p.status === "plant" || p.status === "sick"));
  const events = useEvents() ?? [];
  const locations = useLocations() ?? [];
  const nav = useNavigate();
  const [id, setId] = useState("");
  const p = plants.find((x) => x.id === id);
  const sp = p ? speciesOf(p) : undefined;
  const plan = p ? soilCheckPlan(p, events.filter((e) => e.plantId === p.id), sp, Date.now()) : null;
  const loc = locations.find((l) => l.id === p?.locationId);
  return (
    <ToolFrame title="עוזר השקיה" subtitle="לא 'להשקות כל X ימים' — מתי כדאי לבדוק את האדמה, ולמה.">
      <Select icon="pot" value={id} onChange={(e) => setId(e.target.value)}><option value="">בחירת צמח…</option>{plants.map((x) => <option key={x.id} value={x.id}>{displayName(x)}</option>)}</Select>
      {p && plan && (
        <Card className="space-y-2 p-4 text-[15px]">
          <div className="text-[18px] font-bold text-ink">בדיקת האדמה הבאה: {relativeDays(plan.nextCheckAt, Date.now())}</div>
          <ul className="list-disc space-y-1 ps-5 text-text">
            <li>ידע כללי על הזן: {sp ? `${sp.he} — ${sp.water.text}` : "אין זן משויך"}</li>
            <li>עציץ: {p.potDiameterCm ? `${p.potDiameterCm} ס״מ` : "לא צוין"} · מצע: {p.substrate ?? "לא צוין"}</li>
            <li>מיקום: {loc ? `${loc.name}${loc.lightCategory ? ` · ${LIGHT_LABEL[loc.lightCategory]}` : ""}` : "לא צוין"}</li>
            <li>עונה: {[11, 12, 1, 2, 3].includes(new Date().getMonth() + 1) ? "חורף — האדמה מתייבשת לאט יותר" : "עונה חמה"}</li>
            <li>היסטוריה אישית: {plan.dry.cycles.length >= 3 ? `${plan.dry.cycles.length} מחזורים, טווח טיפוסי ${plan.dry.typicalMin}–${plan.dry.typicalMax} ימים` : `${plan.dry.cycles.length} מחזורים — עוד לא מספיק לדפוס`}</li>
          </ul>
          <p className="text-[13px] text-muted">מזג אוויר יכול להקדים או לדחות בדיקה, אבל לא קובע לבד אם להשקות.</p>
          <Button className="w-full" onClick={() => nav(`/plants/${p.id}`)}>לבדיקת אדמה בכרטיס הצמח</Button>
        </Card>
      )}
    </ToolFrame>
  );
}

function FertilizerCalc() {
  const [water, setWater] = useState("1");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<"ml_per_l" | "g_per_l">("ml_per_l");
  const amount = Number(water) * Number(dose);
  return (
    <ToolFrame title="מחשבון דישון" subtitle="הוראות היצרן על התווית הן הקובעות.">
      <Field label="כמות מים (ליטר)"><Input type="number" inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} /></Field>
      <Field label="מינון לפי התווית" hint="למשל 2 מ״ל לליטר. אם התווית ממליצה על ריכוז מופחת לצמחי בית — השתמשי בו.">
        <div className="flex gap-2"><Input type="number" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} /><Chip selected={unit === "ml_per_l"} onClick={() => setUnit("ml_per_l")}>מ״ל/ל׳</Chip><Chip selected={unit === "g_per_l"} onClick={() => setUnit("g_per_l")}>גרם/ל׳</Chip></div>
      </Field>
      {dose && water && (
        <div className="rounded-card bg-sage/70 p-5 text-center">
          <div className="text-[14px] text-muted">כמות דשן</div>
          <div className="mt-1 text-[32px] font-bold text-ink"><span className="ltr">{Math.round(amount * 100) / 100}</span> {unit === "ml_per_l" ? "מ״ל" : "גרם"}</div>
          <div className="text-[14px] text-muted">ל־<span className="ltr">{water}</span> ליטר מים</div>
        </div>
      )}
      <InfoNote icon="info">לא מדשנים צמח יבש מאוד, חולה או מיד אחרי העברת עציץ. אין כלל דישון אוניברסלי.</InfoNote>
    </ToolFrame>
  );
}

function PotSize() {
  const [cur, setCur] = useState("");
  const [reason, setReason] = useState<"roots" | "growth" | "stability" | "refresh">("roots");
  const c = Number(cur);
  const next = reason === "refresh" ? c : c < 15 ? c + 2 : c < 30 ? c + 3 : c + 5;
  return (
    <ToolFrame title="גודל עציץ" subtitle="מעבר מתון עדיף על קפיצה גדולה.">
      <Field label="קוטר העציץ הנוכחי (ס״מ)"><Input type="number" inputMode="decimal" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="למה להחליף?"><div className="flex flex-wrap gap-2">{([["roots", "שורשים יוצאים / צפוף"], ["growth", "הצמח גדל מאוד"], ["stability", "העציץ לא יציב"], ["refresh", "רק לרענן מצע"]] as const).map(([k, t]) => <Chip key={k} selected={reason === k} onClick={() => setReason(k)}>{t}</Chip>)}</div></Field>
      {c > 0 && (
        <div className="rounded-card bg-sage/70 p-5 text-center">
          <div className="text-[14px] text-muted">{reason === "refresh" ? "אפשר להישאר באותו גודל" : "גודל מומלץ"}</div>
          <div className="mt-1 text-[32px] font-bold text-ink"><span className="ltr">{next}</span> ס״מ</div>
          <p className="mt-2 text-[14px] text-muted">עציץ גדול מדי מחזיק לחות זמן רב ומעלה סיכון לריקבון שורשים.</p>
        </div>
      )}
    </ToolFrame>
  );
}

function SpeciesPickerTool({ title, subtitle, filter, render }: { title: string; subtitle: string; filter: (s: (typeof SPECIES)[number]) => boolean; render: (id: string) => React.ReactNode }) {
  const [id, setId] = useState("");
  return (
    <ToolFrame title={title} subtitle={subtitle}>
      <Select icon="leaf" value={id} onChange={(e) => setId(e.target.value)}><option value="">בחירת זן…</option>{SPECIES.filter(filter).map((s) => <option key={s.id} value={s.id}>{s.he}</option>)}</Select>
      {id && render(id)}
    </ToolFrame>
  );
}

function Sowing() {
  const nav = useNavigate();
  return (
    <SpeciesPickerTool title="עוזר זריעה" subtitle="עומק, חום, אור ונביטה — לפי הזן." filter={(s) => s.propagation.methods.some((m) => m.includes("זריעה"))}
      render={(id) => { const sp = speciesById(id)!; return (
        <div className="space-y-3">
          <Card className="p-4 text-[15px] leading-relaxed"><p className="text-ink">{sp.propagation.text}</p>{sp.propagation.rooting && <p className="mt-2 text-muted">{sp.propagation.rooting}</p>}<p className="mt-2 text-muted">טמפרטורה: {sp.temp.text} · אור אחרי נביטה: {sp.light.text}</p><p className="mt-2 text-[13px] text-muted">אין כלל אחיד של חושך או כיסוי לכל הזרעים — זה תלוי בזן.</p></Card>
          <Button icon="seed" className="w-full" onClick={() => nav(`/plants/new?species=${id}&status=seedling`)}>התחלתי לזרוע</Button>
        </div>
      ); }} />
  );
}

function Propagation() {
  return <SpeciesPickerTool title="עוזר השרשה" subtitle="רק שיטות שמתאימות לזן." filter={(s) => s.propagation.possible} render={(id) => <PropagationPanel sp={speciesById(id)!} />} />;
}

function Repot() {
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt && p.status !== "rooting");
  const toast = useToast();
  const nav = useNavigate();
  const [id, setId] = useState("");
  const [reason, setReason] = useState("roots");
  const [size, setSize] = useState("");
  const [substrate, setSubstrate] = useState("");
  const p = plants.find((x) => x.id === id);
  const steps: Record<string, string[]> = {
    roots: ["להשקות יום לפני כדי שהגוש ייצא בקלות.", "להוציא בעדינות ולשחרר שורשים שמסתובבים.", "לעבור לעציץ גדול ב־2–5 ס״מ בלבד.", "למלא מצע טרי בלי לדחוס חזק.", "להשקות ולתת כמה ימים במקום מוכר, בלי דישון."],
    rot: ["להוציא ולבחון את השורשים: לבנים ומוצקים הם בריאים.", "להסיר רק חלקים רכים וכהים, עם כלי נקי.", "מצע חדש ומנוקז, עציץ לא גדול מדי.", "להשקות בזהירות ולעקוב — ולהשתמש באבחון אם צריך."],
    refresh: ["להוציא את הצמח ולנער מצע ישן בעדינות.", "לבדוק שורשים.", "להחזיר לאותו עציץ (נקי) עם מצע טרי."],
  };
  return (
    <ToolFrame title="מדריך העברת עציץ" subtitle="שלבים לפי הסיבה, ותיעוד אוטומטי בסיום.">
      <Select icon="pot" value={id} onChange={(e) => setId(e.target.value)}><option value="">בחירת צמח (אופציונלי)…</option>{plants.map((x) => <option key={x.id} value={x.id}>{displayName(x)}</option>)}</Select>
      <div className="flex flex-wrap gap-2">{([["roots", "צפוף / שורשים יוצאים"], ["rot", "חשד לריקבון"], ["refresh", "ריענון מצע"]] as const).map(([k, t]) => <Chip key={k} selected={reason === k} onClick={() => setReason(k)}>{t}</Chip>)}</div>
      <ol className="space-y-2">{steps[reason].map((s, i) => <li key={i} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-soft"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-sage text-[15px] font-bold text-green">{i + 1}</span><span className="text-[15px] leading-relaxed text-ink">{s}</span></li>)}</ol>
      {p && (
        <Card className="space-y-3 p-4">
          <h2 className="text-[17px] font-bold text-ink">סיימתי</h2>
          <Field label="קוטר עציץ חדש (ס״מ)" optional><Input type="number" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder={p.potDiameterCm ? String(p.potDiameterCm) : ""} /></Field>
          <Field label="מצע" optional><Input value={substrate} onChange={(e) => setSubstrate(e.target.value)} placeholder={p.substrate ?? ""} /></Field>
          <Button className="w-full" onClick={async () => {
            await recordEvent(p.id, "repot", { reason });
            const patch: Record<string, unknown> = {};
            if (size) patch.potDiameterCm = Number(size);
            if (substrate) patch.substrate = substrate;
            if (Object.keys(patch).length) await updatePlant(p, patch);
            toast("נרשמה העברת עציץ 🪴"); nav(`/plants/${p.id}`);
          }}>תיעוד העברה</Button>
        </Card>
      )}
    </ToolFrame>
  );
}

const MATERIALS = [
  { id: "potting", label: "מצע עציצים כללי", drain: 1, air: 1, hold: 3 }, { id: "perlite", label: "פרלייט", drain: 3, air: 3, hold: 0 },
  { id: "bark", label: "קליפות אורן", drain: 2, air: 3, hold: 1 }, { id: "coco", label: "סיבי קוקוס", drain: 1, air: 2, hold: 3 },
  { id: "pumice", label: "פומיס / טוף", drain: 3, air: 2, hold: 1 }, { id: "sand", label: "חול גס", drain: 3, air: 1, hold: 0 },
  { id: "compost", label: "קומפוסט", drain: 0, air: 1, hold: 3 }, { id: "leca", label: "לקה", drain: 3, air: 3, hold: 0 },
];
const NEEDS = { drain: "ניקוז מהיר (סוקולנטים)", air: "אוורור (אראונים, מונסטרה)", hold: "שימור לחות (עשבים, ירקות)" } as const;

function SoilMix() {
  const [need, setNeed] = useState<keyof typeof NEEDS>("air");
  const [have, setHave] = useState<string[]>(["potting", "perlite"]);
  const mix = useMemo(() => {
    const avail = MATERIALS.filter((m) => have.includes(m.id));
    if (!avail.length) return [];
    const base = avail.find((m) => m.hold >= 3);
    const scored = avail.map((m) => ({ m, s: m[need] + (m === base ? 1.5 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
    const total = scored.reduce((a, b) => a + b.s, 0);
    return scored.map((x) => ({ label: x.m.label, parts: Math.max(1, Math.round((x.s / total) * 6)) }));
  }, [need, have]);
  return (
    <ToolFrame title="בונה תערובת מצע" subtitle="רק מהחומרים שכבר יש לך — בלי רשימת קניות.">
      <Field label="מה הצמח צריך?"><div className="flex flex-wrap gap-2">{(Object.keys(NEEDS) as (keyof typeof NEEDS)[]).map((k) => <Chip key={k} selected={need === k} onClick={() => setNeed(k)}>{NEEDS[k]}</Chip>)}</div></Field>
      <Field label="מה יש לך?"><div className="flex flex-wrap gap-2">{MATERIALS.map((m) => <Chip key={m.id} selected={have.includes(m.id)} onClick={() => setHave((h) => (h.includes(m.id) ? h.filter((x) => x !== m.id) : [...h, m.id]))}>{m.label}</Chip>)}</div></Field>
      {mix.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[17px] font-bold text-ink">תערובת מוצעת</h2>
          <ul className="mt-2 space-y-1.5">{mix.map((x) => <li key={x.label} className="flex justify-between rounded-xl bg-bg-soft px-3 py-2 text-[15px]"><span className="text-ink">{x.label}</span><span className="font-semibold text-green">{x.parts} חלקים</span></li>)}</ul>
          <p className="mt-2 text-[13px] text-muted">הערכה כללית. לצמחים מסוימים כדאי לבדוק גם בעמוד הזן.</p>
        </Card>
      )}
    </ToolFrame>
  );
}

export function ToolPage() {
  const { tool } = useParams();
  switch (tool) {
    case "light": return <LightMeter />;
    case "watering": return <WateringAssistant />;
    case "fertilizer": return <FertilizerCalc />;
    case "pot": return <PotSize />;
    case "sowing": return <Sowing />;
    case "propagation": return <Propagation />;
    case "repot": return <Repot />;
    case "soil": return <SoilMix />;
    default: return <Tools />;
  }
}

