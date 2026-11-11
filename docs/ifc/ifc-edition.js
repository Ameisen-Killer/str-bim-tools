// Édition des maquettes de /ifc/ (mode Éditeur) : déplacer, tourner, copier, changer d'étage, dimensions des
// extrusions, attributs, valeurs de propriétés, classe IFC. Rien ici ne touche à la page.
// - Chaque opération rend un « changement » { avant, apres } que l'historique de l'éditeur rejoue dans les deux
//   sens (comme la suppression), et la liste des éléments dont la géométrie est à relire.
// - On n'écrit que dans le fichier : placements (IFCLOCALPLACEMENT et son IFCAXIS2PLACEMENT3D), relations,
//   représentations. Ce qui est partagé avec d'autres objets (placement, solide, profil, jeu de propriétés)
//   est copié avant d'être modifié : seul l'objet visé change.
// - Les coordonnées passées ici sont dans les unités de longueur du fichier, dans son repère.
(function(global){
  "use strict";

  var C = IFC.champs, R = IFC.idRef, L = IFC.refsListe, N = IFC.nombre;
  var ID = [1,0,0, 0,1,0, 0,0,1, 0,0,0];

  // ================= Petites maths (matrice affine = axes X, Y, Z puis origine) =================
  function mul(A, B){
    return [
      A[0]*B[0]+A[3]*B[1]+A[6]*B[2], A[1]*B[0]+A[4]*B[1]+A[7]*B[2], A[2]*B[0]+A[5]*B[1]+A[8]*B[2],
      A[0]*B[3]+A[3]*B[4]+A[6]*B[5], A[1]*B[3]+A[4]*B[4]+A[7]*B[5], A[2]*B[3]+A[5]*B[4]+A[8]*B[5],
      A[0]*B[6]+A[3]*B[7]+A[6]*B[8], A[1]*B[6]+A[4]*B[7]+A[7]*B[8], A[2]*B[6]+A[5]*B[7]+A[8]*B[8],
      A[0]*B[9]+A[3]*B[10]+A[6]*B[11]+A[9], A[1]*B[9]+A[4]*B[10]+A[7]*B[11]+A[10], A[2]*B[9]+A[5]*B[10]+A[8]*B[11]+A[11]
    ];
  }
  function inverse(A){
    var a = A[0], b = A[3], c = A[6], d = A[1], e = A[4], f = A[7], g = A[2], h = A[5], k = A[8];
    var co0 = e*k - f*h, co1 = f*g - d*k, co2 = d*h - e*g, det = a*co0 + b*co1 + c*co2;
    if (!det) return ID;
    var i = 1/det;
    // inverse 3×3 rangée en colonnes comme A
    var M = [co0*i, co1*i, co2*i, (c*h - b*k)*i, (a*k - c*g)*i, (b*g - a*h)*i, (b*f - c*e)*i, (c*d - a*f)*i, (a*e - b*d)*i, 0, 0, 0];
    M[9] = -(M[0]*A[9] + M[3]*A[10] + M[6]*A[11]);
    M[10] = -(M[1]*A[9] + M[4]*A[10] + M[7]*A[11]);
    M[11] = -(M[2]*A[9] + M[5]*A[10] + M[8]*A[11]);
    return M;
  }
  function norm(v){ var l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); return l > 1e-12 && isFinite(l) ? [v[0]/l, v[1]/l, v[2]/l] : null; }
  function cross(a, b){ return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
  function dot(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
  function ortho(v, z){ var d = dot(v, z); return norm([v[0] - z[0]*d, v[1] - z[1]*d, v[2] - z[2]*d]); }
  function repere(o, z, xr){
    z = norm(z) || [0,0,1];
    var x = xr ? ortho(xr, z) : null;
    if (!x) x = ortho(Math.abs(z[0]) < .9 ? [1,0,0] : [0,1,0], z);
    var y = cross(z, x);
    return [x[0],x[1],x[2], y[0],y[1],y[2], z[0],z[1],z[2], o[0],o[1],o[2]];
  }
  // translation, et rotation d'angle a (radians) autour de la verticale passant par le point c
  function translation(d){ return [1,0,0, 0,1,0, 0,0,1, d[0], d[1], d[2]]; }
  function rotationZ(a, c){
    var k = Math.cos(a), s = Math.sin(a);
    return [k, s, 0, -s, k, 0, 0, 0, 1, c[0] - k*c[0] + s*c[1], c[1] - s*c[0] - k*c[1], 0];
  }

  // ================= Lecture des placements =================
  function point(m, id){
    var e = m.ent.get(id), c = e ? C(e)[0] : null, p = [0,0,0];
    if (Array.isArray(c)) for (var i = 0; i < 3 && i < c.length; i++) p[i] = N(c[i]) || 0;
    return p;
  }
  function direction(m, v){
    var e = v && v.ref && m.ent.get(v.ref);
    if (!e) return null;
    var c = C(e)[0];
    if (!Array.isArray(c)) return null;
    return [N(c[0]) || 0, N(c[1]) || 0, c.length > 2 ? N(c[2]) || 0 : 0];
  }
  function axe(m, v){
    var e = v && v.ref && m.ent.get(v.ref);
    if (!e) return ID;
    var a = C(e);
    if (e.type === "IFCAXIS2PLACEMENT3D") return repere(point(m, R(a[0])), direction(m, a[1]) || [0,0,1], direction(m, a[2]));
    if (e.type === "IFCAXIS2PLACEMENT2D"){ var d = direction(m, a[1]) || [1,0,0]; return repere(point(m, R(a[0])), [0,0,1], [d[0], d[1], 0]); }
    return ID;
  }
  function estLocal(m, id){ var e = id && m.ent.get(id); return !!(e && e.type === "IFCLOCALPLACEMENT"); }
  function parentPl(m, id){ return estLocal(m, id) ? R(C(m.ent.get(id))[0]) : 0; }
  function monde(m, id, prof){
    if (!estLocal(m, id) || (prof || 0) > 64) return ID;
    var a = C(m.ent.get(id));
    return mul(monde(m, R(a[0]), (prof || 0) + 1), axe(m, a[1]));
  }
  function chaine(m, id){ var out = [], k = 0; while (id && k++ < 64){ out.push(id); id = parentPl(m, id); } return out; }
  function placementDe(m, id){ var e = m.ent.get(id); return e ? R(C(e)[5]) : 0; }

  // ================= Écriture =================
  function reel(x){
    if (!isFinite(x) || Math.abs(x) < 1e-12) return "0.";
    var t = String(parseFloat(x.toPrecision(15))), k = t.indexOf("e");
    if (k >= 0){ var a = t.slice(0, k); return (a.indexOf(".") < 0 ? a + "." : a) + "E" + t.slice(k + 1); }
    return t.indexOf(".") < 0 ? t + "." : t;
  }
  function arrondi(v, q){ var r = Math.round(v/q)*q; return Math.abs(r - v) < q*1e-3 ? r : v; }
  function triplet(v, q){ return "(" + v.map(function(x){ return reel(q ? arrondi(x, q) : x); }).join(",") + ")"; }
  // Chaîne STEP : apostrophes et barres doublées, caractères hors ASCII en \X2\…\X0\
  function texteStep(s){
    var o = "'";
    for (var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i);
      if (c === 39) o += "''";
      else if (c === 92) o += "\\\\";
      else if (c >= 32 && c < 127) o += s.charAt(i);
      else if (c >= 32) o += "\\X2\\" + ("000" + c.toString(16).toUpperCase()).slice(-4) + "\\X0\\";
    }
    return o + "'";
  }
  var B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  function guid(){
    var r = new Uint8Array(22);
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(r); else for (var k = 0; k < 22; k++) r[k] = Math.random()*256 | 0;
    var s = B64.charAt(r[0] & 3);
    for (var i = 1; i < 22; i++) s += B64.charAt(r[i] & 63);
    return "'" + s + "'";
  }
  function listeIds(ids){ return "(" + ids.map(function(i){ return "#" + i; }).join(",") + ")"; }
  // remplace la référence #a par #b dans des arguments bruts (hors chaînes)
  function remplacerRef(args, a, b){
    var re = new RegExp("#" + a + "(?![0-9])", "g");
    return args.map(function(x){ return x.charCodeAt(0) === 39 ? x : x.replace(re, "#" + b); });
  }

  // Écritures d'une opération : entités créées, modifiées, retirées → changement annulable
  function Ecrivain(m){
    var avant = new Map(), apres = new Map(), retires = new Set(), neufs = [], suivant = m.maxId;
    var W = {
      ent: function(id){ return retires.has(id) ? null : apres.get(id) || m.ent.get(id); },
      args: function(id){ return IFC.bruts(W.ent(id)).slice(); },
      cree: function(type, args){
        var id = ++suivant;
        apres.set(id, IFC.lireEntite("#" + id + "=" + type + "(" + args.join(",") + ")"));
        neufs.push(id);
        return id;
      },
      garder: function(id){ if (m.ent.has(id) && !avant.has(id)) avant.set(id, m.ent.get(id)); },
      modifie: function(id, args){ W.garder(id); apres.set(id, IFC.refaire(W.ent(id), args)); },
      // même id, autre classe (changement de classe IFC)
      retype: function(id, type, args){ W.garder(id); apres.set(id, IFC.lireEntite("#" + id + "=" + type + "(" + args.join(",") + ")")); },
      retire: function(id){ W.garder(id); apres.delete(id); retires.add(id); },
      vide: function(){ return !avant.size && !apres.size; },
      fin: function(){
        if (W.vide()) return null;
        m.maxId = suivant;
        neufs.forEach(function(id){ if (apres.has(id)) m.ordre.push(id); });
        var av = [], ap = [];
        avant.forEach(function(e){ av.push(e); });
        apres.forEach(function(e){ ap.push(e); });
        return { avant: av, apres: ap, nbRetirees: retires.size };
      },
      nbNeufs: function(){ return neufs.length; }
    };
    return W;
  }

  // Nombre d'entités qui désignent chacun des ids (styles et calques exclus : ils ne possèdent rien)
  var FAIBLES = { IFCSTYLEDITEM:1, IFCPRESENTATIONLAYERASSIGNMENT:1, IFCPRESENTATIONLAYERWITHSTYLE:1, IFCMATERIALDEFINITIONREPRESENTATION:1, IFCSHAPEASPECT:1 };
  function compteRefs(m, ids){
    var n = new Map();
    ids.forEach(function(id){ n.set(id, 0); });
    m.ent.forEach(function(e){
      if (FAIBLES[e.type]) return;
      var vu = null;
      for (var i = 0; i < e.refs.length; i++){
        var r = e.refs[i], c = n.get(r);
        if (c === undefined) continue;
        if (!vu) vu = new Set();
        if (vu.has(r)) continue;
        vu.add(r); n.set(r, c + 1);
      }
    });
    return n;
  }
  // Placements utilisés comme ObjectPlacement par plusieurs objets
  function usagesPlacements(m){
    var I = IFC.index(m), n = new Map();
    I.produits.forEach(function(id){ var p = placementDe(m, id); if (p) n.set(p, (n.get(p) || 0) + 1); });
    return n;
  }
  // Nouvel axe local pour la matrice M (unités du fichier ; arrondis : 1e-6 sur les positions, 1e-12 sur les directions)
  function ecrireAxe(W, M){
    var o = W.cree("IFCCARTESIANPOINT", [triplet([M[9], M[10], M[11]], 1e-6)]);
    var z = W.cree("IFCDIRECTION", [triplet(norm([M[6], M[7], M[8]]) || [0,0,1], 1e-12)]);
    var x = W.cree("IFCDIRECTION", [triplet(norm([M[0], M[1], M[2]]) || [1,0,0], 1e-12)]);
    return W.cree("IFCAXIS2PLACEMENT3D", ["#" + o, "#" + z, "#" + x]);
  }
  // Pose l'objet id à la matrice monde Wn, son placement relatif à parent (placement, 0 = absolu)
  function poser(W, m, usage, id, Wn, parent){
    var p = placementDe(m, id), L0 = mul(inverse(monde(m, parent)), Wn), ax = ecrireAxe(W, L0);
    var args = [parent ? "#" + parent : "$", "#" + ax];
    if (estLocal(m, p) && (usage.get(p) || 0) <= 1) W.modifie(p, args);
    else { var np = W.cree("IFCLOCALPLACEMENT", args), ea = W.args(id); ea[5] = "#" + np; W.modifie(id, ea); }
  }
  // Objets dont la géométrie dépend des placements modifiés (eux-mêmes, et ce qui est placé par rapport à eux)
  function touches(m, pls){
    var I = IFC.index(m), out = [];
    if (!pls.size) return out;
    I.produits.forEach(function(id){ if (chaine(m, placementDe(m, id)).some(function(p){ return pls.has(p); })) out.push(id); });
    return out;
  }

  // ================= Déplacer, tourner =================
  // T : matrice monde (translation, rotation) appliquée aux objets ids. Un objet placé par rapport à un autre
  // objet transformé (ouverture dans son mur, pièce d'un assemblage) le suit sans être transformé deux fois.
  function transformer(m, ids, T){
    var W = Ecrivain(m), I = IFC.index(m), usage = usagesPlacements(m), pls = new Map(), ignores = 0;
    ids.forEach(function(id){
      var p = placementDe(m, id);
      if (!I.estProduit.has(id) || !estLocal(m, p) || IFC.infos(m, id).genre === "spatial"){ ignores++; return; }
      pls.set(id, p);
    });
    var dePl = new Set(pls.values()), modifies = new Set(), nb = 0;
    pls.forEach(function(p, id){
      if (chaine(m, parentPl(m, p)).some(function(x){ return dePl.has(x); })){ nb++; return; }
      poser(W, m, usage, id, mul(T, monde(m, p)), parentPl(m, p));
      modifies.add(p); nb++;
    });
    var ids2 = touches(m, modifies);
    return { changement: W.fin(), ids: ids2, nb: nb, ignores: ignores };
  }

  // ================= Copier =================
  var RELS_LISTE = { IFCRELCONTAINEDINSPATIALSTRUCTURE: 4, IFCRELDEFINESBYPROPERTIES: 4, IFCRELDEFINESBYTYPE: 4,
    IFCRELASSOCIATESMATERIAL: 4, IFCRELASSOCIATESCLASSIFICATION: 4, IFCRELASSOCIATESDOCUMENT: 4, IFCRELASSIGNSTOGROUP: 4 };
  function ajouterALaListe(W, rel, k, ids){
    var a = W.args(rel), s = a[k] || "()";
    if (s === "$" || s === "()") a[k] = listeIds(ids);
    else a[k] = s.slice(0, -1) + "," + ids.map(function(i){ return "#" + i; }).join(",") + ")";
    W.modifie(rel, a);
  }
  function oterDeLaListe(W, rel, k, ids){
    var a = W.args(rel), garde = L(C(W.ent(rel))[k]).filter(function(i){ return ids.indexOf(i) < 0; });
    if (!garde.length){ W.retire(rel); return; }
    a[k] = listeIds(garde);
    W.modifie(rel, a);
  }
  // Copies (n fois, la k-ième transformée par T^k) des objets ids, avec leurs ouvertures et le contenu de leurs
  // assemblages ; les copies reçoivent un GlobalId neuf, gardent forme, matériau, type, propriétés et étage.
  function copier(m, ids, T, n){
    var W = Ecrivain(m), I = IFC.index(m), tous = new Set(), pile = [];
    function mettre(id){ if (tous.has(id) || !I.estProduit.has(id) || IFC.infos(m, id).genre === "spatial") return; tous.add(id); pile.push(id); }
    ids.forEach(mettre);
    while (pile.length){
      var x = pile.pop();
      (I.enfants.get(x) || []).forEach(mettre);
      (I.ouvertures.get(x) || []).forEach(mettre);
    }
    var ordre = Array.from(tous).sort(function(a, b){ return chaine(m, placementDe(m, a)).length - chaine(m, placementDe(m, b)).length; });
    // relations où figurent les originaux
    var liees = new Map();
    function lier(id, r){ var l = liees.get(id); if (!l) liees.set(id, l = []); l.push(r); }
    m.ent.forEach(function(e){
      var t = e.type;
      if (t.lastIndexOf("IFCREL", 0) !== 0) return;
      var a = C(e);
      if (RELS_LISTE[t] !== undefined) L(a[RELS_LISTE[t]]).forEach(function(o){ if (tous.has(o)) lier(o, { rel: e.id, k: RELS_LISTE[t] }); });
      else if (t === "IFCRELAGGREGATES" || t === "IFCRELNESTS") L(a[5]).forEach(function(o){ if (tous.has(o)) lier(o, { rel: e.id, k: 5, parent: R(a[4]) }); });
      else if (t === "IFCRELVOIDSELEMENT"){ var o = R(a[5]); if (tous.has(o)) lier(o, { rel: e.id, hote: R(a[4]) }); }
    });
    var ajouts = new Map(), copies = [], Tk = ID;
    function ajout(rel, k, id){ var c = ajouts.get(rel); if (!c) ajouts.set(rel, c = { k: k, ids: [] }); c.ids.push(id); }
    for (var k = 1; k <= n; k++){
      Tk = mul(T, Tk);
      var neuf = new Map(), plNeuf = new Map(), agreg = new Map();
      ordre.forEach(function(o){
        var e = m.ent.get(o);
        if (!e || e.type === "(COMPLEXE)") return;
        var a = IFC.bruts(e).slice(), p = placementDe(m, o);
        a[0] = guid();
        if (estLocal(m, p)){
          var par = parentPl(m, p), np;
          if (plNeuf.has(par)) np = W.cree("IFCLOCALPLACEMENT", ["#" + plNeuf.get(par), IFC.bruts(m.ent.get(p))[1]]);
          else np = W.cree("IFCLOCALPLACEMENT", [par ? "#" + par : "$", "#" + ecrireAxe(W, mul(inverse(monde(m, par)), mul(Tk, monde(m, p))))]);
          plNeuf.set(p, np);
          a[5] = "#" + np;
        }
        var pds = R(C(e)[6]);
        if (pds && m.ent.get(pds)) a[6] = "#" + W.cree(m.ent.get(pds).type, IFC.bruts(m.ent.get(pds)).slice());
        var c = W.cree(e.type, a);
        neuf.set(o, c); copies.push(c);
      });
      ordre.forEach(function(o){
        var c = neuf.get(o);
        if (!c) return;
        (liees.get(o) || []).forEach(function(l){
          if (l.hote !== undefined){
            if (!neuf.has(l.hote)) return;
            var va = IFC.bruts(m.ent.get(l.rel)).slice();
            va[0] = guid(); va[4] = "#" + neuf.get(l.hote); va[5] = "#" + c;
            W.cree("IFCRELVOIDSELEMENT", va);
          }
          else if (l.parent !== undefined && neuf.has(l.parent)){
            var g = agreg.get(l.rel + ":" + l.parent);
            if (!g) agreg.set(l.rel + ":" + l.parent, g = { rel: l.rel, parent: neuf.get(l.parent), ids: [] });
            g.ids.push(c);
          }
          else ajout(l.rel, l.k, c);
        });
      });
      agreg.forEach(function(g){
        var ga = IFC.bruts(m.ent.get(g.rel)).slice();
        ga[0] = guid(); ga[4] = "#" + g.parent; ga[5] = listeIds(g.ids);
        W.cree(m.ent.get(g.rel).type, ga);
      });
    }
    ajouts.forEach(function(c, rel){ ajouterALaListe(W, rel, c.k, c.ids); });
    var premiers = ids.filter(function(id){ return tous.has(id); }).length;
    return { changement: W.fin(), ids: [], copies: copies, nb: premiers*n, nbAvecContenu: tous.size*n };
  }

  // ================= Étages =================
  function etages(m){
    var I = IFC.index(m), out = [];
    I.produits.forEach(function(id){
      var e = m.ent.get(id);
      if (e.type !== "IFCBUILDINGSTOREY") return;
      var a = C(e), z = monde(m, R(a[5]))[11], el = N(a[9]);
      out.push({ id: id, nom: IFC.chaine(a[2]) || IFC.chaine(a[7]) || "Étage #" + id, z: z, elevation: isFinite(el) ? el : null });
    });
    return out.sort(function(x, y){ return (x.elevation != null ? x.elevation : x.z) - (y.elevation != null ? y.elevation : y.z); });
  }
  function altitude(m, id){
    var e = m.ent.get(id), a = C(e), el = N(a[9]);
    return { z: monde(m, R(a[5]))[11], el: isFinite(el) ? el : null };
  }
  // Objets ids rattachés à l'étage cible. suivre : décalés en hauteur de la différence d'altitude des étages ;
  // sinon ils gardent leur position. Leur placement passe sous celui du nouvel étage s'il dépendait de l'ancien.
  function changerEtage(m, ids, cible, suivre){
    var W = Ecrivain(m), I = IFC.index(m), usage = usagesPlacements(m), plC = placementDe(m, cible);
    var relDe = new Map(), relCible = 0, modifies = new Set(), nb = 0, ignores = 0, oter = new Map();
    m.ent.forEach(function(e){
      if (e.type !== "IFCRELCONTAINEDINSPATIALSTRUCTURE") return;
      var a = C(e);
      if (R(a[5]) === cible && !relCible) relCible = e.id;
      L(a[4]).forEach(function(o){ relDe.set(o, e.id); });
    });
    var aC = altitude(m, cible), ajout = [];
    ids.forEach(function(id){
      var old = I.conteneur.get(id), rel = relDe.get(id);
      if (!old || !rel || IFC.infos(m, id).genre === "spatial"){ ignores++; return; }
      if (old === cible){ nb++; return; }
      var l = oter.get(rel); if (!l) oter.set(rel, l = []); l.push(id);
      ajout.push(id);
      var p = placementDe(m, id);
      if (estLocal(m, p)){
        var dz = 0;
        if (suivre && m.ent.get(old) && m.ent.get(old).type === "IFCBUILDINGSTOREY"){
          var aO = altitude(m, old);
          dz = aC.z - aO.z;
          if (Math.abs(dz) < 1e-9 && aC.el != null && aO.el != null) dz = aC.el - aO.el;
        }
        var plO = placementDe(m, old), parent = parentPl(m, p), reparente = plO && parent === plO && plC;
        if (dz || reparente){
          poser(W, m, usage, id, mul(translation([0, 0, dz]), monde(m, p)), reparente ? plC : parent);
          modifies.add(p);
        }
      }
      nb++;
    });
    oter.forEach(function(l, rel){ oterDeLaListe(W, rel, 4, l); });
    if (ajout.length){
      if (relCible && !W.ent(relCible)) relCible = 0;
      if (relCible) ajouterALaListe(W, relCible, 4, ajout);
      else {
        var modele = m.ent.get(relDe.get(ajout[0])), oh = modele ? IFC.bruts(modele)[1] : "$";
        W.cree("IFCRELCONTAINEDINSPATIALSTRUCTURE", [guid(), oh, "$", "$", listeIds(ajout), "#" + cible]);
      }
    }
    return { changement: W.fin(), ids: touches(m, modifies), nb: nb, ignores: ignores };
  }

  // ================= Dimensions des extrusions =================
  // Paramètres de profil modifiables : position dans les arguments → libellé
  var PROFILS = {
    IFCRECTANGLEPROFILEDEF: [[3, "Largeur (X)"], [4, "Hauteur (Y)"]],
    IFCROUNDEDRECTANGLEPROFILEDEF: [[3, "Largeur (X)"], [4, "Hauteur (Y)"]],
    IFCRECTANGLEHOLLOWPROFILEDEF: [[3, "Largeur (X)"], [4, "Hauteur (Y)"], [5, "Épaisseur de paroi"]],
    IFCCIRCLEPROFILEDEF: [[3, "Rayon"]],
    IFCCIRCLEHOLLOWPROFILEDEF: [[3, "Rayon"], [4, "Épaisseur de paroi"]],
    IFCISHAPEPROFILEDEF: [[3, "Largeur"], [4, "Hauteur"], [5, "Épaisseur d'âme"], [6, "Épaisseur d'aile"]],
    IFCTSHAPEPROFILEDEF: [[3, "Hauteur"], [4, "Largeur d'aile"], [5, "Épaisseur d'âme"], [6, "Épaisseur d'aile"]],
    IFCUSHAPEPROFILEDEF: [[3, "Hauteur"], [4, "Largeur d'aile"], [5, "Épaisseur d'âme"], [6, "Épaisseur d'aile"]],
    IFCLSHAPEPROFILEDEF: [[3, "Hauteur"], [4, "Largeur"], [5, "Épaisseur"]],
    IFCCSHAPEPROFILEDEF: [[3, "Hauteur"], [4, "Largeur"], [5, "Épaisseur de paroi"], [6, "Retour"]],
    IFCZSHAPEPROFILEDEF: [[3, "Hauteur"], [4, "Largeur d'aile"], [5, "Épaisseur d'âme"], [6, "Épaisseur d'aile"]],
    IFCELLIPSEPROFILEDEF: [[3, "Demi-axe 1"], [4, "Demi-axe 2"]]
  };
  var NOMS_PROFILS = { IFCRECTANGLEPROFILEDEF: "rectangle", IFCROUNDEDRECTANGLEPROFILEDEF: "rectangle arrondi", IFCRECTANGLEHOLLOWPROFILEDEF: "tube rectangulaire",
    IFCCIRCLEPROFILEDEF: "cercle", IFCCIRCLEHOLLOWPROFILEDEF: "tube rond", IFCISHAPEPROFILEDEF: "profil en I", IFCTSHAPEPROFILEDEF: "profil en T",
    IFCUSHAPEPROFILEDEF: "profil en U", IFCLSHAPEPROFILEDEF: "cornière", IFCCSHAPEPROFILEDEF: "profil en C", IFCZSHAPEPROFILEDEF: "profil en Z",
    IFCELLIPSEPROFILEDEF: "ellipse", IFCARBITRARYCLOSEDPROFILEDEF: "contour", IFCARBITRARYPROFILEDEFWITHVOIDS: "contour avec vides" };
  // Solides extrudés du corps de l'objet : [{ chemin : ids de la forme au solide, solide, profondeur, profil, params }]
  function extrusions(m, id){
    var e = m.ent.get(id), out = [];
    if (!e) return out;
    var pds = R(C(e)[6]), pe = pds && m.ent.get(pds);
    if (!pe) return out;
    function items(rep, chemin, prof){
      var re = m.ent.get(rep);
      if (!re || prof > 6) return;
      L(C(re)[3]).forEach(function(i){ item(i, chemin.concat(rep), prof); });
    }
    function item(i, chemin, prof){
      var ie = m.ent.get(i);
      if (!ie || prof > 12) return;
      var a = C(ie);
      if (ie.type === "IFCEXTRUDEDAREASOLID"){
        var pr = m.ent.get(R(a[0])), params = [];
        if (pr && PROFILS[pr.type]){ var pa = C(pr); PROFILS[pr.type].forEach(function(x){ var v = N(pa[x[0]]); if (isFinite(v)) params.push({ k: x[0], nom: x[1], v: v }); }); }
        out.push({ chemin: chemin.concat(i), solide: i, profondeur: N(a[3]), profil: pr ? pr.id : 0, typeProfil: pr ? NOMS_PROFILS[pr.type] || IFC.nomType(pr.type) : "", params: params });
      }
      else if (ie.type === "IFCMAPPEDITEM"){
        var src = R(a[0]), se = m.ent.get(src);
        if (se) items(R(C(se)[1]), chemin.concat(i, src), prof + 1);
      }
      else if (ie.type === "IFCBOOLEANCLIPPINGRESULT" || ie.type === "IFCBOOLEANRESULT") item(R(a[1]), chemin.concat(i), prof + 1);
    }
    L(C(pe)[2]).forEach(function(rep){
      var re = m.ent.get(rep), ra = re && C(re), ident = ra ? IFC.chaine(ra[1]) : "";
      if (!re || (ident && !/^(Body|Facetation)$/i.test(ident))) return;
      items(rep, [pds], 0);
    });
    return out;
  }
  // Nouvelle profondeur (prof, ou null) et paramètres de profil ({ k: valeur }) de la n-ième extrusion de chaque
  // objet ; ce qui est partagé avec d'autres objets est copié d'abord.
  function dimensionner(m, ids, n, prof, params){
    var W = Ecrivain(m), faits = [], ignores = 0, liste = [];
    ids.forEach(function(id){ var x = extrusions(m, id)[n]; if (x) liste.push({ id: id, x: x }); else ignores++; });
    var tous = new Set();
    liste.forEach(function(l){ l.x.chemin.forEach(function(c){ tous.add(c); }); if (l.x.profil) tous.add(l.x.profil); });
    var compte = compteRefs(m, Array.from(tous));
    liste.forEach(function(l){
      var x = l.x, P = x.chemin.slice(), iSol = P.length - 1, aProfil = params && Object.keys(params).length && x.profil;
      if (aProfil) P.push(x.profil);
      var s = -1;
      for (var i = 0; i < P.length; i++) if ((compte.get(P[i]) || 0) > 1){ s = i; break; }
      var neuf = {}, change = false;
      for (var j = P.length - 1; j >= 0; j--){
        var a = W.args(P[j]), mod = false;
        if (j === iSol && prof != null){ a[3] = reel(prof); mod = true; }
        if (aProfil && j === P.length - 1){ Object.keys(params).forEach(function(k){ a[+k] = reel(params[k]); }); mod = true; }
        if (j + 1 < P.length && neuf[P[j + 1]]){ a = remplacerRef(a, P[j + 1], neuf[P[j + 1]]); mod = true; }
        if (s >= 0 && j >= s) neuf[P[j]] = W.cree(W.ent(P[j]).type, a);
        else if (mod) W.modifie(P[j], a);
        if (mod) change = true;
      }
      if (s === 0){ var ea = W.args(l.id); ea[6] = "#" + neuf[P[0]]; W.modifie(l.id, ea); }
      if (change) faits.push(l.id);
    });
    return { changement: W.fin(), ids: faits, nb: faits.length, ignores: ignores };
  }

  // ================= Attributs =================
  // valeurs : { 2: nom, 3: description, 4: type d'objet, 7: repère } ; "" efface, undefined ne change rien
  function attributs(m, ids, valeurs){
    var W = Ecrivain(m), nb = 0;
    ids.forEach(function(id){
      var e = m.ent.get(id);
      if (!e) return;
      var a = W.args(id), g = IFC.infos(m, id).genre, mod = false;
      Object.keys(valeurs).forEach(function(k){
        var v = valeurs[k];
        if (v === undefined || v === null) return;
        k = +k;
        if (k === 7 && g === "spatial") return;
        if (k >= a.length) return;
        var t = v === "" ? "$" : texteStep(v);
        if (a[k] !== t){ a[k] = t; mod = true; }
      });
      if (mod){ W.modifie(id, a); nb++; }
    });
    return { changement: W.fin(), ids: [], nb: nb };
  }

  // ================= Propriétés =================
  function texteValeur(v){
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    if (v.str !== undefined) return IFC.decoder(v.str);
    if (v.enu !== undefined) return v.enu === "T" ? "Oui" : v.enu === "F" ? "Non" : v.enu === "U" ? "Inconnu" : v.enu;
    if (v.type) return texteValeur(v.v);
    return "";
  }
  // Propriétés simples des jeux de l'objet lui-même (pas ceux de son type) : [{ jeu, nom, texte, brut }]
  function proprietesEditables(m, id){
    var I = IFC.index(m), out = [];
    (I.psets.get(id) || []).forEach(function(d){
      var pe = m.ent.get(d);
      if (!pe || pe.type !== "IFCPROPERTYSET") return;
      var jeu = IFC.chaine(C(pe)[2]);
      L(C(pe)[4]).forEach(function(q){
        var qe = m.ent.get(q);
        if (!qe || qe.type !== "IFCPROPERTYSINGLEVALUE") return;
        var a = C(qe);
        out.push({ jeu: jeu, nom: IFC.chaine(a[0]), texte: texteValeur(a[2]), brut: IFC.bruts(qe)[2] || "$" });
      });
    });
    return out;
  }
  var CHAINES = /^IFC(LABEL|TEXT|IDENTIFIER|DESCRIPTIVEMEASURE|URIREFERENCE|DATE|DATETIME|TIME|DURATION|TIMESTAMP)$/;
  // Valeur saisie → valeur STEP du même type que l'ancienne ; null si elle ne convient pas
  function valeurStep(brut, texte){
    texte = String(texte).trim();
    if (texte === "") return "$";
    var p = brut.indexOf("("), type = p > 0 ? brut.slice(0, p).trim().toUpperCase() : "", dedans = p > 0 ? brut.slice(p + 1, brut.lastIndexOf(")")).trim() : brut;
    if (!type) return "IFCLABEL(" + texteStep(texte) + ")";
    var c = dedans.charAt(0);
    if (c === "'" || CHAINES.test(type)) return type + "(" + texteStep(texte) + ")";
    if (c === "."){
      var t = texte.toLowerCase();
      if (/^(oui|vrai|true|t|1|yes|x)$/.test(t)) return type + "(.T.)";
      if (/^(non|faux|false|f|0|no)$/.test(t)) return type + "(.F.)";
      if (/^(inconnu|unknown|u|\?)$/.test(t) && type === "IFCLOGICAL") return type + "(.U.)";
      if (/^[a-z_][a-z0-9_]*$/i.test(texte) && type !== "IFCBOOLEAN" && type !== "IFCLOGICAL") return type + "(." + texte.toUpperCase() + ".)";
      return null;
    }
    var x = parseFloat(texte.replace(/\s|'/g, "").replace(",", "."));
    if (!isFinite(x)) return null;
    if (/INTEGER|COUNTMEASURE/.test(type) && dedans.indexOf(".") < 0) return type + "(" + Math.round(x) + ")";
    return type + "(" + reel(x) + ")";
  }
  // Valeur texte de la propriété « nom » du jeu « jeu » pour les objets ids ; les jeux partagés avec des objets
  // non visés sont copiés pour ceux-ci.
  function propriete(m, ids, jeu, nom, texte){
    var W = Ecrivain(m), I = IFC.index(m), groupes = new Map(), ignores = 0, refuse = 0;
    ids.forEach(function(id){
      var trouve = 0;
      (I.psets.get(id) || []).some(function(d){
        var pe = m.ent.get(d);
        if (!pe || pe.type !== "IFCPROPERTYSET" || IFC.chaine(C(pe)[2]) !== jeu) return false;
        var q = L(C(pe)[4]).filter(function(q){ var qe = m.ent.get(q); return qe && qe.type === "IFCPROPERTYSINGLEVALUE" && IFC.chaine(C(qe)[0]) === nom; })[0];
        if (!q) return false;
        trouve = d;
        var g = groupes.get(d); if (!g) groupes.set(d, g = { q: q, ids: [] }); g.ids.push(id);
        return true;
      });
      if (!trouve) ignores++;
    });
    if (!groupes.size) return { changement: null, ids: [], nb: 0, ignores: ignores };
    var rels = new Map();         // jeu → relations qui le portent
    m.ent.forEach(function(e){
      if (e.type !== "IFCRELDEFINESBYPROPERTIES") return;
      var d = R(C(e)[5]);
      if (groupes.has(d)){ var l = rels.get(d); if (!l) rels.set(d, l = []); l.push(e.id); }
    });
    var qs = []; groupes.forEach(function(g){ qs.push(g.q); });
    var compte = compteRefs(m, qs), nb = 0, oter = new Map();
    groupes.forEach(function(g, d){
      var qe = m.ent.get(g.q), qa = IFC.bruts(qe).slice(), v = valeurStep(qa[2] || "$", texte);
      if (v === null){ refuse += g.ids.length; return; }
      if (qa[2] === v) { nb += g.ids.length; return; }
      qa[2] = v;
      var users = new Set();
      (rels.get(d) || []).forEach(function(r){ L(C(m.ent.get(r))[4]).forEach(function(o){ users.add(o); }); });
      var cibles = new Set(g.ids), seul = Array.from(users).every(function(o){ return cibles.has(o); });
      if (seul){
        if ((compte.get(g.q) || 0) <= 1) W.modifie(g.q, qa);
        else { var nq = W.cree(qe.type, qa); W.modifie(d, remplacerRef(W.args(d), g.q, nq)); }
      } else {
        var nq2 = W.cree(qe.type, qa), pa = remplacerRef(IFC.bruts(m.ent.get(d)).slice(), g.q, nq2);
        pa[0] = guid();
        var np = W.cree("IFCPROPERTYSET", pa), r0 = (rels.get(d) || [])[0], oh = r0 ? IFC.bruts(m.ent.get(r0))[1] : "$";
        W.cree("IFCRELDEFINESBYPROPERTIES", [guid(), oh, "$", "$", listeIds(g.ids), "#" + np]);
        (rels.get(d) || []).forEach(function(r){
          var dedans = L(C(m.ent.get(r))[4]).filter(function(o){ return cibles.has(o); });
          if (!dedans.length) return;
          var l = oter.get(r); if (!l) oter.set(r, l = []);
          dedans.forEach(function(o){ if (l.indexOf(o) < 0) l.push(o); });
        });
      }
      nb += g.ids.length;
    });
    oter.forEach(function(l, r){ oterDeLaListe(W, r, 4, l); });
    return { changement: W.fin(), ids: [], nb: nb, ignores: ignores, refuse: refuse };
  }

  // ================= Classe IFC =================
  // Classes proposées : nombre d'arguments et valeur du dernier (type prédéfini) selon le schéma
  var CLASSES = {
    IFCWALL: ["Mur", 8, 9], IFCSLAB: ["Dalle", 9, 9], IFCBEAM: ["Poutre", 8, 9], IFCCOLUMN: ["Poteau", 8, 9],
    IFCMEMBER: ["Barre (ossature)", 8, 9], IFCPLATE: ["Plaque", 8, 9], IFCFOOTING: ["Semelle", 9, 9],
    IFCCOVERING: ["Revêtement", 9, 9], IFCRAILING: ["Garde-corps", 9, 9], IFCROOF: ["Toiture", 9, 9],
    IFCSTAIR: ["Escalier", 9, 9], IFCRAMP: ["Rampe", 9, 9], IFCCURTAINWALL: ["Mur-rideau", 8, 9],
    IFCBUILDINGELEMENTPROXY: ["Élément générique (proxy)", 9, 9]
  };
  // types prédéfinis obligatoires en IFC2X3
  var OBLIGATOIRE_2X3 = { IFCFOOTING: 1, IFCROOF: 1, IFCSTAIR: 1, IFCRAMP: 1 };
  function changerClasse(m, ids, cible){
    var W = Ecrivain(m), def = CLASSES[cible], ifc4 = !/^IFC2X3/i.test(m.schema), nb = 0, ignores = 0;
    if (!def) return { changement: null, ids: [], nb: 0, ignores: ids.length };
    var n = ifc4 ? def[2] : def[1];
    ids.forEach(function(id){
      var e = m.ent.get(id), i = e && IFC.infos(m, id);
      if (!e || !i || i.genre !== "element" || e.type === cible){ ignores++; return; }
      var a = IFC.bruts(e).slice(0, 8);
      if (a.length < 8){ ignores++; return; }
      if (n > 8) a.push(ifc4 || OBLIGATOIRE_2X3[cible] ? ".NOTDEFINED." : "$");
      W.retype(id, cible, a);
      nb++;
    });
    return { changement: W.fin(), ids: [], nb: nb, ignores: ignores };
  }

  global.IFCEdition = {
    transformer: transformer, copier: copier, changerEtage: changerEtage, etages: etages,
    extrusions: extrusions, dimensionner: dimensionner, attributs: attributs,
    proprietesEditables: proprietesEditables, propriete: propriete, valeurStep: valeurStep,
    changerClasse: changerClasse, CLASSES: CLASSES,
    translation: translation, rotationZ: rotationZ, mul: mul, monde: monde
  };
})(typeof window !== "undefined" ? window : self);
