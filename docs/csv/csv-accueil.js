// CSV Studio — animation de l'accueil : des lignes de texte séparées par des points-virgules se rangent en tableau,
// une colonne se trie, un filtre retire des lignes, puis la boucle reprend. Dessin 2D sur <canvas>, sans bibliothèque.
(function(){
  "use strict";
  var section = document.getElementById("accueil"), canvas = document.getElementById("scene");
  if (section) requestAnimationFrame(function(){ section.classList.add("vu"); });
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");

  var TITRES = ["Repère", "Type", "Longueur", "Niveau"];
  var LIGNES = [
    ["PO-001", "Poutre", "5.40", "Rez"],
    ["PT-002", "Poteau", "2.80", "Rez"],
    ["PO-003", "Poutre", "7.20", "Étage 1"],
    ["VO-004", "Voile", "4.10", "Sous-sol"],
    ["PO-005", "Poutre", "3.60", "Étage 2"],
    ["PT-006", "Poteau", "2.80", "Étage 1"],
    ["DA-007", "Dalle", "6.00", "Étage 2"]
  ];
  var N = LIGNES.length, NC = TITRES.length, COL_NUM = 2;
  // rang de chaque ligne une fois triée par longueur décroissante, puis une fois filtrée sur « Poutre »
  var ordre = LIGNES.map(function(l, i){ return i; }).sort(function(a, b){ return LIGNES[b][COL_NUM] - LIGNES[a][COL_NUM] || a - b; });
  var rangTri = [], rangFiltre = [], gardees = 0;
  ordre.forEach(function(i, r){ rangTri[i] = r; });
  ordre.forEach(function(i){ rangFiltre[i] = LIGNES[i][1] === "Poutre" ? gardees++ : -1; });

  var DUREE = 13.5, L = 0, H = 0, couleurs = null, depart = 0;

  function lireCouleurs(){
    var s = getComputedStyle(document.documentElement);
    function v(nom, repli){ return (s.getPropertyValue(nom) || repli).trim() || repli; }
    couleurs = { or: v("--scene-or", "96,205,255"), encre: v("--scene-encre", "255,255,255") };
  }
  function tailler(){
    var b = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!b.width || !b.height) return false;
    if (Math.round(b.width) !== L || Math.round(b.height) !== H || canvas.width !== Math.round(b.width * dpr)){
      L = Math.round(b.width); H = Math.round(b.height);
      canvas.width = Math.round(L * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return true;
  }
  function doux(t){ t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function phase(t, a, b){ return doux((t - a) / (b - a)); }
  function mix(a, b, k){ return a + (b - a) * k; }

  function dessiner(t){
    ctx.clearRect(0, 0, L, H);
    var marge = Math.max(18, Math.min(34, L * 0.07)), taille = Math.max(10.5, Math.min(15, (L - 2 * marge) / 27));
    var hl = Math.max(24, Math.min(36, (H - 2 * marge) / (N + 3.2)));
    ctx.font = taille + 'px "Cascadia Mono","Cascadia Code",Consolas,"IBM Plex Mono",ui-monospace,monospace';
    ctx.textBaseline = "middle";
    var lpv = ctx.measureText(";").width, i, c;

    // largeur de chaque colonne du tableau, ramenée à la largeur disponible
    var larg = [], total = 0;
    for (c = 0; c < NC; c++){
      var m = ctx.measureText(TITRES[c]).width;
      for (i = 0; i < N; i++) m = Math.max(m, ctx.measureText(LIGNES[i][c]).width);
      larg[c] = m + 22; total += larg[c];
    }
    var k = Math.min(1.25, (L - 2 * marge) / total), xcol = [marge + (L - 2 * marge - total * k) / 2];
    for (c = 0; c < NC; c++){ larg[c] *= k; xcol[c + 1] = xcol[c] + larg[c]; }

    var entree = phase(t, 0, 1.3), grille = phase(t, 1.9, 3.4), tri = phase(t, 4.6, 5.9), filtre = phase(t, 7.3, 8.4);
    var sortie = 1 - phase(t, 11.2, 12.4), haut = (H - (N + 1) * hl) / 2 + (filtre * (N - gardees) * hl) / 2;
    var nbLignes = mix(N, gardees, filtre);

    // bandeau des titres et traits du tableau
    if (grille > 0){
      ctx.fillStyle = "rgba(" + couleurs.or + "," + (0.16 * grille * sortie) + ")";
      ctx.fillRect(xcol[0], haut, xcol[NC] - xcol[0], hl);
      ctx.strokeStyle = "rgba(" + couleurs.encre + "," + (0.16 * grille * sortie) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (c = 0; c <= NC; c++){ var x = Math.round(xcol[c]) + 0.5; ctx.moveTo(x, haut); ctx.lineTo(x, haut + (nbLignes + 1) * hl * grille); }
      for (i = 0; i <= Math.ceil(nbLignes) + 1; i++){
        var y = Math.round(haut + Math.min(i, nbLignes + 1) * hl) + 0.5;
        ctx.moveTo(xcol[0], y); ctx.lineTo(xcol[0] + (xcol[NC] - xcol[0]) * grille, y);
      }
      ctx.stroke();
    }

    // une ligne de texte : chaque champ glisse de sa place dans la phrase à sa colonne
    function ligne(champs, rang, alpha, titre, apparition){
      if (alpha <= 0.01) return;
      var y = haut + (rang + 0.5) * hl, xb = xcol[0] + 11;
      for (var j = 0; j < NC; j++){
        var w = ctx.measureText(champs[j]).width;
        var cible = j === COL_NUM ? xcol[j + 1] - 11 - w : xcol[j] + 11;
        var x = mix(xb, cible, grille);
        ctx.fillStyle = titre && grille > 0.5 ? "rgba(" + couleurs.or + "," + alpha + ")" : "rgba(" + couleurs.encre + "," + (alpha * (titre ? 0.95 : 0.8)) + ")";
        ctx.fillText(champs[j], x, y + (1 - apparition) * 8);
        xb += w;
        if (j < NC - 1){
          if (grille < 1){ ctx.fillStyle = "rgba(" + couleurs.or + "," + (alpha * (1 - grille)) + ")"; ctx.fillText(";", xb, y + (1 - apparition) * 8); }
          xb += lpv;
        }
      }
    }
    ligne(TITRES, 0, entree * sortie, true, entree);
    for (i = 0; i < N; i++){
      var app = phase(t, 0.12 * (i + 1), 0.12 * (i + 1) + 1.1);
      var rang = mix(i, rangTri[i], tri), a = app * sortie;
      if (rangFiltre[i] < 0) a *= 1 - phase(t, 7.3, 7.9);
      else rang = mix(rang, rangFiltre[i], filtre);
      ligne(LIGNES[i], rang + 1, a, false, app);
    }

    // repères : flèche de tri sur « Longueur », puis étiquette du filtre
    if (tri > 0){
      ctx.fillStyle = "rgba(" + couleurs.or + "," + (tri * sortie) + ")";
      ctx.fillText("▼", xcol[COL_NUM] + 8, haut + hl / 2);
    }
    if (filtre > 0){
      var txt = "Type = Poutre", lt = ctx.measureText(txt).width + 22, xe = xcol[NC] - lt, ye = haut - hl * 0.95;
      ctx.fillStyle = "rgba(" + couleurs.or + "," + (0.16 * filtre * sortie) + ")";
      ctx.strokeStyle = "rgba(" + couleurs.or + "," + (0.5 * filtre * sortie) + ")";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(xe, ye, lt, hl * 0.72, hl * 0.36); else ctx.rect(xe, ye, lt, hl * 0.72);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(" + couleurs.encre + "," + (0.9 * filtre * sortie) + ")";
      ctx.fillText(txt, xe + 11, ye + hl * 0.36);
    }
  }

  function boucle(maintenant){
    if (canvas.offsetParent === null || document.hidden){ setTimeout(function(){ requestAnimationFrame(boucle); }, 400); return; }
    if (!couleurs) lireCouleurs();
    if (!depart) depart = maintenant;
    if (tailler()) dessiner(((maintenant - depart) / 1000) % DUREE);
    requestAnimationFrame(boucle);
  }
  window.addEventListener("csv-theme", function(){ couleurs = null; });
  requestAnimationFrame(boucle);
})();
