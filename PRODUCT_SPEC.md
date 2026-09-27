# PRODUCT_SPEC.md

# אפיון מוצר מלא --- מערכת אישית לניהול, גידול ומעקב אחר צמחים

## 1. מטרת המסמך

מסמך זה הוא מקור האמת המלא לדרישות המוצר. הוא מתאר מה המערכת צריכה לעשות
וכיצד היא צריכה להתנהג, ולא קובע ספריות או ארכיטקטורה סופית. במקרה של
סתירה, ההחלטות המעודכנות במסמך זה גוברות.

## 2. חזון

PWA אישית מקיפה לניהול וגידול צמחים: אוסף אישי, יומן חזותי, היסטוריה
טכנית, זרעים ושתילים, ייחורים, השקיה חכמה, דישון, מיקומים ותאורה, אבחון
וטיפול, מאגר צמחים, Wishlist, כלי גידול ו-AI Botanist. ידע כללי על הזן
הוא נקודת פתיחה; ככל שנצברת היסטוריה אישית, ההמלצות נשענות יותר על הצמח
המסוים.

## 3. מחוץ להיקף

אין Social/Feed/Followers/Likes/Community, חדשות, קורסים, פרסומות, Plant
of the Day, QR, Harvest Log, Gamification אגרסיבי, Photos Tab נפרד,
Weather Tool עצמאי, השקיה קשיחה לפי ימים, עריכת תמונות AI,
יישור/חיתוך/Overlay לטיימלאפס, חובה להזין עציץ/מצע, כלל שורש אוניברסלי,
שינוי סטטוס או סיום טיפול אוטומטי.

# פלטפורמה ותשתית

## 4. PWA

-   Web App מתקדמת, iPhone-first, נגישה דרך האינטרנט.
-   ניתנת להוספה למסך הבית ומתנהגת ככל האפשר כאפליקציה.
-   לא Native iOS, לא SwiftUI, אין Mac/Xcode/App Store.
-   אין Ubuntu פרטי ואין מחשב אישי שחייב לפעול.
-   קוד ב-GitHub פרטי.

## 5. כיוון תשתית לבדיקה

Cloudflare הוא הכיוון לבדיקה, לא בחירה סופית: Pages/Workers לאפליקציה
וצד שרת, D1 לנתונים, R2 לתמונות, Access להגבלת גישה. יש לאמת התאמה,
מגבלות ועלויות בשלב הארכיטקטורה.

## 6. גישה ושמירה

המערכת מיועדת למשתמשת אישית אחת. אין הרשמת אימייל/סיסמה ייעודית
לאפליקציה. יש להגביל למשתמשת מורשית. הנתונים והתמונות נשמרים אמין בענן,
עם גיבוי ושחזור מסודרים ומטמון מקומי לעבודה חלקית בחיבור חלש. AI דורש
אינטרנט; מידע אישי שכבר נטען ופעולות מתאימות צריכים להישאר שימושיים ככל
האפשר.

# שפה ועיצוב

## 7. עברית

-   כל הממשק בעברית, RTL אמיתי.
-   שמות מדעיים LTR תקין בתוך RTL.
-   Metric: °C, ס"מ, מ"ל, ליטר וכו'.

## 8. שפה חזותית

טבעי, רך, חם וחמוד-מאויר בלי להיות ילדותי: Off-white/cream, ירוקים
טבעיים, כרטיסים מעוגלים, מרווחים, תמונות צמחים גדולות ואיורים בוטניים
קטנים. נבט קטן יכול להיות אלמנט מותג עדין, לא Mascot מציק. להימנע
מניאון, Jungle decoration, עומס ומראה קליני. Dark Mode חם ולא שחור
מוחלט. Primary ירוק, Secondary בהיר/outline, Text action לפעולה משנית.
משימות והצעות נראות שונה. אנימציות עדינות בלבד.

## 9. טון

אנושי, רגוע, ברור, ידידותי, לא קליני ולא מאשים. רמת ניסיון משנה עומק
הסבר בלבד.

# ניווט

## 10. Bottom Navigation

בדיוק: 1. היום 2. מצא צמח 3. הצמחים שלי 4. המיקומים שלי 5. כלים

Diagnose אינו Tab ראשי.

## 11. Floating +

בדיוק: - זיהוי צמח - AI Botanist

# Onboarding והגדרות

## 12. Onboarding

שאלה אחת למסך + Progress; הכול ניתן לדילוג ולשינוי בהגדרות. 1. אזור
גידול: עיר/אזור/מדינה; לא כתובת מדויקת. לעונות, זריעה, חוץ, טמפרטורה
ומזג אוויר. 2. חיות: כלב/חתול/ציפור/ארנב/מכרסם/זוחל/אחר, multi-select;
שם אופציונלי לכל חיה. 3. ניסיון: מתחילה/קצת ניסיון/מנוסה/מנוסה מאוד; לא
נועל פיצ'רים. 4. מה מגדלים:
בית/ירקות/עשבים/פרחים/סוקולנטים/מזרע/ייחורים/גינת חוץ. 5. איפה:
פנים/חוץ/מרפסת/אדני חלון/גינה/מספר אזורים. 6. עזרה: בדיקות אדמה, דישון,
השרשות, שתילים, העברת עציץ, בריאות, עונתי/מזג אוויר. ברירת מחדל יכולה
להיות ON; Push רק לחשוב. סיום: "הכול מוכן 🌱 עכשיו נכיר את הצמחים שלך" +
"+ הוספת הצמח הראשון שלי" / "🔎 קודם בא לי להסתכל על צמחים".

Settings: כל הנ"ל + התראות, הצעות צילום, יחידות, הרשאות, מצב
גיבוי/שמירה, Appearance/Dark Mode.

# היום

## 13. Today

בתוך כ-5 שניות ברור מה דורש תשומת לב. משימות: בדיקות אדמה, דישון, השרשה,
שתילים, Repotting, טיפול/Health follow-up ועוד. אפשר
Complete/Postpone/תגובה מובנית. השרשה: אין שורשים/התחילו/אורך
אופציונלי/ריקבון/תמונה. אדמה: יבש-השקיתי / לח-לא השקיתי / משהו לא בסדר.

בתחתית: "🌿 לא דורשים טיפול היום --- 12 צמחים", thumbnails + "הצג הכל".
לא "הכול בסדר".

## 14. Suggestions

נפרדות ממשימות. צילום: "בא לך לראות כמה הוא השתנה?" → צלמי/לא עכשיו. אין
overdue/guilt. תדירות חכמה לשתילים/ייחורים/החלמה. תמונה נכנסת לאותו
Journal/Timelapse. השלמת אור: "חסרה מדידת צהריים"; לא חובה; מפסיקים
כשמספיק וניתן להציע מחדש עונתית.

# מצא צמח ומידע זן

## 15. Find Plant

חיפוש שם + מצלמה + גלריה במסך אחד. חיפוש לפי
common/local/scientific/aliases, לא nickname אישי. זיהוי AI מציג חלופות
כשלא בטוח ולא מזייף certainty.

## 16. General Plant Page

תמונת זן, שמות, aliases, confidence/alternatives אם AI, "+ הוספה לצמחים
שלי", "♡ הוספה לצמחי החלומות", "יש לך 2..." אם קיים. Quick care:
אור/מים/טמפ'/לחות/קושי/בטיחות. Tabs: טיפול \| ריבוי \| בטיחות 🐾 \|
בעיות.

טיפול: בדיקת אדמה והשקיה, over/underwater; אור אידיאלי/נסבל/לא מתאים,
חלון/שמש/סימנים וקישור למד אור; מצע/ניקוז/עציץ; דשן/עונה/מתי לא;
טמפ'/לחות/פנים-חוץ/קור/רוח/מזגן/lifecycle; התאמה לאזור/עונה. אין fixed
schedule. ריבוי: אפשרות ושיטות מתאימות בלבד, node/growth
point/leaf-only, שלבים והמחשות, rooting estimate, אור/טמפ'/מים/rot,
ו-"✂️ התחלתי ייחור". בטיחות: species-specific לפי חיה ו-exposure (בליעה,
מוהל/עור/פה, עיניים), חלקים, תסמינים ומה לעשות; אין airborne claims ללא
בסיס. התאמה לשמות חיות. אין label כזה על Wishlist card. בעיות:
pests/disease וגם yellow/brown/curling/slow growth/drop וכו', visual
examples ו-"📷 אבחני את הצמח שלי".

# My Plants

## 17. Tabs וסטטוסים

Search/filter/sort. סדר Tabs מדויק: הכול \| בהשרשה \| שתילים \| צמחים \|
חולים \| ♡ צמחי החלומות שלי סטטוסים אישיים בלבד: בהשרשה, שתיל, צמח,
חולה. Wishlist נפרד. Search כולל species/common/scientific/personal
name. Card: תמונה, שם, זן, מיקום, סטטוס, next action. סינון/מיון לפי
מיקום/שם/תאריך; manual order אפשרי אך לא חובה.

## 18. Naming

ראשון: `Monstera deliciosa`; שני `#2`; שלישי `#3`; לעולם אין #1.
Nickname מחליף display name בלי לשנות identity. חל גם בפיצול קבוצות.

# הוספת צמח

## 19. Flow

מזן ידוע לא שואלים species שוב. 1. Personal photo: מצלמה/גלריה/skip;
identification photo ניתן לשימוש באישור. Placeholder זן אם skip, מסומן
ולא נכנס Journal/Timelapse. 2. Status: בהשרשה/שתיל/צמח/חולה. 3. Nickname
אופציונלי. 4. Location קיים/חדש; התאמת אור יכולה להזהיר אך לא לחסום. 5.
שאלות קצרות לפי status. צמח: acquired date today/date/don't remember;
pot diameter optional. שתיל: sow date עיקרי; germination/count optional.
השרשה: start date/method/root state; length optional. חולה: offer
Diagnose now/not now. "+ פרטים נוספים": pot
material/diameter/drainage/substrate/light/last
water/fertilizer/repot/height/note. Pot/substrate לא חובה.

# כרטיס אישי

## 20. Header ו-Care Plan

Gallery גדולה, name, species, location, status, "אצלי מאז", age/day
count, edit/archive/delete/status. Status suggestions never automatic.
Care Plan גבוה וברור: next soil check, fertilizer, roots, recovery וכו'.
Tabs: Journal \| היסטוריה \| בריאות \| מידע. AI Botanist נגיש ומכיר
plant.

Edit מאפשר name/location/status/dates/pot/substrate וכו'. Archive/Delete
בטוחים; מדיניות cascade פתוחה לארכיטקטורה.

# תמונות, Journal, History

## 21. Photos

אין Photos tab. Header gallery swipe; fullscreen/date/notes/delete/set
main/+photo. Originals immutable: אין AI
crop/straighten/center/enhance/align/reposition/overlay/ghost/angle
guide. AI מנתח בלבד. Technical thumbnails מותרות בלי לשנות מקור.

## 22. Journal

סיפור אישי: photos/video אם נתמך, notes, milestones, meaningful
automatic events. "+ הוספת עדכון". Milestones: first sprout/new
leaf/first flower/new growth/first root/repotted/recovered/other. Quick
photo minimal. Gallery photo uses original capture date metadata; אחרת
today/date/unknown. Seedlings/propagations show day count.

## 23. History

Technical automatic log, לא duplicate manual logging. Filters:
הכול/השקיה/דישון/עציץ/מיקום/בריאות/התפתחות. Soil check, watering,
fertilizer, repot, substrate/location/status,
health/treatment/development וכו'.

## 24. Timelapse + Compare

Timelapse מתוך Journal: date range, all/selected, basic speed/length.
Originals only, no alignment/crop. Compare: 2 photos, side-by-side או
slider, originals unchanged.

# זיכרון ולמידה

## 25. Persistent Plant Memory

לכל צמח זיכרון מובנה: data, photos, Journal, History, soil/watering,
fertilizing, pruning if recorded, pot/substrate, location/light,
seed/propagation, diagnosis/treatment, status changes, notes/actions. עם
היסטוריה, personal behavior מקבל יותר משקל; אין להסיק pattern מאירוע
יחיד ויש לבטא confidence.

# השקיה

## 26. Soil-check model

לא "water every X days". Today: "הגיע הזמן לבדוק". Dry/slightly
moist/very moist/not checked. אם dry שואלים אם watered; רק yes יוצר
watering event. אם moist, no watering event ו-next check. "משהו לא בסדר"
→ Diagnose. Dry-down learning from actual cycles. כשהנתונים מספיקים:
last watering, typical range, number of cycles. בתחילה
species/season/pot/substrate/location; בהמשך personal history. Weather
may move check, never conclude water need. Missed check: calm wording,
no guilt.

# דישון

## 27. Fertilizing

Time window, לא harsh due date: fertilized/remind later/skip. Optional
fertilizer used. "My Fertilizers": name/photo/NPK/manufacturer
instructions/dose/plants. AI can read label; manufacturer authoritative.
No universal invented rule; context-aware when not to fertilize.

# שתילים

## 28. Seed batches

Start via Sowing Assistant/species/add seedling. Ask sow date, seed
count/unknown, one cell/multiple/direct; if multiple, container count.
Do not create card per seed. Optional
depth/substrate/container/dome/location/note. Before germination stays
Seedlings: day count/"waiting", moisture/temp/light/dome
species-specific; no universal darkness/dome. Track first sprout date
and current germinated count; later +sprouts preserve dates. Stages
species-aware: sowing/germination/cotyledons/true
leaves/separate-thin/transplant/established; explain true leaves for
beginner. Multiple seedlings: separated/thinned/leave together.
Separation creates personal cards inheriting shared history. Thinning
stores counts, no dead cards. Transplant readiness species/stage
checklist, not arbitrary date. Optional pot/substrate/location/photo,
logged. Seedling→plant suggested, user confirms. Summary: sow
date/age/sown/germinated/first sprout delay/germination rate/stage.
Future grows can compare to past.

# השרשות

## 29. Propagation

Start from species/mother/tool/add. If mother known, explicit lineage
and mother history "נלקח ייחור". Ask count + together/separate. Together
= group; separate can create cards. Only suitable methods:
water/soil/sphagnum/LECA/etc. Explain anatomy/node/growth
point/leaf-only/cut with illustrations. Start date + optional
container/substrate/location/nodes/leaves/note. Card: method/day
count/root state/longest optional/last water change/location. Checks: no
roots/started/grew/problem. First root can prompt photo; no mandatory
ruler. No universal 5cm readiness; species/method/root system/context.
Water: water state/change/roots/photo, no universal interval. Soil:
moisture/establishment, no repeated pulling. Problems:
blackening/softness/smell/yellow/dark roots/other/photo → Diagnose with
context. Move to substrate: date + optional
pot/substrate/location/photo. End asks: "ההשרשה הסתיימה! מה הסטטוס שלו
עכשיו?" → שתיל/צמח. Same record. Group outcome: all together=one plant;
split=cards sharing history; some succeed=counts, no dead cards.

# Plant Family

## 30. Lineage

Explicit mother/descendant relationships, not inferred by species. "🌳
משפחת הצמח": mother/direct descendants/relevant lineage. Small/cute, not
huge genealogy system.

# Diagnose + Health

## 31. Diagnose entry

No bottom tab. From Health, care task, Pest ID, AI suggestion etc. Plant
preselected when contextual; otherwise choose My Plant or unowned
identify/search. Guided photos: whole, close-up, optional
underside/soil/pest/roots. AI checks image quality first and requests
retake only when materially needed. Symptoms multi-select:
yellow/brown-black/dry tips/wilt/holes/insects/drop/no
growth/root/mold/other. Dynamic relevant follow-ups. Result: likely
cause, confidence, alternatives, evidence, missing info. Urgency
green/yellow/orange/red or clear text. Contagious suspicion: temporary
isolation/check nearby plants; never auto-mark sick. Risky irreversible
actions require higher confidence.

## 32. Health tab + treatment

No active: "💚 אין כרגע בעיה פעילה במעקב" + Diagnose + previous
treatments. Active: issue/likely
cause/confidence/alternatives/why/treatment. Treatment produces dated
tasks mirrored to Today. Recovery: new photo + user-observable facts; AI
may suggest improving/unchanged/worsening but asks if matches
observation. Multiple simultaneous issues allowed; conflicting plans
must be reconciled/warned. AI never auto-recovers. Suggest "נראה שמוצי
התאושש. לסיים את הטיפול?" User confirms; then may suggest sick→plant.
Past treatment opens full case; recurrence may link but not assume same
diagnosis. "🏥 קיבלתי אבחנה מאיש מקצוע": diagnosis/who
optional/notes/instructions; distinguish external from AI.

# Locations

## 33. My Locations

Reusable entities: "סלון -- ליד החלון", "מדף", "מטבח", "מרפסת". Only
name required. Optional indoor: window distance/direction/direct sun/AC.
Outdoor: direct/partial/shade/rain/wind. Light readings belong to
location, multiple times/dates; build profile, never one permanent
measurement. Seasonal remeasurement suggestions possible. Location page:
details/light history/profile/plants. "האם צמח יתאים לכאן?" choose
database/wishlist/personal; compare and explain, never block placement.
Moving plant updates current location + History + AI context. Contagious
issue can suggest checking neighbors.

# Wishlist

## 34. Dream Plants

Separate collection/tab, not status. Saved species page has full general
Care/Propagation/Safety/Problems but no personal tracking. No pet safety
clutter on card, no purchase nagging. "🌱 קניתי את הצמח!" asks:
ייחור/בהשרשה \| שתיל \| צמח. No "חולה". Then personal creation flow and
removes that explicit Wishlist entry. If personal plant added another
way, don't auto-remove Wishlist. Preserve personal note if any.

# Tools

## 35. Exact core tools

1.  Light Meter
2.  Watering Assistant
3.  Fertilizer Calculator
4.  Pot Size Assistant
5.  Sowing Assistant
6.  Propagation Assistant
7.  Repotting Guide
8.  Pest Identification
9.  "מה זה הדבר הזה?"
10. Soil Mix Builder

Light Meter: measure/input light subject to real web/iPhone
capabilities, assess plant, save location. Never fake lux. Watering
Assistant:
species/pot/substrate/location/season/weather/history/dry-down;
recommend checks. Fertilizer Calculator: water volume + label dose;
optional label photo; manufacturer authoritative. Pot Size: current +
reason, sensible size-up and oversized moisture risk. Sowing:
species/region/date,
timing/container/seeds/depth/temp/dome/pre-germination
light/germination/transplant; "התחלתי לזרוע". Propagation:
species-specific illustrated wizard; "התחלתי השרשה". Repotting:
reason-aware steps, optional root-ball AI; completion logs and updates
current state. Pest ID:
photo/confidence/harmful/hosts/inspect/treatment; "מצאתי אותו..." →
plant → Diagnose. "What is this?": ambiguous plant visual assistant,
optional save with confirmation. Soil Mix: plant + desired
drainage/aeration/retention + materials owned; recommend from available
materials, no unnecessary shopping list.

# Weather

## 36. Background only

Weather influences check timing/outdoor/sowing/cold-heat context. No
standalone screen/tool. Never determines watering by itself.

# Notifications

## 37. Important only

Onboarding opt-in, editable Settings. Push/system notifications only for
important soil check/treatment/seedling/propagation tasks. No push for
photos/light-profile/engagement. PWA iPhone notification
capability/limitations must be validated in architecture.

## 38. Custom reminders

Per plant, one-time or recurring where appropriate: rotate pot/check
support/inspect leaves/custom. Lightweight.

# Current state

## 39. Pot/substrate/location/status

Current state shown now; every change updates current state and
preserves history (e.g. 12→17→21 cm).

# AI

## 40. Claude API

Claude API through secure server-side layer only. API key never
browser/client/frontend.

## 41. AI Botanist

General chat from floating +, multiple images. From personal card
automatically knows plant and relevant context. General chat can select
My Plant.

## 42. Context minimization

Each AI request gets only relevant structured context for
plant/question. Never whole DB or unrelated plants.

## 43. No silent mutations

AI can propose tasks/status/location/treatment/data actions; user must
explicitly confirm before mutation.

## 44. Uncertainty

AI must distinguish known/high, likely/medium, possible/low,
insufficient. When relevant separate: - מה אני רואה/יודע - מה אני חושב -
מה חסר If still uncertain, say so. Higher-risk/irreversible action
requires higher certainty. Applies to Botanist, Diagnose,
identification, Pest ID, "What is this?".

## 45. AI images

May analyze for
identification/diagnosis/pests/what-is-this/follow-up/fertilizer
label/root ball. Never modifies original.

# Data principles

## 46. Single Source of Truth

One logical photo can appear gallery/journal/timelapse. One watering
event feeds History/AI. Light belongs to location. Treatment tasks link
to treatment. Propagation record continues through transition. Location
change updates current + history.

## 47. Event history

Structured events for
soil/water/fertilizer/repot/substrate/location/status/sow/germination/split/propagation/root/water
change/diagnosis/treatment/pruning etc.; exact schema deferred.

# Empty states/personality

## 48. Examples

Today empty: "הכול רגוע להיום 🌿 אין צמחים שדורשים טיפול כרגע."
Milestones sparingly: "שורש ראשון! 🌱", "נבט ראשון 🌱", "מוצי התאושש
💚", wishlist purchased "הוא כבר לא רק חלום 🌱".

# UX principles

## 49. Mandatory

1.  Helps, doesn't nag.
2.  Tasks != suggestions.
3.  No guilt.
4.  Ask only what's needed.
5.  Advanced details optional.
6.  Reuse known info.
7.  Personal history improves recommendations.
8.  Species knowledge starts; personal history gains weight.
9.  AI data changes require confirmation.
10. AI uncertainty is a feature.
11. Photos remain originals.
12. Calm/uncluttered.
13. Don't add features to fill space.
14. Experience level changes explanation, not capabilities.
15. Features integrate with shared data.
16. Recommendations warn/explain rather than unnecessarily blocking user
    choice.

# Performance, reliability, privacy

## 50. Scale

Plan for hundreds of plants, thousands of history events/photos. Do not
load all full-res images in lists. Exact pagination/thumbnails/cache
deferred. Network/AI has loading/failure/retry. Personal data shouldn't
vanish on temporary network failure. Private personal system; photos not
public; no ads/social; no advertising analytics/tracking without
explicit future decision; don't send irrelevant data to AI; secrets
never frontend.

# Accessibility

## 51. Basic only

Not a project focus, but readable contrast/text, reasonable tap targets,
clear labels, and don't rely only on color for critical meaning.

# Critical invariants

## 52. Never break

-   PWA/Web, iPhone-first, Hebrew RTL.
-   Exact 5 bottom tabs.
-   Floating + only Identify + AI Botanist.
-   Wishlist != status.
-   Only 4 personal statuses.
-   No #1.
-   Soil-check watering.
-   AI no silent mutation; admits uncertainty.
-   Original photos unchanged; original timelapse.
-   No Photos/Weather/Social/Ads/News/Courses tabs/features.
-   Pot/substrate optional.
-   No universal root length.
-   Seedling/cutting groups supported; split preserves history; no
    pointless dead cards.
-   Lineage.
-   Treatment/status never auto-complete/change.
-   Suggestions never overdue.
-   Important notifications only.
-   Claude server-side only; key never frontend.
-   Minimal relevant AI context.
-   Reliable cloud storage + backup/restore + weak-connection cache.
-   No Mac/Xcode/App Store/private Ubuntu/personal always-on computer
    dependency.

# החלטות פתוחות

1.  Frontend framework/libraries.
2.  Final code architecture.
3.  Final validation of Cloudflare Pages/Workers/D1/R2/Access, limits
    and cost.
4.  Exact authentication flow for the one authorized user.
5.  Exact data schema.
6.  Exact PWA cache/offline/sync strategy.
7.  Backup/restore format, frequency, versioning and restore procedure.
8.  Current iPhone PWA push notification capabilities/limitations.
9.  Light Meter feasibility in iPhone web APIs and fallback UX if
    reliable lux is unavailable.
10. General plant database/source and provenance/verification policy.
11. Weather data provider.
12. Archive/Delete cascade/retention policy.
13. Whether Journal video is in v1.
14. Whether manual drag sorting is in v1.
15. Claude API cost/rate/context/image strategy.
16. Image originals/thumbnails/storage optimization implementation.
17. Exact confidence computation/display conventions.
18. Data export/year summary remains future nice-to-have, not current
    requirement.
19. General statistics screen is not required and remains out of scope
    unless later added.

------------------------------------------------------------------------

מסמך זה הוא אפיון מוצר עצמאי. השלב הבא הוא תכנון ארכיטקטורה טכנית מתוך
הדרישות וההחלטות הפתוחות, ללא כתיבת קוד לפני אישור הארכיטקטורה.
