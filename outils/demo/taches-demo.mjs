// Tâches de démonstration du planificateur (31.10.2026)
// ---------------------------------------------------------------------------
// Lancé à la main par .github/workflows/taches-demo.yml. Crée, dans un bureau
// de la base, des tâches réalistes du lundi 2 au vendredi 27 novembre 2026 sur
// ses affaires actives et ses ingénieurs et dessinateurs réels, pour une
// présentation. Charge visée : de 55 à 95 % de la capacité de chacun sur les
// quatre semaines, tâches déjà prévues comprises, trois personnes en surcharge.
//
// Variables : SUPABASE_SERVICE_ROLE_KEY (secret GitHub), BUREAU (id ou nom ;
// vide = le seul bureau qui n'est ni de test ni fictif), MODE = essai
// (rien n'est écrit), injecte ou retire.
// Les tâches créées portent toutes la même date de création, MARQUE : c'est
// elle qui permet de les retirer (MODE=retire) sans toucher aux autres.
// Le dépôt est public, ses journaux aussi : aucun nom de personne ni
// d'affaire n'y est écrit, seulement des numéros d'ordre et des chiffres.
// Node 20, aucune dépendance.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, "..", "..");
const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MODE = (process.env.MODE || "essai").trim();
const BUREAU = (process.env.BUREAU || "").trim();
const MARQUE = "2026-10-31T17:00:00.424242+00:00";
const LUNDI = "2026-11-02", FIN = "2026-11-27", SEMAINES = 4;
const URL_BASE = ((readFileSync(path.join(racine, "docs/planif/assets/config.js"), "utf8")
  .match(/url:\s*"([^"]+)"/) || [])[1] || "").replace(/\/+$/, "");

if (!CLE) { console.error("Secret SUPABASE_SERVICE_ROLE_KEY absent."); process.exit(1); }
if (!["essai", "injecte", "retire"].includes(MODE)) { console.error("MODE inconnu : " + MODE); process.exit(1); }

async function rest(chemin, options = {}) {
  const rep = await fetch(URL_BASE + "/rest/v1/" + chemin, {
    method: options.method || "GET",
    headers: Object.assign({ apikey: CLE, "Content-Type": "application/json", Prefer: options.prefer || "" },
      /^sb_/.test(CLE) ? {} : { Authorization: "Bearer " + CLE }),
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const t = await rep.text();
  if (!rep.ok) throw new Error(rep.status + " sur " + chemin.split("?")[0] + " : " + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}
async function tout(chemin) {
  const l = [];
  for (let de = 0; ; de += 1000) {
    const p = await rest(chemin + (chemin.includes("?") ? "&" : "?") + "limit=1000&offset=" + de);
    l.push(...p);
    if (p.length < 1000) return l;
  }
}

/* ---------------------------------------------------------------- bureau */
const bureaux = await rest("bureaux?select=id,nom,actif");
const FICTIFS = /^(bureau de test|bureau d'essai|bureau de charge)/i;
let bureau;
if (BUREAU) bureau = bureaux.find(b => b.id === BUREAU || b.nom.trim().toLowerCase() === BUREAU.toLowerCase());
else {
  const reels = bureaux.filter(b => b.actif && !FICTIFS.test(b.nom.trim()));
  if (reels.length === 1) bureau = reels[0];
  else { console.error(reels.length + " bureaux réels : préciser BUREAU (id)."); process.exit(1); }
}
if (!bureau) { console.error("Bureau introuvable."); process.exit(1); }
const B = bureau.id;
console.log(`${bureaux.length} bureaux dans la base ; bureau visé : ${B}${FICTIFS.test(bureau.nom) ? " (fictif)" : ""}.`);

/* ---------------------------------------------------------------- retrait */
const dejaLa = await tout(`taches?select=id&bureau_id=eq.${B}&cree_le=eq.${encodeURIComponent(MARQUE)}`);
if (MODE === "retire") {
  for (let i = 0; i < dejaLa.length; i += 100) {
    await rest(`taches?id=in.(${dejaLa.slice(i, i + 100).map(t => t.id).join(",")})`, { method: "DELETE" });
  }
  console.log(dejaLa.length + " tâches de démonstration retirées.");
  process.exit(0);
}
if (dejaLa.length) { console.error(dejaLa.length + " tâches de démonstration déjà présentes : lancer d'abord MODE=retire."); process.exit(1); }

/* ---------------------------------------------------------------- lecture */
const membres = await tout(`membres?select=id,metier,succursale,discipline,capacite,actif&bureau_id=eq.${B}`);
const affaires = await tout(`affaires?select=id,code,phase,statut,ao_type,succursale,secteurs,responsable_id,cree_le&bureau_id=eq.${B}`);
const equipes = await tout(`affaire_membres?select=affaire_id,membre_id&bureau_id=eq.${B}`);
const taches = await tout(`taches?select=affaire_id,titre,charge_inge,charge_dessin,ingenieur_id,dessinateur_id,echeance,statut,fini_inge,fini_dessin&bureau_id=eq.${B}`);

const pers = membres.filter(m => m.actif && (m.metier === "ingenieur" || m.metier === "dessinateur"))
  .map(m => ({ ...m, cible: 0, charge: 0 }));
const parId = new Map(pers.map(p => [p.id, p]));
for (const t of taches) {
  if (t.statut === "termine" || t.echeance < LUNDI || t.echeance > FIN) continue;
  if (!t.fini_inge && parId.has(t.ingenieur_id)) parId.get(t.ingenieur_id).charge += Number(t.charge_inge);
  if (!t.fini_dessin && parId.has(t.dessinateur_id)) parId.get(t.dessinateur_id).charge += Number(t.charge_dessin);
}
const ing = pers.filter(p => p.metier === "ingenieur"), des = pers.filter(p => p.metier === "dessinateur");
console.log(`Membres : ${membres.length} (dont ${ing.length} ingénieurs et ${des.length} dessinateurs actifs). ` +
  `Affaires : ${affaires.length} (${affaires.filter(a => a.statut === "active").length} actives). Tâches existantes : ${taches.length}.`);
if (!ing.length && !des.length) { console.error("Aucun ingénieur ni dessinateur actif : rien à planifier."); process.exit(1); }

/* ---------------------------------------------------------------- hasard fixe */
let graine = 20261102;
const alea = () => { graine = (graine + 0x6D2B79F5) | 0; let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const entre = (a, b) => a + Math.floor(alea() * (b - a + 1));
const melange = l => { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };

// Charge visée par personne : de 55 à 95 % de sa capacité, et trois personnes
// en surcharge (110 à 120 %) pour que la carte de charge montre ses alertes.
melange(pers.slice()).forEach((p, k) => {
  const taux = k < 3 ? 1.1 + alea() * 0.1 : 0.55 + alea() * 0.4;
  p.cible = Number(p.capacite) * SEMAINES * taux;
});

/* ---------------------------------------------------------------- modèles */
const M = {
  etude: [
    ["Relevé de l'existant et visite des lieux", 1.5, 0.5],
    ["Hypothèses et descente de charges", 2.5, 0],
    ["Prédimensionnement des dalles et des porteurs", 3, 0],
    ["Plans de principe de la structure", 1, 3],
    ["Modèle BIM de structure, avant-projet", 0.5, 3],
    ["Étude parasismique selon SIA 261", 2.5, 0],
    ["Estimation des coûts du gros œuvre", 1.5, 0],
    ["Rapport technique et convention d'utilisation", 2, 0],
    ["Coordination avec l'architecte", 1, 0.5]
  ],
  autorisation: [
    ["Plans de structure pour la mise à l'enquête", 0.5, 2.5],
    ["Justificatif parasismique pour l'autorisation", 2, 0],
    ["Plans de soumission du gros œuvre", 0.5, 3],
    ["Métré béton, coffrage et armature (CAN 241)", 0.5, 3],
    ["Descriptif de soumission CAN 241", 2, 0.5],
    ["Comparatif des offres du gros œuvre", 1.5, 0]
  ],
  execution: [
    ["Note de calcul d'exécution", 3, 0],
    ["Plans de coffrage du radier", 0.5, 3],
    ["Plans d'armature du radier", 1, 4],
    ["Plans de coffrage des murs du sous-sol", 0.5, 3.5],
    ["Plans d'armature des murs du sous-sol", 1, 4],
    ["Réception d'armature sur chantier", 0.5, 0],
    ["Plans de coffrage de la dalle sur rez", 0.5, 3],
    ["Plans d'armature de la dalle sur rez", 1, 4],
    ["Détails des réservations CVSE", 0.5, 2],
    ["Contrôle des plans d'entreprise", 1.5, 0],
    ["Plans de coffrage des étages", 0.5, 4],
    ["Plans d'armature des étages", 1, 4.5],
    ["Listes de fers", 0, 1.5],
    ["Séance de chantier et procès-verbal", 0.5, 0]
  ],
  fin: [
    ["Plans conformes à l'exécution", 0.5, 3],
    ["Dossier de l'ouvrage", 1.5, 1],
    ["Visite de réception de l'ouvrage", 0.5, 0],
    ["Mise à jour de la maquette BIM finale", 0.5, 2]
  ]
};
const groupe = ph => ["21", "31", "32"].includes(ph) ? "etude" : ["33", "41"].includes(ph) ? "autorisation" : ph === "53" ? "fin" : "execution";
const NOTES_ATTENTE = ["En attente des plans de l'architecte.", "En attente du rapport géotechnique.", "En attente de la validation du maître d'ouvrage."];

/* ---------------------------------------------------------------- dates */
const jour = (n) => { const d = new Date(LUNDI + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const echeanceSemaine = s => jour(7 * (s - 1) + (alea() < 0.7 ? 4 : entre(2, 3)));   // vendredi le plus souvent
const arrondi = x => Math.max(0.5, Math.round(x * 2) / 2);

/* ---------------------------------------------------------------- affaires retenues */
const equipe = new Map();
for (const e of equipes) { if (!equipe.has(e.affaire_id)) equipe.set(e.affaire_id, new Set()); equipe.get(e.affaire_id).add(e.membre_id); }
const ouvertes = new Map();
for (const t of taches) if (t.statut !== "termine") { if (!ouvertes.has(t.affaire_id)) ouvertes.set(t.affaire_id, new Set()); ouvertes.get(t.affaire_id).add(t.titre.toLowerCase()); }
const actives = melange(affaires.filter(a => a.statut === "active" && a.phase !== "AO" && !a.ao_type))
  .sort((a, b) => ((b.responsable_id || equipe.has(b.id)) ? 1 : 0) - ((a.responsable_id || equipe.has(a.id)) ? 1 : 0));
if (!actives.length) { console.error("Aucune affaire active hors appel d'offres."); process.exit(1); }

function choisis(liste, a, part) {
  const eq = equipe.get(a.id) || new Set();
  const cand = liste.filter(p => p.charge + part <= p.cible * 1.12);
  if (!cand.length) return null;
  const note = p => (p.id === a.responsable_id ? 3 : 0) + (eq.has(p.id) ? 2 : 0)
    + (a.succursale && p.succursale === a.succursale ? 1 : 0)
    + ((a.secteurs || []).includes(p.discipline) ? 1 : 0) - 4 * (p.charge / p.cible);
  cand.sort((x, y) => note(y) - note(x));
  return cand[0];
}

const nouvelles = [];
let aAffecter = 0, iAffaire = 0;
const plein = l => l.every(p => p.charge >= p.cible * 0.95);
const SECTEURS = ["", " — secteur B", " — secteur C", " — secteur D", " — secteur E"];
// Tours successifs sur les affaires tant que l'équipe n'est pas chargée
while (iAffaire < actives.length * 15 && !(plein(ing) && plein(des))) {
  const a = actives[iAffaire++ % actives.length];
  const mod = M[groupe(a.phase)];
  const n = entre(2, 4), debut = entre(0, mod.length - 1), s0 = entre(1, 5 - Math.min(n, 4));
  for (let k = 0; k < n; k++) {
    const [base, ci0, cd0] = mod[(debut + k) % mod.length];
    const deja = ouvertes.get(a.id) || new Set();
    const titre = base + (SECTEURS.find(x => !deja.has((base + x).toLowerCase())) ?? null);
    if (titre.endsWith("null")) continue;
    const f = [0.8, 1, 1, 1.25, 1.5][entre(0, 4)];
    const ci = ci0 ? arrondi(ci0 * f) : 0, cd = cd0 ? arrondi(cd0 * f) : 0;
    const semaine = Math.min(4, s0 + k);
    let i = ci ? choisis(ing, a, ci) : null, d = cd ? choisis(des, a, cd) : null;
    // Quelques parts laissées « à affecter » pour la démonstration
    const laisse = aAffecter < 6 && alea() < 0.12;
    if (laisse) { if (cd) d = null; else i = null; }
    if ((ci && !i) || (cd && !d)) {
      if (!laisse && aAffecter >= 10) continue;   // plus personne de libre : on n'en rajoute pas
      aAffecter++;
    }
    if (i) i.charge += ci;
    if (d) d.charge += cd;
    let statut = "a_faire", avancement = 0, note = "";
    if (semaine === 1 && alea() < 0.75) { statut = "en_cours"; avancement = 10 * entre(2, 7); }
    else if (semaine === 2 && alea() < 0.35) { statut = "en_cours"; avancement = 10 * entre(1, 3); }
    else if (semaine >= 3 && alea() < 0.08) { statut = "attente"; note = NOTES_ATTENTE[entre(0, 2)]; }
    const r = alea();
    nouvelles.push({
      bureau_id: B, affaire_id: a.id, titre, note, charge_inge: ci, charge_dessin: cd,
      echeance: echeanceSemaine(semaine), ingenieur_id: i ? i.id : null, dessinateur_id: d ? d.id : null,
      statut, avancement, priorite: r < 0.1 ? 1 : r < 0.22 ? 2 : r < 0.35 ? 3 : 5, cree_le: MARQUE
    });
    (ouvertes.get(a.id) || ouvertes.set(a.id, new Set()).get(a.id)).add(titre.toLowerCase());
  }
}

/* ---------------------------------------------------------------- compte rendu (sans noms) */
const affIdx = new Map(actives.map((a, k) => [a.id, "A" + (k + 1)]));
console.log(`\n${nouvelles.length} tâches sur ${new Set(nouvelles.map(t => t.affaire_id)).size} affaires, ${aAffecter} avec une part à affecter.`);
for (let s = 1; s <= 4; s++) {
  const l = nouvelles.filter(t => t.echeance >= jour(7 * (s - 1)) && t.echeance <= jour(7 * (s - 1) + 6));
  console.log(`Semaine ${s} : ${l.length} tâches, ${l.reduce((x, t) => x + t.charge_inge, 0)} j calcul, ${l.reduce((x, t) => x + t.charge_dessin, 0)} j dessin.`);
}
console.log("\nCharge sur les 4 semaines (jours prévus / capacité) :");
for (const [nom, l] of [["Ingénieurs", ing], ["Dessinateurs", des]]) {
  console.log(nom + " : " + l.map((p, k) => `${nom[0]}${k + 1} ${p.charge}/${Number(p.capacite) * SEMAINES}`).join(" · "));
}
console.log("\nDétail :");
for (const t of nouvelles.sort((x, y) => x.echeance.localeCompare(y.echeance))) {
  console.log(`${t.echeance}  ${affIdx.get(t.affaire_id).padEnd(4)} ${t.titre.padEnd(48)} ${String(t.charge_inge).padStart(4)} + ${String(t.charge_dessin).padStart(4)} j  ` +
    `${t.statut}${t.avancement ? " " + t.avancement + " %" : ""}  P${t.priorite}${(!t.ingenieur_id && t.charge_inge) || (!t.dessinateur_id && t.charge_dessin) ? "  à affecter" : ""}`);
}

if (MODE === "essai") { console.log("\nEssai : rien n'est écrit."); process.exit(0); }
for (let i = 0; i < nouvelles.length; i += 100) {
  await rest("taches", { method: "POST", body: nouvelles.slice(i, i + 100), prefer: "return=minimal" });
}
console.log(`\n${nouvelles.length} tâches injectées (date de création ${MARQUE}).`);
