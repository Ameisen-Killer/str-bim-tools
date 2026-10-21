// Aperçu 3D de /ifc/ : rendu canvas 2D maison, sans WebGL ni bibliothèque.
// - Géométrie lue : IFCFACETEDBREP (faces, boucles, points), IFCMAPPEDITEM (IFCREPRESENTATIONMAP +
//   IFCCARTESIANTRANSFORMATIONOPERATOR3D), IFCEXTRUDEDAREASOLID (profils paramétrés ou polylignes),
//   surfaces à facettes, faces triangulées/polygonales IFC4, quelques primitives ; chaîne
//   IFCLOCALPLACEMENT récursive. Le reste est compté dans « non lus » et affiché dans la vue.
// - Projection orthographique, faces triées en profondeur (peintre), ombrage lambert, arêtes fines.
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
  function poly(pts){ return pts; }
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
  function profil(G, id, prof){
    var e = G.m.ent.get(id);
    if (!e || (prof || 0) > 8) return null;
    var a = C(e), t = e.type, B = null, pos = a[2];
    var X, Y, w, h, b, tw, tf;
    switch (t){
      case "IFCRECTANGLEPROFILEDEF": case "IFCROUNDEDRECTANGLEPROFILEDEF":
        B = [rect(N(a[3])/2, N(a[4])/2)]; break;
      case "IFCRECTANGLEHOLLOWPROFILEDEF":
        X = N(a[3])/2; Y = N(a[4])/2; w = N(a[5]);
        B = [rect(X, Y), rect(X - w, Y - w)]; break;
      case "IFCCIRCLEPROFILEDEF":
        B = [cercle(N(a[3]))]; break;
      case "IFCCIRCLEHOLLOWPROFILEDEF":
        B = [cercle(N(a[3])), cercle(N(a[3]) - N(a[4]))]; break;
      case "IFCELLIPSEPROFILEDEF":
        B = [cercle(N(a[3]), N(a[4]))]; break;
      case "IFCISHAPEPROFILEDEF":
        b = N(a[3])/2; h = N(a[4])/2; tw = N(a[5])/2; tf = N(a[6]);
        B = [poly([-b,-h, b,-h, b,-h+tf, tw,-h+tf, tw,h-tf, b,h-tf, b,h, -b,h, -b,h-tf, -tw,h-tf, -tw,-h+tf, -b,-h+tf])]; break;
      case "IFCTSHAPEPROFILEDEF":
        h = N(a[3])/2; b = N(a[4])/2; tw = N(a[5])/2; tf = N(a[6]);
        B = [poly([-b,h, b,h, b,h-tf, tw,h-tf, tw,-h, -tw,-h, -tw,h-tf, -b,h-tf])]; break;
      case "IFCUSHAPEPROFILEDEF": case "IFCCSHAPEPROFILEDEF":
        h = N(a[3])/2; b = N(a[4])/2; tw = N(a[5]); tf = t === "IFCCSHAPEPROFILEDEF" ? tw : N(a[6]);
        B = [poly([-b,-h, b,-h, b,-h+tf, -b+tw,-h+tf, -b+tw,h-tf, b,h-tf, b,h, -b,h])]; break;
      case "IFCLSHAPEPROFILEDEF":
        h = N(a[3])/2; b = (N(a[4]) || N(a[3]))/2; tw = N(a[5]);
        B = [poly([-b,-h, b,-h, b,-h+tw, -b+tw,-h+tw, -b+tw,h, -b,h])]; break;
      case "IFCZSHAPEPROFILEDEF":
        h = N(a[3])/2; b = N(a[4]); tw = N(a[5])/2; tf = N(a[6]);
        B = [poly([-tw,-h, b-tw,-h, b-tw,-h+tf, tw,-h+tf, tw,h, -b+tw,h, -b+tw,h-tf, -tw,h-tf])]; break;
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

  // ================= Rendu et interaction =================
  function creer(cv, rappels){
    rappels = rappels || {};
    var ctx = cv.getContext("2d");
    var G = null, liste = [], sel = new Set(), actif = 0;
    var yaw = -0.65, pitch = 0.5, zoom = 1, px = 0, py = 0, centre = [0,0,0], rayon = 1;
    var W = 0, H = 0, dpr = 1, dessin = [], attente = false, vite = false, nbFaces = 0;
    var coul = {};
    var LUM = (function(){ var l = Math.hypot(-.45, .6, .66); return [-.45/l, .6/l, .66/l]; })();
    var OR = [214,168,92];

    function rvb(nom, defaut){
      var v = getComputedStyle(document.documentElement).getPropertyValue(nom).trim().split(",").map(Number);
      return v.length === 3 && v.every(isFinite) ? v : defaut;
    }
    function couleurs(){
      coul.piece = rvb("--vue-piece", [236,232,224]);
      var a = rvb("--vue-arete", [236,232,224]);
      coul.arete = "rgba(" + a.join(",") + ",.2)";
      coul.areteOr = "rgba(120,86,30,.55)";
      coul.actif = "rgba(" + OR.join(",") + ",.95)";
      coul.texte = "rgba(" + a.join(",") + ",.45)";
      coul.teintes = {};
    }
    function teinte(base, k){
      var cle = (base === OR ? "o" : "p") + k, t = coul.teintes[cle];
      if (!t){
        var f = .34 + .66*k/24;
        t = coul.teintes[cle] = "rgb(" + Math.round(base[0]*f) + "," + Math.round(base[1]*f) + "," + Math.round(base[2]*f) + ")";
      }
      return t;
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

    function echelle(){ return Math.min(W, H)*.44/rayon*zoom; }
    function demander(){ if (!attente){ attente = true; requestAnimationFrame(rendre); } }

    function rendre(){
      attente = false;
      if (!W || !H) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      dessin.length = 0;
      if (!liste.length){
        ctx.fillStyle = coul.texte; ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText(G ? "Aucune géométrie à afficher" : "", W/2, H/2);
        return;
      }
      var ca = Math.cos(yaw), sa = Math.sin(yaw), cb = Math.cos(pitch), sb = Math.sin(pitch), s = echelle();
      var cx = W/2 + px, cy = H/2 + py, c0 = centre[0], c1 = centre[1], c2 = centre[2];
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
              var up = qz*cb + yv*sb, sx = cx + xv*s, sy = cy - up*s;
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
      var aretes = !(vite && dessin.length > 12000);
      ctx.lineJoin = "round";
      ctx.lineWidth = .6;
      for (var i = 0; i < dessin.length; i++){
        var F = dessin[i], it = liste[F.el], n = F.n;
        var nx1 = ca*n[0] + sa*n[1], ny1 = -sa*n[0] + ca*n[1];
        var nup = n[2]*cb + ny1*sb, ndp = ny1*cb - n[2]*sb;
        var lum = Math.abs(nx1*LUM[0] + nup*LUM[1] - ndp*LUM[2]);
        var choisi = sel.has(it.id);
        ctx.beginPath();
        for (var bj = 0; bj < F.p.length; bj++){
          var P = F.p[bj];
          ctx.moveTo(P[0], P[1]);
          for (var q = 2; q < P.length; q += 2) ctx.lineTo(P[q], P[q+1]);
          ctx.closePath();
        }
        ctx.fillStyle = teinte(choisi ? OR : coul.piece, Math.round(lum*24));
        ctx.fill("evenodd");
        if (it.id === actif){ ctx.strokeStyle = coul.actif; ctx.lineWidth = 1.1; ctx.stroke(); ctx.lineWidth = .6; }
        else if (aretes){ ctx.strokeStyle = choisi ? coul.areteOr : coul.arete; ctx.stroke(); }
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
    function viser(x, y){
      for (var i = dessin.length - 1; i >= 0; i--){       // du devant vers l'arrière
        var F = dessin[i];
        if (x < F.x0 || x > F.x1 || y < F.y0 || y > F.y1) continue;
        if (dedans(F, x, y)) return liste[F.el].id;
      }
      return 0;
    }

    function recadrer(){
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      liste.forEach(function(it){
        for (var k = 0; k < 3; k++){
          if (it.geo.min[k] < mn[k]) mn[k] = it.geo.min[k];
          if (it.geo.max[k] > mx[k]) mx[k] = it.geo.max[k];
        }
      });
      if (!isFinite(mn[0])){ centre = [0,0,0]; rayon = 1; }
      else {
        centre = [(mn[0] + mx[0])/2, (mn[1] + mx[1])/2, (mn[2] + mx[2])/2];
        rayon = Math.max(1e-9, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])/2);
      }
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
          else { yaw += dx*.01; pitch = Math.max(-1.55, Math.min(1.55, pitch + dy*.01)); }
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
        var p = local(e);
        if (rappels.surClic) rappels.surClic(viser(p.x, p.y), e);
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

    return {
      // Nouveau modèle : la géométrie en cache repart de zéro
      modele: function(m){ G = Contexte(m); liste = []; },
      // Éléments à dessiner (ids) ; renvoie le bilan de lecture
      afficher: function(ids){
        liste = [];
        nbFaces = 0;
        ids.forEach(function(id){
          var g = geometrie(G, id);
          if (g){ liste.push({ id: id, geo: g }); nbFaces += g.faces.length; }
        });
        demander();
        return { elements: liste.length, faces: nbFaces, nonLus: G.nonLus, erreurs: G.erreurs };
      },
      selection: function(s, a){ sel = s; actif = a || 0; demander(); },
      recadrer: recadrer,
      redessiner: function(){ taille(); }
    };
  }

  global.IFCVue = { creer: creer };
})(window);
