import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { STATUS_LABEL } from "../../shared/domain.ts";
import { lightFit, searchSpecies, speciesById, SPECIES, type Species } from "../../shared/species.ts";
import type { Status } from "../../shared/types.ts";
import { db } from "../data/db.ts";
import { addPhoto } from "../data/media.ts";
import { createLocation, createPlant, markPurchased, useLocations, type NewPlantInput } from "../data/store.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { BackButton, Button, Chip, Field, InfoNote, Input, Select, SpeciesImage, Textarea, cx, useToast } from "../ui/ui.tsx";

type Step = "species" | "photo" | "status" | "details";
const STATUS_CARDS: { id: Status; icon: IconName; text: string }[] = [
  { id: "plant", icon: "pot", text: "צמח מבוסס בעציץ או בגינה" },
  { id: "seedling", icon: "seed", text: "זרעים שנזרעו או שתילים צעירים" },
  { id: "rooting", icon: "root", text: "ייחור שמכה שורש" },
  { id: "sick", icon: "steth", text: "צמח שצריך עכשיו טיפול" },
];

export default function AddPlant() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const preset = speciesById(params.get("species"));
  const wishlistId = params.get("wishlist");
  const locations = useLocations() ?? [];
  const [step, setStep] = useState<Step>(preset || params.get("name") ? "photo" : "species");
  const [species, setSpecies] = useState<Species | null>(preset ?? null);
  const [custom, setCustom] = useState({ he: params.get("name") ?? "", scientific: params.get("sci") ?? "" });
  const [q, setQ] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const initialStatus = (params.get("status") as Status) || null;
  const [status, setStatus] = useState<Status | null>(initialStatus);
  const [nickname, setNickname] = useState("");
  const [locationId, setLocationId] = useState<string>("");
  const [newLoc, setNewLoc] = useState("");
  const [acq, setAcq] = useState<"today" | "date" | "unknown">("today");
  const [acqDate, setAcqDate] = useState("");
  const [more, setMore] = useState(false);
  const [d, setD] = useState<Partial<NewPlantInput>>({});
  const [saving, setSaving] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchSpecies(q).slice(0, 30), [q]);

  const pick = (f: File | undefined) => { if (!f) return; setPhoto(f); setPreview(URL.createObjectURL(f)); setStep("status"); };
  const statuses = wishlistId ? STATUS_CARDS.filter((s) => s.id !== "sick") : STATUS_CARDS;
  const loc = locations.find((l) => l.id === locationId);
  const fit = lightFit(species ?? undefined, loc?.lightCategory);

  const save = async () => {
    if (!status) return;
    setSaving(true);
    try {
      let locId = locationId || null;
      if (locationId === "__new" && newLoc.trim()) locId = (await createLocation({ name: newLoc.trim() })).id;
      if (locationId === "__new" && !newLoc.trim()) locId = null;
      const today = new Date().toISOString().slice(0, 10);
      const plant = await createPlant({
        ...d, species, customName: species ? undefined : { he: custom.he.trim() || "צמח", scientific: custom.scientific.trim() || undefined },
        status, nickname, locationId: locId,
        acquiredAt: status === "plant" || status === "sick" ? (acq === "today" ? today : acq === "date" ? acqDate || null : null) : (d.acquiredAt ?? null),
      });
      if (photo) await addPhoto(plant.id, photo, { setMain: true });
      if (wishlistId) {
        const w = await db.wishlist.get(wishlistId);
        if (w) await markPurchased(w, plant.id);
        toast("הוא כבר לא רק חלום 🌱");
      } else toast("הצמח נוסף 🌱");
      nav(status === "sick" ? `/plants/${plant.id}?diagnose=offer` : `/plants/${plant.id}`, { replace: true });
    } finally { setSaving(false); }
  };

  const title = { species: "איזה צמח זה?", photo: "תמונה אישית", status: "מה המצב שלו?", details: "עוד כמה פרטים" }[step];
  const back = () => setStep(step === "details" ? "status" : step === "status" ? "photo" : step === "photo" && !preset ? "species" : step);

  return (
    <main className="safe-top min-h-dvh px-4 pb-[calc(env(safe-area-inset-bottom)+28px)]">
      <div className="flex items-center justify-between">
        {step === "species" || (step === "photo" && preset) ? <BackButton /> : <button onClick={back} aria-label="חזרה" className="pressable grid size-11 place-items-center rounded-full bg-surface shadow-soft"><Icon name="back" /></button>}
        <div className="text-[15px] font-medium text-muted">הוספת צמח</div>
        <div className="w-11" />
      </div>
      <h1 className="mt-4 text-center text-[28px] font-bold text-ink">{title}</h1>
      {species && step !== "species" && <p className="mt-1 text-center text-[16px] text-muted">{species.he} · <span className="sci">{species.scientific}</span></p>}

      {step === "species" && (
        <div className="rise mt-4 space-y-3">
          <Input icon="search" autoFocus placeholder="שם בעברית, באנגלית או שם מדעי" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="secondary" icon="camera" className="w-full" onClick={() => nav("/identify?add=1")}>לא יודעת — לזהות לפי תמונה</Button>
          <div className="grid grid-cols-2 gap-3">
            {results.map((s) => (
              <button key={s.id} onClick={() => { setSpecies(s); setStep("photo"); }} className="pressable rounded-card bg-surface p-2 text-start shadow-soft">
                <SpeciesImage species={s} className="aspect-[7/5] w-full" />
                <div className="px-1 pt-2 text-[16px] font-bold text-ink">{s.he}</div>
                <div className="px-1 pb-1 text-[13px]"><span className="sci text-muted">{s.scientific}</span></div>
              </button>
            ))}
          </div>
          <div className="rounded-card bg-sage/60 p-4">
            <div className="text-[16px] font-semibold text-ink">הזן לא ברשימה?</div>
            <div className="mt-2 space-y-2">
              <Input placeholder="שם הצמח בעברית" value={custom.he} onChange={(e) => setCustom({ ...custom, he: e.target.value })} />
              <Input placeholder="שם מדעי (אופציונלי)" dir="ltr" value={custom.scientific} onChange={(e) => setCustom({ ...custom, scientific: e.target.value })} />
              <Button size="md" className="w-full" disabled={!custom.he.trim()} onClick={() => { setSpecies(null); setStep("photo"); }}>המשך עם השם הזה</Button>
            </div>
          </div>
          {!q && SPECIES.length > 0 && <p className="text-center text-[13px] text-muted">המאגר הכללי מתרחב בהדרגה.</p>}
        </div>
      )}

      {step === "photo" && (
        <div className="rise mt-6 space-y-3">
          <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-card bg-sage">
            {species ? <SpeciesImage species={species} className="size-full" /> : <Icon name="camera" size={56} className="text-green" />}
          </div>
          <p className="text-center text-[15px] text-muted">תמונה של הצמח שלך נכנסת ליומן ולטיימלאפס. אפשר גם לדלג — תוצג תמונת זן מסומנת.</p>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <input ref={libRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <div className="grid grid-cols-2 gap-3">
            <Button icon="camera" onClick={() => camRef.current?.click()}>מצלמה</Button>
            <Button variant="secondary" icon="image" onClick={() => libRef.current?.click()}>גלריה</Button>
          </div>
          <Button variant="text" className="w-full" onClick={() => setStep("status")}>דלגי בינתיים</Button>
        </div>
      )}

      {step === "status" && (
        <div className="rise mt-6 space-y-3">
          {preview && <img src={preview} alt="" className="mx-auto aspect-square w-32 rounded-card object-cover shadow-soft" />}
          {statuses.map((s) => (
            <button key={s.id} onClick={() => { setStatus(s.id); setStep("details"); }} aria-pressed={status === s.id}
              className={cx("pressable flex w-full items-center gap-4 rounded-card p-4 text-start shadow-soft", status === s.id ? "bg-sage ring-2 ring-green/70" : "bg-surface")}>
              <div className="grid size-12 place-items-center rounded-full bg-sage text-green"><Icon name={s.icon} size={26} /></div>
              <div className="flex-1"><div className="text-[18px] font-semibold text-ink">{STATUS_LABEL[s.id]}</div><div className="text-[14px] text-muted">{s.text}</div></div>
            </button>
          ))}
        </div>
      )}

      {step === "details" && status && (
        <div className="rise mt-6 space-y-4">
          <Field label="כינוי" optional hint="אם לא תבחרי כינוי, נשתמש בשם הזן."><Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="למשל: מוצי" /></Field>
          <Field label="מיקום">
            <Select icon="pin" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">ללא מיקום כרגע</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="__new">+ מיקום חדש</option>
            </Select>
          </Field>
          {locationId === "__new" && <Input autoFocus placeholder="למשל: סלון — ליד החלון" value={newLoc} onChange={(e) => setNewLoc(e.target.value)} />}
          {fit === "poor" && <InfoNote icon="sun" title="שימי לב לאור">לפי הידע הכללי, האור במיקום הזה פחות מתאים ל{species?.he}. אפשר בכל זאת למקם כאן — נעקוב ונלמד.</InfoNote>}

          {(status === "plant" || status === "sick") && (
            <>
              <Field label="מתי הגיע אלייך?">
                <div className="flex flex-wrap gap-2">{([["today", "היום"], ["date", "בחירת תאריך"], ["unknown", "לא זוכרת"]] as const).map(([k, l]) => <Chip key={k} selected={acq === k} onClick={() => setAcq(k)}>{l}</Chip>)}</div>
              </Field>
              {acq === "date" && <Input type="date" value={acqDate} onChange={(e) => setAcqDate(e.target.value)} />}
              <Field label="קוטר עציץ (ס״מ)" optional><Input type="number" inputMode="decimal" value={d.potDiameterCm ?? ""} onChange={(e) => setD({ ...d, potDiameterCm: e.target.value ? Number(e.target.value) : null })} /></Field>
            </>
          )}
          {status === "seedling" && (
            <>
              <Field label="תאריך זריעה"><Input type="date" value={d.sowDate ?? ""} onChange={(e) => setD({ ...d, sowDate: e.target.value || null })} /></Field>
              <Field label="כמה זרעים?" optional><Input type="number" inputMode="numeric" value={d.seedCount ?? ""} onChange={(e) => setD({ ...d, seedCount: e.target.value ? Number(e.target.value) : null })} placeholder="לא ידוע" /></Field>
              <Field label="איך נזרע?" optional>
                <div className="flex flex-wrap gap-2">{([["one_cell", "תא אחד"], ["multiple_cells", "כמה תאים"], ["direct", "ישירות לאדמה"]] as const).map(([k, l]) => <Chip key={k} selected={d.sowingType === k} onClick={() => setD({ ...d, sowingType: k })}>{l}</Chip>)}</div>
              </Field>
              <Field label="כבר נבטו?" optional><Input type="number" inputMode="numeric" value={d.germinatedCount ?? ""} onChange={(e) => setD({ ...d, germinatedCount: e.target.value ? Number(e.target.value) : null })} placeholder="0" /></Field>
              <p className="text-[13px] text-muted">לא נוצר כרטיס לכל זרע — זה כרטיס קבוצה אחד עם ספירה.</p>
            </>
          )}
          {status === "rooting" && (
            <>
              <Field label="מתי התחלת?"><Input type="date" value={d.propagationStart ?? new Date().toISOString().slice(0, 10)} onChange={(e) => setD({ ...d, propagationStart: e.target.value || null })} /></Field>
              <Field label="שיטה">
                <div className="flex flex-wrap gap-2">{(species?.propagation.methods.length ? species.propagation.methods : ["מים", "מצע", "ספגנום", "לקה"]).map((m) => <Chip key={m} selected={d.propagationMethod === m} onClick={() => setD({ ...d, propagationMethod: m })}>{m}</Chip>)}</div>
              </Field>
              <Field label="מצב שורשים">
                <div className="flex flex-wrap gap-2">{([["none", "אין שורשים"], ["started", "התחילו"], ["growing", "גדלים"]] as const).map(([k, l]) => <Chip key={k} selected={(d.rootState ?? "none") === k} onClick={() => setD({ ...d, rootState: k })}>{l}</Chip>)}</div>
              </Field>
              <Field label="כמה ייחורים?" optional><Input type="number" inputMode="numeric" value={d.cuttingCount ?? ""} onChange={(e) => setD({ ...d, cuttingCount: e.target.value ? Number(e.target.value) : null })} /></Field>
            </>
          )}
          {status === "sick" && <InfoNote icon="steth">אחרי השמירה נציע לפתוח אבחון — אפשר גם לוותר.</InfoNote>}

          <button className="pressable flex min-h-11 w-full items-center justify-center gap-2 text-[16px] font-medium text-green" onClick={() => setMore((m) => !m)}>
            <Icon name={more ? "down" : "plus"} size={18} /> פרטים נוספים
          </button>
          {more && (
            <div className="fade-in space-y-3 rounded-card bg-sage/50 p-4">
              <Field label="חומר העציץ" optional><Input value={d.potMaterial ?? ""} onChange={(e) => setD({ ...d, potMaterial: e.target.value || null })} placeholder="פלסטיק, חרס, קרמיקה…" /></Field>
              <Field label="ניקוז" optional><div className="flex gap-2">{([[true, "יש חור ניקוז"], [false, "אין"]] as const).map(([v, l]) => <Chip key={l} selected={d.drainage === v} onClick={() => setD({ ...d, drainage: v })}>{l}</Chip>)}</div></Field>
              <Field label="מצע" optional><Input value={d.substrate ?? ""} onChange={(e) => setD({ ...d, substrate: e.target.value || null })} /></Field>
              <Field label="השקיה אחרונה" optional><Input type="date" value={d.lastWateredAt ?? ""} onChange={(e) => setD({ ...d, lastWateredAt: e.target.value || null })} /></Field>
              <Field label="הערה" optional><Textarea rows={3} value={d.note ?? ""} onChange={(e) => setD({ ...d, note: e.target.value || null })} /></Field>
              <p className="text-[13px] text-muted">עציץ ומצע לא חובה. כל פרט עוזר להמלצות להיות מדויקות יותר.</p>
            </div>
          )}
          <Button icon="check" loading={saving} onClick={save} className="w-full">שמירת הצמח</Button>
        </div>
      )}
    </main>
  );
}
