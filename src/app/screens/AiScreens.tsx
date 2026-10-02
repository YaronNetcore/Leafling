import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { matchCandidate } from "../../shared/catalog.ts";
import { useCatalog } from "../data/catalog.ts";
import { aiErrorText, askAi, carryIdentificationPhotos, picked, type AiResult } from "../data/ai.ts";
import { prepareForUpload as prepareImages } from "../data/images.ts";
import { PhotoPicker, usePhotoPicker as useFilePicker } from "../ui/PhotoPicker.tsx";
import { openHealthCase, setStatus, speciesOf, usePhotos, usePlant, usePlants } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Button, Chip, Field, InfoNote, PlantImage, Select, Sheet, Textarea, useToast } from "../ui/ui.tsx";
import { AiResultView } from "./AiResultView.tsx";

function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="safe-top min-h-dvh px-4">
      <div className="flex items-center justify-between"><BackButton /><div className="w-11" /></div>
      <h1 className="mt-3 text-center text-[28px] font-bold text-ink">{title}</h1>
      {subtitle && <p className="mx-auto mt-1 max-w-sm text-center text-[16px] text-muted">{subtitle}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </main>
  );
}

function ErrorBox({ code, onRetry }: { code: string; onRetry: () => void }) {
  return (
    <div className="rounded-card bg-sun-bg p-4 text-[15px] text-ink">
      <p>{aiErrorText(code)}</p>
      <Button size="sm" variant="secondary" icon="refresh" className="mt-3" onClick={onRetry}>לנסות שוב</Button>
    </div>
  );
}

/** Plant identification — shows alternatives when unsure; never fakes certainty. */
export function Identify() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mode = "identify" as const;
  const picker = useFilePicker();
  const catalog = useCatalog();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (params.get("picked") && picked.files.length) { picker.add(picked.files); picked.files = []; } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = ["זיהוי צמח", "צלמי את הצמח — עדיף צילום של הצמח כולו ועוד צילום קרוב של עלה."];
  const [stage, setStage] = useState<"prep" | "ask" | null>(null);
  const run = async () => {
    if (!picker.files.length) return;
    setBusy(true); setErr(null); setRes(null);
    try {
      setStage("prep");
      const images = await prepareImages(picker.files);
      setStage("ask");
      setRes(await askAi({ mode, images, question: note }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setStage(null); }
  };
  return (
    <Frame title={titles[0]} subtitle={titles[1]}>
      <PhotoPicker picker={picker} hint="נשלח עותק מוקטן בלי מיקום GPS; המקור לא משתנה." />
      <Textarea rows={2} placeholder="הערה (אופציונלי)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button icon="sparkles" loading={busy} disabled={!picker.files.length || picker.loading || busy} onClick={run} className="w-full">{stage === "prep" ? "מכינים את התמונות…" : stage === "ask" ? "מזהים…" : "לזהות"}</Button>
      {!picker.files.length && !busy && <p className="-mt-2 text-center text-[13px] text-muted">צריך לפחות תמונה אחת כדי לזהות.</p>}
      {err && <ErrorBox code={err} onRetry={run} />}
      {res && (
        <>
          <AiResultView r={res} candidatesTitle={mode === "identify" ? "מועמדים לזיהוי" : "אפשרויות"} />
          {mode === "identify" && res.candidates.map((c, i) => {
            const m = matchCandidate(c.scientific, c.name_he, catalog?.entries ?? []);
            const add = (url: string) => { carryIdentificationPhotos(picker.files); nav(url); };
            return (
              <div key={i} className="space-y-1.5 rounded-2xl bg-surface p-3 shadow-soft" data-testid="identify-candidate">
                <div className="text-[15px] font-semibold text-ink">{c.name_he} <span className="sci text-[14px] font-normal text-muted">{c.scientific}</span></div>
                {m ? (
                  <>
                    {m.level === "genus" && <p className="text-[13px] text-muted">במאגר יש עמוד כללי לסוג ({m.he}) — לא לזן המדויק.</p>}
                    <div className="flex gap-2">
                      <Button size="md" variant="secondary" className="flex-1" onClick={() => nav(`/find/species/${m.id}`)}>{m.he} — לעמוד הזן</Button>
                      <Button size="md" data-testid="identify-add" onClick={() => add(m.level === "genus" ? `/plants/new?name=${encodeURIComponent(c.name_he)}&sci=${encodeURIComponent(c.scientific)}&from=identify` : `/plants/new?species=${m.id}&from=identify`)}>הוספה</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] text-muted" data-testid="identify-not-in-catalog">זוהה ע״י AI — הזן עוד לא במאגר של Leafling, אבל אפשר להמשיך איתו. הזיהוי אינו מידע בוטני מאומת.</p>
                    <Button size="md" variant="secondary" className="w-full" data-testid="identify-add" onClick={() => add(`/plants/new?name=${encodeURIComponent(c.name_he)}&sci=${encodeURIComponent(c.scientific)}&from=identify`)}>הוספה בשם "{c.name_he}"</Button>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
      <div className="h-8" />
    </Frame>
  );
}

const SYMPTOMS = ["הצהבה", "חום/שחור", "קצוות יבשים", "נבילה", "חורים", "חרקים", "נשירה", "אין צמיחה", "בעיה בשורשים", "עובש", "אחר"];

/** Diagnose: contextual (plant preselected), guided photos, symptoms, result with confidence. Never auto-marks sick. */
export function Diagnose() {
  const { plantId: routeId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt);
  const [plantId, setPlantId] = useState(routeId ?? "");
  const plant = usePlant(plantId || undefined);
  const photos = usePhotos(plantId || undefined) ?? [];
  const picker = useFilePicker();
  const [sym, setSym] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [useLatest, setUseLatest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const latest = useMemo(() => [...photos].filter((p) => p.uploadState === "uploaded").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [photos]);
  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      setRes(await askAi({ mode: "diagnose", plantId: plantId || undefined, symptoms: sym, question: note, images: await prepareImages(picker.files), photoIds: useLatest && latest ? [latest.id] : [] }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Frame title="אבחון" subtitle="צילום של הצמח כולו + צילום קרוב. אפשר להוסיף גב עלה, אדמה, מזיק או שורשים.">
      {!routeId && (
        <Field label="איזה צמח?">
          <Select icon="pot" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
            <option value="">צמח שלא שלי / בלי שיוך</option>
            {plants.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </Select>
        </Field>
      )}
      {plant && <div className="flex items-center gap-3 rounded-2xl bg-sage/70 p-3"><PlantImage plant={plant} species={speciesOf(plant)} className="size-12" /><div className="text-[15px] font-semibold text-ink">{displayName(plant)}</div></div>}
      <PhotoPicker picker={picker} hint="1. הצמח כולו · 2. צילום קרוב של הבעיה · אופציונלי: גב העלה, אדמה, מזיק, שורשים" />
      {latest && <label className="flex items-center gap-2 text-[15px] text-ink"><input type="checkbox" checked={useLatest} onChange={(e) => setUseLatest(e.target.checked)} className="size-5 accent-[var(--green)]" />לצרף גם את התמונה האחרונה מהיומן</label>}
      <div><div className="mb-2 text-[15px] font-semibold text-ink">מה רואים?</div><div className="flex flex-wrap gap-2">{SYMPTOMS.map((s) => <Chip key={s} selected={sym.includes(s)} onClick={() => setSym((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s}</Chip>)}</div></div>
      <Textarea rows={2} placeholder="עוד פרטים (אופציונלי)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button icon="steth" loading={busy} disabled={!picker.files.length && !(useLatest && latest) && !sym.length} onClick={run} className="w-full">{busy ? "בודקים…" : "לאבחן"}</Button>
      {err && <ErrorBox code={err} onRetry={run} />}
      {res && (
        <>
          <AiResultView r={res} candidatesTitle="אבחנות אפשריות" />
          {plant && res.confidence !== "insufficient" && <Button variant="secondary" icon="steth" className="w-full" onClick={() => setConfirm(true)}>לפתוח מעקב בריאות</Button>}
        </>
      )}
      <InfoNote icon="info">פעולות מסוכנות או בלתי הפיכות (גיזום חזק, חיתוך שורשים, חומרי הדברה) מומלצות רק בביטחון גבוה.</InfoNote>
      <div className="h-8" />
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="לפתוח מעקב בריאות?">
        {res && plant && (
          <div className="space-y-3">
            <p className="text-center text-[15px] text-muted">יישמר מעקב עם האבחנה הסבירה ודרגת הביטחון. הסטטוס של הצמח לא ישתנה אוטומטית.</p>
            <Button className="w-full" onClick={async () => {
              const top = res.candidates[0];
              await openHealthCase(plant.id, { title: top?.name_he ?? "בעיה במעקב", source: "ai", likelyCause: res.answer.slice(0, 400), confidence: res.confidence });
              setConfirm(false); toast("נפתח מעקב בריאות");
              if (plant.status !== "sick" && confirmSick()) await setStatus(plant, "sick");
              nav(`/plants/${plant.id}`);
            }}>כן, לפתוח מעקב</Button>
            <Button variant="text" className="w-full" onClick={() => setConfirm(false)}>לא עכשיו</Button>
          </div>
        )}
      </Sheet>
    </Frame>
  );
}

const confirmSick = () => window.confirm('לסמן את הצמח כ"חולה"? אפשר לשנות בכל רגע.');
