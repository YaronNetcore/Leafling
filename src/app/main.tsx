import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { uploadPending } from "./data/media.ts";
import { onSync, startSyncLoop } from "./data/sync.ts";
import { ToastProvider } from "./ui/ui.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
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

// The service worker is versioned per build; a new version takes over on the next launch
// and removes older caches (including the Phase 0 harness cache), so the phone never
// keeps showing an outdated design.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "activated" && navigator.serviceWorker.controller) location.reload(); });
    });
    void reg.update();
  }).catch(() => undefined);
}
