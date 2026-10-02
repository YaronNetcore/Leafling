import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Profile } from "../../shared/types.ts";
import { normalizePets } from "../../shared/pets.ts";
import { saveProfile, useProfile } from "../data/store.ts";
import { PetsEditor } from "../ui/PetsEditor.tsx";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Button, Field, IconButton, InfoNote, Input, Select, Wordmark, cx } from "../ui/ui.tsx";

// Six onboarding questions (PRODUCT_SPEC §12), one per screen, all skippable and editable
// later in Settings. Steps 1–4 follow the supplied design references.

const STEPS = 6;
const REGIONS = ["צפון", "חיפה", "מרכז", "תל אביב", "ירושלים", "דרום", "יהודה ושומרון"];
const COUNTRIES = ["ישראל", "ארצות הברית", "בריטניה", "צרפת", "גרמניה", "איטליה", "ספרד", "קנדה", "אוסטרליה", "אחר"];
const CITIES = ["תל אביב–יפו", "ירושלים", "חיפה", "ראשון לציון", "פתח תקווה", "אשדוד", "נתניה", "באר שבע", "חולון", "רמת גן", "הרצליה", "כפר סבא", "רעננה", "מודיעין", "רחובות", "אשקלון", "בת ים", "חדרה", "קריית שמונה", "אילת", "טבריה", "נצרת", "עכו", "צפת"];

export const INTERESTS = [
  { id: "houseplants", label: "צמחי בית" }, { id: "vegetables", label: "ירקות" }, { id: "herbs", label: "עשבי תיבול" },
  { id: "flowers", label: "פרחים" }, { id: "succulents", label: "סוקולנטים" }, { id: "seeds", label: "מזרע" },
  { id: "cuttings", label: "ייחורים" }, { id: "outdoor", label: "גינת חוץ" },
];
export const PLACES = [
  { id: "indoors", label: "בתוך הבית" }, { id: "balcony", label: "מרפסת" }, { id: "garden", label: "גינה" },
  { id: "windowsill", label: "אדני חלון" }, { id: "outdoors", label: "בחוץ" }, { id: "other", label: "אחר" },
];
const EXPERIENCE: { id: NonNullable<Profile["experience"]>; label: string; text: string; icon: IconName }[] = [
  { id: "beginner", label: "מתחילה", text: "רוצה הסברים פשוטים וצעד־צעד", icon: "seed" },
  { id: "some", label: "קצת ניסיון", text: "כבר גידלתי כמה צמחים", icon: "sprout" },
  { id: "experienced", label: "מנוסה", text: "מכירה את הבסיס היטב", icon: "leaf" },
  { id: "expert", label: "מנוסה מאוד", text: "אפשר להיכנס לפרטים", icon: "pot" },
];
export const HELP: { id: string; label: string; icon: IconName }[] = [
  { id: "soil", label: "בדיקות אדמה והשקיה", icon: "drop" }, { id: "fertilize", label: "דישון", icon: "flask" },
  { id: "rooting", label: "השרשות וייחורים", icon: "root" }, { id: "seedlings", label: "שתילים", icon: "seed" },
  { id: "repot", label: "העברת עציץ", icon: "pot" }, { id: "health", label: "בריאות הצמח", icon: "steth" },
  { id: "seasonal", label: "עונתי ומזג אוויר", icon: "sun" },
];

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3" aria-label={`שלב ${step} מתוך ${STEPS}`}>
      <div className="flex flex-1 gap-1.5">
        {Array.from({ length: STEPS }, (_, i) => <span key={i} className={cx("h-2 flex-1 rounded-full transition-colors", i < step ? "bg-green" : "bg-line")} />)}
      </div>
      <span className="ltr text-[15px] font-medium text-muted">{step}/{STEPS}</span>
    </div>
  );
}

function SelectTile({ selected, onClick, img, label, wide }: { selected: boolean; onClick: () => void; img: string; label: string; wide?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={selected}
      className={cx("pressable relative flex flex-col overflow-hidden rounded-card p-2 text-center shadow-soft", selected ? "bg-sage ring-2 ring-green/70" : "bg-surface")}>
      <img src={img} alt="" className={cx("w-full rounded-2xl object-cover", wide ? "aspect-[2/1]" : "aspect-[6/5]")} />
      <span className="py-2 text-[16px] font-medium text-ink">{label}</span>
      <span className={cx("absolute end-3 top-3 grid size-7 place-items-center rounded-lg border-2 shadow-sm", selected ? "border-green bg-green text-on-green" : "border-muted/40 bg-surface")}>
        {selected && <Icon name="check" size={18} strokeWidth={3} />}
      </span>
    </button>
  );
}

function Frame({ step, title, subtitle, children, onNext, onSkip, onBack, nextLabel = "המשך", mascot = true }:
  { step: number; title: string; subtitle?: string; children: ReactNode; onNext: () => void; onSkip: () => void; onBack?: () => void; nextLabel?: string; mascot?: boolean }) {
  return (
    <main className="safe-top relative flex min-h-dvh flex-col overflow-x-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
      {mascot && <img src="/img/deco/pot-mascot.webp" alt="" aria-hidden className="deco-pot pointer-events-none absolute bottom-0 end-0 z-0 w-20 opacity-95" />}
      <img src="/img/deco/leaves-bottom-left.webp" alt="" aria-hidden className="deco pointer-events-none absolute bottom-0 start-0 z-0 w-28 -scale-x-100 opacity-70" />
      <div className="flex items-center justify-between">
        <div className="w-11">{onBack && <IconButton icon="back" label="חזרה" onClick={onBack} />}</div>
        <Wordmark />
        <div className="w-11" />
      </div>
      <div className="mt-4 px-6"><Progress step={step} /></div>
      <h1 className="mt-6 text-center text-[29px] font-bold leading-tight text-ink">{title}</h1>
      {subtitle && <p className="mx-auto mt-2 max-w-sm text-center text-[16px] leading-relaxed text-muted">{subtitle}</p>}
      <div className="rise relative z-10 mt-5 flex-1">{children}</div>
      <div className="relative z-10 mx-auto mt-6 w-full max-w-sm space-y-1">
        <Button onClick={onNext} trailing="forward" className="w-full">{nextLabel}</Button>
        <button onClick={onSkip} className="pressable block min-h-11 w-full text-center text-[16px] font-medium text-green">דלגי בינתיים</button>
      </div>
    </main>
  );
}

export default function Onboarding() {
  const { step: stepParam } = useParams();
  const step = Math.min(Math.max(Number(stepParam) || 1, 1), STEPS);
  const nav = useNavigate();
  const profile = useProfile();
  const [draft, setDraft] = useState<Partial<Profile>>({});
  useEffect(() => { if (profile) setDraft((d) => ({ ...profile, ...d })); }, [profile]);
  const p = { pets: [], interests: [], places: [], help: {}, ...draft } as Profile;
  const set = (patch: Partial<Profile>) => { setDraft((d) => ({ ...d, ...patch })); void saveProfile(patch); };
  const go = (n: number) => {
    if (n > STEPS) { void saveProfile({ onboardingDone: true, onboardingStep: STEPS }); nav("/onboarding/done"); return; }
    void saveProfile({ onboardingStep: n });
    nav(`/onboarding/${n}`);
  };
  const toggle = (key: "interests" | "places", id: string) => {
    const cur = p[key] ?? [];
    set({ [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } as Partial<Profile>);
  };
  const common = { step, onNext: () => go(step + 1), onSkip: () => go(step + 1), onBack: step > 1 ? () => nav(`/onboarding/${step - 1}`) : undefined };

  if (step === 1) return (
    <Frame {...common} title="איפה את נמצאת?" subtitle="זה עוזר לנו להתאים את התזכורות וההמלצות שלך למזג האוויר, לעונות השנה ולתנאים באזור שלך." mascot={false}>
      <img src="/img/deco/onboarding-location.webp" alt="" className="mx-auto w-full max-w-md rounded-[2.5rem]" />
      <div className="mt-5 space-y-4">
        <Field label="מדינה"><Select icon="pin" value={p.country ?? "ישראל"} onChange={(e) => set({ country: e.target.value })}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="אזור / מחוז" optional>
          {(p.country ?? "ישראל") === "ישראל"
            ? <Select icon="map" value={p.region ?? ""} onChange={(e) => set({ region: e.target.value || null })}><option value="">בחירה…</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</Select>
            : <Input icon="map" value={p.region ?? ""} onChange={(e) => set({ region: e.target.value })} placeholder="אזור" />}
        </Field>
        <Field label="עיר" optional hint="לא צריך כתובת מדויקת.">
          <Input icon="city" list="cities" value={p.city ?? ""} onChange={(e) => set({ city: e.target.value })} placeholder="למשל: תל אביב" />
          <datalist id="cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
      </div>
    </Frame>
  );

  if (step === 2) return (
    <Frame {...common} title="יש לך חיות מחמד?" subtitle="נשתמש במידע הזה כדי להתריע אם צמחים עלולים להיות מסוכנים לחברים הפרוותיים שלך.">
      <PetsEditor pets={normalizePets(p.pets)} onChange={(pets) => set({ pets })} />
      <InfoNote icon="paw" title="למה זה חשוב?" className="mt-4">חלק מהצמחים יכולים להיות רעילים או לגרום לגירוי, בהתאם לסוג החיה ולסוג החשיפה (אכילה, מגע, עיניים וכו׳).</InfoNote>
    </Frame>
  );

  if (step === 3) return (
    <Frame {...common} title="מה את מגדלת?" subtitle="אפשר לבחור כמה אפשרויות">
      <div className="grid grid-cols-3 gap-2.5">
        {INTERESTS.map((it) => <SelectTile key={it.id} selected={p.interests.includes(it.id)} onClick={() => toggle("interests", it.id)} img={`/img/interests/${it.id}.webp`} label={it.label} />)}
      </div>
      <InfoNote icon="sprout" title="לא בטוחה?" className="mt-4">זה בסדר, אפשר לשנות את ההגדרות האלה בכל שלב בהגדרות האפליקציה.</InfoNote>
    </Frame>
  );

  if (step === 4) return (
    <Frame {...common} title="איפה את מגדלת?" subtitle="אפשר לבחור כמה מיקומים">
      <div className="grid grid-cols-2 gap-3">
        {PLACES.map((pl) => <SelectTile key={pl.id} wide selected={p.places.includes(pl.id)} onClick={() => toggle("places", pl.id)} img={`/img/places/${pl.id}.webp`} label={pl.label} />)}
      </div>
      <InfoNote icon="pot" title="חשוב לדעת:" className="mt-4">המיקום עוזר לנו להציע טיפול מותאם יותר, בהתבסס על אור, עונות ומזג אוויר באזור שלך.</InfoNote>
    </Frame>
  );

  if (step === 5) return (
    <Frame {...common} title="כמה ניסיון יש לך?" subtitle="זה משנה רק את עומק ההסברים — כל האפשרויות פתוחות לכולן.">
      <div className="space-y-3">
        {EXPERIENCE.map((x) => (
          <button key={x.id} onClick={() => set({ experience: x.id })} aria-pressed={p.experience === x.id}
            className={cx("pressable flex w-full items-center gap-4 rounded-card p-4 text-start shadow-soft", p.experience === x.id ? "bg-sage ring-2 ring-green/70" : "bg-surface")}>
            <div className="grid size-12 place-items-center rounded-full bg-sage text-green"><Icon name={x.icon} size={26} /></div>
            <div className="flex-1"><div className="text-[18px] font-semibold text-ink">{x.label}</div><div className="text-[14px] text-muted">{x.text}</div></div>
            {p.experience === x.id && <Icon name="check" className="text-green" />}
          </button>
        ))}
      </div>
    </Frame>
  );

  return (
    <Frame {...common} title="במה נעזור לך?" subtitle="אפשר לשנות בכל רגע בהגדרות." nextLabel="סיום">
      <div className="space-y-2">
        {HELP.map((h) => {
          const on = p.help?.[h.id] !== false;
          return (
            <button key={h.id} onClick={() => set({ help: { ...p.help, [h.id]: !on } })} role="switch" aria-checked={on}
              className="pressable flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-start shadow-soft">
              <div className="grid size-11 place-items-center rounded-full bg-sage text-green"><Icon name={h.icon} /></div>
              <span className="flex-1 text-[17px] text-ink">{h.label}</span>
              <span className={cx("relative h-7 w-12 rounded-full transition-colors", on ? "bg-green" : "bg-line")}>
                <span className={cx("absolute top-1 size-5 rounded-full bg-surface shadow transition-all", on ? "end-1" : "start-1")} />
              </span>
            </button>
          );
        })}
      </div>
      <InfoNote icon="bell" className="mt-4">התראות למכשיר יישלחו רק לדברים חשובים — בדיקות אדמה, טיפולים, שתילים והשרשות. לעולם לא בשביל "לחזור לאפליקציה".</InfoNote>
    </Frame>
  );
}

export function OnboardingDone() {
  const nav = useNavigate();
  return (
    <main className="safe-top relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 pb-10 text-center">
      <img src="/img/deco/pot-mascot.webp" alt="" aria-hidden className="celebrate w-40" />
      <h1 className="mt-6 text-[30px] font-bold text-ink">הכול מוכן 🌱</h1>
      <p className="mt-2 text-[18px] text-muted">עכשיו נכיר את הצמחים שלך</p>
      <div className="mt-8 w-full max-w-sm space-y-3">
        <Button icon="plus" onClick={() => nav("/plants/new")} className="w-full">הוספת הצמח הראשון שלי</Button>
        <Button variant="outline" icon="search" onClick={() => nav("/find")} className="w-full">קודם בא לי להסתכל על צמחים</Button>
      </div>
    </main>
  );
}
