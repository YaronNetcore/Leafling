#!/usr/bin/env python3
"""Builds public/catalog/plants-core-v1.json — Leafling's general plant catalog pack (editorial draft).

Data, not code: the app loads packs listed in public/catalog/index.json at runtime and validates every entry
(src/shared/catalog.ts). More validated species are imported by adding entries/packs — no app code changes.

Provenance (honest): compiled by the Leafling editor from general, widely published horticultural knowledge;
NOT yet verified against a primary source. Fields that are not known are simply left out (never guessed).
Pet toxicity is filled in only where the ASPCA toxic/non-toxic plant list covers the plant ("T"/"N");
everything else is "unknown". Images: none in this pack (licensed images can be added per entry with
url/license/author/source); the app shows a botanical placeholder per plant group instead.
"""
import json, os, re

OUT = os.path.join(os.path.dirname(__file__), "../../public/catalog")
L = {"L": "low", "M": "medium", "B": "bright_indirect", "D": "direct"}
WATER = {"moist": "moist", "top": "top_dry", "half": "half_dry", "dry": "dry"}
HUM = {"low": "low", "med": "medium", "high": "high"}
SUB = {"aroid": "aroid", "gen": "general", "grit": "gritty", "orch": "orchid_bark", "moist": "moisture_retentive", "veg": "rich_garden", "peat": "peat_free_acidic", "mount": "mounted"}
WHERE = {"in": "indoor", "out": "outdoor", "both": "both"}
LIFE = {"per": "perennial", "ann": "annual", "bi": "biennial"}
PROP = {"cw": "stem_cutting_water", "cs": "stem_cutting_soil", "leaf": "leaf_cutting", "div": "division", "off": "offsets",
        "seed": "seed", "air": "air_layering", "tuber": "tuber", "bulb": "bulb", "run": "runners", "spore": "spores",
        "keiki": "keiki", "pad": "pad_cutting", "rhiz": "rhizome", "clove": "cloves", "graft": "grafting"}
TOX = {"T": ("toxic", "toxic"), "N": ("non_toxic", "non_toxic"), "?": ("unknown", "unknown")}

entries = []
def E(id, sci, he, en, fam, cat, grp, light=None, water=None, hum=None, tmin=None, sub=None, where=None, life="per",
      prop=(), tox="?", syn=(), heAlt=(), cultivar=None, parent=None, sow=None, note=None, genus=None, species=None):
    g = genus or sci.replace("×", "").split()[0]
    sp = species
    if sp is None and not cultivar and len(sci.split()) >= 2 and not sci.endswith("spp."):
        parts = sci.replace("× ", "").split()
        sp = parts[1] if len(parts) > 1 and parts[1].islower() else None
    care = {}
    if light: care["light"] = [L[c] for c in light]
    if water: care["water"] = WATER[water]
    if hum: care["humidity"] = HUM[hum]
    if tmin is not None: care["tempMinC"] = tmin
    if sub: care["substrate"] = SUB[sub]
    if where: care["where"] = WHERE[where]
    if life: care["lifecycle"] = LIFE[life]
    if prop: care["propagation"] = [PROP[p] for p in prop]
    if sow: care["sowing"] = {"depth": sow[0], "germDays": list(sow[1]), "tempC": list(sow[2])}
    e = {"id": id, "scientific": sci, "genus": g, "family": fam, "he": he, "category": cat, "group": grp, "care": care}
    if sp: e["species"] = sp
    if cultivar: e["cultivar"] = cultivar
    if parent: e["parent"] = parent
    if syn: e["synonyms"] = list(syn)
    if heAlt: e["heAlt"] = list(heAlt)
    if en: e["en"] = list(en)
    c, d = TOX[tox]
    e["toxicity"] = {"cats": c, "dogs": d, "source": "ASPCA" if tox in ("T", "N") else None}
    if note: e["note"] = note
    entries.append(e)

A = "Araceae"
# ---------------- Aroids ----------------
E("monstera-adansonii", "Monstera adansonii", "מונסטרה אדנסוני", ["Swiss cheese vine", "Adanson's monstera"], A, "houseplant", "aroid", "MB", "top", "high", 15, "aroid", "in", prop=("cw", "cs"), tox="T", syn=("Monstera friedrichsthalii",))
E("monstera-deliciosa-thai-constellation", "Monstera deliciosa 'Thai Constellation'", "מונסטרה תאי קונסטליישן", ["Thai Constellation monstera"], A, "houseplant", "aroid", "B", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Thai Constellation", parent="monstera-deliciosa", genus="Monstera", species="deliciosa")
E("monstera-deliciosa-albo", "Monstera deliciosa 'Albo Variegata'", "מונסטרה אלבו", ["Albo monstera"], A, "houseplant", "aroid", "B", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Albo Variegata", parent="monstera-deliciosa", genus="Monstera", species="deliciosa", note="חלקים לבנים לגמרי בעלה אינם עושים פוטוסינתזה — הצמח צריך אור בהיר יותר וגדל לאט יותר.")
E("monstera-standleyana", "Monstera standleyana", "מונסטרה סטנדליאנה", ["Five holes plant"], A, "houseplant", "aroid", "MB", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T")
E("monstera-siltepecana", "Monstera siltepecana", "מונסטרה סילטפקנה", ["Silver monstera"], A, "houseplant", "aroid", "MB", "top", "high", 15, "aroid", "in", prop=("cw", "cs"), tox="T")
E("monstera-obliqua", "Monstera obliqua", "מונסטרה אובליקווה", [], A, "houseplant", "aroid", "MB", "moist", "high", 18, "aroid", "in", prop=("cs",), tox="T", note="נדירה מאוד ועדינה; צמחים שנמכרים בשם הזה הם לעיתים קרובות מונסטרה אדנסוני.")
E("philodendron-hederaceum", "Philodendron hederaceum", "פילודנדרון לב", ["Heartleaf philodendron"], A, "houseplant", "aroid", "MB", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", syn=("Philodendron scandens", "Philodendron oxycardium"), heAlt=("פילודנדרון מטפס",))
E("philodendron-hederaceum-brasil", "Philodendron hederaceum 'Brasil'", "פילודנדרון ברזיל", ["Philodendron Brasil"], A, "houseplant", "aroid", "MB", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Brasil", parent="philodendron-hederaceum", genus="Philodendron", species="hederaceum")
E("philodendron-micans", "Philodendron hederaceum var. hederaceum 'Micans'", "פילודנדרון מיקנס", ["Velvet leaf philodendron"], A, "houseplant", "aroid", "MB", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Micans", parent="philodendron-hederaceum", genus="Philodendron", species="hederaceum")
E("philodendron-birkin", "Philodendron 'Birkin'", "פילודנדרון בירקין", [], A, "houseplant", "aroid", "MB", "top", "med", 15, "aroid", "in", prop=("cs",), tox="T", cultivar="Birkin", genus="Philodendron")
E("philodendron-pink-princess", "Philodendron erubescens 'Pink Princess'", "פילודנדרון פינק פרינסס", ["Pink princess philodendron"], A, "houseplant", "aroid", "B", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Pink Princess", parent="philodendron-erubescens", genus="Philodendron", species="erubescens")
E("philodendron-erubescens", "Philodendron erubescens", "פילודנדרון ארובסנס", ["Blushing philodendron"], A, "houseplant", "aroid", "MB", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T")
E("philodendron-gloriosum", "Philodendron gloriosum", "פילודנדרון גלוריוסום", [], A, "houseplant", "aroid", "MB", "top", "high", 16, "aroid", "in", prop=("cs", "rhiz"), tox="T", note="צמח זוחל: הגבעול צריך לשכב על המצע ולא להיקבר בו.")
E("philodendron-melanochrysum", "Philodendron melanochrysum", "פילודנדרון מלנוכריסום", ["Black gold philodendron"], A, "houseplant", "aroid", "MB", "top", "high", 16, "aroid", "in", prop=("cs",), tox="T")
E("philodendron-squamiferum", "Philodendron squamiferum", "פילודנדרון סקוואמיפרום", [], A, "houseplant", "aroid", "MB", "top", "high", 16, "aroid", "in", prop=("cs",), tox="T")
E("philodendron-verrucosum", "Philodendron verrucosum", "פילודנדרון ורוקוזום", [], A, "houseplant", "aroid", "M", "moist", "high", 16, "aroid", "in", prop=("cs",), tox="T")
E("philodendron-hastatum", "Philodendron hastatum", "פילודנדרון האסטטום", ["Silver sword philodendron"], A, "houseplant", "aroid", "MB", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T")
E("philodendron-brandtianum", "Philodendron brandtianum", "פילודנדרון ברנדטיאנום", [], A, "houseplant", "aroid", "MB", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T")
E("thaumatophyllum-bipinnatifidum", "Thaumatophyllum bipinnatifidum", "פילודנדרון סלואום", ["Tree philodendron", "Lacy tree philodendron"], A, "houseplant", "aroid", "MBD", "top", "med", 5, "aroid", "both", prop=("seed", "cs"), tox="T", syn=("Philodendron bipinnatifidum", "Philodendron selloum"))
E("thaumatophyllum-xanadu", "Thaumatophyllum xanadu", "פילודנדרון קסנדו", ["Xanadu philodendron"], A, "houseplant", "aroid", "MB", "top", "med", 8, "aroid", "both", prop=("div",), tox="T", syn=("Philodendron xanadu",))
E("epipremnum-aureum-marble-queen", "Epipremnum aureum 'Marble Queen'", "פוטוס מרבל קווין", ["Marble queen pothos"], A, "houseplant", "aroid", "MB", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Marble Queen", parent="epipremnum-aureum", genus="Epipremnum", species="aureum")
E("epipremnum-aureum-neon", "Epipremnum aureum 'Neon'", "פוטוס ניאון", ["Neon pothos"], A, "houseplant", "aroid", "MB", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Neon", parent="epipremnum-aureum", genus="Epipremnum", species="aureum")
E("epipremnum-aureum-manjula", "Epipremnum aureum 'Manjula'", "פוטוס מנג'ולה", ["Manjula pothos"], A, "houseplant", "aroid", "B", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Manjula", parent="epipremnum-aureum", genus="Epipremnum", species="aureum")
E("epipremnum-aureum-njoy", "Epipremnum aureum 'N'Joy'", "פוטוס אנג'וי", ["N'Joy pothos"], A, "houseplant", "aroid", "B", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="N'Joy", parent="epipremnum-aureum", genus="Epipremnum", species="aureum")
E("epipremnum-pinnatum", "Epipremnum pinnatum", "אפיפרמנום פינטום", ["Dragon tail plant"], A, "houseplant", "aroid", "MB", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T")
E("epipremnum-pinnatum-cebu-blue", "Epipremnum pinnatum 'Cebu Blue'", "פוטוס סבו בלו", ["Cebu blue pothos"], A, "houseplant", "aroid", "MB", "top", "med", 13, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Cebu Blue", parent="epipremnum-pinnatum", genus="Epipremnum", species="pinnatum")
E("scindapsus-pictus", "Scindapsus pictus", "סינדפסוס פיקטוס", ["Satin pothos", "Silver philodendron"], A, "houseplant", "aroid", "MB", "half", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", heAlt=("פוטוס כסוף",))
E("rhaphidophora-tetrasperma", "Rhaphidophora tetrasperma", "רפידופורה טטרספרמה", ["Mini monstera"], A, "houseplant", "aroid", "MB", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", heAlt=("מיני מונסטרה",))
E("syngonium-podophyllum", "Syngonium podophyllum", "סינגוניום", ["Arrowhead plant", "Arrowhead vine"], A, "houseplant", "aroid", "MB", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", heAlt=("סינגוניום פודופילום",))
E("syngonium-podophyllum-neon-robusta", "Syngonium podophyllum 'Neon Robusta'", "סינגוניום ורוד", ["Pink syngonium"], A, "houseplant", "aroid", "B", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Neon Robusta", parent="syngonium-podophyllum", genus="Syngonium", species="podophyllum")
E("syngonium-podophyllum-albo", "Syngonium podophyllum 'Albo Variegatum'", "סינגוניום אלבו", [], A, "houseplant", "aroid", "B", "top", "med", 15, "aroid", "in", prop=("cw", "cs"), tox="T", cultivar="Albo Variegatum", parent="syngonium-podophyllum", genus="Syngonium", species="podophyllum")
E("syngonium-wendlandii", "Syngonium wendlandii", "סינגוניום וונדלנדי", [], A, "houseplant", "aroid", "M", "top", "high", 16, "aroid", "in", prop=("cw", "cs"), tox="T")
E("anthurium-clarinervium", "Anthurium clarinervium", "אנתוריום קלרינרביום", ["Velvet cardboard anthurium"], A, "houseplant", "aroid", "MB", "top", "high", 16, "aroid", "in", prop=("div", "seed"), tox="T")
E("anthurium-crystallinum", "Anthurium crystallinum", "אנתוריום קריסטלינום", ["Crystal anthurium"], A, "houseplant", "aroid", "MB", "top", "high", 16, "aroid", "in", prop=("div", "seed"), tox="T")
E("anthurium-warocqueanum", "Anthurium warocqueanum", "אנתוריום ורוקאנום", ["Queen anthurium"], A, "houseplant", "aroid", "M", "moist", "high", 18, "aroid", "in", prop=("cs", "seed"), tox="T", note="דורש לחות אוויר גבוהה מאוד; מתאים לרוב לוויטרינה או לחממה ביתית.")
E("anthurium-veitchii", "Anthurium veitchii", "אנתוריום וייצ'י", ["King anthurium"], A, "houseplant", "aroid", "MB", "moist", "high", 18, "aroid", "in", prop=("cs", "seed"), tox="T")
E("anthurium-scherzerianum", "Anthurium scherzerianum", "אנתוריום שרצריאנום", ["Flamingo flower"], A, "flower", "aroid", "MB", "top", "high", 15, "aroid", "in", prop=("div",), tox="T")
E("alocasia-amazonica-polly", "Alocasia × amazonica 'Polly'", "אלוקסיה פולי", ["African mask plant", "Alocasia Polly"], A, "houseplant", "aroid", "B", "top", "high", 16, "aroid", "in", prop=("tuber", "div"), tox="T", cultivar="Polly", parent="alocasia", genus="Alocasia", heAlt=("אלוקסיה אמזוניקה",), note="מאבדת עלים בחורף או אחרי שינוי — לעיתים זו תרדמה ולא מחלה; לבדוק את הפקעת לפני שמוותרים.")
E("alocasia-baginda-dragon-scale", "Alocasia baginda 'Dragon Scale'", "אלוקסיה דרגון סקייל", ["Dragon scale alocasia"], A, "houseplant", "aroid", "B", "top", "high", 17, "aroid", "in", prop=("tuber", "div"), tox="T", cultivar="Dragon Scale", parent="alocasia", genus="Alocasia", species="baginda")
E("alocasia-cuprea", "Alocasia cuprea", "אלוקסיה קופריאה", ["Red secret alocasia", "Mirror plant"], A, "houseplant", "aroid", "MB", "top", "high", 17, "aroid", "in", prop=("tuber", "div"), tox="T", parent="alocasia")
E("alocasia-zebrina", "Alocasia zebrina", "אלוקסיה זברינה", ["Zebra alocasia"], A, "houseplant", "aroid", "B", "top", "high", 16, "aroid", "in", prop=("tuber", "div"), tox="T", parent="alocasia")
E("alocasia-frydek", "Alocasia micholitziana 'Frydek'", "אלוקסיה פרידק", ["Green velvet alocasia"], A, "houseplant", "aroid", "B", "top", "high", 17, "aroid", "in", prop=("tuber", "div"), tox="T", cultivar="Frydek", parent="alocasia", genus="Alocasia", species="micholitziana")
E("alocasia-macrorrhizos", "Alocasia macrorrhizos", "אלוקסיה מקרוריזוס", ["Giant taro", "Elephant ear"], A, "houseplant", "aroid", "BD", "top", "med", 10, "aroid", "both", prop=("off", "div"), tox="T", parent="alocasia")
E("alocasia-odora", "Alocasia odora", "אלוקסיה אודורה", ["Night-scented lily", "Elephant ear"], A, "houseplant", "aroid", "BD", "top", "med", 8, "aroid", "both", prop=("off", "div"), tox="T", parent="alocasia")
E("alocasia-pink-dragon", "Alocasia 'Pink Dragon'", "אלוקסיה פינק דרגון", ["Pink dragon alocasia"], A, "houseplant", "aroid", "B", "top", "high", 16, "aroid", "in", prop=("tuber", "div"), tox="T", cultivar="Pink Dragon", parent="alocasia", genus="Alocasia")
E("alocasia-black-velvet", "Alocasia reginula 'Black Velvet'", "אלוקסיה בלאק ולווט", ["Black velvet alocasia"], A, "houseplant", "aroid", "M", "top", "high", 17, "aroid", "in", prop=("tuber", "div"), tox="T", cultivar="Black Velvet", parent="alocasia", genus="Alocasia", species="reginula")
E("alocasia-wentii", "Alocasia wentii", "אלוקסיה ונטי", ["Hardy elephant ear"], A, "houseplant", "aroid", "MB", "top", "med", 10, "aroid", "both", prop=("tuber", "div"), tox="T", parent="alocasia")
E("colocasia-esculenta", "Colocasia esculenta", "קולוקסיה", ["Taro", "Elephant ear"], A, "outdoor", "aroid", "BD", "moist", "high", 10, "moist", "both", prop=("tuber", "div"), tox="T", heAlt=("טארו", "קולקסיה"))
E("caladium-bicolor", "Caladium bicolor", "קלדיום", ["Angel wings", "Elephant ear"], A, "houseplant", "aroid", "MB", "top", "high", 16, "aroid", "both", prop=("tuber",), tox="T", syn=("Caladium × hortulanum",), note="נכנס לתרדמה בחורף: העלים מתייבשים והפקעת נשמרת יבשה עד האביב.")
E("aglaonema-commutatum", "Aglaonema commutatum", "אגלאונמה", ["Chinese evergreen"], A, "houseplant", "aroid", "LM", "half", "med", 15, "gen", "in", prop=("div", "cs"), tox="T")
E("aglaonema-siam-aurora", "Aglaonema 'Siam Aurora'", "אגלאונמה אדומה", ["Red aglaonema"], A, "houseplant", "aroid", "MB", "half", "med", 16, "gen", "in", prop=("div", "cs"), tox="T", cultivar="Siam Aurora", genus="Aglaonema")
E("dieffenbachia-seguine", "Dieffenbachia seguine", "דיפנבכיה", ["Dumb cane"], A, "houseplant", "aroid", "MB", "top", "med", 15, "gen", "in", prop=("cs", "cw"), tox="T", syn=("Dieffenbachia maculata", "Dieffenbachia picta"))
E("zamioculcas-zamiifolia-raven", "Zamioculcas zamiifolia 'Raven'", "זמיוקולקס רייבן", ["Raven ZZ plant"], A, "houseplant", "aroid", "LMB", "dry", "low", 10, "grit", "in", prop=("leaf", "div", "rhiz"), tox="T", cultivar="Raven", parent="zamioculcas-zamiifolia", genus="Zamioculcas", species="zamiifolia")

# ---------------- Marantaceae (prayer plants) ----------------
M = "Marantaceae"
E("goeppertia-orbifolia", "Goeppertia orbifolia", "קלתאה אורביפוליה", ["Calathea orbifolia"], M, "houseplant", "marantaceae", "M", "moist", "high", 16, "moist", "in", prop=("div",), tox="N", syn=("Calathea orbifolia",), note="רגישה למים קשים ולאוויר יבש: קצוות חומים הם סימן נפוץ.")
E("goeppertia-makoyana", "Goeppertia makoyana", "קלתאה מקויאנה", ["Peacock plant"], M, "houseplant", "marantaceae", "LM", "moist", "high", 16, "moist", "in", prop=("div",), tox="N", syn=("Calathea makoyana",))
E("goeppertia-insignis", "Goeppertia insignis", "קלתאה לנציפוליה", ["Rattlesnake plant"], M, "houseplant", "marantaceae", "M", "moist", "high", 16, "moist", "in", prop=("div",), tox="N", syn=("Calathea lancifolia", "Goeppertia lancifolia"))
E("goeppertia-roseopicta", "Goeppertia roseopicta", "קלתאה רוזאופיקטה", ["Rose-painted calathea"], M, "houseplant", "marantaceae", "M", "moist", "high", 16, "moist", "in", prop=("div",), tox="N", syn=("Calathea roseopicta",))
E("goeppertia-ornata", "Goeppertia ornata", "קלתאה אורנטה", ["Pinstripe calathea"], M, "houseplant", "marantaceae", "M", "moist", "high", 16, "moist", "in", prop=("div",), tox="N", syn=("Calathea ornata",))
E("goeppertia-zebrina", "Goeppertia zebrina", "קלתאה זברינה", ["Zebra plant"], M, "houseplant", "marantaceae", "M", "moist", "high", 16, "moist", "in", prop=("div",), tox="N", syn=("Calathea zebrina",))
E("maranta-leuconeura", "Maranta leuconeura", "מרנטה", ["Prayer plant"], M, "houseplant", "marantaceae", "M", "moist", "high", 15, "moist", "in", prop=("cw", "cs", "div"), tox="N", heAlt=("צמח התפילה",))
E("maranta-leuconeura-fascinator", "Maranta leuconeura 'Fascinator'", "מרנטה אדומה", ["Red prayer plant"], M, "houseplant", "marantaceae", "M", "moist", "high", 15, "moist", "in", prop=("cw", "cs", "div"), tox="N", cultivar="Fascinator", parent="maranta-leuconeura", genus="Maranta", species="leuconeura")
E("ctenanthe-burle-marxii", "Ctenanthe burle-marxii", "קטננטה", ["Fishbone prayer plant"], M, "houseplant", "marantaceae", "M", "moist", "high", 16, "moist", "in", prop=("div",), species="burle-marxii")
E("stromanthe-thalia-triostar", "Stromanthe thalia 'Triostar'", "סטרומנטה טריוסטאר", ["Stromanthe Triostar"], M, "houseplant", "marantaceae", "MB", "moist", "high", 16, "moist", "in", prop=("div",), syn=("Stromanthe sanguinea 'Triostar'",), cultivar="Triostar", genus="Stromanthe", species="thalia")

# ---------------- Ficus ----------------
F = "Moraceae"
E("ficus-lyrata", "Ficus lyrata", "פיקוס כינורי", ["Fiddle-leaf fig"], F, "houseplant", "ficus", "BD", "top", "med", 13, "gen", "in", prop=("air", "cs"), tox="T", note="לא אוהב שינויי מקום: אחרי הזזה נשירת עלים זמנית שכיחה.")
E("ficus-elastica", "Ficus elastica", "פיקוס גומי", ["Rubber plant", "Rubber fig"], F, "houseplant", "ficus", "MB", "half", "med", 10, "gen", "in", prop=("air", "cs"), tox="T")
E("ficus-elastica-tineke", "Ficus elastica 'Tineke'", "פיקוס גומי טינקה", ["Tineke rubber plant"], F, "houseplant", "ficus", "B", "half", "med", 12, "gen", "in", prop=("air", "cs"), tox="T", cultivar="Tineke", parent="ficus-elastica", genus="Ficus", species="elastica")
E("ficus-elastica-burgundy", "Ficus elastica 'Burgundy'", "פיקוס גומי בורגונדי", ["Burgundy rubber plant"], F, "houseplant", "ficus", "MB", "half", "med", 10, "gen", "in", prop=("air", "cs"), tox="T", cultivar="Burgundy", parent="ficus-elastica", genus="Ficus", species="elastica")
E("ficus-benjamina", "Ficus benjamina", "פיקוס בנימינה", ["Weeping fig"], F, "houseplant", "ficus", "B", "top", "med", 12, "gen", "both", prop=("cs", "air"), tox="T")
E("ficus-microcarpa", "Ficus microcarpa", "פיקוס מיקרוקרפה", ["Chinese banyan", "Ginseng ficus"], F, "houseplant", "ficus", "BD", "top", "med", 5, "gen", "both", prop=("cs", "air"), tox="T", heAlt=("פיקוס גינסנג",))
E("ficus-pumila", "Ficus pumila", "פיקוס מטפס", ["Creeping fig"], F, "houseplant", "ficus", "MB", "moist", "med", 5, "gen", "both", prop=("cs",), tox="T")
E("ficus-altissima", "Ficus altissima", "פיקוס אלטיסימה", ["Council tree"], F, "houseplant", "ficus", "B", "top", "med", 10, "gen", "in", prop=("cs", "air"), tox="T")
E("ficus-carica", "Ficus carica", "תאנה", ["Common fig"], F, "fruit", "fruit", "D", "half", "low", -10, "gen", "out", prop=("cs",), tox="T")

# ---------------- Dracaena & relatives ----------------
D = "Asparagaceae"
E("dracaena-fragrans", "Dracaena fragrans", "דרצנה ריחנית", ["Corn plant"], D, "houseplant", "dracaena", "LMB", "half", "med", 13, "gen", "in", prop=("cs",), tox="T", heAlt=("דרצנה מסנג'יאנה",))
E("dracaena-fragrans-compacta", "Dracaena fragrans 'Compacta'", "דרצנה קומפקטה", [], D, "houseplant", "dracaena", "LMB", "half", "med", 13, "gen", "in", prop=("cs",), tox="T", cultivar="Compacta", parent="dracaena-fragrans", genus="Dracaena", species="fragrans")
E("dracaena-marginata", "Dracaena reflexa var. angustifolia", "דרצנה מרגינטה", ["Dragon tree", "Madagascar dragon tree"], D, "houseplant", "dracaena", "MB", "half", "low", 10, "gen", "in", prop=("cs",), tox="T", syn=("Dracaena marginata",), species="reflexa")
E("dracaena-reflexa", "Dracaena reflexa", "דרצנה רפלקסה", ["Song of India"], D, "houseplant", "dracaena", "MB", "half", "med", 13, "gen", "in", prop=("cs",), tox="T")
E("dracaena-sanderiana", "Dracaena sanderiana", "במבוק המזל", ["Lucky bamboo"], D, "houseplant", "dracaena", "M", "moist", "med", 15, None, "in", prop=("cw",), tox="T", note="אם גדל במים: להחליף מים כל שבוע–שבועיים, עדיף מים מסוננים.")
E("dracaena-trifasciata-laurentii", "Dracaena trifasciata 'Laurentii'", "סנסווריה לורנטי", ["Variegated snake plant"], D, "houseplant", "sansevieria", "LMBD", "dry", "low", 10, "grit", "in", prop=("div", "rhiz"), tox="T", syn=("Sansevieria trifasciata 'Laurentii'",), cultivar="Laurentii", parent="dracaena-trifasciata", genus="Dracaena", species="trifasciata", note="ייחור עלה של זן מגוון נוטה לאבד את הפס הצהוב — חלוקה שומרת עליו.")
E("dracaena-trifasciata-hahnii", "Dracaena trifasciata 'Hahnii'", "סנסווריה הני", ["Bird's nest snake plant"], D, "houseplant", "sansevieria", "LMB", "dry", "low", 10, "grit", "in", prop=("div", "leaf"), tox="T", syn=("Sansevieria trifasciata 'Hahnii'",), cultivar="Hahnii", parent="dracaena-trifasciata", genus="Dracaena", species="trifasciata")
E("dracaena-angolensis", "Dracaena angolensis", "סנסווריה גלילית", ["Cylindrical snake plant"], D, "houseplant", "sansevieria", "MBD", "dry", "low", 10, "grit", "in", prop=("div", "leaf"), tox="T", syn=("Sansevieria cylindrica",))
E("dracaena-masoniana", "Dracaena masoniana", "סנסווריה מסוניאנה", ["Whale fin snake plant"], D, "houseplant", "sansevieria", "LMB", "dry", "low", 10, "grit", "in", prop=("div", "rhiz"), tox="T", syn=("Sansevieria masoniana",))
E("cordyline-fruticosa", "Cordyline fruticosa", "קורדילינה", ["Ti plant"], D, "houseplant", "dracaena", "B", "top", "high", 13, "gen", "both", prop=("cs",), tox="T")
E("beaucarnea-recurvata", "Beaucarnea recurvata", "בוקרניאה", ["Ponytail palm", "Elephant's foot"], D, "houseplant", "succulent", "BD", "dry", "low", 5, "grit", "both", prop=("seed", "off"), tox="N", syn=("Nolina recurvata",), heAlt=("רגל פיל", "נולינה"))
E("yucca-gigantea", "Yucca gigantea", "יוקה", ["Spineless yucca"], D, "houseplant", "dracaena", "BD", "dry", "low", 0, "grit", "both", prop=("cs", "off"), tox="T", syn=("Yucca elephantipes",))
E("aspidistra-elatior", "Aspidistra elatior", "אספידיסטרה", ["Cast iron plant"], D, "houseplant", "foliage", "LM", "half", "low", 2, "gen", "both", prop=("div", "rhiz"), tox="N")
E("asparagus-setaceus", "Asparagus setaceus", "אספרגוס נוצתי", ["Asparagus fern", "Lace fern"], D, "houseplant", "foliage", "MB", "top", "med", 7, "gen", "both", prop=("div", "seed"), tox="T", syn=("Asparagus plumosus",), heAlt=("אספרגוס שרכי",), note="למרות השם — אינו שרך.")
E("asparagus-densiflorus-sprengeri", "Asparagus densiflorus 'Sprengeri'", "אספרגוס ספרנגרי", ["Foxtail fern", "Sprenger's asparagus"], D, "houseplant", "foliage", "MBD", "top", "low", 2, "gen", "both", prop=("div", "seed"), tox="T", cultivar="Sprengeri", genus="Asparagus", species="densiflorus")

# ---------------- Hoya ----------------
H = "Apocynaceae"
E("hoya-carnosa", "Hoya carnosa", "הויה", ["Wax plant"], H, "houseplant", "hoya", "MB", "half", "med", 10, "orch", "in", prop=("cw", "cs"), tox="N", heAlt=("שעוונית",), note="לא לחתוך את גבעולי הפריחה הישנים — פרחים חדשים יוצאים מהם שוב.")
E("hoya-carnosa-krimson-queen", "Hoya carnosa 'Krimson Queen'", "הויה קרימסון קווין", [], H, "houseplant", "hoya", "B", "half", "med", 10, "orch", "in", prop=("cw", "cs"), tox="N", cultivar="Krimson Queen", parent="hoya-carnosa", genus="Hoya", species="carnosa")
E("hoya-carnosa-compacta", "Hoya carnosa 'Compacta'", "הויה קומפקטה", ["Hindu rope"], H, "houseplant", "hoya", "B", "dry", "med", 10, "orch", "in", prop=("cs",), tox="N", cultivar="Compacta", parent="hoya-carnosa", genus="Hoya", species="carnosa")
E("hoya-kerrii", "Hoya kerrii", "הויה קרי", ["Sweetheart hoya"], H, "houseplant", "hoya", "B", "dry", "med", 13, "orch", "in", prop=("cs",), heAlt=("הויה לב",), note="עלה בודד בעציץ לרוב לא יצמיח צמח — צריך גבעול עם מפרק.")
E("hoya-pubicalyx", "Hoya pubicalyx", "הויה פוביקליקס", [], H, "houseplant", "hoya", "B", "half", "med", 10, "orch", "in", prop=("cw", "cs"))
E("hoya-linearis", "Hoya linearis", "הויה לינאריס", [], H, "houseplant", "hoya", "MB", "top", "high", 10, "orch", "in", prop=("cs",))
E("hoya-australis", "Hoya australis", "הויה אוסטרליס", [], H, "houseplant", "hoya", "B", "half", "med", 10, "orch", "in", prop=("cw", "cs"))
E("ceropegia-woodii", "Ceropegia woodii", "מחרוזת לבבות", ["String of hearts"], H, "houseplant", "succulent", "B", "dry", "low", 10, "grit", "in", prop=("cs", "tuber"), heAlt=("צרופגיה",))

# ---------------- Peperomia & Pilea ----------------
P = "Piperaceae"
E("peperomia-obtusifolia", "Peperomia obtusifolia", "פפרומיה אובטוסיפוליה", ["Baby rubber plant"], P, "houseplant", "peperomia", "MB", "half", "med", 13, "grit", "in", prop=("cs", "leaf"), tox="N")
E("peperomia-argyreia", "Peperomia argyreia", "פפרומיה אבטיח", ["Watermelon peperomia"], P, "houseplant", "peperomia", "MB", "half", "med", 15, "grit", "in", prop=("leaf",), tox="N")
E("peperomia-caperata", "Peperomia caperata", "פפרומיה קפרטה", ["Emerald ripple peperomia"], P, "houseplant", "peperomia", "M", "half", "med", 15, "grit", "in", prop=("leaf",), tox="N")
E("peperomia-prostrata", "Peperomia prostrata", "פפרומיה פרוסטרטה", ["String of turtles"], P, "houseplant", "peperomia", "M", "half", "high", 15, "grit", "in", prop=("cs",))
E("peperomia-polybotrya", "Peperomia polybotrya", "פפרומיה פוליבוטריה", ["Raindrop peperomia"], P, "houseplant", "peperomia", "MB", "half", "med", 13, "grit", "in", prop=("cs", "leaf"))
E("peperomia-rotundifolia", "Peperomia rotundifolia", "פפרומיה רוטונדיפוליה", ["Trailing jade"], P, "houseplant", "peperomia", "M", "half", "med", 15, "grit", "in", prop=("cs",))
E("pilea-peperomioides", "Pilea peperomioides", "פילאה", ["Chinese money plant", "UFO plant"], "Urticaceae", "houseplant", "foliage", "MB", "half", "med", 10, "gen", "in", prop=("off", "cw"), heAlt=("צמח הכסף הסיני", "פילאה פפרומיואידס"))
E("pilea-cadierei", "Pilea cadierei", "פילאה קדיירי", ["Aluminium plant"], "Urticaceae", "houseplant", "foliage", "MB", "top", "med", 12, "gen", "in", prop=("cs", "cw"), tox="N")
E("pilea-involucrata", "Pilea involucrata", "פילאה אינבולוקרטה", ["Friendship plant"], "Urticaceae", "houseplant", "foliage", "M", "top", "high", 15, "gen", "in", prop=("cs",), tox="N")

# ---------------- Begonia ----------------
G = "Begoniaceae"
E("begonia-maculata", "Begonia maculata", "בגוניה מקולטה", ["Polka dot begonia"], G, "houseplant", "begonia", "MB", "top", "high", 15, "gen", "in", prop=("cw", "cs"), tox="T", note="רגישה לעודף מים: להשקות כשהשכבה העליונה מתייבשת, לא להשאיר מים בתחתית.")
E("begonia-rex", "Begonia rex", "בגוניה רקס", ["Rex begonia", "Painted-leaf begonia"], G, "houseplant", "begonia", "M", "top", "high", 15, "gen", "in", prop=("leaf", "div"), tox="T")
E("begonia-cucullata", "Begonia cucullata", "בגוניה תמידית", ["Wax begonia"], G, "flower", "begonia", "MBD", "top", "med", 10, "gen", "both", life="ann", prop=("cs", "seed"), tox="T", syn=("Begonia semperflorens",))
E("begonia-tuberhybrida", "Begonia × tuberhybrida", "בגוניה פקעתית", ["Tuberous begonia"], G, "flower", "begonia", "MB", "top", "med", 10, "gen", "both", prop=("tuber",), tox="T")

# ---------------- Orchids ----------------
O = "Orchidaceae"
E("phalaenopsis", "Phalaenopsis spp.", "פלנופסיס", ["Moth orchid"], O, "flower", "orchid", "MB", "half", "med", 15, "orch", "in", prop=("keiki",), tox="N", heAlt=("סחלב", "סחלב פרפר"), note="להשקות כשהשורשים בעציץ השקוף הופכים כסופים; לא להשאיר מים בלב הצמח.")
E("dendrobium", "Dendrobium spp.", "דנדרוביום", ["Dendrobium orchid"], O, "flower", "orchid", "B", "half", "med", 10, "orch", "in", prop=("keiki", "div"), tox="N")
E("cattleya", "Cattleya spp.", "קטליה", ["Cattleya orchid"], O, "flower", "orchid", "B", "half", "med", 13, "orch", "in", prop=("div",), tox="N")
E("oncidium", "Oncidium spp.", "אונקידיום", ["Dancing lady orchid"], O, "flower", "orchid", "B", "top", "med", 12, "orch", "in", prop=("div",))
E("cymbidium", "Cymbidium spp.", "צימבידיום", ["Boat orchid"], O, "flower", "orchid", "BD", "top", "med", 5, "orch", "both", prop=("div",), note="צריך לילות קרירים בסתיו כדי לפרוח.")
E("paphiopedilum", "Paphiopedilum spp.", "פפיופדילום", ["Slipper orchid"], O, "flower", "orchid", "LM", "top", "med", 13, "orch", "in", prop=("div",), heAlt=("נעל ונוס",))
E("vanda", "Vanda spp.", "ונדה", ["Vanda orchid"], O, "flower", "orchid", "B", "half", "high", 15, "mount", "in", prop=("keiki",))
E("ludisia-discolor", "Ludisia discolor", "לודיסיה", ["Jewel orchid"], O, "houseplant", "orchid", "LM", "top", "high", 15, "moist", "in", prop=("cw", "cs"))

# ---------------- Ferns ----------------
E("nephrolepis-exaltata", "Nephrolepis exaltata", "שרך בוסטון", ["Boston fern", "Sword fern"], "Nephrolepidaceae", "houseplant", "fern", "MB", "moist", "high", 13, "moist", "in", prop=("div", "run"), tox="N", heAlt=("נפרולפיס",))
E("adiantum-raddianum", "Adiantum raddianum", "שערות שולמית", ["Maidenhair fern"], "Pteridaceae", "houseplant", "fern", "M", "moist", "high", 13, "moist", "in", prop=("div", "spore"), tox="N", heAlt=("אדיאנטום",), note="אינו סולח על ייבוש: גם יום אחד של מצע יבש לגמרי מייבש עלים.")
E("asplenium-nidus", "Asplenium nidus", "אספלניום", ["Bird's nest fern"], "Aspleniaceae", "houseplant", "fern", "LM", "top", "high", 15, "moist", "in", prop=("spore",), tox="N", heAlt=("שרך קן הציפור",))
E("platycerium-bifurcatum", "Platycerium bifurcatum", "קרן צבי", ["Staghorn fern"], "Polypodiaceae", "houseplant", "fern", "MB", "half", "high", 10, "mount", "in", prop=("off", "spore"), tox="N", heAlt=("פלטיצריום",))
E("pteris-cretica", "Pteris cretica", "פטריס", ["Cretan brake fern"], "Pteridaceae", "houseplant", "fern", "M", "moist", "high", 10, "moist", "in", prop=("div", "spore"))
E("davallia-fejeensis", "Davallia fejeensis", "דבליה", ["Rabbit's foot fern"], "Davalliaceae", "houseplant", "fern", "MB", "top", "high", 13, "orch", "in", prop=("rhiz", "div"))
E("phlebodium-aureum", "Phlebodium aureum", "פלבודיום", ["Blue star fern"], "Polypodiaceae", "houseplant", "fern", "LM", "top", "med", 13, "orch", "in", prop=("rhiz", "div"))
E("pellaea-rotundifolia", "Pellaea rotundifolia", "פליאה", ["Button fern"], "Pteridaceae", "houseplant", "fern", "M", "top", "med", 10, "gen", "in", prop=("div",))
E("microsorum-musifolium", "Microsorum musifolium", "שרך תנין", ["Crocodile fern"], "Polypodiaceae", "houseplant", "fern", "M", "moist", "high", 15, "moist", "in", prop=("div",), heAlt=("מיקרוסורום",))

# ---------------- Palms & palm-like ----------------
R = "Arecaceae"
E("dypsis-lutescens", "Dypsis lutescens", "דקל ארקה", ["Areca palm", "Butterfly palm"], R, "houseplant", "palm", "B", "top", "med", 10, "gen", "both", prop=("div", "seed"), tox="N", syn=("Chrysalidocarpus lutescens",))
E("chamaedorea-elegans", "Chamaedorea elegans", "דקל שולחני", ["Parlor palm"], R, "houseplant", "palm", "LM", "top", "med", 10, "gen", "in", prop=("seed",), tox="N", heAlt=("כמדוריאה",))
E("howea-forsteriana", "Howea forsteriana", "דקל קנטיה", ["Kentia palm"], R, "houseplant", "palm", "LMB", "half", "med", 8, "gen", "in", prop=("seed",), heAlt=("הוואה",))
E("rhapis-excelsa", "Rhapis excelsa", "רפיס", ["Lady palm"], R, "houseplant", "palm", "LMB", "top", "med", 5, "gen", "both", prop=("div", "seed"), tox="N")
E("ravenea-rivularis", "Ravenea rivularis", "דקל מלכותי", ["Majesty palm"], R, "houseplant", "palm", "B", "moist", "high", 10, "gen", "in", prop=("seed",), heAlt=("רבנאה",))
E("phoenix-roebelenii", "Phoenix roebelenii", "תמר גמדי", ["Pygmy date palm"], R, "outdoor", "palm", "BD", "top", "med", 2, "gen", "both", prop=("seed",), heAlt=("פניקס רובלני",))
E("phoenix-dactylifera", "Phoenix dactylifera", "תמר מצוי", ["Date palm"], R, "fruit", "palm", "D", "half", "low", -5, "grit", "out", prop=("seed", "off"))
E("livistona-chinensis", "Livistona chinensis", "ליוויסטונה", ["Chinese fan palm"], R, "outdoor", "palm", "BD", "top", "med", 0, "gen", "both", prop=("seed",))
E("cycas-revoluta", "Cycas revoluta", "ציקס", ["Sago palm"], "Cycadaceae", "outdoor", "tree", "BD", "half", "low", -5, "grit", "both", prop=("off", "seed"), tox="T", heAlt=("דקל סאגו",), note="אינו דקל. רעיל מאוד לבעלי חיים ולבני אדם — כל חלקי הצמח, ובמיוחד הזרעים.")

# ---------------- Succulents & cacti ----------------
E("crassula-ovata", "Crassula ovata", "קרסולה", ["Jade plant", "Money tree"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 5, "grit", "both", prop=("leaf", "cs"), tox="T", heAlt=("עץ הכסף", "עץ הירקן"))
E("crassula-perforata", "Crassula perforata", "קרסולה פרפורטה", ["String of buttons"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 5, "grit", "both", prop=("cs", "leaf"))
E("haworthiopsis-attenuata", "Haworthiopsis attenuata", "הוורתיה", ["Zebra haworthia"], "Asphodelaceae", "succulent", "succulent", "MB", "dry", "low", 5, "grit", "in", prop=("off",), tox="N", syn=("Haworthia attenuata",), heAlt=("הוורתיה זברה",))
E("haworthia-cooperi", "Haworthia cooperi", "הוורתיה קופרי", ["Window haworthia"], "Asphodelaceae", "succulent", "succulent", "MB", "dry", "low", 5, "grit", "in", prop=("off",))
E("gasteria", "Gasteria spp.", "גסטריה", ["Ox tongue"], "Asphodelaceae", "succulent", "succulent", "MB", "dry", "low", 5, "grit", "in", prop=("off", "leaf"))
E("sedum-morganianum", "Sedum morganianum", "סדום מורגניאנום", ["Burro's tail", "Donkey's tail"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 7, "grit", "both", prop=("leaf", "cs"), tox="N", heAlt=("זנב חמור",))
E("sedum-rubrotinctum", "Sedum rubrotinctum", "סדום רוברוטינקטום", ["Jelly bean plant"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 2, "grit", "both", prop=("leaf", "cs"))
E("curio-rowleyanus", "Curio rowleyanus", "מחרוזת פנינים", ["String of pearls"], "Asteraceae", "succulent", "succulent", "B", "dry", "low", 7, "grit", "in", prop=("cs",), tox="T", syn=("Senecio rowleyanus",), heAlt=("סנציו",))
E("curio-radicans", "Curio radicans", "מחרוזת בננות", ["String of bananas"], "Asteraceae", "succulent", "succulent", "B", "dry", "low", 5, "grit", "both", prop=("cs",), tox="T", syn=("Senecio radicans",))
E("kalanchoe-blossfeldiana", "Kalanchoe blossfeldiana", "קלנחואה", ["Flaming Katy"], "Crassulaceae", "flower", "succulent", "BD", "dry", "low", 8, "grit", "both", prop=("cs",), tox="T")
E("kalanchoe-tomentosa", "Kalanchoe tomentosa", "קלנחואה טומנטוזה", ["Panda plant"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 8, "grit", "in", prop=("leaf", "cs"), tox="T", heAlt=("אוזן חתול",))
E("kalanchoe-daigremontiana", "Kalanchoe daigremontiana", "קלנחואה דיגרמונטיאנה", ["Mother of thousands"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 5, "grit", "both", prop=("run",), tox="T", syn=("Bryophyllum daigremontianum",), heAlt=("אם אלפים",))
E("graptopetalum-paraguayense", "Graptopetalum paraguayense", "גרפטופטלום", ["Ghost plant"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 0, "grit", "both", prop=("leaf", "cs"))
E("sempervivum", "Sempervivum spp.", "סמפרויבום", ["Houseleek", "Hens and chicks"], "Crassulaceae", "succulent", "succulent", "D", "dry", "low", -15, "grit", "out", prop=("off",))
E("aeonium-arboreum", "Aeonium arboreum", "אאוניום", ["Tree houseleek"], "Crassulaceae", "succulent", "succulent", "BD", "dry", "low", 2, "grit", "both", prop=("cs",), note="גדל בעיקר בחורף ונח בקיץ — בקיץ להשקות פחות.")
E("lithops", "Lithops spp.", "ליתופס", ["Living stones"], "Aizoaceae", "succulent", "succulent", "BD", "dry", "low", 5, "grit", "in", prop=("seed", "div"), heAlt=("אבנים חיות",), note="לא להשקות בזמן החלפת העלים (כשזוג חדש מופיע מתוך הישן).")
E("euphorbia-milii", "Euphorbia milii", "קוצי המשיח", ["Crown of thorns"], "Euphorbiaceae", "succulent", "succulent", "BD", "dry", "low", 8, "grit", "both", prop=("cs",), tox="T", heAlt=("אופורביה מילי",), note="השרף הלבן מגרה עור ועיניים.")
E("euphorbia-trigona", "Euphorbia trigona", "אופורביה טריגונה", ["African milk tree"], "Euphorbiaceae", "succulent", "succulent", "BD", "dry", "low", 10, "grit", "in", prop=("cs",), tox="T")
E("euphorbia-tirucalli", "Euphorbia tirucalli", "אופורביה טירוקלי", ["Pencil cactus", "Firesticks"], "Euphorbiaceae", "succulent", "succulent", "BD", "dry", "low", 8, "grit", "both", prop=("cs",), tox="T")
E("portulacaria-afra", "Portulacaria afra", "פורטולקריה", ["Elephant bush"], "Didiereaceae", "succulent", "succulent", "BD", "dry", "low", 2, "grit", "both", prop=("cs",), heAlt=("עץ פילים",))
E("agave-americana", "Agave americana", "אגבה אמריקנית", ["Century plant"], "Asparagaceae", "succulent", "succulent", "D", "dry", "low", -5, "grit", "out", prop=("off",))
E("schlumbergera", "Schlumbergera spp.", "קקטוס חג המולד", ["Christmas cactus", "Holiday cactus"], "Cactaceae", "succulent", "cactus", "MB", "half", "med", 10, "orch", "in", prop=("cs",), tox="N", heAlt=("שלומברגרה",), note="קקטוס יערות: אוהב מצע מאוורר ואור עקיף, לא שמש מדברית.")
E("rhipsalis-baccifera", "Rhipsalis baccifera", "ריפסליס", ["Mistletoe cactus"], "Cactaceae", "succulent", "cactus", "MB", "half", "med", 10, "orch", "in", prop=("cs",))
E("opuntia-ficus-indica", "Opuntia ficus-indica", "צבר", ["Prickly pear", "Indian fig"], "Cactaceae", "fruit", "cactus", "D", "dry", "low", -5, "grit", "out", prop=("pad",), species="ficus-indica")
E("mammillaria", "Mammillaria spp.", "ממילריה", ["Pincushion cactus"], "Cactaceae", "succulent", "cactus", "BD", "dry", "low", 5, "grit", "both", prop=("off", "seed"))
E("echinopsis", "Echinopsis spp.", "אכינופסיס", ["Easter lily cactus"], "Cactaceae", "succulent", "cactus", "D", "dry", "low", 0, "grit", "both", prop=("off", "seed"))
E("gymnocalycium-mihanovichii", "Gymnocalycium mihanovichii", "גימנוקליציום", ["Moon cactus"], "Cactaceae", "succulent", "cactus", "B", "dry", "low", 10, "grit", "in", prop=("graft",), note="הצבעוניים מורכבים על כנה ירוקה כי אין להם כלורופיל משלהם.")
E("cereus-repandus", "Cereus repandus", "צראוס", ["Peruvian apple cactus"], "Cactaceae", "succulent", "cactus", "D", "dry", "low", 0, "grit", "both", prop=("cs",), syn=("Cereus peruvianus",))
E("astrophytum", "Astrophytum spp.", "אסטרופיטום", ["Star cactus", "Bishop's cap"], "Cactaceae", "succulent", "cactus", "BD", "dry", "low", 5, "grit", "in", prop=("seed",))
E("ferocactus", "Ferocactus spp.", "פרוקקטוס", ["Barrel cactus"], "Cactaceae", "succulent", "cactus", "D", "dry", "low", 0, "grit", "out", prop=("seed",))
E("epiphyllum-oxypetalum", "Epiphyllum oxypetalum", "אפיפילום", ["Queen of the night"], "Cactaceae", "succulent", "cactus", "MB", "half", "med", 10, "orch", "both", prop=("cs",), heAlt=("מלכת הלילה",))

# ---------------- Other houseplants ----------------
E("tradescantia-zebrina", "Tradescantia zebrina", "טרדסקנציה זברינה", ["Inch plant", "Wandering dude"], "Commelinaceae", "houseplant", "foliage", "MB", "top", "med", 10, "gen", "both", prop=("cw", "cs"), tox="T")
E("tradescantia-pallida", "Tradescantia pallida", "טרדסקנציה סגולה", ["Purple heart"], "Commelinaceae", "houseplant", "foliage", "BD", "half", "low", 5, "gen", "both", prop=("cw", "cs"), tox="T", heAlt=("לב סגול",))
E("tradescantia-spathacea", "Tradescantia spathacea", "טרדסקנציה ספטציאה", ["Oyster plant", "Moses-in-the-cradle"], "Commelinaceae", "houseplant", "foliage", "BD", "half", "med", 10, "gen", "both", prop=("off", "cs"), tox="T", syn=("Rhoeo spathacea", "Rhoeo discolor"))
E("tradescantia-fluminensis", "Tradescantia fluminensis", "טרדסקנציה פלומיננסיס", ["Small-leaf spiderwort", "Wandering Jew"], "Commelinaceae", "houseplant", "foliage", "MB", "top", "med", 5, "gen", "both", prop=("cw", "cs"), tox="T")
E("callisia-repens", "Callisia repens", "קליסיה", ["Turtle vine"], "Commelinaceae", "houseplant", "foliage", "MB", "top", "med", 10, "gen", "in", prop=("cs", "cw"))
E("fittonia-albivenis", "Fittonia albivenis", "פיטוניה", ["Nerve plant"], "Acanthaceae", "houseplant", "foliage", "M", "moist", "high", 15, "moist", "in", prop=("cw", "cs"), tox="N", note="קורסת כשהיא צמאה ומתאוששת מהר אחרי השקיה — אבל ייבוש חוזר מחליש אותה.")
E("hypoestes-phyllostachya", "Hypoestes phyllostachya", "היפואסטס", ["Polka dot plant"], "Acanthaceae", "houseplant", "foliage", "MB", "top", "med", 13, "gen", "in", prop=("cw", "seed"), tox="N")
E("coleus-scutellarioides", "Coleus scutellarioides", "קולאוס", ["Coleus", "Painted nettle"], "Lamiaceae", "houseplant", "foliage", "MB", "top", "med", 10, "gen", "both", life="ann", prop=("cw", "seed"), tox="T", syn=("Plectranthus scutellarioides", "Solenostemon scutellarioides"))
E("plectranthus-verticillatus", "Plectranthus verticillatus", "פלקטרנטוס", ["Swedish ivy"], "Lamiaceae", "houseplant", "foliage", "MB", "top", "med", 10, "gen", "both", prop=("cw", "cs"), tox="N")
E("strelitzia-reginae", "Strelitzia reginae", "ציפור גן עדן", ["Bird of paradise"], "Strelitziaceae", "flower", "foliage", "BD", "top", "med", 5, "gen", "both", prop=("div", "seed"), tox="T", heAlt=("סטרליציה",))
E("strelitzia-nicolai", "Strelitzia nicolai", "סטרליציה ניקולאי", ["Giant white bird of paradise"], "Strelitziaceae", "houseplant", "foliage", "BD", "top", "med", 5, "gen", "both", prop=("div", "seed"), heAlt=("ציפור גן עדן לבנה",))
E("heptapleurum-arboricola", "Heptapleurum arboricola", "שפלרה", ["Dwarf umbrella tree"], "Araliaceae", "houseplant", "foliage", "MB", "half", "med", 10, "gen", "both", prop=("cs", "air"), tox="T", syn=("Schefflera arboricola",))
E("heptapleurum-actinophyllum", "Heptapleurum actinophyllum", "שפלרה אקטינופילה", ["Umbrella tree"], "Araliaceae", "houseplant", "foliage", "B", "half", "med", 10, "gen", "both", prop=("cs", "air", "seed"), tox="T", syn=("Schefflera actinophylla",), heAlt=("עץ מטריה",))
E("fatsia-japonica", "Fatsia japonica", "פטסיה", ["Japanese aralia"], "Araliaceae", "houseplant", "foliage", "LMB", "top", "med", -5, "gen", "both", prop=("cs", "seed"))
E("hedera-helix", "Hedera helix", "קיסוס", ["English ivy"], "Araliaceae", "houseplant", "foliage", "LMB", "top", "med", -10, "gen", "both", prop=("cw", "cs"), tox="T", heAlt=("קיסוס החורש",))
E("polyscias-fruticosa", "Polyscias fruticosa", "פוליסיאס", ["Ming aralia"], "Araliaceae", "houseplant", "foliage", "B", "top", "high", 15, "gen", "in", prop=("cs",))
E("radermachera-sinica", "Radermachera sinica", "רדרמכרה", ["China doll"], "Bignoniaceae", "houseplant", "foliage", "B", "top", "med", 13, "gen", "in", prop=("cs",))
E("oxalis-triangularis", "Oxalis triangularis", "חמציץ סגול", ["Purple shamrock", "False shamrock"], "Oxalidaceae", "houseplant", "foliage", "MB", "top", "med", 7, "gen", "both", prop=("bulb", "div"), tox="T", heAlt=("אוקסליס",), note="העלים נסגרים בלילה; תרדמה קצרה עם עלים נובלים היא חלק מהמחזור.")
E("streptocarpus-ionanthus", "Streptocarpus ionanthus", "סיגלית אפריקאית", ["African violet"], "Gesneriaceae", "flower", "flower", "MB", "top", "med", 15, "gen", "in", prop=("leaf", "div"), tox="N", syn=("Saintpaulia ionantha",), note="להשקות מלמטה או ליד השוליים; מים קרים על העלים משאירים כתמים.")
E("streptocarpus", "Streptocarpus spp.", "סטרפטוקרפוס", ["Cape primrose"], "Gesneriaceae", "flower", "flower", "MB", "top", "med", 10, "gen", "in", prop=("leaf", "div"))
E("guzmania", "Guzmania spp.", "גוזמניה", ["Guzmania bromeliad"], "Bromeliaceae", "flower", "bromeliad", "MB", "top", "high", 15, "orch", "in", prop=("off",), note="צמח האם פורח פעם אחת ואז מתייבש בהדרגה — הצמחונים בבסיס הם הדור הבא.")
E("tillandsia", "Tillandsia spp.", "טילנדסיה", ["Air plant"], "Bromeliaceae", "houseplant", "bromeliad", "B", "half", "med", 10, "mount", "in", prop=("off",), heAlt=("צמח אוויר",), note="משרים או מרססים ומייבשים היטב תוך כמה שעות; מים שנשארים בבסיס גורמים לריקבון.")
E("aechmea-fasciata", "Aechmea fasciata", "אכמאה", ["Urn plant", "Silver vase"], "Bromeliaceae", "flower", "bromeliad", "B", "top", "med", 13, "orch", "in", prop=("off",))
E("neoregelia", "Neoregelia spp.", "נאורגליה", ["Blushing bromeliad"], "Bromeliaceae", "houseplant", "bromeliad", "B", "top", "med", 13, "orch", "in", prop=("off",))
E("cryptanthus", "Cryptanthus spp.", "קריפטנתוס", ["Earth star"], "Bromeliaceae", "houseplant", "bromeliad", "M", "top", "high", 15, "gen", "in", prop=("off",))
E("nepenthes", "Nepenthes spp.", "נפנטס", ["Tropical pitcher plant"], "Nepenthaceae", "houseplant", "carnivorous", "B", "moist", "high", 15, "peat", "in", prop=("cs",), note="מים רכים בלבד (גשם/מזוקקים) ובלי דשן רגיל.")
E("dionaea-muscipula", "Dionaea muscipula", "דיונאה", ["Venus flytrap"], "Droseraceae", "houseplant", "carnivorous", "D", "moist", "med", -5, "peat", "both", prop=("div", "seed"), heAlt=("מלכודת זבובים", "מלכודת ונוס"), note="מים רכים בלבד, בלי דשן; צריך תרדמת חורף קרירה. לא לסגור מלכודות סתם — זה מתיש את הצמח.")
E("soleirolia-soleirolii", "Soleirolia soleirolii", "סולירוליה", ["Baby's tears"], "Urticaceae", "houseplant", "foliage", "M", "moist", "high", 0, "moist", "both", prop=("div",))

# ---------------- Herbs ----------------
E("salvia-rosmarinus", "Salvia rosmarinus", "רוזמרין", ["Rosemary"], "Lamiaceae", "herb", "herb", "D", "dry", "low", -5, "grit", "out", prop=("cs",), tox="N", syn=("Rosmarinus officinalis",))
E("thymus-vulgaris", "Thymus vulgaris", "טימין", ["Thyme"], "Lamiaceae", "herb", "herb", "D", "dry", "low", -10, "grit", "out", prop=("cs", "div", "seed"), heAlt=("קורנית",), sow=("surface", (7, 21), (15, 22)))
E("origanum-vulgare", "Origanum vulgare", "אורגנו", ["Oregano"], "Lamiaceae", "herb", "herb", "D", "half", "low", -10, "grit", "out", prop=("cs", "div", "seed"), sow=("surface", (7, 14), (18, 24)))
E("origanum-syriacum", "Origanum syriacum", "זעתר", ["Syrian oregano", "Za'atar"], "Lamiaceae", "herb", "herb", "D", "dry", "low", -2, "grit", "out", prop=("cs", "seed"), syn=("Majorana syriaca",), heAlt=("אזוב מצוי", "אזוביון"), note="צמח בר מוגן בישראל — מגדלים מזרעים או משתילים ממשתלה, לא קוטפים בטבע.")
E("petroselinum-crispum", "Petroselinum crispum", "פטרוזיליה", ["Parsley"], "Apiaceae", "herb", "herb", "BD", "top", "med", -5, "veg", "both", life="bi", prop=("seed",), tox="T", sow=("1cm", (14, 28), (15, 25)), note="נביטה איטית — השריה של הזרעים לילה במים יכולה לקצר אותה.")
E("coriandrum-sativum", "Coriandrum sativum", "כוסברה", ["Coriander", "Cilantro"], "Apiaceae", "herb", "herb", "BD", "top", "med", -2, "veg", "both", life="ann", prop=("seed",), sow=("1cm", (7, 14), (15, 22)), note="בחום הקיץ עולה מהר לפריחה; זריעה בסתיו–חורף נותנת יותר עלים.")
E("anethum-graveolens", "Anethum graveolens", "שמיר", ["Dill"], "Apiaceae", "herb", "herb", "D", "top", "low", 0, "veg", "out", life="ann", prop=("seed",), sow=("0.5cm", (7, 14), (15, 22)))
E("allium-schoenoprasum", "Allium schoenoprasum", "עירית", ["Chives"], "Amaryllidaceae", "herb", "herb", "BD", "top", "med", -15, "veg", "both", prop=("div", "seed"), tox="T", sow=("0.5cm", (7, 14), (15, 22)))
E("salvia-officinalis", "Salvia officinalis", "מרווה", ["Sage"], "Lamiaceae", "herb", "herb", "D", "dry", "low", -10, "grit", "out", prop=("cs", "seed"), heAlt=("מרווה רפואית",))
E("melissa-officinalis", "Melissa officinalis", "מליסה", ["Lemon balm"], "Lamiaceae", "herb", "herb", "BD", "top", "med", -10, "veg", "both", prop=("cs", "div", "seed"), heAlt=("מליסה לימונית",))
E("aloysia-citrodora", "Aloysia citrodora", "לואיזה", ["Lemon verbena"], "Verbenaceae", "herb", "herb", "D", "half", "low", -2, "gen", "out", prop=("cs",), syn=("Aloysia triphylla",))
E("cymbopogon-citratus", "Cymbopogon citratus", "למון גראס", ["Lemongrass"], "Poaceae", "herb", "herb", "D", "top", "med", 5, "veg", "both", prop=("div",), heAlt=("עשב לימון",))
E("stevia-rebaudiana", "Stevia rebaudiana", "סטיביה", ["Stevia"], "Asteraceae", "herb", "herb", "D", "top", "med", 0, "veg", "both", prop=("cs", "seed"))
E("foeniculum-vulgare", "Foeniculum vulgare", "שומר", ["Fennel"], "Apiaceae", "herb", "herb", "D", "top", "low", -10, "veg", "out", prop=("seed",), sow=("1cm", (7, 14), (15, 25)))
E("tropaeolum-majus", "Tropaeolum majus", "כובע הנזיר", ["Nasturtium"], "Tropaeolaceae", "flower", "flower", "D", "half", "low", 2, "gen", "out", life="ann", prop=("seed", "cs"), tox="N", heAlt=("טרופיאולום",), sow=("2cm", (7, 14), (15, 22)), note="עלים ופרחים אכילים.")
E("ocimum-tenuiflorum", "Ocimum tenuiflorum", "בזיליקום קדוש", ["Holy basil", "Tulsi"], "Lamiaceae", "herb", "herb", "D", "top", "med", 10, "veg", "both", life="ann", prop=("seed", "cw"), heAlt=("טולסי",), sow=("0.5cm", (5, 14), (20, 30)))
E("ocimum-basilicum-genovese", "Ocimum basilicum 'Genovese'", "בזיליקום גנובזה", ["Genovese basil"], "Lamiaceae", "herb", "herb", "D", "top", "med", 10, "veg", "both", life="ann", prop=("seed", "cw"), tox="N", cultivar="Genovese", parent="ocimum-basilicum", genus="Ocimum", species="basilicum", sow=("0.5cm", (5, 10), (20, 30)))
E("mentha-spicata", "Mentha spicata", "נענע ירוקה", ["Spearmint"], "Lamiaceae", "herb", "herb", "BD", "moist", "med", -10, "veg", "both", prop=("cw", "div"), tox="T", parent="mentha")

# ---------------- Vegetables ----------------
E("solanum-lycopersicum-cherry", "Solanum lycopersicum var. cerasiforme", "עגבניית שרי", ["Cherry tomato"], "Solanaceae", "vegetable", "vegetable", "D", "top", "low", 10, "veg", "out", life="ann", prop=("seed", "cs"), tox="T", parent="solanum-lycopersicum", genus="Solanum", species="lycopersicum", sow=("0.5cm", (5, 12), (20, 30)))
E("capsicum-annuum", "Capsicum annuum", "פלפל", ["Pepper", "Chili pepper"], "Solanaceae", "vegetable", "vegetable", "D", "top", "low", 12, "veg", "out", life="ann", prop=("seed",), sow=("0.5cm", (7, 21), (24, 30)), note="פלפלים חריפים ומתוקים שייכים לאותו מין ברובם; זרעים צריכים חום כדי לנבוט.")
E("solanum-melongena", "Solanum melongena", "חציל", ["Eggplant", "Aubergine"], "Solanaceae", "vegetable", "vegetable", "D", "top", "low", 12, "veg", "out", life="ann", prop=("seed",), sow=("0.5cm", (7, 14), (24, 30)))
E("cucumis-sativus", "Cucumis sativus", "מלפפון", ["Cucumber"], "Cucurbitaceae", "vegetable", "vegetable", "D", "top", "low", 12, "veg", "out", life="ann", prop=("seed",), sow=("2cm", (3, 10), (20, 30)))
E("cucurbita-pepo", "Cucurbita pepo", "קישוא", ["Zucchini", "Courgette"], "Cucurbitaceae", "vegetable", "vegetable", "D", "top", "low", 12, "veg", "out", life="ann", prop=("seed",), sow=("3cm", (5, 10), (20, 30)))
E("lactuca-sativa", "Lactuca sativa", "חסה", ["Lettuce"], "Asteraceae", "vegetable", "vegetable", "BD", "moist", "med", 0, "veg", "out", life="ann", prop=("seed",), sow=("surface", (4, 10), (10, 20)), note="זרעי חסה צריכים אור לנביטה וכיסוי דק בלבד; בחום רב הנביטה נכשלת.")
E("spinacia-oleracea", "Spinacia oleracea", "תרד", ["Spinach"], "Amaranthaceae", "vegetable", "vegetable", "BD", "moist", "med", -5, "veg", "out", life="ann", prop=("seed",), sow=("1cm", (7, 14), (10, 20)))
E("phaseolus-vulgaris", "Phaseolus vulgaris", "שעועית", ["Common bean", "Green bean"], "Fabaceae", "vegetable", "vegetable", "D", "top", "low", 10, "veg", "out", life="ann", prop=("seed",), sow=("3cm", (7, 10), (18, 30)))
E("pisum-sativum", "Pisum sativum", "אפונה", ["Pea"], "Fabaceae", "vegetable", "vegetable", "BD", "top", "low", -2, "veg", "out", life="ann", prop=("seed",), sow=("3cm", (7, 14), (10, 20)))
E("raphanus-sativus", "Raphanus sativus", "צנונית", ["Radish"], "Brassicaceae", "vegetable", "vegetable", "BD", "moist", "med", -2, "veg", "out", life="ann", prop=("seed",), sow=("1cm", (3, 7), (10, 25)))
E("daucus-carota-sativus", "Daucus carota subsp. sativus", "גזר", ["Carrot"], "Apiaceae", "vegetable", "vegetable", "D", "moist", "low", -2, "veg", "out", life="bi", prop=("seed",), species="carota", sow=("0.5cm", (10, 21), (10, 25)), note="זורעים ישירות למקום — גזר לא אוהב העתקה.")
E("beta-vulgaris", "Beta vulgaris", "סלק", ["Beet", "Beetroot"], "Amaranthaceae", "vegetable", "vegetable", "BD", "top", "low", -2, "veg", "out", life="bi", prop=("seed",), sow=("2cm", (7, 14), (10, 25)))
E("allium-cepa", "Allium cepa", "בצל", ["Onion"], "Amaryllidaceae", "vegetable", "vegetable", "D", "top", "low", -5, "veg", "out", life="bi", prop=("seed", "bulb"), tox="T", sow=("1cm", (7, 14), (10, 25)))
E("allium-sativum", "Allium sativum", "שום", ["Garlic"], "Amaryllidaceae", "vegetable", "vegetable", "D", "half", "low", -10, "veg", "out", prop=("clove",), tox="T", note="שותלים שיני שום בסתיו; קוטפים כשהעלים התחתונים מצהיבים.")
E("brassica-oleracea-italica", "Brassica oleracea var. italica", "ברוקולי", ["Broccoli"], "Brassicaceae", "vegetable", "vegetable", "D", "top", "low", -5, "veg", "out", life="ann", prop=("seed",), species="oleracea", sow=("1cm", (4, 10), (10, 25)))
E("eruca-vesicaria", "Eruca vesicaria", "רוקט", ["Rocket", "Arugula"], "Brassicaceae", "vegetable", "vegetable", "BD", "top", "low", -2, "veg", "out", life="ann", prop=("seed",), syn=("Eruca sativa",), heAlt=("ארוגולה", "בן-חרדל"), sow=("0.5cm", (3, 7), (10, 25)))
E("zea-mays", "Zea mays", "תירס", ["Corn", "Maize"], "Poaceae", "vegetable", "vegetable", "D", "top", "low", 10, "veg", "out", life="ann", prop=("seed",), sow=("3cm", (5, 10), (18, 30)))
E("abelmoschus-esculentus", "Abelmoschus esculentus", "במיה", ["Okra"], "Malvaceae", "vegetable", "vegetable", "D", "top", "low", 15, "veg", "out", life="ann", prop=("seed",), sow=("2cm", (7, 14), (24, 32)))
E("fragaria-ananassa", "Fragaria × ananassa", "תות שדה", ["Strawberry"], "Rosaceae", "fruit", "fruit", "D", "top", "med", -10, "veg", "out", prop=("run",), genus="Fragaria")

# ---------------- Fruit trees & vines ----------------
E("citrus-limon", "Citrus limon", "לימון", ["Lemon"], "Rutaceae", "fruit", "fruit", "D", "top", "low", -2, "gen", "out", prop=("graft", "air"), tox="T")
E("citrus-sinensis", "Citrus × sinensis", "תפוז", ["Sweet orange"], "Rutaceae", "fruit", "fruit", "D", "top", "low", -2, "gen", "out", prop=("graft",), tox="T", genus="Citrus")
E("citrus-reticulata", "Citrus reticulata", "קלמנטינה", ["Mandarin", "Clementine"], "Rutaceae", "fruit", "fruit", "D", "top", "low", -2, "gen", "out", prop=("graft",), tox="T", heAlt=("מנדרינה",))
E("citrus-japonica", "Citrus japonica", "קומקוואט", ["Kumquat"], "Rutaceae", "fruit", "fruit", "D", "top", "low", -5, "gen", "both", prop=("graft",), tox="T", syn=("Fortunella japonica", "Fortunella margarita"))
E("citrus-microcarpa", "Citrus × microcarpa", "קלמונדין", ["Calamondin"], "Rutaceae", "fruit", "fruit", "BD", "top", "med", 0, "gen", "both", prop=("cs", "graft"), tox="T", genus="Citrus", syn=("× Citrofortunella microcarpa",))
E("persea-americana", "Persea americana", "אבוקדו", ["Avocado"], "Lauraceae", "fruit", "fruit", "BD", "top", "med", 0, "gen", "both", prop=("seed", "graft"), tox="T", note="עץ מגרעין יכול לגדול יפה בעציץ, אבל לרוב לא יניב פרי בלי הרכבה. רעיל במיוחד לציפורים.")
E("mangifera-indica", "Mangifera indica", "מנגו", ["Mango"], "Anacardiaceae", "fruit", "fruit", "D", "top", "low", 2, "gen", "out", prop=("seed", "graft"))
E("punica-granatum", "Punica granatum", "רימון", ["Pomegranate"], "Lythraceae", "fruit", "fruit", "D", "half", "low", -10, "gen", "out", prop=("cs", "seed"))
E("olea-europaea", "Olea europaea", "זית", ["Olive"], "Oleaceae", "fruit", "fruit", "D", "dry", "low", -8, "grit", "out", prop=("cs",))
E("vitis-vinifera", "Vitis vinifera", "גפן", ["Grapevine"], "Vitaceae", "fruit", "fruit", "D", "half", "low", -15, "gen", "out", prop=("cs",), tox="T", note="ענבים וצימוקים רעילים לכלבים.")
E("passiflora-edulis", "Passiflora edulis", "פסיפלורה", ["Passion fruit"], "Passifloraceae", "fruit", "fruit", "D", "top", "med", 0, "gen", "out", prop=("seed", "cs"), heAlt=("שעונית",))
E("carica-papaya", "Carica papaya", "פפאיה", ["Papaya"], "Caricaceae", "fruit", "fruit", "D", "top", "med", 5, "gen", "out", prop=("seed",))
E("musa-acuminata", "Musa acuminata", "בננה", ["Banana"], "Musaceae", "fruit", "fruit", "BD", "moist", "high", 5, "veg", "both", prop=("off",), tox="N")
E("psidium-guajava", "Psidium guajava", "גויאבה", ["Guava"], "Myrtaceae", "fruit", "fruit", "D", "top", "low", -2, "gen", "out", prop=("seed", "air"))
E("morus-alba", "Morus alba", "תות עץ", ["White mulberry"], "Moraceae", "fruit", "fruit", "D", "half", "low", -15, "gen", "out", prop=("cs",))
E("rubus-idaeus", "Rubus idaeus", "פטל", ["Raspberry"], "Rosaceae", "fruit", "fruit", "D", "top", "low", -20, "veg", "out", prop=("off", "cs"))
E("prunus-persica", "Prunus persica", "אפרסק", ["Peach"], "Rosaceae", "fruit", "fruit", "D", "top", "low", -15, "gen", "out", prop=("graft", "seed"), tox="T")
E("eriobotrya-japonica", "Eriobotrya japonica", "שסק", ["Loquat"], "Rosaceae", "fruit", "fruit", "D", "half", "low", -8, "gen", "out", prop=("seed", "graft"))
E("diospyros-kaki", "Diospyros kaki", "אפרסמון", ["Persimmon"], "Ebenaceae", "fruit", "fruit", "D", "half", "low", -15, "gen", "out", prop=("graft",))

# ---------------- Flowers & balcony ----------------
E("pelargonium-hortorum", "Pelargonium × hortorum", "גרניום", ["Zonal geranium"], "Geraniaceae", "flower", "flower", "D", "half", "low", 0, "gen", "both", prop=("cs",), tox="T", genus="Pelargonium", heAlt=("פלרגוניום",))
E("pelargonium-peltatum", "Pelargonium peltatum", "גרניום תלוי", ["Ivy-leaved geranium"], "Geraniaceae", "flower", "flower", "D", "half", "low", 0, "gen", "both", prop=("cs",), tox="T")
E("petunia", "Petunia × atkinsiana", "פטוניה", ["Petunia"], "Solanaceae", "flower", "flower", "D", "top", "low", 0, "gen", "out", life="ann", prop=("seed", "cs"), tox="N", genus="Petunia")
E("tagetes-erecta", "Tagetes erecta", "טגטס", ["African marigold"], "Asteraceae", "flower", "flower", "D", "top", "low", 5, "gen", "out", life="ann", prop=("seed",), tox="T", sow=("0.5cm", (4, 10), (20, 30)))
E("calendula-officinalis", "Calendula officinalis", "ציפורני חתול", ["Pot marigold"], "Asteraceae", "flower", "flower", "D", "top", "low", -5, "gen", "out", life="ann", prop=("seed",), tox="N", sow=("1cm", (7, 14), (15, 22)))
E("rosa", "Rosa spp.", "ורד", ["Rose"], "Rosaceae", "flower", "flower", "D", "top", "low", -15, "veg", "out", prop=("cs", "graft"), tox="N")
E("jasminum-officinale", "Jasminum officinale", "יסמין", ["Common jasmine"], "Oleaceae", "flower", "vine", "BD", "top", "med", -5, "gen", "out", prop=("cs",), tox="N")
E("bougainvillea", "Bougainvillea spp.", "בוגנוויליה", ["Bougainvillea"], "Nyctaginaceae", "flower", "vine", "D", "dry", "low", 2, "gen", "out", prop=("cs",), note="פורחת יותר כשהיא מעט יבשה ובשמש מלאה.")
E("hibiscus-rosa-sinensis", "Hibiscus rosa-sinensis", "היביסקוס", ["Chinese hibiscus"], "Malvaceae", "flower", "flower", "BD", "top", "med", 5, "gen", "both", prop=("cs",), tox="N", species="rosa-sinensis")
E("gardenia-jasminoides", "Gardenia jasminoides", "גרדניה", ["Gardenia"], "Rubiaceae", "flower", "flower", "B", "moist", "high", 10, "peat", "both", prop=("cs",), tox="T", note="מצע חומצי ומים רכים; הצהבה בין העורקים מרמזת על בעיה בקליטת ברזל.")
E("impatiens-walleriana", "Impatiens walleriana", "אימפטיינס", ["Busy Lizzie"], "Balsaminaceae", "flower", "flower", "M", "moist", "med", 10, "gen", "both", life="ann", prop=("cs", "seed"))
E("viola-wittrockiana", "Viola × wittrockiana", "אמנון ותמר", ["Pansy"], "Violaceae", "flower", "flower", "BD", "top", "low", -10, "gen", "out", life="ann", prop=("seed",), tox="N", genus="Viola", sow=("0.5cm", (7, 14), (15, 20)))
E("chrysanthemum-morifolium", "Chrysanthemum × morifolium", "חרצית", ["Florist's chrysanthemum"], "Asteraceae", "flower", "flower", "BD", "top", "low", -5, "gen", "both", prop=("cs", "div"), tox="T", genus="Chrysanthemum")
E("gerbera-jamesonii", "Gerbera jamesonii", "גרברה", ["Gerbera daisy"], "Asteraceae", "flower", "flower", "BD", "top", "low", 5, "gen", "both", prop=("div", "seed"), tox="N")
E("zinnia-elegans", "Zinnia elegans", "ציניה", ["Zinnia"], "Asteraceae", "flower", "flower", "D", "top", "low", 10, "gen", "out", life="ann", prop=("seed",), tox="N", sow=("0.5cm", (4, 7), (20, 30)))
E("helianthus-annuus", "Helianthus annuus", "חמנית", ["Sunflower"], "Asteraceae", "flower", "flower", "D", "top", "low", 5, "veg", "out", life="ann", prop=("seed",), tox="N", sow=("2cm", (7, 10), (18, 30)))
E("cosmos-bipinnatus", "Cosmos bipinnatus", "קוסמוס", ["Garden cosmos"], "Asteraceae", "flower", "flower", "D", "dry", "low", 5, "gen", "out", life="ann", prop=("seed",), sow=("0.5cm", (5, 10), (18, 28)))
E("lobularia-maritima", "Lobularia maritima", "לובולריה", ["Sweet alyssum"], "Brassicaceae", "flower", "flower", "BD", "top", "low", -2, "gen", "out", life="ann", prop=("seed",), heAlt=("אליסום",), sow=("surface", (5, 10), (15, 22)))
E("portulaca-grandiflora", "Portulaca grandiflora", "רגלה גדולת פרחים", ["Moss rose"], "Portulacaceae", "flower", "flower", "D", "dry", "low", 10, "grit", "out", life="ann", prop=("seed", "cs"), heAlt=("פורטולקה",))
E("lantana-camara", "Lantana camara", "לנטנה", ["Lantana"], "Verbenaceae", "flower", "flower", "D", "dry", "low", 0, "gen", "out", prop=("cs",), tox="T")
E("plumbago-auriculata", "Plumbago auriculata", "פלומבגו", ["Cape leadwort"], "Plumbaginaceae", "flower", "flower", "D", "half", "low", -2, "gen", "out", prop=("cs",))
E("nerium-oleander", "Nerium oleander", "הרדוף", ["Oleander"], "Apocynaceae", "flower", "flower", "D", "dry", "low", -8, "gen", "out", prop=("cs",), tox="T", heAlt=("הרדוף הנחלים",), note="רעיל מאוד לבני אדם ולבעלי חיים בכל חלקיו.")
E("hydrangea-macrophylla", "Hydrangea macrophylla", "הורטנזיה", ["Bigleaf hydrangea"], "Hydrangeaceae", "flower", "flower", "M", "moist", "med", -10, "veg", "out", prop=("cs",), tox="T", note="צבע הפרח בחלק מהזנים תלוי בחומציות הקרקע.")
E("tulipa", "Tulipa spp.", "צבעוני", ["Tulip"], "Liliaceae", "flower", "bulb", "BD", "top", "low", -20, "gen", "out", prop=("bulb",), tox="T")
E("narcissus-tazetta", "Narcissus tazetta", "נרקיס", ["Paperwhite", "Bunch-flowered daffodil"], "Amaryllidaceae", "flower", "bulb", "BD", "top", "low", -10, "gen", "out", prop=("bulb",), tox="T")
E("hippeastrum", "Hippeastrum spp.", "היפאסטרום", ["Amaryllis"], "Amaryllidaceae", "flower", "bulb", "B", "half", "low", 10, "gen", "in", prop=("bulb", "off"), tox="T", heAlt=("אמריליס",))
E("hyacinthus-orientalis", "Hyacinthus orientalis", "יקינטון", ["Hyacinth"], "Asparagaceae", "flower", "bulb", "BD", "top", "low", -15, "gen", "both", prop=("bulb",), tox="T")
E("freesia", "Freesia spp.", "פריזיה", ["Freesia"], "Iridaceae", "flower", "bulb", "D", "top", "low", 0, "gen", "out", prop=("bulb",))
E("anemone-coronaria", "Anemone coronaria", "כלנית", ["Poppy anemone"], "Ranunculaceae", "flower", "bulb", "D", "top", "low", -5, "gen", "out", prop=("tuber", "seed"), note="פרח בר מוגן בישראל — מגדלים מפקעות או זרעים ממשתלה בלבד.")
E("dianthus-caryophyllus", "Dianthus caryophyllus", "ציפורן", ["Carnation"], "Caryophyllaceae", "flower", "flower", "D", "half", "low", -5, "grit", "out", prop=("cs", "seed"), tox="T")
E("matthiola-incana", "Matthiola incana", "מנתור", ["Stock"], "Brassicaceae", "flower", "flower", "BD", "top", "low", -5, "gen", "out", life="ann", prop=("seed",))
E("antirrhinum-majus", "Antirrhinum majus", "לוע ארי", ["Snapdragon"], "Plantaginaceae", "flower", "flower", "D", "top", "low", -5, "gen", "out", life="ann", prop=("seed",), tox="N", sow=("surface", (7, 14), (15, 21)))
E("zantedeschia-aethiopica", "Zantedeschia aethiopica", "קלה", ["Calla lily", "Arum lily"], A, "flower", "aroid", "BD", "moist", "med", -2, "veg", "both", prop=("div", "rhiz"), tox="T", heAlt=("זנטדסקיה",))
E("gazania", "Gazania spp.", "גזניה", ["Treasure flower"], "Asteraceae", "flower", "flower", "D", "dry", "low", -2, "grit", "out", prop=("seed", "div"))
E("mandevilla", "Mandevilla spp.", "מנדווילה", ["Mandevilla", "Dipladenia"], "Apocynaceae", "flower", "vine", "BD", "top", "med", 7, "gen", "both", prop=("cs",), heAlt=("דיפלדניה",))
E("thunbergia-alata", "Thunbergia alata", "תונברגיה", ["Black-eyed Susan vine"], "Acanthaceae", "flower", "vine", "D", "top", "med", 5, "gen", "out", life="ann", prop=("seed",))
E("cyclamen-persicum", "Cyclamen persicum", "רקפת", ["Florist's cyclamen", "Persian cyclamen"], "Primulaceae", "flower", "flower", "MB", "top", "med", 2, "gen", "both", prop=("tuber", "seed"), tox="T", heAlt=("רקפת מצויה",), note="גדלה ופורחת בחורף ונחה בקיץ; משקים מלמטה ולא על הפקעת.")

# --------------------------------------------------------------------------------------------------
ids = [e["id"] for e in entries]
assert len(ids) == len(set(ids)), "duplicate ids"
for e in entries:
    assert re.fullmatch(r"[a-z0-9-]{2,64}", e["id"]), e["id"]
pack = {
    "pack": "plants-core-v1", "version": 1, "updated": "2026-10-02",
    "provenance": {
        "kind": "editorial_draft", "verified": False,
        "he": "מידע כללי שנאסף ע״י Leafling מידע הורטיקולטורי מקובל ומפורסם — טיוטה שטרם אומתה מול מקור ראשוני. שדות שאינם ידועים נשארים ריקים.",
        "toxicity_he": "בטיחות לחיות מחמד מסומנת רק כשהצמח מופיע ברשימת ASPCA (ארגון צער בעלי חיים האמריקאי) — טרם אומת בתוך Leafling. אחרת: לא ידוע.",
    },
    "images": "none — botanical placeholders by plant group; licensed images can be added per entry (url, license, author, source)",
    "entries": entries,
}
with open(os.path.join(OUT, "plants-core-v1.json"), "w", encoding="utf-8") as f:
    json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
    json.dump({"version": 1, "packs": ["plants-core-v1.json"]}, f, ensure_ascii=False)
print(len(entries), "entries")
