import { useNavigate } from "react-router-dom";
import { HUMIDITY_TEXT, LIFECYCLE_TEXT, PROPAGATION_TEXT, SOW_DEPTH_TEXT, SUBSTRATE_TEXT, WATER_TEXT, WHERE_TEXT, GROUP_LABEL, type CatalogEntry } from "../../shared/catalog.ts";
import { LIGHT_LABEL, speciesById, type Toxicity } from "../../shared/species.ts";
import { useCatalog } from "../data/catalog.ts";
import { CatalogArt } from "../ui/CatalogArt.tsx";
import { Icon, type IconName } from "../ui/icons.tsx";
import { BackButton, Button, EmptyState, IconBubble } from "../ui/ui.tsx";

// General page for a catalog plant. Shows ONLY the fields the catalog has — nothing is filled in to look complete.

const TOX_TEXT: Record<Toxicity, string> = { toxic: "רעיל", non_toxic: "לא רעיל לפי הרשימה", unknown: "לא ידוע" };

function Row({ icon, tone, title, children }: { icon: IconName; tone: "sun" | "water" | "soil" | "heat" | "sage"; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface p-3 shadow-soft">
      <IconBubble icon={icon} tone={tone} />
      <div className="min-w-0 flex-1 pt-0.5"><div className="text-[16px] font-semibold text-ink">{title}</div><div className="text-[15px] leading-snug text-muted">{children}</div></div>
    </div>
  );
}

/** Care facts of a catalog entry (also used on a personal plant linked to a catalog species). */
export function CatalogCare({ e, provenance }: { e: CatalogEntry; provenance?: string }) {
  const c = e.care;
  return (
    <div className="space-y-2" data-testid="catalog-care">
      <p className="flex items-center gap-1.5 px-1 text-[13px] text-muted"><Icon name="info" size={15} /> מידע כללי — טיוטה שטרם אומתה מול מקור ראשוני.</p>
      {c.light && <Row icon="sun" tone="sun" title="אור">{c.light.map((l) => LIGHT_LABEL[l]).join(" · ")}</Row>}
      {c.water && <Row icon="drop" tone="water" title="השקיה">{WATER_TEXT[c.water]} בודקים את האדמה — לא לפי לוח זמנים קבוע.</Row>}
      {c.substrate && <Row icon="pot" tone="soil" title="מצע">{SUBSTRATE_TEXT[c.substrate] ?? c.substrate}</Row>}
      {(c.tempMinC !== undefined || c.humidity) && <Row icon="thermo" tone="heat" title="טמפרטורה ולחות">{[c.tempMinC !== undefined ? `לא מתחת לכ-${c.tempMinC}°C` : "", c.humidity ? HUMIDITY_TEXT[c.humidity] : ""].filter(Boolean).join(" · ")}</Row>}
      {(c.where || c.lifecycle) && <Row icon="home" tone="sage" title="איפה ומחזור חיים">{[c.where ? WHERE_TEXT[c.where] : "", c.lifecycle ? LIFECYCLE_TEXT[c.lifecycle] : ""].filter(Boolean).join(" · ")}</Row>}
      {c.propagation?.length ? <Row icon="sprout" tone="sage" title="ריבוי">{c.propagation.map((p) => PROPAGATION_TEXT[p] ?? p).join(" · ")}</Row> : null}
      {c.sowing && <Row icon="seed" tone="soil" title="זריעה">עומק: {SOW_DEPTH_TEXT[c.sowing.depth] ?? c.sowing.depth} · נביטה: <span className="ltr">{c.sowing.germDays[0]}–{c.sowing.germDays[1]}</span> ימים · חום לנביטה: <span className="ltr">{c.sowing.tempC[0]}–{c.sowing.tempC[1]}°C</span></Row>}
      {e.note && <Row icon="info" tone="sage" title="חשוב לדעת">{e.note}</Row>}
      <Row icon="paw" tone="heat" title="חיות מחמד">
        חתולים: {TOX_TEXT[e.toxicity.cats]} · כלבים: {TOX_TEXT[e.toxicity.dogs]}
        <span className="block text-[13px]">{e.toxicity.source ? "מקור: רשימת ASPCA — טרם אומת בתוך Leafling." : "אין מקור מאומת במאגר — לא מניחים שהצמח בטוח."}</span>
      </Row>
      {provenance && <p className="px-1 pt-1 text-[12px] leading-relaxed text-muted">{provenance}</p>}
    </div>
  );
}

export function CatalogSpeciesPage({ id }: { id: string }) {
  const nav = useNavigate();
  const catalog = useCatalog();
  if (!catalog) return <main className="safe-top min-h-dvh px-4"><BackButton to="/find" /><p className="mt-10 text-center text-muted">טוען את המאגר…</p></main>;
  const e = catalog.byId.get(id);
  if (!e) return <EmptyState title="הזן לא נמצא" action={<Button onClick={() => nav("/find")} className="w-full">חזרה לחיפוש</Button>} />;
  const parent = e.parent ? (speciesById(e.parent) ? { id: e.parent, he: speciesById(e.parent)!.he } : catalog.byId.get(e.parent) ? { id: e.parent, he: catalog.byId.get(e.parent)!.he } : null) : null;
  return (
    <div data-testid="catalog-page">
      <div className="relative">
        <CatalogArt group={e.group} image={e.image?.url} className="h-[34vh] min-h-[240px] w-full !rounded-none" label={false} />
        <div className="safe-top absolute inset-x-0 top-0 px-4"><BackButton to="/find" /></div>
      </div>
      <div className="relative -mt-6 space-y-4 rounded-t-[28px] bg-bg px-4 pb-6 pt-5">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-ink">{e.he}</h1>
          <div className="sci text-[16px] text-muted">{e.scientific}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full bg-sage px-3 py-1 text-[13px] font-semibold text-green">{GROUP_LABEL[e.group] ?? e.group}</span>
            {e.cultivar && <span className="rounded-full bg-surface px-3 py-1 text-[13px] text-ink shadow-soft">זן תרבותי: <span className="ltr">'{e.cultivar}'</span></span>}
            {[...(e.heAlt ?? [])].slice(0, 3).map((a) => <span key={a} className="rounded-full bg-surface px-3 py-1 text-[13px] text-ink shadow-soft">{a}</span>)}
          </div>
          {e.image && <p className="mt-1 text-[11px] text-muted">תמונה: {e.image.author} · {e.image.license}</p>}
        </div>
        <div className="space-y-1 rounded-card bg-sage/50 p-3 text-[14px] text-ink">
          {e.en?.length ? <div>באנגלית: <span className="ltr">{e.en.join(", ")}</span></div> : null}
          {e.synonyms?.length ? <div>שמות נרדפים: {e.synonyms.map((s, i) => <span key={s}>{i ? ", " : ""}<span className="sci">{s}</span></span>)}</div> : null}
          <div>משפחה: <span className="ltr">{e.family}</span> · סוג: <span className="sci">{e.genus}</span></div>
          {parent && <button onClick={() => nav(`/find/species/${parent.id}`)} className="pressable mt-1 font-semibold text-green">שייך ל{parent.he} ←</button>}
        </div>
        <CatalogCare e={e} provenance={catalog.provenance} />
        <Button icon="plus" onClick={() => nav(`/plants/new?species=${e.id}`)} className="w-full">הוסף לצמחים שלי</Button>
      </div>
    </div>
  );
}
