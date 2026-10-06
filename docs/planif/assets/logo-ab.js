/* Logo du bureau en volume — décor de l'accueil (02.10.2026, redessiné le 05.10.2026).
   ---------------------------------------------------------------------------
   Demande de Tony : sur l'accueil, à la place du globe, le logo du bureau qui
   tourne lentement sur lui-même, avec une épaisseur de 10 % de sa largeur.
   Il ne paraît que pour le bureau qui en est le propriétaire (voir l'accueil,
   decorDuBureau) : jamais en démonstration.

   Le logo est dessiné ici, sans fichier image, mais **à l'identique** du
   fichier du bureau fourni par Tony (06.10.2026, 1502 × 2000 px, après un
   premier de 1063 × 1358 le 05.10) : chaque bord a été relevé sur l'image au
   dixième de pixel (moindres carrés pour les jambes du A, cercles ajustés
   pour les panses du B), puis le rendu comparé au fichier : écart moyen
   0,4 / 255. Les cotes ci-dessous sont celles de ce fichier, en pixels ; le
   dessin les met à l'échelle. Ne pas les « arrondir » : Tony veut le logo
   parfaitement exact. Le même tracé sert à /ab/ (ab/assets/logo-ab*.svg).
     - le pavé n'est pas carré : 921,74 × 876,52 (la hauteur fait 95 % de la
       largeur) ; vert en haut sur 73 % de la hauteur, gris dessous ;
     - le A a un sommet plat, des jambes d'épaisseur légèrement variable et
       pas de barre ; le B, un fût droit et deux panses dont les évidements
       se terminent en demi-cercle — le bas de la panse haute tombe sur la
       limite vert / gris.
   On le peint une fois dans un canvas hors écran, puis, à chaque image :
     - la plaque (largeur L, épaisseur 0,1 L) tourne autour de l'axe vertical ;
     - la face visible est recopiée en fines tranches verticales, chacune à
       sa propre hauteur : c'est la perspective (le bord qui s'éloigne
       rapetisse), sans 3D ni bibliothèque ;
     - la tranche visible (le chant) suit le même partage vert / gris, un
       ton plus sombre ;
     - la lumière : une face vue de biais s'assombrit un peu. Plus d'ombre au
       sol (retirée à la demande de Tony, 05.10.2026).
   Le dos montre aussi le logo, à l'endroit : on le lit toujours.

   S'arrête hors écran et onglet caché ; tourne même quand le système demande
   de réduire les animations (choix de Tony). Au survol de l'en-tête, il
   accélère un peu, puis reprend son pas.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var TAU = Math.PI * 2;
  // Couleurs du fichier du bureau (06.10.2026) ; le chant, un ton plus sombre (80 %)
  var VERT = "#CAE09B", GRIS = "#87868B", BLANC = "#FFFFFF";
  var VERT_CHANT = "#A2B37C", GRIS_CHANT = "#6C6B6F";

  // Cotes du fichier, en pixels de l'image (1502 × 2000) : le pavé
  var X0 = 6.62, Y0 = 1.97, LARG = 1491.7, HAUT = 1418.23, Y_LIMITE = 1040.9;
  var RAPPORT = HAUT / LARG;           // hauteur / largeur du pavé
  var LIMITE = (Y_LIMITE - Y0) / HAUT; // part du vert, en hauteur
  // « AB » en blanc, même tracé que ab/assets/logo-ab-marque.svg (pair-impair : les évidements du B)
  var LETTRES = "M379.04 733.3H491.52L730.2 1269.8H607.91L434.68 844.11L258.75 1269.8H163.42ZM800.1 733.3H1159.76A154.36 154.36 0 0 1 1263.61 1001.86A154.33 154.33 0 0 1 1159.16 1269.8H800.1ZM908 814.34H1125.27A74.64 74.64 0 0 1 1125.27 963.62H908ZM908 1040.45H1123.81A74.52 74.52 0 0 1 1123.81 1189.49H908Z";
  var EPAISSEUR = .10;                 // de la largeur
  var TOUR = 26;                       // secondes par tour : lentement
  var TRANCHES = 60, TRANCHES_MIN = 6; // tranches de la face, selon sa largeur à l'écran
  var IMAGES = 30;                     // images par seconde au plus : il tourne lentement,
                                       // 60 ou 144 (écran rapide) ne se voient pas et coûtent

  /* Le logo, peint une fois. Largeur S en pixels, hauteur S × RAPPORT. */
  function peint(S) {
    var c = document.createElement("canvas");
    c.width = S; c.height = Math.round(S * RAPPORT);
    var g = c.getContext("2d");
    g.scale(c.width / LARG, c.height / HAUT);
    g.translate(-X0, -Y0);
    g.fillStyle = VERT; g.fillRect(X0, Y0, LARG, Y_LIMITE - Y0);
    g.fillStyle = GRIS; g.fillRect(X0, Y_LIMITE, LARG, Y0 + HAUT - Y_LIMITE);
    g.fillStyle = BLANC;
    g.fill(new Path2D(LETTRES), "evenodd");
    return c;
  }

  function lance(cv) {
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var logo = null;

    var W = 0, H = 0, dpr = 1, L = 0, cx = 0, cy = 0, f = 0, D = 0;
    function taille() {
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      W = r.width; H = r.height;
      dpr = Math.max(1, Math.min(global.devicePixelRatio || 1, 2));
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      L = Math.min(H * .62, W * .42);              // côté du logo à l'écran, de face
      D = L * 4.2;                                 // recul de l'œil : une perspective douce
      f = D;                                       // de face, 1 unité = 1 pixel
      cx = W - L * .95;
      cy = H * .47;
      var S = Math.min(1024, Math.round(L * dpr * 1.5 / 64) * 64 || 256);
      if (!logo || logo.width !== S) logo = peint(S);
    }

    /* Un point de la plaque (x, y, z, en pixels de face) après rotation θ
       autour de l'axe vertical, projeté : [X, Y-échelle, profondeur]. */
    function projette(x, z, cos, sin) {
      var xr = x * cos + z * sin, zr = -x * sin + z * cos;
      var k = f / (D - zr);
      return { X: cx + xr * k, k: k, z: zr };
    }

    function dessiner(T) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!L) return;
      // Rotation régulière, sans flottement ni à-coups : un logo qui monte et
      // descend donnait le mal de mer à Tony (05.10.2026)
      var th = TAU * T / TOUR;
      var cos = Math.cos(th), sin = Math.sin(th);
      var demi = L / 2, hd = L * RAPPORT / 2, ep = L * EPAISSEUR / 2;
      var yc = cy;

      // Le chant visible : à droite si la plaque tourne sa droite vers nous
      var cote = sin < 0 ? 1 : -1;                  // x du chant visible : +demi ou -demi
      var a = projette(cote * demi, ep, cos, sin), b = projette(cote * demi, -ep, cos, sin);
      if (Math.abs(a.X - b.X) > .3) {
        var lim = -hd + 2 * hd * LIMITE;
        ctx.beginPath();
        ctx.moveTo(a.X, yc - hd * a.k); ctx.lineTo(b.X, yc - hd * b.k);
        ctx.lineTo(b.X, yc + lim * b.k); ctx.lineTo(a.X, yc + lim * a.k); ctx.closePath();
        ctx.fillStyle = VERT_CHANT; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(a.X, yc + lim * a.k); ctx.lineTo(b.X, yc + lim * b.k);
        ctx.lineTo(b.X, yc + hd * b.k); ctx.lineTo(a.X, yc + hd * a.k); ctx.closePath();
        ctx.fillStyle = GRIS_CHANT; ctx.fill();
        // un filet de lumière sur l'arête avant
        ctx.beginPath(); ctx.moveTo(a.X, yc - hd * a.k); ctx.lineTo(a.X, yc + hd * a.k);
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.stroke();
      }

      // La face visible, en tranches : l'avant si elle nous regarde, sinon le dos
      var face = cos >= 0 ? ep : -ep;
      var S = logo.width, prec = projette(-demi, face, cos, sin);
      // Autant de tranches que la face en demande : une tous les 3 px de largeur
      // vue à l'écran. De face, la perspective ne joue pas ; de profil, la face
      // est étroite. 90 tranches à chaque image coûtaient pour rien.
      var large = Math.abs(projette(demi, face, cos, sin).X - prec.X);
      var n = Math.max(TRANCHES_MIN, Math.min(TRANCHES, Math.round(large / 3)));
      ctx.imageSmoothingEnabled = true;
      for (var i = 1; i <= n; i++) {
        var u0 = (i - 1) / n, u1 = i / n;
        var p = projette(-demi + u1 * L, face, cos, sin);
        var x0 = Math.min(prec.X, p.X), w = Math.abs(p.X - prec.X);
        if (w > .01) {
          var k = (prec.k + p.k) / 2, hT = L * RAPPORT * k;
          // de dos, la colonne de gauche de l'écran est la droite du logo : on la retourne pour le lire
          var su = cos >= 0 ? u0 : 1 - u1;
          ctx.drawImage(logo, su * S, 0, Math.max(1, S / n), logo.height,
                        x0 - .25, yc - hT / 2, w + .5, hT);    // +0,5 px : pas de jour entre deux tranches
        }
        prec = p;
      }
      // Vue de biais, la face s'assombrit un peu
      var biais = 1 - Math.abs(cos);
      if (biais > .02) {
        var g0 = projette(-demi, face, cos, sin), g1 = projette(demi, face, cos, sin);
        ctx.beginPath();
        ctx.moveTo(g0.X, yc - hd * g0.k); ctx.lineTo(g1.X, yc - hd * g1.k);
        ctx.lineTo(g1.X, yc + hd * g1.k); ctx.lineTo(g0.X, yc + hd * g0.k); ctx.closePath();
        ctx.fillStyle = "rgba(0,0,0," + (.28 * biais).toFixed(3) + ")";
        ctx.fill();
      }
    }

    /* ---------------------------------------------------------- temps */
    var T = 0, dernier = 0, anim = null, visible = true, cible = 0, excite = 0;
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
      // Trop tôt pour l'image suivante : on attend la prochaine occasion sans rien dessiner
      if (dernier && now - dernier < 1000 / IMAGES - 4) { relance(); return; }
      var dt = dernier ? Math.min(.1, (now - dernier) / 1000) : 0;
      dernier = now;
      excite += (cible - excite) * (1 - Math.exp(-dt / (cible > excite ? .6 : 1.8)));
      T += dt * (1 + 1.5 * excite);
      dessiner(T);
      relance();
    }
    function relance() {
      if (anim === null && visible && !document.hidden) anim = global.requestAnimationFrame(frame);
    }
    function reprend() { dernier = 0; relance(); }

    global.addEventListener("resize", function () { taille(); dessiner(T); reprend(); });
    document.addEventListener("visibilitychange", reprend);
    if (global.IntersectionObserver) {
      new global.IntersectionObserver(function (e) {
        visible = e[0].isIntersecting;
        if (visible) reprend();
      }, { rootMargin: "120px" }).observe(cv);
    }
    taille();
    T = -TOUR * .07;                               // il arrive légèrement de biais
    relance();
  }

  global.Decor = global.Decor || {};
  global.Decor.logoAB = lance;
})(window);
