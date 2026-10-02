/* Logo du bureau en volume — décor de l'accueil (02.10.2026).
   ---------------------------------------------------------------------------
   Demande de Tony : sur l'accueil, à la place du globe, le logo du bureau qui
   tourne lentement sur lui-même, avec une épaisseur de 10 % de sa largeur.
   Il ne paraît que pour le bureau qui en est le propriétaire (voir l'accueil,
   decorDuBureau) : jamais en démonstration.

   Le logo est dessiné ici, sans fichier image : un carré vert (haut) et gris
   (bas), « AB » en blanc à cheval sur la limite. On le peint une fois dans un
   canvas hors écran, puis, à chaque image :
     - la plaque (largeur L, épaisseur 0,1 L) tourne autour de l'axe vertical ;
     - la face visible est recopiée en fines tranches verticales, chacune à
       sa propre hauteur : c'est la perspective (le bord qui s'éloigne
       rapetisse), sans 3D ni bibliothèque ;
     - la tranche visible (le chant) suit le même partage vert / gris, un
       ton plus sombre ;
     - la lumière : une face vue de biais s'assombrit un peu, une ombre douce
       au sol s'élargit et se resserre avec la rotation.
   Le dos montre aussi le logo, à l'endroit : on le lit toujours.

   S'arrête hors écran et onglet caché ; tourne même quand le système demande
   de réduire les animations (choix de Tony). Au survol de l'en-tête, il
   accélère un peu, puis reprend son pas.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var TAU = Math.PI * 2;
  var VERT = "#C8DE9A", GRIS = "#8B8B8D", BLANC = "#FFFFFF";
  var VERT_CHANT = "#9FB676", GRIS_CHANT = "#6C6C6E";
  var LIMITE = .585;                   // part du vert, en hauteur
  var EPAISSEUR = .10;                 // de la largeur
  var TOUR = 26;                       // secondes par tour : lentement
  var TRANCHES = 90;

  /* Le logo, peint une fois. Côté S en pixels. */
  function peint(S) {
    var c = document.createElement("canvas");
    c.width = c.height = S;
    var g = c.getContext("2d");
    g.fillStyle = VERT; g.fillRect(0, 0, S, S);
    g.fillStyle = GRIS; g.fillRect(0, Math.round(S * LIMITE), S, S - Math.round(S * LIMITE));

    // « AB » : le A sans barre, comme un lambda ; trait fin et égal
    var e = S * .062, haut = S * .405, bas = S * .735, h = bas - haut;
    g.strokeStyle = BLANC; g.lineWidth = e; g.lineJoin = "miter"; g.lineCap = "butt";
    g.beginPath();
    var ax = S * .255, aw = S * .235;
    g.moveTo(ax, bas); g.lineTo(ax + aw / 2, haut + e * .45); g.lineTo(ax + aw, bas);
    g.stroke();

    // B : un fût et deux panses, la seconde un peu plus large
    var bx = S * .56 + e / 2, r1 = h * .25, r2 = h * .27, ext1 = S * .115, ext2 = S * .13;
    var y0 = haut + e / 2, ym = haut + h * .47, y1 = bas - e / 2;
    g.beginPath();
    g.moveTo(bx, bas); g.lineTo(bx, y0);
    g.lineTo(bx + ext1 - r1 / 2, y0);
    g.arc(bx + ext1 - r1 / 2, (y0 + ym) / 2, (ym - y0) / 2, -Math.PI / 2, Math.PI / 2);
    g.lineTo(bx, ym);
    g.moveTo(bx, ym);
    g.lineTo(bx + ext2 - r2 / 2, ym);
    g.arc(bx + ext2 - r2 / 2, (ym + y1) / 2, (y1 - ym) / 2, -Math.PI / 2, Math.PI / 2);
    g.lineTo(bx, y1);
    g.stroke();
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
      var th = TAU * T / TOUR + .5 * Math.sin(T * .21) * .25;  // pas tout à fait régulier : il flotte
      var cos = Math.cos(th), sin = Math.sin(th);
      var demi = L / 2, ep = L * EPAISSEUR / 2;
      var flotte = Math.sin(T * .9) * L * .015;
      var yc = cy + flotte;

      // L'ombre au sol, qui suit l'emprise de la plaque
      var emprise = Math.abs(demi * cos) + Math.abs(ep * sin);
      var gr = ctx.createRadialGradient(cx, cy + demi * 1.08, 1, cx, cy + demi * 1.08, Math.max(4, emprise * 1.1));
      gr.addColorStop(0, "rgba(0,0,0,.22)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.translate(cx, cy + demi * 1.08); ctx.scale(1, .16); ctx.translate(-cx, -(cy + demi * 1.08));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(cx, cy + demi * 1.08, Math.max(4, emprise * 1.1), 0, TAU); ctx.fill();
      ctx.restore();

      // Le chant visible : à droite si la plaque tourne sa droite vers nous
      var cote = sin < 0 ? 1 : -1;                  // x du chant visible : +demi ou -demi
      var a = projette(cote * demi, ep, cos, sin), b = projette(cote * demi, -ep, cos, sin);
      if (Math.abs(a.X - b.X) > .3) {
        var lim = -demi + L * LIMITE;
        ctx.beginPath();
        ctx.moveTo(a.X, yc - demi * a.k); ctx.lineTo(b.X, yc - demi * b.k);
        ctx.lineTo(b.X, yc + lim * b.k); ctx.lineTo(a.X, yc + lim * a.k); ctx.closePath();
        ctx.fillStyle = VERT_CHANT; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(a.X, yc + lim * a.k); ctx.lineTo(b.X, yc + lim * b.k);
        ctx.lineTo(b.X, yc + demi * b.k); ctx.lineTo(a.X, yc + demi * a.k); ctx.closePath();
        ctx.fillStyle = GRIS_CHANT; ctx.fill();
        // un filet de lumière sur l'arête avant
        ctx.beginPath(); ctx.moveTo(a.X, yc - demi * a.k); ctx.lineTo(a.X, yc + demi * a.k);
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.stroke();
      }

      // La face visible, en tranches : l'avant si elle nous regarde, sinon le dos
      var face = cos >= 0 ? ep : -ep;
      var S = logo.width, prec = projette(-demi, face, cos, sin);
      ctx.imageSmoothingEnabled = true;
      for (var i = 1; i <= TRANCHES; i++) {
        var u0 = (i - 1) / TRANCHES, u1 = i / TRANCHES;
        var p = projette(-demi + u1 * L, face, cos, sin);
        var x0 = Math.min(prec.X, p.X), w = Math.abs(p.X - prec.X);
        if (w > .01) {
          var k = (prec.k + p.k) / 2, hT = L * k;
          // de dos, la colonne de gauche de l'écran est la droite du logo : on la retourne pour le lire
          var su = cos >= 0 ? u0 : 1 - u1;
          ctx.drawImage(logo, su * S, 0, Math.max(1, S / TRANCHES), S,
                        x0 - .25, yc - hT / 2, w + .5, hT);    // +0,5 px : pas de jour entre deux tranches
        }
        prec = p;
      }
      // Vue de biais, la face s'assombrit un peu
      var biais = 1 - Math.abs(cos);
      if (biais > .02) {
        var g0 = projette(-demi, face, cos, sin), g1 = projette(demi, face, cos, sin);
        ctx.beginPath();
        ctx.moveTo(g0.X, yc - demi * g0.k); ctx.lineTo(g1.X, yc - demi * g1.k);
        ctx.lineTo(g1.X, yc + demi * g1.k); ctx.lineTo(g0.X, yc + demi * g0.k); ctx.closePath();
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
      var dt = dernier ? Math.min(.05, (now - dernier) / 1000) : 0;
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
