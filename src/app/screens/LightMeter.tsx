import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { AUTO_LABEL, CONFIDENCE_LABEL, LightSmoother, savedCategory, type LiveState } from "../../shared/light.ts";
import type { Plant } from "../../shared/types.ts";
import { CAMERA_PROBLEM_TEXT, type CameraProblem, type CameraReport, attachPreview, cameraProblem, cameraReport, createSampler, detachPreview, openRearCamera, stopStream } from "../data/camera.ts";
import { addLightReading, timeOfDayNow, useLocations, usePlants } from "../data/store.ts";
import { PersonalPlantPicker } from "../ui/PersonalPlantPicker.tsx";
import { BackButton, Button, InfoNote, cx, useToast } from "../ui/ui.tsx";

// מד אור — LIVE and AUTOMATIC. The rear camera runs inside Leafling; about 8 times a second only the target circle
// (plus a tiny whole-frame view) is reduced in memory to a few numbers; a smoother turns them into a continuously
// updating position on the "חשוך … שמש" scale and an automatic light category. No photo, no measure button, no
// manual category. The signal is RELATIVE (shadow contrast/sharpness in the circle, or the camera's dark limit) —
// iPhone browsers expose no exposure data, so there is no lux (see shared/light.ts). Nothing is stored except the
// reading the user saves to one of HER OWN plants.

const SAMPLE_MS = 125;
const CIRCLE = 0.42; // circle diameter as a share of the preview's shorter side (the same circle is analysed)

type Cam = "starting" | "live" | "off" | CameraProblem | "interrupted";

export default function LightMeter() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const fromPlant = params.get("plant");
  const fromLocation = params.get("location");
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt && !p.deletedAt);
  const locations = useLocations() ?? [];
  const presetPlant = plants.find((p) => p.id === fromPlant);
  const fromLocationName = locations.find((l) => l.id === fromLocation)?.name;

  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const gen = useRef(0);
  const smoother = useRef(new LightSmoother());
  const [cam, setCam] = useState<Cam>("starting");
  const [live, setLive] = useState<LiveState | null>(null);
  const [report, setReport] = useState<CameraReport | null>(null);
  const [picking, setPicking] = useState(false);
  const [snapshot, setSnapshot] = useState<LiveState | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

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
    smoother.current.reset();
    setLive(null);
    try {
      const s = await openRearCamera();
      if (my !== gen.current || !video.current) { stopStream(s); return; }
      stream.current = s;
      const track = s.getVideoTracks()[0];
      track?.addEventListener("ended", () => { if (stream.current === s) { stopCamera(); setCam("interrupted"); } });
      await attachPreview(video.current, s);
      if (my !== gen.current) return;
      setReport(cameraReport(track));
      setCam("live");
    } catch (e) {
      if (my === gen.current) setCam(cameraProblem(e));
    }
  }, [stopCamera]);

  // Camera on while the screen is open; released on leave/unmount, when the app is hidden, on pagehide.
  useEffect(() => { void startCamera(); return () => stopCamera(); }, [startCamera, stopCamera]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") { if (stream.current) { stopCamera(); setCam("off"); } }
      else if (!stream.current && !saving.current) void startCamera();
    };
    const onHide = () => stopCamera();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onHide); };
  }, [startCamera, stopCamera]);

  // Continuous measurement while the camera is live (stops with it — no work in the background).
  useEffect(() => {
    if (cam !== "live") return;
    const sampler = createSampler();
    const iv = setInterval(() => {
      const v = video.current, b = box.current;
      if (!v || !b) return;
      const r = b.getBoundingClientRect();
      const s = sampler.sample(v, { w: r.width, h: r.height, circle: CIRCLE * Math.min(r.width, r.height) });
      if (s) setLive(smoother.current.push(s, performance.now()));
    }, SAMPLE_MS);
    return () => { clearInterval(iv); sampler.dispose(); };
  }, [cam]);

  const ready = Boolean(cam === "live" && live?.ready && live.category);

  const save = async (plant: Plant | null, reading: LiveState) => {
    if (saving.current || !reading.category) return;
    // A plant's own location is used when it has one; otherwise the location the meter was opened from.
    const locationId = plant ? plant.locationId ?? fromLocation ?? null : fromLocation;
    if (!plant && !locationId) return;
    saving.current = true; setBusy(true);
    try {
      await addLightReading({
        plantId: plant?.id ?? null, locationId, category: savedCategory(reading.category), estimate: true, lux: null,
        method: "camera_live_auto", confidence: reading.confidence, timeOfDay: timeOfDayNow(),
        relative: { shadowContrast: Math.round(reading.contrast * 100) / 100, edgeSharpness: Math.round(reading.sharp * 1000) / 1000, dark: reading.dark, noShadow: reading.category === "no_shadow", algorithm: "shadow-contrast-v1" },
      });
      stopCamera();
      toast(plant ? `נשמר בהיסטוריה של ${displayName(plant)}` : "נשמר בפרופיל האור של המיקום");
      nav(plant ? `/plants/${plant.id}` : `/locations/${locationId}`, { replace: true });
    } catch { toast("השמירה נכשלה — אפשר לנסות שוב"); saving.current = false; setBusy(false); }
  };
  // The reading is frozen when the user taps — moving the phone while choosing a plant does not change it.
  const openPicker = () => { if (!live || !ready) return; setSnapshot(live); setPicking(true); };

  const problem = cam !== "starting" && cam !== "live" && cam !== "off" ? CAMERA_PROBLEM_TEXT[cam] : null;
  const label = live?.category ? AUTO_LABEL[live.category] : null;

  return (
    <main className="safe-top min-h-dvh overflow-x-hidden px-4 pb-10">
      <BackButton to={fromPlant ? `/plants/${fromPlant}` : fromLocation ? `/locations/${fromLocation}` : "/tools"} />
      <h1 className="mt-2 text-center text-[26px] font-bold text-ink">מד אור</h1>
      <div className="rise mt-3 space-y-3">
        {!problem && <p className="text-center text-[15px] leading-snug text-muted">כווני את העיגול למקום של הצמח, והחזיקי יד כ־30 ס״מ מעליו כך שהצל ייפול בתוך העיגול. המדידה רציפה — בלי לצלם.</p>}

        <div ref={box} className={cx("relative mx-auto aspect-[3/4] max-h-[50dvh] w-full overflow-hidden rounded-[28px] bg-[#23301f] shadow-soft", problem && "hidden")}>
          <video ref={video} data-testid="light-preview" data-state={cam} className="absolute inset-0 size-full object-cover" playsInline muted autoPlay aria-label="תצוגת מצלמה חיה" />
          {/* The analysed target: exactly this circle (CIRCLE × the shorter side, centred). */}
          <div data-testid="light-target" className="pointer-events-none absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white/85 shadow-[0_0_0_9999px_rgba(20,30,18,0.18)]"
            style={{ width: `${CIRCLE * 100}%`, maxHeight: `${CIRCLE * 100}%` }} aria-hidden />
          {cam === "starting" && <div className="absolute inset-0 grid place-items-center text-[15px] text-white/85"><span className="flex items-center gap-2"><span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />מפעילה מצלמה…</span></div>}
        </div>

        {problem ? (
          <div data-testid="light-camera-problem" role="alert" className="space-y-3">
            <InfoNote icon="camera" title={problem.title}>{problem.body}</InfoNote>
            {cam !== "unsupported" && cam !== "no_camera" && <Button variant="secondary" icon="refresh" className="w-full" onClick={() => void startCamera()}>לנסות שוב</Button>}
          </div>
        ) : (
          <>
            <div className="rounded-card bg-surface p-4 shadow-soft" data-testid="light-live" data-category={live?.category ?? ""} data-position={live ? live.position.toFixed(3) : ""}>
              <div className="flex justify-between text-[13px] font-semibold text-muted"><span>חשוך</span><span>שמש ישירה</span></div>
              <div className="relative mt-1.5 h-3 rounded-full bg-gradient-to-l from-sun via-sun-bg to-surface-2" role="meter" aria-label="עוצמת אור יחסית" aria-valuemin={0} aria-valuemax={100} aria-valuenow={live ? Math.round(live.position * 100) : 0}>
                <span className="absolute top-1/2 size-5 -translate-y-1/2 rounded-full border-[3px] border-surface bg-green shadow-soft transition-[inset-inline-start] duration-300 ease-out"
                  style={{ insetInlineStart: `calc(${((live?.position ?? 0) * 100).toFixed(1)}% - 10px)` }} />
              </div>
              <p className="mt-1.5 text-center text-[12px] text-muted">מדד יחסי לפי הצל בעיגול — לא לוקס (בדפדפן של האייפון אין נתוני חשיפה)</p>
              <div className="mt-3 text-center" aria-live="polite">
                {cam === "live" && label && live ? (
                  <>
                    <div className="text-[24px] font-bold text-ink" data-testid="light-category"><span aria-hidden>{label.emoji} </span>{label.title}</div>
                    <p className="mx-auto mt-1 max-w-sm text-[14px] leading-snug text-muted">{label.text}</p>
                    <span className="mt-2 inline-block rounded-full bg-sage px-3 py-1 text-[12px] font-semibold text-green" data-testid="light-confidence">{CONFIDENCE_LABEL[live.confidence]} · אוטומטי</span>
                  </>
                ) : <div className="py-3 text-[15px] text-muted">{cam === "off" ? "המצלמה כבויה" : "מתחילה למדוד…"}</div>}
              </div>
            </div>

            {presetPlant ? (
              <>
                <Button icon="leaf" className="w-full" disabled={!ready || busy} loading={busy} data-testid="light-save-preset" onClick={() => live && void save(presetPlant, live)}>שמירה ל{displayName(presetPlant)}</Button>
                <Button variant="text" className="w-full" disabled={!ready || busy} onClick={openPicker}>שייכי לצמח אחר</Button>
              </>
            ) : (
              <>
                <Button icon="leaf" className="w-full" disabled={!ready || busy} loading={busy} data-testid="light-assign" onClick={openPicker}>שייכי לצמח</Button>
                {fromLocation && <Button variant="secondary" className="w-full" disabled={!ready || busy} data-testid="light-save-location" onClick={() => live && void save(null, live)}>שמירה ל{fromLocationName ? `"${fromLocationName}"` : "מיקום"} בלבד</Button>}
              </>
            )}
            {!ready && cam === "live" && <p className="-mt-1 text-center text-[13px] text-muted">השמירה תתאפשר כשהמדידה תתייצב.</p>}

            <details className="rounded-2xl bg-bg-soft px-3 py-2 text-[13px] text-muted" data-testid="light-tech">
              <summary className="cursor-pointer py-1 font-semibold">פרטים טכניים</summary>
              <ul className="mt-1 space-y-1">
                <li>מה המצלמה בדפדפן הזה חושפת: <span className="ltr" data-testid="light-capabilities">{report?.capabilities.join(", ") || "—"}</span></li>
                <li>נתוני חשיפה (זמן חשיפה / ISO): {report?.exposureData ? "קיימים בדפדפן הזה, אבל Leafling עוד לא משתמשת בהם (לא אומתו על מכשיר)" : "לא זמינים — לכן אין לוקס"}</li>
                <li>יחס אור/צל בעיגול: <span className="ltr">{live ? live.contrast.toFixed(2) : "—"}</span> · חדות קצה הצל: <span className="ltr">{live ? live.sharp.toFixed(2) : "—"}</span>{live?.dark ? " · המצלמה בגבול הרגישות (חשוך)" : ""}</li>
                <li>דגימה: כ־8 פעמים בשנייה, רק העיגול. תמונות לא נשמרות ולא נשלחות.</li>
              </ul>
            </details>
          </>
        )}
      </div>

      <PersonalPlantPicker open={picking} onClose={() => setPicking(false)} title="לאיזה מהצמחים שלך לשייך?" currentLocationId={fromLocation}
        onPick={(p) => { setPicking(false); if (snapshot) void save(p, snapshot); }}
        pickLabel={(p) => (!p.locationId && fromLocation ? `יישמר גם למיקום "${fromLocationName ?? ""}"` : null)} testid="light-plant-picker" />
    </main>
  );
}
