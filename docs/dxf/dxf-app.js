/* STR Bim Tools · visionneuse DXF : canvas 2D, calques, propriétés, mesure. Les fichiers restent sur le poste. */
(function(){
  "use strict";
  var VERSION = "1.0.0";
  var $ = function(s){ return document.querySelector(s); };
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k, d){ try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e){ return d; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch (e){} }
  function hex(c){ return "#" + ("00000" + c.toString(16)).slice(-6); }
  function nb(x, d){ return (Math.round(x*Math.pow(10, d))/Math.pow(10, d)).toLocaleString("fr-CH", { maximumFractionDigits: d }); }
  $("#version").textContent = "v" + VERSION;

  var cv = $("#vue"), ctx = cv.getContext("2d"), centre = $("#centre");
  var S = null;                 // scène lue (DXF.lire)
  var O = [0, 0];               // origine retirée des coordonnées (précision du canvas sur de grandes coordonnées)
  var seaux = [], remplis = []; // tracés par calque et couleur : { c, col, path }
  var vue = { x: 0, y: 0, s: 1 };   // centre (relatif à O) et échelle (px par unité)
  var W = 0, H = 0, dpr = 1, besoin = false;
  var choisi = -1, cheminChoisi = null;
  var grille = null;            // index des segments pour viser
  var mode = "";                // "" ou "mesure"
  var mesure = [];              // points (relatifs à O) de la mesure en cours

  // ================= Fond, couleurs =================
  function clair(){ return document.documentElement.getAttribute("data-theme") === "clair"; }
  function css(col){
    if (col === -1) return clair() ? "#000000" : "#FFFFFF";
    // couleurs trop proches du fond : assombries ou éclaircies pour rester lisibles
    var r = col >> 16 & 255, g = col >> 8 & 255, b = col & 255, l = (r*299 + g*587 + b*114)/1000;
    if (!clair() && l < 40) return "#5A5A5A";
    if (clair() && l > 225) return "#8A8A8A";
    return hex(col);
  }

  // ================= Taille et rendu =================
  function taille(){
    var r = centre.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    demander();
  }
  if ("ResizeObserver" in window) new ResizeObserver(taille).observe(centre); else window.addEventListener("resize", taille);
  function demander(){ if (!besoin){ besoin = true; requestAnimationFrame(rendre); } }
  function versEcran(x, y){ return [W/2 + (x - vue.x)*vue.s, H/2 - (y - vue.y)*vue.s]; }
  function versDessin(px, py){ return [vue.x + (px - W/2)/vue.s, vue.y - (py - H/2)/vue.s]; }

  function rendre(){
    besoin = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!S) return;
    var s = vue.s;
    ctx.setTransform(dpr*s, 0, 0, -dpr*s, dpr*(W/2 - vue.x*s), dpr*(H/2 + vue.y*s));
    // remplissages d'abord, traits par-dessus
    remplis.forEach(function(R){
      if (!S.calques[R.c].visible) return;
      ctx.globalAlpha = R.alpha; ctx.fillStyle = css(R.col); ctx.fill(R.path, "evenodd");
    });
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1/s; ctx.lineJoin = "round"; ctx.lineCap = "round";
    seaux.forEach(function(B){
      if (!S.calques[B.c].visible) return;
      ctx.strokeStyle = css(B.col); ctx.stroke(B.path);
    });
    if (cheminChoisi){
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--or").trim() || "#60CDFF";
      ctx.lineWidth = 3/s; ctx.stroke(cheminChoisi);
    }
    // textes, à l'échelle de l'écran, seulement lisibles
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "alphabetic";
    var police = getComputedStyle(document.body).fontFamily;
    for (var i = 0; i < S.textes.length; i++){
      var T = S.textes[i];
      if (!S.calques[T.c].visible) continue;
      var hp = T.h*s;
      if (hp < 2.5 || hp > 4000) continue;
      var p = versEcran(T.x - O[0], T.y - O[1]);
      var marge = hp*(T.l.length + 1)*40;
      if (p[0] < -marge || p[0] > W + marge || p[1] < -marge || p[1] > H + marge) continue;
      ctx.save();
      ctx.translate(p[0], p[1]); ctx.rotate(-T.rot);
      if (T.w !== 1) ctx.scale(T.w, 1);
      ctx.font = Math.max(1, hp/0.72).toFixed(1) + "px " + police;
      ctx.fillStyle = css(T.col);
      ctx.textAlign = T.ah === 1 ? "center" : T.ah === 2 ? "right" : "left";
      var n = T.l.length, pasL = hp*1.667, y0;
      // av : 0 ligne de base, 1 bas, 2 milieu, 3 haut
      if (T.av === 3) y0 = hp;
      else if (T.av === 2) y0 = hp/2 - (n - 1)*pasL/2;
      else if (T.av === 1) y0 = -(n - 1)*pasL - hp*0.2;
      else y0 = 0;
      for (var k = 0; k < n; k++) ctx.fillText(T.l[k], 0, y0 + k*pasL);
      ctx.restore();
    }
    dessinerMesure();
  }

  // ================= Construction des tracés =================
  function construire(){
    seaux = []; remplis = [];
    var parCle = new Map();
    O = [isFinite(S.min[0]) ? (S.min[0] + S.max[0])/2 : 0, isFinite(S.min[1]) ? (S.min[1] + S.max[1])/2 : 0];
    S.polys.forEach(function(P){
      var k = P.c + "|" + P.col, B = parCle.get(k);
      if (!B){ B = { c: P.c, col: P.col, path: new Path2D() }; parCle.set(k, B); seaux.push(B); }
      var p = P.p;
      B.path.moveTo(p[0] - O[0], p[1] - O[1]);
      for (var q = 2; q < p.length; q += 2) B.path.lineTo(p[q] - O[0], p[q + 1] - O[1]);
    });
    S.fills.forEach(function(F){
      var path = new Path2D();
      F.contours.forEach(function(p){
        path.moveTo(p[0] - O[0], p[1] - O[1]);
        for (var q = 2; q < p.length; q += 2) path.lineTo(p[q] - O[0], p[q + 1] - O[1]);
        path.closePath();
      });
      remplis.push({ c: F.c, col: F.col, path: path, alpha: F.alpha });
    });
    grille = null;
    if (isFinite(S.min[0])) indexer();
  }

  // Grille de segments pour viser et accrocher (coordonnées relatives à O)
  function indexer(){
    var segs = [], ids = [];
    S.polys.forEach(function(P){
      var p = P.p;
      for (var q = 2; q < p.length; q += 2){ segs.push(p[q - 2] - O[0], p[q - 1] - O[1], p[q] - O[0], p[q + 1] - O[1]); ids.push(P.e, P.c); }
    });
    var n = ids.length/2;
    var mnx = S.min[0] - O[0], mny = S.min[1] - O[1], lx = Math.max(1e-9, S.max[0] - S.min[0]), ly = Math.max(1e-9, S.max[1] - S.min[1]);
    var N = Math.max(8, Math.min(512, Math.round(Math.sqrt(n/4)))), cx = lx/N, cy = ly/N, cases = new Map(), grands = [];
    for (var i = 0; i < n; i++){
      var x1 = segs[4*i], y1 = segs[4*i + 1], x2 = segs[4*i + 2], y2 = segs[4*i + 3];
      var i0 = Math.floor((Math.min(x1, x2) - mnx)/cx), i1 = Math.floor((Math.max(x1, x2) - mnx)/cx), j0 = Math.floor((Math.min(y1, y2) - mny)/cy), j1 = Math.floor((Math.max(y1, y2) - mny)/cy);
      if ((i1 - i0 + 1)*(j1 - j0 + 1) > 64){ grands.push(i); continue; }
      for (var a = i0; a <= i1; a++) for (var b = j0; b <= j1; b++){ var k = a*100003 + b, l = cases.get(k); if (!l) cases.set(k, l = []); l.push(i); }
    }
    grille = { segs: new Float64Array(segs), ids: ids, mnx: mnx, mny: mny, cx: cx, cy: cy, cases: cases, grands: grands };
  }
  function candidats(x, y, r){
    var G = grille, out = G.grands.slice(), vus = new Set();
    var i0 = Math.floor((x - r - G.mnx)/G.cx), i1 = Math.floor((x + r - G.mnx)/G.cx), j0 = Math.floor((y - r - G.mny)/G.cy), j1 = Math.floor((y + r - G.mny)/G.cy);
    if ((i1 - i0 + 1)*(j1 - j0 + 1) > 4096) return null;
    for (var a = i0; a <= i1; a++) for (var b = j0; b <= j1; b++){
      var l = G.cases.get(a*100003 + b);
      if (l) for (var q = 0; q < l.length; q++) if (!vus.has(l[q])){ vus.add(l[q]); out.push(l[q]); }
    }
    return out;
  }
  // Entité sous le curseur (segment le plus proche, calques visibles) ; -1 sinon
  function viser(px, py){
    if (!grille) return -1;
    var d = versDessin(px, py), r = 6/vue.s, L = candidats(d[0], d[1], r), G = grille, best = -1, bd = r;
    if (L) L.forEach(function(i){
      if (!S.calques[G.ids[2*i + 1]].visible) return;
      var x1 = G.segs[4*i], y1 = G.segs[4*i + 1], x2 = G.segs[4*i + 2], y2 = G.segs[4*i + 3];
      var dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy, t = l2 ? Math.max(0, Math.min(1, ((d[0] - x1)*dx + (d[1] - y1)*dy)/l2)) : 0;
      var e = Math.hypot(d[0] - x1 - t*dx, d[1] - y1 - t*dy);
      if (e < bd){ bd = e; best = G.ids[2*i]; }
    });
    if (best < 0){
      // texte sous le curseur
      for (var k = S.textes.length - 1; k >= 0; k--){
        var T = S.textes[k];
        if (!S.calques[T.c].visible) continue;
        var p = versEcran(T.x - O[0], T.y - O[1]), hp = T.h*vue.s;
        if (Math.abs(px - p[0]) < Math.max(8, hp*4) && Math.abs(py - p[1]) < Math.max(8, hp)) return T.e;
      }
    }
    return best;
  }
  // Accroche : extrémité, milieu ou point le plus proche d'un segment, à 10 px près
  function accrocher(px, py){
    var d = versDessin(px, py);
    if (!grille) return { p: d, type: "" };
    var r = 10/vue.s, L = candidats(d[0], d[1], r), G = grille, best = null, bd = r;
    if (L) L.forEach(function(i){
      if (!S.calques[G.ids[2*i + 1]].visible) return;
      var x1 = G.segs[4*i], y1 = G.segs[4*i + 1], x2 = G.segs[4*i + 2], y2 = G.segs[4*i + 3];
      [[x1, y1, "Extrémité"], [x2, y2, "Extrémité"], [(x1 + x2)/2, (y1 + y2)/2, "Milieu"]].forEach(function(c){
        var e = Math.hypot(d[0] - c[0], d[1] - c[1]);
        if (e < bd){ bd = e; best = { p: [c[0], c[1]], type: c[2] }; }
      });
    });
    if (best) return best;
    bd = 6/vue.s;
    if (L) L.forEach(function(i){
      if (!S.calques[G.ids[2*i + 1]].visible) return;
      var x1 = G.segs[4*i], y1 = G.segs[4*i + 1], x2 = G.segs[4*i + 2], y2 = G.segs[4*i + 3];
      var dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy, t = l2 ? Math.max(0, Math.min(1, ((d[0] - x1)*dx + (d[1] - y1)*dy)/l2)) : 0;
      var e = Math.hypot(d[0] - x1 - t*dx, d[1] - y1 - t*dy);
      if (e < bd){ bd = e; best = { p: [x1 + t*dx, y1 + t*dy], type: "Proche" }; }
    });
    return best || { p: d, type: "" };
  }

  // ================= Navigation =================
  function recadrer(){
    if (!S || !isFinite(S.min[0])){ demander(); return; }
    var lx = Math.max(1e-6, S.max[0] - S.min[0]), ly = Math.max(1e-6, S.max[1] - S.min[1]);
    vue.x = (S.min[0] + S.max[0])/2 - O[0]; vue.y = (S.min[1] + S.max[1])/2 - O[1];
    vue.s = Math.min((W - 40)/lx, (H - 40)/ly);
    if (!isFinite(vue.s) || vue.s <= 0) vue.s = 1;
    demander();
  }
  function zoomer(px, py, f){
    var a = versDessin(px, py);
    vue.s = Math.max(1e-9, Math.min(1e9, vue.s*f));
    var b = versDessin(px, py);
    vue.x += a[0] - b[0]; vue.y += a[1] - b[1];
    demander();
  }
  cv.addEventListener("wheel", function(e){
    e.preventDefault();
    var r = cv.getBoundingClientRect(), d = e.deltaMode === 1 ? e.deltaY*33 : e.deltaY;
    zoomer(e.clientX - r.left, e.clientY - r.top, Math.exp(-d*0.0015));
  }, { passive: false });
  var tir = null, pointeurs = new Map();
  cv.addEventListener("pointerdown", function(e){
    cv.setPointerCapture(e.pointerId);
    pointeurs.set(e.pointerId, [e.clientX, e.clientY]);
    tir = { x: e.clientX, y: e.clientY, vx: vue.x, vy: vue.y, bouge: false, bouton: e.button };
    if (pointeurs.size === 2){
      var P = Array.from(pointeurs.values());
      tir.pince = { d: Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]), s: vue.s };
    }
  });
  cv.addEventListener("pointermove", function(e){
    var r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (pointeurs.has(e.pointerId)) pointeurs.set(e.pointerId, [e.clientX, e.clientY]);
    if (tir && tir.pince && pointeurs.size === 2){
      var P = Array.from(pointeurs.values()), d = Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]);
      var mx = (P[0][0] + P[1][0])/2 - r.left, my = (P[0][1] + P[1][1])/2 - r.top;
      zoomer(mx, my, tir.pince.s*d/tir.pince.d/vue.s);
      return;
    }
    if (tir && (Math.abs(e.clientX - tir.x) + Math.abs(e.clientY - tir.y) > 3 || tir.bouge)){
      tir.bouge = true; cv.classList.add("tire");
      vue.x = tir.vx - (e.clientX - tir.x)/vue.s; vue.y = tir.vy + (e.clientY - tir.y)/vue.s;
      demander();
    }
    if (S){
      var d2 = versDessin(px, py);
      var a = mode === "mesure" ? accrocher(px, py) : null;
      if (a){ survol = a; demander(); d2 = a.p; }
      $("#coord").textContent = "X " + nb(d2[0] + O[0], 3) + "   Y " + nb(d2[1] + O[1], 3) + (a && a.type ? "   · " + a.type : "");
    }
  });
  var survol = null;
  function lacher(e){
    pointeurs.delete(e.pointerId);
    if (!tir) return;
    var r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (!tir.bouge && !tir.pince && tir.bouton === 0 && S){
      if (mode === "mesure"){
        var a = accrocher(px, py);
        if (mesure.length >= 2) mesure = [];
        mesure.push(a.p);
        if (mesure.length === 2) annoncerMesure();
        demander();
      } else choisir(viser(px, py));
    }
    cv.classList.remove("tire");
    if (!pointeurs.size) tir = null;
  }
  cv.addEventListener("pointerup", lacher);
  cv.addEventListener("pointercancel", lacher);
  cv.addEventListener("dblclick", function(){ if (mode !== "mesure") recadrer(); });
  document.addEventListener("keydown", function(e){
    if (e.target.closest && e.target.closest("input,textarea,select")) return;
    if (e.key === "Escape"){ if (mode){ outilMesure(false); } else choisir(-1); }
    else if (e.key === "f" || e.key === "F") recadrer();
  });

  // ================= Mesure =================
  function outilMesure(on){
    mode = on ? "mesure" : ""; mesure = []; survol = null;
    $('[data-c="mesure"]').setAttribute("aria-pressed", String(on));
    cv.classList.toggle("mesure", on);
    etat(on ? "Mesure : clique deux points (accroche aux extrémités et milieux). Échap pour sortir." : "");
    demander();
  }
  function annoncerMesure(){
    var a = mesure[0], b = mesure[1], dx = b[0] - a[0], dy = b[1] - a[1];
    etat("Distance " + nb(Math.hypot(dx, dy), 4) + " " + unite() + "   ΔX " + nb(dx, 4) + "   ΔY " + nb(dy, 4) + "   angle " + nb(Math.atan2(dy, dx)*180/Math.PI, 2) + "°");
  }
  function dessinerMesure(){
    if (mode !== "mesure") return;
    var c = getComputedStyle(document.documentElement).getPropertyValue("--or").trim() || "#60CDFF";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
    var pts = mesure.slice();
    if (pts.length === 1 && survol) pts.push(survol.p);
    if (pts.length === 2){
      var a = versEcran(pts[0][0], pts[0][1]), b = versEcran(pts[1][0], pts[1][1]);
      ctx.setLineDash(mesure.length === 2 ? [] : [6, 4]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      var dd = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      ctx.font = "600 13px " + getComputedStyle(document.body).fontFamily; ctx.textAlign = "center";
      ctx.lineWidth = 4; ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--vue-fond").trim();
      var t = nb(dd, 3) + " " + unite();
      ctx.strokeText(t, (a[0] + b[0])/2, (a[1] + b[1])/2 - 8); ctx.fillText(t, (a[0] + b[0])/2, (a[1] + b[1])/2 - 8);
      ctx.strokeStyle = c; ctx.lineWidth = 2;
    }
    pts.forEach(function(p){ var q = versEcran(p[0], p[1]); ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, 2*Math.PI); ctx.fill(); });
    if (survol && survol.type){ var q = versEcran(survol.p[0], survol.p[1]); ctx.strokeRect(q[0] - 6, q[1] - 6, 12, 12); }
  }
  function unite(){ return S && DXF.UNITES[S.unites] && S.unites ? DXF.UNITES[S.unites] : ""; }

  // ================= Sélection et propriétés =================
  function choisir(i){
    choisi = i; cheminChoisi = null;
    if (i >= 0){
      var E = S.ents[i], path = new Path2D(), pr = E.prims;
      for (var q = pr[0]; q < pr[1]; q++){
        var p = S.polys[q].p;
        path.moveTo(p[0] - O[0], p[1] - O[1]);
        for (var z = 2; z < p.length; z += 2) path.lineTo(p[z] - O[0], p[z + 1] - O[1]);
      }
      cheminChoisi = path;
      replier("d", false);
    }
    proprietes();
    demander();
  }
  function ligneProp(k, v){ return "<tr><th>" + esc(k) + "</th><td>" + v + "</td></tr>"; }
  function valeurProp(v){
    if (Array.isArray(v)) return '<span class="mono">' + nb(v[0], 4) + " ; " + nb(v[1], 4) + "</span>";
    if (typeof v === "number") return '<span class="mono">' + nb(v, 4) + "</span>";
    return esc(v);
  }
  function proprietes(){
    var f = $("#props");
    if (!S){ f.innerHTML = '<div class="vide-p">Ouvre un DXF pour voir ses informations.</div>'; return; }
    if (choisi < 0){
      var lx = S.max[0] - S.min[0], ly = S.max[1] - S.min[1], types = Object.keys(S.types).sort(function(a, b){ return S.types[b] - S.types[a]; });
      var ign = Object.keys(S.ignores);
      f.innerHTML = '<div class="tete"><h2>' + esc(S.nom) + '</h2><div class="sous">Clique un objet du dessin pour voir ses propriétés.</div></div>' +
        '<div class="carte"><h3>Fichier</h3><table class="tbl">' +
        ligneProp("Version", esc((DXF.VERSIONS[S.version] || "") + (S.version ? " (" + S.version + ")" : "inconnue"))) +
        ligneProp("Unités", esc(DXF.UNITES[S.unites] || "non précisées")) +
        ligneProp("Étendue", isFinite(lx) ? '<span class="mono">' + nb(lx, 2) + " × " + nb(ly, 2) + "</span> " + esc(unite()) : "—") +
        ligneProp("Calques", S.calques.length) + ligneProp("Blocs", S.blocs) +
        ligneProp("Lecture", nb(S.duree/1000, 2) + " s") +
        "</table></div>" +
        '<div class="carte"><h3>Objets de l\'espace objet</h3><table class="tbl">' + types.map(function(t){ return ligneProp(t, '<span class="mono">' + S.types[t] + "</span>"); }).join("") + "</table>" +
        (S.papier ? '<p class="note">' + S.papier + " objet(s) de l'espace papier non affichés.</p>" : "") +
        (ign.length ? '<p class="note">Non dessinés : ' + esc(ign.map(function(t){ return t + " (" + S.ignores[t] + ")"; }).join(", ")) + ".</p>" : "") + "</div>";
      return;
    }
    var E = S.ents[choisi], L = S.calques[E.calque], c = E.couleur;
    var nomCoul = c === 256 ? "DuCalque" : c === 0 ? "DuBloc" : "ACI " + c;
    var h = '<div class="tete"><h2>' + esc(E.type) + '</h2><div class="sous">Calque ' + esc(L.nom) + '</div><button type="button" class="fermer" title="Fermer">×</button></div><div class="carte"><table class="tbl">' +
      ligneProp("Calque", '<i class="pastille" style="--c:' + css(L.couleur) + '"></i>' + esc(L.nom)) +
      ligneProp("Couleur", esc(nomCoul)) + (E.handle ? ligneProp("Handle", '<span class="mono">' + esc(E.handle) + "</span>") : "");
    Object.keys(E.info).forEach(function(k){ h += ligneProp(k, valeurProp(E.info[k])); });
    f.innerHTML = h + "</table></div>";
  }
  $("#props").addEventListener("click", function(e){ if (e.target.closest(".fermer")) choisir(-1); });

  // ================= Calques =================
  var filtre = "";
  function calques(){
    var el = $("#calques");
    if (!S){ el.innerHTML = '<div class="vide-p">Aucun dessin ouvert.</div>'; $("#n-calques").textContent = ""; return; }
    var L = S.calques.map(function(c, i){ return i; }).filter(function(i){ return !filtre || S.calques[i].nom.toLowerCase().indexOf(filtre) >= 0; })
      .sort(function(a, b){ return S.calques[a].nom.localeCompare(S.calques[b].nom, "fr", { numeric: true }); });
    var vis = S.calques.filter(function(c){ return c.visible; }).length;
    $("#n-calques").textContent = vis + " / " + S.calques.length + " visibles";
    el.innerHTML = L.map(function(i){
      var c = S.calques[i];
      return '<label class="calque' + (c.visible ? "" : " off") + '" title="Clic : afficher ou masquer · double-clic : isoler"><input type="checkbox" data-i="' + i + '"' + (c.visible ? " checked" : "") + '>' +
        '<i class="pastille" style="--c:' + css(c.couleur) + '"></i><span class="nom">' + esc(c.nom) + "</span>" + (c.gele ? '<span class="gel" title="Gelé dans le fichier">❄</span>' : "") + '<span class="n">' + c.n + "</span></label>";
    }).join("") || '<div class="vide-p">Aucun calque ne correspond.</div>';
  }
  $("#calques").addEventListener("change", function(e){
    var i = e.target.getAttribute("data-i");
    if (i === null) return;
    S.calques[+i].visible = e.target.checked;
    calques(); demander();
  });
  $("#calques").addEventListener("dblclick", function(e){
    var l = e.target.closest(".calque");
    if (!l) return;
    e.preventDefault();
    var i = +l.querySelector("input").getAttribute("data-i");
    S.calques.forEach(function(c, k){ c.visible = k === i; });
    calques(); demander();
  });
  $("#f-calque").addEventListener("input", function(){ filtre = this.value.trim().toLowerCase(); calques(); });
  $("#tous").addEventListener("click", function(){ if (S){ S.calques.forEach(function(c){ c.visible = true; }); calques(); demander(); } });
  $("#aucun").addEventListener("click", function(){ if (S){ S.calques.forEach(function(c){ c.visible = false; }); calques(); demander(); } });

  // ================= Ouverture =================
  function etat(t){ $("#etat").textContent = t || ""; }
  function ouvrir(f){
    if (!f) return;
    if (/\.dwg$/i.test(f.name)){ etat("Les DWG ne s'ouvrent pas encore ici : enregistre-le en DXF depuis AutoCAD ou Revit."); return; }
    if (!/\.dxf$/i.test(f.name)){ etat("Choisis un fichier .dxf."); return; }
    $("#chargement").hidden = false; $("#chargement-txt").textContent = "Lecture de « " + f.name + " »…";
    var t0 = performance.now();
    f.arrayBuffer().then(function(buf){
      return new Promise(function(ok){ setTimeout(ok, 30); }).then(function(){ return DXF.lire(buf, f.name); });
    }).then(function(sc){
      S = sc; choisi = -1; cheminChoisi = null; mesure = [];
      construire();
      $("#accueil").hidden = true; $("#outils").hidden = false;
      document.title = f.name + " · Visionneuse DXF · STR Bim Tools";
      calques(); proprietes(); recadrer();
      $("#chargement").hidden = true;
      etat(f.name + " · " + S.ents.length + " objets · " + S.calques.length + " calques · ouvert en " + nb((performance.now() - t0)/1000, 2) + " s");
    }).catch(function(err){
      $("#chargement").hidden = true;
      etat("Lecture impossible : " + (err && err.message || err));
      if (window.console) console.error(err);
    });
  }
  $("#fichier").addEventListener("change", function(){ ouvrir(this.files[0]); this.value = ""; });
  function choisirFichier(){ $("#fichier").click(); }
  $("#btn-ouvrir").addEventListener("click", choisirFichier);
  $("#btn-ouvrir2").addEventListener("click", choisirFichier);
  ["dragenter", "dragover"].forEach(function(t){ document.addEventListener(t, function(e){ e.preventDefault(); centre.classList.add("survol"); }); });
  ["dragleave", "drop"].forEach(function(t){ document.addEventListener(t, function(e){ e.preventDefault(); if (t === "drop" || !e.relatedTarget) centre.classList.remove("survol"); }); });
  document.addEventListener("drop", function(e){ var f = e.dataTransfer && e.dataTransfer.files; if (f && f.length) ouvrir(f[0]); });

  // ================= Barre d'outils, panneaux, thème =================
  $("#outils").addEventListener("click", function(e){
    var b = e.target.closest("[data-c]");
    if (!b) return;
    var c = b.getAttribute("data-c");
    if (c === "cadrer") recadrer();
    else if (c === "mesure") outilMesure(mode !== "mesure");
  });
  function replier(cote, oui){
    var app = $(".app"), b = $("#rep-" + cote), quoi = cote === "g" ? "les calques" : "les propriétés";
    app.classList.toggle("sans-" + cote, oui);
    b.textContent = (cote === "g") === oui ? "›" : "‹";
    b.title = (oui ? "Afficher " : "Réduire ") + quoi;
    b.setAttribute("aria-expanded", String(!oui));
  }
  ["g", "d"].forEach(function(c){
    replier(c, false);
    $("#rep-" + c).addEventListener("click", function(){ replier(c, !$(".app").classList.contains("sans-" + c)); });
  });
  $("#btn-theme").addEventListener("click", function(){
    var c = clair() ? "sombre" : "clair";
    document.documentElement.setAttribute("data-theme", c);
    document.querySelector("meta[name=theme-color]").setAttribute("content", c === "clair" ? "#F3F3F3" : "#202020");
    lsSet("dxf.theme", c);
    if (S){ calques(); proprietes(); }
    demander();
  });
  calques(); proprietes(); taille();
})();
