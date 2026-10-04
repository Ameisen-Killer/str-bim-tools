#!/usr/bin/env python3
"""Génère docs/bench/donnees.js, la base du comparateur /bench/.

Sources :
  - jeu de données « cpu-gpu-data-crawler » (github.com/lijieyu233/cpu-gpu-data-crawler) :
    caractéristiques TechPowerUp et scores PassMark (CPU Mark, Single Thread, G3D Mark).
    Ses scores font foi.
  - complements-cpu.txt / complements-gpu.txt (ce dossier) : base saisie à la main. Elle sert
    à ajouter les puces absentes du jeu de données (graphiques intégrées Intel, puces de portable
    récentes…), à donner la graphique intégrée de chaque processeur et à combler le mono-cœur
    quand PassMark ne le publie pas.

Usage : python3 bench/generer-donnees.py <dossier out/ du jeu de données> [date AAAA-MM-JJ]
"""
import csv
import math
import os
import re
import statistics
import sys
import unicodedata
from collections import defaultdict

ICI = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(ICI, "..", "docs", "bench", "donnees.js")


def norm(s):
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9+]", "", s)


def cle_cpu(nom):
    return norm(nom.replace("Ryzen Threadripper", "Threadripper"))


def cle_gpu(nom, suffixe=""):
    """Clé de rapprochement : sans marque ; « Laptop », « Mobile » et « Max-Q » désignent la même puce de portable,
    quelle que soit leur place dans le nom (« RTX 500 Mobile Ada Generation » = « RTX 500 Ada Laptop »)."""
    k = re.sub(r"^(nvidia|amd|intel)", "", norm(nom))
    portable = bool(re.search(r"laptop|mobile|maxq", k))
    k = re.sub(r"laptop|mobile|maxq|workstation", "", k.replace("adageneration", "ada"))
    k = re.sub(r"(\d)go$", r"\1gb", k) + suffixe
    return k + ("@portable" if portable else "")


def nombre(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def txt(x):
    """Nombre court pour le fichier : 3.0 -> 3, 4.55 -> 4.55."""
    if x is None:
        return ""
    return ("%.3f" % x).rstrip("0").rstrip(".")


# ---------------------------------------------------------------- compléments
def lire_complements(fichier):
    lignes = []
    with open(os.path.join(ICI, fichier), encoding="utf-8") as f:
        for l in f:
            l = l.rstrip("\n")
            if l.strip():
                lignes.append(l.split("|"))
    return lignes


def marque_cpu(nom):
    return "AMD" if re.match(r"(Ryzen|Athlon|Threadripper)", nom) else "Intel"


def marque_gpu(nom):
    if re.match(r"(GeForce|Quadro|NVIDIA)", nom):
        return "NVIDIA"
    if re.match(r"(Radeon|AMD)", nom):
        return "AMD"
    return "Intel"


# ---------------------------------------------------------------- type de poste
SOCKETS_PORTABLES = re.compile(r"^(BGA|Socket (FP\d|FT\d|FS1|FL1|G\d|P|M|479|S1|AM2r2 mobile)\b)")


def type_cpu(nom, socket):
    if SOCKETS_PORTABLES.match(socket or ""):
        return "P"
    if re.match(r"(Xeon|Ryzen Threadripper|Threadripper|EPYC|Opteron|Itanium)", nom):
        return "S"
    if re.match(r"(Atom|Celeron N|Pentium (Silver )?N|Processor N)", nom):
        return "P"
    return "F"


# ---------------------------------------------------------------- graphique intégrée
def igpu(nom, code, typ):
    """Code de la graphique intégrée (voir complements-gpu.txt), "" si aucune, "?" si inconnue."""
    n = nom
    if re.match(r"(Xeon|EPYC|Opteron|Itanium|Ryzen Threadripper|Threadripper)", n) and typ == "S":
        if re.match(r"Xeon (E-2\d{3}G|E3-12\d5|W-1[23]\d\d)", n):
            return "uhd630"
        return ""
    c = code or ""
    intel = not re.match(r"(Ryzen|Athlon|AMD|A\d|E\d|Phenom|Sempron|Turion|FX|EPYC|Opteron)", n)
    if intel:
        if typ != "P" and re.search(r"\dK?F( Plus)?$", n):
            return ""
        if c.startswith("Sandy Bridge"):
            return "hd2000"
        if c.startswith("Ivy Bridge"):
            return "hd4000" if typ == "P" or "i7" in n else "hd2500"
        if c.startswith(("Haswell", "Crystalwell", "Crystal Well")):
            return "hd4400" if re.search(r"\d{4}U$|\d{4}Y$", n) else "hd4600"
        if c.startswith("Broadwell"):
            return "hd5500"
        if c.startswith("Skylake") and not re.search(r"-(X|W|SP|EP)$", c):
            return "hd520" if re.search(r"\d{4}[UY]$|[mM]\d", n) else "hd530"
        if c.startswith("Kaby Lake") and c not in ("Kaby Lake-X", "Kaby Lake G"):
            if re.search(r"-(R|U|Y)$", c) or re.search(r"\d{4}[UY]$", n):
                return "uhd620" if c == "Kaby Lake-R" else "hd620"
            return "hd630"
        if c in ("Coffee Lake-U", "Whiskey Lake-U", "Comet Lake-U", "Comet Lake-Y", "Amber Lake-Y"):
            return "uhd620"
        if c.startswith(("Coffee Lake", "Comet Lake")):
            return "uhd630"
        if c.startswith("Ice Lake") and not re.search(r"-(SP|D|W)$", c):
            return "irisg7" if "G7" in n else "uhdg1"
        if c.startswith("Tiger Lake"):
            return "irisxe" if "G7" in n else "uhdxe"
        if c.startswith("Rocket Lake"):
            return "uhd730" if re.search(r"i5-114", n) else "uhd750"
        if c in ("Alder Lake-S", "Raptor Lake-S", "Raptor Lake-R", "Bartlett Lake"):
            return "uhd730" if re.search(r"i3-|i5-1[234]4|Core [35] ", n) else "uhd770"
        if c in ("Alder Lake-HX", "Raptor Lake-HX"):
            return "uhdxe"
        if c.startswith(("Alder Lake", "Raptor Lake")):
            return "uhdxe" if re.search(r"i3-|Core 3 |Pentium|Celeron", n) else "irisxe"
        if c in ("Alder Lake-N", "Twin Lake", "Amston Lake", "Gracemont"):
            return "uhdn"
        if c.startswith("Meteor Lake"):
            return "arcmtl" if re.search(r"H$", n) else "mtlgfx"
        if c == "Lunar Lake":
            return "arc130v" if re.search(r"[23]6V$", n) else "arc140v"
        if c.startswith("Arrow Lake"):
            if re.search(r"\d{3}H$", n):
                return "arc130t" if re.search(r"5 2\d5H$", n) else "arc140t"
            if re.search(r"\d{3}U$", n):
                return "mtlgfx"
            return "arlgfx"
        if c == "Panther Lake":
            return "arcb390" if re.search(r"X\d|EXTREME", n) else "ptlgfx"
        if c == "Wildcat Lake":
            return "ptlgfx"
        if c in ("Gemini Lake", "Jasper Lake", "Apollo Lake", "Elkhart Lake", "Bay Trail-M", "Bay Trail-D",
                 "Bay Trail-T", "Braswell", "Cherry Trail"):
            return "uhd600"
        return "?"
    # AMD
    desk = typ == "F"
    if desk and re.search(r"\dF$", n):
        return ""
    if c in ("Raven Ridge", "Picasso", "Dali", "Raven Ridge 2", "Pollock"):
        if desk:
            if not re.search(r"G[E]?$", n):
                return ""
            return "vega3" if "Athlon" in n else ("vega8d" if "Ryzen 3" in n else "vega11")
        return "vega3" if re.search(r"Athlon|Ryzen 3 3[12]", n) else "vega8m"
    if c in ("Renoir", "Lucienne", "Cezanne", "Cezanne-U", "Barcelo", "Barcelo-R"):
        if desk and not re.search(r"G[E]?$", n):
            return ""
        return "radeonr"
    if c.startswith("Rembrandt"):
        return "r660m" if "Ryzen 5" in n else "r680m"
    if c in ("Phoenix", "Hawk Point"):
        if desk and not re.search(r"G[E]?$", n):
            return ""
        if re.search(r"8500G|7545U|8540U", n):
            return "r740m"
        return "r760m" if "Ryzen 5" in n else ("r740m" if "Ryzen 3" in n else "r780m")
    if c == "Phoenix2":
        return "r740m"
    if c in ("Mendocino", "Raphael", "Granite Ridge", "Dragon Range", "Fire Range"):
        return "r610m"
    if c == "Strix Point":
        return "r890m" if "HX" in n else "r880m"
    if c.startswith("Krackan Point"):
        return "r860m" if "AI 7" in n else "r840m"
    if c == "Gorgon Point":
        if re.search(r"HX 47", n):
            return "r890m"
        if re.search(r"AI 9", n):
            return "r880m"
        return "r860m" if "AI 7" in n else "r840m"
    if c in ("Strix Halo", "Gorgon Halo"):
        return "r8060s" if re.search(r"[34]9[5]", n) else "r8050s"
    if c in ("Vermeer", "Matisse", "Matisse 2", "Zen", "Summit Ridge", "Pinnacle Ridge", "Colfax", "Castle Peak",
             "Chagall PRO", "Storm Peak", "Shimada Peak", "Whitehaven"):
        return ""
    return "?"


# ---------------------------------------------------------------- processeurs
CPU_EXCLUS = re.compile(r"\(|Steam|^Arc G|^\d{4}S$|Xbox|Playstation|^Processor U?\d+$")


def puissance(x):
    """Cœurs × fréquence, l'hyper-threading comptant pour un tiers de cœur."""
    f = x["turbo"] or x["base"]
    try:
        c, t = int(x["coeurs"]), int(x["threads"] or x["coeurs"])
    except (TypeError, ValueError):
        return None
    return (c + (t - c) / 3) * f if f and c else None


def processeurs(dossier, date):
    comp = {cle_cpu(p[0]): p for p in lire_complements("complements-cpu.txt")}
    rangs, sans_mark = [], []
    vus = set()
    limite = (date or "9999")[:7]
    with open(os.path.join(dossier, "cpu.csv"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["brand"] not in ("Intel", "AMD"):
                continue
            nom = r["model"].strip()
            k = cle_cpu(nom)
            if k in vus:
                continue
            x = dict(
                marque=r["brand"], nom=nom, cle=k, coeurs=r["cores"], threads=r["threads"],
                base=nombre(r["base_clock_ghz"]), turbo=nombre(r["boost_clock_ghz"]), tdp=nombre(r["tdp_w"]),
                annee=(r["released_date"] or "")[:4], code=r["codename"], socket=r["socket"],
                mark=int(float(r["passmark_cpu_mark"])) if r["passmark_cpu_mark"] else None,
                st=int(float(r["passmark_single_thread"])) if r["passmark_single_thread"] else None,
                estime=False,
            )
            if x["mark"]:
                vus.add(k)
                rangs.append(x)
            else:
                sortie = (r["released_date"] or "")[:7]
                if sortie and "2010" <= sortie <= limite and k not in comp and not CPU_EXCLUS.search(nom):
                    sans_mark.append(x)

    # CPU Mark des processeurs sans mesure : log(mark) = a + b·log(cœurs × fréquence), famille par famille,
    # sinon par marque et par année (± 1 an)
    par_famille, par_periode = defaultdict(list), defaultdict(list)
    for x in rangs:
        w = puissance(x)
        if w and x["annee"]:
            par_famille[x["code"]].append((math.log(w), math.log(x["mark"])))
            for a in (int(x["annee"]) - 1, int(x["annee"]), int(x["annee"]) + 1):
                par_periode[(x["marque"], str(a), x["socket"].startswith(("BGA", "Socket FP")))].append(
                    (math.log(w), math.log(x["mark"])))
    ajoutes = 0
    for x in sans_mark:
        if x["cle"] in vus:
            continue
        w = puissance(x)
        p = par_famille.get(x["code"]) or []
        if len(p) < 4:
            p = par_periode.get((x["marque"], x["annee"], x["socket"].startswith(("BGA", "Socket FP")))) or []
        if not w or len(p) < 4:
            continue
        a, b = droite(p, .6)
        x["mark"] = int(round(math.exp(a + b * math.log(w)) / 10) * 10)
        x["estime"] = True
        vus.add(x["cle"])
        rangs.append(x)
        ajoutes += 1
    st_mesure = {x["cle"]: x["st"] for x in rangs if x["st"]}
    print("processeurs sans CPU Mark estimés : %d" % ajoutes)
    # Rapport mono-cœur / fréquence par famille, pour estimer les manquants
    par_code, par_annee = defaultdict(list), defaultdict(list)
    for x in rangs:
        f = x["turbo"] or x["base"]
        st = x["st"] or (int(comp[x["cle"]][9]) if x["cle"] in comp else None)   # mesure, sinon base saisie
        if st and f:
            par_code[x["code"]].append(st / f)
            par_annee[(x["marque"], x["annee"])].append(st / f)
    lignes, estimes, complets = [], 0, 0
    for x in rangs:
        c = comp.get(x["cle"])
        typ = c[7] if c else type_cpu(x["nom"], x["socket"])
        drap = "s" if x["estime"] else ""
        st = x["st"]
        if not st:
            # même puce sans graphique (F, KF) ou en version PRO : même mono-cœur
            for v in (re.sub(r"(\d)K?F( Plus)?$", r"\1K\2", x["nom"]), re.sub(r"(\d)F( Plus)?$", r"\1\2", x["nom"]),
                      x["nom"].replace(" PRO ", " ")):
                kv = cle_cpu(v)
                if kv != x["cle"] and (st_mesure.get(kv) or kv in comp):
                    st, drap = st_mesure.get(kv) or int(comp[kv][9]), drap or "e"
                    break
        if not st and c:
            st, drap = int(c[9]), drap or "e"
        if not st:
            f = x["turbo"] or x["base"]
            ech = par_code.get(x["code"]) or []
            if len(ech) < 2:
                a = x["annee"]
                ech = (par_annee.get((x["marque"], a)) or []) + (par_annee.get((x["marque"], str(int(a) - 1) if a else "")) or []) \
                    + (par_annee.get((x["marque"], str(int(a) + 1) if a else "")) or [])
            if f and ech:
                st = int(round(statistics.median(ech) * f / 10) * 10)
                st = min(st, x["mark"])
                drap = drap or "e"
        if not st:
            continue
        if drap:
            estimes += 1
        coeurs = x["coeurs"]
        for v in (x["nom"], re.sub(r"(\d)K?F( Plus)?$", r"\1K\2", x["nom"]), re.sub(r"(\d)F( Plus)?$", r"\1\2", x["nom"])):
            cv = comp.get(cle_cpu(v))
            if cv and "+" in cv[1] and sum(map(int, cv[1].split("+"))) == int(x["coeurs"] or 0):
                coeurs = cv[1]   # répartition cœurs performance + efficacité
                break
        ig = c[10] if c else igpu(x["nom"], x["code"], typ)
        if c:
            complets += 1
        lignes.append([x["marque"], x["nom"], coeurs, x["threads"], txt(x["base"]), txt(x["turbo"] or x["base"]),
                       txt(x["tdp"]), x["annee"], typ, x["mark"], st, ig, drap])
    # Puces de la base saisie absentes du jeu de données
    ajout = 0
    for k, p in comp.items():
        if k in vus:
            continue
        ajout += 1
        lignes.append([marque_cpu(p[0])] + p[:10] + [p[10], "s"])
    lignes.sort(key=lambda l: (l[0], l[1]))
    print("processeurs : %d (mono-cœur estimé %d, complétés par la base saisie %d, ajoutés %d)"
          % (len(lignes), estimes, complets, ajout))
    return lignes


# ---------------------------------------------------------------- graphiques
EXCLUS = re.compile(r"^(Tesla|GRID|Instinct|Radeon Instinct|CMP|A100|H100|H200|B200|L4\b|L40|A10\b|A16\b|A2\b|A30\b|A40\b|"
                    r"Data Center|Jetson|Xavier|Orin|Playstation|Xbox|Steam|Switch|Rubin|B[123]00|GB10|H20|MI\d|RTX Spark|.*Server|"
                    r"A800|A30X|A10M|Arctic Sound|N1 |Ryzen .*GPU|RTX 6000D|.*PRO V\d|.*Embedded|"
                    r".* (GA|AD|GB|TU)\d{3}$|.*GDDR6X$|.*TiM$|.* x2$|.*\d+SP\b|P10\dM|.*6000D)", re.I)
INTEGREES = re.compile(r"(IGP|nForce|^ION|Graphics|^Radeon (RX )?Vega (3|6|7|8|10|11)( Mobile)?$|"
                       r"^Radeon (\d{3}M|80\d0S|8065S|R\d M\d+DX|HD 8\d{3}[EG])$)")
PORTABLES = re.compile(r"(\d{2,4}MX?\b|\bM\d{3,4}\b|Mobile|Mobility|Max-Q|Laptop|\bM\d+X?\b|\d{3,4}S$)")
PRO = re.compile(r"^(Quadro|RTX A\d|RTX \d{4} Ada|RTX PRO|T\d{3,4}\b|NVS|Radeon Pro|Radeon PRO|FirePro|FireGL|Arc Pro|Radeon AI PRO)")


def famille(r):
    """Famille d'architecture, pour estimer le G3D Mark à partir des caractéristiques."""
    c = r["chip"] or ""
    m = re.match(r"(GB|AD|GA|TU|GP|GM|GK)\d", c)
    if m:
        return m.group(1)
    m = re.match(r"Navi (\d)", c)
    if m:
        return "Navi" + m.group(1)
    if r["brand"] == "Intel":
        return "Intel"
    return r["brand"] + "-autre"


def debit(r):
    """Cœurs × fréquence : la puissance de calcul théorique (fréquence de base pour les puces de portable)."""
    try:
        return int(r["shaders"]) * float(r["core_clock_ghz"])
    except (TypeError, ValueError):
        return None


def droite(points, pente_min=.5):
    """log(score) = a + b·log(débit), pente bornée pour rester raisonnable hors de l'échantillon."""
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    mx, my = statistics.mean(xs), statistics.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs) or 1
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    b = min(max(b, pente_min), 1.0)
    return my - b * mx, b


def graphiques(dossier, date):
    comp = lire_complements("complements-gpu.txt")
    mesures, sans_score = {}, {}
    with open(os.path.join(dossier, "gpu.csv"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["brand"] not in ("NVIDIA", "AMD", "ATI", "Intel"):
                continue
            nom = r["model"].strip()
            if EXCLUS.search(nom):
                continue
            k = cle_gpu(nom)
            if r["passmark_g3d_mark"]:
                mesures.setdefault(k, r)
            else:
                sans_score.setdefault(k, r)

    def integree(r):
        nom, bus = r["model"], r["bus_interface"] or ""
        return (bus in ("IGP", "Ring Bus") or not r["memory_gb"] or bool(INTEGREES.search(nom))
                or bool(re.search(r"\d+EU\b|^Arc \d{3}[VT]\b|^Arc Graphics|^Radeon Graphics", nom))) \
            and not re.search(r"Vega M|Pro Vega", nom)

    def portable(r):
        if "Workstation" in r["model"]:
            return False   # « Max-Q Workstation » : carte de PC fixe
        return bool(PORTABLES.search(r["model"]) or (r["bus_interface"] or "").startswith("MXM"))

    # Estimation par les caractéristiques, calée sur les cartes mesurées depuis 2016
    pts = defaultdict(list)
    for r in mesures.values():
        t = debit(r)
        if t and (r["released_date"] or "") >= "2016" and not integree(r):
            pts[famille(r)].append((math.log(t), math.log(float(r["passmark_g3d_mark"]))))
    droites = {f: droite(p) for f, p in pts.items() if len(p) >= 4}
    plafonds = {f: math.exp(max(y for _, y in p)) for f, p in pts.items()}

    def estimer(r):
        t, d = debit(r), droites.get(famille(r))
        if not (t and d):
            return None
        # jamais au-dessus de la meilleure carte mesurée de la même famille
        return min(math.exp(d[0] + d[1] * math.log(t)), .98 * plafonds[famille(r)])

    # Les puces de portable sont données à leur fréquence de base : facteur calé sur la base saisie
    rapports = {"0": [], "1": []}
    for p in comp:
        if p[2] == "L":
            r = sans_score.get(cle_gpu(p[0]))
            e = estimer(r) if r is not None else None
            if e:
                rapports[p[3]].append(float(p[5]) / e)
    facteur = {k: statistics.median(v) if v else 1.2 for k, v in rapports.items()}
    print("facteur portable : grand public %.2f, pro %.2f" % (facteur["0"], facteur["1"]))

    lignes, pris, maj = [], set(), 0
    # Base saisie d'abord : elle porte les codes des graphiques intégrées et les noms lisibles
    for p in comp:
        k = cle_gpu(p[0])
        r = mesures.get(k)
        if r is None and p[2] != "I":
            r = mesures.get(cle_gpu(p[0], p[1] + "gb"))   # le jeu de données précise la mémoire : « RTX 3060 12 GB »
        drap = "s"
        g3d = p[5]
        if r is not None:
            g3d, drap = str(int(float(r["passmark_g3d_mark"]))), ""
            pris.add(cle_gpu(r["model"]))
            maj += 1
        pris.add(k)
        pris.add(cle_gpu(p[0], p[1] + "gb"))
        lignes.append([marque_gpu(p[0]), p[0], p[1], p[2], p[3], p[4], g3d, p[6] if len(p) > 6 else "", drap])
    ajout = 0
    for k, r in mesures.items():
        if k in pris:
            continue
        nom = r["model"].strip()
        integ = integree(r)
        typ = "I" if integ else ("L" if portable(r) else "D")
        vram = 0 if integ else (nombre(r["memory_gb"]) or 0)
        lignes.append(["ATI" if r["brand"] == "ATI" else r["brand"], nom, txt(vram), typ, "1" if PRO.match(nom) else "0",
                       (r["released_date"] or "")[:4], str(int(float(r["passmark_g3d_mark"]))), "", ""])
        pris.add(k)
        ajout += 1
    # Puces sans score PassMark (portables récents, nouvelles cartes pro) : estimées par leurs caractéristiques
    estimees = 0
    limite = (date or "9999")[:7]
    for k, r in sans_score.items():
        if k in pris or integree(r) or r["brand"] == "ATI":
            continue
        sortie = (r["released_date"] or "")[:7]
        port = portable(r)
        if sortie > limite or (not sortie and not port) or (sortie and sortie < "2016"):
            continue   # annonces futures, puces anciennes
        e = estimer(r)
        if not e:
            continue
        pro = "1" if PRO.match(r["model"]) else "0"
        if port:
            e *= facteur[pro]
        lignes.append([r["brand"], r["model"].strip(), txt(nombre(r["memory_gb"]) or 0), "L" if port else "D", pro,
                       sortie[:4], str(int(round(e / 100) * 100)), "", "s"])
        pris.add(k)
        estimees += 1
    lignes.sort(key=lambda l: (l[3] != "I", l[0], l[1]))
    print("graphiques : %d (base saisie recalée sur PassMark %d, mesurées ajoutées %d, estimées par les caractéristiques %d)"
          % (len(lignes), maj, ajout, estimees))
    return lignes


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    dossier = sys.argv[1]
    date = sys.argv[2] if len(sys.argv) > 2 else None
    cpu = processeurs(dossier, date)
    gpu = graphiques(dossier, date)
    for l in cpu + gpu:
        for v in l:
            assert "|" not in str(v) and "`" not in str(v) and "\n" not in str(v), l
    with open(SORTIE, "w", encoding="utf-8", newline="\n") as f:
        f.write("""// Bench : base des processeurs et des cartes graphiques — fichier généré par bench/generer-donnees.py,
// ne pas modifier à la main (corriger bench/complements-*.txt puis relancer le script).
// Scores PassMark (CPU Mark, Single Thread, G3D Mark) et caractéristiques TechPowerUp, via le jeu de données
// github.com/lijieyu233/cpu-gpu-data-crawler, complétés par une base saisie à la main.
//
// Processeur : marque | nom | cœurs (P+E) | threads | GHz base | GHz turbo | TDP W | année | type | CPU Mark | mono-cœur
//              | graphique intégrée (code, "" aucune, "?" inconnue) | drapeau
//   type : F = fixe, P = portable (ou mini-PC), S = station de travail ou serveur
// Graphique  : marque | nom | Go de mémoire vidéo | type | pro | année | G3D Mark | code | drapeau
//   type : I = intégrée au processeur, D = carte de PC fixe, L = puce de portable ; pro = 1 pour les gammes certifiées
// Drapeau : e = mono-cœur estimé (PassMark ne le publie pas), s = valeurs estimées (absent du jeu de données)
(function(){
"use strict";
window.BENCH_DONNEES = {
""")
        f.write('maj: "%s",\n' % (date or ""))
        f.write("cpu: `\n" + "\n".join("|".join(str(v) for v in l) for l in cpu) + "\n`,\n")
        f.write("gpu: `\n" + "\n".join("|".join(str(v) for v in l) for l in gpu) + "\n`\n};\n})();\n")
    print("écrit :", os.path.relpath(SORTIE))


if __name__ == "__main__":
    main()
