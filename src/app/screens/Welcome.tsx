import { useNavigate } from "react-router-dom";
import { saveProfile, useProfile } from "../data/store.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Button } from "../ui/ui.tsx";

const VALUES: { icon: IconName; text: string }[] = [
  { icon: "book", text: "ידע מקצועי בגישה פשוטה" },
  { icon: "calendar", text: "תזכורות חכמות" },
  { icon: "sprout", text: "מעקב מותאם אישית" },
];

export default function Welcome() {
  const nav = useNavigate();
  const profile = useProfile();
  const start = async () => {
    await saveProfile({ welcomeSeen: true });
    nav(profile?.onboardingDone ? "/today" : `/onboarding/${profile?.onboardingStep ?? 1}`);
  };
  return (
    <main className="safe-top relative flex min-h-dvh flex-col overflow-hidden px-5 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <img src="/img/deco/leaves-bottom-left.webp" alt="" aria-hidden className="deco pointer-events-none absolute -bottom-2 start-0 w-40 -scale-x-100 opacity-80" />
      <img src="/img/deco/leaves-bottom-left.webp" alt="" aria-hidden className="deco pointer-events-none absolute end-0 top-0 w-36 -scale-y-100 opacity-70" />
      <div className="relative mx-auto mt-2 w-full max-w-sm">
        <img src="/img/deco/welcome-hero.webp" alt="Leafling — עציץ מחייך עם פוטוס" className="brand-hero rise mx-auto w-[86%]" />
      </div>
      <div className="rise mt-2 text-center" style={{ animationDelay: "80ms" }}>
        <h1 className="flex items-center justify-center gap-2 text-[27px] font-bold text-ink">
          <Icon name="sprout" className="text-green" size={26} />הבית לצמחים שלך
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-[17px] leading-relaxed text-muted">מעקב, ידע, תזכורות והכוונה חכמה כדי שהצמחים שלך יגדלו ויתפתחו.</p>
      </div>
      <ul className="rise mx-auto mt-6 grid w-full max-w-sm grid-cols-3 gap-3" style={{ animationDelay: "140ms" }}>
        {VALUES.map((v) => (
          <li key={v.text} className="flex flex-col items-center gap-2 rounded-card bg-sage/80 px-2 py-4 text-center">
            <Icon name={v.icon} size={34} className="text-green" />
            <span className="text-[14px] leading-snug text-ink">{v.text}</span>
          </li>
        ))}
      </ul>
      <div className="relative mx-auto mt-auto w-full max-w-sm space-y-3 pt-8">
        <Button onClick={start} icon="sprout" trailing="forward" className="w-full">מתחילים</Button>
        {profile?.onboardingDone ? (
          <Button variant="outline" onClick={() => nav("/today")} trailing="forward" className="w-full">כבר יש לי הגדרות — כניסה לאפליקציה</Button>
        ) : (
          <p className="px-4 text-center text-[13px] leading-relaxed text-muted">הכניסה מאובטחת דרך Cloudflare Access — אין סיסמה נוספת לזכור.</p>
        )}
      </div>
    </main>
  );
}
