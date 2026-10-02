import type { LightCat } from "./types.ts";

// General species knowledge — the STARTING POINT only. Every entry is general
// horticultural guidance, labelled in the UI as "מידע כללי" and not verified per plant.
// Pet-safety statuses cite the ASPCA toxic/non-toxic plant list as their source and are
// still marked "not verified in-app" until the owner verifies them (ARCHITECTURE §15).
// Species without a source are "unknown" — the app never asserts safety without a basis.

export type Toxicity = "toxic" | "non_toxic" | "unknown";

export interface Species {
  id: string;
  scientific: string;
  he: string;
  aliases: string[];
  image?: string;
  family: string;
  category: "houseplant" | "herb" | "vegetable" | "succulent" | "flower" | "outdoor";
  difficulty: "קל" | "בינוני" | "מאתגר";
  summary: string;
  light: { ideal: LightCat[]; tolerated: LightCat[]; text: string; signs: string };
  water: { text: string; over: string; under: string };
  /** Initial soil-check interval prior in days (warm season); personal history refines it. */
  checkDays: [number, number];
  substrate: string;
  temp: { min: number; max: number; text: string };
  humidity: string;
  fertilize: { text: string; intervalDays: number | null; seasonMonths: number[]; avoid: string };
  growth: { size: string; rate: string };
  propagation: { possible: boolean; methods: string[]; text: string; rooting?: string };
  safety: { cats: Toxicity; dogs: Toxicity; note: string; source: string | null };
  problems: { title: string; signs: string; fix: string }[];
}

const ASPCA = "רשימת הצמחים של ASPCA (ארגון צער בעלי חיים האמריקאי) — טרם אומת בתוך Leafling";
const WARM = [3, 4, 5, 6, 7, 8, 9];

export const SPECIES: Species[] = [
  {
    id: "monstera-deliciosa", scientific: "Monstera deliciosa", he: "מונסטרה", aliases: ["מונסטרה דליסיוזה", "Swiss cheese plant", "פילודנדרון מחורר"],
    image: "/img/species/monstera.webp", family: "Araceae", category: "houseplant", difficulty: "קל",
    summary: "צמח טרופי מטפס עם עלים גדולים ומחוררים. קל לטיפול ומתאים לגידול בתוך הבית.",
    light: { ideal: ["bright_indirect"], tolerated: ["medium"], text: "אור בהיר ועקיף. מתאים ליד חלון.", signs: "עלים קטנים בלי חורים יכולים לרמז על מעט אור; כתמים חומים יבשים על שמש ישירה חזקה." },
    water: { text: "כאשר השכבה העליונה של האדמה (כ־3–5 ס\"מ) מתייבשת.", over: "עלים מצהיבים ואדמה רטובה לאורך זמן.", under: "עלים מתקפלים ונבולים, שוליים חומים." },
    checkDays: [5, 9], substrate: "מצע מאוורר ומנוקז היטב, עם קליפות ופרלייט.",
    temp: { min: 15, max: 30, text: "18–30°C. לא מתחת ל־15°C." }, humidity: "לחות בינונית ומעלה; סובלת לחות ביתית רגילה.",
    fertilize: { text: "באביב ובקיץ, אחת ל־4–6 שבועות.", intervalDays: 35, seasonMonths: WARM, avoid: "לא לדשן צמח יבש מאוד, חולה או מיד אחרי העברה." },
    growth: { size: "יכול להגיע ל־2–3 מטר בתנאי בית.", rate: "בינוני–מהיר בתנאים מתאימים." },
    propagation: { possible: true, methods: ["ייחור עם מפרק (node) במים", "ייחור במצע", "ספגנום"], text: "חותכים מתחת למפרק שיש בו שורש אווירי או ניצן. ייחור עלה בלבד בלי מפרק לא יתפתח לצמח.", rooting: "לרוב 2–6 שבועות, תלוי בחום ובאור." },
    safety: { cats: "toxic", dogs: "toxic", note: "מכיל גבישי סידן אוקסלט: גירוי בפה, ריור והקאה באכילה.", source: ASPCA },
    problems: [
      { title: "עלים מצהיבים", signs: "הצהבה מהעלים התחתונים, אדמה רטובה", fix: "לבדוק ניקוז ולתת למצע להתייבש יותר בין השקיות." },
      { title: "שוליים חומים", signs: "קצוות יבשים ופריכים", fix: "לבדוק אם האדמה מתייבשת לגמרי או אם הלחות נמוכה מאוד." },
      { title: "אקריות / תריפסים", signs: "נקודות בהירות, קורים דקים בגב העלה", fix: "לבודד, לשטוף ולטפל בהתאם לזיהוי." },
    ],
  },
  {
    id: "epipremnum-aureum", scientific: "Epipremnum aureum", he: "פוטוס", aliases: ["סינדפסוס", "Pothos", "Devil's ivy", "אפיפרמנום"],
    image: "/img/species/pothos.webp", family: "Araceae", category: "houseplant", difficulty: "קל",
    summary: "צמח מטפס או משתלשל, סלחני מאוד ומתאים למתחילים.",
    light: { ideal: ["bright_indirect", "medium"], tolerated: ["low"], text: "אור עקיף בינוני–בהיר. סובל אור נמוך.", signs: "באור נמוך הגיוון בעלים נחלש והגבעולים מתארכים." },
    water: { text: "כשהחלק העליון של המצע יבש.", over: "עלים צהובים ורכים, ריקבון בבסיס.", under: "עלים נבולים שמתאוששים אחרי השקיה." },
    checkDays: [5, 9], substrate: "מצע עציצים כללי עם תוספת פרלייט.",
    temp: { min: 13, max: 30, text: "16–30°C. רגיש לקור מתחת ל־13°C." }, humidity: "גמיש; מעדיף לחות בינונית.",
    fertilize: { text: "אביב–קיץ, אחת לחודש בריכוז מדולל.", intervalDays: 30, seasonMonths: WARM, avoid: "בחורף בדרך כלל אין צורך." },
    growth: { size: "שלוחות באורך מטרים.", rate: "מהיר." },
    propagation: { possible: true, methods: ["ייחור במים", "ייחור במצע"], text: "ייחור עם מפרק אחד לפחות. שורשים מופיעים מהמפרק.", rooting: "לרוב 1–4 שבועות." },
    safety: { cats: "toxic", dogs: "toxic", note: "סידן אוקסלט: גירוי בפה ובקיבה.", source: ASPCA },
    problems: [
      { title: "עלים צהובים", signs: "כמה עלים מצהיבים בבת אחת", fix: "לרוב עודף מים; לבדוק אדמה לפני השקיה." },
      { title: "גבעולים ארוכים ודלילים", signs: "רווחים גדולים בין עלים", fix: "להעביר למקום מואר יותר ולגזום." },
    ],
  },
  {
    id: "alocasia", scientific: "Alocasia spp.", he: "אלוקסיה", aliases: ["אוזן פיל", "Elephant ear", "Alocasia Pink Dragon"],
    image: "/img/species/alocasia.webp", family: "Araceae", category: "houseplant", difficulty: "מאתגר",
    summary: "צמח טרופי עם עלים דקורטיביים, רגיש יחסית לשינויים ולעודף מים.",
    light: { ideal: ["bright_indirect"], tolerated: ["medium"], text: "אור בהיר ועקיף, בלי שמש צהריים ישירה.", signs: "צריבה בשמש ישירה; נטייה לאור ומתיחה באור חלש." },
    water: { text: "לשמור על לחות קלה; לבדוק כשהשכבה העליונה מתחילה להתייבש.", over: "ריקבון בבסיס, עלים מצהיבים.", under: "עלים נופלים וקצוות יבשים." },
    checkDays: [3, 6], substrate: "מצע אוורירי מאוד עם קליפות ופרלייט.",
    temp: { min: 16, max: 30, text: "18–30°C; לא אוהבת קור ורוחות." }, humidity: "מעדיפה לחות גבוהה.",
    fertilize: { text: "בעונת הצמיחה, אחת ל־3–4 שבועות בריכוז נמוך.", intervalDays: 28, seasonMonths: WARM, avoid: "לא בזמן תרדמה או כשהצמח מאבד עלים." },
    growth: { size: "לרוב 40–120 ס\"מ בבית, תלוי בזן.", rate: "בינוני; לעתים נח בחורף." },
    propagation: { possible: true, methods: ["חלוקת פקעות / בצלצולים"], text: "מפרידים פקעות קטנות בזמן העברת עציץ.", rooting: "שבועות עד חודשים." },
    safety: { cats: "toxic", dogs: "toxic", note: "סידן אוקסלט; גירוי חזק בפה.", source: ASPCA },
    problems: [
      { title: "עלים נופלים בחורף", signs: "פחות עלים, צמיחה נעצרת", fix: "יכולה להיות תרדמה עונתית. להפחית השקיה ולא לדשן." },
      { title: "אקריות", signs: "נקודות וקורים דקים", fix: "לבדוק את גב העלים ולטפל לפי זיהוי." },
    ],
  },
  {
    id: "solanum-lycopersicum", scientific: "Solanum lycopersicum", he: "עגבנייה", aliases: ["עגבניה", "עגבניית שרי", "Tomato"],
    image: "/img/species/tomato.webp", family: "Solanaceae", category: "vegetable", difficulty: "בינוני",
    summary: "ירק קיצי שאוהב שמש וחום. מתאים לעציץ גדול או לגינה.",
    light: { ideal: ["direct"], tolerated: ["bright_indirect"], text: "שמש ישירה לפחות 6 שעות ביום.", signs: "צמח מתארך ופורח מעט כשחסר אור." },
    water: { text: "השקיה סדירה כשהשכבה העליונה מתייבשת; בעציץ בקיץ לעתים קרובות.", over: "עלים מצהיבים, ריקבון שורשים.", under: "נבילה, סדקים בפרי." },
    checkDays: [1, 3], substrate: "מצע עשיר ומנוקז, עציץ של 20 ליטר ומעלה לצמח אחד.",
    temp: { min: 10, max: 32, text: "18–30°C; חנטה נפגעת בחום קיצוני." }, humidity: "בינונית; אוורור טוב מפחית מחלות.",
    fertilize: { text: "בזמן צמיחה ופריחה לפי הוראות היצרן.", intervalDays: 14, seasonMonths: WARM, avoid: "עודף חנקן מעודד עלווה על חשבון פרי." },
    growth: { size: "50 ס\"מ עד 2 מטר, לפי הזן.", rate: "מהיר בעונה החמה." },
    propagation: { possible: true, methods: ["זריעה", "ייחור של חוטר צדדי במים"], text: "זריעה בעומק כ־0.5 ס\"מ; ייחורי חוטרים מכים שורש בקלות.", rooting: "נביטה בדרך כלל תוך 5–10 ימים בחום." },
    safety: { cats: "toxic", dogs: "toxic", note: "העלים והגבעולים הירוקים רעילים לחיות; הפרי הבשל נחשב פחות בעייתי.", source: ASPCA },
    problems: [
      { title: "ריקבון קצה הפרי", signs: "כתם שחור בתחתית הפרי", fix: "השקיה סדירה ואחידה; קשור לזמינות סידן." },
      { title: "כתמי עלים", signs: "כתמים חומים עם הילה צהובה", fix: "להסיר עלים נגועים ולשפר אוורור." },
    ],
  },
  {
    id: "ocimum-basilicum", scientific: "Ocimum basilicum", he: "בזיליקום", aliases: ["ריחן", "Basil"],
    image: "/img/species/basil.webp", family: "Lamiaceae", category: "herb", difficulty: "קל",
    summary: "עשב תיבול ריחני שאוהב חום ואור.",
    light: { ideal: ["direct", "bright_indirect"], tolerated: [], text: "שמש או אור בהיר מאוד, 6 שעות ומעלה.", signs: "גבעולים ארוכים ועלים קטנים כשחסר אור." },
    water: { text: "לשמור על לחות קלה; לבדוק כשהשכבה העליונה יבשה.", over: "השחרה בבסיס הגבעול.", under: "נבילה מהירה בחום." },
    checkDays: [1, 3], substrate: "מצע עשיר ומנוקז.",
    temp: { min: 12, max: 32, text: "18–30°C; רגיש מאוד לקור." }, humidity: "בינונית.",
    fertilize: { text: "דשן מאוזן מדולל כל 2–4 שבועות בעונה.", intervalDays: 21, seasonMonths: WARM, avoid: "לא בצמח שנבל מחום — קודם להשקות ולהתאושש." },
    growth: { size: "30–60 ס\"מ.", rate: "מהיר בקיץ." },
    propagation: { possible: true, methods: ["ייחור במים", "זריעה"], text: "ייחור קצה באורך 8–10 ס\"מ מכה שורש במים.", rooting: "לרוב 1–2 שבועות." },
    safety: { cats: "non_toxic", dogs: "non_toxic", note: "מופיע כלא רעיל לכלבים ולחתולים.", source: ASPCA },
    problems: [
      { title: "פריחה מוקדמת", signs: "תפרחות בקצות הענפים", fix: "לקטום תפרחות כדי לעודד עלווה." },
      { title: "כנימות", signs: "חרקים קטנים בקצוות רכים", fix: "לשטוף ולבדוק שוב בעוד כמה ימים." },
    ],
  },
  {
    id: "echeveria", scientific: "Echeveria spp.", he: "אצ'ווריה", aliases: ["סוקולנט", "אשווריה", "Echeveria"],
    image: "/img/species/echeveria.webp", family: "Crassulaceae", category: "succulent", difficulty: "קל",
    summary: "סוקולנט בצורת שושנת, אוגר מים בעלים ואוהב אור חזק.",
    light: { ideal: ["direct", "bright_indirect"], tolerated: [], text: "אור חזק, כולל כמה שעות שמש ישירה.", signs: "השושנת נפתחת ומתארכת כשחסר אור." },
    water: { text: "רק כשהמצע יבש לגמרי.", over: "עלים שקופים ורכים, ריקבון.", under: "עלים מתקמטים." },
    checkDays: [10, 18], substrate: "מצע לסוקולנטים, מנוקז מאוד, עם חול גס או פומיס.",
    temp: { min: 5, max: 35, text: "10–30°C; להגן מקרה." }, humidity: "נמוכה.",
    fertilize: { text: "מעט מאוד: פעם–פעמיים בעונה בריכוז מדולל.", intervalDays: 60, seasonMonths: [4, 5, 6, 7, 8], avoid: "לא בחורף." },
    growth: { size: "5–20 ס\"מ קוטר.", rate: "איטי." },
    propagation: { possible: true, methods: ["עלה", "שושנות צד"], text: "עלה שלם שנתלש בעדינות יכול להצמיח שושנת חדשה.", rooting: "שבועות." },
    safety: { cats: "non_toxic", dogs: "non_toxic", note: "מופיע כלא רעיל.", source: ASPCA },
    problems: [{ title: "ריקבון", signs: "עלים רכים ושחורים בבסיס", fix: "להפסיק השקיה, להסיר חלקים רקובים ולהעביר למצע יבש." }],
  },
  {
    id: "anthurium-andraeanum", scientific: "Anthurium andraeanum", he: "אנתוריום", aliases: ["פלמינגו", "Flamingo flower"],
    image: "/img/species/anthurium.webp", family: "Araceae", category: "flower", difficulty: "בינוני",
    summary: "צמח פורח טרופי עם עלי עטיף צבעוניים.",
    light: { ideal: ["bright_indirect"], tolerated: ["medium"], text: "אור בהיר ועקיף.", signs: "מעט פריחה באור חלש." },
    water: { text: "כשהשכבה העליונה יבשה; לא להשאיר מים בתחתית.", over: "שורשים רקובים, עלים צהובים.", under: "קצוות חומים." },
    checkDays: [4, 8], substrate: "מצע אוורירי לצמחי אראונים.",
    temp: { min: 15, max: 30, text: "18–28°C." }, humidity: "מעדיף לחות גבוהה.",
    fertilize: { text: "דשן מעודד פריחה בריכוז נמוך באביב–קיץ.", intervalDays: 30, seasonMonths: WARM, avoid: "לא בתקופות קור." },
    growth: { size: "30–60 ס\"מ.", rate: "בינוני." },
    propagation: { possible: true, methods: ["חלוקה"], text: "חלוקת צמח בוגר בזמן העברת עציץ." },
    safety: { cats: "toxic", dogs: "toxic", note: "סידן אוקסלט.", source: ASPCA },
    problems: [{ title: "אין פריחה", signs: "עלים בריאים בלי פרחים", fix: "לרוב חסר אור; להעביר למקום מואר יותר." }],
  },
  {
    id: "lavandula-angustifolia", scientific: "Lavandula angustifolia", he: "לבנדר", aliases: ["אזוביון", "Lavender"],
    image: "/img/interests/outdoor.webp", family: "Lamiaceae", category: "outdoor", difficulty: "בינוני",
    summary: "שיח ריחני ים־תיכוני שאוהב שמש ומצע יבש.",
    light: { ideal: ["direct"], tolerated: [], text: "שמש מלאה.", signs: "פריחה דלה וצמח רפוי בצל." },
    water: { text: "רק כשהמצע יבש; רגיש לעודף מים.", over: "השחרה וקמילה מהבסיס.", under: "נדיר בצמח מבוסס." },
    checkDays: [5, 10], substrate: "מצע דל ומנוקז מאוד.",
    temp: { min: -5, max: 38, text: "עמיד לחום; מעדיף חורף קריר." }, humidity: "נמוכה.",
    fertilize: { text: "כמעט לא נדרש.", intervalDays: null, seasonMonths: [], avoid: "דישון מוגזם מחליש ריח ופריחה." },
    growth: { size: "40–80 ס\"מ.", rate: "בינוני." },
    propagation: { possible: true, methods: ["ייחור קצה עצי־למחצה"], text: "ייחורים בסתיו או באביב במצע מנוקז." },
    safety: { cats: "toxic", dogs: "toxic", note: "עלול לגרום הקאה ובחילה באכילה.", source: ASPCA },
    problems: [{ title: "ריקבון שורשים", signs: "צמח מתייבש למרות אדמה רטובה", fix: "לשפר ניקוז ולהפחית השקיה." }],
  },
  {
    id: "dracaena-trifasciata", scientific: "Dracaena trifasciata", he: "סנסיווריה", aliases: ["לשון חמות", "Snake plant", "Sansevieria"],
    family: "Asparagaceae", category: "houseplant", difficulty: "קל",
    summary: "צמח עמיד מאוד עם עלים זקופים, סלחני להזנחה.",
    light: { ideal: ["bright_indirect", "medium"], tolerated: ["low", "direct"], text: "גמיש מאוד: מאור נמוך ועד שמש חלקית.", signs: "צמיחה איטית מאוד באור נמוך." },
    water: { text: "רק כשהמצע יבש לגמרי.", over: "בסיס רך ומצהיב — הבעיה הנפוצה ביותר.", under: "עלים מתקמטים." },
    checkDays: [12, 24], substrate: "מצע מנוקז מאוד, כמו לסוקולנטים.",
    temp: { min: 10, max: 32, text: "15–30°C." }, humidity: "נמוכה–בינונית.",
    fertilize: { text: "פעם–פעמיים בעונה.", intervalDays: 60, seasonMonths: [4, 5, 6, 7, 8], avoid: "לא בחורף." },
    growth: { size: "30–120 ס\"מ.", rate: "איטי." },
    propagation: { possible: true, methods: ["חלוקה", "ייחור עלה"], text: "ייחורי עלה עלולים לאבד את הגיוון בשוליים." },
    safety: { cats: "toxic", dogs: "toxic", note: "סאפונינים; בחילה והקאה.", source: ASPCA },
    problems: [{ title: "בסיס רך", signs: "עלים נופלים מהבסיס", fix: "סימן לעודף מים; לבדוק שורשים ולייבש." }],
  },
  {
    id: "zamioculcas-zamiifolia", scientific: "Zamioculcas zamiifolia", he: "זמיוקולקס", aliases: ["ZZ", "צמח זי זי"],
    family: "Araceae", category: "houseplant", difficulty: "קל",
    summary: "צמח עמיד עם קני שורש אוגרי מים.",
    light: { ideal: ["bright_indirect", "medium"], tolerated: ["low"], text: "אור עקיף; סובל אור נמוך.", signs: "התארכות ונטייה לכיוון האור." },
    water: { text: "רק כשהמצע יבש כמעט לגמרי.", over: "עלים צהובים, קני שורש רכים.", under: "עלים מתקמטים מעט." },
    checkDays: [10, 20], substrate: "מצע מנוקז.",
    temp: { min: 12, max: 30, text: "16–30°C." }, humidity: "גמיש.",
    fertilize: { text: "מעט בעונת הצמיחה.", intervalDays: 45, seasonMonths: WARM, avoid: "לא בחורף." },
    growth: { size: "40–90 ס\"מ.", rate: "איטי." },
    propagation: { possible: true, methods: ["חלוקה", "ייחור עלה"], text: "ייחורי עלה איטיים מאוד." },
    safety: { cats: "unknown", dogs: "unknown", note: "מכיל סידן אוקסלט כמו בני משפחתו; אין לנו מקור מאומת לסיווג.", source: null },
    problems: [{ title: "עלים מצהיבים", signs: "הצהבה עם מצע רטוב", fix: "להאריך את הזמן בין השקיות." }],
  },
  {
    id: "spathiphyllum", scientific: "Spathiphyllum spp.", he: "ספטיפיליום", aliases: ["שושנת השלום", "Peace lily"],
    family: "Araceae", category: "flower", difficulty: "קל",
    summary: "צמח פורח שמראה בבירור מתי הוא צמא.",
    light: { ideal: ["medium", "bright_indirect"], tolerated: ["low"], text: "אור עקיף בינוני.", signs: "בלי פריחה באור חלש מאוד." },
    water: { text: "כשהשכבה העליונה מתחילה להתייבש; נובל בבירור כשצמא.", over: "קצוות חומים וצהובים.", under: "נבילה דרמטית שמתאוששת מהר." },
    checkDays: [3, 7], substrate: "מצע עשיר ומנוקז.",
    temp: { min: 15, max: 30, text: "18–28°C." }, humidity: "מעדיף לחות.",
    fertilize: { text: "אחת לחודש באביב–קיץ.", intervalDays: 30, seasonMonths: WARM, avoid: "לא בחורף." },
    growth: { size: "40–70 ס\"מ.", rate: "בינוני." },
    propagation: { possible: true, methods: ["חלוקה"], text: "חלוקה בזמן העברה." },
    safety: { cats: "toxic", dogs: "toxic", note: "סידן אוקסלט.", source: ASPCA },
    problems: [{ title: "קצוות חומים", signs: "שוליים יבשים", fix: "לבדוק עודף דשן או אדמה שמתייבשת לגמרי." }],
  },
  {
    id: "chlorophytum-comosum", scientific: "Chlorophytum comosum", he: "כלורופיטום", aliases: ["צמח העכביש", "Spider plant"],
    family: "Asparagaceae", category: "houseplant", difficulty: "קל",
    summary: "צמח תלוי שמוציא צמחונים קטנים על שלוחות.",
    light: { ideal: ["bright_indirect", "medium"], tolerated: ["low"], text: "אור עקיף.", signs: "פסים חיוורים יותר באור נמוך." },
    water: { text: "כשהשכבה העליונה יבשה.", over: "ריקבון בבסיס.", under: "קצוות חומים." },
    checkDays: [5, 9], substrate: "מצע כללי מנוקז.",
    temp: { min: 8, max: 30, text: "12–28°C." }, humidity: "גמיש.",
    fertilize: { text: "אחת לחודש באביב–קיץ.", intervalDays: 30, seasonMonths: WARM, avoid: "עודף דשן גורם לקצוות חומים." },
    growth: { size: "30–60 ס\"מ, עם שלוחות.", rate: "מהיר." },
    propagation: { possible: true, methods: ["צמחונים מהשלוחות", "חלוקה"], text: "צמחון עם שורשים קטנים מכה שורש במים או במצע.", rooting: "1–3 שבועות." },
    safety: { cats: "non_toxic", dogs: "non_toxic", note: "מופיע כלא רעיל.", source: ASPCA },
    problems: [{ title: "קצוות חומים", signs: "חום בקצות העלים", fix: "לבדוק עודף מלחים/דשן ותדירות בדיקת אדמה." }],
  },
  {
    id: "aloe-vera", scientific: "Aloe vera", he: "אלוורה", aliases: ["אלווה", "Aloe"],
    family: "Asphodelaceae", category: "succulent", difficulty: "קל",
    summary: "סוקולנט עם עלים בשרניים, אוהב אור חזק.",
    light: { ideal: ["direct", "bright_indirect"], tolerated: [], text: "אור חזק, שמש חלקית.", signs: "עלים שטוחים ונוטים באור חלש." },
    water: { text: "רק כשהמצע יבש לגמרי.", over: "עלים רכים ושקופים.", under: "עלים דקים ומקומטים." },
    checkDays: [12, 24], substrate: "מצע לסוקולנטים.",
    temp: { min: 5, max: 35, text: "10–30°C." }, humidity: "נמוכה.",
    fertilize: { text: "פעם–פעמיים בעונה.", intervalDays: 60, seasonMonths: [4, 5, 6, 7, 8], avoid: "לא בחורף." },
    growth: { size: "30–60 ס\"מ.", rate: "איטי–בינוני." },
    propagation: { possible: true, methods: ["צמחוני בסיס"], text: "מפרידים צמחונים עם שורשים." },
    safety: { cats: "toxic", dogs: "toxic", note: "עלול לגרום הקאה ושלשול.", source: ASPCA },
    problems: [{ title: "עלים חומים", signs: "צריבה אחרי מעבר חד לשמש", fix: "להרגיל בהדרגה לשמש." }],
  },
  {
    id: "mentha", scientific: "Mentha spp.", he: "נענע", aliases: ["מנטה", "Mint"],
    family: "Lamiaceae", category: "herb", difficulty: "קל",
    summary: "עשב תיבול נמרץ שאוהב לחות.",
    light: { ideal: ["bright_indirect", "direct"], tolerated: ["medium"], text: "שמש חלקית או אור בהיר.", signs: "גבעולים דלילים באור חלש." },
    water: { text: "לשמור על מצע לח מעט.", over: "ריקבון בבסיס.", under: "נבילה מהירה." },
    checkDays: [1, 3], substrate: "מצע עשיר.",
    temp: { min: 5, max: 32, text: "15–28°C." }, humidity: "בינונית.",
    fertilize: { text: "מעט, בעונת הצמיחה.", intervalDays: 30, seasonMonths: WARM, avoid: "עודף דשן מחליש ריח." },
    growth: { size: "30–60 ס\"מ, מתפשט.", rate: "מהיר." },
    propagation: { possible: true, methods: ["ייחור במים", "חלוקה"], text: "ייחורים מכים שורש בקלות במים.", rooting: "1–2 שבועות." },
    safety: { cats: "toxic", dogs: "toxic", note: "מופיע כרעיל באכילת כמות.", source: ASPCA },
    problems: [{ title: "חלודה", signs: "נקודות כתומות בגב העלה", fix: "להסיר עלים נגועים ולשפר אוורור." }],
  },
];

export const speciesById = (id: string | null | undefined): Species | undefined => SPECIES.find((s) => s.id === id);

const norm = (s: string) => s.toLowerCase().replace(/[֑-ׇ'"׳״\-\s.]/g, "");

/** Search by Hebrew/common/scientific/alias names (never by personal nickname). */
export function searchSpecies(q: string): Species[] {
  const n = norm(q);
  if (!n) return SPECIES;
  return SPECIES.filter((s) => [s.he, s.scientific, ...s.aliases].some((name) => norm(name).includes(n)));
}

export const LIGHT_LABEL: Record<LightCat, string> = {
  low: "אור נמוך",
  medium: "אור בינוני",
  bright_indirect: "אור בהיר עקיף",
  direct: "שמש ישירה",
};

/** Light fit for a location category: never blocks, only explains. */
export function lightFit(sp: Species | undefined, cat: LightCat | null | undefined): "fit" | "tolerated" | "poor" | null {
  if (!sp || !cat) return null;
  if (sp.light.ideal.includes(cat)) return "fit";
  if (sp.light.tolerated.includes(cat)) return "tolerated";
  return "poor";
}
