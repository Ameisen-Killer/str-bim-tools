// Copie de /ifc/ifc-core.js pour /fgh/ (validation des réservations), sans changement.
// Noyau IFC de /ifc/ : lecture STEP (ISO 10303-21), index des éléments, suppression propre, export.
// Aussi chargé par le Web Worker ifc-lecteur.js (lecture en arrière-plan) : rien ici ne touche à la page.
// - Le fichier est lu octet par octet (un caractère = un octet) : tout ce qui n'est pas touché
//   ressort à l'identique à l'export, accents compris, quel que soit l'encodage d'origine.
// - Chaque entité est figée (Object.freeze) : { id, type, src (texte d'origine sans le « ; »), refs }.
//   Une suppression produit un « changement » { avant:[entités retirées ou remplacées], apres:[nouvelles
//   versions] } que l'historique rejoue dans les deux sens. Les ids d'origine sont gardés.
// - Aucune expression régulière sur le fichier entier : la lecture avance caractère par caractère
//   (chaînes '…' avec apostrophes doublées, commentaires /* */, entités sur plusieurs lignes).
(function(global){
  "use strict";

  var GEL = Object.freeze;

  function erreur(msg){ var e = new Error(msg); e.ifc = true; return e; }

  // ================= Octets <-> texte =================
  function versTexte(octets){
    var parts = [], PAS = 0x8000;
    for (var i = 0; i < octets.length; i += PAS) parts.push(String.fromCharCode.apply(null, octets.subarray(i, i + PAS)));
    return parts.join("");
  }
  function versOctets(s){
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return u;
  }

  // ================= Découpage en instructions =================
  // Appelle traiter(texte, début, fin, pur) pour chaque instruction terminée par « ; » hors chaîne et hors
  // commentaire ; pur = sans commentaire, le texte est alors txt[début..fin[ débarrassé de ses blancs.
  // progres(fraction) est appelé de temps en temps sur les gros fichiers.
  function instructions(txt, traiter, progres){
    var n = txt.length, i = 0, deb = 0, morceaux = [], c, f, prochain = 4e6;
    while (i < n){
      if (progres && i >= prochain){ progres(i/n); prochain = i + 4e6; }
      c = txt.charCodeAt(i);
      if (c === 39){                                   // ' : chaîne, '' = apostrophe échappée
        i++;
        for (;;){
          if (i >= n) throw erreur("Fichier illisible : une chaîne de caractères n'est jamais refermée (apostrophe manquante).");
          if (txt.charCodeAt(i) === 39){
            if (txt.charCodeAt(i + 1) === 39){ i += 2; continue; }
            break;
          }
          i++;
        }
        i++; continue;
      }
      if (c === 47 && txt.charCodeAt(i + 1) === 42){   // /* commentaire */
        morceaux.push(txt.slice(deb, i));
        f = txt.indexOf("*/", i + 2);
        if (f < 0) throw erreur("Fichier illisible : un commentaire /* n'est jamais refermé.");
        i = f + 2; deb = i; continue;
      }
      if (c === 59){                                   // ;
        morceaux.push(txt.slice(deb, i));
        var pur = morceaux.length === 1;
        if (traiter((pur ? morceaux[0] : morceaux.join("")).trim(), deb, i, pur) === false) return;
        morceaux = []; i++; deb = i; continue;
      }
      i++;
    }
  }

  // Découpe s[deb..fin[ au niveau supérieur (virgules hors parenthèses et hors chaînes).
  function decouper(s, deb, fin){
    var out = [], prof = 0, d = deb, i = deb, c;
    while (i < fin){
      c = s.charCodeAt(i);
      if (c === 39){
        i++;
        while (i < fin){
          if (s.charCodeAt(i) === 39){ if (s.charCodeAt(i + 1) === 39){ i += 2; continue; } break; }
          i++;
        }
        i++; continue;
      }
      if (c === 40) prof++;
      else if (c === 41) prof--;
      else if (c === 44 && prof === 0){ out.push(s.slice(d, i).trim()); d = i + 1; }
      i++;
    }
    var dernier = s.slice(d, fin).trim();
    if (dernier !== "" || out.length) out.push(dernier);
    return out;
  }

  // Références #n hors chaînes, à partir de la position deb (doublons gardés).
  function lireRefs(s, deb){
    var out = [], n = s.length, i = deb, c, v;
    while (i < n){
      c = s.charCodeAt(i);
      if (c === 39){
        i++;
        while (i < n){
          if (s.charCodeAt(i) === 39){ if (s.charCodeAt(i + 1) === 39){ i += 2; continue; } break; }
          i++;
        }
        i++; continue;
      }
      if (c === 35){
        i++; v = 0;
        while (i < n){ c = s.charCodeAt(i); if (c < 48 || c > 57) break; v = v*10 + (c - 48); i++; }
        if (v > 0) out.push(v);
        continue;
      }
      i++;
    }
    return out;
  }

  // ================= Entités =================
  function debutArgs(src){ return src.indexOf("(", src.indexOf("=") + 1) + 1; }

  function lireEntite(s){
    var eq = s.indexOf("=");
    var id = eq > 1 ? parseInt(s.slice(1, eq), 10) : NaN;
    if (!(id > 0)) throw erreur("Entité illisible dans la section DATA : « " + s.slice(0, 60) + " ».");
    var i = eq + 1, n = s.length;
    while (i < n && s.charCodeAt(i) <= 32) i++;
    var p = s.indexOf("(", i);
    if (p < 0 || s.charCodeAt(n - 1) !== 41) throw erreur("Entité #" + id + " incomplète : parenthèses mal fermées.");
    var type = s.slice(i, p).trim().toUpperCase() || "(COMPLEXE)";
    return GEL({ id: id, type: type, src: s, refs: GEL(lireRefs(s, p)) });
  }

  // Nouvelle version d'une entité avec d'autres arguments (même id, même début de ligne).
  function refaire(e, args){
    var d = debutArgs(e.src);
    var src = e.src.slice(0, d) + args.join(",") + ")";
    return GEL({ id: e.id, type: e.type, src: src, refs: GEL(lireRefs(src, d - 1)) });
  }

  // Arguments bruts (texte) et lus (valeurs), mis en cache par entité.
  var cacheBruts = new WeakMap(), cacheChamps = new WeakMap();
  function bruts(e){
    var a = cacheBruts.get(e);
    if (!a){ a = decouper(e.src, debutArgs(e.src), e.src.lastIndexOf(")")); cacheBruts.set(e, a); }
    return a;
  }
  function champs(e){
    var a = cacheChamps.get(e);
    if (!a){ a = bruts(e).map(valeur); cacheChamps.set(e, a); }
    return a;
  }

  // Valeur STEP : #n -> {ref}, 'x' -> {str}, .X. -> {enu}, (…) -> tableau, TYPE(x) -> {type, v},
  // nombre -> number, $ et * -> null.
  function valeur(r){
    if (r === "") return null;
    var c = r.charCodeAt(0);
    if (c === 35) return { ref: parseInt(r.slice(1), 10) };
    if (c === 36 || c === 42) return null;
    if (c === 39) return { str: r.slice(1, -1).replace(/''/g, "'") };
    if (c === 46) return { enu: r.slice(1, -1).toUpperCase() };
    if (c === 40) return decouper(r, 1, r.length - 1).map(valeur);
    if (c === 34) return { bin: r.slice(1, -1) };
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)){
      var p = r.indexOf("(");
      if (p > 0) return { type: r.slice(0, p).trim().toUpperCase(), v: valeur(r.slice(p + 1, r.lastIndexOf(")")).trim()) };
      return { brut: r };
    }
    var x = parseFloat(r);
    return isNaN(x) ? { brut: r } : x;
  }

  function idRef(v){ return v && v.ref ? v.ref : 0; }
  function refsListe(v){
    var out = [];
    if (Array.isArray(v)) v.forEach(function(x){ if (x && x.ref) out.push(x.ref); });
    else if (v && v.ref) out.push(v.ref);
    return out;
  }
  function toutesRefs(v, out){
    out = out || [];
    if (!v) return out;
    if (v.ref) out.push(v.ref);
    else if (Array.isArray(v)) v.forEach(function(x){ toutesRefs(x, out); });
    else if (v.type) toutesRefs(v.v, out);
    return out;
  }
  function nombre(v){
    if (typeof v === "number") return v;
    if (v && v.type) return nombre(v.v);
    return NaN;
  }

  // Texte d'une chaîne IFC pour l'affichage : \X2\…\X0\, \X\hh, \S\c, et UTF-8 brut (exports non conformes).
  function decoder(s){
    if (!s) return "";
    if (s.indexOf("\\") >= 0){
      s = s.replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gi, function(m, h){
        var o = ""; for (var i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o;
      }).replace(/\\X4\\((?:[0-9A-F]{8})+)\\X0\\/gi, function(m, h){
        var o = ""; for (var i = 0; i < h.length; i += 8){ try { o += String.fromCodePoint(parseInt(h.substr(i, 8), 16)); } catch(e){} } return o;
      }).replace(/\\X\\([0-9A-F]{2})/gi, function(m, h){
        return String.fromCharCode(parseInt(h, 16));
      }).replace(/\\S\\(.)/g, function(m, c){
        return String.fromCharCode(c.charCodeAt(0) + 128);
      }).replace(/\\P[A-I]\\/g, "").replace(/\\\\/g, "\\");
    }
    if (/[\x80-\xff]/.test(s)){ try { s = decodeURIComponent(escape(s)); } catch(e){} }
    return s;
  }
  function chaine(v){
    if (!v) return "";
    if (v.str !== undefined) return decoder(v.str);
    if (v.type && v.v && v.v.str !== undefined) return decoder(v.v.str);
    return "";
  }

  // ================= Lecture d'un fichier =================
  var SCHEMAS_OK = /^(IFC2X3(_TC1|_FINAL)?|IFC4(_ADD1|_ADD2|_ADD2_TC1)?)$/;

  // Les blancs que trim() retire, pour les caractères 0–255 (le fichier est lu octet = caractère)
  function blanc(c){ return c === 32 || (c >= 9 && c <= 13) || c === 160; }

  // Première étape de la lecture, faisable dans un Web Worker (ifc-lecteur.js) : contrôle du fichier et
  // découpage des entités sous une forme compacte (tableaux typés, positions dans le texte) qui passe
  // d'un fil à l'autre sans copie. Le texte complet est rendu à part (r.txt), il ne voyage pas.
  function analyser(octets, progres){
    if (octets.length < 20) throw erreur("Le fichier est vide ou tronqué.");
    if (octets[0] === 0x50 && octets[1] === 0x4B) throw erreur("Ce fichier est compressé (.ifczip ou .zip). Décompresse-le d'abord, puis ouvre le .ifc qu'il contient.");
    var txt = versTexte(octets);
    var debut = txt.slice(0, 4000);
    if (/^\s*<\?xml/.test(debut) || /<ifcXML|iso_10303_28/i.test(debut)) throw erreur("Ce fichier est un ifcXML : seul le format texte .ifc (STEP) est pris en charge.");
    if (debut.indexOf("ISO-10303-21") < 0) throw erreur("Ce fichier n'est pas un IFC valide : la ligne d'ouverture « ISO-10303-21; » est absente.");

    // tableaux qui grandissent par doublement
    var cap = 1024, nb = 0, ids = new Int32Array(cap), deb = new Int32Array(cap), fin = new Int32Array(cap), typ = new Int32Array(cap), rdeb = new Int32Array(cap + 1);
    var rcap = 4096, nr = 0, refs = new Int32Array(rcap);
    var types = [], typeNum = new Map(), speciaux = {}, vus = new Set();
    function agrandir(t, n){ var u = new t.constructor(n); u.set(t); return u; }

    var etat = 0, entetes = [], dataDecl = "DATA", maxId = 0, doublons = 0;
    instructions(txt, function(s, d, f, pur){
      if (etat === 3){
        if (s.charCodeAt(0) === 35){
          var e = lireEntite(s);
          if (vus.has(e.id)){ doublons++; return; }
          vus.add(e.id);
          if (nb === cap){
            cap *= 2;
            ids = agrandir(ids, cap); deb = agrandir(deb, cap); fin = agrandir(fin, cap); typ = agrandir(typ, cap); rdeb = agrandir(rdeb, cap + 1);
          }
          if (pur){ while (blanc(txt.charCodeAt(d))) d++; while (blanc(txt.charCodeAt(f - 1))) f--; }
          if (!pur || f - d !== s.length){ speciaux[nb] = s; d = f = -1; }
          var t = typeNum.get(e.type);
          if (t === undefined){ t = types.length; types.push(e.type); typeNum.set(e.type, t); }
          ids[nb] = e.id; deb[nb] = d; fin[nb] = f; typ[nb] = t; rdeb[nb] = nr;
          if (nr + e.refs.length > rcap){ while (nr + e.refs.length > rcap) rcap *= 2; refs = agrandir(refs, rcap); }
          for (var k = 0; k < e.refs.length; k++) refs[nr++] = e.refs[k];
          nb++;
          if (e.id > maxId) maxId = e.id;
          return;
        }
        if (s === "ENDSEC"){ etat = 4; return; }
        if (s === "") return;
        throw erreur("Ligne inattendue dans la section DATA : « " + s.slice(0, 60) + " ».");
      }
      if (etat === 0){
        if (s.indexOf("ISO-10303-21") < 0) throw erreur("Ce fichier n'est pas un IFC valide : il doit commencer par « ISO-10303-21; ».");
        etat = 1; return;
      }
      if (etat === 1){
        if (s === "HEADER"){ etat = 2; return; }
        throw erreur("Ce fichier n'est pas un IFC valide : la section HEADER est absente.");
      }
      if (etat === 2){
        if (s === "ENDSEC"){ etat = 25; return; }
        entetes.push(s); return;
      }
      if (etat === 25 || etat === 4){
        if (/^DATA\b/.test(s)){ if (etat === 25) dataDecl = s; etat = 3; return; }
        if (s === "END-ISO-10303-21"){ etat = 5; return false; }
        if (etat === 25) throw erreur("Ce fichier n'est pas un IFC valide : la section DATA est absente.");
        return;
      }
    }, progres);
    if (etat < 3) throw erreur("Ce fichier n'est pas un IFC valide : la section DATA est absente.");
    if (etat === 3) throw erreur("Fichier tronqué : la section DATA ne se termine pas (ENDSEC manquant). Le téléchargement ou l'export a peut-être été interrompu.");
    if (!nb) throw erreur("Le fichier ne contient aucune entité.");

    var schema = "";
    entetes.forEach(function(h){
      if (/^FILE_SCHEMA\s*\(/i.test(h)){
        var s = toutesChaines(valeur(h.slice(h.indexOf("("))));
        if (s.length) schema = s[0].toUpperCase().trim();
      }
    });
    if (!schema) throw erreur("Schéma introuvable : l'en-tête ne contient pas de FILE_SCHEMA.");
    if (!SCHEMAS_OK.test(schema)) throw erreur("Schéma « " + schema + " » non pris en charge : l'outil lit les fichiers IFC2X3 et IFC4.");
    rdeb[nb] = nr;

    return {
      txt: txt, taille: octets.length, schema: schema, eol: debut.indexOf("\r\n") >= 0 ? "\r\n" : "\n",
      entetes: entetes, dataDecl: dataDecl, maxId: maxId, doublons: doublons,
      nb: nb, ids: ids.slice(0, nb), deb: deb.slice(0, nb), fin: fin.slice(0, nb), typ: typ.slice(0, nb),
      rdeb: rdeb.slice(0, nb + 1), refs: refs.slice(0, nr), types: types, speciaux: speciaux
    };
  }

  // Deuxième étape : les entités figées, par tranches [k0, k1[ (pour rendre la main entre deux tranches)
  function assembler(r, txt, ent, ordre, k0, k1){
    for (var k = k0; k < k1; k++){
      var a = r.rdeb[k], b = r.rdeb[k + 1], refs = new Array(b - a);
      for (var j = a; j < b; j++) refs[j - a] = r.refs[j];
      var src = r.deb[k] < 0 ? r.speciaux[k] : txt.slice(r.deb[k], r.fin[k]);
      ent.set(r.ids[k], GEL({ id: r.ids[k], type: r.types[r.typ[k]], src: src, refs: GEL(refs) }));
      ordre.push(r.ids[k]);
    }
  }
  function modele(r, nom, ent, ordre){
    return {
      nom: nom || "modele.ifc",
      taille: r.taille,
      schema: r.schema,
      eol: r.eol,
      entetes: r.entetes,
      dataDecl: r.dataDecl,
      ordre: ordre,
      ent: ent,
      maxId: r.maxId,
      nbOrigine: ent.size,
      doublons: r.doublons,
      version: 0
    };
  }

  // Lecture d'un coup (sans Web Worker)
  function lire(buffer, nom){
    var r = analyser(new Uint8Array(buffer)), ent = new Map(), ordre = [];
    assembler(r, r.txt, ent, ordre, 0, r.nb);
    return modele(r, nom, ent, ordre);
  }

  // Lecture par étapes : progres(fraction 0–1, étape) ; le texte est reconstruit et les entités
  // assemblées par tranches de ~40 ms, la page reste vivante.
  function pause(){ return new Promise(function(ok){ setTimeout(ok, 0); }); }
  function lireParEtapes(r, octets, nom, progres){
    var parts = [], PAS = 0x8000, i = 0, ent = new Map(), ordre = [], k = 0;
    function texte(){
      var t0 = performance.now();
      while (i < octets.length && performance.now() - t0 < 40){
        for (var n = 0; n < 32 && i < octets.length; n++, i += PAS) parts.push(String.fromCharCode.apply(null, octets.subarray(i, i + PAS)));
      }
      if (progres) progres(i/octets.length, "texte");
      return i < octets.length ? pause().then(texte) : null;
    }
    function entites(txt){
      var t0 = performance.now();
      while (k < r.nb && performance.now() - t0 < 40){ var k1 = Math.min(r.nb, k + 5000); assembler(r, txt, ent, ordre, k, k1); k = k1; }
      if (progres) progres(k/r.nb, "entites");
      return k < r.nb ? pause().then(function(){ return entites(txt); }) : modele(r, nom, ent, ordre);
    }
    return Promise.resolve(texte()).then(function(){
      var txt = parts.join("");
      parts = null;
      return pause().then(function(){ return entites(txt); });
    });
  }
  function toutesChaines(v, out){
    out = out || [];
    if (!v) return out;
    if (v.str !== undefined) out.push(v.str);
    else if (Array.isArray(v)) v.forEach(function(x){ toutesChaines(x, out); });
    return out;
  }

  // ================= Index des éléments et des relations =================
  var SPATIAL = { IFCPROJECT:1, IFCSITE:1, IFCBUILDING:1, IFCBUILDINGSTOREY:1, IFCSPACE:1, IFCSPATIALZONE:1, IFCEXTERNALSPATIALELEMENT:1 };
  var NON_SUPPRIMABLES = { IFCPROJECT:1, IFCSITE:1, IFCBUILDING:1, IFCBUILDINGSTOREY:1 };
  var OUVERTURES = { IFCOPENINGELEMENT:1, IFCOPENINGSTANDARDCASE:1 };
  var PLACEMENTS = { IFCLOCALPLACEMENT:1, IFCGRIDPLACEMENT:1, IFCLINEARPLACEMENT:1 };
  // produits reconnus même sans placement ni représentation ($, $)
  var PRODUITS_NUS = { IFCELEMENTASSEMBLY:1, IFCSITE:1, IFCBUILDING:1, IFCBUILDINGSTOREY:1, IFCSPACE:1 };

  // Élément produit reconnu par sa structure : GlobalId en 1er argument,
  // argument 6 = IFCLOCALPLACEMENT (ou $), argument 7 = IFCPRODUCTDEFINITIONSHAPE (ou $).
  function estProduit(m, e){
    var s = e.src, d = debutArgs(s);
    while (s.charCodeAt(d) <= 32) d++;
    if (s.charCodeAt(d) !== 39) return false;          // pas de GlobalId : on ne lit pas plus loin
    if (e.type.lastIndexOf("IFCREL", 0) === 0) return false;
    var a = champs(e);
    if (a.length < 7 || !a[0] || a[0].str === undefined) return false;
    var p = a[5], r = a[6], pe, re;
    if (p !== null){ pe = p && p.ref && m.ent.get(p.ref); if (!pe || !PLACEMENTS[pe.type]) return false; }
    if (r !== null){ re = r && r.ref && m.ent.get(r.ref); if (!re || re.type !== "IFCPRODUCTDEFINITIONSHAPE") return false; }
    if (p === null && r === null) return !!PRODUITS_NUS[e.type];
    return true;
  }

  function ajouter(map, cle, val){ var l = map.get(cle); if (!l) map.set(cle, l = []); l.push(val); }
  function lier(enf, par, p, liste){
    if (!p) return;
    liste.forEach(function(k){ if (!k) return; ajouter(enf, p, k); if (!par.has(k)) par.set(k, p); });
  }

  function index(m){
    if (m._idx && m._idx.v === m.version) return m._idx;
    var I = { v: m.version, produits: [], estProduit: new Set(), projets: [],
      enfants: new Map(), parent: new Map(), contenu: new Map(), conteneur: new Map(),
      ouvertures: new Map(), perce: new Map(), materiaux: new Map(), psets: new Map(), typeObjet: new Map() };
    m.ordre.forEach(function(id){
      var e = m.ent.get(id);
      if (!e) return;
      var t = e.type, a;
      if (t.lastIndexOf("IFCREL", 0) === 0){
        a = champs(e);
        switch (t){
          case "IFCRELAGGREGATES": case "IFCRELNESTS":
            lier(I.enfants, I.parent, idRef(a[4]), refsListe(a[5])); break;
          case "IFCRELCONTAINEDINSPATIALSTRUCTURE":
            lier(I.contenu, I.conteneur, idRef(a[5]), refsListe(a[4])); break;
          case "IFCRELVOIDSELEMENT":
            lier(I.ouvertures, I.perce, idRef(a[4]), [idRef(a[5])]); break;
          case "IFCRELASSOCIATESMATERIAL":
            refsListe(a[4]).forEach(function(o){ if (idRef(a[5])) ajouter(I.materiaux, o, idRef(a[5])); }); break;
          case "IFCRELDEFINESBYPROPERTIES":
            var defs = toutesRefs(a[5]);
            refsListe(a[4]).forEach(function(o){ defs.forEach(function(d){ ajouter(I.psets, o, d); }); }); break;
          case "IFCRELDEFINESBYTYPE":
            refsListe(a[4]).forEach(function(o){ if (idRef(a[5])) I.typeObjet.set(o, idRef(a[5])); }); break;
        }
        return;
      }
      if (t === "IFCPROJECT"){ I.projets.push(id); return; }
      if (estProduit(m, e)){ I.produits.push(id); I.estProduit.add(id); }
    });
    m._idx = I; m._inf = new Map();
    return I;
  }

  // Arborescence à plat : projet > site > bâtiment > étage > éléments > enfants d'assemblage > ouvertures.
  function arbre(m){
    var I = index(m), vu = new Set(), out = [];
    function visite(id, niv){
      if (vu.has(id)) return;
      var e = m.ent.get(id);
      if (!e || !(I.estProduit.has(id) || e.type === "IFCPROJECT")) return;
      vu.add(id);
      out.push({ id: id, niv: niv });
      (I.enfants.get(id) || []).forEach(function(c){ visite(c, niv + 1); });
      (I.contenu.get(id) || []).forEach(function(c){
        // un enfant d'assemblage aussi rattaché à l'étage apparaît sous son assemblage
        var p = I.parent.get(c);
        if (p && p !== id && I.estProduit.has(p)) return;
        visite(c, niv + 1);
      });
      (I.ouvertures.get(id) || []).forEach(function(c){ visite(c, niv + 1); });
    }
    I.projets.forEach(function(p){ visite(p, 0); });
    I.produits.forEach(function(p){ if (!I.parent.has(p) && !I.conteneur.has(p) && !I.perce.has(p)) visite(p, 0); });
    I.produits.forEach(function(p){ visite(p, 0); });
    return out;
  }

  // Enfants d'assemblage (IFCRELAGGREGATES / IFCRELNESTS), récursivement.
  function descendants(m, id){
    var I = index(m), out = [], vu = new Set([id]), pile = [id];
    while (pile.length){
      (I.enfants.get(pile.pop()) || []).forEach(function(c){
        if (vu.has(c) || !I.estProduit.has(c)) return;
        vu.add(c); out.push(c); pile.push(c);
      });
    }
    return out;
  }

  // ================= Fiche d'un élément =================
  var NOMS_TYPES = {};
  ("IfcProject IfcSite IfcBuilding IfcBuildingStorey IfcSpace IfcBeam IfcBeamStandardCase IfcColumn IfcColumnStandardCase " +
   "IfcMember IfcMemberStandardCase IfcPlate IfcPlateStandardCase IfcSlab IfcSlabStandardCase IfcSlabElementedCase IfcWall " +
   "IfcWallStandardCase IfcWallElementedCase IfcFooting IfcPile IfcMechanicalFastener IfcFastener IfcElementAssembly " +
   "IfcOpeningElement IfcOpeningStandardCase IfcBuildingElementProxy IfcDiscreteAccessory IfcReinforcingBar IfcReinforcingMesh " +
   "IfcTendon IfcTendonAnchor IfcRailing IfcStair IfcStairFlight IfcRamp IfcRampFlight IfcRoof IfcDoor IfcWindow IfcCovering " +
   "IfcCurtainWall IfcChimney IfcShadingDevice IfcFurnishingElement IfcFurniture IfcFlowSegment IfcFlowFitting IfcFlowTerminal " +
   "IfcDistributionElement IfcDistributionPort IfcAnnotation IfcGrid IfcProxy IfcVirtualElement IfcCivilElement " +
   "IfcGeographicElement IfcElementComponent IfcBuildingElementPart IfcEdgeFeature IfcChamferEdgeFeature IfcRoundedEdgeFeature " +
   "IfcProjectionElement IfcSpatialZone IfcExternalSpatialElement IfcTransportElement IfcEquipmentElement IfcBearing")
    .split(" ").forEach(function(n){ NOMS_TYPES[n.toUpperCase()] = n; });
  function nomType(t){
    if (NOMS_TYPES[t]) return NOMS_TYPES[t];
    if (t.lastIndexOf("IFC", 0) === 0) return "Ifc" + t.charAt(3) + t.slice(4).toLowerCase();
    return t;
  }

  function genre(m, e){
    if (SPATIAL[e.type]) return "spatial";
    if (OUVERTURES[e.type] || index(m).perce.has(e.id)) return "ouverture";
    return "element";
  }

  function infos(m, id){
    index(m);
    var c = m._inf.get(id);
    if (c) return c;
    var e = m.ent.get(id);
    if (!e) return null;
    var a = champs(e), g = genre(m, e);
    c = {
      id: id, type: e.type, typeLib: nomType(e.type), genre: g,
      nom: chaine(a[2]), globalId: chaine(a[0]), description: chaine(a[3]), objectType: chaine(a[4]),
      tag: g === "element" || g === "ouverture" ? chaine(a[7]) : "",
      nomLong: g === "spatial" ? chaine(e.type === "IFCPROJECT" ? a[5] : a[7]) : "",
      materiau: materiaux(m, id).join(", "),
      supprimable: !NON_SUPPRIMABLES[e.type]
    };
    m._inf.set(id, c);
    return c;
  }

  function materiaux(m, id){
    var I = index(m), mats = I.materiaux.get(id);
    if (!mats && I.typeObjet.has(id)) mats = I.materiaux.get(I.typeObjet.get(id));
    var noms = [], vu = new Set();
    (function marche(liste, prof){
      if (prof > 6) return;
      liste.forEach(function(r){
        if (vu.has(r)) return; vu.add(r);
        var e = m.ent.get(r);
        if (!e || e.type.lastIndexOf("IFCMATERIAL", 0) !== 0) return;
        if (e.type === "IFCMATERIAL"){ var n = chaine(champs(e)[0]); if (n && noms.indexOf(n) < 0) noms.push(n); return; }
        marche(e.refs, prof + 1);
      });
    })(mats || [], 0);
    return noms;
  }

  var FR = new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 6 });
  function texteValeur(m, v){
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return FR.format(v);
    if (Array.isArray(v)) return v.map(function(x){ return texteValeur(m, x); }).join(" ; ");
    if (v.str !== undefined) return decoder(v.str);
    if (v.enu !== undefined) return v.enu === "T" ? "Oui" : v.enu === "F" ? "Non" : v.enu === "U" ? "Inconnu" : v.enu;
    if (v.type) return texteValeur(m, v.v);
    if (v.ref){ var e = m.ent.get(v.ref); return e ? nomType(e.type) + " #" + v.ref : "#" + v.ref; }
    return v.brut || v.bin || "";
  }

  function lignesProps(m, liste, prefixe, out, prof){
    liste.forEach(function(r){
      var e = m.ent.get(r);
      if (!e) return;
      var a = champs(e), nom = prefixe + chaine(a[0]);
      switch (e.type){
        case "IFCPROPERTYSINGLEVALUE": out.push([nom, texteValeur(m, a[2])]); break;
        case "IFCPROPERTYENUMERATEDVALUE": out.push([nom, texteValeur(m, a[2])]); break;
        case "IFCPROPERTYLISTVALUE": out.push([nom, texteValeur(m, a[2])]); break;
        case "IFCPROPERTYBOUNDEDVALUE": out.push([nom, texteValeur(m, a[3]) + " … " + texteValeur(m, a[2])]); break;
        case "IFCPROPERTYREFERENCEVALUE": out.push([nom, texteValeur(m, a[3])]); break;
        case "IFCPROPERTYTABLEVALUE": out.push([nom, "(tableau)"]); break;
        case "IFCCOMPLEXPROPERTY": if (prof < 4) lignesProps(m, refsListe(a[3]), nom + " › ", out, prof + 1); break;
        default:
          if (e.type.lastIndexOf("IFCQUANTITY", 0) === 0) out.push([nom, texteValeur(m, a[3])]);
          else out.push([nom || nomType(e.type), "—"]);
      }
    });
  }

  // Jeux de propriétés et de quantités : [{ nom, origine, props:[[nom, valeur]] }]
  function proprietes(m, id){
    var I = index(m), out = [];
    function jeu(d, origine){
      var e = m.ent.get(d);
      if (!e) return;
      var a = champs(e), props = [];
      if (e.type === "IFCPROPERTYSET") lignesProps(m, refsListe(a[4]), "", props, 0);
      else if (e.type === "IFCELEMENTQUANTITY") lignesProps(m, refsListe(a[5]), "", props, 0);
      out.push({ nom: chaine(a[2]) || nomType(e.type), origine: origine, props: props });
    }
    (I.psets.get(id) || []).forEach(function(d){ jeu(d, ""); });
    var t = I.typeObjet.get(id), te = t && m.ent.get(t);
    if (te){
      var nomT = chaine(champs(te)[2]) || nomType(te.type);
      refsListe(champs(te)[5]).forEach(function(d){ jeu(d, "Type " + nomT); });
      (I.psets.get(t) || []).forEach(function(d){ jeu(d, "Type " + nomT); });
    }
    return out;
  }

  // ================= Suppression propre =================
  // Références « faibles » : elles ne gardent pas en vie ce qu'elles désignent, et sont nettoyées après coup.
  var FAIBLES = { IFCSTYLEDITEM: [0], IFCPRESENTATIONLAYERASSIGNMENT: [2], IFCPRESENTATIONLAYERWITHSTYLE: [2], IFCMATERIALDEFINITIONREPRESENTATION: [3] };
  // Objets racines (GlobalId) qu'on peut quand même supprimer quand plus rien ne les référence.
  // (…PROPERTIES : jeux de propriétés prédéfinis de l'IFC2X3, même rôle qu'un IFCPROPERTYSET)
  var RACINES_SUPPRIMABLES = /^(IFCPROPERTYSET|IFCELEMENTQUANTITY|IFC\w+PROPERTIES)$/;

  var cacheFortes = new WeakMap();
  function refsFortes(e){
    var pos = FAIBLES[e.type];
    if (!pos) return e.refs;
    var f = cacheFortes.get(e);
    if (f) return f;
    var faibles = [], a = champs(e);
    pos.forEach(function(k){ toutesRefs(a[k], faibles); });
    f = e.refs.slice();
    faibles.forEach(function(r){ var i = f.indexOf(r); if (i >= 0) f.splice(i, 1); });
    cacheFortes.set(e, f);
    return f;
  }

  function aGlobalId(e){
    var s = e.src, d = debutArgs(s);
    while (s.charCodeAt(d) <= 32) d++;
    if (s.charCodeAt(d) !== 39) return false;
    var a = champs(e)[0];
    return !!(a && a.str !== undefined && a.str.length === 22);
  }
  // Socle du fichier, gardé même s'il ne sert plus (contextes de représentation, historique, unités).
  var SOCLE = { IFCOWNERHISTORY:1, IFCGEOMETRICREPRESENTATIONCONTEXT:1, IFCGEOMETRICREPRESENTATIONSUBCONTEXT:1,
    IFCUNITASSIGNMENT:1, IFCAPPLICATION:1, IFCPERSONANDORGANIZATION:1, IFCPERSON:1, IFCORGANIZATION:1 };
  function protege(e){ return !!SOCLE[e.type] || (!RACINES_SUPPRIMABLES.test(e.type) && aGlobalId(e)); }
  function estRelation(e){ return e.type.lastIndexOf("IFCREL", 0) === 0; }

  // Retire d'un argument brut les références vers des ids de « parti » (Set ou Map).
  // coupe = une référence unique visait un id supprimé, ou une liste est devenue vide.
  function filtrer(raw, parti){
    var c = raw.charCodeAt(0);
    if (c === 35){
      return parti.has(parseInt(raw.slice(1), 10)) ? { txt: "$", coupe: true, change: true } : { txt: raw };
    }
    if (c === 40){
      var parts = decouper(raw, 1, raw.length - 1), garde = [], ote = false, change = false;
      parts.forEach(function(p){
        if (p.charCodeAt(0) === 35 && parti.has(parseInt(p.slice(1), 10))){ ote = true; return; }
        if (p.charCodeAt(0) === 40){ var f = filtrer(p, parti); if (f.change) change = true; garde.push(f.txt); return; }
        garde.push(p);
      });
      if (ote && !garde.length) return { txt: "()", coupe: true, change: true };
      return ote || change ? { txt: "(" + garde.join(",") + ")", change: true } : { txt: raw };
    }
    if ((c >= 65 && c <= 90) && raw.charCodeAt(raw.length - 1) === 41){   // valeur typée TYPE((#1,#2))
      var p = raw.indexOf("(");
      if (p > 0){
        var f = filtrer(raw.slice(p + 1, -1).trim(), parti);
        if (f.change) return { txt: raw.slice(0, p + 1) + f.txt + ")", coupe: f.coupe, change: true };
      }
    }
    return { txt: raw };
  }
  function elaguer(e, parti){
    var args = bruts(e).slice(), coupe = false, change = false;
    for (var k = 0; k < args.length; k++){
      var f = filtrer(args[k], parti);
      if (f.change){ change = true; args[k] = f.txt; if (f.coupe) coupe = true; }
    }
    return { args: args, coupe: coupe, change: change };
  }

  // Plan de suppression : ce qui partira si on supprime les éléments demandés.
  function planifier(m, demandes){
    var I = index(m), D = new Set(), pile = [];
    function prendre(id){
      var e = m.ent.get(id);
      if (!e || D.has(id) || !I.estProduit.has(id) || NON_SUPPRIMABLES[e.type]) return;
      D.add(id); pile.push(id);
    }
    demandes.forEach(prendre);
    var nbDemandes = D.size;
    // enfants d'assemblage et ouvertures partent avec leur élément
    while (pile.length){
      var id = pile.pop();
      (I.enfants.get(id) || []).forEach(prendre);
      (I.ouvertures.get(id) || []).forEach(prendre);
    }

    var retire = new Map(), remplace = new Map();
    D.forEach(function(id){ retire.set(id, m.ent.get(id)); });

    // 1) Entités qui désignent un élément supprimé : relations élaguées ou supprimées
    m.ent.forEach(function(e){
      if (retire.has(e.id)) return;
      var touche = false;
      for (var i = 0; i < e.refs.length; i++) if (D.has(e.refs[i])){ touche = true; break; }
      if (!touche) return;
      if (e.type === "(COMPLEXE)"){ if (!aGlobalId(e)) retire.set(e.id, e); return; }
      var r = elaguer(e, D);
      if (r.coupe && (estRelation(e) || !aGlobalId(e))) retire.set(e.id, e);
      else remplace.set(e.id, refaire(e, r.args));
    });

    // 2) Cascade : compteur de références entrantes (fortes)
    var cnt = new Int32Array(m.maxId + 2), faibles = [], file = [];
    m.ent.forEach(function(e){
      var f = refsFortes(e);
      for (var i = 0; i < f.length; i++) if (f[i] < cnt.length) cnt[f[i]]++;
      if (FAIBLES[e.type]) faibles.push(e);
    });
    function candidat(id){
      var e = m.ent.get(id);
      if (!e || retire.has(id) || protege(e)) return;
      remplace.delete(id);
      retire.set(id, e); file.push(e);
    }
    function lacher(e){
      var f = refsFortes(e);
      for (var i = 0; i < f.length; i++){
        var r = f[i];
        if (r < cnt.length && --cnt[r] === 0) candidat(r);
      }
    }
    retire.forEach(function(e){ file.push(e); });
    var tour = 0, change;
    do {
      while (file.length) lacher(file.pop());
      // 3) Références faibles : styles, calques, représentations de matériaux
      change = false;
      faibles.forEach(function(w){
        if (retire.has(w.id)) return;
        var cur = remplace.get(w.id) || w, r = elaguer(cur, retire);
        if (!r.change) return;
        change = true;
        if (r.coupe){ remplace.delete(w.id); retire.set(w.id, w); file.push(w); }
        else remplace.set(w.id, refaire(w, r.args));
      });
    } while ((change || file.length) && ++tour < 50);

    var avant = [], apres = [], nbOuv = 0;
    D.forEach(function(id){ if (OUVERTURES[m.ent.get(id).type]) nbOuv++; });
    retire.forEach(function(e){ avant.push(e); });
    remplace.forEach(function(n, id){ avant.push(m.ent.get(id)); apres.push(n); });
    return {
      elements: D, nbDemandes: nbDemandes, nbElements: D.size, nbOuvertures: nbOuv,
      nbEntites: retire.size, nbModifiees: remplace.size,
      changement: { avant: avant, apres: apres, nbRetirees: retire.size }
    };
  }

  // Applique un changement (ou l'annule avec inverse = true).
  function appliquer(m, ch, inverse){
    var ote = inverse ? ch.apres : ch.avant, met = inverse ? ch.avant : ch.apres;
    ote.forEach(function(e){ m.ent.delete(e.id); });
    met.forEach(function(e){ m.ent.set(e.id, e); });
    m.version++;
  }

  // ================= Export =================
  function horodatage(){
    var d = new Date();
    function z(x){ return (x < 10 ? "0" : "") + x; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds());
  }
  function entetesExport(m){
    var t = horodatage();
    return m.entetes.map(function(h){
      if (!/^FILE_NAME\s*\(/i.test(h)) return h;
      var p = h.indexOf("("), a = decouper(h, p + 1, h.lastIndexOf(")"));
      if (a.length < 2) return h;
      a[1] = "'" + t + "'";
      return h.slice(0, p + 1) + a.join(",") + ")";
    });
  }
  function ecrire(m){
    var L = ["ISO-10303-21;", "HEADER;"];
    entetesExport(m).forEach(function(h){ L.push(h + ";"); });
    L.push("ENDSEC;", m.dataDecl + ";");
    m.ordre.forEach(function(id){ var e = m.ent.get(id); if (e) L.push(e.src + ";"); });
    L.push("ENDSEC;", "END-ISO-10303-21;");
    return L.join(m.eol) + m.eol;
  }
  // Taille exacte du fichier exporté, sans le construire.
  function taille(m){
    var eol = m.eol.length, t = 0;
    t += ("ISO-10303-21;HEADER;ENDSEC;" + m.dataDecl + ";ENDSEC;END-ISO-10303-21;").length + 6*eol;
    entetesExport(m).forEach(function(h){ t += h.length + 1 + eol; });
    m.ordre.forEach(function(id){ var e = m.ent.get(id); if (e) t += e.src.length + 1 + eol; });
    return t;
  }
  function nomExport(nom){
    if (/^fusion_/i.test(nom)) return nom;            // une fusion porte déjà un nom à elle
    return nom.replace(/\.ifc$/i, "") + "_modifie.ifc";
  }

  // ================= Fusion =================
  // Réécrit les références #n hors chaînes (y compris l'identifiant en tête de ligne) avec nouveau(n).
  function renumeroter(s, nouveau){
    var out = [], n = s.length, i = 0, d = 0, c, v;
    while (i < n){
      c = s.charCodeAt(i);
      if (c === 39){
        i++;
        while (i < n){
          if (s.charCodeAt(i) === 39){ if (s.charCodeAt(i + 1) === 39){ i += 2; continue; } break; }
          i++;
        }
        i++; continue;
      }
      if (c === 35){
        var j = i + 1; v = 0;
        while (j < n){ c = s.charCodeAt(j); if (c < 48 || c > 57) break; v = v*10 + (c - 48); j++; }
        if (v > 0){ out.push(s.slice(d, i + 1), String(nouveau(v))); d = j; }
        i = j; continue;
      }
      i++;
    }
    out.push(s.slice(d));
    return out.join("");
  }
  // Unité de longueur d'un modèle (pour signaler des maquettes à des échelles différentes)
  function uniteLongueur(m){
    var u = "";
    m.ent.forEach(function(e){
      if (u || (e.type !== "IFCSIUNIT" && e.type !== "IFCCONVERSIONBASEDUNIT")) return;
      var a = champs(e);
      if (!a[1] || a[1].enu !== "LENGTHUNIT") return;
      u = e.type === "IFCSIUNIT" ? ((a[2] && a[2].enu) || "") + (a[3] && a[3].enu || "") : chaine(a[2]);
    });
    return u;
  }
  // Fusion de plusieurs modèles en un seul : les identifiants sont décalés fichier par fichier, les
  // projets des fichiers suivants disparaissent au profit de celui du premier (leurs sites s'y rattachent)
  // et leurs contextes de représentation s'ajoutent à la liste du projet gardé. Promesse du modèle fusionné
  // et d'un bilan { unites, guidsDoubles } ; progres(0–1). Les modèles d'origine ne sont pas touchés.
  function fusionner(ms, nom, progres){
    if (ms.length < 2) return Promise.reject(erreur("Il faut au moins deux maquettes pour une fusion."));
    var schemas = ms.map(function(m){ return m.schema; });
    if (schemas.some(function(x){ return x !== schemas[0]; }))
      return Promise.reject(erreur("Fusion impossible : les maquettes n'ont pas le même schéma (" + schemas.join(", ") + ")."));
    var m0 = ms[0], projet0 = 0;
    m0.ent.forEach(function(e){ if (!projet0 && e.type === "IFCPROJECT") projet0 = e.id; });
    if (!projet0) return Promise.reject(erreur("Fusion impossible : « " + m0.nom + " » n'a pas d'IfcProject."));
    var ent = new Map(), ordre = [], decal = 0, contextes = [], total = 0, guids = new Set(), doublons = 0;
    ms.forEach(function(m){ total += m.ordre.length; });
    var unites = ms.map(uniteLongueur);
    var suite = Promise.resolve();
    ms.forEach(function(m, k){
      suite = suite.then(function(){
        var d = decal, projets = new Set(), max = 0;
        m.ent.forEach(function(e){ if (e.id > max) max = e.id; if (k > 0 && e.type === "IFCPROJECT") projets.add(e.id); });
        // contextes des projets abandonnés : rattachés au projet gardé
        projets.forEach(function(id){ refsListe(champs(m.ent.get(id))[7]).forEach(function(r){ contextes.push(r + d); }); });
        function nouveau(id){ return projets.has(id) ? projet0 : id + d; }
        var ids = m.ordre, i = 0;
        decal += max;
        return new Promise(function(ok, ko){
          (function tranche(){
            try {
              var t0 = Date.now();
              while (i < ids.length && Date.now() - t0 < 40){
                var e = m.ent.get(ids[i++]);
                if (!e || projets.has(e.id)) continue;
                var n = d ? lireEntite(renumeroter(e.src, nouveau)) : e;
                ent.set(n.id, n); ordre.push(n.id);
                if (aGlobalId(n)){ var g = champs(n)[0].str; if (guids.has(g)) doublons++; else guids.add(g); }
              }
            } catch (err){ ko(err); return; }
            if (progres) progres(Math.min(1, (ordre.length + projets.size)/total));
            if (i < ids.length) setTimeout(tranche, 0); else ok();
          })();
        });
      });
    });
    return suite.then(function(){
      var p = ent.get(projet0);
      if (contextes.length){
        var a = bruts(p).slice(), liste = a[7] && a[7] !== "$" ? refsListe(valeur(a[7])) : [];
        a[7] = "(" + liste.concat(contextes).map(function(r){ return "#" + r; }).join(",") + ")";
        ent.set(projet0, refaire(p, a));
      }
      var entetes = m0.entetes.map(function(h){
        if (!/^FILE_NAME\s*\(/i.test(h)) return h;
        var q = h.indexOf("("), a = decouper(h, q + 1, h.lastIndexOf(")"));
        if (!a.length) return h;
        a[0] = "'" + nom.replace(/'/g, "''") + "'";
        return h.slice(0, q + 1) + a.join(",") + ")";
      });
      var taille = 0;
      ms.forEach(function(m){ taille += m.taille; });
      var m = modele({ taille: taille, schema: m0.schema, eol: m0.eol, entetes: entetes, dataDecl: m0.dataDecl, maxId: decal, doublons: 0 }, nom, ent, ordre);
      return { m: m, unites: unites.every(function(u){ return u === unites[0]; }) ? null : unites, guidsDoubles: doublons };
    });
  }

  global.IFC = {
    lire: lire, analyser: analyser, lireParEtapes: lireParEtapes, index: index, arbre: arbre, descendants: descendants, infos: infos, proprietes: proprietes,
    planifier: planifier, appliquer: appliquer, ecrire: ecrire, taille: taille, nomExport: nomExport, versOctets: versOctets,
    champs: champs, idRef: idRef, refsListe: refsListe, nombre: nombre, chaine: chaine, decoder: decoder, nomType: nomType,
    fusionner: fusionner,
    // pour écrire de nouvelles entités ailleurs (retaille selon la boîte de coupe, dans ifc-vue.js)
    lireEntite: lireEntite, refaire: refaire, bruts: bruts, uniteLongueur: uniteLongueur
  };
})(typeof window !== "undefined" ? window : self);
