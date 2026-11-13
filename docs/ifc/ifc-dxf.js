/* IFC Studio — document DXF en mémoire et écriture DXF R12 texte (2D ou 3D).
 *
 * Le document est une structure simple, faite pour être relue et retravaillée (futur éditeur DXF) :
 *   doc = { unite: "m", calques: [{ nom, couleur (ACI 1–255), type: "CONTINUOUS" | "AXE" }],
 *           entites: [{ type: "LIGNE" | "POLYLIGNE" | "POINT", calque, pts: [[x, y, z]…], ferme, info }] }
 *   info : données libres attachées à l'entité (ex. { ifc: { gid, type, nom } }), gardées en mémoire, pas écrites.
 *
 *   var doc = DXF.document();
 *   DXF.calque(doc, "STR_MURS", 1);
 *   DXF.ligne(doc, "STR_MURS", [0, 0, 0], [5, 0, 0], info);
 *   DXF.polyligne(doc, "STR_DALLES", pts, true, info);
 *   DXF.telecharger(DXF.ecrire(doc), "plan.dxf");
 */
(function(){
  "use strict";

  function document_(){ return { unite: "m", calques: [], entites: [], vus: new Set() }; }

  function calque(doc, nom, couleur, type){
    if (!doc.calques.some(function(c){ return c.nom === nom; })) doc.calques.push({ nom: nom, couleur: couleur || 7, type: type || "CONTINUOUS" });
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

  // Étendue du document : { min: [x, y, z], max: [x, y, z] } (zéros s'il est vide)
  function etendue(doc){
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    doc.entites.forEach(function(e){ e.pts.forEach(function(p){ for (var i = 0; i < 3; i++){ if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i]; } }); });
    if (!isFinite(mn[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
    return { min: mn, max: mx };
  }

  // DXF R12 (AC1009) texte, fins de ligne Windows ; polylignes 3D (POLYLINE drapeau 8)
  function ecrire(doc){
    var L = [];
    function g(code, v){ L.push(String(code), String(v)); }
    function xyz(p, d){ g(10 + (d || 0), nb(p[0])); g(20 + (d || 0), nb(p[1])); g(30 + (d || 0), nb(p[2])); }
    var E = etendue(doc);
    g(0, "SECTION"); g(2, "HEADER");
    g(9, "$ACADVER"); g(1, "AC1009");
    g(9, "$INSUNITS"); g(70, doc.unite === "mm" ? 4 : 6);
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
    g(0, "TABLE"); g(2, "LAYER"); g(70, doc.calques.length + 1);
    g(0, "LAYER"); g(2, "0"); g(70, 0); g(62, 7); g(6, "CONTINUOUS");
    doc.calques.forEach(function(c){ if (c.nom !== "0"){ g(0, "LAYER"); g(2, c.nom); g(70, 0); g(62, c.couleur); g(6, c.type); } });
    g(0, "ENDTAB");
    g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    doc.entites.forEach(function(e){
      if (e.type === "LIGNE"){ g(0, "LINE"); g(8, e.calque); xyz(e.pts[0]); xyz(e.pts[1], 1); }
      else if (e.type === "POINT"){ g(0, "POINT"); g(8, e.calque); xyz(e.pts[0]); }
      else if (e.type === "POLYLIGNE"){
        g(0, "POLYLINE"); g(8, e.calque); g(66, 1); g(10, "0.0"); g(20, "0.0"); g(30, "0.0"); g(70, 8 | (e.ferme ? 1 : 0));
        e.pts.forEach(function(p){ g(0, "VERTEX"); g(8, e.calque); xyz(p); g(70, 32); });
        g(0, "SEQEND"); g(8, e.calque);
      }
    });
    g(0, "ENDSEC"); g(0, "EOF");
    return L.join("\r\n") + "\r\n";
  }

  function telecharger(texte, nom){
    var blob = new Blob([texte], { type: "application/dxf" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  }

  window.DXF = { document: document_, calque: calque, ligne: ligne, polyligne: polyligne, point: point,
    etendue: etendue, ecrire: ecrire, telecharger: telecharger };
})();
