// CSV Studio — interface : onglets, grille virtuelle, sélection, saisie, presse-papiers, filtres, tris, recherche,
// outils de nettoyage et d'analyse, exports. Le noyau (lecture, écriture, formules) est dans csv-core.js.
(function(){
  "use strict";
  var VERSION = "1.0.0";
  var C = window.CSV;
  var RH = 28;                 // hauteur d'une ligne
  var HMAX = 12000000;         // hauteur de défilement maximale : au-delà, la position est mise à l'échelle
  var LMIN = 44, LMAX = 460;   // largeurs de colonne
  var MAX_ANNULER = 60;

  var $ = function(s){ return document.querySelector(s); };
  function id(x){ return document.getElementById(x); }
  var el = {
    accueil: id("accueil"), editeur: id("editeur"), mb: id("mb"), fNom: id("f-nom"), fBilan: id("f-bilan"), rapide: id("rapide"),
    onglets: id("onglets"), puces: id("puces"), grille: id("grille"), coin: id("coin"), tetes: id("tetes"), nums: id("nums"),
    corps: id("corps"), espace: id("espace"), toile: id("toile"), sel: id("sel"), actif: id("actif"), edit: id("edit"), vide: id("vide"),
    cherche: id("cherche"), profil: id("profil"), etat: id("etat"), stSel: id("st-sel"), stFormat: id("st-format"),
    ctx: id("ctx"), pop: id("pop"), fichier: id("fichier"), chargement: id("chargement"), chargementTxt: id("chargement-txt"),
    erreur: id("erreur"), recents: id("recents"), recentsListe: id("recents-liste")
  };

  var docs = [], D = null, numDoc = 1, numCol = 1;
  var tx = new WeakSet();      // lignes déjà recopiées pendant la modification en cours (copie à l'écriture)
  var V = { r0: 0, r1: 0, c0: 0, c1: 0, decal: 0, haut: 0, vh: 0, vw: 0, ech: false };
  var forcer = null;           // première ligne imposée quand la position de défilement est mise à l'échelle
  var edition = null;          // cellule en cours de saisie
  var rech = null;             // recherche en cours : { test, remplacer }
  var profilOuvert = false;
  var revision = 0;            // monte à chaque modification des données (clé du profil de colonne)

  [].forEach.call(document.querySelectorAll("[data-version]"), function(x){ x.textContent = "v" + VERSION; });

  // ====================================================================================================
  // Petits outils
  // ====================================================================================================
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"; }); }
  function borner(x, a, b){ return x < a ? a : x > b ? b : x; }
  function milliers(s){ return s.replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function fmtN(n){ return milliers(String(n)); }
  function fmtX(x){
    if (x == null || !isFinite(x)) return "—";
    var s = C.texteNombre(Math.abs(x) < 1e12 ? C.arrondi(x, 4) : x);
    if (/e/i.test(s)) return s;
    var p = s.split(".");
    return milliers(p[0]) + (p[1] ? "." + p[1] : "");
  }
  function pluriel(n, mot, mots){ return fmtN(n) + " " + (n > 1 ? (mots || mot + "s") : mot); }
  function octets(n){ return n < 1024 ? n + " o" : n < 1048576 ? Math.round(n / 1024) + " Ko" : (n / 1048576).toFixed(1).replace(".", ",") + " Mo"; }
  var minuterieEtat = 0;
  function etat(msg, alerte){
    el.etat.textContent = msg || "";
    el.etat.classList.toggle("alerte", !!alerte);
    clearTimeout(minuterieEtat);
    if (msg) minuterieEtat = setTimeout(function(){ el.etat.textContent = ""; }, alerte ? 12000 : 7000);
  }
  function garder(cle, v){ try { localStorage.setItem(cle, v); } catch (e){} }
  function lireReglage(cle){ try { return localStorage.getItem(cle); } catch (e){ return null; } }
  function pause(){ return new Promise(function(ok){ requestAnimationFrame(function(){ setTimeout(ok, 0); }); }); }
  function sansExt(nom){ return String(nom).replace(/\.[A-Za-z0-9]{1,5}$/, ""); }
  function norme(s){ return C.sansAccent(String(s)).toLowerCase().trim(); }

  // ====================================================================================================
  // Tableaux (un par onglet)
  // ====================================================================================================
  function nouvelleCol(nom){ return { id: numCol++, nom: nom, l: 120, cache: false, type: "texte" }; }

  // entete : tableau de titres, ou null (les colonnes s'appellent alors « Colonne 1 »… et l'export n'écrit pas de titres)
  function nouveauDoc(nom, entete, lignes, format){
    var nc = entete ? entete.length : 0, i;
    for (i = 0; i < lignes.length; i++) if (lignes[i].length > nc) nc = lignes[i].length;
    if (nc < 1) nc = 1;
    C.completer(lignes, nc);
    var d = {
      id: numDoc++, nom: nom, lignes: lignes, cols: [], vue: [], vc: [], xs: [0], largeur: 0,
      tri: [], filtres: {}, rapide: "", sel: { ar: 0, ac: 0, fr: 0, fc: 0 }, annuler: [], refaire: [], modifie: false,
      format: format || { sep: ";", encodage: "utf-8-bom", fin: "\r\n" }, sansEntete: !entete, sx: 0, sy: 0,
      tampon: null, lecture: null, note: ""
    };
    for (i = 0; i < nc; i++){
      var t = entete && entete[i] != null ? String(entete[i]).trim() : "";
      d.cols.push(nouvelleCol(t || "Colonne " + (i + 1)));
    }
    d.vue = tousIndices(lignes.length);
    typesCols(d);
    ajusterTout(d);
    calcCols(d);
    return d;
  }
  function tousIndices(n){ var v = new Array(n); for (var i = 0; i < n; i++) v[i] = i; return v; }

  function ajouterDoc(d){
    docs.push(d);
    activer(d);
  }
  function activer(d){
    if (edition) validerEdition();
    fermerFlottants();
    if (D){ D.sx = el.corps.scrollLeft; D.sy = el.corps.scrollTop; }
    D = d;
    forcer = null;
    document.body.classList.add("edition");
    el.accueil.hidden = true; el.editeur.hidden = false;
    el.rapide.value = d.rapide;
    majOnglets(); majBarre(); majPuces();
    dessiner();                                   // pose la taille de la zone de défilement avant d'y revenir
    el.corps.scrollLeft = d.sx; el.corps.scrollTop = d.sy;
    dessiner();
    majSelection();
    if (rech) compterRecherche();
    el.grille.focus({ preventScroll: true });
  }
  function fermerDoc(d, sansDemander){
    if (!sansDemander && d.modifie && !confirm("« " + d.nom + " » a des modifications non enregistrées.\nFermer quand même ?")) return false;
    var k = docs.indexOf(d);
    if (k < 0) return true;
    docs.splice(k, 1);
    if (D === d){
      D = null;
      if (docs.length) activer(docs[Math.min(k, docs.length - 1)]);
      else retourAccueil();
    } else majOnglets();
    return true;
  }
  function retourAccueil(){
    fermerFlottants();
    D = null;
    document.body.classList.remove("edition");
    el.editeur.hidden = true; el.accueil.hidden = false;
    document.title = "CSV Studio · STR Bim Tools";
    afficherRecents();
  }

  function majOnglets(){
    el.onglets.innerHTML = docs.map(function(d){
      return '<div class="og" role="tab" aria-selected="' + (d === D) + '" data-doc="' + d.id + '" title="' + esc(d.nom) + '">' +
        '<button type="button" class="og-nom">' + (d.modifie ? "<i>●</i>" : "") + esc(d.nom) + "</button>" +
        '<button type="button" class="og-x" data-fermer="' + d.id + '" aria-label="Fermer ' + esc(d.nom) + '">×</button></div>';
    }).join("") + '<button type="button" class="og-plus" data-plus title="Ouvrir un autre fichier (Ctrl + O)" aria-label="Ouvrir un autre fichier">+</button>';
  }
  function nomSep(s){ return s === ";" ? "point-virgule" : s === "," ? "virgule" : s === "\t" ? "tabulation" : s === "|" ? "barre |" : s === " " ? "espace" : "« " + s + " »"; }
  function majBarre(){
    if (!D) return;
    document.title = (D.modifie ? "● " : "") + D.nom + " · CSV Studio";
    el.fNom.textContent = D.nom;
    var n = D.lignes.length, a = D.vue.length, nc = D.cols.length, masquees = nc - D.vc.length;
    el.fBilan.innerHTML = (a !== n ? "<b>" + fmtN(a) + "</b> sur " : "") + pluriel(n, "ligne") + " · " + pluriel(nc, "colonne") +
      (masquees ? " (" + masquees + " masquée" + (masquees > 1 ? "s" : "") + ")" : "") + (D.note ? " · " + esc(D.note) : "");
    el.stFormat.textContent = nomSep(D.format.sep) + " · " + C.nomEncodage(D.format.encodage) + " · " + (D.format.fin === "\n" ? "LF" : "CRLF");
    var og = el.onglets.querySelector('[data-doc="' + D.id + '"] .og-nom');
    if (og && !!og.querySelector("i") !== D.modifie) majOnglets();
  }

  // ---------- Colonnes : positions, largeurs, types ----------
  function calcCols(d){
    d = d || D;
    var vc = [], xs = [0], x = 0;
    d.cols.forEach(function(c, i){ if (!c.cache){ vc.push(i); x += c.l; xs.push(x); } });
    d.vc = vc; d.xs = xs; d.largeur = x;
  }
  var mesure = document.createElement("canvas").getContext("2d");
  function ajusterCol(d, c){
    var m = mesure.measureText(d.cols[c].nom).width * 1.08 + 58, n = Math.min(d.vue.length, 300), v, w;
    for (var k = 0; k < n; k++){
      v = d.lignes[d.vue[k]][c];
      if (!v) continue;
      if (v.length > 90) v = v.slice(0, 90);
      w = mesure.measureText(v).width + 24;
      if (w > m) m = w;
    }
    d.cols[c].l = Math.round(borner(m, LMIN + 26, LMAX));
  }
  function ajusterTout(d){
    mesure.font = '13px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
    for (var c = 0; c < d.cols.length; c++){ if (c < 400) ajusterCol(d, c); else d.cols[c].l = 120; }
  }
  function typesCols(d){
    var n = Math.min(d.lignes.length, 300), L = d.lignes;
    for (var c = 0; c < d.cols.length; c++){
      var ech = new Array(n);
      for (var i = 0; i < n; i++) ech[i] = L[i][c];
      d.cols[c].type = C.typeDe(ech);
    }
  }
  function numerique(type){ return type === "entier" || type === "nombre"; }
  function indexColId(idc){ for (var i = 0; i < D.cols.length; i++) if (D.cols[i].id === idc) return i; return -1; }

  // ====================================================================================================
  // Vue : filtres et tris (ne touchent jamais aux données)
  // ====================================================================================================
  var OPS = [["", "Toutes les valeurs"], ["contient", "contient"], ["sans", "ne contient pas"], ["egal", "est égal à"], ["diff", "est différent de"],
    ["debut", "commence par"], ["fin", "finit par"], ["regex", "correspond à l'expression"], ["vide", "est vide"], ["plein", "n'est pas vide"],
    [">", "est supérieur à"], [">=", "est supérieur ou égal à"], ["<", "est inférieur à"], ["<=", "est inférieur ou égal à"], ["entre", "est entre"]];
  function nomOp(op){ for (var i = 0; i < OPS.length; i++) if (OPS[i][0] === op) return OPS[i][1]; return op; }

  // Filtre de colonne → fonction (valeur) → gardée ?
  function fabriqueTest(f, type){
    var tests = [], a = f.a || "", al = a.toLowerCase(), b = f.b || "";
    function valeur(v){ var x = type === "date" ? C.date(v) : C.nombre(v); return isNaN(x) ? (type === "date" ? C.nombre(v) : C.date(v)) : x; }
    var A = valeur(a), B = valeur(b), re;
    switch (f.op){
      case "contient": tests.push(function(v){ return v.toLowerCase().indexOf(al) >= 0; }); break;
      case "sans": tests.push(function(v){ return v.toLowerCase().indexOf(al) < 0; }); break;
      case "egal": tests.push(isNaN(A) ? function(v){ return v.toLowerCase() === al; } : function(v){ return v.toLowerCase() === al || valeur(v) === A; }); break;
      case "diff": tests.push(isNaN(A) ? function(v){ return v.toLowerCase() !== al; } : function(v){ return v.toLowerCase() !== al && valeur(v) !== A; }); break;
      case "debut": tests.push(function(v){ return v.toLowerCase().lastIndexOf(al, 0) === 0; }); break;
      case "fin": tests.push(function(v){ var s = v.toLowerCase(); return s.length >= al.length && s.indexOf(al, s.length - al.length) >= 0; }); break;
      case "regex": re = new RegExp(a, "i"); tests.push(function(v){ return re.test(v); }); break;
      case "vide": tests.push(function(v){ return v.trim() === ""; }); break;
      case "plein": tests.push(function(v){ return v.trim() !== ""; }); break;
      case ">": tests.push(function(v){ return valeur(v) > A; }); break;
      case ">=": tests.push(function(v){ return valeur(v) >= A; }); break;
      case "<": tests.push(function(v){ return valeur(v) < A; }); break;
      case "<=": tests.push(function(v){ return valeur(v) <= A; }); break;
      case "entre": tests.push(function(v){ var x = valeur(v); return x >= Math.min(A, B) && x <= Math.max(A, B); }); break;
    }
    if (f.mode === "exclus" && f.ens.size) tests.push(function(v){ return !f.ens.has(v); });
    else if (f.mode === "inclus") tests.push(function(v){ return f.ens.has(v); });
    if (!tests.length) return null;
    if (tests.length === 1) return tests[0];
    return function(v){ return tests[0](v) && tests[1](v); };
  }
  function filtreActif(f){ return !!f && (!!f.op || (f.mode === "exclus" && f.ens.size > 0) || f.mode === "inclus"); }
  function aFiltre(){
    if (D.rapide.trim()) return true;
    for (var k in D.filtres) if (filtreActif(D.filtres[k]) && indexColId(+k) >= 0) return true;
    return false;
  }
  function vueModifiee(){ return aFiltre() || D.tri.length > 0; }

  // Indices des lignes qui passent les filtres (sauf celui de la colonne sautId), dans l'ordre des données
  function lignesFiltrees(sautId){
    var L = D.lignes, n = L.length, tests = [], k, c, t;
    for (k in D.filtres){
      c = indexColId(+k);
      if (c < 0){ delete D.filtres[k]; continue; }
      if (+k === sautId || !filtreActif(D.filtres[k])) continue;
      try { t = fabriqueTest(D.filtres[k], D.cols[c].type); } catch (e){ t = null; }
      if (t) tests.push({ c: c, t: t });
    }
    var mots = D.rapide.toLowerCase().split(/\s+/).filter(Boolean), nt = tests.length, nm = mots.length;
    if (!nt && !nm) return tousIndices(n);
    var v = [], i, l, j, ok, s;
    for (i = 0; i < n; i++){
      l = L[i]; ok = true;
      for (j = 0; j < nt; j++) if (!tests[j].t(l[tests[j].c])){ ok = false; break; }
      if (ok && nm){
        s = l.join("\u0001").toLowerCase();
        for (j = 0; j < nm; j++) if (s.indexOf(mots[j]) < 0){ ok = false; break; }
      }
      if (ok) v.push(i);
    }
    return v;
  }
  function trier(v){
    var L = D.lignes, n = L.length;
    D.tri = D.tri.filter(function(t){ return indexColId(t.id) >= 0; });
    var niv = D.tri.map(function(t){
      var c = indexColId(t.id), type = D.cols[c].type, k = null;
      if (numerique(type) || type === "date"){
        k = new Float64Array(n);
        for (var i = 0; i < n; i++) k[i] = type === "date" ? C.date(L[i][c]) : C.nombre(L[i][c]);
      }
      return { c: c, k: k, s: t.sens };
    });
    if (!niv.length) return v;
    var nn = niv.length;
    v.sort(function(a, b){
      for (var q = 0; q < nn; q++){
        var z = niv[q], r = 0, va = L[a][z.c], vb = L[b][z.c];
        if (va === vb) continue;
        if (va === "") return 1;                                   // les vides toujours à la fin
        if (vb === "") return -1;
        if (z.k){
          var x = z.k[a], y = z.k[b], nx = x !== x, ny = y !== y;
          if (nx || ny) r = nx && ny ? C.comparer(va, vb) * z.s : (nx ? 1 : -1);
          else r = (x < y ? -1 : x > y ? 1 : 0) * z.s;
        } else r = C.comparer(va, vb) * z.s;
        if (r) return r;
      }
      return a - b;
    });
    return v;
  }
  function recalcVue(){
    D.vue = trier(lignesFiltrees(null));
    revision++;
    forcer = null;
    bornerSelection();
    majBarre(); majPuces();
    dessiner();
    majSelection();
    if (rech) compterRecherche();
  }
  function bornerSelection(){
    var s = D.sel, n = Math.max(0, D.vue.length - 1), m = Math.max(0, D.vc.length - 1);
    s.ar = borner(s.ar, 0, n); s.fr = borner(s.fr, 0, n); s.ac = borner(s.ac, 0, m); s.fc = borner(s.fc, 0, m);
  }

  function texteFiltre(f){
    var t = "";
    if (f.op) t = nomOp(f.op) + (f.op === "vide" || f.op === "plein" ? "" : " « " + f.a + " »" + (f.op === "entre" ? " et « " + f.b + " »" : ""));
    if (f.mode === "inclus") t += (t ? ", " : "") + (f.ens.size === 1 ? "= « " + (Array.from(f.ens)[0] || "(vide)") + " »" : pluriel(f.ens.size, "valeur") + " gardée" + (f.ens.size > 1 ? "s" : ""));
    else if (f.mode === "exclus" && f.ens.size) t += (t ? ", " : "") + pluriel(f.ens.size, "valeur") + " écartée" + (f.ens.size > 1 ? "s" : "");
    return t;
  }
  function majPuces(){
    var h = "";
    if (D.rapide.trim()) h += '<span class="puce"><span>Contient <b>' + esc(D.rapide.trim()) + '</b></span><button type="button" data-puce="rapide" aria-label="Retirer">×</button></span>';
    Object.keys(D.filtres).forEach(function(k){
      var f = D.filtres[k], c = indexColId(+k);
      if (c < 0 || !filtreActif(f)) return;
      h += '<span class="puce"><span><b>' + esc(D.cols[c].nom) + "</b> " + esc(texteFiltre(f)) + '</span><button type="button" data-puce="f' + k + '" aria-label="Retirer ce filtre">×</button></span>';
    });
    D.tri.forEach(function(t, i){
      var c = indexColId(t.id);
      if (c < 0) return;
      h += '<span class="puce"><span>Tri' + (D.tri.length > 1 ? " " + (i + 1) : "") + " : <b>" + esc(D.cols[c].nom) + "</b> " + (t.sens > 0 ? "▲" : "▼") + '</span><button type="button" data-puce="t' + t.id + '" aria-label="Retirer ce tri">×</button></span>';
    });
    if (h) h += '<button type="button" class="btn petit" data-puce="tout">Tout effacer</button>';
    var avant = el.puces.hidden;
    el.puces.innerHTML = h;
    el.puces.hidden = !h;
    if (avant !== el.puces.hidden) redessiner();
  }
  el.puces.addEventListener("click", function(e){
    var b = e.target.closest("[data-puce]");
    if (!b || !D) return;
    var p = b.getAttribute("data-puce");
    if (p === "rapide"){ D.rapide = ""; el.rapide.value = ""; }
    else if (p === "tout"){ D.rapide = ""; el.rapide.value = ""; D.filtres = {}; D.tri = []; }
    else if (p.charAt(0) === "f") delete D.filtres[p.slice(1)];
    else D.tri = D.tri.filter(function(t){ return String(t.id) !== p.slice(1); });
    recalcVue();
    el.grille.focus();
  });
  var minuterieRapide = 0;
  el.rapide.addEventListener("input", function(){
    clearTimeout(minuterieRapide);
    minuterieRapide = setTimeout(function(){ if (D){ D.rapide = el.rapide.value; recalcVue(); } }, 180);
  });
  el.rapide.addEventListener("keydown", function(e){
    if (e.key === "Escape"){ e.preventDefault(); if (el.rapide.value){ el.rapide.value = ""; D.rapide = ""; recalcVue(); } el.grille.focus(); }
    else if (e.key === "Enter" || e.key === "ArrowDown"){ e.preventDefault(); el.grille.focus(); }
  });

  // ====================================================================================================
  // Dessin de la grille (seules les cellules visibles existent dans la page)
  // ====================================================================================================
  var attente = false;
  function redessiner(){
    if (attente) return;
    attente = true;
    requestAnimationFrame(function(){ attente = false; dessiner(); });
  }
  function texteCellule(v){
    if (v.length > 400) v = v.slice(0, 400) + "…";
    var h = esc(v);
    return h.indexOf("\n") >= 0 || h.indexOf("\r") >= 0 ? h.replace(/\r\n|\r|\n/g, '<span class="nl">↵</span>') : h;
  }
  function rect(){
    var s = D.sel;
    return { r0: Math.min(s.ar, s.fr), r1: Math.max(s.ar, s.fr), c0: Math.min(s.ac, s.fc), c1: Math.max(s.ac, s.fc) };
  }
  function dessiner(){
    if (!D || el.editeur.hidden) return;
    var co = el.corps, n = D.vue.length, vc = D.vc, xs = D.xs, L = D.lignes;
    var wn = Math.max(44, String(L.length).length * 8 + 24);
    if (el.grille._wn !== wn){ el.grille._wn = wn; el.grille.style.setProperty("--wn", wn + "px"); }
    var total = n * RH, ech = total > HMAX, hEsp = ech ? HMAX : total, wEsp = D.largeur + 80;
    if (el.espace._h !== hEsp || el.espace._w !== wEsp){
      el.espace._h = hEsp; el.espace._w = wEsp;
      el.espace.style.height = hEsp + "px"; el.espace.style.width = wEsp + "px";
      el.toile.style.width = D.largeur + "px";
    }
    var vh = co.clientHeight, vw = co.clientWidth, sx = co.scrollLeft, sy = co.scrollTop, r0, decal, haut;
    if (ech){
      var parPage = Math.max(1, Math.floor(vh / RH)), maxPrem = Math.max(0, n - parPage), course = HMAX - vh;
      if (forcer && Math.abs(sy - forcer.sy) < 1.5) r0 = forcer.r0;
      else { forcer = null; r0 = course > 0 ? Math.round(sy / course * maxPrem) : 0; }
      r0 = borner(r0, 0, maxPrem); decal = 0; haut = sy;
    } else { r0 = Math.floor(sy / RH); decal = sy - r0 * RH; haut = r0 * RH; }
    var r1 = Math.min(n, r0 + Math.ceil(vh / RH) + 1), c0 = 0, c1, r, c, q = rect();
    while (c0 < vc.length - 1 && xs[c0 + 1] <= sx) c0++;
    c1 = c0;
    while (c1 < vc.length && xs[c1] < sx + vw) c1++;
    V.r0 = r0; V.r1 = r1; V.c0 = c0; V.c1 = c1; V.decal = decal; V.haut = haut; V.vh = vh; V.vw = vw; V.ech = ech;

    // cellules
    var h = "", test = rech ? rech.test : null, estNum = [];
    for (c = c0; c < c1; c++) estNum[c] = numerique(D.cols[vc[c]].type);
    for (r = r0; r < r1; r++){
      var li = L[D.vue[r]];
      h += '<div class="g-l' + (r & 1 ? " imp" : "") + '" style="top:' + ((r - r0) * RH) + 'px">';
      for (c = c0; c < c1; c++){
        var v = li[vc[c]];
        h += '<div class="c' + (estNum[c] ? " n" : "") + (test && v && test(v) ? " tr" : "") + '" style="left:' + xs[c] + "px;width:" + (xs[c + 1] - xs[c]) + 'px">' + (v ? texteCellule(v) : "") + "</div>";
      }
      h += "</div>";
    }
    el.toile.style.top = haut + "px";
    el.toile.innerHTML = h;

    // titres de colonnes
    h = "";
    var toutesLignes = n > 0 && q.r0 === 0 && q.r1 === n - 1;
    for (c = c0; c < c1; c++){
      var col = D.cols[vc[c]], f = D.filtres[col.id], tri = "";
      for (var t = 0; t < D.tri.length; t++) if (D.tri[t].id === col.id) tri = (D.tri[t].sens > 0 ? "▲" : "▼") + (D.tri.length > 1 ? t + 1 : "");
      h += '<div class="t' + (c >= q.c0 && c <= q.c1 && (toutesLignes || n === 0) ? " s" : "") + (filtreActif(f) ? " f" : "") + '" data-c="' + c + '" style="left:' + (xs[c] - sx) + "px;width:" + (xs[c + 1] - xs[c]) + 'px" title="' + esc(col.nom) + " · " + nomType(col.type) + '">' +
        '<span class="t-nom">' + esc(col.nom) + "</span>" + (tri ? '<span class="t-tri">' + tri + "</span>" : "") +
        '<button type="button" class="t-menu" tabindex="-1" data-menu-col="' + c + '" aria-label="Trier et filtrer ' + esc(col.nom) + '"></button><i class="t-bord" data-bord="' + c + '"></i></div>';
    }
    el.tetes.innerHTML = h;

    // numéros de ligne (ceux du fichier, même filtré)
    h = "";
    var toutesCols = q.c0 === 0 && q.c1 === vc.length - 1;
    for (r = r0; r < r1; r++) h += '<div class="nu' + (toutesCols && r >= q.r0 && r <= q.r1 ? " s" : "") + '" data-r="' + r + '" style="top:' + ((r - r0) * RH - decal) + 'px">' + (D.vue[r] + 1) + "</div>";
    el.nums.innerHTML = h;

    // sélection
    if (n && vc.length){
      poser(el.sel, q.r0, q.r1, q.c0, q.c1, q.r0 === q.r1 && q.c0 === q.c1);
      poser(el.actif, D.sel.ar, D.sel.ar, D.sel.ac, D.sel.ac, false);
    } else { el.sel.hidden = true; el.actif.hidden = true; }
    el.vide.hidden = n > 0;
    if (!n) el.vide.textContent = L.length ? "Aucune ligne ne passe les filtres." : "Tableau vide : Lignes › Insérer une ligne, ou colle des données (Ctrl + V).";
    if (edition) placerEdition();
  }
  function poser(e, ra, rb, ca, cb, cacher){
    var y0 = V.haut + (ra - V.r0) * RH, y1 = V.haut + (rb + 1 - V.r0) * RH;
    y0 = Math.max(y0, V.haut - 4000); y1 = Math.min(y1, V.haut + V.vh + 4000);
    if (cacher || y1 <= y0){ e.hidden = true; return; }
    e.hidden = false;
    e.style.left = D.xs[ca] + "px"; e.style.top = y0 + "px";
    e.style.width = (D.xs[cb + 1] - D.xs[ca]) + "px"; e.style.height = (y1 - y0) + "px";
  }
  function nomType(t){ return t === "entier" ? "nombre entier" : t === "nombre" ? "nombre" : t === "date" ? "date" : t === "bool" ? "oui / non" : "texte"; }

  // Amène la cellule (r, c) de la vue dans la fenêtre
  function voir(r, c){
    var co = el.corps, vh = co.clientHeight, vw = co.clientWidth, n = D.vue.length;
    if (n * RH > HMAX){
      var parPage = Math.max(1, Math.floor(vh / RH)), maxPrem = Math.max(0, n - parPage), prem = V.r0;
      if (r < prem) prem = r; else if (r >= prem + parPage) prem = r - parPage + 1;
      prem = borner(prem, 0, maxPrem);
      if (prem !== V.r0 || !V.ech){
        co.scrollTop = maxPrem ? prem / maxPrem * (HMAX - vh) : 0;
        forcer = { sy: co.scrollTop, r0: prem };
      }
    } else {
      var y = r * RH;
      if (y < co.scrollTop) co.scrollTop = y;
      else if (y + RH > co.scrollTop + vh) co.scrollTop = y + RH - vh;
    }
    var x0 = D.xs[c], x1 = D.xs[c + 1];
    if (x0 < co.scrollLeft || x1 - x0 > vw) co.scrollLeft = x0;
    else if (x1 > co.scrollLeft + vw) co.scrollLeft = x1 - vw;
  }
  el.corps.addEventListener("scroll", function(){
    if (edition && V.ech) validerEdition();
    redessiner();
  }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(redessiner).observe(el.corps);
  else window.addEventListener("resize", redessiner);

  // ====================================================================================================
  // Sélection
  // ====================================================================================================
  function selectionner(ar, ac, fr, fc, montrer){
    D.sel = { ar: ar, ac: ac, fr: fr, fc: fc };
    bornerSelection();
    if (montrer && D.vue.length && D.vc.length) voir(D.sel.fr, D.sel.fc);
    redessiner();
    majSelection();
  }
  function deplacer(dr, dc, etendre){
    var s = D.sel, n = Math.max(0, D.vue.length - 1), m = Math.max(0, D.vc.length - 1);
    var r = borner((etendre ? s.fr : s.ar) + dr, 0, n), c = borner((etendre ? s.fc : s.ac) + dc, 0, m);
    if (etendre) selectionner(s.ar, s.ac, r, c, true); else selectionner(r, c, r, c, true);
  }
  function lignesSel(){
    if (!D.vue.length) return [];
    var q = rect(), v = [];
    for (var r = q.r0; r <= q.r1; r++) v.push(D.vue[r]);
    return v;
  }
  function colsSel(){
    var q = rect(), v = [];
    for (var c = q.c0; c <= q.c1; c++) if (D.vc[c] != null) v.push(D.vc[c]);
    return v;
  }
  function colActive(){ return D.vc[D.sel.ac]; }

  // Barre d'état : taille de la sélection, somme, moyenne, min, max
  var minuterieSel = 0;
  function majSelection(){
    clearTimeout(minuterieSel);
    minuterieSel = setTimeout(function(){
      if (!D) return;
      if (!D.vue.length || !D.vc.length){ el.stSel.textContent = ""; majProfil(); return; }
      var q = rect(), nl = q.r1 - q.r0 + 1, ncol = q.c1 - q.c0 + 1, h;
      if (nl === 1 && ncol === 1) h = "Ligne " + fmtN(D.vue[q.r0] + 1) + " · " + esc(D.cols[D.vc[q.c0]].nom);
      else {
        h = fmtN(nl) + " × " + fmtN(ncol);
        if (nl * ncol <= 600000){
          var nb = 0, pleines = 0, somme = 0, min = Infinity, max = -Infinity, r, c, v, x, l;
          for (r = q.r0; r <= q.r1; r++){
            l = D.lignes[D.vue[r]];
            for (c = q.c0; c <= q.c1; c++){
              v = l[D.vc[c]];
              if (v === "") continue;
              pleines++;
              x = C.nombre(v);
              if (x === x){ nb++; somme += x; if (x < min) min = x; if (x > max) max = x; }
            }
          }
          h += " · " + fmtN(pleines) + " remplies";
          if (nb) h += " · Somme <b>" + fmtX(somme) + "</b> · Moyenne <b>" + fmtX(somme / nb) + "</b> · Min " + fmtX(min) + " · Max " + fmtX(max);
        }
      }
      el.stSel.innerHTML = h;
      majProfil();
    }, 90);
  }

  // ---------- Souris ----------
  function colA(x){
    var xs = D.xs, a = 0, b = D.vc.length - 1, m;
    while (a < b){ m = (a + b + 1) >> 1; if (xs[m] <= x) a = m; else b = m - 1; }
    return Math.max(0, a);
  }
  function celluleA(e){
    var b = el.corps.getBoundingClientRect(), x = e.clientX - b.left + el.corps.scrollLeft, y = e.clientY - b.top;
    return { r: borner(V.r0 + Math.floor((y + V.decal) / RH), 0, Math.max(0, D.vue.length - 1)), c: colA(x) };
  }
  var glisse = null;           // { type:"cellules"|"lignes"|"colonnes"|"largeur", … }
  function dansSelection(p){ var q = rect(); return p.r >= q.r0 && p.r <= q.r1 && p.c >= q.c0 && p.c <= q.c1; }

  el.corps.addEventListener("mousedown", function(e){
    if (!D || e.target === el.edit) return;
    var b = el.corps.getBoundingClientRect();
    if (e.clientX - b.left >= el.corps.clientWidth || e.clientY - b.top >= el.corps.clientHeight) return;     // barres de défilement
    if (edition) validerEdition();
    fermerFlottants();
    el.grille.focus({ preventScroll: true });
    if (!D.vue.length || !D.vc.length) return;
    var p = celluleA(e);
    if (e.button === 2){ if (!dansSelection(p)) selectionner(p.r, p.c, p.r, p.c); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.shiftKey) selectionner(D.sel.ar, D.sel.ac, p.r, p.c);
    else selectionner(p.r, p.c, p.r, p.c);
    if (e.detail >= 2 && !e.shiftKey){ editer(); return; }
    glisse = { type: "cellules" };
  });
  el.nums.addEventListener("mousedown", function(e){
    var n = e.target.closest("[data-r]");
    if (!D || !n) return;
    if (edition) validerEdition();
    fermerFlottants();
    el.grille.focus({ preventScroll: true });
    var r = +n.getAttribute("data-r"), m = D.vc.length - 1;
    if (e.button === 2){ var q = rect(); if (!(r >= q.r0 && r <= q.r1 && q.c0 === 0 && q.c1 === m)) selectionner(r, 0, r, m); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.shiftKey) selectionner(D.sel.ar, 0, r, m); else selectionner(r, 0, r, m);
    glisse = { type: "lignes" };
  });
  el.tetes.addEventListener("mousedown", function(e){
    if (!D) return;
    var bord = e.target.closest("[data-bord]"), bm = e.target.closest("[data-menu-col]"), t = e.target.closest(".t");
    if (edition) validerEdition();
    if (bord){
      e.preventDefault();
      var c = +bord.getAttribute("data-bord");
      if (e.detail >= 2){ mesure.font = '13px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif'; ajusterCol(D, D.vc[c]); calcCols(); redessiner(); return; }
      glisse = { type: "largeur", c: D.vc[c], x: e.clientX, l: D.cols[D.vc[c]].l };
      return;
    }
    if (bm){ e.preventDefault(); ouvrirMenuCol(+bm.getAttribute("data-menu-col")); return; }
    if (!t) return;
    fermerFlottants();
    el.grille.focus({ preventScroll: true });
    var cc = +t.getAttribute("data-c"), n = Math.max(0, D.vue.length - 1);
    if (e.button === 2){ var q = rect(); if (!(cc >= q.c0 && cc <= q.c1 && q.r0 === 0 && q.r1 === n)) selectionner(0, cc, n, cc); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.detail >= 2){ CMD["col-renommer"](); return; }
    if (e.shiftKey) selectionner(0, D.sel.ac, n, cc); else selectionner(0, cc, n, cc);
    glisse = { type: "colonnes" };
  });
  el.coin.addEventListener("click", function(){ if (D) CMD["tout-selectionner"](); });
  document.addEventListener("mousemove", function(e){
    if (!glisse || !D) return;
    if (glisse.type === "largeur"){
      D.cols[glisse.c].l = Math.round(borner(glisse.l + e.clientX - glisse.x, LMIN, 1200));
      calcCols(); redessiner();
      return;
    }
    var b = el.corps.getBoundingClientRect(), co = el.corps;
    if (glisse.type !== "colonnes"){
      if (e.clientY > b.top + co.clientHeight) co.scrollTop += RH * 2; else if (e.clientY < b.top) co.scrollTop -= RH * 2;
    }
    if (glisse.type !== "lignes"){
      if (e.clientX > b.left + co.clientWidth) co.scrollLeft += 40; else if (e.clientX < b.left) co.scrollLeft -= 40;
    }
    var p = celluleA({ clientX: borner(e.clientX, b.left, b.left + co.clientWidth - 1), clientY: borner(e.clientY, b.top, b.top + co.clientHeight - 1) }), s = D.sel;
    if (glisse.type === "lignes"){ if (p.r !== s.fr) selectionner(s.ar, 0, p.r, D.vc.length - 1); }
    else if (glisse.type === "colonnes"){ if (p.c !== s.fc) selectionner(0, s.ac, Math.max(0, D.vue.length - 1), p.c); }
    else if (p.r !== s.fr || p.c !== s.fc) selectionner(s.ar, s.ac, p.r, p.c);
  });
  document.addEventListener("mouseup", function(){ glisse = null; });

  // ====================================================================================================
  // Saisie dans une cellule
  // ====================================================================================================
  function placerEdition(){
    var e = edition, ed = el.edit, l = D.xs[e.c + 1] - D.xs[e.c];
    ed.style.left = D.xs[e.c] + "px";
    ed.style.top = (V.haut + (e.r - V.r0) * RH) + "px";
    ed.style.minWidth = l + "px";
    tailleEdition();
  }
  function tailleEdition(){
    var ed = el.edit, v = ed.value, lignes = v.split("\n"), plus = 0;
    for (var i = 0; i < lignes.length; i++) if (lignes[i].length > plus) plus = lignes[i].length;
    ed.style.width = Math.min(640, plus * 7.4 + 30) + "px";
    ed.style.height = Math.min(10, lignes.length) * 20 + 10 + "px";
  }
  function editer(debut){
    if (!D.vue.length || !D.vc.length) return;
    var s = D.sel;
    selectionner(s.ar, s.ac, s.ar, s.ac, true);
    dessiner();
    edition = { r: s.ar, c: s.ac, i: D.vue[s.ar], ci: D.vc[s.ac] };
    el.edit.value = debut != null ? debut : D.lignes[edition.i][edition.ci];
    el.edit.hidden = false;
    placerEdition();
    el.edit.focus({ preventScroll: true });
    var n = el.edit.value.length;
    el.edit.setSelectionRange(n, n);
  }
  function validerEdition(){
    if (!edition) return;
    var e = edition, v = el.edit.value;
    edition = null;
    el.edit.hidden = true;
    if (D && D.lignes[e.i] && v !== D.lignes[e.i][e.ci]) modifier("Saisie", function(){ ligneModif(e.i)[e.ci] = v; });
  }
  function annulerEdition(){
    edition = null;
    el.edit.hidden = true;
    el.grille.focus({ preventScroll: true });
  }
  el.edit.addEventListener("input", tailleEdition);
  el.edit.addEventListener("blur", function(){ validerEdition(); });
  el.edit.addEventListener("keydown", function(e){
    e.stopPropagation();
    if (e.key === "Escape"){ e.preventDefault(); annulerEdition(); }
    else if (e.key === "Enter" && e.altKey){
      e.preventDefault();
      var ed = el.edit, a = ed.selectionStart;
      ed.value = ed.value.slice(0, a) + "\n" + ed.value.slice(ed.selectionEnd);
      ed.setSelectionRange(a + 1, a + 1); tailleEdition();
    }
    else if (e.key === "Enter"){ e.preventDefault(); validerEdition(); el.grille.focus({ preventScroll: true }); deplacer(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === "Tab"){ e.preventDefault(); validerEdition(); el.grille.focus({ preventScroll: true }); deplacer(0, e.shiftKey ? -1 : 1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s"){ e.preventDefault(); validerEdition(); executer("enregistrer"); }
  });

  // ====================================================================================================
  // Modifications et historique
  // Une modification garde l'ancien tableau de lignes ; les lignes elles-mêmes ne sont jamais réécrites sur place
  // (ligneModif en fait une copie la première fois), si bien qu'annuler revient à reposer l'ancien tableau.
  // ====================================================================================================
  function instantane(){
    return { lignes: D.lignes.slice(), cols: D.cols.map(function(c){ return Object.assign({}, c); }), sansEntete: D.sansEntete, modifie: D.modifie };
  }
  function restaurer(s){ D.lignes = s.lignes; D.cols = s.cols; D.sansEntete = s.sansEntete; }
  function ligneModif(i){
    var l = D.lignes[i];
    if (!tx.has(l)){ l = l.slice(); tx.add(l); D.lignes[i] = l; }
    return l;
  }
  // fn modifie D.lignes et D.cols ; elle renvoie false si rien n'a changé. o.structure : le nombre ou l'ordre des lignes change.
  function modifier(lib, fn, o){
    var avant = instantane(), res;
    tx = new WeakSet();
    try { res = fn(); }
    catch (e){ restaurer(avant); calcCols(); recalcVue(); throw e; }
    if (res === false) return false;
    D.annuler.push({ lib: lib, etat: avant });
    var poids = 0;
    for (var k = D.annuler.length - 1; k >= 0; k--){
      poids += D.annuler[k].etat.lignes.length + 1000;
      if (poids > 40000000 || D.annuler.length - k > MAX_ANNULER){ D.annuler.splice(0, k + 1); break; }
    }
    D.refaire = [];
    D.modifie = true;
    apres(o && o.structure);
    return true;
  }
  function apres(structure){
    revision++;
    typesCols(D);
    calcCols();
    if (structure) recalcVue();
    else { bornerSelection(); majBarre(); dessiner(); majSelection(); if (rech) compterRecherche(); }
  }
  function rejouer(de, vers, mot){
    if (edition) validerEdition();
    var e = de.pop();
    if (!e){ etat("Rien à " + mot + "."); return; }
    vers.push({ lib: e.lib, etat: instantane() });
    restaurer(e.etat);
    D.modifie = mot === "annuler" ? e.etat.modifie : true;
    apres(true);
    etat((mot === "annuler" ? "Annulé : " : "Rétabli : ") + e.lib);
  }

  // ---------- Opérations de base sur les colonnes ----------
  // Insère des colonnes à la position pos ; fn(ligne, i) donne leurs valeurs (sinon vides)
  function insererCols(pos, noms, fn){
    var k = noms.length, vides = noms.map(function(){ return ""; });
    D.lignes = D.lignes.map(function(l, i){
      var v = fn ? (fn(l, i) || vides) : vides, n = l.slice(0, pos), j;
      for (j = 0; j < k; j++) n.push(v[j] == null ? "" : v[j]);
      for (j = pos; j < l.length; j++) n.push(l[j]);
      return n;
    });
    var neuves = noms.map(nouvelleCol);
    D.cols.splice.apply(D.cols, [pos, 0].concat(neuves));
    return neuves;
  }
  function supprimerCols(indices){
    var ens = new Set(indices);
    if (ens.size >= D.cols.length) throw new Error("Il faut garder au moins une colonne.");
    D.lignes = D.lignes.map(function(l){ return l.filter(function(v, j){ return !ens.has(j); }); });
    D.cols = D.cols.filter(function(c, j){ return !ens.has(j); });
  }
  function insererDans(pos, items){ D.lignes = D.lignes.slice(0, pos).concat(items, D.lignes.slice(pos)); }
  function plusGrand(t){ var m = -Infinity; for (var i = 0; i < t.length; i++) if (t[i] > m) m = t[i]; return m; }
  function plusPetit(t){ var m = Infinity; for (var i = 0; i < t.length; i++) if (t[i] < m) m = t[i]; return m; }
  function ligneVide(){ var l = new Array(D.cols.length); for (var i = 0; i < l.length; i++) l[i] = ""; return l; }
  function nomLibre(base){
    var noms = new Set(D.cols.map(function(c){ return c.nom; })), n = base, k = 2;
    while (noms.has(n)) n = base + " " + k++;
    return n;
  }

  // Applique fn(valeur, colonne) → nouvelle valeur à toutes les cellules de la sélection
  function transformer(lib, fn){
    if (!D.vue.length){ etat("Aucune cellule à modifier."); return; }
    var q = rect(), n = 0;
    modifier(lib, function(){
      for (var r = q.r0; r <= q.r1; r++){
        var i = D.vue[r], src = D.lignes[i], l = null;
        for (var c = q.c0; c <= q.c1; c++){
          var ci = D.vc[c], v = src[ci], nv = fn(v, D.cols[ci]);
          if (nv !== v){ if (!l) l = ligneModif(i); l[ci] = nv; n++; }
        }
      }
      if (!n) return false;
    });
    etat(n ? lib + " : " + pluriel(n, "cellule modifiée", "cellules modifiées") + "." : lib + " : rien à modifier dans la sélection" + (q.r0 === q.r1 ? " (clique un titre de colonne pour la traiter en entier)." : "."));
  }

  // ====================================================================================================
  // Presse-papiers
  // ====================================================================================================
  function champTsv(v){ return /[\t\n\r"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function texteSelection(avecTitres){
    var q = rect(), out = [], r, c, l, s;
    if (avecTitres){
      s = [];
      for (c = q.c0; c <= q.c1; c++) s.push(champTsv(D.cols[D.vc[c]].nom));
      out.push(s.join("\t"));
    }
    if (D.vue.length) for (r = q.r0; r <= q.r1; r++){
      l = D.lignes[D.vue[r]]; s = "";
      for (c = q.c0; c <= q.c1; c++) s += (c > q.c0 ? "\t" : "") + champTsv(l[D.vc[c]]);
      out.push(s);
    }
    return out.join("\r\n");
  }
  function effacerSelection(lib){
    transformer(lib || "Effacer", function(){ return ""; });
  }
  function coller(texte){
    if (!texte) return;
    var a = C.analyser(texte, "\t").lignes;
    if (!a.length) return;
    var q = rect(), h = a.length, w = a[0].length, un = h === 1 && w === 1, bloque = vueModifiee(), nb = 0, coupe = false;
    if (!D.vue.length){ q = { r0: 0, r1: 0, c0: D.sel.ac, c1: D.sel.ac }; un = false; }
    modifier("Coller", function(){
      var r, c, l;
      if (un){
        for (r = q.r0; r <= q.r1; r++){
          l = ligneModif(D.vue[r]);
          for (c = q.c0; c <= q.c1; c++){ l[D.vc[c]] = a[0][0]; nb++; }
        }
        return;
      }
      var manque = q.c0 + w - D.vc.length;
      if (manque > 0){
        var noms = [];
        for (c = 0; c < manque; c++) noms.push("Colonne " + (D.cols.length + c + 1));
        insererCols(D.cols.length, noms, null);
        calcCols();
      }
      for (var k = 0; k < h; k++){
        var i;
        r = q.r0 + k;
        if (r < D.vue.length) i = D.vue[r];
        else if (!bloque){ i = D.lignes.length; l = ligneVide(); tx.add(l); D.lignes.push(l); }
        else { coupe = true; break; }
        l = ligneModif(i);
        for (c = 0; c < w; c++){ l[D.vc[q.c0 + c]] = a[k][c]; nb++; }
      }
    }, { structure: true });
    if (!un) selectionner(q.r0, q.c0, Math.min(q.r0 + h - 1, Math.max(0, D.vue.length - 1)), Math.min(q.c0 + w - 1, D.vc.length - 1));
    etat("Collé : " + pluriel(nb, "cellule") + (coupe ? ". La suite n'a pas été collée : un filtre ou un tri est actif, les lignes ne peuvent pas être ajoutées." : "."), coupe);
  }
  function grilleActive(){ return !!D && !edition && document.activeElement === el.grille; }
  document.addEventListener("copy", function(e){
    if (!grilleActive()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", texteSelection(false));
    var q = rect();
    etat("Copié : " + fmtN(q.r1 - q.r0 + 1) + " × " + fmtN(q.c1 - q.c0 + 1) + ".");
  });
  document.addEventListener("cut", function(e){
    if (!grilleActive()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", texteSelection(false));
    effacerSelection("Couper");
  });
  document.addEventListener("paste", function(e){
    var t = e.target, saisie = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
    if (saisie || document.querySelector("dialog[open]")) return;
    var texte = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    if (!texte) return;
    if (!D){ e.preventDefault(); docDepuisPressePapiers(texte); return; }
    if (!grilleActive()) return;
    e.preventDefault();
    try { coller(texte); } catch (err){ etat(err.message, true); }
  });
  function ecrirePressePapiers(texte, message){
    if (!navigator.clipboard || !navigator.clipboard.writeText){ etat("Ce navigateur ne laisse pas copier depuis un menu : utilise Ctrl + C.", true); return; }
    navigator.clipboard.writeText(texte).then(function(){ etat(message); }, function(){ etat("Copie refusée par le navigateur : utilise Ctrl + C.", true); });
  }
  function lirePressePapiers(suite){
    if (!navigator.clipboard || !navigator.clipboard.readText){ etat("Ce navigateur ne laisse pas coller depuis un menu : utilise Ctrl + V.", true); return; }
    navigator.clipboard.readText().then(suite, function(){ etat("Lecture du presse-papiers refusée : utilise Ctrl + V.", true); });
  }
  function docDepuisPressePapiers(texte){
    try {
      var det = C.detecter(texte), sep = texte.indexOf("\t") >= 0 ? "\t" : det.sep, a = C.analyser(texte, sep);
      if (!a.lignes.length) throw new Error("Le presse-papiers ne contient pas de tableau.");
      var entete = C.aEntete(a.lignes) && a.lignes.length > 1 ? a.lignes.shift() : null;
      var d = nouveauDoc("Presse-papiers.csv", entete, a.lignes, { sep: ";", encodage: "utf-8-bom", fin: "\r\n" });
      d.modifie = true;
      ajouterDoc(d);
      etat("Tableau créé depuis le presse-papiers : " + pluriel(d.lignes.length, "ligne") + ".");
    } catch (e){ signaler(e); }
  }

  // ====================================================================================================
  // Clavier
  // ====================================================================================================
  el.grille.addEventListener("keydown", function(e){
    if (!D || edition) return;
    var ctrl = e.ctrlKey || e.metaKey, maj = e.shiftKey, k = e.key || "", page = Math.max(1, Math.floor(V.vh / RH) - 1), fait = true;
    if (k === "ArrowDown") deplacer(ctrl ? Infinity : 1, 0, maj);
    else if (k === "ArrowUp") deplacer(ctrl ? -Infinity : -1, 0, maj);
    else if (k === "ArrowRight") deplacer(0, ctrl ? Infinity : 1, maj);
    else if (k === "ArrowLeft") deplacer(0, ctrl ? -Infinity : -1, maj);
    else if (k === "PageDown") deplacer(page, 0, maj);
    else if (k === "PageUp") deplacer(-page, 0, maj);
    else if (k === "Home") deplacer(ctrl ? -Infinity : 0, -Infinity, maj);
    else if (k === "End") deplacer(ctrl ? Infinity : 0, Infinity, maj);
    else if (k === "Tab") deplacer(0, maj ? -1 : 1);
    else if (k === "Enter") deplacer(maj ? -1 : 1, 0);
    else if (k === "F2") editer();
    else if (k === "Delete" || k === "Backspace") effacerSelection();
    else if (k === "Escape"){ if (rech) fermerRecherche(); else selectionner(D.sel.ar, D.sel.ac, D.sel.ar, D.sel.ac); }
    else if (k === " " && ctrl) selectionner(0, D.sel.ac, Math.max(0, D.vue.length - 1), D.sel.fc);
    else if (k === " " && maj) selectionner(D.sel.ar, 0, D.sel.fr, D.vc.length - 1);
    else if (k === "ContextMenu" || (k === "F10" && maj)){
      var b = el.actif.getBoundingClientRect();
      menuCellules(b.left + 20, b.bottom);
    }
    else if (k.length === 1 && !ctrl && !e.altKey) editer(k);
    else fait = false;
    if (fait) e.preventDefault();
  });
  document.addEventListener("keydown", function(e){
    var ctrl = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase();
    if (e.key === "Escape"){
      if (!el.ctx.hidden || !el.pop.hidden || menuOuvert){ fermerFlottants(); e.preventDefault(); return; }
    }
    if (document.querySelector("dialog[open]")) return;
    if (ctrl && k === "o"){ e.preventDefault(); el.fichier.click(); return; }
    if (!D) return;
    var t = e.target, saisie = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
    if (ctrl && k === "s"){ e.preventDefault(); executer(e.shiftKey ? "exporter-csv" : "enregistrer"); }
    else if (ctrl && k === "f"){ e.preventDefault(); ouvrirRecherche(false); }
    else if (ctrl && k === "h"){ e.preventDefault(); ouvrirRecherche(true); }
    else if (ctrl && k === "g"){ e.preventDefault(); executer("aller"); }
    else if (saisie) return;
    else if (ctrl && k === "z"){ e.preventDefault(); executer(e.shiftKey ? "refaire" : "annuler"); }
    else if (ctrl && k === "y"){ e.preventDefault(); executer("refaire"); }
    else if (ctrl && k === "a"){ e.preventDefault(); executer("tout-selectionner"); }
    else if (ctrl && k === "d"){ e.preventDefault(); executer("remplir-bas"); }
    else if (ctrl && e.shiftKey && k === "l"){ e.preventDefault(); executer("filtre-valeur"); }
    else if (e.altKey && e.key === "ArrowDown"){ e.preventDefault(); ouvrirMenuCol(D.sel.ac); }
    else if (e.key === "F3"){ e.preventDefault(); if (rech) chercherSuivant(e.shiftKey ? -1 : 1); else ouvrirRecherche(false); }
  });

  // ====================================================================================================
  // Menus
  // ====================================================================================================
  // [commande, libellé, raccourci, classe] · "-" = trait · ["#", titre] = sous-titre
  var MENUS = [
    ["Fichier", [
      ["nouveau", "Nouveau tableau", ""], ["ouvrir", "Ouvrir…", "Ctrl+O"], ["coller-nouveau", "Nouveau depuis le presse-papiers", ""],
      ["relire", "Relire le fichier avec d'autres réglages…", ""], "-",
      ["enregistrer", "Enregistrer le CSV", "Ctrl+S"], ["exporter-csv", "Exporter en CSV…", "Ctrl+Maj+S"],
      ["exporter-xlsx", "Exporter en Excel (.xlsx)", ""], ["exporter-json", "Exporter en JSON", ""],
      ["exporter-md", "Exporter en tableau Markdown", ""], ["exporter-html", "Exporter en page HTML", ""], ["exporter-sql", "Exporter en SQL (INSERT)", ""], "-",
      ["renommer", "Renommer le tableau…", ""], ["fermer", "Fermer l'onglet", ""], ["fermer-tout", "Tout fermer", ""]
    ]],
    ["Édition", [
      ["annuler", "Annuler", "Ctrl+Z"], ["refaire", "Rétablir", "Ctrl+Y"], "-",
      ["couper", "Couper", "Ctrl+X"], ["copier", "Copier", "Ctrl+C"], ["copier-titres", "Copier avec les titres", ""], ["coller", "Coller", "Ctrl+V"], "-",
      ["rechercher", "Rechercher…", "Ctrl+F"], ["remplacer", "Remplacer…", "Ctrl+H"], ["aller", "Aller à la ligne…", "Ctrl+G"], "-",
      ["tout-selectionner", "Tout sélectionner", "Ctrl+A"], ["effacer", "Effacer le contenu", "Suppr"], ["remplir-bas", "Recopier vers le bas", "Ctrl+D"]
    ]],
    ["Affichage", [
      ["profil", "Profil de la colonne", "", "coche"], ["ajuster", "Ajuster la largeur des colonnes", ""], ["afficher-colonnes", "Afficher les colonnes masquées", ""], "-",
      ["#", "Thème"], ["theme:sombre", "Sombre", "", "radio"], ["theme:clair", "Clair", "", "radio"], ["theme:systeme", "Système", "", "radio"]
    ]],
    ["Lignes", [
      ["ligne-dessus", "Insérer au-dessus", ""], ["ligne-dessous", "Insérer au-dessous", ""], ["ligne-dupliquer", "Dupliquer", ""],
      ["ligne-monter", "Monter", ""], ["ligne-descendre", "Descendre", ""], ["ligne-supprimer", "Supprimer", "", "danger"], "-",
      ["lignes-vides", "Supprimer les lignes vides", ""], ["doublons", "Doublons…", ""],
      ["garder-affichees", "Ne garder que les lignes affichées", ""], ["supprimer-affichees", "Supprimer les lignes affichées", "", "danger"], "-",
      ["titres-monter", "Utiliser la première ligne comme titres", ""], ["titres-descendre", "Remettre les titres en première ligne", ""],
      ["numeroter", "Ajouter une colonne de numéros", ""], ["transposer", "Transposer (lignes ↔ colonnes)", ""]
    ]],
    ["Colonnes", [
      ["col-gauche", "Insérer à gauche", ""], ["col-droite", "Insérer à droite", ""], ["col-dupliquer", "Dupliquer", ""], ["col-renommer", "Renommer…", ""],
      ["col-reculer", "Déplacer vers la gauche", ""], ["col-avancer", "Déplacer vers la droite", ""], ["col-masquer", "Masquer", ""],
      ["col-supprimer", "Supprimer", "", "danger"], "-",
      ["col-calculee", "Colonne calculée…", ""], ["col-scinder", "Scinder en plusieurs colonnes…", ""], ["col-fusionner", "Fusionner les colonnes sélectionnées…", ""], "-",
      ["cols-vides", "Supprimer les colonnes vides", ""]
    ]],
    ["Données", [
      ["tri-asc", "Trier de A à Z, du plus petit au plus grand", ""], ["tri-desc", "Trier de Z à A, du plus grand au plus petit", ""],
      ["tri-multi", "Tri sur plusieurs colonnes…", ""], ["tri-aucun", "Retirer le tri", ""], ["tri-figer", "Appliquer l'ordre affiché aux données", ""], "-",
      ["filtre-col", "Filtrer la colonne…", "Alt+↓"], ["filtre-valeur", "Filtrer sur la valeur de la cellule", "Ctrl+Maj+L"], ["filtre-aucun", "Effacer les filtres", ""], "-",
      ["croise", "Tableau croisé…", ""], ["resume", "Résumé des colonnes", ""], "-",
      ["comparer", "Comparer avec un autre onglet…", ""], ["joindre", "Ramener des colonnes d'un autre onglet…", ""], ["empiler", "Ajouter les lignes d'un autre onglet…", ""]
    ]],
    ["Transformer", [
      ["t-trim", "Retirer les espaces au début et à la fin", ""], ["t-espaces", "Réduire les espaces multiples", ""],
      ["t-maj", "MAJUSCULES", ""], ["t-min", "minuscules", ""], ["t-propre", "Première Lettre En Majuscule", ""], ["t-accents", "Retirer les accents", ""], "-",
      ["t-point", "Nombres : virgule → point", ""], ["t-virgule", "Nombres : point → virgule", ""], ["t-milliers", "Nombres : retirer les séparateurs de milliers", ""],
      ["t-arrondir", "Nombres : arrondir…", ""], ["t-calcul", "Nombres : multiplier, diviser, ajouter…", ""], "-",
      ["t-date-iso", "Dates → 2026-11-21", ""], ["t-date-ch", "Dates → 21.11.2026", ""], "-",
      ["t-affixe", "Ajouter un texte devant ou derrière…", ""], ["t-zeros", "Compléter avec des zéros…", ""],
      ["t-vides-dessus", "Remplir les vides avec la valeur du dessus", ""], ["t-vides-valeur", "Remplir les vides avec une valeur…", ""]
    ]],
    ["Aide", [["raccourcis", "Raccourcis et astuces", ""], ["a-propos", "À propos de CSV Studio", ""]]]
  ];
  var LIBELLES = {};
  MENUS.forEach(function(m){ m[1].forEach(function(i){ if (Array.isArray(i) && i[0] !== "#") LIBELLES[i[0]] = i; }); });

  function htmlItems(items){
    return items.map(function(i){
      if (i === "-") return "<hr>";
      if (typeof i === "string") i = LIBELLES[i];
      if (i[0] === "#") return '<div class="mb-sous">' + esc(i[1]) + "</div>";
      var role = i[3] === "radio" ? "menuitemradio" : i[3] === "coche" ? "menuitemcheckbox" : "menuitem";
      return '<button type="button" role="' + role + '" data-cmd="' + i[0] + '"' + (i[3] === "danger" ? ' class="danger"' : "") + "><span>" + esc(i[1]) + "</span><kbd>" + esc(i[2] || "") + "</kbd></button>";
    }).join("");
  }
  el.mb.innerHTML = MENUS.map(function(m){
    return '<div class="mb-gr"><button type="button" class="mb-titre" role="menuitem" aria-haspopup="true" aria-expanded="false">' + m[0] + '</button><div class="mb-liste" role="menu" hidden>' + htmlItems(m[1]) + "</div></div>";
  }).join("");

  var menuOuvert = null;
  // Commandes indisponibles selon l'état, et libellés qui en dépendent
  function preparerItems(racine){
    var s = D ? D.sel : null, plusieurs = docs.length > 1, q = D ? rect() : null;
    [].forEach.call(racine.querySelectorAll("[data-cmd]"), function(b){
      var cmd = b.getAttribute("data-cmd"), off = false, sp = b.querySelector("span");
      if (cmd === "annuler"){ off = !D.annuler.length; sp.textContent = "Annuler" + (off ? "" : " : " + D.annuler[D.annuler.length - 1].lib); }
      else if (cmd === "refaire"){ off = !D.refaire.length; sp.textContent = "Rétablir" + (off ? "" : " : " + D.refaire[D.refaire.length - 1].lib); }
      else if (cmd === "relire") off = !D.tampon;
      else if (cmd === "comparer" || cmd === "joindre" || cmd === "empiler") off = !plusieurs;
      else if (cmd === "tri-aucun" || cmd === "tri-figer") off = !D.tri.length;
      else if (cmd === "filtre-aucun") off = !aFiltre();
      else if (cmd === "garder-affichees" || cmd === "supprimer-affichees") off = !aFiltre();
      else if (cmd === "afficher-colonnes") off = D.vc.length === D.cols.length;
      else if (cmd === "col-fusionner") off = q.c1 === q.c0;
      else if (cmd === "ligne-monter" || cmd === "ligne-descendre") off = vueModifiee();
      else if (cmd === "profil") b.setAttribute("aria-checked", String(profilOuvert));
      else if (cmd.indexOf("theme:") === 0) b.setAttribute("aria-checked", String((lireReglage("csv.theme") || "sombre") === cmd.slice(6)));
      b.disabled = off;
    });
    void s;
  }
  function fermerMenus(){
    if (!menuOuvert) return;
    menuOuvert.querySelector(".mb-titre").setAttribute("aria-expanded", "false");
    menuOuvert.querySelector(".mb-liste").hidden = true;
    menuOuvert = null;
  }
  function ouvrirMenu(gr){
    if (edition) validerEdition();
    fermerFlottants();
    menuOuvert = gr;
    var liste = gr.querySelector(".mb-liste");
    preparerItems(liste);
    gr.querySelector(".mb-titre").setAttribute("aria-expanded", "true");
    liste.hidden = false;
    liste.style.left = "0";
    var b = liste.getBoundingClientRect();
    if (b.right > window.innerWidth - 8) liste.style.left = (window.innerWidth - 8 - b.right) + "px";
  }
  el.mb.addEventListener("click", function(e){
    var t = e.target.closest(".mb-titre"), b = e.target.closest("[data-cmd]");
    if (t){ var gr = t.parentNode; if (menuOuvert === gr) fermerMenus(); else ouvrirMenu(gr); return; }
    if (b && !b.disabled) executer(b.getAttribute("data-cmd"));
  });
  el.mb.addEventListener("mouseover", function(e){
    var t = e.target.closest(".mb-titre");
    if (t && menuOuvert && menuOuvert !== t.parentNode) ouvrirMenu(t.parentNode);
  });
  document.addEventListener("mousedown", function(e){
    if (menuOuvert && !menuOuvert.contains(e.target)) fermerMenus();
    if (!el.ctx.hidden && !el.ctx.contains(e.target)) el.ctx.hidden = true;
    if (!el.pop.hidden && !el.pop.contains(e.target) && !e.target.closest("[data-menu-col]")) el.pop.hidden = true;
  });
  window.addEventListener("blur", fermerFlottants);
  function fermerFlottants(){ fermerMenus(); el.ctx.hidden = true; el.pop.hidden = true; }

  function placer(boite, x, y){
    boite.style.left = "0px"; boite.style.top = "0px";
    var b = boite.getBoundingClientRect();
    boite.style.left = Math.max(8, Math.min(x, window.innerWidth - b.width - 8)) + "px";
    boite.style.top = Math.max(8, Math.min(y, window.innerHeight - b.height - 8)) + "px";
  }
  function ouvrirCtx(x, y, titre, items){
    fermerFlottants();
    el.ctx.innerHTML = (titre ? '<div class="ctx-titre">' + esc(titre) + "</div>" : "") + htmlItems(items);
    preparerItems(el.ctx);
    el.ctx.hidden = false;
    placer(el.ctx, x, y);
  }
  el.ctx.addEventListener("click", function(e){
    var b = e.target.closest("[data-cmd]");
    if (b && !b.disabled) executer(b.getAttribute("data-cmd"));
  });
  function menuCellules(x, y){
    ouvrirCtx(x, y, "", ["couper", "copier", "copier-titres", "coller", "effacer", "-", "filtre-valeur", "tri-asc", "tri-desc", "-", "ligne-dessus", "ligne-dessous", "ligne-dupliquer", "ligne-supprimer", "-", "remplir-bas", "t-trim"]);
  }
  el.corps.addEventListener("contextmenu", function(e){
    if (!D || e.target === el.edit) return;
    e.preventDefault();
    menuCellules(e.clientX, e.clientY);
  });
  el.nums.addEventListener("contextmenu", function(e){
    if (!D) return;
    e.preventDefault();
    var q = rect();
    ouvrirCtx(e.clientX, e.clientY, q.r1 > q.r0 ? pluriel(q.r1 - q.r0 + 1, "ligne") : "Ligne " + fmtN((D.vue[q.r0] || 0) + 1),
      ["ligne-dessus", "ligne-dessous", "ligne-dupliquer", "ligne-monter", "ligne-descendre", "-", "couper", "copier", "coller", "-", "ligne-supprimer"]);
  });
  el.tetes.addEventListener("contextmenu", function(e){
    if (!D) return;
    e.preventDefault();
    var q = rect();
    ouvrirCtx(e.clientX, e.clientY, q.c1 > q.c0 ? pluriel(q.c1 - q.c0 + 1, "colonne") : D.cols[colActive()].nom,
      ["tri-asc", "tri-desc", "filtre-col", "-", "col-renommer", "col-gauche", "col-droite", "col-dupliquer", "col-reculer", "col-avancer", "col-masquer", "-",
       "col-calculee", "col-scinder", "col-fusionner", "-", "copier", "col-supprimer"]);
  });
  el.onglets.addEventListener("click", function(e){
    var x = e.target.closest("[data-fermer]"), o = e.target.closest("[data-doc]");
    if (e.target.closest("[data-plus]")){ el.fichier.click(); return; }
    if (x){ var d = trouverDoc(+x.getAttribute("data-fermer")); if (d) fermerDoc(d); return; }
    if (o){ var d2 = trouverDoc(+o.getAttribute("data-doc")); if (d2 && d2 !== D) activer(d2); }
  });
  el.onglets.addEventListener("auxclick", function(e){
    var o = e.target.closest("[data-doc]");
    if (o && e.button === 1){ e.preventDefault(); var d = trouverDoc(+o.getAttribute("data-doc")); if (d) fermerDoc(d); }
  });
  el.onglets.addEventListener("dblclick", function(e){ if (e.target.closest("[data-doc]")) executer("renommer"); });
  function trouverDoc(n){ for (var i = 0; i < docs.length; i++) if (docs[i].id === n) return docs[i]; return null; }
  el.stFormat.addEventListener("click", function(){ executer("exporter-csv"); });

  function executer(cmd){
    fermerFlottants();
    if (edition) validerEdition();
    var p = cmd.indexOf(":"), nom = p < 0 ? cmd : cmd.slice(0, p), arg = p < 0 ? null : cmd.slice(p + 1);
    var fn = CMD[nom];
    if (!fn) return;
    try {
      var r = fn(arg);
      if (r && typeof r.then === "function") r.catch(function(e){ etat(e.message || String(e), true); });
    } catch (e){ etat(e.message || String(e), true); if (window.console) console.error(e); }
    if (D && !document.querySelector("dialog[open]") && el.cherche.hidden && el.pop.hidden) el.grille.focus({ preventScroll: true });
  }

  // ====================================================================================================
  // Fenêtres
  // ====================================================================================================
  // o = { titre, html, ok, large, surOk(dlg) → false pour rester ouverte (peut être asynchrone), sansAnnuler, pret(dlg) }
  function fenetre(o){
    fermerFlottants();
    var d = document.createElement("dialog");
    if (o.large) d.className = "large";
    d.innerHTML = '<form method="dialog"><h2>' + esc(o.titre) + '</h2><div class="fen-corps">' + o.html + '</div><p class="fen-erreur" role="alert" hidden></p>' +
      '<div class="actions">' + (o.sansAnnuler ? "" : '<button type="button" class="btn" data-annuler>Annuler</button>') + '<button type="submit" class="btn plein">' + esc(o.ok || "OK") + "</button></div></form>";
    var err = d.querySelector(".fen-erreur");
    d.querySelector("form").addEventListener("submit", function(e){
      e.preventDefault();
      err.hidden = true;
      Promise.resolve().then(function(){ return o.surOk ? o.surOk(d) : true; }).then(function(r){ if (r !== false) d.close(); })
        .catch(function(x){ err.textContent = x.message || String(x); err.hidden = false; });
    });
    var an = d.querySelector("[data-annuler]");
    if (an) an.addEventListener("click", function(){ d.close(); });
    d.addEventListener("close", function(){ d.remove(); if (D) el.grille.focus({ preventScroll: true }); });
    document.body.appendChild(d);
    d.showModal();
    if (o.pret) o.pret(d);
    var premier = d.querySelector("[data-n]");
    if (premier){ premier.focus(); if (premier.select && premier.type !== "checkbox") premier.select(); }
    return d;
  }
  function lg(label, interieur){ return '<label class="lg"><span>' + esc(label) + "</span>" + interieur + "</label>"; }
  function hSel(n, opts, val){
    return '<select class="champ" data-n="' + n + '">' + opts.map(function(o){
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
  }
  function hTxt(n, val, indice, type){
    return '<input class="champ" data-n="' + n + '" type="' + (type || "text") + '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(indice || "") + '" autocomplete="off" spellcheck="false">';
  }
  function hCoche(n, label, coche){ return '<label class="coche"><input type="checkbox" data-n="' + n + '"' + (coche ? " checked" : "") + "><span>" + esc(label) + "</span></label>"; }
  function champ(d, n){ return d.querySelector('[data-n="' + n + '"]'); }
  function val(d, n){ var e = champ(d, n); return e.type === "checkbox" ? e.checked : e.value; }
  function optsCols(vide){
    var o = D.cols.map(function(c, i){ return [i, c.nom]; });
    if (vide != null) o.unshift(["", vide]);
    return o;
  }
  function optsDocs(){ return docs.filter(function(d){ return d !== D; }).map(function(d){ return [d.id, d.nom]; }); }
  // Une seule question
  function saisir(titre, label, defaut, suite, o){
    o = o || {};
    fenetre({ titre: titre, ok: o.ok, html: lg(label, hTxt("v", defaut, o.indice, o.type)) + (o.note ? '<p class="note">' + esc(o.note) + "</p>" : ""),
      surOk: function(d){ return suite(val(d, "v")); } });
  }
  function message(titre, html, large){ fenetre({ titre: titre, html: html, sansAnnuler: true, ok: "Fermer", large: large }); }

  var SEPS = [["auto", "Automatique"], ["pv", "Point-virgule  ;"], ["v", "Virgule  ,"], ["tab", "Tabulation"], ["barre", "Barre  |"], ["espace", "Espace"], ["autre", "Autre…"]];
  function sepVersCode(s){ return s === ";" ? "pv" : s === "," ? "v" : s === "\t" ? "tab" : s === "|" ? "barre" : s === " " ? "espace" : "autre"; }
  function codeVersSep(c, autre){
    if (c === "pv") return ";"; if (c === "v") return ","; if (c === "tab") return "\t"; if (c === "barre") return "|"; if (c === "espace") return " ";
    if (c === "autre"){ if (!autre) throw new Error("Indique le caractère séparateur."); return autre.charAt(0); }
    return null;
  }

  // ====================================================================================================
  // Menu de colonne : tri, condition, liste des valeurs
  // ====================================================================================================
  function ouvrirMenuCol(c){
    if (!D || D.vc[c] == null) return;
    fermerFlottants();
    var ci = D.vc[c], col = D.cols[ci], ancien = D.filtres[col.id];
    var f = ancien ? { op: ancien.op, a: ancien.a, b: ancien.b, mode: ancien.mode, ens: new Set(ancien.ens) } : { op: "", a: "", b: "", mode: null, ens: new Set() };
    // valeurs de la colonne parmi les lignes que les autres filtres laissent passer
    var cpt = new Map(), idx = lignesFiltrees(col.id), i, v;
    for (i = 0; i < idx.length; i++){ v = D.lignes[idx[i]][ci]; cpt.set(v, (cpt.get(v) || 0) + 1); }
    var valeurs = Array.from(cpt.keys()).sort(C.comparer);
    el.pop.innerHTML = '<div class="pop-titre">' + esc(col.nom) + "<small>" + nomType(col.type) + " · " + pluriel(valeurs.length, "valeur") + "</small></div>" +
      '<div class="pop-rang"><button type="button" class="btn petit" data-a="asc">▲ Croissant</button><button type="button" class="btn petit" data-a="desc">▼ Décroissant</button></div>' +
      hSel("op", OPS, f.op) + '<div class="pop-rang" data-bornes>' + hTxt("a", f.a, "valeur") + hTxt("b", f.b, "et") + "</div>" +
      hTxt("q", "", "Chercher dans les valeurs…", "search") +
      '<div class="pop-liens"><button type="button" data-a="tout">Tout cocher</button><button type="button" data-a="rien">Tout décocher</button></div>' +
      '<div class="pop-vals" data-vals></div>' +
      '<div class="pop-rang"><button type="button" class="btn" data-a="effacer">Effacer</button><button type="button" class="btn plein" data-a="ok">Appliquer</button></div>';
    var pop = el.pop, selOp = champ(pop, "op"), chA = champ(pop, "a"), chB = champ(pop, "b"), chQ = champ(pop, "q"), boite = pop.querySelector("[data-vals]"), montrees = [];
    function coche(x){ return f.mode === "exclus" ? !f.ens.has(x) : f.mode === "inclus" ? f.ens.has(x) : true; }
    function cocher(x, oui){
      if (f.mode === null){ if (oui) return; f.mode = "exclus"; f.ens = new Set(); }
      if (f.mode === "exclus"){ if (oui) f.ens.delete(x); else f.ens.add(x); }
      else if (oui) f.ens.add(x); else f.ens.delete(x);
    }
    function lister(){
      var q = chQ.value.toLowerCase();
      montrees = q ? valeurs.filter(function(x){ return x.toLowerCase().indexOf(q) >= 0; }) : valeurs;
      var h = "", n = Math.min(montrees.length, 400);
      for (var k = 0; k < n; k++){
        var x = montrees[k];
        h += '<label><input type="checkbox" data-k="' + k + '"' + (coche(x) ? " checked" : "") + "><span>" + (x === "" ? "(vide)" : esc(x.length > 80 ? x.slice(0, 80) + "…" : x)) + "</span><em>" + fmtN(cpt.get(x)) + "</em></label>";
      }
      if (!montrees.length) h = '<div class="note">Aucune valeur.</div>';
      else if (montrees.length > n) h += '<div class="note">… et ' + fmtN(montrees.length - n) + " autres : précise la recherche.</div>";
      boite.innerHTML = h;
    }
    function bornes(){
      var op = selOp.value, sans = !op || op === "vide" || op === "plein";
      pop.querySelector("[data-bornes]").hidden = sans;
      chB.hidden = op !== "entre";
    }
    function appliquer(){
      f.op = selOp.value; f.a = chA.value; f.b = chB.value;
      if (f.op === "regex"){ try { new RegExp(f.a); } catch (e){ etat("Expression régulière incorrecte : " + e.message, true); return; } }
      if (f.op && f.op !== "vide" && f.op !== "plein" && f.a === "" && f.op !== "egal" && f.op !== "diff") f.op = "";
      if (f.mode === "exclus" && !f.ens.size) f.mode = null;
      if (filtreActif(f)) D.filtres[col.id] = f; else delete D.filtres[col.id];
      pop.hidden = true;
      recalcVue();
      el.grille.focus({ preventScroll: true });
    }
    pop.onclick = function(e){
      var a = e.target.closest("[data-a]");
      if (!a) return;
      a = a.getAttribute("data-a");
      if (a === "asc" || a === "desc"){ D.tri = [{ id: col.id, sens: a === "asc" ? 1 : -1 }]; pop.hidden = true; recalcVue(); el.grille.focus({ preventScroll: true }); }
      else if (a === "tout"){ if (chQ.value) montrees.forEach(function(x){ cocher(x, true); }); else { f.mode = null; f.ens = new Set(); } lister(); }
      else if (a === "rien"){ if (chQ.value) montrees.forEach(function(x){ cocher(x, false); }); else { f.mode = "inclus"; f.ens = new Set(); } lister(); }
      else if (a === "effacer"){ delete D.filtres[col.id]; pop.hidden = true; recalcVue(); el.grille.focus({ preventScroll: true }); }
      else if (a === "ok") appliquer();
    };
    boite.onchange = function(e){
      var k = e.target.getAttribute("data-k");
      if (k != null) cocher(montrees[+k], e.target.checked);
    };
    chQ.oninput = lister;
    selOp.onchange = function(){ bornes(); if (!pop.querySelector("[data-bornes]").hidden) chA.focus(); };
    pop.onkeydown = function(e){
      if (e.key === "Enter" && e.target.tagName !== "BUTTON"){
        e.preventDefault();
        // Entrée dans la recherche de valeurs : ne garder que les valeurs trouvées
        if (e.target === chQ && chQ.value && montrees.length){ f.mode = "inclus"; f.ens = new Set(montrees); }
        appliquer();
      }
      e.stopPropagation();
      if (e.key === "Escape"){ pop.hidden = true; el.grille.focus({ preventScroll: true }); }
    };
    bornes(); lister();
    pop.hidden = false;
    var b = el.tetes.getBoundingClientRect();
    placer(pop, b.left + D.xs[c] - el.corps.scrollLeft, b.bottom + 2);
    chQ.focus();
  }

  // ====================================================================================================
  // Rechercher et remplacer
  // ====================================================================================================
  var ch = { quoi: id("ch-quoi"), par: id("ch-par"), casse: id("ch-casse"), entier: id("ch-entier"), regex: id("ch-regex"), portee: id("ch-portee"), compte: id("ch-compte"), ligneRempl: id("ch-rempl-ligne") };
  function ouvrirRecherche(avecRemplacer){
    if (!D) return;
    fermerFlottants();
    el.cherche.hidden = false;
    ch.ligneRempl.hidden = !avecRemplacer;
    ch.portee.value = "tout"; zoneFigee = null;
    var q = rect();
    if (q.r0 === q.r1 && q.c0 === q.c1 && D.vue.length && !ch.quoi.value){
      var v = D.lignes[D.vue[q.r0]][D.vc[q.c0]];
      if (v && v.length < 60 && v.indexOf("\n") < 0) ch.quoi.value = v;
    }
    if (q.r1 > q.r0 && !(q.r0 === 0 && q.r1 === D.vue.length - 1)){ ch.portee.value = "selection"; zoneFigee = zoneRecherche(); }
    else if (q.r1 > q.r0 && q.c0 === q.c1) ch.portee.value = "colonne";
    majRecherche();
    ch.quoi.focus(); ch.quoi.select();
  }
  function fermerRecherche(){
    el.cherche.hidden = true;
    rech = null;
    redessiner();
    if (D) el.grille.focus({ preventScroll: true });
  }
  function presse(b){ return b.getAttribute("aria-pressed") === "true"; }
  function majRecherche(){
    var q = ch.quoi.value;
    rech = null;
    if (q){
      try {
        var src = presse(ch.regex) ? q : C.echapRe(q);
        if (presse(ch.entier)) src = "^(?:" + src + ")$";
        var drap = presse(ch.casse) ? "" : "i", re = new RegExp(src, drap), reG = new RegExp(src, drap + "g"), litteral = !presse(ch.regex);
        rech = {
          test: function(v){ return re.test(v); },
          remplacer: function(v, par){ return litteral ? v.replace(reG, function(){ return par; }) : v.replace(reG, par); }
        };
        ch.quoi.style.borderColor = "";
      } catch (e){ ch.quoi.style.borderColor = "var(--rouge)"; }
    }
    compterRecherche();
    redessiner();
  }
  // Zone parcourue par la recherche : { r0, r1, cols:[positions de colonnes visibles] }
  function zoneRecherche(){
    var n = D.vue.length, q = rect(), p = ch.portee.value, cols = [], c;
    if (p === "selection"){ for (c = q.c0; c <= q.c1; c++) cols.push(c); return { r0: q.r0, r1: q.r1, cols: cols }; }
    if (p === "colonne") return { r0: 0, r1: n - 1, cols: [D.sel.ac] };
    for (c = 0; c < D.vc.length; c++) cols.push(c);
    return { r0: 0, r1: n - 1, cols: cols };
  }
  var zoneFigee = null, minuterieCompte = 0;
  function zone(){ return ch.portee.value === "selection" && zoneFigee ? zoneFigee : zoneRecherche(); }
  function compterRecherche(){
    clearTimeout(minuterieCompte);
    if (!rech || !D || !D.vue.length){ ch.compte.textContent = rech ? "0 résultat" : ""; return; }
    minuterieCompte = setTimeout(function(){
      if (!rech || !D) return;
      var z = zone(), n = 0, vus = 0, limite = 3000000, r, k, l, v;
      for (r = z.r0; r <= z.r1 && vus < limite; r++){
        l = D.lignes[D.vue[r]];
        if (!l) break;
        for (k = 0; k < z.cols.length; k++){ v = l[D.vc[z.cols[k]]]; vus++; if (v && rech.test(v)) n++; }
      }
      ch.compte.textContent = (vus >= limite ? "plus de " : "") + pluriel(n, "résultat");
    }, 160);
  }
  function chercherSuivant(sens){
    if (!rech || !D.vue.length){ return false; }
    var z = zone(), nl = z.r1 - z.r0 + 1, ncol = z.cols.length, total = nl * ncol;
    if (total <= 0) return false;
    var kr = borner(D.sel.ar, z.r0, z.r1) - z.r0, kc = z.cols.indexOf(D.sel.ac);
    if (kc < 0) kc = sens > 0 ? -1 : 0;
    var pos = kr * ncol + kc, i, p, r, c, v;
    for (i = 1; i <= total; i++){
      p = ((pos + sens * i) % total + total) % total;
      r = z.r0 + Math.floor(p / ncol); c = z.cols[p % ncol];
      v = D.lignes[D.vue[r]][D.vc[c]];
      if (v && rech.test(v)){
        if (ch.portee.value === "selection") zoneFigee = z;
        D.sel = { ar: r, ac: c, fr: r, fc: c };
        voir(r, c); redessiner(); majSelection();
        return true;
      }
    }
    etat("« " + ch.quoi.value + " » : introuvable.");
    return false;
  }
  function remplacerUn(){
    if (!rech || !D.vue.length) return;
    var s = D.sel, i = D.vue[s.ar], ci = D.vc[s.ac], v = D.lignes[i][ci];
    if (v && rech.test(v)){
      var nv = rech.remplacer(v, ch.par.value);
      if (nv !== v) modifier("Remplacer", function(){ ligneModif(i)[ci] = nv; });
    }
    chercherSuivant(1);
  }
  function remplacerTout(){
    if (!rech || !D.vue.length) return;
    var z = zone(), n = 0, par = ch.par.value, R = rech;
    modifier("Remplacer tout", function(){
      for (var r = z.r0; r <= z.r1; r++){
        var i = D.vue[r], src = D.lignes[i], l = null;
        for (var k = 0; k < z.cols.length; k++){
          var ci = D.vc[z.cols[k]], v = src[ci];
          if (!v || !R.test(v)) continue;
          var nv = R.remplacer(v, par);
          if (nv !== v){ if (!l) l = ligneModif(i); l[ci] = nv; n++; }
        }
      }
      if (!n) return false;
    });
    etat(n ? pluriel(n, "cellule modifiée", "cellules modifiées") + "." : "Aucun remplacement à faire.");
  }
  ch.quoi.addEventListener("input", function(){ zoneFigee = null; majRecherche(); });
  ch.portee.addEventListener("change", function(){ zoneFigee = ch.portee.value === "selection" ? zoneRecherche() : null; compterRecherche(); });
  [ch.casse, ch.entier, ch.regex].forEach(function(b){
    b.addEventListener("click", function(){ b.setAttribute("aria-pressed", String(!presse(b))); majRecherche(); });
  });
  id("ch-suiv").addEventListener("click", function(){ chercherSuivant(1); });
  id("ch-prec").addEventListener("click", function(){ chercherSuivant(-1); });
  id("ch-fermer").addEventListener("click", fermerRecherche);
  id("ch-un").addEventListener("click", function(){ try { remplacerUn(); } catch (e){ etat(e.message, true); } });
  id("ch-tous").addEventListener("click", function(){ try { remplacerTout(); } catch (e){ etat(e.message, true); } });
  el.cherche.addEventListener("keydown", function(e){
    if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); fermerRecherche(); }
    else if (e.key === "Enter" && e.target === ch.quoi){ e.preventDefault(); chercherSuivant(e.shiftKey ? -1 : 1); }
    else if (e.key === "Enter" && e.target === ch.par){ e.preventDefault(); remplacerUn(); }
  });

  // ====================================================================================================
  // Profil de la colonne active
  // ====================================================================================================
  var profilCle = "";
  function majProfil(){
    if (!profilOuvert || !D) return;
    var ci = colActive();
    if (ci == null || !D.vue.length){ el.profil.innerHTML = '<div class="pf-tete"><h3>Profil</h3><button type="button" class="btn nu petit" data-pf="fermer" aria-label="Fermer">✕</button></div><div class="pf-vide">Aucune donnée.</div>'; profilCle = ""; return; }
    var col = D.cols[ci], cle = D.id + "|" + col.id + "|" + revision + "|" + D.vue.length + "|" + D.rapide + "|" + JSON.stringify(D.tri);
    if (cle === profilCle) return;
    profilCle = cle;
    var n = D.vue.length, vals = new Array(n), i;
    for (i = 0; i < n; i++) vals[i] = D.lignes[D.vue[i]][ci];
    var p = C.profil(vals), h;
    function stat(t, v){ return '<div class="pf-stat"><small>' + t + "</small><b>" + v + "</b></div>"; }
    h = '<div class="pf-tete"><h3 title="' + esc(col.nom) + '">' + esc(col.nom) + '</h3><button type="button" class="btn nu petit" data-pf="fermer" aria-label="Fermer le profil">✕</button></div>' +
      '<span class="pf-type">' + nomType(p.type) + "</span>" +
      '<div class="pf-stats">' + stat("Lignes", fmtN(p.n)) + stat("Remplies", fmtN(p.remplies)) + stat("Vides", fmtN(p.vides)) + stat("Valeurs distinctes", fmtN(p.distinctes)) +
      stat("En double", fmtN(p.doublons)) + stat("Longueur", p.lmin === p.lmax ? p.lmax : p.lmin + " à " + p.lmax);
    if (p.nNum) h += stat("Somme", fmtX(p.somme)) + stat("Moyenne", fmtX(p.moyenne)) + stat("Minimum", fmtX(p.min)) + stat("Maximum", fmtX(p.max)) + stat("Médiane", fmtX(p.mediane)) + stat("Écart-type", fmtX(p.ecart));
    h += "</div>";
    if (p.nNum > 1 && p.max > p.min && p.nNum >= p.remplies * 0.6){
      var NB = 16, cases = new Array(NB).fill(0), x, plus = 0;
      for (i = 0; i < n; i++){ x = C.nombre(vals[i]); if (x === x) cases[Math.min(NB - 1, Math.floor((x - p.min) / (p.max - p.min) * NB))]++; }
      for (i = 0; i < NB; i++) if (cases[i] > plus) plus = cases[i];
      h += '<div class="pf-titre">Répartition</div><div class="pf-histo">' + cases.map(function(k){ return '<i style="height:' + Math.max(1, Math.round(k / plus * 100)) + '%" title="' + fmtN(k) + '"></i>'; }).join("") +
        '</div><div class="pf-axe"><span>' + fmtX(p.min) + "</span><span>" + fmtX(p.max) + "</span></div>";
    }
    if (p.top.length){
      h += '<div class="pf-titre">Valeurs les plus fréquentes</div>';
      var maxi = p.top[0][1];
      p.top.forEach(function(t, k){
        h += '<button type="button" class="pf-barre" data-pf="v' + k + '" title="Filtrer sur cette valeur"><i style="width:' + Math.round(t[1] / maxi * 100) + '%"></i><span>' + esc(t[0].length > 60 ? t[0].slice(0, 60) + "…" : t[0]) + "</span><em>" + fmtN(t[1]) + "</em></button>";
      });
    }
    el.profil.innerHTML = h;
    el.profil._top = p.top; el.profil._col = col.id;
  }
  el.profil.addEventListener("click", function(e){
    var b = e.target.closest("[data-pf]");
    if (!b) return;
    var a = b.getAttribute("data-pf");
    if (a === "fermer"){ executer("profil"); return; }
    var t = el.profil._top[+a.slice(1)];
    if (t){ D.filtres[el.profil._col] = { op: "", a: "", b: "", mode: "inclus", ens: new Set([t[0]]) }; recalcVue(); }
  });

  // ====================================================================================================
  // Ouverture des fichiers
  // ====================================================================================================
  function signaler(e){
    var msg = e && e.message ? e.message : String(e);
    if (D) etat(msg, true);
    else { el.erreur.innerHTML = "<b>Lecture impossible</b>" + esc(msg); el.erreur.hidden = false; }
    if (window.console) console.error(e);
  }
  function chargement(txt){
    el.chargement.hidden = !txt;
    if (txt){ el.chargementTxt.textContent = txt; el.erreur.hidden = true; if (D) etat(txt); }
  }
  // Octets d'un fichier texte → tableau. o = { encodage, sep, entete:true|false|null, sauter }
  function docDepuisTexte(nom, tampon, o){
    o = o || {};
    var dec = C.decoder(tampon, o.encodage || "auto"), t = dec.texte, k, p;
    if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
    for (k = 0; k < (o.sauter || 0); k++){ p = t.indexOf("\n"); if (p < 0){ t = ""; break; } t = t.slice(p + 1); }
    var det = C.detecter(t);
    if (det.ligneSep) t = t.slice(t.indexOf("\n") + 1);
    var sep = o.sep || det.sep, a = C.analyser(t, sep);
    if (!a.lignes.length) throw new Error("« " + nom + " » ne contient aucune ligne.");
    var avecTitres = o.entete != null ? o.entete : C.aEntete(a.lignes);
    var entete = avecTitres ? a.lignes.shift() : null;
    var enc = dec.encodage === "utf-16be" ? "utf-16le" : dec.encodage;
    var d = nouveauDoc(nom, entete, a.lignes, { sep: sep, encodage: enc, fin: det.fin === "\n" ? "\n" : "\r\n" });
    var notes = [];
    if (a.irregulieres) notes.push(pluriel(a.irregulieres, "ligne incomplète complétée", "lignes incomplètes complétées"));
    if (a.vides) notes.push(pluriel(a.vides, "ligne vide ignorée", "lignes vides ignorées"));
    d.note = notes.join(", ");
    if (tampon.byteLength <= 200 * 1048576) d.tampon = tampon;
    d.lecture = { encodage: o.encodage || "auto", sep: o.sep || null, entete: o.entete == null ? null : o.entete, sauter: o.sauter || 0 };
    return d;
  }
  async function lireTampon(nom, tampon){
    var ext = (/\.([A-Za-z0-9]+)$/.exec(nom) || ["", ""])[1].toLowerCase(), crees = [], o = new Uint8Array(tampon, 0, Math.min(4, tampon.byteLength));
    var zip = o[0] === 0x50 && o[1] === 0x4B;
    if (ext === "xls" || (o[0] === 0xD0 && o[1] === 0xCF)) throw new Error("« " + nom + " » est un ancien classeur .xls : enregistre-le en .xlsx ou en .csv depuis Excel.");
    if (ext === "xlsx" || ext === "xlsm" || zip){
      var feuilles = await C.lireXlsx(tampon);
      if (!feuilles.length) throw new Error("« " + nom + " » ne contient aucune feuille remplie.");
      feuilles.slice(0, 12).forEach(function(f){
        var entete = C.aEntete(f.lignes) && f.lignes.length > 1 ? f.lignes.shift() : null;
        crees.push(nouveauDoc(sansExt(nom) + (feuilles.length > 1 ? " · " + f.nom : "") + ".csv", entete, f.lignes));
      });
    } else if (ext === "json"){
      var j = C.lireJson(C.decoder(tampon, "auto").texte.replace(/^﻿/, ""));
      if (!j.lignes.length) throw new Error("« " + nom + " » ne contient aucun enregistrement.");
      crees.push(nouveauDoc(sansExt(nom) + ".csv", j.entete, j.lignes));
    } else crees.push(docDepuisTexte(nom, tampon));
    return crees;
  }
  async function ouvrirFichiers(liste){
    liste = [].slice.call(liste);
    if (!liste.length) return;
    for (var k = 0; k < liste.length; k++){
      var f = liste[k];
      try {
        chargement("Lecture de " + f.name + "…");
        await pause();
        var tampon = await f.arrayBuffer(), crees = await lireTampon(f.name, tampon);
        crees.forEach(ajouterDoc);
        ranger(f.name, tampon);
        var d = crees[0];
        etat(f.name + " : " + pluriel(d.lignes.length, "ligne") + ", " + pluriel(d.cols.length, "colonne") + (crees.length > 1 ? ", " + crees.length + " feuilles" : "") + (d.note ? " · " + d.note : "") + ".");
      } catch (e){ signaler(e); }
    }
    chargement("");
    el.fichier.value = "";
  }
  el.fichier.addEventListener("change", function(){ ouvrirFichiers(el.fichier.files); });
  id("choisir").addEventListener("click", function(){ el.fichier.click(); });
  id("vierge").addEventListener("click", function(){ CMD.nouveau(); });
  id("exemple").addEventListener("click", function(){ ajouterDoc(docExemple()); etat("Tableau d'exemple : des données inventées pour essayer les outils."); });

  // glisser-déposer sur toute la fenêtre
  var survol = 0;
  function aDesFichiers(e){ return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
  window.addEventListener("dragenter", function(e){ if (aDesFichiers(e)){ e.preventDefault(); survol++; document.body.classList.add("glisse"); } });
  window.addEventListener("dragover", function(e){ if (aDesFichiers(e)){ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
  window.addEventListener("dragleave", function(e){ if (aDesFichiers(e)){ survol = Math.max(0, survol - 1); if (!survol) document.body.classList.remove("glisse"); } });
  window.addEventListener("drop", function(e){
    if (!aDesFichiers(e)) return;
    e.preventDefault();
    survol = 0; document.body.classList.remove("glisse");
    ouvrirFichiers(e.dataTransfer.files);
  });
  window.addEventListener("beforeunload", function(e){
    if (docs.some(function(d){ return d.modifie; })){ e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- Récents : la liste dans localStorage, les fichiers dans IndexedDB ----------
  var MAX_RECENTS = 8, MAX_RECENT_OCTETS = 40 * 1048576;
  function base(){
    return new Promise(function(ok, ko){
      if (!window.indexedDB){ ko(new Error("IndexedDB absent")); return; }
      var r = indexedDB.open("csv-studio", 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore("fichiers"); };
      r.onsuccess = function(){ ok(r.result); };
      r.onerror = function(){ ko(r.error); };
    });
  }
  function operation(mode, fn){
    return base().then(function(bd){
      return new Promise(function(ok, ko){
        var t = bd.transaction("fichiers", mode), req = fn(t.objectStore("fichiers"));
        t.oncomplete = function(){ bd.close(); ok(req ? req.result : null); };
        t.onerror = t.onabort = function(){ bd.close(); ko(t.error); };
      });
    });
  }
  function recents(){ try { var l = JSON.parse(lireReglage("csv.recents") || "[]"); return Array.isArray(l) ? l : []; } catch (e){ return []; } }
  function ranger(nom, tampon){
    if (tampon.byteLength > MAX_RECENT_OCTETS) return;
    var cle = nom + "|" + tampon.byteLength, l = recents().filter(function(r){ return r.cle !== cle; });
    l.unshift({ cle: cle, nom: nom, taille: tampon.byteLength, date: Date.now() });
    var trop = l.splice(MAX_RECENTS);
    operation("readwrite", function(s){ trop.forEach(function(r){ s.delete(r.cle); }); return s.put(tampon, cle); })
      .then(function(){ garder("csv.recents", JSON.stringify(l)); if (!D) afficherRecents(); }, function(){});
  }
  function afficherRecents(){
    var l = recents();
    el.recents.hidden = !l.length;
    el.recentsListe.innerHTML = l.map(function(r, i){
      var d = new Date(r.date), date = ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." + d.getFullYear();
      return '<li><button type="button" class="recent" data-recent="' + i + '"><span class="r-nom">' + esc(r.nom) + '</span><span class="r-info">' + octets(r.taille) + " · " + date + "</span></button>" +
        '<button type="button" class="r-x" data-oublier="' + i + '" title="Retirer de la liste" aria-label="Retirer ' + esc(r.nom) + ' de la liste">×</button></li>';
    }).join("");
  }
  el.recents.addEventListener("click", function(e){
    var o = e.target.closest("[data-oublier]"), b = e.target.closest("[data-recent]"), l = recents(), r;
    if (o){
      r = l[+o.getAttribute("data-oublier")];
      if (!r) return;
      garder("csv.recents", JSON.stringify(l.filter(function(z){ return z.cle !== r.cle; })));
      operation("readwrite", function(s){ return s.delete(r.cle); }).catch(function(){});
      afficherRecents();
      return;
    }
    if (!b) return;
    r = l[+b.getAttribute("data-recent")];
    if (!r) return;
    chargement("Lecture de " + r.nom + "…");
    operation("readonly", function(s){ return s.get(r.cle); }).then(function(tampon){
      if (!tampon) throw new Error("« " + r.nom + " » n'est plus dans la mémoire du navigateur : rouvre le fichier.");
      return lireTampon(r.nom, tampon).then(function(crees){ crees.forEach(ajouterDoc); ranger(r.nom, tampon); });
    }).catch(signaler).then(function(){ chargement(""); });
  });

  // Tableau d'exemple : une nomenclature inventée, pour essayer les outils sans fichier
  function docExemple(){
    var graine = 7;
    function alea(){ graine = (graine * 16807) % 2147483647; return graine / 2147483647; }
    function choix(t){ return t[Math.floor(alea() * t.length)]; }
    var types = [["Poutre", ["30x50", "30x60", "40x70", "25x45"], "PO"], ["Poteau", ["30x30", "40x40", "50x50", "Ø40"], "PT"], ["Voile", ["ép. 20", "ép. 25", "ép. 30"], "VO"], ["Dalle", ["ép. 22", "ép. 25", "ép. 28"], "DA"], ["Semelle", ["120x120x40", "160x160x50", "200x200x60"], "SE"]];
    var niveaux = ["Sous-sol", "Rez", "Étage 1", "Étage 2", "Étage 3", "Toiture"], betons = ["C25/30", "C30/37", "C30/37", "C35/45"], statuts = ["Validé", "Validé", "À contrôler", "En étude", ""];
    var lignes = [], compte = {};
    for (var i = 0; i < 260; i++){
      var t = choix(types), niv = choix(niveaux), n = (compte[t[2]] = (compte[t[2]] || 0) + 1);
      var long = t[0] === "Dalle" || t[0] === "Semelle" ? "" : (2 + alea() * 6).toFixed(2), vol = (0.2 + alea() * (t[0] === "Dalle" ? 40 : 4)).toFixed(3);
      var jour = 1 + Math.floor(alea() * 28), mois = 1 + Math.floor(alea() * 11);
      lignes.push([t[2] + "-" + ("00" + n).slice(-3), t[0], choix(t[1]), choix(betons), niv, long, vol, String(Math.round(vol * (80 + alea() * 90))), ("0" + jour).slice(-2) + "." + ("0" + mois).slice(-2) + ".2026", choix(statuts)]);
    }
    lignes.push(lignes[3].slice(), lignes[17].slice());           // deux doublons, pour l'outil « Doublons »
    var d = nouveauDoc("Exemple nomenclature.csv", ["Repère", "Type", "Section", "Béton", "Niveau", "Longueur (m)", "Volume (m3)", "Armature (kg)", "Date", "Statut"], lignes);
    return d;
  }

  // ====================================================================================================
  // Exports
  // ====================================================================================================
  function telecharger(nom, blob){
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 60000);
  }
  // Données à écrire. o.affichees : seulement les lignes affichées (sinon toutes, dans l'ordre du tri s'il y en a un) ;
  // o.visibles : sans les colonnes masquées ; o.selection : seulement la sélection.
  function donnees(o){
    o = o || {};
    var cols, idx, q = rect(), L = D.lignes;
    if (o.selection){ cols = colsSel(); idx = lignesSel(); }
    else {
      cols = o.visibles ? D.vc.slice() : tousIndices(D.cols.length);
      idx = o.affichees ? D.vue : (D.tri.length ? trier(tousIndices(L.length)) : null);
    }
    var entier = cols.length === D.cols.length && !o.selection, lignes;
    if (entier) lignes = idx ? idx.map(function(i){ return L[i]; }) : L;
    else lignes = (idx || tousIndices(L.length)).map(function(i){ var l = L[i]; return cols.map(function(c){ return l[c]; }); });
    void q;
    return { entete: cols.map(function(c){ return D.cols[c].nom; }), lignes: lignes, types: cols.map(function(c){ return D.cols[c].type; }), largeurs: cols.map(function(c){ return D.cols[c].l; }) };
  }
  function ecrireCsv(nom, x, format, avecTitres, guillemets){
    var morceaux = C.ecrire(avecTitres ? x.entete : null, x.lignes, { sep: format.sep, fin: format.fin, guillemets: guillemets || "besoin" });
    var r = C.versOctets(morceaux, format.encodage);
    telecharger(nom, new Blob(r.octets, { type: "text/csv" }));
    return r.perdus;
  }
  function nomExport(ext){ return sansExt(D.nom) + "." + ext; }
  function portee(d){ return { affichees: val(d, "portee") === "affichees", selection: val(d, "portee") === "selection", visibles: val(d, "visibles") }; }
  function htmlPortee(){
    var q = rect(), plusieurs = q.r1 > q.r0 || q.c1 > q.c0, opts = [["tout", "Toutes les lignes (" + fmtN(D.lignes.length) + ")"]];
    if (aFiltre()) opts.push(["affichees", "Lignes affichées (" + fmtN(D.vue.length) + ")"]);
    if (plusieurs) opts.push(["selection", "Sélection (" + fmtN(q.r1 - q.r0 + 1) + " × " + fmtN(q.c1 - q.c0 + 1) + ")"]);
    return lg("Lignes à écrire", hSel("portee", opts, aFiltre() ? "affichees" : "tout")) +
      (D.vc.length < D.cols.length ? hCoche("visibles", "Sans les colonnes masquées", true) : '<input type="hidden" data-n="visibles" value="">');
  }
  function exporterAutre(titre, ext, type, fabrique){
    fenetre({ titre: titre, ok: "Exporter", html: htmlPortee(), surOk: function(d){
      var p = portee(d);
      p.visibles = p.visibles === true;
      var x = donnees(p), contenu = fabrique(x);
      return Promise.resolve(contenu).then(function(c){
        telecharger(nomExport(ext), c instanceof Blob ? c : new Blob([c], { type: type }));
        etat(nomExport(ext) + " : " + pluriel(x.lignes.length, "ligne") + " exportée" + (x.lignes.length > 1 ? "s" : "") + ".");
      });
    } });
  }

  // ====================================================================================================
  // Commandes
  // ====================================================================================================
  var CMD = {};

  // ---------- Fichier ----------
  CMD.nouveau = function(){
    var lignes = [];
    for (var i = 0; i < 20; i++) lignes.push(["", "", "", ""]);
    ajouterDoc(nouveauDoc("Sans titre " + numDoc + ".csv", ["Colonne 1", "Colonne 2", "Colonne 3", "Colonne 4"], lignes));
    etat("Nouveau tableau : double-clique un titre pour le renommer, tape dans une cellule pour la remplir.");
  };
  CMD.ouvrir = function(){ el.fichier.click(); };
  CMD["coller-nouveau"] = function(){ lirePressePapiers(function(t){ if (t) docDepuisPressePapiers(t); else etat("Le presse-papiers est vide.", true); }); };
  CMD.relire = function(){
    if (!D.tampon){ etat("Ce tableau ne vient pas d'un fichier texte : rien à relire.", true); return; }
    var le = D.lecture || {}, cible = D;
    fenetre({ titre: "Relire le fichier", ok: "Relire",
      html: '<div class="rang">' + lg("Séparateur", hSel("sep", SEPS, le.sep ? sepVersCode(le.sep) : "auto")) + lg("Autre séparateur", hTxt("autre", le.sep && sepVersCode(le.sep) === "autre" ? le.sep : "", "un caractère")) + "</div>" +
        '<div class="rang">' + lg("Encodage", hSel("enc", [["auto", "Automatique"], ["utf-8", "UTF-8"], ["windows-1252", "Windows-1252 (ANSI)"], ["utf-16le", "UTF-16 LE"], ["utf-16be", "UTF-16 BE"], ["ibm850", "DOS 850"], ["macintosh", "Mac Roman"]], le.encodage || "auto")) +
        lg("Première ligne", hSel("ent", [["auto", "Automatique"], ["oui", "Titres des colonnes"], ["non", "Données"]], le.entete == null ? "auto" : le.entete ? "oui" : "non")) + "</div>" +
        lg("Lignes à ignorer au début du fichier", hTxt("sauter", le.sauter || 0, "0", "number")) +
        (cible.modifie ? '<p class="note">Les modifications non enregistrées de cet onglet seront perdues.</p>' : ""),
      surOk: function(d){
        var e = val(d, "ent"), neuf = docDepuisTexte(cible.nom, cible.tampon, { sep: codeVersSep(val(d, "sep"), val(d, "autre")), encodage: val(d, "enc"),
          entete: e === "auto" ? null : e === "oui", sauter: Math.max(0, parseInt(val(d, "sauter"), 10) || 0) });
        var k = docs.indexOf(cible);
        if (k < 0) return;
        docs[k] = neuf;
        D = null;
        activer(neuf);
        etat("Fichier relu : " + pluriel(neuf.lignes.length, "ligne") + ", " + pluriel(neuf.cols.length, "colonne") + ", séparateur " + nomSep(neuf.format.sep) + ", " + C.nomEncodage(neuf.format.encodage) + ".");
      } });
  };
  CMD.enregistrer = function(){
    var nom = nomExport(/\.(tsv|txt|tab|dat)$/i.test(D.nom) ? /\.([A-Za-z0-9]+)$/.exec(D.nom)[1] : "csv");
    var perdus = ecrireCsv(nom, donnees({}), D.format, !D.sansEntete);
    D.modifie = false;
    majBarre(); majOnglets();
    etat(nom + " enregistré dans les téléchargements (" + pluriel(D.lignes.length, "ligne") + ", " + nomSep(D.format.sep) + ", " + C.nomEncodage(D.format.encodage) + ")" +
      (perdus ? " · " + pluriel(perdus, "caractère") + " hors Windows-1252 remplacé" + (perdus > 1 ? "s" : "") + " par « ? »" : "") + ".", perdus > 0);
  };
  CMD["exporter-csv"] = function(){
    var f = D.format;
    fenetre({ titre: "Exporter en CSV", ok: "Exporter",
      html: '<div class="rang">' + lg("Séparateur", hSel("sep", SEPS.slice(1), sepVersCode(f.sep))) + lg("Autre séparateur", hTxt("autre", sepVersCode(f.sep) === "autre" ? f.sep : "", "un caractère")) + "</div>" +
        '<div class="rang">' + lg("Encodage", hSel("enc", C.ENCODAGES, f.encodage)) + lg("Fins de ligne", hSel("fin", [["crlf", "Windows (CRLF)"], ["lf", "Unix (LF)"]], f.fin === "\n" ? "lf" : "crlf")) + "</div>" +
        '<div class="rang">' + lg("Guillemets", hSel("guil", [["besoin", "Seulement si nécessaire"], ["toujours", "Autour de chaque valeur"]], "besoin")) + lg("Nom du fichier", hTxt("nom", nomExport("csv"))) + "</div>" +
        htmlPortee() + '<div class="coches">' + hCoche("titres", "Écrire la ligne de titres", !D.sansEntete) + hCoche("retenir", "Retenir ces réglages pour « Enregistrer »", true) + "</div>",
      surOk: function(d){
        var format = { sep: codeVersSep(val(d, "sep"), val(d, "autre")), encodage: val(d, "enc"), fin: val(d, "fin") === "lf" ? "\n" : "\r\n" }, p = portee(d);
        p.visibles = p.visibles === true;
        var x = donnees(p), nom = val(d, "nom").trim() || nomExport("csv");
        var perdus = ecrireCsv(nom, x, format, val(d, "titres"), val(d, "guil"));
        if (val(d, "retenir")){ D.format = format; majBarre(); }
        etat(nom + " : " + pluriel(x.lignes.length, "ligne") + " exportée" + (x.lignes.length > 1 ? "s" : "") + (perdus ? " · " + pluriel(perdus, "caractère") + " hors Windows-1252 remplacé par « ? »" : "") + ".", perdus > 0);
      } });
  };
  CMD["exporter-xlsx"] = function(){
    exporterAutre("Exporter en Excel", "xlsx", "", function(x){
      return C.xlsx({ nom: sansExt(D.nom), entete: D.sansEntete ? null : x.entete, lignes: x.lignes, types: x.types, largeurs: x.largeurs }).then(function(r){
        if (r.tronque) etat("Excel s'arrête à 1 048 576 lignes : le classeur est tronqué.", true);
        return r.blob;
      });
    });
  };
  CMD["exporter-json"] = function(){
    exporterAutre("Exporter en JSON", "json", "application/json", function(x){
      var cles = x.entete, num = x.types.map(numerique), parts = ["[\n"];
      x.lignes.forEach(function(l, i){
        var o = {};
        for (var c = 0; c < cles.length; c++){
          var v = l[c], n;
          if (num[c] && v !== "" && !C.codeTexte(v) && isFinite(n = C.nombre(v))) o[cles[c]] = n;
          else o[cles[c]] = v;
        }
        parts.push("  " + JSON.stringify(o) + (i < x.lignes.length - 1 ? ",\n" : "\n"));
      });
      parts.push("]\n");
      return new Blob(parts, { type: "application/json" });
    });
  };
  CMD["exporter-md"] = function(){
    exporterAutre("Exporter en tableau Markdown", "md", "text/markdown", function(x){
      function c(v){ return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>"); }
      var parts = ["| " + x.entete.map(c).join(" | ") + " |\n", "|" + x.types.map(function(t){ return numerique(t) ? " ---: |" : " --- |"; }).join("") + "\n"];
      x.lignes.forEach(function(l){ parts.push("| " + l.map(c).join(" | ") + " |\n"); });
      return new Blob(parts, { type: "text/markdown" });
    });
  };
  CMD["exporter-html"] = function(){
    exporterAutre("Exporter en page HTML", "html", "text/html", function(x){
      var parts = ['<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>' + esc(sansExt(D.nom)) + "</title><style>body{font:14px/1.4 system-ui,sans-serif;margin:24px}table{border-collapse:collapse}" +
        "th,td{border:1px solid #ccc;padding:4px 10px;text-align:left;white-space:pre-wrap}th{background:#f1f1f1;position:sticky;top:0}td.n{text-align:right}tr:nth-child(even) td{background:#fafafa}</style></head><body>\n<table>\n<thead><tr>" +
        x.entete.map(function(t){ return "<th>" + esc(t) + "</th>"; }).join("") + "</tr></thead>\n<tbody>\n"];
      var num = x.types.map(numerique);
      x.lignes.forEach(function(l){
        var s = "<tr>";
        for (var c = 0; c < l.length; c++) s += (num[c] ? '<td class="n">' : "<td>") + esc(l[c]) + "</td>";
        parts.push(s + "</tr>\n");
      });
      parts.push("</tbody>\n</table>\n</body></html>\n");
      return new Blob(parts, { type: "text/html" });
    });
  };
  CMD["exporter-sql"] = function(){
    exporterAutre("Exporter en SQL", "sql", "text/plain", function(x){
      function ident(s){ return '"' + String(s).replace(/"/g, '""') + '"'; }
      var table = ident(C.sansAccent(sansExt(D.nom)).replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "tableau"), num = x.types.map(numerique);
      var parts = ["CREATE TABLE " + table + " (\n" + x.entete.map(function(t, c){ return "  " + ident(t) + (num[c] ? " NUMERIC" : x.types[c] === "date" ? " DATE" : " TEXT"); }).join(",\n") + "\n);\n\n"];
      var debut = "INSERT INTO " + table + " (" + x.entete.map(ident).join(", ") + ") VALUES (";
      x.lignes.forEach(function(l){
        var vals = [];
        for (var c = 0; c < l.length; c++){
          var v = l[c], n, d;
          if (v === "") vals.push("NULL");
          else if (num[c] && !C.codeTexte(v) && isFinite(n = C.nombre(v))) vals.push(String(n));
          else if (x.types[c] === "date" && !isNaN(d = C.date(v))) vals.push("'" + C.formatDate(d, "iso") + "'");
          else vals.push("'" + v.replace(/'/g, "''") + "'");
        }
        parts.push(debut + vals.join(", ") + ");\n");
      });
      return new Blob(parts, { type: "text/plain" });
    });
  };
  CMD.renommer = function(){
    saisir("Renommer le tableau", "Nom du fichier", D.nom, function(v){
      v = v.trim();
      if (!v) throw new Error("Le nom ne peut pas être vide.");
      D.nom = v; majOnglets(); majBarre();
    });
  };
  CMD.fermer = function(){ fermerDoc(D); };
  CMD["fermer-tout"] = function(){
    var n = docs.filter(function(d){ return d.modifie; }).length;
    if (n && !confirm(pluriel(n, "tableau a", "tableaux ont") + " des modifications non enregistrées.\nTout fermer quand même ?")) return;
    docs = []; D = null;
    retourAccueil();
  };

  // ---------- Édition ----------
  CMD.annuler = function(){ rejouer(D.annuler, D.refaire, "annuler"); };
  CMD.refaire = function(){ rejouer(D.refaire, D.annuler, "rétablir"); };
  CMD.copier = function(){ var q = rect(); ecrirePressePapiers(texteSelection(false), "Copié : " + fmtN(q.r1 - q.r0 + 1) + " × " + fmtN(q.c1 - q.c0 + 1) + "."); };
  CMD["copier-titres"] = function(){ ecrirePressePapiers(texteSelection(true), "Copié avec les titres."); };
  CMD.couper = function(){
    var t = texteSelection(false);
    if (!navigator.clipboard || !navigator.clipboard.writeText){ etat("Ce navigateur ne laisse pas couper depuis un menu : utilise Ctrl + X.", true); return; }
    navigator.clipboard.writeText(t).then(function(){ effacerSelection("Couper"); }, function(){ etat("Copie refusée par le navigateur : utilise Ctrl + X.", true); });
  };
  CMD.coller = function(){ lirePressePapiers(function(t){ try { coller(t); } catch (e){ etat(e.message, true); } }); };
  CMD.effacer = function(){ effacerSelection(); };
  CMD.rechercher = function(){ ouvrirRecherche(false); };
  CMD.remplacer = function(){ ouvrirRecherche(true); };
  CMD.aller = function(){
    saisir("Aller à la ligne", "Numéro de ligne (1 à " + fmtN(D.lignes.length) + ")", "", function(v){
      var n = parseInt(String(v).replace(/\D/g, ""), 10);
      if (!(n >= 1 && n <= D.lignes.length)) throw new Error("Indique un numéro entre 1 et " + D.lignes.length + ".");
      var r = D.vue.indexOf(n - 1);
      if (r < 0) throw new Error("La ligne " + n + " est masquée par un filtre.");
      selectionner(r, D.sel.ac, r, D.sel.ac, true);
    }, { type: "number", ok: "Aller" });
  };
  CMD["tout-selectionner"] = function(){ selectionner(0, 0, Math.max(0, D.vue.length - 1), Math.max(0, D.vc.length - 1)); };
  CMD["remplir-bas"] = function(){
    var q = rect();
    if (q.r1 === q.r0){ etat("Sélectionne au moins deux lignes : la première est recopiée dans les suivantes."); return; }
    var modele = D.lignes[D.vue[q.r0]];
    modifier("Recopier vers le bas", function(){
      for (var r = q.r0 + 1; r <= q.r1; r++){
        var l = ligneModif(D.vue[r]);
        for (var c = q.c0; c <= q.c1; c++) l[D.vc[c]] = modele[D.vc[c]];
      }
    });
  };

  // ---------- Affichage ----------
  CMD.profil = function(){
    profilOuvert = !profilOuvert;
    el.profil.hidden = !profilOuvert;
    garder("csv.profil", profilOuvert ? "1" : "");
    profilCle = "";
    majProfil();
    redessiner();
  };
  CMD.ajuster = function(){ ajusterTout(D); calcCols(); redessiner(); };
  CMD["afficher-colonnes"] = function(){ D.cols.forEach(function(c){ c.cache = false; }); calcCols(); bornerSelection(); majBarre(); redessiner(); };
  CMD.theme = function(choix){ appliquerTheme(choix); };

  // ---------- Lignes ----------
  function insererLignes(dessous){
    var q = rect(), k = D.vue.length ? q.r1 - q.r0 + 1 : 1, pos = D.vue.length ? D.vue[dessous ? q.r1 : q.r0] + (dessous ? 1 : 0) : D.lignes.length;
    if (D.tri.length && D.vue.length) pos = dessous ? plusGrand(lignesSel()) + 1 : plusPetit(lignesSel());
    modifier(k > 1 ? "Insérer " + k + " lignes" : "Insérer une ligne", function(){
      var neuves = [];
      for (var i = 0; i < k; i++) neuves.push(ligneVide());
      insererDans(pos, neuves);
    }, { structure: true });
    var r = D.vue.indexOf(pos);
    if (r >= 0) selectionner(r, 0, r + k - 1, D.vc.length - 1, true);
    else etat("Ligne insérée, mais masquée par le filtre en cours.");
  }
  CMD["ligne-dessus"] = function(){ insererLignes(false); };
  CMD["ligne-dessous"] = function(){ insererLignes(true); };
  CMD["ligne-dupliquer"] = function(){
    var idx = lignesSel();
    if (!idx.length) return;
    var pos = plusGrand(idx) + 1;
    modifier("Dupliquer", function(){
      insererDans(pos, idx.map(function(i){ return D.lignes[i].slice(); }));
    }, { structure: true });
  };
  CMD["ligne-supprimer"] = function(){
    var idx = lignesSel();
    if (!idx.length) return;
    var ens = new Set(idx);
    modifier(idx.length > 1 ? "Supprimer " + idx.length + " lignes" : "Supprimer la ligne", function(){
      D.lignes = D.lignes.filter(function(l, i){ return !ens.has(i); });
    }, { structure: true });
    selectionner(D.sel.ar, D.sel.ac, D.sel.ar, D.sel.ac);
    etat(pluriel(idx.length, "ligne supprimée", "lignes supprimées") + ".");
  };
  function decalerLignes(sens){
    if (vueModifiee()){ etat("Retire d'abord le tri et les filtres pour déplacer des lignes.", true); return; }
    var q = rect(), n = D.lignes.length;
    if (!n || (sens < 0 && q.r0 === 0) || (sens > 0 && q.r1 === n - 1)) return;
    modifier(sens < 0 ? "Monter" : "Descendre", function(){
      var bloc = D.lignes.splice(q.r0, q.r1 - q.r0 + 1);
      insererDans(q.r0 + sens, bloc);
    }, { structure: true });
    selectionner(D.sel.ar + sens, D.sel.ac, D.sel.fr + sens, D.sel.fc, true);
  }
  CMD["ligne-monter"] = function(){ decalerLignes(-1); };
  CMD["ligne-descendre"] = function(){ decalerLignes(1); };
  CMD["lignes-vides"] = function(){
    var n = 0;
    modifier("Supprimer les lignes vides", function(){
      var avant = D.lignes.length;
      D.lignes = D.lignes.filter(function(l){ for (var c = 0; c < l.length; c++) if (l[c].trim() !== "") return true; return false; });
      n = avant - D.lignes.length;
      if (!n) return false;
    }, { structure: true });
    etat(n ? pluriel(n, "ligne vide supprimée", "lignes vides supprimées") + "." : "Aucune ligne vide.");
  };
  CMD.doublons = function(){
    var q = rect(), cs = colsSel(), nomsSel = cs.map(function(c){ return D.cols[c].nom; }).join(", ");
    if (nomsSel.length > 60) nomsSel = nomsSel.slice(0, 60) + "…";
    fenetre({ titre: "Doublons", ok: "Appliquer",
      html: lg("Deux lignes sont en double si elles ont les mêmes valeurs dans", hSel("cle", [["toutes", "toutes les colonnes"], ["sel", cs.length > 1 ? "les colonnes sélectionnées (" + nomsSel + ")" : "la colonne « " + nomsSel + " »"]], cs.length === D.cols.length ? "toutes" : "sel")) +
        lg("Action", hSel("action", [["supprimer", "Supprimer les doublons (garder la première ligne)"], ["garder", "Ne garder que les lignes en double"], ["marquer", "Ajouter une colonne « Doublon »"], ["filtrer", "Afficher seulement les lignes en double"]], "supprimer")) +
        hCoche("souple", "Ignorer la casse, les accents et les espaces autour", false),
      surOk: function(d){
        var cols = val(d, "cle") === "toutes" ? tousIndices(D.cols.length) : cs, souple = val(d, "souple"), action = val(d, "action");
        function cle(l){ var s = ""; for (var k = 0; k < cols.length; k++){ var v = l[cols[k]]; s += (souple ? norme(v) : v) + "\u0001"; } return s; }
        var cpt = new Map(), L = D.lignes, i;
        for (i = 0; i < L.length; i++){ var k0 = cle(L[i]); cpt.set(k0, (cpt.get(k0) || 0) + 1); }
        var enDouble = 0;
        cpt.forEach(function(k){ if (k > 1) enDouble += k - 1; });
        if (!enDouble){ etat("Aucun doublon."); return; }
        if (action === "supprimer"){
          modifier("Supprimer les doublons", function(){ var vus = new Set(); D.lignes = L.filter(function(l){ var k = cle(l); if (vus.has(k)) return false; vus.add(k); return true; }); }, { structure: true });
          etat(pluriel(enDouble, "doublon supprimé", "doublons supprimés") + ".");
        } else if (action === "garder"){
          modifier("Garder les doublons", function(){ D.lignes = L.filter(function(l){ return cpt.get(cle(l)) > 1; }); }, { structure: true });
          etat(pluriel(D.lignes.length, "ligne en double gardée", "lignes en double gardées") + ".");
        } else {
          var neuve;
          modifier("Marquer les doublons", function(){
            var vus = new Set();
            neuve = insererCols(D.cols.length, [nomLibre("Doublon")], function(l){ var k = cle(l); if (cpt.get(k) < 2) return [""]; if (vus.has(k)) return ["doublon"]; vus.add(k); return ["original"]; })[0];
          }, { structure: true });
          if (action === "filtrer"){ D.filtres[neuve.id] = { op: "plein", a: "", b: "", mode: null, ens: new Set() }; recalcVue(); }
          etat(pluriel(enDouble, "doublon repéré", "doublons repérés") + " dans la colonne « " + neuve.nom + " ».");
        }
        void q;
      } });
  };
  CMD["garder-affichees"] = function(){
    var n = D.lignes.length - D.vue.length;
    if (!n){ etat("Toutes les lignes sont déjà affichées."); return; }
    var garde = D.vue.slice().sort(function(a, b){ return a - b; });
    modifier("Ne garder que les lignes affichées", function(){ D.lignes = garde.map(function(i){ return D.lignes[i]; }); }, { structure: true });
    D.filtres = {}; D.rapide = ""; el.rapide.value = ""; recalcVue();
    etat(pluriel(n, "ligne supprimée", "lignes supprimées") + ", filtres retirés.");
  };
  CMD["supprimer-affichees"] = function(){
    if (!aFiltre()){ etat("Pose d'abord un filtre : cette commande supprime les lignes qu'il laisse passer.", true); return; }
    var ens = new Set(D.vue), n = ens.size;
    if (!n) return;
    modifier("Supprimer les lignes affichées", function(){ D.lignes = D.lignes.filter(function(l, i){ return !ens.has(i); }); }, { structure: true });
    D.filtres = {}; D.rapide = ""; el.rapide.value = ""; recalcVue();
    etat(pluriel(n, "ligne supprimée", "lignes supprimées") + ", filtres retirés.");
  };
  CMD["titres-monter"] = function(){
    if (!D.lignes.length){ etat("Aucune ligne à utiliser comme titres.", true); return; }
    modifier("Première ligne comme titres", function(){
      var l = D.lignes[0];
      D.cols.forEach(function(c, i){ c.nom = l[i].trim() || "Colonne " + (i + 1); });
      D.lignes = D.lignes.slice(1);
      D.sansEntete = false;
    }, { structure: true });
  };
  CMD["titres-descendre"] = function(){
    modifier("Titres en première ligne", function(){
      D.lignes.unshift(D.cols.map(function(c){ return c.nom; }));
      D.cols.forEach(function(c, i){ c.nom = "Colonne " + (i + 1); });
      D.sansEntete = true;
    }, { structure: true });
    etat("Les titres sont redevenus une ligne de données : l'export n'écrira plus de ligne de titres.");
  };
  CMD.numeroter = function(){
    var rang = new Map();
    D.vue.forEach(function(i, r){ rang.set(i, r + 1); });
    modifier("Ajouter une colonne de numéros", function(){
      insererCols(0, [nomLibre("N°")], function(l, i){ return [rang.has(i) ? String(rang.get(i)) : ""]; });
    }, { structure: true });
    etat("Colonne « N° » ajoutée, dans l'ordre affiché.");
  };
  CMD.transposer = function(){
    if (D.lignes.length > 2000) throw new Error("Transposer demande au plus 2000 lignes (elles deviennent des colonnes).");
    modifier("Transposer", function(){
      var L = D.lignes, noms = D.cols.map(function(c){ return c.nom; }), neuves = [];
      for (var c = 0; c < noms.length; c++){
        var l = [noms[c]];
        for (var i = 0; i < L.length; i++) l.push(L[i][c]);
        neuves.push(l);
      }
      D.lignes = neuves;
      D.cols = [];
      for (var k = 0; k <= L.length; k++) D.cols.push(nouvelleCol("Colonne " + (k + 1)));
      D.sansEntete = true;
      D.filtres = {}; D.tri = [];
    }, { structure: true });
    ajusterTout(D); calcCols(); redessiner();
    etat("Tableau transposé. Lignes › Utiliser la première ligne comme titres, si besoin.");
  };

  // ---------- Colonnes ----------
  function insererColonne(aDroite){
    var q = rect(), pos = aDroite ? D.vc[q.c1] + 1 : D.vc[q.c0];
    modifier("Insérer une colonne", function(){ insererCols(pos, [nomLibre("Colonne " + (D.cols.length + 1))], null); });
    var c = D.vc.indexOf(pos);
    selectionner(0, c, Math.max(0, D.vue.length - 1), c, true);
  }
  CMD["col-gauche"] = function(){ insererColonne(false); };
  CMD["col-droite"] = function(){ insererColonne(true); };
  CMD["col-dupliquer"] = function(){
    var cs = colsSel(), pos = cs[cs.length - 1] + 1;
    modifier("Dupliquer", function(){
      var neuves = insererCols(pos, cs.map(function(c){ return nomLibre(D.cols[c].nom + " (copie)"); }), function(l){ return cs.map(function(c){ return l[c]; }); });
      neuves.forEach(function(n, k){ n.l = D.cols[cs[k]].l; });
    });
  };
  CMD["col-renommer"] = function(){
    var ci = colActive(), col = D.cols[ci];
    saisir("Renommer la colonne", "Titre de la colonne", col.nom, function(v){
      v = v.trim();
      if (!v) throw new Error("Le titre ne peut pas être vide.");
      if (v === col.nom) return;
      modifier("Renommer la colonne", function(){ D.cols[indexColId(col.id)].nom = v; D.sansEntete = false; });
    });
  };
  function decalerCols(sens){
    var q = rect(), a = D.vc[q.c0], b = D.vc[q.c1], cible = sens < 0 ? D.vc[q.c0 - 1] : D.vc[q.c1 + 1];
    if (cible == null) return;
    modifier(sens < 0 ? "Déplacer vers la gauche" : "Déplacer vers la droite", function(){
      // la colonne voisine passe de l'autre côté du bloc
      function bouger(t){ var x = t.splice(cible, 1)[0]; t.splice(sens < 0 ? b : a, 0, x); return t; }
      D.lignes = D.lignes.map(function(l){ return bouger(l.slice()); });
      bouger(D.cols);
    });
    selectionner(D.sel.ar, D.sel.ac + sens, D.sel.fr, D.sel.fc + sens, true);
  }
  CMD["col-reculer"] = function(){ decalerCols(-1); };
  CMD["col-avancer"] = function(){ decalerCols(1); };
  CMD["col-masquer"] = function(){
    var cs = colsSel();
    if (cs.length >= D.vc.length){ etat("Il faut garder au moins une colonne affichée.", true); return; }
    cs.forEach(function(c){ D.cols[c].cache = true; });
    calcCols(); bornerSelection(); majBarre(); redessiner(); majSelection();
    etat(pluriel(cs.length, "colonne masquée", "colonnes masquées") + " · Affichage › Afficher les colonnes masquées.");
  };
  CMD["col-supprimer"] = function(){
    var cs = colsSel();
    modifier(cs.length > 1 ? "Supprimer " + cs.length + " colonnes" : "Supprimer la colonne", function(){ supprimerCols(cs); });
    selectionner(D.sel.ar, Math.min(D.sel.ac, D.sel.fc), D.sel.ar, Math.min(D.sel.ac, D.sel.fc));
  };
  CMD["cols-vides"] = function(){
    var vides = [];
    for (var c = 0; c < D.cols.length; c++){
      var plein = false;
      for (var i = 0; i < D.lignes.length; i++) if (D.lignes[i][c].trim() !== ""){ plein = true; break; }
      if (!plein) vides.push(c);
    }
    if (!vides.length){ etat("Aucune colonne vide."); return; }
    modifier("Supprimer les colonnes vides", function(){ supprimerCols(vides); });
    etat(pluriel(vides.length, "colonne vide supprimée", "colonnes vides supprimées") + ".");
  };
  CMD["col-calculee"] = function(){
    var noms = D.cols.map(function(c){ return c.nom; }), exemple = D.vue.length ? D.lignes[D.vue[D.sel.ar]] : null;
    var num = D.cols.filter(function(c){ return numerique(c.type); })[0], defaut = num ? "[" + num.nom + "] * 2" : "MAJUSCULE([" + D.cols[colActive()].nom + "])";
    fenetre({ titre: "Colonne calculée", ok: "Créer la colonne", large: true,
      html: '<div class="rang">' + lg("Titre de la nouvelle colonne", hTxt("nom", nomLibre("Calcul"))) + lg("Insérer une colonne dans la formule", hSel("ins", optsCols("Choisir…"), "")) + "</div>" +
        lg("Formule", '<textarea class="champ" data-n="formule" rows="3" spellcheck="false">' + esc(defaut) + "</textarea>") +
        '<div class="apercu" data-apercu></div>' +
        '<div class="fn-liste">' + C.FONCTIONS.map(function(f){ return "<div><code>" + esc(f[0]) + "</code> — " + esc(f[1]) + "</div>"; }).join("") +
        "<div>Colonnes entre crochets : <code>[Longueur (m)] * [Volume (m3)]</code> · texte entre guillemets · décimales avec un point · <code>&amp;</code> colle deux textes.</div></div>",
      pret: function(d){
        var ta = champ(d, "formule"), ap = d.querySelector("[data-apercu]");
        function apercu(){
          try {
            var f = C.formule(ta.value, noms);
            ap.textContent = exemple ? "Ligne " + (D.vue[D.sel.ar] + 1) + " → " + f(exemple, D.sel.ar) : "Formule correcte.";
            ap.classList.remove("ko");
          } catch (e){ ap.textContent = e.message; ap.classList.add("ko"); }
        }
        ta.addEventListener("input", apercu);
        champ(d, "ins").addEventListener("change", function(){
          var s = champ(d, "ins");
          if (s.value === "") return;
          var t = "[" + noms[+s.value] + "]", a = ta.selectionStart;
          ta.value = ta.value.slice(0, a) + t + ta.value.slice(ta.selectionEnd);
          s.value = ""; ta.focus(); ta.setSelectionRange(a + t.length, a + t.length);
          apercu();
        });
        apercu();
        ta.focus();
      },
      surOk: function(d){
        var f = C.formule(val(d, "formule"), noms), nom = val(d, "nom").trim() || nomLibre("Calcul"), rang = new Map();
        D.vue.forEach(function(i, r){ rang.set(i, r); });
        var pos = D.vc[rect().c1] + 1;
        modifier("Colonne calculée", function(){ insererCols(pos, [nom], function(l, i){ return [f(l, rang.has(i) ? rang.get(i) : i)]; }); });
        var c = D.vc.indexOf(pos);
        mesure.font = '13px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
        ajusterCol(D, pos); calcCols();
        selectionner(0, c, Math.max(0, D.vue.length - 1), c, true);
        etat("Colonne « " + nom + " » créée. Les valeurs sont figées : elles ne se recalculent pas si les données changent.");
      } });
  };
  CMD["col-scinder"] = function(){
    var ci = colActive(), col = D.cols[ci], ech = "", i;
    for (i = 0; i < D.vue.length && i < 200 && !ech; i++) ech = D.lignes[D.vue[i]][ci];
    var devine = [" - ", ";", ",", "/", "|", "_", "-", " "].filter(function(s){ return ech.indexOf(s) >= 0; })[0] || " ";
    fenetre({ titre: "Scinder « " + col.nom + " »", ok: "Scinder",
      html: '<div class="rang">' + lg("Séparateur", hTxt("sep", devine)) + lg("Nombre maximal de colonnes", hTxt("max", "", "automatique", "number")) + "</div>" +
        '<div class="coches">' + hCoche("regex", "Le séparateur est une expression régulière", false) + hCoche("trim", "Retirer les espaces autour", true) + hCoche("garder", "Garder la colonne d'origine", true) + "</div>",
      surOk: function(d){
        var sep = val(d, "sep"), maxi = parseInt(val(d, "max"), 10) || 0, propre = val(d, "trim"), garde = val(d, "garder");
        if (sep === "") throw new Error("Indique un séparateur.");
        var coupe = val(d, "regex") ? new RegExp(sep) : sep;
        function morceaux(v){
          if (v === "") return [];
          var p = v.split(coupe);
          if (maxi && p.length > maxi) p = p.slice(0, maxi - 1).concat([v.split(coupe).slice(maxi - 1).join(typeof coupe === "string" ? coupe : " ")]);
          return propre ? p.map(function(x){ return x.trim(); }) : p;
        }
        var k = 0;
        D.lignes.forEach(function(l){ var n = morceaux(l[ci]).length; if (n > k) k = n; });
        if (k < 2) throw new Error("Le séparateur n'apparaît dans aucune valeur de la colonne.");
        if (k > 60) throw new Error("Cela ferait " + k + " colonnes : limite le nombre maximal.");
        var noms = [];
        for (var j = 1; j <= k; j++) noms.push(col.nom + " " + j);
        modifier("Scinder la colonne", function(){
          insererCols(ci + 1, noms, function(l){ return morceaux(l[ci]); });
          if (!garde) supprimerCols([ci]);
        });
        ajusterTout(D); calcCols(); redessiner();
        etat("« " + col.nom + " » scindée en " + k + " colonnes.");
      } });
  };
  CMD["col-fusionner"] = function(){
    var cs = colsSel();
    if (cs.length < 2){ etat("Sélectionne au moins deux colonnes (clique un titre, puis Maj + clic sur un autre).", true); return; }
    fenetre({ titre: "Fusionner " + cs.length + " colonnes", ok: "Fusionner",
      html: '<div class="rang">' + lg("Titre de la nouvelle colonne", hTxt("nom", nomLibre(D.cols[cs[0]].nom + " + " + D.cols[cs[cs.length - 1]].nom))) + lg("Séparateur entre les valeurs", hTxt("sep", " ")) + "</div>" +
        '<div class="coches">' + hCoche("vides", "Ignorer les valeurs vides", true) + hCoche("garder", "Garder les colonnes d'origine", false) + "</div>",
      surOk: function(d){
        var sep = val(d, "sep"), sansVides = val(d, "vides"), garde = val(d, "garder"), nom = val(d, "nom").trim() || "Fusion", pos = cs[cs.length - 1] + 1;
        modifier("Fusionner les colonnes", function(){
          insererCols(pos, [nom], function(l){
            var p = cs.map(function(c){ return l[c]; });
            if (sansVides) p = p.filter(function(v){ return v !== ""; });
            return [p.join(sep)];
          });
          if (!garde) supprimerCols(cs);
        });
        bornerSelection(); redessiner();
      } });
  };

  // ---------- Données : tris et filtres ----------
  function trierActive(sens){
    var col = D.cols[colActive()];
    D.tri = [{ id: col.id, sens: sens }];
    recalcVue();
    etat("Trié sur « " + col.nom + " » (" + nomType(col.type) + "). Les données du fichier gardent leur ordre tant que tu n'appliques pas l'ordre affiché.");
  }
  CMD["tri-asc"] = function(){ trierActive(1); };
  CMD["tri-desc"] = function(){ trierActive(-1); };
  CMD["tri-aucun"] = function(){ D.tri = []; recalcVue(); };
  CMD["tri-multi"] = function(){
    var t = D.tri, sens = [[1, "Croissant"], [-1, "Décroissant"]];
    function niveau(k, vide){
      var c = t[k] ? indexColId(t[k].id) : (k === 0 ? colActive() : "");
      return '<div class="rang">' + lg(k === 0 ? "Trier par" : "Puis par", hSel("c" + k, optsCols(vide), c)) + lg("Ordre", hSel("s" + k, sens, t[k] ? t[k].sens : 1)) + "</div>";
    }
    fenetre({ titre: "Tri sur plusieurs colonnes", ok: "Trier", html: niveau(0, null) + niveau(1, "—") + niveau(2, "—") + niveau(3, "—"),
      surOk: function(d){
        var tri = [], vus = new Set();
        for (var k = 0; k < 4; k++){
          var c = val(d, "c" + k);
          if (c === "" || vus.has(c)) continue;
          vus.add(c);
          tri.push({ id: D.cols[+c].id, sens: +val(d, "s" + k) });
        }
        D.tri = tri;
        recalcVue();
      } });
  };
  CMD["tri-figer"] = function(){
    if (!D.tri.length){ etat("Aucun tri en cours."); return; }
    if (aFiltre()){ etat("Retire d'abord les filtres : l'ordre ne peut être appliqué qu'à toutes les lignes.", true); return; }
    var ordre = D.vue.slice();
    modifier("Appliquer l'ordre affiché", function(){ D.lignes = ordre.map(function(i){ return D.lignes[i]; }); }, { structure: false });
    D.tri = [];
    recalcVue();
    etat("L'ordre affiché est maintenant celui des données.");
  };
  CMD["filtre-col"] = function(){ ouvrirMenuCol(D.sel.ac); };
  CMD["filtre-valeur"] = function(){
    if (!D.vue.length) return;
    var ci = colActive(), col = D.cols[ci], ens = new Set(lignesSel().map(function(i){ return D.lignes[i][ci]; }));
    D.filtres[col.id] = { op: "", a: "", b: "", mode: "inclus", ens: ens };
    recalcVue();
    etat("Filtre posé sur « " + col.nom + " » : " + pluriel(D.vue.length, "ligne") + ".");
  };
  CMD["filtre-aucun"] = function(){ D.filtres = {}; D.rapide = ""; el.rapide.value = ""; recalcVue(); };

  // ---------- Données : analyse ----------
  function docResultat(nom, entete, lignes){
    var d = nouveauDoc(nom, entete, lignes, { sep: D.format.sep, encodage: D.format.encodage, fin: D.format.fin });
    d.modifie = true;
    ajouterDoc(d);
    return d;
  }
  var OPS_CROISE = [["nombre", "Nombre de lignes"], ["somme", "Somme"], ["moyenne", "Moyenne"], ["min", "Minimum"], ["max", "Maximum"], ["distinct", "Nombre de valeurs distinctes"], ["remplies", "Nombre de valeurs remplies"]];
  CMD.croise = function(){
    var num = -1;
    D.cols.forEach(function(c, i){ if (num < 0 && numerique(c.type)) num = i; });
    fenetre({ titre: "Tableau croisé", ok: "Créer dans un nouvel onglet",
      html: '<div class="rang">' + lg("Une ligne par", hSel("g1", optsCols(null), colActive())) + lg("puis par", hSel("g2", optsCols("—"), "")) + "</div>" +
        lg("Une colonne par (facultatif)", hSel("pc", optsCols("—"), "")) +
        '<div class="rang">' + lg("Calcul", hSel("op", OPS_CROISE, num >= 0 ? "somme" : "nombre")) + lg("sur la colonne", hSel("vc", optsCols("—"), num >= 0 ? num : "")) + "</div>" +
        '<p class="note">Le calcul porte sur les lignes affichées (' + fmtN(D.vue.length) + "). Le résultat s'ouvre dans un nouvel onglet, avec une ligne de total.</p>",
      surOk: function(d){
        var g1 = +val(d, "g1"), g2 = val(d, "g2") === "" ? -1 : +val(d, "g2"), pc = val(d, "pc") === "" ? -1 : +val(d, "pc"), vc = val(d, "vc") === "" ? -1 : +val(d, "vc"), op = val(d, "op");
        if (op !== "nombre" && vc < 0) throw new Error("Choisis la colonne sur laquelle porte le calcul.");
        function vide(){ return { n: 0, nn: 0, s: 0, min: Infinity, max: -Infinity, ens: op === "distinct" ? new Set() : null, pleines: 0 }; }
        function ajouter(m, k, v){
          var a = m.get(k);
          if (!a){ a = vide(); m.set(k, a); }
          a.n++;
          if (v !== ""){ a.pleines++; if (a.ens) a.ens.add(v); var x = C.nombre(v); if (x === x){ a.nn++; a.s += x; if (x < a.min) a.min = x; if (x > a.max) a.max = x; } }
        }
        function resultat(a){
          if (!a) return "";
          return op === "nombre" ? String(a.n) : op === "remplies" ? String(a.pleines) : op === "distinct" ? String(a.ens.size) :
            !a.nn ? "" : C.texteNombre(op === "somme" ? a.s : op === "moyenne" ? a.s / a.nn : op === "min" ? a.min : a.max);
        }
        var groupes = new Map(), totaux = new Map(), pivots = new Set(), T = "\u0000";
        D.vue.forEach(function(i){
          var l = D.lignes[i], cle = l[g1] + (g2 >= 0 ? "\u0001" + l[g2] : ""), g = groupes.get(cle), v = vc >= 0 ? l[vc] : "";
          if (!g){ g = { k1: l[g1], k2: g2 >= 0 ? l[g2] : "", cases: new Map() }; groupes.set(cle, g); }
          ajouter(g.cases, T, v); ajouter(totaux, T, v);
          if (pc >= 0){ pivots.add(l[pc]); ajouter(g.cases, l[pc], v); ajouter(totaux, l[pc], v); }
        });
        var pv = Array.from(pivots).sort(C.comparer);
        if (pv.length > 250) throw new Error("« " + D.cols[pc].nom + " » a " + pv.length + " valeurs différentes : c'est trop pour en faire des colonnes.");
        var libelle = nomOpCroise(op) + (vc >= 0 && op !== "nombre" ? " de " + D.cols[vc].nom : "");
        var entete = [D.cols[g1].nom];
        if (g2 >= 0) entete.push(D.cols[g2].nom);
        if (pc >= 0){ pv.forEach(function(p){ entete.push(p === "" ? "(vide)" : p); }); entete.push("Total"); } else entete.push(libelle);
        var liste = Array.from(groupes.values()).sort(function(a, b){ return C.comparer(a.k1, b.k1) || C.comparer(a.k2, b.k2); });
        function ligne(tete, cases){
          var l = tete.slice();
          if (pc >= 0) pv.forEach(function(p){ l.push(resultat(cases.get(p))); });
          l.push(resultat(cases.get(T)));
          return l;
        }
        var lignes = liste.map(function(g){ return ligne(g2 >= 0 ? [g.k1, g.k2] : [g.k1], g.cases); });
        lignes.push(ligne(g2 >= 0 ? ["Total", ""] : ["Total"], totaux));
        var source = D.nom;
        docResultat("Croisé " + sansExt(source) + ".csv", entete, lignes);
        etat("Tableau croisé de « " + source + " » : " + pluriel(liste.length, "groupe") + " · " + libelle + ".");
      } });
  };
  function nomOpCroise(op){ for (var i = 0; i < OPS_CROISE.length; i++) if (OPS_CROISE[i][0] === op) return OPS_CROISE[i][1]; return op; }
  CMD.resume = function(){
    var n = D.vue.length, lignes = [], source = D.nom;
    D.cols.forEach(function(col, c){
      var vals = new Array(n);
      for (var i = 0; i < n; i++) vals[i] = D.lignes[D.vue[i]][c];
      var p = C.profil(vals), X = C.texteNombre;
      lignes.push([col.nom, nomType(p.type), String(p.remplies), String(p.vides), String(p.distinctes), String(p.doublons),
        p.nNum ? X(p.min) : "", p.nNum ? X(p.max) : "", p.nNum ? X(p.somme) : "", p.nNum ? X(C.arrondi(p.moyenne, 6)) : "", p.nNum ? X(p.mediane) : "",
        String(p.lmax), p.top.length ? p.top[0][0] : "", p.top.length ? String(p.top[0][1]) : ""]);
    });
    docResultat("Résumé " + sansExt(source) + ".csv", ["Colonne", "Type", "Remplies", "Vides", "Distinctes", "En double", "Minimum", "Maximum", "Somme", "Moyenne", "Médiane", "Longueur max", "Valeur la plus fréquente", "Occurrences"], lignes);
    etat("Résumé des " + lignes.length + " colonnes de « " + source + " » sur " + pluriel(n, "ligne affichée", "lignes affichées") + ".");
  };

  // ---------- Données : plusieurs onglets ----------
  function colsCommunes(B){
    var nb = B.cols.map(function(c){ return norme(c.nom); });
    return D.cols.map(function(c, i){ return [i, c.nom]; }).filter(function(o){ return nb.indexOf(norme(o[1])) >= 0; });
  }
  function colParNom(doc, nom){ var k = norme(nom); for (var i = 0; i < doc.cols.length; i++) if (norme(doc.cols[i].nom) === k) return i; return -1; }
  CMD.comparer = function(){
    var autres = optsDocs();
    if (!autres.length){ etat("Ouvre un deuxième tableau pour comparer.", true); return; }
    var A = D;
    fenetre({ titre: "Comparer deux tableaux", ok: "Comparer",
      html: lg("Ancienne version", '<input class="champ" value="' + esc(A.nom) + '" disabled>') + lg("Nouvelle version", hSel("autre", autres, autres[0][0])) +
        lg("Colonne qui identifie une ligne", '<select class="champ" data-n="cle"></select>') +
        '<div class="coches">' + hCoche("masquer", "Ne pas lister les lignes identiques", true) + hCoche("souple", "Ignorer la casse et les espaces autour", false) + "</div>" +
        '<p class="note">Le résultat s\'ouvre dans un nouvel onglet : état de chaque ligne (ajoutée, supprimée, modifiée) et, pour les cellules changées, « ancienne valeur → nouvelle valeur ».</p>',
      pret: function(d){
        function cles(){
          var B = trouverDoc(+val(d, "autre")), o = colsCommunes(B).concat([["", "(aucune : comparer ligne à ligne)"]]);
          champ(d, "cle").innerHTML = o.map(function(x){ return '<option value="' + x[0] + '">' + esc(x[1]) + "</option>"; }).join("");
        }
        champ(d, "autre").addEventListener("change", cles);
        cles();
      },
      surOk: function(d){
        var B = trouverDoc(+val(d, "autre")), cle = val(d, "cle"), souple = val(d, "souple"), masquer = val(d, "masquer");
        var ka = cle === "" ? -1 : +cle, kb = ka < 0 ? -1 : colParNom(B, A.cols[ka].nom);
        function n(v){ return souple ? v.trim().toLowerCase() : v; }
        var noms = A.cols.map(function(c){ return c.nom; }), corr = noms.map(function(x){ return colParNom(B, x); }), enPlus = [];
        B.cols.forEach(function(c, j){ if (corr.indexOf(j) < 0) enPlus.push(j); });
        var entete = ["État", "Colonnes modifiées"].concat(noms, enPlus.map(function(j){ return B.cols[j].nom; }));
        var index = new Map(), pris = new Uint8Array(B.lignes.length), lignes = [], bilan = { m: 0, a: 0, s: 0, i: 0 }, i, j;
        if (kb >= 0) for (j = 0; j < B.lignes.length; j++){ var k = n(B.lignes[j][kb]); if (!index.has(k)) index.set(k, j); }
        for (i = 0; i < A.lignes.length; i++){
          var la = A.lignes[i];
          j = kb >= 0 ? index.get(n(la[ka])) : (i < B.lignes.length ? i : undefined);
          if (j === undefined || pris[j]){ bilan.s++; lignes.push(["Supprimée", ""].concat(la, enPlus.map(function(){ return ""; }))); continue; }
          pris[j] = 1;
          var lb = B.lignes[j], changes = [], sortie = [];
          for (var c = 0; c < noms.length; c++){
            if (corr[c] < 0 || n(la[c]) === n(lb[corr[c]])) sortie.push(la[c]);
            else { changes.push(noms[c]); sortie.push(la[c] + " → " + lb[corr[c]]); }
          }
          var plus = enPlus.map(function(q){ return lb[q]; });
          if (changes.length){ bilan.m++; lignes.push(["Modifiée", changes.join(", ")].concat(sortie, plus)); }
          else { bilan.i++; if (!masquer) lignes.push(["Identique", ""].concat(sortie, plus)); }
        }
        for (j = 0; j < B.lignes.length; j++) if (!pris[j]){
          bilan.a++;
          var lb2 = B.lignes[j];
          lignes.push(["Ajoutée", ""].concat(corr.map(function(q){ return q < 0 ? "" : lb2[q]; }), enPlus.map(function(q){ return lb2[q]; })));
        }
        var texte = pluriel(bilan.m, "ligne modifiée", "lignes modifiées") + ", " + bilan.a + " ajoutée" + (bilan.a > 1 ? "s" : "") + ", " + bilan.s + " supprimée" + (bilan.s > 1 ? "s" : "") + ", " + bilan.i + " identique" + (bilan.i > 1 ? "s" : "");
        if (!lignes.length){ etat("Les deux tableaux sont identiques (" + pluriel(bilan.i, "ligne") + ")."); return; }
        docResultat("Comparaison " + sansExt(A.nom) + " - " + sansExt(B.nom) + ".csv", entete, lignes);
        etat("Comparaison : " + texte + ".");
      } });
  };
  CMD.joindre = function(){
    var autres = optsDocs();
    if (!autres.length){ etat("Ouvre un deuxième tableau.", true); return; }
    fenetre({ titre: "Ramener des colonnes d'un autre onglet", ok: "Ramener",
      html: lg("Tableau où chercher", hSel("autre", autres, autres[0][0])) +
        '<div class="rang">' + lg("Colonne commune, ici", hSel("ka", optsCols(null), colActive())) + lg("Colonne commune, là-bas", '<select class="champ" data-n="kb"></select>') + "</div>" +
        lg("Colonnes à ramener", '<select class="champ" data-n="quoi"></select>') +
        hCoche("souple", "Ignorer la casse et les espaces autour de la valeur commune", true) +
        '<p class="note">Pour chaque ligne d\'ici, la première ligne de l\'autre tableau qui porte la même valeur est utilisée (comme RECHERCHEV).</p>',
      pret: function(d){
        function remplir(){
          var B = trouverDoc(+val(d, "autre")), ka = +val(d, "ka"), kb = colParNom(B, D.cols[ka].nom);
          champ(d, "kb").innerHTML = B.cols.map(function(c, j){ return '<option value="' + j + '"' + (j === kb ? " selected" : "") + ">" + esc(c.nom) + "</option>"; }).join("");
          champ(d, "quoi").innerHTML = '<option value="">Toutes les autres colonnes</option>' + B.cols.map(function(c, j){ return '<option value="' + j + '">' + esc(c.nom) + "</option>"; }).join("");
        }
        champ(d, "autre").addEventListener("change", remplir);
        champ(d, "ka").addEventListener("change", remplir);
        remplir();
      },
      surOk: function(d){
        var B = trouverDoc(+val(d, "autre")), ka = +val(d, "ka"), kb = +val(d, "kb"), quoi = val(d, "quoi"), souple = val(d, "souple"), trouvees = 0;
        function n(v){ return souple ? v.trim().toLowerCase() : v; }
        var cols = quoi === "" ? tousIndices(B.cols.length).filter(function(j){ return j !== kb; }) : [+quoi];
        if (!cols.length) throw new Error("L'autre tableau n'a pas d'autre colonne à ramener.");
        var index = new Map();
        B.lignes.forEach(function(l){ var k = n(l[kb]); if (!index.has(k)) index.set(k, l); });
        modifier("Ramener des colonnes", function(){
          var noms = [];
          cols.forEach(function(j){ var x = nomLibre(B.cols[j].nom); while (noms.indexOf(x) >= 0) x += " 2"; noms.push(x); });
          insererCols(D.cols.length, noms, function(l){
            var m = index.get(n(l[ka]));
            if (!m) return null;
            trouvees++;
            return cols.map(function(j){ return m[j]; });
          });
        });
        ajusterTout(D); calcCols(); redessiner();
        etat(pluriel(cols.length, "colonne ramenée", "colonnes ramenées") + " de « " + B.nom + " » : " + fmtN(trouvees) + " lignes sur " + fmtN(D.lignes.length) + " ont trouvé leur correspondance.", trouvees < D.lignes.length);
      } });
  };
  CMD.empiler = function(){
    var autres = optsDocs();
    if (!autres.length){ etat("Ouvre un deuxième tableau.", true); return; }
    fenetre({ titre: "Ajouter les lignes d'un autre onglet", ok: "Ajouter",
      html: lg("Tableau à ajouter à la suite", hSel("autre", autres, autres[0][0])) + hCoche("plus", "Créer les colonnes qui n'existent pas ici", true) +
        '<p class="note">Les colonnes sont rapprochées par leur titre, sans tenir compte de la casse ni des accents.</p>',
      surOk: function(d){
        var B = trouverDoc(+val(d, "autre")), plus = val(d, "plus"), n = B.lignes.length;
        modifier("Ajouter des lignes", function(){
          var corr = B.cols.map(function(c){ return colParNom(D, c.nom); }), manquent = [];
          corr.forEach(function(p, j){ if (p < 0) manquent.push(j); });
          if (plus && manquent.length){
            insererCols(D.cols.length, manquent.map(function(j){ return B.cols[j].nom; }), null);
            corr = B.cols.map(function(c){ return colParNom(D, c.nom); });
          }
          B.lignes.forEach(function(l){
            var x = ligneVide();
            for (var j = 0; j < corr.length; j++) if (corr[j] >= 0) x[corr[j]] = l[j];
            D.lignes.push(x);
          });
        }, { structure: true });
        etat(pluriel(n, "ligne ajoutée", "lignes ajoutées") + " depuis « " + B.nom + " ».");
      } });
  };

  // ---------- Transformer la sélection ----------
  // Réécrit un nombre avec le séparateur décimal voulu (dec nul : celui d'origine), sans séparateur de milliers
  function reecrireNombre(v, dec){
    var t = v.trim();
    if (t === "" || C.codeTexte(t) || isNaN(C.nombre(t))) return v;
    t = t.replace(/[\s  '’]/g, "");
    var iv = t.lastIndexOf(","), ip = t.lastIndexOf("."), nv = t.split(",").length - 1, np = t.split(".").length - 1, d = -1;
    if (nv && np) d = Math.max(iv, ip); else if (nv === 1) d = iv; else if (np === 1) d = ip;
    if (d < 0) return t.replace(/[.,]/g, "");
    var ent = t.slice(0, d).replace(/[.,]/g, ""), fra = t.slice(d + 1);
    return fra === "" ? ent : ent + (dec || t.charAt(d)) + fra;
  }
  function avecVirgule(v){ return v.indexOf(",") >= 0 && v.indexOf(".") < 0; }
  CMD["t-trim"] = function(){ transformer("Retirer les espaces autour", function(v){ return v.trim(); }); };
  CMD["t-espaces"] = function(){ transformer("Réduire les espaces", function(v){ return v.replace(/[ \t ]+/g, " ").trim(); }); };
  CMD["t-maj"] = function(){ transformer("Majuscules", function(v){ return v.toUpperCase(); }); };
  CMD["t-min"] = function(){ transformer("Minuscules", function(v){ return v.toLowerCase(); }); };
  CMD["t-propre"] = function(){ transformer("Première lettre en majuscule", function(v){ return C.nomPropre(v); }); };
  CMD["t-accents"] = function(){ transformer("Retirer les accents", function(v){ return C.sansAccent(v); }); };
  CMD["t-point"] = function(){ transformer("Virgule → point", function(v){ return reecrireNombre(v, "."); }); };
  CMD["t-virgule"] = function(){ transformer("Point → virgule", function(v){ return reecrireNombre(v, ","); }); };
  CMD["t-milliers"] = function(){ transformer("Retirer les séparateurs de milliers", function(v){ return reecrireNombre(v, null); }); };
  CMD["t-arrondir"] = function(){
    saisir("Arrondir les nombres", "Nombre de décimales", "2", function(s){
      var n = parseInt(s, 10);
      if (!(n >= 0 && n <= 12)) throw new Error("Indique un nombre de décimales entre 0 et 12.");
      transformer("Arrondir à " + n + " décimale" + (n > 1 ? "s" : ""), function(v){
        var x = C.nombre(v);
        if (v === "" || isNaN(x) || C.codeTexte(v.trim())) return v;
        var r = C.arrondi(x, n, 0).toFixed(n);
        return avecVirgule(v) ? r.replace(".", ",") : r;
      });
    }, { type: "number" });
  };
  CMD["t-calcul"] = function(){
    fenetre({ titre: "Calcul sur les nombres", ok: "Appliquer",
      html: '<div class="rang">' + lg("Opération", hSel("op", [["*", "Multiplier par"], ["/", "Diviser par"], ["+", "Ajouter"], ["-", "Soustraire"]], "*")) + lg("Valeur", hTxt("k", "1000")) + "</div>" +
        '<p class="note">Exemples : diviser par 1000 pour passer des mm aux m, multiplier par 1.081 pour ajouter la TVA.</p>',
      surOk: function(d){
        var k = C.nombre(val(d, "k")), op = val(d, "op");
        if (isNaN(k)) throw new Error("La valeur n'est pas un nombre.");
        if (op === "/" && k === 0) throw new Error("Division par zéro.");
        transformer("Calcul " + op + " " + C.texteNombre(k), function(v){
          var x = C.nombre(v);
          if (v === "" || isNaN(x) || C.codeTexte(v.trim())) return v;
          var r = C.texteNombre(op === "*" ? x * k : op === "/" ? x / k : op === "+" ? x + k : x - k);
          return avecVirgule(v) ? r.replace(".", ",") : r;
        });
      } });
  };
  function transformerDates(fmt, lib){
    transformer(lib, function(v){ var d = C.date(v); return isNaN(d) ? v : C.formatDate(d, fmt); });
  }
  CMD["t-date-iso"] = function(){ transformerDates("iso", "Dates au format 2026-11-21"); };
  CMD["t-date-ch"] = function(){ transformerDates("ch", "Dates au format 21.11.2026"); };
  CMD["t-affixe"] = function(){
    fenetre({ titre: "Ajouter un texte", ok: "Appliquer",
      html: '<div class="rang">' + lg("Devant", hTxt("avant", "")) + lg("Derrière", hTxt("apres", "")) + "</div>" + hCoche("vides", "Laisser les cellules vides telles quelles", true),
      surOk: function(d){
        var a = val(d, "avant"), b = val(d, "apres"), vides = val(d, "vides");
        if (!a && !b) throw new Error("Indique un texte à ajouter.");
        transformer("Ajouter un texte", function(v){ return v === "" && vides ? v : a + v + b; });
      } });
  };
  CMD["t-zeros"] = function(){
    saisir("Compléter avec des zéros", "Longueur voulue", "4", function(s){
      var n = parseInt(s, 10);
      if (!(n >= 1 && n <= 40)) throw new Error("Indique une longueur entre 1 et 40.");
      transformer("Compléter avec des zéros", function(v){
        if (!/^\d+$/.test(v)) return v;
        while (v.length < n) v = "0" + v;
        return v;
      });
    }, { type: "number", note: "Seules les cellules faites uniquement de chiffres sont complétées : 12 devient 0012." });
  };
  CMD["t-vides-dessus"] = function(){
    var q = rect(), n = 0;
    if (!D.vue.length) return;
    modifier("Remplir les vides", function(){
      for (var c = q.c0; c <= q.c1; c++){
        var ci = D.vc[c], dernier = "";
        for (var r = q.r0; r <= q.r1; r++){
          var i = D.vue[r], v = D.lignes[i][ci];
          if (v !== "") dernier = v;
          else if (dernier !== ""){ ligneModif(i)[ci] = dernier; n++; }
        }
      }
      if (!n) return false;
    });
    etat(n ? pluriel(n, "cellule vide remplie", "cellules vides remplies") + " avec la valeur du dessus." : "Aucun vide à remplir dans la sélection (sélectionne une colonne entière par son titre).");
  };
  CMD["t-vides-valeur"] = function(){
    saisir("Remplir les vides", "Valeur à écrire dans les cellules vides de la sélection", "0", function(s){
      transformer("Remplir les vides", function(v){ return v === "" ? s : v; });
    });
  };

  // ---------- Aide ----------
  CMD.raccourcis = function(){
    function t(l){ return '<table class="aide-table">' + l.map(function(x){ return "<tr><td><kbd>" + x[0].split("+").join("</kbd> + <kbd>") + "</kbd></td><td>" + x[1] + "</td></tr>"; }).join("") + "</table>"; }
    message("Raccourcis et astuces", '<div class="aide-cols">' +
      t([["F2", "modifier la cellule (ou double-clic, ou taper)"], ["Alt+Entrée", "retour à la ligne dans la cellule"], ["Entrée", "valider et descendre"], ["Tab", "valider et aller à droite"],
         ["Suppr", "effacer la sélection"], ["Ctrl+D", "recopier la première ligne vers le bas"], ["Ctrl+Z", "annuler"], ["Ctrl+Y", "rétablir"],
         ["Ctrl+C", "copier (se colle dans Excel)"], ["Ctrl+V", "coller depuis Excel ou un autre tableau"]]) +
      t([["Ctrl+F", "rechercher"], ["Ctrl+H", "remplacer"], ["Ctrl+G", "aller à une ligne"], ["Alt+↓", "trier et filtrer la colonne"], ["Ctrl+Maj+L", "filtrer sur la valeur de la cellule"],
         ["Ctrl+Espace", "sélectionner la colonne"], ["Maj+Espace", "sélectionner la ligne"], ["Ctrl+A", "tout sélectionner"], ["Ctrl+S", "enregistrer le CSV"], ["Ctrl+O", "ouvrir un fichier"]]) +
      "</div><p>Clic sur un titre : sélectionne la colonne. Double-clic : la renomme. Le bord droit d'un titre se tire pour élargir, double-clic pour ajuster. Clic droit partout pour les actions. " +
      "Le menu Transformer agit sur la sélection : clique d'abord le titre de la colonne à nettoyer.</p>", true);
  };
  CMD["a-propos"] = function(){
    message("CSV Studio v" + VERSION, "<p>Ouvre des fichiers CSV, TSV, texte, Excel .xlsx et JSON ; détecte le séparateur et l'encodage ; trie, filtre, recherche, nettoie, compare, croise, puis réécrit en CSV, Excel, JSON, Markdown, HTML ou SQL.</p>" +
      "<p>Tout se passe dans ton navigateur : aucun fichier n'est envoyé sur un serveur. Les fichiers récents sont gardés dans la mémoire de ce navigateur, sur ce poste.</p>" +
      "<p>Un trieur ou un filtre ne change jamais le fichier : ils ne font que choisir ce qui s'affiche. « Enregistrer » écrit toutes les lignes ; « Exporter » laisse choisir.</p>" +
      '<p class="note">STR Bim Tools · by Tony Varin</p>');
  };

  // ====================================================================================================
  // Thème et démarrage
  // ====================================================================================================
  function appliquerTheme(choix){
    garder("csv.theme", choix);
    var c = choix === "systeme" ? (matchMedia("(prefers-color-scheme: light)").matches ? "clair" : "sombre") : choix;
    document.documentElement.setAttribute("data-theme", c);
    var meta = document.querySelector("meta[name=theme-color]");
    if (meta) meta.setAttribute("content", c === "clair" ? "#F3F3F3" : "#202020");
    [].forEach.call(document.querySelectorAll("[data-choix-theme]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-choix-theme") === choix)); });
    window.dispatchEvent(new Event("csv-theme"));
  }
  (function(){
    var btn = id("theme-btn"), menu = id("menu-theme"), choix = lireReglage("csv.theme") || "sombre";
    [].forEach.call(document.querySelectorAll("[data-choix-theme]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-choix-theme") === choix)); });
    btn.addEventListener("click", function(e){ e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
    menu.addEventListener("click", function(e){
      var b = e.target.closest("[data-choix-theme]");
      if (b){ appliquerTheme(b.getAttribute("data-choix-theme")); menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("click", function(e){ if (!menu.hidden && !menu.contains(e.target)){ menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", function(){ if ((lireReglage("csv.theme") || "sombre") === "systeme") appliquerTheme("systeme"); });
  })();

  if (lireReglage("csv.profil")){ profilOuvert = true; el.profil.hidden = false; }
  afficherRecents();
})();
