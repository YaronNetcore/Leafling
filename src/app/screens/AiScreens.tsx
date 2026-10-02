import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { SPECIES, type Species } from "../../shared/species.ts";
import { aiErrorText, askAi, picked, prepareImages, type AiResult } from "../data/ai.ts";
import { openHealthCase, setStatus, speciesOf, usePhotos, usePlant, usePlants } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Button, Chip, Field, InfoNote, PlantImage, Select, Sheet, Textarea, useToast } from "../ui/ui.tsx";
import { AiResultView } from "./AiResultView.tsx";

function useFilePicker(max = 4) {
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => { const u = files.map((f) => URL.createObjectURL(f)); setUrls(u); return () => u.forEach(URL.revokeObjectURL); }, [files]);
  const add = (list: FileList | File[] | null) => setFiles((cur) => [...cur, ...Array.from(list ?? [])].slice(0, max));
  const remove = (i: number) => setFiles((cur) => cur.filter((_, j) => j !== i));
  return { files, urls, add, remove, clear: () => setFiles([]) };
}

function PhotoPicker({ picker, hint }: { picker: ReturnType<typeof useFilePicker>; hint?: string }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {picker.urls.map((u, i) => (
          <div key={u} className="relative size-20">
            <img src={u} alt="" className="size-20 rounded-2xl object-cover" />
            <button aria-label="הסרת תמונה" onClick={() => picker.remove(i)} className="absolute -end-1 -top-1 grid size-7 place-items-center rounded-full bg-ink text-bg"><Icon name="x" size={14} /></button>
          </div>
        ))}
        {picker.files.length < 4 && (
          <>
            <button onClick={() => cam.current?.click()} className="pressable grid size-20 place-items-center rounded-2xl border-2 border-dashed border-sage-strong text-green" aria-label="צילום"><Icon name="camera" size={28} /></button>
            <button onClick={() => lib.current?.click()} className="pressable grid size-20 place-items-center rounded-2xl border-2 border-dashed border-sage-strong text-green" aria-label="גלריה"><Icon name="image" size={28} /></button>
          </>
        )}
      </div>
      {hint && <p className="mt-2 text-[13px] text-muted">{hint}</p>}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { picker.add(e.target.files); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" multiple hidden onChange={(e) => { picker.add(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

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

function matchSpecies(scientific: string, he: string): Species | undefined {
  const s = scientific.toLowerCase();
  return SPECIES.find((x) => (s && (x.scientific.toLowerCase().startsWith(s.split(" ")[0]) && s.includes(x.scientific.toLowerCase().split(" ")[0]))) || x.he === he || x.aliases.includes(he));
}

/** Identify / pest ID / "What is this?" — shows alternatives when unsure; never fakes certainty. */
export function Identify() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mode = (params.get("mode") as "identify" | "pest" | "what") ?? "identify";
  const picker = useFilePicker();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (params.get("picked") && picked.files.length) { picker.add(picked.files); picked.files = []; } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = { identify: ["זיהוי צמח", "צלמי את הצמח — עדיף צילום של הצמח כולו ועוד צילום קרוב של עלה."], pest: ["זיהוי מזיקים", "צילום קרוב וחד של המזיק או הסימן."], what: ["מה זה הדבר הזה?", "צמח, פטרייה, חרק או כתם — נעזור להבין מה רואים."] }[mode];
  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await askAi({ mode, images: await prepareImages(picker.files), question: note })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Frame title={titles[0]} subtitle={titles[1]}>
      <PhotoPicker picker={picker} hint="עד 4 תמונות. נשלח עותק מוקטן בלי מיקום GPS." />
      <Textarea rows={2} placeholder="הערה (אופציונלי)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button icon="sparkles" loading={busy} disabled={!picker.files.length} onClick={run} className="w-full">{busy ? "בודקים…" : "לזהות"}</Button>
      {err && <ErrorBox code={err} onRetry={run} />}
      {res && (
        <>
          <AiResultView r={res} candidatesTitle={mode === "identify" ? "מועמדים לזיהוי" : "אפשרויות"} />
          {mode === "identify" && res.candidates.map((c, i) => {
            const sp = matchSpecies(c.scientific, c.name_he);
            return (
              <div key={i} className="flex gap-2">
                {sp ? <>
                  <Button size="md" variant="secondary" className="flex-1" onClick={() => nav(`/find/species/${sp.id}`)}>{sp.he} — לעמוד הזן</Button>
                  <Button size="md" onClick={() => nav(`/plants/new?species=${sp.id}`)}>הוספה</Button>
                </> : <Button size="md" variant="secondary" className="w-full" onClick={() => nav(`/plants/new?name=${encodeURIComponent(c.name_he)}&sci=${encodeURIComponent(c.scientific)}`)}>הוספה בשם "{c.name_he}"</Button>}
              </div>
            );
          })}
        </>
      )}
      <div className="h-8" />
    </Frame>
  );
}

/** AI Botanist: general chat, or scoped to exactly one selected plant. */
export function Botanist() {
  const [params] = useSearchParams();
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt);
  const [plantId, setPlantId] = useState(params.get("plant") ?? "");
  const plant = plants.find((p) => p.id === plantId);
  const picker = useFilePicker();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<{ q: string; r?: AiResult; err?: string }[]>([]);
  const run = async () => {
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    const entry: { q: string; r?: AiResult; err?: string } = { q: question };
    try { entry.r = await askAi({ mode: "ask", plantId: plantId || undefined, question, images: await prepareImages(picker.files) }); setQ(""); picker.clear(); }
    catch (e) { entry.err = (e as Error).message; }
    setThread((t) => [entry, ...t]);
    setBusy(false);
  };
  return (
    <Frame title="AI Botanist" subtitle={plant ? `מכיר את ${displayName(plant)} ואת ההיסטוריה שלו` : "שאלה כללית, או בחרי צמח כדי לקבל תשובה מותאמת"}>
      <Field label="על איזה צמח?">
        <Select icon="pot" value={plantId} onChange={(e) => setPlantId(e.target.value)}>
          <option value="">שאלה כללית (בלי צמח אישי)</option>
          {plants.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
        </Select>
      </Field>
      {plant && <div className="flex items-center gap-3 rounded-2xl bg-sage/70 p-3"><PlantImage plant={plant} species={speciesOf(plant)} className="size-12" /><p className="text-[13px] text-muted">נשלח רק מידע מובנה על הצמח הזה (סטטוס, מיקום, היסטוריה אחרונה). צמחים אחרים לא נשלחים.</p></div>}
      <Textarea rows={3} placeholder="למשל: למה העלים התחתונים מצהיבים?" value={q} onChange={(e) => setQ(e.target.value)} />
      <PhotoPicker picker={picker} />
      <Button icon="sparkles" loading={busy} disabled={!q.trim()} onClick={run} className="w-full">שליחה</Button>
      {thread.map((t, i) => (
        <div key={i} className="space-y-2">
          <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-green px-4 py-3 text-[15px] text-on-green">{t.q}</div>
          {t.r ? <AiResultView r={t.r} /> : <ErrorBox code={t.err ?? "x"} onRetry={() => { setQ(t.q); }} />}
        </div>
      ))}
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
