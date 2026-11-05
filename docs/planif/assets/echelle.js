/* Planification — échelle d'affichage (05.11.2026), avec echelle.css.
   Le zoom de la page (90 % sur ordinateur) décale tout ce qui se place au pixel
   près : les mesures (getBoundingClientRect, position du pointeur) sont celles
   de l'écran, alors qu'une position écrite en style est encore réduite par le
   zoom. Echelle.k() mesure le rapport réel sur un témoin, sans rien supposer du
   navigateur : 0,9 si les deux diffèrent, 1 sinon. Une mesure d'écran se
   convertit en valeur de style par Echelle.px(v) = v / k.
   Pose aussi --vhk, qui rend aux hauteurs en vh la fenêtre entière. */
(function (global) {
  "use strict";
  var memo = null;
  function mesure() {
    var hote = document.body || document.documentElement;
    var t = document.createElement("div");
    t.style.cssText = "position:fixed;left:0;top:0;width:100px;height:100vh;visibility:hidden;pointer-events:none;contain:strict";
    hote.appendChild(t);
    var r = t.getBoundingClientRect();
    t.remove();
    var k = r.width / 100 || 1, kv = global.innerHeight ? r.height / global.innerHeight : 1;
    if (Math.abs(k - 1) < 0.01) k = 1;
    if (!kv || Math.abs(kv - 1) < 0.01) kv = 1;
    memo = { l: global.innerWidth, h: global.innerHeight, k: k };
    var vhk = String(Math.round(1 / kv * 10000) / 10000);
    if (document.documentElement.style.getPropertyValue("--vhk") !== vhk) document.documentElement.style.setProperty("--vhk", vhk);
    return k;
  }
  function k() {
    if (memo && memo.l === global.innerWidth && memo.h === global.innerHeight) return memo.k;
    return mesure();
  }
  global.Echelle = {
    k: k,
    /** Une mesure d'écran (px) convertie en valeur de style. */
    px: function (v) { return v / k(); }
  };
  mesure();
  global.addEventListener("resize", function () { memo = null; mesure(); });
})(window);
