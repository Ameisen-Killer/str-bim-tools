/* Villa filaire du tableau de bord — décor.
   ---------------------------------------------------------------------------
   Remplace la tour (26.09.2026), trop haute pour un en-tête qui s'est
   resserré : une maison basse et large tient dans la bande au-dessus du filet
   d'or, sur lequel elle est posée — le filet lui sert de sol.

   Même recette que la maquette de l'accueil : volumes orientés, faces cachées
   masquées par un aplat du fond, construction du sol vers le toit, puis
   mouvement lent. Ici, pas de tour complet : la maison a une façade, alors la
   caméra balance de vingt degrés de part et d'autre au lieu de tourner autour
   — on la voit toujours de face, terrasse et bassin devant.

   Trois volumes à toit plat : deux ailes d'un niveau qui s'avancent, un corps
   central de deux niveaux en retrait, largement vitré. Devant, la terrasse et
   le bassin. Les couleurs viennent du thème ; le dessin s'arrête dès qu'il
   sort de l'écran ou que l'onglet passe au second plan.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var cv = document.getElementById("villa");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function norm(v) { var n = Math.hypot(v[0], v[2]) || 1; return [v[0] / n, 0, v[2] / n]; }
  var graine = 7;
  function rnd() { var x = Math.sin(graine++ * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* --------------------------------------------------------- la maison ---
     Mètres. x va vers la droite, y vers le haut, z vers le fond : la façade
     principale regarde les z négatifs, c'est de ce côté que sont la terrasse
     et le bassin. */

  var NIV = 3.6;                                   // hauteur d'un niveau
  var faces = [], vitres = [], sol = [], finConstruction = 0;

  /** Délai d'apparition : la construction monte, et va de gauche à droite. */
  function retard(x, y) { return .35 + x * .018 + y * .1; }

  /** Une face plane, définie par son origine, sa direction et sa normale. */
  function Face(O, a, n, lon, bas, haut) {
    var f = {
      O: O, a: a, n: n, lon: lon, bas: bas, haut: haut, lignes: [], vitres: [], plan: "v",
      P: function (s, t) { return [O[0] + a[0] * s, t, O[2] + a[2] * s]; }
    };
    f.c = [O[0] + a[0] * lon / 2, (bas + haut) / 2, O[2] + a[2] * lon / 2];
    faces.push(f);
    return f;
  }

  /** Une toiture plate, vue de dessus : quatre coins, et son propre aplat. */
  function Toit(x0, z0, x1, z1, y) {
    var f = {
      plan: "h", y: y, lignes: [], vitres: [],
      quad: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]],
      c: [(x0 + x1) / 2, y, (z0 + z1) / 2]
    };
    faces.push(f);
    return f;
  }

  function L(f, s0, t0, s1, t1, cls, d, t) {
    f.lignes.push({ a: f.P(s0, t0), b: f.P(s1, t1), c: cls, d: d, t: t });
    finConstruction = Math.max(finConstruction, d + t);
  }
  /** Ligne posée à plat (toiture, terrasse, bassin) : coordonnées absolues. */
  function LH(f, a, b, cls, d, t) {
    f.lignes.push({ a: a, b: b, c: cls, d: d, t: t });
    finConstruction = Math.max(finConstruction, d + t);
  }
  function vitre(f, s0, s1, t0, t1, o, d) {
    var q = { p: [f.P(s0, t0), f.P(s1, t0), f.P(s1, t1), f.P(s0, t1)], o: o, cur: 0, d: d, t: 1.3 };
    f.vitres.push(q); vitres.push(q);
    finConstruction = Math.max(finConstruction, d + q.t);
  }

  /**
   * Façade vitrée : meneaux réguliers, nez de dalle à chaque niveau, et un
   * vitrage allumé par travée. `pleine` : rez largement ouvert (baies), sinon
   * un simple rythme de fenêtres.
   */
  function facade(f, pleine) {
    var pas = 1.7, nm = Math.max(2, Math.round(f.lon / pas)), mw = f.lon / nm;
    var etages = Math.max(1, Math.round((f.haut - f.bas) / NIV));

    for (var k = 0; k <= nm; k++) {
      L(f, k * mw, f.bas, k * mw, f.haut, (k === 0 || k === nm) ? "v" : "vf",
        retard(f.O[0] + f.a[0] * k * mw, f.bas) + .1, .9);
    }
    for (var j = 0; j <= etages; j++) {
      var t = f.bas + j * (f.haut - f.bas) / etages;
      L(f, 0, t, f.lon, t, (j === 0 || j === etages) ? "v" : "vf", retard(f.c[0], t) + .2, 1);
    }
    for (var e = 0; e < etages; e++) {
      var y0 = f.bas + e * (f.haut - f.bas) / etages, y1 = f.bas + (e + 1) * (f.haut - f.bas) / etages;
      for (var b = 0; b < nm; b++) {
        var large = pleine || rnd() > .35;
        if (!large) continue;
        var r = rnd();
        vitre(f, b * mw + .18, (b + 1) * mw - .18, y0 + .35, y1 - .45,
              r < .55 ? .30 + rnd() * .34 : .02 + rnd() * .04,
              retard(f.O[0] + f.a[0] * (b + .5) * mw, y0) + 1.1 + rnd() * .9);
      }
    }
  }

  /**
   * Un volume à toit plat : ses quatre façades, sa toiture et son acrotère.
   * `avant` : la façade qui regarde la terrasse est entièrement vitrée.
   */
  function volume(x0, z0, x1, z1, haut, avant) {
    var lx = x1 - x0, lz = z1 - z0, ACR = .35;
    facade(Face([x0, 0, z0], [1, 0, 0], [0, 0, -1], lx, 0, haut), avant);   // devant
    facade(Face([x1, 0, z0], [0, 0, 1], [1, 0, 0], lz, 0, haut), false);    // droite
    facade(Face([x1, 0, z1], [-1, 0, 0], [0, 0, 1], lx, 0, haut), false);   // derrière
    facade(Face([x0, 0, z1], [0, 0, -1], [-1, 0, 0], lz, 0, haut), false);  // gauche

    var t = Toit(x0, z0, x1, z1, haut);
    var d = retard((x0 + x1) / 2, haut) + .5;
    // Acrotère : le bandeau plein qui coiffe un toit plat, et le seul relief du dessus
    [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]].forEach(function (s, i) {
      LH(t, [s[0], haut + ACR, s[1]], [s[2], haut + ACR, s[3]], "v", d + i * .06, .8);
      LH(t, [s[0], haut, s[1]], [s[0], haut + ACR, s[1]], "vf", d + i * .06, .4);
    });
    return t;
  }

  var AILE = 3.6, CORPS = 7.2;
  volume(0, -2, 10, 8, AILE, true);        // aile gauche, avancée
  volume(10, 0, 24, 8, CORPS, true);       // corps central, deux niveaux
  volume(24, -2, 34, 8, AILE, true);       // aile droite, avancée

  /* ------------------------------------------------- terrasse et bassin ---
     Posés à plat, en traits seuls : le filet d'or de l'en-tête passe derrière,
     et rien ne doit le masquer. */

  var TERRASSE = { x0: .5, x1: 33.5, z0: -9.2, z1: 8 };
  var BASSIN = { x0: 8.5, x1: 25.5, z0: -8, z1: -3.2 };

  var dalle = Toit(TERRASSE.x0, TERRASSE.z0, TERRASSE.x1, TERRASSE.z1, 0);
  dalle.transparent = true;                      // pas d'aplat : le filet reste visible
  dalle.rang = 1;                                // le sol se pose avant tout le reste

  // L'eau : une face à part, posée sur le bassin. Elle est devant la maison,
  // donc dessinée en dernier — sinon les façades passeraient par-dessus.
  var eau = Toit(BASSIN.x0, BASSIN.z0, BASSIN.x1, BASSIN.z1, 0);
  eau.transparent = true; eau.nappe = true; eau.rang = -1;

  function contour(f, r, y, cls, d, t) {
    LH(f, [r.x0, y, r.z0], [r.x1, y, r.z0], cls, d, t);
    LH(f, [r.x1, y, r.z0], [r.x1, y, r.z1], cls, d + .1, t);
    LH(f, [r.x1, y, r.z1], [r.x0, y, r.z1], cls, d + .2, t);
    LH(f, [r.x0, y, r.z1], [r.x0, y, r.z0], cls, d + .3, t);
  }

  contour(dalle, TERRASSE, 0, "f", .1, 1.8);
  contour(dalle, BASSIN, 0, "v", .5, 1.6);
  // Margelle : un second trait à l'intérieur, et la ligne d'eau
  contour(dalle, { x0: BASSIN.x0 + .45, x1: BASSIN.x1 - .45, z0: BASSIN.z0 + .45, z1: BASSIN.z1 - .45 }, 0, "vf", .8, 1.4);
  for (var i = 1; i <= 3; i++) {
    var zz = BASSIN.z0 + (BASSIN.z1 - BASSIN.z0) * i / 4;
    LH(dalle, [BASSIN.x0 + .8, 0, zz], [BASSIN.x1 - .8, 0, zz], "vf", 1.3 + i * .18, 1.2);
  }
  sol.push(dalle);

  /* ------------------------------------------------------ caméra qui balance */

  var CENTRE = [17, 0, -1], R = 58, EH = 10.5, AMPLI = .34;   // ±19° autour de la face
  var LUM = norm([-.75, 0, -.66]);
  var cam = {};

  function camera(th) {
    cam.eye = [CENTRE[0] + R * Math.sin(th), EH, CENTRE[2] - R * Math.cos(th)];
    cam.fw = norm([CENTRE[0] - cam.eye[0], 0, CENTRE[2] - cam.eye[2]]);
    cam.rt = [cam.fw[2], 0, -cam.fw[0]];
  }
  function proj(p) {
    var dx = p[0] - cam.eye[0], dz = p[2] - cam.eye[2];
    var z = dx * cam.fw[0] + dz * cam.fw[2];
    if (z < 1) z = 1;                                     // rien ne passe derrière l'œil
    return [(dx * cam.rt[0] + dz * cam.rt[2]) / z, -(p[1] - EH) / z];
  }

  // Cadrage tenu sur tout le balancement : la maison ne sort jamais du cadre
  var ext = { x: 0, y0: 1e9, y1: -1e9 };
  (function () {
    var pts = [];
    faces.forEach(function (f) {
      if (f.plan === "h") pts.push.apply(pts, f.quad);
      else pts.push(f.P(0, f.bas), f.P(0, f.haut), f.P(f.lon, f.bas), f.P(f.lon, f.haut));
      // Emmarchement, margelles : des traits qui débordent des faces
      f.lignes.forEach(function (l) { pts.push(l.a, l.b); });
    });
    for (var i = 0; i <= 24; i++) {
      camera(-AMPLI + 2 * AMPLI * i / 24);
      pts.forEach(function (p) {
        var q = proj(p);
        ext.x = Math.max(ext.x, Math.abs(q[0]));
        ext.y0 = Math.min(ext.y0, q[1]);
        ext.y1 = Math.max(ext.y1, q[1]);
      });
    }
  })();

  var W = 0, H = 0, dpr = 1, S = 1, CX = 0, CY = 0, RECUL = .9, ASSISE = 3;   // ASSISE : la maison pose à trois pixels du filet
  function taille() {
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    S = RECUL * Math.min(W / (2 * ext.x), H / (ext.y1 - ext.y0));
    // Calée en bas plutôt que centrée : le terrain se pose sur le filet d'or,
    // et le jeu restant passe au-dessus du toit, là où il fait respirer.
    CX = W / 2; CY = H - ASSISE - S * ext.y1;
  }
  function ecran(p) { var q = proj(p); return [CX + S * q[0], CY + S * q[1]]; }

  /* ------------------------------------------------------------ couleurs */

  var ALPHA = { "": .62, f: .22, v: .5, vf: .16 };
  var COUL = null;

  function lisTheme() {
    var s = getComputedStyle(document.documentElement);
    function v(nom, defaut) { return (s.getPropertyValue(nom) || defaut).trim(); }
    var encre = v("--encre", "236,232,224"), verre = v("--verre-rvb", "170,192,214");
    COUL = {
      fond: v("--noir", "#050505"),
      or: v("--or", "#D6A85C"),
      verre: verre,
      trait: { "": encre, f: encre, v: verre, vf: verre }
    };
  }
  lisTheme();
  if (global.MutationObserver) {
    new MutationObserver(lisTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* -------------------------------------------------------------- dessin */

  function polygone(pts) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var e = ecran(pts[i]);
      i ? ctx.lineTo(e[0], e[1]) : ctx.moveTo(e[0], e[1]);
    }
    ctx.closePath();
  }

  function dessiner(T, th) {
    camera(th);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.lineCap = "butt"; ctx.lineJoin = "miter";

    // Faces tournées vers l'œil, de la plus lointaine à la plus proche
    var vis = [];
    for (var k = 0; k < faces.length; k++) {
      var f = faces[k];
      if (f.plan === "v" && f.n[0] * (cam.eye[0] - f.c[0]) + f.n[2] * (cam.eye[2] - f.c[2]) <= 0) continue;
      f.z = (f.c[0] - cam.eye[0]) * cam.fw[0] + (f.c[2] - cam.eye[2]) * cam.fw[2];
      vis.push(f);
    }
    vis.sort(function (a, b) { return ((b.rang || 0) - (a.rang || 0)) || (b.z - a.z); });

    for (var m = 0; m < vis.length; m++) {
      var fa = vis[m];
      var lam = fa.plan === "h" ? .5 : Math.max(0, fa.n[0] * LUM[0] + fa.n[2] * LUM[2]);
      var eclat = .72 + .4 * lam;

      // L'eau s'éclaire une fois la maison montée
      if (fa.nappe) {
        var plein = ease(clamp((T - finConstruction + 1.4) / 2.6));
        if (plein > .01) {
          polygone(fa.quad);
          ctx.fillStyle = "rgba(" + COUL.verre + "," + (.17 * plein).toFixed(3) + ")";
          ctx.fill();
        }
      }

      // L'aplat du fond masque ce qui passe derrière — sauf la dalle et l'eau,
      // qui laissent voir le filet d'or de l'en-tête.
      if (!fa.transparent) {
        if (fa.plan === "h") polygone(fa.quad);
        else polygone([fa.P(0, fa.bas), fa.P(fa.lon, fa.bas), fa.P(fa.lon, fa.haut), fa.P(0, fa.haut)]);
        var pose = ease(clamp((T - retard(fa.c[0], fa.plan === "h" ? fa.y : fa.bas)) / 1.2));
        if (pose > .02) {
          ctx.globalAlpha = pose;
          ctx.fillStyle = COUL.fond; ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      for (var qi = 0; qi < fa.vitres.length; qi++) {
        var q = fa.vitres[qi];
        var al = clamp((T - q.d) / q.t) * q.cur;
        if (al < .01) continue;
        polygone(q.p);
        ctx.globalAlpha = al * (.8 + .25 * lam);
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

  /* ------------------------ construction, puis balancement lent ---
     Le dessin s'interrompt quand la maison sort de l'écran ou que l'onglet
     passe au second plan : le planning ne partage pas le processeur pour rien. */

  var PERIODE = 54, DEBUT_MVT = finConstruction - 1.2;
  var T = 0, th = 0, prochaine = DEBUT_MVT + 1, dernier = 0, anim = null, visible = true;

  function frame(now) {
    anim = null;
    var dt = dernier ? Math.min(.05, (now - dernier) / 1000) : 0;
    dernier = now;
    T += dt;

    // Va-et-vient : la maison a une face, on la regarde de trois quarts, d'un
    // bord puis de l'autre. Sinus : les extrêmes sont des ralentis, pas des chocs.
    var avance = ease(clamp((T - DEBUT_MVT) / 5));
    th = AMPLI * avance * Math.sin((T - DEBUT_MVT) / PERIODE * Math.PI * 2);

    // Une fois la maison debout, une pièce s'allume ou s'éteint de temps en temps
    if (T > prochaine) {
      prochaine = T + 1.1;
      var q = vitres[Math.floor(Math.random() * vitres.length)];
      q.o = q.o > .25 ? .02 + Math.random() * .04 : .3 + Math.random() * .34;
    }
    for (var i = 0; i < vitres.length; i++) {
      var v = vitres[i], d = v.o - v.cur, pas = dt / 2.6;
      v.cur = Math.abs(d) <= pas ? v.o : v.cur + (d > 0 ? pas : -pas);
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
