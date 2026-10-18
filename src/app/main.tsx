import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { bootIdentity } from "./data/identity.ts";
import { uploadPending } from "./data/media.ts";
import { onSync, startSyncLoop } from "./data/sync.ts";
import { BootScreen, ErrorBoundary, ErrorScreen } from "./ui/Recovery.tsx";
import { Button, ToastProvider, Wordmark } from "./ui/ui.tsx";
import "./styles.css";

// Identity first: the server says who is signed in; only then is that user's own local database opened.
const root = createRoot(document.getElementById("root")!);
(window as unknown as { __leaflingMounted?: boolean }).__leaflingMounted = true;
// Something is visible from the first frame; if starting takes long, say so (with a refresh button).
root.render(<BootScreen />);
const slow = setTimeout(() => root.render(<BootScreen slow />), 12_000);
void bootIdentity().then((boot) => {
  clearTimeout(slow);
  if (boot.kind === "signin") {
    root.render(
      <main className="safe-top flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
        <Wordmark />
        <p className="text-[16px] text-muted">כדי להיכנס צריך חיבור לאינטרנט. אחרי הכניסה הראשונה הנתונים שלך זמינים גם בלי חיבור.</p>
        <Button onClick={() => { location.href = `/?reauth=${Date.now()}`; }}>כניסה</Button>
      </main>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
  startSyncLoop();
  onSync((s) => { if (s.status === "idle") void uploadPending(); });
}).catch(() => {
  clearTimeout(slow);
  root.render(<ErrorScreen title="לא הצלחנו לפתוח את Leafling" onRetry={() => location.reload()} />);
});

// The service worker is versioned per build; a new version takes over on the next launch
// and removes older caches (including the Phase 0 harness cache), so the phone never
// keeps showing an outdated design.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // Reload only when a NEW version replaces one that already controlled this page — not on the very
  // first install (clients.claim() would otherwise reload the page at a random moment).
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "activated" && hadController) location.reload(); });
    });
    void reg.update();
  }).catch(() => undefined);
}
