import type { PetEntry, PetKind } from "./types.ts";

// Pets: any number of individual animals, several of the same kind allowed (e.g. two dogs).
// Toxicity is always evaluated by the animal's KIND (never inferred from its name); names only
// personalise the wording ("לא בטוח למיקאסה ולבייליס").

export const PET_KINDS: PetKind[] = ["dog", "cat", "bird", "rabbit", "rodent", "reptile", "other"];
export const PET_SINGULAR: Record<PetKind, string> = { dog: "כלב", cat: "חתול", bird: "ציפור", rabbit: "ארנב", rodent: "מכרסם", reptile: "זוחל", other: "חיה" };
export const PET_PLURAL: Record<PetKind, string> = { dog: "כלבים", cat: "חתולים", bird: "ציפורים", rabbit: "ארנבים", rodent: "מכרסמים", reptile: "זוחלים", other: "חיות" };

export type Pet = PetEntry & { id: string };

/**
 * Older profiles stored pets without ids (one entry per kind). They are read as-is and given a
 * deterministic id from their position, so nothing is rewritten until the user edits the list.
 */
export function normalizePets(pets: PetEntry[] | null | undefined): Pet[] {
  if (!Array.isArray(pets)) return [];
  return pets
    .filter((p) => p && typeof p === "object" && PET_KINDS.includes(p.kind))
    .map((p, i) => ({ ...p, id: typeof p.id === "string" && p.id ? p.id : `legacy-${i}-${p.kind}`, name: typeof p.name === "string" ? p.name : null }));
}

export const newPet = (kind: PetKind): Pet => ({ id: crypto.randomUUID(), kind, name: null });

export function petDisplayName(p: Pet, all: Pet[]): string {
  const name = p.name?.trim();
  if (name) return name;
  const same = all.filter((x) => x.kind === p.kind);
  return same.length > 1 ? `${PET_SINGULAR[p.kind]} ${same.indexOf(p) + 1}` : PET_SINGULAR[p.kind];
}

/** "למיקאסה ולבייליס", "לכלב", "למיקאסה, לבייליס ולחתול". */
export function hebrewToList(pets: Pet[]): string {
  const items = pets.map((p) => {
    const n = p.name?.trim();
    if (!n) return `ל${PET_SINGULAR[p.kind]}`;
    return /^[֐-׿]/.test(n) ? `ל${n}` : `ל-${n}`;
  });
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ו${items[items.length - 1]}`;
}

export type Tox = "toxic" | "non_toxic" | "unknown";
export interface PetSafety { unsafe: Pet[]; unknown: Pet[]; safe: Pet[]; warning: string | null; unknownNote: string | null }

/** Personalised safety for ALL saved pets, by kind. Only cats and dogs have sourced data; others are unknown. */
export function petSafety(tox: { cats: Tox; dogs: Tox }, pets: Pet[]): PetSafety {
  const of = (k: PetKind): Tox => (k === "cat" ? tox.cats : k === "dog" ? tox.dogs : "unknown");
  const unsafe = pets.filter((p) => of(p.kind) === "toxic");
  const unknown = pets.filter((p) => of(p.kind) === "unknown");
  const safe = pets.filter((p) => of(p.kind) === "non_toxic");
  return {
    unsafe, unknown, safe,
    warning: unsafe.length ? `לא בטוח ${hebrewToList(unsafe)}` : null,
    unknownNote: unknown.length ? `אין מידע מאומת ${hebrewToList(unknown)} — לכן לא נקבע שהצמח בטוח.` : null,
  };
}
