import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { LIGHT_CATEGORY_LABEL, LIVE_SAMPLE, SHADOW_HINT, analyzeLiveFrames, type LiveVerdict } from "../../shared/light.ts";
import type { LightCat } from "../../shared/types.ts";
import { CAMERA_PROBLEM_TEXT, type CameraProblem, attachPreview, cameraProblem, detachPreview, openRearCamera, sampleFrames, stopStream } from "../data/camera.ts";
import { addLightReading, timeOfDayNow, useLocations, usePlants } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Button, Card, Field, InfoNote, Select, cx, useToast } from "../ui/ui.tsx";

// מד אור — a LIVE rear-camera preview inside Leafling (getUserMedia → inline <video>), no photo:
// aim at the plant's spot → "מדדי אור" → ~1.4 s of frames are reduced in memory to brightness statistics →
// an honest observation → "שייכי לצמח" → save. No frame is stored, uploaded or added to photos/journal/R2.
// Auto-exposed browser frames cannot show HOW MUCH light there is (see src/shared/light.ts), so the camera
// decides only "very dim" by itself; otherwise the user names what she sees, guided by the hand-shadow test.

const CATS: LightCat[] = ["low", "medium", "bright_indirect", "direct"];
const TONE: Record<LightCat, string> = { low: "bg-surface-2 text-ink", medium: "bg-sage text-green", bright_indirect: "bg-sun-bg text-soil", direct: "bg-sun text-on-green" };

type Cam = "starting" | "live" | "off" | CameraProblem | "interrupted";
type Phase = "aim" | "measuring" | "result";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function LightMeter() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt && !p.deletedAt);
  const locations = (useLocations() ?? []).filter((l) => !l.deletedAt);
  const fromPlant = params.get("plant");
  const fromLocation = params.get("location");

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const gen = useRef(0); // bumps on every start/stop so stale async work can tell it was superseded
  const liveSince = useRef(0);
  const [cam, setCam] = useState<Cam>("starting");
  const [phase, setPhase] = useState<Phase>("aim");
  const phaseRef = useRef<Phase>("aim");
  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const [verdict, setVerdict] = useState<LiveVerdict | null>(null);
  const [userCat, setUserCat] = useState<LightCat | null>(null);
  const [plantId, setPlantId] = useState(fromPlant ?? "");
  const [locationId, setLocationId] = useState(fromLocation ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const stopCamera = useCallback(() => {
    gen.current++;
    stopStream(stream.current);
    stream.current = null;
    detachPreview(video.current);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    const my = gen.current;
    setCam("starting");
    try {
      const s = await openRearCamera();
      if (my !== gen.current || !video.current) { stopStream(s); return; } // screen left / restarted meanwhile
      stream.current = s;
      for (const t of s.getVideoTracks()) {
        t.addEventListener("ended", () => { if (stream.current === s) { stopCamera(); setCam("interrupted"); if (phaseRef.current === "measuring") setPhaseBoth("aim"); } });
      }
      await attachPreview(video.current, s);
      if (my !== gen.current) return;
      liveSince.current = performance.now();
      setCam("live");
    } catch (e) {
      if (my === gen.current) setCam(cameraProblem(e));
    }
  }, [stopCamera]);

  // Camera on while the screen is open; always released on leave/unmount (no leaked track, no camera light).
  useEffect(() => {
    void startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // Leaving the app (home screen, app switcher, locked phone) releases the camera; coming back resumes it
  // unless a result is already on screen.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (stream.current || phaseRef.current === "measuring") { stopCamera(); setCam("off"); }
        if (phaseRef.current === "measuring") setPhaseBoth("aim");
      } else if (phaseRef.current !== "result" && !stream.current) void startCamera();
    };
    const onHide = () => stopCamera();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onHide); };
  }, [startCamera, stopCamera]);

  // A new entry point (different plant/location) starts a fresh measurement.
  const key = `${fromPlant ?? ""}|${fromLocation ?? ""}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setVerdict(null); setUserCat(null); setSaved(false); setPhaseBoth("aim");
    setPlantId(fromPlant ?? ""); setLocationId(fromLocation ?? "");
    if (!stream.current) void startCamera();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const measure = async () => {
    const v = video.current;
    if (!v || cam !== "live" || phaseRef.current !== "aim") return;
    const my = gen.current;
    setPhaseBoth("measuring");
    const settled = performance.now() - liveSince.current;
    if (settled < LIVE_SAMPLE.warmupMs) await wait(LIVE_SAMPLE.warmupMs - settled); // let auto-exposure settle
    const frames = my === gen.current ? await sampleFrames(v, () => my !== gen.current) : [];
    if (my !== gen.current) return; // the camera was stopped meanwhile (screen hidden / left)
    stopCamera(); // the preview is no longer needed
    setCam("off");
    setVerdict(analyzeLiveFrames(frames));
    setUserCat(null); setSaved(false);
    setPhaseBoth("result");
  };

  const again = () => {
    setVerdict(null); setUserCat(null); setSaved(false); setPhaseBoth("aim");
    void startCamera();
  };

  const plant = plants.find((p) => p.id === plantId);
  // The spot the user measured: the location she came from, else the chosen plant's own location, else a chosen one.
  const fixedLocation = fromLocation || plant?.locationId || null;
  const effectiveLocation = fixedLocation || (!plant ? locationId : "") || null;
  const locName = (id: string | null) => locations.find((l) => l.id === id)?.name;
  const category: LightCat | null = verdict?.kind === "dark" ? "low" : verdict?.kind === "undetermined" ? userCat : null;

  const save = async () => {
    if (!category || saved || busy) return;
    if (!plant && !effectiveLocation) { toast("צריך לבחור צמח או מיקום"); return; }
    setBusy(true);
    try {
      await addLightReading({
        plantId: plant?.id ?? null, locationId: effectiveLocation, category, estimate: true,
        method: verdict?.kind === "dark" ? "camera_live_dark" : "camera_live_user", timeOfDay: timeOfDayNow(),
      });
      setSaved(true);
      toast(plant ? `נשמר בהיסטוריה של ${displayName(plant)}` : "נשמר בפרופיל האור של המיקום");
      nav(plant ? `/plants/${plant.id}` : effectiveLocation ? `/locations/${effectiveLocation}` : "/tools", { replace: true });
    } catch { toast("השמירה נכשלה — אפשר לנסות שוב"); } finally { setBusy(false); }
  };

  const problem = cam !== "starting" && cam !== "live" && cam !== "off" ? CAMERA_PROBLEM_TEXT[cam] : null;

  return (
    <main className="safe-top min-h-dvh overflow-x-hidden px-4 pb-10">
      <BackButton to={fromPlant ? `/plants/${fromPlant}` : fromLocation ? `/locations/${fromLocation}` : "/tools"} />
      <h1 className="mt-3 text-center text-[28px] font-bold text-ink">מד אור</h1>
      <div className="rise mt-4 space-y-4">
        {phase !== "result" && (
          <div className="text-center">
            <p className="text-[18px] font-semibold text-ink">כווני את הטלפון למקום שבו הצמח נמצא</p>
            <p className="mt-1 text-[14px] text-muted">המדידה מתבצעת בזמן אמת — אין צורך לצלם תמונה.</p>
          </div>
        )}
        {/* Always mounted so the camera can restart from any state; hidden while a result or a problem shows. */}
        <div className={cx("relative mx-auto aspect-[3/4] max-h-[58dvh] w-full overflow-hidden rounded-[28px] bg-[#23301f] shadow-soft", (problem || phase === "result") && "hidden")}>
          <video ref={video} data-testid="light-preview" data-state={cam} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay aria-label="תצוגת מצלמה חיה" />
          <div className="pointer-events-none absolute inset-6 rounded-[22px] border-2 border-white/45" aria-hidden />
          {cam === "starting" && (
            <div className="absolute inset-0 grid place-items-center text-[15px] text-white/85">
              <span className="flex items-center gap-2"><span className="size-5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />מפעילה מצלמה…</span>
            </div>
          )}
          {phase === "measuring" && (
            <div data-testid="light-measuring" role="status" className="absolute inset-x-4 bottom-4 flex items-center justify-center gap-2 rounded-full bg-black/55 px-4 py-3 text-[16px] font-semibold text-white">
              <Icon name="sun" size={20} className="animate-pulse" />מודדת את האור…
            </div>
          )}
        </div>
        {phase !== "result" && (
          <>
            {problem ? (
              <div data-testid="light-camera-problem" role="alert" className="space-y-3">
                <InfoNote icon="camera" title={problem.title}>{problem.body}</InfoNote>
                {cam !== "unsupported" && cam !== "no_camera" && <Button variant="secondary" icon="refresh" className="w-full" onClick={() => void startCamera()}>לנסות שוב</Button>}
              </div>
            ) : (
              <Button data-testid="light-measure" icon="sun" className="w-full" loading={phase === "measuring"} disabled={cam !== "live"} onClick={() => void measure()}>מדדי אור</Button>
            )}
          </>
        )}

        {phase === "result" && verdict && (
          <div data-testid="light-result" data-verdict={verdict.kind} className="space-y-4">
            <Card className="p-5">
              {verdict.kind === "dark" && (
                <>
                  <div className="text-[13px] text-muted">הערכה</div>
                  <div className={cx("mt-1 inline-block rounded-full px-4 py-1.5 text-[22px] font-bold", TONE.low)}>{LIGHT_CATEGORY_LABEL.low}</div>
                  <p className="mt-3 text-[14px] leading-relaxed text-muted">גם אחרי שהמצלמה הגבירה את הרגישות שלה עד הסוף, התמונה נשארה כהה — כנראה שיש מעט אור במקום. זו הערכה גסה, לא מדידה של מד אור מכויל. אם העדשה הייתה מכוסה, אפשר למדוד שוב.</p>
                </>
              )}
              {verdict.kind === "undetermined" && (
                <>
                  <p className="text-[17px] font-semibold text-ink">המצלמה לא יכולה לדעת כמה אור יש כאן</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted">מצלמת הטלפון מתאימה את עצמה אוטומטית לכל תאורה, ולכן מהתמונה החיה לבד אי אפשר להבחין בין אור בינוני, חזק או שמש ישירה. מה את רואה במקום? טיפ: החזיקי יד כ-30 ס״מ מעל המקום והסתכלי על הצל.</p>
                  {verdict.brightAreas && <p data-testid="light-bright-areas" className="mt-2 rounded-2xl bg-sun-bg px-3 py-2 text-[14px] text-soil">במצלמה נראו אזורים בהירים מאוד — אולי שמש או חלון. אם השמש נוגעת במקום עצמו, בחרי ״שמש ישירה״.</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2" data-testid="light-user-choice" role="radiogroup" aria-label="מה האור במקום">
                    {CATS.map((c) => (
                      <button key={c} type="button" role="radio" aria-checked={userCat === c} onClick={() => setUserCat(c)}
                        className={cx("pressable min-h-16 rounded-2xl border px-3 py-2 text-start", userCat === c ? "border-green bg-sage" : "border-line bg-surface")}>
                        <span className="block text-[16px] font-semibold text-ink">{LIGHT_CATEGORY_LABEL[c]}</span>
                        <span className="block text-[13px] text-muted">{SHADOW_HINT[c]}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[13px] text-muted">הבחירה נשמרת כהערכה שלך — לא כמדידה.</p>
                </>
              )}
              {verdict.kind === "unstable" && <InfoNote icon="info" title="האור השתנה בזמן המדידה">ייתכן שהטלפון זז או שהתאורה מהבהבת. החזיקי את הטלפון יציב ומדדי שוב.</InfoNote>}
              {verdict.kind === "no_frames" && <InfoNote icon="info" title="לא התקבלה תמונה מהמצלמה">אפשר למדוד שוב.</InfoNote>}
              <Button variant="outline" size="md" icon="refresh" className="mt-4 w-full" onClick={again}>למדוד שוב</Button>
            </Card>

            {category && (
              <Card className="space-y-3 p-4">
                <Field label="שייכי לצמח">
                  <Select icon="pot" value={plantId} onChange={(e) => setPlantId(e.target.value)} data-testid="light-plant">
                    <option value="">{fromLocation ? "בלי צמח — רק למיקום" : "בחירת צמח…"}</option>
                    {plants.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
                  </Select>
                </Field>
                {fixedLocation ? (
                  <p className="text-[14px] text-muted">{plant ? `יתווסף להיסטוריה של ${displayName(plant)} וגם לפרופיל האור של "${locName(fixedLocation) ?? "המיקום"}".` : `יתווסף לפרופיל האור של "${locName(fixedLocation) ?? "המיקום"}".`}</p>
                ) : plant ? (
                  <p className="text-[14px] text-muted">לצמח אין מיקום — ההערכה תישמר בהיסטוריה שלו.</p>
                ) : locations.length > 0 ? (
                  <Field label="או למיקום" optional>
                    <Select icon="pin" value={locationId} onChange={(e) => setLocationId(e.target.value)} data-testid="light-location">
                      <option value="">ללא</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </Field>
                ) : null}
                <Button icon="check" className="w-full" loading={busy} disabled={saved || (!plant && !effectiveLocation)} onClick={save}>שמירה</Button>
              </Card>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
