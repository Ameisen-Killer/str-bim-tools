// /fgh/pln/ : liste des plans du chantier Fairmont (03.11.2026).
// Les plans vivent dans la table fgh_plans du projet Supabase du site (migration-fgh-plans.sql),
// ouverte sans connexion comme Visas : clé PUBLIABLE ci-dessous, jamais la clé secrète.
// Bandeau gauche : les grandes zones (A00…TTZ) puis leurs niveaux. Import de l'export « Tableau de suivi »
// de Kairnial (SheetJS), exports PDF (jsPDF) et Excel (ExcelJS) avec l'en-tête AB, chargés au premier usage.
(function () {
  "use strict";

  var BASE = { url: "https://hxhjkdfnoygrlbdhjkwc.supabase.co", cle: "sb_publishable_33G_BjGlKGUBhSVIc_QUmQ_QDKC64vA" };
  var TABLE = "fgh_plans";
  var LIBS = {
    xlsx: "/fgh/arm/vendor/xlsx-0.18.5.full.min.js?v=1",
    jspdf: "/fgh/arm/vendor/jspdf-2.5.1.umd.min.js?v=1",
    exceljs: "/fgh/pln/vendor/exceljs-4.4.0.min.js?v=1"
  };
  var PROJET = "6848 – Hôtel Fairmont Genève";

  // Niveaux : codes Kairnial, libellés recoupés sur les titres de l'export du 03.11.2026
  var NIVEAUX = { "000": "Tous niveaux", "050": "SS-4", "060": "SS-3", "070": "SS-2", "080": "SS-1", "090": "Rez inf", "100": "Rez",
    "110": "Étage 1", "120": "Étage 2", "130": "Étage 3", "140": "Étage 4", "150": "Étage 5", "160": "Étage 6", "170": "Étage 7", "180": "Étage 8", "190": "Toiture" };
  var TYPES = { PLA: "Plan", ARM: "Armatures", LIS: "Listes de fers", ELV: "Élévation", DET: "Détail", NDC: "Note de calcul", DES: "Descriptif",
    RAP: "Rapport", CPE: "Coupe", SCH: "Schéma", CDC: "Cahier des charges", FTE: "Fiche technique", RFI: "RFI", MOD: "Maquette" };
  var CHAMPS = ["projet", "discipline", "emetteur", "phase", "type", "niveau", "zone", "numero", "indice", "titre", "date_indice", "auteur", "statut", "remarque", "controle_n", "date_controle", "controle_par", "liste_assoc"];

  var $ = function (s) { return document.querySelector(s); };
  var PLANS = [], ZONE = "", NIVEAU = "", TYPESEL = {}, NEUFS = false, RUB = "", PAR_RUB = lsGet("fgh.pln.rub") === "1", TRI = { col: "date", sens: -1 }, VUE = [], EDITE = null;

  // ------------------------------------------------------------------ outils
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function plie(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(m, ms) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, ms || 2600); }
  function occupe(on, txt) { $("#occupe").textContent = txt || "Traitement…"; $("#occupe").hidden = !on; }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function dateFr(iso) { if (!iso) return ""; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? m[3] + "." + m[2] + "." + m[1] : iso; }
  function aujourdhui() { var d = new Date(); return d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate()); }
  function horo(iso) { if (!iso) return ""; var d = new Date(iso); return deux(d.getDate()) + "." + deux(d.getMonth() + 1) + "." + d.getFullYear() + " à " + deux(d.getHours()) + ":" + deux(d.getMinutes()); }
  function code(p) { return [p.projet, p.discipline, p.emetteur, p.phase, p.type, p.niveau, p.zone, p.numero].join("-"); }
  function cle(p) { return [p.type, p.niveau, p.zone, p.numero].map(function (x) { return String(x || "").trim().toUpperCase(); }).join("|"); }
  function numInd(i) { var n = parseInt(i, 10); return isNaN(n) ? -1 : n; }
  function cmpInd(a, b) { var x = numInd(a), y = numInd(b); return x !== y ? x - y : String(a || "").localeCompare(String(b || "")); }
  function niveauNom(n) { return NIVEAUX[n] || n; }
  function charge(src) {
    charge.f = charge.f || {};
    return charge.f[src] || (charge.f[src] = new Promise(function (ok, ko) {
      var s = document.createElement("script"); s.src = src; s.onload = ok;
      s.onerror = function () { delete charge.f[src]; ko(new Error("Bibliothèque introuvable : " + src)); };
      document.head.appendChild(s);
    }));
  }

  // ------------------------------------------------------------------ base
  function appel(chemin, o) {
    o = o || {};
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
          throw new Error(/PGRST205|42P01|does not exist|could not find the table/i.test(brut)
            ? "La table des plans n'existe pas encore : exécute migration-fgh-plans.sql dans Supabase."
            : /row-level security|permission/i.test(brut) || r.status === 401 || r.status === 403 ? "Opération refusée par la base."
            : "Base : " + (j.message || "erreur " + r.status) + ".");
        });
      });
  }
  function litTout() {
    var tout = [];
    function page(d) {
      return appel(TABLE + "?select=*&order=type,niveau,zone,numero", { plage: d + "-" + (d + 999) }).then(function (l) {
        tout = tout.concat(l || []);
        return l && l.length === 1000 ? page(d + 1000) : tout;
      });
    }
    return page(0);
  }
  function etat(txt, classe) { var e = $("#etat"); e.className = "etat " + (classe || ""); e.innerHTML = "<span>" + esc(txt) + "</span>"; e.title = txt; }
  function recharge(silence) {
    if (!silence) etat("Chargement…");
    return litTout().then(function (l) {
      PLANS = l; etat(l.length + " plans · à jour", "ok"); dessine();
    }).catch(function (e) { etat("Base indisponible", "ko"); if (!PLANS.length) videMessage(e.message); toast(e.message, 5000); });
  }

  // ------------------------------------------------------------------ zones
  // Un plan (livrable type-niveau-zone-n°) = un groupe ; chaque indice est une ligne de la table.
  // Le dernier indice est affiché, les précédents sont empilés dessous et se déplient.
  var GROUPES = [], OUVERTS = {};
  function regroupe() {
    var m = {};
    PLANS.forEach(function (p) { var k = cle(p); (m[k] = m[k] || []).push(p); });
    GROUPES = Object.keys(m).map(function (k) {
      var r = m[k].sort(function (a, b) { return cmpInd(b.indice, a.indice) || String(b.date_indice || "").localeCompare(String(a.date_indice || "")); });
      return { cle: k, rows: r, d: r[0] };
    });
    var IX = {};
    GROUPES.forEach(function (g) { IX[g.cle] = g; g.lie = null; });
    GROUPES.forEach(function (g) {
      if (g.d.type !== "ARM") return;
      var man = null;
      g.rows.some(function (p) { var m = /(?:^|-)LIS-(\w+)-(\w+)-(\w+)\s*$/i.exec(String(p.liste_assoc || "").trim()); if (m) man = "LIS|" + m[1] + "|" + m[2].toUpperCase() + "|" + m[3]; return !!m; });
      var l = IX[man || ("LIS|" + g.d.niveau + "|" + g.d.zone + "|" + g.d.numero)];
      if (l) { g.lie = l; g.lieMan = !!man; if (!l.lie) l.lie = g; }
    });
  }
  // contrôle d'armatures du plan : l'indice affiché, sinon le dernier indice contrôlé du plan
  function ctrlDe(g, p) {
    if (p.controle_n) return { p: p, ici: true };
    if (p !== g.d) return null;
    var c = g.rows.filter(function (x) { return x.controle_n; })[0];
    return c ? { p: c, ici: false } : null;
  }
  function ligneCtrl(g, p) {
    var c = ctrlDe(g, p); if (!c) return "";
    var q = c.p, info = String(q.controle_info || "");
    return '<span class="ctrl-ligne' + (c.ici ? "" : " autre") + '"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "<span>Contrôlé sur place" + (q.date_controle ? " le " + esc(dateFr(q.date_controle)) : "") + (q.controle_par ? " par " + esc(q.controle_par) : "") +
      " · fiche n°" + esc(q.controle_n) + (c.ici ? "" : " (ind. " + esc(q.indice) + ")") + (info ? " · " + esc(info.slice(0, 90)) : "") + "</span>" +
      (q.controle_lien && /^https:\/\//.test(q.controle_lien) ? '<a href="' + esc(q.controle_lien) + '" target="_blank" rel="noopener" title="Fiche PDF dans SharePoint">PDF</a>' : "") +
      '<a href="/fgh/arm/#ctrl=' + encodeURIComponent(q.controle_n) + '" title="Ouvrir ce contrôle dans ARM (sur l\'appareil qui l\'a saisi)">ARM</a></span>';
  }
  function lienAssoc(g) {
    var l = g.lie; if (!l) return "";
    var q = l.d, lib = g.d.type === "ARM" ? "Liste" : "Plan d'armatures";
    return ' · <button type="button" class="assoc" data-va="' + esc(l.cle) + '" title="Aller à ' + esc(code(q)) + (g.lieMan ? " (association choisie à la main)" : " (même niveau, zone et n°)") + '">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.3 2.3 0 0 0 3.3 3.3L8.3 10.8M11 8.5l1.2-1.2a2.3 2.3 0 0 0-3.3-3.3L7.7 5.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' +
      lib + " " + esc(q.numero) + " ind. " + esc(q.indice) + (q.controle_n ? " ✓" : "") + "</button>";
  }
  function vaA(k) {
    var trouve = function () { for (var i = 0; i < VUE.length; i++) if (VUE[i].cle === k) return i; return -1; };
    var i = trouve();
    if (i < 0) { ZONE = ""; NIVEAU = ""; TYPESEL = {}; $("#recherche").value = ""; dessine(); i = trouve(); }
    var tr = $("#corps").querySelector('tr[data-i="' + i + '"][data-j="0"]'); if (!tr) return;
    tr.scrollIntoView({ block: "center", behavior: "smooth" }); tr.classList.remove("eclair"); void tr.offsetWidth; tr.classList.add("eclair");
  }
  function zonesInfos() {
    var z = {}, ok = passeTypesRecherche();
    GROUPES.forEach(function (g) {
      var p = g.d, k = p.zone || "?"; z[k] = z[k] || { n: 0, neufs: 0, noyaux: {}, niv: {}, nivNeufs: {} };
      if (ok(g)) {
        z[k].n++; z[k].niv[p.niveau] = (z[k].niv[p.niveau] || 0) + 1;
        if (neuf(p)) { z[k].neufs++; z[k].nivNeufs[p.niveau] = (z[k].nivNeufs[p.niveau] || 0) + 1; }
      }
      var m, re = /noyau\s+([A-Z])\b/gi; while ((m = re.exec(p.titre || ""))) z[k].noyaux[m[1].toUpperCase()] = 1;
    });
    return z;
  }
  function sousTitreZone(k, info) {
    if (k === "TTZ") return "Toutes zones";
    var n = Object.keys(info.noyaux).sort();
    if (n.length) return (n.length > 1 ? "Noyaux " : "Noyau ") + n.join(" · ");
    return "";
  }
  function pastilleNeufs(n) { return n ? '<span class="n-neufs" title="' + n + ' plan(s) déposé(s) depuis moins de 7 jours">+' + n + "</span>" : ""; }
  function dessineZones() {
    var Z = zonesInfos(), cles = Object.keys(Z).sort(function (a, b) { return (a === "TTZ") - (b === "TTZ") || a.localeCompare(b); });
    var h = '<button type="button" class="zone" data-z="" aria-current="' + (!ZONE) + '"><span class="nom"><b>Toutes les zones</b></span><span class="n">' + GROUPES.filter(passeTypesRecherche()).length + "</span></button><div class=\"sep-zones\"></div>";
    cles.forEach(function (k) {
      var i = Z[k], st = sousTitreZone(k, i), ici = ZONE === k;
      h += '<button type="button" class="zone" data-z="' + esc(k) + '" aria-current="' + (ici && !NIVEAU) + '"><span class="nom"><b>Zone ' + esc(k) + "</b>" + (st ? "<small>" + esc(st) + "</small>" : "") + "</span>" + pastilleNeufs(i.neufs) + '<span class="n' + (i.n ? "" : " zero") + '">' + i.n + "</span></button>";
      if (ici) {
        h += '<div class="niveaux">' + Object.keys(i.niv).sort().map(function (nv) {
          return '<button type="button" class="zone" data-z="' + esc(k) + '" data-n="' + esc(nv) + '" aria-current="' + (NIVEAU === nv) + '"><span class="nom">' + esc(niveauNom(nv)) + ' <small style="display:inline">' + esc(nv) + "</small></span>" + pastilleNeufs(i.nivNeufs[nv]) + '<span class="n">' + i.niv[nv] + "</span></button>";
        }).join("") + "</div>";
      }
    });
    // rubriques : comptées dans la zone et le niveau choisis, avec les types et la recherche
    var ok = passeTypesRecherche(), cr = {};
    GROUPES.forEach(function (g) { var p = g.d; if ((ZONE && p.zone !== ZONE) || (NIVEAU && p.niveau !== NIVEAU) || !ok(g)) return; var r = rubrique(p); cr[r.r.c] = (cr[r.r.c] || 0) + 1; if (r.s) cr[cleRub(p)] = (cr[cleRub(p)] || 0) + 1; });
    h += '<div class="sep-zones"></div><div class="titre-rub">Rubriques</div>';
    RUBRIQUES.forEach(function (r) {
      var n = cr[r.c] || 0, ici = RUB === r.c || RUB.indexOf(r.c + "|") === 0;
      if (!n && !ici) return;
      h += '<button type="button" class="zone rub-b" data-r="' + esc(r.c) + '" aria-current="' + (RUB === r.c) + '"><span class="nom">' + esc(r.lib) + '</span><span class="n">' + n + "</span></button>";
      if (ici && r.sous) h += '<div class="niveaux">' + r.sous.map(function (x) {
        var k = r.c + "|" + x[2], m = cr[k] || 0; if (!m && RUB !== k) return "";
        return '<button type="button" class="zone rub-b" data-r="' + esc(k) + '" aria-current="' + (RUB === k) + '"><span class="nom">' + esc(x[2]) + ' <small style="display:inline">' + x[0] + "–" + x[1] + '</small></span><span class="n">' + m + "</span></button>";
      }).join("") + "</div>";
    });
    $("#liste-zones").innerHTML = h;
    var manuels = GROUPES.filter(function (g) { return g.rows.some(function (p) { return p.source === "manuel"; }); }).length;
    $("#pied-zones").textContent = GROUPES.length + " plans · " + PLANS.length + " indices" + (manuels ? " · " + manuels + " avec saisie manuelle" : "");
  }
  $("#liste-zones").addEventListener("click", function (e) {
    var rb = e.target.closest(".rub-b");
    if (rb) { var k = rb.dataset.r; RUB = RUB === k ? (k.indexOf("|") > 0 ? k.split("|")[0] : "") : k; dessine(); $("#defile").scrollTop = 0; return; }
    var b = e.target.closest(".zone"); if (!b) return;
    var z = b.dataset.z, n = b.dataset.n || "";
    if (!n && z === ZONE && !NIVEAU && z) { ZONE = ""; } else { ZONE = z; NIVEAU = n; }
    if (!n) NIVEAU = "";
    if (matchMedia("(max-width:760px)").matches && (n || !z)) basculeZones(false);
    dessine(); $("#defile").scrollTop = 0;
  });
  function basculeZones(ouvert) {
    var r = document.documentElement;
    if (ouvert === undefined) ouvert = r.classList.contains("sans-zones");
    r.classList.toggle("sans-zones", !ouvert);
    lsSet("fgh.pln.zones", ouvert ? "1" : "0");
  }
  $("#btn-zones").addEventListener("click", function () { basculeZones(); });
  function majBtnRub() { $("#btn-rub").setAttribute("aria-pressed", PAR_RUB); }
  $("#btn-rub").addEventListener("click", function () { PAR_RUB = !PAR_RUB; lsSet("fgh.pln.rub", PAR_RUB ? "1" : "0"); majBtnRub(); dessineListe(); });
  majBtnRub();
  if (matchMedia("(max-width:760px)").matches) document.documentElement.classList.add("sans-zones");

  // ------------------------------------------------------------------ liste
  function texteRecherche(p) {
    return [code(p), p.titre, "ind " + p.indice, p.auteur, p.statut, p.remarque, p.controle_n ? "controle controlé sur place n°" + p.controle_n + " " + (p.controle_par || "") + " " + (p.controle_info || "") : "", niveauNom(p.niveau), TYPES[p.type]].join(" ");
  }
  // Jokers façon DOS : « ? » = un caractère, « * » = n'importe quelle suite ; dans un mot qui contient un chiffre,
  // « x » vaut aussi un caractère (3xxx = 3000 à 3999, 060-A0x-15xx…). Le mot doit alors couvrir tout le bloc.
  function joker(m) {
    var x = /\d/.test(m) && /x/.test(m);
    if (!x && !/[*?]/.test(m)) return m;
    var re = m.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^\\s]*").replace(/\?/g, "[^\\s]");
    if (x) re = re.replace(/x/g, "[^\\s-]");
    return new RegExp("(^|[^0-9a-z])" + re + "(?![0-9a-z])");
  }
  // filtre des types cochés et de la recherche (sans la zone ni le niveau) : sert aussi aux compteurs du bandeau
  function passeTypesRecherche() {
    var mots = plie($("#recherche").value).split(/\s+/).filter(Boolean).map(joker), types = Object.keys(TYPESEL);
    return function (g) {
      if (NEUFS && !neuf(g.d)) return false;
      if (types.length && !TYPESEL[g.d.type]) return false;
      if (!mots.length) return true;
      var t = plie(g.rows.map(texteRecherche).join(" "));
      return mots.every(function (m) { return typeof m === "string" ? t.indexOf(m) >= 0 : m.test(t); });
    };
  }
  function filtres() {
    var ok = passeTypesRecherche();
    return GROUPES.filter(function (g) {
      var p = g.d;
      if (ZONE && p.zone !== ZONE) return false;
      if (NIVEAU && p.niveau !== NIVEAU) return false;
      if (RUB && cleRub(p).indexOf(RUB) !== 0) return false;
      return ok(g);
    });
  }
  // n°, puis niveau, puis zone (puis type)
  function cmpNum(a, b) {
    return String(a.numero).localeCompare(String(b.numero), "fr", { numeric: true }) || String(a.niveau).localeCompare(String(b.niveau), "fr", { numeric: true }) ||
      String(a.zone).localeCompare(String(b.zone), "fr", { numeric: true }) || String(a.type).localeCompare(String(b.type));
  }
  function trie(l) {
    var c = TRI.col, s = TRI.sens;
    var v = c === "code" ? function (p) { return code(p); } : c === "date" ? function (p) { return p.date_indice || ""; } : function (p) { return p[c] || ""; };
    return l.sort(function (x, y) {
      var a = x.d, b = y.d;
      if (PAR_RUB) { var ra = rubrique(a), rb = rubrique(b); if (ra.i !== rb.i) return ra.i - rb.i; if (ra.s !== rb.s) return ra.s.localeCompare(rb.s, "fr", { numeric: true }); }
      var r = c === "indice" ? cmpInd(a.indice, b.indice) : c === "code" ? cmpNum(a, b) : String(v(a)).localeCompare(String(v(b)), "fr", { numeric: true });
      return r * s || code(a).localeCompare(code(b));
    });
  }
  function dessineTypes() {
    var c = {};
    GROUPES.forEach(function (g) { var p = g.d; if ((!ZONE || p.zone === ZONE) && (!NIVEAU || p.niveau === NIVEAU)) c[p.type] = (c[p.type] || 0) + 1; });
    var nN = GROUPES.filter(function (g) { return (!ZONE || g.d.zone === ZONE) && (!NIVEAU || g.d.niveau === NIVEAU) && neuf(g.d); }).length;
    $("#types").innerHTML = '<button type="button" class="b-neufs" data-neuf="1" aria-pressed="' + NEUFS + '" title="Plans déposés depuis moins de 7 jours">Nouveaux<i>' + nN + "</i></button>" + Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (t) {
      return '<button type="button" data-t="' + esc(t) + '" aria-pressed="' + !!TYPESEL[t] + '" title="' + esc(TYPES[t] || t) + '">' + esc(t) + "<i>" + c[t] + "</i></button>";
    }).join("");
  }
  $("#types").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.neuf) { NEUFS = !NEUFS; dessine(); return; }
    var t = b.dataset.t; if (TYPESEL[t]) delete TYPESEL[t]; else TYPESEL[t] = 1;
    dessine();
  });
  function videMessage(m) {
    $("#corps").innerHTML = ""; var v = $("#vide"); v.hidden = false;
    v.innerHTML = "<b>" + esc(m) + "</b>";
  }
  // ------------------------------------------------------------------ rubriques (réservation des numéros AB, liste des livrables du 11.09.2025)
  var RUBRIQUES = [
    { c: "G", lib: "Géotechnique", de: 1, a: 99 },
    { c: "N", lib: "Notes de calcul", de: 100, a: 499 },
    { c: "C", lib: "Convention d'utilisation", de: 500, a: 529 },
    { c: "S", lib: "Repérage des sondages", de: 530, a: 549 },
    { c: "P", lib: "Plans généraux au 1/100", de: 550, a: 999 },
    { c: "1", lib: "1 - Démolition", de: 1000, a: 1499 },
    { c: "2", lib: "2 - Renforcement", de: 1500, a: 1999 },
    { c: "3", lib: "3 - Reconstruction / Extension", de: 2000, a: 2499, sous: [[2000, 2099, "3.1 - Triangles façades"], [2100, 2199, "3.2 - Parking"], [2200, 2299, "3.3 - Socle"], [2300, 2499, "3.4 - Noyaux"]] },
    { c: "4", lib: "4 - Charpente métallique", de: 2500, a: 3499, sous: [[2500, 2599, "4.1 - Parking SS-1"], [2600, 2699, "4.2 - Théâtre"], [2700, 2799, "4.3 - Piscine"], [2800, 2999, "4.4 - Marquises / Pergolas"], [3000, 3199, "4.5 - Façade Mont-Blanc"], [3200, 3399, "4.6 - Façade Patio"], [3400, 3499, "4.7 - Toiture"]] },
    { c: "A", lib: "Armatures et listes de fers", types: ["ARM", "LIS"] },
    { c: "X", lib: "Autres" }
  ];
  // { i: rang de la rubrique, r: rubrique, s: sous-rubrique ou "" } ; les plans d'armatures et listes forment leur propre rubrique
  var CACHE_RUB = new WeakMap();
  function rubrique(p) {
    var cr = CACHE_RUB.get(p); if (cr && cr.n === p.numero && cr.t === p.type) return cr.v;
    var n = parseInt(p.numero, 10), t = String(p.type || "").toUpperCase(), res = null;
    for (var i = 0; i < RUBRIQUES.length && !res; i++) {
      var r = RUBRIQUES[i];
      if (r.types ? r.types.indexOf(t) >= 0 : r.de != null && n >= r.de && n <= r.a) {
        var s = ""; (r.sous || []).forEach(function (x) { if (n >= x[0] && n <= x[1]) s = x[2]; });
        res = { i: i, r: r, s: s };
      }
    }
    if (!res && (t === "NDC" || t === "RAP")) res = { i: 1, r: RUBRIQUES[1], s: "" };
    res = res || { i: RUBRIQUES.length - 1, r: RUBRIQUES[RUBRIQUES.length - 1], s: "" };
    CACHE_RUB.set(p, { n: p.numero, t: p.type, v: res }); return res;
  }
  function cleRub(p) { var r = rubrique(p); return r.r.c + (r.s ? "|" + r.s : ""); }
  function libRub(p) { var r = rubrique(p); return r.s || r.r.lib; }

  // déposé depuis moins de 7 jours (date de l'indice)
  function neuf(p) {
    if (!p.date_indice) return false;
    var d = new Date(p.date_indice + "T12:00:00"), j = (Date.now() - d.getTime()) / 864e5;
    return j > -1 && j < 7;
  }
  function ligne(p, i, j, g) {
    var ancien = j > 0, n = g.rows.length, ouvert = !!OUVERTS[g.cle];
    var pile = ancien ? '<span class="filet" aria-hidden="true"></span>' : n > 1
      ? '<button type="button" class="pile" data-pile="' + i + '" aria-expanded="' + ouvert + '" title="' + (ouvert ? "Masquer" : "Voir") + " les " + (n - 1) + ' indice(s) précédent(s)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
      : '<span class="pile-vide"></span>';
    return '<tr data-i="' + i + '" data-j="' + j + '" class="' + (ancien ? "ancien" : n > 1 ? "empile" : "") + (EDITE && EDITE.id === p.id ? " choisie" : "") + '">' +
      '<td class="code">' + pile + esc([p.projet, p.discipline, p.emetteur, p.phase].join("-")) + "-<b>" + esc([p.type, p.niveau, p.zone, p.numero].join("-")) + "</b></td>" +
      '<td class="ind">' + esc(p.indice) + (neuf(p) ? '<span class="neuf" title="Déposé il y a moins de 7 jours">nouveau</span>' : "") + (!ancien && n > 1 ? '<span class="nb-ind" title="' + n + ' indices">' + n + "</span>" : "") + '</td><td class="titre">' + esc(p.titre || "—") +
      (ancien ? "" : "<small>" + esc((TYPES[p.type] || p.type) + " · " + niveauNom(p.niveau) + " · zone " + p.zone + " · " + libRub(p)) + lienAssoc(g) + (p.remarque ? " · " + esc(p.remarque.slice(0, 80)) : "") + "</small>") + ligneCtrl(g, p) + "</td>" +
      '<td class="nw col-m">' + esc(dateFr(p.date_indice)) + '</td><td class="nw col-m">' + esc(p.auteur) + '</td><td class="col-m">' + (p.statut ? '<span class="pastille">' + esc(p.statut) + "</span> " : "") +
      (p.source === "manuel" ? '<span class="pastille manuel" title="Saisi à la main dans cet outil">manuel</span>' : "") + "</td></tr>";
  }
  function dessineListe() {
    VUE = trie(filtres());
    var nInd = 0; VUE.forEach(function (g) { nInd += g.rows.length; });
    $("#compte").textContent = VUE.length + " / " + GROUPES.length + " plans · " + nInd + " indices";
    document.querySelectorAll("thead [data-tri]").forEach(function (th) {
      if (th.dataset.tri === TRI.col) th.setAttribute("aria-sort", TRI.sens > 0 ? "ascending" : "descending"); else th.removeAttribute("aria-sort");
    });
    var v = $("#vide");
    if (!PLANS.length) {
      v.hidden = false;
      v.innerHTML = "<b>La liste est vide</b>Importe le dernier export Kairnial pour la remplir d'un coup, ou crée un plan à la main." +
        '<div><button type="button" class="bt plein" id="vide-import">Importer l\'export Kairnial</button></div>';
      $("#vide-import").onclick = function () { $("#fichier").click(); };
      $("#corps").innerHTML = ""; return;
    }
    v.hidden = !!VUE.length; if (!VUE.length) v.innerHTML = "<b>Aucun plan</b>Change la zone, les types ou la recherche.";
    var h = [];
    var avant = null, cpt = {};
    if (PAR_RUB) VUE.forEach(function (g) { var r = rubrique(g.d); cpt[r.r.c] = (cpt[r.r.c] || 0) + 1; cpt[cleRub(g.d)] = (cpt[cleRub(g.d)] || 0) + 1; });
    for (var i = 0; i < VUE.length; i++) {
      var g = VUE[i];
      if (PAR_RUB) {
        var r = rubrique(g.d), k = cleRub(g.d);
        if (!avant || avant.r !== r.r) h.push('<tr class="rub"><td colspan="6"><b>' + esc(r.r.lib) + "</b><span>" + cpt[r.r.c] + "</span></td></tr>");
        if (r.s && (!avant || avant.k !== k)) h.push('<tr class="rub sous"><td colspan="6">' + esc(r.s) + "<span>" + cpt[k] + "</span></td></tr>");
        avant = { r: r.r, k: k };
      }
      h.push(ligne(g.d, i, 0, g));
      if (OUVERTS[g.cle]) for (var j = 1; j < g.rows.length; j++) h.push(ligne(g.rows[j], i, j, g));
    }
    $("#corps").innerHTML = h.join("");
  }
  function dessine() { regroupe(); dessineZones(); dessineTypes(); dessineListe(); listes(); }
  $("#corps").addEventListener("click", function (e) {
    if (e.target.closest("a")) return;
    var va = e.target.closest(".assoc"); if (va) { vaA(va.dataset.va); return; }
    var b = e.target.closest(".pile");
    if (b) { var g = VUE[+b.dataset.pile]; if (OUVERTS[g.cle]) delete OUVERTS[g.cle]; else OUVERTS[g.cle] = 1; dessineListe(); return; }
    var tr = e.target.closest("tr[data-i]"); if (tr) ouvre(VUE[+tr.dataset.i].rows[+tr.dataset.j]);
  });
  document.querySelector("thead").addEventListener("click", function (e) {
    var th = e.target.closest("[data-tri]"); if (!th) return;
    TRI = { col: th.dataset.tri, sens: TRI.col === th.dataset.tri ? -TRI.sens : th.dataset.tri === "date" ? -1 : 1 }; dessineListe();
  });
  $("#recherche").addEventListener("input", function () { clearTimeout(dessineListe.t); dessineListe.t = setTimeout(function () { dessineZones(); dessineListe(); }, 120); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("#recherche").focus(); }
    if (e.key === "Escape") { if (!$("#f-plan").hidden) ferme("#f-plan"); else if (!$("#f-import").hidden) ferme("#f-import"); else if (!$("#f-apercu").hidden) ferme("#f-apercu"); }
  });
  function listes() {
    function remplit(id, vals, lib) { $(id).innerHTML = vals.map(function (v) { return '<option value="' + esc(v) + '">' + (lib ? esc(lib(v)) : ""); }).join(""); }
    function uniques(k) { var o = {}; PLANS.forEach(function (p) { if (p[k]) o[p[k]] = 1; }); return Object.keys(o).sort(); }
    remplit("#dl-types", uniques("type").concat(Object.keys(TYPES)).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(), function (t) { return TYPES[t] || ""; });
    remplit("#dl-niveaux", uniques("niveau").concat(Object.keys(NIVEAUX)).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(), niveauNom);
    remplit("#dl-zones", uniques("zone"));
    remplit("#dl-auteurs", uniques("auteur"));
    remplit("#dl-lis", GROUPES.filter(function (g) { return g.d.type === "LIS"; }).map(function (g) { return [g.d.type, g.d.niveau, g.d.zone, g.d.numero].join("-"); }).sort(), function (v) { var g = GROUPES.filter(function (x) { return [x.d.type, x.d.niveau, x.d.zone, x.d.numero].join("-") === v; })[0]; return g ? g.d.titre : ""; });
  }

  // ------------------------------------------------------------------ fiche
  var F = $("#form-plan");
  function ferme(s) { $(s).hidden = true; if (s === "#f-plan") { EDITE = null; dessineListe(); } if (s === "#f-apercu") $("#fa-cadre").src = "about:blank"; }
  document.querySelectorAll("[data-ferme]").forEach(function (b) { b.addEventListener("click", function () { ferme("#" + b.closest(".voile").id); }); });
  document.querySelectorAll(".voile").forEach(function (v) { v.addEventListener("mousedown", function (e) { if (e.target === v) ferme("#" + v.id); }); });
  function ouvre(p) {
    EDITE = p || null;
    var d = p || { projet: "FGH", discipline: "STR", emetteur: "ABI", phase: "51", type: Object.keys(TYPESEL)[0] || "PLA", niveau: NIVEAU || "", zone: ZONE || "", numero: "", indice: "00", titre: "", date_indice: aujourdhui(), auteur: lsGet("fgh.nom") || "", statut: "", remarque: "", controle_n: "", date_controle: "", controle_par: "", liste_assoc: "" };
    CHAMPS.forEach(function (k) { F.elements[k].value = d[k] == null ? "" : d[k]; });
    $("#fp-titre").textContent = p ? "Modifier l'indice " + p.indice : "Nouveau plan";
    $("#fp-suppr").hidden = !p; $("#fp-indice").hidden = !p;
    $("#fp-rub-l").hidden = !!p; if (!p) remplitRub();
    $("#fp-trace").textContent = p ? "Créé le " + horo(p.cree_le) + " · modifié le " + horo(p.modifie_le) + (p.modifie_par ? " par " + p.modifie_par : "") + (p.source === "kairnial" ? " · importé de Kairnial" : " · créé à la main") : "";
    majCode(); $("#f-plan").hidden = false; dessineListe();
    setTimeout(function () { F.elements[p ? "titre" : "type"].focus(); }, 30);
  }
  // prochain n° libre d'une plage : après le plus grand n° déjà pris (plans hors armatures et listes)
  function prochainNumero(de, a) {
    var max = de - 1;
    PLANS.forEach(function (p) { if (/^(ARM|LIS)$/.test(String(p.type).toUpperCase())) return; var n = parseInt(p.numero, 10); if (n >= de && n <= a && n > max) max = n; });
    if (max + 1 > a) { for (var n = de; n <= a; n++) if (!PLANS.some(function (p) { return parseInt(p.numero, 10) === n; })) return n; return null; }
    return max + 1;
  }
  function plagesRub() {
    var L = [];
    RUBRIQUES.forEach(function (r) {
      if (r.de == null) return;
      if (r.sous) r.sous.forEach(function (x) { L.push({ lib: r.lib.split(" - ")[1] + " · " + x[2], de: x[0], a: x[1] }); });
      else L.push({ lib: r.lib, de: r.de, a: r.a });
    });
    return L;
  }
  function remplitRub() {
    var pad = function (n) { return ("000" + n).slice(-4); };
    $("#fp-rub").innerHTML = '<option value="">— choisir pour proposer un n° —</option>' + plagesRub().map(function (x, i) {
      var n = prochainNumero(x.de, x.a);
      return '<option value="' + i + '"' + (n == null ? " disabled" : "") + ">" + esc(x.lib) + " (" + pad(x.de) + "–" + pad(x.a) + ") → " + (n == null ? "plage pleine" : pad(n)) + "</option>";
    }).join("");
  }
  $("#fp-rub").addEventListener("change", function () {
    var x = plagesRub()[+this.value]; if (!x) return;
    var n = prochainNumero(x.de, x.a); if (n == null) return;
    F.elements.numero.value = ("000" + n).slice(-4);
    if (/^(ARM|LIS)$/.test(F.elements.type.value.toUpperCase())) F.elements.type.value = "PLA";
    majCode(); F.elements.titre.focus();
  });
  function lit() {
    var o = {};
    CHAMPS.forEach(function (k) { o[k] = String(F.elements[k].value || "").trim(); });
    ["projet", "discipline", "emetteur", "phase", "type", "zone", "liste_assoc"].forEach(function (k) { o[k] = o[k].toUpperCase(); });
    o.date_indice = o.date_indice || null; o.date_controle = o.date_controle || null;
    return o;
  }
  function majCode() {
    var o = lit(); $("#fp-code").textContent = code(o) + (o.indice ? " · ind. " + o.indice : "");
    $("#fp-rub-info").textContent = o.numero ? "Rubrique : " + libRub(o) : "";
    var meme = PLANS.filter(function (p) { return cle(p) === cle(o) && (!EDITE || p.id !== EDITE.id); });
    var doublon = meme.filter(function (p) { return cmpInd(p.indice, o.indice) === 0; })[0];
    var a = $("#fp-alerte");
    a.hidden = !o.numero || (!doublon && (EDITE || !meme.length));
    if (doublon) a.textContent = "L'indice " + o.indice + " de ce plan existe déjà : « " + (doublon.titre || "sans titre") + " ». Change l'indice ou le numéro.";
    else if (!EDITE && meme.length) a.textContent = "Ce plan existe déjà (" + meme.length + " indice(s), dernier : " + meme.map(function (p) { return p.indice; }).sort(cmpInd).pop() + ") : la fiche sera ajoutée comme nouvel indice.";
  }
  F.addEventListener("input", majCode);
  F.addEventListener("submit", function (e) {
    e.preventDefault();
    var o = lit(), qui = nom(); if (qui === null) return;
    o.modifie_par = qui;
    var b = $("#fp-ok"); b.disabled = true;
    var req = EDITE
      ? appel(TABLE + "?id=eq." + encodeURIComponent(EDITE.id), { methode: "PATCH", corps: o, prefer: "return=representation" })
      : appel(TABLE, { methode: "POST", corps: Object.assign({ source: "manuel" }, o), prefer: "return=representation" });
    req.then(function (l) {
      var r = l && l[0]; if (!r) throw new Error("La base n'a rien renvoyé.");
      if (EDITE) { var i = PLANS.indexOf(EDITE); PLANS[i] = r; } else PLANS.push(r);
      if (!EDITE) OUVERTS[cle(r)] = OUVERTS[cle(r)] || 0;
      toast(EDITE ? "Indice " + r.indice + " enregistré" : "Ajouté : " + code(r) + " ind. " + r.indice);
      $("#f-plan").hidden = true; EDITE = null; dessine();
    }).catch(function (err) { toast(err.message, 5000); }).then(function () { b.disabled = false; });
  });
  function supprime(p) {
    if (!p || !confirm("Supprimer l'indice " + p.indice + " du plan " + code(p) + " ?\nLes autres indices du plan restent. Cette suppression vaut pour tout le monde.")) return;
    appel(TABLE + "?id=eq." + encodeURIComponent(p.id), { methode: "DELETE" }).then(function () {
      PLANS = PLANS.filter(function (x) { return x.id !== p.id; }); $("#f-plan").hidden = true; EDITE = null; dessine(); toast("Indice supprimé");
    }).catch(function (err) { toast(err.message, 5000); });
  }
  $("#fp-suppr").addEventListener("click", function () { supprime(EDITE); });
  // Nouvel indice : une nouvelle ligne, copiée de l'indice le plus avancé du plan ; l'ancien reste empilé dessous
  $("#fp-indice").addEventListener("click", function () {
    if (!EDITE) return;
    var g = GROUPES.filter(function (x) { return x.cle === cle(EDITE); })[0], der = g ? g.d : EDITE, n = numInd(der.indice);
    EDITE = null;
    CHAMPS.forEach(function (k) { F.elements[k].value = der[k] == null ? "" : der[k]; });
    F.elements.indice.value = n < 0 ? "00" : (n + 1 < 10 ? "0" : "") + (n + 1);
    F.elements.date_indice.value = aujourdhui();
    if (lsGet("fgh.nom")) F.elements.auteur.value = lsGet("fgh.nom");
    ["controle_n", "date_controle", "controle_par"].forEach(function (k) { F.elements[k].value = ""; });
    $("#fp-titre").textContent = "Nouvel indice " + F.elements.indice.value;
    $("#fp-suppr").hidden = true; $("#fp-indice").hidden = true; $("#fp-trace").textContent = "L'indice " + der.indice + " restera dans l'historique du plan.";
    majCode(); F.elements.titre.focus();
  });
  $("#btn-nouveau").addEventListener("click", function () { ouvre(null); });

  // ------------------------------------------------------------------ clic droit sur une ligne
  // (appui long au téléphone : le navigateur envoie le même événement)
  var MENU = $("#menu-ligne"), MENU_P = null;
  function fermeMenu() { MENU.hidden = true; MENU_P = null; document.querySelectorAll("tr.menu-ici").forEach(function (t) { t.classList.remove("menu-ici"); }); }
  $("#corps").addEventListener("contextmenu", function (e) {
    var tr = e.target.closest("tr[data-i]"); if (!tr) return;
    e.preventDefault(); fermeMenu();
    var g = VUE[+tr.dataset.i], p = g.rows[+tr.dataset.j]; MENU_P = p; tr.classList.add("menu-ici");
    $("#ml-tete").textContent = [p.type, p.niveau, p.zone, p.numero].join("-") + " · ind. " + p.indice;
    $("#ml-arm").querySelector("small").textContent = /^(ARM|LIS)$/.test(p.type) ? "ouvre ARM avec la fiche préremplie" : "plan " + p.type + " : à compléter dans ARM";
    MENU.hidden = false;
    var w = MENU.offsetWidth, h = MENU.offsetHeight;
    MENU.style.left = Math.max(4, Math.min(e.clientX, innerWidth - w - 4)) + "px";
    MENU.style.top = Math.max(4, Math.min(e.clientY, innerHeight - h - 4)) + "px";
    MENU.querySelector("button").focus();
  });
  document.addEventListener("mousedown", function (e) { if (!MENU.hidden && !MENU.contains(e.target)) fermeMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !MENU.hidden) fermeMenu(); });
  $("#defile").addEventListener("scroll", function () { if (!MENU.hidden) fermeMenu(); });
  MENU.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-a]"); if (!b || !MENU_P) return;
    var p = MENU_P, a = b.dataset.a; fermeMenu();
    if (a === "indice") { ouvre(p); $("#fp-indice").click(); }
    else if (a === "modifier") ouvre(p);
    else if (a === "supprimer") supprime(p);
    else if (a === "copier") { var t = code(p) + " ind. " + p.indice; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copié : " + t); }, function () { prompt("Code :", t); }); }
    else if (a === "arm") versArm(p);
  });
  // Fiche de contrôle d'armature : ARM s'ouvre sur un nouveau contrôle, plan lié et champs remplis
  function versArm(p) {
    var d = { id: p.id, projet: p.projet, discipline: p.discipline, type: p.type, niveau: p.niveau, zone: p.zone, numero: p.numero, indice: p.indice, titre: p.titre };
    location.href = "/fgh/arm/#pln=" + encodeURIComponent(JSON.stringify(d));
  }
  function nom() {
    var n = lsGet("fgh.nom");
    if (n) return n;
    n = prompt("Ton nom (noté sur les plans que tu modifies, gardé sur ce poste) :", "");
    if (n === null) return null;
    n = n.trim().slice(0, 100); if (n) lsSet("fgh.nom", n);
    return n;
  }

  // ------------------------------------------------------------------ import Kairnial
  $("#btn-import").addEventListener("click", function () { $("#fichier").click(); });
  $("#fichier").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (f) importe(f);
  });
  document.addEventListener("dragover", function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types, "Files") >= 0) e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return;
    e.preventDefault(); if (/\.xlsx?$/i.test(f.name)) importe(f); else toast("Dépose l'export Kairnial (.xlsx)");
  });
  var IMPORT = null;
  function titreDoc(t) { return String(t || "").trim().replace(/\.(pdf|dwg|dxf|ifc|xlsx?|docx?)$/i, "").trim(); }
  function dateIso(v) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + deux(v.getMonth() + 1) + "-" + deux(v.getDate());
    var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v || "")); return m ? m[3] + "-" + m[2] + "-" + m[1] : null;
  }
  function litExport(wb) {
    var garde = {}, nb = 0;
    wb.SheetNames.forEach(function (nomF) {
      var A = XLSX.utils.sheet_to_json(wb.Sheets[nomF], { header: 1, raw: true, defval: null });
      var hi = -1;
      for (var r = 0; r < Math.min(A.length, 30); r++) if (A[r] && String(A[r][0] || "").trim() === "Projet" && A[r].some(function (c) { return /4 chiffres/i.test(String(c || "")); })) { hi = r; break; }
      if (hi < 0) return;
      var H = A[hi].map(function (c) { return plie(c).trim(); });
      var col = function (re) { for (var i = 0; i < H.length; i++) if (re.test(H[i])) return i; return -1; };
      var C = { projet: col(/^projet$/), discipline: col(/^discipline$/), emetteur: col(/^emetteur$/), phase: col(/^phase$/), type: col(/^type de document$/), niveau: col(/^niveau$/),
        zone: col(/^zone$/), numero: col(/^4 chiffres$/), indice: col(/^indice$/), titre: col(/^libelle du document$/), di: col(/^dernier indice$/), date: col(/^date depot ged$/), auteur: col(/^ajoute par$/) };
      for (var i = hi + 1; i < A.length; i++) {
        var L = A[i]; if (!L || !L[C.numero] || !L[C.type]) continue;
        var g = function (k) { return C[k] < 0 || L[C[k]] == null ? "" : String(L[C[k]]).trim(); };
        var p = { projet: g("projet") || "FGH", discipline: g("discipline") || "STR", emetteur: g("emetteur") || "ABI", phase: g("phase") || "51", type: g("type").toUpperCase(),
          niveau: g("niveau") || "000", zone: (g("zone") || "TTZ").toUpperCase(), numero: g("numero"), indice: g("indice") || "00", titre: titreDoc(g("titre")).slice(0, 300),
          date_indice: dateIso(L[C.date]), auteur: g("auteur").slice(0, 100) };
        nb++;
        var k = cle(p) + "#" + numInd(p.indice), d = garde[k];
        if (!d || (p.date_indice || "") > (d.date_indice || "")) garde[k] = p;
      }
    });
    return { plans: garde, lignes: nb };
  }
  function importe(f) {
    occupe(true, "Lecture de l'export…");
    charge(LIBS.xlsx).then(function () { return f.arrayBuffer(); }).then(function (buf) {
      var wb = XLSX.read(buf, { type: "array", cellDates: true });
      var R = litExport(wb), keys = Object.keys(R.plans);
      if (!keys.length) throw new Error("Aucun plan trouvé : est-ce bien l'export « Tableau de suivi » de Kairnial ?");
      var parInd = {}, plansConnus = {}, plansExport = {};
      PLANS.forEach(function (p) { parInd[cle(p) + "#" + numInd(p.indice)] = p; plansConnus[cle(p)] = 1; });
      var nouveaux = [], majs = [], egaux = 0, avances = [];
      keys.forEach(function (k) {
        var n = R.plans[k], a = parInd[k]; plansExport[cle(n)] = 1;
        if (!a) {
          nouveaux.push(Object.assign({ source: "kairnial", statut: "", remarque: "", controle_n: "", date_controle: null, controle_par: "" }, n));
          if (plansConnus[cle(n)]) avances.push(n);
          return;
        }
        if (n.titre !== a.titre || (n.date_indice || null) !== (a.date_indice || null) || (n.auteur && n.auteur !== a.auteur)) {
          majs.push({ avant: a, apres: Object.assign({}, a, { titre: n.titre, date_indice: n.date_indice, auteur: n.auteur || a.auteur }) });
        } else egaux++;
      });
      var nPlans = Object.keys(plansExport).length, nouveauxPlans = Object.keys(plansExport).filter(function (k) { return !plansConnus[k]; }).length;
      var absents = GROUPES.filter(function (g) { return !plansExport[g.cle]; }).length;
      IMPORT = { nouveaux: nouveaux, majs: majs };
      $("#fi-fichier").textContent = f.name + " · " + R.lignes + " lignes lues : " + nPlans + " plans, " + keys.length + " indices";
      $("#fi-bilan").innerHTML = [[nouveauxPlans, "nouveaux plans"], [nouveaux.length, "indices ajoutés"], [majs.length, "indices corrigés"], [egaux, "indices déjà à jour"]]
        .map(function (x) { return "<div><b>" + x[0] + "</b><span>" + x[1] + "</span></div>"; }).join("");
      var det = avances.slice(0, 200).map(function (n) { return "<div>" + esc(code(n)) + " : nouvel indice <em>" + esc(n.indice) + "</em></div>"; }).join("");
      $("#fi-detail").innerHTML = (avances.length ? '<p class="muet">Nouveaux indices sur des plans déjà dans la liste :</p><div class="detail">' + det + (avances.length > 200 ? "<div>… et " + (avances.length - 200) + " autres</div>" : "") + "</div>" : "") +
        (absents ? '<p class="muet">' + absents + " plan(s) de la liste absents de l'export : rien n'y est changé.</p>" : "");
      $("#fi-ok").disabled = !nouveaux.length && !majs.length;
      $("#fi-ok").textContent = nouveaux.length || majs.length ? "Appliquer" : "Rien à faire";
      $("#f-import").hidden = false;
    }).catch(function (e) { toast(e.message, 5000); }).then(function () { occupe(false); });
  }
  $("#fi-ok").addEventListener("click", function () {
    if (!IMPORT) return;
    var qui = nom(); if (qui === null) return;
    var lots = [], N = IMPORT.nouveaux.map(function (p) { p.modifie_par = qui; return p; });
    var M = IMPORT.majs.map(function (m) { var o = {}; CHAMPS.concat(["id", "source"]).forEach(function (k) { o[k] = m.apres[k]; }); o.modifie_par = qui; return o; });
    for (var i = 0; i < N.length; i += 500) lots.push({ ins: N.slice(i, i + 500) });
    for (var j = 0; j < M.length; j += 500) lots.push({ maj: M.slice(j, j + 500) });
    var fait = 0;
    occupe(true, "Enregistrement…");
    lots.reduce(function (pr, lot) {
      return pr.then(function () {
        var req = lot.ins ? appel(TABLE, { methode: "POST", corps: lot.ins, prefer: "return=minimal" })
          : appel(TABLE + "?on_conflict=id", { methode: "POST", corps: lot.maj, prefer: "resolution=merge-duplicates,return=minimal" });
        return req.then(function () { fait += (lot.ins || lot.maj).length; occupe(true, "Enregistrement… " + fait + " / " + (N.length + M.length)); });
      });
    }, Promise.resolve()).then(function () {
      $("#f-import").hidden = true; toast(N.length + " indices ajoutés, " + M.length + " corrigés", 4000); IMPORT = null; return recharge(true);
    }).catch(function (e) { toast(e.message + (fait ? " (" + fait + " déjà enregistrés)" : ""), 6000); recharge(true); }).then(function () { occupe(false); });
  });

  // ------------------------------------------------------------------ exports
  function LV() { return VUE.map(function (g) { return g.d; }); }
  // exports : toujours classés par rubrique, l'ordre de l'écran gardé à l'intérieur de chaque rubrique
  function vueRub() {
    return VUE.map(function (g, i) { return { g: g, i: i, r: rubrique(g.d) }; }).sort(function (a, b) {
      return a.r.i - b.r.i || a.r.s.localeCompare(b.r.s, "fr", { numeric: true }) || a.i - b.i;
    });
  }
  // [{ type: "rub"|"sous"|"plan", lib, n, g }] dans l'ordre d'export
  function lignesExport() {
    var L = vueRub(), out = [], cpt = {};
    L.forEach(function (x) { cpt[x.r.r.c] = (cpt[x.r.r.c] || 0) + 1; var k = x.r.r.c + "|" + x.r.s; cpt[k] = (cpt[k] || 0) + 1; });
    var av = null;
    L.forEach(function (x) {
      if (!av || av.r !== x.r.r) out.push({ type: "rub", lib: x.r.r.lib, n: cpt[x.r.r.c] });
      if (x.r.s && (!av || av.r !== x.r.r || av.s !== x.r.s)) out.push({ type: "sous", lib: x.r.s, n: cpt[x.r.r.c + "|" + x.r.s] });
      out.push({ type: "plan", g: x.g, sous: !!x.r.s });
      av = { r: x.r.r, s: x.r.s };
    });
    return out;
  }
  function texteCtrl(p) { return p.controle_n ? "n°" + p.controle_n + (p.date_controle ? " · " + dateFr(p.date_controle) : "") + (p.controle_par ? " · " + p.controle_par : "") : ""; }
  function libelleVue() {
    var b = [];
    if (ZONE) b.push("Zone " + ZONE + (NIVEAU ? " · " + niveauNom(NIVEAU) : ""));
    if (RUB) b.push(RUB.split("|").pop() === RUB ? RUBRIQUES.filter(function (r) { return r.c === RUB; })[0].lib : RUB.split("|")[1]);
    if (NEUFS) b.push("Nouveaux (moins de 7 jours)");
    var t = Object.keys(TYPESEL); if (t.length) b.push(t.join(", "));
    if ($("#recherche").value.trim()) b.push("« " + $("#recherche").value.trim() + " »");
    return b.join(" · ") || "Tous les plans";
  }
  function nomFichier(ext) {
    return ("FGH - Liste des plans" + (ZONE ? " - " + ZONE + (NIVEAU ? " " + niveauNom(NIVEAU) : "") : "") + " - " + aujourdhui()).replace(/[\\/:*?"<>|]/g, "-") + "." + ext;
  }
  function telecharge(blob, nomF) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nomF; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  // Enregistrer : fenêtre « Enregistrer sous » du système quand le navigateur la propose (Chrome, Edge), sinon téléchargement
  function enregistre(blob, nomF) {
    if (!window.showSaveFilePicker) { telecharge(blob, nomF); return Promise.resolve(true); }
    var ext = nomF.split(".").pop(), types = { pdf: { description: "Document PDF", accept: { "application/pdf": [".pdf"] } },
      xlsx: { description: "Classeur Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } } };
    return window.showSaveFilePicker({ suggestedName: nomF, types: types[ext] ? [types[ext]] : undefined }).then(function (h) {
      return h.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); }).then(function () { toast("Enregistré : " + h.name); return true; });
    }).catch(function (e) { if (e && e.name === "AbortError") return false; telecharge(blob, nomF); return true; });
  }
  var APERCU = null;
  function apercu(blob, nomF, pages) {
    if (APERCU) URL.revokeObjectURL(APERCU.url);
    APERCU = { blob: blob, nom: nomF, url: URL.createObjectURL(blob) };
    $("#fa-nom").textContent = nomF; $("#fa-info").textContent = pages + " page" + (pages > 1 ? "s" : "") + " · " + Math.max(1, Math.round(blob.size / 1024)) + " Ko";
    $("#fa-cadre").src = APERCU.url + "#view=FitH"; $("#f-apercu").hidden = false;
  }
  $("#fa-enreg").addEventListener("click", function () { if (APERCU) enregistre(APERCU.blob, APERCU.nom).then(function (ok) { if (ok) ferme("#f-apercu"); }); });
  $("#fa-ouvrir").addEventListener("click", function () { if (APERCU) window.open(APERCU.url, "_blank", "noopener"); });
  function logo() {
    return logo.p || (logo.p = fetch("/fgh/logo-ab.jpg?v=1").then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.readAsDataURL(b); });
    }));
  }
  var BUREAUX = [["LAUSANNE", "021 614 20 00"], ["GENEVE", "022 349 80 88"], ["NYON", "022 363 76 10"], ["FRIBOURG", "026 321 35 55"]];

  // PDF A4, paysage ou portrait ; colonnes adaptées à la largeur
  var ORIENT = lsGet("fgh.pln.orient") === "portrait" ? "portrait" : "landscape", TOUS_IND = lsGet("fgh.pln.tousind") === "1";
  function fairePdf(orient) {
    return Promise.all([charge(LIBS.jspdf), logo()]).then(function (r) {
      var img = r[1], d = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: orient });
      var pay = orient === "landscape", W = pay ? 297 : 210, HP = pay ? 210 : 297, M = 12, BAS = HP - 10, vert = [77, 122, 28], pale = [234, 242, 216], gris = [135, 134, 139];
      var cols = pay ? [["Code", 62, "code"], ["Ind.", 11, "ind"], ["Titre", 130, "titre"], ["Niveau", 18, "niv"], ["Date", 17, "date"], ["Statut · contrôle", 35, "statut"]]
        : [["Code", 56, "code"], ["Ind.", 9, "ind"], ["Titre", 74, "titre"], ["Date", 16, "date"], ["Statut · contrôle", 31, "statut"]];
      var X = [M]; cols.forEach(function (c, i) { X[i + 1] = X[i] + c[1]; });
      var iT = cols.findIndex(function (c) { return c[2] === "titre"; });
      var y, quand = dateFr(aujourdhui());
      function T(s, x, yy, o) { o = o || {}; d.setFont("helvetica", o.b ? "bold" : "normal"); d.setFontSize(o.s || 8); d.setTextColor.apply(d, o.c || [0, 0, 0]); d.text(String(s == null ? "" : s), x, yy, o.a ? { align: o.a } : undefined); }
      function court(t, w) { d.setFont("helvetica", "normal"); d.setFontSize(7); return d.splitTextToSize(t || "", w - 2)[0] || ""; }
      function entete() {
        d.addImage(img, "JPEG", M, 8, 13.2, 12.5);
        BUREAUX.forEach(function (b, i) { var yy = 11.2 + i * 3.2; T(b[0], M + 17, yy, { b: 1, s: 6.5 }); d.setFont("helvetica", "bold"); var w = d.getTextWidth(b[0]); T(" - T " + b[1], M + 17 + w, yy, { s: 6.5 }); });
        T("LISTE DES PLANS", W - M, 12.5, { b: 1, s: 12, a: "right" });
        T(PROJET, W - M, 17.5, { s: 9, a: "right" });
        T(court(libelleVue(), pay ? 150 : 90) + " · " + VUE.length + " plan(s)" + (TOUS_IND ? ", tous les indices" : "") + " · édition du " + quand, W - M, 21.5, { s: 7.5, a: "right", c: gris });
        d.setDrawColor.apply(d, vert); d.setLineWidth(.5); d.line(M, 25, W - M, 25);
        y = 31; d.setFillColor.apply(d, pale); d.rect(M, y - 4.2, W - 2 * M, 6, "F");
        cols.forEach(function (c, i) { T(c[0], X[i] + 1.5, y, { b: 1, s: 7.5, c: [40, 60, 15] }); });
        y += 5;
      }
      entete();
      var zebre = 0;
      lignesExport().forEach(function (L) {
        if (L.type !== "plan") {
          var hb = L.type === "rub" ? 6 : 5;
          if (y + hb + 4 > BAS) { d.addPage(); entete(); }
          if (L.type === "rub") { d.setFillColor(202, 224, 155); d.rect(M, y - 3.6, W - 2 * M, hb, "F"); T(L.lib + "  (" + L.n + ")", M + 1.5, y + .4, { b: 1, s: 8.5, c: [40, 60, 15] }); }
          else { d.setFillColor(238, 244, 226); d.rect(M + 4, y - 3.4, W - 2 * M - 4, hb, "F"); T(L.lib + "  (" + L.n + ")", M + 5.5, y, { b: 1, s: 7.5, c: [60, 80, 30] }); }
          y += hb + .6; zebre = 0; return;
        }
        var i = zebre++;
        (TOUS_IND ? L.g.rows : [L.g.d]).forEach(function (p, j) {
          var vieux = j > 0, noir = vieux ? [110, 110, 110] : [0, 0, 0];
          d.setFont("helvetica", "normal"); d.setFontSize(7.5);
          var lignes = vieux ? [] : d.splitTextToSize(p.titre || "—", cols[iT][1] - 3).slice(0, 3), h = Math.max(1, lignes.length) * 3.4 + (vieux ? .8 : 1.6);
          if (y + h > BAS) { d.addPage(); entete(); }
          if (i % 2) { d.setFillColor(246, 248, 242); d.rect(M, y - 3.3, W - 2 * M, h, "F"); }
          cols.forEach(function (c, k) {
            var x = X[k] + 1.5;
            if (c[2] === "code") T(vieux ? "" : code(p), x, y, { s: pay ? 7 : 6.5 });
            else if (c[2] === "ind") T(p.indice, x + (vieux ? 1.5 : 0), y, { b: !vieux, s: vieux ? 7 : 7.5, c: vieux ? gris : vert });
            else if (c[2] === "titre") { if (vieux) T(court(p.titre && p.titre !== L.g.d.titre ? p.titre : "indice précédent", c[1]), x, y, { s: 6.5, c: gris }); else { d.setFont("helvetica", "normal"); d.setFontSize(7.5); d.setTextColor(0); d.text(lignes, x, y); } }
            else if (c[2] === "niv") T(vieux ? "" : niveauNom(p.niveau), x, y, { s: 7 });
            else if (c[2] === "date") T(dateFr(p.date_indice), x, y, { s: 7, c: noir });
            else if (c[2] === "auteur") T(court(p.auteur, c[1]), x, y, { s: 7, c: noir });
            else if (c[2] === "statut") T(court([p.statut, p.controle_n ? "ctrl n°" + p.controle_n : ""].filter(Boolean).join(" · "), c[1]), x, y, { s: 7, c: noir });
          });
          y += h;
        });
      });
      var n = d.getNumberOfPages();
      for (var k = 1; k <= n; k++) { d.setPage(k); d.setDrawColor(200); d.setLineWidth(.2); d.line(M, HP - 7, W - M, HP - 7); T("AB Ingénieurs · " + PROJET + " · liste des plans du " + quand, M, HP - 3, { s: 6.5, c: gris }); T("page " + k + " / " + n, W - M, HP - 3, { s: 6.5, c: gris, a: "right" }); }
      return { blob: d.output("blob"), pages: n };
    });
  }
  function pdfApercu() {
    occupe(true, "Création du PDF…");
    document.querySelectorAll("#fa-orient button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.o === ORIENT); });
    document.querySelectorAll("#fa-ind button").forEach(function (b) { b.setAttribute("aria-pressed", (b.dataset.t === "1") === TOUS_IND); });
    return fairePdf(ORIENT).then(function (r) { apercu(r.blob, nomFichier("pdf"), r.pages); }).catch(function (e) { toast(e.message, 5000); }).then(function () { occupe(false); });
  }
  $("#btn-pdf").addEventListener("click", function () {
    if (!VUE.length) { toast("Rien à exporter"); return; }
    pdfApercu();
  });
  $("#fa-ind").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-t]"); if (!b || (b.dataset.t === "1") === TOUS_IND) return;
    TOUS_IND = b.dataset.t === "1"; lsSet("fgh.pln.tousind", TOUS_IND ? "1" : "0"); pdfApercu();
  });
  $("#fa-orient").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-o]"); if (!b || b.dataset.o === ORIENT) return;
    ORIENT = b.dataset.o; lsSet("fgh.pln.orient", ORIENT === "portrait" ? "portrait" : "paysage"); pdfApercu();
  });

  $("#btn-xlsx").addEventListener("click", function () {
    if (!VUE.length) { toast("Rien à exporter"); return; }
    occupe(true, "Création du classeur…");
    Promise.all([charge(LIBS.exceljs), logo()]).then(function (r) {
      var wb = new window.ExcelJS.Workbook(); wb.creator = "AB Ingénieurs"; wb.created = new Date();
      var VERT = "FF4D7A1C", FONCE = "FF283C0F", PALE = "FFCAE09B", PALE2 = "FFEEF4E2", GRIS = "FF87868B";
      var ws = wb.addWorksheet("Liste des plans", { properties: { outlineProperties: { summaryBelow: false } },
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .2, footer: .2 } },
        headerFooter: { oddFooter: "&L&8AB Ingénieurs · " + PROJET + " · nomenclature des livrables&R&8page &P / &N" } });
      var tetes = ["A_Code projet", "B_Discipline", "C_Emetteur", "D_Phase SIA", "E_Type document", "F_Code étage", "G_Zone", "H_Numéro de livrable", "I_Indice de révision",
        "Code complet", "J_Titre du document", "K_Niveau", "L_Date de l'indice", "M_Auteur", "N_Statut", "O_Contrôle sur place (n° · date · par)", "P_Remarques"];
      var larg = [7, 8, 8, 7, 8, 7, 7, 9, 8, 33, 62, 12, 11, 18, 14, 30, 40], NC = tetes.length;
      ws.columns = larg.map(function (w) { return { width: w }; });
      var id = wb.addImage({ base64: r[1], extension: "jpeg" });
      ws.addImage(id, { tl: { col: 0.15, row: 0.2 }, ext: { width: 58, height: 55 } });
      [1, 2, 3, 4].forEach(function (k) { ws.getRow(k).height = 15; });
      BUREAUX.forEach(function (b, i) { ws.getCell(1 + i, 3).value = { richText: [{ text: b[0], font: { bold: true, size: 8, name: "Arial" } }, { text: " - T " + b[1], font: { size: 8, name: "Arial" } }] }; });
      ws.mergeCells("K1:Q1"); ws.getCell("K1").value = "HÔTEL FAIRMONT GENÈVE"; ws.getCell("K1").font = { bold: true, size: 18, name: "Arial", color: { argb: VERT } }; ws.getRow(1).height = 24;
      ws.mergeCells("K2:Q2"); ws.getCell("K2").value = PROJET + " · Structure"; ws.getCell("K2").font = { size: 11, name: "Arial" };
      ws.mergeCells("K3:Q3"); ws.getCell("K3").value = "Ingénieur structure : AB Ingénieurs SA (ABI)"; ws.getCell("K3").font = { size: 9, name: "Arial", color: { argb: GRIS } };
      ws.mergeCells("A6:Q6"); var t6 = ws.getCell("A6"); t6.value = "NOMENCLATURE DES LIVRABLES – LISTE DES PLANS"; ws.getRow(6).height = 20;
      t6.font = { bold: true, size: 12, name: "Arial", color: { argb: FONCE } }; t6.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } }; t6.alignment = { vertical: "middle", indent: 1 };
      var nInd = 0; VUE.forEach(function (g) { nInd += g.rows.length; });
      [["Date de mise à jour :", new Date(aujourdhui() + "T12:00:00")], ["Nombre total de livrables :", VUE.length], ["Indices au total :", nInd], ["Vue exportée :", libelleVue()]].forEach(function (x, k) {
        var rw = 7 + k; ws.mergeCells(rw, 1, rw, 4); ws.getCell(rw, 1).value = x[0]; ws.getCell(rw, 1).font = { size: 9, name: "Arial", bold: true };
        ws.mergeCells(rw, 5, rw, 10); var c5 = ws.getCell(rw, 5); c5.value = x[1]; c5.font = { size: 9, name: "Arial" }; c5.alignment = { horizontal: "left" }; if (k === 0) c5.numFmt = "dd.mm.yyyy";
      });
      ws.mergeCells("K8:Q9"); var nb = ws.getCell("K8"); nb.alignment = { wrapText: true, vertical: "top" }; nb.font = { size: 8, italic: true, name: "Arial", color: { argb: GRIS } };
      nb.value = "Classement par rubrique selon la réservation des numéros (feuille « Rubriques »). Les plans d'armatures et les listes de fers forment leur propre rubrique. Seul le dernier indice de chaque plan figure ici ; tous les indices sont dans « Historique des indices ».";
      var LH = 12, H = ws.getRow(LH); H.values = tetes; H.height = 36;
      H.eachCell(function (cell) { cell.font = { bold: true, name: "Arial", size: 8, color: { argb: FONCE } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
        cell.alignment = { vertical: "middle", wrapText: true }; cell.border = { top: { style: "thin", color: { argb: GRIS } }, bottom: { style: "thin", color: { argb: GRIS } }, left: { style: "hair", color: { argb: GRIS } }, right: { style: "hair", color: { argb: GRIS } } }; });
      var fin = { bottom: { style: "hair", color: { argb: "FFC8C8C8" } } };
      lignesExport().forEach(function (L) {
        if (L.type !== "plan") {
          var rs = ws.addRow([]), n = rs.number; ws.mergeCells(n, 1, n, NC);
          var c0 = ws.getCell(n, 1); c0.value = (L.type === "sous" ? "      " : "") + L.lib + "   (" + L.n + ")";
          c0.font = { bold: true, name: "Arial", size: L.type === "rub" ? 10 : 9, color: { argb: L.type === "rub" ? FONCE : "FF3C501E" } };
          c0.fill = { type: "pattern", pattern: "solid", fgColor: { argb: L.type === "rub" ? "FFDCEBBE" : PALE2 } }; c0.alignment = { vertical: "middle" };
          rs.height = L.type === "rub" ? 18 : 15; if (L.type === "sous") rs.outlineLevel = 1; return;
        }
        var p = L.g.d;
        var row = ws.addRow([p.projet, p.discipline, p.emetteur, p.phase, p.type, p.niveau, p.zone, p.numero, p.indice, code(p) + "-" + p.indice, p.titre, niveauNom(p.niveau),
          p.date_indice ? new Date(p.date_indice + "T12:00:00") : null, p.auteur, p.statut, texteCtrl(p), p.remarque]);
        row.font = { name: "Arial", size: 8 }; row.alignment = { vertical: "top" }; row.outlineLevel = L.sous ? 2 : 1;
        row.eachCell({ includeEmpty: true }, function (cell) { cell.border = fin; });
        row.getCell(13).numFmt = "dd.mm.yyyy"; row.getCell(9).font = { name: "Arial", size: 8, bold: true, color: { argb: VERT } };
        if (p.controle_n) row.getCell(16).font = { name: "Arial", size: 8, bold: true, color: { argb: VERT } };
        if (neuf(p)) row.getCell(11).font = { name: "Arial", size: 8, bold: true };
      });
      ws.autoFilter = { from: { row: LH, column: 1 }, to: { row: ws.rowCount, column: NC } };
      ws.views = [{ state: "frozen", ySplit: LH }];
      ws.pageSetup.printTitlesRow = LH + ":" + LH;
      // Rubriques : réservation des numéros
      var wr = wb.addWorksheet("Rubriques");
      wr.columns = [{ width: 44 }, { width: 10 }, { width: 10 }, { width: 14 }];
      var hr = wr.addRow(["Rubrique", "Début", "Fin", "Plans exportés"]);
      hr.eachCell(function (cell) { cell.font = { bold: true, name: "Arial", size: 9, color: { argb: FONCE } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } }; });
      var cr = {}; vueRub().forEach(function (x) { cr[x.r.r.c] = (cr[x.r.r.c] || 0) + 1; if (x.r.s) cr[x.r.s] = (cr[x.r.s] || 0) + 1; });
      var pad = function (n) { return n == null ? "" : ("000" + n).slice(-4); };
      RUBRIQUES.forEach(function (rb) {
        var w = wr.addRow([rb.lib, rb.types ? "types " + rb.types.join(", ") : pad(rb.de), rb.types ? "" : pad(rb.a), cr[rb.c] || 0]); w.font = { name: "Arial", size: 9, bold: true };
        (rb.sous || []).forEach(function (x) { var v = wr.addRow(["      " + x[2], pad(x[0]), pad(x[1]), cr[x[2]] || 0]); v.font = { name: "Arial", size: 9 }; });
      });
      // Historique : tous les indices des plans exportés, du plus récent au plus ancien
      var wh = wb.addWorksheet("Historique des indices", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      wh.columns = [{ width: 34 }, { width: 7 }, { width: 70 }, { width: 12 }, { width: 20 }, { width: 16 }, { width: 11 }, { width: 13 }];
      var hh = wh.addRow(["Code", "Indice", "Titre", "Date indice", "Auteur", "Statut", "Contrôle n°", "Date contrôle"]);
      hh.eachCell(function (cell) { cell.font = { bold: true, name: "Arial", size: 9, color: { argb: "FF283C0F" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCAE09B" } }; });
      VUE.forEach(function (g, gi) {
        g.rows.forEach(function (p, j) {
          var rw = wh.addRow([code(p), p.indice, p.titre, p.date_indice ? new Date(p.date_indice + "T12:00:00") : null, p.auteur, p.statut, p.controle_n, p.date_controle ? new Date(p.date_controle + "T12:00:00") : null]);
          rw.font = { name: "Arial", size: 9, bold: j === 0, color: j ? { argb: "FF6F6F6F" } : undefined };
          rw.getCell(4).numFmt = "dd.mm.yyyy"; rw.getCell(8).numFmt = "dd.mm.yyyy";
          if (gi % 2) rw.eachCell({ includeEmpty: true }, function (cell) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8F2" } }; });
        });
      });
      wh.autoFilter = { from: { row: 1, column: 1 }, to: { row: wh.rowCount, column: 8 } };
      wh.views = [{ state: "frozen", ySplit: 1 }];
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      enregistre(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomFichier("xlsx"));
    }).catch(function (e) { toast(e.message, 5000); }).then(function () { occupe(false); });
  });

  // ------------------------------------------------------------------ thème, démarrage
  $("#btn-theme").addEventListener("click", function () {
    var r = document.documentElement, c = r.getAttribute("data-theme") === "clair" ? "sombre" : "clair";
    r.setAttribute("data-theme", c); lsSet("fgh.theme", c);
    document.querySelector("meta[name=theme-color]").setAttribute("content", c === "clair" ? "#F4F5F2" : "#1B1D19");
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && $("#f-plan").hidden && $("#f-import").hidden && Date.now() - (recharge.t || 0) > 60000) { recharge.t = Date.now(); recharge(true); }
  });
  recharge.t = Date.now();
  recharge();
})();
