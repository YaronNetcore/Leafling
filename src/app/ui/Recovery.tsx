import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Wordmark } from "./ui.tsx";

// Never a blank page: a visible boot screen while starting, and a Hebrew recovery screen if a screen fails to render.
// Errors are shown generically (no technical details, no personal data); the name goes to the console only.

/** Clears the app's cached code (not the user's data) and reloads — the "outdated version" escape hatch. */
export async function hardReload() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.filter((k) => k.startsWith("leafling-shell-")).map((k) => caches.delete(k)));
  } catch { /* best effort */ }
  location.replace(`/?reload=${Date.now()}`);
}

export function BootScreen({ slow }: { slow?: boolean }) {
  return (
    <main className="safe-top flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center" data-testid="boot-screen">
      <Wordmark />
      <span className="size-7 animate-spin rounded-full border-2 border-green border-t-transparent" aria-hidden />
      <p className="text-[16px] text-muted">{slow ? "החיבור איטי מהרגיל… עוד רגע." : "טוען את הצמחים שלך…"}</p>
      {slow && <Button variant="secondary" onClick={() => void hardReload()}>רענון</Button>}
    </main>
  );
}

export function ErrorScreen({ onRetry, title = "משהו השתבש בתצוגה" }: { onRetry?: () => void; title?: string }) {
  return (
    <main className="safe-top flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center" role="alert" data-testid="error-screen">
      <Wordmark />
      <h1 className="text-[22px] font-bold text-ink">{title}</h1>
      <p className="text-[16px] text-muted">הנתונים שלך שמורים. אפשר לנסות שוב או לרענן את האפליקציה.</p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        {onRetry && <Button onClick={onRetry}>לנסות שוב</Button>}
        <Button variant="secondary" onClick={() => void hardReload()}>רענון האפליקציה</Button>
        <Button variant="text" onClick={() => location.assign("/today")}>חזרה למסך היום</Button>
      </div>
    </main>
  );
}

const isChunkError = (e: unknown) => /dynamically imported module|Importing a module script failed|Failed to fetch|Loading chunk/i.test(String((e as Error)?.message ?? e));

/** Catches render errors of one screen; navigating elsewhere (new key) resets it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("leafling:render_error", (error as Error)?.name ?? "Error", info.componentStack?.split("\n").slice(0, 3).join(" "));
    // Code of an older version that no longer exists on the server → load the current version once.
    if (isChunkError(error) && !sessionStorage.getItem("leafling.chunkReload")) {
      sessionStorage.setItem("leafling.chunkReload", "1");
      void hardReload();
    }
  }
  render() {
    if (this.state.error) return <ErrorScreen onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
