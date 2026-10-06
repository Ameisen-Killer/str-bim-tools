// Veille des appels d'offres simap.ch (06.10.2026)
// ---------------------------------------------------------------------------
// Lancé chaque matin par .github/workflows/veille-simap.yml. Interroge l'API
// publique de simap.ch (lecture sans compte) pour les cantons et les métiers
// de criteres.json, garde les publications qui concernent la structure ou le
// génie civil, et les range dans la table veille_ao de la base (clé de
// service, secret GitHub SUPABASE_SERVICE_ROLE_KEY).
// Sans ce secret, ou avec ESSAI=1 : rien n'est écrit, la sortie montre ce qui
// l'aurait été.
// Node 20, aucune dépendance.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, "..", "..");
const C = JSON.parse(readFileSync(path.join(ici, "criteres.json"), "utf8"));
const SIMAP = "https://www.simap.ch/api";
const AGENT = "str-bim-tools-veille/1.0 (+https://str-bim-tools.com)";
const jours = parseInt(process.env.JOURS || C.joursParDefaut, 10) || 3;
const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ESSAI = process.env.ESSAI === "1" || !CLE;
const URL_BASE = (process.env.SUPABASE_URL ||
  (readFileSync(path.join(racine, "docs/planif/assets/config.js"), "utf8").match(/url:\s*"([^"]+)"/) || [])[1] || "").replace(/\/+$/, "");

/* ------------------------------------------------------------ simap.ch
   L'hôte pose un cookie de session à la première requête (page de contrôle) :
   on suit les redirections à la main en gardant les cookies. */
const cookies = new Map();
function retiensCookies(rep) {
  const liste = typeof rep.headers.getSetCookie === "function" ? rep.headers.getSetCookie() : [];
  for (const c of liste) {
    const [paire] = c.split(";");
    const i = paire.indexOf("=");
    if (i > 0) cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
  }
}
function enteteCookies() { return [...cookies].map(([k, v]) => k + "=" + v).join("; "); }
const pause = ms => new Promise(r => setTimeout(r, ms));

async function simap(chemin, params = {}) {
  const u = new URL(SIMAP + chemin);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    for (const x of [].concat(v)) u.searchParams.append(k, x);
  }
  let adresse = u.toString();
  for (let essai = 1; essai <= 4; essai++) {
    let rep;
    for (let saut = 0; saut < 6; saut++) {
      rep = await fetch(adresse, { redirect: "manual", headers: { "User-Agent": AGENT, Accept: "application/json", Cookie: enteteCookies() } });
      retiensCookies(rep);
      if (rep.status >= 300 && rep.status < 400 && rep.headers.get("location")) {
        adresse = new URL(rep.headers.get("location"), adresse).toString();
        if (!adresse.includes("/api/")) adresse = u.toString();   // page de contrôle du cookie : on revient à l'API
        continue;
      }
      break;
    }
    if (rep.ok) return rep.json();
    if (rep.status >= 400 && rep.status < 500 && rep.status !== 429) {
      throw new Error("simap " + rep.status + " sur " + chemin + " : " + (await rep.text()).slice(0, 300));
    }
    await pause(2000 * essai);
    adresse = u.toString();
  }
  throw new Error("simap injoignable : " + chemin);
}

const texte = v => (v == null ? "" : typeof v === "string" ? v
  : typeof v === "object" ? (v.fr || v.de || v.it || v.en || Object.values(v).find(Boolean) || "") : String(v)).replace(/\s+/g, " ").trim();
const code = v => v == null ? "" : typeof v === "object" ? String(v.code || v.id || "") : String(v);
const codes = l => (Array.isArray(l) ? l : []).map(code).filter(Boolean);

/* ------------------------------------------------------------ recherche */
function depuis() {
  const d = new Date(Date.now() - jours * 864e5);
  return d.toISOString().slice(0, 10);
}

async function recherche(filtre) {
  const trouves = [];
  let curseur = null;
  for (let page = 0; page < 25; page++) {
    const r = await simap("/publications/v2/project/project-search", { lang: "fr", newestPublicationFrom: depuis(), lastItem: curseur, ...filtre });
    const l = r.projects || [];
    trouves.push(...l);
    const suite = r.pagination && (r.pagination.lastItem || r.pagination.nextItem);
    if (!l.length || !suite || suite === curseur) break;
    curseur = suite;
    await pause(300);
  }
  return trouves;
}

/** Le mot ou l'expression, entier : « pont » ne prend pas « Pontaise ». */
function motEntier(m) {
  const e = m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]");
  return new RegExp("(?<!\\p{L})" + e + "s?(?!\\p{L})", "iu");
}

function motifsDe(det, resume) {
  const motifs = [];
  const cpv = [code(det.base && det.base.cpvCode), ...codes(det.procurement && det.procurement.additionalCpvCodes)].filter(Boolean);
  const bkp = codes(det.procurement && det.procurement.bkpCodes);
  for (const c of cpv) if (C.cpvPrefixes.some(p => c.startsWith(p))) motifs.push("CPV " + c);
  for (const b of bkp) if (C.bkp.some(p => b.startsWith(p))) motifs.push("CFC " + b);
  const corps = texte(resume.title) + " " + texte(det.procurement && det.procurement.orderDescription);
  for (const m of C.motsCles) if (motEntier(m).test(corps)) motifs.push("« " + m + " »");
  return { motifs: [...new Set(motifs)], cpv, bkp };
}

/* ------------------------------------------------------------ base */
async function base(chemin, options = {}) {
  const rep = await fetch(URL_BASE + "/rest/v1/" + chemin, {
    method: options.methode || "GET",
    // Clé secrète au nouveau format (sb_secret_…) : seulement dans apikey ; l'ancienne
    // clé service_role (un JWT) va aussi dans Authorization.
    headers: Object.assign({ apikey: CLE, "Content-Type": "application/json", Prefer: options.prefer || "" },
      /^sb_/.test(CLE) ? {} : { Authorization: "Bearer " + CLE }),
    body: options.corps ? JSON.stringify(options.corps) : undefined
  });
  if (!rep.ok) throw new Error("base " + rep.status + " : " + (await rep.text()).slice(0, 300));
  return rep.status === 204 ? null : rep.json().catch(() => null);
}

/* ------------------------------------------------------------ déroulé */
const vus = new Map();
await simap("/cantons/v1", { lang: "fr" });                     // pose le cookie
for (const canton of C.cantons) {
  for (const type of C.typesPublication) {
    // Par l'adjudicateur (le canton et ses communes) et par le lieu d'exécution
    // (marchés fédéraux livrés dans le canton : routes nationales, CFF…)
    for (const filtre of [{ issuedByOrganizations: C.institutions[canton] }, { orderAddressCantons: canton }]) {
      try {
        for (const p of await recherche({ ...filtre, newestPubTypes: type })) {
          if (!vus.has(p.id)) vus.set(p.id, { ...p, _canton: canton });
        }
      } catch (e) { console.warn("⚠ " + canton + " " + type + " : " + e.message); }
      await pause(300);
    }
  }
}
const candidats = [...vus.values()].filter(p => !p.projectSubType || C.sousTypesRetenus.includes(p.projectSubType));
console.log(`simap.ch depuis le ${depuis()} : ${vus.size} projets dans ${C.cantons.join(", ")}, ${candidats.length} mandats ou concours à examiner.`);

let connus = new Set();
if (!ESSAI && candidats.length) {
  for (let i = 0; i < candidats.length; i += 100) {
    const ids = candidats.slice(i, i + 100).map(p => '"' + p.id + '"').join(",");
    (await base("veille_ao?select=id&id=in.(" + encodeURIComponent(ids) + ")")).forEach(x => connus.add(x.id));
  }
}

const lignes = [];
for (const p of candidats) {
  if (connus.has(p.id)) continue;
  let det = {};
  try { det = await simap(`/publications/v1/project/${p.id}/publication-details/${p.publicationId}`, { lang: "fr" }); }
  catch (e) { console.warn("⚠ détail " + p.id + " : " + e.message); continue; }
  await pause(250);
  const { motifs, cpv, bkp } = motifsDe(det, p);
  if (!motifs.length) continue;
  const info = det["project-info"] || {};
  const adr = p.orderAddress || {};
  lignes.push({
    id: p.id, publication_id: p.publicationId, titre: texte(p.title) || texte(info.title) || "(sans titre)",
    description: texte(det.procurement && det.procurement.orderDescription).slice(0, 4000),
    adjudicateur: texte(p.procOfficeName) || texte(info.procOfficeAddress && info.procOfficeAddress.name),
    canton: adr.cantonId || p._canton, lieu: texte(adr.city),
    procedure: p.processType || "", type_publication: p.pubType || "", sous_type: p.projectSubType || "",
    cpv, bkp, publie_le: (p.publicationDate || (det.dates && det.dates.publicationDate) || "").slice(0, 10) || null,
    delai_remise: (det.dates && det.dates.offerDeadline) || null,
    lien: `https://www.simap.ch/fr/project-detail/${p.id}`, motifs
  });
}

console.log(`${lignes.length} publication(s) retenue(s) (structure, génie civil).`);
for (const l of lignes) console.log(`  · [${l.canton}] ${l.publie_le} — ${l.titre} — ${l.adjudicateur} — remise ${l.delai_remise || "?"} — ${l.motifs.join(", ")}`);

if (ESSAI) { console.log("Essai : rien n'est écrit dans la base."); process.exit(0); }
if (!URL_BASE) throw new Error("Adresse de la base introuvable.");
for (let i = 0; i < lignes.length; i += 50) {
  await base("veille_ao?on_conflict=id", { methode: "POST", prefer: "resolution=merge-duplicates,return=minimal", corps: lignes.slice(i, i + 50) });
}
console.log("Enregistré dans la base.");
