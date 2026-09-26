/* Villa filaire du tableau de bord — décor.
   ---------------------------------------------------------------------------
   À la place de la tour (26.09.2026), qui imposait 300 px de haut à l'en-tête :
   une villa basse et large, posée sur le filet d'or qui lui sert de sol.

   Le sujet : une maison à toit plat, deux ailes d'un niveau qui s'avancent, un
   étage en porte-à-faux au-dessus de la terrasse, porté par deux poteaux
   grêles ; une pergola à chevrons sur l'aile gauche, des cyprès de part et
   d'autre, et devant, un bassin qui reflète tout ça.

   Le reflet n'est pas un effet : c'est la même géométrie projetée avec les
   hauteurs inversées. Un miroir plan à y = 0, vu en perspective, donne
   exactement ça — il suffit de découper au bassin et d'onduler la surface.

   Trois passes par image : le lointain (sol, haie, arbres, ombres portées), la
   maison (faces triées du fond vers l'avant, chacune masquée par un aplat du
   fond), puis l'eau (nappe, reflet, rides). Les couleurs viennent du thème.
   Le dessin s'arrête dès que le décor sort de l'écran ou que l'onglet passe au
   second plan, et « mouvement réduit » fige la scène sur son dernier état.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var cv = document.getElementById("villa");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");
  var SOBRE = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function norm(v) { var n = Math.hypot(v[0], v[2]) || 1; return [v[0] / n, 0, v[2] / n]; }
  var graine = 11;
  function rnd() { var x = Math.sin(graine++ * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ------------------------------------------------------------ styles ---
     Une épaisseur et une densité par nature de trait : c'est ce qui sépare un
     dessin d'un grillage. L'ossature tient l'image, les meneaux la texturent
     sans jamais lui disputer la vedette. */

  var STYLE = {
    s: { a: .92, w: 1.15, c: "encre" },  // ossature, arêtes, acrotères
    x: { a: .62, w: .85, c: "encre" },   // poteaux, chevrons, garde-corps
    m: { a: .34, w: .55, c: "verre" },   // meneaux, nez de dalle
    g: { a: .24, w: .70, c: "encre" },   // terrasse, bassin, dallage
    a: { a: .44, w: .80, c: "verre" }    // végétal
  };
  var ORDRE = ["g", "m", "x", "s", "a"];

  /* ------------------------------------------------------- la géométrie ---
     Mètres. x vers la droite, y vers le haut, z vers le fond : la façade
     principale regarde les z négatifs, c'est de ce côté que sont la terrasse,
     le bassin et la lumière. */

  var NIV = 3.6;
  var faces = [], vitres = [], decor = [], arbres = [], ombres = [], pts = [], finConstruction = 0;

  /** Délai d'apparition : ça monte du sol, et ça va de la gauche vers la droite. */
  function retard(x, y) { return .3 + x * .014 + y * .095; }
  function jalon(d) { if (d > finConstruction) finConstruction = d; }

  function Face(O, a, n, lon, bas, haut) {
    var f = {
      O: O, a: a, n: n, lon: lon, bas: bas, haut: haut, lignes: [], vitres: [], plan: "v",
      P: function (s, t) { return [O[0] + a[0] * s, t, O[2] + a[2] * s]; }
    };
    f.c = [O[0] + a[0] * lon / 2, (bas + haut) / 2, O[2] + a[2] * lon / 2];
    f.quad = [f.P(0, bas), f.P(lon, bas), f.P(lon, haut), f.P(0, haut)];
    faces.push(f); pts.push.apply(pts, f.quad);
    return f;
  }
  function Toit(x0, z0, x1, z1, y) {
    var f = {
      plan: "h", y: y, lignes: [], vitres: [],
      quad: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]],
      c: [(x0 + x1) / 2, y, (z0 + z1) / 2]
    };
    faces.push(f); pts.push.apply(pts, f.quad);
    return f;
  }

  function L(f, s0, t0, s1, t1, cls, d, t) {
    f.lignes.push({ a: f.P(s0, t0), b: f.P(s1, t1), c: cls, d: d, t: t }); jalon(d + t);
  }
  /** Trait libre, en coordonnées absolues : toitures, sol, poteaux, chevrons. */
  function LH(f, a, b, cls, d, t) {
    f.lignes.push({ a: a, b: b, c: cls, d: d, t: t }); jalon(d + t); pts.push(a, b);
  }
  function vitre(f, s0, s1, t0, t1, o, d) {
    var q = { p: [f.P(s0, t0), f.P(s1, t0), f.P(s1, t1), f.P(s0, t1)], o: o, cur: 0, d: d, t: 1.2 };
    f.vitres.push(q); vitres.push(q); jalon(d + q.t);
  }

  /**
   * Façade vitrée : meneaux réguliers, nez de dalle à chaque niveau, vitrages
   * allumés par travée. `pleine` ouvre toutes les travées — les grandes baies
   * du rez ; sinon deux tiers environ, pour que la façade respire.
   */
  function facade(f, pleine) {
    var pas = 1.7, nm = Math.max(2, Math.round(f.lon / pas)), mw = f.lon / nm;
    var etages = Math.max(1, Math.round((f.haut - f.bas) / NIV)), k, j, e, b;

    for (k = 0; k <= nm; k++) {
      L(f, k * mw, f.bas, k * mw, f.haut, (k === 0 || k === nm) ? "s" : "m",
        retard(f.O[0] + f.a[0] * k * mw, f.bas) + .1, .85);
    }
    for (j = 0; j <= etages; j++) {
      var t = f.bas + j * (f.haut - f.bas) / etages;
      L(f, 0, t, f.lon, t, (j === 0 || j === etages) ? "s" : "m", retard(f.c[0], t) + .2, .95);
    }
    for (e = 0; e < etages; e++) {
      var y0 = f.bas + e * (f.haut - f.bas) / etages, y1 = f.bas + (e + 1) * (f.haut - f.bas) / etages;
      for (b = 0; b < nm; b++) {
        if (!pleine && rnd() < .32) continue;
        var vif = rnd();
        vitre(f, b * mw + .16, (b + 1) * mw - .16, y0 + .3, y1 - .42,
              vif < .5 ? .34 + rnd() * .36 : .02 + rnd() * .05,
              retard(f.O[0] + f.a[0] * (b + .5) * mw, y0) + 1.2 + rnd() * 1.1);
      }
    }
  }

  /** Un volume à toit plat : quatre façades, une toiture, un acrotère. */
  function volume(x0, z0, x1, z1, bas, haut, avant) {
    var lx = x1 - x0, lz = z1 - z0, ACR = .32;
    facade(Face([x0, 0, z0], [1, 0, 0], [0, 0, -1], lx, bas, haut), avant);
    facade(Face([x1, 0, z0], [0, 0, 1], [1, 0, 0], lz, bas, haut), false);
    facade(Face([x1, 0, z1], [-1, 0, 0], [0, 0, 1], lx, bas, haut), false);
    facade(Face([x0, 0, z1], [0, 0, -1], [-1, 0, 0], lz, bas, haut), false);

    var t = Toit(x0, z0, x1, z1, haut), d = retard((x0 + x1) / 2, haut) + .45;
    [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]].forEach(function (c, i) {
      LH(t, [c[0], haut + ACR, c[1]], [c[2], haut + ACR, c[3]], "s", d + i * .05, .75);
      LH(t, [c[0], haut, c[1]], [c[0], haut + ACR, c[1]], "m", d + i * .05, .35);
    });
    ombres.push({ q: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], h: haut, d: d });
    return t;
  }

  var H1 = 3.6, H2 = 7.4;
  volume(0, -2, 11, 8, 0, H1, true);             // aile gauche
  volume(11, 0, 25, 8, 0, H1, true);             // corps, rez en retrait
  volume(10.5, -2.5, 25.5, 8.5, H1, H2, true);   // étage en porte-à-faux
  volume(25, -2, 36, 8, 0, H1, true);            // aile droite

  /* Ce qui tient le porte-à-faux et ce qui abrite la terrasse. Deux poteaux
     grêles plutôt qu'un mur : c'est là que la maison prend son air de flotter. */
  var greement = Toit(0, -7, 36, -2, H1);
  greement.transparent = true;
  [13, 23].forEach(function (x, i) {
    var d = 2.1 + i * .2;
    LH(greement, [x, 0, -2.2], [x, H1, -2.2], "x", d, .7);
    LH(greement, [x + .26, 0, -2.2], [x + .26, H1, -2.2], "x", d + .05, .7);
    LH(greement, [x, 0, -2.2], [x + .26, 0, -2.2], "x", d + .3, .2);
  });
  (function pergola() {
    var z0 = -2, z1 = -6.6, y = H1, d0 = 2.3, x;
    LH(greement, [0, y, z1], [11, y, z1], "x", d0, .9);
    LH(greement, [0, y, z0], [0, y, z1], "x", d0 + .1, .5);
    LH(greement, [11, y, z0], [11, y, z1], "x", d0 + .1, .5);
    for (x = .9; x < 11; x += 1.1) LH(greement, [x, y, z0], [x, y, z1], "x", d0 + .25 + x * .035, .45);
    LH(greement, [.4, 0, z1], [.4, y, z1], "x", d0 + .2, .6);
    LH(greement, [10.6, 0, z1], [10.6, y, z1], "x", d0 + .3, .6);
  })();

  /* --------------------------------------------- terrasse, bassin, jardin */

  var TERRASSE = { x0: -5.5, x1: 41.5, z0: -14.8, z1: 9 };
  var BASSIN = { x0: 5, x1: 31, z0: -14, z1: -3.6 };

  var dalle = Toit(TERRASSE.x0, TERRASSE.z0, TERRASSE.x1, TERRASSE.z1, 0);
  dalle.transparent = true;
  faces.pop(); decor.push(dalle);          // le sol se dessine à part, avant la maison

  function contour(f, r, cls, d, t) {
    LH(f, [r.x0, 0, r.z0], [r.x1, 0, r.z0], cls, d, t);
    LH(f, [r.x1, 0, r.z0], [r.x1, 0, r.z1], cls, d + .1, t);
    LH(f, [r.x1, 0, r.z1], [r.x0, 0, r.z1], cls, d + .2, t);
    LH(f, [r.x0, 0, r.z1], [r.x0, 0, r.z0], cls, d + .3, t);
  }
  contour(dalle, TERRASSE, "g", .1, 1.6);
  contour(dalle, BASSIN, "s", .45, 1.5);
  contour(dalle, { x0: BASSIN.x0 + .5, x1: BASSIN.x1 - .5, z0: BASSIN.z0 + .5, z1: BASSIN.z1 - .5 }, "m", .75, 1.3);
  // Marches à l'angle du bassin, joints de dallage devant la maison
  for (var s = 0; s < 3; s++) {
    LH(dalle, [BASSIN.x0 + .8, 0, BASSIN.z1 - 1.1 - s * .55],
              [BASSIN.x0 + 4.2, 0, BASSIN.z1 - 1.1 - s * .55], "m", 1.5 + s * .12, .9);
  }
  for (var jx = 2; jx < 36; jx += 5.4) {
    LH(dalle, [jx, 0, -2.4], [jx, 0, BASSIN.z1 - .4], "g", .5 + jx * .012, 1);
  }
  // Haie de fond : la ligne d'horizon du jardin
  LH(dalle, [-13, 0, 9.4], [48, 0, 9.4], "g", .15, 1.8);
  for (var hx = -13; hx < 48; hx += 2.4) LH(dalle, [hx, 0, 9.4], [hx, .75, 9.4], "a", .6 + (hx + 13) * .012, .5);

  /* Cyprès et boules de buis : le vertical qui manque à une maison basse. */
  function arbre(x, z, h, larg, forme, d) {
    arbres.push({ p: [x, 0, z], h: h, w: larg, f: forme, d: d, t: 1.5 });
    pts.push([x - larg, 0, z], [x + larg, h, z]);
    jalon(d + 1.5);
  }
  arbre(-8.5, 5.5, 8.2, 1, "cypres", 1.9);
  arbre(-12, 7.2, 6.8, .85, "cypres", 2.15);
  arbre(43.5, 5, 7.8, .95, "cypres", 2.35);
  arbre(46.8, 7.4, 6.2, .8, "cypres", 2.55);
  arbre(-2.6, -5.5, 1.5, 1.2, "buis", 2.8);
  arbre(38.6, -6.2, 1.7, 1.35, "buis", 2.95);
  arbre(34.5, -9.8, 1.3, 1.05, "buis", 3.1);

  /* ---------------------------------------------------- caméra et cadrage */

  var CENTRE = [18, 0, -2], R = 58, EH = 11, AMPLI = .3;
  var PARAX = .06, PARAY = .25;     // ce que la souris peut pousser, en plus du balancement
  var LUM = norm([-.72, 0, -.69]);
  var cam = {}, biais = { th: 0, h: 0, cth: 0, ch: 0, vth: 0, vh: 0 };

  function camera(th, dh) {
    cam.eye = [CENTRE[0] + R * Math.sin(th), EH + dh, CENTRE[2] - R * Math.cos(th)];
    cam.fw = norm([CENTRE[0] - cam.eye[0], 0, CENTRE[2] - cam.eye[2]]);
    cam.rt = [cam.fw[2], 0, -cam.fw[0]];
  }
  function proj(p) {
    var dx = p[0] - cam.eye[0], dz = p[2] - cam.eye[2];
    var z = dx * cam.fw[0] + dz * cam.fw[2];
    if (z < 1) z = 1;
    return [(dx * cam.rt[0] + dz * cam.rt[2]) / z, -(p[1] - cam.eye[1]) / z, z];
  }

  // Cadrage tenu sur tout le balancement, rotation de la souris comprise : en
  // largeur elle ne coûte rien, c'est la hauteur de la bande qui commande la
  // taille. Le peu que la souris donne en hauteur tient dans ASSISE.
  var ext = { x: 0, y0: 1e9, y1: -1e9 };
  (function () {
    var bal = AMPLI + PARAX;
    for (var i = 0; i <= 24; i++) {
      camera(-bal + 2 * bal * i / 24, 0);
      for (var k = 0; k < pts.length; k++) {
        var q = proj(pts[k]);
        if (Math.abs(q[0]) > ext.x) ext.x = Math.abs(q[0]);
        if (q[1] < ext.y0) ext.y0 = q[1];
        if (q[1] > ext.y1) ext.y1 = q[1];
      }
    }
  })();

  var W = 0, H = 0, dpr = 1, S = 1, CX = 0, CY = 0, RECUL = .96, ASSISE = 3;
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
  function ecran(p) { var q = proj(p); return [CX + S * q[0], CY + S * q[1], q[2]]; }

  /* ------------------------------------------------------------ couleurs */

  var COUL = null, CLAIR = false;
  function lisTheme() {
    var st = getComputedStyle(document.documentElement);
    function v(nom, def) { return (st.getPropertyValue(nom) || def).trim(); }
    var fond = v("--noir", "#050505");
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fond);
    var lum = m ? (parseInt(m[1], 16) * .299 + parseInt(m[2], 16) * .587 + parseInt(m[3], 16) * .114) / 255 : 0;
    CLAIR = lum > .5;                    // fond clair : les ombres portées ont un sens
    COUL = {
      fond: fond, or: v("--or", "#D6A85C"),
      encre: v("--encre", "236,232,224"), verre: v("--verre-rvb", "170,192,214")
    };
  }
  lisTheme();
  if (global.MutationObserver) {
    new MutationObserver(lisTheme).observe(document.documentElement,
      { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* -------------------------------------------------------------- dessin */

  var LOIN = 0, PRES = 0;                 // bornes de profondeur, pour l'estompe
  function estompe(z) { return PRES === LOIN ? 1 : 1 - .22 * clamp((LOIN - z) / (LOIN - PRES)); }
  function trait(cls, alpha) {
    var st = STYLE[cls];
    ctx.strokeStyle = "rgba(" + COUL[st.c] + "," + Math.min(1, st.a * alpha).toFixed(3) + ")";
    ctx.lineWidth = st.w;
  }
  function chemin(q, f) {
    ctx.beginPath();
    for (var i = 0; i < q.length; i++) {
      var e = (f || ecran)(q[i]);
      i ? ctx.lineTo(e[0], e[1]) : ctx.moveTo(e[0], e[1]);
    }
    ctx.closePath();
  }
  /** Les traits d'une face, par nature, chacun à son avancement. */
  function lignes(f, T, alpha, fct) {
    var vers = fct || ecran;
    for (var o = 0; o < ORDRE.length; o++) {
      var cls = ORDRE[o], n = 0;
      ctx.beginPath();
      for (var i = 0; i < f.lignes.length; i++) {
        var l = f.lignes[i];
        if (l.c !== cls) continue;
        var p = ease(clamp((T - l.d) / l.t));
        if (p <= 0) continue;
        var b = [l.a[0] + (l.b[0] - l.a[0]) * p, l.a[1] + (l.b[1] - l.a[1]) * p, l.a[2] + (l.b[2] - l.a[2]) * p];
        var e0 = vers(l.a), e1 = vers(b);
        ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); n++;
      }
      if (n) { trait(cls, alpha); ctx.stroke(); }
    }
  }

  /** Cyprès et buis : une silhouette en deux courbes, plus quelques nervures. */
  function vegetal(a, T) {
    var p = ease(clamp((T - a.d) / a.t));
    if (p <= .01) return;
    var bas = ecran(a.p), haut = ecran([a.p[0], a.h * p, a.p[2]]);
    var w = S * a.w * p / bas[2], hy = bas[1] - haut[1];
    if (hy < 1) return;
    trait("a", estompe(bas[2]));
    ctx.beginPath();
    if (a.f === "cypres") {
      // Large au tiers de sa hauteur, effilé vers la pointe, fermé au sol
      ctx.moveTo(bas[0] - w * .4, bas[1]);
      ctx.bezierCurveTo(bas[0] - w, bas[1] - hy * .38, bas[0] - w * .58, bas[1] - hy * .84, haut[0], haut[1]);
      ctx.bezierCurveTo(bas[0] + w * .58, bas[1] - hy * .84, bas[0] + w, bas[1] - hy * .38, bas[0] + w * .4, bas[1]);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath();                          // deux touffes, pour la matière
      for (var k = 1; k <= 2; k++) {
        var y = bas[1] - hy * (.22 + k * .22);
        ctx.moveTo(bas[0] - w * .34, y); ctx.quadraticCurveTo(bas[0], y + hy * .07, bas[0] + w * .34, y);
      }
      ctx.globalAlpha = .5; ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      ctx.moveTo(bas[0] - w, bas[1]);
      ctx.bezierCurveTo(bas[0] - w, bas[1] - hy * 1.6, bas[0] + w, bas[1] - hy * 1.6, bas[0] + w, bas[1]);
      ctx.closePath(); ctx.stroke();
    }
  }

  /**
   * La lumière qui sort des baies et se pose sur la terrasse. Deux nappes
   * dégressives plutôt qu'un dégradé : à cette taille, personne ne voit la
   * différence, et c'est deux fois moins de travail par image.
   */
  function lueur(T) {
    for (var i = 0; i < faces.length; i++) {
      var f = faces[i];
      if (f.plan !== "v" || f.n[2] > -.5) continue;
      for (var vi = 0; vi < f.vitres.length; vi++) {
        var v = f.vitres[vi], al = clamp((T - v.d) / v.t) * v.cur;
        if (al < .12) continue;
        var g = v.p[0], d = v.p[1];
        for (var e = 0; e < 2; e++) {
          var l0 = e * 2.2, l1 = l0 + 2.2, o0 = l0 * .18, o1 = l1 * .18;
          chemin([[g[0] - o0, 0, g[2] - l0], [d[0] + o0, 0, d[2] - l0],
                  [d[0] + o1, 0, d[2] - l1], [g[0] - o1, 0, g[2] - l1]]);
          ctx.globalAlpha = (e ? .022 : .045) * al;
          ctx.fillStyle = COUL.or; ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Ombres portées : seulement sur fond clair, où elles posent les volumes. */
  function ombre(o, T) {
    var p = ease(clamp((T - o.d) / 1.4));
    if (p <= .02) return;
    var dx = -LUM[0] * o.h * .85, dz = -LUM[2] * o.h * .85;
    chemin([[o.q[0][0] + dx, 0, o.q[0][2] + dz], [o.q[1][0] + dx, 0, o.q[1][2] + dz],
            [o.q[2][0] + dx, 0, o.q[2][2] + dz], [o.q[3][0] + dx, 0, o.q[3][2] + dz]]);
    ctx.fillStyle = "rgba(" + COUL.encre + "," + (.055 * p).toFixed(3) + ")";
    ctx.fill();
  }

  /** L'eau : la nappe, le reflet de la maison tête en bas, les rides. */
  function bassin(T) {
    var plein = ease(clamp((T - finConstruction + 1.8) / 2.4));
    if (plein <= .01) return;
    var q = [[BASSIN.x0, 0, BASSIN.z0], [BASSIN.x1, 0, BASSIN.z0],
             [BASSIN.x1, 0, BASSIN.z1], [BASSIN.x0, 0, BASSIN.z1]];
    chemin(q);
    ctx.save(); ctx.clip();
    ctx.fillStyle = "rgba(" + COUL.verre + "," + (.11 * plein).toFixed(3) + ")";
    ctx.fill();

    // Miroir : la même géométrie, hauteurs inversées, surface qui ondule
    var ride = SOBRE ? 0 : 1;
    function mir(p) {
      var e = ecran([p[0], -p[1], p[2]]);
      e[0] += ride * (.9 * Math.sin(e[1] * .5 + T * 1.5) + .45 * Math.sin(e[1] * 1.4 - T * 2.3));
      return e;
    }
    var base = .82 * plein, i, vi;
    ctx.globalAlpha = base;
    for (i = 0; i < faces.length; i++) {
      var f = faces[i];
      if (f.plan === "v" && f.n[0] * (cam.eye[0] - f.c[0]) + f.n[2] * (cam.eye[2] - f.c[2]) <= 0) continue;
      lignes(f, T, .9, mir);
      for (vi = 0; vi < f.vitres.length; vi++) {
        var v = f.vitres[vi], al = clamp((T - v.d) / v.t) * v.cur;
        if (al < .02) continue;
        chemin(v.p, mir);
        ctx.fillStyle = COUL.or; ctx.globalAlpha = base * al * .85; ctx.fill();
        ctx.globalAlpha = base;
      }
    }
    ctx.globalAlpha = 1;

    // Le reflet s'efface vers le bord proche, comme sur l'eau
    var e0 = ecran([BASSIN.x0, 0, BASSIN.z1]), e1 = ecran([BASSIN.x0, 0, BASSIN.z0]);
    var g = ctx.createLinearGradient(0, e0[1], 0, e1[1]);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(.45, "rgba(0,0,0,0)");
    g.addColorStop(1, COUL.fond);
    ctx.globalAlpha = .8; ctx.fillStyle = g; chemin(q); ctx.fill(); ctx.globalAlpha = 1;

    // Rides : trois traits qui glissent lentement en travers du bassin
    if (!SOBRE) {
      trait("m", 1); ctx.globalAlpha = .5;
      for (var r = 0; r < 3; r++) {
        var z = BASSIN.z1 - (BASSIN.z1 - BASSIN.z0) * ((T * .055 + r * .34) % 1);
        ctx.beginPath();
        for (var x = BASSIN.x0 + 1; x <= BASSIN.x1 - 1; x += 2) {
          var e = ecran([x, 0, z + .35 * Math.sin(x * .55 + T * 1.1)]);
          x === BASSIN.x0 + 1 ? ctx.moveTo(e[0], e[1]) : ctx.lineTo(e[0], e[1]);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function dessiner(T, th, dh) {
    camera(th, dh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "butt"; ctx.lineJoin = "miter";

    var i, f, vi, vis = [];
    LOIN = -1e9; PRES = 1e9;
    for (i = 0; i < faces.length; i++) {
      f = faces[i];
      if (f.plan === "v" && f.n[0] * (cam.eye[0] - f.c[0]) + f.n[2] * (cam.eye[2] - f.c[2]) <= 0) continue;
      f.z = (f.c[0] - cam.eye[0]) * cam.fw[0] + (f.c[2] - cam.eye[2]) * cam.fw[2];
      if (f.z > LOIN) LOIN = f.z;
      if (f.z < PRES) PRES = f.z;
      vis.push(f);
    }
    vis.sort(function (a, b) { return b.z - a.z; });

    /* 1. le lointain : sol, haie, ombres portées, végétal */
    for (i = 0; i < decor.length; i++) lignes(decor[i], T, 1);
    if (CLAIR) for (i = 0; i < ombres.length; i++) ombre(ombres[i], T);
    for (i = 0; i < arbres.length; i++) vegetal(arbres[i], T);

    /* 2. la maison, du fond vers l'avant */
    for (i = 0; i < vis.length; i++) {
      f = vis[i];
      var lam = f.plan === "h" ? .5 : Math.max(0, f.n[0] * LUM[0] + f.n[2] * LUM[2]);
      var alpha = (.74 + .38 * lam) * estompe(f.z);

      if (!f.transparent) {
        var pose = ease(clamp((T - retard(f.c[0], f.plan === "h" ? f.y : f.bas)) / 1.1));
        if (pose > .02) {
          chemin(f.quad);
          ctx.globalAlpha = pose; ctx.fillStyle = COUL.fond; ctx.fill(); ctx.globalAlpha = 1;
        }
      }
      for (vi = 0; vi < f.vitres.length; vi++) {
        var v = f.vitres[vi], al = clamp((T - v.d) / v.t) * v.cur;
        if (al < .01) continue;
        chemin(v.p);
        ctx.globalAlpha = al * (.78 + .26 * lam);
        ctx.fillStyle = COUL.or;
        if (v.cur > .3) { ctx.shadowColor = COUL.or; ctx.shadowBlur = 5 * v.cur; }
        ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      lignes(f, T, alpha);
    }

    /* 3. ce que les baies posent sur la terrasse, puis l'eau par-dessus */
    lueur(T);
    bassin(T);
  }

  /* ---------------------------------- construction, balancement, souris ---
     Le dessin s'interrompt quand le décor sort de l'écran ou que l'onglet
     passe au second plan : le planning ne partage pas le processeur pour rien. */

  var PERIODE = 58, DEBUT_MVT = finConstruction - 1.4;
  var T = 0, prochaine = DEBUT_MVT + 1.5, dernier = 0, anim = null, visible = true;

  function frame(now) {
    anim = null;
    var dt = dernier ? Math.min(.05, (now - dernier) / 1000) : 0;
    dernier = now; T += dt;

    // Va-et-vient : la maison a une face, on la regarde de trois quarts d'un
    // bord puis de l'autre. Sinus : les extrêmes sont des ralentis, pas des chocs.
    var lance = ease(clamp((T - DEBUT_MVT) / 6));
    var th = AMPLI * lance * Math.sin((T - DEBUT_MVT) / PERIODE * Math.PI * 2);

    // La souris pousse doucement le point de vue, sans jamais le reprendre en main
    biais.vth = biais.vth * .86 + (biais.cth - biais.th) * .12; biais.th += biais.vth;
    biais.vh = biais.vh * .86 + (biais.ch - biais.h) * .12; biais.h += biais.vh;

    if (T > prochaine) {                  // une pièce s'allume, une autre s'éteint
      prochaine = T + 1.2;
      var q = vitres[Math.floor(Math.random() * vitres.length)];
      q.o = q.o > .25 ? .02 + Math.random() * .05 : .34 + Math.random() * .36;
    }
    for (var i = 0; i < vitres.length; i++) {
      var v = vitres[i], ec = v.o - v.cur, pas = dt / 2.4;
      v.cur = Math.abs(ec) <= pas ? v.o : v.cur + (ec > 0 ? pas : -pas);
    }

    dessiner(T, th + biais.th, biais.h);
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
  if (!SOBRE) {
    global.addEventListener("mousemove", function (e) {
      var w = global.innerWidth || 1, h = global.innerHeight || 1;
      biais.cth = (e.clientX / w - .5) * 2 * PARAX;
      biais.ch = (.5 - e.clientY / h) * 2 * PARAY;
    }, { passive: true });
  }

  taille();
  if (SOBRE) { dessiner(finConstruction + 8, 0, 0); }   // mouvement réduit : une image, la scène finie
  else relance();
})(window);
