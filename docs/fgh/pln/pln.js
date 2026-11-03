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
  var CHAMPS = ["projet", "discipline", "emetteur", "phase", "type", "niveau", "zone", "numero", "indice", "titre", "date_indice", "auteur", "statut", "remarque"];

  var $ = function (s) { return document.querySelector(s); };
  var PLANS = [], ZONE = "", NIVEAU = "", TYPESEL = {}, TRI = { col: "code", sens: 1 }, VUE = [], EDITE = null;

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
  function zonesInfos() {
    var z = {};
    PLANS.forEach(function (p) {
      var k = p.zone || "?"; z[k] = z[k] || { n: 0, noyaux: {}, niv: {} };
      z[k].n++; z[k].niv[p.niveau] = (z[k].niv[p.niveau] || 0) + 1;
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
  function dessineZones() {
    var Z = zonesInfos(), cles = Object.keys(Z).sort(function (a, b) { return (a === "TTZ") - (b === "TTZ") || a.localeCompare(b); });
    var h = '<button type="button" class="zone" data-z="" aria-current="' + (!ZONE) + '"><span class="nom"><b>Toutes les zones</b></span><span class="n">' + PLANS.length + "</span></button><div class=\"sep-zones\"></div>";
    cles.forEach(function (k) {
      var i = Z[k], st = sousTitreZone(k, i), ici = ZONE === k;
      h += '<button type="button" class="zone" data-z="' + esc(k) + '" aria-current="' + (ici && !NIVEAU) + '"><span class="nom"><b>Zone ' + esc(k) + "</b>" + (st ? "<small>" + esc(st) + "</small>" : "") + '</span><span class="n">' + i.n + "</span></button>";
      if (ici) {
        h += '<div class="niveaux">' + Object.keys(i.niv).sort().map(function (nv) {
          return '<button type="button" class="zone" data-z="' + esc(k) + '" data-n="' + esc(nv) + '" aria-current="' + (NIVEAU === nv) + '"><span class="nom">' + esc(niveauNom(nv)) + ' <small style="display:inline">' + esc(nv) + '</small></span><span class="n">' + i.niv[nv] + "</span></button>";
        }).join("") + "</div>";
      }
    });
    $("#liste-zones").innerHTML = h;
    var manuels = PLANS.filter(function (p) { return p.source === "manuel"; }).length;
    $("#pied-zones").textContent = PLANS.length + " plans" + (manuels ? " · " + manuels + " créés à la main" : "");
  }
  $("#liste-zones").addEventListener("click", function (e) {
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
  if (matchMedia("(max-width:760px)").matches) document.documentElement.classList.add("sans-zones");

  // ------------------------------------------------------------------ liste
  function filtres() {
    var mots = plie($("#recherche").value).split(/\s+/).filter(Boolean), types = Object.keys(TYPESEL);
    return PLANS.filter(function (p) {
      if (ZONE && p.zone !== ZONE) return false;
      if (NIVEAU && p.niveau !== NIVEAU) return false;
      if (types.length && !TYPESEL[p.type]) return false;
      if (!mots.length) return true;
      var t = plie([code(p), p.titre, p.indice, p.auteur, p.statut, p.remarque, niveauNom(p.niveau), TYPES[p.type]].join(" "));
      return mots.every(function (m) { return t.indexOf(m) >= 0; });
    });
  }
  function trie(l) {
    var c = TRI.col, s = TRI.sens;
    var v = c === "code" ? function (p) { return code(p); } : c === "date" ? function (p) { return p.date_indice || ""; } : function (p) { return p[c] || ""; };
    return l.sort(function (a, b) {
      var r = c === "indice" ? cmpInd(a.indice, b.indice) : String(v(a)).localeCompare(String(v(b)), "fr", { numeric: true });
      return r * s || code(a).localeCompare(code(b));
    });
  }
  function dessineTypes() {
    var base = PLANS.filter(function (p) { return (!ZONE || p.zone === ZONE) && (!NIVEAU || p.niveau === NIVEAU); }), c = {};
    base.forEach(function (p) { c[p.type] = (c[p.type] || 0) + 1; });
    $("#types").innerHTML = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (t) {
      return '<button type="button" data-t="' + esc(t) + '" aria-pressed="' + !!TYPESEL[t] + '" title="' + esc(TYPES[t] || t) + '">' + esc(t) + "<i>" + c[t] + "</i></button>";
    }).join("");
  }
  $("#types").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var t = b.dataset.t; if (TYPESEL[t]) delete TYPESEL[t]; else TYPESEL[t] = 1;
    dessine();
  });
  function videMessage(m) {
    $("#corps").innerHTML = ""; var v = $("#vide"); v.hidden = false;
    v.innerHTML = "<b>" + esc(m) + "</b>";
  }
  function dessineListe() {
    VUE = trie(filtres());
    $("#compte").textContent = VUE.length + " / " + PLANS.length + " plans";
    document.querySelectorAll("thead th").forEach(function (th) {
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
    for (var i = 0; i < VUE.length; i++) {
      var p = VUE[i];
      h.push('<tr data-i="' + i + '"' + (EDITE && EDITE.id === p.id ? ' class="choisie"' : "") + '><td class="code">' + esc([p.projet, p.discipline, p.emetteur, p.phase].join("-")) + "-<b>" + esc([p.type, p.niveau, p.zone, p.numero].join("-")) + "</b></td>" +
        '<td class="ind">' + esc(p.indice) + '</td><td class="titre">' + esc(p.titre || "—") + "<small>" + esc((TYPES[p.type] || p.type) + " · " + niveauNom(p.niveau) + " · zone " + p.zone) + (p.remarque ? " · " + esc(p.remarque.slice(0, 80)) : "") + "</small></td>" +
        '<td class="nw col-m">' + esc(dateFr(p.date_indice)) + '</td><td class="nw col-m">' + esc(p.auteur) + '</td><td class="col-m">' + (p.statut ? '<span class="pastille">' + esc(p.statut) + "</span> " : "") + (p.source === "manuel" ? '<span class="pastille manuel" title="Créé à la main dans cet outil">manuel</span>' : "") + "</td></tr>");
    }
    $("#corps").innerHTML = h.join("");
  }
  function dessine() { dessineZones(); dessineTypes(); dessineListe(); listes(); }
  $("#corps").addEventListener("click", function (e) { var tr = e.target.closest("tr"); if (tr) ouvre(VUE[+tr.dataset.i]); });
  document.querySelector("thead").addEventListener("click", function (e) {
    var th = e.target.closest("th"); if (!th) return;
    TRI = { col: th.dataset.tri, sens: TRI.col === th.dataset.tri ? -TRI.sens : 1 }; dessineListe();
  });
  $("#recherche").addEventListener("input", function () { clearTimeout(dessineListe.t); dessineListe.t = setTimeout(dessineListe, 120); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("#recherche").focus(); }
    if (e.key === "Escape") { if (!$("#f-plan").hidden) ferme("#f-plan"); else if (!$("#f-import").hidden) ferme("#f-import"); }
  });
  function listes() {
    function remplit(id, vals, lib) { $(id).innerHTML = vals.map(function (v) { return '<option value="' + esc(v) + '">' + (lib ? esc(lib(v)) : ""); }).join(""); }
    function uniques(k) { var o = {}; PLANS.forEach(function (p) { if (p[k]) o[p[k]] = 1; }); return Object.keys(o).sort(); }
    remplit("#dl-types", uniques("type").concat(Object.keys(TYPES)).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(), function (t) { return TYPES[t] || ""; });
    remplit("#dl-niveaux", uniques("niveau").concat(Object.keys(NIVEAUX)).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(), niveauNom);
    remplit("#dl-zones", uniques("zone"));
    remplit("#dl-auteurs", uniques("auteur"));
  }

  // ------------------------------------------------------------------ fiche
  var F = $("#form-plan");
  function ferme(s) { $(s).hidden = true; if (s === "#f-plan") { EDITE = null; dessineListe(); } }
  document.querySelectorAll("[data-ferme]").forEach(function (b) { b.addEventListener("click", function () { ferme("#" + b.closest(".voile").id); }); });
  document.querySelectorAll(".voile").forEach(function (v) { v.addEventListener("mousedown", function (e) { if (e.target === v) ferme("#" + v.id); }); });
  function ouvre(p) {
    EDITE = p || null;
    var d = p || { projet: "FGH", discipline: "STR", emetteur: "ABI", phase: "51", type: Object.keys(TYPESEL)[0] || "PLA", niveau: NIVEAU || "", zone: ZONE || "", numero: "", indice: "00", titre: "", date_indice: aujourdhui(), auteur: lsGet("fgh.nom") || "", statut: "", remarque: "" };
    CHAMPS.forEach(function (k) { F.elements[k].value = d[k] == null ? "" : d[k]; });
    $("#fp-titre").textContent = p ? "Modifier le plan" : "Nouveau plan";
    $("#fp-suppr").hidden = !p; $("#fp-indice").hidden = !p;
    $("#fp-trace").textContent = p ? "Créé le " + horo(p.cree_le) + " · modifié le " + horo(p.modifie_le) + (p.modifie_par ? " par " + p.modifie_par : "") + (p.source === "kairnial" ? " · importé de Kairnial" : " · créé à la main") : "";
    majCode(); $("#f-plan").hidden = false; dessineListe();
    setTimeout(function () { F.elements[p ? "titre" : "type"].focus(); }, 30);
  }
  function lit() {
    var o = {};
    CHAMPS.forEach(function (k) { o[k] = String(F.elements[k].value || "").trim(); });
    ["projet", "discipline", "emetteur", "phase", "type", "zone"].forEach(function (k) { o[k] = o[k].toUpperCase(); });
    o.date_indice = o.date_indice || null;
    return o;
  }
  function majCode() {
    var o = lit(); $("#fp-code").textContent = code(o) + (o.indice ? " · ind. " + o.indice : "");
    var doublon = PLANS.filter(function (p) { return cle(p) === cle(o) && (!EDITE || p.id !== EDITE.id); })[0];
    var a = $("#fp-alerte");
    a.hidden = !doublon || !o.numero;
    if (doublon) a.textContent = "Ce code existe déjà : « " + (doublon.titre || "sans titre") + " », ind. " + doublon.indice + ". Vérifie le numéro.";
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
      toast(EDITE ? "Plan enregistré" : "Plan créé : " + code(r));
      $("#f-plan").hidden = true; EDITE = null; dessine();
    }).catch(function (err) { toast(err.message, 5000); }).then(function () { b.disabled = false; });
  });
  $("#fp-suppr").addEventListener("click", function () {
    if (!EDITE || !confirm("Supprimer le plan " + code(EDITE) + " ind. " + EDITE.indice + " de la liste ?\nCette suppression vaut pour tout le monde.")) return;
    var p = EDITE;
    appel(TABLE + "?id=eq." + encodeURIComponent(p.id), { methode: "DELETE" }).then(function () {
      PLANS = PLANS.filter(function (x) { return x !== p; }); $("#f-plan").hidden = true; EDITE = null; dessine(); toast("Plan supprimé");
    }).catch(function (err) { toast(err.message, 5000); });
  });
  $("#fp-indice").addEventListener("click", function () {
    var i = F.elements.indice, n = numInd(i.value);
    i.value = n < 0 ? "00" : (n + 1 < 10 ? "0" : "") + (n + 1);
    F.elements.date_indice.value = aujourdhui();
    if (lsGet("fgh.nom")) F.elements.auteur.value = lsGet("fgh.nom");
    majCode(); toast("Indice " + i.value + " : vérifie puis enregistre");
  });
  $("#btn-nouveau").addEventListener("click", function () { ouvre(null); });
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
        var k = cle(p), d = garde[k];
        if (!d || cmpInd(p.indice, d.indice) > 0 || (cmpInd(p.indice, d.indice) === 0 && (p.date_indice || "") > (d.date_indice || ""))) garde[k] = p;
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
      var parCle = {}; PLANS.forEach(function (p) { parCle[cle(p)] = p; });
      var nouveaux = [], majs = [], egaux = 0, enAvance = 0;
      keys.forEach(function (k) {
        var n = R.plans[k], a = parCle[k];
        if (!a) { nouveaux.push(Object.assign({ source: "kairnial", statut: "", remarque: "" }, n)); return; }
        var c = cmpInd(n.indice, a.indice);
        if (c > 0 || (c === 0 && (n.titre !== a.titre || (n.date_indice || null) !== (a.date_indice || null)))) {
          majs.push({ avant: a, apres: Object.assign({}, a, { indice: n.indice, titre: n.titre, date_indice: n.date_indice, auteur: n.auteur || a.auteur }) });
        } else if (c < 0) enAvance++; else egaux++;
      });
      var absents = PLANS.filter(function (p) { return !R.plans[cle(p)]; }).length;
      IMPORT = { nouveaux: nouveaux, majs: majs };
      $("#fi-fichier").textContent = f.name + " · " + R.lignes + " lignes lues, " + keys.length + " plans au dernier indice";
      $("#fi-bilan").innerHTML = [[nouveaux.length, "nouveaux plans"], [majs.length, "mis à jour"], [egaux, "déjà à jour"], [absents + enAvance, "gardés tels quels"]]
        .map(function (x) { return "<div><b>" + x[0] + "</b><span>" + x[1] + "</span></div>"; }).join("");
      var det = majs.slice(0, 200).map(function (m) { return "<div>" + esc(code(m.avant)) + " : ind. " + esc(m.avant.indice) + " → <em>" + esc(m.apres.indice) + "</em></div>"; }).join("");
      $("#fi-detail").innerHTML = (majs.length ? '<p class="muet">Indices qui avancent :</p><div class="detail">' + det + (majs.length > 200 ? "<div>… et " + (majs.length - 200) + " autres</div>" : "") + "</div>" : "") +
        (absents + enAvance ? '<p class="muet">' + absents + " plan(s) de la liste absents de l'export" + (enAvance ? ", " + enAvance + " avec un indice plus avancé que Kairnial" : "") + " : rien n'y est changé.</p>" : "");
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
      $("#f-import").hidden = true; toast(N.length + " plans ajoutés, " + M.length + " mis à jour", 4000); IMPORT = null; return recharge(true);
    }).catch(function (e) { toast(e.message + (fait ? " (" + fait + " déjà enregistrés)" : ""), 6000); recharge(true); }).then(function () { occupe(false); });
  });

  // ------------------------------------------------------------------ exports
  function libelleVue() {
    var b = [];
    if (ZONE) b.push("Zone " + ZONE + (NIVEAU ? " · " + niveauNom(NIVEAU) : ""));
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
  function logo() {
    return logo.p || (logo.p = fetch("/fgh/logo-ab.jpg?v=1").then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok(fr.result); }; fr.readAsDataURL(b); });
    }));
  }
  var BUREAUX = [["LAUSANNE", "021 614 20 00"], ["GENEVE", "022 349 80 88"], ["NYON", "022 363 76 10"], ["FRIBOURG", "026 321 35 55"]];

  $("#btn-pdf").addEventListener("click", function () {
    if (!VUE.length) { toast("Rien à exporter"); return; }
    occupe(true, "Création du PDF…");
    Promise.all([charge(LIBS.jspdf), logo()]).then(function (r) {
      var img = r[1], d = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
      var W = 297, M = 12, vert = [77, 122, 28], pale = [234, 242, 216], gris = [135, 134, 139];
      var cols = [["Code", 62], ["Ind.", 11], ["Titre", 118], ["Niveau", 20], ["Date", 19], ["Auteur", 26], ["Statut", 17]];
      var X = [M]; cols.forEach(function (c, i) { X[i + 1] = X[i] + c[1]; });
      var y, page = 0, quand = dateFr(aujourdhui());
      function T(s, x, yy, o) { o = o || {}; d.setFont("helvetica", o.b ? "bold" : "normal"); d.setFontSize(o.s || 8); d.setTextColor.apply(d, o.c || [0, 0, 0]); d.text(String(s == null ? "" : s), x, yy, o.a ? { align: o.a } : undefined); }
      function entete() {
        page++;
        d.addImage(img, "JPEG", M, 8, 13.2, 12.5);
        BUREAUX.forEach(function (b, i) { var yy = 11.2 + i * 3.2; T(b[0], M + 17, yy, { b: 1, s: 6.5 }); d.setFont("helvetica", "bold"); var w = d.getTextWidth(b[0]); T(" - T " + b[1], M + 17 + w, yy, { s: 6.5 }); });
        T("LISTE DES PLANS", W - M, 12.5, { b: 1, s: 12, a: "right" });
        T(PROJET, W - M, 17.5, { s: 9, a: "right" });
        T(libelleVue() + " · " + VUE.length + " plan(s) · édition du " + quand, W - M, 21.5, { s: 7.5, a: "right", c: gris });
        d.setDrawColor.apply(d, vert); d.setLineWidth(.5); d.line(M, 25, W - M, 25);
        y = 31; d.setFillColor.apply(d, pale); d.rect(M, y - 4.2, W - 2 * M, 6, "F");
        cols.forEach(function (c, i) { T(c[0], X[i] + 1.5, y, { b: 1, s: 7.5, c: [40, 60, 15] }); });
        y += 5;
      }
      entete();
      VUE.forEach(function (p, i) {
        d.setFont("helvetica", "normal"); d.setFontSize(7.5);
        var lignes = d.splitTextToSize(p.titre || "—", cols[2][1] - 3).slice(0, 3), h = Math.max(1, lignes.length) * 3.4 + 1.6;
        if (y + h > 200) { d.addPage(); entete(); }
        if (i % 2) { d.setFillColor(246, 248, 242); d.rect(M, y - 3.3, W - 2 * M, h, "F"); }
        T(code(p), X[0] + 1.5, y, { s: 7 }); T(p.indice, X[1] + 1.5, y, { b: 1, s: 7.5, c: vert });
        d.setTextColor(0); d.text(lignes, X[2] + 1.5, y);
        T(niveauNom(p.niveau), X[3] + 1.5, y, { s: 7 }); T(dateFr(p.date_indice), X[4] + 1.5, y, { s: 7 });
        T(d.splitTextToSize(p.auteur || "", cols[5][1] - 2)[0] || "", X[5] + 1.5, y, { s: 7 }); T(d.splitTextToSize(p.statut || "", cols[6][1] - 2)[0] || "", X[6] + 1.5, y, { s: 7 });
        y += h;
      });
      var n = d.getNumberOfPages();
      for (var k = 1; k <= n; k++) { d.setPage(k); d.setDrawColor(200); d.setLineWidth(.2); d.line(M, 203, W - M, 203); T("AB Ingénieurs · " + PROJET + " · liste des plans du " + quand, M, 207, { s: 6.5, c: gris }); T("page " + k + " / " + n, W - M, 207, { s: 6.5, c: gris, a: "right" }); }
      telecharge(d.output("blob"), nomFichier("pdf"));
    }).catch(function (e) { toast(e.message, 5000); }).then(function () { occupe(false); });
  });

  $("#btn-xlsx").addEventListener("click", function () {
    if (!VUE.length) { toast("Rien à exporter"); return; }
    occupe(true, "Création du classeur…");
    Promise.all([charge(LIBS.exceljs), logo()]).then(function (r) {
      var wb = new window.ExcelJS.Workbook(); wb.creator = "AB Ingénieurs"; wb.created = new Date();
      var ws = wb.addWorksheet("Liste des plans", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .2, footer: .2 } },
        headerFooter: { oddFooter: "&L&8AB Ingénieurs · " + PROJET + "&R&8page &P / &N" } });
      var tetes = ["Projet", "Discipline", "Émetteur", "Phase", "Type", "Niveau", "Zone", "N°", "Code", "Indice", "Titre", "Niveau (libellé)", "Date indice", "Auteur", "Statut", "Remarque"];
      var larg = [8, 10, 9, 7, 7, 8, 7, 7, 34, 7, 70, 14, 12, 20, 16, 30];
      ws.columns = larg.map(function (w) { return { width: w }; });
      var id = wb.addImage({ base64: r[1], extension: "jpeg" });
      ws.addImage(id, { tl: { col: 0.15, row: 0.2 }, ext: { width: 58, height: 55 } });
      ws.getRow(1).height = 15; ws.getRow(2).height = 15; ws.getRow(3).height = 15; ws.getRow(4).height = 15;
      BUREAUX.forEach(function (b, i) { var c = ws.getCell(1 + i, 3); c.value = { richText: [{ text: b[0], font: { bold: true, size: 8, name: "Arial" } }, { text: " - T " + b[1], font: { size: 8, name: "Arial" } }] }; });
      ws.mergeCells("I1:K1"); ws.getCell("I1").value = "LISTE DES PLANS"; ws.getCell("I1").font = { bold: true, size: 14, name: "Arial" };
      ws.mergeCells("I2:K2"); ws.getCell("I2").value = PROJET; ws.getCell("I2").font = { size: 11, name: "Arial" };
      ws.mergeCells("I3:K3"); ws.getCell("I3").value = libelleVue() + " · " + VUE.length + " plan(s) · édition du " + dateFr(aujourdhui()); ws.getCell("I3").font = { size: 9, name: "Arial", color: { argb: "FF87868B" } };
      for (var c = 1; c <= tetes.length; c++) ws.getCell(5, c).border = { top: { style: "medium", color: { argb: "FF4D7A1C" } } };
      var H = ws.getRow(6); H.values = tetes; H.height = 20;
      H.eachCell(function (cell) { cell.font = { bold: true, name: "Arial", size: 9, color: { argb: "FF283C0F" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCAE09B" } };
        cell.alignment = { vertical: "middle" }; cell.border = { bottom: { style: "thin", color: { argb: "FF87868B" } } }; });
      VUE.forEach(function (p, i) {
        var row = ws.addRow([p.projet, p.discipline, p.emetteur, p.phase, p.type, p.niveau, p.zone, p.numero, code(p), p.indice, p.titre, niveauNom(p.niveau),
          p.date_indice ? new Date(p.date_indice + "T12:00:00") : null, p.auteur, p.statut, p.remarque]);
        row.font = { name: "Arial", size: 9 }; row.alignment = { vertical: "top", wrapText: false };
        row.getCell(13).numFmt = "dd.mm.yyyy"; row.getCell(10).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF4D7A1C" } };
        if (i % 2) row.eachCell({ includeEmpty: true }, function (cell) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8F2" } }; });
      });
      ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + VUE.length, column: tetes.length } };
      ws.views = [{ state: "frozen", ySplit: 6 }];
      ws.pageSetup.printTitlesRow = "6:6";
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      telecharge(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomFichier("xlsx"));
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
