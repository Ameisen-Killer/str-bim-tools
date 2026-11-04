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
    fichierPlanifie();
  }

  // ------------------------------------------------------------------ fichier JSON lié
  // Chrome et Edge sur ordinateur : l'outil garde la main sur un fichier .json choisi par
  // l'utilisateur et le réécrit à chaque changement : toute la configuration de tous les chantiers
  // (référentiels, trigrammes, plages, bâtiments et niveaux) et leurs réservations.
  // Le lien est retenu (IndexedDB) ; après un rechargement, le navigateur redemande l'accord d'un clic.
  var FI = { h: null, droit: "", quand: "", err: "" }, FI_OK = typeof window.showSaveFilePicker === "function";
  function idb(mode, f) {
    return new Promise(function (ok, ko) {
      var r = indexedDB.open("organiseur", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onerror = function () { ko(r.error); };
      r.onsuccess = function () { var t = r.result.transaction("kv", mode), q = f(t.objectStore("kv")); t.oncomplete = function () { ok(q && q.result); }; t.onerror = function () { ko(t.error); }; };
    });
  }
  // un fichier = un chantier : sa configuration complète et ses réservations
  function documentJson() {
    var d = litLocal(), c = d.chantiers[0] || null;
    return { format: "str-bim-tools/organiseur", version: 2, enregistre_le: new Date().toISOString(),
      chantier: c ? { id: c.id, code: c.code, nom: c.nom, config: c.config, cree_le: c.cree_le, modifie_le: c.modifie_le } : null,
      reservations: d.reservations.map(function (r) { var o = copie(r); delete o.chantier; return o; }) };
  }
  function contenuFichier() { return JSON.stringify(documentJson(), null, 2); }
  // lit un fichier de l'organiseur (un chantier ; un ancien fichier à plusieurs chantiers donne le premier)
  function versDocument(j) {
    var c, res;
    if (j && j.chantier && j.chantier.code) {
      c = { id: j.chantier.id || nouvelId(), code: U(j.chantier.code), nom: j.chantier.nom || "", config: j.chantier.config || {}, cree_le: j.chantier.cree_le || new Date().toISOString(), modifie_le: j.chantier.modifie_le || new Date().toISOString() };
      res = j.reservations || [];
    } else if (j && Array.isArray(j.chantiers) && j.chantiers.length) {
      c = j.chantiers[0]; res = (j.reservations || []).filter(function (r) { return r.chantier === c.id; });
    } else throw new Error("Ce fichier n'est pas un fichier de l'organiseur.");
    return { chantiers: [c], reservations: res.map(function (r) { return Object.assign({}, r, { chantier: c.id, id: r.id || nouvelId() }); }) };
  }
  function ecritFichier() {
    if (!FI.h || FI.droit !== "granted") return Promise.resolve();
    return FI.h.createWritable().then(function (w) { return w.write(contenuFichier()).then(function () { return w.close(); }); }).then(function () {
      FI.quand = new Date(); FI.err = ""; lsSet("org.exporte", new Date().toISOString()); majFichier();
    }).catch(function (e) { FI.err = e.message || "écriture refusée"; majFichier(); });
  }
  function fichierPlanifie() { if (!FI.h) return; clearTimeout(fichierPlanifie.t); fichierPlanifie.t = setTimeout(ecritFichier, 400); }
  function majFichier() {
    var b = $("#b-fichier"), n = $("#fichier-nom");
    b.classList.toggle("lie", !!FI.h && FI.droit === "granted" && !FI.err);
    b.classList.toggle("attente", !!FI.h && FI.droit !== "granted");
    n.textContent = !FI.h ? "Aucun fichier lié" : FI.err ? FI.h.name + " · erreur" : FI.droit !== "granted" ? FI.h.name + " · cliquer pour reprendre" : FI.h.name + (FI.quand ? " · enregistré " + deux(FI.quand.getHours()) + ":" + deux(FI.quand.getMinutes()) : " · lié");
    b.title = !FI.h ? "Aucun fichier lié : les données ne sont que dans ce navigateur" : "Lié à " + FI.h.name + (FI.err ? " (" + FI.err + ")" : "");
  }
  function lie(h, lire) {
    // si Chrome ne donne pas tout de suite le droit d'écrire, le fichier est quand même lu ;
    // le bouton du fichier propose alors « cliquer pour reprendre »
    return h.requestPermission({ mode: "readwrite" }).catch(function () { return "prompt"; }).then(function (p) {
      if (p !== "granted" && !lire) throw new Error("Accès au fichier refusé.");
      FI.h = h; FI.droit = p; FI.err = "";
      idb("readwrite", function (s) { return s.put(h, "fichier"); }).catch(function () {});
      if (!lire) return ecritFichier();
      return h.getFile().then(function (f) { return f.text(); }).then(function (t) {
        if (!t.trim()) return ecritFichier();
        var doc = versDocument(JSON.parse(t));
        ecritLocal(doc); toast("Chantier " + doc.chantiers[0].code + " ouvert depuis " + h.name + "."); return charge();
      });
    }).then(majFichier).catch(function (e) { if (lire) delie(); FI.err = ""; majFichier(); toast(e.message, 5000); });
  }
  function delie() { FI = { h: null, droit: "", quand: "", err: "" }; idb("readwrite", function (s) { return s.delete("fichier"); }).catch(function () {}); majFichier(); }
  function sansFichierConfirme() { return !CUR || FI.h || window.confirm("Le chantier " + CUR.code + " n'est enregistré dans aucun fichier : il sera remplacé. Continuer ?"); }
  // ouvrir un autre chantier : avec lien au fichier si le navigateur le permet, sinon simple lecture
  function ouvrirFichier() {
    if (!sansFichierConfirme()) return;
    if (FI_OK) { window.showOpenFilePicker({ types: TYPES_FI, multiple: false }).then(function (l) { delie(); return lie(l[0], true); }).catch(function () {}); return; }
    $("#f-import").value = ""; $("#f-import").click();
  }
  var TYPES_FI = [{ description: "Organiseur (JSON)", accept: { "application/json": [".json"] } }];
  function fenFichier() {
    var c = $("#fi-corps"), p = $("#fi-pied");
    if (!LOCAL) { c.innerHTML = '<p class="texte">L\'outil travaille sur la base partagée (adresse avec ?base=1) : pas de fichier à lier. Ajoute ?base=0 à l\'adresse pour revenir au fichier.</p>'; p.innerHTML = '<span class="esp"></span><button class="btn" data-fi="x">Fermer</button>'; }
    else if (!FI_OK) { c.innerHTML = '<p class="texte">Ce navigateur ne sait pas garder un fichier ouvert (il faut Chrome ou Edge sur ordinateur). Tes données restent dans ce navigateur : sauve-les avec <b>JSON</b> et rouvre-les avec <b>Importer</b>.</p>'; p.innerHTML = '<span class="esp"></span><button class="btn" data-fi="x">Fermer</button>'; }
    else {
      c.innerHTML = '<p class="texte">' + (FI.h ? "Le chantier " + esc(CUR ? CUR.code : "") + " est lié à <b>" + esc(FI.h.name) + "</b>" + (FI.droit === "granted" ? " : chaque changement y est enregistré tout de suite." : " : le navigateur demande ton accord pour y écrire à nouveau.") :
        CUR ? "Le chantier " + esc(CUR.code) + " n'est enregistré dans aucun fichier : il n'est que dans ce navigateur." : "Aucun chantier ouvert.") + "</p>" +
        '<p class="texte">Un fichier = un chantier, avec toute sa configuration (référentiels, trigrammes, plages, bâtiments et niveaux) et ses réservations. Mets tes fichiers dans un dossier synchronisé (OneDrive…) pour les retrouver sur un autre poste.</p>';
      p.innerHTML = (FI.h ? '<button class="btn danger" data-fi="delie">Délier</button>' : "") + '<span class="esp"></span>' +
        (FI.h && FI.droit !== "granted" ? '<button class="btn accent" data-fi="reprendre">Reprendre ' + esc(FI.h.name) + "</button>" : "") +
        '<button class="btn" data-fi="nveau">Nouveau chantier…</button><button class="btn" data-fi="ouvrir">Ouvrir…</button>' +
        (CUR ? '<button class="btn' + (FI.h ? "" : " accent") + '" data-fi="sous">Enregistrer sous…</button>' : "");
    }
    $("#voile-fi").hidden = false;
  }
  $("#b-fichier").addEventListener("click", function () {
    if (FI.h && FI.droit !== "granted") { lie(FI.h, false); return; }
    fenFichier();
  });
  $("#voile-fi").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
  $("#fi-pied").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-fi]"); if (!b) return; var a = b.dataset.fi;
    $("#voile-fi").hidden = true;
    if (a === "sous") window.showSaveFilePicker({ suggestedName: (CUR ? CUR.code : "chantier") + ".json", types: TYPES_FI }).then(function (h) { return lie(h, false); }).catch(function () {});
    else if (a === "ouvrir") ouvrirFichier();
    else if (a === "nveau") ouvreNouveau();
    else if (a === "reprendre") lie(FI.h, false);
    else if (a === "delie") { delie(); toast("Fichier délié : le chantier reste dans ce navigateur."); rechargeDonnees(true); }
  });
  if (LOCAL && FI_OK) idb("readonly", function (s) { return s.get("fichier"); }).then(function (h) {
    if (!h) return; FI.h = h;
    return h.queryPermission({ mode: "readwrite" }).then(function (p) { FI.droit = p; if (p === "granted") ecritFichier(); });
  }).catch(function () {}).then(majFichier);
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
      disciplines: [], phases: [], types: [], batiments: [], zones: [], plages: [] };
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
    c.batiments = [{ c: "FGH", lib: "Hôtel Fairmont Genève", niveaux: [] }];
    var N = { "000": "Tous niveaux", "050": "SS-4", "060": "SS-3", "070": "SS-2", "080": "SS-1", "090": "Rez inf", "100": "Rez",
      "110": "Étage 1", "120": "Étage 2", "130": "Étage 3", "140": "Étage 4", "150": "Étage 5", "160": "Étage 6", "170": "Étage 7", "180": "Étage 8", "190": "Toiture" };
    c.batiments[0].niveaux = Object.keys(N).map(function (k) { return { c: k, lib: N[k], fictif: k === "000" }; });
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
    // niveaux par bâtiment (04.11.2026) : l'ancienne liste commune est répartie dans chaque bâtiment
    if (Array.isArray(c.niveaux) && c.niveaux.length) {
      if (!c.batiments.length) c.batiments = [{ c: "B1", lib: "Bâtiment" }];
      c.batiments.forEach(function (b) {
        if (Array.isArray(b.niveaux) && b.niveaux.length) return;
        b.niveaux = c.niveaux.filter(function (n) { var bl = U(n.bat).split(/[\s,;]+/).filter(Boolean); return !bl.length || bl.indexOf(U(b.c)) >= 0; })
          .map(function (n) { var o = copie(n); delete o.bat; return o; });
      });
    }
    delete c.niveaux;
    c.batiments.forEach(function (b) { if (!Array.isArray(b.niveaux)) b.niveaux = []; });
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
  // niveaux d'un bâtiment, ou de tous les bâtiments (sans doublon de code) si aucun n'est choisi
  function niveauxDe(bat) {
    var bs = CONF.batiments.filter(function (b) { return !bat || U(b.c) === U(bat); }), vu = {}, L = [];
    bs.forEach(function (b) { b.niveaux.forEach(function (n) { if (n.c && !vu[U(n.c)]) { vu[U(n.c)] = 1; L.push(n); } }); });
    return L;
  }
  function libNiv(bat, c) { var x = niveauxDe(bat).concat(niveauxDe("")).filter(function (n) { return U(n.c) === U(c); })[0]; return x ? x.lib : ""; }
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
      // mode fichier : un seul chantier ouvert ; les autres d'avant le 04.11.2026 sont mis de côté (org.anciens)
      if (LOCAL && CH.length > 1) {
        var d = litLocal(); lsSet("org.anciens", JSON.stringify(d));
        try { localStorage.setItem("org.donnees", JSON.stringify({ chantiers: [c], reservations: d.reservations.filter(function (r) { return r.chantier === c.id; }) })); } catch (e) {}
        CH = [c]; toast("Un chantier par fichier : " + c.code + " reste ouvert, les autres sont mis de côté.", 5000);
      }
      remplitChantiers(c);
      if (!c) { CUR = null; ecranVide(); etat("Aucun chantier", "ok"); return; }
      return ouvre(c);
    }).catch(function (e) {
      etat("Base indisponible", "ko"); CUR = null;
      ecranVide(e.manque ? "La base n'est pas encore prête" : "Base indisponible", e.message, e.manque);
    });
  }
  function remplitChantiers(c) {
    $("#chantier").hidden = LOCAL; $("#ch-nom").hidden = !LOCAL; $("#lib-import").textContent = LOCAL ? "Ouvrir" : "Importer";
    $("#b-import").title = LOCAL ? "Ouvrir le fichier JSON d'un chantier" : "Importer un chantier depuis un JSON"; $("#b-json").title = LOCAL ? "Télécharger une copie du fichier du chantier" : "Exporter le chantier en JSON";
    $("#ch-nom").textContent = c ? c.code + (c.nom ? " · " + c.nom : "") : "";
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
      etat(RES.length + " réservation(s)" + (CONF.liste_plans ? " · " + PLANS.length + " plans" : "") + (LOCAL ? (FI.h ? "" : " · dans ce navigateur seulement" + (aExporter() ? ", pense à lier un fichier" : "")) : " · base partagée"), LOCAL && !FI.h && aExporter() ? "" : "ok");
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
      esc(texte || (LOCAL ? "Ouvre le fichier JSON d'un chantier, ou crée un chantier : vide, pour bâtir toi-même tes référentiels et tes plages, ou prérempli avec la numérotation du Fairmont. Un chantier = un fichier." : "Crée un premier chantier : vide, ou prérempli avec la numérotation du Fairmont.")) + "</p>" +
      (manque ? '<p>Une fois la migration passée, recharge la page (Ctrl+F5).</p>' :
        '<div class="actions">' + (LOCAL ? '<button class="btn accent" data-m="ouvrir">Ouvrir un fichier…</button>' : "") + '<button class="btn' + (LOCAL ? "" : " accent") + '" data-m="fgh">Chantier Fairmont prérempli</button><button class="btn" data-m="vide">Chantier vide</button></div>');
  }
  $("#vide").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-m]"); if (!b) return;
    if (b.dataset.m === "ouvrir") ouvrirFichier(); else ouvreNouveau(b.dataset.m === "fgh");
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
  function ouvreNouveau(fgh) {
    var F = $("#fc"); F.reset();
    $("#fc-modele").innerHTML = '<option value="vide">Rien (référentiels et plages à créer)</option><option value="fgh">Numérotation du Fairmont (préremplie)</option>' +
      CH.map(function (x) { return '<option value="' + esc(x.id) + '">Copie des référentiels et plages de ' + esc(x.code) + "</option>"; }).join("");
    if (fgh) { F.elements.code.value = "FGH"; F.elements.nom.value = "Hôtel Fairmont Genève"; F.elements.modele.value = "fgh"; }
    $("#voile-ch").hidden = false; setTimeout(function () { F.elements.code.focus(); }, 30);
  }
  $("#fc").addEventListener("submit", function (e) {
    e.preventDefault(); var F = this, code = U(F.elements.code.value), nom = F.elements.nom.value.trim(), mod = F.elements.modele.value;
    if (!LOCAL) {
      if (CH.some(function (x) { return U(x.code) === code; })) { toast("Ce code de chantier existe déjà."); return; }
      $("#voile-ch").hidden = true; creeChantier(code, nom, mod); return;
    }
    // mode fichier : le nouveau chantier remplace celui qui est ouvert et part dans son propre fichier
    if (!sansFichierConfirme()) return;
    $("#voile-ch").hidden = true;
    var choix = FI_OK ? window.showSaveFilePicker({ suggestedName: code + ".json", types: TYPES_FI }) : Promise.resolve(null);
    choix.then(function (h) {
      delie();
      var garde = CH.slice();
      try { localStorage.setItem("org.donnees", JSON.stringify({ chantiers: [], reservations: [] })); } catch (er) {}
      CH = garde;   // pour « copie des référentiels de… »
      return creeChantier(code, nom, mod).then(function () {
        CH = CH.filter(function (x) { return x.id === (CUR && CUR.id); });
        if (h) return lie(h, false);
        toast("Chantier créé : sauve-le avec le bouton JSON.", 5000);
      });
    }).catch(function () { toast("Création annulée."); });
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
    var emp = [lib("batiments", r.batiment) || r.batiment, libNiv(r.batiment, r.niveau) || r.niveau, r.zone ? "zone " + r.zone : ""].filter(Boolean).join(" · ");
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
    $("#fr-niv").innerHTML = options(niveauxDe(FR.elements.batiment.value), "—"); FR.elements.niveau.value = nv; if (FR.elements.niveau.value !== nv) FR.elements.niveau.value = "";
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
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { $("#voile").hidden = true; $("#voile-ch").hidden = true; $("#voile-fi").hidden = true; } });

  // ------------------------------------------------------------------ référentiels
  // ------------------------------------------------------------------ maquette filaire
  // Chaque bâtiment : emprise rectangulaire, une dalle par niveau, arêtes verticales jusqu'au toit.
  // Vue axonométrique qu'on tourne au pointeur ; le niveau ou le bâtiment en cours de saisie est en couleur.
  var MQ = { th: -0.6, ph: 0.55, foc: null };
  function nombre(v) { v = String(v).trim().replace(",", "."); if (v === "") return ""; var n = parseFloat(v); return isNaN(n) ? "" : n; }
  function nb(v, def) { return typeof v === "number" && !isNaN(v) ? v : def; }
  function modeleBat() {
    var bats = CONF.batiments.length ? CONF.batiments : [{ c: "", lib: "" }], x0 = 0;
    return bats.map(function (b, i) {
      var L = Math.max(1, nb(b.lg, 20)), W = Math.max(1, nb(b.la, 15)), X = nb(b.x, x0), Y = nb(b.y, 0); x0 = X + L + 8;
      var z = null, hp = 0, niv = [];
      (b.niveaux || []).forEach(function (n, k) {
        if (n.fictif) return;
        var h = Math.max(0.2, nb(n.h, 3)), zz = typeof n.alt === "number" ? n.alt : z == null ? 0 : z + hp;
        niv.push({ k: k, n: n, z: zz, h: h }); z = zz; hp = h;
      });
      return { i: i, b: b, X: X, Y: Y, L: L, W: W, niv: niv, haut: niv.length ? niv[niv.length - 1].z + niv[niv.length - 1].h : 0, bas: niv.length ? Math.min.apply(null, niv.map(function (x) { return x.z; })) : 0 };
    });
  }
  function dessineMaquette() {
    var svg = $("#mq"); if (!svg) return;
    var M = modeleBat(), ct = Math.cos(MQ.th), st = Math.sin(MQ.th), sp = Math.sin(MQ.ph), cp = Math.cos(MQ.ph);
    function P(x, y, z) { return [x * ct - y * st, (x * st + y * ct) * sp - z * cp]; }
    var pts = [];
    M.forEach(function (m) { [m.bas, m.haut].forEach(function (z) { [[0, 0], [m.L, 0], [m.L, m.W], [0, m.W]].forEach(function (c) { pts.push(P(m.X + c[0], m.Y + c[1], z)); }); }); });
    if (!pts.length) { svg.innerHTML = ""; return; }
    var W = svg.clientWidth || 420, H = svg.clientHeight || 380, xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x1 = Math.min.apply(null, xs), x2 = Math.max.apply(null, xs), y1 = Math.min.apply(null, ys), y2 = Math.max.apply(null, ys);
    var e = Math.min((W - 130) / Math.max(1, x2 - x1), (H - 40) / Math.max(1, y2 - y1)), ox = 14 - x1 * e, oy = 26 - y1 * e;
    function S(x, y, z) { var p = P(x, y, z); return [ox + p[0] * e, oy + p[1] * e]; }
    function poly(m, z) { return [[0, 0], [m.L, 0], [m.L, m.W], [0, m.W]].map(function (c) { var q = S(m.X + c[0], m.Y + c[1], z); return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" "); }
    var h = "";
    M.forEach(function (m) {
      var onB = MQ.foc && MQ.foc.l === "batiments" && MQ.foc.i === m.i;
      h += '<polygon class="mq-sol" points="' + poly(m, m.bas) + '"/>';
      [[0, 0], [m.L, 0], [m.L, m.W], [0, m.W]].forEach(function (c) {
        var a = S(m.X + c[0], m.Y + c[1], m.bas), b = S(m.X + c[0], m.Y + c[1], m.haut);
        h += '<line class="mq-arete' + (onB ? " on" : "") + '" x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '"/>';
      });
      var dern = -1e9;
      m.niv.forEach(function (v) {
        var on = onB || (MQ.foc && MQ.foc.l === "niv" && m.i === NIVB && MQ.foc.i === v.k);
        h += '<polygon class="mq-dalle' + (on ? " on" : "") + '" points="' + poly(m, v.z) + '"><title>' + esc(v.n.c + " · " + v.n.lib + " · z = " + (Math.round(v.z * 100) / 100) + " m") + "</title></polygon>";
        // étiquette au coin le plus à droite, sautée si elle chevauche la précédente (sauf niveau en cours)
        var cs = [[0, 0], [m.L, 0], [m.L, m.W], [0, m.W]].map(function (c) { return S(m.X + c[0], m.Y + c[1], v.z); }).sort(function (a, b) { return b[0] - a[0]; })[0];
        if (on || Math.abs(cs[1] - dern) >= 11) { dern = cs[1]; h += '<text class="mq-t' + (on ? " on" : "") + '" x="' + (cs[0] + 6).toFixed(1) + '" y="' + (cs[1] + 3.5).toFixed(1) + '">' + esc(v.n.lib || v.n.c) + "</text>"; }
      });
      h += '<polygon class="mq-toit' + (onB ? " on" : "") + '" points="' + poly(m, m.haut) + '"/>';
      var t = S(m.X + m.L / 2, m.Y + m.W / 2, m.haut);
      h += '<text class="mq-nom" x="' + t[0].toFixed(1) + '" y="' + (t[1] - 8).toFixed(1) + '" text-anchor="middle">' + esc(m.b.lib || m.b.c || "Bâtiment") + "</text>";
    });
    var n = M.reduce(function (s, m) { return s + m.niv.length; }, 0);
    if (!n) h += '<text class="mq-t" x="14" y="' + (H - 12) + '">Ajoute des niveaux pour voir les étages.</text>';
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.innerHTML = h;
    dessineCoupe(M);
  }
  // Coupe : une colonne par bâtiment, l'altitude en ordonnée ; les traits pointillés prolongent chaque
  // altitude d'un bâtiment à l'autre pour voir comment les niveaux s'intercalent. Un clic ouvre le niveau.
  function dessineCoupe(M) {
    var svg = $("#coupe"); if (!svg) return;
    M = M.filter(function (m) { return m.niv.length; });
    var W = svg.clientWidth || 420;
    if (!M.length) { svg.setAttribute("viewBox", "0 0 " + W + " 60"); svg.style.height = "60px"; svg.innerHTML = '<text class="mq-t" x="14" y="34">Ajoute des niveaux pour voir la coupe.</text>'; return; }
    var z1 = Math.min.apply(null, M.map(function (m) { return m.bas; })), z2 = Math.max.apply(null, M.map(function (m) { return m.haut; }));
    var e = Math.max(8, Math.min(26, 520 / Math.max(1, z2 - z1))), H = Math.round((z2 - z1) * e + 54), g = 52, col = (W - g - 10) / M.length;
    var Y = function (z) { return 30 + (z2 - z) * e; }, f = function (z) { return (z > 0 ? "+" : "") + z.toFixed(2); };
    var h = "", alts = {};
    M.forEach(function (m) { m.niv.forEach(function (v) { alts[v.z.toFixed(2)] = 1; }); alts[m.haut.toFixed(2)] = 1; });
    var dern = -1e9;
    Object.keys(alts).map(Number).sort(function (a, b) { return b - a; }).forEach(function (z) {
      var y = Y(z); h += '<line class="cp-guide" x1="' + (g - 4) + '" y1="' + y.toFixed(1) + '" x2="' + (W - 6) + '" y2="' + y.toFixed(1) + '"/>';
      if (y - dern >= 10) { dern = y; h += '<text class="cp-alt" x="' + (g - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + f(z) + "</text>"; }
    });
    M.forEach(function (m, c) {
      var x = g + c * col + 6, w = col - 12;
      h += '<text class="mq-nom" x="' + (x + w / 2).toFixed(1) + '" y="16" text-anchor="middle">' + esc(m.b.c || m.b.lib || "Bâtiment") + "</text>";
      h += '<rect class="cp-bat" x="' + x.toFixed(1) + '" y="' + Y(m.haut).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + ((m.haut - m.bas) * e).toFixed(1) + '"/>';
      m.niv.forEach(function (v) {
        var on = MQ.foc && MQ.foc.l === "niv" && m.i === NIVB && MQ.foc.i === v.k, y = Y(v.z), hh = Math.max(2, v.h * e);
        h += '<g class="cp-niv' + (on ? " on" : "") + '" data-b="' + m.i + '" data-k="' + v.k + '"><title>' + esc((m.b.c || "") + " · " + v.n.c + " " + v.n.lib + " · " + f(v.z) + " m · " + v.h + " m") + "</title>" +
          '<rect x="' + x.toFixed(1) + '" y="' + (y - hh).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hh.toFixed(1) + '"/>' +
          '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + (x + w).toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
          (hh >= 11 ? '<text x="' + (x + 5).toFixed(1) + '" y="' + (y - Math.min(hh, 13) / 2 + 3.5).toFixed(1) + '">' + esc((v.n.lib || v.n.c) + (w > 110 ? "  " + v.n.c : "")) + "</text>" : "") + "</g>";
      });
    });
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.style.height = H + "px"; svg.innerHTML = h;
  }
  $("#ref").addEventListener("click", function (e) {
    var g = e.target.closest && e.target.closest(".cp-niv"); if (!g) return;
    var b = +g.dataset.b, k = +g.dataset.k;
    NIVB = b;
    var i = document.querySelector('#ref input[data-l="niv"][data-b="' + b + '"][data-i="' + k + '"][data-c="lib"]'); if (i) { i.focus(); i.scrollIntoView({ block: "center", behavior: "smooth" }); }
  });
  (function () {
    var g = null;
    $("#ref").addEventListener("pointerdown", function (e) { var s = e.target.closest("#mq"); if (!s) return; e.preventDefault(); s.setPointerCapture(e.pointerId); g = { x: e.clientX, y: e.clientY }; });
    $("#ref").addEventListener("pointermove", function (e) {
      if (!g) return; MQ.th += (e.clientX - g.x) * 0.01; MQ.ph = Math.max(0.12, Math.min(1.45, MQ.ph + (e.clientY - g.y) * 0.006)); g = { x: e.clientX, y: e.clientY }; dessineMaquette();
    });
    ["pointerup", "pointercancel"].forEach(function (t) { $("#ref").addEventListener(t, function () { g = null; }); });
    $("#ref").addEventListener("focusin", function (e) { var d = e.target.dataset || {}; if (d.l === "niv") NIVB = +d.b; var f = (d.l === "batiments" || d.l === "niv") ? { l: d.l, i: +d.i } : null; if (JSON.stringify(f) !== JSON.stringify(MQ.foc)) { MQ.foc = f; dessineMaquette(); } });
    window.addEventListener("resize", function () { if (VUE === "ref") dessineMaquette(); });
  })();

  var NIVB = 0;   // bâtiment dont on édite les niveaux
  function liste(k) { return k === "niv" ? (CONF.batiments[NIVB] || { niveaux: [] }).niveaux : CONF[k]; }
  $("#ref").addEventListener("change", function (e) {
    if (e.target.id === "niv-bat") { NIVB = +e.target.value; MQ.foc = null; dessineRef(); }
    else if (e.target.dataset.copie != null && e.target.value !== "") {
      var src = CONF.batiments[+e.target.value], dst = CONF.batiments[+e.target.dataset.copie];
      if (dst.niveaux.length && !window.confirm("Remplacer les " + dst.niveaux.length + " niveaux de " + (dst.c || "ce bâtiment") + " par ceux de " + (src.c || "l'autre") + " ?")) { e.target.value = ""; return; }
      dst.niveaux = copie(src.niveaux); marque(); dessineRef();
    }
  });
  var LISTES = [
    { k: "disciplines", t: "Disciplines", aide: "Code court qui entre dans le code du document (ex. STR).", cols: [["c", "Code", 110], ["lib", "Libellé"]] },
    { k: "phases", t: "Phases", aide: "Phases du projet (ex. SIA 112 : 51 projet d'exécution).", cols: [["c", "Code", 110], ["lib", "Libellé"]] },
    { k: "types", t: "Types de document", aide: "Plans, détails, notes de calcul, fiches, rapports… Coche « n° propres » pour un type qui a sa propre suite de numéros (ex. ARM et LIS, qui reprennent le n° de l'ouvrage) ; les autres partagent la numérotation commune.", cols: [["c", "Code", 110], ["lib", "Libellé"], ["propre", "N° propres", 90, "case"]] },
    { k: "batiments", t: "Bâtiments", aide: "Un ou plusieurs bâtiments. Longueur et largeur dessinent l'emprise (20 × 15 m si vide) ; X et Y placent le bâtiment sur le site (sinon côte à côte).", cols: [["c", "Code", 90], ["lib", "Nom"], ["lg", "Long. (m)", 76, "nb"], ["la", "Larg. (m)", 76, "nb"], ["x", "X (m)", 64, "nb"], ["y", "Y (m)", 64, "nb"]] },
    { k: "niv", t: "Niveaux du bâtiment", aide: "Chaque bâtiment a ses niveaux, du plus bas au plus haut. Hauteur d'étage : 3 m si vide. Altitude : facultative, sinon les niveaux s'empilent. « Hors maquette » pour un niveau fictif (ex. 000 tous niveaux).", cols: [["c", "Code", 76], ["lib", "Libellé"], ["h", "Haut. (m)", 72, "nb"], ["alt", "Alt. (m)", 72, "nb"], ["fictif", "Hors maq.", 62, "case"]] },
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
      if (L.k === "niv") return;
      if (L.k === "batiments") { h += '<div class="ref-bat"><div class="ref-bat-l">' + blocBatiments(); return; }
      h += (L.k === "niv" ? "" : '<div class="bloc"><h3>' + L.t + "</h3><p>" + esc(L.aide) + "</p><table>") + '<thead><tr>' + L.cols.map(function (c) { return '<th' + (c[2] ? ' style="width:' + c[2] + 'px"' : "") + ">" + c[1] + "</th>"; }).join("") + '<th style="width:100px"></th></tr></thead><tbody>' +
        liste(L.k).map(function (e, i) {
          return "<tr>" + L.cols.map(function (c) {
            return c[3] === "case" ? '<td><input type="checkbox" data-l="' + L.k + '" data-i="' + i + '" data-c="' + c[0] + '"' + (e[c[0]] ? " checked" : "") + "></td>"
              : c[3] === "nb" ? '<td><input class="champ mono" inputmode="decimal" data-l="' + L.k + '" data-i="' + i + '" data-c="' + c[0] + '" value="' + esc(e[c[0]] == null ? "" : e[c[0]]) + '" maxlength="12"></td>'
              : '<td><input class="champ' + (c[0] === "c" ? " mono" : "") + '" data-l="' + L.k + '" data-i="' + i + '" data-c="' + c[0] + '" value="' + esc(e[c[0]] || "") + '" maxlength="' + (c[0] === "c" ? 10 : 200) + '"></td>';
          }).join("") + '<td class="x"><button class="mini plus" data-mv="' + L.k + '|' + i + '|-1" title="Monter">↑</button><button class="mini plus" data-mv="' + L.k + '|' + i + '|1" title="Descendre">↓</button><button class="mini" data-sup="' + L.k + '|' + i + '" title="Retirer">×</button></td></tr>';
        }).join("") + '</tbody></table><button class="btn ajout" data-ajout="' + L.k + '">+ Ajouter</button></div>';
      if (L.k === "zones") h += '</div><aside class="maquette"><div class="mq-tete"><b>Maquette filaire</b><small>glisser pour tourner</small></div><svg id="mq" role="img" aria-label="Maquette filaire des bâtiments et de leurs niveaux"></svg>' +
        '<div class="mq-tete"><b>Coupe des niveaux</b><small>les niveaux de tous les bâtiments, par altitude</small></div><svg id="coupe" role="img" aria-label="Coupe des niveaux des bâtiments"></svg></aside></div>';
    });
    $("#ref").innerHTML = h; majEnreg(); verifiePlages(); dessineMaquette();
  }
  // Bâtiments et niveaux dans un seul tableau : chaque bâtiment, puis ses niveaux juste en dessous
  function blocBatiments() {
    function ch(l, b, i, c, v, o) {
      o = o || {};
      if (o.cas) return '<td><input type="checkbox" data-l="' + l + '" data-b="' + b + '" data-i="' + i + '" data-c="' + c + '"' + (v ? " checked" : "") + ' title="Niveau fictif, non dessiné"></td>';
      return '<td' + (o.sty ? ' style="' + o.sty + '"' : "") + '><input class="champ' + (o.mono ? " mono" : "") + '"' + (o.nb ? ' inputmode="decimal" maxlength="12"' : ' maxlength="' + (c === "c" ? 10 : 200) + '"') +
        ' data-l="' + l + '" data-b="' + b + '" data-i="' + i + '" data-c="' + c + '" value="' + esc(v == null ? "" : v) + '"' + (o.ph ? ' placeholder="' + o.ph + '"' : "") + "></td>";
    }
    function act(l, b, i) {
      return '<td class="x" style="white-space:nowrap">' + (l === "batiments" ? '<button class="mini plus" data-ajout="niv" data-b="' + b + '" title="Ajouter un niveau à ce bâtiment">+</button>' : "") +
        '<button class="mini plus" data-mv="' + l + "|" + i + '|-1" data-b="' + b + '" title="Monter">↑</button><button class="mini plus" data-mv="' + l + "|" + i + '|1" data-b="' + b + '" title="Descendre">↓</button>' +
        '<button class="mini" data-sup="' + l + "|" + i + '" data-b="' + b + '" title="' + (l === "batiments" ? "Retirer le bâtiment et ses niveaux" : "Retirer le niveau") + '">×</button></td>';
    }
    var h = '<div class="bloc"><h3>Bâtiments et niveaux</h3><p>Chaque bâtiment, puis ses niveaux du plus bas au plus haut (« + » sur la ligne du bâtiment pour en ajouter). Bâtiment : longueur et largeur de l\'emprise (20 × 15 m si vide), X et Y pour le placer (sinon côte à côte). Niveau : hauteur d\'étage (3 m si vide), altitude facultative (sinon les niveaux s\'empilent), « hors maquette » pour un niveau fictif comme 000.</p>' +
      '<table class="t-bat"><thead><tr><th style="width:96px">Code</th><th>Nom</th><th style="width:78px">Long. (m)</th><th style="width:78px">Larg. (m)</th><th style="width:70px">X (m)</th><th style="width:70px">Y (m)</th><th style="width:124px"></th></tr></thead><tbody>';
    if (!CONF.batiments.length) h += '<tr><td colspan="7" style="color:var(--texte-faible);padding:8px 4px">Aucun bâtiment pour l\'instant.</td></tr>';
    CONF.batiments.forEach(function (b, bi) {
      h += '<tr class="l-bat">' + ch("batiments", bi, bi, "c", b.c, { mono: 1 }) + ch("batiments", bi, bi, "lib", b.lib) + ch("batiments", bi, bi, "lg", b.lg, { nb: 1, mono: 1 }) + ch("batiments", bi, bi, "la", b.la, { nb: 1, mono: 1 }) +
        ch("batiments", bi, bi, "x", b.x, { nb: 1, mono: 1 }) + ch("batiments", bi, bi, "y", b.y, { nb: 1, mono: 1 }) + act("batiments", bi, bi) + "</tr>";
      var autres = CONF.batiments.map(function (o, k) { return k === bi || !o.niveaux.length ? "" : '<option value="' + k + '">' + esc((o.c || "?") + " (" + o.niveaux.length + " niv.)") + "</option>"; }).join("");
      h += '<tr class="l-tete"><td class="ind">Niveaux de ' + esc(b.c || "ce bâtiment") + '</td><td>Libellé</td><td>Haut. (m)</td><td>Alt. (m)</td><td>Hors maq.</td><td colspan="2">' +
        (autres ? '<select class="champ" data-copie="' + bi + '" style="height:26px;font-size:12px"><option value="">Reprendre de…</option>' + autres + "</select>" : "") + "</td></tr>";
      if (!b.niveaux.length) h += '<tr class="l-niv"><td class="ind" colspan="7" style="color:var(--texte-faible);padding:4px 4px 10px 26px">Aucun niveau : « + » sur la ligne du bâtiment.</td></tr>';
      b.niveaux.forEach(function (n, i) {
        h += '<tr class="l-niv">' + ch("niv", bi, i, "c", n.c, { mono: 1, sty: "padding-left:22px" }) + ch("niv", bi, i, "lib", n.lib) + ch("niv", bi, i, "h", n.h, { nb: 1, mono: 1, ph: "3" }) + ch("niv", bi, i, "alt", n.alt, { nb: 1, mono: 1 }) +
          ch("niv", bi, i, "fictif", n.fictif, { cas: 1 }) + "<td></td>" + act("niv", bi, i) + "</tr>";
      });
    });
    return h + '</tbody></table><button class="btn ajout" data-ajout="batiments">+ Ajouter un bâtiment</button></div>';
  }
  function exempleVal() { return valeurs({ type: (CONF.types[0] || {}).c, discipline: (CONF.disciplines[0] || {}).c, phase: (CONF.phases[0] || {}).c, batiment: (CONF.batiments[0] || {}).c, niveau: (((CONF.batiments[0] || {}).niveaux || [])[0] || {}).c, zone: (CONF.zones[0] || {}).c }, CONF.plages[0] ? +CONF.plages[0].de : 1); }
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
      if (d.l === "niv") NIVB = +d.b;
      liste(d.l)[+d.i][d.c] = d.c === "c" ? U(v) : /^(lg|la|x|y|h|alt)$/.test(d.c) ? nombre(v) : v;
      if (d.l === "batiments" || d.l === "niv") dessineMaquette();
      if (d.l === "batiments" && (d.c === "c" || d.c === "lib")) { var sb = $("#niv-bat"); if (sb && sb.options[+d.i]) sb.options[+d.i].textContent = (CONF.batiments[+d.i].c || "?") + (CONF.batiments[+d.i].lib ? " · " + CONF.batiments[+d.i].lib : ""); }
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
    if (d.b != null && /^niv/.test(d.ajout || d.sup || d.mv || "")) NIVB = +d.b;
    if (d.segx) { CONF.segments = CONF.segments.filter(function (k) { return k !== d.segx; }); marque(); majSegs(); return; }
    if (d.segplus) { CONF.segments.splice(Math.max(0, CONF.segments.indexOf("numero")), 0, d.segplus); marque(); majSegs(); return; }
    if (d.ajout) liste(d.ajout).push(d.ajout === "batiments" ? { c: "", lib: "", niveaux: [] } : { c: "", lib: "" });
    else if (d.sup) { s = d.sup.split("|"); liste(s[0]).splice(+s[1], 1); }
    else if (d.mv) { s = d.mv.split("|"); var L = liste(s[0]), i = +s[1], j = i + +s[2]; if (j < 0 || j >= L.length) return; L.splice(j, 0, L.splice(i, 1)[0]); }
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
    ["disciplines", "phases", "types", "batiments", "zones"].forEach(function (k) { CONF[k] = CONF[k].filter(function (x) { return x.c; }); });
    CONF.batiments.forEach(function (b) { b.niveaux = b.niveaux.filter(function (x) { return x.c; }); });
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
    if (LOCAL) { telecharge(CUR.code + ".json", documentJson()); if (!FI.h) { lsSet("org.exporte", new Date().toISOString()); setTimeout(function () { rechargeDonnees(true); }, 50); } return; }
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
          libelles: { discipline: lib("disciplines", r.discipline), phase: lib("phases", r.phase), type: lib("types", r.type), batiment: lib("batiments", r.batiment), niveau: libNiv(r.batiment, r.niveau), zone: lib("zones", r.zone) },
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
  $("#b-import").addEventListener("click", function () { if (LOCAL) { ouvrirFichier(); return; } $("#f-import").value = ""; $("#f-import").click(); });
  $("#f-import").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (t) {
      var j = JSON.parse(t);
      if (LOCAL) { var doc = versDocument(j); delie(); ecritLocal(doc); toast("Chantier " + doc.chantiers[0].code + " ouvert (sans lien au fichier : pense au bouton JSON)."); return charge(); }
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
