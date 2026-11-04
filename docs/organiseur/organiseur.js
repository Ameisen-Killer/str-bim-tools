// Organiseur de documents (04.11.2026) : numérotation des documents d'un chantier.
// Chaque chantier porte ses référentiels (gabarit du code, disciplines, phases, types,
// bâtiments, niveaux, zones) et un arbre de plages de numéros construit par l'utilisateur.
// On y réserve à l'avance des blocs de n° ; un n° devient « émis » quand il apparaît dans
// la liste de plans liée (pour le Fairmont : la table fgh_plans de /fgh/pln/).
// Base Supabase (tables doc_chantiers et doc_reservations, migration-organiseur.sql),
// export et import JSON par chantier.
(function () {
  "use strict";
  var BASE = { url: "https://hxhjkdfnoygrlbdhjkwc.supabase.co", cle: "sb_publishable_33G_BjGlKGUBhSVIc_QUmQ_QDKC64vA" };
  var GABARIT = ["projet", "discipline", "emetteur", "phase", "type", "niveau", "zone", "numero"];
  // les trigrammes possibles du code, dans l'ordre où l'utilisateur les range (glisser-déposer)
  var SEGMENTS = { projet: "Projet", discipline: "Discipline", emetteur: "Émetteur", phase: "Phase", type: "Type", batiment: "Bâtiment", niveau: "Niveau", zone: "Zone", numero: "N°" };

  var $ = function (s) { return document.querySelector(s); };
  var VUE_RES = [], CH = [], CUR = null, CONF = null, RES = [], PLANS = [], SEL = "", ESPACE = "*", VUE = "plages", SALE = false;

  // ------------------------------------------------------------------ outils
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function plie(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(m, ms) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, ms || 2800); }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function dateFr(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? m[3] + "." + m[2] + "." + m[1] : ""; }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function U(s) { return String(s == null ? "" : s).trim().toUpperCase(); }
  function etat(txt, classe) { var e = $("#etat"); e.className = "etat " + (classe || ""); e.innerHTML = "<span>" + esc(txt) + "</span>"; e.title = txt; }
  function moi() { return lsGet("org.nom") || ""; }

  // ------------------------------------------------------------------ base
  // Mode fichier (par défaut depuis le 04.11.2026, demande de Tony) : chantiers et réservations
  // vivent dans ce navigateur (localStorage « org.donnees ») et se sauvent ou s'ouvrent en JSON.
  // La base Supabase reste prête : ?base=1 dans l'adresse (retenu), ?base=0 pour revenir au fichier.
  var LOCAL = (function () {
    var q = /[?&]base=([01])/.exec(location.search); if (q) lsSet("org.mode", q[1] === "1" ? "base" : "fichier");
    return lsGet("org.mode") !== "base";
  })();
  function nouvelId() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function litLocal() { try { var d = JSON.parse(lsGet("org.donnees") || "null"); if (d && Array.isArray(d.chantiers) && Array.isArray(d.reservations)) return d; } catch (e) {} return { chantiers: [], reservations: [] }; }
  function ecritLocal(d) {
    try { localStorage.setItem("org.donnees", JSON.stringify(d)); } catch (e) { throw new Error("Le navigateur refuse d'enregistrer (stockage plein ou navigation privée) : exporte le JSON."); }
    lsSet("org.modifie", new Date().toISOString());
  }
  function refus(m, code) { var e = new Error(m); e.code = code; return e; }
  // les quelques appels de l'outil, rejoués sur les données du navigateur (mêmes règles que la base)
  function local(chemin, o) {
    return Promise.resolve().then(function () {
      var m = /^(doc_chantiers|doc_reservations)(?:\?(.*))?$/.exec(chemin); if (!m) throw new Error("Appel local inconnu.");
      var d = litLocal(), t = m[1] === "doc_chantiers" ? d.chantiers : d.reservations, P = {}, maint = new Date().toISOString();
      (m[2] || "").split("&").forEach(function (x) { var i = x.indexOf("="); if (i > 0) P[x.slice(0, i)] = decodeURIComponent(x.slice(i + 1)); });
      var filtre = function (r) { return Object.keys(P).every(function (k) { return !/^eq\./.test(P[k]) || String(r[k]) === P[k].slice(3); }); };
      var meth = o.methode || "GET";
      if (meth === "GET") {
        var l = t.filter(filtre), ord = P.order;
        if (ord) l.sort(function (a, b) { return a[ord] < b[ord] ? -1 : a[ord] > b[ord] ? 1 : 0; });
        var pl = /^(\d+)-(\d+)$/.exec(o.plage || ""); return copie(pl ? l.slice(+pl[1], +pl[2] + 1) : l);
      }
      function verifie(r) {
        if (m[1] === "doc_chantiers") {
          if (d.chantiers.some(function (c) { return c.id !== r.id && U(c.code) === U(r.code); })) throw refus("Ce code de chantier existe déjà.", "23505");
          return;
        }
        if (r.statut === "annule") return;
        var c = d.chantiers.filter(function (x) { return x.id === r.chantier; })[0], pr = {};
        ((c && c.config && c.config.types) || []).forEach(function (y) { if (y.propre) pr[U(y.c)] = 1; });
        var esp = function (ty) { return pr[U(ty)] ? U(ty) : "*"; };
        var a = d.reservations.filter(function (x) { return x.chantier === r.chantier && x.id !== r.id && x.statut !== "annule" && esp(x.type) === esp(r.type) && x.de <= r.a && r.de <= x.a; })[0];
        if (a) throw refus("Numéros déjà réservés : " + a.de + " à " + a.a + " (" + a.titre + ")", "23P01");
      }
      if (meth === "POST") {
        var r = copie(o.corps), ex = r.id ? t.filter(function (x) { return x.id === r.id; })[0] : null;
        if (ex) { var n = Object.assign(copie(ex), r, { modifie_le: maint }); verifie(n); t[t.indexOf(ex)] = n; ecritLocal(d); return [copie(n)]; }
        r.id = r.id || nouvelId(); r.cree_le = r.modifie_le = maint;
        if (m[1] === "doc_reservations") r = Object.assign({ discipline: "", phase: "", batiment: "", niveau: "", zone: "", titre: "", par: "", echeance: null, statut: "reserve", remarque: "" }, r);
        else r = Object.assign({ nom: "", config: {} }, r);
        verifie(r); t.push(r); ecritLocal(d); return [copie(r)];
      }
      var vis = t.filter(filtre);
      if (meth === "PATCH") {
        var sortie = vis.map(function (x) { var n = Object.assign(copie(x), copie(o.corps), { modifie_le: maint }); verifie(n); return n; });
        sortie.forEach(function (n) { var i = t.findIndex(function (x) { return x.id === n.id; }); t[i] = n; });
        ecritLocal(d); return copie(sortie);
      }
      if (meth === "DELETE") {
        vis.forEach(function (x) { t.splice(t.indexOf(x), 1); });
        if (m[1] === "doc_chantiers") d.reservations = d.reservations.filter(function (x) { return !vis.some(function (c) { return c.id === x.chantier; }); });
        ecritLocal(d); return null;
      }
      throw new Error("Appel local inconnu.");
    });
  }
  function appel(chemin, o) {
    o = o || {};
    if (LOCAL && /^doc_/.test(chemin)) return local(chemin, o);
    var h = { apikey: BASE.cle };
    if (o.corps !== undefined) h["Content-Type"] = "application/json";
    if (o.prefer) h.Prefer = o.prefer;
    if (o.plage) h.Range = o.plage;
    return fetch(BASE.url + "/rest/v1/" + chemin, { method: o.methode || "GET", headers: h, body: o.corps === undefined ? undefined : JSON.stringify(o.corps) })
      .catch(function () { throw new Error("Serveur injoignable : vérifie ta connexion, puis réessaie."); })
      .then(function (r) {
        if (r.ok) return r.status === 204 ? null : r.text().then(function (t) { return t ? JSON.parse(t) : null; });
        return r.text().then(function (t) {
          var j = {}; try { j = JSON.parse(t); } catch (e) {}
          var brut = String(j.message || j.error || "") + " " + (j.code || "");
          var err = new Error(/PGRST205|42P01|does not exist|could not find the table/i.test(brut)
            ? "Les tables de l'organiseur n'existent pas encore : exécute migration-organiseur.sql dans Supabase."
            : j.code === "23P01" ? j.message
            : j.code === "23505" ? "Ce code de chantier existe déjà."
            : /row-level security|permission/i.test(brut) || r.status === 401 || r.status === 403 ? "Opération refusée par la base."
            : "Base : " + (j.message || "erreur " + r.status) + ".");
          err.manque = /PGRST205|42P01|could not find the table/i.test(brut);
          throw err;
        });
      });
  }
  function litTout(chemin) {
    var tout = [];
    function page(d) {
      return appel(chemin, { plage: d + "-" + (d + 999) }).then(function (l) {
        tout = tout.concat(l || []);
        return l && l.length === 1000 ? page(d + 1000) : tout;
      });
    }
    return page(0);
  }

  // ------------------------------------------------------------------ modèles
  function confVide() {
    return { segments: GABARIT.slice(), separateur: "-", chiffres: 4, fixes: { emetteur: "" }, liste_plans: "",
      disciplines: [], phases: [], types: [], batiments: [], niveaux: [], zones: [], plages: [] };
  }
  // Fairmont : référentiels repris de /fgh/pln/ (codes Kairnial, liste des livrables AB du 11.09.2025)
  function confFairmont(zones) {
    var c = confVide();
    c.fixes = { emetteur: "ABI" };
    c.liste_plans = "fgh_plans";
    c.disciplines = [{ c: "STR", lib: "Structure" }];
    c.phases = [{ c: "51", lib: "Projet d'exécution (SIA 112)" }];
    var T = { PLA: "Plan", ARM: "Armatures", LIS: "Listes de fers", ELV: "Élévation", DET: "Détail", NDC: "Note de calcul", DES: "Descriptif",
      RAP: "Rapport", CPE: "Coupe", SCH: "Schéma", CDC: "Cahier des charges", FTE: "Fiche technique", RFI: "RFI", MOD: "Maquette" };
    c.types = Object.keys(T).map(function (k) { return { c: k, lib: T[k], propre: k === "ARM" || k === "LIS" }; });
    c.batiments = [{ c: "FGH", lib: "Hôtel Fairmont Genève" }];
    var N = { "000": "Tous niveaux", "050": "SS-4", "060": "SS-3", "070": "SS-2", "080": "SS-1", "090": "Rez inf", "100": "Rez",
      "110": "Étage 1", "120": "Étage 2", "130": "Étage 3", "140": "Étage 4", "150": "Étage 5", "160": "Étage 6", "170": "Étage 7", "180": "Étage 8", "190": "Toiture" };
    c.niveaux = Object.keys(N).map(function (k) { return { c: k, lib: N[k], bat: "" }; });
    c.zones = (zones && zones.length ? zones : ["TTZ"]).map(function (z) { return { c: z, lib: z === "TTZ" ? "Toutes zones" : "Zone " + z, bat: "" }; });
    function P(lib, de, a, sous) { return { lib: lib, de: de, a: a, types: [], sous: (sous || []).map(function (s) { return P(s[2], s[0], s[1]); }) }; }
    c.plages = [
      P("Géotechnique", 1, 99), P("Notes de calcul", 100, 499), P("Convention d'utilisation", 500, 529),
      P("Repérage des sondages", 530, 549), P("Plans généraux au 1/100", 550, 999),
      P("1 - Démolition", 1000, 1499), P("2 - Renforcement", 1500, 1999),
      P("3 - Reconstruction / Extension", 2000, 2499, [[2000, 2099, "3.1 - Triangles façades"], [2100, 2199, "3.2 - Parking"], [2200, 2299, "3.3 - Socle"], [2300, 2499, "3.4 - Noyaux"]]),
      P("4 - Charpente métallique", 2500, 3499, [[2500, 2599, "4.1 - Parking SS-1"], [2600, 2699, "4.2 - Théâtre"], [2700, 2799, "4.3 - Piscine"], [2800, 2999, "4.4 - Marquises / Pergolas"], [3000, 3199, "4.5 - Façade Mont-Blanc"], [3200, 3399, "4.6 - Façade Patio"], [3400, 3499, "4.7 - Toiture"]])
    ];
    return c;
  }
  // garde une configuration lisible même si elle vient d'un JSON incomplet
  function normalise(c) {
    var d = confVide(); c = c && typeof c === "object" ? c : {};
    Object.keys(d).forEach(function (k) { if (c[k] == null || (Array.isArray(d[k]) && !Array.isArray(c[k]))) c[k] = d[k]; });
    if (typeof c.fixes !== "object") c.fixes = {};
    // ancien gabarit texte « {projet}-{type}-… » : converti en liste de trigrammes
    if (typeof c.gabarit === "string") { var g = c.gabarit.match(/\{(\w+)\}/g); if (g) c.segments = g.map(function (x) { return x.slice(1, -1); }); }
    delete c.gabarit;
    c.segments = (Array.isArray(c.segments) ? c.segments : GABARIT.slice()).filter(function (k, i, a) { return SEGMENTS[k] && a.indexOf(k) === i; });
    if (c.segments.indexOf("numero") < 0) c.segments.push("numero");
    if (typeof c.separateur !== "string" || c.separateur.length > 3) c.separateur = "-";
    c.chiffres = Math.max(1, Math.min(6, parseInt(c.chiffres, 10) || 4));
    (function nettoie(L) { L.forEach(function (p) { p.types = Array.isArray(p.types) ? p.types : []; p.sous = Array.isArray(p.sous) ? p.sous : []; nettoie(p.sous); }); })(c.plages);
    return c;
  }

  // ------------------------------------------------------------------ numérotation
  function pad(n) { var s = String(n); while (s.length < CONF.chiffres) s = "0" + s; return s; }
  function lib(liste, c) { var x = (CONF[liste] || []).filter(function (e) { return U(e.c) === U(c); })[0]; return x ? x.lib : ""; }
  function propres() { var m = {}; CONF.types.forEach(function (t) { if (t.propre) m[U(t.c)] = 1; }); return m; }
  function espace(t) { return propres()[U(t)] ? U(t) : "*"; }
  function valeurs(r, n) {
    var v = { projet: CUR ? (CUR._code != null ? U(CUR._code) : CUR.code) : "", discipline: r.discipline, emetteur: CONF.fixes.emetteur, phase: r.phase, type: r.type,
      batiment: r.batiment, niveau: r.niveau, zone: r.zone, numero: n == null ? "" : pad(n) };
    Object.keys(v).forEach(function (k) { if (v[k] == null || v[k] === "") v[k] = CONF.fixes[k] || ""; });
    return v;
  }
  function codeDoc(r, n) {
    var v = valeurs(r, n);
    return CONF.segments.map(function (k) { return v[k] === "" ? "···" : v[k]; }).join(CONF.separateur);
  }
  // plages à plat : { p: nœud, d: profondeur, cle: "0.2", chemin }
  function aplat() {
    var L = [];
    (function marche(nds, d, cle, chemin) {
      nds.forEach(function (p, i) { var k = cle ? cle + "." + i : String(i), ch = chemin ? chemin + " › " + p.lib : p.lib; L.push({ p: p, d: d, cle: k, chemin: ch }); marche(p.sous || [], d + 1, k, ch); });
    })(CONF.plages, 0, "", "");
    return L;
  }
  function plageDe(cle) { return aplat().filter(function (x) { return x.cle === cle; })[0] || null; }
  // la plage la plus fine qui contient tout le bloc
  function plageDuBloc(de, a) { var b = null; aplat().forEach(function (x) { if (+x.p.de <= de && a <= +x.p.a) b = x; }); return b; }
  function actives() { return RES.filter(function (r) { return r.statut !== "annule"; }); }
  // occupation d'une suite de numéros : n → { r: réservation, pl: [plans émis] }
  function occupation(esp) {
    var m = {};
    actives().forEach(function (r) { if (espace(r.type) !== esp) return; for (var n = r.de; n <= r.a; n++) (m[n] = m[n] || { pl: [] }).r = r; });
    PLANS.forEach(function (p) { var n = parseInt(p.numero, 10); if (isNaN(n) || espace(p.type) !== esp) return; (m[n] = m[n] || { pl: [] }).pl.push(p); });
    return m;
  }
  function premierBloc(de, a, nb, esp, sauf) {
    var occ = occupation(esp);
    if (sauf) for (var k = sauf.de; k <= sauf.a; k++) if (occ[k] && occ[k].r === sauf && !occ[k].pl.length) delete occ[k];
    var suite = 0;
    for (var n = de; n <= a; n++) { if (occ[n]) suite = 0; else if (++suite === nb) return n - nb + 1; }
    return null;
  }
  function emisDans(r) {
    var esp = espace(r.type), n = 0;
    PLANS.forEach(function (p) { var k = parseInt(p.numero, 10); if (k >= r.de && k <= r.a && espace(p.type) === esp) n++; });
    return n;
  }
  function statutDe(r) {
    if (r.statut === "annule") return { c: "annule", t: "Annulé" };
    var e = emisDans(r), tot = r.a - r.de + 1;
    if (r.statut === "emis" || (e && e >= tot)) return { c: "emis", t: "Émis" + (tot > 1 ? " " + (e || tot) + "/" + tot : "") };
    return { c: "reserve", t: e ? "Réservé · " + e + "/" + tot + " émis" : "Réservé" };
  }

  // ------------------------------------------------------------------ chargement
  function charge() {
    etat("Chargement…");
    return appel("doc_chantiers?select=*&order=code").then(function (l) {
      CH = l || [];
      var id = lsGet("org.chantier"), c = CH.filter(function (x) { return x.id === id; })[0] || CH[0] || null;
      remplitChantiers(c);
      if (!c) { CUR = null; ecranVide(); etat("Aucun chantier", "ok"); return; }
      return ouvre(c);
    }).catch(function (e) {
      etat("Base indisponible", "ko"); CUR = null;
      ecranVide(e.manque ? "La base n'est pas encore prête" : "Base indisponible", e.message, e.manque);
    });
  }
  function remplitChantiers(c) {
    $("#chantier").innerHTML = CH.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.code + (x.nom ? " · " + x.nom : "")) + "</option>"; }).join("") +
      '<option value="+">+ Nouveau chantier…</option>';
    if (c) $("#chantier").value = c.id;
  }
  function ouvre(c) {
    delete c._code; delete c._nom; CUR = c; CONF = normalise(copie(c.config)); SALE = false; lsSet("org.chantier", c.id);
    if (SEL && !plageDe(SEL)) SEL = "";
    return rechargeDonnees();
  }
  function aExporter() { var m = lsGet("org.modifie"), x = lsGet("org.exporte"); return !!m && (!x || m > x); }
  function rechargeDonnees(silence) {
    if (!CUR) return Promise.resolve();
    if (!silence) etat("Chargement…");
    var id = CUR.id;
    return Promise.all([
      litTout("doc_reservations?select=*&chantier=eq." + id + "&order=de"),
      CONF.liste_plans === "fgh_plans" ? litTout("fgh_plans?select=type,niveau,zone,numero,indice,titre&order=numero").catch(function () { return []; }) : Promise.resolve([])
    ]).then(function (r) {
      if (!CUR || CUR.id !== id) return;
      RES = r[0]; PLANS = dernierIndice(r[1]);
      etat(RES.length + " réservation(s)" + (CONF.liste_plans ? " · " + PLANS.length + " plans" : "") + (LOCAL ? " · fichier dans ce navigateur" + (aExporter() ? ", à exporter" : "") : " · à jour"), LOCAL && aExporter() ? "" : "ok");
      dessine();
    }).catch(function (e) { etat("Base indisponible", "ko"); toast(e.message, 5000); });
  }
  // un livrable = type-niveau-zone-n° ; seul l'indice le plus récent compte
  function dernierIndice(l) {
    var m = {};
    (l || []).forEach(function (p) { var k = [U(p.type), U(p.niveau), U(p.zone), U(p.numero)].join("|"); if (!m[k] || String(p.indice) > String(m[k].indice)) m[k] = p; });
    return Object.keys(m).map(function (k) { return m[k]; });
  }

  function ecranVide(titre, texte, manque) {
    ["plages", "res", "ref"].forEach(function (v) { $("#v-" + v).hidden = true; });
    $("#v-vide").hidden = false;
    $("#vide").innerHTML = "<h2>" + esc(titre || "Aucun chantier pour l'instant") + "</h2><p>" +
      esc(texte || "Crée un premier chantier : vide, pour bâtir toi-même tes référentiels et tes plages, ou prérempli avec la numérotation du Fairmont. Tu peux aussi ouvrir un JSON exporté avec « Importer ».") + "</p>" +
      (manque ? '<p>Une fois la migration passée, recharge la page (Ctrl+F5).</p>' :
        '<div class="actions"><button class="btn accent" data-m="fgh">Chantier Fairmont prérempli</button><button class="btn" data-m="vide">Chantier vide</button></div>');
  }
  $("#vide").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-m]"); if (!b) return;
    if (b.dataset.m === "fgh") creeChantier("FGH", "Hôtel Fairmont Genève", "fgh"); else ouvreNouveau();
  });

  // ------------------------------------------------------------------ chantiers
  function zonesFgh() {
    return litTout("fgh_plans?select=zone").then(function (l) {
      var m = {}; (l || []).forEach(function (p) { if (p.zone) m[U(p.zone)] = 1; });
      return Object.keys(m).sort(function (a, b) { return (a === "TTZ") - (b === "TTZ") || a.localeCompare(b); });
    }).catch(function () { return []; });
  }
  function creeChantier(code, nom, modele) {
    var conf = modele === "fgh" ? zonesFgh().then(confFairmont)
      : Promise.resolve(modele && modele !== "vide" ? (function () { var c = CH.filter(function (x) { return x.id === modele; })[0]; var k = normalise(copie(c ? c.config : {})); k.liste_plans = ""; return k; })() : confVide());
    return conf.then(function (config) {
      return appel("doc_chantiers", { methode: "POST", prefer: "return=representation", corps: { code: U(code), nom: nom || "", config: config, modifie_par: moi() } });
    }).then(function (l) {
      var c = l && l[0]; if (!c) return;
      CH.push(c); CH.sort(function (a, b) { return a.code.localeCompare(b.code); });
      $("#v-vide").hidden = true; remplitChantiers(c); toast("Chantier " + c.code + " créé."); VUE = modele === "vide" ? "ref" : "plages"; return ouvre(c);
    }).catch(function (e) { toast(e.message, 5000); });
  }
  function ouvreNouveau() {
    var F = $("#fc"); F.reset();
    $("#fc-modele").innerHTML = '<option value="vide">Rien (référentiels et plages à créer)</option><option value="fgh">Numérotation du Fairmont (préremplie)</option>' +
      CH.map(function (x) { return '<option value="' + esc(x.id) + '">Copie des référentiels et plages de ' + esc(x.code) + "</option>"; }).join("");
    $("#voile-ch").hidden = false; setTimeout(function () { F.elements.code.focus(); }, 30);
  }
  $("#fc").addEventListener("submit", function (e) {
    e.preventDefault(); var F = this;
    if (CH.some(function (x) { return U(x.code) === U(F.elements.code.value); })) { toast("Ce code de chantier existe déjà."); return; }
    $("#voile-ch").hidden = true; creeChantier(F.elements.code.value, F.elements.nom.value.trim(), F.elements.modele.value);
  });
  $("#fc-fermer").addEventListener("click", function () { $("#voile-ch").hidden = true; if (CUR) $("#chantier").value = CUR.id; });
  $("#chantier").addEventListener("change", function () {
    if (this.value === "+") { ouvreNouveau(); return; }
    if (SALE && !confirmeQuitter()) { this.value = CUR.id; return; }
    var c = CH.filter(function (x) { return x.id === $("#chantier").value; })[0]; if (c) ouvre(c);
  });
  function confirmeQuitter() { return window.confirm("Les changements des référentiels ne sont pas enregistrés. Les abandonner ?"); }

  // ------------------------------------------------------------------ vues
  function dessine() {
    if (!CUR) return;
    $("#v-vide").hidden = true;
    document.querySelectorAll(".onglets button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.v === VUE); });
    ["plages", "res", "ref"].forEach(function (v) { $("#v-" + v).hidden = v !== VUE; });
    if (VUE === "plages") dessinePlages(); else if (VUE === "res") dessineRes(); else dessineRef();
  }
  document.querySelector(".onglets").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (!b || !CUR) return;
    if (VUE === "ref" && b.dataset.v !== "ref" && SALE && !confirmeQuitter()) return;
    if (VUE === "ref" && b.dataset.v !== "ref" && SALE) { CONF = normalise(copie(CUR.config)); SALE = false; }
    VUE = b.dataset.v; dessine();
  });

  // ---------- plages
  function stats(p, esp) {
    var occ = occupation(esp), e = 0, r = 0, tot = Math.max(0, p.a - p.de + 1);
    for (var n = +p.de; n <= +p.a; n++) { var o = occ[n]; if (!o) continue; if (o.pl.length) e++; else if (o.r) r++; }
    return { e: e, r: r, tot: tot, libre: tot - e - r };
  }
  function dessinePlages() {
    var L = aplat();
    var h = '<div class="titre-arbre">Plages du chantier</div>';
    if (!L.length) h += '<div class="vide" style="padding:10px">Aucune plage. Construis ton arbre dans l\'onglet « Référentiels du chantier ».</div>';
    L.forEach(function (x) {
      var s = stats(x.p, "*"), pe = s.tot ? s.e / s.tot * 100 : 0, pr = s.tot ? s.r / s.tot * 100 : 0;
      h += '<button type="button" class="lot' + (x.d ? " sous" : "") + '" style="padding-left:' + (10 + x.d * 16) + 'px" data-k="' + x.cle + '" aria-current="' + (SEL === x.cle) + '">' +
        '<span class="nom">' + esc(x.p.lib || "(sans nom)") + '</span><span class="bornes">' + pad(x.p.de) + "–" + pad(x.p.a) + "</span>" +
        '<span class="jauge"><i class="e" style="width:' + pe + '%"></i><i class="r" style="width:' + pr + '%"></i></span>' +
        "<small>" + s.libre + " libre(s) · " + s.r + " réservé(s) · " + s.e + " émis" + (x.p.types.length ? " · " + esc(x.p.types.join(", ")) : "") + "</small></button>";
    });
    var hors = RES.filter(function (r) { return r.statut !== "annule" && !plageDuBloc(r.de, r.a); }).length;
    if (hors) h += '<div class="titre-arbre">' + hors + " réservation(s) hors plage</div>";
    $("#arbre").innerHTML = h;
    dessineDetail();
  }
  $("#arbre").addEventListener("click", function (e) { var b = e.target.closest(".lot"); if (!b) return; SEL = b.dataset.k; dessinePlages(); });

  function dessineDetail() {
    var x = SEL ? plageDe(SEL) : null, D = $("#detail");
    if (!x) {
      var tot = actives().length;
      D.innerHTML = '<h2>' + esc(CUR.code + (CUR.nom ? " · " + CUR.nom : "")) + '</h2><div class="sous-t">' + aplat().length + " plage(s) · " + tot + " réservation(s) active(s)" + (CONF.liste_plans ? " · " + PLANS.length + " plans émis lus dans la liste des plans" : "") + "</div>" +
        '<p class="vide" style="padding:0">Choisis une plage à gauche pour voir ses numéros : libres, réservés, émis. Un clic sur un n° libre le réserve.</p>' +
        '<div class="apercu">' + esc(codeDoc({ type: "", discipline: "", phase: "", niveau: "", zone: "" }, null)) + "</div>";
      return;
    }
    var p = x.p, esps = ["*"].concat(Object.keys(propres()));
    if (esps.indexOf(ESPACE) < 0) ESPACE = "*";
    var s = stats(p, ESPACE), occ = occupation(ESPACE), cases = "";
    if (p.a - p.de > 5000) cases = '<p class="vide" style="padding:0">Plage trop grande pour afficher chaque numéro.</p>';
    else for (var n = +p.de; n <= +p.a; n++) {
      var o = occ[n], c = "case", t = pad(n) + " · libre";
      if (o && o.pl.length) { c += o.r ? " e" : " h"; t = pad(n) + " · émis : " + o.pl.map(function (q) { return q.type + " ind " + q.indice + " " + (q.titre || ""); }).join(" / ") + (o.r ? "" : " (sans réservation)"); }
      else if (o && o.r) { c += " r"; t = pad(n) + " · réservé : " + o.r.type + " " + (o.r.titre || "") + (o.r.par ? " (" + o.r.par + ")" : ""); }
      cases += '<button type="button" class="' + c + '" data-n="' + n + '" title="' + esc(t) + '">' + pad(n).slice(-3) + "</button>";
    }
    var dedans = RES.filter(function (r) { return r.de <= p.a && p.de <= r.a; }).sort(function (a, b) { return a.de - b.de; });
    D.innerHTML = "<h2>" + esc(p.lib) + '</h2><div class="sous-t">' + esc(x.chemin) + " · n° " + pad(p.de) + " à " + pad(p.a) +
      (p.types.length ? " · réservée aux types " + esc(p.types.join(", ")) : " · tous types") + "</div>" +
      '<div class="compte"><span><b>' + s.libre + "</b>libres</span><span><b>" + s.r + "</b>réservés</span><span><b>" + s.e + "</b>émis</span></div>" +
      '<div class="outils-d"><button class="btn accent" id="d-res">Réserver dans cette plage</button>' +
      (esps.length > 1 ? '<select id="d-esp" title="Suite de numéros affichée">' + esps.map(function (e) { return '<option value="' + esc(e) + '"' + (e === ESPACE ? " selected" : "") + ">" + (e === "*" ? "Numérotation commune" : "N° propres " + esc(e) + " (" + esc(lib("types", e)) + ")") + "</option>"; }).join("") + "</select>" : "") +
      '<span class="legende"><span style="--c:var(--c-libre)">Libre</span><span style="--c:var(--c-res)">Réservé</span><span style="--c:var(--c-emis)">Émis</span><span style="--c:var(--c-hors)">Émis sans réservation</span></span></div>' +
      '<div class="grille">' + cases + "</div>" +
      (dedans.length ? '<table><thead><tr><th>N°</th><th>Code</th><th>Titre</th><th>État</th></tr></thead><tbody>' + dedans.map(ligneRes).join("") + "</tbody></table>" : '<p class="vide" style="padding:0">Aucune réservation dans cette plage.</p>');
  }
  $("#detail").addEventListener("click", function (e) {
    if (e.target.closest("#d-res")) { ouvreRes(null, { plage: SEL, type: ESPACE !== "*" ? ESPACE : "" }); return; }
    var c = e.target.closest(".case");
    if (c) {
      var n = +c.dataset.n, o = occupation(ESPACE)[n];
      if (o && o.r) ouvreRes(o.r); else if (!o) ouvreRes(null, { plage: SEL, de: n, type: ESPACE !== "*" ? ESPACE : "" });
      else toast("N° " + pad(n) + " déjà émis dans la liste des plans.");
      return;
    }
    var tr = e.target.closest("tr[data-id]"); if (tr) ouvreRes(RES.filter(function (r) { return r.id === tr.dataset.id; })[0]);
  });
  $("#detail").addEventListener("change", function (e) { if (e.target.id === "d-esp") { ESPACE = e.target.value; dessineDetail(); } });

  function ligneRes(r) {
    var st = statutDe(r), num = pad(r.de) + (r.a > r.de ? "–" + pad(r.a) : "");
    var emp = [lib("batiments", r.batiment) || r.batiment, lib("niveaux", r.niveau) || r.niveau, r.zone ? "zone " + r.zone : ""].filter(Boolean).join(" · ");
    return '<tr class="clic" data-id="' + esc(r.id) + '"><td class="mono">' + num + "</td><td class=\"mono\" style=\"font-size:12px\">" + esc(codeDoc(r, r.de)) + (r.a > r.de ? "<small>à " + pad(r.a) + "</small>" : "") +
      "</td><td>" + esc(r.titre || "—") + "<small>" + esc(lib("types", r.type) || r.type) + (r.remarque ? " · " + esc(r.remarque.slice(0, 80)) : "") + "</small></td>" +
      (VUE === "res" ? '<td class="masque-p">' + esc(emp) + '</td><td class="masque-p">' + esc(r.par) + "</td><td>" + dateFr(r.echeance) + "</td>" : "") +
      '<td><span class="statut ' + st.c + '">' + esc(st.t) + "</span></td></tr>";
  }

  // ---------- réservations
  function dessineRes() {
    var sel = $("#r-type").value;
    $("#r-type").innerHTML = '<option value="">Tous les types</option>' + CONF.types.map(function (t) { return '<option value="' + esc(t.c) + '">' + esc(t.c + " · " + t.lib) + "</option>"; }).join("");
    $("#r-type").value = sel;
    var mots = plie($("#r-cherche").value).split(/\s+/).filter(Boolean), ty = $("#r-type").value, st = $("#r-statut").value;
    var L = RES.filter(function (r) {
      if (ty && U(r.type) !== U(ty)) return false;
      var s = statutDe(r).c;
      if (st === "actif" ? s === "annule" : st && s !== st) return false;
      var hay = plie([pad(r.de), pad(r.a), codeDoc(r, r.de), r.titre, r.par, r.remarque, lib("types", r.type)].join(" "));
      return mots.every(function (m) { return hay.indexOf(m) >= 0; });
    }).sort(function (a, b) { return a.de - b.de || String(a.type).localeCompare(b.type); });
    VUE_RES = L;
    $("#r-corps").innerHTML = L.length ? L.map(ligneRes).join("") : '<tr><td colspan="7" class="vide">Aucune réservation' + (RES.length ? " pour ces filtres" : " : clique sur « Réserver » en haut à droite") + ".</td></tr>";
  }
  ["#r-cherche", "#r-type", "#r-statut"].forEach(function (s) { $(s).addEventListener("input", dessineRes); });
  $("#r-corps").addEventListener("click", function (e) { var tr = e.target.closest("tr[data-id]"); if (tr) ouvreRes(RES.filter(function (r) { return r.id === tr.dataset.id; })[0]); });

  // ------------------------------------------------------------------ fenêtre de réservation
  var FR = $("#fr"), EDITE = null;
  function options(liste, vide) {
    return (vide ? '<option value="">' + esc(vide) + "</option>" : "") + liste.map(function (x) { return '<option value="' + esc(x.c) + '">' + esc(x.c + (x.lib ? " · " + x.lib : "")) + "</option>"; }).join("");
  }
  function filtreBat(liste) { var b = FR.elements.batiment.value; return liste.filter(function (x) { return !x.bat || !b || U(x.bat).split(/[\s,;]+/).indexOf(U(b)) >= 0; }); }
  function remplitLieux() {
    var nv = FR.elements.niveau.value, z = FR.elements.zone.value;
    $("#fr-niv").innerHTML = options(filtreBat(CONF.niveaux), "—"); FR.elements.niveau.value = nv; if (FR.elements.niveau.value !== nv) FR.elements.niveau.value = "";
    $("#fr-zone").innerHTML = options(filtreBat(CONF.zones), "—"); FR.elements.zone.value = z; if (FR.elements.zone.value !== z) FR.elements.zone.value = "";
  }
  function typesDePlage() {
    var x = plageDe(FR.elements.plage.value), t = x && x.p.types.length ? x.p.types.map(U) : null;
    return CONF.types.filter(function (y) { return !t || t.indexOf(U(y.c)) >= 0; });
  }
  function remplitTypes() {
    var v = FR.elements.type.value, L = typesDePlage();
    $("#fr-type").innerHTML = options(L, L.length ? "" : "— aucun type : ajoute-les dans les référentiels —");
    if (L.some(function (y) { return U(y.c) === U(v); })) FR.elements.type.value = v;
  }
  function ouvreRes(r, pre) {
    if (!CUR) return;
    if (!CONF.types.length) { toast("Ajoute d'abord des types de document dans « Référentiels du chantier »."); VUE = "ref"; dessine(); return; }
    EDITE = r || null; pre = pre || {};
    FR.reset();
    $("#fr-titre").textContent = r ? "Réservation " + pad(r.de) + (r.a > r.de ? "–" + pad(r.a) : "") : "Réserver des numéros";
    $("#fr-ok").textContent = r ? "Enregistrer" : "Réserver";
    $("#fr-suppr").hidden = !r; $("#fr-revit").hidden = !r; $("#fr-suppr").textContent = "Supprimer"; delete $("#fr-suppr").dataset.arme;
    var L = aplat();
    $("#fr-plage").innerHTML = '<option value="">Hors plage (n° libres)</option>' + L.map(function (x) { return '<option value="' + x.cle + '">' + " ".repeat(x.d) + esc(x.p.lib) + " (" + pad(x.p.de) + "–" + pad(x.p.a) + ")</option>"; }).join("");
    $("#fr-disc").innerHTML = options(CONF.disciplines, "—"); $("#fr-phase").innerHTML = options(CONF.phases, "—");
    $("#fr-bat").innerHTML = options(CONF.batiments, "—");
    var E = FR.elements;
    if (r) {
      var px = plageDuBloc(r.de, r.a); E.plage.value = px ? px.cle : "";
      remplitTypes(); E.type.value = r.type;
      ["discipline", "phase", "batiment"].forEach(function (k) { E[k].value = r[k] || ""; });
      remplitLieux(); E.niveau.value = r.niveau || ""; E.zone.value = r.zone || "";
      E.de.value = r.de; E.a.value = r.a; E.nombre.value = r.a - r.de + 1;
      ["titre", "par", "remarque", "statut"].forEach(function (k) { E[k].value = r[k] || ""; }); E.echeance.value = r.echeance || "";
    } else {
      E.plage.value = pre.plage || "";
      remplitTypes(); if (pre.type) E.type.value = pre.type;
      if (CONF.disciplines.length === 1) E.discipline.value = CONF.disciplines[0].c;
      if (CONF.phases.length === 1) E.phase.value = CONF.phases[0].c;
      if (CONF.batiments.length === 1) E.batiment.value = CONF.batiments[0].c;
      remplitLieux(); E.par.value = moi(); E.statut.value = "reserve";
      if (pre.de != null) { E.de.value = pre.de; E.a.value = pre.de; E.nombre.value = 1; } else propose();
    }
    majCode(); $("#voile").hidden = false;
    setTimeout(function () { (r ? E.titre : E.type).focus(); }, 30);
  }
  // premier bloc libre de la taille voulue dans la plage choisie
  function propose() {
    var E = FR.elements, x = plageDe(E.plage.value), nb = Math.max(1, Math.min(1000, parseInt(E.nombre.value, 10) || 1));
    if (!x || !E.type.value) return;
    var d = premierBloc(+x.p.de, +x.p.a, nb, espace(E.type.value), EDITE);
    if (d == null) { E.de.value = ""; E.a.value = ""; avert("Pas de bloc de " + nb + " n° libres d'affilée dans cette plage."); return; }
    E.de.value = d; E.a.value = d + nb - 1;
  }
  function avert(m) { $("#fr-avert").textContent = m || ""; $("#fr-avert").hidden = !m; }
  function brouillon() {
    var E = FR.elements;
    return { type: U(E.type.value), discipline: E.discipline.value, phase: E.phase.value, batiment: E.batiment.value, niveau: E.niveau.value, zone: E.zone.value,
      de: parseInt(E.de.value, 10), a: parseInt(E.a.value, 10), titre: E.titre.value.trim(), par: E.par.value.trim(), echeance: E.echeance.value || null,
      statut: E.statut.value, remarque: E.remarque.value.trim() };
  }
  function controle(r) {
    if (!r.type) return "Choisis un type de document.";
    if (isNaN(r.de) || isNaN(r.a)) return "Indique les numéros.";
    if (r.a < r.de) return "Le n° de fin est avant le n° de début.";
    if (r.a - r.de >= 1000) return "1000 numéros au plus par réservation.";
    if (r.statut === "annule") return "";
    var occ = occupation(espace(r.type));
    for (var n = r.de; n <= r.a; n++) {
      var o = occ[n]; if (!o) continue;
      if (o.r && o.r !== EDITE) return "Le n° " + pad(n) + " est déjà réservé (" + o.r.type + " " + (o.r.titre || "") + ").";
    }
    return "";
  }
  function majCode() {
    var r = brouillon(), x = plageDe(FR.elements.plage.value), m = controle(r), occ = isNaN(r.de) ? {} : occupation(espace(r.type)), emis = 0;
    for (var n = r.de; n <= r.a; n++) if (occ[n] && occ[n].pl.length) emis++;
    $("#fr-code").textContent = isNaN(r.de) ? codeDoc(r, null) : codeDoc(r, r.de) + (r.a > r.de ? "  …  " + pad(r.a) + "  (" + (r.a - r.de + 1) + " n°)" : "");
    if (!m && x && !isNaN(r.de) && (r.de < x.p.de || r.a > x.p.a)) m = "Attention : le bloc déborde de la plage " + x.p.lib + ".";
    if (!m && emis) m = emis + " n° de ce bloc existent déjà dans la liste des plans.";
    avert(m);
  }
  FR.addEventListener("input", function (e) {
    var k = e.target.name;
    if (k === "plage") { remplitTypes(); propose(); }
    if (k === "type" || k === "nombre") propose();
    if (k === "de") { var nb = Math.max(1, parseInt(FR.elements.nombre.value, 10) || 1); if (FR.elements.de.value !== "") FR.elements.a.value = +FR.elements.de.value + nb - 1; }
    if (k === "a" && FR.elements.de.value !== "" && FR.elements.a.value !== "") FR.elements.nombre.value = Math.max(1, FR.elements.a.value - FR.elements.de.value + 1);
    if (k === "batiment") remplitLieux();
    majCode();
  });
  FR.addEventListener("submit", function (e) {
    e.preventDefault();
    var r = brouillon(), m = controle(r);
    if (m) { avert(m); return; }
    if (r.par) lsSet("org.nom", r.par);
    r.modifie_par = r.par;
    var b = $("#fr-ok"); b.disabled = true;
    var q = EDITE ? appel("doc_reservations?id=eq." + EDITE.id, { methode: "PATCH", prefer: "return=representation", corps: r })
      : (r.chantier = CUR.id, appel("doc_reservations", { methode: "POST", prefer: "return=representation", corps: r }));
    q.then(function (l) {
      var n = l && l[0]; if (!n) throw new Error("La base n'a rien renvoyé.");
      if (EDITE) RES = RES.map(function (x) { return x.id === n.id ? n : x; }); else RES.push(n);
      $("#voile").hidden = true; toast(EDITE ? "Réservation enregistrée." : "N° " + pad(n.de) + (n.a > n.de ? " à " + pad(n.a) : "") + " réservé(s)."); dessine();
    }).catch(function (err) { avert(err.message); rechargeDonnees(true); }).then(function () { b.disabled = false; });
  });
  $("#fr-suppr").addEventListener("click", function () {
    var b = this; if (!EDITE) return;
    if (!b.dataset.arme) { b.dataset.arme = "1"; b.textContent = "Confirmer la suppression"; return; }
    appel("doc_reservations?id=eq." + EDITE.id, { methode: "DELETE" }).then(function () {
      var id = EDITE.id; RES = RES.filter(function (x) { return x.id !== id; }); $("#voile").hidden = true; toast("Réservation supprimée."); dessine();
    }).catch(function (err) { avert(err.message); });
  });
  $("#fr-fermer").addEventListener("click", function () { $("#voile").hidden = true; });
  $("#b-reserver").addEventListener("click", function () { if (!CUR) { toast("Crée d'abord un chantier."); return; } ouvreRes(null, { plage: SEL }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("#voile").hidden = true; $("#voile-ch").hidden = true; } });

  // ------------------------------------------------------------------ référentiels
  var LISTES = [
    { k: "disciplines", t: "Disciplines", aide: "Code court qui entre dans le code du document (ex. STR).", cols: [["c", "Code", 110], ["lib", "Libellé"]] },
    { k: "phases", t: "Phases", aide: "Phases du projet (ex. SIA 112 : 51 projet d'exécution).", cols: [["c", "Code", 110], ["lib", "Libellé"]] },
    { k: "types", t: "Types de document", aide: "Plans, détails, notes de calcul, fiches, rapports… Coche « n° propres » pour un type qui a sa propre suite de numéros (ex. ARM et LIS, qui reprennent le n° de l'ouvrage) ; les autres partagent la numérotation commune.", cols: [["c", "Code", 110], ["lib", "Libellé"], ["propre", "N° propres", 90, "case"]] },
    { k: "batiments", t: "Bâtiments", aide: "Un ou plusieurs bâtiments du chantier.", cols: [["c", "Code", 110], ["lib", "Nom"]] },
    { k: "niveaux", t: "Niveaux", aide: "Du plus bas au plus haut. « Bâtiments » : codes séparés par une virgule si le niveau n'existe que dans certains bâtiments (vide = tous).", cols: [["c", "Code", 110], ["lib", "Libellé"], ["bat", "Bâtiments", 140]] },
    { k: "zones", t: "Zones", aide: "Zones ou secteurs. « Bâtiments » : vide = tous.", cols: [["c", "Code", 110], ["lib", "Libellé"], ["bat", "Bâtiments", 140]] }
  ];
  function dessineRef() {
    var h = '<div class="bloc"><h3>Chantier et code des documents</h3><p>Fais glisser les trigrammes sur l\'exemple pour changer leur ordre ; × en retire un, les boutons du dessous en ajoutent.</p>' +
      '<div class="segs" id="segs">' + chipsSeg() + "</div>" +
      '<div class="ajout-segs" id="ajout-segs">' + ajoutSeg() + "</div>" +
      '<div class="ligne-ch"><label>Code du chantier<input class="champ mono" data-g="code" value="' + esc(CUR._code != null ? CUR._code : CUR.code) + '" maxlength="20"></label>' +
      '<label>Nom<input class="champ" data-g="nom" value="' + esc(CUR._nom != null ? CUR._nom : CUR.nom) + '" maxlength="200"></label>' +
      '<label>Émetteur (fixe)<input class="champ mono" data-g="emetteur" value="' + esc(CONF.fixes.emetteur || "") + '" maxlength="10"></label>' +
      '<label>Chiffres du n°<input class="champ mono" data-g="chiffres" type="number" min="1" max="6" value="' + CONF.chiffres + '"></label>' +
      '<label>Séparateur<select class="champ" data-g="separateur">' + [["-", "tiret  -"], ["_", "souligné  _"], [".", "point  ."], [" ", "espace"], ["", "aucun"]].map(function (o) { return '<option value="' + esc(o[0]) + '"' + (CONF.separateur === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
      '<label>Liste de plans liée<select class="champ" data-g="liste_plans"><option value="">Aucune (état à la main)</option><option value="fgh_plans"' + (CONF.liste_plans === "fgh_plans" ? " selected" : "") + ">Liste des plans Fairmont (/fgh/pln/)</option></select></label></div>" +
      "</div></div>";
    h += '<div class="bloc"><h3>Plages de numéros</h3><p>Construis ton arbre : un lot par ligne (ex. NDC 1–99, Démolition, Reconstruction…), avec des sous-plages dans un lot. « Types » : codes séparés par une virgule pour réserver la plage à certains types (vide = tous).</p>' +
      '<table><thead><tr><th>Libellé</th><th style="width:96px">Du n°</th><th style="width:96px">Au n°</th><th style="width:150px">Types</th><th style="width:136px"></th></tr></thead><tbody id="ref-plages">' + lignesPlages() + "</tbody></table>" +
      '<button class="btn ajout" data-ajout-plage="">+ Ajouter un lot</button><div class="avert" id="ref-avert" style="color:var(--rouge);font-size:12.5px;margin-top:6px"></div></div>';
    LISTES.forEach(function (L) {
      h += '<div class="bloc"><h3>' + L.t + "</h3><p>" + esc(L.aide) + '</p><table><thead><tr>' + L.cols.map(function (c) { return '<th' + (c[2] ? ' style="width:' + c[2] + 'px"' : "") + ">" + c[1] + "</th>"; }).join("") + '<th style="width:100px"></th></tr></thead><tbody>' +
        CONF[L.k].map(function (e, i) {
          return "<tr>" + L.cols.map(function (c) {
            return c[3] === "case" ? '<td><input type="checkbox" data-l="' + L.k + '" data-i="' + i + '" data-c="' + c[0] + '"' + (e[c[0]] ? " checked" : "") + "></td>"
              : '<td><input class="champ' + (c[0] === "c" ? " mono" : "") + '" data-l="' + L.k + '" data-i="' + i + '" data-c="' + c[0] + '" value="' + esc(e[c[0]] || "") + '" maxlength="' + (c[0] === "c" ? 10 : 200) + '"></td>';
          }).join("") + '<td class="x"><button class="mini plus" data-mv="' + L.k + '|' + i + '|-1" title="Monter">↑</button><button class="mini plus" data-mv="' + L.k + '|' + i + '|1" title="Descendre">↓</button><button class="mini" data-sup="' + L.k + '|' + i + '" title="Retirer">×</button></td></tr>';
        }).join("") + '</tbody></table><button class="btn ajout" data-ajout="' + L.k + '">+ Ajouter</button></div>';
    });
    $("#ref").innerHTML = h; majEnreg(); verifiePlages();
  }
  function exempleVal() { return valeurs({ type: (CONF.types[0] || {}).c, discipline: (CONF.disciplines[0] || {}).c, phase: (CONF.phases[0] || {}).c, batiment: (CONF.batiments[0] || {}).c, niveau: (CONF.niveaux[0] || {}).c, zone: (CONF.zones[0] || {}).c }, CONF.plages[0] ? +CONF.plages[0].de : 1); }
  function chipsSeg() {
    var v = exempleVal();
    return CONF.segments.map(function (k, i) {
      return (i && CONF.separateur.trim() ? '<span class="sep-seg">' + esc(CONF.separateur) + "</span>" : "") +
        '<span class="seg" tabindex="0" data-seg="' + k + '" title="Glisser pour déplacer (ou flèches gauche et droite)"><b>' + esc(v[k] || "···") + "</b><small>" + SEGMENTS[k] + "</small>" +
        (k === "numero" ? "" : '<button type="button" class="seg-x" data-segx="' + k + '" title="Retirer ' + SEGMENTS[k] + ' du code">×</button>') + "</span>";
    }).join("");
  }
  function ajoutSeg() {
    var L = Object.keys(SEGMENTS).filter(function (k) { return CONF.segments.indexOf(k) < 0; });
    return L.length ? "Ajouter : " + L.map(function (k) { return '<button type="button" class="btn nu" data-segplus="' + k + '">+ ' + SEGMENTS[k] + "</button>"; }).join("") : "";
  }
  function majSegs() { var a = $("#segs"); if (a) { a.innerHTML = chipsSeg(); $("#ajout-segs").innerHTML = ajoutSeg(); } }
  function lignesPlages() {
    return aplat().map(function (x) {
      return '<tr><td><input class="champ" style="margin-left:' + x.d * 22 + 'px;width:calc(100% - ' + x.d * 22 + 'px)" data-p="' + x.cle + '" data-c="lib" value="' + esc(x.p.lib) + '" maxlength="200"></td>' +
        '<td><input class="champ mono" type="number" min="0" max="999999" data-p="' + x.cle + '" data-c="de" value="' + esc(x.p.de) + '"></td>' +
        '<td><input class="champ mono" type="number" min="0" max="999999" data-p="' + x.cle + '" data-c="a" value="' + esc(x.p.a) + '"></td>' +
        '<td><input class="champ mono" data-p="' + x.cle + '" data-c="types" value="' + esc(x.p.types.join(", ")) + '" placeholder="tous"></td>' +
        '<td class="x" style="white-space:nowrap"><button class="mini plus" data-ajout-plage="' + x.cle + '" title="Ajouter une sous-plage">+</button><button class="mini plus" data-pmv="' + x.cle + '|-1" title="Monter">↑</button><button class="mini plus" data-pmv="' + x.cle + '|1" title="Descendre">↓</button><button class="mini" data-psup="' + x.cle + '" title="Retirer (avec ses sous-plages)">×</button></td></tr>';
    }).join("") || '<tr><td colspan="5" style="color:var(--texte-faible);padding:8px 4px">Aucune plage pour l\'instant.</td></tr>';
  }
  function parent(cle) { var p = cle.split("."), i = +p.pop(); return { liste: p.length ? plageDe(p.join(".")).p.sous : CONF.plages, i: i }; }
  function verifiePlages() {
    var m = [];
    (function v(L, pere) {
      var t = L.slice().sort(function (a, b) { return a.de - b.de; });
      t.forEach(function (p, i) {
        if (!(p.lib || "").trim()) m.push("Une plage n'a pas de libellé.");
        if (isNaN(+p.de) || isNaN(+p.a) || p.de === "" || p.a === "" || +p.a < +p.de) m.push((p.lib || "Une plage") + " : bornes à corriger.");
        if (pere && (+p.de < +pere.de || +p.a > +pere.a)) m.push(p.lib + " déborde de " + pere.lib + ".");
        if (i && +p.de <= +t[i - 1].a) m.push(p.lib + " chevauche " + t[i - 1].lib + ".");
        v(p.sous, p);
      });
    })(CONF.plages, null);
    var a = $("#ref-avert"); if (a) a.textContent = m.filter(function (x, i) { return m.indexOf(x) === i; }).join(" ");
    return !m.length;
  }
  function marque() { SALE = true; majEnreg(); }
  function majEnreg() {
    $("#b-enreg").disabled = !SALE; $("#b-annuler-ref").disabled = !SALE;
    $("#enreg").classList.toggle("sale", SALE); $("#enreg-msg").textContent = SALE ? "Changements non enregistrés." : "Aucun changement.";
  }
  $("#ref").addEventListener("input", function (e) {
    var t = e.target, d = t.dataset, v = t.type === "checkbox" ? t.checked : t.value;
    if (d.g) {
      if (d.g === "code") CUR._code = v; else if (d.g === "nom") CUR._nom = v;
      else if (d.g === "emetteur") CONF.fixes.emetteur = v.trim();
      else if (d.g === "chiffres") CONF.chiffres = Math.max(1, Math.min(6, parseInt(v, 10) || 4));
      else CONF[d.g] = v;
    } else if (d.l) {
      CONF[d.l][+d.i][d.c] = d.c === "c" ? U(v) : v;
    } else if (d.p) {
      var x = plageDe(d.p).p;
      if (d.c === "types") x.types = v.split(/[\s,;]+/).map(U).filter(Boolean);
      else if (d.c === "lib") x.lib = v; else x[d.c] = v === "" ? "" : parseInt(v, 10);
      verifiePlages();
    } else return;
    marque(); if (!t.closest("#segs")) majSegs();
  });
  $("#ref").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return; var d = b.dataset, s;
    if (d.segx) { CONF.segments = CONF.segments.filter(function (k) { return k !== d.segx; }); marque(); majSegs(); return; }
    if (d.segplus) { CONF.segments.splice(Math.max(0, CONF.segments.indexOf("numero")), 0, d.segplus); marque(); majSegs(); return; }
    if (d.ajout) CONF[d.ajout].push({ c: "", lib: "" });
    else if (d.sup) { s = d.sup.split("|"); CONF[s[0]].splice(+s[1], 1); }
    else if (d.mv) { s = d.mv.split("|"); var L = CONF[s[0]], i = +s[1], j = i + +s[2]; if (j < 0 || j >= L.length) return; L.splice(j, 0, L.splice(i, 1)[0]); }
    else if (d.ajoutPlage !== undefined) {
      if (d.ajoutPlage === "") { var der = CONF.plages[CONF.plages.length - 1], de = der ? +der.a + 1 : 1; CONF.plages.push({ lib: "", de: de, a: de + 99, types: [], sous: [] }); }
      else { var p = plageDe(d.ajoutPlage).p, ds = p.sous.length ? +p.sous[p.sous.length - 1].a + 1 : +p.de; p.sous.push({ lib: "", de: ds, a: Math.min(+p.a, ds + 99), types: [], sous: [] }); }
    }
    else if (d.psup) { var q = parent(d.psup); q.liste.splice(q.i, 1); SEL = ""; }
    else if (d.pmv) { s = d.pmv.split("|"); var r = parent(s[0]), k = r.i + +s[1]; if (k < 0 || k >= r.liste.length) return; r.liste.splice(k, 0, r.liste.splice(r.i, 1)[0]); SEL = ""; }
    else return;
    marque(); dessineRef();
  });
  // glisser-déposer des trigrammes (souris et doigt) : la pastille suit le pointeur, les autres s'écartent
  var GLISSE = null;
  $("#ref").addEventListener("pointerdown", function (e) {
    var c = e.target.closest(".seg"); if (!c || e.target.closest(".seg-x") || e.button > 0) return;
    e.preventDefault(); c.setPointerCapture(e.pointerId); c.focus();
    GLISSE = { k: c.dataset.seg, x0: e.clientX, bouge: false }; c.classList.add("tenue");
  });
  $("#ref").addEventListener("pointermove", function (e) {
    if (!GLISSE) return;
    if (!GLISSE.bouge && Math.abs(e.clientX - GLISSE.x0) < 4) return;
    GLISSE.bouge = true;
    var chips = [].slice.call(document.querySelectorAll("#segs .seg")), i = CONF.segments.indexOf(GLISSE.k), j = i;
    chips.forEach(function (ch, n) { var r = ch.getBoundingClientRect(); if (e.clientY >= r.top - 20 && e.clientY <= r.bottom + 20 && e.clientX > r.left && e.clientX < r.right) j = n; });
    if (j === i) return;
    CONF.segments.splice(j, 0, CONF.segments.splice(i, 1)[0]); marque(); majSegs();
    var n = document.querySelector('#segs .seg[data-seg="' + GLISSE.k + '"]'); n.classList.add("tenue"); n.setPointerCapture(e.pointerId);
  });
  function lache() { if (!GLISSE) return; var n = document.querySelector('#segs .seg[data-seg="' + GLISSE.k + '"]'); if (n) n.classList.remove("tenue"); GLISSE = null; }
  $("#ref").addEventListener("pointerup", lache); $("#ref").addEventListener("pointercancel", lache);
  $("#ref").addEventListener("keydown", function (e) {
    var c = e.target.closest && e.target.closest(".seg"); if (!c || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault(); var k = c.dataset.seg, i = CONF.segments.indexOf(k), j = i + (e.key === "ArrowLeft" ? -1 : 1);
    if (j < 0 || j >= CONF.segments.length) return;
    CONF.segments.splice(j, 0, CONF.segments.splice(i, 1)[0]); marque(); majSegs();
    document.querySelector('#segs .seg[data-seg="' + k + '"]').focus();
  });
  $("#b-annuler-ref").addEventListener("click", function () { CONF = normalise(copie(CUR.config)); delete CUR._code; delete CUR._nom; SALE = false; dessineRef(); });
  $("#b-enreg").addEventListener("click", function () {
    if (!verifiePlages()) { toast("Corrige d'abord les plages signalées en rouge.", 4000); return; }
    ["disciplines", "phases", "types", "batiments", "niveaux", "zones"].forEach(function (k) { CONF[k] = CONF[k].filter(function (x) { return x.c; }); });
    var corps = { config: CONF, modifie_par: moi() };
    if (CUR._code != null && U(CUR._code)) corps.code = U(CUR._code);
    if (CUR._nom != null) corps.nom = CUR._nom.trim();
    this.disabled = true;
    appel("doc_chantiers?id=eq." + CUR.id, { methode: "PATCH", prefer: "return=representation", corps: corps }).then(function (l) {
      var c = l && l[0]; if (!c) throw new Error("La base n'a rien renvoyé.");
      CH = CH.map(function (x) { return x.id === c.id ? c : x; }); CUR = c; CONF = normalise(copie(c.config)); SALE = false;
      remplitChantiers(c); toast("Référentiels enregistrés."); dessineRef(); rechargeDonnees(true);
    }).catch(function (err) { toast(err.message, 5000); majEnreg(); });
  });
  window.addEventListener("beforeunload", function (e) { if (SALE) { e.preventDefault(); e.returnValue = ""; } });

  // ------------------------------------------------------------------ JSON
  $("#b-json").addEventListener("click", function () {
    if (!CUR) { toast("Aucun chantier à exporter."); return; }
    var d = new Date(), j = { format: "str-bim-tools/organiseur", version: 1, exporte_le: d.toISOString(),
      chantier: { code: CUR.code, nom: CUR.nom, config: CONF },
      reservations: RES.map(function (r) { var o = copie(r); delete o.chantier; return o; }) };
    lsSet("org.exporte", new Date().toISOString()); setTimeout(function () { rechargeDonnees(true); }, 50);
    telecharge("organiseur-" + CUR.code + "-" + d.getFullYear() + deux(d.getMonth() + 1) + deux(d.getDate()) + ".json", j);
  });
  // Feuilles Revit : une entrée par n° réservé, prête pour un script de création de feuilles
  function feuillesRevit(liste) {
    var F = [];
    liste.forEach(function (r) {
      for (var n = r.de; n <= r.a; n++) {
        var v = valeurs(r, n);
        F.push({ numero_feuille: codeDoc(r, n), nom_feuille: r.titre || lib("types", r.type) || r.type, indice: "00",
          trigrammes: CONF.segments.map(function (k) { return { cle: k, libelle: SEGMENTS[k], valeur: v[k] }; }),
          parametres: { projet: v.projet, discipline: v.discipline, emetteur: v.emetteur, phase: v.phase, type: v.type, batiment: v.batiment, niveau: v.niveau, zone: v.zone, numero: v.numero },
          libelles: { discipline: lib("disciplines", r.discipline), phase: lib("phases", r.phase), type: lib("types", r.type), batiment: lib("batiments", r.batiment), niveau: lib("niveaux", r.niveau), zone: lib("zones", r.zone) },
          plage: (plageDuBloc(r.de, r.a) || { chemin: "" }).chemin, reserve_par: r.par, echeance: r.echeance, statut: statutDe(r).c, reservation: r.id });
      }
    });
    return F;
  }
  function telecharge(nom, objet) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(objet, null, 2)], { type: "application/json" }));
    a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function exportRevit(liste, suffixe) {
    var F = feuillesRevit(liste.filter(function (r) { return r.statut !== "annule"; }));
    if (!F.length) { toast("Aucune feuille à exporter."); return; }
    var d = new Date();
    telecharge("feuilles-revit-" + CUR.code + "-" + suffixe + ".json", { format: "str-bim-tools/feuilles-revit", version: 1, exporte_le: d.toISOString(),
      chantier: { code: CUR.code, nom: CUR.nom }, separateur: CONF.separateur, ordre: CONF.segments, feuilles: F });
    toast(F.length + " feuille(s) exportée(s).");
  }
  $("#fr-revit").addEventListener("click", function () { if (EDITE) exportRevit([EDITE], pad(EDITE.de) + (EDITE.a > EDITE.de ? "-" + pad(EDITE.a) : "")); });
  $("#r-revit").addEventListener("click", function () { exportRevit(VUE_RES, "selection"); });
  $("#b-import").addEventListener("click", function () { $("#f-import").value = ""; $("#f-import").click(); });
  $("#f-import").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (t) {
      var j = JSON.parse(t);
      if (!j || !j.chantier || !j.chantier.code) throw new Error("Ce fichier n'est pas un export de l'organiseur.");
      var code = U(j.chantier.code), ex = CH.filter(function (x) { return U(x.code) === code; })[0];
      if (ex && !window.confirm("Le chantier " + code + " existe : remplacer ses référentiels et plages par ceux du fichier, et ajouter ou mettre à jour ses réservations ?")) return;
      var conf = normalise(j.chantier.config);
      var q = ex ? appel("doc_chantiers?id=eq." + ex.id, { methode: "PATCH", prefer: "return=representation", corps: { config: conf, nom: j.chantier.nom || ex.nom, modifie_par: moi() } })
        : appel("doc_chantiers", { methode: "POST", prefer: "return=representation", corps: { code: code, nom: j.chantier.nom || "", config: conf, modifie_par: moi() } });
      return q.then(function (l) {
        var c = l[0], champs = ["id", "de", "a", "type", "discipline", "phase", "batiment", "niveau", "zone", "titre", "par", "echeance", "statut", "remarque"];
        var R = (j.reservations || []).map(function (r) { var o = { chantier: c.id, modifie_par: moi() }; champs.forEach(function (k) { if (r[k] !== undefined) o[k] = r[k]; }); if (!ex) delete o.id; return o; });
        // une à une : une réservation qui en chevauche une autre est signalée, les autres passent
        var ko = 0;
        return R.reduce(function (p, r) {
          return p.then(function () {
            return appel("doc_reservations" + (r.id ? "?on_conflict=id" : ""), { methode: "POST", prefer: "resolution=merge-duplicates,return=minimal", corps: r }).catch(function () { ko++; });
          });
        }, Promise.resolve()).then(function () {
          toast("Import terminé" + (R.length ? " : " + (R.length - ko) + " réservation(s)" + (ko ? ", " + ko + " refusée(s) (chevauchement)" : "") : "") + ".", 5000);
          lsSet("org.chantier", c.id); return charge();
        });
      });
    }).catch(function (e) { toast(e.message || "Fichier illisible.", 5000); });
  });

  // ------------------------------------------------------------------ thème et démarrage
  $("#b-theme").addEventListener("click", function () {
    var c = document.documentElement.getAttribute("data-theme") === "clair" ? "sombre" : "clair";
    document.documentElement.setAttribute("data-theme", c); lsSet("org.theme", c);
    document.querySelector("meta[name=theme-color]").setAttribute("content", c === "clair" ? "#F3F3F3" : "#202020");
  });
  // les réservations des autres arrivent toutes les minutes quand la page est visible
  setInterval(function () { if (document.visibilityState === "visible" && CUR && $("#voile").hidden) rechargeDonnees(true); }, 60000);
  charge();
})();
