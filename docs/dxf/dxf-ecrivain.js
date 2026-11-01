/* STR Bim Tools · écriture d'une scène lue (DXF.lire) en DXF AutoCAD 2000 (AC1015) complet : poignées, table des
   blocs, espace objet, présentations, dictionnaires. Sert à préparer la conversion DWG par LibreDWG, qui ne reprend
   rien d'un DXF R12 (pas de table BLOCK_RECORD). Le dessin est écrit à plat : blocs éclatés, polylignes, textes. */
(function(global){
  "use strict";

  // couleur RGB → index ACI le plus proche (1–255)
  var cacheAci = new Map();
  function aci(rgb){
    if (rgb === -1) return 7;
    if (cacheAci.has(rgb)) return cacheAci.get(rgb);
    var r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255, best = 7, bd = Infinity;
    for (var i = 1; i < 256; i++){
      var c = DXF.ACI[i];
      if (c === -1) c = 0xFFFFFF;
      var d = Math.pow((c >> 16 & 255) - r, 2) + Math.pow((c >> 8 & 255) - g, 2) + Math.pow((c & 255) - b, 2);
      if (d < bd){ bd = d; best = i; }
    }
    cacheAci.set(rgb, best);
    return best;
  }
  function nb(v){ return isFinite(v) ? String(Math.round(v*1e6)/1e6) : "0"; }
  function nomCalque(n){ return String(n || "0").replace(/[<>\/\\":;?*|=`]/g, "_"); }

  function ecrire(S){
    var L = [], h = 0x20;
    function g(c, v){ L.push(String(c), String(v)); }
    function poignee(){ return (h++).toString(16).toUpperCase(); }
    // poignées fixes
    var H = {};
    ["blkCtl", "lyrCtl", "styCtl", "ltCtl", "viewCtl", "ucsCtl", "vpCtl", "appCtl", "dimCtl",
     "brModel", "brPaper", "blkModel", "endModel", "blkPaper", "endPaper",
     "ltByBlock", "ltByLayer", "ltCont", "styStd", "appAcad", "dimStd", "vpActif",
     "dicRacine", "dicGroupes", "dicPres", "dicPlot", "dicStyles", "plotNormal", "presModel", "presPapier"].forEach(function(k){ H[k] = poignee(); });
    var calques = S.calques.map(function(c){ return { nom: nomCalque(c.nom), aci: aci(c.couleur), off: !c.visible, h: poignee() }; });

    // ---------- HEADER ----------
    g(0, "SECTION"); g(2, "HEADER");
    g(9, "$ACADVER"); g(1, "AC1015");
    g(9, "$ACADMAINTVER"); g(70, 6);
    g(9, "$DWGCODEPAGE"); g(3, "ANSI_1252");
    g(9, "$INSBASE"); g(10, 0); g(20, 0); g(30, 0);
    g(9, "$EXTMIN"); g(10, nb(S.min[0])); g(20, nb(S.min[1])); g(30, 0);
    g(9, "$EXTMAX"); g(10, nb(S.max[0])); g(20, nb(S.max[1])); g(30, 0);
    g(9, "$LIMMIN"); g(10, 0); g(20, 0);
    g(9, "$LIMMAX"); g(10, 420); g(20, 297);
    g(9, "$CLAYER"); g(8, "0");
    g(9, "$CELTYPE"); g(6, "ByLayer");
    g(9, "$CECOLOR"); g(62, 256);
    g(9, "$INSUNITS"); g(70, S.unites || 0);
    g(9, "$MEASUREMENT"); g(70, 1);
    g(9, "$LUNITS"); g(70, 2);
    g(9, "$LUPREC"); g(70, 4);
    var posSeed = L.length;
    g(9, "$HANDSEED"); g(5, "FFFF");
    g(0, "ENDSEC");

    // ---------- CLASSES ----------
    // objets « classes » d'AutoCAD 2000 : à déclarer, sinon LibreDWG ne sait pas les écrire
    g(0, "SECTION"); g(2, "CLASSES");
    [["ACDBDICTIONARYWDFLT", "AcDbDictionaryWithDefault"], ["ACDBPLACEHOLDER", "AcDbPlaceHolder"], ["LAYOUT", "AcDbLayout"]].forEach(function(k){
      g(0, "CLASS"); g(1, k[0]); g(2, k[1]); g(3, "ObjectDBX Classes"); g(90, 0); g(280, 0); g(281, 0);
    });
    g(0, "ENDSEC");

    // ---------- TABLES ----------
    g(0, "SECTION"); g(2, "TABLES");
    function table(nom, hc, n, corps){
      g(0, "TABLE"); g(2, nom); g(5, hc); g(330, 0); g(100, "AcDbSymbolTable"); g(70, n);
      corps();
      g(0, "ENDTAB");
    }
    table("VPORT", H.vpCtl, 1, function(){
      var cx = (S.min[0] + S.max[0])/2, cy = (S.min[1] + S.max[1])/2, ht = Math.max(1, (S.max[1] - S.min[1])*1.1);
      if (!isFinite(cx)){ cx = 0; cy = 0; ht = 100; }
      g(0, "VPORT"); g(5, H.vpActif); g(330, H.vpCtl); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbViewportTableRecord");
      g(2, "*Active"); g(70, 0); g(10, 0); g(20, 0); g(11, 1); g(21, 1); g(12, nb(cx)); g(22, nb(cy)); g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10);
      g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0); g(40, nb(ht)); g(41, 1.6); g(42, 50); g(43, 0); g(44, 0); g(50, 0); g(51, 0);
      g(71, 0); g(72, 1000); g(73, 1); g(74, 3); g(75, 0); g(76, 0); g(77, 0); g(78, 0); g(281, 0); g(65, 1); g(110, 0); g(120, 0); g(130, 0); g(111, 1); g(121, 0); g(131, 0); g(112, 0); g(122, 1); g(132, 0); g(79, 0); g(146, 0);
    });
    table("LTYPE", H.ltCtl, 3, function(){
      [["ByBlock", H.ltByBlock], ["ByLayer", H.ltByLayer], ["Continuous", H.ltCont]].forEach(function(t){
        g(0, "LTYPE"); g(5, t[1]); g(330, H.ltCtl); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbLinetypeTableRecord");
        g(2, t[0]); g(70, 0); g(3, t[0] === "Continuous" ? "Solid line" : ""); g(72, 65); g(73, 0); g(40, 0);
      });
    });
    table("LAYER", H.lyrCtl, calques.length, function(){
      calques.forEach(function(c){
        g(0, "LAYER"); g(5, c.h); g(330, H.lyrCtl); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbLayerTableRecord");
        g(2, c.nom); g(70, 0); g(62, c.off ? -c.aci : c.aci); g(6, "Continuous"); g(370, -3); g(390, H.plotNormal);
      });
    });
    table("STYLE", H.styCtl, 1, function(){
      g(0, "STYLE"); g(5, H.styStd); g(330, H.styCtl); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbTextStyleTableRecord");
      g(2, "Standard"); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, "txt"); g(4, "");
    });
    table("VIEW", H.viewCtl, 0, function(){});
    table("UCS", H.ucsCtl, 0, function(){});
    table("APPID", H.appCtl, 1, function(){
      g(0, "APPID"); g(5, H.appAcad); g(330, H.appCtl); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbRegAppTableRecord"); g(2, "ACAD"); g(70, 0);
    });
    g(0, "TABLE"); g(2, "DIMSTYLE"); g(5, H.dimCtl); g(330, 0); g(100, "AcDbSymbolTable"); g(70, 1); g(100, "AcDbDimStyleTable"); g(71, 0);
    g(0, "DIMSTYLE"); g(105, H.dimStd); g(330, H.dimCtl); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbDimStyleTableRecord"); g(2, "Standard"); g(70, 0);
    g(0, "ENDTAB");
    table("BLOCK_RECORD", H.blkCtl, 2, function(){
      [["*Model_Space", H.brModel, H.presModel], ["*Paper_Space", H.brPaper, H.presPapier]].forEach(function(b){
        g(0, "BLOCK_RECORD"); g(5, b[1]); g(330, H.blkCtl); g(100, "AcDbSymbolTableRecord"); g(100, "AcDbBlockTableRecord"); g(2, b[0]); g(340, b[2]);
      });
    });
    g(0, "ENDSEC");

    // ---------- BLOCKS ----------
    g(0, "SECTION"); g(2, "BLOCKS");
    [["*Model_Space", H.brModel, H.blkModel, H.endModel], ["*Paper_Space", H.brPaper, H.blkPaper, H.endPaper]].forEach(function(b){
      g(0, "BLOCK"); g(5, b[2]); g(330, b[1]); g(100, "AcDbEntity"); g(8, "0"); g(100, "AcDbBlockBegin"); g(2, b[0]); g(70, 0); g(10, 0); g(20, 0); g(30, 0); g(3, b[0]); g(1, "");
      g(0, "ENDBLK"); g(5, b[3]); g(330, b[1]); g(100, "AcDbEntity"); g(8, "0"); g(100, "AcDbBlockEnd");
    });
    g(0, "ENDSEC");

    // ---------- ENTITIES ----------
    g(0, "SECTION"); g(2, "ENTITIES");
    var n = 0;
    function entete(type, c, col){
      g(0, type); g(5, poignee()); g(330, H.brModel); g(100, "AcDbEntity"); g(8, calques[c].nom);
      var a = col === S.calques[c].couleur ? 256 : aci(col);
      if (a !== 256) g(62, a);
      n++;
    }
    function polyligne(c, col, p){
      var nv = p.length/2, ferme = nv > 2 && Math.abs(p[0] - p[p.length - 2]) < 1e-9 && Math.abs(p[1] - p[p.length - 1]) < 1e-9;
      if (ferme) nv--;
      if (nv < 2) return;
      if (nv === 2 && !ferme){
        entete("LINE", c, col); g(100, "AcDbLine"); g(10, nb(p[0])); g(20, nb(p[1])); g(30, 0); g(11, nb(p[2])); g(21, nb(p[3])); g(31, 0);
        return;
      }
      entete("LWPOLYLINE", c, col); g(100, "AcDbPolyline"); g(90, nv); g(70, ferme ? 1 : 0); g(43, 0);
      for (var q = 0; q < nv; q++){ g(10, nb(p[2*q])); g(20, nb(p[2*q + 1])); }
    }
    S.polys.forEach(function(P){ polyligne(P.c, P.col, P.p); });
    S.fills.forEach(function(F){ if (F.alpha >= 1) F.contours.forEach(function(p){ var q = p.slice(); if (q[0] !== q[q.length - 2] || q[1] !== q[q.length - 1]) q.push(q[0], q[1]); polyligne(F.c, F.col, q); }); });
    S.textes.forEach(function(T){
      var pas = T.h*1.667;
      T.l.forEach(function(ligne, k){
        if (!String(ligne).trim()) return;
        // décalage des lignes suivantes vers le bas, dans le sens du texte
        var dx = Math.sin(T.rot)*pas*k, dy = -Math.cos(T.rot)*pas*k;
        var x = T.x + dx, y = T.y + dy, ah = T.ah > 2 ? 0 : T.ah, av = T.av;
        if (T.multi && av === 3){ x += Math.sin(T.rot)*T.h; y -= Math.cos(T.rot)*T.h; av = 0; }
        entete("TEXT", T.c, T.col); g(100, "AcDbText"); g(10, nb(x)); g(20, nb(y)); g(30, 0); g(40, nb(T.h)); g(1, ligne);
        if (T.rot) g(50, nb(T.rot*180/Math.PI));
        if (T.w !== 1) g(41, nb(T.w));
        g(7, "Standard");
        if (ah) g(72, ah);
        if (ah || av){ g(11, nb(x)); g(21, nb(y)); g(31, 0); }
        g(100, "AcDbText");
        if (av) g(73, av);
      });
    });
    g(0, "ENDSEC");

    // ---------- OBJECTS ----------
    g(0, "SECTION"); g(2, "OBJECTS");
    g(0, "DICTIONARY"); g(5, H.dicRacine); g(330, 0); g(100, "AcDbDictionary"); g(281, 1);
    g(3, "ACAD_GROUP"); g(350, H.dicGroupes);
    g(3, "ACAD_LAYOUT"); g(350, H.dicPres);
    g(3, "ACAD_PLOTSTYLENAME"); g(350, H.dicStyles);
    g(3, "ACAD_PLOTSETTINGS"); g(350, H.dicPlot);
    g(0, "DICTIONARY"); g(5, H.dicGroupes); g(330, H.dicRacine); g(100, "AcDbDictionary"); g(281, 1);
    g(0, "DICTIONARY"); g(5, H.dicPlot); g(330, H.dicRacine); g(100, "AcDbDictionary"); g(281, 1);
    g(0, "ACDBDICTIONARYWDFLT"); g(5, H.dicStyles); g(330, H.dicRacine); g(100, "AcDbDictionary"); g(281, 1); g(3, "Normal"); g(350, H.plotNormal); g(100, "AcDbDictionaryWithDefault"); g(340, H.plotNormal);
    g(0, "ACDBPLACEHOLDER"); g(5, H.plotNormal); g(330, H.dicStyles);
    g(0, "DICTIONARY"); g(5, H.dicPres); g(330, H.dicRacine); g(100, "AcDbDictionary"); g(281, 1); g(3, "Layout1"); g(350, H.presPapier); g(3, "Model"); g(350, H.presModel);
    [["Model", H.presModel, H.brModel, 0], ["Layout1", H.presPapier, H.brPaper, 1]].forEach(function(p){
      g(0, "LAYOUT"); g(5, p[1]); g(330, H.dicPres); g(100, "AcDbPlotSettings"); g(1, ""); g(2, "none_device"); g(4, ""); g(6, "");
      g(40, 0); g(41, 0); g(42, 0); g(43, 0); g(44, 0); g(45, 0); g(46, 0); g(47, 0); g(48, 0); g(49, 0); g(140, 0); g(141, 0); g(142, 1); g(143, 1);
      g(70, p[3] ? 688 : 1712); g(72, 1); g(73, 0); g(74, 5); g(7, ""); g(75, 16); g(147, 1); g(148, 0); g(149, 0);
      g(100, "AcDbLayout"); g(1, p[0]); g(70, 1); g(71, p[3]); g(10, 0); g(20, 0); g(11, 420); g(21, 297); g(12, 0); g(22, 0); g(32, 0);
      g(14, 0); g(24, 0); g(34, 0); g(15, 0); g(25, 0); g(35, 0); g(146, 0); g(13, 0); g(23, 0); g(33, 0); g(16, 1); g(26, 0); g(36, 0); g(17, 0); g(27, 1); g(37, 0);
      g(76, 0); g(330, p[2]);
    });
    g(0, "ENDSEC");
    g(0, "EOF");
    L[posSeed + 3] = h.toString(16).toUpperCase();
    return { texte: L.join("\r\n") + "\r\n", entites: n };
  }
  DXF.ecrire2000 = ecrire;
})(window);
