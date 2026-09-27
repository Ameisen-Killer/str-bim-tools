/* Spectre du tableau de bord — décor.
   ---------------------------------------------------------------------------
   À la place de la villa filaire (27.09.2026, demande de Tony) : un ruban de
   fils colorés qui ondule sans fin sur le fond, comme un voile de soie vu de
   côté. Pas de boucle : chaque image est une fonction continue du temps, il
   n'y a donc ni début, ni fin, ni raccord.

   Ce qui fait l'effet :
     - le ruban : une soixantaine de fils posés côte à côte autour d'une ligne
       médiane qui ondule (deux sinus lents, de sens contraires) ;
     - la torsion : la largeur du ruban est multipliée par le cosinus d'un angle
       qui tourne le long du ruban et dans le temps. Quand il passe par zéro, le
       ruban se présente par la tranche, les fils se rejoignent et se croisent :
       c'est ce qui donne le relief, sans aucune 3D ;
     - la couleur : un spectre qui court le long du ruban et dérive lentement ;
     - la lumière : sur fond sombre, les fils s'additionnent (« lighter ») —
       là où ils se serrent, ça brille tout seul. Sur fond clair, l'addition
       n'aurait aucun sens : trait simple, couleurs plus denses ;
     - les bords : le ruban naît et s'éteint en fondu, pas de coupure au cadre.

   Deux emplacements : l'en-tête du tableau de bord, et le bas de la page de
   connexion (sur toute la largeur). Le fondu des bouts se règle par
   data-fondu="début,fin" sur le canvas (fractions de la largeur) : décalé à
   droite dans l'en-tête, où le ruban sort de derrière le titre, symétrique en
   bas de la connexion.

   Le dessin s'arrête dès que le décor sort de l'écran ou que l'onglet passe
   au second plan. Il tourne même quand le système demande de réduire les
   animations : choix de Tony, dont le poste a les effets désactivés.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var cv = document.getElementById("spectre");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  var FONDU = (cv.getAttribute("data-fondu") || ".24,.88").split(",").map(parseFloat);
  if (!(FONDU[0] >= 0 && FONDU[1] <= 1 && FONDU[0] < FONDU[1])) FONDU = [.24, .88];

  var FILS = 60;                  // fils du ruban
  var PAS = 4;                    // px entre deux points d'un fil…
  var POINTS_MAX = 280;           // …sans dépasser ce nombre, même sur un grand écran
  var PIXELS_MAX = 1.8e6;         // surface de canvas au-delà de laquelle on baisse la densité
  var BANDES = 12;                // dégradés de couleur par image (un pour cinq fils)
  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------ cadre */

  var W = 0, H = 0, dpr = 1, n = 0;
  var centre = [], torsion = [], froisse = [];
  function taille() {
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    /* Le ruban de la connexion couvre tout l'écran en largeur : en pleine
       densité d'un écran Retina, chaque image coûterait des millions de pixels
       et des images sauteraient. Au-delà d'une surface raisonnable, la densité
       baisse — des fils fins et flous ne s'en ressentent pas. */
    dpr = Math.min(global.devicePixelRatio || 1, 2, Math.sqrt(PIXELS_MAX / Math.max(1, W * H)));
    dpr = Math.max(1, dpr);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    n = Math.min(POINTS_MAX, Math.ceil(W / PAS));
    centre = new Float32Array(n + 1);
    torsion = new Float32Array(n + 1);
    froisse = new Float32Array(n + 1);
  }

  /* --------------------------------------------------------- couleurs */

  var CLAIR = false;
  function lisTheme() {
    var fond = (getComputedStyle(document.documentElement).getPropertyValue("--noir") || "#050505").trim();
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fond);
    var lum = m ? (parseInt(m[1], 16) * .299 + parseInt(m[2], 16) * .587 + parseInt(m[3], 16) * .114) / 255 : 0;
    CLAIR = lum > .5;
  }
  lisTheme();
  if (global.MutationObserver) {
    new MutationObserver(lisTheme).observe(document.documentElement,
      { attributes: true, attributeFilter: ["data-theme"] });
  }

  function teinte(h, lum, a) {
    return "hsla(" + (((h % 360) + 360) % 360).toFixed(1) + "," + (CLAIR ? 78 : 92) + "%," + lum + "%," + a + ")";
  }

  /* ------------------------------------------------------------ dessin */

  function dessiner(T) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    if (!n) return;

    var mi = H * .5, ampli = H * .25, large = H * .44;
    var i, s;

    // La ligne médiane, la torsion et le froissé, une fois pour tous les fils
    for (i = 0; i <= n; i++) {
      s = i / n;
      centre[i] = mi + ampli * (
        .64 * Math.sin(TAU * s * 1.0 + T * .36) +
        .36 * Math.sin(TAU * s * 1.9 - T * .52 + 1.7));
      torsion[i] = Math.cos(TAU * s * .8 - T * .23 + .6 * Math.sin(T * .13));
      froisse[i] = H * .011 * (1 - Math.abs(torsion[i]));
    }

    var h0 = T * 6;                              // le spectre dérive : un tour en une minute
    var lum = CLAIR ? 44 : 62;
    ctx.globalCompositeOperation = CLAIR ? "source-over" : "lighter";
    ctx.lineJoin = "round"; ctx.lineCap = "round";

    /* Un dégradé par bande de fils voisins plutôt qu'un par fil : l'œil ne
       distingue pas cinq fils côte à côte d'une même teinte, et l'image coûte
       cinq fois moins d'objets à créer — autant de ramasse-miettes en moins,
       donc d'à-coups en moins. */
    var degrades = [];
    for (var b = 0; b < BANDES; b++) {
      var ub = (b + .5) / BANDES - .5, g = ctx.createLinearGradient(0, 0, W, 0);
      for (var k = 0; k <= 4; k++) g.addColorStop(k / 4, teinte(h0 + 200 + k * 60 + ub * 70, lum, 1));
      degrades.push(g);
    }

    var xs = [], ys = [];
    for (var f = 0; f < FILS; f++) {
      var u = f / (FILS - 1) - .5;               // -0,5 … 0,5 à travers le ruban
      var coeur = 1 - Math.abs(2 * u);           // les fils du milieu portent la lumière
      ctx.strokeStyle = degrades[Math.min(BANDES - 1, Math.floor((u + .5) * BANDES))];

      var phase = f * .41;
      for (i = 0; i <= n; i++) {
        s = i / n;
        xs[i] = s * W;
        ys[i] = centre[i] + u * large * torsion[i] + froisse[i] * Math.sin(s * 9 + T * .8 + phase);
      }
      /* Courbes et non segments : chaque point sert de point de contrôle, la
         courbe passe par les milieux. Plus aucun angle, même là où le ruban
         se tord le plus. */
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (i = 1; i < n; i++) {
        ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
      }
      ctx.lineTo(xs[n], ys[n]);

      if (!CLAIR) {                              // halo : trait large et presque transparent
        ctx.lineWidth = 3.2;
        ctx.globalAlpha = .035 + .05 * coeur;
        ctx.stroke();
      }
      ctx.lineWidth = CLAIR ? .9 : 1.05;          // sous 1 px, un fil scintille en bougeant
      ctx.globalAlpha = CLAIR ? .22 + .38 * coeur : .16 + .34 * coeur;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Fondu aux deux bouts : le ruban sort de nulle part et y retourne
    ctx.globalCompositeOperation = "destination-in";
    var bord = ctx.createLinearGradient(0, 0, W, 0);
    bord.addColorStop(0, "rgba(0,0,0,0)");
    bord.addColorStop(FONDU[0], "rgba(0,0,0,1)");
    bord.addColorStop(FONDU[1], "rgba(0,0,0,1)");
    bord.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bord;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  /* ------------------------------------------------------------ temps
     Le temps n'avance que pendant qu'on regarde : au retour sur l'onglet, le
     ruban reprend là où on l'a laissé, sans saut. */

  var T = 0, dernier = 0, anim = null, visible = true;

  function frame(now) {
    anim = null;
    var dt = dernier ? Math.min(.05, (now - dernier) / 1000) : 0;
    dernier = now; T += dt;
    dessiner(T);
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
  T = 7;                                         // on entre dans un ruban déjà en mouvement
  relance();
})(window);
