import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { bootIdentity } from "./data/identity.ts";
import { uploadPending } from "./data/media.ts";
import { onSync, startSyncLoop } from "./data/sync.ts";
import { Button, ToastProvider, Wordmark } from "./ui/ui.tsx";
import "./styles.css";

// Identity first: the server says who is signed in; only then is that user's own local database opened.
const root = createRoot(document.getElementById("root")!);
void bootIdentity().then((boot) => {
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
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </StrictMode>,
  );
  startSyncLoop();
  onSync((s) => { if (s.status === "idle") void uploadPending(); });
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
