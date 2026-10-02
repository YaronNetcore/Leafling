import { useEffect, useRef, useState } from "react";
import { IMAGE_ERROR_TEXT, MAX_IMAGES, checkFile, makePreview, planAdd, type ImageError } from "../data/images.ts";
import { Icon } from "./icons.tsx";

export interface PickedImage { id: string; file: File; status: "loading" | "ready" | "error"; preview?: string; error?: ImageError }

/** Up to MAX_IMAGES images from the camera and/or the photo library, each with its own preview. */
export function usePhotoPicker(max = MAX_IMAGES) {
  const [items, setItems] = useState<PickedImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(items);
  live.current = items;
  useEffect(() => () => live.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const add = (list: FileList | File[] | null | undefined) => {
    // Copy NOW: a FileList is live and is emptied when the <input> is reset right after this call.
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const { accept, overflow } = planAdd(live.current.length, files, max);
    const notes: string[] = [];
    if (overflow) notes.push(IMAGE_ERROR_TEXT.too_many + (accept.length ? ` ${overflow} לא נוספו.` : ""));
    const fresh: PickedImage[] = [];
    for (const file of accept) {
      const bad = checkFile(file);
      if (bad) { notes.push(IMAGE_ERROR_TEXT[bad]); continue; }
      fresh.push({ id: crypto.randomUUID(), file, status: "loading" });
    }
    setNotice(notes.length ? [...new Set(notes)].join(" ") : null);
    if (!fresh.length) return;
    live.current = [...live.current, ...fresh];
    setItems(live.current);
    for (const it of fresh) {
      makePreview(it.file).then(
        (preview) => setItems((cur) => cur.some((x) => x.id === it.id) ? cur.map((x) => (x.id === it.id ? { ...x, status: "ready", preview } : x)) : (URL.revokeObjectURL(preview), cur)),
        () => setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, status: "error", error: "unreadable" } : x))),
      );
    }
  };
  const remove = (id: string) => setItems((cur) => { const it = cur.find((x) => x.id === id); if (it?.preview) URL.revokeObjectURL(it.preview); return cur.filter((x) => x.id !== id); });
  const clear = () => setItems((cur) => { cur.forEach((x) => x.preview && URL.revokeObjectURL(x.preview)); return []; });
  const ready = items.filter((i) => i.status === "ready");
  return { items, ready, files: ready.map((i) => i.file), loading: items.some((i) => i.status === "loading"), notice, add, remove, clear, max };
}

export function PhotoPicker({ picker, hint }: { picker: ReturnType<typeof usePhotoPicker>; hint?: string }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const full = picker.items.length >= picker.max;
  return (
    <div>
      <div className="flex flex-wrap gap-2" data-testid="photo-picker">
        {picker.items.map((it, i) => (
          <div key={it.id} className="relative size-20" data-testid="picked-image" data-status={it.status}>
            {it.status === "ready" && <img src={it.preview} alt={`תמונה ${i + 1}`} className="size-20 rounded-2xl object-cover" />}
            {it.status === "loading" && <div className="skeleton grid size-20 place-items-center rounded-2xl text-[12px] text-muted">טוען…</div>}
            {it.status === "error" && <div className="grid size-20 place-items-center rounded-2xl bg-heat-bg p-1 text-center text-[11px] leading-tight text-heat">לא נקראה</div>}
            <button type="button" aria-label={`הסרת תמונה ${i + 1}`} onClick={() => picker.remove(it.id)} className="absolute -end-1 -top-1 grid size-7 place-items-center rounded-full bg-ink text-bg"><Icon name="x" size={14} /></button>
          </div>
        ))}
        {!full && (
          <>
            <button type="button" onClick={() => cam.current?.click()} className="pressable flex size-20 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-dashed border-sage-strong text-green" aria-label="צילום במצלמה"><Icon name="camera" size={26} /><span className="text-[11px]">מצלמה</span></button>
            <button type="button" onClick={() => lib.current?.click()} className="pressable flex size-20 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-dashed border-sage-strong text-green" aria-label="בחירה מהגלריה"><Icon name="image" size={26} /><span className="text-[11px]">גלריה</span></button>
          </>
        )}
      </div>
      <p className="mt-2 text-[13px] text-muted">{picker.items.length}/{picker.max} תמונות{hint ? ` · ${hint}` : ""}</p>
      {picker.notice && <p role="alert" className="mt-1 text-[13px] font-medium text-heat">{picker.notice}</p>}
      {picker.items.some((i) => i.status === "error") && <p role="alert" className="mt-1 text-[13px] font-medium text-heat">{IMAGE_ERROR_TEXT.unreadable}</p>}
      {/* Two separate inputs: camera capture and library selection work independently. */}
      <input ref={cam} data-testid="input-camera" type="file" accept="image/*" capture="environment" hidden onChange={(e) => { picker.add(e.target.files); e.target.value = ""; }} />
      <input ref={lib} data-testid="input-library" type="file" accept="image/*" multiple hidden onChange={(e) => { picker.add(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
