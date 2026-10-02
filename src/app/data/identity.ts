import { importLegacyLocalDb, openUserDb } from "./db.ts";

// Boot-time identity. The server is the only authority on who is signed in (/api/v1/me returns the
// internal user id derived from the verified Access identity). The browser only remembers the last
// confirmed user id so the app can still open offline — and forgets it on explicit sign-out, so a
// signed-out device never shows the previous user's local data.

const LAST_USER = "leafling.lastUser";
export type Boot =
  | { kind: "ready"; userId: string; email?: string; online: boolean }
  | { kind: "signin" } // no confirmed identity on this device and the server cannot be reached / asks to sign in
;

const store = {
  get: () => { try { return localStorage.getItem(LAST_USER); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(LAST_USER, v); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(LAST_USER); } catch { /* ignore */ } },
};

export let me: { userId: string; email?: string } | null = null;

export async function bootIdentity(): Promise<Boot> {
  let server: { userId: string; email: string; isLegacyOwner: boolean } | null = null;
  try {
    const res = await fetch("/api/v1/me", { redirect: "manual", credentials: "same-origin", cache: "no-store" });
    if (res.ok && res.type !== "opaqueredirect") server = await res.json();
  } catch { /* offline */ }

  if (server) {
    store.set(server.userId);
    const db = openUserDb(server.userId);
    if (server.isLegacyOwner) await importLegacyLocalDb(db).catch(() => undefined);
    me = { userId: server.userId, email: server.email };
    return { kind: "ready", userId: server.userId, email: server.email, online: true };
  }
  // Offline (or Access session expired): open the last CONFIRMED user's local copy; sync stays paused
  // until the server confirms the identity again, and the X-Leafling-User latch refuses any push if
  // the next sign-in is a different person.
  const last = store.get();
  if (last && /^[A-Za-z0-9_-]{1,64}$/.test(last)) {
    openUserDb(last);
    me = { userId: last };
    return { kind: "ready", userId: last, online: false };
  }
  return { kind: "signin" };
}

/** Sign out / switch user: forget the device's remembered user, then end the Access session. */
export function signOut() {
  store.clear();
  location.href = "/cdn-cgi/access/logout";
}
