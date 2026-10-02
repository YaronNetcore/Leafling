import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import { searchSpecies, speciesById, SPECIES } from "../../shared/species.ts";
import { picked } from "../data/ai.ts";
import { addToWishlist, usePlants, useWishlist } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Button, Card, EmptyState, IconButton, Input, PageHeader, SpeciesImage, TabRow, useToast } from "../ui/ui.tsx";
import { SpeciesTabs } from "./SpeciesCare.tsx";

const CATS = [
  { id: "all", label: "הכול" }, { id: "houseplant", label: "צמחי בית" }, { id: "herb", label: "עשבי תיבול" },
  { id: "vegetable", label: "ירקות" }, { id: "succulent", label: "סוקולנטים" }, { id: "flower", label: "פורחים" }, { id: "outdoor", label: "גינה" },
];

/** Find Plant: name search + camera + gallery in one screen. Searches species names, never personal nicknames. */
export default function FindPlant() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchSpecies(q).filter((s) => cat === "all" || s.category === cat), [q, cat]);
  const go = (files: FileList | null) => { if (files?.length) { picked.files = Array.from(files); nav("/identify?picked=1"); } };
  return (
    <div>
      <PageHeader title="מצא צמח" subtitle="חיפוש לפי שם, או זיהוי לפי תמונה" />
      <div className="px-4">
        <Input icon="search" placeholder="מונסטרה, Pothos, בזיליקום…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button variant="secondary" icon="camera" onClick={() => camRef.current?.click()}>מצלמה</Button>
          <Button variant="secondary" icon="image" onClick={() => libRef.current?.click()}>גלריה</Button>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { go(e.target.files); e.target.value = ""; }} />
        <input ref={libRef} type="file" accept="image/*" multiple hidden onChange={(e) => { go(e.target.files); e.target.value = ""; }} />
        <div className="mt-4"><TabRow tabs={CATS} value={cat} onChange={setCat} /></div>
        {!results.length ? <EmptyState title="לא מצאנו את הזן" text="אפשר לנסות שם אחר, לזהות לפי תמונה, או להוסיף צמח עם שם משלך." action={<Button variant="secondary" onClick={() => nav("/plants/new")} className="w-full">הוספה עם שם משלי</Button>} /> : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {results.map((s) => (
              <Card key={s.id} as="button" onClick={() => nav(`/find/species/${s.id}`)} className="rise p-2">
                <SpeciesImage species={s} className="aspect-[7/5] w-full" />
                <div className="px-1.5 pt-2 text-[17px] font-bold text-ink">{s.he}</div>
                <div className="px-1.5 pb-1 text-[13px]"><span className="sci text-muted">{s.scientific}</span></div>
              </Card>
            ))}
          </div>
        )}
        <p className="mt-4 text-center text-[13px] text-muted">{SPECIES.length} זנים במאגר הכללי · מידע כללי שמסומן כלא מאומת</p>
      </div>
    </div>
  );
}

/** General plant page (reference 06): hero, names, tabs טיפול | ריבוי | בטיחות | בעיות נפוצות. */
export function SpeciesPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const sp = speciesById(id);
  const plants = usePlants() ?? [];
  const wishlist = useWishlist() ?? [];
  if (!sp) return <EmptyState title="הזן לא נמצא" action={<Button onClick={() => nav("/find")} className="w-full">חזרה לחיפוש</Button>} />;
  const mine = plants.filter((p) => p.speciesId === sp.id && !p.archivedAt);
  const inWishlist = wishlist.some((w) => w.speciesId === sp.id);
  return (
    <div>
      <div className="relative h-[42vh] min-h-[300px] overflow-hidden">
        <SpeciesImage species={sp} className="size-full !rounded-none" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/55 to-transparent" />
        <div className="safe-top absolute inset-x-0 top-0 flex justify-between px-4">
          <BackButton to="/find" />
          <IconButton icon="heart" label={inWishlist ? "כבר בצמחי החלומות" : "הוספה לצמחי החלומות"} className={inWishlist ? "!text-[#e48c8c]" : ""}
            onClick={async () => { await addToWishlist(sp.id); toast("נשמר בצמחי החלומות ♡"); }} />
        </div>
        <div className="absolute inset-x-0 bottom-9 px-5 text-white">
          <h1 className="text-[34px] font-bold leading-tight drop-shadow">{sp.he}</h1>
          <div className="sci text-[16px] drop-shadow">{sp.scientific}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-surface/90 px-3 py-1 text-[13px] font-semibold text-ink">קושי: {sp.difficulty}</span>
            {sp.aliases.slice(0, 2).map((a) => <span key={a} className="rounded-full bg-surface/70 px-3 py-1 text-[13px] text-ink">{a}</span>)}
          </div>
        </div>
      </div>
      <div className="relative -mt-6 rounded-t-[28px] bg-bg px-4 pt-4">
        {mine.length > 0 && (
          <button onClick={() => nav(mine.length === 1 ? `/plants/${mine[0].id}` : "/plants")} className="pressable mb-3 flex w-full items-center gap-2 rounded-2xl bg-sage px-4 py-3 text-start text-[15px] font-medium text-green">
            <Icon name="pot" />יש לך {mine.length === 1 ? `כבר את ${displayName(mine[0])}` : `${mine.length} צמחים מהזן הזה`}<Icon name="forward" size={18} className="ms-auto" />
          </button>
        )}
        <SpeciesTabs sp={sp} />
        <div className="mt-5 space-y-2 pb-2">
          <Button icon="plus" onClick={() => nav(`/plants/new?species=${sp.id}`)} className="w-full">הוסף לצמחים שלי</Button>
          {!inWishlist && <Button variant="outline" icon="heart" onClick={async () => { await addToWishlist(sp.id); toast("נשמר בצמחי החלומות ♡"); }} className="w-full">♡ הוספה לצמחי החלומות</Button>}
        </div>
      </div>
    </div>
  );
}
