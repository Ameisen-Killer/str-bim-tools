/* Tour filaire du tableau de bord — décor.
   ---------------------------------------------------------------------------
   Même recette que la maquette de l'accueil (docs/index.html) : façades
   orientées, faces cachées masquées par un aplat du fond, construction du bas
   vers le haut, puis rotation lente (un tour en 60 s). Ici, une seule tour de
   verre de 28 niveaux, sans interaction : le planning garde la souris.
   Les couleurs viennent du thème ; le dessin s'arrête dès qu'il sort de l'écran.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var cv = document.getElementById("tour");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function norm(v) { var n = Math.hypot(v[0], v[2]) || 1; return [v[0] / n, 0, v[2] / n]; }
  var graine = 1;
  function rnd() { var x = Math.sin(graine++ * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ------------------------------------------------------------- la tour ---
     Carrée, 26 m de côté, 28 niveaux de 3,9 m. Chaque façade porte ses
     meneaux, ses nez de dalle et ses plateaux éclairés. */

  var COTE = 26, NIV = 28, ETAGE = 3.9, HAUT = NIV * ETAGE + 1.2;
  var KM = 4.6 / HAUT;                                  // la construction monte : délai par mètre
  var faces = [], vitres = [], finConstruction = 0;

  function retard(y) { return .25 + y * KM; }

  function Face(O, a, n) {
    var f = {
      O: O, a: a, n: n, lignes: [], vitres: [],
      P: function (s, t) { return [O[0] + a[0] * s, t, O[2] + a[2] * s]; }
    };
    f.c = [O[0] + a[0] * COTE / 2, HAUT / 2, O[2] + a[2] * COTE / 2];
    faces.push(f);
    return f;
  }
  function L(f, s0, t0, s1, t1, cls, d, t) {
    f.lignes.push({ a: f.P(s0, t0), b: f.P(s1, t1), c: cls, d: d, t: t });
    finConstruction = Math.max(finConstruction, d + t);
  }
  function plateau(f, s0, s1, t0, t1, o, d) {
    var q = { p: [f.P(s0, t0), f.P(s1, t0), f.P(s1, t1), f.P(s0, t1)], o: o, cur: o, d: d, t: 1.4 };
    f.vitres.push(q); vitres.push(q);
    finConstruction = Math.max(finConstruction, d + q.t);
  }

  function facade(f) {
    var nm = Math.round(COTE / 1.5), mw = COTE / nm, montee = 3.6 * HAUT / 71.4;
    for (var k = 0; k <= nm; k++) {
      L(f, k * mw, 0, k * mw, HAUT, (k === 0 || k === nm || k % 4 === 0) ? "v" : "vf", .25 + k * .025, montee);
    }
    for (var j = 0; j <= NIV; j++) {
      var t = j * ETAGE, fort = (j % 4 === 0 || j === NIV);
      L(f, 0, t, COTE, t, fort ? "v" : "vf", retard(t) + .3, 1.2);
      if (fort && j > 0) L(f, 0, t - .6, COTE, t - .6, "vf", retard(t) + .4, 1.2);
    }
    L(f, 0, HAUT, COTE, HAUT, "v", retard(HAUT) + .5, 1.4);

    // Plateaux éclairés, par tronçons de deux à cinq travées
    for (var e = 0; e < NIV; e++) {
      var s = 0;
      while (s < COTE - .1) {
        var bout = Math.min(COTE, s + mw * (2 + Math.floor(rnd() * 4)));
        var r = rnd(), r2 = rnd();
        plateau(f, s + .25, bout - .25, e * ETAGE + .5, (e + 1) * ETAGE - .7,
                r < .24 ? .34 + r2 * .34 : .015 + r2 * .03, retard(e * ETAGE) + .9 + r2 * 1.2);
        s = bout;
      }
    }
  }

  facade(Face([0, 0, 0], [1, 0, 0], [0, 0, -1]));        // sud
  facade(Face([COTE, 0, 0], [0, 0, 1], [1, 0, 0]));      // est
  facade(Face([COTE, 0, COTE], [-1, 0, 0], [0, 0, 1]));  // nord
  facade(Face([0, 0, COTE], [0, 0, -1], [-1, 0, 0]));    // ouest

  /* ------------------------------------------------------ caméra en orbite */

  var CENTRE = [COTE / 2, 0, COTE / 2], RAYON = .78 * COTE;
  var R = 2.6 * HAUT, EH = 14, TH0 = .5;                 // œil bas : les verticales restent verticales
  var LUM = norm([.8, 0, -.6]);
  var cam = {};

  function camera(th) {
    cam.eye = [CENTRE[0] + R * Math.sin(th), EH, CENTRE[2] - R * Math.cos(th)];
    cam.fw = norm([CENTRE[0] - cam.eye[0], 0, CENTRE[2] - cam.eye[2]]);
    cam.rt = [cam.fw[2], 0, -cam.fw[0]];
  }
  function proj(p) {
    var dx = p[0] - cam.eye[0], dz = p[2] - cam.eye[2];
    var z = dx * cam.fw[0] + dz * cam.fw[2];
    return [(dx * cam.rt[0] + dz * cam.rt[2]) / z, -(p[1] - EH) / z];
  }

  // Cadrage valable pour tous les angles : la tour ne sort jamais du cadre
  var ext = { x: 0, y0: 1e9, y1: -1e9 };
  (function () {
    var pts = [];
    faces.forEach(function (f) { pts.push(f.P(0, 0), f.P(0, HAUT), f.P(COTE, 0), f.P(COTE, HAUT)); });
    for (var i = 0; i < 72; i++) {
      camera(i / 72 * Math.PI * 2);
      pts.forEach(function (p) {
        var q = proj(p);
        ext.x = Math.max(ext.x, Math.abs(q[0]));
        ext.y0 = Math.min(ext.y0, q[1]);
        ext.y1 = Math.max(ext.y1, q[1]);
      });
    }
  })();

  var W = 0, H = 0, dpr = 1, S = 1, CX = 0, CY = 0, RECUL = .88;
  function taille() {
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    S = RECUL * Math.min(W * .94 / (2 * ext.x), H * .96 / (ext.y1 - ext.y0));
    CX = W / 2; CY = H / 2 - S * (ext.y0 + ext.y1) / 2;
  }
  function ecran(p) { var q = proj(p); return [CX + S * q[0], CY + S * q[1]]; }

  /* ---------------------------------------------------------- couleurs ---
     Elles viennent du thème : trait d'encre ou trait clair, verre, or, fond. */

  var ALPHA = { "": .62, f: .2, v: .5, vf: .16 };
  var COUL = null;

  function lisTheme() {
    var s = getComputedStyle(document.documentElement);
    function v(nom, defaut) { return (s.getPropertyValue(nom) || defaut).trim(); }
    var encre = v("--encre", "236,232,224"), verre = v("--verre-rvb", "170,192,214");
    COUL = {
      fond: v("--noir", "#050505"),
      or: v("--or", "#D6A85C"),
      sol: "rgba(" + encre + ",.13)",
      verre: verre,
      trait: { "": encre, f: encre, v: verre, vf: verre }
    };
  }
  lisTheme();
  if (global.MutationObserver) {
    new MutationObserver(lisTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* ------------------------------------------------------------- dessin */

  function dessiner(T, th) {
    camera(th);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.lineCap = "butt"; ctx.lineJoin = "miter";

    // Cercle d'implantation
    var ps = ease(clamp((T - .1) / 2.2));
    if (ps > 0) {
      ctx.beginPath();
      for (var i = 0; i <= 96 * ps; i++) {
        var an = TH0 - Math.PI / 2 + i / 96 * Math.PI * 2;
        var e = ecran([CENTRE[0] + RAYON * Math.cos(an), 0, CENTRE[2] + RAYON * Math.sin(an)]);
        i ? ctx.lineTo(e[0], e[1]) : ctx.moveTo(e[0], e[1]);
      }
      ctx.strokeStyle = COUL.sol; ctx.stroke();
    }

    // Façades tournées vers l'œil, de la plus lointaine à la plus proche
    var vis = [];
    for (var k = 0; k < faces.length; k++) {
      var f = faces[k];
      if (f.n[0] * (cam.eye[0] - f.c[0]) + f.n[2] * (cam.eye[2] - f.c[2]) <= 0) continue;
      f.z = (f.c[0] - cam.eye[0]) * cam.fw[0] + (f.c[2] - cam.eye[2]) * cam.fw[2];
      vis.push(f);
    }
    vis.sort(function (a, b) { return b.z - a.z; });

    for (var m = 0; m < vis.length; m++) {
      var fa = vis[m];
      var c0 = ecran(fa.P(0, 0)), c1 = ecran(fa.P(COTE, 0)), c2 = ecran(fa.P(COTE, HAUT)), c3 = ecran(fa.P(0, HAUT));
      ctx.beginPath();
      ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]);
      ctx.closePath();
      ctx.fillStyle = COUL.fond; ctx.fill();                 // la façade masque ce qui est derrière

      var lam = Math.max(0, fa.n[0] * LUM[0] + fa.n[2] * LUM[2]);
      var eclat = .72 + .4 * lam;

      // Reflet du verre, une fois la façade montée
      var ap = ease(clamp((T - retard(HAUT) - 1.6) / 2.4));
      if (ap > 0) {
        var vv = norm([cam.eye[0] - fa.c[0], 0, cam.eye[2] - fa.c[2]]);
        var hv = norm([LUM[0] + vv[0], 0, LUM[2] + vv[2]]);
        var spec = Math.pow(Math.max(0, fa.n[0] * hv[0] + fa.n[2] * hv[2]), 10);
        var g = ctx.createLinearGradient(0, c3[1], 0, c0[1]);
        g.addColorStop(0, "rgba(" + COUL.verre + "," + ((.05 + .2 * spec) * ap).toFixed(3) + ")");
        g.addColorStop(1, "rgba(" + COUL.verre + "," + ((.01 + .04 * spec) * ap).toFixed(3) + ")");
        ctx.fillStyle = g; ctx.fill();
      }

      for (var qi = 0; qi < fa.vitres.length; qi++) {
        var q = fa.vitres[qi];
        var al = clamp((T - q.d) / q.t) * q.cur;
        if (al < .01) continue;
        var p0 = ecran(q.p[0]), p1 = ecran(q.p[1]), p2 = ecran(q.p[2]), p3 = ecran(q.p[3]);
        ctx.globalAlpha = al * (.8 + .25 * lam);
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        ctx.fillStyle = COUL.or; ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (var cls in COUL.trait) {
        ctx.beginPath();
        var n = 0;
        for (var li = 0; li < fa.lignes.length; li++) {
          var l = fa.lignes[li];
          if (l.c !== cls) continue;
          var p = ease(clamp((T - l.d) / l.t));
          if (p <= 0) continue;
          var b = [l.a[0] + (l.b[0] - l.a[0]) * p, l.a[1] + (l.b[1] - l.a[1]) * p, l.a[2] + (l.b[2] - l.a[2]) * p];
          var e0 = ecran(l.a), e1 = ecran(b);
          ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]);
          n++;
        }
        if (n) {
          ctx.strokeStyle = "rgba(" + COUL.trait[cls] + "," + Math.min(1, ALPHA[cls] * eclat).toFixed(3) + ")";
          ctx.stroke();
        }
      }
    }
  }

  /* --------------------------------- construction, puis rotation lente ---
     Le dessin s'interrompt quand la tour sort de l'écran ou que l'onglet
     passe au second plan : le planning ne partage pas le processeur pour rien. */

  var VITESSE = Math.PI * 2 / 60, DEBUT_ROT = finConstruction - 1.5;
  var T = 0, th = TH0, omega = 0, prochaine = DEBUT_ROT + 1, dernier = 0, anim = null, visible = true;

  function frame(now) {
    anim = null;
    var dt = dernier ? Math.min(.05, (now - dernier) / 1000) : 0;
    dernier = now;
    T += dt;

    var cible = T > DEBUT_ROT ? VITESSE : 0;
    omega += (cible - omega) * Math.min(1, dt * (T - DEBUT_ROT < 6 ? .35 : 1.2));
    th += omega * dt;

    // Une fois la tour montée, un plateau s'allume ou s'éteint de temps en temps
    if (T > prochaine) {
      prochaine = T + .8;
      var q = vitres[Math.floor(Math.random() * vitres.length)];
      q.o = q.o > .3 ? .015 + Math.random() * .03 : .34 + Math.random() * .34;
    }
    if (T > DEBUT_ROT) {
      for (var i = 0; i < vitres.length; i++) {
        var v = vitres[i], d = v.o - v.cur, pas = dt / 2.8;
        v.cur = Math.abs(d) <= pas ? v.o : v.cur + (d > 0 ? pas : -pas);
      }
    }

    dessiner(T, th);
    relance();
  }
  function relance() {
    if (anim === null && visible && !document.hidden) anim = requestAnimationFrame(frame);
  }
  function reprend() { dernier = 0; relance(); }

  global.addEventListener("resize", function () { taille(); reprend(); });
  document.addEventListener("visibilitychange", reprend);
  if (global.IntersectionObserver) {
    new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting;
      if (visible) reprend();
    }, { rootMargin: "120px" }).observe(cv);
  }

  taille();
  relance();
})(window);
