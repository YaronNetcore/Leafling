import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { readExif } from "../../shared/exif.ts";
import { LIGHT_CATEGORY_LABEL, categoryFromExposure, validExposure } from "../../shared/light.ts";
import type { LightCat } from "../../shared/types.ts";
import { makePreview } from "../data/images.ts";
import { addLightReading, timeOfDayNow, useLocations, usePlants } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Button, Card, Chip, Field, InfoNote, Select, cx, useToast } from "../ui/ui.tsx";

// מד אור — one flow: aim the phone at the plant's spot → take a photo → broad category (an ESTIMATE from the
// camera's own exposure data) → attach to a plant → save. No lux numbers, no scores, no questionnaire.
// Why an estimate: iPhone browsers expose no light sensor; a photo's EXIF exposure is the only real signal.

const CATS: LightCat[] = ["low", "medium", "bright_indirect", "direct"];
const TONE: Record<LightCat, string> = { low: "bg-surface-2 text-ink", medium: "bg-sage text-green", bright_indirect: "bg-sun-bg text-soil", direct: "bg-sun text-on-green" };

type Result =
  | { kind: "estimate"; category: LightCat; preview: string | null }
  | { kind: "no_exif"; preview: string | null }
  | { kind: "error" };

export default function LightMeter() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt && !p.deletedAt);
  const locations = (useLocations() ?? []).filter((l) => !l.deletedAt);
  const cam = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [userCat, setUserCat] = useState<LightCat | null>(null);
  const [plantId, setPlantId] = useState(params.get("plant") ?? "");
  const [locationId, setLocationId] = useState(params.get("location") ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => () => { if (result && "preview" in result && result.preview) URL.revokeObjectURL(result.preview); }, [result]);
  // A new entry point (different plant/location) starts a fresh measurement.
  const key = `${params.get("plant") ?? ""}|${params.get("location") ?? ""}`;
  useEffect(() => {
    setResult(null); setUserCat(null); setSaved(false);
    setPlantId(params.get("plant") ?? ""); setLocationId(params.get("location") ?? "");
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const plant = plants.find((p) => p.id === plantId);
  // The plant's own location is already known — never ask for it again.
  const effectiveLocation = plant ? (plant.locationId ?? null) : locationId || null;
  const locName = (id: string | null) => locations.find((l) => l.id === id)?.name;
  const category = result?.kind === "estimate" ? result.category : userCat;
  const fromPlant = Boolean(params.get("plant"));

  const onPhoto = async (files: FileList | null) => {
    const file = Array.from(files ?? [])[0];
    if (!file) return;
    setBusy(true); setSaved(false); setUserCat(null);
    try {
      const exif = readExif(new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer()));
      const preview = await makePreview(file).catch(() => null);
      const e = { exposureTime: exif.exposureTime ?? undefined, fNumber: exif.fNumber ?? undefined, iso: exif.iso ?? undefined };
      setResult(validExposure(e) ? { kind: "estimate", category: categoryFromExposure(e), preview } : { kind: "no_exif", preview });
    } catch { setResult({ kind: "error" }); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!category || saved) return;
    if (!plant && !effectiveLocation) { toast("צריך לבחור צמח או מיקום"); return; }
    setBusy(true);
    try {
      await addLightReading({
        plantId: plant?.id ?? null, locationId: effectiveLocation, category, estimate: true,
        method: result?.kind === "estimate" ? "camera_exposure" : "user_choice", timeOfDay: timeOfDayNow(),
      });
      setSaved(true);
      toast(plant ? `נשמר בהיסטוריה של ${displayName(plant)}` : "נשמר בפרופיל האור של המיקום");
      nav(plant ? `/plants/${plant.id}` : effectiveLocation ? `/locations/${effectiveLocation}` : "/tools", { replace: true });
    } catch { toast("השמירה נכשלה — אפשר לנסות שוב"); } finally { setBusy(false); }
  };

  return (
    <main className="safe-top min-h-dvh px-4 pb-10">
      <BackButton to={fromPlant ? `/plants/${params.get("plant")}` : params.get("location") ? `/locations/${params.get("location")}` : "/tools"} />
      <h1 className="mt-3 text-center text-[28px] font-bold text-ink">מד אור</h1>
      <div className="rise mt-5 space-y-4">
        <Card className="p-5 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-sun-bg text-sun"><Icon name="sun" size={32} /></div>
          <p className="mt-3 text-[18px] font-semibold text-ink">כַּווני את הטלפון למקום שבו הצמח נמצא</p>
          <p className="mt-1 text-[14px] text-muted">צלמי את המקום באור הרגיל שלו, בלי פלאש. התמונה משמשת רק להערכה ולא נשמרת.</p>
          <Button icon="camera" className="mt-4 w-full" loading={busy && !result} onClick={() => cam.current?.click()}>{result ? "למדוד שוב" : "מדדי אור"}</Button>
          <input ref={cam} data-testid="light-camera" type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onPhoto(e.target.files); e.target.value = ""; }} />
        </Card>

        {result?.kind === "error" && <InfoNote icon="info" title="לא הצלחנו לקרוא את התמונה">אפשר לנסות לצלם שוב.</InfoNote>}

        {result && result.kind !== "error" && (
          <div data-testid="light-result"><Card className="p-4">
            <div className="flex items-center gap-3">
              {result.preview && <img src={result.preview} alt="" className="size-16 rounded-2xl object-cover" />}
              <div className="flex-1">
                {result.kind === "estimate" ? (
                  <>
                    <div className="text-[13px] text-muted">הערכה</div>
                    <div className={cx("mt-1 inline-block rounded-full px-3 py-1 text-[20px] font-bold", TONE[result.category])}>{LIGHT_CATEGORY_LABEL[result.category]}</div>
                  </>
                ) : (
                  <div className="text-[15px] text-ink">בתמונה הזו אין נתוני חשיפה של המצלמה, ולכן אי אפשר להעריך ממנה את עוצמת האור.</div>
                )}
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              {result.kind === "estimate"
                ? "הערכה גסה מנתוני החשיפה שהמצלמה בחרה — לא מדידה של מד אור מכויל. משטחים כהים או בהירים מאוד יכולים להטות אותה."
                : "אפשר לצלם שוב עם מצלמת הטלפון, או לבחור בעצמך איך האור נראה במקום — זה יישמר כהערכה שלך."}
            </p>
            {result.kind === "no_exif" && (
              <div className="mt-3 flex flex-wrap gap-2" data-testid="light-user-choice">
                {CATS.map((c) => <Chip key={c} selected={userCat === c} onClick={() => setUserCat(c)}>{LIGHT_CATEGORY_LABEL[c]}</Chip>)}
              </div>
            )}
          </Card></div>
        )}

        {category && (
          <Card className="space-y-3 p-4">
            <Field label="שייכי לצמח">
              <Select icon="pot" value={plantId} onChange={(e) => setPlantId(e.target.value)} data-testid="light-plant">
                <option value="">{params.get("location") ? "בלי צמח — רק למיקום" : "בחירת צמח…"}</option>
                {plants.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
              </Select>
            </Field>
            {plant ? (
              <p className="text-[14px] text-muted">{plant.locationId ? `יתווסף גם לפרופיל האור של "${locName(plant.locationId) ?? "המיקום"}".` : "לצמח אין מיקום — ההערכה תישמר בהיסטוריה שלו."}</p>
            ) : !params.get("location") && locations.length > 0 ? (
              <Field label="או למיקום" optional>
                <Select icon="pin" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">ללא</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            ) : effectiveLocation ? <p className="text-[14px] text-muted">יתווסף לפרופיל האור של "{locName(effectiveLocation)}".</p> : null}
            <Button icon="check" className="w-full" loading={busy} disabled={saved || (!plant && !effectiveLocation)} onClick={save}>שמירה</Button>
          </Card>
        )}
      </div>
    </main>
  );
}
