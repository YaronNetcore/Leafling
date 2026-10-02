import type { AiResult } from "../data/ai.ts";
import { Icon } from "../ui/icons.tsx";
import { ConfidenceBadge, cx } from "../ui/ui.tsx";

const URGENCY: Record<AiResult["urgency"], { label: string; cls: string } | null> = {
  none: null,
  green: { label: "לא דחוף", cls: "bg-sage text-green" },
  yellow: { label: "כדאי לשים לב", cls: "bg-sun-bg text-soil" },
  orange: { label: "בעיה משמעותית", cls: "bg-[color-mix(in_srgb,var(--problem)_18%,transparent)] text-problem" },
  red: { label: "דחוף", cls: "bg-heat-bg text-urgent" },
};

function Section({ title, items, icon }: { title: string; items: string[]; icon: "search" | "sparkles" | "help" }) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-soft">
      <div className="flex items-center gap-2 text-[16px] font-bold text-ink"><Icon name={icon} size={18} className="text-green" />{title}</div>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-[15px] leading-relaxed text-text">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** Uncertainty is a feature: what I see / what I think / what is missing, with a confidence level. */
export function AiResultView({ r, candidatesTitle = "חלופות" }: { r: AiResult; candidatesTitle?: string }) {
  const u = URGENCY[r.urgency];
  return (
    <div className="rise space-y-3">
      <div className="rounded-card bg-sage/70 p-4">
        <div className="flex flex-wrap items-center gap-2"><ConfidenceBadge value={r.confidence} />{u && <span className={cx("rounded-full px-3 py-1 text-[13px] font-semibold", u.cls)}>{u.label}</span>}</div>
        <p className="mt-3 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{r.answer}</p>
      </div>
      {r.retake_request && <div className="flex gap-3 rounded-card bg-sun-bg p-4 text-[15px] text-ink"><Icon name="camera" className="text-soil" />{r.retake_request}</div>}
      {r.contagious_suspected && <div className="flex gap-3 rounded-card bg-heat-bg p-4 text-[15px] text-ink"><Icon name="info" className="text-heat" />יש חשד לבעיה מדבקת: כדאי לבודד זמנית ולבדוק צמחים שנמצאים לידו.</div>}
      <Section title="מה אני רואה / יודעת" items={r.observed} icon="search" />
      <Section title="מה אני חושבת" items={r.interpretation} icon="sparkles" />
      <Section title="מה חסר" items={r.missing} icon="help" />
      {r.candidates.length > 0 && (
        <div className="rounded-2xl bg-surface p-4 shadow-soft">
          <div className="text-[16px] font-bold text-ink">{candidatesTitle}</div>
          <ul className="mt-2 space-y-2">
            {r.candidates.map((c, i) => (
              <li key={i} className="rounded-xl bg-bg-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[16px] font-semibold text-ink">{c.name_he}{c.scientific && <span className="sci ms-2 text-[14px] font-normal text-muted">{c.scientific}</span>}</span><ConfidenceBadge value={c.confidence} /></div>
                <p className="mt-1 text-[14px] text-muted">{c.why}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="px-1 text-[13px] text-muted">ה-AI לא משנה נתונים. כל פעולה מתבצעת רק באישור שלך.</p>
    </div>
  );
}
