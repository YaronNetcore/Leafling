import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { actionTitle, affectedPlants } from "../../shared/actions.ts";
import { isOpenCase } from "../../shared/domain.ts";
import type { ChatMessage, Plant } from "../../shared/types.ts";
import { db } from "../data/db.ts";
import { speciesOf } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { BackButton, Card, EmptyState, PlantImage, cx } from "../ui/ui.tsx";

export { actionTitle };

// "צפייה בצמחים שעודכנו": the plants of one confirmed AI Botanist card, checked against the records actually on
// this device (events, health cases, reminders) — not the chat text. One entry per bulk action (Today lists the
// recent ones), each plant opens its own page.

/** Confirmed bulk cards (≥ 1 saved plant), newest first. */
export const useActionCards = () => useLiveQuery(async () => (await db.messages.toArray())
  .filter((m) => !m.deletedAt && m.proposal && (m.proposal.status === "done" || m.proposal.status === "partial") && Object.values(m.proposal.results ?? {}).includes("saved"))
  .sort((a, b) => (b.proposal!.finishedAt ?? b.at).localeCompare(a.proposal!.finishedAt ?? a.at)), [], undefined as ChatMessage[] | undefined);

export function ActionUpdates() {
  const { id } = useParams();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const m = id ? await db.messages.get(id) : undefined;
    if (!m?.proposal) return { m: null };
    const ids = m.proposal.confirmedIds ?? [];
    const [plants, events, cases, reminders] = await Promise.all([
      db.plants.bulkGet(ids), db.events.where("plantId").anyOf(ids).toArray(), db.health.where("plantId").anyOf(ids).toArray(), db.reminders.where("plantId").anyOf(ids).toArray(),
    ]);
    return { m, rows: affectedPlants(m.proposal, plants.filter((x): x is Plant => Boolean(x)), events, cases, reminders) };
  }, [id]);

  if (data === undefined) return <div className="p-6"><div className="skeleton h-60 rounded-card" /></div>;
  if (!data.m?.proposal) return <EmptyState title="העדכון לא נמצא" text="ייתכן שהוא עוד לא סונכרן למכשיר הזה." />;
  const p = data.m.proposal;
  const rows = data.rows!;
  const saved = rows.filter((r) => r.result === "saved");
  const stored = saved.filter((r) => (r.event || (p.action === "reminder" && r.reminder)));
  return (
    <div className="safe-top px-4 pb-10">
      <div className="flex items-center gap-2 py-2"><BackButton /><h1 className="text-[22px] font-bold text-ink">{actionTitle(p)}</h1></div>
      <Card className="p-4" >
        <div className="text-[15px] text-ink" data-testid="updates-summary">{p.dateLabel.split(" · ")[1] ?? p.day} · {saved.length === 1 ? "צמח אחד עודכן" : `${saved.length} צמחים עודכנו`}{p.details.product ? ` · ${p.details.product}` : ""}</div>
        {stored.length < saved.length && <p className="mt-1 text-[14px] text-muted">{saved.length - stored.length} עוד לא סונכרנו למכשיר הזה — הם יופיעו בסנכרון הבא.</p>}
        {p.followUpChosen && p.followUp && <p className="mt-1 text-[14px] text-muted">תזכורת לבדיקה חוזרת ב־{new Date(p.followUp.dueAt).toLocaleDateString("he-IL")} — בדיקה בלבד, לא ריסוס חוזר.</p>}
      </Card>
      <ul className="mt-3 space-y-2" data-testid="updates-list">
        {rows.map((r) => (
          <li key={r.plantId}>
            <button data-testid="updates-plant" data-plant-id={r.plantId} disabled={!r.plant} onClick={() => nav(`/plants/${r.plantId}?tab=${p.action === "treatment" ? "health" : "history"}`)}
              className="pressable flex w-full items-center gap-3 rounded-2xl bg-surface p-2.5 text-start shadow-soft disabled:opacity-60">
              {r.plant ? <PlantImage plant={r.plant} species={speciesOf(r.plant)} className="size-14 shrink-0" /> : <span className="size-14 shrink-0 rounded-2xl bg-surface-2" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-bold text-ink">{r.name}</span>
                <span className="mt-0.5 flex flex-wrap gap-1.5 text-[12px]">
                  {r.result === "saved" && (r.event || r.reminder) && <span className="rounded-full bg-sage px-2 py-0.5 font-semibold text-green">✓ נשמר {r.event ? new Date(r.event.occurredAt).toLocaleDateString("he-IL") : ""}</span>}
                  {r.result === "saved" && !(r.event || r.reminder) && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">ממתין לסנכרון</span>}
                  {r.result === "failed" && <span className="rounded-full bg-sun-bg px-2 py-0.5 text-ink">לא נשמר</span>}
                  {r.result === "skipped" && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">דולג</span>}
                  {r.issue && <span className={cx("rounded-full px-2 py-0.5", isOpenCase(r.issue) ? "bg-sun-bg text-ink" : "bg-surface-2 text-muted")}>{isOpenCase(r.issue) ? `בעיה פעילה: ${r.issue.title}` : "הבעיה סומנה כפתורה"}</span>}
                  {r.reminder && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">{r.reminder.active ? `תזכורת ${new Date(r.reminder.nextAt).toLocaleDateString("he-IL")}` : "תזכורת בוצעה"}</span>}
                </span>
              </span>
              <Icon name="back" size={18} className="text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
