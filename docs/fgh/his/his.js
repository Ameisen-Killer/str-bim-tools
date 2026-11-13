// /fgh/his/ : historique des réservations du chantier Fairmont (13.11.2026).
// Reprend toutes les décisions écrites par le valideur /fgh/rsv/ dans ses fichiers JSON
// (format STR_FGH_RES_VALIDATION : une entrée par réservation, paramètre, heure et auteur)
// et les range dans la table fgh_res_historique (migration-fgh-res-historique.sql).
// Une décision n'est gardée qu'une fois : clé (réservation, paramètre, heure, auteur).
// Trois vues : Réservations (état actuel et nombre de décisions), Journal (toutes les
// décisions, la plus récente en tête), Fichiers (les JSON importés).
// « JSON consolidé » rend un fichier que le valideur relit : la dernière décision de chaque
// réservation et de chaque paramètre, tous auteurs confondus (la plus récente gagne, comme dans RSV).
(function () {
  "use strict";

  var BASE = { url: "https://hxhjkdfnoygrlbdhjkwc.supabase.co" };
  var T_HIS = "fgh_res_historique", T_FIC = "fgh_res_fichiers";
  var FORMAT = "STR_FGH_RES_VALIDATION";
  var P_ST = "PVA_RES_VAL_Statut", P_DATE = "PVA_RES_VAL_Date", P_COM = "PVA_RES_VAL_Commentaire";
  var PARAMS = [P_ST, P_DATE, P_COM];
  var LIB = {}; LIB[P_ST] = "Statut"; LIB[P_DATE] = "Date"; LIB[P_COM] = "Commentaire";
  var STATUTS = [["VALIDE", "Validée", "valide"], ["REFUSE", "Refusée", "refuse"], ["A REVOIR", "À revoir", "revoir"], ["", "En attente", "attente"]];
  var EXCELJS = "/fgh/pln/vendor/exceljs-4.4.0.min.js?v=1";
  // Niveaux : mêmes codes que /fgh/pln/ (FGH_070 = 070 = SS-2)
  var NIVEAUX = { "000": "Tous niveaux", "050": "SS-4", "060": "SS-3", "070": "SS-2", "080": "SS-1", "090": "Rez inf", "100": "Rez",
    "110": "Étage 1", "120": "Étage 2", "130": "Étage 3", "140": "Étage 4", "150": "Étage 5", "160": "Étage 6", "170": "Étage 7", "180": "Étage 8", "190": "Toiture" };

  var $ = function (s) { return document.querySelector(s); };
  var H = [], FICHIERS = [], RES = [], PAR_K = new Map();
  var VUE = lsGet("fgh.his.vue") || "res", FILT = { statut: null, auteur: "", niveau: "", param: "", div: false }, TRI = {}, AFFICHE = [];

  // ------------------------------------------------------------------ outils
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function plie(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(m, ms) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, ms || 2600); }
  function occupe(on, txt) { $("#occupe").textContent = txt || "Traitement…"; $("#occupe").hidden = !on; }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function horo(iso) { if (!iso) return ""; var d = new Date(iso); if (isNaN(d)) return iso; return deux(d.getDate()) + "." + deux(d.getMonth() + 1) + "." + d.getFullYear() + " " + deux(d.getHours()) + ":" + deux(d.getMinutes()); }
  function pluriel(n, m) { return n + " " + m + (n > 1 ? "s" : ""); }
  function codeNiv(n) { var m = /(\d{3})\s*$/.exec(n || ""); return m ? m[1] : ""; }
  function nomNiv(n) { var c = codeNiv(n); return NIVEAUX[c] ? NIVEAUX[c] : (n || "—"); }
  function classeSt(v) { for (var i = 0; i < STATUTS.length - 1; i++) if (STATUTS[i][0] === v) return STATUTS[i][2]; return "attente"; }
  function libSt(v) { for (var i = 0; i < STATUTS.length - 1; i++) if (STATUTS[i][0] === v) return STATUTS[i][1]; return "En attente"; }
  function pastilleSt(v) { return '<span class="statut st-' + classeSt(v) + '">' + esc(libSt(v)) + "</span>"; }
  function cmpTxt(a, b) { return String(a).localeCompare(String(b), "fr", { numeric: true }); }
  // valeur d'une entrée : une décision annulée (retire) ramène la valeur de la maquette (ancien)
  function valeur(e) { return e ? (e.retire ? e.ancien || "" : e.nouveau || "") : ""; }

  // ------------------------------------------------------------------ base
  function appel(chemin, o) {
    o = o || {};
    var h = {};
    if (o.corps !== undefined) h["Content-Type"] = "application/json";
    if (o.prefer) h.Prefer = o.prefer;
    if (o.plage) h.Range = o.plage;
    return window.FghAcces.fetch(BASE.url + "/rest/v1/" + chemin, { method: o.methode || "GET", headers: h, body: o.corps === undefined ? undefined : JSON.stringify(o.corps) })
      .catch(function (e) { if (e && e.perdue) throw e; throw new Error("Serveur injoignable : vérifie ta connexion, puis réessaie."); })
      .then(function (r) {
        if (r.ok) return r.status === 204 ? null : r.text().then(function (t) { return t ? JSON.parse(t) : null; });
        return r.text().then(function (t) {
          var j = {}; try { j = JSON.parse(t); } catch (e) {}
          var brut = String(j.message || j.error || "") + " " + (j.code || "");
          throw new Error(/PGRST205|42P01|does not exist|could not find the table/i.test(brut)
            ? "Les tables de l'historique n'existent pas encore : exécute migration-fgh-res-historique.sql dans Supabase."
            : /row-level security|permission/i.test(brut) || r.status === 401 || r.status === 403 ? "Opération refusée par la base (accès au chantier requis)."
            : "Base : " + (j.message || "erreur " + r.status) + ".");
        });
      });
  }
  function litTout(table, ordre) {
    var tout = [];
    function page(d) {
      return appel(table + "?select=*&order=" + ordre, { plage: d + "-" + (d + 999) }).then(function (l) {
        tout = tout.concat(l || []);
        return l && l.length === 1000 ? page(d + 1000) : tout;
      });
    }
    return page(0);
  }
  function etat(txt, cls) { var e = $("#etat"); e.className = "etat " + (cls || ""); e.innerHTML = "<span>" + esc(txt) + "</span>"; }

  function recharge() {
    etat("Lecture…");
    return Promise.all([litTout(T_HIS, "quand,k,parametre"), litTout(T_FIC, "importe_le.desc")]).then(function (r) {
      H = r[0]; FICHIERS = r[1];
      calcule();
      etat(pluriel(H.length, "décision"), "ok");
      rendu();
    }).catch(function (e) {
      etat("Erreur", "ko");
      $("#corps").innerHTML = ""; $("#tete").innerHTML = "";
      var v = $("#vide"); v.hidden = false;
      v.innerHTML = "<b>Historique indisponible</b>" + esc(e.message);
    });
  }

  // ------------------------------------------------------------------ calcul
  function calcule() {
    PAR_K = new Map();
    H.forEach(function (e) {
      var r = PAR_K.get(e.k);
      if (!r) PAR_K.set(e.k, r = { k: e.k, ev: [], cur: {}, auteurs: {} });
      // identité : la dernière entrée connue fait foi (n°, famille et niveau peuvent arriver plus tard)
      ["numero", "famille", "niveau", "element_id", "unique_id", "cle"].forEach(function (c) { if (e[c]) r[c] = e[c]; });
      r.ev.push(e);
    });
    RES = [];
    PAR_K.forEach(function (r) {
      r.ev.sort(function (a, b) { return a.quand < b.quand ? -1 : a.quand > b.quand ? 1 : 0; });
      var dernStAuteur = {};
      r.ev.forEach(function (e) {
        r.cur[e.parametre] = e;
        if (e.par) r.auteurs[e.par] = (r.auteurs[e.par] || 0) + 1;
        if (e.parametre === P_ST) dernStAuteur[e.par || "?"] = valeur(e);
      });
      var avis = {}; Object.keys(dernStAuteur).forEach(function (a) { avis[dernStAuteur[a]] = 1; });
      r.diverge = Object.keys(dernStAuteur).length > 1 && Object.keys(avis).length > 1;
      r.statut = valeur(r.cur[P_ST]);
      r.date = valeur(r.cur[P_DATE]);
      r.com = valeur(r.cur[P_COM]);
      r.dern = r.ev[r.ev.length - 1];
      r.nom = r.numero || r.element_id || r.k;
      r.txt = plie([r.nom, r.famille, r.niveau, nomNiv(r.niveau), r.com, Object.keys(r.auteurs).join(" "), r.unique_id].join(" "));
      RES.push(r);
    });
  }

  // ------------------------------------------------------------------ filtres (bandeau)
  function compte(liste, f) { var c = {}; liste.forEach(function (x) { var v = f(x); c[v] = (c[v] || 0) + 1; }); return c; }
  function bouton(groupe, val, libelle, n, actif, pt) {
    return '<button type="button" class="zone" data-g="' + groupe + '" data-val="' + esc(val) + '" aria-current="' + actif + '">' +
      (pt ? '<span class="pt st-' + pt + '"></span>' : "") + '<span class="nom"><b>' + esc(libelle) + "</b></span>" +
      '<span class="n' + (n ? "" : " zero") + '">' + n + "</span></button>";
  }
  function renduFiltres() {
    var h = "";
    if (VUE === "res") {
      var cs = compte(RES, function (r) { return classeSt(r.statut); });
      h += '<div class="filtre-titre">Statut actuel</div>' + bouton("statut", "", "Toutes", RES.length, FILT.statut === null);
      STATUTS.forEach(function (s) { h += bouton("statut", s[2], s[1], cs[s[2]] || 0, FILT.statut === s[2], s[2]); });
      h += bouton("div", "1", "Avis divergents", RES.filter(function (r) { return r.diverge; }).length, FILT.div);
    }
    if (VUE !== "fichiers") {
      var source = VUE === "res" ? null : H, ca = {};
      if (source) ca = compte(source, function (e) { return e.par || "?"; });
      else RES.forEach(function (r) { Object.keys(r.auteurs).forEach(function (a) { ca[a] = (ca[a] || 0) + 1; }); });
      h += '<div class="filtre-titre">Auteur</div>' + bouton("auteur", "", "Tous", source ? H.length : RES.length, !FILT.auteur);
      Object.keys(ca).sort(cmpTxt).forEach(function (a) { h += bouton("auteur", a, a, ca[a], FILT.auteur === a); });
      if (VUE === "journal") {
        var cp = compte(H, function (e) { return e.parametre; });
        h += '<div class="filtre-titre">Paramètre</div>' + bouton("param", "", "Tous", H.length, !FILT.param);
        PARAMS.forEach(function (p) { h += bouton("param", p, LIB[p], cp[p] || 0, FILT.param === p); });
      }
      var cn = VUE === "res" ? compte(RES, function (r) { return r.niveau || ""; }) : compte(H, function (e) { return e.niveau || ""; });
      h += '<div class="filtre-titre">Niveau</div>' + bouton("niveau", "", "Tous", VUE === "res" ? RES.length : H.length, !FILT.niveau);
      Object.keys(cn).sort(cmpTxt).forEach(function (n) { h += bouton("niveau", n || "?", (codeNiv(n) || n || "?") + " · " + nomNiv(n), cn[n], FILT.niveau === (n || "?")); });
    } else {
      h += '<div class="filtre-titre">Fichiers</div><p class="muet" style="padding:0 14px">' + pluriel(FICHIERS.length, "fichier importé") + ".</p>";
    }
    $("#filtres").innerHTML = h;
    $("#pied-zones").textContent = pluriel(RES.length, "réservation") + " · " + pluriel(H.length, "décision") + " · " + pluriel(FICHIERS.length, "fichier");
  }
  $("#filtres").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-g]"); if (!b) return;
    var g = b.getAttribute("data-g"), v = b.getAttribute("data-val");
    if (g === "statut") { FILT.statut = v === "" || FILT.statut === v ? null : v; FILT.div = false; }
    else if (g === "div") FILT.div = !FILT.div;
    else FILT[g] = FILT[g] === v ? "" : v;
    rendu();
  });
  $("#vues").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-v]"); if (!b) return;
    VUE = b.getAttribute("data-v"); lsSet("fgh.his.vue", VUE); rendu();
  });

  // ------------------------------------------------------------------ colonnes des vues
  var COLS = {
    res: [
      { id: "nom", t: "N°", v: function (r) { return r.nom; }, h: function (r) { return '<td class="code"><b>' + esc(r.nom) + "</b>" + (r.diverge ? '<span class="diverge" title="Les auteurs n\'ont pas le même dernier avis">AVIS</span>' : "") + "</td>"; } },
      { id: "niveau", t: "Niveau", v: function (r) { return r.niveau || ""; }, h: function (r) { return '<td class="nw">' + esc(nomNiv(r.niveau)) + "</td>"; } },
      { id: "famille", t: "Famille", m: 1, v: function (r) { return r.famille || ""; }, h: function (r) { return '<td class="nw col-m">' + esc(r.famille || "") + "</td>"; } },
      { id: "statut", t: "Statut", v: function (r) { return libSt(r.statut); }, h: function (r) { return "<td>" + pastilleSt(r.statut) + "</td>"; } },
      { id: "date", t: "Date", m: 1, v: function (r) { var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(r.date); return m ? m[3] + m[2] + m[1] : r.date; }, h: function (r) { return '<td class="nw col-m">' + esc(r.date) + "</td>"; } },
      { id: "com", t: "Commentaire", v: function (r) { return r.com; }, h: function (r) { return '<td class="com">' + esc(r.com) + "</td>"; } },
      { id: "nb", t: "Décisions", m: 1, v: function (r) { return r.ev.length; }, h: function (r) { return '<td class="nb col-m">' + r.ev.length + "</td>"; } },
      { id: "dern", t: "Dernière", v: function (r) { return r.dern.quand; }, h: function (r) { return '<td class="nw">' + esc(horo(r.dern.quand)) + ' <span class="muet">' + esc(r.dern.par) + "</span></td>"; } }
    ],
    journal: [
      { id: "quand", t: "Quand", v: function (e) { return e.quand; }, h: function (e) { return '<td class="nw">' + esc(horo(e.quand)) + "</td>"; } },
      { id: "par", t: "Par", v: function (e) { return e.par; }, h: function (e) { return '<td class="nw">' + esc(e.par || "—") + "</td>"; } },
      { id: "nom", t: "N°", v: function (e) { return nomDe(e); }, h: function (e) { return '<td class="code"><b>' + esc(nomDe(e)) + "</b></td>"; } },
      { id: "niveau", t: "Niveau", m: 1, v: function (e) { return e.niveau || ""; }, h: function (e) { return '<td class="nw col-m">' + esc(nomNiv(e.niveau)) + "</td>"; } },
      { id: "parametre", t: "Paramètre", v: function (e) { return LIB[e.parametre]; }, h: function (e) { return '<td class="nw">' + esc(LIB[e.parametre]) + "</td>"; } },
      { id: "chg", t: "Ancien → nouveau", v: function (e) { return valeur(e); }, h: function (e) { return '<td class="com">' + fleche(e) + "</td>"; } },
      { id: "fichier", t: "Fichier", m: 1, v: function (e) { return e.fichier; }, h: function (e) { return '<td class="col-m muet">' + esc(e.fichier) + "</td>"; } }
    ],
    fichiers: [
      { id: "nom", t: "Fichier", v: function (f) { return f.nom; }, h: function (f) { return "<td><b>" + esc(f.nom) + "</b></td>"; } },
      { id: "auteur", t: "Auteur", v: function (f) { return f.auteur; }, h: function (f) { return '<td class="nw">' + esc(f.auteur) + "</td>"; } },
      { id: "date", t: "Écrit le", v: function (f) { return f.date_fichier; }, h: function (f) { return '<td class="nw">' + esc(horo(f.date_fichier)) + "</td>"; } },
      { id: "maquette", t: "Maquette", m: 1, v: function (f) { return f.maquette; }, h: function (f) { return '<td class="col-m">' + esc(f.maquette) + ' <span class="muet">' + esc(f.export_du) + "</span></td>"; } },
      { id: "version", t: "Valideur", m: 1, v: function (f) { return f.version_page; }, h: function (f) { return '<td class="nw col-m">' + esc(f.version_page) + "</td>"; } },
      { id: "n", t: "Entrées", v: function (f) { return f.nb_entrees; }, h: function (f) { return '<td class="nb">' + f.nb_entrees + "</td>"; } },
      { id: "neuves", t: "Nouvelles", v: function (f) { return f.nb_nouvelles; }, h: function (f) { return '<td class="nb">' + f.nb_nouvelles + "</td>"; } },
      { id: "imp", t: "Importé", v: function (f) { return f.importe_le; }, h: function (f) { return '<td class="nw">' + esc(horo(f.importe_le)) + ' <span class="muet">' + esc(f.importe_par || "") + "</span></td>"; } }
    ]
  };
  var TRI_DEFAUT = { res: { col: "niveau", sens: 1 }, journal: { col: "quand", sens: -1 }, fichiers: { col: "imp", sens: -1 } };
  function nomDe(e) { var r = PAR_K.get(e.k); return (r && r.nom) || e.numero || e.element_id || e.k; }
  function fleche(e) {
    if (e.retire) return '<span class="annule">annulée, retour à « ' + esc(e.ancien || "vide") + " »</span>";
    var a = e.ancien || "", n = e.nouveau || "";
    var fa = e.parametre === P_ST ? (a ? libSt(a) : "—") : a, fn = e.parametre === P_ST ? libSt(n) : (n || "vide");
    return (a ? "<s>" + esc(fa) + "</s><i>→</i>" : "") + "<b>" + esc(fn) + "</b>";
  }

  // ------------------------------------------------------------------ rendu
  function lignes() {
    var q = plie($("#recherche").value.trim()), mots = q ? q.split(/\s+/) : [];
    function ok(txt) { return mots.every(function (m) { return txt.indexOf(m) >= 0; }); }
    if (VUE === "res") return RES.filter(function (r) {
      if (FILT.statut !== null && classeSt(r.statut) !== FILT.statut) return false;
      if (FILT.div && !r.diverge) return false;
      if (FILT.auteur && !r.auteurs[FILT.auteur]) return false;
      if (FILT.niveau && (r.niveau || "?") !== FILT.niveau) return false;
      return !mots.length || ok(r.txt);
    });
    if (VUE === "journal") return H.filter(function (e) {
      if (FILT.auteur && (e.par || "?") !== FILT.auteur) return false;
      if (FILT.param && e.parametre !== FILT.param) return false;
      if (FILT.niveau && (e.niveau || "?") !== FILT.niveau) return false;
      return !mots.length || ok(plie([nomDe(e), e.par, e.niveau, nomNiv(e.niveau), e.famille, LIB[e.parametre], e.ancien, e.nouveau, e.fichier].join(" ")));
    });
    return FICHIERS.filter(function (f) { return !mots.length || ok(plie([f.nom, f.auteur, f.maquette, f.importe_par].join(" "))); });
  }
  function rendu() {
    document.querySelectorAll("#vues button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === VUE)); });
    renduFiltres();
    var cols = COLS[VUE], tri = TRI[VUE] || TRI_DEFAUT[VUE], c = cols.filter(function (x) { return x.id === tri.col; })[0] || cols[0];
    var l = lignes();
    l.sort(function (a, b) {
      var x = c.v(a), y = c.v(b), d = typeof x === "number" ? x - y : cmpTxt(x == null ? "" : x, y == null ? "" : y);
      if (!d && VUE === "res") d = cmpTxt(a.nom, b.nom);
      return d * tri.sens;
    });
    AFFICHE = l;
    $("#tete").innerHTML = "<tr>" + cols.map(function (x) {
      return '<th data-tri="' + x.id + '"' + (x.m ? ' class="col-m"' : "") + (x.id === c.id ? ' aria-sort="' + (tri.sens > 0 ? "ascending" : "descending") + '"' : "") + "><span>" + esc(x.t) + "</span></th>";
    }).join("") + "</tr>";
    $("#corps").innerHTML = l.map(function (x, i) { return '<tr data-i="' + i + '">' + cols.map(function (k) { return k.h(x); }).join("") + "</tr>"; }).join("");
    var tot = VUE === "res" ? RES.length : VUE === "journal" ? H.length : FICHIERS.length;
    $("#compte").textContent = l.length === tot ? String(tot) : l.length + " sur " + tot;
    var v = $("#vide");
    v.hidden = l.length > 0;
    if (!l.length) v.innerHTML = tot ? "<b>Aucun résultat</b>Change la recherche ou les filtres." :
      '<b>Historique vide</b>Importe les fichiers JSON du valideur pour remplir l\'historique.<br><button type="button" class="bt plein" data-import>Importer des JSON</button>';
  }
  $("#tete").addEventListener("click", function (ev) {
    var th = ev.target.closest("th[data-tri]"); if (!th) return;
    var id = th.getAttribute("data-tri"), t = TRI[VUE] || TRI_DEFAUT[VUE];
    TRI[VUE] = { col: id, sens: t.col === id ? -t.sens : 1 };
    rendu();
  });
  var minut;
  $("#recherche").addEventListener("input", function () { clearTimeout(minut); minut = setTimeout(rendu, 150); });

  // ------------------------------------------------------------------ fiche d'une réservation
  var FICHE = null;
  function ouvreFiche(r) {
    FICHE = r;
    $("#fr-titre").textContent = "Réservation " + r.nom;
    $("#fr-sous").textContent = [r.famille, r.niveau ? r.niveau + " (" + nomNiv(r.niveau) + ")" : "", r.unique_id].filter(Boolean).join(" · ");
    var h = '<div class="etat-actuel"><div><span>Statut</span><b>' + pastilleSt(r.statut) + (r.diverge ? '<span class="diverge">AVIS</span>' : "") + "</b></div>" +
      "<div><span>Date de validation</span><b>" + esc(r.date || "—") + "</b></div><div><span>Commentaire</span><b>" + esc(r.com || "—") + "</b></div></div>";
    // une ligne de frise par (heure, auteur) : statut, date et commentaire posés ensemble
    var groupes = [], dern = null;
    r.ev.forEach(function (e) {
      if (!dern || dern.quand !== e.quand || dern.par !== e.par) groupes.push(dern = { quand: e.quand, par: e.par, fichier: e.fichier, l: [] });
      dern.l.push(e);
    });
    h += '<ol class="frise">' + groupes.reverse().map(function (g) {
      var annule = g.l.every(function (e) { return e.retire; });
      return '<li class="' + (annule ? "r" : "") + '"><div class="q"><b>' + esc(horo(g.quand)) + "</b> · " + esc(g.par || "auteur inconnu") + (g.fichier ? " · " + esc(g.fichier) : "") + "</div>" +
        g.l.map(function (e) { return '<div class="l"><span class="p">' + esc(LIB[e.parametre]) + "</span>" + fleche(e) + "</div>"; }).join("") + "</li>";
    }).join("") + "</ol>";
    $("#fr-corps").innerHTML = h;
    $("#f-res").hidden = false;
  }
  $("#fr-copier").addEventListener("click", function () {
    if (!FICHE) return;
    navigator.clipboard.writeText(FICHE.nom).then(function () { toast("N° copié : " + FICHE.nom); }, function () { toast("Copie impossible."); });
  });
  $("#corps").addEventListener("click", function (ev) {
    var tr = ev.target.closest("tr[data-i]"); if (!tr) return;
    var x = AFFICHE[+tr.getAttribute("data-i")];
    if (VUE === "res") ouvreFiche(x);
    else if (VUE === "journal") { var r = PAR_K.get(x.k); if (r) ouvreFiche(r); }
    else { VUE = "journal"; $("#recherche").value = x.nom; rendu(); }
  });
  document.addEventListener("click", function (ev) {
    if (ev.target.closest("[data-ferme]") || ev.target.classList.contains("voile")) { var v = ev.target.closest(".voile"); if (v) v.hidden = true; }
    if (ev.target.closest("[data-import]")) ouvreImport();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") document.querySelectorAll(".voile").forEach(function (v) { v.hidden = true; });
  });

  // ------------------------------------------------------------------ import
  function ouvreImport() { $("#fi-bilan").innerHTML = ""; $("#f-import").hidden = false; }
  $("#btn-import").addEventListener("click", ouvreImport);
  $("#fi-depot").addEventListener("click", function () { $("#fichier").click(); });
  $("#fichier").addEventListener("change", function () { var f = Array.from(this.files || []); this.value = ""; if (f.length) importe(f); });
  ["dragenter", "dragover"].forEach(function (t) {
    document.addEventListener(t, function (ev) { if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf("Files") >= 0) { ev.preventDefault(); document.body.classList.add("glisse"); } });
  });
  document.addEventListener("dragleave", function (ev) { if (!ev.relatedTarget) document.body.classList.remove("glisse"); });
  document.addEventListener("drop", function (ev) {
    document.body.classList.remove("glisse");
    if (!ev.dataTransfer || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    if ($("#f-import").hidden) ouvreImport();
    importe(Array.from(ev.dataTransfer.files));
  });
  function litFichier(f) {
    return new Promise(function (ok, ko) { var l = new FileReader(); l.onload = function () { ok(String(l.result)); }; l.onerror = function () { ko(new Error("lecture impossible")); }; l.readAsText(f, "utf-8"); });
  }
  function court(s, n) { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n) : s; }
  function entrees(d, nom) {
    var vu = new Map();
    (d.modifications || []).forEach(function (x) {
      if (!x || PARAMS.indexOf(x.parametre) < 0) return;
      var k = x.cle || (x.unique_id ? "uid:" + x.unique_id : ""); if (!k) return;
      var e = { k: court(k, 300), parametre: x.parametre, quand: court(x.quand || "", 40), par: court(x.par || "", 100),
        cle: court(x.cle, 300), unique_id: court(x.unique_id, 100), element_id: court(x.element_id, 40), numero: court(x.numero, 60),
        famille: court(x.famille, 200), niveau: court(x.niveau, 60), ancien: court(x.ancien, 4000), nouveau: court(x.nouveau, 4000),
        retire: !!x.retire, fichier: court(nom, 255) };
      vu.set([e.k, e.parametre, e.quand, e.par].join("|"), e);
    });
    return Array.from(vu.values());
  }
  function envoie(lignes) {
    var neuves = 0, i = 0;
    function suite() {
      if (i >= lignes.length) return Promise.resolve(neuves);
      var lot = lignes.slice(i, i + 500); i += 500;
      // ignore-duplicates : une décision déjà connue n'est ni réécrite ni comptée
      return appel(T_HIS + "?on_conflict=k,parametre,quand,par", { methode: "POST", corps: lot, prefer: "resolution=ignore-duplicates,return=representation" })
        .then(function (r) { neuves += (r || []).length; return suite(); });
    }
    return suite();
  }
  function importe(liste) {
    var bilan = $("#fi-bilan"), total = 0;
    bilan.innerHTML = "";
    occupe(true, "Import…");
    var p = Promise.resolve();
    liste.forEach(function (f) {
      p = p.then(function () { return litFichier(f); }).then(function (txt) {
        var d; try { d = JSON.parse(txt); } catch (e) { throw new Error("ce n'est pas du JSON"); }
        if (!d || d.format !== FORMAT) throw new Error("ce n'est pas un fichier du valideur des réservations");
        var l = entrees(d, f.name);
        return envoie(l).then(function (n) {
          total += n;
          var m = d.maquette || {};
          return appel(T_FIC, { methode: "POST", prefer: "return=minimal", corps: { nom: court(f.name, 255), auteur: court(d.auteur, 100), date_fichier: court(d.date, 40),
            version_page: court(d.version_page, 20), maquette: court(m.nom, 200), export_du: court(m.export_du, 40), nb_entrees: l.length, nb_nouvelles: n } })
            .then(function () { return "<div>✓ <b>" + esc(f.name) + "</b> : " + pluriel(l.length, "entrée") + ", dont " + n + " nouvelle" + (n > 1 ? "s" : "") + ".</div>"; });
        });
      }).catch(function (e) {
        if (e && e.perdue) throw e;
        return '<div class="alerte">' + esc(f.name) + " : " + esc(e.message) + "</div>";
      }).then(function (h) { bilan.insertAdjacentHTML("beforeend", h); });
    });
    p.then(function () { return recharge(); }).then(function () {
      toast(pluriel(total, "décision") + " ajoutée" + (total > 1 ? "s" : "") + " à l'historique.", 4000);
    }).catch(function (e) { toast(e.message, 5000); }).then(function () { occupe(false); });
  }

  // ------------------------------------------------------------------ exports
  function enregistre(blob, nom) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function jour() { var d = new Date(); return d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate()); }
  // Même forme que docModifs() de /fgh/rsv/fgh-app.js : le valideur relit ce fichier tel quel
  $("#btn-json").addEventListener("click", function () {
    if (!RES.length) { toast("Historique vide."); return; }
    var out = [];
    RES.slice().sort(function (a, b) { return cmpTxt(a.niveau || "", b.niveau || "") || cmpTxt(a.nom, b.nom); }).forEach(function (r) {
      PARAMS.forEach(function (p) {
        var x = r.cur[p]; if (!x) return;
        var e = { cle: r.cle || "", unique_id: r.unique_id || "", element_id: r.element_id || "", numero: r.numero || "", famille: r.famille || "", niveau: r.niveau || "",
          parametre: p, ancien: x.ancien, nouveau: x.nouveau, par: x.par || "", quand: x.quand || "" };
        if (x.retire) e.retire = true;
        out.push(e);
      });
    });
    var f = FICHIERS.slice().sort(function (a, b) { return cmpTxt(b.date_fichier, a.date_fichier); })[0] || {};
    var doc = { format: FORMAT, version: 1, outil: "str-bim-tools.com/fgh", version_page: "historique", date: new Date().toISOString(), auteur: "Historique consolidé",
      maquette: { nom: f.maquette || "", export_du: f.export_du || "" }, modifications: out };
    enregistre(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }), "FGH_Validation_RES_historique_" + jour() + ".json");
    toast(pluriel(out.length, "entrée") + " exportée" + (out.length > 1 ? "s" : "") + " (" + pluriel(RES.length, "réservation") + ").");
  });
  function charge(src) {
    return charge.p || (charge.p = new Promise(function (ok, ko) {
      var s = document.createElement("script"); s.src = src; s.onload = ok;
      s.onerror = function () { charge.p = null; ko(new Error("Bibliothèque Excel introuvable.")); };
      document.head.appendChild(s);
    }));
  }
  $("#btn-xlsx").addEventListener("click", function () {
    if (!AFFICHE.length) { toast("Rien à exporter."); return; }
    occupe(true, "Export Excel…");
    charge(EXCELJS).then(function () {
      var wb = new window.ExcelJS.Workbook(); wb.creator = "AB Ingénieurs"; wb.created = new Date();
      var ws, nom = { res: "Réservations", journal: "Journal", fichiers: "Fichiers" }[VUE];
      ws = wb.addWorksheet(nom, { views: [{ state: "frozen", ySplit: 1 }] });
      var ent, ligne;
      if (VUE === "res") {
        ent = ["N°", "Niveau", "Famille", "Statut", "Date", "Commentaire", "Décisions", "Auteurs", "Dernière décision", "Par", "Avis divergents", "UniqueId"];
        ligne = function (r) { return [r.nom, r.niveau, r.famille, libSt(r.statut), r.date, r.com, r.ev.length, Object.keys(r.auteurs).join(", "), horo(r.dern.quand), r.dern.par, r.diverge ? "oui" : "", r.unique_id]; };
      } else if (VUE === "journal") {
        ent = ["Quand", "Par", "N°", "Niveau", "Paramètre", "Ancien", "Nouveau", "Annulée", "Fichier"];
        ligne = function (e) { return [horo(e.quand), e.par, nomDe(e), e.niveau, LIB[e.parametre], e.ancien, e.nouveau, e.retire ? "oui" : "", e.fichier]; };
      } else {
        ent = ["Fichier", "Auteur", "Écrit le", "Maquette", "Export du", "Valideur", "Entrées", "Nouvelles", "Importé le", "Par"];
        ligne = function (f) { return [f.nom, f.auteur, horo(f.date_fichier), f.maquette, f.export_du, f.version_page, f.nb_entrees, f.nb_nouvelles, horo(f.importe_le), f.importe_par]; };
      }
      ws.addRow(ent);
      AFFICHE.forEach(function (x) { ws.addRow(ligne(x)); });
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4D7A1C" } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ent.length } };
      ws.columns.forEach(function (c, i) { var m = ent[i].length; AFFICHE.slice(0, 400).forEach(function (x) { m = Math.max(m, String(ligne(x)[i] == null ? "" : ligne(x)[i]).length); }); c.width = Math.min(60, m + 2); });
      return wb.xlsx.writeBuffer().then(function (buf) {
        enregistre(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "FGH_Historique_RES_" + nom + "_" + jour() + ".xlsx");
      });
    }).catch(function (e) { toast(e.message, 5000); }).then(function () { occupe(false); });
  });

  // ------------------------------------------------------------------ bandeau, thème, démarrage
  $("#btn-zones").addEventListener("click", function () {
    var r = document.documentElement; r.classList.toggle("sans-zones");
    lsSet("fgh.his.filtres", r.classList.contains("sans-zones") ? "0" : "1");
  });
  $("#btn-theme").addEventListener("click", function () {
    var r = document.documentElement, c = r.getAttribute("data-theme") === "clair" ? "sombre" : "clair";
    r.setAttribute("data-theme", c); lsSet("fgh.theme", c);
    document.querySelector("meta[name=theme-color]").setAttribute("content", c === "clair" ? "#F4F5F2" : "#1B1D19");
  });
  if (["res", "journal", "fichiers"].indexOf(VUE) < 0) VUE = "res";
  recharge();
})();
