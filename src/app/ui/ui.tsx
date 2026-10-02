import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CONFIDENCE_LABEL, STATUS_LABEL } from "../../shared/domain.ts";
import type { Species } from "../../shared/species.ts";
import type { Confidence, Plant, Status } from "../../shared/types.ts";
import { usePhotoUrl } from "../data/media.ts";
import { Icon, type IconName } from "./icons.tsx";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Buttons ----------
type BtnVariant = "primary" | "secondary" | "outline" | "text" | "danger";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-green text-on-green shadow-soft hover:bg-green-press",
  secondary: "bg-sage text-green hover:bg-sage-strong",
  outline: "bg-surface text-ink border border-line shadow-soft",
  text: "bg-transparent text-green",
  danger: "bg-transparent text-urgent border border-urgent/40",
};
export function Button({ variant = "primary", icon, trailing, loading, size = "lg", className, children, ...rest }:
  { variant?: BtnVariant; icon?: IconName; trailing?: IconName; loading?: boolean; size?: "lg" | "md" | "sm" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sz = size === "lg" ? "min-h-14 px-6 text-[17px]" : size === "md" ? "min-h-12 px-5 text-[16px]" : "min-h-10 px-4 text-[15px]";
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={cx("pressable inline-flex items-center justify-center gap-2 rounded-full font-semibold disabled:opacity-50", sz, BTN[variant], className)}>
      {loading ? <span className="size-5 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden /> : icon ? <Icon name={icon} size={22} /> : null}
      <span className="flex-1 text-center">{children}</span>
      {trailing ? <Icon name={trailing} size={20} /> : null}
    </button>
  );
}

export function IconButton({ icon, label, className, filled, ...rest }: { icon: IconName; label: string; filled?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label={label} title={label} {...rest}
      className={cx("pressable grid size-11 shrink-0 place-items-center rounded-full", filled ? "bg-green text-on-green shadow-soft" : "bg-surface/90 text-ink shadow-soft backdrop-blur", className)}>
      <Icon name={icon} size={22} />
    </button>
  );
}

export function BackButton({ to, className }: { to?: string; className?: string }) {
  const nav = useNavigate();
  return <IconButton icon="back" label="חזרה" className={className} onClick={() => (to ? nav(to) : history.length > 1 ? nav(-1) : nav("/today"))} />;
}

// ---------- Surfaces ----------
export function Card({ className, children, onClick, as = "div" }: { className?: string; children: ReactNode; onClick?: () => void; as?: "div" | "button" }) {
  const Tag = as;
  return <Tag onClick={onClick} className={cx("rounded-card bg-surface shadow-soft", onClick && "pressable text-start w-full", className)}>{children}</Tag>;
}

export function SoftCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-card bg-sage/70 p-4", className)}>{children}</div>;
}

// ---------- Chips & tabs ----------
export function Chip({ selected, children, onClick, icon, className }: { selected?: boolean; children: ReactNode; onClick?: () => void; icon?: IconName; className?: string }) {
  return (
    <button onClick={onClick} aria-pressed={selected}
      className={cx("pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] font-medium",
        selected ? "bg-green text-on-green shadow-soft" : "bg-surface text-ink shadow-soft", className)}>
      {icon && <Icon name={icon} size={18} />}{children}
    </button>
  );
}

export function TabRow<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: IconName }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
      {tabs.map((t) => <Chip key={t.id} selected={t.id === value} icon={t.icon} onClick={() => onChange(t.id)}>{t.label}</Chip>)}
    </div>
  );
}

// ---------- Brand & decoration ----------
export function Wordmark({ className }: { className?: string }) {
  return <img src="/img/deco/wordmark.webp" alt="Leafling" className={cx("brand-img h-11 w-auto select-none", className)} draggable={false} />;
}

export function LeafCorner({ side = "start", className }: { side?: "start" | "end"; className?: string }) {
  return (
    <img src="/img/deco/leaves-bottom-left.webp" alt="" aria-hidden draggable={false}
      className={cx("deco pointer-events-none absolute bottom-0 w-36 select-none opacity-90", side === "end" ? "end-0" : "start-0 -scale-x-100", className)} />
  );
}

/** Simple vector sprig used as a light decorative accent. */
export function Sprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={cx("pointer-events-none select-none", className)} aria-hidden>
      <path d="M20 110 C40 80 60 60 100 20" stroke="var(--leaf)" strokeWidth="3" fill="none" strokeLinecap="round" />
      {[[38, 86, -30], [52, 70, 20], [64, 58, -35], [78, 44, 25], [90, 30, -30]].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx="12" ry="5.5" fill="var(--leaf)" opacity={0.75 - i * 0.06} transform={`rotate(${r} ${x} ${y})`} />
      ))}
    </svg>
  );
}

export function PageHeader({ title, subtitle, start, end, logo = true }: { title: string; subtitle?: string; start?: ReactNode; end?: ReactNode; logo?: boolean }) {
  return (
    <header className="safe-top relative px-4 pb-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex w-11 justify-start">{start}</div>
        {logo ? <Wordmark /> : <div />}
        <div className="flex w-11 justify-end">{end}</div>
      </div>
      <h1 className="mt-3 text-center text-[30px] font-bold leading-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1 text-center text-[16px] text-muted">{subtitle}</p>}
    </header>
  );
}

// ---------- Plant imagery ----------
export function PlantImage({ plant, species, variant = "thumb", className, rounded = "rounded-2xl" }:
  { plant?: Pick<Plant, "mainPhotoId"> | null; species?: Species; variant?: "thumb" | "display"; className?: string; rounded?: string }) {
  const url = usePhotoUrl(plant?.mainPhotoId, variant);
  const src = url ?? species?.image ?? null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className={cx("grid place-items-center bg-gradient-to-br from-sage to-sage-strong text-green", rounded, className)} aria-hidden>
        <Icon name="sprout" size={44} strokeWidth={1.5} />
      </div>
    );
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={cx("object-cover", rounded, className)} />;
}

export function SpeciesImage({ species, className }: { species?: Species; className?: string }) {
  return <PlantImage plant={null} species={species} className={className} />;
}

// ---------- Badges ----------
const STATUS_STYLE: Record<Status, string> = {
  plant: "bg-sage text-green", seedling: "bg-sun-bg text-soil", rooting: "bg-water-bg text-water", sick: "bg-heat-bg text-heat",
};
export function StatusBadge({ status }: { status: Status }) {
  return <span className={cx("inline-flex items-center rounded-full px-3 py-1 text-[13px] font-semibold", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}

const CONF_ICON: Record<Confidence, string> = { known: "●●●", likely: "●●○", possible: "●○○", insufficient: "○○○" };
export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium text-ink">
      <span aria-hidden className="tracking-[-0.15em] text-green">{CONF_ICON[value]}</span>ביטחון: {CONFIDENCE_LABEL[value]}
    </span>
  );
}

export function InfoNote({ icon = "leaf", title, children, className }: { icon?: IconName; title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex gap-3 rounded-card bg-sage/70 p-4", className)}>
      <div className="grid size-11 shrink-0 place-items-center rounded-full bg-surface/70 text-green"><Icon name={icon} /></div>
      <div className="text-[15px] leading-relaxed">
        {title && <div className="font-semibold text-ink">{title}</div>}
        <div className="text-muted">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rise flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-4 grid size-28 place-items-center rounded-full bg-sage text-green"><Icon name="sprout" size={56} strokeWidth={1.4} /></div>
      <h2 className="text-[21px] font-bold text-ink">{title}</h2>
      {text && <p className="mt-2 max-w-xs text-[16px] leading-relaxed text-muted">{text}</p>}
      {action && <div className="mt-6 w-full max-w-xs">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[19px] font-bold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function IconBubble({ icon, tone = "sage", size = 48 }: { icon: IconName; tone?: "sage" | "water" | "sun" | "soil" | "heat"; size?: number }) {
  const tones = { sage: "bg-sage text-green", water: "bg-water-bg text-water", sun: "bg-sun-bg text-sun", soil: "bg-soil-bg text-soil", heat: "bg-heat-bg text-heat" };
  return <div className={cx("grid shrink-0 place-items-center rounded-full", tones[tone])} style={{ width: size, height: size }}><Icon name={icon} size={Math.round(size * 0.5)} /></div>;
}

// ---------- Forms ----------
export function Field({ label, optional, children, hint }: { label: string; optional?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-[15px] font-semibold text-ink">{label}{optional && <span className="font-normal text-muted"> (אופציונלי)</span>}</span>
      {children}
      {hint && <span className="mt-1 block px-1 text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

export function Input({ icon, className, ...rest }: { icon?: IconName } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 shadow-soft">
      {icon && <Icon name={icon} className="shrink-0 text-green-soft" />}
      <input {...rest} className={cx("min-w-0 flex-1 bg-transparent py-3 text-[17px] text-ink outline-none placeholder:text-muted", className)} />
    </div>
  );
}

export function Select({ icon, children, ...rest }: { icon?: IconName } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 shadow-soft">
      {icon && <Icon name={icon} className="shrink-0 text-green-soft" />}
      <select {...rest} className="min-w-0 flex-1 appearance-none bg-transparent py-3 text-[17px] text-ink outline-none">{children}</select>
      <Icon name="down" size={20} className="pointer-events-none shrink-0 text-muted" />
    </div>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("w-full rounded-2xl bg-surface p-4 text-[17px] text-ink shadow-soft outline-none placeholder:text-muted", props.className)} />;
}

// ---------- Bottom sheet ----------
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="סגירה" className="fade-in absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="sheet-in relative max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-bg px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 shadow-lift">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" aria-hidden />
        {title && <h2 className="mb-4 text-center text-[21px] font-bold text-ink">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function ActionRow({ icon, title, subtitle, onClick, tone = "sage", trailing = true }:
  { icon: IconName; title: string; subtitle?: string; onClick?: () => void; tone?: "sage" | "water" | "sun" | "soil" | "heat"; trailing?: boolean }) {
  return (
    <button onClick={onClick} className="pressable flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-start shadow-soft">
      <IconBubble icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-semibold text-ink">{title}</div>
        {subtitle && <div className="text-[14px] leading-snug text-muted">{subtitle}</div>}
      </div>
      {trailing && <Icon name="forward" size={20} className="shrink-0 text-muted" />}
    </button>
  );
}

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2600); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div role="status" className="rise fixed inset-x-4 top-[max(env(safe-area-inset-top),12px)] z-[60] mx-auto max-w-md rounded-2xl bg-ink px-4 py-3 text-center text-[15px] font-medium text-bg shadow-lift">{msg}</div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
