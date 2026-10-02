import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { onSync, type SyncState } from "../data/sync.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Sheet, cx } from "./ui.tsx";

// Exactly five tabs, in this order (RTL: first tab is on the right). Diagnose is not a tab.
const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: "/today", label: "היום", icon: "leaf" },
  { to: "/find", label: "מצא צמח", icon: "search" },
  { to: "/plants", label: "הצמחים שלי", icon: "pot" },
  { to: "/locations", label: "המיקומים שלי", icon: "pin" },
  { to: "/tools", label: "כלים", icon: "tools" },
];

export function BottomNav() {
  return (
    <nav aria-label="ניווט ראשי" className="fixed inset-x-0 bottom-0 z-40 rounded-t-[28px] bg-surface/95 shadow-lift backdrop-blur-md safe-bottom">
      <ul className="mx-auto grid max-w-xl grid-cols-5 px-1 pt-2 pb-1">
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink to={t.to} className={({ isActive }) => cx("pressable mx-auto flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[12px] font-medium",
              isActive ? "bg-sage text-green" : "text-muted")}>
              {({ isActive }) => (<><Icon name={t.icon} size={24} strokeWidth={isActive ? 2.1 : 1.8} /><span className="whitespace-nowrap">{t.label}</span></>)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Floating + with exactly two actions: plant identification and AI Botanist. */
export function Fab() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <>
      <button aria-label="פעולות מהירות: זיהוי צמח או הבוטנאי" onClick={() => setOpen(true)}
        className="pressable fixed end-4 z-40 grid size-14 place-items-center rounded-full bg-green text-on-green shadow-lift"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 92px)" }}>
        <Icon name="plus" size={28} strokeWidth={2.2} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "זיהוי צמח", sub: "צילום או תמונה מהגלריה", icon: "camera" as const, to: "/identify" },
            { label: "AI Botanist", sub: "לשאול על צמח", icon: "sparkles" as const, to: "/botanist" },
          ].map((a) => (
            <button key={a.to} onClick={() => { setOpen(false); nav(a.to); }} className="pressable flex flex-col items-center gap-2 rounded-card bg-surface p-5 text-center shadow-soft">
              <div className="grid size-14 place-items-center rounded-full bg-sage text-green"><Icon name={a.icon} size={28} /></div>
              <div className="text-[17px] font-semibold text-ink">{a.label}</div>
              <div className="text-[13px] text-muted">{a.sub}</div>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

export function SyncBanner() {
  const [s, setS] = useState<SyncState>({ status: "idle", pending: 0 });
  useEffect(() => onSync(setS), []);
  if (s.status === "needs-login") {
    return (
      <div className="fixed inset-x-3 top-[max(env(safe-area-inset-top),8px)] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-surface p-3 shadow-lift">
        <Icon name="cloud" className="text-green" />
        <div className="flex-1 text-[14px] leading-snug"><b className="text-ink">צריך להתחבר מחדש</b><br /><span className="text-muted">השינויים שלך שמורים במכשיר ({s.pending}) ויסונכרנו אחרי ההתחברות.</span></div>
        <button className="pressable rounded-full bg-green px-4 py-2 text-[14px] font-semibold text-on-green" onClick={() => { location.href = `/?reauth=${Date.now()}`; }}>התחברות</button>
      </div>
    );
  }
  if ((s.status === "offline" || s.status === "error") && s.pending > 0) {
    return (
      <div className="fixed inset-x-3 top-[max(env(safe-area-inset-top),8px)] z-50 mx-auto max-w-md rounded-full bg-surface px-4 py-2 text-center text-[13px] text-muted shadow-soft">
        נשמר במכשיר · {s.pending} שינויים ממתינים לסנכרון
      </div>
    );
  }
  return null;
}

const TOP_LEVEL = new Set(["/today", "/find", "/plants", "/locations", "/tools"]);

export function MainLayout() {
  const { pathname } = useLocation();
  return (
    <div className="pb-nav min-h-dvh">
      <SyncBanner />
      <Outlet />
      {TOP_LEVEL.has(pathname) && <Fab />}
      <BottomNav />
    </div>
  );
}
