/* STR Bim Tools · DXF 3D en mémoire : lecture et écriture (DXF R12 texte), partagé par IFC Studio (export du
 * modèle analytique) et l'éditeur DXF (/dxf/, mode 3D).
 *
 * Le document est une structure simple, faite pour être retravaillée :
 *   doc = { unite: "m", calques: [{ nom, couleur (ACI 1–255), type: nom du type de ligne, visible }],
 *           entites: [{ type: "LIGNE" | "POLYLIGNE" | "POINT", calque, pts: [[x, y, z]…], ferme, couleur?, info }],
 *           ignores: { TYPE: nombre } (lecture : objets d'autres types, non repris) }
 *   info : données libres attachées à l'entité (ex. { ifc: { gid, type, nom } }), gardées en mémoire, pas écrites.
 *   couleur : ACI propre à l'entité (absente = DuCalque).
 *
 *   var doc = DXF3D.document();
 *   DXF3D.calque(doc, "STR_MURS", 1);
 *   DXF3D.ligne(doc, "STR_MURS", [0, 0, 0], [5, 0, 0], info);
 *   DXF3D.polyligne(doc, "STR_DALLES", pts, true, info);
 *   DXF3D.telecharger(DXF3D.ecrire(doc), "plan.dxf");
 *   var doc2 = DXF3D.lire(texteOuArrayBuffer);
 */
(function(){
  "use strict";

  function document_(){ return { unite: "m", calques: [], entites: [], ignores: {}, vus: new Set() }; }

  function calque(doc, nom, couleur, type){
    var c = null;
    doc.calques.forEach(function(k){ if (k.nom === nom) c = k; });
    if (!c){ c = { nom: nom, couleur: couleur || 7, type: type || "CONTINUOUS", visible: true }; doc.calques.push(c); }
    return c;
  }
  function p3(p){ return [+p[0] || 0, +p[1] || 0, +p[2] || 0]; }
  function nb(v){ return (Math.round(v*1e4)/1e4).toFixed(4); }
  function clePt(p){ return nb(p[0]) + "," + nb(p[1]) + "," + nb(p[2]); }

  // Ligne ; un doublon exact sur le même calque (dans un sens ou dans l'autre) est ignoré
  function ligne(doc, cal, a, b, info){
    a = p3(a); b = p3(b);
    var ka = clePt(a), kb = clePt(b);
    if (ka === kb) return null;
    var k = cal + "|" + (ka < kb ? ka + "|" + kb : kb + "|" + ka);
    if (!doc.vus) doc.vus = new Set();
    if (doc.vus.has(k)) return null;
    doc.vus.add(k);
    var e = { type: "LIGNE", calque: cal, pts: [a, b], ferme: false, info: info || null };
    doc.entites.push(e);
    return e;
  }
  // Polyligne 3D ; deux points ouverts → ligne
  function polyligne(doc, cal, pts, ferme, info){
    pts = pts.map(p3);
    if (pts.length < 2) return null;
    if (pts.length === 2 && !ferme) return ligne(doc, cal, pts[0], pts[1], info);
    var e = { type: "POLYLIGNE", calque: cal, pts: pts, ferme: !!ferme, info: info || null };
    doc.entites.push(e);
    return e;
  }
  function point(doc, cal, p, info){
    var e = { type: "POINT", calque: cal, pts: [p3(p)], ferme: false, info: info || null };
    doc.entites.push(e);
    return e;
  }

  // Étendue du document : { min: [x, y, z], max: [x, y, z] } (zéros s'il est vide) ; seulement les calques
  // visibles si visibles est vrai
  function etendue(doc, visibles){
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], vis = null;
    if (visibles){ vis = new Set(); doc.calques.forEach(function(c){ if (c.visible !== false) vis.add(c.nom); }); }
    doc.entites.forEach(function(e){
      if (vis && !vis.has(e.calque)) return;
      e.pts.forEach(function(p){ for (var i = 0; i < 3; i++){ if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i]; } });
    });
    if (!isFinite(mn[0])) return { min: [0, 0, 0], max: [0, 0, 0], vide: true };
    return { min: mn, max: mx };
  }

  // ================= Écriture : DXF R12 (AC1009) texte, fins de ligne Windows ; polylignes 3D (POLYLINE drapeau 8) =================
  var TYPES_CONNUS = { CONTINUOUS: 1, AXE: 1 };
  function ecrire(doc){
    var L = [];
    function g(code, v){ L.push(String(code), String(v)); }
    function xyz(p, d){ g(10 + (d || 0), nb(p[0])); g(20 + (d || 0), nb(p[1])); g(30 + (d || 0), nb(p[2])); }
    function coul(e){ if (e.couleur != null && e.couleur !== 256 && e.couleur > 0 && e.couleur < 256) g(62, e.couleur); }
    var E = etendue(doc);
    // calques utilisés par une entité mais absents de la table : ajoutés
    var noms = new Set(doc.calques.map(function(c){ return c.nom; })), cals = doc.calques.slice();
    doc.entites.forEach(function(e){ if (!noms.has(e.calque)){ noms.add(e.calque); cals.push({ nom: e.calque, couleur: 7, type: "CONTINUOUS", visible: true }); } });
    g(0, "SECTION"); g(2, "HEADER");
    g(9, "$ACADVER"); g(1, "AC1009");
    g(9, "$INSUNITS"); g(70, doc.unite === "mm" ? 4 : doc.unite === "cm" ? 5 : 6);
    g(9, "$LTSCALE"); g(40, "1.0");
    g(9, "$EXTMIN"); xyz(E.min);
    g(9, "$EXTMAX"); xyz(E.max);
    g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES");
    g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
    g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, "0.0");
    // axe : trait mixte (long 0,60 m, vide 0,10, point 0,02, vide 0,10)
    g(0, "LTYPE"); g(2, "AXE"); g(70, 0); g(3, "Axe ____ . ____ . ____"); g(72, 65); g(73, 4); g(40, "0.82");
    g(49, "0.60"); g(49, "-0.10"); g(49, "0.02"); g(49, "-0.10");
    g(0, "ENDTAB");
    var avec0 = noms.has("0");
    g(0, "TABLE"); g(2, "LAYER"); g(70, cals.length + (avec0 ? 0 : 1));
    if (!avec0){ g(0, "LAYER"); g(2, "0"); g(70, 0); g(62, 7); g(6, "CONTINUOUS"); }
    cals.forEach(function(c){
      // calque masqué : couleur négative (éteint), comme AutoCAD
      var col = Math.max(1, Math.min(255, c.couleur || 7));
      g(0, "LAYER"); g(2, c.nom); g(70, 0); g(62, c.visible === false ? -col : col); g(6, TYPES_CONNUS[c.type] ? c.type : "CONTINUOUS");
    });
    g(0, "ENDTAB");
    g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    doc.entites.forEach(function(e){
      if (e.type === "LIGNE"){ g(0, "LINE"); g(8, e.calque); coul(e); xyz(e.pts[0]); xyz(e.pts[1], 1); }
      else if (e.type === "POINT"){ g(0, "POINT"); g(8, e.calque); coul(e); xyz(e.pts[0]); }
      else if (e.type === "POLYLIGNE"){
        g(0, "POLYLINE"); g(8, e.calque); coul(e); g(66, 1); g(10, "0.0"); g(20, "0.0"); g(30, "0.0"); g(70, 8 | (e.ferme ? 1 : 0));
        e.pts.forEach(function(p){ g(0, "VERTEX"); g(8, e.calque); xyz(p); g(70, 32); });
        g(0, "SEQEND"); g(8, e.calque);
      }
    });
    g(0, "ENDSEC"); g(0, "EOF");
    return L.join("\r\n") + "\r\n";
  }

  // ================= Lecture : lignes, polylignes (2D, 3D, légères), points ; le reste est compté dans ignores =================
  function texteDe(buf){
    if (typeof buf === "string") return buf;
    var u8 = new Uint8Array(buf);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); }
    catch (e){ return new TextDecoder("windows-1252").decode(u8); }
  }
  function lire(buf){
    var l = texteDe(buf).split(/\r\n|\n|\r/), C = [], V = [];
    for (var i = 0; i + 1 < l.length; i += 2){
      var c = parseInt(l[i], 10);
      if (isNaN(c)) continue;
      C.push(c); V.push(l[i + 1].trim());
    }
    var doc = document_(), n = C.length, k = 0, section = "";
    for (var h = 0; h + 1 < n; h++) if (C[h] === 9 && V[h] === "$INSUNITS"){ var u = parseInt(V[h + 1], 10); doc.unite = u === 4 ? "mm" : u === 5 ? "cm" : "m"; break; }
    // objet : type + groupes jusqu'au prochain code 0
    function objet(){
      var o = { type: V[k], g: [] };
      k++;
      while (k < n && C[k] !== 0){ o.g.push([C[k], V[k]]); k++; }
      return o;
    }
    function val(o, code, def){ for (var j = 0; j < o.g.length; j++) if (o.g[j][0] === code) return o.g[j][1]; return def; }
    function num(o, code, def){ var v = parseFloat(val(o, code)); return isFinite(v) ? v : def; }
    function compter(t){ doc.ignores[t] = (doc.ignores[t] || 0) + 1; }
    function cal(o){ var nom = val(o, 8, "0"); if (!doc.calques.some(function(c){ return c.nom === nom; })) calque(doc, nom, 7); return nom; }
    function couleur(o){ var c = parseInt(val(o, 62, "256"), 10); return isFinite(c) && c > 0 && c < 256 ? c : null; }
    function pousser(e, o){ var c = couleur(o); if (c != null) e.couleur = c; doc.entites.push(e); }
    // repère objet (OCS) d'une polyligne 2D : seul le cas courant de l'extrusion −Z (miroir) est repris
    function ocsX(o){ return num(o, 230, 1) < 0 ? -1 : 1; }
    while (k < n){
      if (C[k] !== 0){ k++; continue; }
      var t = V[k];
      if (t === "SECTION"){ section = V[k + 1] || ""; k += 2; continue; }
      if (t === "ENDSEC"){ section = ""; k++; continue; }
      if (t === "EOF") break;
      var o = objet();
      if (section === "TABLES" && o.type === "LAYER"){
        var nomC = val(o, 2, "0"), col = parseInt(val(o, 62, "7"), 10) || 7, ex = null;
        doc.calques.forEach(function(c){ if (c.nom === nomC) ex = c; });
        if (!ex) ex = calque(doc, nomC, Math.abs(col), val(o, 6, "CONTINUOUS"));
        else { ex.couleur = Math.abs(col); ex.type = val(o, 6, "CONTINUOUS"); }
        ex.visible = col > 0 && !(parseInt(val(o, 70, "0"), 10) & 1);
        continue;
      }
      if (section !== "ENTITIES") continue;
      if (o.type === "LINE"){
        pousser({ type: "LIGNE", calque: cal(o), pts: [[num(o, 10, 0), num(o, 20, 0), num(o, 30, 0)], [num(o, 11, 0), num(o, 21, 0), num(o, 31, 0)]], ferme: false, info: null }, o);
      } else if (o.type === "POINT"){
        pousser({ type: "POINT", calque: cal(o), pts: [[num(o, 10, 0), num(o, 20, 0), num(o, 30, 0)]], ferme: false, info: null }, o);
      } else if (o.type === "LWPOLYLINE"){
        var z = num(o, 38, 0), sx = ocsX(o), pts = [], x = null, a3 = false;
        o.g.forEach(function(q){
          if (q[0] === 10) x = parseFloat(q[1]);
          else if (q[0] === 20 && x !== null){ pts.push([sx*x, parseFloat(q[1]), z]); x = null; }
          else if (q[0] === 42 && parseFloat(q[1])) a3 = true;
        });
        if (a3) compter("arcs de LWPOLYLINE (redressés)");
        if (pts.length > 1) pousser({ type: "POLYLIGNE", calque: cal(o), pts: pts, ferme: !!(parseInt(val(o, 70, "0"), 10) & 1), info: null }, o);
      } else if (o.type === "POLYLINE"){
        var fl = parseInt(val(o, 70, "0"), 10) || 0, zp = num(o, 30, 0), sxp = ocsX(o), sommets = [];
        while (k < n && C[k] === 0 && V[k] === "VERTEX"){
          var v = objet(), vf = parseInt(val(v, 70, "0"), 10) || 0;
          if (vf & (16 | 128)) continue;          // sommet de contrôle de spline, face de maillage
          sommets.push(fl & 8 ? [num(v, 10, 0), num(v, 20, 0), num(v, 30, 0)] : [sxp*num(v, 10, 0), num(v, 20, 0), zp]);
        }
        if (k < n && C[k] === 0 && V[k] === "SEQEND") objet();
        if (fl & (16 | 64)){ compter("POLYLINE (maillage)"); continue; }
        if (sommets.length > 1) pousser({ type: sommets.length === 2 && !(fl & 1) ? "LIGNE" : "POLYLIGNE", calque: cal(o), pts: sommets, ferme: !!(fl & 1) && sommets.length > 2, info: null }, o);
      } else if (o.type !== "SEQEND" && o.type !== "ATTRIB" && o.type !== "VERTEX") compter(o.type);
    }
    return doc;
  }

  function telecharger(texte, nom){
    var blob = new Blob([texte], { type: "application/dxf" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  }

  window.DXF3D = { document: document_, calque: calque, ligne: ligne, polyligne: polyligne, point: point,
    etendue: etendue, ecrire: ecrire, lire: lire, telecharger: telecharger };
})();
