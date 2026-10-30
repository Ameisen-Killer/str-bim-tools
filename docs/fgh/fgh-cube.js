// /fgh/ : cube de navigation, comme le ViewCube de Revit, dessiné dans un petit canvas au coin de la vue 3D.
// - Clic sur une face, une arête ou un coin : vue animée depuis ce côté, recadrée. Survol en surbrillance.
// - Glisser le cube : rotation libre ; glisser la boussole : rotation autour de la verticale ; clic sur N, E,
//   S ou O : vue depuis ce point cardinal (le nord vient de l'IFC, TrueNorth).
// - Vue de face : triangles vers les faces voisines ; vue de dessus ou de dessous : flèches de rotation de 90°.
// - Maison : vue 3D de départ.
// Le cube suit le repère du projet Revit (angle a autour de la verticale, lu dans l'IFC), comme le ViewCube de
// Revit orienté sur le nord du projet : AVANT regarde vers le −Y du projet, DROITE vers son +X.
(function(){
  "use strict";
  var PI = Math.PI, DEMI = PI/2, TOUR = 2*PI;
  // Faces : normale, axes du texte (u vers la droite, v vers le haut ; u × v = normale, pour lire le nom de
  // l'extérieur), nom
  var FACES = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], nom: "HAUT" },
    { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0], nom: "BAS" },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], nom: "AVANT" },
    { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1], nom: "ARRIÈRE" },
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], nom: "DROITE" },
    { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1], nom: "GAUCHE" }
  ];
  var BORD = .3;                              // largeur des bandes d'arête et des coins (côté du cube : 2)
  var R1 = 1.95, R2 = 2.32;                   // boussole : rayons intérieur et extérieur, au pied du cube
  var LUM = (function(){ var l = Math.hypot(-.45, .6, .66); return [-.45/l, .6/l, .66/l]; })();   // comme la vue
  var POLICE = '"Inter Tight","Inter Tight repli",system-ui,-apple-system,"Segoe UI",sans-serif';
  var CARDINAUX = [{ l: "N", d: 0 }, { l: "E", d: -DEMI }, { l: "S", d: PI }, { l: "O", d: DEMI }];

  function dot(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
  function plus(a, b, k){ return [a[0] + b[0]*k, a[1] + b[1]*k, a[2] + b[2]*k]; }
  function angleNorm(a){ return a - TOUR*Math.round(a/TOUR); }
  function quart(a){ return DEMI*Math.round(a/DEMI); }
  function dansPoly(P, x, y){
    var s = 0;
    for (var i = 0, n = P.length; i < n; i++){
      var a = P[i], b = P[(i + 1) % n], c = (b[0] - a[0])*(y - a[1]) - (b[1] - a[1])*(x - a[0]);
      if (c){ if (s && (c > 0) !== (s > 0)) return false; s = c; }
    }
    return true;
  }
  // nom d'une zone (direction d du cube) : « haut avant droite »
  function nomZone(d){
    var m = [];
    if (d[2]) m.push(d[2] > 0 ? "haut" : "bas");
    if (d[1]) m.push(d[1] < 0 ? "avant" : "arrière");
    if (d[0]) m.push(d[0] > 0 ? "droite" : "gauche");
    return m.join(" ");
  }
  function memeZone(a, b){ return !!(a && b && a.type === b.type && (a.cle || "") === (b.cle || "")); }

  function creer(cv, vue, opts){
    opts = opts || {};
    var ctx = cv.getContext("2d"), lacet = 0, plongee = 0, angle = 0, nord = DEMI, cle = "", zones = [], survol = null, ptr = null;

    function palette(){
      var clair = document.documentElement.getAttribute("data-theme") === "clair";
      return clair ? {
        face: [251, 250, 246], ombre: [.80, .20], arete: "rgba(22,19,15,.45)", texte: "rgb(74,66,54)",
        or: "rgb(122,83,18)", orFond: "rgba(122,83,18,.26)", anneau: "rgba(22,19,15,.09)", anneauTrait: "rgba(22,19,15,.32)",
        lettre: "rgb(74,66,54)", outil: "rgba(22,19,15,.55)"
      } : {
        face: [74, 72, 66], ombre: [.70, .50], arete: "rgba(236,232,224,.42)", texte: "rgb(236,232,224)",
        or: "rgb(240,200,120)", orFond: "rgba(214,168,92,.42)", anneau: "rgba(236,232,224,.10)", anneauTrait: "rgba(236,232,224,.34)",
        lettre: "rgb(236,232,224)", outil: "rgba(236,232,224,.62)"
      };
    }

    // orientation de la vue dans le repère du cube : lacet ramené entre −π et π, plongée
    function orientation(){ return { y: angleNorm(lacet - angle), p: plongee }; }
    function vueDeFace(o){
      var t = .012;
      if (Math.abs(o.p - DEMI) < t) return "haut";
      if (Math.abs(o.p + DEMI) < t) return "bas";
      if (Math.abs(o.p) < t && Math.abs(o.y - quart(o.y)) < t) return "cote";
      return null;
    }
    function aller(y, p){ vue.allerVers(y + angle, p); }

    function dessiner(){
      var S = cv.clientWidth, k = Math.min(window.devicePixelRatio || 1, 2);
      if (!S) return;
      if (cv.width !== Math.round(S*k)){ cv.width = Math.round(S*k); cv.height = Math.round(S*k); }
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.clearRect(0, 0, S, S);
      zones = [];
      var C = palette(), o = orientation(), ca = Math.cos(o.y), sa = Math.sin(o.y), cb = Math.cos(o.p), sb = Math.sin(o.p);
      var h = S*.19, cx = S/2, cy = S/2 + S*.02;
      var droite = [ca, sa, 0], haut = [-sb*sa, sb*ca, cb], oeil = [cb*sa, -cb*ca, sb];
      function ecran(P){ return [cx + h*dot(P, droite), cy - h*dot(P, haut)]; }

      // --- boussole, en deux temps : la partie derrière le cube, puis celle devant ---
      var vis = Math.max(0, Math.min(1, (Math.abs(sb) - .08)*3)), parts = [[], []], lettres = [[], []];
      if (vis > 0){
        var N = 96, run = null, prec = null;
        for (var j = 0; j <= N; j++){
          var t = j/N*TOUR, c = Math.cos(t), s = Math.sin(t), devant = dot([c*(R1 + R2)/2, s*(R1 + R2)/2, -1], oeil) > 0 ? 1 : 0;
          var pt = { a: ecran([c*R1, s*R1, -1]), b: ecran([c*R2, s*R2, -1]) };
          if (devant !== prec){ if (run) run.pts.push(pt); run = { pts: [], d: devant }; parts[devant].push(run); prec = devant; }
          run.pts.push(pt);
        }
        CARDINAUX.forEach(function(q){
          var t = nord - angle + q.d, P = [Math.cos(t)*(R1 + R2)/2, Math.sin(t)*(R1 + R2)/2, -1];
          lettres[dot(P, oeil) > 0 ? 1 : 0].push({ l: q.l, e: ecran(P), t: t });
        });
      }
      var survolAnneau = survol && (survol.type === "anneau" || survol.type === "lettre");
      function boussole(devant){
        if (!vis) return;
        ctx.save();
        ctx.globalAlpha = vis;
        parts[devant].forEach(function(r){
          ctx.beginPath();
          r.pts.forEach(function(q, i){ if (i) ctx.lineTo(q.b[0], q.b[1]); else ctx.moveTo(q.b[0], q.b[1]); });
          for (var i = r.pts.length - 1; i >= 0; i--) ctx.lineTo(r.pts[i].a[0], r.pts[i].a[1]);
          ctx.closePath();
          ctx.fillStyle = survolAnneau ? C.orFond : C.anneau; ctx.fill();
          ctx.strokeStyle = survolAnneau ? C.or : C.anneauTrait; ctx.lineWidth = 1;
          ["a", "b"].forEach(function(cote){
            ctx.beginPath();
            r.pts.forEach(function(q, i){ if (i) ctx.lineTo(q[cote][0], q[cote][1]); else ctx.moveTo(q[cote][0], q[cote][1]); });
            ctx.stroke();
          });
        });
        ctx.font = "600 " + Math.round(S*.075) + "px " + POLICE;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        lettres[devant].forEach(function(q){
          var sv = survol && survol.type === "lettre" && survol.cle === q.l;
          ctx.fillStyle = sv ? C.or : C.lettre;
          ctx.fillText(q.l, q.e[0], q.e[1]);
          if (vis > .5) zones.push({ type: "lettre", cle: q.l, t: q.t, rond: [q.e[0], q.e[1], S*.07] });
        });
        ctx.restore();
      }
      boussole(0);

      // --- ombre douce du cube posée au sol, dans la boussole (visible depuis le dessus) ---
      if (sb > .05){
        var o0 = ecran([0, 0, -1]), ro = h*1.7, sombre = C.texte.indexOf("236") >= 0;
        ctx.save();
        ctx.translate(o0[0], o0[1]); ctx.scale(1, sb);
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, ro), a = (sombre ? .55 : .32)*Math.min(1, sb*2);
        g.addColorStop(0, "rgba(0,0,0," + a + ")"); g.addColorStop(.55, "rgba(0,0,0," + a*.45 + ")"); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ro, 0, TOUR); ctx.fill();
        ctx.restore();
      }

      // --- cube : faces tournées vers l'œil (convexe : elles ne se recouvrent pas) ---
      var fit = taillePolice();
      FACES.forEach(function(F){
        var f = dot(F.n, oeil);
        if (f <= 1e-3) return;
        var nv = [dot(F.n, droite), dot(F.n, haut), f], l = Math.max(0, nv[0]*LUM[0] + nv[1]*LUM[1] + nv[2]*LUM[2]);
        var g = C.ombre[0] + C.ombre[1]*l, rgb = C.face.map(function(v){ return Math.min(255, Math.round(v*g)); });
        function pt(a, b){ return ecran(plus(plus(F.n, F.u, a), F.v, b)); }
        function quad(a0, a1, b0, b1){ return [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)]; }
        function trace(Q){ ctx.beginPath(); Q.forEach(function(q, i){ if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }
        var tout = quad(-1, 1, -1, 1);
        trace(tout);
        ctx.fillStyle = "rgb(" + rgb.join(",") + ")"; ctx.fill();
        // 9 zones par face : centre (la face), bandes (arêtes), coins
        var I = [[-1, -1 + BORD], [-1 + BORD, 1 - BORD], [1 - BORD, 1]];
        for (var iu = -1; iu <= 1; iu++) for (var iv = -1; iv <= 1; iv++){
          var d = plus(plus(F.n, F.u, iu), F.v, iv), Q = quad(I[iu + 1][0], I[iu + 1][1], I[iv + 1][0], I[iv + 1][1]), c = d.join(",");
          if (survol && survol.type === "zone" && survol.cle === c){ trace(Q); ctx.fillStyle = C.orFond; ctx.fill(); }
          zones.push({ type: "zone", cle: c, d: d, poly: Q });
        }
        // nom de la face, posé dans son plan (projection orthogonale : transformation affine exacte)
        var O = ecran(F.n), U = ecran(plus(F.n, F.u, 1)), V = ecran(plus(F.n, F.v, 1));
        ctx.save();
        ctx.setTransform(k*(U[0] - O[0])/100, k*(U[1] - O[1])/100, -k*(V[0] - O[0])/100, -k*(V[1] - O[1])/100, k*O[0], k*O[1]);
        ctx.globalAlpha = Math.max(0, Math.min(1, (f - .1)/.3));
        ctx.font = "600 " + fit + "px " + POLICE;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = survol && survol.type === "zone" && survol.cle === F.n.join(",") ? C.or : C.texte;
        ctx.fillText(F.nom, 0, 2);
        ctx.restore();
        trace(tout);
        ctx.strokeStyle = C.arete; ctx.lineWidth = 1; ctx.lineJoin = "round"; ctx.stroke();
      });
      boussole(1);

      // --- vue de face : triangles vers les faces voisines ; dessus ou dessous : flèches de 90° ---
      var face = vueDeFace(o);
      if (face){
        var e = h + S*.045, L = S*.06, w = S*.05;
        [["haut", 0, -1], ["bas", 0, 1], ["gauche", -1, 0], ["droite", 1, 0]].forEach(function(t){
          var dx = t[1], dy = t[2], bx = cx + dx*e, by = cy + dy*e, ax = bx + dx*L, ay = by + dy*L;
          var P = [[ax, ay], [bx - dy*w, by + dx*w], [bx + dy*w, by - dx*w]];
          ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.lineTo(P[2][0], P[2][1]); ctx.closePath();
          ctx.fillStyle = survol && survol.type === "triangle" && survol.cle === t[0] ? C.or : C.outil; ctx.fill();
          zones.push({ type: "triangle", cle: t[0], rond: [(ax + bx)/2, (ay + by)/2, S*.065] });
        });
        // en haut à droite, hors de la boussole (rayon extérieur 2,32 × h = 0,44 × S)
        if (face !== "cote") [["horaire", 1, cx + S*.433, cy - S*.25], ["antihoraire", -1, cx + S*.25, cy - S*.433]].forEach(function(f){
          var sv = survol && survol.type === "fleche" && survol.cle === f[0], r = S*.045, sens = f[1];
          ctx.save();
          ctx.translate(f[2], f[3]);
          ctx.strokeStyle = ctx.fillStyle = sv ? C.or : C.outil; ctx.lineWidth = Math.max(1.5, S*.014); ctx.lineCap = "round";
          var a0 = sens > 0 ? -PI*.85 : PI*.15, a1 = sens > 0 ? PI*.15 : PI*1.15;
          ctx.beginPath(); ctx.arc(0, 0, r, a0, a1, sens < 0); ctx.stroke();
          // pointe au bout de l'arc, tangente au sens de rotation
          var tx = Math.cos(a1)*r, ty = Math.sin(a1)*r, dxp = -Math.sin(a1)*sens, dyp = Math.cos(a1)*sens, q = S*.032;
          ctx.beginPath();
          ctx.moveTo(tx + dxp*q, ty + dyp*q);
          ctx.lineTo(tx - dyp*q*.8 - dxp*q*.2, ty + dxp*q*.8 - dyp*q*.2);
          ctx.lineTo(tx + dyp*q*.8 - dxp*q*.2, ty - dxp*q*.8 - dyp*q*.2);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          zones.push({ type: "fleche", cle: f[0], sens: sens, rond: [f[2], f[3], S*.075] });
        });
      }

      // --- maison : vue de départ ---
      var mx = S*.1, my = S*.09, m = S*.05, sm = survol && survol.type === "maison";
      ctx.save();
      ctx.strokeStyle = sm ? C.or : C.outil; ctx.lineWidth = Math.max(1.4, S*.012); ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(mx - m, my); ctx.lineTo(mx, my - m*.9); ctx.lineTo(mx + m, my);
      ctx.moveTo(mx - m*.7, my - m*.25); ctx.lineTo(mx - m*.7, my + m*.85); ctx.lineTo(mx + m*.7, my + m*.85); ctx.lineTo(mx + m*.7, my - m*.25);
      ctx.stroke();
      ctx.restore();
      zones.push({ type: "maison", rond: [mx, my, S*.08] });

      // couronne de la boussole : en tête de liste, donc essayée en dernier (les zones sont lues depuis la fin),
      // pour que les faces du cube devant elle gardent le clic
      if (vis > .5) zones.unshift({ type: "anneau", h: h, cx: cx, cy: cy, ca: ca, sa: sa, cb: cb, sb: sb });
    }

    var policeCache = { s: 0, v: 0 };
    function taillePolice(){
      // même taille pour les six noms, ARRIÈRE compris, tenue dans la face sans les bandes d'arête
      if (policeCache.v) return policeCache.v;
      ctx.save();
      ctx.font = "600 40px " + POLICE;
      var w = Math.max.apply(null, FACES.map(function(F){ return ctx.measureText(F.nom).width; }));
      ctx.restore();
      policeCache.v = Math.max(14, Math.min(40, 40*(2*(1 - BORD)*100 - 14)/w));
      return policeCache.v;
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ policeCache.v = 0; dessiner(); });

    function zoneSous(x, y){
      for (var i = zones.length - 1; i >= 0; i--){
        var z = zones[i];
        if (z.rond){ if (Math.hypot(x - z.rond[0], y - z.rond[1]) <= z.rond[2]) return z; continue; }
        if (z.poly){ if (dansPoly(z.poly, x, y)) return z; continue; }
        if (z.type === "anneau"){
          // point de la boussole sous le curseur : retour du plan z = −1 vers le repère du cube
          var X = (x - z.cx)/z.h, Y = -(y - z.cy)/z.h, q = (Y + z.cb)/z.sb, px = z.ca*X - z.sa*q, py = z.sa*X + z.ca*q, r = Math.hypot(px, py);
          if (r >= R1 - .1 && r <= R2 + .12) return z;
        }
      }
      return null;
    }
    function survoler(z){
      if (memeZone(z, survol) || (!z && !survol)) return;
      survol = z;
      cv.style.cursor = z ? (z.type === "anneau" ? "grab" : "pointer") : "";
      cv.title = !z ? "" : z.type === "zone" ? "Vue " + nomZone(z.d) : z.type === "triangle" ? "Tourner vers la face voisine" :
        z.type === "fleche" ? (z.sens > 0 ? "Tourner de 90° dans le sens horaire" : "Tourner de 90° dans le sens antihoraire") :
        z.type === "lettre" ? "Vue depuis le " + { N: "nord", E: "est", S: "sud", O: "ouest" }[z.cle] :
        z.type === "maison" ? "Vue 3D de départ" : "Glisser pour tourner autour de la verticale";
      dessiner();
    }

    function agir(z){
      var o = orientation(), face = vueDeFace(o), y = quart(o.y);
      if (z.type === "zone"){
        var d = z.d, hz = Math.hypot(d[0], d[1]);
        // dessus ou dessous : on garde le quart de tour le plus proche, pour ne pas faire pivoter le plan
        aller(hz ? Math.atan2(d[0], -d[1]) : y, Math.atan2(d[2], hz));
      }
      // triangles : vers la face qui est de ce côté de l'écran, d'équerre avec le cube
      else if (z.type === "triangle"){
        if (z.cle === "gauche") aller(y - DEMI, 0);
        else if (z.cle === "droite") aller(y + DEMI, 0);
        else if (face === "cote") aller(y, z.cle === "haut" ? DEMI : -DEMI);
        else if (face === "haut") aller(z.cle === "haut" ? y + PI : y, 0);
        else aller(z.cle === "haut" ? y : y + PI, 0);
      }
      // sens horaire à l'écran : lacet croissant vu de dessus, décroissant vu de dessous
      else if (z.type === "fleche") aller(o.y + z.sens*DEMI*(o.p > 0 ? 1 : -1), o.p);
      else if (z.type === "lettre") aller(z.t + DEMI, o.p);
      else if (z.type === "maison"){ if (opts.maison) opts.maison(); }
    }

    function local(e){ var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    // rotation autour de la verticale qui garde sous le curseur le point saisi de la boussole
    function angleAnneau(x, y){
      var z = null;
      for (var i = 0; i < zones.length; i++) if (zones[i].type === "anneau") z = zones[i];
      if (!z || Math.abs(z.sb) < .2) return null;
      var X = (x - z.cx)/z.h, Y = -(y - z.cy)/z.h, q = (Y + z.cb)/z.sb;
      return Math.atan2(z.sa*X + z.ca*q, z.ca*X - z.sa*q);
    }
    cv.addEventListener("pointerdown", function(e){
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      var p = local(e);
      ptr = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, z: zoneSous(p.x, p.y), glisse: false };
      try { cv.setPointerCapture(e.pointerId); } catch (x){}
    });
    cv.addEventListener("pointermove", function(e){
      var p = local(e);
      if (!ptr || ptr.id !== e.pointerId){ if (e.pointerType === "mouse") survoler(zoneSous(p.x, p.y)); return; }
      if (!ptr.glisse && Math.hypot(p.x - ptr.x0, p.y - ptr.y0) > 4){
        ptr.glisse = true;
        cv.style.cursor = "grabbing";
      }
      if (ptr.glisse){
        var a0 = ptr.z && ptr.z.type === "anneau" ? angleAnneau(ptr.x, ptr.y) : null, a1 = a0 == null ? null : angleAnneau(p.x, p.y);
        if (a0 != null && a1 != null) vue.tourner(-angleNorm(a1 - a0), 0);
        else if (ptr.z && ptr.z.type === "anneau") vue.tourner(-(p.x - ptr.x)*.012, 0);
        else vue.tourner(-(p.x - ptr.x)*.012, (p.y - ptr.y)*.012);
      }
      ptr.x = p.x; ptr.y = p.y;
    });
    function lacher(e, annule){
      if (!ptr || ptr.id !== e.pointerId) return;
      var z = ptr.z, g = ptr.glisse;
      ptr = null;
      if (g){ vue.finTourner(); cv.style.cursor = ""; survol = null; survoler(e.pointerType === "mouse" ? zoneSous(local(e).x, local(e).y) : null); return; }
      if (!annule && z && z.type !== "anneau") agir(z);
    }
    cv.addEventListener("pointerup", function(e){ lacher(e, false); });
    cv.addEventListener("pointercancel", function(e){ lacher(e, true); });
    cv.addEventListener("pointerleave", function(){ if (!ptr) survoler(null); });
    cv.addEventListener("contextmenu", function(e){ e.preventDefault(); });
    // molette sur le cube : zoom de la vue (le canvas voisin), autour du centre de l'écran
    cv.addEventListener("wheel", function(e){
      e.preventDefault();
      var v = Array.prototype.filter.call(cv.parentNode.children, function(c){ return c !== cv && c.tagName === "CANVAS"; })[0];
      if (!v) return;
      var r = v.getBoundingClientRect();
      v.dispatchEvent(new WheelEvent("wheel", { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true, cancelable: true }));
    }, { passive: false });
    new MutationObserver(function(){ dessiner(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if ("ResizeObserver" in window) new ResizeObserver(function(){ dessiner(); }).observe(cv);

    return {
      // appelé par la vue après chaque image : redessin seulement si l'orientation a changé
      camera: function(l, p){
        var c = l.toFixed(5) + "|" + p.toFixed(5);
        if (c === cle) return;
        cle = c; lacet = l; plongee = p;
        dessiner();
      },
      // repère du projet (angle a de son axe X autour de la verticale) et direction du nord (radians, depuis +X)
      repere: function(a, n){ angle = a || 0; nord = n == null ? DEMI : n; dessiner(); },
      redessiner: dessiner
    };
  }

  window.FGHCube = { creer: creer };
})();
