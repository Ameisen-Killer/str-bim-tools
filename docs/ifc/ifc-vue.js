// Aperçu 3D de /ifc/ : rendu maison, sans bibliothèque. WebGL écrit à la main (tampon de profondeur,
// exact), avec en secours le moteur canvas 2D du peintre (ou forcé par ?moteur=canvas dans l'adresse).
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
      case "IFCBOOLEANRESULT": case "IFCBOOLEANCLIPPINGRESULT":
        // aperçu : on dessine l'opérande principal (les découpes ne sont pas calculées)
        item(G, R(a[1]), M, out, prof + 1);
        if (a[0] && a[0].enu === "UNION") item(G, R(a[2]), M, out, prof + 1);
        break;
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

  function geometrie(G, id){
    if (G.cache.has(id)) return G.cache.get(id);
    var res = null;
    try {
      var e = G.m.ent.get(id), a = C(e), pds = G.m.ent.get(R(a[6]));
      if (pds){
        var reps = L(C(pds)[2]).map(function(r){ return G.m.ent.get(r); }).filter(Boolean);
        var choix = reps.filter(function(r){ return IFC.chaine(C(r)[1]).toLowerCase() === "body"; });
        if (!choix.length) choix = reps.filter(function(r){ return TYPES_3D[IFC.chaine(C(r)[2])]; });
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
  var SOURCES = {
    vFaces: "attribute vec3 aP;attribute vec3 aN;attribute vec3 aC;uniform mat4 uM;uniform vec3 uL;varying vec3 vC;" +
      "void main(){gl_Position=uM*vec4(aP,1.0);float l=abs(dot(aN,uL));vC=aC*(0.34+0.66*l);}",
    fFaces: "precision mediump float;varying vec3 vC;void main(){gl_FragColor=vec4(vC,1.0);}",
    vLignes: "attribute vec3 aP;attribute vec4 aC;uniform mat4 uM;varying vec4 vC;void main(){gl_Position=uM*vec4(aP,1.0);vC=aC;}",
    fLignes: "precision mediump float;varying vec4 vC;void main(){gl_FragColor=vC;}",
    vId: "attribute vec3 aP;attribute vec3 aC;uniform mat4 uM;varying vec3 vC;void main(){gl_Position=uM*vec4(aP,1.0);vC=aC;}",
    fId: "precision mediump float;varying vec3 vC;void main(){gl_FragColor=vec4(vC,1.0);}"
  };

  function moteurGL(cv){
    var gl = null;
    try {
      var opts = { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false };
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
      return { p: p, uM: gl.getUniformLocation(p, "uM"), uL: gl.getUniformLocation(p, "uL") };
    }
    var P = {}, B = {}, nTri = 0, nLig = 0, plages = [], origine = [0,0,0], fbo = null;
    function init(){
      P.faces = programme(SOURCES.vFaces, SOURCES.fFaces, ["aP", "aN", "aC"]);
      P.lignes = programme(SOURCES.vLignes, SOURCES.fLignes, ["aP", null, "aC"]);
      P.id = programme(SOURCES.vId, SOURCES.fId, ["aP", null, "aC"]);
      ["pos", "nor", "col", "ids", "lpos", "lcol"].forEach(function(k){ B[k] = gl.createBuffer(); });
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
    }

    function teinter(liste, sel, actif, coul){
      var col = new Uint8Array(3*nTri), lcol = new Uint8Array(4*nLig);
      var P1 = coul.piece, ar = coul.areteRGBA, aro = coul.areteOrRGBA, act = coul.actifRGBA;
      liste.forEach(function(it, e){
        var pl = plages[e];
        if (!pl) return;
        var c = sel.has(it.id) ? OR : P1, l = it.id === actif ? act : sel.has(it.id) ? aro : ar;
        for (var v = pl[0]; v < pl[1]; v++){ col[3*v] = c[0]; col[3*v+1] = c[1]; col[3*v+2] = c[2]; }
        for (var w = pl[2]; w < pl[3]; w++){ lcol[4*w] = l[0]; lcol[4*w+1] = l[1]; lcol[4*w+2] = l[2]; lcol[4*w+3] = l[3]; }
      });
      remplir(B.col, col, gl.DYNAMIC_DRAW);
      remplir(B.lcol, lcol, gl.DYNAMIC_DRAW);
    }

    // Matrice de vue (colonnes) : même projection orthographique que le moteur canvas
    function matrice(c){
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
      perdu: function(){ return gl.isContextLost(); },
      restaurer: function(){ init(); if (dernier) charger(dernier.liste, dernier.orig); }
    };
  }

  // ================= Moteur canvas 2D (secours) =================
  function moteurCanvas(cv){
    var ctx = cv.getContext("2d"), liste = [], dessin = [], sel = new Set(), actif = 0, coul = null, teintes = {};
    function teinte(base, k){
      var cle = (base === OR ? "o" : "p") + k, t = teintes[cle];
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
          for (var bi = 0; bi < f.b.length; bi++){
            var b = f.b[bi], p = f.p[bi];
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
        var choisi = sel.has(it.id), estActif = it.id === actif, fond = teinte(choisi ? OR : coul.piece, Math.round(lum*24));
        ctx.beginPath();
        for (var bj = 0; bj < F.p.length; bj++){
          var P = F.p[bj];
          ctx.moveTo(P[0], P[1]);
          for (var q = 2; q < P.length; q += 2) ctx.lineTo(P[q], P[q+1]);
          ctx.closePath();
        }
        ctx.fillStyle = fond;
        ctx.fill("evenodd");
        if (detail){ ctx.strokeStyle = fond; ctx.lineWidth = .8; ctx.stroke(); }     // bouche les joints entre facettes
        if ((detail || estActif) && F.ar && F.ar.length){
          ctx.beginPath();
          for (var r = 0; r < F.ar.length; r += 2){
            var Q = F.p[F.ar[r]], a = F.ar[r+1], m = Q.length/2, z = (a + 1) % m;
            ctx.moveTo(Q[2*a], Q[2*a+1]); ctx.lineTo(Q[2*z], Q[2*z+1]);
          }
          ctx.strokeStyle = estActif ? coul.actif : choisi ? coul.areteOr : coul.arete;
          ctx.lineWidth = estActif ? 1.1 : .6;
          ctx.stroke();
        }
      }
      if (!liste.length){
        ctx.fillStyle = coul.texte; ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText("Aucune géométrie à afficher", W/2, H/2);
      }
    }
    function dedans(F, x, y){
      var c = false;
      for (var bi = 0; bi < F.p.length; bi++){
        var p = F.p[bi], n = p.length/2;
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
      perdu: function(){ return false; }, restaurer: function(){}
    };
  }

  // ================= Vue : caméra, interaction, choix du moteur =================
  var OR = [214,168,92];

  function creer(cv, rappels){
    rappels = rappels || {};
    // WebGL d'abord ; le moteur canvas 2D prend le relais s'il manque (ou avec ?moteur=canvas dans l'adresse)
    var M = null;
    if (!/[?&]moteur=canvas\b/.test(location.search)) M = moteurGL(cv);
    if (M && M.echec){
      var neuf = cv.cloneNode(false);           // un canvas qui a servi à WebGL ne peut plus donner de contexte 2D
      cv.parentNode.replaceChild(neuf, cv);
      cv = neuf; M = null;
    }
    if (!M) M = moteurCanvas(cv);

    var Gs = new Map(), liste = [], sel = new Set(), actif = 0, nbFaces = 0;
    var yaw = -0.65, pitch = 0.5, zoom = 1, px = 0, py = 0, centre = [0,0,0], rayon = 1, origine = null, prof = 1;
    var W = 0, H = 0, dpr = 1, attente = false, vite = false, coul = {};
    var LUM = (function(){ var l = Math.hypot(-.45, .6, .66); return [-.45/l, .6/l, .66/l]; })();

    function rvb(nom, defaut){
      var v = getComputedStyle(document.documentElement).getPropertyValue(nom).trim().split(",").map(Number);
      return v.length === 3 && v.every(isFinite) ? v : defaut;
    }
    function couleurs(){
      var a = rvb("--vue-arete", [236,232,224]), clair = document.documentElement.getAttribute("data-theme") === "clair";
      coul = {
        piece: rvb("--vue-piece", [236,232,224]),
        arete: "rgba(" + a.join(",") + ",.24)", areteRGBA: [a[0], a[1], a[2], Math.round(255*(clair ? .32 : .2))],
        areteOr: "rgba(120,86,30,.55)", areteOrRGBA: [120, 86, 30, 140],
        actif: "rgba(" + OR.join(",") + ",.95)", actifRGBA: clair ? [150, 104, 30, 255] : [240, 196, 112, 255],
        texte: "rgba(" + a.join(",") + ",.45)"
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
    if ("ResizeObserver" in window) new ResizeObserver(taille).observe(cv);
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
        centre: centre, prof: prof, vite: vite, lumiere: lumiere, lumiereVue: LUM };
    }
    function demander(){ if (!attente){ attente = true; requestAnimationFrame(rendre); } }
    function rendre(){
      attente = false;
      if (!W || !H) return;
      M.dessiner(camera());
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
    function recadrer(){
      var b = boite();
      if (b){ centre = b.c; rayon = b.r; } else { centre = [0,0,0]; rayon = 1; }
      zoom = 1; px = 0; py = 0;
      demander();
    }

    // ---------- Souris, doigt, molette ----------
    var ptrs = new Map(), depart = null, bouge = false, multi = false;
    function zoomAutour(f, x, y){
      var nzm = Math.min(400, Math.max(.05, zoom*f));
      f = nzm/zoom; zoom = nzm;
      var cx = W/2 + px, cy = H/2 + py;
      px = x - W/2 - (x - cx)*f;
      py = y - H/2 - (y - cy)*f;
    }
    function local(e){ var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener("pointerdown", function(e){
      try { cv.setPointerCapture(e.pointerId); } catch (x){}
      ptrs.set(e.pointerId, local(e));
      if (ptrs.size === 1){ depart = local(e); bouge = false; multi = false; }
      else multi = true;
      cv.classList.add("tire");
    });
    cv.addEventListener("pointermove", function(e){
      var p = ptrs.get(e.pointerId);
      if (!p) return;
      var n = local(e);
      if (ptrs.size === 1){
        if (!bouge && Math.hypot(n.x - depart.x, n.y - depart.y) > 5) bouge = true;
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
      if (e.type === "pointerup" && !bouge && !multi && (e.button === 0 || e.pointerType !== "mouse")){
        var p = local(e), k = W && H ? M.viser(camera(), p.x, p.y) : 0;
        if (M.nom === "WebGL") demander();
        if (rappels.surClic) rappels.surClic(k > 0 && liste[k - 1] ? liste[k - 1].id : 0, e);
      }
    }
    cv.addEventListener("pointerup", fin);
    cv.addEventListener("pointercancel", fin);
    cv.addEventListener("contextmenu", function(e){ e.preventDefault(); });
    cv.addEventListener("dblclick", function(e){ e.preventDefault(); recadrer(); });
    var minuterie = 0;
    cv.addEventListener("wheel", function(e){
      e.preventDefault();
      var p = local(e);
      zoomAutour(Math.exp(-e.deltaY*(e.deltaMode === 1 ? .05 : .0015)), p.x, p.y);
      vite = true; demander();
      clearTimeout(minuterie);
      minuterie = setTimeout(function(){ vite = false; demander(); }, 160);
    }, { passive: false });
    cv.addEventListener("webglcontextlost", function(e){ e.preventDefault(); });
    cv.addEventListener("webglcontextrestored", function(){ M.restaurer(); M.teinter(liste, sel, actif, coul); demander(); });

    return {
      // Modèles ouverts (plusieurs fichiers dans le même repère) : la géométrie déjà lue reste en cache
      modeles: function(ms){
        var avant = Gs;
        Gs = new Map();
        ms.forEach(function(m){ Gs.set(m, avant.get(m) || Contexte(m)); });
        liste = []; origine = null;
      },
      // Éléments à dessiner : [{ cle, m, id }] ; renvoie le bilan de lecture
      afficher: function(items){
        liste = [];
        nbFaces = 0;
        items.forEach(function(it){
          var G = Gs.get(it.m), g = G ? geometrie(G, it.id) : null;
          if (g){ liste.push({ id: it.cle, geo: g }); nbFaces += g.faces.length; }
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
      redessiner: function(){ taille(); }
    };
  }

  global.IFCVue = { creer: creer };
})(window);
