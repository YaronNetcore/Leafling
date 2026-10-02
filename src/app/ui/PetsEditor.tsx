import { PET_KINDS, PET_SINGULAR, newPet, petDisplayName, type Pet } from "../../shared/pets.ts";
import type { PetKind } from "../../shared/types.ts";
import { Icon } from "./icons.tsx";
import { Input, Select, cx } from "./ui.tsx";

// Any number of individual pets — several of the same kind allowed (e.g. two dogs, מיקאסה and בייליס).
// Used by onboarding and Settings. Every change is passed up as the full list (saved to the user's profile).

const KIND_LABEL: Record<PetKind, string> = { dog: "כלב", cat: "חתול", bird: "ציפור", rabbit: "ארנב", rodent: "מכרסם", reptile: "זוחל", other: "אחר" };

export function PetsEditor({ pets, onChange }: { pets: Pet[]; onChange: (pets: Pet[]) => void }) {
  const count = (k: PetKind) => pets.filter((p) => p.kind === k).length;
  const update = (id: string, patch: Partial<Pet>) => onChange(pets.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <div>
      <p className="mb-2 text-[14px] text-muted">כל לחיצה מוסיפה חיה אחת — אפשר להוסיף כמה מאותו סוג.</p>
      <div className="grid grid-cols-4 gap-2" data-testid="pet-kinds">
        {PET_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => onChange([...pets, newPet(k)])} aria-label={`הוספת ${KIND_LABEL[k]}`}
            className={cx("pressable relative flex flex-col items-center rounded-card p-2 shadow-soft", count(k) ? "bg-sage ring-2 ring-green/70" : "bg-surface")}>
            <img src={`/img/pets/${k}.webp`} alt="" className="soft-edge aspect-square w-full object-contain" />
            <span className="mt-0.5 text-[14px] font-medium text-ink">{KIND_LABEL[k]}</span>
            <span className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-green text-[12px] font-bold text-on-green">{count(k) ? count(k) : <Icon name="plus" size={14} strokeWidth={3} />}</span>
          </button>
        ))}
      </div>
      {pets.length > 0 && (
        <div className="mt-4 space-y-2" data-testid="pet-list">
          {pets.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-2xl bg-surface p-2 shadow-soft" data-testid="pet-row">
              <div className="w-28 shrink-0">
                <Select aria-label="סוג החיה" value={p.kind} onChange={(e) => update(p.id, { kind: e.target.value as PetKind })}>
                  {PET_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <Input aria-label="שם" placeholder={`שם ל${PET_SINGULAR[p.kind]}`} value={p.name ?? ""} onChange={(e) => update(p.id, { name: e.target.value })} />
              </div>
              <button type="button" aria-label={`הסרת ${petDisplayName(p, pets)}`} onClick={() => onChange(pets.filter((x) => x.id !== p.id))}
                className="pressable grid size-10 shrink-0 place-items-center rounded-full bg-heat-bg text-heat"><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
