// Fonction Supabase « fgh-arm-mail » (03.11.2026) : envoie par mail une ou plusieurs fiches de
// contrôle d'armatures de l'outil /fgh/arm/, via Resend, depuis une adresse du domaine.
// La page dépose d'abord les PDF dans le seau privé fgh-arm (dossier m/…), puis appelle cette
// fonction avec { a: [adresses], sujet, texte, fichiers: [{ chemin, nom }] }. La fonction lit les
// PDF avec la clé de service, les joint au mail, puis les efface du seau.
// Garde-fou : seules les adresses ou domaines listés dans FGH_MAIL_AUTORISES sont acceptés
// (ex. « @ab-ing.ch, varintony@gmail.com »), pour que personne ne s'en serve pour écrire à n'importe qui.
// Depuis le 13.11.2026, seule une personne connectée aux outils FGH (identifiants de la
// planification, fonction acces_fgh de la base) peut s'en servir : son jeton est relu ici.
// À déployer dans le tableau de bord Supabase, « Verify JWT » désactivé, avec les secrets
// RESEND_API_KEY, FGH_MAIL_AUTORISES et, au choix, FGH_MAIL_DE (voir reglages-supabase.md).
// SUPABASE_ANON_KEY est fourni d'office par Supabase aux fonctions.

const ORIGINES = ["https://str-bim-tools.com", "https://www.str-bim-tools.com"];
const URL_BASE = Deno.env.get("SUPABASE_URL") ?? "";
const CLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DE = Deno.env.get("FGH_MAIL_DE") || "Contrôle armatures FGH <contact@str-bim-tools.com>";
const AUTORISES = (Deno.env.get("FGH_MAIL_AUTORISES") ?? "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

function entetes(origine: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(origine) ? origine : ORIGINES[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Vary": "Origin",
  };
}

function reponse(corps: unknown, statut: number, origine: string): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...entetes(origine), "Content-Type": "application/json" } });
}

const MAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
const CHEMIN = /^m\/[a-z0-9]{8,40}\/fiche-\d{1,2}\.pdf$/;

function autorise(adresse: string): boolean {
  const a = adresse.toLowerCase();
  return AUTORISES.some((x) => (x.startsWith("@") ? a.endsWith(x) : a === x));
}

// La personne qui appelle a-t-elle accès aux outils FGH ? (jeton de connexion de la page)
async function accesFgh(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !ANON) return false;
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/acces_fgh`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" },
      body: "{}",
    });
    return r.ok && (await r.json()) === true;
  } catch {
    return false;
  }
}

function base64(octets: Uint8Array): string {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
}

async function retire(chemins: string[]) {
  if (!chemins.length) return;
  await fetch(`${URL_BASE}/storage/v1/object/fgh-arm`, {
    method: "DELETE",
    headers: { apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: chemins }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const origine = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: entetes(origine) });
  if (req.method !== "POST") return reponse({ ok: false, erreur: "méthode non permise" }, 405, origine);
  if (!RESEND || !CLE || !URL_BASE) return reponse({ ok: false, erreur: "fonction pas encore réglée (secret RESEND_API_KEY manquant)" }, 500, origine);
  if (!AUTORISES.length) return reponse({ ok: false, erreur: "aucune adresse autorisée (secret FGH_MAIL_AUTORISES vide)" }, 500, origine);

  if (!(await accesFgh(req))) return reponse({ ok: false, erreur: "connexion aux outils FGH requise" }, 403, origine);

  let q: { a?: unknown; sujet?: unknown; texte?: unknown; fichiers?: unknown };
  try { q = await req.json(); } catch { return reponse({ ok: false, erreur: "demande illisible" }, 400, origine); }

  const a = Array.isArray(q.a) ? q.a.map((x) => String(x).trim()).filter(Boolean) : [];
  const fichiers = Array.isArray(q.fichiers) ? q.fichiers as { chemin?: unknown; nom?: unknown }[] : [];
  const chemins = fichiers.map((f) => String(f?.chemin ?? ""));
  if (!a.length || a.length > 10 || a.some((x) => !MAIL.test(x))) { await retire(chemins); return reponse({ ok: false, erreur: "adresse(s) invalide(s)" }, 400, origine); }
  const refusees = a.filter((x) => !autorise(x));
  if (refusees.length) { await retire(chemins); return reponse({ ok: false, erreur: "adresse non autorisée : " + refusees.join(", ") }, 403, origine); }
  if (!fichiers.length || fichiers.length > 10 || chemins.some((c) => !CHEMIN.test(c))) return reponse({ ok: false, erreur: "pièces jointes invalides" }, 400, origine);

  const pj: { filename: string; content: string }[] = [];
  let total = 0;
  for (const f of fichiers) {
    const chemin = String(f.chemin);
    const r = await fetch(`${URL_BASE}/storage/v1/object/authenticated/fgh-arm/${chemin}`, { headers: { apikey: CLE, Authorization: `Bearer ${CLE}` } });
    if (!r.ok) { await retire(chemins); return reponse({ ok: false, erreur: "fiche PDF introuvable dans le stockage" }, 400, origine); }
    const octets = new Uint8Array(await r.arrayBuffer());
    total += octets.length;
    if (total > 35 * 1024 * 1024) { await retire(chemins); return reponse({ ok: false, erreur: "pièces jointes trop lourdes (35 Mo au plus)" }, 413, origine); }
    let nom = String(f.nom ?? "fiche.pdf").replace(/[\\/:*?"<>|\r\n]/g, "-").slice(0, 150);
    if (!/\.pdf$/i.test(nom)) nom += ".pdf";
    pj.push({ filename: nom, content: base64(octets) });
  }

  const envoi = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: DE,
      to: a,
      subject: String(q.sujet ?? "Contrôle d'armatures").slice(0, 200),
      text: String(q.texte ?? "").slice(0, 8000),
      attachments: pj,
    }),
  });
  await retire(chemins);
  if (!envoi.ok) {
    let m = "erreur " + envoi.status;
    try { const j = await envoi.json(); m = j.message || j.name || m; } catch { /* rien */ }
    return reponse({ ok: false, erreur: "Resend a refusé l'envoi : " + m }, 502, origine);
  }
  const j = await envoi.json().catch(() => ({}));
  return reponse({ ok: true, id: (j as { id?: string }).id ?? "" }, 200, origine);
});
