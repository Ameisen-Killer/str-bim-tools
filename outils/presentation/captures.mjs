// Captures d'écran du planificateur pour la page de présentation (15.11.2026).
// Lancé par la tâche GitHub « Captures de la présentation » : entre par le bouton
// « Essayer la démo » (Bureau de test, aucune donnée réelle), photographie les
// grandes pages et range les images dans le dossier de la page de présentation.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const SITE = "https://str-bim-tools.com";
const SORTIE = process.env.SORTIE || "docs/planificateur-presentation-q7k3/captures";
mkdirSync(SORTIE, { recursive: true });

const PAGES = [
  ["accueil", "/planif/"],
  ["communication", "/planif/communication/"],
  ["taches", "/planif/taches/"],
  ["tableau-de-bord", "/planif/planning/"],
  ["charge", "/planif/charge/"],
  ["affaires", "/planif/affaires/"],
  ["equipe", "/planif/equipe/"],
  ["absences", "/planif/absences/"],
  ["annuaire", "/planif/annuaire/"],
];

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function entreEnDemo(page) {
  await page.goto(SITE + "/planif/connexion/", { waitUntil: "networkidle" });
  await page.click("#demo");
  await page.waitForURL((u) => !/connexion/.test(u.pathname), { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}

async function photo(page, nom, chemin) {
  try {
    await page.goto(SITE + chemin, { waitUntil: "networkidle", timeout: 45000 });
    await pause(3000);                       // données, animations d'entrée
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SORTIE}/${nom}.jpg`, type: "jpeg", quality: 84 });
    console.log("ok", nom);
  } catch (e) {
    console.log("ÉCHEC", nom, e.message);
  }
}

const nav = await chromium.launch();

// Ordinateur : 1440 × 900, net sur grand écran
const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "fr-CH", timezoneId: "Europe/Zurich" });
const page = await ctx.newPage();
await entreEnDemo(page);
for (const [nom, chemin] of PAGES) await photo(page, nom, chemin);

// L'aide « Charlie » ouverte sur une question
try {
  await page.goto(SITE + "/planif/absences/", { waitUntil: "networkidle" });
  await pause(2000);
  await page.click(".aide-bouton");
  await page.fill(".aide-saisie", "Comment je demande un congé ?");
  await page.keyboard.press("Enter");
  await pause(2500);
  await page.screenshot({ path: `${SORTIE}/aide.jpg`, type: "jpeg", quality: 84 });
  console.log("ok aide");
} catch (e) { console.log("ÉCHEC aide", e.message); }
await ctx.close();

// Téléphone (format Galaxy S24)
const tel = await nav.newContext({ viewport: { width: 384, height: 832 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "fr-CH", timezoneId: "Europe/Zurich" });
const pt = await tel.newPage();
await entreEnDemo(pt);
await photo(pt, "mobile-accueil", "/planif/");
await photo(pt, "mobile-taches", "/planif/taches/");
await tel.close();

await nav.close();
