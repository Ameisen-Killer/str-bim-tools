/* STR Bim Tools · DXF Studio, mode 3D : vue 3D en fil de fer (projection orthogonale), cube de navigation
 * d'IFC Studio (/ifc/ifc-cube.js), sélection, accroche, et outils pour retravailler un modèle analytique :
 * aligner, prolonger jusqu'à, raccorder en coin, déplacer / copier, fusionner les nœuds, cote Z, ligne,
 * supprimer, changer de calque, coordonnées des sommets, annuler / rétablir.
 * Le dessin est un document DXF3D (dxf-3d.js) : lignes, polylignes et points ; le reste du fichier n'est pas repris.
 * Repère de la caméra comme IFC Studio : lacet autour de Z, plongée ; droite = [cos l, sin l, 0]. */
(function(){
  "use strict";
  var $ = function(s){ return document.querySelector(s); };
  var PI = Math.PI, DEMI = PI/2;
  var cv = $("#vue3d"), ctx = cv.getContext("2d"), centre = $("#centre");
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nb(x, d){ return (Math.round(x*Math.pow(10, d))/Math.pow(10, d)).toLocaleString("fr-CH", { maximumFractionDigits: d }); }
  function etat(t){ $("#etat").textContent = t || ""; }

  var doc = null, nomDoc = "", actif = false, modifie = false;
  var yaw = PI/4, pitch = Math.atan(Math.SQRT1_2), s = 1, px = 0, py = 0, C = [0, 0, 0];
  var W = 0, H = 0, dpr = 1, besoin = false, anim = null;
  var proj = [];                 // coordonnées écran de chaque entité (Float64Array x, y…), null si masquée
  var sel = new Set();           // entités choisies (objets de doc.entites)
  var survol = null, accroche = null, souris = null, cadre = null;
  var outil = null, et = null;   // outil en cours et son état
  var annul = [], retab = [];
  var calqueCourant = "0", zTravail = 0, filtre = "";

  // ================= Couleurs =================
  function clair(){ return document.documentElement.getAttribute("data-theme") === "clair"; }
  function hex(c){ return "#" + ("00000" + c.toString(16)).slice(-6); }
  function couleurAci(i){
    var col = window.DXF && DXF.ACI ? DXF.ACI[i] : -1;
    if (col === undefined || col === -1) return clair() ? "#000000" : "#FFFFFF";
    var r = col >> 16 & 255, g = col >> 8 & 255, b = col & 255, l = (r*299 + g*587 + b*114)/1000;
    if (!clair() && l < 40) return "#5A5A5A";
    if (clair() && l > 225) return "#8A8A8A";
    return hex(col);
  }
  function accent(){ return getComputedStyle(document.documentElement).getPropertyValue("--or").trim() || "#60CDFF"; }
  function calqueDe(nom){ for (var i = 0; i < doc.calques.length; i++) if (doc.calques[i].nom === nom) return doc.calques[i]; return null; }
  function couleurDe(e){ var c = calqueDe(e.calque); return couleurAci(e.couleur != null ? e.couleur : c ? c.couleur : 7); }
  function visible(e){ var c = calqueDe(e.calque); return !c || c.visible !== false; }

  // ================= Caméra =================
  function base(){
    var ca = Math.cos(yaw), sa = Math.sin(yaw), cb = Math.cos(pitch), sb = Math.sin(pitch);
    return { r: [ca, sa, 0], u: [-sb*sa, sb*ca, cb], e: [cb*sa, -cb*ca, sb] };
  }
  function ecran(p, B){
    var d0 = p[0] - C[0], d1 = p[1] - C[1], d2 = p[2] - C[2];
    return [W/2 + px + s*(d0*B.r[0] + d1*B.r[1]), H/2 + py - s*(d0*B.u[0] + d1*B.u[1] + d2*B.u[2])];
  }
  // point de l'écran ramené sur le plan horizontal z = z0 (le plan de la vue si on regarde de côté)
  function monde(x, y, z0){
    var B = base(), a = (x - W/2 - px)/s, b = -(y - H/2 - py)/s;
    var P = [C[0] + B.r[0]*a + B.u[0]*b, C[1] + B.r[1]*a + B.u[1]*b, C[2] + B.u[2]*b];
    if (Math.abs(B.e[2]) > 1e-3){ var t = (z0 - P[2])/B.e[2]; P = [P[0] + B.e[0]*t, P[1] + B.e[1]*t, z0]; }
    return P;
  }
  function cadrer(){
    if (!doc) return;
    var E = DXF3D.etendue(doc, true);
    if (E.vide) E = DXF3D.etendue(doc);
    C = [0, 1, 2].map(function(i){ return (E.min[i] + E.max[i])/2; });
    var B = base(), lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    doc.entites.forEach(function(e){
      if (!visible(e)) return;
      e.pts.forEach(function(p){
        var d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]], u = d[0]*B.r[0] + d[1]*B.r[1], v = d[0]*B.u[0] + d[1]*B.u[1] + d[2]*B.u[2];
        if (u < lo[0]) lo[0] = u; if (u > hi[0]) hi[0] = u; if (v < lo[1]) lo[1] = v; if (v > hi[1]) hi[1] = v;
      });
    });
    if (!isFinite(lo[0])){ lo = [-1, -1]; hi = [1, 1]; }
    var w = Math.max(hi[0] - lo[0], 1e-6), h = Math.max(hi[1] - lo[1], 1e-6);
    s = Math.min((W - 80)/w, (H - 80)/h);
    if (!isFinite(s) || s <= 0) s = 1;
    if (w < 1e-5 && h < 1e-5) s = Math.min(W, H)/10;
    px = -s*(lo[0] + hi[0])/2; py = s*(lo[1] + hi[1])/2;
    demander();
  }
  // vue animée vers une orientation (cube) ; cad : recadrer, sinon tourner autour du centre de l'écran
  function allerVers(l, p, duree, cad){
    p = Math.max(-DEMI, Math.min(DEMI, p));
    if (!cad){
      var B = base(), a = -px/s, b = py/s;
      C = [C[0] + B.r[0]*a + B.u[0]*b, C[1] + B.r[1]*a + B.u[1]*b, C[2] + B.u[2]*b];
      px = py = 0;
    }
    var l0 = yaw, dl = l - yaw, p0 = pitch, t0 = 0, d = duree == null ? 700 : duree, jeton = {};
    dl -= 2*PI*Math.round(dl/(2*PI));
    anim = jeton;
    function pas(t){
      if (anim !== jeton) return;
      if (!t0) t0 = t;
      var u = d ? Math.min(1, (t - t0)/d) : 1, k = u < .5 ? 4*u*u*u : 1 - Math.pow(2 - 2*u, 3)/2;
      yaw = l0 + dl*k; pitch = p0 + (p - p0)*k;
      if (cad) cadrer();
      demander();
      if (u < 1) requestAnimationFrame(pas);
      else { anim = null; yaw -= 2*PI*Math.round(yaw/(2*PI)); }
    }
    requestAnimationFrame(pas);
  }
  var cube = null, vueCube = {
    allerVers: allerVers,
    tourner: function(dl, dp){ anim = null; yaw += dl; pitch = Math.max(-DEMI, Math.min(DEMI, pitch + dp)); demander(); },
    finTourner: function(){ demander(); }
  };
  function vueMaison(){ allerVers(PI/4, Math.atan(Math.SQRT1_2), null, true); }
  if (window.IFCCube) cube = IFCCube.creer($("#cube3d"), vueCube, { maison: vueMaison });

  // ================= Rendu =================
  function taille(){
    if (!actif) return;
    var r = centre.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    if (cube) cube.redessiner();
    demander();
  }
  if ("ResizeObserver" in window) new ResizeObserver(taille).observe(centre); else window.addEventListener("resize", taille);
  new MutationObserver(function(){ if (actif){ calques(); proprietes(); demander(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function demander(){ if (!besoin){ besoin = true; requestAnimationFrame(rendre); } }

  function trace(P, ferme){
    ctx.moveTo(P[0], P[1]);
    for (var j = 2; j < P.length; j += 2) ctx.lineTo(P[j], P[j + 1]);
    if (ferme) ctx.lineTo(P[0], P[1]);
  }
  function traceEnt(e, P){
    if (e.type === "POINT"){ ctx.moveTo(P[0] - 4, P[1]); ctx.lineTo(P[0] + 4, P[1]); ctx.moveTo(P[0], P[1] - 4); ctx.lineTo(P[0], P[1] + 4); }
    else trace(P, e.ferme);
  }
  function rendre(){
    besoin = false;
    if (!actif) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (cube) cube.camera(yaw, pitch);
    if (!doc) return;
    var B = base(), parCouleur = new Map();
    proj = new Array(doc.entites.length);
    doc.entites.forEach(function(e, i){
      if (!visible(e)) { proj[i] = null; return; }
      var P = new Float64Array(e.pts.length*2);
      e.pts.forEach(function(p, j){ var q = ecran(p, B); P[2*j] = q[0]; P[2*j + 1] = q[1]; });
      proj[i] = P;
      var c = couleurDe(e), l = parCouleur.get(c);
      if (!l) parCouleur.set(c, l = []);
      l.push(i);
    });
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // repère au point 0, 0, 0
    var o = ecran([0, 0, 0], B), lg = 40;
    [[1, 0, 0, "#E5484D"], [0, 1, 0, "#46A758"], [0, 0, 1, "#3E8EED"]].forEach(function(a){
      var q = ecran([a[0]*lg/s, a[1]*lg/s, a[2]*lg/s], B);
      ctx.strokeStyle = a[3]; ctx.globalAlpha = .7; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.lineWidth = 1.2;
    parCouleur.forEach(function(l, c){
      ctx.strokeStyle = c; ctx.beginPath();
      l.forEach(function(i){ traceEnt(doc.entites[i], proj[i]); });
      ctx.stroke();
    });
    var ac = accent();
    // référence de l'outil en cours (aligner, prolonger, coin)
    if (et && et.ref){ var ir = doc.entites.indexOf(et.ref.e); if (ir >= 0 && proj[ir]){ ctx.strokeStyle = "#F5A524"; ctx.lineWidth = 3; ctx.beginPath(); traceEnt(et.ref.e, proj[ir]); ctx.stroke(); } }
    if (sel.size){
      ctx.strokeStyle = ac; ctx.lineWidth = 2.6; ctx.beginPath();
      doc.entites.forEach(function(e, i){ if (sel.has(e) && proj[i]) traceEnt(e, proj[i]); });
      ctx.stroke();
    }
    if (survol && !sel.has(survol.e)){
      var is = doc.entites.indexOf(survol.e);
      if (is >= 0 && proj[is]){ ctx.strokeStyle = ac; ctx.globalAlpha = .55; ctx.lineWidth = 2.2; ctx.beginPath(); traceEnt(survol.e, proj[is]); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    apercu(B, ac);
    if (accroche){
      var q = ecran(accroche.p, B);
      ctx.strokeStyle = ac; ctx.lineWidth = 1.6;
      if (accroche.type === "Milieu"){ ctx.beginPath(); ctx.moveTo(q[0], q[1] - 7); ctx.lineTo(q[0] + 7, q[1] + 6); ctx.lineTo(q[0] - 7, q[1] + 6); ctx.closePath(); ctx.stroke(); }
      else if (accroche.type === "Proche"){ ctx.beginPath(); ctx.moveTo(q[0] - 6, q[1] - 6); ctx.lineTo(q[0] + 6, q[1] + 6); ctx.moveTo(q[0] + 6, q[1] - 6); ctx.lineTo(q[0] - 6, q[1] + 6); ctx.stroke(); }
      else ctx.strokeRect(q[0] - 6, q[1] - 6, 12, 12);
    }
    if (cadre){
      var x0 = Math.min(cadre.x0, cadre.x1), y0 = Math.min(cadre.y0, cadre.y1), w = Math.abs(cadre.x1 - cadre.x0), h = Math.abs(cadre.y1 - cadre.y0);
      var croise = cadre.x1 < cadre.x0;
      ctx.fillStyle = croise ? "rgba(70,167,88,.12)" : "rgba(62,142,237,.12)"; ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = croise ? "#46A758" : "#3E8EED"; ctx.lineWidth = 1; ctx.setLineDash(croise ? [6, 4] : []);
      ctx.strokeRect(x0 + .5, y0 + .5, w, h); ctx.setLineDash([]);
    }
  }
  // aperçu de l'outil en cours : élastique, sélection déplacée
  function apercu(B, ac){
    if (!et || !souris) return;
    var p = accroche ? accroche.p : monde(souris.x, souris.y, et.base ? et.base[2] : zTravail);
    ctx.strokeStyle = ac; ctx.lineWidth = 1.4; ctx.setLineDash([6, 4]);
    if ((outil === "deplacer" || outil === "copier") && et.base){
      var d = [p[0] - et.base[0], p[1] - et.base[1], p[2] - et.base[2]];
      ctx.beginPath();
      sel.forEach(function(e){
        var P = [];
        e.pts.forEach(function(q){ var r = ecran([q[0] + d[0], q[1] + d[1], q[2] + d[2]], B); P.push(r[0], r[1]); });
        traceEnt(e, P);
      });
      var a = ecran(et.base, B), b = ecran(p, B);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    } else if ((outil === "ligne" || outil === "mesure") && et.base){
      var a2 = ecran(et.base, B), b2 = ecran(p, B);
      ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
      if (outil === "mesure"){
        ctx.setLineDash([]);
        var dd = Math.hypot(p[0] - et.base[0], p[1] - et.base[1], p[2] - et.base[2]), t = nb(dd, 3) + " " + doc.unite;
        ctx.font = "600 13px " + getComputedStyle(document.body).fontFamily; ctx.textAlign = "center";
        ctx.lineWidth = 4; ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--vue-fond").trim();
        ctx.strokeText(t, (a2[0] + b2[0])/2, (a2[1] + b2[1])/2 - 8);
        ctx.fillStyle = ac; ctx.fillText(t, (a2[0] + b2[0])/2, (a2[1] + b2[1])/2 - 8);
      }
    }
    ctx.setLineDash([]);
  }

  // ================= Viser, accrocher =================
  function distSeg(x, y, x1, y1, x2, y2){
    var dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy, t = l2 ? Math.max(0, Math.min(1, ((x - x1)*dx + (y - y1)*dy)/l2)) : 0;
    return { d: Math.hypot(x - x1 - t*dx, y - y1 - t*dy), t: t };
  }
  // entité sous le curseur : { e, seg (indice du côté), t (position sur ce côté) } ou null
  function viser(x, y, r){
    if (!doc) return null;
    var best = null, bd = r || 7;
    doc.entites.forEach(function(e, i){
      var P = proj[i];
      if (!P) return;
      if (e.type === "POINT"){ var d0 = Math.hypot(x - P[0], y - P[1]); if (d0 < bd){ bd = d0; best = { e: e, seg: 0, t: 0 }; } return; }
      var n = e.pts.length, segs = n - 1 + (e.ferme ? 1 : 0);
      for (var j = 0; j < segs; j++){
        var k = (j + 1) % n, q = distSeg(x, y, P[2*j], P[2*j + 1], P[2*k], P[2*k + 1]);
        if (q.d < bd){ bd = q.d; best = { e: e, seg: j, t: q.t }; }
      }
    });
    return best;
  }
  function lerp(a, b, t){ return [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t, a[2] + (b[2] - a[2])*t]; }
  function bout(e, j){ return [e.pts[j], e.pts[(j + 1) % e.pts.length]]; }
  // accroche : extrémité ou sommet, milieu, sinon point le plus proche d'un côté
  function accrocher(x, y){
    if (!doc) return null;
    var best = null, bd = 10;
    doc.entites.forEach(function(e, i){
      var P = proj[i];
      if (!P) return;
      var n = e.pts.length;
      for (var j = 0; j < n; j++){
        var d = Math.hypot(x - P[2*j], y - P[2*j + 1]);
        if (d < bd){ bd = d; best = { p: e.pts[j].slice(), type: "Extrémité" }; }
      }
      var segs = n - 1 + (e.ferme ? 1 : 0);
      for (j = 0; j < segs; j++){
        var k = (j + 1) % n, d2 = Math.hypot(x - (P[2*j] + P[2*k])/2, y - (P[2*j + 1] + P[2*k + 1])/2);
        if (d2 < bd){ bd = d2; best = { p: lerp(e.pts[j], e.pts[k], .5), type: "Milieu" }; }
      }
    });
    if (best) return best;
    var v = viser(x, y, 7);
    if (v && v.e.type !== "POINT"){ var b = bout(v.e, v.seg); return { p: lerp(b[0], b[1], v.t), type: "Proche" }; }
    return null;
  }
  function pointSouris(x, y){ var a = accrocher(x, y); if (a){ zTravail = a.p[2]; return a.p; } return monde(x, y, zTravail); }

  // ================= Annuler, rétablir =================
  function instantane(){ return JSON.stringify({ c: doc.calques, e: doc.entites }); }
  function memoriser(){
    annul.push(instantane());
    if (annul.length > 40) annul.shift();
    retab = [];
    modifie = true;
  }
  function restaurer(t){
    var o = JSON.parse(t);
    doc.calques = o.c; doc.entites = o.e;
    sel.clear(); survol = null;
    modifie = true;
    majTout();
  }
  function annuler(){ if (!annul.length){ etat("Rien à annuler."); return; } retab.push(instantane()); restaurer(annul.pop()); etat("Annulé."); }
  function retablir(){ if (!retab.length){ etat("Rien à rétablir."); return; } annul.push(instantane()); restaurer(retab.pop()); etat("Rétabli."); }
  function majTout(){ calques(); proprietes(); demander(); }

  // ================= Géométrie en plan =================
  function d2(a, b){ return [b[0] - a[0], b[1] - a[1]]; }
  function long2(v){ return Math.hypot(v[0], v[1]); }
  // intersection en plan des droites (a, b) et (c, d) : paramètre t sur (a, b), ou null si parallèles
  function interT(a, b, c, d){
    var r = d2(a, b), q = d2(c, d), den = r[0]*q[1] - r[1]*q[0];
    if (Math.abs(den) < 1e-12*Math.max(1, long2(r)*long2(q))) return null;
    return ((c[0] - a[0])*q[1] - (c[1] - a[1])*q[0])/den;
  }
  function translater(e, v){ e.pts = e.pts.map(function(p){ return [p[0] + v[0], p[1] + v[1], p[2] + v[2]]; }); }
  function tournerPlan(e, o, ang){
    var c = Math.cos(ang), sn = Math.sin(ang);
    e.pts = e.pts.map(function(p){ var x = p[0] - o[0], y = p[1] - o[1]; return [o[0] + c*x - sn*y, o[1] + sn*x + c*y, p[2]]; });
  }
  function milieu(e){ return lerp(e.pts[0], e.pts[e.pts.length - 1], .5); }
  function proche(a, b, tol){ return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol && Math.abs(a[2] - b[2]) < tol; }
  // croix d'un poteau : lignes de même milieu (l'autre branche) et axe vertical qui part de ce point
  function partenaires(e){
    var out = [e];
    if (e.type !== "LIGNE") return out;
    var m = milieu(e), tol = 1e-3;
    doc.entites.forEach(function(f){
      if (f === e || f.type !== "LIGNE") return;
      if (proche(milieu(f), m, tol)) out.push(f);
      else if (long2(d2(f.pts[0], f.pts[1])) < tol && (proche(f.pts[0], m, tol) || proche(f.pts[1], m, tol))) out.push(f);
    });
    return out;
  }
  function angleSeg(a, b){ return Math.atan2(b[1] - a[1], b[0] - a[0]); }
  function ecartAngle(a1, a2){ var d = a2 - a1; d -= PI*Math.round(d/PI); return d; }   // modulo 180°

  // ================= Commandes =================
  function exigeSel(){ if (!sel.size){ etat("Choisis d'abord des objets (clic, Ctrl + clic, ou Ctrl + glisser pour une fenêtre)."); return false; } return true; }
  function supprimer(){
    if (!exigeSel()) return;
    memoriser();
    var n = sel.size;
    doc.entites = doc.entites.filter(function(e){ return !sel.has(e); });
    sel.clear(); survol = null;
    majTout(); etat(n + " objet(s) supprimé(s).");
  }
  function deplacerDe(v, copie, nbCopies){
    memoriser();
    var nouv = [];
    if (copie){
      for (var k = 1; k <= (nbCopies || 1); k++) sel.forEach(function(e){
        var c = JSON.parse(JSON.stringify(e)); translater(c, [v[0]*k, v[1]*k, v[2]*k]); doc.entites.push(c); nouv.push(c);
      });
      sel = new Set(nouv);
    } else sel.forEach(function(e){ translater(e, v); });
    majTout();
    etat((copie ? nouv.length + " copie(s)" : sel.size + " objet(s) déplacé(s)") + " de " + nb(v[0], 3) + " ; " + nb(v[1], 3) + " ; " + nb(v[2], 3) + " " + doc.unite + ".");
  }
  function dlgDeplacer(copie){
    if (!exigeSel()) return;
    var ch = [{ id: "dx", l: "ΔX", v: 0 }, { id: "dy", l: "ΔY", v: 0 }, { id: "dz", l: "ΔZ", v: 0 }];
    if (copie) ch.push({ id: "n", l: "Nombre de copies", v: 1, min: 1 });
    dialogue(copie ? "Copier la sélection" : "Déplacer la sélection", ch, function(r){
      if (!r.dx && !r.dy && !r.dz) return;
      deplacerDe([r.dx, r.dy, r.dz], copie, Math.max(1, Math.round(r.n || 1)));
    });
  }
  function dlgCoteZ(){
    if (!exigeSel()) return;
    var z0 = null;
    sel.forEach(function(e){ if (z0 === null) z0 = e.pts[0][2]; });
    dialogue("Mettre à la cote Z", [{ id: "z", l: "Cote Z (" + doc.unite + ")", v: Math.round((z0 || 0)*1e4)/1e4 }], function(r){
      memoriser();
      sel.forEach(function(e){ e.pts.forEach(function(p){ p[2] = r.z; }); });
      majTout(); etat(sel.size + " objet(s) mis à Z = " + nb(r.z, 4) + " " + doc.unite + ".");
    });
  }
  // nœuds proches fusionnés au point moyen (extrémités et sommets, sélection ou calques visibles)
  function dlgNoeuds(){
    if (!doc) return;
    dialogue("Fusionner les nœuds proches", [{ id: "tol", l: "Tolérance (" + doc.unite + ")", v: doc.unite === "mm" ? 50 : doc.unite === "cm" ? 5 : .05, min: 0 }], function(r){
      var tol = Math.abs(r.tol);
      if (!tol) return;
      var liste = (sel.size ? Array.from(sel) : doc.entites.filter(visible)).filter(function(e){ return e.type !== "POINT"; });
      var pts = [];
      liste.forEach(function(e){ e.pts.forEach(function(p, j){ pts.push({ e: e, j: j, p: p }); }); });
      var parent = pts.map(function(_, i){ return i; });
      function racine(i){ while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
      var grille = new Map();
      function cle(a, b, c){ return a + "," + b + "," + c; }
      pts.forEach(function(q, i){
        var g = [Math.floor(q.p[0]/tol), Math.floor(q.p[1]/tol), Math.floor(q.p[2]/tol)];
        for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c = -1; c <= 1; c++){
          var l = grille.get(cle(g[0] + a, g[1] + b, g[2] + c));
          if (l) l.forEach(function(k){
            if (pts[k].e === q.e) return;   // jamais deux sommets du même objet (croix, petits côtés)
            if (Math.hypot(pts[k].p[0] - q.p[0], pts[k].p[1] - q.p[1], pts[k].p[2] - q.p[2]) <= tol) parent[racine(k)] = racine(i);
          });
        }
        var k0 = cle(g[0], g[1], g[2]), l0 = grille.get(k0);
        if (!l0) grille.set(k0, l0 = []);
        l0.push(i);
      });
      var groupes = new Map();
      pts.forEach(function(q, i){ var r0 = racine(i), l = groupes.get(r0); if (!l) groupes.set(r0, l = []); l.push(q); });
      var nG = 0, nP = 0, chg = [];
      groupes.forEach(function(l){
        if (l.length < 2) return;
        var m = [0, 0, 0];
        l.forEach(function(q){ m[0] += q.p[0]/l.length; m[1] += q.p[1]/l.length; m[2] += q.p[2]/l.length; });
        var bouge = l.some(function(q){ return !proche(q.p, m, 1e-9); });
        if (!bouge) return;
        nG++; nP += l.length;
        chg.push({ l: l, m: m });
      });
      if (!nG){ etat("Aucun nœud à fusionner à " + nb(tol, 4) + " " + doc.unite + " près."); return; }
      memoriser();
      chg.forEach(function(c){ c.l.forEach(function(q){ q.e.pts[q.j] = c.m.slice(); }); });
      majTout(); etat(nG + " nœud(s) fusionné(s), " + nP + " extrémités recalées.");
    });
  }
  // aligner : la cible (et sa croix de poteau, ou la sélection qui la contient) vient sur la droite de référence, en plan
  function aligner(ref, cible){
    var a = bout(ref.e, ref.seg), ar = angleSeg(a[0], a[1]);
    if (long2(d2(a[0], a[1])) < 1e-9){ etat("La référence est verticale : choisis une ligne vue en plan."); return false; }
    var groupe = sel.has(cible.e) ? Array.from(sel) : partenaires(cible.e), b = bout(cible.e, cible.seg), ang = ecartAngle(ar, angleSeg(b[0], b[1]));
    var croix = groupe.length > 1 && !sel.has(cible.e);
    if (long2(d2(b[0], b[1])) < 1e-9 || (Math.abs(ang) > 20*PI/180 && !croix)){
      etat("Aligne une ligne presque parallèle à la référence (moins de 20°), ou la croix d'un poteau.");
      return false;
    }
    memoriser();
    var m = lerp(b[0], b[1], .5);
    // presque parallèle (et seule) : remise parallèle autour de son milieu
    if (!croix && Math.abs(ang) > 1e-9 && groupe.length === 1) tournerPlan(cible.e, m, -ang);
    var n = [-Math.sin(ar), Math.cos(ar)], dist = (m[0] - a[0][0])*n[0] + (m[1] - a[0][1])*n[1];
    groupe.forEach(function(e){ translater(e, [-n[0]*dist, -n[1]*dist, 0]); });
    majTout();
    etat("Aligné (" + nb(Math.abs(dist), 4) + " " + doc.unite + (Math.abs(ang) > 1e-9 && !croix ? ", tourné de " + nb(Math.abs(ang)*180/PI, 3) + "°" : "") + "). Clique la ligne suivante, ou Échap.");
    return true;
  }
  // extrémité d'une ligne (ou polyligne ouverte) la plus proche du clic : { k (sommet qui bouge), kn (voisin) }
  function extremite(v, x, y){
    var e = v.e, n = e.pts.length, i = doc.entites.indexOf(e), P = proj[i];
    if (e.type === "POINT" || e.ferme || n < 2) return null;
    var d0 = Math.hypot(x - P[0], y - P[1]), d1 = Math.hypot(x - P[2*n - 2], y - P[2*n - 1]);
    return d0 <= d1 ? { k: 0, kn: 1 } : { k: n - 1, kn: n - 2 };
  }
  function prolonger(limite, v, x, y){
    var L = bout(limite.e, limite.seg), x0 = extremite(v, x, y);
    if (!x0){ etat("Choisis une ligne ou une polyligne ouverte."); return false; }
    var e = v.e, A = e.pts[x0.kn], B = e.pts[x0.k], t = interT(A, B, L[0], L[1]);
    if (t === null){ etat("Les deux lignes sont parallèles en plan : rien à prolonger."); return false; }
    if (t <= 1e-9){ etat("L'intersection est de l'autre côté : clique plutôt près de l'autre bout."); return false; }
    memoriser();
    e.pts[x0.k] = lerp(A, B, t);
    majTout(); etat("Prolongé jusqu'à la limite. Clique le bout suivant, ou Échap.");
    return true;
  }
  // raccorder en coin : chaque ligne garde le côté cliqué et s'arrête à l'intersection
  function coin(v1, v2){
    function bornes(v){
      var e = v.e;
      if (e.type === "POINT" || e.ferme || e.pts.length < 2) return null;
      var b = bout(e, v.seg), first = v.seg === 0, last = v.seg === e.pts.length - 2;
      return { e: e, a: b[0], b: b[1], t: v.t, first: first, last: last, j: v.seg };
    }
    var a = bornes(v1), b = bornes(v2);
    if (!a || !b || a.e === b.e){ etat("Choisis deux lignes différentes."); return false; }
    var ta = interT(a.a, a.b, b.a, b.b), tb = interT(b.a, b.b, a.a, a.b);
    if (ta === null){ etat("Les deux lignes sont parallèles en plan : pas de coin."); return false; }
    function bouge(q, t){
      // le bout du côté de l'intersection (par rapport au clic) vient sur l'intersection
      if (t >= q.t){ if (!q.last){ return "Le coin doit se faire sur un bout de polyligne."; } q.e.pts[q.j + 1] = lerp(q.a, q.b, t); }
      else { if (!q.first){ return "Le coin doit se faire sur un bout de polyligne."; } q.e.pts[q.j] = lerp(q.a, q.b, t); }
      return null;
    }
    memoriser();
    var err = bouge(a, ta) || bouge(b, tb);
    if (err){ restaurer(annul.pop()); etat(err); return false; }
    majTout(); etat("Coin raccordé.");
    return true;
  }

  // ================= Outils (clics dans la vue) =================
  var AIDES = {
    mesure: "Mesure : clique deux points (accroche aux extrémités et milieux).",
    deplacer: "Déplacer : clique le point de départ, puis le point d'arrivée.",
    copier: "Copier : clique le point de départ, puis le point d'arrivée.",
    aligner: "Aligner : clique la ligne de référence, puis les lignes ou les croix de poteaux à aligner dessus.",
    prolonger: "Prolonger jusqu'à : clique la ligne limite, puis le bout de chaque ligne à prolonger ou à couper.",
    coin: "Raccorder en coin : clique la première ligne du côté à garder, puis la seconde.",
    ligne: "Ligne : clique les points les uns après les autres (calque courant) ; Échap pour finir."
  };
  function choisirOutil(o){
    if ((o === "deplacer" || o === "copier") && !exigeSel()) return;
    outil = o === outil ? null : o; et = outil ? {} : null; accroche = null;
    document.querySelectorAll("#outils3d [data-o]").forEach(function(b){ b.setAttribute("aria-pressed", String(b.getAttribute("data-o") === outil)); });
    cv.classList.toggle("mesure", !!outil);
    etat(outil ? AIDES[outil] + " Échap ou clic droit pour sortir." : "");
    demander();
  }
  function clicOutil(x, y){
    var v, p;
    if (outil === "mesure"){
      p = pointSouris(x, y);
      if (!et.base){ et.base = p; demander(); return; }
      var dx = p[0] - et.base[0], dy = p[1] - et.base[1], dz = p[2] - et.base[2];
      etat("Distance " + nb(Math.hypot(dx, dy, dz), 4) + " " + doc.unite + " · en plan " + nb(Math.hypot(dx, dy), 4) + "   ΔX " + nb(dx, 4) + "   ΔY " + nb(dy, 4) + "   ΔZ " + nb(dz, 4) + "   angle " + nb(Math.atan2(dy, dx)*180/PI, 2) + "°");
      et.base = null; demander(); return;
    }
    if (outil === "deplacer" || outil === "copier"){
      p = pointSouris(x, y);
      if (!et.base){ et.base = p; etat("Clique le point d'arrivée."); demander(); return; }
      var cp = outil === "copier";
      deplacerDe([p[0] - et.base[0], p[1] - et.base[1], p[2] - et.base[2]], cp, 1);
      if (cp) et.base = null; else choisirOutil(null);
      return;
    }
    if (outil === "ligne"){
      p = pointSouris(x, y);
      if (et.base){
        memoriser();
        if (!calqueDe(calqueCourant)) DXF3D.calque(doc, calqueCourant, 7);
        doc.entites.push({ type: "LIGNE", calque: calqueCourant, pts: [et.base.slice(), p.slice()], ferme: false, info: null });
        majTout();
      }
      et.base = p; demander(); return;
    }
    v = viser(x, y, 8);
    if (!v){ etat("Rien sous le curseur. " + AIDES[outil]); return; }
    if (outil === "aligner"){
      if (!et.ref){ if (v.e.type === "POINT") return; et.ref = v; etat("Référence choisie. Clique les lignes ou les croix à aligner dessus."); demander(); return; }
      if (v.e !== et.ref.e) aligner(et.ref, v);
      return;
    }
    if (outil === "prolonger"){
      if (!et.ref){ if (v.e.type === "POINT") return; et.ref = v; etat("Limite choisie. Clique le bout de chaque ligne à prolonger ou à couper."); demander(); return; }
      if (v.e !== et.ref.e) prolonger(et.ref, v, x, y);
      return;
    }
    if (outil === "coin"){
      if (!et.ref){ et.ref = v; etat("Clique la seconde ligne, du côté à garder."); demander(); return; }
      coin(et.ref, v); et.ref = null; demander();
    }
  }

  // ================= Souris, doigts, molette =================
  function local(e){ var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function zoomer(x, y, f){
    var ns = Math.max(1e-9, Math.min(1e9, s*f)); f = ns/s; s = ns;
    px = x - W/2 - (x - W/2 - px)*f; py = y - H/2 - (y - H/2 - py)*f;
    demander();
  }
  cv.addEventListener("wheel", function(e){
    e.preventDefault(); anim = null;
    var p = local(e), d = e.deltaMode === 1 ? e.deltaY*33 : e.deltaY;
    zoomer(p.x, p.y, Math.exp(-d*.0015));
  }, { passive: false });
  var tir = null, ptrs = new Map();
  cv.addEventListener("pointerdown", function(e){
    if (!doc) return;
    cv.setPointerCapture(e.pointerId);
    var p = local(e);
    ptrs.set(e.pointerId, p);
    anim = null;
    tir = { x: p.x, y: p.y, x0: p.x, y0: p.y, bouton: e.button, bouge: false, ctrl: e.ctrlKey || e.metaKey, maj: e.shiftKey, pivot: false };
    if (ptrs.size === 2){
      var P = Array.from(ptrs.values());
      tir.pince = { d: Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y), m: [(P[0].x + P[1].x)/2, (P[0].y + P[1].y)/2] };
    }
  });
  cv.addEventListener("pointermove", function(e){
    if (!doc) return;
    var p = local(e);
    souris = p;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (tir && tir.pince && ptrs.size === 2){
      var P = Array.from(ptrs.values()), d = Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y), m = [(P[0].x + P[1].x)/2, (P[0].y + P[1].y)/2];
      px += m[0] - tir.pince.m[0]; py += m[1] - tir.pince.m[1];
      zoomer(m[0], m[1], d/tir.pince.d);
      tir.pince = { d: d, m: m };
      return;
    }
    if (tir && !tir.bouge && Math.abs(p.x - tir.x0) + Math.abs(p.y - tir.y0) > 3) tir.bouge = true;
    if (tir && tir.bouge){
      var dx = p.x - tir.x, dy = p.y - tir.y;
      if (tir.ctrl && tir.bouton === 0){ cadre = { x0: tir.x0, y0: tir.y0, x1: p.x, y1: p.y }; }
      else if (tir.maj || tir.bouton === 1 || tir.bouton === 2){ px += dx; py += dy; cv.classList.add("tire"); }
      else {
        // rotation autour du point visé au départ du glisser (sinon du centre de la vue)
        if (!tir.pivot){
          tir.pivot = true;
          var a = accrocher(tir.x0, tir.y0);
          if (a){ var q = ecran(a.p, base()); C = a.p.slice(); px = q[0] - W/2; py = q[1] - H/2; }
        }
        yaw -= dx*.01; pitch = Math.max(-DEMI, Math.min(DEMI, pitch + dy*.01));
        cv.classList.add("tire");
      }
      tir.x = p.x; tir.y = p.y;
      demander();
      return;
    }
    // survol : accroche (outils à points) ou objet sous le curseur
    var aPoints = outil === "mesure" || outil === "deplacer" || outil === "copier" || outil === "ligne";
    accroche = aPoints ? accrocher(p.x, p.y) : null;
    survol = aPoints ? null : viser(p.x, p.y, 7);
    var w = accroche ? accroche.p : aPoints ? monde(p.x, p.y, et && et.base ? et.base[2] : zTravail) : null;
    $("#coord").textContent = w ? "X " + nb(w[0], 3) + "   Y " + nb(w[1], 3) + "   Z " + nb(w[2], 3) + (accroche ? "   · " + accroche.type : "") :
      survol ? survol.e.type + " · " + survol.e.calque : "";
    demander();
  });
  cv.addEventListener("pointerleave", function(){ souris = null; survol = null; accroche = null; $("#coord").textContent = ""; demander(); });
  function lacher(e){
    ptrs.delete(e.pointerId);
    if (!tir) return;
    var p = local(e), t = tir;
    if (ptrs.size) return;
    tir = null;
    cv.classList.remove("tire");
    if (cadre){ fenetre(cadre, t.maj); cadre = null; demander(); return; }
    if (t.bouge || t.pince || e.type === "pointercancel") return;
    if (t.bouton === 2){ if (outil) choisirOutil(null); return; }
    if (t.bouton !== 0) return;
    if (outil){ clicOutil(p.x, p.y); return; }
    var v = viser(p.x, p.y, 7);
    if (t.ctrl || t.maj){ if (v){ if (sel.has(v.e)) sel.delete(v.e); else sel.add(v.e); } }
    else { sel.clear(); if (v) sel.add(v.e); }
    proprietes(); demander();
  }
  cv.addEventListener("pointerup", lacher);
  cv.addEventListener("pointercancel", lacher);
  cv.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  cv.addEventListener("dblclick", function(){ if (!outil) cadrer(); });
  // fenêtre : de gauche à droite, objets entièrement dedans ; de droite à gauche, objets touchés
  function fenetre(f, retirer){
    var x0 = Math.min(f.x0, f.x1), x1 = Math.max(f.x0, f.x1), y0 = Math.min(f.y0, f.y1), y1 = Math.max(f.y0, f.y1), croise = f.x1 < f.x0;
    function dedans(x, y){ return x >= x0 && x <= x1 && y >= y0 && y <= y1; }
    function coupe(ax, ay, bx, by){
      var t0 = 0, t1 = 1, d = [bx - ax, by - ay], lo = [x0, y0], hi = [x1, y1], a = [ax, ay];
      for (var k = 0; k < 2; k++){
        if (Math.abs(d[k]) < 1e-12){ if (a[k] < lo[k] || a[k] > hi[k]) return false; continue; }
        var u = (lo[k] - a[k])/d[k], v = (hi[k] - a[k])/d[k];
        if (u > v){ var w = u; u = v; v = w; }
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        if (t0 > t1) return false;
      }
      return true;
    }
    var n = 0;
    doc.entites.forEach(function(e, i){
      var P = proj[i];
      if (!P) return;
      var m = P.length/2, tous = true, un = false;
      for (var j = 0; j < m; j++){ if (dedans(P[2*j], P[2*j + 1])) un = true; else tous = false; }
      if (croise && !un) for (j = 0; j + 1 < m && !un; j++) un = coupe(P[2*j], P[2*j + 1], P[2*j + 2], P[2*j + 3]);
      if (croise ? un : tous){ if (retirer) sel.delete(e); else sel.add(e); n++; }
    });
    proprietes();
    etat(n + " objet(s) " + (retirer ? "retiré(s) de" : "ajouté(s) à") + " la sélection.");
  }

  // ================= Clavier =================
  document.addEventListener("keydown", function(e){
    if (!actif || !doc) return;
    if (e.target.closest && e.target.closest("input,textarea,select,dialog")) return;
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === "z" || k === "Z") && !e.shiftKey){ e.preventDefault(); annuler(); return; }
    if (ctrl && (k === "y" || k === "Y" || ((k === "z" || k === "Z") && e.shiftKey))){ e.preventDefault(); retablir(); return; }
    if (ctrl && (k === "a" || k === "A")){ e.preventDefault(); sel = new Set(doc.entites.filter(visible)); proprietes(); demander(); return; }
    if (ctrl || e.altKey) return;
    if (k === "Escape"){ if (outil){ if (et && (et.base || et.ref) && outil !== "aligner" && outil !== "prolonger"){ et = {}; demander(); } else choisirOutil(null); } else { sel.clear(); proprietes(); demander(); } return; }
    if (k === "Delete" || k === "Backspace"){ e.preventDefault(); supprimer(); return; }
    var c = { f: cadrer, m: function(){ choisirOutil("mesure"); }, d: function(){ choisirOutil("deplacer"); }, c: function(){ choisirOutil("copier"); },
      a: function(){ choisirOutil("aligner"); }, p: function(){ choisirOutil("prolonger"); }, r: function(){ choisirOutil("coin"); },
      l: function(){ choisirOutil("ligne"); }, n: dlgNoeuds, z: dlgCoteZ }[k.toLowerCase()];
    if (c){ e.preventDefault(); c(); }
  });

  // ================= Barre d'outils 3D =================
  $("#outils3d").addEventListener("click", function(e){
    var b = e.target.closest("button");
    if (!b || !doc) return;
    var o = b.getAttribute("data-o"), c = b.getAttribute("data-c");
    if (o){ choisirOutil(o); return; }
    ({ cadrer: cadrer, dessus: function(){ allerVers(0, DEMI, null, true); }, maison: vueMaison, supprimer: supprimer,
      annuler: annuler, retablir: retablir, deplacer: function(){ dlgDeplacer(false); }, copier: function(){ dlgDeplacer(true); },
      noeuds: dlgNoeuds, z: dlgCoteZ }[c] || function(){})();
  });

  // ================= Petite fenêtre de saisie =================
  function dialogue(titre, champs, ok){
    var d = $("#dlg3d");
    d.innerHTML = '<form method="dialog"><h2>' + esc(titre) + '</h2><div class="champs">' + champs.map(function(c){
      return '<label><span>' + esc(c.l) + '</span><input class="champ" type="number" step="any" name="' + c.id + '" value="' + c.v + '"' + (c.min != null ? ' min="' + c.min + '"' : "") + "></label>";
    }).join("") + '</div><div class="pied"><button type="submit" class="bt prim" value="ok">OK</button><button type="submit" class="bt" value="non" formnovalidate>Annuler</button></div></form>';
    var f = d.querySelector("form");
    f.addEventListener("submit", function(ev){
      var bt = ev.submitter;
      if (bt && bt.value !== "ok") return;
      var r = {};
      champs.forEach(function(c){ var v = parseFloat(String(f.elements[c.id].value).replace(",", ".")); r[c.id] = isFinite(v) ? v : 0; });
      setTimeout(function(){ ok(r); }, 0);
    });
    d.showModal();
    var i = d.querySelector("input");
    if (i){ i.focus(); i.select(); }
  }

  // ================= Calques =================
  function calques(){
    if (!actif) return;
    var el = $("#calques");
    if (!doc){ el.innerHTML = '<div class="vide-p">Aucun dessin ouvert.</div>'; return; }
    var nb0 = {};
    doc.entites.forEach(function(e){ nb0[e.calque] = (nb0[e.calque] || 0) + 1; });
    var L = doc.calques.map(function(c, i){ return i; }).filter(function(i){ return !filtre || doc.calques[i].nom.toLowerCase().indexOf(filtre) >= 0; })
      .sort(function(a, b){ return doc.calques[a].nom.localeCompare(doc.calques[b].nom, "fr", { numeric: true }); });
    var vis = doc.calques.filter(function(c){ return c.visible !== false; }).length;
    $("#n-calques").textContent = vis + " / " + doc.calques.length + " visibles";
    el.innerHTML = L.map(function(i){
      var c = doc.calques[i];
      return '<label class="calque' + (c.visible === false ? " off" : "") + '" title="Clic : afficher ou masquer · double-clic : isoler"><input type="checkbox" data-k="' + i + '"' + (c.visible === false ? "" : " checked") + '>' +
        '<i class="pastille" style="--c:' + couleurAci(c.couleur) + '"></i><span class="nom">' + esc(c.nom) + (c.nom === calqueCourant ? ' <span class="courant">courant</span>' : "") + '</span><span></span><span class="n">' + (nb0[c.nom] || 0) + "</span></label>";
    }).join("") || '<div class="vide-p">Aucun calque ne correspond.</div>';
  }
  $("#calques").addEventListener("change", function(e){
    if (!actif) return;
    var i = e.target.getAttribute("data-k");
    if (i === null) return;
    doc.calques[+i].visible = e.target.checked;
    sel.forEach(function(x){ if (!visible(x)) sel.delete(x); });
    calques(); proprietes(); demander();
  });
  $("#calques").addEventListener("dblclick", function(e){
    if (!actif) return;
    var l = e.target.closest(".calque");
    if (!l) return;
    e.preventDefault();
    var i = +l.querySelector("input").getAttribute("data-k");
    doc.calques.forEach(function(c, k){ c.visible = k === i; });
    sel.forEach(function(x){ if (!visible(x)) sel.delete(x); });
    calques(); proprietes(); demander();
  });
  $("#f-calque").addEventListener("input", function(){ if (actif){ filtre = this.value.trim().toLowerCase(); calques(); } });
  $("#tous").addEventListener("click", function(){ if (actif && doc){ doc.calques.forEach(function(c){ c.visible = true; }); calques(); demander(); } });
  $("#aucun").addEventListener("click", function(){ if (actif && doc){ doc.calques.forEach(function(c){ c.visible = false; }); sel.clear(); calques(); proprietes(); demander(); } });

  // ================= Propriétés =================
  function ligneProp(k, v){ return "<tr><th>" + esc(k) + "</th><td>" + v + "</td></tr>"; }
  function optionsCalques(choisi){
    return doc.calques.map(function(c){ return '<option value="' + esc(c.nom) + '"' + (c.nom === choisi ? " selected" : "") + ">" + esc(c.nom) + "</option>"; }).join("");
  }
  function proprietes(){
    if (!actif) return;
    var f = $("#props");
    if (!doc){ f.innerHTML = '<div class="vide-p">Ouvre un DXF pour le retravailler en 3D.</div>'; return; }
    if (!sel.size){
      var E = DXF3D.etendue(doc), types = {};
      doc.entites.forEach(function(e){ types[e.type] = (types[e.type] || 0) + 1; });
      var ign = Object.keys(doc.ignores || {});
      f.innerHTML = '<div class="tete"><h2>' + esc(nomDoc) + '</h2><div class="sous">Clique un objet pour le choisir, Ctrl + glisser pour une fenêtre.</div></div>' +
        '<div class="carte"><h3>Dessin 3D</h3><table class="tbl">' +
        ligneProp("Unité", esc(doc.unite)) +
        ligneProp("Lignes", '<span class="mono">' + (types.LIGNE || 0) + "</span>") + ligneProp("Polylignes", '<span class="mono">' + (types.POLYLIGNE || 0) + "</span>") +
        (types.POINT ? ligneProp("Points", '<span class="mono">' + types.POINT + "</span>") : "") +
        ligneProp("Étendue", E.vide ? "—" : '<span class="mono">' + nb(E.max[0] - E.min[0], 2) + " × " + nb(E.max[1] - E.min[1], 2) + " × " + nb(E.max[2] - E.min[2], 2) + "</span>") +
        ligneProp("Z", E.vide ? "—" : '<span class="mono">' + nb(E.min[2], 3) + " à " + nb(E.max[2], 3) + "</span>") +
        "</table>" + (ign.length ? '<p class="note">Non repris en 3D (perdus si tu enregistres depuis ce mode) : ' + esc(ign.map(function(t){ return t + " (" + doc.ignores[t] + ")"; }).join(", ")) + ".</p>" : "") + "</div>" +
        '<div class="carte"><h3>Calque courant</h3><select class="champ" id="ed-courant">' + optionsCalques(calqueCourant) + "</select>" +
        '<p class="note">Les lignes dessinées vont sur ce calque.</p></div>' +
        '<div class="carte"><h3>Raccourcis</h3><table class="tbl">' +
        ligneProp("Glisser", "tourner autour du point visé") + ligneProp("Maj + glisser, bouton du milieu", "déplacer la vue") +
        ligneProp("Ctrl + glisser", "fenêtre de sélection (vers la gauche : objets touchés)") +
        ligneProp("A · P · R", "aligner · prolonger · coin") + ligneProp("D · C", "déplacer · copier (deux points)") +
        ligneProp("N · Z · L", "nœuds · cote Z · ligne") + ligneProp("M · F", "mesure · tout voir") +
        ligneProp("Suppr · Ctrl+Z · Ctrl+Y", "supprimer · annuler · rétablir") + "</table></div>";
      return;
    }
    var L = Array.from(sel), cal = L[0].calque, memeCal = L.every(function(e){ return e.calque === cal; }), lg = 0;
    L.forEach(function(e){ for (var j = 0; j + 1 < e.pts.length; j++) lg += Math.hypot(e.pts[j + 1][0] - e.pts[j][0], e.pts[j + 1][1] - e.pts[j][1], e.pts[j + 1][2] - e.pts[j][2]); if (e.ferme && e.pts.length > 2){ var a = e.pts[e.pts.length - 1], b = e.pts[0]; lg += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); } });
    var h = '<div class="tete"><h2>' + (L.length === 1 ? esc(L[0].type === "LIGNE" ? "Ligne" : L[0].type === "POLYLIGNE" ? "Polyligne" + (L[0].ferme ? " fermée" : "") : "Point") : L.length + " objets") +
      '</h2><div class="sous">' + (memeCal ? "Calque " + esc(cal) : "Plusieurs calques") + '</div><button type="button" class="fermer" title="Ne rien choisir">×</button></div>' +
      '<div class="carte"><table class="tbl">' +
      ligneProp("Calque", '<select class="champ" id="ed-calque">' + (memeCal ? "" : '<option value="" selected>(plusieurs)</option>') + optionsCalques(memeCal ? cal : null) + '<option value="+">Nouveau calque…</option></select>') +
      (lg ? ligneProp("Longueur", '<span class="mono">' + nb(lg, 4) + "</span> " + esc(doc.unite)) : "");
    if (L.length === 1 && L[0].type === "LIGNE"){
      var p = L[0].pts, dx = p[1][0] - p[0][0], dy = p[1][1] - p[0][1], dz = p[1][2] - p[0][2], pl = Math.hypot(dx, dy);
      h += ligneProp("En plan", '<span class="mono">' + nb(pl, 4) + "</span>") + (pl > 1e-9 ? ligneProp("Angle en plan", '<span class="mono">' + nb(Math.atan2(dy, dx)*180/PI, 3) + "°</span>") : "") +
        ligneProp("ΔZ", '<span class="mono">' + nb(dz, 4) + "</span>");
    }
    var info = L.length === 1 && L[0].info && L[0].info.ifc;
    if (info) h += ligneProp("IFC", esc(info.type + (info.nom ? " · " + info.nom : ""))) + (info.gid ? ligneProp("GlobalId", '<span class="mono">' + esc(info.gid) + "</span>") : "");
    h += "</table></div>";
    if (L.length === 1 && L[0].pts.length <= 24){
      h += '<div class="carte"><h3>' + (L[0].pts.length > 1 ? "Sommets" : "Position") + '</h3><table class="tbl sommets"><tr><th></th><th>X</th><th>Y</th><th>Z</th></tr>' +
        L[0].pts.map(function(q, j){
          return "<tr><th>" + (j + 1) + "</th>" + [0, 1, 2].map(function(a){ return '<td><input class="champ mono" data-j="' + j + '" data-a="' + a + '" value="' + (Math.round(q[a]*1e4)/1e4) + '"></td>'; }).join("") + "</tr>";
        }).join("") + '</table><p class="note">Entrée pour valider une valeur.</p></div>';
    }
    h += '<div class="carte"><div class="liens"><button type="button" data-c="deplacer">Déplacer…</button><button type="button" data-c="copier">Copier…</button><button type="button" data-c="z">Cote Z…</button><button type="button" data-c="supprimer">Supprimer</button></div></div>';
    f.innerHTML = h;
  }
  $("#props").addEventListener("click", function(e){
    if (!actif) return;
    if (e.target.closest(".fermer")){ sel.clear(); proprietes(); demander(); return; }
    var b = e.target.closest("[data-c]");
    if (!b) return;
    ({ deplacer: function(){ dlgDeplacer(false); }, copier: function(){ dlgDeplacer(true); }, z: dlgCoteZ, supprimer: supprimer }[b.getAttribute("data-c")] || function(){})();
  });
  $("#props").addEventListener("change", function(e){
    if (!actif || !doc) return;
    var t = e.target;
    if (t.id === "ed-courant"){ calqueCourant = t.value; calques(); return; }
    if (t.id === "ed-calque"){
      var nom = t.value;
      if (!nom){ return; }
      if (nom === "+"){
        dialogueTexte("Nouveau calque", "Nom du calque", "STR_", function(n){
          n = n.trim();
          if (!n) { proprietes(); return; }
          memoriser();
          DXF3D.calque(doc, n, 7);
          sel.forEach(function(x){ x.calque = n; });
          calqueCourant = n;
          majTout();
        });
        return;
      }
      memoriser();
      sel.forEach(function(x){ x.calque = nom; });
      majTout(); etat(sel.size + " objet(s) sur le calque " + nom + ".");
      return;
    }
    var j = t.getAttribute("data-j");
    if (j !== null && sel.size === 1){
      var v = parseFloat(String(t.value).replace(/\s/g, "").replace(",", "."));
      if (!isFinite(v)){ proprietes(); return; }
      var e0 = Array.from(sel)[0];
      memoriser();
      e0.pts[+j][+t.getAttribute("data-a")] = v;
      majTout();
    }
  });
  function dialogueTexte(titre, libelle, val, ok){
    var d = $("#dlg3d");
    d.innerHTML = '<form method="dialog"><h2>' + esc(titre) + '</h2><div class="champs"><label><span>' + esc(libelle) + '</span><input class="champ" name="t" value="' + esc(val) + '"></label></div>' +
      '<div class="pied"><button type="submit" class="bt prim" value="ok">OK</button><button type="submit" class="bt" value="non">Annuler</button></div></form>';
    var f = d.querySelector("form");
    f.addEventListener("submit", function(ev){ if (ev.submitter && ev.submitter.value !== "ok"){ proprietes(); return; } var v = f.elements.t.value; setTimeout(function(){ ok(v); }, 0); });
    d.showModal();
    var i = d.querySelector("input"); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
  }

  // ================= Interface publique (dxf-app.js) =================
  window.Editeur3D = {
    // lit le DXF (texte ou ArrayBuffer) : { entites, ignores (nombre d'objets non repris), a3D (des Z différents) }
    charger: function(buf, nom){
      doc = DXF3D.lire(buf); nomDoc = nom || "";
      sel.clear(); survol = null; outil = null; et = null; annul = []; retab = []; modifie = false;
      calqueCourant = doc.calques.length ? doc.calques[0].nom : "0";
      var E = DXF3D.etendue(doc), ign = 0;
      Object.keys(doc.ignores).forEach(function(k){ ign += doc.ignores[k]; });
      zTravail = E.min[2];
      yaw = PI/4; pitch = Math.atan(Math.SQRT1_2);
      if (E.max[2] - E.min[2] < 1e-9){ yaw = 0; pitch = DEMI; }
      return { entites: doc.entites.length, ignores: ign, a3D: E.max[2] - E.min[2] > 1e-9 };
    },
    activer: function(on){
      actif = !!on;
      if (!actif){ outil = null; et = null; return; }
      document.querySelectorAll("#outils3d [data-o]").forEach(function(b){ b.setAttribute("aria-pressed", "false"); });
      taille(); cadrer(); calques(); proprietes();
      if (cube) cube.redessiner();
    },
    actif: function(){ return actif; },
    modifie: function(){ return modifie; },
    enregistre: function(){ modifie = false; },
    texte: function(){ return DXF3D.ecrire(doc); }
  };
})();
