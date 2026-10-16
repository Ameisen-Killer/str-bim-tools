// Fonction Supabase « reseau » (16.10.2026) : nom réseau d'une page vue.
// Appelée par /assets/mesure.js juste après note_visite, avec l'identifiant de
// la page vue. Elle lit l'adresse IP de l'appelant (en-tête x-forwarded-for),
// cherche son nom DNS inverse (PTR, par DNS sur HTTPS chez Cloudflare) et
// l'inscrit dans visites.reseau. L'adresse IP n'est écrite nulle part.
// reseau = '' quand l'adresse n'a pas de nom. Une page vue de plus de
// 5 minutes, ou déjà renseignée, n'est plus modifiée.
// À déployer dans le tableau de bord Supabase, « Verify JWT » désactivé
// (voir reglages-supabase.md, « Nom réseau des visites »).

const ORIGINES = ["https://str-bim-tools.com", "https://www.str-bim-tools.com"];
const URL_BASE = Deno.env.get("SUPABASE_URL") ?? "";
const CLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function entetes(origine: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(origine) ? origine : ORIGINES[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Vary": "Origin",
  };
}

// 1.2.3.4 → 4.3.2.1.in-addr.arpa ; IPv6 → 32 chiffres hexadécimaux inversés + ip6.arpa
function nomInverse(ip: string): string | null {
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (v4) return `${v4[4]}.${v4[3]}.${v4[2]}.${v4[1]}.in-addr.arpa`;
  if (!/^[0-9a-f:]+$/i.test(ip) || ip.split("::").length > 2) return null;
  const abrege = ip.includes("::");
  const [g, d] = ip.split("::");
  const gauche = g ? g.split(":") : [], droite = d ? d.split(":") : [];
  const manque = 8 - gauche.length - droite.length;
  if (abrege ? manque < 1 : manque !== 0) return null;
  const groupes = [...gauche, ...Array(abrege ? manque : 0).fill("0"), ...droite];
  if (groupes.some((x) => x.length < 1 || x.length > 4)) return null;
  return groupes.map((x) => x.padStart(4, "0")).join("").toLowerCase().split("").reverse().join(".") + ".ip6.arpa";
}

// Nom PTR, '' s'il n'y en a pas, null si la résolution a échoué
async function resout(nom: string): Promise<string | null> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${nom}&type=PTR`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (j.Status !== 0 && j.Status !== 3) return null;
  const ptr = (j.Answer ?? []).find((a: { type: number }) => a.type === 12);
  if (!ptr) return "";
  const n = String(ptr.data).toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9._-]{1,253}$/.test(n) ? n : "";
}

Deno.serve(async (req) => {
  const h = entetes(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: h });

  let id = "";
  try { id = String((await req.json()).id ?? ""); } catch { /* corps illisible */ }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response(null, { status: 400, headers: h });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const nom = nomInverse(ip);
  const reseau = nom ? await resout(nom).catch(() => null) : null;
  if (reseau === null || !URL_BASE || !CLE) return new Response(null, { status: 204, headers: h });

  const depuis = new Date(Date.now() - 5 * 60_000).toISOString();
  const auth: Record<string, string> = { apikey: CLE };
  if (CLE.startsWith("eyJ")) auth.Authorization = `Bearer ${CLE}`;
  await fetch(`${URL_BASE}/rest/v1/visites?id=eq.${id}&reseau=is.null&le=gte.${encodeURIComponent(depuis)}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ reseau }),
  }).catch(() => null);
  return new Response(null, { status: 204, headers: h });
});
