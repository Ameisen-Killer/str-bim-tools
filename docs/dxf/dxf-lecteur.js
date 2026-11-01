/* STR Bim Tools · lecteur DXF (texte), sans bibliothèque.
   DXF.lire(arrayBuffer) → scène : calques, polylignes, remplissages et textes, à plat (vue de dessus, X/Y du
   dessin), blocs éclatés (INSERT, DIMENSION), couleurs AutoCAD (ACI, DuPlan, DuBloc, couleurs vraies).
   Coordonnées : celles du fichier (unités du dessin). L'objet espace papier n'est pas lu. */
(function(global){
  "use strict";

  // ================= Couleurs AutoCAD (ACI) → entier 0xRRGGBB ; -1 = « blanc/noir » (suit le fond) =================
  var ACI = (function(){
    var t = new Array(256);
    var base = [0, 0xFF0000, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0xFF00FF, -1, 0x808080, 0xC0C0C0];
    for (var i = 0; i < 10; i++) t[i] = base[i];
    var V = [1, 1, .8, .8, .6, .6, .5, .5, .3, .3];
    for (i = 10; i < 250; i++){
      var h = Math.floor((i - 10)/10)*15, sub = i % 10, v = V[sub], s = sub % 2 ? .5 : 1;
      t[i] = hsv(h, s, v);
    }
    var gris = [0x33, 0x50, 0x69, 0x82, 0xBE, 0xFF];
    for (i = 250; i < 256; i++){ var g = gris[i - 250]; t[i] = (g << 16) | (g << 8) | g; }
    return t;
  })();
  function hsv(h, s, v){
    var c = v*s, x = c*(1 - Math.abs((h/60) % 2 - 1)), m = v - c, r, g, b;
    if (h < 60){ r = c; g = x; b = 0; } else if (h < 120){ r = x; g = c; b = 0; } else if (h < 180){ r = 0; g = c; b = x; }
    else if (h < 240){ r = 0; g = x; b = c; } else if (h < 300){ r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return (Math.round((r + m)*255) << 16) | (Math.round((g + m)*255) << 8) | Math.round((b + m)*255);
  }

  // ================= Texte du fichier =================
  function decoder(buf){
    var u8 = new Uint8Array(buf);
    var debut = String.fromCharCode.apply(null, u8.subarray(0, 22));
    if (debut.indexOf("AutoCAD Binary DXF") === 0) throw new Error("DXF binaire : enregistre-le en DXF texte (ASCII) depuis AutoCAD.");
    if (debut.indexOf("AC10") === 0) throw new Error("Ce fichier est un DWG renommé, pas un DXF.");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); }
    catch (e){ return new TextDecoder("windows-1252").decode(u8); }
  }
  // Paires (code, valeur) : deux tableaux parallèles
  function paires(txt){
    var l = txt.split(/\r\n|\n|\r/), n = l.length >> 1, codes = new Int32Array(n), vals = new Array(n), k = 0;
    for (var i = 0; i + 1 < l.length; i += 2){
      var c = parseInt(l[i], 10);
      if (isNaN(c)) continue;
      codes[k] = c; vals[k] = (c === 1 || c === 3) ? l[i + 1] : l[i + 1].trim(); k++;
    }
    return { c: codes, v: vals, n: k };
  }

  // Entité brute : type + liste de [code, valeur] jusqu'au prochain code 0
  function Ent(type){ this.type = type; this.g = []; }
  Ent.prototype.s = function(code, def){ for (var i = 0; i < this.g.length; i++) if (this.g[i][0] === code) return this.g[i][1]; return def; };
  Ent.prototype.f = function(code, def){ var v = this.s(code); if (v === undefined) return def; var x = parseFloat(v); return isFinite(x) ? x : def; };
  Ent.prototype.i = function(code, def){ var v = this.s(code); if (v === undefined) return def; var x = parseInt(v, 10); return isFinite(x) ? x : def; };

  // Lecture des sections : en-tête, calques, blocs, entités
  function structure(P){
    var i = 0, R = { entete: {}, calques: [], blocs: new Map(), entites: [] };
    function lireEnts(fin){
      // entités jusqu'à « fin » (ENDSEC, ENDBLK) ; POLYLINE / INSERT absorbent leurs VERTEX / ATTRIB
      var out = [], cur = null, mere = null;
      while (i < P.n){
        var c = P.c[i], v = P.v[i];
        if (c === 0){
          if (v === fin || v === "ENDSEC" || v === "EOF") break;
          var e = new Ent(v);
          i++;
          while (i < P.n && P.c[i] !== 0){ e.g.push([P.c[i], P.v[i]]); i++; }
          if (v === "VERTEX" || v === "ATTRIB"){ if (mere) (mere.sous || (mere.sous = [])).push(e); continue; }
          if (v === "SEQEND"){ mere = null; continue; }
          cur = e; out.push(e);
          mere = (v === "POLYLINE" || (v === "INSERT" && e.i(66, 0) === 1)) ? e : null;
          continue;
        }
        i++;
      }
      return out;
    }
    while (i < P.n){
      if (P.c[i] === 0 && P.v[i] === "SECTION" && P.c[i + 1] === 2){
        var nom = P.v[i + 1]; i += 2;
        if (nom === "HEADER"){
          var var_ = null;
          while (i < P.n && !(P.c[i] === 0 && P.v[i] === "ENDSEC")){
            if (P.c[i] === 9){ var_ = P.v[i]; R.entete[var_] = {}; }
            else if (var_) R.entete[var_][P.c[i]] = P.v[i];
            i++;
          }
        } else if (nom === "TABLES"){
          while (i < P.n && !(P.c[i] === 0 && P.v[i] === "ENDSEC")){
            if (P.c[i] === 0 && P.v[i] === "LAYER"){
              var e = new Ent("LAYER"); i++;
              while (i < P.n && P.c[i] !== 0){ e.g.push([P.c[i], P.v[i]]); i++; }
              R.calques.push(e);
              continue;
            }
            i++;
          }
        } else if (nom === "BLOCKS"){
          while (i < P.n && !(P.c[i] === 0 && P.v[i] === "ENDSEC")){
            if (P.c[i] === 0 && P.v[i] === "BLOCK"){
              var b = new Ent("BLOCK"); i++;
              while (i < P.n && P.c[i] !== 0){ b.g.push([P.c[i], P.v[i]]); i++; }
              b.ents = lireEnts("ENDBLK");
              // passe ENDBLK et ses groupes
              if (i < P.n && P.v[i] === "ENDBLK"){ i++; while (i < P.n && P.c[i] !== 0) i++; }
              R.blocs.set(b.s(2, ""), b);
              continue;
            }
            i++;
          }
        } else if (nom === "ENTITIES"){
          R.entites = lireEnts("ENDSEC");
        }
        while (i < P.n && !(P.c[i] === 0 && P.v[i] === "ENDSEC")) i++;
      }
      i++;
    }
    return R;
  }

  // ================= Géométrie 2D =================
  // Matrice affine [a, b, c, d, e, f] : x' = a x + c y + e ; y' = b x + d y + f
  var ID = [1, 0, 0, 1, 0, 0];
  function mul(A, B){ return [A[0]*B[0] + A[2]*B[1], A[1]*B[0] + A[3]*B[1], A[0]*B[2] + A[2]*B[3], A[1]*B[2] + A[3]*B[3], A[0]*B[4] + A[2]*B[5] + A[4], A[1]*B[4] + A[3]*B[5] + A[5]]; }
  function tr(x, y){ return [1, 0, 0, 1, x, y]; }
  function rot(a){ var c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; }
  function ech(sx, sy){ return [sx, 0, 0, sy, 0, 0]; }
  // Système de coordonnées objet : seule l'extrusion vers le bas (0, 0, −1, dessin en miroir) compte en vue de dessus
  function ocs(e){ return e.f(230, 1) < 0 ? [-1, 0, 0, 1, 0, 0] : ID; }

  function pas(balayage){ return Math.max(4, Math.min(256, Math.ceil(Math.abs(balayage)/(2*Math.PI)*72))); }
  function arc(out, cx, cy, r, a0, a1){
    // a0 → a1 en sens trigo (radians)
    while (a1 <= a0) a1 += 2*Math.PI;
    var n = pas(a1 - a0);
    for (var k = 0; k <= n; k++){ var t = a0 + (a1 - a0)*k/n; out.push(cx + r*Math.cos(t), cy + r*Math.sin(t)); }
  }
  // arc d'un renflement (bulge) entre deux sommets, sans le premier point
  function renflement(out, x1, y1, x2, y2, b){
    var th = 4*Math.atan(b), d = Math.hypot(x2 - x1, y2 - y1);
    if (d < 1e-12 || Math.abs(th) < 1e-9){ out.push(x2, y2); return; }
    var r = d/(2*Math.sin(th/2)), mx = (x1 + x2)/2, my = (y1 + y2)/2, h = r*Math.cos(th/2);
    var nx = -(y2 - y1)/d, ny = (x2 - x1)/d, cx = mx + nx*h, cy = my + ny*h;
    var a0 = Math.atan2(y1 - cy, x1 - cx), n = pas(th);
    var ar = Math.abs(r);
    for (var k = 1; k <= n; k++){ var t = a0 + th*k/n; out.push(cx + ar*Math.cos(t), cy + ar*Math.sin(t)); }
    // garde l'extrémité exacte
    out[out.length - 2] = x2; out[out.length - 1] = y2;
  }
  function ellipse(out, cx, cy, mx, my, ratio, t0, t1, bas){
    var nx = -my*ratio, ny = mx*ratio;
    if (bas){ nx = -nx; ny = -ny; }
    while (t1 <= t0) t1 += 2*Math.PI;
    var n = pas(t1 - t0);
    for (var k = 0; k <= n; k++){ var t = t0 + (t1 - t0)*k/n, c = Math.cos(t), s = Math.sin(t); out.push(cx + c*mx + s*nx, cy + c*my + s*ny); }
  }
  // B-spline (rationnelle ou non) : algorithme de de Boor
  function bspline(out, deg, U, P, W){
    var n = P.length/2;
    if (n < 2) return;
    if (!U || U.length !== n + deg + 1 || deg < 1){ for (var q = 0; q < P.length; q++) out.push(P[q]); return; }
    var t0 = U[deg], t1 = U[n], N = Math.max(8, Math.min(800, n*10));
    for (var k = 0; k <= N; k++){
      var t = t0 + (t1 - t0)*k/N, s = deg;
      while (s < n - 1 && t >= U[s + 1]) s++;
      var d = [];
      for (var j = 0; j <= deg; j++){
        var w = W ? W[s - deg + j] || 1 : 1;
        d.push([P[2*(s - deg + j)]*w, P[2*(s - deg + j) + 1]*w, w]);
      }
      for (var r = 1; r <= deg; r++){
        for (j = deg; j >= r; j--){
          var i = s - deg + j, den = U[i + deg - r + 1] - U[i], a = den ? (t - U[i])/den : 0;
          d[j] = [(1 - a)*d[j - 1][0] + a*d[j][0], (1 - a)*d[j - 1][1] + a*d[j][1], (1 - a)*d[j - 1][2] + a*d[j][2]];
        }
      }
      out.push(d[deg][0]/d[deg][2], d[deg][1]/d[deg][2]);
    }
  }

  // ================= Texte : nettoyage des codes de mise en forme =================
  function unicode(s){
    return String(s || "").replace(/\\U\+([0-9A-Fa-f]{4})/g, function(_, h){ return String.fromCharCode(parseInt(h, 16)); })
      .replace(/%%[cC]/g, "Ø").replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%[uUoOkK]/g, "").replace(/%%%/g, "%");
  }
  function mtexte(s){
    s = unicode(s);
    return s.replace(/\\P/g, "\n").replace(/\\~/g, " ").replace(/\\S([^;]*?)[\^#\/]([^;]*?);/g, "$1/$2")
      .replace(/\\[LlOoKkNX]/g, "").replace(/\\[ACFHQTWfcp][^;\\{}]*;?/g, "")
      .replace(/\\\\/g, "\\").replace(/\\[{}]/g, function(m){ return m.charAt(1); }).replace(/[{}]/g, "");
  }

  // ================= Construction de la scène =================
  function lire(buf, nomFichier){
    var t0 = performance.now();
    var txt = typeof buf === "string" ? buf : decoder(buf);
    var R = structure(paires(txt));
    var S = { calques: [], polys: [], fills: [], textes: [], ents: [], types: {}, ignores: {}, papier: 0, entete: R.entete };
    var parNom = new Map();
    function calque(nom){
      nom = nom || "0";
      var k = parNom.get(nom);
      if (k !== undefined) return k;
      k = S.calques.length; parNom.set(nom, k);
      S.calques.push({ nom: nom, couleur: -1, visible: true, gele: false, n: 0 });
      return k;
    }
    R.calques.forEach(function(e){
      var k = calque(e.s(2, "0")), L = S.calques[k], c = e.i(62, 7), tc = e.s(420);
      L.couleur = tc !== undefined ? (parseInt(tc, 10) & 0xFFFFFF) : (ACI[Math.abs(c)] === undefined ? -1 : ACI[Math.abs(c)]);
      L.visible = c >= 0;
      L.gele = !!(e.i(70, 0) & 1);
      if (L.gele) L.visible = false;
    });
    calque("0");

    function couleur(e, ctx, k){
      var tc = e.s(420);
      if (tc !== undefined) return parseInt(tc, 10) & 0xFFFFFF;
      var c = e.i(62, 256);
      if (c === 256) return S.calques[k].couleur;
      if (c === 0) return ctx ? ctx.couleur : -1;
      return ACI[Math.abs(c)] === undefined ? -1 : ACI[Math.abs(c)];
    }
    function pt(M, x, y){ return [M[0]*x + M[2]*y + M[4], M[1]*x + M[3]*y + M[5]]; }
    function poser(M, pts){ for (var q = 0; q < pts.length; q += 2){ var x = pts[q], y = pts[q + 1]; pts[q] = M[0]*x + M[2]*y + M[4]; pts[q + 1] = M[1]*x + M[3]*y + M[5]; } return pts; }
    function poly(k, col, pts, ent, ferme){
      if (pts.length < 4) return;
      if (ferme) pts.push(pts[0], pts[1]);
      S.polys.push({ c: k, col: col, p: pts, e: ent });
    }
    function remplir(k, col, contours, ent, alpha){
      contours = contours.filter(function(c){ return c.length >= 6; });
      if (contours.length) S.fills.push({ c: k, col: col, contours: contours, e: ent, alpha: alpha });
    }
    function longueur(p){ var l = 0; for (var q = 2; q < p.length; q += 2) l += Math.hypot(p[q] - p[q - 2], p[q + 1] - p[q - 1]); return l; }

    // Dessine une entité dans le repère M ; ctx = { calque, couleur } de l'INSERT parent ; ent = index de l'entité de tête
    function dessiner(e, M, ctx, ent, prof, info){
      var nomC = e.s(8, "0"), k = (nomC === "0" && ctx) ? ctx.calque : calque(nomC);
      var col = couleur(e, ctx, k), O = mul(M, ocs(e)), p, x, y;
      switch (e.type){
        case "LINE":
          p = poser(M, [e.f(10, 0), e.f(20, 0), e.f(11, 0), e.f(21, 0)]);
          if (info) info.Longueur = longueur(p);
          poly(k, col, p, ent); break;
        case "LWPOLYLINE": {
          var V = [], B = [], cur = -1;
          e.g.forEach(function(g){
            if (g[0] === 10){ V.push(parseFloat(g[1]), 0); B.push(0); cur = B.length - 1; }
            else if (g[0] === 20 && cur >= 0) V[2*cur + 1] = parseFloat(g[1]);
            else if (g[0] === 42 && cur >= 0) B[cur] = parseFloat(g[1]) || 0;
          });
          var ferme = !!(e.i(70, 0) & 1);
          p = sommets(V, B, ferme);
          poser(O, p);
          if (info){ info.Sommets = V.length/2; info.Fermée = ferme ? "oui" : "non"; info.Longueur = longueur(p); }
          poly(k, col, p, ent); break;
        }
        case "POLYLINE": {
          var fl = e.i(70, 0), vs = e.sous || [];
          if (fl & 64){
            // maillage polyface : sommets puis faces (index négatif = arête cachée)
            var PV = [];
            vs.forEach(function(v){ var f = v.i(70, 0); if ((f & 192) === 192) PV.push(v.f(10, 0), v.f(20, 0)); });
            vs.forEach(function(v){
              var f = v.i(70, 0);
              if (!((f & 128) && !(f & 64))) return;
              var id = [v.i(71, 0), v.i(72, 0), v.i(73, 0), v.i(74, 0)].filter(function(z){ return z; });
              for (var q = 0; q < id.length; q++){
                var a = id[q], b = id[(q + 1) % id.length];
                if (a < 0) continue;
                a = Math.abs(a) - 1; b = Math.abs(b) - 1;
                if (2*a + 1 < PV.length && 2*b + 1 < PV.length) poly(k, col, poser(M, [PV[2*a], PV[2*a + 1], PV[2*b], PV[2*b + 1]]), ent);
              }
            });
            break;
          }
          if (fl & 16){
            var m = e.i(71, 0), n = e.i(72, 0), G = vs.map(function(v){ return [v.f(10, 0), v.f(20, 0)]; });
            if (m*n === G.length){
              for (var r = 0; r < m; r++){ p = []; for (var s = 0; s < n; s++) p.push(G[r*n + s][0], G[r*n + s][1]); poly(k, col, poser(M, p), ent, !!(fl & 32)); }
              for (s = 0; s < n; s++){ p = []; for (r = 0; r < m; r++) p.push(G[r*n + s][0], G[r*n + s][1]); poly(k, col, poser(M, p), ent, !!(fl & 1)); }
            }
            break;
          }
          var V2 = [], B2 = [];
          vs.forEach(function(v){ if (v.i(70, 0) & 16) return; V2.push(v.f(10, 0), v.f(20, 0)); B2.push(v.f(42, 0)); });
          p = sommets(V2, B2, !!(fl & 1));
          poser(fl & 8 ? M : O, p);
          if (info){ info.Sommets = V2.length/2; info.Fermée = fl & 1 ? "oui" : "non"; info.Longueur = longueur(p); }
          poly(k, col, p, ent); break;
        }
        case "CIRCLE": {
          var rr = e.f(40, 0); p = []; arc(p, e.f(10, 0), e.f(20, 0), rr, 0, 2*Math.PI);
          if (info){ info.Rayon = rr; info.Centre = pt(O, e.f(10, 0), e.f(20, 0)); }
          poly(k, col, poser(O, p), ent); break;
        }
        case "ARC": {
          var ra = e.f(40, 0), d2r = Math.PI/180; p = []; arc(p, e.f(10, 0), e.f(20, 0), ra, e.f(50, 0)*d2r, e.f(51, 360)*d2r);
          if (info){ info.Rayon = ra; info["Angle de début"] = e.f(50, 0) + "°"; info["Angle de fin"] = e.f(51, 0) + "°"; }
          poly(k, col, poser(O, p), ent); break;
        }
        case "ELLIPSE":
          p = []; ellipse(p, e.f(10, 0), e.f(20, 0), e.f(11, 1), e.f(21, 0), e.f(40, 1), e.f(41, 0), e.f(42, 2*Math.PI), e.f(230, 1) < 0);
          poly(k, col, poser(M, p), ent); break;
        case "SPLINE": {
          var U = [], C = [], W = [], F = [];
          e.g.forEach(function(g){
            if (g[0] === 40) U.push(parseFloat(g[1]));
            else if (g[0] === 41) W.push(parseFloat(g[1]));
            else if (g[0] === 10) C.push(parseFloat(g[1]), 0);
            else if (g[0] === 20) C[C.length - 1] = parseFloat(g[1]);
            else if (g[0] === 11) F.push(parseFloat(g[1]), 0);
            else if (g[0] === 21) F[F.length - 1] = parseFloat(g[1]);
          });
          p = [];
          if (C.length >= 4) bspline(p, e.i(71, 3), U, C, W.length === C.length/2 ? W : null);
          else p = F;
          poly(k, col, poser(M, p), ent); break;
        }
        case "SOLID": case "TRACE": {
          var Q = [e.f(10, 0), e.f(20, 0), e.f(11, 0), e.f(21, 0), e.f(13, e.f(12, 0)), e.f(23, e.f(22, 0)), e.f(12, 0), e.f(22, 0)];
          poser(O, Q);
          remplir(k, col, [Q.slice()], ent, 1);
          poly(k, col, Q, ent, true); break;
        }
        case "3DFACE": {
          var F4 = [e.f(10, 0), e.f(20, 0), e.f(11, 0), e.f(21, 0), e.f(12, 0), e.f(22, 0), e.f(13, e.f(12, 0)), e.f(23, e.f(22, 0))], cache = e.i(70, 0);
          poser(M, F4);
          for (var q = 0; q < 4; q++){ if (cache & (1 << q)) continue; var a = q, b = (q + 1) % 4; poly(k, col, [F4[2*a], F4[2*a + 1], F4[2*b], F4[2*b + 1]], ent); }
          break;
        }
        case "LEADER": {
          var L2 = [], c2 = -1;
          e.g.forEach(function(g){ if (g[0] === 10){ L2.push(parseFloat(g[1]), 0); c2 = L2.length - 1; } else if (g[0] === 20 && c2 >= 0) L2[c2] = parseFloat(g[1]); });
          poly(k, col, poser(M, L2), ent); break;
        }
        case "HATCH": hachure(e, O, k, col, ent, info); break;
        case "TEXT": case "ATTRIB": case "ATTDEF": {
          if (e.type === "ATTDEF" && ctx) break;              // définition d'attribut : invisible dans les blocs insérés
          if (e.type !== "TEXT" && (e.i(70, 0) & 1)) break;   // attribut invisible
          var h = e.f(40, 1), ah = e.i(72, 0), av = e.type === "TEXT" ? e.i(73, 0) : e.i(74, 0), px = e.f(10, 0), py = e.f(20, 0);
          if ((ah || av) && e.s(11) !== undefined){ px = e.f(11, 0); py = e.f(21, 0); }
          if (ah === 3 || ah === 5){ px = (e.f(10, 0) + e.f(11, 0))/2; py = (e.f(20, 0) + e.f(21, 0))/2; ah = 1; }
          if (ah === 4){ ah = 1; av = 2; }
          var chaine = unicode(e.s(1, ""));
          if (info) info.Texte = chaine;
          texte(k, col, O, px, py, h, e.f(50, 0)*Math.PI/180, [chaine], ah > 2 ? 0 : ah, av, ent, e.f(41, 1));
          break;
        }
        case "MTEXT": {
          var brut = "";
          e.g.forEach(function(g){ if (g[0] === 3) brut += g[1]; });
          brut += e.s(1, "");
          var lignes = mtexte(brut).split("\n"), att = e.i(71, 1), ang = e.f(50, 0)*Math.PI/180;
          if (e.s(11) !== undefined) ang = Math.atan2(e.f(21, 0), e.f(11, 1));
          if (info) info.Texte = lignes.join(" ⏎ ");
          // point d'attache 1–9 : haut/milieu/bas × gauche/centre/droite ; av 3 = haut, 2 = milieu, 1 = bas
          texte(k, col, M, e.f(10, 0), e.f(20, 0), e.f(40, 1), ang, lignes, (att - 1) % 3, 3 - Math.floor((att - 1)/3), ent, 1, true);
          break;
        }
        case "INSERT": case "DIMENSION": {
          var nomB = e.s(2, ""), bl = R.blocs.get(nomB);
          if (info && e.type === "INSERT"){ info.Bloc = nomB; info["Point d'insertion"] = pt(O, e.f(10, 0), e.f(20, 0)); info["Échelle"] = e.f(41, 1) + " × " + e.f(42, 1); info.Rotation = e.f(50, 0) + "°"; }
          if (info && e.type === "DIMENSION"){ var mes = e.f(42); if (mes !== undefined) info.Mesure = mes; if (e.s(1)) info.Texte = e.s(1); }
          var sous = { calque: k, couleur: col };
          if (bl && prof < 16){
            var bx = bl.f(10, 0), by = bl.f(20, 0);
            if (e.type === "DIMENSION"){
              bl.ents.forEach(function(se){ dessiner(se, M, sous, ent, prof + 1); });
            } else {
              var nc = Math.max(1, e.i(70, 1)), nl = Math.max(1, e.i(71, 1)), dc = e.f(44, 0), dl = e.f(45, 0), rotI = e.f(50, 0)*Math.PI/180;
              for (var ci = 0; ci < Math.min(nc, 200); ci++) for (var li = 0; li < Math.min(nl, 200); li++){
                var T = mul(O, mul(tr(e.f(10, 0), e.f(20, 0)), mul(rot(rotI), mul(tr(ci*dc, li*dl), mul(ech(e.f(41, 1), e.f(42, 1)), tr(-bx, -by))))));
                bl.ents.forEach(function(se){ dessiner(se, T, sous, ent, prof + 1); });
              }
            }
          }
          (e.sous || []).forEach(function(at){
            if (info && at.s(2)) info["Attribut " + at.s(2)] = unicode(at.s(1, ""));
            dessiner(at, M, ctx, ent, prof + 1);
          });
          break;
        }
        case "POINT": case "VIEWPORT": case "XLINE": case "RAY": case "IMAGE": case "WIPEOUT": case "OLE2FRAME": case "SEQEND": case "ENDBLK":
          if (!ctx) S.ignores[e.type] = (S.ignores[e.type] || 0) + 1;
          break;
        default:
          if (!ctx) S.ignores[e.type] = (S.ignores[e.type] || 0) + 1;
      }
    }
    function sommets(V, B, ferme){
      var n = V.length/2, p = [];
      if (!n) return p;
      p.push(V[0], V[1]);
      for (var q = 0; q < n - 1 + (ferme ? 1 : 0); q++){
        var a = q, b = (q + 1) % n;
        if (B[a]) renflement(p, V[2*a], V[2*a + 1], V[2*b], V[2*b + 1], B[a]); else p.push(V[2*b], V[2*b + 1]);
      }
      return p;
    }
    function inverse(A){ var B = []; for (var z = A.length - 2; z >= 0; z -= 2) B.push(A[z], A[z + 1]); return B; }
    function texte(k, col, M, x, y, h, a, lignes, ah, av, ent, largeur, multi){
      var P0 = pt(M, x, y), ux = M[0]*Math.cos(a) + M[2]*Math.sin(a), uy = M[1]*Math.cos(a) + M[3]*Math.sin(a);
      var det = M[0]*M[3] - M[1]*M[2], k2 = Math.sqrt(Math.abs(det)) || 1;
      S.textes.push({ c: k, col: col, x: P0[0], y: P0[1], h: h*k2, rot: Math.atan2(uy, ux), l: lignes, ah: ah || 0, av: av || 0, w: largeur || 1, multi: !!multi, miroir: det < 0, e: ent });
    }
    // HATCH : contours (polylignes ou arêtes : segment, arc, ellipse, spline) ; plein = rempli, motif = voile léger
    function hachure(e, O, k, col, ent, info){
      var g = e.g, q = 0, contours = [], plein = false, nom = "";
      while (q < g.length && g[q][0] !== 91){ if (g[q][0] === 70) plein = g[q][1] === "1"; if (g[q][0] === 2) nom = g[q][1]; q++; }
      var nb = q < g.length ? parseInt(g[q][1], 10) : 0; q++;
      function num(code){ while (q < g.length && g[q][0] !== code) q++; return q < g.length ? parseFloat(g[q++][1]) : 0; }
      for (var c = 0; c < nb && q < g.length; c++){
        var flags = num(92), p = [];
        if (flags & 2){
          var bul = num(72), fer = num(73), nv = num(93), V = [], B = [];
          for (var v = 0; v < nv; v++){ V.push(num(10), num(20)); B.push(bul ? num(42) : 0); }
          p = sommets(V, B, true);
        } else {
          var ne = num(93);
          for (var a = 0; a < ne; a++){
            var ty = num(72);
            if (ty === 1){ var x1 = num(10), y1 = num(20), x2 = num(11), y2 = num(21); if (!p.length) p.push(x1, y1); p.push(x2, y2); }
            else if (ty === 2){
              var cx = num(10), cy = num(20), r = num(40), s0 = num(50), s1 = num(51), ccw = num(73), A = [];
              // sens horaire : angles comptés à l'envers, parcours de −début à −fin
              if (ccw) arc(A, cx, cy, r, s0*Math.PI/180, s1*Math.PI/180);
              else { arc(A, cx, cy, r, -s1*Math.PI/180, -s0*Math.PI/180); A = inverse(A); }
              p = p.concat(A);
            } else if (ty === 3){
              var ex = num(10), ey = num(20), mx = num(11), my = num(21), rat = num(40), e0 = num(50)*Math.PI/180, e1 = num(51)*Math.PI/180, ccw2 = num(73), E = [];
              ellipse(E, ex, ey, mx, my, rat, ccw2 ? e0 : -e1, ccw2 ? e1 : -e0, false);
              p = p.concat(ccw2 ? E : inverse(E));
            } else if (ty === 4){
              var dg = num(94); num(73); num(74); var nk = num(95), nc = num(96), U = [], C = [];
              for (var z2 = 0; z2 < nk; z2++) U.push(num(40));
              for (z2 = 0; z2 < nc; z2++) C.push(num(10), num(20));
              var Sp = []; bspline(Sp, dg, U, C, null); p = p.concat(Sp);
            }
          }
        }
        if (p.length >= 6) contours.push(poser(O, p));
      }
      if (info){ info.Motif = nom || "—"; info.Contours = contours.length; }
      if (plein) remplir(k, col, contours, ent, 1);
      else { remplir(k, col, contours, ent, .18); contours.forEach(function(p){ poly(k, col, p.slice(), ent); }); }
    }

    R.entites.forEach(function(e){
      S.types[e.type] = (S.types[e.type] || 0) + 1;
      if (e.i(67, 0) === 1){ S.papier++; return; }
      var ent = S.ents.length, info = {}, nomC = e.s(8, "0");
      S.ents.push({ type: e.type, calque: calque(nomC), handle: e.s(5, ""), info: info, couleur: e.i(62, 256) });
      S.calques[calque(nomC)].n++;
      var np = S.polys.length, nf = S.fills.length, nt = S.textes.length;
      dessiner(e, ID, null, ent, 0, info);
      S.ents[ent].prims = [np, S.polys.length, nf, S.fills.length, nt, S.textes.length];
    });
    // étendue du dessin
    var mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    function et(x, y){ if (!isFinite(x) || !isFinite(y)) return; if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; }
    S.polys.forEach(function(P){ for (var q = 0; q < P.p.length; q += 2) et(P.p[q], P.p[q + 1]); });
    S.textes.forEach(function(T){ et(T.x, T.y); });
    S.min = mn; S.max = mx;
    var ver = R.entete.$ACADVER && R.entete.$ACADVER[1];
    S.version = ver || "";
    S.unites = R.entete.$INSUNITS ? parseInt(R.entete.$INSUNITS[70], 10) : 0;
    S.blocs = R.blocs.size;
    S.duree = performance.now() - t0;
    S.nom = nomFichier || "";
    return S;
  }

  var VERSIONS = { AC1006: "R10", AC1009: "R11/R12", AC1012: "R13", AC1014: "R14", AC1015: "AutoCAD 2000", AC1018: "AutoCAD 2004", AC1021: "AutoCAD 2007", AC1024: "AutoCAD 2010", AC1027: "AutoCAD 2013", AC1032: "AutoCAD 2018" };
  var UNITES = { 0: "sans unité", 1: "pouces", 2: "pieds", 4: "mm", 5: "cm", 6: "m", 7: "km" };
  global.DXF = { lire: lire, ACI: ACI, VERSIONS: VERSIONS, UNITES: UNITES };
})(window);
