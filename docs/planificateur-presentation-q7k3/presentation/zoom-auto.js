/* Agrandissement automatique des captures pendant la lecture (17.11.2026, demande de Tony).
   Quand la voix parle d'un bloc qui porte une capture et que le défilement automatique est actif,
   la capture grandit doucement jusqu'au centre de l'écran, reste agrandie pendant le cœur du
   passage, puis revient d'elle-même à sa place avant le bloc suivant. Le fond s'assombrit pendant
   l'agrandissement. Défilement manuel, pause ou « Défilement auto » décoché : tout se remet en place. */
(function(){
  "use strict";
  var DEBUT = .22, FIN = .78;          // part du passage où la capture est agrandie
  var base = (document.currentScript && document.currentScript.src || "").replace(/[^\/]*$/, "");
  var TL = null;
  fetch(base + "timeline.json?v=5").then(function(r){ return r.json() }).then(function(t){ TL = t });

  var voile = document.createElement("div");
  voile.setAttribute("aria-hidden", "true");
  voile.style.cssText = "position:fixed;inset:0;z-index:39;background:#F4F5F2;opacity:0;pointer-events:none";
  document.body.appendChild(voile);

  var cible = null, k = 0, dx = 0, dy = 0;

  function cibleDe(bloc){
    return bloc ? (bloc.querySelector(".telephones") || bloc.querySelector(".capture")) : null;
  }
  function pose(el, kk){
    if (kk < .002){
      el.style.transform = ""; el.style.zIndex = ""; el.style.position = "";
      dx = dy = 0; return;
    }
    // centre actuel sans notre translation (l'échelle se fait autour du centre)
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width/2 - dx, cy = r.top + r.height/2 - dy;
    var w = el.offsetWidth, h = el.offsetHeight;
    var S = Math.min(innerWidth*.92/w, innerHeight*.84/h);
    if (S < 1) S = 1;
    dx = (innerWidth/2 - cx)*kk; dy = (innerHeight/2 - cy)*kk;
    el.style.position = "relative"; el.style.zIndex = "40";
    el.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) scale(" + (1 + (S-1)*kk).toFixed(4) + ")";
  }
  function lisse(x){ return x*x*(3-2*x) }

  function boucle(){
    requestAnimationFrame(boucle);
    var aud = document.getElementById("aud"), auto = document.getElementById("la");
    var voulu = null, but = 0;
    if (TL && aud && auto && auto.checked && !aud.paused){
      var t = aud.currentTime, i = 0;
      while (i < TL.length - 1 && t >= TL[i][1]) i++;
      var bloc = document.querySelector('[data-lecture="' + i + '"]');
      var c = cibleDe(bloc);
      if (c){
        var p = (t - TL[i][0]) / (TL[i][1] - TL[i][0]);
        if (p > DEBUT && p < FIN){ voulu = c; but = 1; }
      }
    }
    // une autre capture demandée : la précédente revient d'abord à sa place
    if (cible && voulu !== cible) but = 0;
    if (!cible && voulu) cible = voulu;
    k += (but - k) * .06;
    if (cible){
      pose(cible, lisse(Math.max(0, Math.min(1, k))));
      if (but === 0 && k < .002){ pose(cible, 0); cible = null; k = 0; }
    }
    voile.style.opacity = (lisse(Math.max(0, Math.min(1, k))) * .82).toFixed(3);
  }
  requestAnimationFrame(boucle);
})();
