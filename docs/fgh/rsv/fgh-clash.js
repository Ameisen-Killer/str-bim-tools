// /fgh/rsv/ : détection de clash entre les réservations (maquette RES) et la structure (maquette STR).
// Une réservation « traverse » un élément de structure quand leurs volumes se recoupent : une face de l'une
// coupe une face de l'autre, ou l'une est entièrement dans l'autre. Les simples contacts ne comptent pas : la
// réservation est d'abord rétrécie de TOL (1 cm) sur chaque face, dans son propre repère (tourné comme elle).
// Ouverture déjà percée dans la structure (réservation reportée par « Sync Reservations ») : la dalle ou le mur
// a un trou à la place de la réservation, qui ne touche donc plus rien. Une ouverture contenue dans la réservation
// (à 10 cm près), ou de même section qu'elle mais plus profonde, compte comme une traversée de son hôte.
// Géométrie en mètres, triangles à plat (9 nombres par triangle), fournis par fgh-vue.js.
(function(global){
  "use strict";

  var TOL = 0.01, MEME_OUV = 0.10, MEME_COPIE = 0.02;

  function boite(T){
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < T.length; i += 3) for (var k = 0; k < 3; k++){ var v = T[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    return { min: mn, max: mx };
  }
  function recoupe(a, b, e){
    for (var k = 0; k < 3; k++) if (a.min[k] > b.max[k] + e || a.max[k] < b.min[k] - e) return false;
    return true;
  }
  // deux boîtes presque identiques : chaque face à moins de d l'une de l'autre
  function memeBoite(a, b, d){
    for (var k = 0; k < 3; k++) if (Math.abs(a.min[k] - b.min[k]) > d || Math.abs(a.max[k] - b.max[k]) > d) return false;
    return true;
  }

  // L'ouverture (boîte o) est-elle le trou de la réservation (boîte r) ? Contenue dans la réservation à d près
  // sur les trois axes, ou sur deux axes avec les mêmes faces (même section, ouverture plus profonde que la réservation)
  function trouDe(o, r, d){
    var dans = 0, memes = 0;
    for (var k = 0; k < 3; k++){
      var inclus = o.min[k] >= r.min[k] - d && o.max[k] <= r.max[k] + d;
      if (inclus) dans++;
      if (inclus && Math.abs(o.min[k] - r.min[k]) <= d && Math.abs(o.max[k] - r.max[k]) <= d) memes++;
      else if (!inclus && (o.max[k] < r.min[k] || o.min[k] > r.max[k])) return false;
    }
    return dans === 3 || (dans === 2 && memes === 2);
  }

  // Orientation en plan de la réservation : normale horizontale de sa plus grande face verticale (modulo 90°)
  function angle(T){
    var best = 0, n = null, q = Math.PI/2;
    for (var k = 0; k < T.length; k += 9){
      var ux = T[k+3] - T[k], uy = T[k+4] - T[k+1], uz = T[k+5] - T[k+2], vx = T[k+6] - T[k], vy = T[k+7] - T[k+1], vz = T[k+8] - T[k+2];
      var m = [uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx], a = Math.hypot(m[0], m[1], m[2]), h = Math.hypot(m[0], m[1]);
      if (a && h/a > .9 && a > best){ best = a; n = m; }
    }
    if (!n) return 0;
    var g = Math.atan2(n[1], n[0]);
    return g - q*Math.round(g/q);
  }
  // Réservation rétrécie de t sur chaque face, dans son repère tourné (exact pour une boîte, très proche pour un rond)
  function retrecir(T, t){
    var a = angle(T), c = Math.cos(a), s = Math.sin(a), n = T.length, L = new Float64Array(n), i;
    for (i = 0; i < n; i += 3){ L[i] = c*T[i] + s*T[i+1]; L[i+1] = -s*T[i] + c*T[i+1]; L[i+2] = T[i+2]; }
    var b = boite(L), ctr = [], f = [];
    for (var k = 0; k < 3; k++){
      var d = b.max[k] - b.min[k];
      ctr.push((b.min[k] + b.max[k])/2);
      f.push(d > 4*t ? (d - 2*t)/d : .5);
    }
    var U = new Float64Array(n);
    for (i = 0; i < n; i += 3){
      var x = ctr[0] + (L[i] - ctr[0])*f[0], y = ctr[1] + (L[i+1] - ctr[1])*f[1];
      U[i] = c*x - s*y; U[i+1] = s*x + c*y; U[i+2] = ctr[2] + (L[i+2] - ctr[2])*f[2];
    }
    return U;
  }

  // Segment [p, q] contre le triangle j de T (Möller–Trumbore)
  function segTri(px, py, pz, qx, qy, qz, T, j){
    var ax = T[j], ay = T[j+1], az = T[j+2];
    var e1x = T[j+3] - ax, e1y = T[j+4] - ay, e1z = T[j+5] - az, e2x = T[j+6] - ax, e2y = T[j+7] - ay, e2z = T[j+8] - az;
    var dx = qx - px, dy = qy - py, dz = qz - pz;
    var hx = dy*e2z - dz*e2y, hy = dz*e2x - dx*e2z, hz = dx*e2y - dy*e2x;
    var det = e1x*hx + e1y*hy + e1z*hz;
    if (Math.abs(det) < 1e-14) return false;
    var f = 1/det, sx = px - ax, sy = py - ay, sz = pz - az;
    var u = f*(sx*hx + sy*hy + sz*hz);
    if (u < 0 || u > 1) return false;
    var cx = sy*e1z - sz*e1y, cy = sz*e1x - sx*e1z, cz = sx*e1y - sy*e1x;
    var v = f*(dx*cx + dy*cy + dz*cz);
    if (v < 0 || u + v > 1) return false;
    var t = f*(e2x*cx + e2y*cy + e2z*cz);
    return t >= 0 && t <= 1;
  }
  // Un côté d'un triangle coupe l'autre (deux triangles non coplanaires qui se recoupent ont toujours un tel côté)
  function cotes(A, i, B, j){
    return segTri(A[i], A[i+1], A[i+2], A[i+3], A[i+4], A[i+5], B, j) ||
      segTri(A[i+3], A[i+4], A[i+5], A[i+6], A[i+7], A[i+8], B, j) ||
      segTri(A[i+6], A[i+7], A[i+8], A[i], A[i+1], A[i+2], B, j);
  }
  function triTri(A, i, B, j){ return cotes(A, i, B, j) || cotes(B, j, A, i); }

  // Point dans un solide fermé : parité des traversées d'un rayon de direction quelconque
  function dansSolide(T, p){
    var r = [.5773, .5774, .5775], c = 0;
    for (var t = 0; t < T.length; t += 9){
      var e1 = [T[t+3] - T[t], T[t+4] - T[t+1], T[t+5] - T[t+2]], e2 = [T[t+6] - T[t], T[t+7] - T[t+1], T[t+8] - T[t+2]];
      var h = [r[1]*e2[2] - r[2]*e2[1], r[2]*e2[0] - r[0]*e2[2], r[0]*e2[1] - r[1]*e2[0]], a = e1[0]*h[0] + e1[1]*h[1] + e1[2]*h[2];
      if (Math.abs(a) < 1e-14) continue;
      var s = [p[0] - T[t], p[1] - T[t+1], p[2] - T[t+2]], u = (s[0]*h[0] + s[1]*h[1] + s[2]*h[2])/a;
      if (u < 0 || u > 1) continue;
      var q = [s[1]*e1[2] - s[2]*e1[1], s[2]*e1[0] - s[0]*e1[2], s[0]*e1[1] - s[1]*e1[0]], v = (r[0]*q[0] + r[1]*q[1] + r[2]*q[2])/a;
      if (v < 0 || u + v > 1) continue;
      if ((e2[0]*q[0] + e2[1]*q[1] + e2[2]*q[2])/a > 0) c++;
    }
    return c % 2 === 1;
  }
  // boîte de chaque triangle (6 nombres), calculée une fois par élément de structure
  function boitesTri(S){
    if (S.bt) return S.bt;
    var T = S.T, n = T.length/9, B = new Float64Array(6*n);
    for (var t = 0; t < n; t++){
      var j = 9*t;
      for (var k = 0; k < 3; k++){
        var a = T[j+k], b = T[j+3+k], c = T[j+6+k];
        B[6*t+k] = Math.min(a, b, c); B[6*t+3+k] = Math.max(a, b, c);
      }
    }
    return (S.bt = B);
  }

  // Une réservation (R : { T rétréci, b sa boîte }) et un élément de structure (S : { T, b }) se recoupent-ils ?
  function clash(R, S){
    var B = boitesTri(S), T = S.T, A = R.T, b = R.b, n = T.length/9;
    for (var t = 0; t < n; t++){
      var o = 6*t;
      if (B[o] > b.max[0] || B[o+3] < b.min[0] || B[o+1] > b.max[1] || B[o+4] < b.min[1] || B[o+2] > b.max[2] || B[o+5] < b.min[2]) continue;
      for (var i = 0; i < A.length; i += 9) if (triTri(A, i, T, 9*t)) return true;
    }
    // aucune face ne se coupe : la réservation dans l'élément, ou l'élément dans la réservation
    if (dansSolide(T, [A[0], A[1], A[2]])) return true;
    return S.b.min[0] >= b.min[0] && S.b.max[0] <= b.max[0] && S.b.min[1] >= b.min[1] && S.b.max[1] <= b.max[1] &&
      S.b.min[2] >= b.min[2] && S.b.max[2] <= b.max[2] && dansSolide(A, [T[0], T[1], T[2]]);
  }

  // res : [{ cle, T }] ; str : [{ cle, T, porteur (mur, dalle, poutre, poteau…) }] ;
  // ouvertures : [{ hote (cle d'un élément de str), T }] ; progres(0–1)
  // → promesse de { traverse: Map cle de réservation → [cles de structure], ms }
  function detecter(res, str, ouvertures, progres){
    var t0 = performance.now();
    str.forEach(function(S){ S.b = boite(S.T); });
    var ouv = (ouvertures || []).map(function(o){ return { hote: o.hote, b: boite(o.T) }; });
    var out = new Map(), i = 0;
    return new Promise(function(ok){
      (function tranche(){
        var t1 = performance.now();
        while (i < res.length && performance.now() - t1 < 30){
          var r = res[i++], vrai = boite(r.T), R = { T: retrecir(r.T, TOL) }, hits = [];
          R.b = boite(R.T);
          // ouvertures de la taille de la réservation : son trou déjà fait dans la structure
          ouv.forEach(function(o){ if (trouDe(o.b, vrai, MEME_OUV) && hits.indexOf(o.hote) < 0) hits.push(o.hote); });
          str.forEach(function(S){
            if (hits.indexOf(S.cle) >= 0 || !recoupe(S.b, R.b, 0)) return;
            // copie de la réservation elle-même dans la structure (objet non porteur de même boîte) : ignorée
            if (!S.porteur && memeBoite(S.b, vrai, MEME_COPIE)) return;
            if (clash(R, S)) hits.push(S.cle);
          });
          out.set(r.cle, hits);
        }
        if (progres) progres(res.length ? i/res.length : 1);
        if (i < res.length) setTimeout(tranche, 0);
        else ok({ traverse: out, ms: performance.now() - t0 });
      })();
    });
  }

  global.FGHClash = { detecter: detecter, TOL: TOL };
})(typeof window !== "undefined" ? window : self);
