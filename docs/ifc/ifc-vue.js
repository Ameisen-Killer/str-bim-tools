// Aperçu 3D de /ifc/ : rendu maison, sans bibliothèque. WebGL écrit à la main (tampon de profondeur,
// exact), avec en secours le moteur canvas 2D du peintre (choisi dans Affichage, ou forcé par ?moteur=canvas).
// - Géométrie lue : IFCFACETEDBREP (faces, boucles, points), IFCMAPPEDITEM (IFCREPRESENTATIONMAP +
//   IFCCARTESIANTRANSFORMATIONOPERATOR3D), IFCEXTRUDEDAREASOLID (profils paramétrés ou polylignes),
//   surfaces à facettes, faces triangulées/polygonales IFC4, quelques primitives ; chaîne
//   IFCLOCALPLACEMENT récursive. Le reste est compté dans « non lus » et affiché dans la vue.
// - Projection orthographique, ombrage lambert, seules les arêtes vives sont tracées (pas les coutures
//   entre facettes d'un rond). Sélection au clic : image d'identifiants hors écran en WebGL, test de
//   point dans les polygones projetés en canvas 2D.
// - Géométrie mise en cache par élément (elle ne change pas quand on supprime d'autres éléments).
(function(global){
  "use strict";

  var C = IFC.champs, R = IFC.idRef, L = IFC.refsListe, N = IFC.nombre;
  var ID = [1,0,0, 0,1,0, 0,0,1, 0,0,0];
  var TYPES_3D = { Brep:1, SweptSolid:1, MappedRepresentation:1, SurfaceModel:1, Tessellation:1, AdvancedSweptSolid:1, Clipping:1, CSG:1, SolidModel:1, AdvancedBrep:1 };

  // ================= Petites maths =================
  // Matrice affine = [ axe X (3), axe Y (3), axe Z (3), origine (3) ]
  function mul(A, B){
    return [
      A[0]*B[0]+A[3]*B[1]+A[6]*B[2], A[1]*B[0]+A[4]*B[1]+A[7]*B[2], A[2]*B[0]+A[5]*B[1]+A[8]*B[2],
      A[0]*B[3]+A[3]*B[4]+A[6]*B[5], A[1]*B[3]+A[4]*B[4]+A[7]*B[5], A[2]*B[3]+A[5]*B[4]+A[8]*B[5],
      A[0]*B[6]+A[3]*B[7]+A[6]*B[8], A[1]*B[6]+A[4]*B[7]+A[7]*B[8], A[2]*B[6]+A[5]*B[7]+A[8]*B[8],
      A[0]*B[9]+A[3]*B[10]+A[6]*B[11]+A[9], A[1]*B[9]+A[4]*B[10]+A[7]*B[11]+A[10], A[2]*B[9]+A[5]*B[10]+A[8]*B[11]+A[11]
    ];
  }
  function norm(v){ var l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); return l > 1e-12 && isFinite(l) ? [v[0]/l, v[1]/l, v[2]/l] : null; }
  function cross(a, b){ return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
  function dot(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
  function ortho(v, z){ var d = dot(v, z); return norm([v[0] - z[0]*d, v[1] - z[1]*d, v[2] - z[2]*d]); }
  // Repère à partir d'une origine, d'un axe Z et d'une direction X approchée
  function repere(o, z, xr){
    z = norm(z) || [0,0,1];
    var x = xr ? ortho(xr, z) : null;
    if (!x) x = ortho(Math.abs(z[0]) < .9 ? [1,0,0] : [0,1,0], z);
    var y = cross(z, x);
    return [x[0],x[1],x[2], y[0],y[1],y[2], z[0],z[1],z[2], o[0],o[1],o[2]];
  }
  function tp(M, x, y, z, out, k){
    out[k]   = M[0]*x + M[3]*y + M[6]*z + M[9];
    out[k+1] = M[1]*x + M[4]*y + M[7]*z + M[10];
    out[k+2] = M[2]*x + M[5]*y + M[8]*z + M[11];
  }

  // ================= Lecture de la géométrie =================
  function Contexte(m){
    var G = { m: m, pts: new Map(), plac: new Map(), cache: new Map(), nonLus: {}, erreurs: 0, angle: 1 };
    // unité d'angle du projet (degrés le plus souvent)
    m.ent.forEach(function(e){
      if (e.type !== "IFCCONVERSIONBASEDUNIT") return;
      var a = C(e);
      if (!a[1] || a[1].enu !== "PLANEANGLEUNIT") return;
      var mw = m.ent.get(R(a[3])), f = mw ? N(C(mw)[0]) : NaN;
      G.angle = f > 0 ? f : Math.PI/180;
    });
    return G;
  }
  function nonLu(G, t){ G.nonLus[t] = (G.nonLus[t] || 0) + 1; }

  function point(G, id){
    var p = G.pts.get(id);
    if (p) return p;
    var e = G.m.ent.get(id), c = e ? C(e)[0] : null;
    p = [0,0,0];
    if (Array.isArray(c)) for (var i = 0; i < 3 && i < c.length; i++) p[i] = N(c[i]) || 0;
    G.pts.set(id, p);
    return p;
  }
  function direction(G, v){
    var e = v && v.ref && G.m.ent.get(v.ref);
    if (!e) return null;
    var c = C(e)[0];
    if (!Array.isArray(c)) return null;
    return [N(c[0]) || 0, N(c[1]) || 0, c.length > 2 ? N(c[2]) || 0 : 0];
  }
  function axe(G, v){
    var e = v && v.ref && G.m.ent.get(v.ref);
    if (!e) return ID;
    var a = C(e);
    if (e.type === "IFCAXIS2PLACEMENT3D") return repere(point(G, R(a[0])), direction(G, a[1]) || [0,0,1], direction(G, a[2]));
    if (e.type === "IFCAXIS2PLACEMENT2D"){
      var d = direction(G, a[1]) || [1,0,0];
      return repere(point(G, R(a[0])), [0,0,1], [d[0], d[1], 0]);
    }
    return ID;
  }
  function placement(G, id, prof){
    if (!id) return ID;
    var M = G.plac.get(id);
    if (M) return M;
    var e = G.m.ent.get(id);
    M = ID;
    if (e && e.type === "IFCLOCALPLACEMENT" && (prof || 0) < 64){
      var a = C(e);
      M = mul(placement(G, R(a[0]), (prof || 0) + 1), axe(G, a[1]));
    }
    G.plac.set(id, M);
    return M;
  }
  // IFCCARTESIANTRANSFORMATIONOPERATOR3D(Axis1, Axis2, LocalOrigin, Scale, Axis3[, Scale2, Scale3])
  // et ses variantes 2D (Axis1, Axis2, LocalOrigin, Scale[, Scale2])
  function operateur(G, v){
    var e = v && v.ref && G.m.ent.get(v.ref);
    if (!e) return ID;
    var a = C(e), t = e.type, en3D = t.indexOf("3D") > 0;
    var o = a[2] ? point(G, R(a[2])) : [0,0,0];
    var s = N(a[3]); if (!(s > 0)) s = 1;
    var s2 = s, s3 = s;
    if (t.indexOf("NONUNIFORM") > 0){
      var x = N(a[en3D ? 5 : 4]); if (x > 0) s2 = x;
      if (en3D){ var y = N(a[6]); if (y > 0) s3 = y; }
    }
    var M = repere([0,0,0], en3D ? (direction(G, a[4]) || [0,0,1]) : [0,0,1], direction(G, a[0]));
    var ax2 = direction(G, a[1]);
    var yx = M[3], yy = M[4], yz = M[5];
    if (ax2 && ax2[0]*yx + ax2[1]*yy + ax2[2]*yz < 0){ yx = -yx; yy = -yy; yz = -yz; }   // repère miroir
    return [M[0]*s, M[1]*s, M[2]*s, yx*s2, yy*s2, yz*s2, M[6]*s3, M[7]*s3, M[8]*s3, o[0], o[1], o[2]];
  }

  // Face polygonale (boucles en coordonnées monde, la première est le contour extérieur)
  function ajouterFace(out, boucles){
    var b = boucles[0];
    if (!b) return;
    var n = b.length/3;
    if (n < 3) return;
    var nx = 0, ny = 0, nz = 0;
    for (var i = 0, j = n - 1; i < n; j = i++){
      var xi = b[3*i], yi = b[3*i+1], zi = b[3*i+2], xj = b[3*j], yj = b[3*j+1], zj = b[3*j+2];
      nx += (yj - yi)*(zj + zi); ny += (zj - zi)*(xj + xi); nz += (xj - xi)*(yj + yi);
    }
    var l = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (!(l > 1e-12) || !isFinite(l)) return;
    out.push({ b: boucles, n: [nx/l, ny/l, nz/l], p: null, z: 0, el: 0, x0: 0, x1: 0, y0: 0, y1: 0 });
  }
  function boucleMonde(G, ids, M){
    var a = new Float64Array(ids.length*3);
    for (var i = 0; i < ids.length; i++){ var p = point(G, ids[i]); tp(M, p[0], p[1], p[2], a, 3*i); }
    return a;
  }

  // ---------- B-rep à facettes ----------
  function face(G, id, M, out){
    var e = G.m.ent.get(id);
    if (!e) return;
    var boucles = [], ext = -1;
    L(C(e)[0]).forEach(function(b){
      var be = G.m.ent.get(b);
      if (!be) return;
      var le = G.m.ent.get(R(C(be)[0]));
      if (!le) return;
      if (le.type !== "IFCPOLYLOOP"){ nonLu(G, le.type); return; }
      if (be.type === "IFCFACEOUTERBOUND") ext = boucles.length;
      boucles.push(boucleMonde(G, L(C(le)[0]), M));
    });
    if (ext > 0){ var t = boucles[0]; boucles[0] = boucles[ext]; boucles[ext] = t; }
    if (boucles.length) ajouterFace(out, boucles);
  }
  function coque(G, id, M, out){
    var e = G.m.ent.get(id);
    if (!e) return;
    L(C(e)[0]).forEach(function(f){ face(G, f, M, out); });
  }

  // ---------- Courbes (points 3D) ----------
  function sansDoublonFinal(pts){
    if (pts.length > 2){
      var a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a[0]-b[0]) < 1e-9 && Math.abs(a[1]-b[1]) < 1e-9 && Math.abs(a[2]-b[2]) < 1e-9) pts.pop();
    }
    return pts;
  }
  function arc(cx, cy, r1, r2, t1, t2, T, out){
    var n = Math.max(4, Math.ceil(Math.abs(t2 - t1)/(2*Math.PI)*36));
    for (var i = 0; i <= n; i++){
      var t = t1 + (t2 - t1)*i/n, x = cx + r1*Math.cos(t), y = cy + r2*Math.sin(t);
      out.push(T ? [T[0]*x + T[3]*y + T[9], T[1]*x + T[4]*y + T[10], T[2]*x + T[5]*y + T[11]] : [x, y, 0]);
    }
  }
  // Arc passant par trois points (IFCARCINDEX), dans le plan XY
  function arc3(p, q, r, out){
    var ax = p[0], ay = p[1], bx = q[0], by = q[1], cx = r[0], cy = r[1];
    var d = 2*(ax*(by - cy) + bx*(cy - ay) + cx*(ay - by));
    if (Math.abs(d) < 1e-12){ out.push(p, q, r); return; }
    var ux = ((ax*ax + ay*ay)*(by - cy) + (bx*bx + by*by)*(cy - ay) + (cx*cx + cy*cy)*(ay - by))/d;
    var uy = ((ax*ax + ay*ay)*(cx - bx) + (bx*bx + by*by)*(ax - cx) + (cx*cx + cy*cy)*(bx - ax))/d;
    var rr = Math.hypot(ax - ux, ay - uy);
    var t1 = Math.atan2(ay - uy, ax - ux), tm = Math.atan2(by - uy, bx - ux), t2 = Math.atan2(cy - uy, cx - ux);
    function entre(a, b, c){ var x = (b - a + 4*Math.PI) % (2*Math.PI), y = (c - a + 4*Math.PI) % (2*Math.PI); return x < y; }
    if (entre(t1, tm, t2)){ while (t2 < t1) t2 += 2*Math.PI; }
    else { while (t2 > t1) t2 -= 2*Math.PI; }
    arc(ux, uy, rr, rr, t1, t2, null, out);
  }
  function courbe(G, id, prof){
    var e = G.m.ent.get(id);
    if (!e || (prof || 0) > 16) return null;
    var a = C(e), out = [], T;
    switch (e.type){
      case "IFCPOLYLINE":
        L(a[0]).forEach(function(p){ out.push(point(G, p)); });
        return sansDoublonFinal(out);
      case "IFCINDEXEDPOLYCURVE": {
        var pl = G.m.ent.get(R(a[0])), co = pl ? C(pl)[0] : null;
        if (!Array.isArray(co)) return null;
        var P = co.map(function(c){ return [N(c[0]) || 0, N(c[1]) || 0, c.length > 2 ? N(c[2]) || 0 : 0]; });
        if (!Array.isArray(a[1])) return sansDoublonFinal(P);
        a[1].forEach(function(seg){
          var ix = seg && seg.type ? seg.v : null;
          if (!Array.isArray(ix)) return;
          var q = ix.map(function(k){ return P[N(k) - 1]; }).filter(Boolean);
          if (seg.type === "IFCARCINDEX" && q.length === 3) arc3(q[0], q[1], q[2], out);
          else q.forEach(function(x){ out.push(x); });
        });
        return sansDoublonFinal(out);
      }
      case "IFCCOMPOSITECURVE": case "IFCCOMPOSITECURVEONSURFACE":
        L(a[0]).forEach(function(s){
          var se = G.m.ent.get(s);
          if (!se) return;
          var sa = C(se), c = courbe(G, R(sa[2]), (prof || 0) + 1);
          if (!c) return;
          if (sa[1] && sa[1].enu === "F") c = c.slice().reverse();
          c.forEach(function(p){
            var d = out[out.length - 1];
            if (!d || Math.abs(d[0]-p[0]) + Math.abs(d[1]-p[1]) + Math.abs(d[2]-p[2]) > 1e-9) out.push(p);
          });
        });
        return sansDoublonFinal(out);
      case "IFCCIRCLE":
        T = axe(G, a[0]); arc(0, 0, N(a[1]), N(a[1]), 0, 2*Math.PI, T, out); out.pop();
        return out;
      case "IFCELLIPSE":
        T = axe(G, a[0]); arc(0, 0, N(a[1]), N(a[2]), 0, 2*Math.PI, T, out); out.pop();
        return out;
      case "IFCTRIMMEDCURVE": {
        var be = G.m.ent.get(R(a[0]));
        if (!be) return null;
        var ba = C(be), sens = !(a[3] && a[3].enu === "F");
        function bout(tr){
          var r = { pt: null, par: NaN };
          (Array.isArray(tr) ? tr : []).forEach(function(v){
            if (v && v.ref) r.pt = point(G, v.ref);
            else if (v && v.type) r.par = N(v);
            else if (typeof v === "number") r.par = v;
          });
          return r;
        }
        var b1 = bout(a[1]), b2 = bout(a[2]);
        if (be.type === "IFCLINE"){
          if (b1.pt && b2.pt) return [b1.pt, b2.pt];
          return null;
        }
        if (be.type === "IFCCIRCLE" || be.type === "IFCELLIPSE"){
          T = axe(G, ba[0]);
          var r1 = N(ba[1]), r2 = be.type === "IFCELLIPSE" ? N(ba[2]) : r1;
          function angle(b){
            if (b.pt){
              var dx = b.pt[0] - T[9], dy = b.pt[1] - T[10], dz = b.pt[2] - T[11];
              return Math.atan2((dx*T[3] + dy*T[4] + dz*T[5])/r2, (dx*T[0] + dy*T[1] + dz*T[2])/r1);
            }
            return b.par*G.angle;
          }
          var t1 = angle(b1), t2 = angle(b2);
          if (!isFinite(t1) || !isFinite(t2)) return null;
          if (sens){ while (t2 <= t1) t2 += 2*Math.PI; }
          else { while (t2 >= t1) t2 -= 2*Math.PI; }
          arc(0, 0, r1, r2, t1, t2, T, out);
          return out;
        }
        nonLu(G, be.type);
        return null;
      }
    }
    nonLu(G, e.type);
    return null;
  }

  // ---------- Profils (boucles 2D à plat [x0,y0,x1,y1,…], la première est l'extérieur) ----------
  function rect(X, Y){ return [-X,-Y, X,-Y, X,Y, -X,Y]; }
  function cercle(rx, ry, n){
    n = n || 32; var o = [];
    for (var i = 0; i < n; i++){ var t = 2*Math.PI*i/n; o.push(rx*Math.cos(t), (ry || rx)*Math.sin(t)); }
    return o;
  }
  function transf2(T, l){
    var o = new Array(l.length);
    for (var i = 0; i < l.length; i += 2){
      o[i] = T[0]*l[i] + T[3]*l[i+1] + T[9];
      o[i+1] = T[1]*l[i] + T[4]*l[i+1] + T[10];
    }
    return o;
  }
  function plat(c){
    if (!c || c.length < 3) return null;
    var o = [];
    c.forEach(function(p){ o.push(p[0], p[1]); });
    return o;
  }
  // Arrondit les sommets d'un contour à plat (rayon par sommet, 0 ou NaN = angle vif) : congés
  // âme-aile, arrondis de bout d'aile, coins des tubes. Arcs découpés tous les 15° au plus.
  function arrondir(pts, rr){
    var n = pts.length/2, out = [];
    for (var i = 0; i < n; i++){
      var r = rr[i], vx = pts[2*i], vy = pts[2*i+1];
      if (!(r > 0)){ out.push(vx, vy); continue; }
      var p = (i + n - 1) % n, s = (i + 1) % n;
      var ax = pts[2*p] - vx, ay = pts[2*p+1] - vy, bx = pts[2*s] - vx, by = pts[2*s+1] - vy;
      var la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (!(la > 0 && lb > 0)){ out.push(vx, vy); continue; }
      ax /= la; ay /= la; bx /= lb; by /= lb;
      var th = Math.acos(Math.max(-1, Math.min(1, ax*bx + ay*by)));
      if (th < 1e-3 || th > Math.PI - 1e-3){ out.push(vx, vy); continue; }
      var tg = r/Math.tan(th/2), lim = .49*Math.min(la, lb);
      if (tg > lim){ r *= lim/tg; tg = lim; }
      var ux = ax + bx, uy = ay + by, lu = Math.hypot(ux, uy);
      ux /= lu; uy /= lu;
      var d = r/Math.sin(th/2), cx = vx + ux*d, cy = vy + uy*d;
      var a1 = Math.atan2(vy + ay*tg - cy, vx + ax*tg - cx), a2 = Math.atan2(vy + by*tg - cy, vx + bx*tg - cx), da = a2 - a1;
      while (da > Math.PI) da -= 2*Math.PI;
      while (da < -Math.PI) da += 2*Math.PI;
      var m = Math.max(2, Math.ceil(Math.abs(da)/(Math.PI/12)));
      for (var k = 0; k <= m; k++){ var t = a1 + da*k/m; out.push(cx + r*Math.cos(t), cy + r*Math.sin(t)); }
    }
    return out;
  }

  function profil(G, id, prof){
    var e = G.m.ent.get(id);
    if (!e || (prof || 0) > 8) return null;
    var a = C(e), t = e.type, B = null, pos = a[2];
    var X, Y, w, h, b, bt, tw, tf, tt, rf, rt, re, ri, g, pente, xw;
    // épaisseur d'une aile à pente (IPN, UPN) : tf est mesurée au milieu du débord, de xw (âme) à xt (bout)
    function ep(x, xa, xb){ return tf + ((xa + xb)/2 - x)*pente; }
    function angle(v){ var x = N(v)*G.angle; return isFinite(x) ? Math.tan(x) : 0; }
    switch (t){
      case "IFCRECTANGLEPROFILEDEF":
        B = [rect(N(a[3])/2, N(a[4])/2)]; break;
      case "IFCROUNDEDRECTANGLEPROFILEDEF":
        ri = N(a[5]);
        B = [arrondir(rect(N(a[3])/2, N(a[4])/2), [ri, ri, ri, ri])]; break;
      case "IFCRECTANGLEHOLLOWPROFILEDEF":
        X = N(a[3])/2; Y = N(a[4])/2; w = N(a[5]); ri = N(a[6]); re = N(a[7]);
        B = [arrondir(rect(X, Y), [re, re, re, re]), arrondir(rect(X - w, Y - w), [ri, ri, ri, ri])]; break;
      case "IFCCIRCLEPROFILEDEF":
        B = [cercle(N(a[3]))]; break;
      case "IFCCIRCLEHOLLOWPROFILEDEF":
        B = [cercle(N(a[3])), cercle(N(a[3]) - N(a[4]))]; break;
      case "IFCELLIPSEPROFILEDEF":
        B = [cercle(N(a[3]), N(a[4]))]; break;
      case "IFCISHAPEPROFILEDEF":
        // (…, OverallWidth, OverallDepth, WebThickness, FlangeThickness, FilletRadius[, FlangeEdgeRadius, FlangeSlope])
        b = N(a[3])/2; h = N(a[4])/2; tw = N(a[5])/2; tf = N(a[6]); rf = N(a[7]); re = N(a[8]); pente = angle(a[9]);
        B = [arrondir([-b,-h, b,-h, b,-h+ep(b,tw,b), tw,-h+ep(tw,tw,b), tw,h-ep(tw,tw,b), b,h-ep(b,tw,b), b,h,
          -b,h, -b,h-ep(b,tw,b), -tw,h-ep(tw,tw,b), -tw,-h+ep(tw,tw,b), -b,-h+ep(b,tw,b)],
          [0,0,re,rf,rf,re,0,0,re,rf,rf,re])]; break;
      case "IFCASYMMETRICISHAPEPROFILEDEF":
        // (…, largeur bas, hauteur, âme, aile bas, congé bas, largeur haut, aile haut, congé haut, …)
        b = N(a[3])/2; h = N(a[4])/2; tw = N(a[5])/2; tf = N(a[6]); rf = N(a[7]);
        bt = N(a[8])/2 || b; tt = N(a[9]) || tf; rt = N(a[10]); if (!(rt >= 0)) rt = rf;
        B = [arrondir([-b,-h, b,-h, b,-h+tf, tw,-h+tf, tw,h-tt, bt,h-tt, bt,h, -bt,h, -bt,h-tt, -tw,h-tt, -tw,-h+tf, -b,-h+tf],
          [0,0,0,rf,rt,0,0,0,0,rt,rf,0])]; break;
      case "IFCTSHAPEPROFILEDEF":
        // (…, Depth, FlangeWidth, WebThickness, FlangeThickness, FilletRadius, FlangeEdgeRadius, WebEdgeRadius, …)
        h = N(a[3])/2; b = N(a[4])/2; tw = N(a[5])/2; tf = N(a[6]); rf = N(a[7]); re = N(a[8]); rt = N(a[9]);
        B = [arrondir([-b,h, b,h, b,h-tf, tw,h-tf, tw,-h, -tw,-h, -tw,h-tf, -b,h-tf], [0,0,re,rf,rt,rt,rf,re])]; break;
      case "IFCUSHAPEPROFILEDEF":
        // (…, Depth, FlangeWidth, WebThickness, FlangeThickness, FilletRadius, EdgeRadius, FlangeSlope)
        h = N(a[3])/2; b = N(a[4])/2; tw = N(a[5]); tf = N(a[6]); rf = N(a[7]); re = N(a[8]); pente = angle(a[9]);
        xw = -b + tw;
        B = [arrondir([-b,-h, b,-h, b,-h+ep(b,xw,b), xw,-h+ep(xw,xw,b), xw,h-ep(xw,xw,b), b,h-ep(b,xw,b), b,h, -b,h],
          [0,0,re,rf,rf,re,0,0])]; break;
      case "IFCCSHAPEPROFILEDEF":
        // profil formé à froid : (…, Depth, Width, WallThickness, Girth, InternalFilletRadius)
        h = N(a[3])/2; b = N(a[4])/2; tw = N(a[5]); g = N(a[6]); ri = N(a[7]) || 0; re = ri + tw;
        B = [g > tw
          ? arrondir([-b,-h, b,-h, b,-h+g, b-tw,-h+g, b-tw,-h+tw, -b+tw,-h+tw, -b+tw,h-tw, b-tw,h-tw, b-tw,h-g, b,h-g, b,h, -b,h],
              [re,re,0,0,ri,ri,ri,ri,0,0,re,re])
          : arrondir([-b,-h, b,-h, b,-h+tw, -b+tw,-h+tw, -b+tw,h-tw, b,h-tw, b,h, -b,h], [re,0,0,ri,ri,0,0,re])]; break;
      case "IFCLSHAPEPROFILEDEF":
        // (…, Depth, Width, Thickness, FilletRadius, EdgeRadius, LegSlope)
        h = N(a[3])/2; b = (N(a[4]) || N(a[3]))/2; tw = N(a[5]); rf = N(a[6]); re = N(a[7]);
        B = [arrondir([-b,-h, b,-h, b,-h+tw, -b+tw,-h+tw, -b+tw,h, -b,h], [0,0,re,rf,re,0])]; break;
      case "IFCZSHAPEPROFILEDEF":
        // (…, Depth, FlangeWidth, WebThickness, FlangeThickness, FilletRadius, EdgeRadius)
        h = N(a[3])/2; b = N(a[4]); tw = N(a[5])/2; tf = N(a[6]); rf = N(a[7]); re = N(a[8]);
        B = [arrondir([-tw,-h, b-tw,-h, b-tw,-h+tf, tw,-h+tf, tw,h, -b+tw,h, -b+tw,h-tf, -tw,h-tf], [0,0,re,rf,0,0,re,rf])]; break;
      case "IFCARBITRARYCLOSEDPROFILEDEF":
        B = [plat(courbe(G, R(a[2])))]; pos = null; break;
      case "IFCARBITRARYPROFILEDEFWITHVOIDS":
        B = [plat(courbe(G, R(a[2])))].concat(L(a[3]).map(function(c){ return plat(courbe(G, c)); })); pos = null; break;
      case "IFCDERIVEDPROFILEDEF": {
        var parent = profil(G, R(a[2]), (prof || 0) + 1);
        if (!parent) return null;
        var T = operateur(G, a[3]);
        return parent.map(function(l){ return transf2(T, l); });
      }
      case "IFCCOMPOSITEPROFILEDEF": {
        var tout = [];
        L(a[2]).forEach(function(p){ var q = profil(G, p, (prof || 0) + 1); if (q) tout = tout.concat(q); });
        return tout.length ? tout : null;
      }
      default:
        nonLu(G, t); return null;
    }
    B = B.filter(function(l){
      if (!l || l.length < 6) return false;
      for (var i = 0; i < l.length; i++) if (!isFinite(l[i])) return false;
      return true;
    });
    if (!B.length) return null;
    if (pos){ var P = axe(G, pos); B = B.map(function(l){ return transf2(P, l); }); }
    return B;
  }

  // Extrusion de boucles 2D (repère P) selon le vecteur v (dans le repère P)
  function extruder(B, P, v, out){
    var bas = [], haut = [];
    B.forEach(function(l){
      var n = l.length/2, b = new Float64Array(3*n), t = new Float64Array(3*n);
      for (var i = 0; i < n; i++){
        tp(P, l[2*i], l[2*i+1], 0, b, 3*i);
        tp(P, l[2*i] + v[0], l[2*i+1] + v[1], v[2], t, 3*i);
      }
      bas.push(b); haut.push(t);
      for (var k = 0; k < n; k++){
        var j = (k + 1) % n, q = new Float64Array(12);
        q[0] = b[3*k]; q[1] = b[3*k+1]; q[2] = b[3*k+2];
        q[3] = b[3*j]; q[4] = b[3*j+1]; q[5] = b[3*j+2];
        q[6] = t[3*j]; q[7] = t[3*j+1]; q[8] = t[3*j+2];
        q[9] = t[3*k]; q[10] = t[3*k+1]; q[11] = t[3*k+2];
        ajouterFace(out, [q]);
      }
    });
    ajouterFace(out, bas);
    ajouterFace(out, haut);
  }
  function extrusion(G, a, M, out){
    var B = profil(G, R(a[0]));
    if (!B) return;
    var P = a[1] ? mul(M, axe(G, a[1])) : M;
    var d = norm(direction(G, a[2]) || [0,0,1]) || [0,0,1], h = N(a[3]) || 0;
    extruder(B, P, [d[0]*h, d[1]*h, d[2]*h], out);
  }
  // IFCREVOLVEDAREASOLID(SweptArea, Position, Axis (IFCAXIS1PLACEMENT), Angle)
  function revolution(G, a, M, out){
    var B = profil(G, R(a[0]));
    if (!B) return;
    var P = a[1] ? mul(M, axe(G, a[1])) : M;
    var ae = G.m.ent.get(R(a[2])), aa = ae ? C(ae) : [];
    var o = aa[0] ? point(G, R(aa[0])) : [0,0,0], k = norm(direction(G, aa[1]) || [0,0,1]) || [0,0,1];
    var ang = N(a[3])*G.angle;
    if (!isFinite(ang) || ang === 0) return;
    var n = Math.max(6, Math.ceil(Math.abs(ang)/(2*Math.PI)*32));
    function tourne(x, y, t, dst, i){   // rotation de Rodrigues autour de l'axe (o, k)
      var vx = x - o[0], vy = y - o[1], vz = -o[2], c = Math.cos(t), s = Math.sin(t), kd = k[0]*vx + k[1]*vy + k[2]*vz;
      var rx = vx*c + (k[1]*vz - k[2]*vy)*s + k[0]*kd*(1 - c);
      var ry = vy*c + (k[2]*vx - k[0]*vz)*s + k[1]*kd*(1 - c);
      var rz = vz*c + (k[0]*vy - k[1]*vx)*s + k[2]*kd*(1 - c);
      tp(P, rx + o[0], ry + o[1], rz + o[2], dst, i);
    }
    B.forEach(function(l){
      var m = l.length/2, anneaux = [];
      for (var s = 0; s <= n; s++){
        var r = new Float64Array(3*m);
        for (var i = 0; i < m; i++) tourne(l[2*i], l[2*i+1], ang*s/n, r, 3*i);
        anneaux.push(r);
      }
      for (s = 0; s < n; s++){
        var A = anneaux[s], Bq = anneaux[s + 1];
        for (var i2 = 0; i2 < m; i2++){
          var j = (i2 + 1) % m, q = new Float64Array([A[3*i2],A[3*i2+1],A[3*i2+2], A[3*j],A[3*j+1],A[3*j+2], Bq[3*j],Bq[3*j+1],Bq[3*j+2], Bq[3*i2],Bq[3*i2+1],Bq[3*i2+2]]);
          ajouterFace(out, [q]);
        }
      }
      if (Math.abs(ang) < 2*Math.PI - 1e-6){ ajouterFace(out, [anneaux[0]]); ajouterFace(out, [anneaux[n]]); }
    });
  }
  // IFCSWEPTDISKSOLID(Directrix, Radius, …) : tube à 8 pans, segment par segment
  function tube(G, a, M, out){
    var c = courbe(G, R(a[0])), r = N(a[1]);
    if (!c || c.length < 2 || !(r > 0)) return;
    var W = c.map(function(p){ var o = [0,0,0]; tp(M, p[0], p[1], p[2], o, 0); return o; });
    var echelle = Math.hypot(M[0], M[1], M[2]) || 1;
    for (var i = 0; i + 1 < W.length; i++){
      var p = W[i], q = W[i + 1], d = norm([q[0]-p[0], q[1]-p[1], q[2]-p[2]]);
      if (!d) continue;
      var T = repere(p, d, null), l = Math.hypot(q[0]-p[0], q[1]-p[1], q[2]-p[2]);
      extruder([cercle(r*echelle, r*echelle, 8)], T, [0, 0, l], out);
    }
  }
  // Faces triangulées et polygonales (IFC4)
  function tessellation(G, e, a, M, out){
    var pl = G.m.ent.get(R(a[0])), co = pl ? C(pl)[0] : null;
    if (!Array.isArray(co)) return;
    var P = new Float64Array(co.length*3);
    co.forEach(function(c, i){ tp(M, N(c[0]) || 0, N(c[1]) || 0, N(c[2]) || 0, P, 3*i); });
    var tri = e.type === "IFCTRIANGULATEDFACESET", pn = tri ? a[4] : a[3];
    pn = Array.isArray(pn) && pn.length ? pn : null;
    function boucle(ix){
      if (!Array.isArray(ix)) return null;
      var b = new Float64Array(ix.length*3);
      for (var i = 0; i < ix.length; i++){
        var k = N(ix[i]);
        if (pn) k = N(pn[k - 1]);
        k = (k - 1)*3;
        if (!(k >= 0 && k + 2 < P.length)) return null;
        b[3*i] = P[k]; b[3*i+1] = P[k+1]; b[3*i+2] = P[k+2];
      }
      return b;
    }
    if (tri){
      (Array.isArray(a[3]) ? a[3] : []).forEach(function(t){ var b = boucle(t); if (b) ajouterFace(out, [b]); });
      return;
    }
    L(a[2]).forEach(function(f){
      var fe = G.m.ent.get(f);
      if (!fe) return;
      var fa = C(fe), b = boucle(fa[0]);
      if (!b) return;
      var bs = [b];
      if (fe.type === "IFCINDEXEDPOLYGONALFACEWITHVOIDS" && Array.isArray(fa[1])) fa[1].forEach(function(v){ var x = boucle(v); if (x) bs.push(x); });
      ajouterFace(out, bs);
    });
  }

  // ---------- Découpe par un demi-espace ----------
  // IFCHALFSPACESOLID(IFCPLANE, AgreementFlag) sous la matrice M : plan { p, n } dans le monde, n tournée vers
  // la matière du demi-espace (celle qu'une différence enlève). null pour les demi-espaces bornés.
  function demiEspace(G, hs, M){
    if (!hs || hs.type !== "IFCHALFSPACESOLID") return null;
    var a = C(hs), pl = G.m.ent.get(R(a[0]));
    if (!pl || pl.type !== "IFCPLANE") return null;
    var P = mul(M, axe(G, C(pl)[0])), n = norm(cross([P[0], P[1], P[2]], [P[3], P[4], P[5]]));
    if (!n) return null;
    if (dot(n, [P[6], P[7], P[8]]) < 0) n = [-n[0], -n[1], -n[2]];
    // AgreementFlag vrai : la normale du plan s'éloigne de la matière
    if (a[1] && a[1].enu === "T") n = [-n[0], -n[1], -n[2]];
    return { p: [P[9], P[10], P[11]], n: n };
  }
  // Boucle plane coupée par le plan (on garde n·x ≤ d) ; les passages sortie → entrée sont des arêtes posées
  // sur le plan, ajoutées à segs. Renvoie la boucle (inchangée si rien ne dépasse) ou null.
  function couperPlan(pts, n, d0, eps, segs){
    var m = pts.length/3, d = new Array(m), dehors = 0, i;
    for (i = 0; i < m; i++){
      d[i] = n[0]*pts[3*i] + n[1]*pts[3*i + 1] + n[2]*pts[3*i + 2] - d0;
      if (d[i] > eps) dehors++;
    }
    if (!dehors) return pts;
    if (dehors === m) return null;
    var out = [], ev = [];
    for (i = 0; i < m; i++){
      var j = (i + 1) % m, a = d[i] <= eps, b = d[j] <= eps;
      if (a) out.push(pts[3*i], pts[3*i + 1], pts[3*i + 2]);
      if (a === b) continue;
      // point de passage calculé toujours dans le même sens de l'arête : identique pour les deux faces voisines
      var u = i, v = j;
      if (pts[3*u] > pts[3*v] || (pts[3*u] === pts[3*v] && (pts[3*u + 1] > pts[3*v + 1] || (pts[3*u + 1] === pts[3*v + 1] && pts[3*u + 2] > pts[3*v + 2])))){ u = j; v = i; }
      var t = Math.max(0, Math.min(1, d[u]/(d[u] - d[v])));
      var q = [pts[3*u] + t*(pts[3*v] - pts[3*u]), pts[3*u + 1] + t*(pts[3*v + 1] - pts[3*u + 1]), pts[3*u + 2] + t*(pts[3*v + 2] - pts[3*u + 2])];
      out.push(q[0], q[1], q[2]);
      ev.push({ sortie: a, q: q });
    }
    var k0 = 0;
    while (k0 < ev.length && !ev[k0].sortie) k0++;
    for (var k = 0; k < ev.length - 1 && k0 < ev.length; k += 2){
      var s = ev[(k0 + k) % ev.length], e = ev[(k0 + k + 1) % ev.length];
      if (s.sortie && !e.sortie) segs.push(s.q, e.q);
    }
    return out.length >= 9 ? out : null;
  }
  // Faces (monde) d'un solide coupées par le plan (p, n) : on garde le côté n·(x − p) ≤ 0 et on ferme la
  // coupe par des faces posées sur le plan (contours chaînés, trous rangés dans leur contour)
  function couperDemiEspace(faces, p, n, out){
    if (!faces.length) return;
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    faces.forEach(function(f){ var b = f.b[0]; for (var i = 0; i < b.length; i += 3) for (var k = 0; k < 3; k++){ if (b[i+k] < mn[k]) mn[k] = b[i+k]; if (b[i+k] > mx[k]) mx[k] = b[i+k]; } });
    var taille = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1, eps = taille*1e-9, d0 = dot(n, p), segs = [];
    faces.forEach(function(f){
      var bs = [], s = [], change = false;
      for (var k = 0; k < f.b.length; k++){
        var r = couperPlan(f.b[k], n, d0, eps, s);
        if (r !== f.b[k]) change = true;
        if (r) bs.push(r);
        else if (k === 0) return;          // contour extérieur entièrement dehors : la face part
      }
      if (!change){ out.push(f); return; }
      for (var i = 0; i < s.length; i++) segs.push(s[i]);
      ajouterFace(out, bs);
    });
    if (!segs.length) return;
    // chaînage des arêtes de coupe en boucles fermées
    var q = taille*1e-7, bouts = new Map();
    function cle(v){ return Math.round(v[0]/q) + "," + Math.round(v[1]/q) + "," + Math.round(v[2]/q); }
    var S = [];
    for (var i = 0; i < segs.length; i += 2){
      var ka = cle(segs[i]), kb = cle(segs[i + 1]);
      if (ka === kb) continue;
      var x = { a: segs[i], b: segs[i + 1], ka: ka, kb: kb, pris: false };
      S.push(x);
      [ka, kb].forEach(function(k){ var l = bouts.get(k); if (!l) bouts.set(k, l = []); l.push(x); });
    }
    var boucles = [];
    S.forEach(function(s0){
      if (s0.pris) return;
      s0.pris = true;
      var pts = [s0.a], debut = s0.ka, cur = s0.kb, pt = s0.b, ferme = false;
      for (var g = 0; g < S.length; g++){
        if (cur === debut){ ferme = true; break; }
        pts.push(pt);
        var suiv = (bouts.get(cur) || []).filter(function(y){ return !y.pris; })[0];
        if (!suiv) break;
        suiv.pris = true;
        if (suiv.ka === cur){ cur = suiv.kb; pt = suiv.b; } else { cur = suiv.ka; pt = suiv.a; }
      }
      if (ferme && pts.length >= 3) boucles.push(pts);
    });
    if (!boucles.length) return;
    // repère du plan : (u, v, n) direct
    var u = ortho(Math.abs(n[0]) < .9 ? [1, 0, 0] : [0, 1, 0], n), v = cross(n, u);
    var B = boucles.map(function(pts){
      var X = pts.map(function(P){ return dot(P, u); }), Y = pts.map(function(P){ return dot(P, v); }), A = 0;
      for (var i = 0, j = X.length - 1; i < X.length; j = i++) A += (X[j] - X[i])*(Y[j] + Y[i]);
      return { pts: pts, X: X, Y: Y, aire: A/2 };
    });
    function dedans(b, x, y){
      var c = false;
      for (var i = 0, j = b.X.length - 1; i < b.X.length; j = i++)
        if ((b.Y[i] > y) !== (b.Y[j] > y) && x < (b.X[j] - b.X[i])*(y - b.Y[i])/(b.Y[j] - b.Y[i]) + b.X[i]) c = !c;
      return c;
    }
    B.forEach(function(b){
      b.contenants = B.filter(function(o){ return o !== b && Math.abs(o.aire) > Math.abs(b.aire) && dedans(o, b.X[0], b.Y[0]); });
    });
    function aplat(b, sens){
      var pts = b.aire*sens >= 0 ? b.pts : b.pts.slice().reverse(), r = [];
      pts.forEach(function(P){ r.push(P[0], P[1], P[2]); });
      return r;
    }
    B.forEach(function(b){
      if (b.contenants.length % 2) return;          // trou : rangé avec son contour
      var bs = [aplat(b, 1)];
      B.forEach(function(h){
        if (h.contenants.length !== b.contenants.length + 1 || h.contenants.indexOf(b) < 0) return;
        bs.push(aplat(h, -1));
      });
      ajouterFace(out, bs);
    });
  }

  function item(G, id, M, out, prof){
    var e = G.m.ent.get(id);
    if (!e || prof > 12) return;
    var a = C(e);
    switch (e.type){
      case "IFCFACETEDBREP": case "IFCFACETEDBREPWITHVOIDS":
        coque(G, R(a[0]), M, out); break;
      case "IFCCLOSEDSHELL": case "IFCOPENSHELL": case "IFCCONNECTEDFACESET":
        coque(G, id, M, out); break;
      case "IFCSHELLBASEDSURFACEMODEL": case "IFCFACEBASEDSURFACEMODEL":
        L(a[0]).forEach(function(s){ coque(G, s, M, out); }); break;
      case "IFCMAPPEDITEM": {
        var src = G.m.ent.get(R(a[0]));
        if (!src) break;
        var sa = C(src), M2 = mul(mul(M, operateur(G, a[1])), axe(G, sa[0]));
        var rep = G.m.ent.get(R(sa[1]));
        if (rep) L(C(rep)[3]).forEach(function(i){ item(G, i, M2, out, prof + 1); });
        break;
      }
      case "IFCEXTRUDEDAREASOLID": case "IFCEXTRUDEDAREASOLIDTAPERED":
        extrusion(G, a, M, out); break;
      case "IFCREVOLVEDAREASOLID": case "IFCREVOLVEDAREASOLIDTAPERED":
        revolution(G, a, M, out); break;
      case "IFCSWEPTDISKSOLID": case "IFCSWEPTDISKSOLIDPOLYGONAL":
        tube(G, a, M, out); break;
      case "IFCBOOLEANRESULT": case "IFCBOOLEANCLIPPINGRESULT": {
        // différence avec un demi-espace plan : découpe calculée (face de fermeture comprise)
        var pl = a[0] && a[0].enu === "DIFFERENCE" ? demiEspace(G, G.m.ent.get(R(a[2])), M) : null;
        if (pl){
          var avant = [];
          item(G, R(a[1]), M, avant, prof + 1);
          couperDemiEspace(avant, pl.p, pl.n, out);
          break;
        }
        // aperçu : sinon on dessine l'opérande principal (les autres découpes ne sont pas calculées)
        item(G, R(a[1]), M, out, prof + 1);
        if (a[0] && a[0].enu === "UNION") item(G, R(a[2]), M, out, prof + 1);
        break;
      }
      case "IFCCSGSOLID":
        item(G, R(a[0]), M, out, prof + 1); break;
      case "IFCPOLYGONALFACESET": case "IFCTRIANGULATEDFACESET":
        tessellation(G, e, a, M, out); break;
      case "IFCBLOCK": {
        var P = mul(M, axe(G, a[0])), x = N(a[1]), y = N(a[2]), z = N(a[3]);
        if (x > 0 && y > 0 && z > 0) extruder([[0,0, x,0, x,y, 0,y]], P, [0,0,z], out);
        break;
      }
      case "IFCRIGHTCIRCULARCYLINDER": {
        var Pc = mul(M, axe(G, a[0])), hc = N(a[1]), rc = N(a[2]);
        if (hc > 0 && rc > 0) extruder([cercle(rc)], Pc, [0,0,hc], out);
        break;
      }
      case "IFCHALFSPACESOLID": case "IFCPOLYGONALBOUNDEDHALFSPACE": case "IFCBOXEDHALFSPACE":
        break;
      default:
        nonLu(G, e.type);
    }
  }

  // Représentations 3D d'un IFCPRODUCTDEFINITIONSHAPE : « Body », sinon celles d'un type 3D
  function corps(G, pds){
    var reps = L(C(pds)[2]).map(function(r){ return G.m.ent.get(r); }).filter(Boolean);
    var choix = reps.filter(function(r){ return IFC.chaine(C(r)[1]).toLowerCase() === "body"; });
    return choix.length ? choix : reps.filter(function(r){ return TYPES_3D[IFC.chaine(C(r)[2])]; });
  }
  function geometrie(G, id){
    if (G.cache.has(id)) return G.cache.get(id);
    var res = null;
    try {
      var e = G.m.ent.get(id), a = C(e), pds = G.m.ent.get(R(a[6]));
      if (pds){
        var choix = corps(G, pds);
        var M = placement(G, R(a[5])), faces = [];
        choix.forEach(function(r){ L(C(r)[3]).forEach(function(i){ item(G, i, M, faces, 0); }); });
        if (faces.length){
          var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          faces.forEach(function(f){
            var b = f.b[0];
            for (var i = 0; i < b.length; i += 3) for (var k = 0; k < 3; k++){
              if (b[i+k] < mn[k]) mn[k] = b[i+k];
              if (b[i+k] > mx[k]) mx[k] = b[i+k];
            }
          });
          res = { faces: faces, min: mn, max: mx };
        }
      }
    } catch (err){ G.erreurs++; }
    G.cache.set(id, res);
    return res;
  }

  // ================= Maillage : arêtes vives et triangles =================
  // Arêtes vives : bord libre, ou angle marqué entre les deux faces qui la partagent. Les facettes
  // d'un rond ou d'une face triangulée ne montrent donc plus leurs coutures.
  var COS_VIF = Math.cos(28*Math.PI/180);
  function aretesVives(geo){
    if (geo.A) return geo.A;
    var faces = geo.faces, q = Math.max(1e-9, Math.hypot(geo.max[0] - geo.min[0], geo.max[1] - geo.min[1], geo.max[2] - geo.min[2])*1e-6);
    var tab = new Map();
    function cle(b, i){ return Math.round(b[i]/q) + "," + Math.round(b[i+1]/q) + "," + Math.round(b[i+2]/q); }
    faces.forEach(function(f, fi){
      f.ar = [];
      f.b.forEach(function(b, bi){
        var n = b.length/3;
        for (var i = 0; i < n; i++){
          var j = (i + 1) % n, a = cle(b, 3*i), c = cle(b, 3*j);
          if (a === c) continue;
          var k = a < c ? a + "|" + c : c + "|" + a, l = tab.get(k);
          if (!l) tab.set(k, l = []);
          l.push(fi, bi, i);
        }
      });
    });
    var seg = [];
    tab.forEach(function(l){
      var vive = l.length !== 6;
      if (!vive) vive = Math.abs(dot(faces[l[0]].n, faces[l[3]].n)) < COS_VIF;
      if (!vive) return;
      for (var r = 0; r < l.length; r += 3) faces[l[r]].ar.push(l[r+1], l[r+2]);
      var b = faces[l[0]].b[l[1]], i = l[2], j = (i + 1) % (b.length/3);
      seg.push(b[3*i], b[3*i+1], b[3*i+2], b[3*j], b[3*j+1], b[3*j+2]);
    });
    geo.A = new Float64Array(seg);
    return geo.A;
  }

  // Triangulation d'une face plane avec trous (ponts vers les trous, puis découpe en oreilles)
  function aire(ix, X, Y){
    var s = 0;
    for (var i = 0, j = ix.length - 1; i < ix.length; j = i++) s += (X[ix[j]] - X[ix[i]])*(Y[ix[j]] + Y[ix[i]]);
    return s/2;
  }
  function orient(ax, ay, bx, by, cx, cy){ return (bx - ax)*(cy - ay) - (by - ay)*(cx - ax); }
  function croise(X, Y, a, b, c, d){
    var d1 = orient(X[a], Y[a], X[b], Y[b], X[c], Y[c]), d2 = orient(X[a], Y[a], X[b], Y[b], X[d], Y[d]);
    var d3 = orient(X[c], Y[c], X[d], Y[d], X[a], Y[a]), d4 = orient(X[c], Y[c], X[d], Y[d], X[b], Y[b]);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function memePoint(X, Y, a, b){ return X[a] === X[b] && Y[a] === Y[b]; }
  function ponts(ext, trous, X, Y){
    trous.sort(function(h, k){
      var mh = -Infinity, mk = -Infinity;
      h.forEach(function(i){ if (X[i] > mh) mh = X[i]; });
      k.forEach(function(i){ if (X[i] > mk) mk = X[i]; });
      return mk - mh;
    });
    trous.forEach(function(h, ti){
      var im = 0;
      for (var i = 1; i < h.length; i++) if (X[h[i]] > X[h[im]]) im = i;
      var M = h[im], best = -1, bestD = Infinity, secours = -1, secoursD = Infinity;
      for (var p = 0; p < ext.length; p++){
        var P = ext[p], d = (X[P] - X[M])*(X[P] - X[M]) + (Y[P] - Y[M])*(Y[P] - Y[M]);
        if (d < secoursD){ secoursD = d; secours = p; }
        if (d >= bestD) continue;
        var libre = true, e, u, v;
        for (e = 0; e < ext.length && libre; e++){
          u = ext[e]; v = ext[(e + 1) % ext.length];
          if (u === P || v === P || memePoint(X, Y, u, P) || memePoint(X, Y, v, P)) continue;
          if (croise(X, Y, M, P, u, v)) libre = false;
        }
        for (var t = ti; t < trous.length && libre; t++){
          var hh = trous[t];
          for (e = 0; e < hh.length && libre; e++){
            u = hh[e]; v = hh[(e + 1) % hh.length];
            if (u === M || v === M) continue;
            if (croise(X, Y, M, P, u, v)) libre = false;
          }
        }
        if (libre){ best = p; bestD = d; }
      }
      if (best < 0) best = secours;
      var tour = h.slice(im).concat(h.slice(0, im + 1));
      ext = ext.slice(0, best + 1).concat(tour, [ext[best]], ext.slice(best + 1));
    });
    return ext;
  }
  function dansTri(X, Y, a, b, c, p){
    return orient(X[a], Y[a], X[b], Y[b], X[p], Y[p]) >= 0 && orient(X[b], Y[b], X[c], Y[c], X[p], Y[p]) >= 0 && orient(X[c], Y[c], X[a], Y[a], X[p], Y[p]) >= 0;
  }
  function oreilles(poly, X, Y, out){
    var n = poly.length, prev = new Int32Array(n), next = new Int32Array(n);
    for (var k = 0; k < n; k++){ prev[k] = (k + n - 1) % n; next[k] = (k + 1) % n; }
    var reste = n, i = 0, essais = 0;
    function coupe(i){
      out.push(poly[prev[i]], poly[i], poly[next[i]]);
      next[prev[i]] = next[i]; prev[next[i]] = prev[i]; reste--; essais = 0;
      return next[i];
    }
    while (reste > 3){
      var a = prev[i], c = next[i], A = poly[a], B = poly[i], Cc = poly[c], ok = false;
      if (orient(X[A], Y[A], X[B], Y[B], X[Cc], Y[Cc]) > 0){
        ok = true;
        for (var p = next[c]; p !== a && ok; p = next[p]){
          var P = poly[p];
          if (memePoint(X, Y, P, A) || memePoint(X, Y, P, B) || memePoint(X, Y, P, Cc)) continue;
          if (dansTri(X, Y, A, B, Cc, P)) ok = false;
        }
      }
      if (ok){ i = coupe(i); continue; }
      i = c;
      if (++essais > reste) i = coupe(i);      // polygone dégénéré : on coupe quand même
    }
    out.push(poly[prev[i]], poly[i], poly[next[i]]);
  }
  // Triangles d'une face : tableau d'indices dans la liste des sommets de ses boucles mises bout à bout
  function trianguler(f){
    var b = f.b;
    if (b.length === 1){
      var n0 = b[0].length/3;
      if (n0 === 3) return [0, 1, 2];
    }
    var nn = f.n, ax = Math.abs(nn[0]), ay = Math.abs(nn[1]), az = Math.abs(nn[2]), iu, iv;
    if (az >= ax && az >= ay){ iu = 0; iv = 1; } else if (ax >= ay){ iu = 1; iv = 2; } else { iu = 2; iv = 0; }
    var X = [], Y = [], boucles = [], base = 0;
    b.forEach(function(l){
      var ix = [];
      for (var i = 0; i < l.length; i += 3){ X.push(l[i + iu]); Y.push(l[i + iv]); ix.push(base + i/3); }
      base += l.length/3;
      boucles.push(ix);
    });
    var ext = boucles[0], sens = aire(ext, X, Y) < 0 ? -1 : 1;
    if (sens < 0) for (var k = 0; k < X.length; k++) X[k] = -X[k];      // contour extérieur dans le sens direct
    if (b.length === 1 && n0 === 4){
      // quadrilatère : coupé par la diagonale qui reste à l'intérieur
      if (orient(X[0], Y[0], X[1], Y[1], X[2], Y[2]) > 0 && orient(X[0], Y[0], X[2], Y[2], X[3], Y[3]) > 0) return [0, 1, 2, 0, 2, 3];
      return [1, 2, 3, 1, 3, 0];
    }
    var trous = boucles.slice(1).filter(function(h){ return h.length >= 3; }).map(function(h){ return aire(h, X, Y) > 0 ? h.slice().reverse() : h; });
    var poly = trous.length ? ponts(ext, trous, X, Y) : ext, out = [];
    if (poly.length >= 3) oreilles(poly, X, Y, out);
    return out;
  }
  // Triangles de tout l'élément, en coordonnées monde, et indice de face de chaque triangle
  function triangles(geo){
    if (geo.T) return geo.T;
    var pos = [], fac = [];
    geo.faces.forEach(function(f, fi){
      var ix = trianguler(f), P = [];
      f.b.forEach(function(l){ for (var i = 0; i < l.length; i++) P.push(l[i]); });
      for (var k = 0; k + 2 < ix.length; k += 3){
        for (var m = 0; m < 3; m++){ var v = 3*ix[k + m]; pos.push(P[v], P[v+1], P[v+2]); }
        fac.push(fi);
      }
    });
    geo.T = new Float64Array(pos);
    geo.TF = fac;
    return geo.T;
  }

  // ================= Moteur WebGL =================
  // Boîte de coupe dans les fragment shaders (coordonnées relatives à l'origine du tampon)
  var COUPE = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n" +
    "uniform float uK;uniform vec3 uB0;uniform vec3 uB1;uniform vec2 uR;varying vec3 vP;" +
    "void coupe(){vec3 q=vec3(uR.x*vP.x+uR.y*vP.y,-uR.y*vP.x+uR.x*vP.y,vP.z);" +
    "if(uK>0.5&&(any(lessThan(q,uB0))||any(greaterThan(q,uB1))))discard;}";
  var SOURCES = {
    vFaces: "attribute vec3 aP;attribute vec3 aN;attribute vec3 aC;uniform mat4 uM;uniform vec3 uL;varying vec3 vC;varying vec3 vP;" +
      "void main(){gl_Position=uM*vec4(aP,1.0);float l=abs(dot(aN,uL));vC=aC*(0.34+0.66*l);vP=aP;}",
    fFaces: COUPE + "varying vec3 vC;void main(){coupe();gl_FragColor=vec4(vC,1.0);}",
    vLignes: "attribute vec3 aP;attribute vec4 aC;uniform mat4 uM;varying vec4 vC;varying vec3 vP;void main(){gl_Position=uM*vec4(aP,1.0);vC=aC;vP=aP;}",
    fLignes: COUPE + "varying vec4 vC;void main(){coupe();gl_FragColor=vC;}",
    vId: "attribute vec3 aP;attribute vec3 aC;uniform mat4 uM;varying vec3 vC;varying vec3 vP;void main(){gl_Position=uM*vec4(aP,1.0);vC=aC;vP=aP;}",
    fId: COUPE + "varying vec3 vC;void main(){coupe();gl_FragColor=vec4(vC,1.0);}"
  };

  function moteurGL(cv){
    var gl = null;
    try {
      var opts = { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false, stencil: true };
      gl = cv.getContext("webgl", opts) || cv.getContext("experimental-webgl", opts);
    } catch (e){ gl = null; }
    if (!gl) return null;

    function programme(vs, fs, attrs){
      function sh(t, src){
        var s = gl.createShader(t);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      }
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      attrs.forEach(function(a, i){ if (a) gl.bindAttribLocation(p, i, a); });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return { p: p, uM: gl.getUniformLocation(p, "uM"), uL: gl.getUniformLocation(p, "uL"),
        uK: gl.getUniformLocation(p, "uK"), uB0: gl.getUniformLocation(p, "uB0"), uB1: gl.getUniformLocation(p, "uB1"), uR: gl.getUniformLocation(p, "uR") };
    }
    var P = {}, B = {}, nTri = 0, nLig = 0, plages = [], origine = [0,0,0], fbo = null, coupe = null, kad = [214, 168, 92, 190], krouge = [200, 46, 40];
    function init(){
      P.faces = programme(SOURCES.vFaces, SOURCES.fFaces, ["aP", "aN", "aC"]);
      P.lignes = programme(SOURCES.vLignes, SOURCES.fLignes, ["aP", null, "aC"]);
      P.id = programme(SOURCES.vId, SOURCES.fId, ["aP", null, "aC"]);
      ["pos", "nor", "col", "ids", "lpos", "lcol", "cadre", "quad"].forEach(function(k){ B[k] = gl.createBuffer(); });
      fbo = null;
    }
    try { init(); } catch (e){ if (window.console) console.warn("WebGL indisponible :", e); return { echec: true }; }

    var dernier = null;    // dernière liste chargée, pour reconstruire après une perte de contexte
    function remplir(buf, data, usage){ gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); }

    function charger(liste, orig){
      dernier = { liste: liste, orig: orig };
      origine = orig;
      var nv = 0, nl = 0;
      liste.forEach(function(it){ nv += triangles(it.geo).length/3; nl += aretesVives(it.geo).length/3; });
      var pos = new Float32Array(3*nv), nor = new Float32Array(3*nv), ids = new Uint8Array(3*nv), lpos = new Float32Array(3*nl);
      var v = 0, w = 0;
      plages = [];
      liste.forEach(function(it, e){
        var T = it.geo.T, TF = it.geo.TF, A = it.geo.A, faces = it.geo.faces, v0 = v, w0 = w;
        var id = e + 1, r = id & 255, g = (id >> 8) & 255, bl = (id >> 16) & 255;
        for (var k = 0; k < T.length; k += 3, v++){
          pos[3*v] = T[k] - orig[0]; pos[3*v+1] = T[k+1] - orig[1]; pos[3*v+2] = T[k+2] - orig[2];
          var n = faces[TF[(k/9) | 0]].n;
          nor[3*v] = n[0]; nor[3*v+1] = n[1]; nor[3*v+2] = n[2];
          ids[3*v] = r; ids[3*v+1] = g; ids[3*v+2] = bl;
        }
        for (k = 0; k < A.length; k += 3, w++){
          lpos[3*w] = A[k] - orig[0]; lpos[3*w+1] = A[k+1] - orig[1]; lpos[3*w+2] = A[k+2] - orig[2];
        }
        plages.push([v0, v, w0, w]);
      });
      nTri = nv; nLig = nl;
      remplir(B.pos, pos); remplir(B.nor, nor); remplir(B.ids, ids); remplir(B.lpos, lpos);
      remplir(B.col, new Uint8Array(3*nv), gl.DYNAMIC_DRAW);
      remplir(B.lcol, new Uint8Array(4*nl), gl.DYNAMIC_DRAW);
      if (coupe) poserCoupe(coupe);
    }

    function poserCoupe(b){
      coupe = b;
      if (b) remplir(B.cadre, new Float32Array(aretesBoite(b).map(function(v, k){ return v - origine[k % 3]; })));
    }
    function teinter(liste, sel, actif, coul){
      kad = coul.cadreRGBA; krouge = coul.coupeRGB;
      var col = new Uint8Array(3*nTri), lcol = new Uint8Array(4*nLig);
      var P1 = coul.piece, ar = coul.areteRGBA, aro = coul.areteOrRGBA, act = coul.actifRGBA;
      liste.forEach(function(it, e){
        var pl = plages[e];
        if (!pl) return;
        var t = it.h != null ? coul.pastel(it.h) : null;
        // contour doré seulement pour la sélection ; l'élément actif non sélectionné garde un contour neutre renforcé
        var s1 = sel.has(it.id), c = s1 ? OR : t ? t.piece : it.rgb || P1, l = s1 ? (it.id === actif ? act : aro) : it.id === actif ? coul.areteActiveRGBA : t ? t.areteRGBA : ar;
        for (var v = pl[0]; v < pl[1]; v++){ col[3*v] = c[0]; col[3*v+1] = c[1]; col[3*v+2] = c[2]; }
        for (var w = pl[2]; w < pl[3]; w++){ lcol[4*w] = l[0]; lcol[4*w+1] = l[1]; lcol[4*w+2] = l[2]; lcol[4*w+3] = l[3]; }
      });
      remplir(B.col, col, gl.DYNAMIC_DRAW);
      remplir(B.lcol, lcol, gl.DYNAMIC_DRAW);
    }

    function matrice(c){ return matriceVue(c, origine); }
    function decoupe(prog, oui){
      gl.uniform1f(prog.uK, oui && coupe ? 1 : 0);
      if (oui && coupe){
        var r = boiteRel(coupe, origine), k = cs(coupe);
        gl.uniform3fv(prog.uB0, r.b0); gl.uniform3fv(prog.uB1, r.b1); gl.uniform2f(prog.uR, k[0], k[1]);
      }
    }
    function attrib(i, buf, n, type, normalise){
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, n, type, !!normalise, 0, 0);
    }
    function faces(c, prog, couleurBuf){
      var M = matrice(c);
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.uM, false, M);
      if (prog.uL) gl.uniform3fv(prog.uL, c.lumiere);
      decoupe(prog, true);
      attrib(0, B.pos, 3, gl.FLOAT);
      if (prog === P.faces) attrib(1, B.nor, 3, gl.FLOAT); else gl.disableVertexAttribArray(1);
      attrib(2, couleurBuf, 3, gl.UNSIGNED_BYTE, true);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      if (nTri) gl.drawArrays(gl.TRIANGLES, 0, nTri);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      return M;
    }
    function dessiner(c){
      if (gl.isContextLost()) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      var M = faces(c, P.faces, B.col);
      if (nLig){
        gl.useProgram(P.lignes.p);
        gl.uniformMatrix4fv(P.lignes.uM, false, M);
        decoupe(P.lignes, true);
        attrib(0, B.lpos, 3, gl.FLOAT);
        gl.disableVertexAttribArray(1);
        attrib(2, B.lcol, 4, gl.UNSIGNED_BYTE, true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.drawArrays(gl.LINES, 0, nLig);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      if (coupe) remplirCoupes(c, M);
      if (coupe && !c.sansCadre){
        // arêtes de la boîte de coupe, en or, visibles à travers les pièces
        gl.useProgram(P.lignes.p);
        gl.uniformMatrix4fv(P.lignes.uM, false, M);
        decoupe(P.lignes, false);
        attrib(0, B.cadre, 3, gl.FLOAT);
        gl.disableVertexAttribArray(1);
        gl.disableVertexAttribArray(2);
        gl.vertexAttrib4f(2, kad[0]/255, kad[1]/255, kad[2]/255, kad[3]/255);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.LINES, 0, 24);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
      }
    }
    // Surfaces coupées en rouge, face par face de la boîte tournée vers l'œil (méthode du pochoir) :
    // la géométrie coupée par ce seul plan inverse le pochoir à chaque surface traversée ; là où le compte
    // est impair, le plan est à l'intérieur d'un solide et on y peint le rectangle de la face en rouge.
    var avecPochoir = !!(gl.getContextAttributes() || {}).stencil;
    function remplirCoupes(c, M){
      if (!avecPochoir || !nTri) return;
      var versOeil = [c.cb*c.sa, -c.cb*c.ca, c.sb], G = 1e7, rel = boiteRel(coupe, origine), kr = cs(coupe);
      for (var f = 0; f < 6; f++){
        var ax = f >> 1, max = f & 1, n = axeBoite(coupe, ax);
        if ((max ? 1 : -1)*(n[0]*versOeil[0] + n[1]*versOeil[1] + n[2]*versOeil[2]) <= 1e-6) continue;        // face vue de dos
        var b0 = [-G, -G, -G], b1 = [G, G, G];
        if (max) b1[ax] = rel.b1[ax]; else b0[ax] = rel.b0[ax];
        // 1) pochoir : parité des surfaces derrière le plan
        gl.enable(gl.STENCIL_TEST);
        gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.stencilFunc(gl.ALWAYS, 0, 1); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.colorMask(false, false, false, false); gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
        gl.useProgram(P.id.p);
        gl.uniformMatrix4fv(P.id.uM, false, M);
        gl.uniform1f(P.id.uK, 1); gl.uniform3fv(P.id.uB0, b0); gl.uniform3fv(P.id.uB1, b1); gl.uniform2f(P.id.uR, kr[0], kr[1]);
        attrib(0, B.pos, 3, gl.FLOAT); gl.disableVertexAttribArray(1); attrib(2, B.ids, 3, gl.UNSIGNED_BYTE, true);
        gl.drawArrays(gl.TRIANGLES, 0, nTri);
        // 2) rectangle de la face, en rouge uni, là où le pochoir est impair et devant la scène
        gl.colorMask(true, true, true, true); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.EQUAL, 1, 1); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        remplir(B.quad, new Float32Array(faceBoite(coupe, ax, max, origine)), gl.DYNAMIC_DRAW);
        gl.useProgram(P.lignes.p);
        gl.uniformMatrix4fv(P.lignes.uM, false, M);
        decoupe(P.lignes, false);
        attrib(0, B.quad, 3, gl.FLOAT); gl.disableVertexAttribArray(2);
        gl.vertexAttrib4f(2, krouge[0]/255, krouge[1]/255, krouge[2]/255, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.STENCIL_TEST);
      }
    }

    // Sélection : rendu des identifiants dans une image hors écran, lecture du pixel visé
    function viser(c, x, y){
      if (gl.isContextLost() || !nTri) return 0;
      var w = cv.width, h = cv.height;
      if (!fbo || fbo.w !== w || fbo.h !== h){
        if (fbo){ gl.deleteFramebuffer(fbo.f); gl.deleteTexture(fbo.t); gl.deleteRenderbuffer(fbo.r); }
        fbo = { w: w, h: h, f: gl.createFramebuffer(), t: gl.createTexture(), r: gl.createRenderbuffer() };
        gl.bindTexture(gl.TEXTURE_2D, fbo.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindRenderbuffer(gl.RENDERBUFFER, fbo.r);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbo.t, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fbo.r);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.f);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      faces(c, P.id, B.ids);
      var px = new Uint8Array(4), X = Math.round(x*c.dpr), Y = Math.round(h - y*c.dpr - 1);
      if (X >= 0 && Y >= 0 && X < w && Y < h) gl.readPixels(X, Y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return px[0] + (px[1] << 8) + (px[2] << 16);     // 0 = rien, sinon rang dans la liste + 1
    }

    return {
      nom: "WebGL", charger: charger, teinter: teinter, dessiner: dessiner, viser: viser,
      coupe: poserCoupe,
      perdu: function(){ return gl.isContextLost(); },
      restaurer: function(){ init(); if (dernier) charger(dernier.liste, dernier.orig); },
      liberer: function(){ var x = gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); }
    };
  }

  // Matrice de vue (colonnes) : même projection orthographique que le moteur canvas, sommets relatifs à l'origine
  function matriceVue(c, origine){
    var dx = origine[0] - c.centre[0], dy = origine[1] - c.centre[1], dz = origine[2] - c.centre[2];
    var kx = 2*c.s/c.W, ky = 2*c.s/c.H, kz = 1/c.prof;
    var r0 = [kx*c.ca, kx*c.sa, 0];
    var r1 = [-ky*c.sb*c.sa, ky*c.sb*c.ca, ky*c.cb];
    var r2 = [-kz*c.cb*c.sa, kz*c.cb*c.ca, -kz*c.sb];
    function t(r){ return r[0]*dx + r[1]*dy + r[2]*dz; }
    return new Float32Array([
      r0[0], r1[0], r2[0], 0,
      r0[1], r1[1], r2[1], 0,
      r0[2], r1[2], r2[2], 0,
      t(r0) + 2*c.px/c.W, t(r1) - 2*c.py/c.H, t(r2), 1
    ]);
  }

  // Sélection par le processeur (moteurs sans lecture de pixel synchrone) : rayon de vue lancé sur les
  // triangles des éléments dont la boîte projetée contient le point ; renvoie rang + 1, ou 0
  function viserCPU(liste, c, x, y, coupe){
    var X = (x - c.W/2 - c.px)/c.s, Y = (c.H/2 + c.py - y)/c.s, best = Infinity, rang = 0, C = c.centre, P = new Array(9);
    var r0 = [c.ca, c.sa, 0], r1 = [-c.sb*c.sa, c.sb*c.ca, c.cb], r2 = [-c.cb*c.sa, c.cb*c.ca, -c.sb];
    for (var e = 0; e < liste.length; e++){
      var g = liste[e].geo, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (var k = 0; k < 8; k++){
        var qx = (k & 1 ? g.max[0] : g.min[0]) - C[0], qy = (k & 2 ? g.max[1] : g.min[1]) - C[1], qz = (k & 4 ? g.max[2] : g.min[2]) - C[2];
        var u = r0[0]*qx + r0[1]*qy, v = r1[0]*qx + r1[1]*qy + r1[2]*qz;
        if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
      }
      if (X < x0 || X > x1 || Y < y0 || Y > y1) continue;
      var T = triangles(g);
      for (var t = 0; t < T.length; t += 9){
        for (var w = 0; w < 3; w++){
          var ax = T[t + 3*w] - C[0], ay = T[t + 3*w + 1] - C[1], az = T[t + 3*w + 2] - C[2];
          P[3*w] = r0[0]*ax + r0[1]*ay; P[3*w + 1] = r1[0]*ax + r1[1]*ay + r1[2]*az; P[3*w + 2] = r2[0]*ax + r2[1]*ay + r2[2]*az;
        }
        var d = (P[4] - P[7])*(P[0] - P[6]) + (P[6] - P[3])*(P[1] - P[7]);
        if (!d) continue;
        var a = ((P[4] - P[7])*(X - P[6]) + (P[6] - P[3])*(Y - P[7]))/d, b = ((P[7] - P[1])*(X - P[6]) + (P[0] - P[6])*(Y - P[7]))/d;
        if (a < -1e-6 || b < -1e-6 || a + b > 1 + 1e-6) continue;
        var z = a*P[2] + b*P[5] + (1 - a - b)*P[8];
        if (z >= best) continue;
        if (coupe && !dansBoite(coupe, C[0] + X*r0[0] + Y*r1[0] + z*r2[0], C[1] + X*r0[1] + Y*r1[1] + z*r2[1], C[2] + Y*r1[2] + z*r2[2], 1e-6)) continue;
        best = z; rang = e + 1;
      }
    }
    return rang;
  }

  // ================= Boîte de coupe : utilitaires =================
  // La boîte peut tourner autour de la verticale (b.a, radians) pour suivre un bâtiment qui n'est pas
  // d'équerre avec les axes du fichier (IFC géoréférencé) : b.min et b.max sont alors exprimés dans le
  // repère de la boîte, obtenu en tournant le repère du fichier de b.a autour de l'axe Z passant par 0.
  function cs(b){ var a = b.a || 0; return [Math.cos(a), Math.sin(a)]; }
  function versBoite(b, x, y){ var k = cs(b); return [k[0]*x + k[1]*y, -k[1]*x + k[0]*y]; }
  function versMonde(b, u, v, w){ var k = cs(b); return [k[0]*u - k[1]*v, k[1]*u + k[0]*v, w]; }
  function axeBoite(b, ax){ var k = cs(b); return ax === 0 ? [k[0], k[1], 0] : ax === 1 ? [-k[1], k[0], 0] : [0, 0, 1]; }
  function centreBoite(b){ return versMonde(b, (b.min[0] + b.max[0])/2, (b.min[1] + b.max[1])/2, (b.min[2] + b.max[2])/2); }
  // Limites de la boîte dans le repère de la boîte, relatives à un point (origine des tampons GPU)
  function boiteRel(b, o){
    var l = versBoite(b, o[0], o[1]), lo = [l[0], l[1], o[2]];
    return { b0: [0, 1, 2].map(function(i){ return b.min[i] - lo[i]; }), b1: [0, 1, 2].map(function(i){ return b.max[i] - lo[i]; }), lo: lo };
  }
  // Rectangle d'une face (axe, côté max ou min) : 6 sommets (deux triangles), relatifs à o
  function faceBoite(b, ax, max, o){
    var u = (ax + 1) % 3, v = (ax + 2) % 3, q = [];
    [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]].forEach(function(k){
      var p = [0, 0, 0];
      p[ax] = max ? b.max[ax] : b.min[ax]; p[u] = k[0] ? b.max[u] : b.min[u]; p[v] = k[1] ? b.max[v] : b.min[v];
      var w = versMonde(b, p[0], p[1], p[2]);
      q.push(w[0] - o[0], w[1] - o[1], w[2] - o[2]);
    });
    return q;
  }
  // 12 arêtes de la boîte → 24 sommets x, y, z à plat
  function aretesBoite(b){
    var x = [b.min[0], b.max[0]], y = [b.min[1], b.max[1]], z = [b.min[2], b.max[2]], r = [];
    function s(i, j, k, i2, j2, k2){
      var p = versMonde(b, x[i], y[j], z[k]), q = versMonde(b, x[i2], y[j2], z[k2]);
      r.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
    for (var a = 0; a < 2; a++) for (var c = 0; c < 2; c++){ s(0, a, c, 1, a, c); s(a, 0, c, a, 1, c); s(a, c, 0, a, c, 1); }
    return r;
  }
  // coordonnée ax (repère de la boîte) du sommet i d'une boucle à plat
  function coordBoite(b, pts, i, ax){
    if (ax === 2 || !b.a) return pts[3*i + ax];
    var k = cs(b), x = pts[3*i], y = pts[3*i + 1];
    return ax === 0 ? k[0]*x + k[1]*y : -k[1]*x + k[0]*y;
  }
  // Boucle plane (x, y, z à plat) coupée par la boîte (Sutherland–Hodgman) ; null s'il ne reste rien
  function couperBoucle(pts, b){
    for (var ax = 0; ax < 3; ax++) for (var cote = 0; cote < 2; cote++){
      var lim = cote ? b.max[ax] : b.min[ax], sg = cote ? -1 : 1, n = pts.length/3, out = [];
      for (var i = 0; i < n; i++){
        var j = (i + 1) % n, da = sg*(coordBoite(b, pts, i, ax) - lim), dj = sg*(coordBoite(b, pts, j, ax) - lim);
        if (da >= 0) out.push(pts[3*i], pts[3*i + 1], pts[3*i + 2]);
        if ((da >= 0) !== (dj >= 0)){
          var t = da/(da - dj);
          out.push(pts[3*i] + t*(pts[3*j] - pts[3*i]), pts[3*i + 1] + t*(pts[3*j + 1] - pts[3*i + 1]), pts[3*i + 2] + t*(pts[3*j + 2] - pts[3*i + 2]));
        }
      }
      if (out.length < 9) return null;
      pts = out;
    }
    return pts;
  }
  // Segment coupé par la boîte (Liang–Barsky) ; null s'il est dehors
  function couperSegment(a, b, B){
    var t0 = 0, t1 = 1, la = versBoite(B, a[0], a[1]).concat(a[2]), lb = versBoite(B, b[0], b[1]).concat(b[2]);
    for (var ax = 0; ax < 3; ax++){
      var d = lb[ax] - la[ax];
      if (Math.abs(d) < 1e-12){ if (la[ax] < B.min[ax] || la[ax] > B.max[ax]) return null; continue; }
      var u = (B.min[ax] - la[ax])/d, v = (B.max[ax] - la[ax])/d;
      if (u > v){ var w = u; u = v; v = w; }
      if (u > t0) t0 = u;
      if (v < t1) t1 = v;
      if (t0 > t1) return null;
    }
    return [a[0] + t0*(b[0] - a[0]), a[1] + t0*(b[1] - a[1]), a[2] + t0*(b[2] - a[2]), a[0] + t1*(b[0] - a[0]), a[1] + t1*(b[1] - a[1]), a[2] + t1*(b[2] - a[2])];
  }
  function dansBoite(B, x, y, z, e){
    if (B.a){ var l = versBoite(B, x, y); x = l[0]; y = l[1]; }
    return x >= B.min[0] - e && x <= B.max[0] + e && y >= B.min[1] - e && y <= B.max[1] + e && z >= B.min[2] - e && z <= B.max[2] + e;
  }

  // ================= Retaille d'un modèle selon la boîte de coupe =================
  // Plan d'une face de la boîte, normale vers l'extérieur : l'intérieur est n·x ≤ d
  function planBoite(b, ax, max){
    var e = axeBoite(b, ax);
    return max ? { n: e, d: b.max[ax] } : { n: [-e[0], -e[1], -e[2]], d: -b.min[ax] };
  }
  // Point dans un solide fermé (triangles à plat) : parité des traversées d'un rayon
  function dansSolide(T, p){
    var r = [.5773, .5774, .5775], c = 0;
    for (var t = 0; t < T.length; t += 9){
      var e1 = [T[t+3] - T[t], T[t+4] - T[t+1], T[t+5] - T[t+2]], e2 = [T[t+6] - T[t], T[t+7] - T[t+1], T[t+8] - T[t+2]];
      var h = cross(r, e2), a = dot(e1, h);
      if (Math.abs(a) < 1e-14) continue;
      var s = [p[0] - T[t], p[1] - T[t+1], p[2] - T[t+2]], u = dot(s, h)/a;
      if (u < 0 || u > 1) continue;
      var q = cross(s, e1), v = dot(r, q)/a;
      if (v < 0 || u + v > 1) continue;
      if (dot(e2, q)/a > 0) c++;
    }
    return c % 2 === 1;
  }
  // Éléments (ids) d'un modèle rangés par rapport à la boîte : dedans, dehors, à cheval (avec les plans de la
  // boîte qui les coupent), sans géométrie lue
  function classer(G, ids, b){
    var r = { dedans: [], dehors: [], acheval: [], sansGeo: [] };
    var tol = 1e-7*Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    ids.forEach(function(id){
      var g = geometrie(G, id);
      if (!g){ r.sansGeo.push(id); return; }
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      g.faces.forEach(function(f){
        var p = f.b[0];
        for (var k = 0; k < p.length/3; k++) for (var a = 0; a < 3; a++){ var v = coordBoite(b, p, k, a); if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
      });
      var plans = [], loin = false;
      for (var a = 0; a < 3; a++){
        if (mx[a] < b.min[a] - tol || mn[a] > b.max[a] + tol) loin = true;
        if (mn[a] < b.min[a] - tol) plans.push(planBoite(b, a, false));
        if (mx[a] > b.max[a] + tol) plans.push(planBoite(b, a, true));
      }
      if (loin){ r.dehors.push(id); return; }
      if (!plans.length){ r.dedans.push(id); return; }
      // une face entre dans la boîte, ou la boîte est noyée dans le solide
      if (g.faces.some(function(f){ return !!couperBoucle(f.b[0], b); }) || dansSolide(triangles(g), centreBoite(b))) r.acheval.push({ id: id, plans: plans });
      else r.dehors.push(id);
    });
    return r;
  }
  // Nombre réel au format STEP (toujours un point décimal)
  function reel(x){
    if (!isFinite(x) || Math.abs(x) < 1e-12) return "0.";
    var t = String(parseFloat(x.toPrecision(15))), k = t.indexOf("e");
    if (k >= 0){ var m = t.slice(0, k); return (m.indexOf(".") < 0 ? m + "." : m) + "E" + t.slice(k + 1); }
    return t.indexOf(".") < 0 ? t + "." : t;
  }
  // Solides qu'une opération booléenne accepte, et ceux qu'une IFCBOOLEANCLIPPINGRESULT accepte en 1er opérande
  var OPERANDES = /^IFC(EXTRUDEDAREASOLID(TAPERED)?|REVOLVEDAREASOLID(TAPERED)?|SWEPTDISKSOLID(POLYGONAL)?|SURFACECURVESWEPTAREASOLID|FIXEDREFERENCESWEPTAREASOLID|DIRECTRIXCURVESWEPTAREASOLID|FACETEDBREP(WITHVOIDS)?|ADVANCEDBREP(WITHVOIDS)?|CSGSOLID|BOOLEANRESULT|BOOLEANCLIPPINGRESULT|BLOCK|RIGHTCIRCULARCYLINDER|RIGHTCIRCULARCONE|SPHERE|RECTANGULARPYRAMID|TRIANGULATEDFACESET|POLYGONALFACESET)$/;
  var CLIPPABLES = /^IFC(EXTRUDEDAREASOLID(TAPERED)?|REVOLVEDAREASOLID(TAPERED)?|SURFACECURVESWEPTAREASOLID|FIXEDREFERENCESWEPTAREASOLID|DIRECTRIXCURVESWEPTAREASOLID|BOOLEANCLIPPINGRESULT)$/;
  // Éléments à cheval [{ id, plans }] coupés net aux plans de la boîte avec les découpes de l'IFC : chaque solide
  // du corps devient une suite de différences avec des demi-espaces (IFCHALFSPACESOLID sur un IFCPLANE), posés
  // dans le repère du solide ; la géométrie d'origine est gardée dessous. Les représentations partagées sont
  // copiées, les IFCMAPPEDITEM reçoivent leur propre IFCREPRESENTATIONMAP. Renvoie le changement (annulable),
  // les éléments touchés et le nombre de solides laissés entiers (surfaces, types non booléens).
  function retaillerModele(G, acheval){
    var m = G.m, ifc4 = !/^IFC2X3/i.test(m.schema), avant = new Map(), apres = new Map(), nouveaux = [], suivant = m.maxId;
    var nonCoupes = 0, touches = [], plans = null;
    function ent(id){ return apres.get(id) || m.ent.get(id); }
    function cree(type, args){
      var id = ++suivant;
      apres.set(id, IFC.lireEntite("#" + id + "=" + type + "(" + args.join(",") + ")"));
      nouveaux.push(id);
      return id;
    }
    function modifie(e, args){
      if (id0(e.id) && !avant.has(e.id)) avant.set(e.id, m.ent.get(e.id));
      apres.set(e.id, IFC.refaire(e, args));
    }
    function id0(id){ return id <= m.maxId && m.ent.has(id); }
    function liste(ids){ return "(" + ids.map(function(i){ return "#" + i; }).join(",") + ")"; }
    function triplet(v){ return "(" + v.map(reel).join(",") + ")"; }
    // demi-espace à enlever, dans le repère M (x_monde = A·y + t) : (Aᵀn)·y ≤ d − n·t reste
    function demi(M, pl){
      var n = pl.n, nl = [M[0]*n[0] + M[1]*n[1] + M[2]*n[2], M[3]*n[0] + M[4]*n[1] + M[5]*n[2], M[6]*n[0] + M[7]*n[1] + M[8]*n[2]];
      var dl = pl.d - (n[0]*M[9] + n[1]*M[10] + n[2]*M[11]), l = Math.hypot(nl[0], nl[1], nl[2]);
      nl = [nl[0]/l, nl[1]/l, nl[2]/l]; dl /= l;
      var x = ortho(Math.abs(nl[0]) < .9 ? [1, 0, 0] : [0, 1, 0], nl);
      var o = cree("IFCCARTESIANPOINT", [triplet([nl[0]*dl, nl[1]*dl, nl[2]*dl])]);
      var ax = cree("IFCAXIS2PLACEMENT3D", ["#" + o, "#" + cree("IFCDIRECTION", [triplet(nl)]), "#" + cree("IFCDIRECTION", [triplet(x)])]);
      // normale vers la matière enlevée : AgreementFlag faux
      return cree("IFCHALFSPACESOLID", ["#" + cree("IFCPLANE", ["#" + ax]), ".F."]);
    }
    function couperItem(id, M){
      var e = ent(id);
      if (!e) return 0;
      if (e.type === "IFCMAPPEDITEM"){
        var a = C(e), src = ent(R(a[0]));
        if (!src) return 0;
        var sa = C(src), rep = ent(R(sa[1]));
        if (!rep) return 0;
        var r = couperListe(L(C(rep)[3]), mul(mul(M, operateur(G, a[1])), axe(G, sa[0])));
        if (!r) return 0;
        var rb = IFC.bruts(rep).slice(), sb = IFC.bruts(src).slice(), mb = IFC.bruts(e).slice();
        rb[3] = liste(r.items); if (r.type) rb[2] = "'" + r.type + "'";
        sb[1] = "#" + cree(rep.type, rb);
        mb[0] = "#" + cree(src.type, sb);
        return cree(e.type, mb);
      }
      if (!OPERANDES.test(e.type) || (!ifc4 && /FACESET$/.test(e.type))){ nonCoupes++; return 0; }
      var cur = id, clip = CLIPPABLES.test(e.type) || (ifc4 && /^IFCSWEPTDISKSOLID/.test(e.type));
      plans.forEach(function(pl){ cur = cree(clip ? "IFCBOOLEANCLIPPINGRESULT" : "IFCBOOLEANRESULT", [".DIFFERENCE.", "#" + cur, "#" + demi(M, pl)]); });
      return cur;
    }
    function couperListe(ids, M){
      var chg = false, items = ids.map(function(i){ var n = couperItem(i, M); if (n) chg = true; return n || i; });
      if (!chg) return null;
      var types = items.map(function(i){ var x = ent(i); return x ? x.type : ""; });
      return { items: items, type: types.every(function(t){ return t === "IFCBOOLEANCLIPPINGRESULT"; }) ? "Clipping" :
        types.every(function(t){ return /^IFCBOOLEAN/.test(t); }) ? "CSG" : null };
    }
    // représentations et formes partagées : comptées pour savoir si on peut les modifier sur place
    var compte = new Map(), FAIBLE = { IFCPRESENTATIONLAYERASSIGNMENT: 1, IFCPRESENTATIONLAYERWITHSTYLE: 1, IFCSTYLEDITEM: 1 };
    acheval.forEach(function(x){
      var e = m.ent.get(x.id), pds = e && m.ent.get(R(C(e)[6]));
      if (!pds) return;
      compte.set(pds.id, 0);
      L(C(pds)[2]).forEach(function(r){ compte.set(r, 0); });
    });
    m.ent.forEach(function(e){
      if (FAIBLE[e.type]) return;
      for (var i = 0; i < e.refs.length; i++){ var c = compte.get(e.refs[i]); if (c !== undefined) compte.set(e.refs[i], c + 1); }
    });
    acheval.forEach(function(x){
      var e = ent(x.id), a = C(e), pds = ent(R(a[6]));
      if (!pds) return;
      plans = x.plans;
      var Mp = placement(G, R(a[5])), choisis = corps(G, pds).map(function(r){ return r.id; });
      var reps = L(C(pds)[2]), nouvelles = reps.slice(), copie = false, coupe = false, pdsSeule = compte.get(pds.id) <= 1;
      reps.forEach(function(rid, k){
        if (choisis.indexOf(rid) < 0) return;
        var rep = ent(rid), r = couperListe(L(C(rep)[3]), Mp);
        if (!r) return;
        coupe = true;
        var rb = IFC.bruts(rep).slice();
        rb[3] = liste(r.items); if (r.type) rb[2] = "'" + r.type + "'";
        if (pdsSeule && compte.get(rid) <= 1) modifie(rep, rb);
        else { nouvelles[k] = cree(rep.type, rb); copie = true; }
      });
      if (!coupe) return;
      touches.push(x.id);
      if (!copie) return;
      var pb = IFC.bruts(pds).slice();
      pb[2] = liste(nouvelles);
      if (pdsSeule) modifie(pds, pb);
      else { var eb = IFC.bruts(e).slice(); eb[6] = "#" + cree(pds.type, pb); modifie(e, eb); }
    });
    m.maxId = suivant;
    nouveaux.forEach(function(id){ m.ordre.push(id); });
    var av = [], ap = [];
    avant.forEach(function(e){ av.push(e); });
    apres.forEach(function(e){ ap.push(e); });
    return { changement: { avant: av, apres: ap, nbRetirees: 0 }, ids: touches, nonCoupes: nonCoupes, nbEntites: nouveaux.length };
  }

  var versionCoupe = 0;

  // ================= Moteur canvas 2D (secours) =================
  function moteurCanvas(cv){
    var ctx = cv.getContext("2d"), liste = [], dessin = [], sel = new Set(), actif = 0, coul = null, teintes = {}, coupe = null, vCoupe = 0;
    // la découpe est gardée en cache sur les faces (partagées entre moteurs) : version unique pour toute la page
    function nouvelleCoupe(b){ coupe = b; vCoupe = ++versionCoupe; }
    // Face vue à travers la boîte de coupe : f.b si elle y est entière, null si elle est dehors, sinon ses boucles coupées
    function decouper(f){
      var b0 = f.b[0], tout = true, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (var k = 0; k < b0.length/3; k++){
        for (var a = 0; a < 3; a++){ var v = coordBoite(coupe, b0, k, a); if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
      }
      for (a = 0; a < 3; a++){
        if (mx[a] < coupe.min[a] || mn[a] > coupe.max[a]) return null;
        if (mn[a] < coupe.min[a] || mx[a] > coupe.max[a]) tout = false;
      }
      if (tout) return f.b;
      var ext = couperBoucle(b0, coupe);
      if (!ext) return null;
      var r = [ext];
      for (var i = 1; i < f.b.length; i++){ var t = couperBoucle(f.b[i], coupe); if (t) r.push(t); }
      return r;
    }
    function segmentsCoupes(f){
      var r = [];
      for (var k = 0; f.ar && k < f.ar.length; k += 2){
        var l = f.b[f.ar[k]], a = f.ar[k + 1], z = (a + 1) % (l.length/3);
        var sg = couperSegment([l[3*a], l[3*a + 1], l[3*a + 2]], [l[3*z], l[3*z + 1], l[3*z + 2]], coupe);
        if (sg) r.push(sg);
      }
      return r;
    }
    function teinte(base, k){
      var cle = base.join(",") + "/" + k, t = teintes[cle];
      if (!t){
        var f = .34 + .66*k/24;
        t = teintes[cle] = "rgb(" + Math.round(base[0]*f) + "," + Math.round(base[1]*f) + "," + Math.round(base[2]*f) + ")";
      }
      return t;
    }
    function dessiner(c){
      ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
      ctx.clearRect(0, 0, c.W, c.H);
      dessin.length = 0;
      var ca = c.ca, sa = c.sa, cb = c.cb, sb = c.sb, s = c.s, cx = c.W/2 + c.px, cy = c.H/2 + c.py;
      var c0 = c.centre[0], c1 = c.centre[1], c2 = c.centre[2], W = c.W, H = c.H;
      for (var e = 0; e < liste.length; e++){
        var faces = liste[e].geo.faces;
        for (var fi = 0; fi < faces.length; fi++){
          var f = faces[fi], zs = 0, nz = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          if (!f.p) f.p = f.b.map(function(b){ return new Float32Array(b.length/3*2); });
          var bs = f.b, ps = f.p, s3 = null;
          if (coupe){
            if (f.kv !== vCoupe){
              f.kv = vCoupe; f.kb = decouper(f);
              var part = f.kb && f.kb !== f.b;
              f.kp = part ? f.kb.map(function(b){ return new Float32Array(b.length/3*2); }) : null;
              f.ks = part ? segmentsCoupes(f) : null;
            }
            if (!f.kb) continue;
            if (f.kb !== f.b){ bs = f.kb; ps = f.kp; s3 = f.ks; }
          }
          f.q = ps; f.s3 = s3;
          for (var bi = 0; bi < bs.length; bi++){
            var b = bs[bi], p = ps[bi];
            for (var k = 0, j = 0; k < b.length; k += 3, j += 2){
              var qx = b[k] - c0, qy = b[k+1] - c1, qz = b[k+2] - c2;
              var xv = ca*qx + sa*qy, yv = -sa*qx + ca*qy;
              var sx = cx + xv*s, sy = cy - (qz*cb + yv*sb)*s;
              p[j] = sx; p[j+1] = sy;
              if (bi === 0){
                zs += yv*cb - qz*sb; nz++;
                if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
              }
            }
          }
          f.z = zs/nz; f.el = e; f.x0 = x0; f.x1 = x1; f.y0 = y0; f.y1 = y1;
          if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) continue;     // hors écran
          dessin.push(f);
        }
      }
      dessin.sort(function(a, b){ return b.z - a.z; });
      var detail = !(c.vite && dessin.length > 12000), L = c.lumiereVue;
      ctx.lineJoin = "round";
      for (var i = 0; i < dessin.length; i++){
        var F = dessin[i], it = liste[F.el], n = F.n;
        var nx1 = ca*n[0] + sa*n[1], ny1 = -sa*n[0] + ca*n[1];
        var nup = n[2]*cb + ny1*sb, ndp = ny1*cb - n[2]*sb;
        var lum = Math.abs(nx1*L[0] + nup*L[1] - ndp*L[2]);
        var choisi = sel.has(it.id), estActif = it.id === actif, pa = it.h != null ? coul.pastel(it.h) : null;
        var fond = teinte(choisi ? OR : pa ? pa.piece : it.rgb || coul.piece, Math.round(lum*24));
        ctx.beginPath();
        for (var bj = 0; bj < F.q.length; bj++){
          var P = F.q[bj];
          ctx.moveTo(P[0], P[1]);
          for (var q = 2; q < P.length; q += 2) ctx.lineTo(P[q], P[q+1]);
          ctx.closePath();
        }
        ctx.fillStyle = fond;
        ctx.fill("evenodd");
        if (detail){ ctx.strokeStyle = fond; ctx.lineWidth = .8; ctx.stroke(); }     // bouche les joints entre facettes
        if ((detail || estActif) && (F.s3 ? F.s3.length : F.ar && F.ar.length)){
          ctx.beginPath();
          if (F.s3) F.s3.forEach(function(g){
            for (var u = 0; u < 6; u += 3){
              var qx = g[u] - c0, qy = g[u+1] - c1, qz = g[u+2] - c2, xv = ca*qx + sa*qy, yv = -sa*qx + ca*qy;
              ctx[u ? "lineTo" : "moveTo"](cx + xv*s, cy - (qz*cb + yv*sb)*s);
            }
          });
          else for (var r = 0; r < F.ar.length; r += 2){
            var Q = F.p[F.ar[r]], a = F.ar[r+1], m = Q.length/2, z = (a + 1) % m;
            ctx.moveTo(Q[2*a], Q[2*a+1]); ctx.lineTo(Q[2*z], Q[2*z+1]);
          }
          ctx.strokeStyle = choisi ? (estActif ? coul.actif : coul.areteOr) : estActif ? coul.areteActive : pa ? pa.arete : coul.arete;
          ctx.lineWidth = estActif ? 1.1 : .6;
          ctx.stroke();
        }
      }
      if (coupe && !c.sansCadre){
        var A = aretesBoite(coupe);
        ctx.beginPath();
        for (var u = 0; u < A.length; u += 3){
          var qx = A[u] - c0, qy = A[u+1] - c1, qz = A[u+2] - c2, xv = ca*qx + sa*qy, yv = -sa*qx + ca*qy;
          ctx[(u/3) % 2 ? "lineTo" : "moveTo"](cx + xv*s, cy - (qz*cb + yv*sb)*s);
        }
        ctx.setLineDash([5, 4]); ctx.strokeStyle = coul.cadre; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      }
      if (!liste.length){
        ctx.fillStyle = coul.texte; ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText("Aucune géométrie à afficher", W/2, H/2);
      }
    }
    function dedans(F, x, y){
      var c = false;
      for (var bi = 0; bi < F.q.length; bi++){
        var p = F.q[bi], n = p.length/2;
        for (var i = 0, j = n - 1; i < n; j = i++){
          var xi = p[2*i], yi = p[2*i+1], xj = p[2*j], yj = p[2*j+1];
          if ((yi > y) !== (yj > y) && x < (xj - xi)*(y - yi)/(yj - yi) + xi) c = !c;
        }
      }
      return c;
    }
    function viser(c, x, y){
      for (var i = dessin.length - 1; i >= 0; i--){       // du devant vers l'arrière
        var F = dessin[i];
        if (x < F.x0 || x > F.x1 || y < F.y0 || y > F.y1) continue;
        if (dedans(F, x, y)) return F.el + 1;
      }
      return 0;
    }
    return {
      nom: "canvas 2D",
      charger: function(l){ liste = l; l.forEach(function(it){ aretesVives(it.geo); }); },
      teinter: function(l, s, a, k){ sel = s; actif = a; if (coul !== k){ coul = k; teintes = {}; } },
      dessiner: dessiner, viser: viser,
      coupe: nouvelleCoupe,
      perdu: function(){ return false; }, restaurer: function(){}, liberer: function(){}
    };
  }

  // ================= Vue : caméra, interaction, choix du moteur =================
  var OR = [214,168,92];

  function geoTriangles(T){
    var faces = [], TF = new Array(T.length/9), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var t = 0, f = 0; t < T.length; t += 9, f++){
      var ux = T[t+3] - T[t], uy = T[t+4] - T[t+1], uz = T[t+5] - T[t+2], vx = T[t+6] - T[t], vy = T[t+7] - T[t+1], vz = T[t+8] - T[t+2];
      var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx, l = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      faces.push({ b: [T.subarray(t, t + 9)], n: [nx/l, ny/l, nz/l], p: null, z: 0, el: 0, x0: 0, x1: 0, y0: 0, y1: 0 });
      TF[f] = f;
      for (var k = 0; k < 9; k++){ var a = k % 3; if (T[t+k] < mn[a]) mn[a] = T[t+k]; if (T[t+k] > mx[a]) mx[a] = T[t+k]; }
    }
    return faces.length ? { faces: faces, T: T, TF: TF, min: mn, max: mx } : null;
  }

  function creer(cv, rappels){
    rappels = rappels || {};
    // WebGL d'abord ; le moteur canvas 2D prend le relais s'il manque, ou s'il est demandé
    // (rappels.moteur = "canvas", ou ?moteur=canvas dans l'adresse)
    var M = null;
    function neufCanvas(){
      var neuf = cv.cloneNode(false);           // un canvas qui a servi à un moteur ne peut plus donner l'autre contexte
      cv.parentNode.replaceChild(neuf, cv);
      cv = neuf;
    }
    function demarrer(nom){
      M = null;
      if (nom !== "canvas"){ M = moteurGL(cv); if (M && !M.echec) M.cle = "webgl"; }
      if (M && M.echec){ neufCanvas(); M = null; }
      if (!M){ M = moteurCanvas(cv); M.cle = "canvas"; }
    }
    demarrer(/[?&]moteur=canvas\b/.test(location.search) ? "canvas" : rappels.moteur);

    var Gs = new Map(), prets = new Map(), liste = [], sel = new Set(), actif = 0, nbFaces = 0, source = "maison";

    // Géométrie externe (web-ifc) : ses unités et ses axes peuvent différer (mètres, Y vers le haut).
    // On compare les boîtes d'éléments lus des deux côtés et on retient l'échelle, la rotation et le
    // décalage qui collent le mieux ; carte : Map(id → Float64Array de triangles), couleurs : Map(id → [r, v, b, a]).
    function calibrer(G, carte, couleurs){
      var ROT = [function(x, y, z){ return [x, y, z]; }, function(x, y, z){ return [x, -z, y]; }];
      var echant = [];
      carte.forEach(function(T, id){ if (echant.length < 40 && T.length >= 9){ var g = geometrie(G, id); if (g) echant.push({ T: T, g: g }); } });
      function med(a){ a = a.slice().sort(function(p, q){ return p - q; }); return a.length ? a[a.length >> 1] : 0; }
      var meilleur = { r: 0, k: 1, t: [0, 0, 0], err: Infinity };
      ROT.forEach(function(R, ri){
        var ks = [], bs = echant.map(function(s){
          var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          for (var i = 0; i < s.T.length; i += 3){
            var p = R(s.T[i], s.T[i+1], s.T[i+2]);
            for (var a = 0; a < 3; a++){ if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
          }
          var dE = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]), dM = Math.hypot(s.g.max[0] - s.g.min[0], s.g.max[1] - s.g.min[1], s.g.max[2] - s.g.min[2]);
          if (dE > 0 && dM > 0) ks.push(dM/dE);
          return { mn: mn, mx: mx };
        });
        var k = med(ks) || 1;
        // échelle arrondie aux conversions d'unités courantes quand elle en est proche
        [1, 10, 100, 1000, .1, .01, .001, 304.8, 25.4, 1/304.8, 1/25.4].forEach(function(u){ if (Math.abs(k/u - 1) < .02) k = u; });
        var t = [0, 1, 2].map(function(a){ return med(echant.map(function(s, i){ return (s.g.min[a] + s.g.max[a])/2 - k*(bs[i].mn[a] + bs[i].mx[a])/2; })); });
        var err = med(echant.map(function(s, i){
          var d = Math.hypot(s.g.max[0] - s.g.min[0], s.g.max[1] - s.g.min[1], s.g.max[2] - s.g.min[2]) || 1, e = 0;
          for (var a = 0; a < 3; a++) e += Math.abs(s.g.min[a] - (k*bs[i].mn[a] + t[a])) + Math.abs(s.g.max[a] - (k*bs[i].mx[a] + t[a]));
          return e/d;
        }));
        if (err < meilleur.err) meilleur = { r: ri, k: k, t: t, err: err };
      });
      var R = ROT[meilleur.r], k = meilleur.k, t = meilleur.t, geos = new Map(), teintes = new Map();
      carte.forEach(function(T, id){
        var U = new Float64Array(T.length);
        for (var i = 0; i < T.length; i += 3){ var p = R(T[i], T[i+1], T[i+2]); U[i] = k*p[0] + t[0]; U[i+1] = k*p[1] + t[1]; U[i+2] = k*p[2] + t[2]; }
        var g = geoTriangles(U);
        if (g) geos.set(id, g);
      });
      // couleurs des matériaux du fichier (0–1) → 0–255
      if (couleurs) couleurs.forEach(function(c, id){
        if (c && geos.has(id)) teintes.set(id, [0, 1, 2].map(function(a){ return Math.max(0, Math.min(255, Math.round(255*c[a]))); }));
      });
      return { geos: geos, teintes: teintes, info: { elements: geos.size, couleurs: teintes.size, echelle: k, rotation: meilleur.r, ecart: meilleur.err, echantillons: echant.length } };
    }
    var yaw = -0.65, pitch = 0.5, zoom = 1, px = 0, py = 0, centre = [0,0,0], rayon = 1, origine = null, prof = 1;
    var W = 0, H = 0, dpr = 1, attente = false, vite = false, coul = {}, coupe = null, cadreMasque = false;
    var LUM = (function(){ var l = Math.hypot(-.45, .6, .66); return [-.45/l, .6/l, .66/l]; })();

    function rvb(nom, defaut){
      var v = getComputedStyle(document.documentElement).getPropertyValue(nom).trim().split(",").map(Number);
      return v.length === 3 && v.every(isFinite) ? v : defaut;
    }
    function tsl(h, s, l){     // teinte, saturation, luminosité → [r, v, b]
      var a = s*Math.min(l, 1 - l);
      return [0, 8, 4].map(function(n){ var k = (n + h/30) % 12; return Math.round(255*(l - a*Math.max(-1, Math.min(k - 3, 9 - k, 1)))); });
    }
    function couleurs(){
      var a = rvb("--vue-arete", [236,232,224]), clair = document.documentElement.getAttribute("data-theme") === "clair";
      coul = {
        piece: rvb("--vue-piece", [236,232,224]),
        arete: "rgba(" + a.join(",") + ",.24)", areteRGBA: [a[0], a[1], a[2], Math.round(255*(clair ? .32 : .2))],
        areteOr: "rgba(120,86,30,.55)", areteOrRGBA: [120, 86, 30, 140],
        actif: "rgba(" + OR.join(",") + ",.95)", actifRGBA: clair ? [150, 104, 30, 255] : [240, 196, 112, 255],
        texte: "rgba(" + a.join(",") + ",.45)",
        areteActive: "rgba(" + a.join(",") + ",.85)", areteActiveRGBA: [a[0], a[1], a[2], 215],
        cadre: clair ? "rgba(150,104,30,.8)" : "rgba(214,168,92,.75)", cadreRGBA: clair ? [150, 104, 30, 205] : [214, 168, 92, 190],
        coupeRGB: clair ? [204, 44, 38] : [196, 48, 42]
      };
      // couleur d'une maquette (teinte 0–360) : remplissage très pastel, arêtes pastel un peu plus soutenues
      var cache = {};
      coul.pastel = function(h){
        var p = cache[h];
        if (!p){
          var r = tsl(h, .75, clair ? .86 : .84), q = tsl(h, clair ? .5 : .58, clair ? .5 : .66);
          p = cache[h] = { piece: r, areteRGBA: [q[0], q[1], q[2], Math.round(255*.9)], arete: "rgba(" + q.join(",") + ",.9)" };
        }
        return p;
      };
      M.teinter(liste, sel, actif, coul);
    }
    couleurs();
    new MutationObserver(function(){ couleurs(); demander(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    function taille(){
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
      rendre();
    }
    var ro = "ResizeObserver" in window ? new ResizeObserver(taille) : null;
    if (ro) ro.observe(cv);
    window.addEventListener("resize", taille);

    function camera(){
      var ca = Math.cos(yaw), sa = Math.sin(yaw), cb = Math.cos(pitch), sb = Math.sin(pitch);
      // lumière : fixée par rapport à l'écran, ramenée dans le repère du modèle pour WebGL
      var lx = LUM[0], lu = LUM[1], lv = LUM[2];
      var lumiere = [
        lx*ca + lu*(-sb*sa) + lv*(cb*sa),
        lx*sa + lu*(sb*ca) + lv*(-cb*ca),
        lu*cb + lv*sb
      ];
      return { ca: ca, sa: sa, cb: cb, sb: sb, s: Math.min(W, H)*.44/rayon*zoom, px: px, py: py, W: W, H: H, dpr: dpr,
        centre: centre, prof: prof, vite: vite, lumiere: lumiere, lumiereVue: LUM, sansCadre: cadreMasque };
    }
    function demander(){ if (!attente){ attente = true; requestAnimationFrame(rendre); } }
    function rendre(){
      attente = false;
      if (!W || !H) return;
      var c = camera();
      M.dessiner(c);
      placerPoignees(c);
      placerMesures(c);
    }

    // ---------- Poignées de la boîte de coupe : une par face, à tirer pour l'étirer ou la réduire ----------
    function ecran(c, p){
      var qx = p[0] - c.centre[0], qy = p[1] - c.centre[1], qz = p[2] - c.centre[2];
      var xv = c.ca*qx + c.sa*qy, yv = -c.sa*qx + c.ca*qy;
      return [W/2 + c.px + xv*c.s, H/2 + c.py - (qz*c.cb + yv*c.sb)*c.s];
    }
    function centreFace(f){        // f = 2·axe + côté (0 : min, 1 : max), point du monde
      var ax = f >> 1, p = [0, 1, 2].map(function(i){ return (coupe.min[i] + coupe.max[i])/2; });
      p[ax] = f & 1 ? coupe.max[ax] : coupe.min[ax];
      return versMonde(coupe, p[0], p[1], p[2]);
    }
    var NOMS_FACES = ["ouest", "est", "sud", "nord", "bas", "haut"], poignees = [], tire = null, fige = false;
    // à la souris, les poignées n'apparaissent qu'au survol de la boîte ; au doigt, elles restent visibles
    var souris = !!(window.matchMedia && matchMedia("(hover: hover)").matches), survol = false, surPoignee = false;
    function pres(x, y){        // le point écran est-il dans l'enveloppe de la boîte projetée (marge 28 px) ?
      if (!coupe || !W) return false;
      var c = camera(), P = [];
      for (var k = 0; k < 8; k++) P.push(ecran(c, versMonde(coupe, k & 1 ? coupe.max[0] : coupe.min[0], k & 2 ? coupe.max[1] : coupe.min[1], k & 4 ? coupe.max[2] : coupe.min[2])));
      P.sort(function(a, b){ return a[0] - b[0] || a[1] - b[1]; });
      function cr(o, a, b){ return (a[0] - o[0])*(b[1] - o[1]) - (a[1] - o[1])*(b[0] - o[0]); }
      var bas = [], haut = [];
      P.forEach(function(p){ while (bas.length > 1 && cr(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop(); bas.push(p); });
      P.slice().reverse().forEach(function(p){ while (haut.length > 1 && cr(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop(); haut.push(p); });
      var E = bas.slice(0, -1).concat(haut.slice(0, -1)), dedans = E.length > 2, n = E.length;
      for (var i = 0; i < n; i++){
        var a = E[i], b = E[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx*dx + dy*dy;
        if (cr(a, b, [x, y]) < 0) dedans = false;
        var t = l2 ? Math.max(0, Math.min(1, ((x - a[0])*dx + (y - a[1])*dy)/l2)) : 0;
        if (Math.hypot(a[0] + t*dx - x, a[1] + t*dy - y) < 28) return true;
      }
      return dedans;
    }
    function survoler(oui){ if (oui !== survol){ survol = oui; placerPoignees(camera()); } }
    NOMS_FACES.forEach(function(nom, f){
      var b = document.createElement("div");
      b.className = "poignee"; b.hidden = true;
      b.title = "Tirer pour déplacer la face " + nom + " de la boîte de coupe";
      b.addEventListener("pointerdown", function(e){
        if (!coupe) return;
        e.preventDefault(); e.stopPropagation();
        try { b.setPointerCapture(e.pointerId); } catch (x){}
        var c = camera(), ax = f >> 1, p = centreFace(f), n = axeBoite(coupe, ax), q = [p[0] + n[0], p[1] + n[1], p[2] + n[2]];
        var a = ecran(c, p), z = ecran(c, q), d = [z[0] - a[0], z[1] - a[1]], l2 = d[0]*d[0] + d[1]*d[1];
        tire = { f: f, ax: ax, x: e.clientX, y: e.clientY, d: d, l2: l2, v0: f & 1 ? coupe.max[ax] : coupe.min[ax] };
        b.classList.add("tiree");
      });
      b.addEventListener("pointermove", function(e){
        if (!tire || tire.f !== f || tire.l2 < 1e-12) return;
        // déplacement de la souris projeté sur l'axe de la face, ramené en unités du modèle
        var k = ((e.clientX - tire.x)*tire.d[0] + (e.clientY - tire.y)*tire.d[1])/tire.l2, v = tire.v0 + k, ax = tire.ax;
        var mini = Math.max(rayon*1e-3, 1e-6);
        if (f & 1) coupe.max[ax] = Math.max(v, coupe.min[ax] + mini);
        else coupe.min[ax] = Math.min(v, coupe.max[ax] - mini);
        M.coupe(coupe);
        vite = true; demander();
      });
      function lache(){
        if (!tire || tire.f !== f) return;
        tire = null; b.classList.remove("tiree");
        vite = false; demander();
      }
      b.addEventListener("pointerup", lache);
      b.addEventListener("pointercancel", lache);
      b.addEventListener("pointerenter", function(){ surPoignee = true; });
      b.addEventListener("pointerleave", function(){ surPoignee = false; if (!tire) placerPoignees(camera()); });
      cv.parentNode.appendChild(b);
      poignees.push(b);
    });
    function placerPoignees(c){
      (poignees || []).forEach(function(b, f){
        if (!coupe || fige || cadreMasque){ b.hidden = true; return; }
        var p = ecran(c, centreFace(f));
        b.hidden = !(p[0] > -20 && p[0] < W + 20 && p[1] > -20 && p[1] < H + 20);
        b.style.transform = "translate(" + p[0].toFixed(1) + "px," + p[1].toFixed(1) + "px)";
        b.classList.toggle("loin", souris && !survol && !surPoignee && !tire);
      });
    }

    // ---------- Mesure : deux clics, accrochage aux sommets, milieux et arêtes vives de l'élément visé ----------
    var SVG = "http://www.w3.org/2000/svg", calque = document.createElementNS(SVG, "svg");
    calque.setAttribute("class", "mesures");
    cv.parentNode.appendChild(calque);
    var mesure = { actif: false, a: null, survol: null, liste: [], unite: { nom: "", k: 3 } };
    var FMT = {};
    function longueur(v){
      var k = mesure.unite.k, f = FMT[k] || (FMT[k] = new Intl.NumberFormat("fr-CH", { minimumFractionDigits: 0, maximumFractionDigits: k }));
      return f.format(Math.abs(v) < Math.pow(10, -k)/2 ? 0 : v) + (mesure.unite.nom ? " " + mesure.unite.nom : "");
    }
    // Segment mesuré entre A et B (points accrochés { p, type, n : normale si face }). Une face cliquée en
    // premier : la mesure part perpendiculairement à elle jusqu'au plan parallèle qui passe par B ; une face
    // cliquée en second : la mesure tombe de A perpendiculairement sur elle. pied : bout calculé, relié au
    // point cliqué par un trait d'aide.
    function segment(A, B){
      var a = A.p, b = B.p, k;
      if (A.n){ k = dot(A.n, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]); return { a: a, b: [a[0] + A.n[0]*k, a[1] + A.n[1]*k, a[2] + A.n[2]*k], perp: true }; }
      if (B.n){ k = dot(B.n, [a[0] - b[0], a[1] - b[1], a[2] - b[2]]); return { a: a, b: [a[0] - B.n[0]*k, a[1] - B.n[1]*k, a[2] - B.n[2]*k], perp: true }; }
      return { a: a, b: b, perp: false };
    }
    function texteMesure(A, B){
      var S = segment(A, B), d = [S.b[0] - S.a[0], S.b[1] - S.a[1], S.b[2] - S.a[2]];
      return { S: S, l: (S.perp ? "⊥ " : "") + longueur(Math.hypot(d[0], d[1], d[2])), d: "ΔX " + longueur(Math.abs(d[0])) + " · ΔY " + longueur(Math.abs(d[1])) + " · ΔZ " + longueur(Math.abs(d[2])) };
    }
    // point visé, accroché au plus proche : sommet (12 px), milieu d'arête (10 px), arête (8 px), sinon la face
    function accroche(x, y){
      var v = viseeSous(x, y);
      if (!v) return null;
      var c = camera(), A = aretesVives(v.it.geo), best = null, e = rayon*1e-6;
      function prendre(P, type, rang, d, lim){
        if (d > lim || (best && (best.rang < rang || (best.rang === rang && best.d <= d)))) return;
        if (coupe && !dansBoite(coupe, P[0], P[1], P[2], e)) return;
        best = { p: P, type: type, rang: rang, d: d };
      }
      for (var i = 0; i < A.length; i += 6){
        var a = [A[i], A[i+1], A[i+2]], b = [A[i+3], A[i+4], A[i+5]], sa = ecran(c, a), sb = ecran(c, b);
        prendre(a, "sommet", 0, Math.hypot(sa[0] - x, sa[1] - y), 12);
        prendre(b, "sommet", 0, Math.hypot(sb[0] - x, sb[1] - y), 12);
        prendre([(a[0] + b[0])/2, (a[1] + b[1])/2, (a[2] + b[2])/2], "milieu", 1, Math.hypot((sa[0] + sb[0])/2 - x, (sa[1] + sb[1])/2 - y), 10);
        var dx = sb[0] - sa[0], dy = sb[1] - sa[1], l2 = dx*dx + dy*dy;
        if (l2 > 1e-9){
          var t = Math.max(0, Math.min(1, ((x - sa[0])*dx + (y - sa[1])*dy)/l2));
          prendre([a[0] + t*(b[0] - a[0]), a[1] + t*(b[1] - a[1]), a[2] + t*(b[2] - a[2])], "arête", 2, Math.hypot(sa[0] + t*dx - x, sa[1] + t*dy - y), 8);
        }
      }
      if (best) return best;
      var T = v.T, t = v.t, n = norm(cross([T[t+3] - T[t], T[t+4] - T[t+1], T[t+5] - T[t+2]], [T[t+6] - T[t], T[t+7] - T[t+1], T[t+8] - T[t+2]]));
      return { p: v.p, type: "face", n: n };
    }
    function el(type, attrs, parent){
      var n = document.createElementNS(SVG, type);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    }
    function symbole(P, type, c, g){
      var q = ecran(c, P), x = q[0], y = q[1];
      if (type === "sommet") el("rect", { x: x - 5, y: y - 5, width: 10, height: 10, "class": "m-point" }, g);
      else if (type === "milieu") el("path", { d: "M" + x + " " + (y - 6) + "L" + (x + 6) + " " + (y + 5) + "L" + (x - 6) + " " + (y + 5) + "Z", "class": "m-point" }, g);
      else if (type === "arête") el("path", { d: "M" + x + " " + (y - 6) + "L" + (x + 6) + " " + y + "L" + x + " " + (y + 6) + "L" + (x - 6) + " " + y + "Z", "class": "m-point" }, g);
      else el("circle", { cx: x, cy: y, r: 4, "class": "m-point" }, g);
    }
    function trait(A, B, c, g, provisoire){
      var t = texteMesure(A, B), p = ecran(c, t.S.a), q = ecran(c, t.S.b), mx = (p[0] + q[0])/2, my = (p[1] + q[1])/2;
      if (t.S.perp){
        // trait d'aide entre le point cliqué et le pied de la perpendiculaire
        var r = ecran(c, B.p);
        if (Math.hypot(r[0] - q[0], r[1] - q[1]) > 1) el("line", { x1: r[0], y1: r[1], x2: q[0], y2: q[1], "class": "m-aide" }, g);
        el("circle", { cx: q[0], cy: q[1], r: 2.5, "class": "m-pied" }, g);
      }
      el("line", { x1: p[0], y1: p[1], x2: q[0], y2: q[1], "class": "m-trait" + (provisoire ? " provisoire" : "") }, g);
      var tx = el("text", { x: mx, y: my - 8, "class": "m-texte" }, g);
      tx.textContent = t.l;
      var td = el("text", { x: mx, y: my + 14, "class": "m-delta" }, g);
      td.textContent = t.d;
    }
    function placerMesures(c){
      cv.classList.toggle("mesure", mesure.actif);          // le canvas change avec le moteur
      while (calque.firstChild) calque.removeChild(calque.firstChild);
      if (!W || (!mesure.liste.length && !mesure.actif)) return;
      mesure.liste.forEach(function(m){ trait(m.a, m.b, c, calque); symbole(m.a.p, m.a.type, c, calque); symbole(m.b.p, m.b.type, c, calque); });
      if (mesure.a && mesure.survol) trait(mesure.a, mesure.survol, c, calque, true);
      if (mesure.a) symbole(mesure.a.p, mesure.a.type, c, calque);
      if (mesure.survol) symbole(mesure.survol.p, mesure.survol.type, c, calque);
    }
    var attenteMesure = 0;
    function survolMesure(e){
      clearTimeout(attenteMesure);
      var p = local(e), ici = cv;
      attenteMesure = setTimeout(function(){
        if (ici !== cv || ptrs.size || !W || !H || !mesure.actif) return;
        mesure.survol = accroche(p.x, p.y);
        demander();
      }, 40);
    }
    function cliqueMesure(x, y){
      var P = accroche(x, y);
      demander();
      if (!P) return;
      if (!mesure.a){ mesure.a = P; mesure.survol = null; if (rappels.surMesure) rappels.surMesure(P.n ? "Mesure perpendiculaire à la face : clique le second point (Échap pour annuler)." : "Mesure : clique le second point (Échap pour annuler)."); return; }
      var m = { a: mesure.a, b: P }, t = texteMesure(m.a, m.b);
      mesure.liste.push(m);
      mesure.a = null; mesure.survol = null;
      if (rappels.surMesure) rappels.surMesure("Mesure" + (t.S.perp ? " perpendiculaire à la face" : "") + " : " + t.l.replace(/^⊥ /, "") + " (" + t.d + ").");
    }

    function boite(){
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      liste.forEach(function(it){
        for (var k = 0; k < 3; k++){
          if (it.geo.min[k] < mn[k]) mn[k] = it.geo.min[k];
          if (it.geo.max[k] > mx[k]) mx[k] = it.geo.max[k];
        }
      });
      if (!isFinite(mn[0])) return null;
      return { c: [(mn[0] + mx[0])/2, (mn[1] + mx[1])/2, (mn[2] + mx[2])/2], r: Math.max(1e-9, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])/2) };
    }
    // Boîte englobante d'une partie des éléments (clés), ou de tous ; avec un angle a, dans le repère tourné
    // de a autour de la verticale (les sommets sont alors parcourus un à un)
    function boiteDe(cles, a){
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], S = cles ? new Set(cles) : null, r = { a: a || 0 };
      liste.forEach(function(it){
        if (S && !S.has(it.id)) return;
        if (r.a){
          var T = triangles(it.geo);
          for (var i = 0; i < T.length; i += 3){
            var l = versBoite(r, T[i], T[i + 1]);
            if (l[0] < mn[0]) mn[0] = l[0]; if (l[0] > mx[0]) mx[0] = l[0];
            if (l[1] < mn[1]) mn[1] = l[1]; if (l[1] > mx[1]) mx[1] = l[1];
          }
          if (it.geo.min[2] < mn[2]) mn[2] = it.geo.min[2];
          if (it.geo.max[2] > mx[2]) mx[2] = it.geo.max[2];
          return;
        }
        for (var k = 0; k < 3; k++){
          if (it.geo.min[k] < mn[k]) mn[k] = it.geo.min[k];
          if (it.geo.max[k] > mx[k]) mx[k] = it.geo.max[k];
        }
      });
      if (!isFinite(mn[0])) return null;
      r.min = mn; r.max = mx;
      return r;
    }
    function cadrerSur(b){
      centre = centreBoite(b);
      rayon = Math.max(1e-9, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])/2);
      zoom = 1; px = 0; py = 0;
      demander();
    }
    function recadrer(){
      if (coupe){ cadrerSur(coupe); return; }
      var b = boite();
      if (b){ centre = b.c; rayon = b.r; } else { centre = [0,0,0]; rayon = 1; }
      zoom = 1; px = 0; py = 0;
      demander();
    }

    // ---------- Souris, doigt, molette ----------
    var ptrs = new Map(), depart = null, bouge = false, multi = false, doigt = false;
    function zoomAutour(f, x, y){
      var nzm = Math.min(400, Math.max(.05, zoom*f));
      f = nzm/zoom; zoom = nzm;
      var cx = W/2 + px, cy = H/2 + py;
      px = x - W/2 - (x - cx)*f;
      py = y - H/2 - (y - cy)*f;
    }
    function local(e){ var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    // Point de la pièce sous le curseur : rayon de vue lancé sur les triangles de l'élément visé, null si vide
    function pointSous(x, y){ var v = viseeSous(x, y); return v ? v.p : null; }
    // Élément, triangle et point visés : { it, T, t (indice du triangle dans T), p }
    function viseeSous(x, y){
      if (!W || !H) return null;
      var c = camera(), k = M.viser(c, x, y), it = k > 0 ? liste[k - 1] : null;
      if (M.nom === "WebGL") demander();
      if (!it) return null;
      var X = (x - W/2 - c.px)/c.s, Y = (H/2 + c.py - y)/c.s, T = triangles(it.geo), best = Infinity, tb = -1, P = new Array(9);
      var r0 = [c.ca, c.sa, 0], r1 = [-c.sb*c.sa, c.sb*c.ca, c.cb], r2 = [-c.cb*c.sa, c.cb*c.ca, -c.sb];
      for (var t = 0; t < T.length; t += 9){
        for (var v = 0; v < 3; v++){
          var qx = T[t + 3*v] - centre[0], qy = T[t + 3*v + 1] - centre[1], qz = T[t + 3*v + 2] - centre[2];
          P[3*v] = r0[0]*qx + r0[1]*qy;
          P[3*v + 1] = r1[0]*qx + r1[1]*qy + r1[2]*qz;
          P[3*v + 2] = r2[0]*qx + r2[1]*qy + r2[2]*qz;      // profondeur : plus petite = plus près
        }
        var d = (P[4] - P[7])*(P[0] - P[6]) + (P[6] - P[3])*(P[1] - P[7]);
        if (!d) continue;
        var a = ((P[4] - P[7])*(X - P[6]) + (P[6] - P[3])*(Y - P[7]))/d;
        var b = ((P[7] - P[1])*(X - P[6]) + (P[0] - P[6])*(Y - P[7]))/d;
        if (a < -1e-6 || b < -1e-6 || a + b > 1 + 1e-6) continue;
        var z = a*P[2] + b*P[5] + (1 - a - b)*P[8];
        if (z >= best) continue;
        if (coupe && !dansBoite(coupe, centre[0] + X*r0[0] + Y*r1[0] + z*r2[0], centre[1] + X*r0[1] + Y*r1[1] + z*r2[1], centre[2] + Y*r1[2] + z*r2[2], rayon*1e-6)) continue;
        best = z; tb = t;
      }
      if (!isFinite(best)) return null;
      return { it: it, T: T, t: tb, p: [0, 1, 2].map(function(i){ return centre[i] + X*r0[i] + Y*r1[i] + best*r2[i]; }) };
    }
    // Angle de la face visée autour de la verticale, ramené entre −45° et 45° : sa normale horizontale, ou,
    // pour une face horizontale (dessus d'une dalle), celle de la plus grande face verticale de l'élément
    function angleFace(T, t){
      function normale(t){
        var ux = T[t+3] - T[t], uy = T[t+4] - T[t+1], uz = T[t+5] - T[t+2], vx = T[t+6] - T[t], vy = T[t+7] - T[t+1], vz = T[t+8] - T[t+2];
        return [uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx];
      }
      var n = normale(t), l = Math.hypot(n[0], n[1], n[2]);
      if (!l || Math.abs(n[2])/l > .9){
        var best = 0;
        n = null;
        for (var k = 0; k < T.length; k += 9){
          var m = normale(k), a = Math.hypot(m[0], m[1], m[2]), h = Math.hypot(m[0], m[1]);
          if (a && h/a > .9 && a > best){ best = a; n = m; }
        }
        if (!n) return null;
      }
      var ang = Math.atan2(n[1], n[0]), q = Math.PI/2;
      return ang - q*Math.round(ang/q);
    }
    var angleCoupe = 0;        // orientation des prochaines boîtes de coupe (la dernière choisie)
    // La rotation tourne autour du point cliqué : il devient le centre, sans que l'image bouge
    function pivoter(x, y){
      var p = pointSous(x, y);
      if (!p) return;
      centre = p; px = x - W/2; py = y - H/2;
    }
    // Survol à la souris : flèche sur un objet, main sur le vide. L'objet n'est cherché que quand la souris
    // marque une courte pause, pour ne pas refaire le rendu de sélection à chaque pixel.
    var attenteSurvol = 0;
    function survolObjet(e){
      clearTimeout(attenteSurvol);
      var p = local(e), ici = cv;
      attenteSurvol = setTimeout(function(){
        if (ici !== cv || ptrs.size || !W || !H) return;
        var k = M.viser(camera(), p.x, p.y);
        if (M.nom === "WebGL") demander();
        cv.classList.toggle("sur-objet", k > 0 && !!liste[k - 1]);
      }, 60);
    }
    function brancher(){
      cv.addEventListener("pointerdown", function(e){
        try { cv.setPointerCapture(e.pointerId); } catch (x){}
        ptrs.set(e.pointerId, local(e));
        if (ptrs.size === 1){ depart = local(e); bouge = false; multi = false; doigt = e.pointerType !== "mouse"; }
        else multi = true;
        cv.classList.add("tire");
      });
      cv.addEventListener("pointermove", function(e){
        if (coupe && souris && e.pointerType === "mouse") survoler(pres(local(e).x, local(e).y));
        var p = ptrs.get(e.pointerId);
        if (!p){ if (e.pointerType === "mouse"){ if (mesure.actif) survolMesure(e); else survolObjet(e); } return; }
        var n = local(e);
        if (ptrs.size === 1){
          if (!bouge && Math.hypot(n.x - depart.x, n.y - depart.y) > 5){
          bouge = true;
          if (!(e.shiftKey || (e.buttons & 6))) pivoter(depart.x, depart.y);
        }
          if (bouge){
            var dx = n.x - p.x, dy = n.y - p.y;
            if (e.shiftKey || (e.buttons & 6)){ px += dx; py += dy; }
            else { yaw -= dx*.01; pitch = Math.max(-1.55, Math.min(1.55, pitch + dy*.01)); }
            vite = true; demander();
          }
          p.x = n.x; p.y = n.y;
        } else if (ptrs.size === 2){
          var q = null;
          ptrs.forEach(function(v, k){ if (k !== e.pointerId) q = v; });
          var am = { x: (p.x + q.x)/2, y: (p.y + q.y)/2 }, ad = Math.hypot(p.x - q.x, p.y - q.y);
          p.x = n.x; p.y = n.y;
          var nm = { x: (p.x + q.x)/2, y: (p.y + q.y)/2 }, nd = Math.hypot(p.x - q.x, p.y - q.y);
          if (ad > 0 && nd > 0) zoomAutour(nd/ad, nm.x, nm.y);
          px += nm.x - am.x; py += nm.y - am.y;
          vite = true; demander();
        }
      });
      function fin(e){
        if (!ptrs.has(e.pointerId)) return;
        ptrs.delete(e.pointerId);
        if (ptrs.size) return;
        cv.classList.remove("tire");
        if (vite){ vite = false; demander(); }
        if (e.type === "pointerup" && !bouge && !multi && mesure.actif && (e.button === 0 || e.pointerType !== "mouse")){
          var pm = local(e);
          if (W && H) cliqueMesure(pm.x, pm.y);
        }
        else if (e.type === "pointerup" && !bouge && !multi && (e.button === 0 || e.pointerType !== "mouse")){
          var p = local(e), k = W && H ? M.viser(camera(), p.x, p.y) : 0;
          if (M.nom === "WebGL") demander();
          if (rappels.surClic) rappels.surClic(k > 0 && liste[k - 1] ? liste[k - 1].id : 0, e);
        }
        else if (e.type === "pointerup" && !bouge && !multi && e.button === 2) menu(e);
      }
      // clic droit sans bouger, ou appui long au doigt : menu contextuel sur l'élément visé
      function menu(e){
        if (!rappels.surMenu) return;
        var p = local(e), k = W && H ? M.viser(camera(), p.x, p.y) : 0;
        if (M.nom === "WebGL") demander();
        rappels.surMenu(k > 0 && liste[k - 1] ? liste[k - 1].id : 0, e.clientX, e.clientY);
      }
      cv.addEventListener("pointerup", fin);
      cv.addEventListener("pointerleave", function(e){
        clearTimeout(attenteSurvol); cv.classList.remove("sur-objet");
        clearTimeout(attenteMesure);
        if (mesure.survol){ mesure.survol = null; demander(); }
        var r = e.relatedTarget;
        if (!(r && r.classList && r.classList.contains("poignee"))) survoler(false);     // passer sur une poignée n'est pas sortir
      });
      cv.addEventListener("pointercancel", fin);
      cv.addEventListener("contextmenu", function(e){
        e.preventDefault();
        if (!doigt || bouge || multi || ptrs.size > 1) return;
        ptrs.clear(); cv.classList.remove("tire");
        menu(e);
      });
      cv.addEventListener("dblclick", function(e){ e.preventDefault(); recadrer(); });
      var minuterie = 0;
      cv.addEventListener("wheel", function(e){
        e.preventDefault();
        var p = local(e);
        // sens d'origine, juste avec une vraie souris (molette vers l'avant : on se rapproche)
        zoomAutour(Math.exp(-e.deltaY*(e.deltaMode === 1 ? .05 : .0015)), p.x, p.y);
        vite = true; demander();
        clearTimeout(minuterie);
        minuterie = setTimeout(function(){ vite = false; demander(); }, 160);
      }, { passive: false });
      cv.addEventListener("webglcontextlost", function(e){ e.preventDefault(); });
      cv.addEventListener("webglcontextrestored", function(){ M.restaurer(); M.teinter(liste, sel, actif, coul); demander(); });
    }
    brancher();

    return {
      // Modèles ouverts (plusieurs fichiers dans le même repère) : la géométrie déjà lue reste en cache
      modeles: function(ms){
        var avant = Gs;
        Gs = new Map();
        ms.forEach(function(m){ Gs.set(m, avant.get(m) || prets.get(m) || Contexte(m)); prets.delete(m); });
        liste = []; origine = null;
        if (!ms.length){ coupe = null; M.coupe(null); }
      },
      // Géométrie calculée à l'avance, par tranches, pour que la page ne gèle pas à l'ouverture d'un gros
      // fichier : ids des éléments du modèle, progres(0–1) ; promesse résolue quand tout est prêt.
      preparer: function(m, ids, progres){
        var G = Gs.get(m) || prets.get(m), i = 0;
        if (!G){ G = Contexte(m); prets.set(m, G); }
        return new Promise(function(ok){
          (function tranche(){
            var t0 = performance.now();
            while (i < ids.length && performance.now() - t0 < 40){
              var g = geometrie(G, ids[i++]);
              if (g){ triangles(g); aretesVives(g); }
            }
            if (progres) progres(ids.length ? i/ids.length : 1);
            if (i < ids.length) setTimeout(tranche, 0); else ok();
          })();
        });
      },
      // Éléments à dessiner : [{ cle, m, id }] ; renvoie le bilan de lecture
      afficher: function(items){
        liste = [];
        nbFaces = 0;
        items.forEach(function(it){
          var G = Gs.get(it.m), g = null, rgb = null;
          if (G && source === "externe" && G.externe){ g = G.externe.geos.get(it.id) || null; if (g) rgb = G.externe.teintes.get(it.id) || null; }
          if (G && !g) g = geometrie(G, it.id);
          if (g){ liste.push({ id: it.cle, geo: g, h: it.h, rgb: rgb }); nbFaces += g.faces.length; }
        });
        // origine fixée au premier affichage (précision des coordonnées en float32) ; profondeur élargie au besoin
        var b = boite();
        if (!origine){ origine = b ? b.c : [0,0,0]; prof = 1; }
        if (b) prof = Math.max(prof, (Math.hypot(b.c[0] - origine[0], b.c[1] - origine[1], b.c[2] - origine[2]) + b.r)*3);
        M.charger(liste, origine);
        M.teinter(liste, sel, actif, coul);
        demander();
        var nonLus = {}, erreurs = 0;
        Gs.forEach(function(G){
          Object.keys(G.nonLus).forEach(function(k){ nonLus[k] = (nonLus[k] || 0) + G.nonLus[k]; });
          erreurs += G.erreurs;
        });
        return { elements: liste.length, faces: nbFaces, nonLus: nonLus, erreurs: erreurs, moteur: M.nom };
      },
      selection: function(s, a){ sel = s; actif = a || 0; M.teinter(liste, sel, actif, coul); demander(); },
      recadrer: recadrer,
      // vue type : lacet (autour de Z) et plongée en radians, puis recadrage
      orienter: function(l, p){ yaw = l; pitch = Math.max(-1.55, Math.min(1.55, p)); recadrer(); },
      redessiner: function(){ taille(); },
      // Zoom sur des éléments (clés), sans rien masquer
      cadrer: function(cles){ var b = boiteDe(cles); if (b) cadrerSur(b); return !!b; },
      // Boîte de coupe autour d'éléments (clés), avec une petite marge ; null l'enlève. Renvoie vrai si une boîte est posée.
      coupe: function(cles){
        var b = cles ? boiteDe(cles, angleCoupe) : null;
        if (b){
          var m = Math.max(Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])*.04, rayon*.002);
          b = { min: b.min.map(function(v){ return v - m; }), max: b.max.map(function(v){ return v + m; }), a: b.a };
        }
        coupe = b; fige = false; cadreMasque = false;
        M.coupe(b);
        if (b) cadrerSur(b); else demander();
        return !!b;
      },
      // Boîte figée : plus de poignées, plus de retouche à la souris
      figer: function(oui){ fige = !!oui && !!coupe; demander(); return fige; },
      fige: function(){ return fige; },
      // Cadre de la boîte (arêtes et poignées) masqué ou affiché ; la coupe reste active
      cadre: function(oui){ if (oui !== undefined){ cadreMasque = !oui; demander(); } return !cadreMasque; },
      aCoupe: function(){ return !!coupe; },
      // Outil de mesure : mode actif ou non (sans argument : l'état) ; les mesures faites restent affichées
      mesurer: function(oui){
        if (oui !== undefined){
          mesure.actif = !!oui; mesure.a = null; mesure.survol = null;
          cv.classList.toggle("mesure", mesure.actif);
          demander();
        }
        return mesure.actif;
      },
      // Échap : abandonne le premier point posé, sinon quitte le mode ; vrai si quelque chose a changé
      annulerMesure: function(){
        if (mesure.a){ mesure.a = null; mesure.survol = null; demander(); return true; }
        if (mesure.actif){ this.mesurer(false); return true; }
        return false;
      },
      nbMesures: function(){ return mesure.liste.length; },
      effacerMesures: function(){ mesure.liste = []; mesure.a = null; demander(); },
      // unité des longueurs affichées : { nom: "mm", k: décimales }
      uniteMesure: function(u){ mesure.unite = u; demander(); },
      // Retaille : éléments d'un modèle (ids) rangés par rapport à la boîte de coupe (null sans boîte)
      classerCoupe: function(m, ids){ var G = Gs.get(m); return coupe && G ? classer(G, ids, coupe) : null; },
      // Coupe net les éléments à cheval [{ id, plans }] (découpes IFC) ; renvoie { changement, ids, nonCoupes }
      retailler: function(m, acheval){ var G = Gs.get(m); return G ? retaillerModele(G, acheval) : null; },
      // Géométrie d'éléments à relire (représentation changée) ; celle de web-ifc est à recalculer
      oublier: function(m, ids){ var G = Gs.get(m); if (!G) return; ids.forEach(function(id){ G.cache.delete(id); }); G.externe = null; },
      // Orientation de la boîte (radians autour de la verticale) ; la boîte en place tourne autour de son centre
      // en gardant ses dimensions. Sans argument : l'angle actuel.
      orienterCoupe: function(a){
        if (a === undefined) return coupe ? coupe.a || 0 : angleCoupe;
        angleCoupe = a;
        if (coupe){
          var C = centreBoite(coupe), h = [0, 1, 2].map(function(i){ return (coupe.max[i] - coupe.min[i])/2; });
          var b = { a: a }, l = versBoite(b, C[0], C[1]), lc = [l[0], l[1], C[2]];
          b.min = lc.map(function(v, i){ return v - h[i]; }); b.max = lc.map(function(v, i){ return v + h[i]; });
          coupe = b;
          M.coupe(b);
          demander();
        }
        return a;
      },
      // Angle de la face visée sous le point écran (clientX, clientY), ou null
      angleSous: function(cx, cy){
        var r = cv.getBoundingClientRect(), v = viseeSous(cx - r.left, cy - r.top);
        return v && v.t >= 0 ? angleFace(v.T, v.t) : null;
      },
      // Changement de moteur à chaud : nouveau canvas, mêmes éléments, même caméra
      // Sans argument : clé du moteur en cours. Avec une clé : promesse du nom du moteur démarré ; le
      // nouveau moteur prépare un canvas neuf à part et ne remplace l'ancien qu'une fois prêt.
      moteur: function(nom){
        if (nom === undefined) return M.cle;
        if (nom === M.cle) return Promise.resolve(M.nom);
        var f = FABRIQUES[nom];
        if (!f) return Promise.reject(new Error("moteur inconnu"));
        var neuf = cv.cloneNode(false);
        neuf.width = cv.width; neuf.height = cv.height;
        return Promise.resolve().then(function(){ return f(neuf, OUTILS); }).then(function(N){
          if (!N || N.echec) throw new Error((N && N.message) || "indisponible sur cet appareil ou ce navigateur");
          N.cle = nom;
          M.liberer();
          ptrs.clear(); vite = false;
          if (ro) ro.unobserve(cv);
          cv.parentNode.replaceChild(neuf, cv);
          cv = neuf; M = N;
          brancher();
          if (ro) ro.observe(cv);
          M.charger(liste, origine || [0,0,0]);
          M.coupe(coupe);
          M.teinter(liste, sel, actif, coul);
          taille();
          return M.nom;
        });
      },
      // Source de la géométrie : "maison" (lecteur de l'outil) ou "externe" (web-ifc, fournie par fichier)
      sourceGeo: function(nom){ if (nom !== undefined) source = nom; return source; },
      geometriesExternes: function(m, carte, couleurs){
        var G = Gs.get(m);
        if (!G) return null;
        G.externe = calibrer(G, carte, couleurs);
        return G.externe.info;
      },
      aExterne: function(m){ var G = Gs.get(m); return !!(G && G.externe); }
    };
  }

  // Moteurs d'affichage : fabrique(canvas, outils) → moteur, promesse de moteur, ou null (indisponible).
  // WebGL et canvas 2D sont ici ; WebGPU et Three.js sont ajoutés par ifc-moteurs.js.
  var FABRIQUES = { webgl: function(cv){ return moteurGL(cv); }, canvas: function(cv){ return moteurCanvas(cv); } };
  var OUTILS = { triangles: triangles, aretesVives: aretesVives, aretesBoite: aretesBoite, boiteRel: boiteRel, axeBoite: axeBoite, faceBoite: faceBoite, matriceVue: matriceVue, viserCPU: viserCPU, OR: OR };
  global.IFCVue = {
    creer: creer,
    ajouterMoteur: function(cle, fabrique){ FABRIQUES[cle] = fabrique; },
    // géométrie venue d'ailleurs (web-ifc) : triangles à plat (9 nombres par triangle) → objet géométrie de l'aperçu
    geoTriangles: geoTriangles
  };
})(window);
