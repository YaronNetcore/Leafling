import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ACTION_LABEL, DESTRUCTIVE, SOIL_LABEL, isRecordKind, type ActionProposal } from "../../shared/actions.ts";
import { aiErrorText } from "../data/ai.ts";
import { cancelProposal, confirmProposal, requestUndo } from "../data/actions.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Button, cx } from "./ui.tsx";

// The confirmation card of an AI Botanist action ("זיהיתי עדכון ל־12 צמחים 🌿"). Nothing is written before
// "אישור ושמירה"; the list can be shown and edited (individual plants removed) first. The card's state comes from
// the server-written message, so it is the same after a reload or on another device.

const ICON: Record<ActionProposal["action"], IconName> = {
  water: "drop", fertilize: "flask", soil_check: "drop", treatment: "steth", move: "move", reminder: "bell", note: "edit",
  resolve_issue: "check", remove_issue: "trash", delete_records: "trash", redate_records: "calendar", edit_records: "edit", cancel_reminders: "bell", redate_reminders: "calendar", undo: "refresh",
};
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
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [undoState, setUndoState] = useState<null | "busy" | "asked" | string>(null);
  const nav = useNavigate();
  const records = isRecordKind(p.action);
  const askUndo = async () => {
    setUndoState("busy");
    try { await requestUndo(p); setUndoState("asked"); } catch (e) { setUndoState((e as Error).message === "already_undone" ? "הפעולה כבר בוטלה." : "לא הצלחתי להכין ביטול — נסי שוב."); }
  };

  const status = result ? "done" : cancelled ? "cancelled" : p.status;
  if (status === "superseded") return <p className="me-auto px-2 text-[13px] text-muted" data-testid="action-status">ההצעה עודכנה — ראו למטה.</p>;
  if (status === "cancelled") return <p className="me-auto px-2 text-[13px] text-muted" data-testid="action-status">בוטל — לא נשמר דבר.</p>;
  if (status === "done" || status === "partial") {
    const saved = savedCount ?? Object.values(p.results ?? {}).filter((x) => x === "saved").length;
    return (
      <div className="me-auto space-y-1.5 px-2">
        <p className={cx("flex items-center gap-1.5 text-[13px] font-semibold", saved ? "text-green" : "text-heat")} data-testid="action-status">
          <Icon name={saved ? "check" : "info"} size={16} />{result ?? (!saved ? (records ? "לא שונה אף רישום" : "לא נשמר אף צמח") : records ? `${ACTION_LABEL[p.action]} בוצע${saved > 1 ? ` ב־${saved} צמחים` : ""}` : `${saved === 1 ? "נשמר לצמח אחד" : `נשמר ל־${saved} צמחים`}${status === "partial" ? " · חלק לא נשמרו" : ""}`)}
        </p>
        <div className="flex flex-wrap gap-2">
          {saved > 0 && <Button size="sm" variant="secondary" icon="leaf" data-testid="action-view" onClick={() => nav(`/updates/${p.id}`)}>צפייה בצמחים שעודכנו</Button>}
          {saved > 0 && !p.undoneBy && undoState !== "asked" && <Button size="sm" variant="text" icon="refresh" data-testid="action-undo" disabled={undoState === "busy"} onClick={() => void askUndo()}>ביטול הפעולה</Button>}
        </div>
        {p.undoneBy && <p className="text-[13px] text-muted" data-testid="action-undone">הפעולה הזו בוטלה.</p>}
        {undoState === "asked" && <p className="text-[13px] text-muted">הכנתי כרטיס ביטול למטה — שום דבר לא ישתנה לפני האישור.</p>}
        {undoState && undoState !== "busy" && undoState !== "asked" && <p className="text-[13px] text-heat" role="alert">{undoState}</p>}
      </div>
    );
  }

  const resume = p.status === "executing"; // saving started (e.g. app closed midway) — continue the same selection
  const n = resume ? p.confirmedIds?.length ?? 0 : sel.size;
  const save = async () => {
    setBusy("save"); setError(null);
    try {
      const r = await confirmProposal(p, resume ? null : p.targets.filter((t) => sel.has(t.plantId)).map((t) => t.plantId), followUp, (d, t) => setProgress([d, t]));
      // Only what the server reports as committed: the message and count come from the execute response.
      setSavedCount(Object.values(r.results).filter((x) => x === "saved").length);
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

  const nRecords = p.targets.filter((t) => sel.has(t.plantId)).reduce((k, t) => k + (t.records?.length ?? 0), 0);
  const rows: [string, string][] = records ? [["פעולה", ACTION_LABEL[p.action]]] : [
    ["פעולה", p.action === "soil_check" ? `${ACTION_LABEL.soil_check} · ${SOIL_LABEL[p.details.soil ?? "slightly_moist"]}` : ACTION_LABEL[p.action]],
    [p.action === "reminder" ? "מתי" : "תאריך", p.dateLabel],
  ];
  if (records && p.details.recordsLabel && p.action !== "undo") rows.push(["מה", p.details.recordsLabel]);
  if (records && p.action === "undo") rows.push(["מה", p.details.undoTitle ?? ""]);
  if (records && p.details.newDateLabel) rows.push([p.action === "redate_reminders" ? "מועד חדש" : "תאריך נכון", p.details.newDateLabel]);
  if (records && p.details.newProduct) rows.push(["חומר נכון", p.details.newProduct]);
  if (records && p.details.newPest) rows.push(["בעיה נכונה", p.details.newPest]);
  if (records) rows.push(["רישומים", `${nRecords} ב־${n === 1 ? "צמח אחד" : `${n} צמחים`}`]);
  if (p.details.product) rows.push(["חומר", p.details.productActive ? `${p.details.product} · ${p.details.productActive}` : p.details.product]);
  if (p.details.pest && !records) rows.push(["בעיה", `${p.details.pest} · דיווח שלך, לא אומת`]);
  if (p.details.toLocationName) rows.push(["לאן", p.details.toLocationName]);
  if (p.details.reminderText) rows.push(["תזכורת", p.details.reminderText]);
  if (p.details.note) rows.push(["הערה", p.details.note]);

  return (
    <section data-testid="action-card" data-action={p.action} aria-label="אישור עדכון" className={cx("me-auto w-[92%] rounded-3xl border bg-surface p-4 shadow-soft", DESTRUCTIVE.includes(p.action) ? "border-urgent/40" : "border-line")}>
      <h3 className="flex items-center gap-2 text-[17px] font-bold text-ink">
        <span className={cx("grid size-9 place-items-center rounded-full", DESTRUCTIVE.includes(p.action) ? "bg-sun-bg text-urgent" : "bg-sage text-green")}><Icon name={ICON[p.action]} size={19} /></span>
        <span data-testid="action-title">{records ? (p.action === "undo" ? `ביטול פעולה: ${nRecords} רישומים` : `${ACTION_LABEL[p.action]}: ${nRecords === 1 ? "רישום אחד" : `${nRecords} רישומים`} ב־${n === 1 ? "צמח אחד" : `${n} צמחים`}`) : n === 1 ? "זיהיתי עדכון לצמח אחד 🌿" : `זיהיתי עדכון ל־${n} צמחים 🌿`}</span>
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
                  {t.records?.map((r) => <span key={`${r.entity}${r.id}`} data-testid="action-record" className={cx("block text-[13px] leading-snug", on ? "text-text" : "text-muted line-through")}>• {r.label}</span>)}
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
          {resume ? "להמשיך בשמירה" : DESTRUCTIVE.includes(p.action) ? "אישור ומחיקה" : "אישור ושמירה"}
        </Button>
        {!resume && <Button size="sm" variant="text" className="col-span-2" data-testid="action-cancel" disabled={busy !== null} onClick={() => void cancel()}>ביטול</Button>}
      </div>
    </section>
  );
}
