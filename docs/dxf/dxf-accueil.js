// DXF Studio : accueil (13.11.2026)
// - scène filaire : petite ossature analytique (deux niveaux de portiques, axes de poteaux et de poutres,
//   croix aux pieds, contours de dalles, grille A-B-C / 1-2-3 à bulles), tracée trait par trait comme en DAO,
//   puis qui tourne lentement ; une sélection passe en accent, une cote apparaît un cycle sur trois ;
// - fichiers récents gardés dans ce navigateur (IndexedDB : nom, taille, date, contenu).
// Couleurs lues dans --scene-fond et --scene-or (thème sombre ou clair).
(function(){
  "use strict";
  var $ = function(s){ return document.querySelector(s); };

  // ================= Scène filaire =================
  (function(){
    var cv = $("#scene");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var W = 0, H = 0, DPR = 1;

    // ---------- Modèle (mètres), centré sur l'origine ----------
    var GX = [0, 6, 12], GY = [0, 5, 10], LX = ["A", "B", "C"], LY = ["1", "2", "3"];
    var Z1 = 3.2, Z2 = 6.4, CX = 6, CY = 5, CZ = 3.0;
    function P(x, y, z){ return [x - CX, y - CY, z - CZ]; }
    var els = [], noeuds = [], bulles = [], t = 0;
    function ajoute(cal, pts, opt){
      opt = opt || {};
      var e = { cal: cal, pts: pts, ferme: !!opt.ferme, grp: opt.grp || [], t0: t, dur: opt.dur || .2, tirets: !!opt.tirets };
      var L = 0, n = pts.length + (e.ferme ? 1 : 0);
      for (var i = 1; i < n; i++){ var a = pts[i - 1], b = pts[i % pts.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
      e.long = L;
      els.push(e); t += opt.pas == null ? .055 : opt.pas;
      return e;
    }
    // grille d'axes au sol
    GX.forEach(function(x, i){
      ajoute("grille", [P(x, -2.2, 0), P(x, 12.2, 0)], { dur: .55, pas: .12, tirets: true });
      bulles.push({ p: P(x, -2.9, 0), txt: LX[i], t0: t + .2 });
    });
    GY.forEach(function(y, i){
      ajoute("grille", [P(-2.2, y, 0), P(14.2, y, 0)], { dur: .55, pas: .12, tirets: true });
      bulles.push({ p: P(-2.9, y, 0), txt: LY[i], t0: t + .2 });
    });
    t += .2;
    // le niveau 2 ne couvre que les files 1 et 2
    function haut(y){ return y <= 5; }
    // croix au centre des pieds de poteaux (30 cm)
    GX.forEach(function(x, i){ GY.forEach(function(y, j){
      var d = .45;
      ajoute("croix", [P(x - d, y, 0), P(x + d, y, 0)], { pas: .02, dur: .12, grp: ["croix"] });
      ajoute("croix", [P(x, y - d, 0), P(x, y + d, 0)], { pas: .03, dur: .12, grp: ["croix"] });
    }); });
    t += .1;
    // poteaux du niveau 1
    GX.forEach(function(x, i){ GY.forEach(function(y, j){
      ajoute("poteaux", [P(x, y, 0), P(x, y, Z1)], { grp: ["axe" + LX[i], "pot1"] });
      noeuds.push({ p: P(x, y, 0), t0: t }); noeuds.push({ p: P(x, y, Z1), t0: t + .15 });
    }); });
    // poutres du niveau 1
    GY.forEach(function(y, j){ for (var i = 1; i < GX.length; i++)
      ajoute("poutres", [P(GX[i - 1], y, Z1), P(GX[i], y, Z1)], { grp: ["file" + LY[j], "pou1"] }); });
    GX.forEach(function(x, i){ for (var j = 1; j < GY.length; j++)
      ajoute("poutres", [P(x, GY[j - 1], Z1), P(x, GY[j], Z1)], { grp: ["axe" + LX[i], "pou1"] }); });
    // dalle du niveau 1, avec une réservation
    var m = .35;
    ajoute("dalles", [P(-m, -m, Z1), P(12 + m, -m, Z1), P(12 + m, 10 + m, Z1), P(-m, 10 + m, Z1)], { ferme: true, dur: .9, pas: .5, grp: ["dalle1"] });
    ajoute("dalles", [P(7.4, 6.4, Z1), P(9.6, 6.4, Z1), P(9.6, 8.4, Z1), P(7.4, 8.4, Z1)], { ferme: true, dur: .35, pas: .2, grp: ["dalle1"] });
    // poteaux du niveau 2
    GX.forEach(function(x, i){ GY.forEach(function(y, j){
      if (!haut(y)) return;
      ajoute("poteaux", [P(x, y, Z1), P(x, y, Z2)], { grp: ["axe" + LX[i], "pot2"] });
      noeuds.push({ p: P(x, y, Z2), t0: t + .15 });
    }); });
    // poutres du niveau 2
    GY.forEach(function(y, j){ if (!haut(y)) return; for (var i = 1; i < GX.length; i++)
      ajoute("poutres", [P(GX[i - 1], y, Z2), P(GX[i], y, Z2)], { grp: ["file" + LY[j], "pou2"] }); });
    GX.forEach(function(x, i){ ajoute("poutres", [P(x, 0, Z2), P(x, 5, Z2)], { grp: ["axe" + LX[i], "pou2"] }); });
    ajoute("dalles", [P(-m, -m, Z2), P(12 + m, -m, Z2), P(12 + m, 5 + m, Z2), P(-m, 5 + m, Z2)], { ferme: true, dur: .9, pas: .4, grp: ["dalle2"] });
    var FIN = t + .6;
    var RAYON = Math.hypot(8.5, 7.5, 3.6);

    // sélections et cotes qui passent en boucle
    var SEL = [
      { g: "axeB", cal: "poteaux" }, { g: "pou1", cal: "poutres" }, { g: "dalle2", cal: "dalles" },
      { g: "file2", cal: "poutres" }, { g: "croix", cal: "croix" }, { g: "axeA", cal: "poteaux" }, { g: "dalle1", cal: "dalles" }
    ];
    var COTES = [
      { a: P(0, -1.3, 0), b: P(6, -1.3, 0), n: [0, -1, 0], txt: "6.00" },
      { a: P(13.3, 0, 0), b: P(13.3, 0, Z1), n: [1, 0, 0], txt: "3.20" },
      { a: P(-1.3, 0, 0), b: P(-1.3, 5, 0), n: [-1, 0, 0], txt: "5.00" },
      { a: P(6, -1.3, Z2), b: P(12, -1.3, Z2), n: [0, -1, 0], txt: "6.00" }
    ];
    var CALQUES = [
      ["grille", "STR_AXES"], ["croix", "STR_POTEAUX_CENTRES"], ["poteaux", "STR_POTEAUX_AXES"],
      ["poutres", "STR_POUTRES_AXES"], ["dalles", "STR_DALLES_CONTOURS"]
    ];

    // ---------- Couleurs ----------
    var C = {};
    function rvb(v, d){ var m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v || ""); return m ? [+m[1], +m[2], +m[3]] : d; }
    function couleurs(){
      var st = getComputedStyle(document.documentElement);
      C.fond = rvb(st.getPropertyValue("--scene-fond"), [28, 28, 28]);
      C.or = rvb(st.getPropertyValue("--scene-or"), [96, 205, 255]);
      var clair = (C.fond[0] + C.fond[1] + C.fond[2]) / 3 > 128;
      C.clair = clair;
      C.cal = clair ? {
        grille: [118, 126, 140], croix: [196, 72, 64], poteaux: [52, 58, 74], poutres: [176, 112, 22], dalles: [26, 138, 92], cote: [60, 60, 66]
      } : {
        grille: [138, 148, 164], croix: [244, 146, 136], poteaux: [214, 218, 228], poutres: [236, 192, 116], dalles: [124, 212, 168], cote: [220, 220, 226]
      };
      C.noeud = clair ? [30, 32, 40] : [250, 250, 255];
      C.sol = clair ? [0, 0, 0] : [255, 255, 255];
      demander();
    }
    function css(c, a){ return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (a == null ? 1 : Math.max(0, Math.min(1, a)).toFixed(3)) + ")"; }
    function mix(a, b, k){ return [a[0] + (b[0] - a[0])*k, a[1] + (b[1] - a[1])*k, a[2] + (b[2] - a[2])*k]; }

    // ---------- Caméra orthographique (comme IFC Studio) ----------
    var lacet = -.62, tangage = .52, vit = 0, R = [], U = [], F = [], s = 1;
    function camera(){
      var ca = Math.cos(lacet), sa = Math.sin(lacet), cb = Math.cos(tangage), sb = Math.sin(tangage);
      R = [ca, sa, 0]; U = [-sb*sa, sb*ca, cb]; F = [cb*sa, -cb*ca, sb];
      s = Math.min(W, H*1.25) / (2.25*RAYON);
    }
    function proj(p){
      return [W/2 + s*(p[0]*R[0] + p[1]*R[1] + p[2]*R[2]), H/2 + H*.03 - s*(p[0]*U[0] + p[1]*U[1] + p[2]*U[2]), p[0]*F[0] + p[1]*F[1] + p[2]*F[2]];
    }
    function prof(z){ return .42 + .58*Math.max(0, Math.min(1, (z + RAYON) / (2*RAYON))); }

    // ---------- Dessin ----------
    function lisse(x){ x = Math.max(0, Math.min(1, x)); return x*x*(3 - 2*x); }
    var temps = 0, cycleT = 0, cycleN = 0, PERIODE = 6.2;
    function etatSel(){
      // phase de la sélection courante : accent qui monte, tenue, effacement, retour
      if (temps <= FIN) return null;
      var k = cycleT / 4.6;
      if (k >= 1) return null;
      var acc, al;
      if (k < .18){ acc = lisse(k/.18); al = 1; }
      else if (k < .58){ acc = 1; al = 1; }
      else if (k < .74){ acc = 1; al = 1 - .82*lisse((k - .58)/.16); }
      else { acc = 1 - lisse((k - .74)/.26); al = .18 + .82*lisse((k - .74)/.26); }
      return { g: SEL[cycleN % SEL.length], acc: acc, al: al };
    }
    function trace(pts, ferme, frac){
      // trace la polyligne projetée jusqu'à la fraction frac de sa longueur (écran)
      var n = pts.length + (ferme ? 1 : 0), L = 0, seg = [];
      for (var i = 1; i < n; i++){ var a = pts[i - 1], b = pts[i % pts.length]; var l = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push(l); L += l; }
      var reste = L*frac;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var j = 1; j < n && reste > 0; j++){
        var A = pts[j - 1], B = pts[j % pts.length], l2 = seg[j - 1];
        if (l2 <= reste){ ctx.lineTo(B[0], B[1]); reste -= l2; }
        else { var q = reste / l2; ctx.lineTo(A[0] + (B[0] - A[0])*q, A[1] + (B[1] - A[1])*q); reste = 0; }
      }
      ctx.stroke();
    }
    function dessiner(){
      camera();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      ctx.fillStyle = css(C.fond); ctx.fillRect(0, 0, W, H);
      // halo derrière l'ossature
      var g = ctx.createRadialGradient(W/2, H*.5, 0, W/2, H*.5, Math.max(W, H)*.62);
      g.addColorStop(0, css(C.or, C.clair ? .10 : .12)); g.addColorStop(.55, css(C.or, C.clair ? .03 : .035)); g.addColorStop(1, css(C.or, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // grille du sol, 1 m, qui s'efface vers les bords
      var apparu = lisse(temps / .8), Rg = 13, z0 = -CZ;
      ctx.lineWidth = 1; ctx.strokeStyle = css(C.sol);
      for (var dir = 0; dir < 2; dir++) for (var u = -Rg; u <= Rg; u++) for (var v = -Rg; v < Rg; v++){
        var a = dir ? [u, v, z0] : [v, u, z0], b = dir ? [u, v + 1, z0] : [v + 1, u, z0];
        var r = Math.hypot((a[0] + b[0])/2, (a[1] + b[1])/2) / Rg;
        if (r >= 1) continue;
        var pa = proj(a), pb = proj(b);
        ctx.globalAlpha = apparu*(C.clair ? .10 : .075)*Math.pow(1 - r, 1.6)*prof((pa[2] + pb[2])/2);
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      }

      var sel = etatSel();
      // éléments, trait par trait
      for (var i = 0; i < els.length; i++){
        var e = els[i], f = (temps - e.t0) / e.dur;
        if (f <= 0) continue;
        f = Math.min(1, f);
        var pts = e.pts.map(proj), zm = 0;
        for (var k = 0; k < pts.length; k++) zm += pts[k][2];
        zm /= pts.length;
        var col = C.cal[e.cal], al = (e.cal === "grille" ? .55 : .92)*prof(zm), larg = e.cal === "dalles" ? 1.1 : e.cal === "grille" ? 1 : 1.4;
        var choisi = sel && e.grp.indexOf(sel.g.g) >= 0;
        if (choisi){ col = mix(col, C.or, sel.acc); al = Math.max(al, sel.acc)*sel.al; larg += .9*sel.acc; }
        ctx.globalAlpha = al; ctx.strokeStyle = css(col); ctx.lineWidth = larg;
        ctx.setLineDash(e.tirets ? [10, 4, 2, 4] : []);
        if (choisi && sel.acc > .05){ ctx.shadowColor = css(C.or, .8*sel.acc*sel.al); ctx.shadowBlur = 10; }
        trace(pts, e.ferme, f);
        ctx.shadowBlur = 0;
        // point de tracé au bout du trait en cours
        if (f < 1 && e.cal !== "grille"){
          var dep = trace0(pts, e.ferme, f);
          ctx.globalAlpha = 1; ctx.fillStyle = css(C.or); ctx.beginPath(); ctx.arc(dep[0], dep[1], 2.2, 0, 6.283); ctx.fill();
        }
      }
      ctx.setLineDash([]);
      // nœuds
      ctx.fillStyle = css(C.noeud);
      noeuds.forEach(function(n){
        var a = lisse((temps - n.t0) / .3); if (a <= 0) return;
        var p = proj(n.p); ctx.globalAlpha = a*.85*prof(p[2]);
        ctx.fillRect(p[0] - 1.6, p[1] - 1.6, 3.2, 3.2);
      });
      // bulles d'axes
      ctx.font = "600 11px " + POLICE; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      bulles.forEach(function(b){
        var a = lisse((temps - b.t0) / .4); if (a <= 0) return;
        var p = proj(b.p), al = a*prof(p[2]);
        ctx.globalAlpha = al; ctx.lineWidth = 1; ctx.strokeStyle = css(C.cal.grille); ctx.fillStyle = css(C.fond);
        ctx.beginPath(); ctx.arc(p[0], p[1], 9.5, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = css(C.cal.cote); ctx.fillText(b.txt, p[0], p[1] + .5);
      });
      // cote, un cycle sur trois
      if (temps > FIN && cycleN % 3 === 2){
        var co = COTES[Math.floor(cycleN / 3) % COTES.length], kc = cycleT / 4.6;
        var ac = kc < .2 ? lisse(kc/.2) : kc > .78 ? 1 - lisse((kc - .78)/.22) : 1;
        if (ac > 0 && kc < 1) cote(co, ac);
      }
      // calques, comme dans DXF Studio
      legende(sel);
      ctx.globalAlpha = 1;
    }
    function trace0(pts, ferme, frac){
      var n = pts.length + (ferme ? 1 : 0), L = 0, seg = [];
      for (var i = 1; i < n; i++){ var a = pts[i - 1], b = pts[i % pts.length]; var l = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push(l); L += l; }
      var reste = L*frac;
      for (var j = 1; j < n; j++){
        var A = pts[j - 1], B = pts[j % pts.length];
        if (seg[j - 1] >= reste){ var q = seg[j - 1] ? reste / seg[j - 1] : 0; return [A[0] + (B[0] - A[0])*q, A[1] + (B[1] - A[1])*q]; }
        reste -= seg[j - 1];
      }
      return pts[0];
    }
    function cote(co, a){
      var pa = proj(co.a), pb = proj(co.b), d = .35;
      var ta = proj([co.a[0] - co.n[0]*d, co.a[1] - co.n[1]*d, co.a[2] - co.n[2]*d]), tb = proj([co.b[0] - co.n[0]*d, co.b[1] - co.n[1]*d, co.b[2] - co.n[2]*d]);
      ctx.globalAlpha = a*.95; ctx.strokeStyle = css(C.cal.cote); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]);
      ctx.moveTo(ta[0], ta[1]); ctx.lineTo(pa[0], pa[1]); ctx.moveTo(tb[0], tb[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      // traits obliques de cote aux extrémités
      [pa, pb].forEach(function(p){ ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1] + 4); ctx.lineTo(p[0] + 4, p[1] - 4); ctx.stroke(); });
      var mx = (pa[0] + pb[0])/2, my = (pa[1] + pb[1])/2, ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
      if (ang > Math.PI/2) ang -= Math.PI; else if (ang < -Math.PI/2) ang += Math.PI;
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
      ctx.font = "600 12px " + POLICE; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      var w = ctx.measureText(co.txt).width + 8;
      ctx.fillStyle = css(C.fond, .85); ctx.fillRect(-w/2, -17, w, 15);
      ctx.fillStyle = css(C.or); ctx.fillText(co.txt, 0, -3);
      ctx.restore();
    }
    function legende(sel){
      var x = 18, y = 22;
      ctx.font = "11px " + MONO; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      CALQUES.forEach(function(c, i){
        var a = lisse((temps - .3 - i*.25) / .5); if (a <= 0) return;
        var actif = sel && sel.g.cal === c[0], k = actif ? sel.acc : 0;
        var col = mix(C.cal[c[0]], C.or, k);
        ctx.globalAlpha = a*(.9); ctx.fillStyle = css(col);
        ctx.fillRect(x, y + i*18 - 4, 8, 8);
        ctx.globalAlpha = a*(.55 + .45*k); ctx.fillStyle = css(k > .5 ? C.or : C.cal.cote);
        ctx.fillText(c[1], x + 16, y + i*18 + .5);
      });
    }
    var POLICE = '"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif';
    var MONO = '"Cascadia Mono",Consolas,ui-monospace,monospace';

    // ---------- Boucle : pause hors écran et onglet caché ----------
    var visible = true, prec = 0, rq = 0, glisse = null;
    function tourne(){ return visible && !document.hidden && W > 0; }
    function image(ts){
      rq = 0;
      if (!tourne()){ prec = 0; return; }
      var dt = prec ? Math.min(.05, (ts - prec) / 1000) : 0; prec = ts;
      temps += dt;
      if (temps > FIN){ cycleT += dt; if (cycleT > PERIODE){ cycleT = 0; cycleN++; } }
      if (!glisse){
        lacet += dt*(2*Math.PI/60) + vit*dt;
        vit *= Math.exp(-dt*2.4);
      }
      dessiner();
      rq = requestAnimationFrame(image);
    }
    function demander(){ if (!rq && tourne()) rq = requestAnimationFrame(image); else if (!tourne() && W) dessiner(); }

    function taille(){
      var r = cv.getBoundingClientRect();
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.max(1, Math.round(W*DPR)); cv.height = Math.max(1, Math.round(H*DPR));
      if (W) dessiner();
      demander();
    }
    if (window.ResizeObserver) new ResizeObserver(taille).observe(cv); else window.addEventListener("resize", taille);
    if (window.IntersectionObserver) new IntersectionObserver(function(en){ visible = en[0].isIntersecting; demander(); }).observe(cv);
    document.addEventListener("visibilitychange", demander);
    new MutationObserver(couleurs).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // glisser pour tourner, avec inertie
    cv.addEventListener("pointerdown", function(e){
      glisse = { x: e.clientX, y: e.clientY, t: performance.now() }; vit = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (x){}
    });
    cv.addEventListener("pointermove", function(e){
      if (!glisse) return;
      var now = performance.now(), dx = e.clientX - glisse.x, dy = e.clientY - glisse.y, dt = Math.max(1, now - glisse.t) / 1000;
      lacet -= dx*.009;
      if (e.pointerType === "mouse") tangage = Math.max(.12, Math.min(1.25, tangage + dy*.006));
      vit = .7*vit + .3*(-dx*.009/dt);
      glisse.x = e.clientX; glisse.y = e.clientY; glisse.t = now;
      if (!rq) dessiner();
    });
    function lacher(){ if (glisse && performance.now() - glisse.t > 90) vit = 0; glisse = null; }
    cv.addEventListener("pointerup", lacher);
    cv.addEventListener("pointercancel", lacher);

    couleurs();
    taille();
  })();

  // ================= Fichiers récents (IndexedDB) =================
  var BASE = "dxf-studio", MAGASIN = "recents", MAX = 8, TROP = 80*1024*1024;
  var ouvrirFichier = null;
  function base(){
    return new Promise(function(ok, ko){
      if (!window.indexedDB){ ko(new Error("IndexedDB indisponible")); return; }
      var rq = indexedDB.open(BASE, 1);
      rq.onupgradeneeded = function(){ rq.result.createObjectStore(MAGASIN, { keyPath: "nom" }); };
      rq.onsuccess = function(){ ok(rq.result); };
      rq.onerror = function(){ ko(rq.error); };
    });
  }
  function tx(mode, f){
    return base().then(function(db){
      return new Promise(function(ok, ko){
        var t = db.transaction(MAGASIN, mode), st = t.objectStore(MAGASIN), res;
        res = f(st);
        t.oncomplete = function(){ db.close(); ok(res && res.result !== undefined ? res.result : res); };
        t.onerror = t.onabort = function(){ db.close(); ko(t.error); };
      });
    });
  }
  function tous(){ return tx("readonly", function(st){ return st.getAll(); }).then(function(l){ return (l || []).sort(function(a, b){ return b.date - a.date; }); }); }
  function taille(o){
    if (o < 1024) return o + " o";
    if (o < 1048576) return Math.round(o/1024) + " ko";
    return (o/1048576).toFixed(o < 10485760 ? 1 : 0).replace(".", ",") + " Mo";
  }
  function quand(t){
    var d = new Date(t), auj = new Date(), z = function(x){ return (x < 10 ? "0" : "") + x; };
    var h = z(d.getHours()) + ":" + z(d.getMinutes());
    if (d.toDateString() === auj.toDateString()) return "aujourd'hui " + h;
    var hier = new Date(auj.getTime() - 864e5);
    if (d.toDateString() === hier.toDateString()) return "hier " + h;
    return z(d.getDate()) + "." + z(d.getMonth() + 1) + "." + d.getFullYear();
  }
  function afficher(){
    var bloc = $("#recents"), ul = $("#recents-liste");
    if (!bloc || !ul) return;
    tous().then(function(l){
      ul.innerHTML = "";
      l.slice(0, MAX).forEach(function(r){
        var li = document.createElement("li");
        var b = document.createElement("button"); b.type = "button"; b.className = "recent"; b.title = "Ouvrir " + r.nom;
        var n = document.createElement("span"); n.className = "r-nom"; n.textContent = r.nom;
        var i = document.createElement("span"); i.className = "r-info"; i.textContent = taille(r.taille) + " · " + quand(r.date);
        b.appendChild(n); b.appendChild(i);
        b.addEventListener("click", function(){
          tx("readonly", function(st){ return st.get(r.nom); }).then(function(rec){
            if (!rec || !ouvrirFichier) return;
            var buf = rec.buf;
            ouvrirFichier({ name: rec.nom, size: rec.taille, arrayBuffer: function(){ return Promise.resolve(buf.slice(0)); } }, !!rec.ifc);
          });
        });
        var x = document.createElement("button"); x.type = "button"; x.className = "r-x"; x.textContent = "×";
        x.title = "Retirer de la liste"; x.setAttribute("aria-label", "Retirer " + r.nom + " des récents");
        x.addEventListener("click", function(){ tx("readwrite", function(st){ return st.delete(r.nom); }).then(afficher, afficher); });
        li.appendChild(b); li.appendChild(x); ul.appendChild(li);
      });
      bloc.hidden = !l.length;
    }).catch(function(){ bloc.hidden = true; });
  }
  function memoriser(nom, buf, ifc){
    if (!buf || buf.byteLength > TROP) return;
    var rec = { nom: nom, taille: buf.byteLength, date: Date.now(), buf: buf.slice(0), ifc: !!ifc };
    tx("readwrite", function(st){ st.put(rec); })
      .then(tous).then(function(l){
        var trop = l.slice(MAX);
        if (trop.length) return tx("readwrite", function(st){ trop.forEach(function(r){ st.delete(r.nom); }); });
      }).then(afficher, function(){});
  }
  afficher();

  window.DXFAccueil = {
    memoriser: memoriser,
    surOuvrir: function(f){ ouvrirFichier = f; }
  };
})();
