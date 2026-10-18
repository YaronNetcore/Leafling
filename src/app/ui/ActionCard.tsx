import { useState } from "react";
import { ACTION_LABEL, SOIL_LABEL, type ActionProposal } from "../../shared/actions.ts";
import { aiErrorText } from "../data/ai.ts";
import { cancelProposal, confirmProposal } from "../data/actions.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Button, cx } from "./ui.tsx";

// The confirmation card of an AI Botanist action ("זיהיתי עדכון ל־12 צמחים 🌿"). Nothing is written before
// "אישור ושמירה"; the list can be shown and edited (individual plants removed) first. The card's state comes from
// the server-written message, so it is the same after a reload or on another device.

const ICON: Record<ActionProposal["action"], IconName> = { water: "drop", fertilize: "flask", soil_check: "drop", treatment: "steth", move: "move", reminder: "bell", note: "edit" };
const NOTE: Record<string, string> = { already_recorded: "כבר נרשם באותו יום", already_there: "כבר שם", excluded: "הוצא מהרשימה" };
const fmt = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });

export function ActionCard({ p }: { p: ActionProposal }) {
  const [sel, setSel] = useState(() => new Set(p.targets.filter((t) => t.selected).map((t) => t.plantId)));
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState(false);
  const [followUp, setFollowUp] = useState(Boolean(p.followUp));
  const [busy, setBusy] = useState<null | "save" | "cancel">(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const status = result ? "done" : cancelled ? "cancelled" : p.status;
  if (status === "superseded") return <p className="me-auto px-2 text-[13px] text-muted" data-testid="action-status">ההצעה עודכנה — ראו למטה.</p>;
  if (status === "cancelled") return <p className="me-auto px-2 text-[13px] text-muted" data-testid="action-status">בוטל — לא נשמר דבר.</p>;
  if (status === "done" || status === "partial") {
    const saved = Object.values(p.results ?? {}).filter((x) => x === "saved").length;
    return (
      <p className="me-auto flex items-center gap-1.5 px-2 text-[13px] font-semibold text-green" data-testid="action-status">
        <Icon name="check" size={16} />{result ?? `${saved === 1 ? "נשמר לצמח אחד" : `נשמר ל־${saved} צמחים`}${status === "partial" ? " · חלק לא נשמרו" : ""}`}
      </p>
    );
  }

  const resume = p.status === "executing"; // saving started (e.g. app closed midway) — continue the same selection
  const n = resume ? p.confirmedIds?.length ?? 0 : sel.size;
  const save = async () => {
    setBusy("save"); setError(null);
    try {
      const r = await confirmProposal(p, resume ? null : p.targets.filter((t) => sel.has(t.plantId)).map((t) => t.plantId), followUp, (d, t) => setProgress([d, t]));
      setResult(r.message ?? "נשמר");
    } catch (e) {
      const code = (e as { code?: string }).code ?? "network";
      setError(code === "proposal_changed" || code === "proposal_closed" ? "ההצעה השתנתה בינתיים — אפשר לרענן ולנסות שוב." : code === "save_failed" ? "חלק מהשמירה לא הסתיים. מה שנשמר נשאר שמור — אפשר לנסות שוב." : aiErrorText(code));
    } finally { setBusy(null); }
  };
  const cancel = async () => {
    setBusy("cancel"); setError(null);
    try { await cancelProposal(p); setCancelled(true); } catch { setError("לא הצלחתי לבטל — נסי שוב."); } finally { setBusy(null); }
  };

  const rows: [string, string][] = [
    ["פעולה", p.action === "soil_check" ? `${ACTION_LABEL.soil_check} · ${SOIL_LABEL[p.details.soil ?? "slightly_moist"]}` : ACTION_LABEL[p.action]],
    [p.action === "reminder" ? "מתי" : "תאריך", p.dateLabel],
  ];
  if (p.details.product) rows.push(["חומר", p.details.productActive ? `${p.details.product} · ${p.details.productActive}` : p.details.product]);
  if (p.details.pest) rows.push(["בעיה", `${p.details.pest} · דיווח שלך, לא אומת`]);
  if (p.details.toLocationName) rows.push(["לאן", p.details.toLocationName]);
  if (p.details.reminderText) rows.push(["תזכורת", p.details.reminderText]);
  if (p.details.note) rows.push(["הערה", p.details.note]);

  return (
    <section data-testid="action-card" aria-label="אישור עדכון" className="me-auto w-[92%] rounded-3xl border border-line bg-surface p-4 shadow-soft">
      <h3 className="flex items-center gap-2 text-[17px] font-bold text-ink">
        <span className="grid size-9 place-items-center rounded-full bg-sage text-green"><Icon name={ICON[p.action]} size={19} /></span>
        <span data-testid="action-title">{n === 1 ? "זיהיתי עדכון לצמח אחד 🌿" : `זיהיתי עדכון ל־${n} צמחים 🌿`}</span>
      </h3>
      <dl className="mt-3 space-y-1.5 text-[15px]">
        {rows.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-16 shrink-0 text-muted">{k}</dt><dd className="min-w-0 flex-1 text-ink">{v}</dd></div>)}
      </dl>
      {p.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-2xl bg-sun-bg p-3 text-[14px] leading-snug text-ink" data-testid="action-warning">
          {p.warnings.map((w) => <li key={w} className="flex gap-1.5"><span aria-hidden>⚠️</span><span>{w}</span></li>)}
        </ul>
      )}
      {p.followUp && !resume && (
        <label className="mt-3 flex items-start gap-2 text-[15px] text-ink">
          <input type="checkbox" data-testid="action-followup" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="mt-1 size-5 accent-[var(--green)]" />
          <span>להוסיף תזכורת ל{p.followUp.text} ב־{fmt(p.followUp.dueAt)} <span className="text-muted">(בדיקה בלבד — לא ריסוס חוזר)</span></span>
        </label>
      )}

      {(show || edit) && !resume && (
        <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto" data-testid="action-plants">
          {p.targets.map((t) => {
            const on = sel.has(t.plantId);
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-[15px] font-semibold", on ? "text-ink" : "text-muted line-through")}>{t.name}</span>
                  <span className="block truncate text-[12px] text-muted">{[t.sub, t.location, !on && t.note ? NOTE[t.note] : null].filter(Boolean).join(" · ")}</span>
                </span>
              </>
            );
            return (
              <li key={t.plantId}>
                {edit ? (
                  <label className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2" data-testid="action-plant" data-plant-id={t.plantId}>
                    <input type="checkbox" checked={on} aria-label={t.name} className="size-5 accent-[var(--green)]"
                      onChange={() => setSel((s) => { const x = new Set(s); if (x.has(t.plantId)) x.delete(t.plantId); else x.add(t.plantId); return x; })} />
                    {body}
                  </label>
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2" data-testid="action-plant" data-plant-id={t.plantId}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p role="alert" className="mt-3 text-[14px] text-heat" data-testid="action-error">{error}</p>}
      {busy === "save" && progress && progress[1] > 1 && <p className="mt-3 text-[14px] text-muted" data-testid="action-progress">שומרת… {progress[0]} מתוך {progress[1]}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {!resume && <Button size="sm" variant="secondary" data-testid="action-show" aria-expanded={show} onClick={() => { setShow(!show); setEdit(false); }}>{show && !edit ? "הסתרת הצמחים" : "הצגת הצמחים"}</Button>}
        {!resume && <Button size="sm" variant="secondary" data-testid="action-edit" aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? "סיום עריכה" : "עריכת הרשימה"}</Button>}
        <Button size="md" icon="check" className="col-span-2" data-testid="action-confirm" disabled={!n || busy !== null} loading={busy === "save"} onClick={() => void save()}>
          {resume ? "להמשיך בשמירה" : "אישור ושמירה"}
        </Button>
        {!resume && <Button size="sm" variant="text" className="col-span-2" data-testid="action-cancel" disabled={busy !== null} onClick={() => void cancel()}>ביטול</Button>}
      </div>
    </section>
  );
}
