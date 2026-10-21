// Scène d'ouverture de /ifc/ : un pied de poteau métallique (HEB, platine, raidisseurs, tiges
// d'ancrage) en volumes ombrés, qui s'assemble pièce par pièce puis tourne lentement (un tour en 60 s).
// Ensuite, en boucle, un groupe de pièces passe en or (sélection), se soulève et s'efface
// (suppression), puis revient à sa place (annulation) : le geste de l'outil.
// Canvas 2D, faces triées (peintre), reflet au sol, halo doré, reflet qui glisse sur les faces.
// Glisser pour tourner. Les animations jouent même si le système demande moins de mouvement (choix de Tony).
(function(){
  "use strict";

  var cv = document.getElementById("scene"), hote = document.getElementById("accueil");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  function clamp(x){ return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(p){ return p < .5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3)/2; }
  function norm(v){ var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
  function cross(a, b){ return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
  function dot(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

  // ================= Modèle (mm, Z vers le haut) =================
  var pieces = [];
  // Prisme convexe : polygone de base (points 3D) extrudé selon v ; normales tournées vers l'extérieur
  function prisme(base, v, d, groupe){
    var n = base.length, haut = base.map(function(p){ return [p[0] + v[0], p[1] + v[1], p[2] + v[2]]; });
    var faces = [base.slice().reverse(), haut];
    for (var i = 0; i < n; i++){ var j = (i + 1) % n; faces.push([base[i], base[j], haut[j], haut[i]]); }
    var c = [0, 0, 0], tous = base.concat(haut);
    tous.forEach(function(p){ c[0] += p[0]/tous.length; c[1] += p[1]/tous.length; c[2] += p[2]/tous.length; });
    pieces.push({ d: d, groupe: groupe || "", faces: faces.map(function(f){
      var nx = 0, ny = 0, nz = 0, m = [0, 0, 0];
      for (var i = 0, j = f.length - 1; i < f.length; j = i++){
        nx += (f[j][1] - f[i][1])*(f[j][2] + f[i][2]);
        ny += (f[j][2] - f[i][2])*(f[j][0] + f[i][0]);
        nz += (f[j][0] - f[i][0])*(f[j][1] + f[i][1]);
        m[0] += f[i][0]/f.length; m[1] += f[i][1]/f.length; m[2] += f[i][2]/f.length;
      }
      var nn = norm([nx, ny, nz]);
      if (dot(nn, [m[0] - c[0], m[1] - c[1], m[2] - c[2]]) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      return { p: f, n: nn, m: m };
    }) });
  }
  function boite(x0, x1, y0, y1, z0, z1, d, g){ prisme([[x0,y0,z0], [x1,y0,z0], [x1,y1,z0], [x0,y1,z0]], [0, 0, z1 - z0], d, g); }
  function cylindre(cx, cy, z0, z1, r, n, d, g, phase){
    var b = [];
    for (var i = 0; i < n; i++){ var t = (phase || 0) + 2*Math.PI*i/n; b.push([cx + r*Math.cos(t), cy + r*Math.sin(t), z0]); }
    prisme(b, [0, 0, z1 - z0], d, g);
  }

  var HC = 980, EP = 28;                                // hauteur du poteau, épaisseur de platine
  boite(-260, 260, -260, 260, 0, EP, .2);               // platine
  boite(-150, 150, -150, -131, EP, HC, .75);            // HEB 300 : ailes et âme
  boite(-150, 150, 131, 150, EP, HC, .85);
  boite(-5.5, 5.5, -131, 131, EP, HC, .8);
  // raidisseurs triangulaires, hors des ailes puis de part et d'autre de l'âme
  prisme([[-7, 150, EP], [-7, 248, EP], [-7, 150, EP + 250]], [14, 0, 0], 1.45, "ry");
  prisme([[-7, -150, EP], [-7, -248, EP], [-7, -150, EP + 250]], [14, 0, 0], 1.55, "ry");
  prisme([[5.5, -7, EP], [248, -7, EP], [5.5, -7, EP + 250]], [0, 14, 0], 1.65, "rx");
  prisme([[-5.5, -7, EP], [-248, -7, EP], [-5.5, -7, EP + 250]], [0, 14, 0], 1.75, "rx");
  // tiges d'ancrage : rondelle, écrou, bout de tige
  [[200, 200], [-200, 200], [-200, -200], [200, -200]].forEach(function(p, k){
    var d = 2.05 + k*.14;
    boite(p[0] - 34, p[0] + 34, p[1] - 34, p[1] + 34, EP, EP + 8, d, "b");
    cylindre(p[0], p[1], EP + 8, EP + 34, 27, 6, d + .08, "b", Math.PI/6);
    cylindre(p[0], p[1], EP + 34, EP + 78, 12, 12, d + .16, "b");
  });
  var FIN_MONTAGE = 3.4, CYCLE = 7.5, ORDRE = ["ry", "b", "rx"], DEBUT_DEMO = 5;
  var CENTRE = [0, 0, HC*.42], PHI = .3;

  // ================= Couleurs (selon le thème) =================
  var coul = null;
  function lireCouleurs(){
    var s = getComputedStyle(document.documentElement);
    function rvb(n, d){ var v = s.getPropertyValue(n).trim().split(",").map(Number); return v.length === 3 && v.every(isFinite) ? v : d; }
    var clair = document.documentElement.getAttribute("data-theme") === "clair";
    coul = { clair: clair, encre: rvb("--encre", [236,232,224]), fond: rvb("--fond-rvb", [5,5,5]), or: clair ? [150,104,30] : [214,168,92] };
  }
  lireCouleurs();
  new MutationObserver(lireCouleurs).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function melange(a, b, k){ return [a[0] + (b[0] - a[0])*k, a[1] + (b[1] - a[1])*k, a[2] + (b[2] - a[2])*k]; }
  function css(c, a){ return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (a === undefined ? 1 : a) + ")"; }

  // ================= Caméra et cadrage =================
  var W = 0, H = 0, dpr = 1, S = 1, OY = 0, R = 3000;
  function vue(th){
    var eye = [CENTRE[0] + R*Math.sin(th)*Math.cos(PHI), CENTRE[1] - R*Math.cos(th)*Math.cos(PHI), CENTRE[2] + R*Math.sin(PHI)];
    var fw = norm([CENTRE[0] - eye[0], CENTRE[1] - eye[1], CENTRE[2] - eye[2]]);
    var rt = norm(cross(fw, [0, 0, 1])), up = cross(rt, fw);
    return { eye: eye, fw: fw, rt: rt, up: up };
  }
  function proj(c, p){
    var v = [p[0] - c.eye[0], p[1] - c.eye[1], p[2] - c.eye[2]], z = dot(v, c.fw);
    return [dot(v, c.rt)/z, dot(v, c.up)/z, z];
  }
  function cadrer(){
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    var mx = 0, y0 = Infinity, y1 = -Infinity;
    for (var k = 0; k < 48; k++){
      var c = vue(2*Math.PI*k/48);
      pieces.forEach(function(pc){ pc.faces.forEach(function(f){ f.p.forEach(function(p){
        var q = proj(c, p);
        mx = Math.max(mx, Math.abs(q[0])); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
      }); }); });
    }
    var Hs = H*.78;                                      // le bas est laissé au reflet
    S = .9*Math.min(W/(2*mx), Hs/(y1 - y0));
    OY = (Hs - (y1 - y0)*S)/2 + y1*S + H*.02;
    return true;
  }
  if ("ResizeObserver" in window) new ResizeObserver(function(){ cadrer(); }).observe(cv);
  window.addEventListener("resize", cadrer);

  // ================= État des pièces à l'instant T =================
  function etatPiece(pc, T){
    var p = ease(clamp((T - pc.d)/.9));
    var st = { dz: (1 - p)*340, a: p, sel: 0, lueur: 1 - clamp((T - pc.d - .9)/.9) };
    if (T < pc.d) st.lueur = 0;
    if (T > DEBUT_DEMO && pc.groupe){
      var k = Math.floor((T - DEBUT_DEMO)/CYCLE), t = (T - DEBUT_DEMO) - k*CYCLE;
      if (ORDRE[k % ORDRE.length] === pc.groupe){
        st.sel = t < 4.8 ? ease(clamp(t/.6)) : 1 - ease(clamp((t - 4.8)/1));
        if (t >= 1.3 && t < 2.1){ var u = ease(clamp((t - 1.3)/.8)); st.dz = u*260; st.a = 1 - u; }
        else if (t >= 2.1 && t < 3.6){ st.a = 0; }
        else if (t >= 3.6 && t < 4.6){ var w = ease(clamp((t - 3.6)/1)); st.dz = (1 - w)*260; st.a = w; }
      }
    }
    return st;
  }

  // ================= Dessin =================
  var LUM = norm([-.45, -.7, .8]);
  function faces(c, T, miroir){
    var liste = [];
    pieces.forEach(function(pc){
      var st = etatPiece(pc, T);
      if (st.a <= .003) return;
      pc.faces.forEach(function(f){
        var sg = miroir ? -1 : 1;
        var n = [f.n[0], f.n[1], f.n[2]*sg], m = [f.m[0], f.m[1], (f.m[2] + st.dz)*sg];
        var ve = [c.eye[0] - m[0], c.eye[1] - m[1], c.eye[2] - m[2]];
        if (dot(n, ve) <= 0) return;                      // face de dos
        var pts = f.p.map(function(p){ var q = proj(c, [p[0], p[1], (p[2] + st.dz)*sg]); return [W/2 + q[0]*S, OY - q[1]*S]; });
        liste.push({ pts: pts, n: n, z: dot([m[0] - c.eye[0], m[1] - c.eye[1], m[2] - c.eye[2]], c.fw), st: st, ve: norm(ve) });
      });
    });
    liste.sort(function(a, b){ return b.z - a.z; });
    return liste;
  }
  function peindre(liste, alpha, aretes, Lr){
    var cl = coul.clair, e = coul.encre, f0 = coul.fond, or = coul.or;
    liste.forEach(function(F){
      var lam = Math.max(0, dot(F.n, LUM)), h = norm([Lr[0] + F.ve[0], Lr[1] + F.ve[1], Lr[2] + F.ve[2]]);
      var spec = Math.pow(Math.max(0, dot(F.n, h)), 22);
      var fond = cl ? melange([214,208,196], [255,254,250], .35 + .65*lam) : melange(f0, e, .05 + .15*lam);
      fond = melange(fond, or, F.st.sel*(cl ? .55 : .42));
      fond = melange(fond, cl ? [255,255,255] : [255,236,200], spec*(cl ? .5 : .28));
      ctx.globalAlpha = alpha*F.st.a;
      ctx.beginPath();
      F.pts.forEach(function(p, i){ if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.fillStyle = css(fond);
      ctx.fill();
      if (!aretes) return;
      var g = Math.max(F.st.sel, F.st.lueur);
      ctx.strokeStyle = g > .01 ? css(melange(e, or, g), cl ? .55 + .4*g : .5 + .45*g) : css(e, cl ? .5 : .46);
      ctx.lineWidth = 1 + g*.6;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  var t0 = null, th = .7, omega = 0, glisse = false, dernierX = 0, elan = 0, avant = 0, visible = true;
  function dessiner(T, dt){
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // rotation : démarre à la fin du montage, un tour en 60 s ; élan après un glisser
    if (!glisse){
      var cible = T > FIN_MONTAGE ? 2*Math.PI/60 : 0;
      omega += (cible + elan - omega)*Math.min(1, dt*1.5);
      elan *= Math.pow(.2, dt);
      th += omega*dt;
    }
    var c = vue(th);
    // lumière du reflet glissant : tourne lentement en sens inverse
    var a = -T*.35, Lr = norm([Math.cos(a)*.8, Math.sin(a)*.8, .55]);
    // sol : reflet atténué vers le bas, puis halo doré sous la platine
    var sol = proj(c, [0, 0, 0]), gx = W/2 + sol[0]*S, gy = OY - sol[1]*S;
    peindre(faces(c, T, true), .32, false, Lr);
    var g = ctx.createLinearGradient(0, gy - 30, 0, H);
    g.addColorStop(0, css(coul.fond, 0)); g.addColorStop(.55, css(coul.fond, .85)); g.addColorStop(1, css(coul.fond, 1));
    ctx.fillStyle = g; ctx.fillRect(0, gy - 30, W, H - gy + 30);
    var mont = ease(clamp((T - .2)/1.6)), rh = 430*S/sol[2]*mont;   // halo de 430 mm de rayon
    if (rh > 1){
      ctx.save();
      ctx.translate(gx, gy); ctx.scale(1, .34);
      var hg = ctx.createRadialGradient(0, 0, 0, 0, 0, rh);
      hg.addColorStop(0, css(coul.or, coul.clair ? .3 : .34)); hg.addColorStop(1, css(coul.or, 0));
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, rh, 0, 2*Math.PI); ctx.fill();
      ctx.restore();
    }
    peindre(faces(c, T, false), 1, true, Lr);
  }

  function image(now){
    requestAnimationFrame(image);
    if (hote && hote.hidden) return;
    if (!visible || document.hidden){ avant = now; return; }
    if (!W && !cadrer()) return;
    if (t0 === null){ t0 = now; avant = now; }
    var dt = Math.min(.05, (now - avant)/1000);
    avant = now;
    dessiner((now - t0)/1000, dt);
  }
  requestAnimationFrame(image);
  if ("IntersectionObserver" in window) new IntersectionObserver(function(e){ visible = e[0].isIntersecting; }).observe(cv);

  // ================= Glisser pour tourner =================
  cv.addEventListener("pointerdown", function(e){
    glisse = true; dernierX = e.clientX; elan = 0;
    try { cv.setPointerCapture(e.pointerId); } catch (x){}
  });
  cv.addEventListener("pointermove", function(e){
    if (!glisse) return;
    var dx = e.clientX - dernierX;
    dernierX = e.clientX;
    th -= dx*.008;
    elan = Math.max(-2, Math.min(2, -dx*.008*60));
  });
  function lache(){ if (!glisse) return; glisse = false; omega = elan; }
  cv.addEventListener("pointerup", lache);
  cv.addEventListener("pointercancel", lache);
})();
