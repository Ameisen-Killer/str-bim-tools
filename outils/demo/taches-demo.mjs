// Tâches de démonstration du planificateur (31.10.2026)
// ---------------------------------------------------------------------------
// Lancé à la main par .github/workflows/taches-demo.yml. Construit, dans un
// bureau de la base, un planning plausible du lundi 2 au vendredi 27 novembre
// 2026, sur ses affaires actives et ses ingénieurs et dessinateurs réels :
//   - chaque personne a une ou deux affaires « à elle » (celles dont elle est
//     responsable ou membre de l'équipe, sinon de sa succursale) ;
//   - chaque affaire déroule ses étapes dans l'ordre de sa phase SIA (radier,
//     puis murs du sous-sol, puis dalles… en exécution) ; les tâches d'une
//     personne se suivent sans se chevaucher ;
//   - trois ou quatre affaires sont urgentes : leurs équipes sont en surcharge ;
//     une dizaine de personnes sont peu chargées ; deux affaires qui démarrent
//     attendent encore leurs dessinateurs (« à affecter »).
//
// Variables : SUPABASE_SERVICE_ROLE_KEY (secret GitHub), BUREAU (id ou nom ;
// vide = le seul bureau qui n'est ni de test ni fictif), MODE :
//   essai     rien n'est écrit, la sortie montre le planning ;
//   injecte   ajoute les tâches ;
//   remplace  SUPPRIME TOUTES LES TÂCHES DU BUREAU, puis ajoute les tâches ;
//   retire    supprime les seules tâches de démonstration.
// Les tâches créées portent toutes la même date de création, MARQUE : c'est
// elle qui permet de les retirer sans toucher aux autres.
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
const LUNDI = "2026-11-02", JOURS = 20;          // quatre semaines ouvrées
const URL_BASE = ((readFileSync(path.join(racine, "docs/planif/assets/config.js"), "utf8")
  .match(/url:\s*"([^"]+)"/) || [])[1] || "").replace(/\/+$/, "");

if (!CLE) { console.error("Secret SUPABASE_SERVICE_ROLE_KEY absent."); process.exit(1); }
if (!["essai", "injecte", "remplace", "retire"].includes(MODE)) { console.error("MODE inconnu : " + MODE); process.exit(1); }

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
async function supprime(ids) {
  for (let i = 0; i < ids.length; i += 100) {
    await rest(`taches?id=in.(${ids.slice(i, i + 100).join(",")})`, { method: "DELETE" });
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
const demo = await tout(`taches?select=id&bureau_id=eq.${B}&cree_le=eq.${encodeURIComponent(MARQUE)}`);
if (MODE === "retire") {
  await supprime(demo.map(t => t.id));
  console.log(demo.length + " tâches de démonstration retirées.");
  process.exit(0);
}
if (MODE === "injecte" && demo.length) { console.error(demo.length + " tâches de démonstration déjà présentes : MODE=retire ou remplace."); process.exit(1); }

/* ---------------------------------------------------------------- lecture */
const membres = await tout(`membres?select=id,metier,succursale,discipline,capacite,actif&bureau_id=eq.${B}`);
const affaires = await tout(`affaires?select=id,code,phase,statut,ao_type,succursale,secteurs,responsable_id&bureau_id=eq.${B}`);
const equipes = await tout(`affaire_membres?select=affaire_id,membre_id&bureau_id=eq.${B}`);
const existantes = await tout(`taches?select=id&bureau_id=eq.${B}`);
console.log(`Membres : ${membres.length}. Affaires : ${affaires.length} (${affaires.filter(a => a.statut === "active").length} actives). Tâches existantes : ${existantes.length}.`);

/* ---------------------------------------------------------------- hasard fixe */
let graine = 20261102;
const alea = () => { graine = (graine + 0x6D2B79F5) | 0; let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const entre = (a, b) => a + Math.floor(alea() * (b - a + 1));
const flottant = (a, b) => a + alea() * (b - a);
const melange = l => { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };

/* ---------------------------------------------------------------- étapes par phase
   [libellé, jours de calcul, jours de dessin], dans l'ordre où on les fait. */
const NIVEAUX = ["dalle sur sous-sol", "dalle sur rez", "dalle sur 1er", "dalle sur 2e", "dalle sur 3e", "dalle de toiture"];
const ETAPES = {
  etude: [
    ["Relevé de l'existant et visite des lieux", 1.5, 1],
    ["Hypothèses et descente de charges", 3, 0],
    ["Étude de variantes structurelles", 3, 1.5],
    ["Prédimensionnement des dalles et des porteurs", 3, 0],
    ["Plans de principe de la structure", 1, 4],
    ["Prédimensionnement des fondations", 2, 0],
    ["Modèle BIM de structure, avant-projet", 0.5, 5],
    ["Étude parasismique selon SIA 261", 2.5, 0],
    ["Plans de projet de l'ouvrage", 1, 6],
    ["Estimation des coûts du gros œuvre", 1.5, 0],
    ["Rapport technique et convention d'utilisation", 2, 0]
  ],
  autorisation: [
    ["Mise à jour du modèle pour l'enquête", 0.5, 3],
    ["Justificatif parasismique pour l'autorisation", 2.5, 0],
    ["Plans de structure pour la mise à l'enquête", 1, 5],
    ["Plans de soumission du gros œuvre", 1, 6],
    ["Métré béton, coffrage et armature (CAN 241)", 0.5, 4],
    ["Descriptif de soumission CAN 241", 3, 0.5],
    ["Plan de contrôle et de surveillance", 1.5, 0],
    ["Analyse des offres et proposition d'adjudication", 2, 0]
  ],
  execution: [
    ["Note de calcul des fondations", 3, 0],
    ["Plans de coffrage du radier", 0.5, 3.5],
    ["Plans d'armature du radier", 1, 5],
    ["Plans de coffrage des murs du sous-sol", 0.5, 4],
    ["Modèle éléments finis des dalles", 3, 0],
    ["Plans d'armature des murs du sous-sol", 1, 5],
    ["Dimensionnement des poteaux et des voiles", 2.5, 0],
    ...NIVEAUX.flatMap((n, k) => [
      ["Plans de coffrage de la " + n, 0.5, 4],
      ...(k === 1 ? [["Détails des réservations CVSE", 0.5, 3]] : []),
      ["Plans d'armature de la " + n, 1, 5.5],
      ...(k === 2 ? [["Contrôle des plans de l'entreprise de façades", 2, 0]] : []),
      ...(k === 3 ? [["Vérification des flèches et des vibrations", 2, 0]] : [])
    ]),
    ["Listes de fers des étages", 0, 2]
  ],
  fin: [
    ["Contrôle des défauts et suivi des réserves", 1.5, 0],
    ["Plans conformes à l'exécution, sous-sol", 0.5, 4],
    ["Plans conformes à l'exécution, étages", 0.5, 5],
    ["Mise à jour de la maquette BIM finale", 0.5, 4],
    ["Dossier de l'ouvrage", 2.5, 1.5],
    ["Visite de réception de l'ouvrage", 1, 0]
  ]
};
// Travail d'ingénieur qui s'ajoute quand les étapes de calcul sont épuisées
const APPOINT = [
  ["Réponses aux questions de l'entreprise", 1.5],
  ["Vérification au feu des éléments porteurs", 2],
  ["Calcul des ancrages et fixations", 1.5],
  ["Coordination CVSE et percements", 1.5],
  ["Contrôle des plans de l'entreprise", 2],
  ["Séance de coordination avec l'architecte et procès-verbal", 1],
  ["Vérification des éléments préfabriqués", 2],
  ["Contrôle du modèle BIM de coordination", 1.5],
  ["Note de calcul des escaliers et paliers", 2],
  ["Avenant au plan de contrôle", 1]
];
const groupe = ph => ["21", "31", "32"].includes(ph) ? "etude" : ["33", "41"].includes(ph) ? "autorisation" : ph === "53" ? "fin" : "execution";
const NOTES_ATTENTE = ["En attente des plans de l'architecte.", "En attente du rapport géotechnique.", "En attente de la validation du maître d'ouvrage."];

/* ---------------------------------------------------------------- calendrier
   Jours ouvrés comptés depuis le lundi 2 novembre (0), week-ends sautés. */
const dateDe = n => { const d = new Date(LUNDI + "T12:00:00Z"); const sem = Math.floor(n / 5), j = ((n % 5) + 5) % 5;
  d.setUTCDate(d.getUTCDate() + 7 * sem + j); return d.toISOString().slice(0, 10); };
const semaineIso = n => 45 + Math.floor(n / 5);

/* ---------------------------------------------------------------- personnes et affaires */
const pers = membres.filter(m => m.actif && (m.metier === "ingenieur" || m.metier === "dessinateur"))
  .map(m => ({ ...m, ratio: 0, profil: "", curseur: 0, affaires: [], ici: 0, charge: 0 }));
const ing = pers.filter(p => p.metier === "ingenieur"), des = pers.filter(p => p.metier === "dessinateur");
console.log(`${ing.length} ingénieurs et ${des.length} dessinateurs actifs.`);
if (!ing.length || !des.length) { console.error("Il faut au moins un ingénieur et un dessinateur actifs."); process.exit(1); }

const equipe = new Map();
for (const e of equipes) { if (!equipe.has(e.affaire_id)) equipe.set(e.affaire_id, new Set()); equipe.get(e.affaire_id).add(e.membre_id); }
const actives = melange(affaires.filter(a => a.statut === "active" && a.phase !== "AO" && !a.ao_type));
if (actives.length < 4) { console.error("Trop peu d'affaires actives hors appel d'offres."); process.exit(1); }
for (const a of actives) {
  a.groupe = groupe(a.phase);
  a.etapes = ETAPES[a.groupe].map(([titre, ci, cd]) => ({ titre, ci, cd }));
  a.appoint = melange(APPOINT.slice());
  a.role = "normale";
}
// Deux affaires qui démarrent, sans dessinateur ; trois ou quatre urgentes,
// de préférence en exécution ou en autorisation.
const parUrgence = actives.slice().sort((x, y) => (y.groupe === "execution" || y.groupe === "autorisation") - (x.groupe === "execution" || x.groupe === "autorisation"));
const nbUrgentes = actives.length >= 12 ? 4 : 3;
parUrgence.slice(0, nbUrgentes).forEach(a => { a.role = "urgente"; });
actives.filter(a => a.role === "normale").slice(-2).forEach(a => { a.role = "a_staffer"; });
const suivies = actives.filter(a => a.role !== "a_staffer");

const lien = (p, a) => (p.id === a.responsable_id ? 6 : 0) + ((equipe.get(a.id) || new Set()).has(p.id) ? 4 : 0)
  + (a.succursale && p.succursale === a.succursale ? 1.5 : 0) + ((a.secteurs || []).includes(p.discipline) ? 1 : 0);

// Profils : l'équipe des affaires urgentes en surcharge, une dizaine de
// personnes peu chargées, les autres entre 65 et 95 % (55 à 85 % pour les
// ingénieurs, dont une part du temps n'est pas planifiée).
const urgentes = suivies.filter(a => a.role === "urgente");
for (const [liste, nbSur, nbPeu] of [[ing, Math.max(2, Math.round(ing.length * 0.1)), Math.max(2, Math.round(ing.length * 0.13))],
                                     [des, Math.max(2, Math.round(des.length * 0.12)), Math.max(2, Math.round(des.length * 0.13))]]) {
  const tri = melange(liste.slice()).sort((x, y) => Math.max(...urgentes.map(a => lien(y, a))) - Math.max(...urgentes.map(a => lien(x, a))));
  tri.forEach((p, k) => {
    if (k < nbSur) { p.profil = "surcharge"; p.ratio = flottant(1.2, 1.4); }
    else if (k >= tri.length - nbPeu) { p.profil = "peu"; p.ratio = flottant(0.15, 0.4); }
    else { p.profil = "normal"; p.ratio = p.metier === "ingenieur" ? flottant(0.55, 0.85) : flottant(0.65, 0.95); }
    // Jours de calendrier par jour de charge : le ratio, ramené au temps partiel
    p.rythme = p.ratio * Number(p.capacite) / 5;
  });
}

// Affaires de chacun : la principale (urgente pour les surchargés), puis les
// autres par lien décroissant. On équilibre la taille des équipes.
const effectif = new Map(suivies.map(a => [a.id, { ingenieur: 0, dessinateur: 0 }]));
for (const p of melange(pers.slice()).sort((x, y) => (y.profil === "surcharge") - (x.profil === "surcharge"))) {
  const choix = (p.profil === "surcharge" ? urgentes : suivies).slice()
    .sort((x, y) => (lien(p, y) - 2 * effectif.get(y.id)[p.metier]) - (lien(p, x) - 2 * effectif.get(x.id)[p.metier]));
  const principale = choix[0];
  effectif.get(principale.id)[p.metier]++;
  const autres = suivies.filter(a => a !== principale).sort((x, y) => lien(p, y) - lien(p, x));
  p.affaires = [principale, ...autres];
  p.curseur = -flottant(0, 3);             // travail déjà commencé la semaine passée
}
const chefDe = new Map();   // ingénieur qui porte le calcul d'une affaire
for (const a of suivies) {
  const resp = ing.find(p => p.id === a.responsable_id);
  chefDe.set(a.id, resp || ing.filter(p => p.affaires[0] === a)[0] || ing.slice().sort((x, y) => lien(y, a) - lien(x, a))[0]);
}

/* ---------------------------------------------------------------- planning
   On fait avancer, à chaque pas, la personne la moins avancée : elle prend la
   prochaine étape de son affaire. Une charge de c jours occupe c / ratio jours
   ouvrés de calendrier : ratio > 1, tout se tasse (surcharge) ; ratio < 1, il
   reste du temps libre. */
const nouvelles = [];
const libre = new Set(pers);
function pose(a, titre, ci, cd, i, d, debut, fin, prio) {
  const echeance = Math.max(2, Math.ceil(fin) - 1);
  let statut = "a_faire", avancement = 0, note = "";
  if (debut < 0) { statut = "en_cours"; avancement = Math.min(80, Math.max(10, Math.round(-debut / (fin - debut) * 10) * 10)); }
  else if (debut > 8 && a.groupe !== "execution" && alea() < 0.06) { statut = "attente"; note = NOTES_ATTENTE[entre(0, 2)]; }
  nouvelles.push({
    bureau_id: B, affaire_id: a.id, titre, note, charge_inge: ci, charge_dessin: cd,
    echeance: dateDe(echeance), ingenieur_id: i ? i.id : null, dessinateur_id: d ? d.id : null,
    statut, avancement, priorite: prio, cree_le: MARQUE, _debut: debut, _fin: echeance + 1
  });
}
const prioDe = a => a.role === "urgente" ? (alea() < 0.5 ? 1 : 2) : alea() < 0.15 ? 3 : 5;
const varie = x => x ? Math.max(0.5, Math.round(x * flottant(0.85, 1.25) * 2) / 2) : 0;

// Suivi de chantier hebdomadaire sur les affaires en exécution
for (const a of suivies.filter(x => x.groupe === "execution")) {
  const c = chefDe.get(a.id);
  for (let s = 0; s < 4; s++) {
    pose(a, `Suivi de chantier et réception d'armature, semaine ${semaineIso(5 * s)}`, a.role === "urgente" ? 1.5 : 1, 0, c, null, 5 * s, 5 * s + 5, prioDe(a));
    c.charge += a.role === "urgente" ? 1.5 : 1;
    c.curseur += (a.role === "urgente" ? 1.5 : 1) / c.rythme;   // son temps de chantier décale le reste
  }
}

let garde = 0;
while (libre.size && garde++ < 5000) {
  const p = [...libre].sort((x, y) => x.curseur - y.curseur)[0];
  if (p.curseur >= JOURS) { libre.delete(p); continue; }
  // Ses deux affaires d'abord (étapes, puis travail d'appoint pour un
  // ingénieur), et seulement ensuite un coup de main ailleurs
  let a = null, etape = null;
  for (const lot of [p.affaires.slice(0, 2), p.affaires.slice(2)]) {
    for (const af of lot) {
      const k = af.etapes.findIndex(e => p.metier === "dessinateur" ? e.cd > 0 : e.cd === 0);
      if (k >= 0) { a = af; etape = af.etapes.splice(k, 1)[0]; break; }
    }
    if (!etape && p.metier === "ingenieur") {
      a = lot.find(af => af.appoint.length);
      if (a) { const [t, c] = a.appoint.shift(); etape = { titre: t, ci: c, cd: 0 }; }
    }
    if (etape) break;
  }
  if (!etape) { libre.delete(p); continue; }
  const ci = varie(etape.ci), cd = varie(etape.cd);
  const mienne = p.metier === "dessinateur" ? cd : ci;
  const debut = p.curseur, fin = debut + mienne / p.rythme;
  p.curseur = fin; p.charge += mienne;
  let ingenieur = p.metier === "ingenieur" ? p : null;
  if (p.metier === "dessinateur" && ci) {
    // Le calcul d'un plan revient à l'ingénieur de l'affaire le moins avancé
    ingenieur = [chefDe.get(a.id), ...ing.filter(x => x.affaires[0] === a)].sort((x, y) => x.curseur - y.curseur)[0];
    ingenieur.curseur += ci / ingenieur.rythme; ingenieur.charge += ci;
  }
  pose(a, etape.titre, ci, cd, ingenieur, p.metier === "dessinateur" ? p : null, debut, fin, prioDe(a));
}
// Les affaires qui démarrent : l'ingénieur est trouvé, les dessinateurs pas encore
for (const a of actives.filter(x => x.role === "a_staffer")) {
  const c = ing.filter(p => p.profil === "peu").sort((x, y) => lien(y, a) - lien(x, a))[0] || ing[0];
  let t = 9;
  for (const e of a.etapes.slice(0, 4)) {
    const ci = varie(e.ci), cd = varie(e.cd);
    const avant = t;
    t += Math.max(2, Math.max(ci, cd) * 1.2);
    pose(a, e.titre, ci, cd, ci ? c : null, null, avant, t, 3);
    c.charge += ci;
  }
}

/* ---------------------------------------------------------------- compte rendu (sans noms) */
// Charge par semaine : chaque part étalée sur ses jours de calendrier
const parSemaine = new Map(pers.map(p => [p.id, [0, 0, 0, 0]]));
for (const t of nouvelles) {
  for (const [id, c] of [[t.ingenieur_id, t.charge_inge], [t.dessinateur_id, t.charge_dessin]]) {
    if (!id || !c) continue;
    const d0 = t._debut, d1 = t._fin, duree = Math.max(0.5, d1 - d0);
    for (let s = 0; s < 4; s++) {
      const recouvre = Math.max(0, Math.min(d1, 5 * s + 5) - Math.max(d0, 5 * s));
      parSemaine.get(id)[s] += c * recouvre / duree;
    }
  }
}
const affIdx = new Map(actives.map((a, k) => [a.id, "A" + (k + 1)]));
console.log(`\nAffaires : ${actives.map(a => affIdx.get(a.id) + " " + a.groupe + (a.role !== "normale" ? " (" + a.role + ")" : "")).join(" · ")}`);
console.log(`\n${nouvelles.length} tâches, dont ${nouvelles.filter(t => (!t.ingenieur_id && t.charge_inge) || (!t.dessinateur_id && t.charge_dessin)).length} à affecter, ${nouvelles.filter(t => t.statut === "en_cours").length} en cours, ${nouvelles.filter(t => t.statut === "attente").length} en attente.`);
console.log("\nCharge par semaine, en % de la capacité (S45 S46 S47 S48) :");
for (const [nom, l] of [["I", ing], ["D", des]]) {
  l.forEach((p, k) => {
    const cap = Number(p.capacite);
    console.log(`${nom}${String(k + 1).padEnd(3)} ${p.profil.padEnd(9)} ${p.affaires[0] ? affIdx.get(p.affaires[0].id).padEnd(4) : "    "} ` +
      parSemaine.get(p.id).map(x => String(Math.round(x / cap * 100)).padStart(4)).join(""));
  });
}
console.log("\nDétail :");
const pIdx = new Map([...ing.map((p, k) => [p.id, "I" + (k + 1)]), ...des.map((p, k) => [p.id, "D" + (k + 1)])]);
for (const t of nouvelles.slice().sort((x, y) => x.echeance.localeCompare(y.echeance))) {
  console.log(`${t.echeance} ${affIdx.get(t.affaire_id).padEnd(4)} ${t.titre.padEnd(62)} ${String(t.charge_inge).padStart(4)} ${(pIdx.get(t.ingenieur_id) || "—").padEnd(4)}` +
    `${String(t.charge_dessin).padStart(4)} ${(pIdx.get(t.dessinateur_id) || (t.charge_dessin ? "—" : "")).padEnd(4)} ${t.statut}${t.avancement ? " " + t.avancement + "%" : ""} P${t.priorite}`);
}

if (MODE === "essai") { console.log("\nEssai : rien n'est écrit."); process.exit(0); }
if (MODE === "remplace") {
  await supprime(existantes.map(t => t.id));
  console.log(`\n${existantes.length} tâches supprimées (toutes celles du bureau).`);
} else if (demo.length) {
  await supprime(demo.map(t => t.id));
}
const lignes = nouvelles.map(({ _debut, _fin, ...t }) => t);
for (let i = 0; i < lignes.length; i += 100) {
  await rest("taches", { method: "POST", body: lignes.slice(i, i + 100), prefer: "return=minimal" });
}
console.log(`${lignes.length} tâches injectées (date de création ${MARQUE}).`);
