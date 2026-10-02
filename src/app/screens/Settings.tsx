import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import type { Plant, Profile } from "../../shared/types.ts";
import { currentUserId, db, deleteLocalUserDb, getMeta } from "../data/db.ts";
import { me, signOut } from "../data/identity.ts";
import { saveProfile, useProfile } from "../data/store.ts";
import { apiJson, mutate, onSync, resyncFromServer, sync, type SyncState } from "../data/sync.ts";
import { useLiveQuery } from "dexie-react-hooks";
import { Icon } from "../ui/icons.tsx";
import { ActionRow, BackButton, Button, Card, Chip, InfoNote, SectionTitle, useToast } from "../ui/ui.tsx";
import { HELP, INTERESTS, PLACES } from "./Onboarding.tsx";

interface Conflict { id: number; entity: string; record_id: string; field: string; overwritten: string; incoming: string; at: string; resolved: number }

export function applyTheme(theme: Profile["theme"]) {
  const dark = theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171a14" : "#f6efe2");
}

async function exportData(): Promise<number> {
  // Full structured export assembled on the phone from paginated server pulls (essential backup E3).
  const records: unknown[] = [];
  let since = 0;
  for (let i = 0; i < 500; i++) {
    const r = await apiJson<{ records: unknown[]; more: boolean; until: number }>(`/api/v1/sync/pull?since=${since}`);
    records.push(...r.records);
    since = r.until;
    if (!r.more) break;
  }
  const manifest = { format: "leafling-export", version: 1, exportedAt: new Date().toISOString(), recordCount: records.length, note: "Photos are exported separately (original-photo export)." };
  const blob = new Blob([JSON.stringify({ manifest, records }, null, 1)], { type: "application/json" });
  const name = `leafling-export-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name }).catch(() => undefined);
  else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  return records.length;
}

export default function Settings() {
  const nav = useNavigate();
  const toast = useToast();
  const profile = useProfile();
  const [s, setS] = useState<SyncState>({ status: "idle", pending: 0 });
  const [lastSync, setLastSync] = useState<number | undefined>();
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const rejected = useLiveQuery(() => db.outbox.where("state").equals("rejected").toArray(), [], []);
  const trash = useLiveQuery(async () => (await db.plants.toArray()).filter((p) => p.deletedAt && Date.now() - Date.parse(p.deletedAt) < 30 * 86_400_000), [], [] as Plant[]);
  useEffect(() => onSync((x) => { setS(x); if (x.lastSyncAt) setLastSync(x.lastSyncAt); }), []);
  useEffect(() => { void getMeta<number>("lastSyncAt").then(setLastSync); }, []);
  const theme = profile?.theme ?? "system";
  const label = (list: { id: string; label: string }[], ids?: string[]) => (ids?.length ? ids.map((i) => list.find((x) => x.id === i)?.label ?? i).join(", ") : "לא נבחר");

  return (
    <main className="safe-top min-h-dvh px-4 pb-10">
      <BackButton to="/today" />
      <h1 className="mt-3 text-center text-[28px] font-bold text-ink">הגדרות</h1>

      <SectionTitle>מראה</SectionTitle>
      <div className="flex gap-2">{([["system", "לפי המכשיר"], ["light", "בהיר"], ["dark", "כהה"]] as const).map(([k, t]) => <Chip key={k} selected={theme === k} onClick={() => { applyTheme(k); void saveProfile({ theme: k }); }}>{t}</Chip>)}</div>

      <SectionTitle>הפרופיל שלי</SectionTitle>
      <div className="space-y-2">
        <ActionRow icon="pin" title="אזור" subtitle={[profile?.city, profile?.region, profile?.country].filter(Boolean).join(", ") || "לא הוגדר"} onClick={() => nav("/onboarding/1")} />
        <ActionRow icon="paw" title="חיות מחמד" subtitle={profile?.pets?.length ? profile.pets.map((p) => p.name || { dog: "כלב", cat: "חתול", bird: "ציפור", rabbit: "ארנב", rodent: "מכרסם", reptile: "זוחל", other: "אחר" }[p.kind]).join(", ") : "אין"} onClick={() => nav("/onboarding/2")} />
        <ActionRow icon="sprout" title="מה אני מגדלת" subtitle={label(INTERESTS, profile?.interests)} onClick={() => nav("/onboarding/3")} />
        <ActionRow icon="home" title="איפה אני מגדלת" subtitle={label(PLACES, profile?.places)} onClick={() => nav("/onboarding/4")} />
        <ActionRow icon="leaf" title="ניסיון" subtitle={{ beginner: "מתחילה", some: "קצת ניסיון", experienced: "מנוסה", expert: "מנוסה מאוד" }[profile?.experience ?? "beginner"] ?? "לא נבחר"} onClick={() => nav("/onboarding/5")} />
        <ActionRow icon="bell" title="במה לעזור" subtitle={HELP.filter((h) => profile?.help?.[h.id] !== false).map((h) => h.label).join(", ")} onClick={() => nav("/onboarding/6")} />
      </div>

      <SectionTitle>שמירה וגיבוי</SectionTitle>
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-sage text-green"><Icon name="cloud" /></span>
          <div className="flex-1 text-[15px]">
            <div className="font-semibold text-ink">{s.status === "needs-login" ? "צריך להתחבר מחדש" : s.status === "offline" ? "לא מקוון — נשמר במכשיר" : s.pending ? `${s.pending} שינויים ממתינים לסנכרון` : "הכול מסונכרן לענן"}</div>
            <div className="text-muted">{lastSync ? `סנכרון אחרון: ${new Date(lastSync).toLocaleString("he-IL")}` : "עוד לא בוצע סנכרון"}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="md" variant="secondary" icon="refresh" onClick={() => void sync()}>סנכרון עכשיו</Button>
          <Button size="md" variant="outline" onClick={async () => { await resyncFromServer(); toast("סונכרן מחדש מהשרת"); }}>טעינה מחדש מהענן</Button>
        </div>
        <Button size="md" icon="archive" loading={busy} className="w-full" onClick={async () => { setBusy(true); try { const n = await exportData(); toast(`יוצאו ${n} רשומות`); } catch { toast("הייצוא דורש חיבור לאינטרנט"); } finally { setBusy(false); } }}>ייצוא גיבוי נתונים (JSON)</Button>
        <p className="text-[13px] text-muted">ייצוא תמונות מקור (ZIP לפי שנים) נמצא עדיין בבדיקת היתכנות בשלב 0.</p>
      </Card>

      {(rejected?.length ?? 0) > 0 && (
        <InfoNote icon="info" title="שינויים שלא נשמרו — לבדיקה" className="mt-3">{rejected!.length} שינויים נדחו על ידי השרת. הם עדיין שמורים במכשיר ולא נמחקו.</InfoNote>
      )}

      <SectionTitle action={<button className="text-[15px] font-medium text-green" onClick={async () => { try { setConflicts((await apiJson<{ conflicts: Conflict[] }>("/api/v1/sync/conflicts")).conflicts); } catch { toast("צריך חיבור לאינטרנט"); } }}>טעינה</button>}>שינויים שהתנגשו</SectionTitle>
      {conflicts === null ? <p className="px-1 text-[14px] text-muted">כשאותו שדה נערך משני מכשירים, הערך הקודם נשמר כאן ואפשר לשחזר אותו.</p>
        : !conflicts.length ? <p className="px-1 text-[14px] text-muted">אין התנגשויות 🌿</p> : (
          <div className="space-y-2">{conflicts.map((c) => (
            <div key={c.id} className="rounded-2xl bg-surface p-3 text-[14px] shadow-soft">
              <div className="text-ink"><b>{c.field}</b>: "{JSON.parse(c.overwritten ?? "null")}" ← "{JSON.parse(c.incoming ?? "null")}"</div>
              <div className="text-muted">{new Date(c.at).toLocaleString("he-IL")}{c.resolved ? " · טופל" : ""}</div>
              {!c.resolved && <Button size="sm" variant="secondary" className="mt-2" onClick={async () => {
                await mutate(c.entity as never, c.record_id, { [c.field]: JSON.parse(c.overwritten ?? "null") });
                await apiJson(`/api/v1/sync/conflicts/${c.id}/resolved`, { method: "POST" });
                setConflicts(conflicts.map((x) => (x.id === c.id ? { ...x, resolved: 1 } : x))); toast("הערך הקודם שוחזר");
              }}>שחזור הערך הקודם</Button>}
            </div>
          ))}</div>
        )}

      <SectionTitle>נמחקו לאחרונה</SectionTitle>
      {!trash?.length ? <p className="px-1 text-[14px] text-muted">האשפה ריקה. פריטים נשמרים כאן 30 יום.</p> : (
        <div className="space-y-2">{trash.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-soft"><span className="flex-1 text-[15px] text-ink">{displayName(p)}</span><Button size="sm" variant="secondary" onClick={async () => { await mutate<Plant>("plant", p.id, { deletedAt: null }); toast("שוחזר"); }}>שחזור</Button></div>
        ))}</div>
      )}

      <SectionTitle>התראות</SectionTitle>
      <InfoNote icon="bell">התראות למכשיר (רק לבדיקות אדמה, טיפולים, שתילים והשרשות) יופעלו אחרי שבדיקות שלב 0 על ה-iPhone יאשרו אותן. בינתיים מסך "היום" הוא המקור למשימות.</InfoNote>
      <SectionTitle>החשבון שלי</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-[14px] text-muted">מחובר/ת בתור <span dir="ltr" className="font-medium text-ink">{me?.email ?? "—"}</span>. הנתונים שלך פרטיים ונפרדים מכל משתמש אחר.</p>
        <Button variant="secondary" className="w-full" icon="logout" onClick={() => {
          if (s.pending > 0 && !confirm(`יש ${s.pending} שינויים שעוד לא סונכרנו. הם יישמרו במכשיר ויסונכרנו כשתתחבר/י שוב. להתנתק?`)) return;
          signOut();
        }}>התנתקות / החלפת משתמש</Button>
        <Button variant="text" className="w-full" disabled={s.pending > 0} onClick={async () => {
          if (!currentUserId || !confirm("למחוק את העותק המקומי של הנתונים שלך מהמכשיר הזה? הנתונים בענן לא נמחקים.")) return;
          await deleteLocalUserDb(currentUserId);
          signOut();
        }}>מחיקת העותק המקומי מהמכשיר והתנתקות</Button>
        {s.pending > 0 && <p className="text-[12px] text-muted">אפשר למחוק את העותק המקומי רק אחרי שכל השינויים סונכרנו.</p>}
      </Card>
      <p className="mt-6 text-center text-[12px] text-muted">Leafling · כניסה מאובטחת דרך Cloudflare Access</p>
    </main>
  );
}
