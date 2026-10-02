import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import type { Plant } from "../../shared/types.ts";
import { postpone, recordEvent, updatePlant, usePlant } from "../data/store.ts";
import { mutate } from "../data/sync.ts";
import { ActionRow, BackButton, Button, Field, InfoNote, Input, cx, useToast } from "../ui/ui.tsx";

function Frame({ title, plant, children }: { title: string; plant?: Plant | null; children: React.ReactNode }) {
  return (
    <main className="safe-top min-h-dvh px-4 pb-10">
      <BackButton />
      <h1 className="mt-4 text-center text-[28px] font-bold text-ink">{title}</h1>
      {plant && <p className="mt-1 text-center text-muted">{displayName(plant)}</p>}
      <div className="rise mt-6 space-y-3">{children}</div>
    </main>
  );
}

/** Rooting check: no universal root length; first root can prompt a photo; no forced ruler. */
export function RootingCheck() {
  const { id } = useParams();
  const p = usePlant(id);
  const nav = useNavigate();
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  if (!p) return null;
  const record = async (state: "none" | "started" | "growing" | "problem") => {
    const first = state !== "none" && state !== "problem" && (p.rootState ?? "none") === "none";
    await recordEvent(p.id, "root_check", { rootState: state });
    if (state !== "problem") await mutate<Plant>("plant", p.id, { rootState: state });
    if (first) await recordEvent(p.id, "milestone", { kind: "first_root" }, { inJournal: true });
    if (state === "problem") { nav(`/diagnose/${p.id}`); return; }
    toast(first ? "שורש ראשון! 🌱" : "נרשם");
    if (state === "growing") setAsk(true); else nav(-1);
  };
  return (
    <Frame title="בדיקת השרשה" plant={p}>
      {!ask ? (
        <>
          <ActionRow icon="root" title="אין שורשים עדיין" onClick={() => record("none")} />
          <ActionRow icon="sprout" title="התחילו שורשים" onClick={() => record("started")} />
          <ActionRow icon="leaf" title="השורשים גדלו" onClick={() => record("growing")} />
          <ActionRow icon="steth" tone="heat" title="משהו לא בסדר" subtitle="השחרה, ריכוך, ריח, הצהבה" onClick={() => record("problem")} />
          {p.propagationMethod?.includes("מים") && <Button variant="secondary" className="w-full" onClick={async () => { await recordEvent(p.id, "water_change", {}); toast("נרשמה החלפת מים"); }}>החלפתי מים</Button>}
          <Button variant="text" className="w-full" onClick={async () => { await postpone(p.id, "rooting_check", 2); nav(-1); }}>לבדוק בעוד יומיים</Button>
          <InfoNote>אין אורך שורש "נכון" אחד — המוכנות תלויה בזן, בשיטה ובמערכת השורשים.</InfoNote>
        </>
      ) : (
        <>
          <p className="text-center text-[18px] text-ink">ההשרשה הסתיימה! מה הסטטוס שלו עכשיו?</p>
          <Button className="w-full" onClick={async () => { await recordEvent(p.id, "propagation_completed", {}); await updatePlant(p, { status: "seedling" }); nav(`/plants/${p.id}`); }}>שתיל</Button>
          <Button variant="secondary" className="w-full" onClick={async () => { await updatePlant(p, { status: "plant" }); nav(`/plants/${p.id}`); }}>צמח</Button>
          <Button variant="text" className="w-full" onClick={() => nav(-1)}>עדיין בהשרשה</Button>
        </>
      )}
    </Frame>
  );
}

/** Germination update: counts on the group card, first sprout milestone, no dead cards. */
export function Germination() {
  const { id } = useParams();
  const p = usePlant(id);
  const nav = useNavigate();
  const toast = useToast();
  const [count, setCount] = useState<string>("");
  if (!p) return null;
  const prev = p.germinatedCount ?? 0;
  return (
    <Frame title="עדכון נביטה" plant={p}>
      <Field label="כמה נבטו עד עכשיו?" hint={p.seedCount ? `מתוך ${p.seedCount} זרעים` : undefined}>
        <Input type="number" inputMode="numeric" min={0} value={count} onChange={(e) => setCount(e.target.value)} placeholder={String(prev)} />
      </Field>
      <Button className="w-full" disabled={count === ""} onClick={async () => {
        const n = Number(count);
        await recordEvent(p.id, "germination_update", { germinated: n, previous: prev }, { inJournal: true });
        await mutate<Plant>("plant", p.id, { germinatedCount: n });
        if (prev === 0 && n > 0) { await recordEvent(p.id, "milestone", { kind: "first_sprout" }, { inJournal: true }); toast("נבט ראשון 🌱"); }
        else toast("נשמר");
        nav(`/plants/${p.id}`);
      }}>שמירה</Button>
      <Button variant="text" className={cx("w-full")} onClick={async () => { await postpone(p.id, "seedling_check", 2); nav(-1); }}>עוד אין שינוי — לבדוק בעוד יומיים</Button>
    </Frame>
  );
}
