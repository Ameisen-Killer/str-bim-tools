/* Planification — ciel du jour (06.11.2026, idée de Tony), avec ciel.css.
   Le fond des pages suit l'heure : nuit bleutée, lever de soleil rosé et
   pêche en bas de l'écran, ciel clair dans la journée, coucher de soleil
   orangé en haut de l'écran le soir (l'inverse du matin), puis le soir bleu.
   Les heures du lever et du coucher sont calculées pour la Suisse romande
   (46,5° N, 6,6° E) à la date du jour ; l'heure est celle du poste.
   Les teintes restent très pâles et en partie transparentes sur le fond de
   la marque (--m-fond) : le texte garde ses contrastes, les encadrés blancs
   ne changent pas. Recalculé chaque minute et au retour sur l'onglet. */
(function (global) {
  "use strict";
  var LAT = 46.5, LON = 6.6;
  var RAD = Math.PI / 180;

  /* Lever et coucher du soleil en heures locales du poste (formule de la NOAA,
     simplifiée : précision de quelques minutes, bien assez pour un fond). */
  function soleil(d) {
    var debut = new Date(d.getFullYear(), 0, 1);
    var j = Math.floor((d - debut) / 864e5) + 1;
    var g = 2 * Math.PI / 365 * (j - 1);
    var eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var c = Math.cos(90.833 * RAD) / (Math.cos(LAT * RAD) * Math.cos(decl))
      - Math.tan(LAT * RAD) * Math.tan(decl);
    var ha = Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
    var decalage = -d.getTimezoneOffset();                       // minutes, heure d'été comprise
    var midi = 720 - 4 * LON - eqt + decalage;                   // midi solaire, minutes
    return { lever: (midi - 4 * ha) / 60, coucher: (midi + 4 * ha) / 60 };
  }

  /* Étapes du ciel : [haut de l'écran, bas de l'écran], couleurs RVB + opacité.
     Placées autour du lever (L) et du coucher (C). */
  var NUIT     = [[196, 204, 230, .45], [214, 214, 236, .40]];
  var AUBE     = [[208, 206, 234, .50], [244, 206, 214, .50]];   // bleu violet, rose en bas
  var LEVER    = [[226, 222, 240, .45], [252, 214, 182, .50]];   // pêche au ras de l'horizon
  var MATIN    = [[212, 228, 244, .50], [250, 236, 214, .40]];
  var JOUR     = [[214, 232, 248, .45], [255, 255, 255, 0]];     // ciel clair, la marque en bas
  var APRESMIDI= [[220, 230, 244, .40], [250, 230, 200, .40]];
  var COUCHER  = [[250, 206, 170, .48], [232, 210, 230, .45]];   // orangé en haut : l'inverse du matin
  var CREPUSC  = [[214, 196, 228, .50], [206, 208, 236, .50]];

  function etapes(L, C) {
    var milieu = (L + C) / 2;
    return [
      [0, NUIT], [L - 1.25, NUIT], [L - 0.5, AUBE], [L + 0.25, LEVER], [L + 1.5, MATIN],
      [milieu, JOUR], [C - 1.75, APRESMIDI], [C - 0.25, COUCHER], [C + 0.75, CREPUSC],
      [C + 2, NUIT], [24, NUIT]
    ];
  }

  function melange(a, b, t) {
    var r = [];
    for (var i = 0; i < 4; i++) r.push(a[i] + (b[i] - a[i]) * t);
    return r;
  }
  function rvba(c) {
    return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + c[3].toFixed(3) + ")";
  }

  function teintes(d) {
    var s = soleil(d);
    var h = d.getHours() + d.getMinutes() / 60;
    var liste = etapes(s.lever, s.coucher);
    for (var i = 0; i < liste.length - 1; i++) {
      var a = liste[i], b = liste[i + 1];
      if (h >= a[0] && h <= b[0]) {
        var t = b[0] > a[0] ? (h - a[0]) / (b[0] - a[0]) : 0;
        t = t * t * (3 - 2 * t);                                  // passage adouci
        return [melange(a[1][0], b[1][0], t), melange(a[1][1], b[1][1], t)];
      }
    }
    return NUIT;
  }

  function pose() {
    var c = teintes(new Date());
    var r = document.documentElement;
    r.style.setProperty("--ciel-haut", rvba(c[0]));
    r.style.setProperty("--ciel-bas", rvba(c[1]));
    r.setAttribute("data-ciel", "");
  }

  pose();
  setInterval(pose, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pose(); });
  global.Ciel = { pose: pose, soleil: soleil };
})(window);
