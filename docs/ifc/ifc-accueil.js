// Scène d'ouverture de /ifc/ : un pied de poteau métallique (HEB, platine, raidisseurs, cordons de
// soudure d'angle, tiges d'ancrage) en volumes ombrés, qui s'assemble pièce par pièce puis tourne lentement (un tour en 60 s).
// Ensuite, en boucle, un groupe de pièces passe en or (sélection), se soulève et s'efface
// (suppression), puis revient à sa place (annulation) : le geste de l'outil.
// WebGL (profondeur exacte, acier ombré, congés du HEB, tiges lisses, ombre douce, reflet au sol, halo
// doré, reflet qui glisse) ; sans WebGL, le même montage en canvas 2D, faces triées (peintre).
// Glisser pour tourner. Les animations jouent même si le système demande moins de mouvement (choix de Tony).
(function(){
  "use strict";

  var cv = document.getElementById("scene"), hote = document.getElementById("accueil");
  if (!cv || !cv.getContext) return;
  var ctx = null;          // contexte 2D, seulement si WebGL manque

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
  // Raidisseurs (plats de 14 mm) : origine contre le poteau, direction du plat, longueur ; l'épaisseur suit
  // du × Z. Coin chanfreiné de 22 mm contre le poteau et la platine.
  var RAIDISSEURS = [
    { o: [-7, 150, EP], du: [0, 1, 0], L: 98, d: 1.45, g: "ry" },                 // hors des ailes
    { o: [7, -150, EP], du: [0, -1, 0], L: 98, d: 1.55, g: "ry" },
    { o: [5.5, 7, EP], du: [1, 0, 0], L: 248 - 5.5, d: 1.65, g: "rx" },           // dans le plan de l'âme
    { o: [-5.5, -7, EP], du: [-1, 0, 0], L: 248 - 5.5, d: 1.75, g: "rx" }
  ];
  var CORDON_HEB = 9, CORDON_RAID = 7;                  // côtés des cordons d'angle (mm)
  // contour du HEB sans les congés (canvas), sens trigonométrique
  var CONTOUR_HEB = [[-150, -150], [150, -150], [150, -131], [5.5, -131], [5.5, 131], [150, 131], [150, 150], [-150, 150], [-150, 131], [-5.5, 131], [-5.5, -131], [-150, -131]];
  // Cordons d'un raidisseur, des deux côtés du plat : sur la platine (le long du plat) et contre le poteau
  // (à la verticale), après le chanfrein. f(origine, axe, longueur, a, b) : cordon dans le coin (a, b).
  function cordonsRaidisseur(r, f){
    var Z = [0, 0, 1], t = cross(r.du, Z);
    [0, 14].forEach(function(e, k){
      var a = k ? t : [-t[0], -t[1], -t[2]], o = [r.o[0] + t[0]*e, r.o[1] + t[1]*e, r.o[2]];
      f([o[0] + r.du[0]*22, o[1] + r.du[1]*22, o[2]], r.du, r.L - 22, a, Z);
      f([o[0], o[1], o[2] + 22], Z, 250 - 22, a, r.du);
    });
  }
  boite(-260, 260, -260, 260, 0, EP, .2);               // platine
  boite(-150, 150, -150, -131, EP, HC, .75);            // HEB 300 : ailes et âme
  boite(-150, 150, 131, 150, EP, HC, .85);
  boite(-5.5, 5.5, -131, 131, EP, HC, .8);
  pieces.slice(1, 4).forEach(function(pc){ pc.coupe = true; });   // dessus du HEB : section coupée, en rouge
  // raidisseurs triangulaires, hors des ailes puis de part et d'autre de l'âme
  prisme([[-7, 150, EP], [-7, 248, EP], [-7, 150, EP + 250]], [14, 0, 0], 1.45, "ry");
  prisme([[-7, -150, EP], [-7, -248, EP], [-7, -150, EP + 250]], [14, 0, 0], 1.55, "ry");
  prisme([[5.5, -7, EP], [248, -7, EP], [5.5, -7, EP + 250]], [0, 14, 0], 1.65, "rx");
  prisme([[-5.5, -7, EP], [-248, -7, EP], [-5.5, -7, EP + 250]], [0, 14, 0], 1.75, "rx");
  // cordons de soudure d'angle (prismes triangulaires) : tour du HEB sur la platine, raidisseurs sur la
  // platine et contre le poteau, des deux côtés
  function plus(a, b, k){ return [a[0] + b[0]*k, a[1] + b[1]*k, a[2] + b[2]*k]; }
  CONTOUR_HEB.forEach(function(p, i){
    var q = CONTOUR_HEB[(i + 1) % CONTOUR_HEB.length], e = [q[0] - p[0], q[1] - p[1], 0], l = Math.hypot(e[0], e[1]), n = [e[1]/l, -e[0]/l, 0];
    var o = [p[0], p[1], EP];
    prisme([o, plus(o, n, CORDON_HEB), plus(o, [0, 0, 1], CORDON_HEB)], e, .95);
  });
  RAIDISSEURS.forEach(function(r){
    cordonsRaidisseur(r, function(o, ax, len, a, b){ prisme([o, plus(o, a, CORDON_RAID), plus(o, b, CORDON_RAID)], plus([0, 0, 0], ax, len), r.d + .12, r.g); });
  });
  // tiges d'ancrage : rondelle, écrou, bout de tige
  [[200, 200], [-200, 200], [-200, -200], [200, -200]].forEach(function(p, k){
    var d = 2.05 + k*.14;
    boite(p[0] - 34, p[0] + 34, p[1] - 34, p[1] + 34, EP, EP + 8, d, "b");
    cylindre(p[0], p[1], EP + 8, EP + 34, 27, 6, d + .08, "b", Math.PI/6);
    cylindre(p[0], p[1], EP + 34, EP + 78, 12, 12, d + .16, "b");
  });
  // points qui servent au cadrage (enveloppe du modèle)
  var sommets = [];
  pieces.forEach(function(pc){ pc.faces.forEach(function(f){ f.p.forEach(function(p){ sommets.push(p); }); }); });
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
      sommets.forEach(function(p){
        var q = proj(c, p);
        mx = Math.max(mx, Math.abs(q[0])); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
      });
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
  var ROUGE = [200, 46, 40];                            // section coupée, même rouge que la boîte de coupe de l'éditeur
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
        liste.push({ pts: pts, n: n, z: dot([m[0] - c.eye[0], m[1] - c.eye[1], m[2] - c.eye[2]], c.fw), st: st, ve: norm(ve), coupe: pc.coupe && f.n[2] > .99 });
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
      if (F.coupe) fond = melange(ROUGE, [255, 255, 255], (cl ? .1 : 0) + .12*lam);
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

  var dessinerScene = dessiner;
  function image(now){
    requestAnimationFrame(image);
    if (hote && hote.hidden) return;
    if (!visible || document.hidden){ avant = now; return; }
    if (!W && !cadrer()) return;
    if (t0 === null){ t0 = now; avant = now; }
    var dt = Math.min(.05, (now - avant)/1000);
    avant = now;
    dessinerScene((now - t0)/1000, dt);
  }
  if (!sceneGL()) ctx = cv.getContext("2d");
  requestAnimationFrame(image);
  if ("IntersectionObserver" in window) new IntersectionObserver(function(e){ visible = e[0].isIntersecting; }).observe(cv);


  // ================= Rendu WebGL =================
  // Maillages propres à ce rendu : profils extrudés avec normales lissées sur les arrondis (congés, tiges),
  // arêtes vives seulement là où l'angle est franc. Même chorégraphie que le canvas (etatPiece).
  function sceneGL(){
    var gl = null;
    try { gl = cv.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false }); } catch (e){ gl = null; }
    if (!gl) return false;

    // ---------- Géométrie ----------
    var mailles = [], cour = null;
    function piece(d, groupe){ cour = { d: d, groupe: groupe || "", P: [], N: [], L: [], coupe: 0 }; mailles.push(cour); }
    function pt(o, du, dv, uv){ return [o[0] + uv[0]*du[0] + uv[1]*dv[0], o[1] + uv[0]*du[1] + uv[1]*dv[1], o[2] + uv[0]*du[2] + uv[1]*dv[2]]; }
    function add(a, b){ return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
    function sommet(p, n){ cour.P.push(p[0], p[1], p[2]); cour.N.push(n[0], n[1], n[2]); }
    function ligne(a, b){ cour.L.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
    // triangulation d'un polygone simple (oreilles), sommets [u, v] dans le sens trigonométrique
    function oreilles(P){
      var idx = P.map(function(_, i){ return i; }), out = [], garde = 0;
      function aire(a, b, c){ return (b[0] - a[0])*(c[1] - a[1]) - (b[1] - a[1])*(c[0] - a[0]); }
      function dedans(p, a, b, c){ return aire(a, b, p) >= 0 && aire(b, c, p) >= 0 && aire(c, a, p) >= 0; }
      while (idx.length > 3 && garde++ < 5000){
        for (var i = 0; i < idx.length; i++){
          var ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
          var a = P[ia], b = P[ib], c = P[ic];
          if (aire(a, b, c) <= 1e-9) continue;
          var ok = true;
          for (var k = 0; k < idx.length && ok; k++){ var q = idx[k]; if (q !== ia && q !== ib && q !== ic && dedans(P[q], a, b, c)) ok = false; }
          if (!ok) continue;
          out.push(ia, ib, ic); idx.splice(i, 1); break;
        }
      }
      if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
      return out;
    }
    // Profil [u, v] posé à l'origine o dans le plan (du, dv) orthonormé, extrudé de h selon du × dv
    function extruder(prof, o, du, dv, h){
      var a2 = 0;
      for (var i = 0, j = prof.length - 1; i < prof.length; j = i++) a2 += (prof[j][0] - prof[i][0])*(prof[j][1] + prof[i][1]);
      if (a2 < 0) prof = prof.slice().reverse();          // sens trigonométrique (a2 = deux fois l'aire signée)
      var n = prof.length, dir = cross(du, dv), v = [dir[0]*h, dir[1]*h, dir[2]*h];
      var bas = prof.map(function(uv){ return pt(o, du, dv, uv); }), haut = bas.map(function(p){ return add(p, v); });
      var nArete = [];
      for (i = 0; i < n; i++){
        var a = prof[i], b = prof[(i + 1) % n], eu = b[0] - a[0], ev = b[1] - a[1], l = Math.hypot(eu, ev) || 1;
        nArete.push(norm([(ev*du[0] - eu*dv[0])/l, (ev*du[1] - eu*dv[1])/l, (ev*du[2] - eu*dv[2])/l]));
      }
      var lisse = [], nLisse = [];
      for (i = 0; i < n; i++){
        var np = nArete[(i + n - 1) % n], nn = nArete[i];
        lisse.push(dot(np, nn) > Math.cos(40*Math.PI/180));
        nLisse.push(norm(add(np, nn)));
      }
      for (i = 0; i < n; i++){
        var j2 = (i + 1) % n, na = lisse[i] ? nLisse[i] : nArete[i], nb = lisse[j2] ? nLisse[j2] : nArete[i];
        sommet(bas[i], na); sommet(bas[j2], nb); sommet(haut[j2], nb);
        sommet(bas[i], na); sommet(haut[j2], nb); sommet(haut[i], na);
        if (!lisse[i]) ligne(bas[i], haut[i]);
        ligne(bas[i], bas[j2]); ligne(haut[i], haut[j2]);
      }
      var t = oreilles(prof), nh = norm(dir), nb2 = [-nh[0], -nh[1], -nh[2]];
      for (i = 0; i < t.length; i += 3){
        sommet(haut[t[i]], nh); sommet(haut[t[i + 1]], nh); sommet(haut[t[i + 2]], nh);
        sommet(bas[t[i]], nb2); sommet(bas[t[i + 2]], nb2); sommet(bas[t[i + 1]], nb2);
      }
    }
    function arc(out, cx, cy, r, a0, a1, n){ for (var k = 0; k <= n; k++){ var a = a0 + (a1 - a0)*k/n; out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]); } }
    function cercle(r, n, ph){ var o = []; for (var k = 0; k < n; k++){ var a = (ph || 0) + 2*Math.PI*k/n; o.push([r*Math.cos(a), r*Math.sin(a)]); } return o; }
    var X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

    // platine
    piece(.2); extruder([[-260, -260], [260, -260], [260, 260], [-260, 260]], [0, 0, 0], X, Y, EP);
    // HEB 300 : b = 300, h = 300, tw = 11, tf = 19, r = 27 ; ailes parallèles à X
    var b2 = 150, tw = 5.5, ti = 131, r = 27, hp = [], Q = Math.PI/2;
    hp.push([-b2, -b2], [b2, -b2], [b2, -ti]);
    arc(hp, tw + r, -ti + r, r, -Q, -2*Q, 6);
    arc(hp, tw + r, ti - r, r, 2*Q, Q, 6);
    hp.push([b2, ti], [b2, b2], [-b2, b2], [-b2, ti]);
    arc(hp, -tw - r, ti - r, r, Q, 0, 6);
    arc(hp, -tw - r, -ti + r, r, 0, -Q, 6);
    hp.push([-b2, -ti]);
    piece(.75); extruder(hp, [0, 0, EP], X, Y, HC - EP);
    cour.coupe = HC;                                    // dessus du HEB : section coupée, en rouge
    // raidisseurs : plats de 14 mm de longueur L, coin chanfreiné contre le poteau, bout incliné ;
    // u part du poteau, v monte ; l'épaisseur suit du × Z, d'où les origines décalées de 7 mm
    function raidisseur(o, du, L, d, g){
      piece(d, g);
      extruder([[0, 22], [22, 0], [L, 0], [L, 38], [22, 250], [0, 250]], o, du, Z, 14);
    }
    // Cordon d'angle : section en quart légèrement bombé, de (c, 0) à (0, c) dans le coin (a, b) ;
    // [s, h, ns, nh] : position et normale de chaque point de la face bombée
    function bombe(c){
      var out = [], bz = c*.16, K = 6;
      for (var k = 0; k <= K; k++){
        var t = k/K, s = bz*Math.sin(Math.PI*t)*.707, dc = bz*Math.PI*Math.cos(Math.PI*t)*.707;
        var ts = c + dc, tz = -c + dc, l = Math.hypot(ts, tz);
        out.push([c*t + s, c*(1 - t) + s, -tz/l, ts/l]);
      }
      return out;
    }
    function cordonDroit(o, ax, len, a, b, c){
      if (dot(cross(a, b), ax) < 0){ var t = a; a = b; b = t; }
      extruder([[0, 0]].concat(bombe(c).map(function(q){ return [q[1], q[0]]; })), o, a, b, len);
    }
    // Cordon tout autour d'un contour (sens trigonométrique), posé sur le plan z : section balayée, coins en onglet
    function cordonContour(poly, z, c){
      var n = poly.length, nE = [], mi = [], S = bombe(c), K = S.length - 1, i, k;
      for (i = 0; i < n; i++){
        var p = poly[i], q = poly[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
        nE.push([dy/l, -dx/l]);
      }
      for (i = 0; i < n; i++){
        var u = nE[(i + n - 1) % n], w = nE[i], kk = 1 + u[0]*w[0] + u[1]*w[1];
        mi.push(kk > .2 ? [(u[0] + w[0])/kk, (u[1] + w[1])/kk] : w);
      }
      function P(i, k){ var m = mi[i % n], p = poly[i % n]; return [p[0] + m[0]*S[k][0], p[1] + m[1]*S[k][0], z + S[k][1]]; }
      function Nn(i, k){ var m = mi[i % n], l = Math.hypot(m[0], m[1]) || 1; return [m[0]/l*S[k][2], m[1]/l*S[k][2], S[k][3]]; }
      for (i = 0; i < n; i++){
        for (k = 0; k < K; k++){
          sommet(P(i, k), Nn(i, k)); sommet(P(i + 1, k), Nn(i + 1, k)); sommet(P(i + 1, k + 1), Nn(i + 1, k + 1));
          sommet(P(i, k), Nn(i, k)); sommet(P(i + 1, k + 1), Nn(i + 1, k + 1)); sommet(P(i, k + 1), Nn(i, k + 1));
        }
        ligne(P(i, 0), P(i + 1, 0)); ligne(P(i, K), P(i + 1, K));          // pieds du cordon
      }
    }
    RAIDISSEURS.forEach(function(r){
      raidisseur(r.o, r.du, r.L, r.d, r.g);
      piece(r.d + .12, r.g);
      cordonsRaidisseur(r, function(o, ax, len, a, b){ cordonDroit(o, ax, len, a, b, CORDON_RAID); });
    });
    // cordon du HEB sur la platine, autour du profil (congés compris)
    var contour = hp.filter(function(p, i){ var q = hp[(i + 1) % hp.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6; }), a2 = 0;
    for (var i2 = 0, j2 = contour.length - 1; i2 < contour.length; j2 = i2++) a2 += (contour[j2][0] - contour[i2][0])*(contour[j2][1] + contour[i2][1]);
    if (a2 < 0) contour.reverse();
    piece(.95); cordonContour(contour, EP, CORDON_HEB);
    // tiges d'ancrage : plaque de répartition, écrou six pans, tige ronde avec chanfrein
    [[200, 200], [-200, 200], [-200, -200], [200, -200]].forEach(function(p, k){
      var d = 2.05 + k*.14;
      piece(d, "b"); extruder([[-34, -34], [34, -34], [34, 34], [-34, 34]], [p[0], p[1], EP], X, Y, 8);
      piece(d + .08, "b"); extruder(cercle(27, 6, Math.PI/6), [p[0], p[1], EP + 8], X, Y, 26);
      piece(d + .16, "b"); extruder(cercle(12, 28), [p[0], p[1], EP + 8], X, Y, 66); extruder(cercle(10, 28), [p[0], p[1], EP + 74], X, Y, 4);
    });

    // ---------- Shaders ----------
    var PREC = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
    var SRC = {
      v: "attribute vec3 aP;attribute vec3 aN;uniform mat4 uM;uniform float uDz;uniform float uMir;uniform float uCoupe;varying vec3 vN;varying vec3 vW;varying float vCoupe;" +
        "void main(){vec3 w=aP+vec3(0.0,0.0,uDz);w.z*=uMir;vW=w;vN=vec3(aN.xy,aN.z*uMir);" +
        "vCoupe=(uCoupe>0.0&&aP.z>uCoupe-0.5&&aN.z>0.99)?1.0:0.0;gl_Position=uM*vec4(w,1.0);}",
      f: PREC + "uniform vec3 uEye;uniform vec3 uL;uniform vec3 uL2;uniform vec3 uBase;uniform vec3 uOr;uniform vec3 uFond;uniform vec3 uSpec;" +
        "uniform float uSel;uniform float uRefl;uniform float uA;uniform vec3 uRouge;varying vec3 vN;varying vec3 vW;varying float vCoupe;" +
        "void main(){vec3 N=normalize(vN);vec3 V=normalize(uEye-vW);if(dot(N,V)<0.0)N=-N;" +
        "float lam=max(dot(N,uL),0.0);float hemi=0.55+0.45*N.z;" +
        "float sp=pow(max(dot(N,normalize(uL+V)),0.0),40.0);float sp2=pow(max(dot(N,normalize(uL2+V)),0.0),90.0);" +
        "float fr=pow(1.0-max(dot(N,V),0.0),4.0);" +
        "vec3 c=uBase*(0.42*hemi+0.62*lam)+uSpec*(0.32*sp+0.6*sp2+0.16*fr);" +
        "if(vCoupe>0.5)c=uRouge*(0.78+0.3*lam)+uSpec*0.1*sp2;" +
        "c=mix(c,uOr*(0.62+0.55*lam)+uSpec*0.3*sp,uSel*0.62);" +
        "if(uRefl>0.0){float k=clamp(1.0+vW.z/650.0,0.0,1.0);gl_FragColor=vec4(mix(uFond,c,uRefl*k*k*uA),1.0);}" +
        "else gl_FragColor=vec4(c,uA);}",
      vl: "attribute vec3 aP;uniform mat4 uM;uniform float uDz;void main(){gl_Position=uM*vec4(aP+vec3(0.0,0.0,uDz),1.0);}",
      fl: PREC + "uniform vec4 uC;void main(){gl_FragColor=uC;}",
      vs: "attribute vec3 aP;uniform mat4 uM;varying vec2 vXY;void main(){vXY=aP.xy;gl_Position=uM*vec4(aP,1.0);}",
      fs: PREC + "uniform vec3 uOr;uniform vec3 uOmbre;uniform float uHalo;uniform float uForce;varying vec2 vXY;" +
        "void main(){float r=length(vXY)/430.0;float h=uHalo*pow(clamp(1.0-r,0.0,1.0),2.0);" +
        "float d=max(abs(vXY.x),abs(vXY.y))-262.0;float o=uForce*(1.0-smoothstep(-30.0,110.0,d));" +
        "float a=h+o;gl_FragColor=vec4(a>0.0?(uOr*h+uOmbre*o)/a:uOr,clamp(a,0.0,1.0));}"
    };
    function programme(vs, fs, attrs){
      function sh(t, src){ var x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; }
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      attrs.forEach(function(a, i){ gl.bindAttribLocation(p, i, a); });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = {};
      for (var k = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); k < n; k++){ var nom = gl.getActiveUniform(p, k).name; u[nom] = gl.getUniformLocation(p, nom); }
      return { p: p, u: u };
    }
    var PF, PL, PS, bufP, bufN, bufL, bufS;
    function init(){
      PF = programme(SRC.v, SRC.f, ["aP", "aN"]); PL = programme(SRC.vl, SRC.fl, ["aP"]); PS = programme(SRC.vs, SRC.fs, ["aP"]);
      var P = [], N = [], L = [];
      mailles.forEach(function(m){
        m.t0 = P.length/3; P.push.apply(P, m.P); N.push.apply(N, m.N); m.nt = m.P.length/3;
        m.l0 = L.length/3; L.push.apply(L, m.L); m.nl = m.L.length/3;
      });
      function buf(data){ var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b; }
      bufP = buf(P); bufN = buf(N); bufL = buf(L); bufS = buf([-900, -900, 0, 900, -900, 0, 900, 900, 0, -900, -900, 0, 900, 900, 0, -900, 900, 0]);
    }
    try { init(); } catch (e){ if (window.console) console.warn("Scène WebGL indisponible :", e); return false; }

    sommets = [];
    mailles.forEach(function(m){ for (var k = 0; k < m.P.length; k += 3) sommets.push([m.P[k], m.P[k + 1], m.P[k + 2]]); });
    cadrer();

    // ---------- Caméra : même projection que le canvas (perspective, cadrage S / OY) ----------
    function matrice(c){
      var n = 400, f = 9000, A = (f + n)/(f - n), B = -2*f*n/(f - n), kx = 2*S/W, ky = 2*S/H, k = 1 - 2*OY/H;
      function ligneM(v){ return [v[0], v[1], v[2], -dot(v, c.eye)]; }
      var r0 = ligneM(c.rt), r1 = ligneM(c.up), r3 = ligneM(c.fw), R = [];
      R[0] = r0.map(function(x){ return kx*x; });
      R[1] = r1.map(function(x, i){ return ky*x + k*r3[i]; });
      R[2] = r3.map(function(x, i){ return A*x + (i === 3 ? B : 0); });
      R[3] = r3;
      var m = new Float32Array(16);
      for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) m[j*4 + i] = R[i][j];
      return m;
    }
    function v3(c){ return [c[0]/255, c[1]/255, c[2]/255]; }
    function attrib(i, b, n){ gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 0, 0); }

    function dessinerGL(T, dt){
      if (gl.isContextLost()) return;
      if (!glisse){
        var cible = T > FIN_MONTAGE ? 2*Math.PI/60 : 0;
        omega += (cible + elan - omega)*Math.min(1, dt*1.5);
        elan *= Math.pow(.2, dt);
        th += omega*dt;
      }
      var c = vue(th), M = matrice(c), cl = coul.clair;
      var a = -T*.35, Lr = norm([Math.cos(a)*.8, Math.sin(a)*.8, .55]);
      var base = cl ? [.78, .79, .81] : [.36, .375, .40], spec = cl ? [1, 1, 1] : [1, .93, .82], fond = v3(coul.fond), or = v3(coul.or);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);

      var etats = mailles.map(function(m){ return etatPiece(m, T); });
      function faces(refl){
        gl.useProgram(PF.p);
        var u = PF.u;
        gl.uniformMatrix4fv(u.uM, false, M);
        gl.uniform3fv(u.uEye, c.eye); gl.uniform3fv(u.uL, LUM); gl.uniform3fv(u.uL2, Lr);
        gl.uniform3fv(u.uBase, base); gl.uniform3fv(u.uSpec, spec); gl.uniform3fv(u.uOr, or); gl.uniform3fv(u.uFond, fond);
        gl.uniform3fv(u.uRouge, v3(ROUGE));
        gl.uniform1f(u.uMir, refl ? -1 : 1); gl.uniform1f(u.uRefl, refl ? .32 : 0);
        attrib(0, bufP, 3); attrib(1, bufN, 3);
        // pièces pleines d'abord, puis celles qui apparaissent ou s'effacent (transparentes)
        [true, false].forEach(function(pleines){
          mailles.forEach(function(m, i){
            var st = etats[i];
            if (st.a <= .003 || (st.a >= .999) !== pleines) return;
            if (!refl && !pleines){ gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
            gl.uniform1f(u.uDz, st.dz); gl.uniform1f(u.uSel, st.sel); gl.uniform1f(u.uA, st.a); gl.uniform1f(u.uCoupe, m.coupe);
            gl.drawArrays(gl.TRIANGLES, m.t0, m.nt);
            gl.disable(gl.BLEND);
          });
        });
        gl.disableVertexAttribArray(1);
      }
      // 1) reflet au sol (fondu dans le fond de page)
      faces(true);
      // 2) ombre douce et halo doré sur le sol
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(PS.p);
      gl.uniformMatrix4fv(PS.u.uM, false, M);
      gl.uniform3fv(PS.u.uOr, or); gl.uniform3fv(PS.u.uOmbre, cl ? [.35, .3, .24] : [0, 0, 0]);
      var mont = ease(clamp((T - .2)/1.6));
      gl.uniform1f(PS.u.uHalo, mont*(cl ? .3 : .36)); gl.uniform1f(PS.u.uForce, mont*(cl ? .22 : .5));
      attrib(0, bufS, 3);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      // 3) le pied de poteau, puis ses arêtes vives (dorées à l'arrivée et en sélection)
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      faces(false);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.useProgram(PL.p);
      gl.uniformMatrix4fv(PL.u.uM, false, M);
      attrib(0, bufL, 3);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      var e = coul.encre;
      mailles.forEach(function(m, i){
        var st = etats[i];
        if (st.a <= .003 || !m.nl) return;
        var g = Math.max(st.sel, st.lueur), k = cl ? .34 : .3;
        var col = melange(e, coul.or, g);
        gl.uniform1f(PL.u.uDz, st.dz);
        gl.uniform4f(PL.u.uC, col[0]/255, col[1]/255, col[2]/255, (k + (.85 - k)*g)*st.a);
        gl.drawArrays(gl.LINES, m.l0, m.nl);
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    cv.addEventListener("webglcontextlost", function(e){ e.preventDefault(); });
    cv.addEventListener("webglcontextrestored", function(){ try { init(); } catch (x){} });
    dessinerScene = dessinerGL;
    return true;
  }

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
