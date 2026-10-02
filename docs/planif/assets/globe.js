/* Globe filaire de l'accueil — décor.
   ---------------------------------------------------------------------------
   À la place du ruban spectral sur la page d'accueil (02.10.2026, demande de
   Tony) : un globe en fil de fer qui tourne sur lui-même, dans l'esprit des
   structures filaires du site.

   Ce qui le compose :
     - des méridiens et des parallèles, projetés à plat (projection
       orthographique) après une rotation autour de l'axe des pôles, puis une
       inclinaison de l'axe vers l'observateur ;
     - la face cachée reste visible, en très pâle : c'est ce qui donne le
       volume d'un fil de fer, sans aucun remplissage ;
     - le contour (le limbe), un anneau incliné qui passe derrière le globe,
       un point qui en fait le tour, et Genève qui palpite quand elle passe
       devant.
   Couleur : l'accent du thème (or sur le sombre, bronze sur le clair), lue
   dans --or. Sur fond sombre, les traits s'additionnent (« lighter »).

   La souris l'anime : au survol de l'en-tête, il accélère en douceur, puis
   reprend son pas. Le canvas reste transparent aux clics.

   Le dessin s'arrête hors écran ou onglet caché. Il tourne même quand le
   système demande de réduire les animations : choix de Tony.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  function lance(cv) {
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  var TAU = Math.PI * 2, RAD = Math.PI / 180;
  var MERIDIENS = 18;                 // un tous les 20°
  var PARALLELES = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
  var PAS = 64;                       // points par ligne
  var INCLINAISON = 23.4 * RAD;       // l'axe penche comme celui de la Terre
  var TOUR = 48;                      // secondes par tour, au repos
  var GENEVE = { lat: 46.2 * RAD, lon: 6.15 * RAD };

  /* ------------------------------------------------------------ cadre */

  var W = 0, H = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  function taille() {
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    dpr = Math.max(1, Math.min(global.devicePixelRatio || 1, 2));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    R = Math.max(10, Math.min(H * .38, W * .3));   // l'anneau incliné monte à 1,22 R : il tient en hauteur
    cx = W - R * 1.55;                // l'anneau doit tenir dans le cadre, à droite
    cy = H * .5;
  }

  /* --------------------------------------------------------- couleurs */

  var CLAIR = false, OR = [214, 168, 92];
  function rvb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }
  function lisTheme() {
    var st = getComputedStyle(document.documentElement);
    var fond = rvb((st.getPropertyValue("--noir") || "#050505").trim());
    CLAIR = fond ? (fond[0] * .299 + fond[1] * .587 + fond[2] * .114) / 255 > .5 : false;
    OR = rvb((st.getPropertyValue("--or") || "#D6A85C").trim()) || OR;
  }
  lisTheme();
  if (global.MutationObserver) {
    new MutationObserver(lisTheme).observe(document.documentElement,
      { attributes: true, attributeFilter: ["data-theme"] });
  }
  function couleur(a) { return "rgba(" + OR[0] + "," + OR[1] + "," + OR[2] + "," + a.toFixed(3) + ")"; }

  /* ------------------------------------------------------ projection
     Un point (latitude, longitude) de la sphère unité : rotation autour de
     l'axe des pôles (le globe tourne), puis inclinaison de l'axe. On garde
     x, y à l'écran et z, la profondeur (z > 0 : face visible). */
  var cosI = Math.cos(INCLINAISON), sinI = Math.sin(INCLINAISON);
  var P = { x: 0, y: 0, z: 0 };
  function projette(lat, lon, rot) {
    var cl = Math.cos(lat), l = lon + rot;
    var x = cl * Math.sin(l), y = Math.sin(lat), z = cl * Math.cos(l);
    // inclinaison autour de l'axe horizontal de l'écran
    var y2 = y * cosI - z * sinI, z2 = y * sinI + z * cosI;
    P.x = cx + R * x; P.y = cy - R * y2; P.z = z2;
    return P;
  }

  /* Une ligne de la sphère, tracée en deux passes : la face visible d'un
     trait franc, la face cachée en filigrane. Chaque segment est rangé selon
     la profondeur de son milieu. */
  var avant = [], arriere = [];
  function ligne(points) {
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      ((a[2] + b[2]) / 2 >= 0 ? avant : arriere).push(a[0], a[1], b[0], b[1]);
    }
  }
  function trace(segments, alpha, largeur) {
    if (!segments.length) return;
    ctx.beginPath();
    for (var i = 0; i < segments.length; i += 4) {
      ctx.moveTo(segments[i], segments[i + 1]);
      ctx.lineTo(segments[i + 2], segments[i + 3]);
    }
    ctx.lineWidth = largeur;
    ctx.strokeStyle = couleur(alpha);
    ctx.stroke();
  }

  /* ------------------------------------------------------------ dessin */

  function dessiner(T) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    if (!R) return;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalCompositeOperation = CLAIR ? "source-over" : "lighter";

    var rot = TAU * T / TOUR;                       // d'ouest en est : la face visible défile vers la droite
    var lueur = 1 + .35 * excite;
    avant.length = 0; arriere.length = 0;
    var i, k, p, pts;

    for (k = 0; k < MERIDIENS; k++) {
      var lon = k * TAU / MERIDIENS;
      pts = [];
      for (i = 0; i <= PAS / 2; i++) {
        p = projette(-Math.PI / 2 + Math.PI * i / (PAS / 2), lon, rot);
        pts.push([p.x, p.y, p.z]);
      }
      ligne(pts);
    }
    PARALLELES.forEach(function (d) {
      var lat = d * RAD;
      pts = [];
      for (i = 0; i <= PAS; i++) {
        p = projette(lat, i * TAU / PAS, rot);
        pts.push([p.x, p.y, p.z]);
      }
      ligne(pts);
    });

    var fortAvant = (CLAIR ? .55 : .42) * lueur, fortArriere = CLAIR ? .12 : .09;
    trace(arriere, fortArriere, .8);
    if (!CLAIR) trace(avant, .05 * lueur, 3);      // halo
    trace(avant, fortAvant, CLAIR ? .9 : 1);

    // L'équateur, un cran plus marqué
    avant.length = 0; arriere.length = 0;
    pts = [];
    for (i = 0; i <= PAS; i++) { p = projette(0, i * TAU / PAS, rot); pts.push([p.x, p.y, p.z]); }
    ligne(pts);
    trace(avant, Math.min(1, fortAvant * 1.5), 1.2);

    // Le contour : toujours net, c'est lui qui fait la sphère
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = couleur((CLAIR ? .5 : .45) * lueur);
    ctx.stroke();

    anneau(T);
    geneve(rot, T);
    ctx.globalCompositeOperation = "source-over";
  }

  /* Un anneau incliné autour du globe, et un point qui en fait le tour.
     Derrière la sphère, l'anneau s'efface : il passe vraiment derrière. */
  function anneau(T) {
    var rA = R * 1.34, inc = 62 * RAD, ci = Math.cos(inc), si = Math.sin(inc);
    var tourne = .35 * Math.sin(T * .05);           // l'anneau oscille à peine sur lui-même
    var ct = Math.cos(tourne), st = Math.sin(tourne);
    function point(a) {
      var x = Math.cos(a), z = Math.sin(a), y = 0;
      var y2 = y * ci - z * si, z2 = y * si + z * ci;   // inclinaison
      var x3 = x * ct - y2 * st, y3 = x * st + y2 * ct; // légère rotation dans le plan de l'écran
      return [cx + rA * x3, cy - rA * y3, z2];
    }
    var n = 120, prec = point(0);
    avant.length = 0; arriere.length = 0;
    for (var i = 1; i <= n; i++) {
      var p = point(i * TAU / n);
      var mz = (prec[2] + p[2]) / 2, mx = (prec[0] + p[0]) / 2 - cx, my = (prec[1] + p[1]) / 2 - cy;
      (mz < 0 && mx * mx + my * my < R * R ? arriere : avant).push(prec[0], prec[1], p[0], p[1]);
      prec = p;
    }
    trace(arriere, CLAIR ? .06 : .04, .9);
    trace(avant, (CLAIR ? .32 : .26) * (1 + .3 * excite), .9);
    // Le satellite
    var s = point(T * TAU / 17);
    var dx = s[0] - cx, dy = s[1] - cy;
    if (!(s[2] < 0 && dx * dx + dy * dy < R * R)) {
      ctx.beginPath(); ctx.arc(s[0], s[1], 2.4, 0, TAU);
      ctx.fillStyle = couleur(CLAIR ? .9 : .85); ctx.fill();
      ctx.beginPath(); ctx.arc(s[0], s[1], 6, 0, TAU);
      ctx.fillStyle = couleur(CLAIR ? .12 : .1); ctx.fill();
    }
  }

  /* Genève : un point qui palpite quand il passe sur la face visible. */
  function geneve(rot, T) {
    var p = projette(GENEVE.lat, GENEVE.lon, rot);
    if (p.z <= 0) return;
    var vis = Math.min(1, p.z * 3);                  // fondu au passage du bord
    var onde = ((T * .7) % 1 + 1) % 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, TAU);
    ctx.fillStyle = couleur(.95 * vis); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 + onde * 11, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = couleur((1 - onde) * .6 * vis); ctx.stroke();
  }

  /* ------------------------------------------------------------ temps
     Le temps n'avance que pendant qu'on regarde : au retour sur l'onglet, le
     globe reprend là où on l'a laissé. */

  var T = 0, dernier = 0, anim = null, visible = true;
  var cible = 0, excite = 0;
  var zone = cv.closest(".entete") || cv;
  document.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;
    var r = zone.getBoundingClientRect();
    cible = (r.width > 0 && e.clientX >= r.left && e.clientX <= r.right &&
             e.clientY >= r.top && e.clientY <= r.bottom) ? 1 : 0;
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", function () { cible = 0; });
  global.addEventListener("blur", function () { cible = 0; });

  function frame(now) {
    anim = null;
    var dt = dernier ? Math.min(.05, (now - dernier) / 1000) : 0;
    dernier = now;
    excite += (cible - excite) * (1 - Math.exp(-dt / (cible > excite ? .6 : 1.8)));
    T += dt * (1 + 2.2 * excite);                   // au survol, le globe s'emballe un peu
    dessiner(T);
    relance();
  }
  function relance() {
    if (anim === null && visible && !document.hidden) anim = requestAnimationFrame(frame);
  }
  function reprend() { dernier = 0; relance(); }

  global.addEventListener("resize", function () { taille(); dessiner(T); reprend(); });
  document.addEventListener("visibilitychange", reprend);
  if (global.IntersectionObserver) {
    new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting;
      if (visible) reprend();
    }, { rootMargin: "120px" }).observe(cv);
  }

  taille();
  T = -10;                                         // Genève entre par la gauche de la face visible
  relance();
  }

  /* Le décor de l'accueil pour tous les bureaux, sauf celui qui a son logo
     (logo-ab.js) : l'accueil choisit (decorDuBureau). */
  global.Decor = global.Decor || {};
  global.Decor.globe = lance;
})(window);
