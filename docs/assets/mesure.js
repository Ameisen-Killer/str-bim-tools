// Mesure d'audience du site (15.10.2026), lue sur la page cachée /stats/
// - Une page vue = un appel à note_visite (base Supabase de la planification),
//   puis des points d'étape fin_visite : le temps passé la page VISIBLE à
//   l'écran (un onglet laissé derrière ne compte pas), toutes les 30 s et au départ.
// - Ni cookie ni stockage chez le visiteur ; la base ne garde ni l'adresse IP
//   ni le navigateur (empreinte hachée valable une journée, voir base-supabase.sql).
// - Nom réseau (16.10.2026) : une fois la page vue notée, la fonction Supabase
//   « reseau » inscrit le nom DNS inverse de l'adresse IP (supabase/functions/).
// - Rien n'est compté sur un appareil où « Ne pas compter mes visites » a été
//   coché dans /stats/ (localStorage « stats.ignore »), ni pour un robot.
// - L'adresse et la clé publiable sont celles de /planif/assets/config.js : les
//   changer ensemble.
(function(){
  "use strict";
  var URL_BASE = "https://hxhjkdfnoygrlbdhjkwc.supabase.co";
  var CLE = "sb_publishable_33G_BjGlKGUBhSVIc_QUmQ_QDKC64vA";

  try { if (localStorage.getItem("stats.ignore") === "1") return; } catch (e) {}
  if (navigator.webdriver || /bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(navigator.userAgent || "")) return;
  if (!window.fetch) return;

  function appel(fn, corps, garde){
    return fetch(URL_BASE + "/rest/v1/rpc/" + fn, {
      method: "POST", keepalive: !!garde,
      headers: { apikey: CLE, "Content-Type": "application/json" },
      body: JSON.stringify(corps)
    });
  }

  // Provenance : le domaine d'un site extérieur, ou la page du site d'où l'on vient
  var referent = null, precedent = null;
  try {
    if (document.referrer){
      var r = new URL(document.referrer);
      if (r.hostname === location.hostname) precedent = r.pathname.replace(/index\.html$/, "");
      else referent = r.hostname;
    }
  } catch (e) {}
  var page = location.pathname.replace(/index\.html$/, "");

  var id = null, cumul = 0, depuis = document.hidden ? 0 : Date.now(), dernier = -1;
  function secondes(){ return Math.round((cumul + (depuis ? Date.now() - depuis : 0)) / 1000); }
  function etape(present, garde){
    if (!id) return;
    var s = Math.min(secondes(), 7200);
    if (s === dernier && present) return;
    dernier = s;
    appel("fin_visite", { p_id: id, p_duree: s, p_present: present }, garde).catch(function(){});
  }
  function cache(){
    if (depuis){ cumul += Date.now() - depuis; depuis = 0; }
    etape(false, true);
  }

  appel("note_visite", {
    p_page: page, p_referent: referent, p_precedent: precedent,
    p_langue: (navigator.language || "").slice(0, 2) || null
  }).then(function(r){ return r.ok ? r.json() : null; })
    .then(function(v){
      id = typeof v === "string" ? v : null;
      if (id) fetch(URL_BASE + "/functions/v1/reseau", {
        method: "POST", headers: { apikey: CLE, "Content-Type": "application/json" },
        body: JSON.stringify({ id: id })
      }).catch(function(){});
    })
    .catch(function(){});

  document.addEventListener("visibilitychange", function(){
    if (document.hidden) cache();
    else { depuis = Date.now(); etape(true, false); }
  });
  window.addEventListener("pagehide", cache);
  window.addEventListener("pageshow", function(e){ if (e.persisted && !document.hidden){ depuis = Date.now(); etape(true, false); } });
  setInterval(function(){ if (!document.hidden) etape(true, false); }, 30000);
})();
