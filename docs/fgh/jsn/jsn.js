// /fgh/jsn/ : éditeur des fichiers JSON de validation des réservations (16.11.2026).
// Format STR_FGH_RES_VALIDATION, écrit par le valideur /fgh/rsv/ et lu par le bouton Revit
// « Import Validation RES ». Tout reste dans le navigateur : rien n'est envoyé à la base.
//
// - Une ligne par réservation : statut, date et commentaire de la maquette et du JSON côte à côte.
//   Valeurs maquette : champ « ancien » du JSON, ou mieux l'IFC des réservations (« IFC RES »,
//   jeu STR_FGH_RES écrit par « Export IFC RES »), qui les donne aussi pour les lignes absentes.
// - Filtres (statut maquette / JSON, lignes présentes, niveau, famille) et recherche (commentaire
//   maquette, commentaire JSON, n° / Id / clé, ou partout).
// - Changements sur PLUSIEURS lignes à la fois (cases à cocher, Maj+clic pour une plage, case
//   d'en-tête pour tout ce qui est affiché) : statut, commentaire, lignes enlevées (la maquette garde
//   sa valeur), ligne statut manquante ajoutée. Annuler revient en arrière pas à pas.
// - Règle de Tony (16.11.2026) : un changement de statut ne change JAMAIS la date ; une date du jour
//   n'est ajoutée que si la maquette n'a pas de date (comme /fgh/rsv/ 2.9.0 et Import 1.5.0).
// - « Enregistrer la version » écrit un NOUVEAU fichier (V1.1 → V1.2, champ version_fichier) puis
//   ouvre la comparaison avant / après (exportable en Excel).
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var FORMAT = "STR_FGH_RES_VALIDATION", FORMAT_VERSION = 1, PSET = "STR_FGH_RES";
  var P_ST = "PVA_RES_VAL_Statut", P_DATE = "PVA_RES_VAL_Date", P_COM = "PVA_RES_VAL_Commentaire";
  var PARAMS = [P_ST, P_DATE, P_COM];
  var LIB = {}; LIB[P_ST] = "Statut"; LIB[P_DATE] = "Date"; LIB[P_COM] = "Commentaire";
  var COURT = { statut: P_ST, date: P_DATE, com: P_COM };
  var GARDE = "(maquette gardée)";
  var EXCELJS = "/fgh/pln/vendor/exceljs-4.4.0.min.js?v=1";
  var NIVEAUX = { "000": "Tous niveaux", "050": "SS-4", "060": "SS-3", "070": "SS-2", "080": "SS-1", "090": "Rez inf", "100": "Rez",
    "110": "Étage 1", "120": "Étage 2", "130": "Étage 3", "140": "Étage 4", "150": "Étage 5", "160": "Étage 6", "170": "Étage 7", "180": "Étage 8", "190": "Toiture" };

  var $ = function (s) { return document.querySelector(s); };
  var ED = null;            // fichier ouvert : { nom, handle, d, resas, pile }
  var AFFICHE = [], SEL = new Set(), DERNIER = null, TRI = { col: "", sens: 1 };
  var FILT = { stj: null, stm: null, lignes: null, niveau: "", famille: "" };
  var IFC = null;           // IFC RES lu : { map, nom } (gardé si on ouvre un autre JSON)
  var SAUVE = null;         // nom du dernier fichier enregistré depuis le dernier changement

  // ------------------------------------------------------------------ outils
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function plie(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function norm(v) { return v == null ? "" : String(v).trim(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(m, ms) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, ms || 2800); }
  function occupe(on, txt) { $("#occupe").textContent = txt || "Traitement…"; $("#occupe").hidden = !on; }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function aujourdhui() { var d = new Date(); return deux(d.getDate()) + "/" + deux(d.getMonth() + 1) + "/" + d.getFullYear(); }
  function pluriel(n, m) { return n + " " + m + (n > 1 ? "s" : ""); }
  function codeNiv(n) { var m = /(\d{3})\s*$/.exec(n || ""); return m ? m[1] : ""; }
  function nomNiv(n) { var c = codeNiv(n); return NIVEAUX[c] ? n + " · " + NIVEAUX[c] : (n || "—"); }
  function cmpTxt(a, b) { return String(a).localeCompare(String(b), "fr", { numeric: true }); }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function classeSt(v) { return v === "VALIDE" ? "valide" : v === "REFUSE" ? "refuse" : v === "A REVOIR" ? "revoir" : "attente"; }
  function pastille(v) { return '<span class="statut st-' + classeSt(v) + '">' + esc(v || "(vide)") + "</span>"; }

  // ------------------------------------------------------------------ réservations
  function cleResa(m) { return norm(m.cle) || "uid:" + norm(m.unique_id); }

  // ligne qui compte pour p (la plus récente) ; une ligne « retire » = pas de ligne
  function active(lignes, p) {
    var l = lignes[p] || [];
    if (!l.length) return null;
    var m = l.slice().sort(function (a, b) { var x = norm(a.quand), y = norm(b.quand); return x < y ? -1 : x > y ? 1 : 0; })[l.length - 1];
    return m.retire ? null : m;
  }
  // valeur du JSON pour p ; null = pas de ligne (la maquette garde sa valeur)
  function nouveau(lignes, p) { var m = active(lignes, p); return m ? norm(m.nouveau) : null; }
  // valeur de la maquette : IFC RES, sinon « ancien » lu à l'ouverture, sinon celui d'une ligne ajoutée ; null = inconnue
  function maquette(r, p) {
    if (r.ifc && r.ifc[p] !== undefined) return r.ifc[p];
    if (r.ancien[p] !== undefined) return r.ancien[p];
    var m = active(r.lignes, p);
    return m && m.ancien != null ? norm(m.ancien) : null;
  }
  function txtMq(r, p) { var v = maquette(r, p); return v === null ? "?" : v; }
  function txtJs(v) { return v === null ? GARDE : (v || "(vide)"); }
  // genre d'un changement par rapport à l'ouverture : "" | "chg" (changée / ajoutée) | "ret" (enlevée)
  function genre(r, p) {
    var a = nouveau(r.orig, p), b = nouveau(r.lignes, p);
    if (a === b) return "";
    return b === null ? "ret" : "chg";
  }
  function modifiee(r) { return PARAMS.some(function (p) { return genre(r, p) !== ""; }); }
  function remarque(r) {
    var t = [];
    if (!active(r.lignes, P_ST)) t.push("Pas de ligne statut");
    var mq = maquette(r, P_DATE), n = nouveau(r.lignes, P_DATE);
    if (n !== null && mq && n !== mq) t.push("Date initiale gardée à l'import (" + mq + ")");
    return t.join(" · ");
  }
  function par(r) {
    var s = {};
    PARAMS.forEach(function (p) { (r.lignes[p] || []).forEach(function (m) { if (norm(m.par)) s[norm(m.par)] = 1; }); });
    return Object.keys(s).sort().join(", ");
  }

  function construire(nom, d, handle) {
    var par_cle = new Map(), resas = [];
    (d.modifications || []).forEach(function (m) {
      if (!m || typeof m !== "object") return;
      var k = cleResa(m), r = par_cle.get(k);
      if (!r) {
        r = { cle: k, uid: norm(m.unique_id), id: norm(m.element_id), num: norm(m.numero), famille: norm(m.famille),
          niveau: norm(m.niveau), lignes: {}, ancien: {}, ifc: null, autres: [] };
        par_cle.set(k, r); resas.push(r);
      }
      var p = norm(m.parametre);
      (r.lignes[p] = r.lignes[p] || []).push(copie(m));
      if (m.ancien != null && !m.retire && r.ancien[p] === undefined) r.ancien[p] = norm(m.ancien);
    });
    resas.forEach(function (r, i) { r.ordre = i; r.orig = copie(r.lignes); });
    return { nom: nom, handle: handle || null, d: d, resas: resas, pile: [] };
  }
  function lignesFichier(ed) {
    var out = [];
    ed.resas.slice().sort(function (a, b) { return a.ordre - b.ordre; }).forEach(function (r) {
      var ps = PARAMS.concat(Object.keys(r.lignes).filter(function (p) { return PARAMS.indexOf(p) < 0; }).sort());
      ps.forEach(function (p) { (r.lignes[p] || []).forEach(function (m) { out.push(m); }); });
    });
    return out;
  }
  function estModifie() { return !!ED && ED.resas.some(modifiee); }

  // ------------------------------------------------------------------ changements (pile d'annulation)
  function memorise() {
    ED.pile.push(ED.resas.map(function (r) { return copie(r.lignes); }));
    if (ED.pile.length > 40) ED.pile.shift();
    SAUVE = null;
  }
  function annule() {
    if (!ED || !ED.pile.length) return;
    var e = ED.pile.pop();
    ED.resas.forEach(function (r, i) { r.lignes = e[i]; });
    SAUVE = null;
    rendu(); toast("Dernier changement annulé.");
  }
  function base(r, auteur, quand) {
    return { cle: r.cle.indexOf("uid:") === 0 ? "" : r.cle, unique_id: r.uid, element_id: r.id, numero: r.num,
      famille: r.famille, niveau: r.niveau, parametre: "", ancien: undefined, nouveau: "", par: auteur, quand: quand };
  }
  // pose la valeur du JSON pour p (modifie la ligne qui compte, ou en ajoute une) ; true si changé
  function pose(r, p, valeur, auteur, quand) {
    valeur = norm(valeur);
    if (nouveau(r.lignes, p) === valeur) return false;
    var m = active(r.lignes, p);
    if (!m) {
      m = base(r, auteur, quand); m.parametre = p;
      var mq = maquette(r, p);
      if (mq !== null) m.ancien = mq; else delete m.ancien;
      r.lignes[p] = [m];        // les anciennes lignes annulées (retire) sont remplacées
    }
    m.nouveau = valeur; m.par = auteur || norm(m.par); m.quand = quand;
    delete m.retire;
    return true;
  }
  function selection() { return ED ? ED.resas.filter(function (r) { return SEL.has(r.cle); }) : []; }
  function auteur() { var v = norm($("#m-par").value); lsSet("fgh.jsn.par", v); return v; }
  function confirme(msg, n) { return n <= 1 || window.confirm(msg); }

  function poseStatut() {
    var sel = selection(); if (!sel.length) return;
    var st = $("#m-statut").value, dater = $("#m-dater").checked;
    if (!confirme("Poser le statut « " + (st || "(vide)") + " » sur " + pluriel(sel.length, "réservation") + " ?\nLes dates ne changent pas.", sel.length)) return;
    memorise();
    var q = new Date().toISOString(), a = auteur(), n = 0, nd = 0;
    sel.forEach(function (r) {
      if (pose(r, P_ST, st, a, q)) n++;
      // règle de Tony : le statut ne touche jamais la date ; date du jour seulement si la maquette n'en a pas
      if (dater && st && nouveau(r.lignes, P_DATE) === null && maquette(r, P_DATE) === "" && pose(r, P_DATE, aujourdhui(), a, q)) nd++;
    });
    if (!n && !nd) ED.pile.pop();
    rendu();
    toast(pluriel(n, "statut") + " changé" + (n > 1 ? "s" : "") + (nd ? ", " + pluriel(nd, "date") + " du jour ajoutée" + (nd > 1 ? "s" : "") + " (maquette sans date)" : "") + ".");
  }
  function poseCom() {
    var sel = selection(); if (!sel.length) return;
    var t = $("#m-com").value;
    if (!confirme("Poser ce commentaire sur " + pluriel(sel.length, "réservation") + " ?", sel.length)) return;
    memorise();
    var q = new Date().toISOString(), a = auteur(), n = 0;
    sel.forEach(function (r) { if (pose(r, P_COM, t, a, q)) n++; });
    if (!n) ED.pile.pop();
    rendu(); toast(pluriel(n, "commentaire") + " changé" + (n > 1 ? "s" : "") + ".");
  }
  function enleve(quoi) {
    var sel = selection(); if (!sel.length) return;
    var ps = quoi.split(",").map(function (c) { return COURT[c]; });
    var lib = ps.map(function (p) { return LIB[p].toLowerCase(); }).join(" et ");
    if (!confirme("Enlever la ligne " + lib + " de " + pluriel(sel.length, "réservation") + " ?\nL'import gardera la valeur de la maquette.", sel.length)) return;
    memorise();
    var n = 0;
    sel.forEach(function (r) { ps.forEach(function (p) { if ((r.lignes[p] || []).length) { r.lignes[p] = []; n++; } }); });
    if (!n) ED.pile.pop();
    rendu(); toast(pluriel(n, "ligne") + " enlevée" + (n > 1 ? "s" : "") + ".");
  }
  function ajouteManquant() {
    var sel = selection(); if (!sel.length) return;
    memorise();
    var q = new Date().toISOString(), a = auteur(), n = 0, inconnus = 0;
    sel.forEach(function (r) {
      if (active(r.lignes, P_ST)) return;
      var mq = maquette(r, P_ST);
      if (mq === null) { inconnus++; return; }
      var m = base(r, a, q); m.parametre = P_ST; m.ancien = mq; m.nouveau = mq;
      r.lignes[P_ST] = [m]; n++;
    });
    if (!n) ED.pile.pop();
    rendu();
    toast(pluriel(n, "ligne") + " statut ajoutée" + (n > 1 ? "s" : "") + " avec le statut de la maquette" +
      (inconnus ? " · " + inconnus + " sans statut maquette connu : choisis le statut et « Poser le statut »" : "") + ".", inconnus ? 6000 : 2800);
  }

  // ------------------------------------------------------------------ filtres
  function stjCle(r) { var v = nouveau(r.lignes, P_ST); return v === null ? "aucune" : classeSt(v); }
  function stmCle(r) { var v = maquette(r, P_ST); return v === null ? "inconnu" : classeSt(v); }
  var LIGNES = [
    ["sans-statut", "Sans ligne statut", function (r) { return !active(r.lignes, P_ST); }],
    ["avec-date", "Avec ligne date", function (r) { return !!active(r.lignes, P_DATE); }],
    ["avec-com", "Avec ligne commentaire", function (r) { return !!active(r.lignes, P_COM); }],
    ["date-gardee", "Date initiale gardée", function (r) { var mq = maquette(r, P_DATE), n = nouveau(r.lignes, P_DATE); return n !== null && !!mq && n !== mq; }],
    ["modifiees", "Modifiées", modifiee]
  ];
  var ST_J = [["valide", "VALIDE"], ["revoir", "A REVOIR"], ["refuse", "REFUSE"], ["attente", "(vide)"], ["aucune", GARDE]];
  var ST_M = [["valide", "VALIDE"], ["revoir", "A REVOIR"], ["refuse", "REFUSE"], ["attente", "(vide)"], ["inconnu", "Inconnu (?)"]];

  function passe(r, sauf) {
    if (sauf !== "stj" && FILT.stj && stjCle(r) !== FILT.stj) return false;
    if (sauf !== "stm" && FILT.stm && stmCle(r) !== FILT.stm) return false;
    if (sauf !== "lignes" && FILT.lignes) { var f = LIGNES.filter(function (l) { return l[0] === FILT.lignes; })[0]; if (f && !f[2](r)) return false; }
    if (sauf !== "niveau" && FILT.niveau && r.niveau !== FILT.niveau) return false;
    if (sauf !== "famille" && FILT.famille && r.famille !== FILT.famille) return false;
    var q = plie(norm($("#recherche").value));
    if (q) {
      var ou = $("#dans").value, champs;
      if (ou === "cmq") champs = [txtMq(r, P_COM)];
      else if (ou === "cjs") champs = [nouveau(r.lignes, P_COM) || ""];
      else if (ou === "id") champs = [r.num, r.id, r.cle, r.uid];
      else champs = [r.num, r.id, r.cle, r.famille, r.niveau, txtMq(r, P_ST), txtMq(r, P_DATE), txtMq(r, P_COM)]
        .concat(PARAMS.map(function (p) { return nouveau(r.lignes, p) || ""; }), [par(r)]);
      if (!champs.some(function (c) { return plie(c).indexOf(q) >= 0; })) return false;
    }
    return true;
  }
  function bouton(g, val, lib, n, actif, pt) {
    return '<button type="button" class="zone" data-g="' + g + '" data-val="' + esc(val) + '" aria-current="' + actif + '">' +
      (pt ? '<span class="pt st-' + pt + '"></span>' : "") + '<span class="nom"><b>' + esc(lib) + "</b></span>" +
      '<span class="n' + (n ? "" : " zero") + '">' + n + "</span></button>";
  }
  function renduFiltres() {
    if (!ED) { $("#filtres").innerHTML = '<div class="filtre-titre">Filtres</div><p class="muet" style="padding:0 14px">Ouvre un fichier.</p>'; $("#pied-zones").textContent = ""; return; }
    var h = "", rs;
    function groupe(titre, g, liste, cle, pt) {
      rs = ED.resas.filter(function (r) { return passe(r, g); });
      var c = {}; rs.forEach(function (r) { var v = cle(r); c[v] = (c[v] || 0) + 1; });
      h += '<div class="filtre-titre">' + titre + "</div>" + bouton(g, "", "Toutes", rs.length, !FILT[g]);
      liste.forEach(function (s) { if (c[s[0]] || FILT[g] === s[0]) h += bouton(g, s[0], s[1], c[s[0]] || 0, FILT[g] === s[0], pt ? s[0] : ""); });
    }
    groupe("Statut JSON", "stj", ST_J, stjCle, true);
    groupe("Statut maquette", "stm", ST_M, stmCle, true);
    rs = ED.resas.filter(function (r) { return passe(r, "lignes"); });
    h += '<div class="filtre-titre">Lignes</div>' + bouton("lignes", "", "Toutes", rs.length, !FILT.lignes);
    LIGNES.forEach(function (l) { h += bouton("lignes", l[0], l[1], rs.filter(l[2]).length, FILT.lignes === l[0]); });
    groupe("Niveau", "niveau", uniques("niveau").map(function (v) { return [v, nomNiv(v)]; }), function (r) { return r.niveau; });
    groupe("Famille", "famille", uniques("famille").map(function (v) { return [v, v || "—"]; }), function (r) { return r.famille; });
    $("#filtres").innerHTML = h;
    $("#pied-zones").textContent = pluriel(ED.resas.length, "réservation") + " · " + pluriel(lignesFichier(ED).length, "ligne");
  }
  function uniques(ch) { var s = {}; ED.resas.forEach(function (r) { s[r[ch]] = 1; }); return Object.keys(s).sort(cmpTxt); }
  $("#filtres").addEventListener("click", function (e) {
    var b = e.target.closest(".zone"); if (!b) return;
    var g = b.getAttribute("data-g"), v = b.getAttribute("data-val");
    FILT[g] = v ? (FILT[g] === v ? (g === "niveau" || g === "famille" ? "" : null) : v) : (g === "niveau" || g === "famille" ? "" : null);
    rendu();
  });

  // ------------------------------------------------------------------ table
  var COLS = [
    ["id", "Id", function (r) { return r.id; }],
    ["num", "N°", function (r) { return r.num; }],
    ["famille", "Famille", function (r) { return r.famille; }],
    ["niveau", "Niveau", function (r) { return r.niveau; }],
    ["stm", "Statut maquette", function (r) { return txtMq(r, P_ST); }],
    ["stj", "Statut JSON", function (r) { return txtJs(nouveau(r.lignes, P_ST)); }],
    ["dtm", "Date maquette", function (r) { return txtMq(r, P_DATE); }],
    ["dtj", "Date JSON", function (r) { return txtJs(nouveau(r.lignes, P_DATE)); }],
    ["cmm", "Commentaire maquette", function (r) { return txtMq(r, P_COM); }],
    ["cmj", "Commentaire JSON", function (r) { return txtJs(nouveau(r.lignes, P_COM)); }],
    ["par", "Par", par],
    ["rq", "Remarque", remarque]
  ];
  function celluleMq(v) { return v === "?" ? '<span class="inconnu" title="Valeur maquette inconnue : ouvre l\'IFC RES">?</span>' : esc(v); }
  function celluleJs(r, p, cls) {
    var v = nouveau(r.lignes, p), g = genre(r, p);
    var txt = v === null ? '<span class="garde">' + GARDE + "</span>" : (p === P_ST ? pastille(v) : esc(v || "(vide)"));
    var a = nouveau(r.orig, p), titre = g ? ' title="À l\'ouverture : ' + esc(txtJs(a)) + '"' : "";
    return '<td class="js ' + cls + " " + g + '"' + titre + ">" + txt + "</td>";
  }
  function rendu() {
    var tete = $("#tete"), corps = $("#corps"), vide = $("#vide");
    renduFiltres();
    majBoutons();
    if (!ED) { tete.innerHTML = ""; corps.innerHTML = ""; vide.hidden = false; $("#compte").textContent = ""; majMasse(); return; }
    vide.hidden = true;
    AFFICHE = ED.resas.filter(function (r) { return passe(r); });
    if (TRI.col) {
      var c = COLS.filter(function (x) { return x[0] === TRI.col; })[0];
      AFFICHE.sort(function (a, b) { return TRI.sens * cmpTxt(c[2](a), c[2](b)); });
    }
    var tous = AFFICHE.length && AFFICHE.every(function (r) { return SEL.has(r.cle); });
    tete.innerHTML = '<tr><th class="sel"><input type="checkbox" id="tout" title="Cocher / décocher toutes les lignes affichées"' + (tous ? " checked" : "") + "></th>" +
      COLS.map(function (c) { return '<th data-col="' + c[0] + '"' + (TRI.col === c[0] ? ' aria-sort="' + (TRI.sens > 0 ? "ascending" : "descending") + '"' : "") + "><span>" + esc(c[1]) + "</span></th>"; }).join("") + "</tr>";
    var h = [];
    AFFICHE.forEach(function (r) {
      var s = SEL.has(r.cle);
      h.push('<tr data-k="' + esc(r.cle) + '"' + (s ? ' class="choisie"' : "") + ">" +
        '<td class="sel"><input type="checkbox"' + (s ? " checked" : "") + "></td>" +
        '<td class="nw mono">' + esc(r.id) + '</td><td class="nw">' + esc(r.num) + '</td><td class="nw">' + esc(r.famille) + '</td><td class="nw">' + esc(r.niveau) + "</td>" +
        '<td class="nw">' + (txtMq(r, P_ST) === "?" ? celluleMq("?") : pastille(txtMq(r, P_ST))) + "</td>" + celluleJs(r, P_ST, "nw") +
        '<td class="nw">' + celluleMq(txtMq(r, P_DATE)) + "</td>" + celluleJs(r, P_DATE, "nw") +
        '<td class="com">' + celluleMq(txtMq(r, P_COM)) + "</td>" + celluleJs(r, P_COM, "com") +
        '<td class="nw">' + esc(par(r)) + '</td><td class="rq">' + esc(remarque(r)) + "</td></tr>");
    });
    corps.innerHTML = h.join("");
    $("#compte").textContent = AFFICHE.length + " / " + pluriel(ED.resas.length, "réservation") + " · " + ED.resas.filter(modifiee).length + " modifiée(s)" + (estModifie() && !SAUVE ? " · non enregistré" : "");
    majMasse();
  }
  function majMasse() {
    var n = SEL.size, vis = AFFICHE.filter(function (r) { return SEL.has(r.cle); }).length;
    $("#masse").classList.toggle("inactive", !n);
    $("#nsel").textContent = n ? pluriel(n, "réservation") + " cochée" + (n > 1 ? "s" : "") + (vis < n ? " (" + (n - vis) + " masquée" + (n - vis > 1 ? "s" : "") + " par le filtre)" : "") : "Coche une ou plusieurs lignes";
  }
  function majBoutons() {
    $("#btn-annuler").disabled = !ED || !ED.pile.length;
    $("#btn-comparer").disabled = !estModifie();
    $("#btn-enregistrer").disabled = !estModifie();
  }
  $("#corps").addEventListener("click", function (e) {
    var tr = e.target.closest("tr"); if (!tr) return;
    var k = tr.getAttribute("data-k"), i = AFFICHE.findIndex(function (r) { return r.cle === k; });
    if (e.target.tagName !== "INPUT" && !e.target.closest("td.sel") && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // clic simple sur la ligne : elle seule est cochée
      SEL.clear(); SEL.add(k);
    } else if (e.shiftKey && DERNIER !== null) {
      var j = AFFICHE.findIndex(function (r) { return r.cle === DERNIER; });
      if (j < 0) j = i;
      // Maj+clic : toute la plage entre la dernière ligne cliquée et celle-ci est cochée
      for (var x = Math.min(i, j); x <= Math.max(i, j); x++) SEL.add(AFFICHE[x].cle);
    } else {
      if (SEL.has(k)) SEL.delete(k); else SEL.add(k);
    }
    DERNIER = k;
    window.getSelection && window.getSelection().removeAllRanges();
    rendu();
  });
  $("#tete").addEventListener("click", function (e) {
    if (e.target.id === "tout") {
      var on = e.target.checked;
      AFFICHE.forEach(function (r) { if (on) SEL.add(r.cle); else SEL.delete(r.cle); });
      rendu(); return;
    }
    var th = e.target.closest("th[data-col]"); if (!th) return;
    var c = th.getAttribute("data-col");
    if (TRI.col === c) { if (TRI.sens > 0) TRI.sens = -1; else TRI.col = ""; } else { TRI.col = c; TRI.sens = 1; }
    rendu();
  });

  // ------------------------------------------------------------------ ouverture
  function lit(fichier, handle) {
    if (estModifie() && !SAUVE && !window.confirm("Les changements en cours ne sont pas enregistrés. Ouvrir un autre fichier quand même ?")) return;
    fichier.text().then(function (t) {
      var d;
      try { d = JSON.parse(t.replace(/^﻿/, "")); } catch (e) { throw new Error("Ce fichier n'est pas un JSON valide."); }
      if (!d || d.format !== FORMAT) throw new Error("Ce fichier ne vient pas du valideur des réservations FGH (format " + FORMAT + ").");
      if ((+d.version || 0) > FORMAT_VERSION) throw new Error("Fichier écrit par une version plus récente du valideur.");
      if (!Array.isArray(d.modifications)) d.modifications = [];
      ED = construire(fichier.name, d, handle);
      SEL.clear(); DERNIER = null; SAUVE = null;
      var trouvees = IFC ? appliqueIfc() : 0;
      var maq = d.maquette || {};
      $("#info-fic").innerHTML = "<b>" + esc(fichier.name) + "</b> · auteur " + esc(d.auteur || "?") + " · version du fichier " + esc(d.version_fichier || "—") +
        " · IFC du " + esc(maq.export_du || "?") + " depuis « " + esc(maq.nom || "?") + " »" + (IFC ? " · valeurs maquette : " + esc(IFC.nom) + " (" + trouvees + " trouvées)" : " · valeurs maquette : champ « ancien » du JSON");
      if (!$("#m-par").value) $("#m-par").value = lsGet("fgh.jsn.par") || d.auteur || "";
      rendu();
      toast(pluriel(ED.resas.length, "réservation") + " · " + pluriel(d.modifications.length, "ligne") + ".");
    }).catch(function (e) { toast(e.message, 6000); });
  }
  function choisirJson() {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({ types: [{ description: "Validation RES", accept: { "application/json": [".json"] } }] })
        .then(function (h) { return h[0].getFile().then(function (f) { lit(f, h[0]); }); })
        .catch(function (e) { if (e && e.name !== "AbortError") $("#fichier").click(); });
    } else $("#fichier").click();
  }
  $("#btn-ouvrir").addEventListener("click", choisirJson);
  $("#btn-ouvrir2").addEventListener("click", choisirJson);
  $("#fichier").addEventListener("change", function () { var f = this.files[0]; this.value = ""; if (f) lit(f, null); });

  // glisser-déposer : JSON ou IFC
  document.addEventListener("dragover", function (e) { e.preventDefault(); document.body.classList.add("glisse"); });
  document.addEventListener("dragleave", function (e) { if (!e.relatedTarget) document.body.classList.remove("glisse"); });
  document.addEventListener("drop", function (e) {
    e.preventDefault(); document.body.classList.remove("glisse");
    var f = e.dataTransfer.files[0]; if (!f) return;
    if (/\.ifc$/i.test(f.name)) litIfc(f); else lit(f, null);
  });

  // ------------------------------------------------------------------ IFC RES (valeurs de la maquette)
  // Le jeu STR_FGH_RES (lib/fgh_res.py de l'extension) : IFCPROPERTYSINGLEVALUE('<nom>',$,IFCTEXT('<valeur>'),$)
  // regroupés par IFCPROPERTYSET(...,'STR_FGH_RES',$,(#a,#b,…)). On lit seulement ces lignes, sans géométrie.
  function decodeStep(s) {
    s = s.replace(/''/g, "'");
    s = s.replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, function (t, h) {
      var o = ""; for (var i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o;
    });
    s = s.replace(/\\X\\([0-9A-Fa-f]{2})/g, function (t, h) { return String.fromCharCode(parseInt(h, 16)); });
    return s.replace(/\\\\/g, "\\");
  }
  var NOMS_IFC = { "Cle ADN": "cle", "Revit UniqueId": "uid" };
  NOMS_IFC[P_ST] = P_ST; NOMS_IFC[P_DATE] = P_DATE; NOMS_IFC[P_COM] = P_COM;
  function litIfc(f) {
    occupe(true, "Lecture de l'IFC…");
    f.arrayBuffer().then(function (buf) {
      var txt = new TextDecoder("latin1").decode(buf);
      var props = new Map(), m;
      var rxP = /#(\d+)\s*=\s*IFCPROPERTYSINGLEVALUE\s*\(\s*'((?:[^']|'')*)'\s*,[^,]*,\s*IFC[A-Z]+\s*\(\s*'((?:[^']|'')*)'\s*\)/g;
      while ((m = rxP.exec(txt))) { var n = decodeStep(m[2]); if (NOMS_IFC[n]) props.set(m[1], [NOMS_IFC[n], decodeStep(m[3])]); }
      var rxS = /IFCPROPERTYSET\s*\(\s*'[^']*'\s*,[^,]*,\s*'STR_FGH_RES'\s*,[^,]*,\s*\(([^)]*)\)\s*\)/g;
      var map = { cle: new Map(), uid: new Map() }, nb = 0;
      while ((m = rxS.exec(txt))) {
        var v = {};
        m[1].split(",").forEach(function (id) { var x = props.get(id.trim().replace("#", "")); if (x) v[x[0]] = x[1]; });
        if (!v.cle && !v.uid) continue;
        nb++;
        PARAMS.forEach(function (p) { if (v[p] === undefined) v[p] = ""; });
        if (v.cle) { var l = map.cle.get(v.cle) || []; l.push(v); map.cle.set(v.cle, l); }
        if (v.uid) map.uid.set(v.uid, v);
      }
      if (!nb) throw new Error("Aucune réservation avec le jeu STR_FGH_RES dans cet IFC : prends le fichier « …_RES.ifc » écrit par « Export IFC RES ».");
      IFC = { map: map, nom: f.name };
      if (!ED) { toast("IFC RES lu (" + pluriel(nb, "réservation") + ") : ouvre maintenant le fichier JSON.", 5000); return; }
      var t = appliqueIfc();
      rendu();
      $("#info-fic").innerHTML = $("#info-fic").innerHTML.replace(/ · valeurs maquette : .*$/, "") + " · valeurs maquette : " + esc(f.name) + " (" + t + " trouvées)";
      toast("IFC RES : " + t + " / " + pluriel(ED.resas.length, "réservation") + " retrouvée" + (t > 1 ? "s" : "") + ".", 4000);
    }).catch(function (e) { toast(e.message, 6000); }).then(function () { occupe(false); });
  }
  function appliqueIfc() {
    var t = 0, map = IFC.map;
    ED.resas.forEach(function (r) {
      var c = r.cle.indexOf("uid:") === 0 ? [] : (map.cle.get(r.cle) || []), v = null;
      if (c.length === 1) v = c[0];
      else if (c.length > 1) v = c.filter(function (x) { return x.uid === r.uid; })[0] || null;   // ADN en double : le UniqueId tranche
      else v = map.uid.get(r.uid) || null;
      r.ifc = v ? { } : null;
      if (v) { PARAMS.forEach(function (p) { r.ifc[p] = norm(v[p]); }); t++; }
    });
    return t;
  }
  $("#btn-ifc").addEventListener("click", function () { $("#fichier-ifc").click(); });
  $("#fichier-ifc").addEventListener("change", function () { var f = this.files[0]; this.value = ""; if (f) litIfc(f); });

  // ------------------------------------------------------------------ enregistrement
  function versionSuivante(v) { var m = /^(\d+)(?:\.(\d+))?$/.exec(norm(v)); return m ? m[1] + "." + ((+m[2] || 0) + 1) : "1.1"; }
  function nomSuivant(nom, v) {
    var base = nom.replace(/\.json$/i, ""), rx = /\bV\d+(?:\.\d+)?\b/i;
    return (rx.test(base) ? base.replace(rx, "V" + v) : base + " - V" + v) + ".json";
  }
  function documentFinal() {
    var d = copie(ED.d), v = versionSuivante(d.version_fichier);
    d.version_fichier = v;
    d.modifications = lignesFichier(ED);
    var hist = Array.isArray(d.editions) ? d.editions : [];
    hist.push({ par: auteur(), quand: new Date().toISOString(), outil: "str-bim-tools.com/fgh/jsn " + VERSION, depuis: ED.nom, version_fichier: v });
    d.editions = hist;
    return d;
  }
  function telecharge(blob, nom) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function enregistre() {
    if (!estModifie()) { toast("Aucun changement : rien à enregistrer."); return; }
    var d = documentFinal(), nom = nomSuivant(ED.nom, d.version_fichier);
    var blob = new Blob([JSON.stringify(d, null, 1)], { type: "application/json" });
    var p;
    if (window.showSaveFilePicker) {
      var o = { suggestedName: nom, types: [{ description: "Validation RES", accept: { "application/json": [".json"] } }] };
      if (ED.handle) o.startIn = ED.handle;
      p = window.showSaveFilePicker(o).then(function (h) {
        if (ED.handle && ED.handle.isSameEntry) return ED.handle.isSameEntry(h).then(function (meme) {
          if (meme) throw new Error("Choisis un autre nom : le fichier d'origine reste tel quel pour comparer.");
          return h;
        });
        return h;
      }).then(function (h) {
        return h.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); }).then(function () { return h.name; });
      });
    } else { telecharge(blob, nom); p = Promise.resolve(nom); }
    p.then(function (n) {
      SAUVE = n;
      ED.d.version_fichier = d.version_fichier;   // un second enregistrement propose la version suivante
      rendu();
      toast("Enregistré : " + n + " (" + pluriel(d.modifications.length, "ligne") + ").", 4000);
      ouvreComparaison(n);
    }).catch(function (e) { if (e && e.name !== "AbortError") toast(e.message, 6000); });
  }
  $("#btn-enregistrer").addEventListener("click", enregistre);

  // ------------------------------------------------------------------ comparaison avant / après
  function ecarts() {
    var out = [];
    ED.resas.slice().sort(function (a, b) { return cmpTxt(a.niveau, b.niveau) || cmpTxt(a.famille, b.famille) || cmpTxt(a.num || a.id, b.num || b.id); }).forEach(function (r) {
      var cel = PARAMS.map(function (p) { return { p: p, mq: txtMq(r, p), av: txtJs(nouveau(r.orig, p)), ap: txtJs(nouveau(r.lignes, p)), g: genre(r, p), rempl: nouveau(r.orig, p) !== null && nouveau(r.lignes, p) !== null }; });
      if (cel.some(function (c) { return c.g; })) out.push({ r: r, cel: cel });
    });
    return out;
  }
  var COMP = [];
  function ouvreComparaison(apres) {
    COMP = ecarts();
    $("#fc-sous").textContent = "Avant : " + ED.nom + " · Après : " + (apres || "(pas encore enregistré)") + " · " + pluriel(COMP.length, "réservation") + " modifiée" + (COMP.length > 1 ? "s" : "");
    $("#fc-tete").innerHTML = "<tr><th>Id</th><th>N°</th><th>Famille</th><th>Niveau</th>" +
      PARAMS.map(function (p) { return "<th>" + LIB[p] + " maquette</th><th>" + LIB[p] + " avant</th><th>" + LIB[p] + " après</th>"; }).join("") + "</tr>";
    $("#fc-corps").innerHTML = COMP.map(function (e) {
      var r = e.r;
      return "<tr><td class=\"nw mono\">" + esc(r.id) + "</td><td class=\"nw\">" + esc(r.num) + "</td><td class=\"nw\">" + esc(r.famille) + "</td><td class=\"nw\">" + esc(r.niveau) + "</td>" +
        e.cel.map(function (c) {
          var cls = c.p === P_COM ? "com" : "nw";
          var av = c.g === "chg" && c.rempl ? '<td class="' + cls + ' av-chg"><s>' + esc(c.av) + "</s></td>" : '<td class="' + cls + '">' + esc(c.av) + "</td>";
          return '<td class="' + cls + '">' + celluleMq(c.mq) + "</td>" + av + '<td class="js ' + cls + " " + c.g + '">' + esc(c.ap) + "</td>";
        }).join("") + "</tr>";
    }).join("");
    COMP.apres = apres || "";
    $("#f-comp").hidden = false;
  }
  $("#btn-comparer").addEventListener("click", function () { if (estModifie()) ouvreComparaison(SAUVE); });
  function charge(src) {
    return charge.p || (charge.p = new Promise(function (ok, ko) {
      var s = document.createElement("script"); s.src = src; s.onload = ok;
      s.onerror = function () { charge.p = null; ko(new Error("Bibliothèque Excel introuvable.")); };
      document.head.appendChild(s);
    }));
  }
  $("#fc-xlsx").addEventListener("click", function () {
    if (!COMP.length) return;
    occupe(true, "Export Excel…");
    charge(EXCELJS).then(function () {
      var wb = new window.ExcelJS.Workbook(); wb.creator = "STR BIM Tools · Tony VARIN"; wb.created = new Date();
      var ws = wb.addWorksheet("Changements", { views: [{ state: "frozen", ySplit: 1, xSplit: 4 }] });
      var ent = ["Élément", "N°", "Famille", "Niveau"];
      PARAMS.forEach(function (p) { ent.push(LIB[p] + " maquette", LIB[p] + " avant", LIB[p] + " après"); });
      ws.addRow(ent);
      var VERT = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } }, ORANGE = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDEBD0" } };
      COMP.forEach(function (e) {
        var l = [e.r.id, e.r.num, e.r.famille, e.r.niveau];
        e.cel.forEach(function (c) { l.push(c.mq, c.av, c.ap); });
        var row = ws.addRow(l);
        e.cel.forEach(function (c, i) {
          var col = 5 + i * 3;
          if (c.g === "chg") { row.getCell(col + 2).fill = VERT; row.getCell(col + 2).font = { bold: true }; }
          if (c.g === "ret") row.getCell(col + 2).fill = ORANGE;
          if (c.g === "chg" && c.rempl) row.getCell(col + 1).font = { strike: true, color: { argb: "FFCC0000" } };
        });
      });
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4D7A1C" } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ent.length } };
      ws.columns.forEach(function (c, i) { c.width = i < 4 ? 16 : (i % 3 === 0 ? 40 : 14); });
      var lg = wb.addWorksheet("Légende");
      lg.addRow(["Vert : valeur changée ou ligne ajoutée"]).getCell(1).fill = VERT;
      lg.addRow(["Orange : ligne retirée, la valeur de la maquette est gardée"]).getCell(1).fill = ORANGE;
      lg.addRow(["Rouge barré : valeur remplacée"]).getCell(1).font = { strike: true, color: { argb: "FFCC0000" } };
      lg.addRow([]);
      lg.addRow(["Avant : " + ED.nom]); lg.addRow(["Après : " + (COMP.apres || "(pas encore enregistré)")]);
      lg.addRow(["Éditeur JSON RES v" + VERSION + " · STR BIM Tools · Tony VARIN"]);
      lg.getColumn(1).width = 70;
      return wb.xlsx.writeBuffer().then(function (buf) {
        var base = (COMP.apres || ED.nom).replace(/\.json$/i, "");
        telecharge(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Comparaison " + base + ".xlsx");
      });
    }).catch(function (e) { toast(e.message, 5000); }).then(function () { occupe(false); });
  });

  // ------------------------------------------------------------------ barre des changements, fenêtres, thème
  $("#m-statut-ok").addEventListener("click", poseStatut);
  $("#m-com-ok").addEventListener("click", poseCom);
  $("#m-com").addEventListener("keydown", function (e) { if (e.key === "Enter") poseCom(); });
  document.querySelectorAll("[data-enlever]").forEach(function (b) { b.addEventListener("click", function () { enleve(b.getAttribute("data-enlever")); }); });
  $("#m-manquant").addEventListener("click", ajouteManquant);
  $("#btn-annuler").addEventListener("click", annule);
  $("#recherche").addEventListener("input", function () { rendu(); });
  $("#dans").addEventListener("change", function () { lsSet("fgh.jsn.dans", this.value); rendu(); });
  document.addEventListener("click", function (ev) {
    if (ev.target.closest("[data-ferme]") || ev.target.classList.contains("voile")) { var v = ev.target.closest(".voile"); if (v) v.hidden = true; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") document.querySelectorAll(".voile").forEach(function (v) { v.hidden = true; });
    var champ = /INPUT|TEXTAREA|SELECT/.test((ev.target.tagName || ""));
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !champ) { ev.preventDefault(); annule(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a" && !champ && ED) { ev.preventDefault(); AFFICHE.forEach(function (r) { SEL.add(r.cle); }); rendu(); }
  });
  window.addEventListener("beforeunload", function (e) { if (estModifie() && !SAUVE) { e.preventDefault(); e.returnValue = ""; } });
  $("#btn-zones").addEventListener("click", function () {
    var r = document.documentElement; r.classList.toggle("sans-zones");
    lsSet("fgh.jsn.filtres", r.classList.contains("sans-zones") ? "0" : "1");
  });
  $("#btn-theme").addEventListener("click", function () {
    var r = document.documentElement, c = r.getAttribute("data-theme") === "clair" ? "sombre" : "clair";
    r.setAttribute("data-theme", c); lsSet("fgh.theme", c);
    document.querySelector("meta[name=theme-color]").setAttribute("content", c === "clair" ? "#F4F5F2" : "#1B1D19");
  });
  $("#version").textContent = "v" + VERSION;
  $("#signature").textContent = "Éditeur JSON RES v" + VERSION + " · STR BIM Tools · Tony VARIN";
  var dans = lsGet("fgh.jsn.dans"); if (dans) $("#dans").value = dans;
  $("#m-par").value = lsGet("fgh.jsn.par") || "";
  rendu();
})();
