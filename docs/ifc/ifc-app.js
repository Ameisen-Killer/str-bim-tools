// Interface de /ifc/ : chargement d'un ou plusieurs fichiers, liste des éléments groupée par fichier,
// propriétés, suppression avec confirmation, annuler / rétablir, export, onglets sur smartphone,
// thème clair / sombre, arborescence repliable avec menu contextuel, couleur par maquette.
// Les fichiers ne quittent jamais le navigateur : aucune requête réseau ici.
// Plusieurs IFC : ils se superposent dans la vue 3D (même repère), chacun garde son historique de
// modifications et s'exporte à part. Un élément est désigné par sa clé « n° de fichier:id ».
(function(){
  "use strict";

  function $(s){ return document.querySelector(s); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var NB = new Intl.NumberFormat("fr-CH");
  function fmtN(n){ return NB.format(n); }
  function fmtTaille(o){
    if (o < 1024) return o + " o";
    if (o < 1048576) return (o/1024).toFixed(1).replace(".", ",") + " Ko";
    return (o/1048576).toFixed(2).replace(".", ",") + " Mo";
  }
  // version de la page, montrée dans le bandeau (à monter à chaque mise en ligne)
  var VERSION = "1.2.0";
  (function(){ var v = document.getElementById("version"); if (v) v.textContent = "v" + VERSION; })();
  function pluriel(n, mot, mots){ return fmtN(n) + " " + (n > 1 ? (mots || mot + "s") : mot); }

  // fichier ouvert : { uid, m (modèle IFC), propre (version exportée), visible, plie, teinte (0–360 ou null), taille: {v, t} }
  var fichiers = [], parUid = new Map(), uidSuivant = 1;
  var lignes = [], choix = new Set(), caches = new Set(), plies = new Set(), actif = "", histo = [], aRefaire = [];

  function lire(cle, permis){ var v = null; try { v = localStorage.getItem(cle); } catch (e){} return permis.indexOf(v) >= 0 ? v : permis[0]; }
  function garder(cle, v){ try { localStorage.setItem(cle, v); } catch (e){} }
  var moteurVoulu = lire("ifc.moteur", ["webgl", "webgpu", "three", "canvas"]), geoVoulue = lire("ifc.geometrie", ["maison", "webifc"]);
  // WebGL et canvas démarrent tout de suite ; WebGPU et Three.js (ifc-moteurs.js) se chargent ensuite
  var cube = null;
  var vue = IFCVue.creer($("#vue"), { surClic: cliqueVue, surMenu: menuVue, moteur: moteurVoulu, surMesure: function(t){ etat(t); },
    surCamera: function(l, p){ if (cube) cube.camera(l, p); } });
  // cube de navigation comme le ViewCube de Revit (ifc-cube.js) : faces dans le repère du projet, maison = vue 3D
  // par défaut de Revit (coin haut, avant, droite), qui recadre tout
  var PLONGEE_MAISON = Math.atan(Math.SQRT1_2), angleProjet = 0;
  function vueMaison(){ vue.allerVers(angleProjet + Math.PI/4, PLONGEE_MAISON, null, true); }
  cube = IFCCube.creer($("#cube"), vue, { maison: vueMaison });
  // repère du projet : axe X du placement du bâtiment (sinon du site) ; nord = TrueNorth du contexte 'Model'
  function repereProjet(){
    for (var i = 0; i < fichiers.length; i++){
      var m = fichiers[i].m, bat = 0, site = 0, ctx = null;
      m.ent.forEach(function(e){
        if (!bat && e.type === "IFCBUILDING") bat = e.id;
        else if (!site && e.type === "IFCSITE") site = e.id;
        else if (e.type === "IFCGEOMETRICREPRESENTATIONCONTEXT" && (!ctx || (IFC.chaine(IFC.champs(e)[1]) === "Model" && IFC.chaine(IFC.champs(ctx)[1]) !== "Model"))) ctx = e;
      });
      var a = bat ? vue.angleRepere(m, bat) : null;
      if (a == null && site) a = vue.angleRepere(m, site);
      if (a == null) continue;
      var d = ctx && m.ent.get(IFC.idRef(IFC.champs(ctx)[5])), rr = d && d.type === "IFCDIRECTION" ? IFC.champs(d)[0] : null, nord = Math.PI/2;
      if (Array.isArray(rr) && rr.length > 1){
        var x = IFC.nombre(rr[0]), y = IFC.nombre(rr[1]);
        if (isFinite(x) && isFinite(y) && (x || y)) nord = Math.atan2(y, x);
      }
      return { angle: a, nord: nord };
    }
    return { angle: 0, nord: Math.PI/2 };
  }
  function majRepere(){ var rp = repereProjet(); angleProjet = rp.angle; cube.repere(rp.angle, rp.nord); }
  // lissage des bords : actif par défaut, choix gardé dans ce navigateur
  vue.lissage(lire("ifc.lissage", ["1", "0"]) === "1");

  // Moteurs et géométries que ce navigateur ne peut pas faire tourner : clé → raison (montrée dans l'infobulle)
  var INDISPO = {};
  (function(){
    function contexte(type){
      var c = document.createElement("canvas"), g = null;
      try { g = c.getContext(type); } catch (e){}
      var l = g && g.getExtension("WEBGL_lose_context");
      if (l) l.loseContext();
      return !!g;
    }
    if (!contexte("webgl")) INDISPO.webgl = "WebGL est indisponible sur cet appareil ou ce navigateur.";
    if (!contexte("webgl2")) INDISPO.three = "Three.js demande WebGL 2, indisponible sur cet appareil ou ce navigateur.";
    if (!navigator.gpu) INDISPO.webgpu = "Ce navigateur ne propose pas WebGPU (ou pas sur cette page non sécurisée).";
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") INDISPO.webifc = "Ce navigateur ne permet pas WebAssembly en arrière-plan.";
  })();
  function marquerIndispo(){
    [].forEach.call(document.querySelectorAll("[data-moteur],[data-geo]"), function(b){
      var k = b.getAttribute("data-moteur") || b.getAttribute("data-geo");
      if (INDISPO[k]) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
    });
  }
  marquerIndispo();
  if (moteurVoulu === "webgpu" || moteurVoulu === "three"){
    vue.moteur(moteurVoulu).then(function(){ if (fichiers.length) majVue(); }).catch(function(err){
      INDISPO[moteurVoulu] = err && err.message || String(err); marquerIndispo();
      if (fichiers.length){ majVue(); etat("Le moteur choisi n'a pas démarré (" + INDISPO[moteurVoulu] + ") : WebGL le remplace."); }
    });
  }

  // Accueil ou éditeur ; dans l'éditeur, le bandeau du site laisse la place à l'interface
  function modeEditeur(oui){
    $("#accueil").hidden = oui;
    $("#editeur").hidden = !oui;
    document.body.classList.toggle("edition", oui);
  }

  function cle(f, id){ return f.uid + ":" + id; }
  function lireCle(c){
    var p = c.indexOf(":");
    return { f: parUid.get(+c.slice(0, p)), id: +c.slice(p + 1) };
  }
  function existe(c){ var d = lireCle(c); return !!(d.f && d.f.m.ent.has(d.id)); }
  function modifie(f){ return f.m.version !== f.propre; }
  function tailleDe(f){
    if (f.taille.v !== f.m.version) f.taille = { v: f.m.version, t: IFC.taille(f.m) };
    return f.taille.t;
  }

  // ================= Messages =================
  function etat(msg){ $("#etat").textContent = msg || ""; }
  function erreur(msg){
    var b = $("#erreur");
    if (!msg){ b.hidden = true; b.innerHTML = ""; return; }
    b.innerHTML = "<b>Fichier refusé</b>" + esc(msg);
    b.hidden = false;
  }
  function nomAff(i){ return i.nom || i.objectType || i.tag || i.typeLib + " #" + i.id; }

  // ================= Chargement =================
  function lireFichier(f){
    if (f.arrayBuffer) return f.arrayBuffer();
    return new Promise(function(ok, ko){
      var r = new FileReader();
      r.onload = function(){ ok(r.result); };
      r.onerror = function(){ ko(r.error); };
      r.readAsArrayBuffer(f);
    });
  }
  function pause(ms){ return new Promise(function(ok){ setTimeout(ok, ms || 30); }); }   // laisse l'écran se rafraîchir

  // ================= .ifczip : archive ZIP qui contient un .ifc (compression du navigateur, sans bibliothèque) =================
  var zipPossible = typeof CompressionStream === "function" && typeof DecompressionStream === "function" && typeof Response === "function";
  function flux(octets, t){ return new Response(new Blob([octets]).stream().pipeThrough(t)).arrayBuffer(); }
  var TABLE_CRC = (function(){
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++){ var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u){
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u.length; i++) c = TABLE_CRC[(c ^ u[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // Archive d'un seul fichier (nom, octets) compressé en « deflate » : promesse d'un Blob
  function zipper(nom, u){
    return flux(u, new CompressionStream("deflate-raw")).then(function(cb){
      var c = new Uint8Array(cb), n = new TextEncoder().encode(nom), crc = crc32(u), d = new Date();
      var heure = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      var jour = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      function entete(sig, central){
        var b = new ArrayBuffer((central ? 46 : 30) + n.length), v = new DataView(b), k = 0;
        function m16(x){ v.setUint16(k, x, true); k += 2; }
        function m32(x){ v.setUint32(k, x >>> 0, true); k += 4; }
        m32(sig);
        if (central) m16(20);                                  // version qui a écrit l'archive
        m16(20); m16(0x0800); m16(8); m16(heure); m16(jour);  // version requise, noms en UTF-8, deflate, date
        m32(crc); m32(c.length); m32(u.length); m16(n.length); m16(0);
        if (central){ m16(0); m16(0); m16(0); m32(0); m32(0); } // commentaire, disque, attributs, position de l'entrée
        new Uint8Array(b, k).set(n);
        return new Uint8Array(b);
      }
      var loc = entete(0x04034b50, false), cen = entete(0x02014b50, true), fin = new DataView(new ArrayBuffer(22));
      fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, 1, true); fin.setUint16(10, 1, true);
      fin.setUint32(12, cen.length, true); fin.setUint32(16, loc.length + c.length, true);
      return new Blob([loc, c, cen, fin.buffer], { type: "application/zip" });
    });
  }
  // Premier .ifc d'une archive ZIP : promesse de { buf, nom }
  function dezipper(buf){
    var v = new DataView(buf), u = new Uint8Array(buf), i = buf.byteLength - 22;
    while (i >= 0 && v.getUint32(i, true) !== 0x06054b50) i--;
    if (i < 0) return Promise.reject(Object.assign(new Error("archive ZIP illisible"), { ifc: true }));
    var nb = v.getUint16(i + 10, true), p = v.getUint32(i + 16, true), dec = new TextDecoder();
    for (var k = 0; k < nb && p + 46 <= buf.byteLength && v.getUint32(p, true) === 0x02014b50; k++){
      var meth = v.getUint16(p + 10, true), taille = v.getUint32(p + 20, true), ln = v.getUint16(p + 28, true);
      var nom = dec.decode(u.subarray(p + 46, p + 46 + ln)), loc = v.getUint32(p + 42, true);
      p += 46 + ln + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
      if (!/\.ifc$/i.test(nom) || /(^|\/)__MACOSX\//.test(nom)) continue;
      var deb = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true), donnees = u.subarray(deb, deb + taille);
      nom = nom.split("/").pop();
      if (meth === 0) return Promise.resolve({ buf: donnees.slice().buffer, nom: nom });
      if (meth !== 8) return Promise.reject(Object.assign(new Error("archive compressée d'une façon que l'outil ne sait pas lire"), { ifc: true }));
      if (!zipPossible) return Promise.reject(Object.assign(new Error("ce navigateur ne sait pas décompresser les .ifczip ; décompresse-le d'abord"), { ifc: true }));
      return flux(donnees, new DecompressionStream("deflate-raw")).then(function(b){ return { buf: b, nom: nom }; });
    }
    return Promise.reject(Object.assign(new Error("l'archive ne contient pas de fichier .ifc"), { ifc: true }));
  }
  // Octets du .ifc d'un fichier choisi, décompressé au besoin : promesse de { buf, nom }
  function octetsIfc(fic){
    return lireFichier(fic).then(function(buf){
      var u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      return u[0] === 0x50 && u[1] === 0x4B ? dezipper(buf) : { buf: buf, nom: fic.name };
    });
  }

  // Lecture d'un fichier : en arrière-plan dans un Web Worker (ifc-lecteur.js), la page reste vivante ;
  // progres(0–1). Sans worker possible, lecture d'un coup comme avant.
  var avecWorker = typeof Worker !== "undefined";
  // découpe du fichier : module Rust compilé en WebAssembly (par défaut) ou lecteur JavaScript
  var lecteurVoulu = lire("ifc.lecteur", ["rust", "js"]);
  function lireClassique(fic){
    return octetsIfc(fic).then(function(x){ return pause().then(function(){ return IFC.lire(x.buf, x.nom); }); });
  }
  function lecture(fic, progres){
    if (!avecWorker) return lireClassique(fic);
    return octetsIfc(fic).then(function(x){
      var buf = x.buf;
      return new Promise(function(ok, ko){
        var w;
        try { w = new Worker("/ifc/ifc-lecteur.js?v=4"); }
        catch (e){ avecWorker = false; lireClassique(fic).then(ok, ko); return; }
        w.onmessage = function(e){
          var d = e.data;
          if (d.progres !== undefined){ progres(.7*d.progres); return; }
          w.terminate();
          if (d.erreur){ var err = new Error(d.erreur); err.ifc = d.ifc; ko(err); return; }
          // la page reconstruit le texte et fige les entités par tranches
          IFC.lireParEtapes(d.resultat, new Uint8Array(d.buffer), x.nom, function(p, etape){
            progres(etape === "texte" ? .7 + .1*p : .8 + .2*p);
          }).then(function(m){
            m.lecteur = d.resultat.lecteur; m.noteLecteur = d.resultat.noteLecteur; m.msLecteur = d.resultat.msLecteur;
            ok(m);
          }, ko);
        };
        w.onerror = function(e){
          // worker indisponible ou tombé (script bloqué, mémoire) : les octets lui ont été transférés,
          // on relit le fichier et on le lit d'un coup
          if (e && e.preventDefault) e.preventDefault();
          w.terminate(); avecWorker = false;
          lireClassique(fic).then(ok, ko);
        };
        w.postMessage({ buffer: buf, lecteur: lecteurVoulu }, [buf]);
      });
    });
  }
  function progresLecture(texte, p){
    $("#chargement-txt").textContent = texte;
    $("#prog").style.width = Math.round(100*p) + "%";
    if (fichiers.length) etat(texte);
  }

  // Travail découpé en tranches d'environ 40 ms : f(k) pour k de 0 à n − 1, la page reste vivante entre deux
  function parTranches(n, f, progres){
    return new Promise(function(ok){
      var i = 0;
      (function tranche(){
        var t0 = performance.now();
        while (i < n && performance.now() - t0 < 40) f(i++);
        progres(n ? i/n : 1);
        if (i < n) setTimeout(tranche, 0); else ok();
      })();
    });
  }
  // Après la lecture : fiches des éléments (nom, type, matériau) puis géométrie 3D, avec la barre de
  // progression ; l'ouverture n'a ensuite plus qu'à assembler ce qui est prêt.
  function preparer(modeles){
    var suite = Promise.resolve();
    modeles.forEach(function(m, n){
      var nom = "« " + m.nom + " »" + (modeles.length > 1 ? " (" + (n + 1) + "/" + modeles.length + ")" : ""), ids = [];
      suite = suite.then(function(){
        progresLecture("Liste des éléments de " + nom + "…", 0);
        return pause();
      }).then(function(){
        var a = IFC.arbre(m);
        return parTranches(a.length, function(k){
          var i = IFC.infos(m, a[k].id);
          if (i && i.vue3D) ids.push(a[k].id);
        }, function(p){ progresLecture("Liste des éléments de " + nom + " : " + Math.floor(100*p) + " %", p); });
      }).then(function(){
        return vue.preparer(m, ids, function(p){ progresLecture("Géométrie 3D de " + nom + " : " + pluriel(Math.round(p*ids.length), "élément") + " sur " + fmtN(ids.length), p); });
      });
    });
    return suite;
  }

  // Toutes les maquettes ouvertes (modifications comprises) deviennent une seule, à exporter ensuite
  function fusionnerTout(){
    if (fichiers.length < 2) return;
    var n = fichiers.length, base = fichiers.map(function(f){ return f.m.nom.replace(/\.ifc$/i, ""); }).join("+");
    var nom = "fusion_" + (base.length <= 60 ? base : n + "_maquettes") + ".ifc";
    if (!confirm("Les " + n + " maquettes ouvertes vont être remplacées par une seule, « " + nom + " », avec leurs modifications. " +
      "Rien n'est perdu tant que tu ne fermes pas la page sans exporter. Continuer ?")) return;
    var t0 = performance.now(), ms = fichiers.map(function(f){ return f.m; }), bilan = null;
    $("#chargement").hidden = false;
    progresLecture("Fusion des maquettes…", 0);
    pause().then(function(){
      return IFC.fusionner(ms, nom, function(p){ progresLecture("Fusion des maquettes : " + Math.floor(100*p) + " %", p); });
    }).then(function(r){
      bilan = r;
      return preparer([r.m]);
    }).then(function(){
      progresLecture("Affichage…", 1);
      return pause();
    }).then(function(){
      $("#chargement").hidden = true;
      vider();
      ouvrir([bilan.m], performance.now() - t0, []);
      fichiers[0].propre = -1;            // jamais exportée : comptée comme modifiée
      rendreListe(); maj();
      etat("Fusion de " + n + " maquettes : « " + nom + " », " + pluriel(bilan.m.ent.size, "entité") + ". Exporte-la avec Ctrl+S." +
        (bilan.unites ? " Attention : unités de longueur différentes (" + bilan.unites.map(function(u){ return u || "?"; }).join(", ") + "), les maquettes ne sont pas à la même échelle." : "") +
        (bilan.guidsDoubles ? " Attention : " + pluriel(bilan.guidsDoubles, "GlobalId en double", "GlobalId en double") + " (même maquette ouverte deux fois ?)." : ""));
    }).catch(function(err){
      $("#chargement").hidden = true;
      if (window.console) console.error(err);
      etat(err && err.ifc ? err.message : "Fusion impossible (" + (err && err.message || err) + ").");
    });
  }

  // Ajoute un ou plusieurs fichiers à ceux déjà ouverts
  function charger(liste){
    liste = [].slice.call(liste || []);
    if (!liste.length) return;
    erreur("");
    $("#chargement").hidden = false;
    progresLecture(liste.length > 1 ? "Lecture de " + liste.length + " fichiers…" : "Lecture du fichier…", 0);
    var ajoutes = [], refus = [], t0 = performance.now();
    // un fichier après l'autre, pour ne pas garder tous les octets en mémoire en même temps
    var suite = Promise.resolve();
    liste.forEach(function(fic, n){
      suite = suite.then(function(){
        var quoi = "Lecture de « " + fic.name + " »" + (liste.length > 1 ? " (" + (n + 1) + "/" + liste.length + ")" : "");
        progresLecture(quoi + "…", 0);
        return lecture(fic, function(p){ progresLecture(quoi + " : " + Math.floor(100*p) + " %", p); }).then(function(m){
          ajoutes.push(m);
        }).catch(function(err){
          if (window.console) console.error(err);
          refus.push("« " + fic.name + " » : " + (err && err.ifc ? err.message : "lecture impossible (" + (err && err.message || err) + ")"));
        });
      });
    });
    suite.then(function(){
      if (!ajoutes.length) return;
      return preparer(ajoutes).then(function(){
        progresLecture("Affichage…", 1);
        return pause();
      });
    }).then(function(){
      $("#chargement").hidden = true;
      if (ajoutes.length && remplacer) vider();
      remplacer = false;
      if (ajoutes.length) ouvrir(ajoutes, performance.now() - t0, refus);
      else if (fichiers.length) etat("Fichier refusé. " + refus.join(" "));
      else erreur(refus.join(" "));
    });
  }

  function ouvrir(modeles, ms, refus){
    var premier = !fichiers.length;
    modeles.forEach(function(m){
      // arborescence réduite à l'ouverture (demande de Tony) : seule la ligne du fichier est affichée
      var f = { uid: uidSuivant++, m: m, propre: m.version, visible: true, plie: true, teinte: null, taille: { v: -1, t: 0 }, unite: uniteMesure(m), carte: conversionCarte(m) };
      fichiers.push(f); parUid.set(f.uid, f);
    });
    vue.modeles(fichiers.map(function(f){ return f.m; }));
    modeEditeur(true);
    if (premier){ $("#recherche").value = ""; $("#filtre-type").value = ""; }
    reconstruire();
    vue.redessiner();
    majRepere();
    if (premier) vue.orienter(angleProjet + Math.PI/4, PLONGEE_MAISON); else vue.recadrer();
    var ent = 0;
    modeles.forEach(function(m){ ent += m.nbOrigine; });
    var nom = modeles.length === 1 ? "« " + modeles[0].nom + " »" : pluriel(modeles.length, "fichier");
    var doublons = modeles.filter(function(m){ return m.doublons; }).length;
    var lect = modeles.map(function(m){ return m.lecteur; }).filter(Boolean), notes = modeles.map(function(m){ return m.noteLecteur; }).filter(Boolean);
    var decoupe = modeles.reduce(function(t, m){ return t + (m.msLecteur || 0); }, 0);
    var parLecteur = lect.length ? " · découpe " + (lect.every(function(x){ return x === "rust"; }) ? "Rust" : lect.every(function(x){ return x === "js"; }) ? "JavaScript" : "Rust et JavaScript") +
      " en " + fmtN(Math.max(1, decoupe)) + " ms" + (notes.length ? " (" + notes[0] + ")" : "") : "";
    etat(nom + " lu" + (modeles.length > 1 ? "s" : "") + " : " + pluriel(ent, "entité") + ", en " + fmtN(Math.max(1, Math.round(ms))) + " ms" + parLecteur +
      (doublons ? " (attention : identifiants en double dans " + pluriel(doublons, "fichier") + ", seule la première entité a été gardée)" : "") + "." +
      (refus && refus.length ? " Refusé" + (refus.length > 1 ? "s" : "") + " : " + refus.join(" ") : ""));
    if (premier) window.scrollTo(0, 0);
    if (geoVoulue === "webifc") calculerWebIfc();
  }

  // ================= Géométrie web-ifc =================
  // Calculée dans un Web Worker (ifc-webifc.js) à partir du fichier tel qu'il est maintenant, un fichier
  // après l'autre ; un élément que web-ifc ne rend pas garde la géométrie de l'outil.
  function geometrieWebIfc(f, progres){
    return new Promise(function(ok, ko){
      var w;
      try { w = new Worker("/ifc/ifc-webifc.js?v=2"); } catch (e){ ko(e); return; }
      var carte = new Map(), couleurs = new Map();
      w.onmessage = function(e){
        var d = e.data;
        if (d.progres !== undefined) progres(d.progres);
        else if (d.lot) d.lot.forEach(function(id, i){
          var avant = carte.get(id), T = d.tri[i];
          if (avant){ var u = new Float64Array(avant.length + T.length); u.set(avant); u.set(T, avant.length); T = u; }
          carte.set(id, T);
          if (d.coul && d.coul[i] && !couleurs.has(id)) couleurs.set(id, d.coul[i]);
        });
        else { w.terminate(); if (d.erreur) ko(new Error(d.erreur)); else ok({ carte: carte, couleurs: couleurs }); }
      };
      w.onerror = function(e){
        if (e && e.preventDefault) e.preventDefault();
        w.terminate();
        ko(new Error(e && e.message || "web-ifc n'a pas pu démarrer"));
      };
      var oct = IFC.versOctets(IFC.ecrire(f.m));
      w.postMessage({ buffer: oct.buffer }, [oct.buffer]);
    });
  }
  var enCalcul = false, echecsWebIfc = new Set();
  function calculerWebIfc(){
    if (enCalcul || geoVoulue !== "webifc") return;
    var f = fichiers.filter(function(x){ return !vue.aExterne(x.m) && !echecsWebIfc.has(x.m); })[0];
    if (!f) return;
    enCalcul = true;
    var quoi = "web-ifc : géométrie de « " + f.m.nom + " »";
    etat(quoi + ", chargement du moteur…");
    geometrieWebIfc(f, function(p){ etat(quoi + " : " + Math.floor(100*p) + " %"); }).then(function(r){
      var info = parUid.has(f.uid) ? vue.geometriesExternes(f.m, r.carte, r.couleurs) : null;
      if (!info) return;
      if (geoVoulue === "webifc") majVue();
      etat(quoi + " : " + pluriel(info.elements, "élément calculé", "éléments calculés") +
        (info.couleurs ? ", couleurs du fichier reprises" : "") +
        (info.ecart > .05 ? " (calage incertain : des éléments peuvent être décalés, repasse sur le lecteur de l'outil au besoin)" : "") + ".");
    }).catch(function(err){
      if (window.console) console.error(err);
      echecsWebIfc.add(f.m);
      etat(quoi + " impossible (" + (err && err.message || err) + ") : la géométrie de l'outil reste affichée.");
    }).then(function(){
      enCalcul = false;
      calculerWebIfc();
    });
  }

  function fermer(f){
    if (modifie(f) && !confirm("Les modifications non exportées de « " + f.m.nom + " » seront perdues. Fermer quand même ?")) return;
    fichiers = fichiers.filter(function(x){ return x !== f; });
    parUid.delete(f.uid);
    // l'historique oublie ce fichier
    [histo, aRefaire].forEach(function(pile){
      for (var i = pile.length - 1; i >= 0; i--){
        pile[i].parts = pile[i].parts.filter(function(p){ return p.f !== f; });
        if (!pile[i].parts.length) pile.splice(i, 1);
      }
    });
    vue.modeles(fichiers.map(function(x){ return x.m; }));
    if (!fichiers.length){
      choix = new Set(); caches = new Set(); plies = new Set(); actif = ""; lignes = [];
      modeEditeur(false);
      etat("");
      window.scrollTo(0, 0);
      return;
    }
    reconstruire();
    majRepere();
    vue.recadrer();
    etat("« " + f.m.nom + " » fermé.");
  }

  // ================= Liste des éléments =================
  // Unité de longueur : symbole et longueur en mètres ; nom IFC (« MILLIMETRE », « FOOT »…)
  function uniteDe(u){
    u = (u || "").trim().toUpperCase().replace(/METERS?$|METRES$/, "METRE");
    u = { M: "METRE", MM: "MILLIMETRE", CM: "CENTIMETRE", DM: "DECIMETRE", KM: "KILOMETRE", FT: "FOOT", IN: "INCH" }[u] || u;
    if (u === "MILLIMETRE") return { nom: "mm", f: .001 };
    if (u === "CENTIMETRE") return { nom: "cm", f: .01 };
    if (u === "DECIMETRE") return { nom: "dm", f: .1 };
    if (u === "METRE") return { nom: "m", f: 1 };
    if (u === "KILOMETRE") return { nom: "km", f: 1000 };
    if (/FOOT|FEET/.test(u)) return { nom: "ft", f: .3048 };
    if (/INCH/.test(u)) return { nom: "in", f: .0254 };
    return { nom: "", f: 1 };
  }
  function uniteMesure(m){ return uniteDe(IFC.uniteLongueur(m)); }
  // Géoréférencement (IFC4 IfcMapConversion, IFC4X3 IfcMapConversionScaled, IFC2X3 jeux de propriétés
  // ePset_MapConversion et ePset_ProjectedCRS) : origine E N H en unités de la carte, rotation de l'axe X,
  // échelles ; fu : mètres par unité de la carte (MapUnit du système de coordonnées, mètre sinon)
  function nomUniteIfc(m, u){
    var b = IFC.champs(u);
    return u.type === "IFCSIUNIT" ? ((b[2] && b[2].enu) || "") + ((b[3] && b[3].enu) || "") : IFC.chaine(b[2]);
  }
  function conversionCarte(m){
    var r = null, up = uniteMesure(m).f;
    function n(v, d){ var x = IFC.nombre(v); return isFinite(x) ? x : d; }
    function repere(E, N, H, xa, xo, k, fx, fy, fz, fu, nom, source){
      var l = Math.hypot(xa, xo) || 1;
      return { E: E, N: N, H: H, c: xa/l, s: xo/l, kx: k*fx, ky: k*fy, kz: k*fz, fu: fu, crs: nom, source: source };
    }
    m.ent.forEach(function(e){
      if (r || (e.type !== "IFCMAPCONVERSION" && e.type !== "IFCMAPCONVERSIONSCALED")) return;
      var a = IFC.champs(e), crs = m.ent.get(IFC.idRef(a[1])), fu = 1, nom = "";
      if (crs && crs.type === "IFCPROJECTEDCRS"){
        var c = IFC.champs(crs), u = m.ent.get(IFC.idRef(c[6]));
        nom = IFC.chaine(c[0]);
        if (u) fu = uniteDe(nomUniteIfc(m, u)).f;
      }
      // sans Scale : passage des unités du projet à celles de la carte
      var sc = e.type === "IFCMAPCONVERSIONSCALED";
      r = repere(n(a[2], 0), n(a[3], 0), n(a[4], 0), n(a[5], 1), n(a[6], 0), n(a[7], up/fu),
        sc ? n(a[8], 1) : 1, sc ? n(a[9], 1) : 1, sc ? n(a[10], 1) : 1, fu, nom, "IfcMapConversion");
    });
    if (r) return r;
    // IFC2X3 : propriétés { nom : { v, unite } } des jeux ePset_MapConversion et ePset_ProjectedCRS
    var jeux = {};
    m.ent.forEach(function(e){
      if (e.type !== "IFCPROPERTYSET") return;
      var a = IFC.champs(e), nj = IFC.chaine(a[2]).toLowerCase();
      if (nj !== "epset_mapconversion" && nj !== "epset_projectedcrs") return;
      var j = jeux[nj] || (jeux[nj] = {});
      (Array.isArray(a[4]) ? a[4] : []).forEach(function(ref){
        var pe = m.ent.get(IFC.idRef(ref));
        if (!pe || pe.type !== "IFCPROPERTYSINGLEVALUE") return;
        var b = IFC.champs(pe);
        j[IFC.chaine(b[0]).toLowerCase()] = { v: b[2], unite: m.ent.get(IFC.idRef(b[3])) };
      });
    });
    var mc = jeux.epset_mapconversion, pc = jeux.epset_projectedcrs || {};
    if (!mc || (!mc.eastings && !mc.northings)) return null;
    var fu = 1, mu = pc.mapunit;
    if (mu) fu = uniteDe(mu.unite ? nomUniteIfc(m, mu.unite) : IFC.chaine(mu.v)).f;
    function val(k, d){ return mc[k] ? n(mc[k].v, d) : d; }
    return repere(val("eastings", 0), val("northings", 0), val("orthogonalheight", 0), val("xaxisabscissa", 1), val("xaxisordinate", 0),
      val("scale", up/fu), 1, 1, 1, fu, pc.name ? IFC.chaine(pc.name.v) : "", "ePset_MapConversion");
  }
  function reconstruire(){
    vue.formats(formatsMesure());
    lignes = [];
    fichiers.forEach(function(f){
      lignes.push({ fichier: f });
      IFC.arbre(f.m).forEach(function(l){
        var i = IFC.infos(f.m, l.id);
        lignes.push({ cle: cle(f, l.id), f: f, id: l.id, niv: l.niv, i: i,
          rech: [nomAff(i), i.typeLib, i.type, i.materiau, i.globalId, i.tag, i.objectType, "#" + i.id].join(" ").toLowerCase() });
      });
    });
    lignes.forEach(function(l, k){ var n = lignes[k + 1]; l.enfants = !l.fichier && !!n && !n.fichier && n.niv > l.niv; });
    choix.forEach(function(c){ if (!existe(c)) choix.delete(c); });
    caches.forEach(function(c){ if (!existe(c)) caches.delete(c); });
    plies.forEach(function(c){ if (!existe(c)) plies.delete(c); });
    if (actif && !existe(actif)) actif = "";
    calculerCouleurs();
    remplirTypes();
    rendreListe();
    infoVue(vue.afficher(itemsVue()));
    afficherProps();
    maj();
  }

  function remplirTypes(){
    var sel = $("#filtre-type"), avant = sel.value, compte = {};
    lignes.forEach(function(l){ if (l.i && l.i.supprimable) compte[l.i.type] = (compte[l.i.type] || 0) + 1; });
    var types = Object.keys(compte).sort(function(a, b){ return IFC.nomType(a).localeCompare(IFC.nomType(b)); });
    sel.innerHTML = '<option value="">Tous les types</option>' + types.map(function(t){
      return '<option value="' + esc(t) + '">' + esc(IFC.nomType(t)) + " (" + compte[t] + ")</option>";
    }).join("");
    sel.value = compte[avant] ? avant : "";
  }

  function enteteFichier(f){
    var m = f.m;
    return '<div class="fic' + (f.visible ? "" : " masque") + (f.plie ? " plie" : "") + (modifie(f) ? " modifie" : "") + '" data-fic="' + f.uid + '">' +
      '<button type="button" class="fic-oeil" data-act="voir" aria-pressed="' + f.visible + '" title="' + (f.visible ? "Masquer" : "Afficher") + ' dans la vue 3D">' + (f.visible ? "◉" : "○") + "</button>" +
      '<div><div class="el-nom"><span class="pli" aria-hidden="true">▾</span> ' + (f.teinte != null ? '<span class="fic-teinte" style="--t:' + pastille(f.teinte) + '"></span>' : "") + esc(m.nom) + '</div><div class="el-info">' +
      esc(m.schema + " · " + fmtN(m.nbOrigine) + (m.ent.size !== m.nbOrigine ? " → " + fmtN(m.ent.size) : "") + " entités · " + fmtTaille(tailleDe(f))) + "</div></div>" +
      '<span class="fic-act"><button type="button" data-act="export" title="Exporter ce fichier">Exporter</button>' +
      '<button type="button" class="fermer" data-act="fermer" title="Fermer ce fichier" aria-label="Fermer ' + esc(m.nom) + '">×</button></span></div>';
  }

  // Lignes affichées : { f } pour un en-tête de fichier, { l, pli, plie, filtre } pour un élément.
  // Au-delà de VIRTUEL lignes, seule la partie visible (et une marge) existe dans la page : deux cales
  // vides tiennent la place du reste, et le défilement redessine la fenêtre.
  var visibles = [], rangs = [], VIRTUEL = 1500, MARGE = 800, hauts = { el: 46, fic: 62 }, fenetre = null, totalH = 0;
  function rendreListe(){
    var q = $("#recherche").value.trim().toLowerCase(), t = $("#filtre-type").value, filtre = !!(q || t);
    var f = null, seuil = Infinity;
    visibles = []; rangs = [];
    lignes.forEach(function(l){
      if (l.fichier){
        f = l.fichier; seuil = Infinity;
        rangs.push({ f: f });
        return;
      }
      if (f.plie && !filtre) return;     // une recherche fouille aussi les maquettes réduites
      var i = l.i, pli = "";
      if (!filtre){
        // un nœud replié cache tout ce qui est plus profond que lui
        if (l.niv > seuil) return;
        seuil = l.enfants && plies.has(l.cle) ? l.niv : Infinity;
        pli = l.enfants ? '<span class="pli" data-pli title="Réduire ou développer">▾</span>' : '<span class="pli" aria-hidden="true"></span>';
      }
      if (filtre){
        if (!i.supprimable) return;
        if (t && i.type !== t) return;
        if (q && l.rech.indexOf(q) < 0) return;
      }
      if (i.supprimable) visibles.push(l.cle);
      rangs.push({ l: l, pli: pli, plie: !!pli && seuil === l.niv, filtre: filtre });
    });
    placer();
    fenetre = null;
    peindre();
  }
  function htmlRang(r){
    if (r.f) return enteteFichier(r.f);
    var l = r.l, i = l.i, c = choix.has(l.cle);
    var info = [i.typeLib, i.materiau, "#" + i.id].filter(Boolean).join(" · ");
    return '<div class="el ' + i.genre + (c ? " choisi" : "") + (caches.has(l.cle) ? " cache" : "") + (l.cle === actif ? " actif" : "") + (r.plie ? " plie" : "") + '" role="listitem" data-cle="' + l.cle +
      '" style="--niv:' + (r.filtre ? 0 : Math.min(l.niv, 8)) + '">' +
      (i.supprimable ? '<input type="checkbox" aria-label="Sélectionner ' + esc(nomAff(i)) + '"' + (c ? " checked" : "") + ">" : '<span class="vide"></span>') +
      '<div><div class="el-nom">' + r.pli + esc(nomAff(i)) + '</div><div class="el-info">' + esc(info) + "</div></div></div>";
  }
  // position verticale de chaque ligne, d'après les hauteurs mesurées
  function placer(){
    var y = 0;
    rangs.forEach(function(r){ r.y = y; y += r.f ? hauts.fic : hauts.el; });
    totalH = y;
  }
  function virtuelle(){ return rangs.length > VIRTUEL; }
  function rangA(y){      // première ligne qui finit après y
    var a = 0, b = rangs.length - 1;
    while (a < b){ var k = (a + b) >> 1, r = rangs[k]; if (r.y + (r.f ? hauts.fic : hauts.el) <= y) a = k + 1; else b = k; }
    return a;
  }
  function peindre(){
    var z = $("#liste");
    if (!rangs.length){ z.innerHTML = '<p class="liste-vide">Aucun élément ne correspond.</p>'; return; }
    if (!virtuelle()){ z.innerHTML = rangs.map(htmlRang).join(""); return; }
    var st = z.scrollTop, k0 = rangA(Math.max(0, st - MARGE)), k1 = rangA(st + (z.clientHeight || window.innerHeight) + MARGE);
    if (fenetre && fenetre[0] === k0 && fenetre[1] === k1) return;
    fenetre = [k0, k1];
    var fin = rangs[k1].y + (rangs[k1].f ? hauts.fic : hauts.el);
    z.innerHTML = '<div class="cale" style="height:' + rangs[k0].y + 'px"></div>' + rangs.slice(k0, k1 + 1).map(htmlRang).join("") +
      '<div class="cale" style="height:' + Math.max(0, totalH - fin) + 'px"></div>';
    z.scrollTop = st;
    // hauteurs réelles (thème, écran étroit) : on corrige une fois si l'estimation était fausse
    var e = z.querySelector(".el"), fi = z.querySelector(".fic"), neuf = false;
    if (e){ var he = e.getBoundingClientRect().height; if (he && Math.abs(he - hauts.el) > .5){ hauts.el = he; neuf = true; } }
    if (fi){ var hf = fi.getBoundingClientRect().height + (parseFloat(getComputedStyle(fi).marginTop) || 0); if (hf && Math.abs(hf - hauts.fic) > .5){ hauts.fic = hf; neuf = true; } }
    if (neuf){ placer(); fenetre = null; peindre(); }
  }
  var peinture = 0;
  $("#liste").addEventListener("scroll", function(){
    if (!virtuelle() || peinture) return;
    peinture = requestAnimationFrame(function(){ peinture = 0; peindre(); });
  });
  window.addEventListener("resize", function(){ if (virtuelle()) peindre(); });
  // Amène la ligne d'un élément dans la zone visible de la liste
  function defilerVers(c){
    if (!virtuelle()){
      var r = $('#liste [data-cle="' + c + '"]');
      if (r) r.scrollIntoView({ block: "nearest" });
      return;
    }
    var k = -1;
    for (var j = 0; j < rangs.length; j++) if (rangs[j].l && rangs[j].l.cle === c){ k = j; break; }
    if (k < 0) return;
    var z = $("#liste"), y = rangs[k].y, h = hauts.el;
    if (y < z.scrollTop) z.scrollTop = y;
    else if (y + h > z.scrollTop + z.clientHeight) z.scrollTop = y + h - z.clientHeight + 8;
    peindre();
  }

  // Met à jour cases et surbrillances sans reconstruire la liste
  function majLignes(){
    [].forEach.call($("#liste").children, function(r){
      var c = r.getAttribute("data-cle");
      if (!c) return;
      var oui = choix.has(c);
      r.classList.toggle("choisi", oui);
      r.classList.toggle("actif", c === actif);
      r.classList.toggle("cache", caches.has(c));
      var cb = r.querySelector("input");
      if (cb) cb.checked = oui;
    });
  }

  function supprimable(c){ var d = lireCle(c), i = d.f && IFC.infos(d.f.m, d.id); return !!(i && i.supprimable); }
  function avecEnfants(c){
    var d = lireCle(c);
    return [c].concat(IFC.descendants(d.f.m, d.id).map(function(id){ return cle(d.f, id); }));
  }
  // Cocher un assemblage coche ses enfants (IFCRELAGGREGATES)
  function cocher(c, oui){
    avecEnfants(c).forEach(function(x){
      if (!supprimable(x)) return;
      if (oui) choix.add(x); else choix.delete(x);
    });
  }
  function activer(c, defiler){
    actif = c;
    majLignes();
    afficherProps();
    maj();
    if (defiler) defilerVers(c);
  }
  function cliqueVue(c){
    if (!c) return;
    var d = lireCle(c), i = d.f && IFC.infos(d.f.m, d.id);
    if (!i) return;
    if (choix.has(c)){ choix.delete(c); etat("« " + nomAff(i) + " » retiré de la sélection."); }
    else if (i.supprimable){ choix.add(c); etat("« " + nomAff(i) + " » ajouté à la sélection."); }
    // déplie le fichier et les parents si besoin, pour retrouver l'élément dans la liste
    if (deplierVers(c)) rendreListe();
    if (choix.has(c)) activer(c, true);
    // site ou bâtiment (terrain) : pas de sélection pour suppression, mais on l'active pour voir ses propriétés
    else if (!i.supprimable && actif !== c){ activer(c, true); etat("« " + nomAff(i) + " » : structure spatiale, non supprimable."); }
    else oublierActif();
  }
  // Un élément désélectionné ne reste pas affiché dans Propriétés
  function oublierActif(){
    if (actif && !choix.has(actif)) actif = "";
    majLignes(); afficherProps(); maj();
  }

  $("#liste").addEventListener("click", function(e){
    var fic = e.target.closest(".fic");
    if (fic){
      var f = parUid.get(+fic.getAttribute("data-fic")), b = e.target.closest("[data-act]"), act = b && b.getAttribute("data-act");
      if (!f) return;
      if (act === "voir") basculerVisible(f);
      else if (act === "export") exporter(f);
      else if (act === "fermer") fermer(f);
      else { f.plie = !f.plie; rendreListe(); }
      return;
    }
    var r = e.target.closest(".el");
    if (!r) return;
    var c = r.getAttribute("data-cle");
    if (e.target.closest("[data-pli]")){ if (plies.has(c)) plies.delete(c); else plies.add(c); rendreListe(); return; }
    if (e.target.tagName === "INPUT"){ cocher(c, e.target.checked); if (e.target.checked) activer(c, false); else oublierActif(); return; }
    activer(c, false);
  });
  $("#recherche").addEventListener("input", function(){ rendreListe(); maj(); });
  $("#filtre-type").addEventListener("change", function(){ rendreListe(); maj(); });
  $("#sel-tout").addEventListener("click", function(){
    visibles.forEach(function(c){ cocher(c, true); });
    majLignes(); maj();
  });
  $("#sel-rien").addEventListener("click", function(){
    visibles.forEach(function(c){ choix.delete(c); });
    oublierActif();
  });
  $("#sel-inv").addEventListener("click", function(){
    visibles.forEach(function(c){ if (choix.has(c)) choix.delete(c); else choix.add(c); });
    oublierActif();
  });

  // ================= Arborescence : réduire, développer, couleur des maquettes =================
  var TEINTES = [[0, "rouge"], [24, "orange"], [48, "jaune"], [90, "vert tilleul"], [135, "vert"], [165, "menthe"], [188, "turquoise"],
    [210, "bleu"], [236, "indigo"], [262, "lavande"], [290, "violet"], [326, "rose"]];
  function pastille(h){ return "hsl(" + h + " 62% 70%)"; }
  function nomTeinte(h){
    if (h == null) return "couleur par défaut";
    var t = TEINTES.filter(function(x){ return x[0] === h; })[0];
    return t ? t[1] : "teinte " + h + "°";
  }
  function teinteDe(hex){     // #rrvvbb → teinte 0–360
    var r = parseInt(hex.substr(1, 2), 16)/255, g = parseInt(hex.substr(3, 2), 16)/255, b = parseInt(hex.substr(5, 2), 16)/255;
    var mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    if (!d) return 0;
    var h = mx === r ? ((g - b)/d + 6) % 6 : mx === g ? (b - r)/d + 2 : (r - g)/d + 4;
    return Math.round(h*60) % 360;
  }
  function indexDe(c){ for (var k = 0; k < lignes.length; k++) if (lignes[k].cle === c) return k; return -1; }
  function indexFichier(f){ for (var k = 0; k < lignes.length; k++) if (lignes[k].fichier === f) return k; return -1; }
  // lignes sous un nœud, ou tout le contenu d'un fichier
  function sousLignes(k){
    var l = lignes[k], r = [];
    for (var j = k + 1; j < lignes.length && !lignes[j].fichier && (l.fichier || lignes[j].niv > l.niv); j++) r.push(lignes[j]);
    return r;
  }
  function plierTout(liste, oui){ liste.forEach(function(x){ if (x.enfants){ if (oui) plies.add(x.cle); else plies.delete(x.cle); } }); }
  // déplie le fichier et les parents d'un élément ; vrai si quelque chose a changé
  function deplierVers(c){
    var k = indexDe(c), change = false;
    if (k < 0) return false;
    for (var j = k - 1, niv = lignes[k].niv; j >= 0 && !lignes[j].fichier; j--){
      if (lignes[j].niv < niv){ if (plies.delete(lignes[j].cle)) change = true; niv = lignes[j].niv; }
    }
    if (lignes[k].f.plie){ lignes[k].f.plie = false; change = true; }
    return change;
  }
  function basculerVisible(f){
    f.visible = !f.visible;
    reconstruire();
    etat("« " + f.m.nom + " » " + (f.visible ? "affiché" : "masqué") + " dans la vue 3D.");
  }
  function teinter(f, h){
    f.teinte = h;
    rendreListe(); majVue();
    etat("« " + f.m.nom + " » : " + nomTeinte(h) + ".");
  }
  // ---------- Phases Revit : couleur de la phase existante et de la phase nouvelle construction, par maquette ----------
  // Nouvelle construction : propriété « Phase de création » / « Phase Created » = New Construction / Nouvelle
  // construction (export Revit), ou jeu STR_FGH_STR Nouveau = 1 (« Export IFC RES ») ; tout le reste est existant.
  var PHASE_NOM = /^phase (de cr[ée]ation|created)$/i, PHASE_NEUVE = /new construction|nouv/i;
  function neufsDe(m){
    var neufs = new Set(), psets = new Set();
    m.ent.forEach(function(e){
      if (e.type !== "IFCPROPERTYSET") return;
      var nom = IFC.chaine(IFC.champs(e)[2]);
      IFC.refsListe(IFC.champs(e)[4]).forEach(function(r){
        var x = m.ent.get(r);
        if (!x || x.type !== "IFCPROPERTYSINGLEVALUE") return;
        var n = IFC.chaine(IFC.champs(x)[0]), v = IFC.chaine(IFC.champs(x)[2]);
        if (nom === "STR_FGH_STR" ? n === "Nouveau" && v === "1" : PHASE_NOM.test(n) && PHASE_NEUVE.test(v)) psets.add(e.id);
      });
    });
    if (psets.size) m.ent.forEach(function(e){
      if (e.type === "IFCRELDEFINESBYPROPERTIES" && psets.has(IFC.idRef(IFC.champs(e)[5]))) IFC.refsListe(IFC.champs(e)[4]).forEach(function(id){ neufs.add(id); });
    });
    return neufs;
  }
  function neufs(f){ if (!f.neufs) f.neufs = neufsDe(f.m); return f.neufs; }
  // teinte d'un élément : celle de sa phase si elle est choisie, sinon celle de la maquette
  function teinteElement(f, id){
    if (teintesCat){ var hc = teintesCat.get(cle(f, id)); return hc === undefined ? null : hc; }
    var p = f.phases;
    if (p){ var t = neufs(f).has(id) ? p.neuf : p.existant; if (t !== undefined) return t; }
    return f.teinte;
  }
  var NOM_PHASE = { existant: "phase existante", neuf: "phase nouvelle construction" };
  // h : teinte 0–360, null (couleur par défaut) ou undefined (comme la maquette)
  function teinterPhase(f, quoi, h){
    if (!f.phases) f.phases = {};
    f.phases[quoi] = h;
    majVue();
    etat("« " + f.m.nom + " », " + NOM_PHASE[quoi] + " : " + (h === undefined ? "comme la maquette" : nomTeinte(h)) + ".");
  }

  // ---------- Actions de vue sur des éléments : masquer, isoler, zoomer, boîte de coupe ----------
  function quoiDe(cles){
    if (cles.length !== 1) return pluriel(cles.length, "élément");
    var d = lireCle(cles[0]);
    return "« " + nomAff(IFC.infos(d.f.m, d.id)) + " »";
  }
  function masquerCles(c){
    c.forEach(function(x){ caches.add(x); });
    majVue();
    etat(pluriel(c.length, "élément masqué", "éléments masqués") + " dans la vue 3D (Maj+H pour tout afficher).");
  }
  function isolerCles(liste){
    var c = new Set(liste), n = 0;
    caches = new Set();
    lignes.forEach(function(l){ if (l.i && l.i.vue3D && !c.has(l.cle)){ caches.add(l.cle); n++; } });
    majVue();
    etat(pluriel(c.size, "élément isolé", "éléments isolés") + ", " + fmtN(n) + " masqués.");
  }
  function zoomerCles(c){ if (vue.cadrer(c)) etat("Zoom sur " + quoiDe(c) + "."); }
  function couperCles(c){
    if (vue.coupe(c)) etat("Boîte de coupe autour de " + quoiDe(c) + " : les autres pièces restent visibles dedans (Maj+B pour la retirer).");
    maj();
  }
  function sansCoupe(){ vue.coupe(null); etat("Boîte de coupe retirée."); maj(); }
  function degres(a){ return (a*180/Math.PI).toFixed(1).replace(".", ",").replace(/,0$/, "") + "°"; }
  // Boîte de coupe tournée autour de la verticale pour suivre la face visée (maquette géoréférencée, bâtiment
  // de biais) : la boîte en place tourne sur son centre, sinon une boîte alignée est posée autour des éléments c
  function alignerCoupe(ang, c){
    if (ang == null) return;
    if (vue.aCoupe()){ vue.orienterCoupe(ang); etat("Boîte de coupe alignée sur la face (" + degres(ang) + ")."); }
    else { vue.orienterCoupe(ang); if (vue.coupe(c)) etat("Boîte de coupe autour de " + quoiDe(c) + ", alignée sur la face (" + degres(ang) + ")."); }
    maj();
  }
  function equerreCoupe(){ vue.orienterCoupe(0); etat("Boîte de coupe remise d'équerre avec les axes du fichier."); maj(); }
  function actionVue(a, c){
    if (!c.length) return false;
    if (a === "masquer") masquerCles(c);
    else if (a === "isoler") isolerCles(c);
    else if (a === "zoomer") zoomerCles(c);
    else if (a === "coupe") couperCles(c);
    else return false;
    return true;
  }
  function boutonsVue(c, sansMasquer){
    var q = c.length > 1 ? " (" + fmtN(c.length) + ")" : "";
    return (sansMasquer ? [] : [bouton("masquer", "Masquer" + q)]).concat([bouton("isoler", "Isoler" + q),
      bouton("zoomer", "Zoomer dessus"), bouton("coupe", "Boîte de coupe autour")]).join("");
  }

  // ---------- Menu contextuel (clic droit ou appui long) ----------
  var ctx = $("#ctx"), cible = null, teinteLibre = $("#teinte-libre"), cibleTeinte = null;
  function bouton(act, txt, classe){
    return '<button type="button" role="menuitem" data-ctx="' + act + '"' + (classe ? ' class="' + classe + '"' : "") + "><span>" + esc(txt) + "</span><kbd></kbd></button>";
  }
  function ouvrirCtx(x, y, c){
    var f = c.f, l = c.l, noeud = !l.fichier, h = [];
    h.push('<div class="ctx-titre">' + esc(noeud ? nomAff(l.i) : f.m.nom) + "</div>");
    if (!noeud){
      h.push(f.plie ? bouton("developper", "Développer la maquette") : bouton("reduire", "Réduire la maquette"));
      h.push(bouton("developper-tout", "Développer tout son contenu"), bouton("reduire-contenu", "Réduire tout son contenu"));
    } else if (l.enfants){
      h.push(plies.has(l.cle) ? bouton("developper", "Développer") : bouton("reduire", "Réduire"));
      h.push(bouton("developper-tout", "Développer tout"), bouton("reduire-tout", "Réduire tout"));
    }
    if (noeud && l.i.supprimable) h.push("<hr>", bouton("selectionner", l.enfants ? "Sélectionner avec son contenu" : "Sélectionner"));
    if (noeud && l.i.supprimable && l.i.genre !== "spatial") h.push(bouton("similaires", "Sélectionner similaires…"));
    if (choix.size) h.push(noeud && l.i.supprimable ? "" : "<hr>", bouton("rien", "Tout désélectionner" + (choix.size > 1 ? " (" + fmtN(choix.size) + ")" : "")));
    c.cles = elementsDe([l].concat(sousLignes(c.k)).filter(function(x){ return x.i && x.f.visible; }).map(function(x){ return x.cle; }));
    if (c.cles.length) h.push("<hr>", '<div class="mb-sous">Vue 3D</div>', boutonsVue(c.cles, !noeud));
    h.push("<hr>", '<div class="mb-sous">Couleur de la maquette</div><div class="teintes">' +
      '<button type="button" role="menuitemradio" class="defaut" data-ctx="teinte" data-h="" aria-checked="' + (f.teinte == null) + '" title="Couleur par défaut" aria-label="Couleur par défaut"></button>' +
      TEINTES.map(function(t){
        return '<button type="button" role="menuitemradio" data-ctx="teinte" data-h="' + t[0] + '" aria-checked="' + (f.teinte === t[0]) + '" style="--t:' + pastille(t[0]) + '" title="' + t[1] + '" aria-label="' + t[1] + '"></button>';
      }).join("") +
      '<button type="button" role="menuitem" class="autre" data-ctx="autre" title="Autre couleur…" aria-label="Autre couleur"></button></div>');
    // couleurs des phases, quand la maquette porte une phase nouvelle construction
    if (neufs(f).size) ["existant", "neuf"].forEach(function(q){
      var cur = f.phases ? f.phases[q] : undefined;
      h.push('<div class="mb-sous">Phase ' + (q === "neuf" ? "nouvelle construction" : "existante") + '</div><div class="teintes">' +
        '<button type="button" role="menuitemradio" class="defaut" data-ctx="teinte-phase" data-q="' + q + '" data-h="m" aria-checked="' + (cur === undefined) + '" title="Comme la maquette" aria-label="Comme la maquette"></button>' +
        TEINTES.map(function(t){
          return '<button type="button" role="menuitemradio" data-ctx="teinte-phase" data-q="' + q + '" data-h="' + t[0] + '" aria-checked="' + (cur === t[0]) + '" style="--t:' + pastille(t[0]) + '" title="' + t[1] + '" aria-label="' + t[1] + '"></button>';
        }).join("") +
        '<button type="button" role="menuitem" class="autre" data-ctx="autre-phase" data-q="' + q + '" title="Autre couleur…" aria-label="Autre couleur"></button></div>');
    });
    if (!noeud) h.push("<hr>", bouton("voir", f.visible ? "Masquer dans la vue 3D" : "Afficher dans la vue 3D"), bouton("export", "Exporter ce fichier"), bouton("fermer", "Fermer ce fichier", "danger"));
    h.push("<hr>", bouton("tout-reduire", "Tout réduire"), bouton("tout-developper", "Tout développer"));
    montrerCtx(x, y, h, c);
  }
  // Clic droit dans la vue 3D : sur l'élément visé, ou sur la sélection s'il en fait partie
  function menuVue(cl, x, y){
    if (!fichiers.length) return;
    var c = [], h = [], ang = null;
    if (cl){
      c = choix.has(cl) ? elementsDe(Array.from(choix)) : [cl];
      if (c.indexOf(cl) < 0) c = [cl];
      activer(cl, true);
      var d = lireCle(cl), i = IFC.infos(d.f.m, d.id);
      h.push('<div class="ctx-titre">' + esc(c.length > 1 ? "Sélection : " + pluriel(c.length, "élément") : nomAff(i)) + "</div>");
      if (i.supprimable) h.push(bouton("basculer", choix.has(cl) ? "Retirer de la sélection" : "Ajouter à la sélection"));
      if (choix.size) h.push(bouton("rien", "Tout désélectionner" + (choix.size > 1 ? " (" + fmtN(choix.size) + ")" : "")));
      if (i.supprimable && i.genre !== "spatial") h.push(bouton("similaires", "Sélectionner similaires…"));
      if (i.supprimable || choix.size) h.push("<hr>");
      h.push(boutonsVue(c));
      var ang = vue.angleSous(x, y);
      if (ang != null) h.push(bouton("aligner", vue.aCoupe() ? "Aligner la boîte de coupe sur cette face" : "Boîte de coupe alignée sur cette face"));
      if (modeEd && c.some(editable)){
        var q = c.length > 1 ? " (" + fmtN(c.length) + ")" : "";
        h.push("<hr>", '<div class="mb-sous">Modifier</div>', bouton("deplacer", "Déplacer, copier, tourner…"), bouton("aligner-face", "Aligner sur une face"),
          bouton("etage", "Changer d'étage…"), bouton("dimensions", "Dimensions…"), bouton("attributs", "Attributs et propriétés…"), bouton("classe", "Classe IFC…"),
          bouton("supprimer", "Supprimer" + q, "danger"));
      }
      h.push("<hr>");
    }
    else if (choix.size) h.push(bouton("rien", "Tout désélectionner" + (choix.size > 1 ? " (" + fmtN(choix.size) + ")" : "")), "<hr>");
    if (vue.aCoupe()) h.push(bouton("cadre-coupe", vue.cadre() ? "Masquer la boîte de coupe" : "Afficher la boîte de coupe"),
      bouton("figer-coupe", vue.fige() ? "Libérer la boîte de coupe" : "Figer la boîte de coupe"), bouton("sans-coupe", "Retirer la boîte de coupe"));
    if (vue.orienterCoupe()) h.push(bouton("equerre-coupe", "Remettre la boîte de coupe d'équerre"));
    if (vue.aCoupe() && modeEd) h.push(bouton("retailler", "Retailler l'IFC selon la boîte…"));
    h.push("<hr>", bouton("mesurer", vue.outil() === "mesure" ? "Arrêter de mesurer" : "Mesurer"),
      bouton("coordonnees", vue.outil() === "point" ? "Arrêter les coordonnées" : "Coordonnées d'un point"));
    if (vue.nbMesures()) h.push(bouton("effacer-mesures", "Effacer les mesures et coordonnées (" + fmtN(vue.nbMesures()) + ")"));
    if (caches.size) h.push(bouton("tout-afficher", "Tout afficher"));
    h.push(bouton("recadrer", "Recadrer"));
    var fd = fondVue();
    function pastilleFond(t){
      return '<button type="button" role="menuitemradio" data-ctx="fond" data-fond="' + t[0] + '" aria-checked="' + (fd === t[0]) + '" style="--t:' + t[0] + '" title="' + t[1] + '" aria-label="Fond ' + t[1] + '"></button>';
    }
    // blanc en premier (demande de Tony), puis le fond du thème, puis les autres
    h.push("<hr>", '<div class="mb-sous">Fond de la vue 3D</div><div class="teintes">' + pastilleFond(FONDS[0]) +
      '<button type="button" role="menuitemradio" data-ctx="fond" data-fond="" aria-checked="' + !fd + '" style="--t:linear-gradient(135deg,#070707 50%,#E9E5DA 50%)" title="Selon le thème" aria-label="Fond selon le thème"></button>' +
      FONDS.slice(1).map(pastilleFond).join("") +
      '<button type="button" role="menuitem" class="autre" data-ctx="fond-autre" title="Autre couleur…" aria-label="Autre couleur de fond"></button></div>');
    montrerCtx(x, y, h, { vue: true, cle: cl, cles: c, angle: ang });
  }
  function montrerCtx(x, y, h, c){
    ctx.innerHTML = h.join("");
    cible = c;
    ctx.hidden = false;
    var w = ctx.offsetWidth, ht = ctx.offsetHeight;
    ctx.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
    ctx.style.top = Math.max(8, Math.min(y, innerHeight - ht - 8)) + "px";
    var b = ctx.querySelector("button");
    if (b) b.focus({ preventScroll: true });
  }
  function fermerCtx(){ if (!ctx.hidden){ ctx.hidden = true; cible = null; } }
  $("#liste").addEventListener("contextmenu", function(e){
    var fic = e.target.closest(".fic"), r = e.target.closest(".el"), k = -1;
    if (fic){ var f = parUid.get(+fic.getAttribute("data-fic")); if (f) k = indexFichier(f); }
    else if (r) k = indexDe(r.getAttribute("data-cle"));
    if (k < 0) return;
    e.preventDefault();
    if (r) activer(r.getAttribute("data-cle"), false);
    ouvrirCtx(e.clientX, e.clientY, { f: lignes[k].fichier || lignes[k].f, l: lignes[k], k: k });
  });
  ctx.addEventListener("click", function(e){
    var b = e.target.closest("[data-ctx]");
    if (!b || !cible) return;
    var a = b.getAttribute("data-ctx"), c = cible;
    if (c.vue && a === "fond-autre"){
      cibleTeinte = "fond";
      teinteLibre.value = fondVue() || (document.documentElement.getAttribute("data-theme") === "clair" ? "#e9e5da" : "#070707");
      teinteLibre.style.left = ctx.style.left; teinteLibre.style.top = ctx.style.top;
      fermerCtx();
      try { teinteLibre.showPicker(); } catch (x){ teinteLibre.click(); }
      return;
    }
    if (c.vue && a === "fond"){ fermerCtx(); fondVue(b.getAttribute("data-fond")); return; }
    if (c.vue || a === "masquer" || a === "isoler" || a === "zoomer" || a === "coupe"){
      fermerCtx();
      if (a === "basculer"){ cliqueVue(c.cle); return; }
      if (a === "similaires"){ similaires(c.cle); return; }
      if (a === "aligner"){ alignerCoupe(c.angle, c.cles); return; }
      if (a === "supprimer" && c.cle && !choix.has(c.cle)){ choix = new Set([c.cle]); majLignes(); maj(); }
      if (!actionVue(a, c.cles) && COMMANDES[a]){
        ciblesCtx = c.cles && c.cles.length ? c.cles : null;
        try { COMMANDES[a](); } finally { ciblesCtx = null; }
      }
      return;
    }
    var f = c.f, l = c.l, noeud = !l.fichier, sous = sousLignes(c.k);
    if (a === "autre" || a === "autre-phase"){
      // sélecteur de couleur du système, ouvert à l'endroit du menu
      cibleTeinte = a === "autre" ? f : { f: f, q: b.getAttribute("data-q") };
      teinteLibre.style.left = ctx.style.left; teinteLibre.style.top = ctx.style.top;
      fermerCtx();
      try { teinteLibre.showPicker(); } catch (x){ teinteLibre.click(); }
      return;
    }
    fermerCtx();
    if (a === "reduire"){ if (noeud) plies.add(l.cle); else f.plie = true; rendreListe(); }
    else if (a === "developper"){ if (noeud) plies.delete(l.cle); else f.plie = false; rendreListe(); }
    else if (a === "developper-tout"){ if (noeud) plies.delete(l.cle); else f.plie = false; plierTout(sous, false); rendreListe(); }
    else if (a === "reduire-tout"){ plies.add(l.cle); plierTout(sous, true); rendreListe(); }
    else if (a === "reduire-contenu"){ f.plie = false; plierTout(sous, true); rendreListe(); }
    else if (a === "selectionner"){
      cocher(l.cle, true); majLignes(); maj();
      etat("« " + nomAff(l.i) + " »" + (l.enfants ? " et son contenu ajoutés" : " ajouté") + " à la sélection.");
    }
    else if (a === "similaires") similaires(l.cle);
    else if (a === "teinte") teinter(f, b.getAttribute("data-h") === "" ? null : +b.getAttribute("data-h"));
    else if (a === "teinte-phase") teinterPhase(f, b.getAttribute("data-q"), b.getAttribute("data-h") === "m" ? undefined : +b.getAttribute("data-h"));
    else if (a === "voir") basculerVisible(f);
    else if (a === "export") exporter(f);
    else if (a === "fermer") fermer(f);
    else if (COMMANDES[a]) COMMANDES[a]();
  });
  ctx.addEventListener("keydown", function(e){
    e.stopPropagation();      // pas de raccourcis de l'éditeur tant que le menu est ouvert
    var its = [].slice.call(ctx.querySelectorAll("button")), i = its.indexOf(document.activeElement);
    if (e.key === "ArrowDown"){ e.preventDefault(); its[(i + 1) % its.length].focus(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
    else if (e.key === "Escape" || e.key === "Tab"){ e.preventDefault(); fermerCtx(); }
  });
  document.addEventListener("pointerdown", function(e){ if (!ctx.hidden && !ctx.contains(e.target)) fermerCtx(); });
  // Windows envoie « contextmenu » au relâchement du clic droit, quand notre menu est déjà sous le curseur :
  // le menu du navigateur ne doit pas s'ouvrir par-dessus
  ctx.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  window.addEventListener("resize", fermerCtx);
  $("#liste").addEventListener("scroll", fermerCtx);
  function surTeinteLibre(){
    if (cibleTeinte === "fond") fondVue(teinteLibre.value);
    else if (cibleTeinte && fichiers.indexOf(cibleTeinte) >= 0) teinter(cibleTeinte, teinteDe(teinteLibre.value));
    else if (cibleTeinte && cibleTeinte.q && fichiers.indexOf(cibleTeinte.f) >= 0) teinterPhase(cibleTeinte.f, cibleTeinte.q, teinteDe(teinteLibre.value));
  }
  // Fond de la vue 3D : couleur choisie (#rrvvbb, gardée pour les prochaines visites) ou "" pour suivre le thème
  var FONDS = [["#ffffff", "blanc"], ["#000000", "noir"], ["#26282c", "anthracite"], ["#7a7d82", "gris"], ["#d4d6d9", "gris clair"],
    ["#172338", "bleu nuit"], ["#cfe0ee", "bleu ciel"]];
  var fondChoisi = (function(){ try { var v = localStorage.getItem("ifc.fond") || ""; return /^#[0-9a-f]{6}$/i.test(v) ? v : ""; } catch (e){ return ""; } })();
  function fondVue(v){
    if (v !== undefined){
      fondChoisi = /^#[0-9a-f]{6}$/i.test(v || "") ? v.toLowerCase() : "";
      garder("ifc.fond", fondChoisi);
    }
    var p = $(".p-vue");
    if (p){ if (fondChoisi) p.style.setProperty("--vue-fond", fondChoisi); else p.style.removeProperty("--vue-fond"); }
    return fondChoisi;
  }
  fondVue();
  teinteLibre.addEventListener("input", surTeinteLibre);
  teinteLibre.addEventListener("change", surTeinteLibre);

  // ================= Propriétés =================
  function ligne(dt, dd, mono){ return dd ? "<dt>" + esc(dt) + "</dt><dd" + (mono ? ' class="mono"' : "") + ">" + esc(dd) + "</dd>" : ""; }
  // ce que montre le panneau : rien, « plusieurs éléments », ou l'élément actif (et sa version)
  var dernierProps = null;
  function cleProps(){ return choix.size > 1 ? "n" + choix.size : actif && existe(actif) ? actif + "@" + lireCle(actif).f.m.version : ""; }
  function afficherProps(){
    dernierProps = cleProps();
    var z = $("#props");
    if (!actif || !existe(actif)){
      z.innerHTML = '<p class="props-vide">Clique un élément dans la liste ou dans la vue 3D.</p>';
      return;
    }
    if (choix.size > 1){
      z.innerHTML = '<p class="props-vide">' + esc(pluriel(choix.size, "élément sélectionné", "éléments sélectionnés")) + " : les propriétés s'affichent pour un seul élément à la fois.</p>";
      return;
    }
    var d = lireCle(actif), m = d.f.m, id = d.id, i = IFC.infos(m, id), I = IFC.index(m);
    var enf = (I.enfants.get(id) || []).length, ouv = (I.ouvertures.get(id) || []).length;
    var parent = I.parent.get(id) || I.conteneur.get(id) || I.perce.get(id), pi = parent && m.ent.has(parent) ? IFC.infos(m, parent) : null;
    // mode Éditeur : nom, type d'objet, description, repère et propriétés simples de l'élément modifiables sur place
    var ed = modeEd;
    function champ(dt, k, v){
      return "<dt>" + esc(dt) + '</dt><dd><input class="pv" data-attr="' + k + '" data-lib="' + esc(dt) + '" data-v0="' + esc(v || "") + '" value="' + esc(v || "") + '" autocomplete="off" spellcheck="false"></dd>';
    }
    var h = '<div class="type">' + esc(i.typeLib) + " · #" + i.id + "</div><h3>" + esc(nomAff(i)) + "</h3><dl>" +
      ligne("Fichier", fichiers.length > 1 ? m.nom : "") +
      ligne("GlobalId", i.globalId, true) +
      (ed ? champ("Nom", 2, i.nom) : ligne("Nom", i.nom)) +
      ligne("Type IFC", i.type, true) +
      (ed ? champ("Type d'objet", 4, i.objectType) : ligne("Type d'objet", i.objectType)) +
      (ed ? champ("Description", 3, i.description) : ligne("Description", i.description)) +
      (ed && i.genre !== "spatial" ? champ("Repère", 7, i.tag) : ligne("Repère", i.tag)) +
      ligne("Nom long", i.nomLong) +
      ligne("Matériau", i.materiau || (i.genre === "spatial" ? "" : "—")) +
      ligne("Dans", pi ? nomAff(pi) + " (" + pi.typeLib + ")" : "") +
      ligne("Enfants", enf ? fmtN(enf) : "") +
      ligne("Ouvertures", ouv ? fmtN(ouv) : "") +
      ligne("Sélection", !i.supprimable ? "Structure spatiale, non supprimable" : choix.has(actif) ? "Cochée" : "") +
      "</dl>";
    var modif = new Map();
    if (ed) IFCEdition.proprietesEditables(m, id).forEach(function(p){ modif.set(p.jeu + "\u0000" + p.nom, p.texte); });
    IFC.proprietes(m, id).forEach(function(p){
      h += '<div class="pset"><div class="pset-nom">' + esc(p.nom) + (p.origine ? " · " + esc(p.origine) : "") + "</div><dl>" +
        (p.props.length ? p.props.map(function(x){
          var k = p.nom + "\u0000" + x[0];
          if (!p.origine && modif.has(k)){
            var t = modif.get(k);
            return "<dt>" + esc(x[0]) + '</dt><dd><input class="pv" data-jeu="' + esc(p.nom) + '" data-prop="' + esc(x[0]) + '" data-v0="' + esc(t) + '" value="' + esc(t) + '" autocomplete="off" spellcheck="false"></dd>';
          }
          return "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd>";
        }).join("") : "<dt>—</dt><dd>Aucune valeur lisible</dd>") +
        "</dl></div>";
    });
    if (ed) h += '<p class="ed-note">Clique une valeur pour la modifier, Entrée pour valider, Échap pour revenir. Les propriétés du type restent en lecture.</p>';
    z.innerHTML = h;
    z.scrollTop = 0;
  }

  // ================= Barre d'actions =================
  function maj(){
    if (!fichiers.length) return;
    var n = choix.size;
    // état des commandes des menus
    var a = !!(actif && existe(actif));
    activerCmd("supprimer", n > 0);
    $("#cmd-supprimer").textContent = "Supprimer la sélection" + (n ? " (" + fmtN(n) + ")" : "");
    activerCmd("annuler", histo.length > 0);
    $("#cmd-annuler").textContent = histo.length ? "Annuler la " + histo[histo.length - 1].txt : "Annuler";
    activerCmd("retablir", aRefaire.length > 0);
    $("#cmd-retablir").textContent = aRefaire.length ? "Rétablir la " + aRefaire[aRefaire.length - 1].txt : "Rétablir";
    $("#cmd-exporter").textContent = fichiers.length > 1 ? "Exporter les fichiers modifiés" : "Exporter l'IFC";
    ["meme-type", "meme-materiau", "meme-nom"].forEach(function(c){ activerCmd(c, a); });
    var nEd = ciblesEdition().length;
    ["deplacer", "copier", "tourner", "deplacer-points", "copier-points", "etage", "dimensions", "attributs", "classe"].forEach(function(c){ activerCmd(c, nEd > 0); });
    [].forEach.call(document.querySelectorAll("[data-lecteur]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-lecteur") === lecteurVoulu)); });
    [].forEach.call(document.querySelectorAll("[data-colorer]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-colorer") === colorer)); });
    activerCmd("similaires", a && supprimable(actif) && IFC.infos(lireCle(actif).f.m, lireCle(actif).id).genre !== "spatial");
    activerCmd("masquer", n > 0 || a);
    activerCmd("isoler", n > 0 || a);
    activerCmd("tout-afficher", caches.size > 0);
    activerCmd("zoomer", n > 0 || a);
    activerCmd("coupe", n > 0 || a);
    activerCmd("sans-coupe", vue.aCoupe());
    $("#b-boite").setAttribute("aria-pressed", String(vue.aCoupe()));
    activerCmd("figer-coupe", vue.aCoupe());
    activerCmd("cadre-coupe", vue.aCoupe());
    activerCmd("equerre-coupe", !!vue.orienterCoupe());
    $("#cmd-cadre").textContent = vue.cadre() ? "Masquer la boîte de coupe" : "Afficher la boîte de coupe";
    $("#cmd-figer").textContent = vue.fige() ? "Libérer la boîte de coupe" : "Figer la boîte de coupe";
    activerCmd("rien", n > 0);
    activerCmd("fusionner", fichiers.length > 1);
    activerCmd("retailler", vue.aCoupe());
    activerCmd("purger", fichiers.length > 0);
    activerCmd("effacer-mesures", vue.nbMesures() > 0);
    $("#cmd-mesurer").textContent = vue.outil() === "mesure" ? "Arrêter de mesurer" : "Mesurer";
    $("#cmd-coord").textContent = vue.outil() === "point" ? "Arrêter les coordonnées" : "Coordonnées d'un point";
    $("#cmd-fusionner").textContent = fichiers.length > 1 ? "Fusionner les " + fichiers.length + " maquettes" : "Fusionner les maquettes";
    var mo = vue.moteur();
    [].forEach.call(document.querySelectorAll("[data-moteur]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-moteur") === mo)); });
    [].forEach.call(document.querySelectorAll("[data-geo]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-geo") === geoVoulue)); });
    var dyn = $('[data-dyn="exports"]');
    dyn.innerHTML = fichiers.length > 1 ? fichiers.map(function(f){
      return '<button type="button" role="menuitem" data-cmd="exporter-fichier" data-uid="' + f.uid + '"><span>Exporter « ' + esc(f.m.nom) + " »</span><kbd>" + (modifie(f) ? "modifié" : "") + "</kbd></button>";
    }).join("") : "";
    $("#compte").textContent = fmtN(visibles.length) + " affichés" + (n ? " · " + fmtN(n) + " cochés" : "");
    var avant = 0, apres = 0, oAvant = 0, oApres = 0;
    fichiers.forEach(function(f){ avant += f.m.nbOrigine; apres += f.m.ent.size; oAvant += f.m.taille; oApres += tailleDe(f); });
    if (fichiers.length === 1){
      $("#f-nom").textContent = fichiers[0].m.nom + " · " + fichiers[0].m.schema;
      $("#f-nom").title = fichiers[0].m.nom;
    } else {
      $("#f-nom").textContent = pluriel(fichiers.length, "fichier") + " superposés";
      $("#f-nom").title = fichiers.map(function(f){ return f.m.nom; }).join("\n");
    }
    $("#f-bilan").innerHTML = "Avant <b>" + fmtN(avant) + "</b> entités · " + fmtTaille(oAvant) +
      " → maintenant <b>" + fmtN(apres) + "</b> entités · " + fmtTaille(oApres);
    // l'élément actif non supprimable (terrain du site) est surligné comme une sélection
    var vus = choix;
    if (actif && !choix.has(actif) && !supprimable(actif)){ vus = new Set(choix); vus.add(actif); }
    vue.selection(vus, actif);
    if (cleProps() !== dernierProps) afficherProps();
  }

  function infoVue(b){
    var nl = Object.keys(b.nonLus);
    $("#vue-info").textContent = pluriel(b.elements, "élément dessiné", "éléments dessinés") + " · " + pluriel(b.faces, "face") +
      (nl.length ? " · géométrie non lue : " + nl.slice(0, 4).map(IFC.nomType).join(", ") + (nl.length > 4 ? "…" : "") : "") +
      (b.erreurs ? " · " + pluriel(b.erreurs, "élément illisible", "éléments illisibles") : "") +
      (caches.size ? " · " + fmtN(caches.size) + " masqués" : "") +
      " · moteur " + b.moteur + (vue.sourceGeo() === "externe" ? " · géométrie web-ifc" : "");
  }

  function confirmer(texte, ok, titre, bouton){
    var d = $("#confirmer");
    $("#confirmer-texte").textContent = texte;
    $("#confirmer-titre").textContent = titre || "Supprimer la sélection ?";
    $("#confirmer-oui").textContent = bouton || "Supprimer";
    if (typeof d.showModal !== "function"){ if (window.confirm(texte)) ok(); return; }
    d.returnValue = "";
    d.addEventListener("close", function f(){
      d.removeEventListener("close", f);
      if (d.returnValue === "oui") ok();
    });
    d.showModal();
  }

  function supprimer(){
    if (!choix.size) return;
    // un plan de suppression par fichier
    var parFichier = new Map();
    choix.forEach(function(c){
      var d = lireCle(c);
      if (!d.f) return;
      if (!parFichier.has(d.f)) parFichier.set(d.f, []);
      parFichier.get(d.f).push(d.id);
    });
    var plans = [], nbEl = 0, nbDem = 0, nbEnt = 0, nbMod = 0;
    parFichier.forEach(function(ids, f){
      var p = IFC.planifier(f.m, ids);
      if (!p.nbElements) return;
      plans.push({ f: f, p: p });
      nbEl += p.nbElements; nbDem += p.nbDemandes; nbEnt += p.nbEntites; nbMod += p.nbModifiees;
    });
    if (!plans.length){ etat("Rien à supprimer : la sélection ne contient que des éléments de structure spatiale."); return; }
    var ajoutes = nbEl - nbDem;
    var texte = pluriel(nbEl, "élément") + (ajoutes ? " (dont " + fmtN(ajoutes) + " ajouté" + (ajoutes > 1 ? "s" : "") + " d'office : enfants d'assemblage ou ouvertures)" : "") +
      " et " + pluriel(nbEnt, "entité") + " au total vont partir" + (plans.length > 1 ? " de " + pluriel(plans.length, "fichier") : " du fichier") +
      (nbMod ? " ; " + pluriel(nbMod, "relation") + " " + (nbMod > 1 ? "seront raccourcies" : "sera raccourcie") : "") + ".";
    confirmer(texte, function(){
      var parts = plans.map(function(x){
        // ouvertures supprimées : leurs hôtes sont à redessiner (relus aussi à l'annulation)
        var ouv = [];
        x.p.elements.forEach(function(id){ var i = IFC.infos(x.f.m, id); if (i && i.genre === "ouverture") ouv.push(id); });
        return ouv.length ? { f: x.f, ch: x.p.changement, ids: ouv } : { f: x.f, ch: x.p.changement };
      });
      plans.forEach(function(x){ IFC.appliquer(x.f.m, x.p.changement); });
      relire(parts);
      var txt = "suppression de " + pluriel(nbEl, "élément");
      histo.push({ parts: parts, txt: txt, e: nbEnt });
      aRefaire = [];
      reconstruire();
      etat(pluriel(nbEl, "élément supprimé", "éléments supprimés") + ", " + pluriel(nbEnt, "entité retirée", "entités retirées") +
        (nbMod ? ", " + pluriel(nbMod, "relation raccourcie", "relations raccourcies") : "") + ".");
    });
  }
  // Retaille selon la boîte de coupe, fichier par fichier (maquettes affichées) : les éléments hors de la boîte
  // partent (comme une suppression), ceux à cheval sont coupés net à la boîte par des découpes IFC
  function retailler(){
    if (!vue.aCoupe()) return;
    var plans = [], nbDehors = 0, nbAcheval = 0, nbDedans = 0;
    fichiers.forEach(function(f){
      if (!f.visible) return;
      // le site et les bâtiments restent entiers (un terrain en surfaces ne se découpe pas en IFC)
      var m = f.m, ids = IFC.index(m).produits.filter(function(id){ return IFC.infos(m, id).genre === "element"; });
      var c = vue.classerCoupe(m, ids);
      if (!c) return;
      var dehors = new Set(c.dehors), change = true;
      // un élément ne part pas sans ses enfants d'assemblage restés dans la boîte ; un assemblage sans
      // géométrie dont tout le contenu part s'en va aussi
      while (change){
        change = false;
        dehors.forEach(function(id){
          if (IFC.descendants(m, id).some(function(d){ return !dehors.has(d) && c.sansGeo.indexOf(d) < 0; })){ dehors.delete(id); change = true; }
        });
      }
      c.sansGeo.forEach(function(id){
        if (IFC.infos(m, id).genre !== "element") return;
        var d = IFC.descendants(m, id);
        if (d.length && d.every(function(x){ return dehors.has(x); })) dehors.add(id);
      });
      if (!dehors.size && !c.acheval.length) return;
      plans.push({ f: f, dehors: Array.from(dehors), acheval: c.acheval });
      nbDehors += dehors.size; nbAcheval += c.acheval.length; nbDedans += c.dedans.length;
    });
    if (!plans.length){ etat("Rien à retailler : tout ce qui est affiché tient déjà dans la boîte de coupe."); return; }
    var texte = pluriel(nbDehors, "élément") + " hors de la boîte " + (nbDehors > 1 ? "vont partir" : "va partir") +
      ", " + pluriel(nbAcheval, "élément") + " à cheval " + (nbAcheval > 1 ? "seront coupés" : "sera coupé") + " net à la boîte (découpes IFC, la géométrie d'origine reste dessous), " +
      pluriel(nbDedans, "élément") + " " + (nbDedans > 1 ? "restent entiers" : "reste entier") + ".";
    confirmer(texte, function(){
      var parts = [], nbEnt = 0, nbSupp = 0, nbCoupes = 0, nonCoupes = 0, ajout = 0;
      plans.forEach(function(x){
        if (x.acheval.length){
          var r = vue.retailler(x.f.m, x.acheval);
          if (r && r.ids.length){
            IFC.appliquer(x.f.m, r.changement);
            vue.oublier(x.f.m, r.ids);
            parts.push({ f: x.f, ch: r.changement, ids: r.ids });
            nbCoupes += r.ids.length; ajout += r.nbEntites;
          }
          if (r) nonCoupes += r.nonCoupes;
        }
        if (x.dehors.length){
          var p = IFC.planifier(x.f.m, x.dehors);
          if (p.nbElements){
            IFC.appliquer(x.f.m, p.changement);
            parts.push({ f: x.f, ch: p.changement });
            nbSupp += p.nbElements; nbEnt += p.nbEntites;
          }
        }
      });
      if (!parts.length){ etat("Rien n'a pu être retaillé."); return; }
      histo.push({ parts: parts, txt: "retaille selon la boîte de coupe", e: nbEnt });
      aRefaire = [];
      reconstruire();
      calculerWebIfc();
      etat("Retaille faite : " + pluriel(nbSupp, "élément supprimé", "éléments supprimés") + ", " + pluriel(nbCoupes, "élément coupé", "éléments coupés") +
        " à la boîte (" + pluriel(ajout, "entité ajoutée", "entités ajoutées") + ")" +
        (nonCoupes ? ", " + pluriel(nonCoupes, "solide laissé entier", "solides laissés entiers") + " (surfaces ou géométrie non découpable)" : "") +
        ". Exporte l'IFC pour garder le résultat.");
    }, "Retailler l'IFC ?", "Retailler");
  }
  // une retaille change la géométrie d'éléments : à relire après annuler / rétablir
  function relire(parts){
    var oui = false;
    parts.forEach(function(p){ if (p.ids){ vue.oublier(p.f.m, p.ids); oui = true; } });
    return oui;
  }
  function annuler(){
    if (!histo.length) return;
    var h = histo.pop();
    h.parts.slice().reverse().forEach(function(p){ IFC.appliquer(p.f.m, p.ch, true); });
    var geo = relire(h.parts);
    aRefaire.push(h);
    reconstruire();
    if (geo) calculerWebIfc();
    etat("Annulé : " + h.txt + " (" + pluriel(h.e, "entité remise", "entités remises") + ").");
  }
  function retablir(){
    if (!aRefaire.length) return;
    var h = aRefaire.pop();
    h.parts.forEach(function(p){ IFC.appliquer(p.f.m, p.ch); });
    var geo = relire(h.parts);
    histo.push(h);
    reconstruire();
    if (geo) calculerWebIfc();
    etat("Rétabli : " + h.txt + ".");
  }

  // Téléchargement de l'IFC du fichier, ou de son .ifczip : promesse du bilan (texte)
  function telecharger(f, zip){
    var m = f.m, version = m.version, oct = IFC.versOctets(IFC.ecrire(m)), nom = IFC.nomExport(m.nom);
    var pret = zip ? zipper(nom, oct) : Promise.resolve(new Blob([oct], { type: "application/x-step" }));
    return pret.then(function(blob){
      var a = document.createElement("a"), nomFichier = zip ? nom.replace(/\.ifc$/i, "") + ".ifczip" : nom;
      a.href = URL.createObjectURL(blob);
      a.download = nomFichier;
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      f.propre = version;
      return "« " + nomFichier + " » : avant " + fmtN(m.nbOrigine) + " entités · " + fmtTaille(m.taille) +
        ", après " + fmtN(m.ent.size) + " entités · " + fmtTaille(oct.length) + (zip ? ", compressé " + fmtTaille(blob.size) : "");
    });
  }
  // Sans argument : le fichier ouvert s'il est seul, sinon tous les fichiers modifiés
  function exporter(f, zip){
    var cibles = f ? [f] : zip ? fichiers.slice() : fichiers.length === 1 ? fichiers.slice() : fichiers.filter(modifie);
    if (!cibles.length){ etat("Aucun fichier modifié. Pour exporter un fichier précis, utilise son bouton « Exporter » dans la liste."); return; }
    if (zip && !zipPossible){ etat("Ce navigateur ne sait pas compresser : mets-le à jour, ou exporte l'IFC non compressé."); return; }
    if (zip) etat("Compression en cours…");
    var bilans = [], suite = Promise.resolve();
    // téléchargements l'un après l'autre et espacés : certains navigateurs ignorent des clics trop rapprochés
    cibles.forEach(function(x, k){
      suite = suite.then(function(){ return k ? pause(400) : null; }).then(function(){ return telecharger(x, zip); }).then(function(b){ bilans.push(b); });
    });
    suite.then(function(){
      etat("Exporté" + (cibles.length > 1 ? "s" : "") + " : " + bilans.join(" ; ") + ".");
      rendreListe(); maj();
    }).catch(function(err){
      if (window.console) console.error(err);
      etat("Export impossible : " + (err && err.message || err) + ".");
    });
  }

  $("#b-recadrer").addEventListener("click", function(){ vue.recadrer(); });
  // chevrons de part et d'autre de la vue : réduire le panneau Éléments ou Propriétés
  function replier(cote, oui){
    var p = $(".panneaux"), b = $("#rep-" + cote), quoi = cote === "g" ? "les éléments" : "les propriétés";
    p.classList.toggle("sans-" + cote, oui);
    b.textContent = (cote === "g") === oui ? "›" : "‹";
    b.title = (oui ? "Afficher " : "Réduire ") + quoi;
    b.setAttribute("aria-expanded", String(!oui));
    garder("ifc.replie." + cote, oui ? "1" : "0");
  }
  ["g", "d"].forEach(function(c){
    replier(c, lire("ifc.replie." + c, ["0", "1"]) === "1");
    $("#rep-" + c).addEventListener("click", function(){ replier(c, !$(".panneaux").classList.contains("sans-" + c)); });
  });
  // poignées : largeur des panneaux Éléments (g) et Propriétés (d), gardée dans ce navigateur
  ["g", "d"].forEach(function(c){
    var poi = $("#poi-" + c), pan = $(c === "g" ? "#p-liste" : "#p-props"), autre = $(c === "g" ? "#p-props" : "#p-liste"), pp = $(".panneaux");
    var nomVar = c === "g" ? "--lg" : "--ld", cleL = "ifc.largeur." + c, x0 = 0, l0 = 0, id = null;
    function borner(l){
      var reste = pp.getBoundingClientRect().width - (autre.offsetParent ? autre.getBoundingClientRect().width : 0) - 320;
      return Math.round(Math.max(200, Math.min(l, Math.max(200, reste))));
    }
    function poser(l){ if (l) pp.style.setProperty(nomVar, l + "px"); else pp.style.removeProperty(nomVar); }
    try { var v = +localStorage.getItem(cleL); if (v >= 200 && v <= 2000) poser(v); } catch (e){}
    poi.addEventListener("pointerdown", function(e){
      if (e.button !== 0) return;
      e.preventDefault();
      id = e.pointerId; x0 = e.clientX; l0 = pan.getBoundingClientRect().width;
      poi.setPointerCapture(id); poi.classList.add("tire"); document.body.classList.add("redim");
    });
    poi.addEventListener("pointermove", function(e){
      if (e.pointerId !== id) return;
      poser(borner(l0 + (c === "g" ? 1 : -1) * (e.clientX - x0)));
    });
    function fin(e){
      if (e.pointerId !== id) return;
      id = null; poi.classList.remove("tire"); document.body.classList.remove("redim");
      garder(cleL, String(Math.round(pan.getBoundingClientRect().width)));
    }
    poi.addEventListener("pointerup", fin);
    poi.addEventListener("pointercancel", fin);
    poi.addEventListener("dblclick", function(){ poser(0); try { localStorage.removeItem(cleL); } catch (e){} etat("Largeur de départ rétablie."); });
  });
  // « Boîte de coupe » : enfoncé tant qu'une boîte est posée, un clic l'enlève ; sinon boîte autour de la
  // sélection, ou de tout ce qui est affiché
  $("#b-boite").addEventListener("click", function(){
    if (vue.aCoupe()){ sansCoupe(); vue.recadrer(); return; }
    var c = choix.size ? Array.from(choix) : itemsVue().map(function(i){ return i.cle; });
    if (c.length) couperCles(c);
  });
  $("#b-dxf").addEventListener("click", exporterDxfAxes);
  $("#b-lissage").setAttribute("aria-pressed", String(vue.lissage()));
  $("#b-lissage").addEventListener("click", function(){
    var on = !vue.lissage(); vue.lissage(on); this.setAttribute("aria-pressed", String(on)); garder("ifc.lissage", on ? "1" : "0");
  });
  // Solide / Filaire : choix gardé dans ce navigateur
  function rendu(fil){
    vue.filaire(fil);
    $("#b-solide").setAttribute("aria-pressed", String(!fil));
    $("#b-filaire").setAttribute("aria-pressed", String(fil));
    garder("ifc.rendu", fil ? "filaire" : "solide");
  }
  rendu(lire("ifc.rendu", ["solide", "filaire"]) === "filaire");
  $("#b-solide").addEventListener("click", function(){ rendu(false); });
  $("#b-filaire").addEventListener("click", function(){ rendu(true); });

  // ================= Export DXF : axes et contours, vue de dessus =================
  // Murs (axe), poteaux (axe ; croix au point d'un poteau vertical), ossatures (axe des poutres et membrures),
  // dalles (contour du dessus et réservations) : éléments affichés qui touchent la boîte de coupe, coupés par
  // elle. DXF R12 texte en mètres, dans le repère du projet Revit (origine = placement du bâtiment, sinon du
  // site ; axes = angleProjet), pour se superposer à un plan exporté de Revit.
  var CALQUES_AXES = [["STR_MURS_AXES", 1, "AXE"], ["STR_DALLES_CONTOURS", 3, "CONTINUOUS"], ["STR_DALLES_RESERVATIONS", 30, "CONTINUOUS"],
    ["STR_POTEAUX_AXES", 5, "AXE"], ["STR_OSSATURES_AXES", 6, "AXE"]];
  function origineProjet(){
    for (var i = 0; i < fichiers.length; i++){
      if (!fichiers[i].visible) continue;
      var m = fichiers[i].m, bat = 0, site = 0;
      m.ent.forEach(function(e){ if (!bat && e.type === "IFCBUILDING") bat = e.id; else if (!site && e.type === "IFCSITE") site = e.id; });
      var o = (bat && vue.origine(m, bat)) || (site && vue.origine(m, site));
      if (o) return o;
    }
    return [0, 0, 0];
  }
  function exporterDxfAxes(){
    if (!fichiers.length){ etat("Ouvre d'abord un IFC."); return; }
    var P = vue.planDxf(), nt = P.n.murs + P.n.dalles + P.n.poteaux + P.n.ossatures;
    if (!nt){ etat("Rien à exporter : aucun mur, dalle, poteau ni ossature affiché" + (vue.aCoupe() ? " dans la boîte de coupe." : ".")); return; }
    var O = origineProjet(), c = Math.cos(-angleProjet), s = Math.sin(-angleProjet);
    function T(x, y){ var dx = x - O[0], dy = y - O[1]; return [c*dx - s*dy, s*dx + c*dy]; }
    var L = [], corps = [], vus = new Set(), nl = 0, mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    function g(code, v){ L.push(String(code), String(v)); }
    function nb(v){ return (Math.round(v*1e4)/1e4).toFixed(4); }
    function etendue(p){ if (p[0] < mn[0]) mn[0] = p[0]; if (p[1] < mn[1]) mn[1] = p[1]; if (p[0] > mx[0]) mx[0] = p[0]; if (p[1] > mx[1]) mx[1] = p[1]; }
    function ligne(calque, a, b){
      var k = calque + nb(a[0]) + nb(a[1]) + nb(b[0]) + nb(b[1]), k2 = calque + nb(b[0]) + nb(b[1]) + nb(a[0]) + nb(a[1]);
      if (vus.has(k) || vus.has(k2)) return;
      vus.add(k); nl++; etendue(a); etendue(b);
      corps.push("0", "LINE", "8", calque, "10", nb(a[0]), "20", nb(a[1]), "30", "0.0", "11", nb(b[0]), "21", nb(b[1]), "31", "0.0");
    }
    [["murs", "STR_MURS_AXES"], ["dalles", "STR_DALLES_CONTOURS"], ["reservations", "STR_DALLES_RESERVATIONS"], ["poteaux", "STR_POTEAUX_AXES"], ["ossatures", "STR_OSSATURES_AXES"]].forEach(function(q){
      var S = P[q[0]];
      for (var i = 0; i < S.length; i += 4) ligne(q[1], T(S[i], S[i+1]), T(S[i+2], S[i+3]));
    });
    // poteau vertical : point et croix de 30 cm sur les axes du projet
    for (var i = 0; i < P.points.length; i += 2){
      var p = T(P.points[i], P.points[i+1]), d = .15;
      etendue(p);
      corps.push("0", "POINT", "8", "STR_POTEAUX_AXES", "10", nb(p[0]), "20", nb(p[1]), "30", "0.0");
      ligne("STR_POTEAUX_AXES", [p[0] - d, p[1]], [p[0] + d, p[1]]);
      ligne("STR_POTEAUX_AXES", [p[0], p[1] - d], [p[0], p[1] + d]);
    }
    g(0, "SECTION"); g(2, "HEADER");
    g(9, "$ACADVER"); g(1, "AC1009");
    g(9, "$INSUNITS"); g(70, 6);
    g(9, "$LTSCALE"); g(40, "1.0");
    g(9, "$EXTMIN"); g(10, nb(mn[0])); g(20, nb(mn[1])); g(30, "0.0");
    g(9, "$EXTMAX"); g(10, nb(mx[0])); g(20, nb(mx[1])); g(30, "0.0");
    g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES");
    g(0, "TABLE"); g(2, "LTYPE"); g(70, 2);
    g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, "0.0");
    // axe : trait mixte (long 0,60 m, vide 0,10, point 0,02, vide 0,10)
    g(0, "LTYPE"); g(2, "AXE"); g(70, 0); g(3, "Axe ____ . ____ . ____"); g(72, 65); g(73, 4); g(40, "0.82");
    g(49, "0.60"); g(49, "-0.10"); g(49, "0.02"); g(49, "-0.10");
    g(0, "ENDTAB");
    g(0, "TABLE"); g(2, "LAYER"); g(70, CALQUES_AXES.length);
    CALQUES_AXES.forEach(function(k){ g(0, "LAYER"); g(2, k[0]); g(70, 0); g(62, k[1]); g(6, k[2]); });
    g(0, "ENDTAB");
    g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    L = L.concat(corps);
    g(0, "ENDSEC"); g(0, "EOF");
    var f0 = fichiers.filter(function(f){ return f.visible; })[0] || fichiers[0];
    var nom = ("Axes_" + f0.m.nom.replace(/\.ifc(zip)?$/i, "")).replace(/[^\w\-]+/g, "_") + ".dxf";
    var blob = new Blob([L.join("\r\n") + "\r\n"], { type: "application/dxf" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
    var bilan = [pluriel(P.n.murs, "mur"), pluriel(P.n.dalles, "dalle"), pluriel(P.n.poteaux, "poteau", "poteaux"), pluriel(P.n.ossatures, "ossature")].join(", ");
    etat("DXF « " + nom + " » : " + bilan + " (" + pluriel(nl, "ligne") + ")" + (vue.aCoupe() ? ", dans la boîte de coupe." : " ; sans boîte de coupe, tous les étages se superposent.") +
      (P.axesCalcules ? " " + pluriel(P.axesCalcules, "axe") + " sans représentation « Axis » dans l'IFC, déduit" + (P.axesCalcules > 1 ? "s" : "") + " de la forme." : ""));
  }

  // ================= Masquer / isoler dans la vue 3D =================
  function elementsDe(liste){
    return liste.filter(function(c){ var d = lireCle(c), i = d.f && IFC.infos(d.f.m, d.id); return i && i.vue3D; });
  }
  function cibles(){ return elementsDe(choix.size ? Array.from(choix) : actif && existe(actif) ? [actif] : []); }
  function itemsVue(){
    var items = [];
    lignes.forEach(function(l){ if (l.i && l.f.visible && l.i.vue3D && !caches.has(l.cle)) items.push({ cle: l.cle, m: l.f.m, id: l.id, h: teinteElement(l.f, l.id) }); });
    return items;
  }
  function majVue(){
    infoVue(vue.afficher(itemsVue()));
    majLignes(); maj();
  }

  // ================= Préférences : unités et décimales des mesures et des coordonnées =================
  var UNITES = { mm: .001, cm: .01, dm: .1, m: 1, ft: .3048, "in": .0254 };
  var DECIMALES = { mm: 1, cm: 2, dm: 2, m: 3, km: 3, ft: 3, "in": 2 };
  var PREFS = { lu: ["auto", "mm", "cm", "dm", "m", "ft", "in"], ld: ["auto", "0", "1", "2", "3", "4"],
    cu: ["m", "auto", "mm", "cm", "dm", "ft", "in"], cd: ["auto", "0", "1", "2", "3", "4"], repere: ["fichier", "geo"] };
  var prefs = (function(){
    var p = {}, r = {};
    try { p = JSON.parse(localStorage.getItem("ifc.prefs") || "{}") || {}; } catch (e){}
    Object.keys(PREFS).forEach(function(k){ r[k] = PREFS[k].indexOf(p[k]) >= 0 ? p[k] : PREFS[k][0]; });
    return r;
  })();
  // Mise en forme d'une valeur en mètres ; décimales « auto » : celles de l'unité, zéros de fin retirés
  function regle(u, d){
    var u0 = fichiers.length ? fichiers[0].unite : { nom: "", f: 1 };
    var nom = u === "auto" ? u0.nom : u, f = u === "auto" ? u0.f : UNITES[u];
    var k = d === "auto" ? (DECIMALES[nom] != null ? DECIMALES[nom] : 3) : +d;
    var fmt = new Intl.NumberFormat("fr-CH", { minimumFractionDigits: d === "auto" ? 0 : k, maximumFractionDigits: k });
    return function(v){ var x = v/f; return fmt.format(Math.abs(x) < Math.pow(10, -k)/2 ? 0 : x) + (nom ? " " + nom : ""); };
  }
  // Formats passés à la vue : longueurs et coordonnées (repère du fichier ou géoréférencé), valeurs de la vue
  // en unités du premier fichier
  function formatsMesure(){
    var f0 = fichiers[0], up = f0 ? f0.unite.f : 1, lg = regle(prefs.lu, prefs.ld), co = regle(prefs.cu, prefs.cd);
    var g = prefs.repere === "geo" && f0 && f0.carte;
    return {
      longueur: function(v){ return lg(v*up); },
      point: function(p, zSeul){
        var q = g ? [g.E + g.kx*(p[0]*g.c - p[1]*g.s), g.N + g.ky*(p[0]*g.s + p[1]*g.c), g.H + g.kz*p[2]].map(function(v){ return v*g.fu; })
          : p.map(function(v){ return v*up; });
        var noms = g ? ["E", "N", "H"] : ["X", "Y", "Z"];
        return (zSeul ? [2] : [0, 1, 2]).map(function(i){ return noms[i] + " " + co(q[i]); });
      }
    };
  }
  function noteGeo(){
    var f0 = fichiers[0], g = f0 && f0.carte;
    $("#pref-geo").textContent = !f0 ? "" : g
      ? "Géoréférencement lu dans « " + f0.m.nom + " » (" + g.source + (g.crs ? ", " + g.crs : "") + ") : E " + regle("m", "3")(g.E*g.fu) + ", N " + regle("m", "3")(g.N*g.fu) + ", H " + regle("m", "3")(g.H*g.fu) + "."
      : "« " + f0.m.nom + " » n'a ni IfcMapConversion ni ePset_MapConversion : les coordonnées restent celles du fichier.";
  }
  function preferences(){
    var d = $("#preferences");
    Object.keys(PREFS).forEach(function(k){ $("#pref-" + k).value = prefs[k]; });
    noteGeo();
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  function appliquerPrefs(){
    try { localStorage.setItem("ifc.prefs", JSON.stringify(prefs)); } catch (e){}
    vue.formats(formatsMesure());
  }
  Object.keys(PREFS).forEach(function(k){
    $("#pref-" + k).addEventListener("change", function(){ prefs[k] = PREFS[k].indexOf(this.value) >= 0 ? this.value : PREFS[k][0]; appliquerPrefs(); });
  });
  $("#pref-defaut").addEventListener("click", function(){
    Object.keys(PREFS).forEach(function(k){ prefs[k] = PREFS[k][0]; $("#pref-" + k).value = prefs[k]; });
    appliquerPrefs();
  });

  // ================= Purge : orphelins toujours, inutilisés selon les cases cochées =================
  var PURGE = ["types", "relations", "psets", "niveaux"];
  // jeux de propriétés cochés dans la liste (clés « P|nom » ou « Q|nom »)
  function jeuxCoches(){
    var j = new Set();
    [].forEach.call(document.querySelectorAll("#purge-jeux input:checked"), function(c){ j.add(c.getAttribute("data-jeu")); });
    return j;
  }
  // Liste des jeux de propriétés de tous les fichiers ouverts, du plus lourd au plus léger
  function listeJeux(){
    var par = new Map();
    fichiers.forEach(function(f){
      IFC.statsPsets(f.m).forEach(function(x){
        var k = (x.quantites ? "Q|" : "P|") + x.nom, s = par.get(k);
        if (!s) par.set(k, s = { cle: k, nom: x.nom, quantites: x.quantites, nb: 0, octets: 0 });
        s.nb += x.nb; s.octets += x.octets;
      });
    });
    var l = Array.from(par.values()).sort(function(a, b){ return b.octets - a.octets; });
    $("#purge-jeux").innerHTML = l.length ? l.map(function(x){
      return '<label class="coche"><input type="checkbox" data-jeu="' + esc(x.cle) + '"><span title="' + esc(x.nom) + '">' + esc(x.nom) +
        (x.quantites ? " <i>(quantités)</i>" : "") + "</span><b>" + fmtN(x.nb) + " · " + fmtTaille(x.octets) + "</b></label>";
    }).join("") : '<p class="pref-note">Aucun jeu de propriétés.</p>';
  }
  function plansPurge(){
    var opts = { jeux: jeuxCoches() };
    PURGE.forEach(function(k){ opts[k] = $("#purge-" + k).checked; });
    return fichiers.map(function(f){ return { f: f, p: IFC.planPurge(f.m, opts) }; });
  }
  function bilanPurge(){
    var tout = { compter: true }, cats = { types: 0, relations: 0, psets: 0, niveaux: 0 }, n = 0, o = 0, orph = 0, mod = 0;
    PURGE.forEach(function(k){ tout[k] = true; });
    fichiers.forEach(function(f){ var c = IFC.planPurge(f.m, tout).cats; PURGE.forEach(function(k){ cats[k] += c[k]; }); });
    PURGE.forEach(function(k){ $("#purge-n-" + k).textContent = fmtN(cats[k]); });
    var jeux = 0, dbl = 0, od = 0;
    plansPurge().forEach(function(x){ n += x.p.nbEntites; o += x.p.octets; orph += x.p.nbOrphelins; mod += x.p.nbModifiees; jeux += x.p.cats.jeux; });
    // doublons : comptés sur le fichier tel qu'il est (la purge en retire parfois une partie avant)
    fichiers.forEach(function(f){ var z = IFC.planFusion(f.m); dbl += z.nbFusions; od += z.octets; });
    $("#purge-n-doublons").textContent = fmtN(dbl);
    var fus = $("#purge-doublons").checked && dbl > 0;
    $("#purge-bilan").textContent = n || fus
      ? (n ? pluriel(n, "entité") + " en moins, " + fmtTaille(Math.max(0, o)) + " de gagnés" + (jeux ? " (" + pluriel(jeux, "jeu", "jeux") + " de propriétés retirés)" : "") + ", dont " + pluriel(orph, "orpheline") +
          (mod ? " ; " + pluriel(mod, "entité raccourcie", "entités raccourcies") : "") + "." : "") +
        (fus ? (n ? " " : "") + "Doublons : jusqu'à " + pluriel(dbl, "entité fusionnée", "entités fusionnées") + ", environ " + fmtTaille(od) + " de plus." : "")
      : "Rien à purger avec ces choix : le fichier est déjà propre.";
    $("#purge-oui").disabled = !(n || fus);
  }
  function purger(){
    var d = $("#purge");
    if (!fichiers.length || typeof d.showModal !== "function") return;
    $("#purge-bilan").textContent = "Calcul du bilan…";
    $("#purge-jeux").innerHTML = "";
    $("#purge-oui").disabled = true;
    d.returnValue = "";
    d.showModal();
    setTimeout(function(){ listeJeux(); bilanPurge(); }, 30);
  }
  // une case cochée (catégorie ou jeu de propriétés) : bilan recalculé
  $("#purge").addEventListener("change", function(e){ if (e.target.type === "checkbox"){ $("#purge-bilan").textContent = "Calcul du bilan…"; setTimeout(bilanPurge, 0); } });
  $("#purge-aucun").addEventListener("click", function(){
    [].forEach.call(document.querySelectorAll("#purge-jeux input:checked"), function(c){ c.checked = false; });
    bilanPurge();
  });
  $("#purge").addEventListener("close", function(){
    if ($("#purge").returnValue !== "oui") return;
    var plans = plansPurge().filter(function(x){ return x.p.nbEntites || x.p.nbModifiees; }), parts = [], n = 0, o = 0, dbl = 0;
    plans.forEach(function(x){ IFC.appliquer(x.f.m, x.p.changement); n += x.p.nbEntites; o += x.p.octets; parts.push({ f: x.f, ch: x.p.changement }); });
    // doublons : après la purge, sur ce qui reste ; même annulation (Ctrl+Z défait les deux)
    if ($("#purge-doublons").checked) fichiers.forEach(function(f){
      var z = IFC.planFusion(f.m);
      if (!z.nbFusions) return;
      IFC.appliquer(f.m, z.changement); n += z.nbFusions; o += z.octets; dbl += z.nbFusions;
      parts.push({ f: f, ch: z.changement });
    });
    if (!parts.length) return;
    histo.push({ parts: parts, txt: "purge", e: n });
    aRefaire = [];
    reconstruire();
    etat("Purge : " + pluriel(n, "entité retirée", "entités retirées") + (dbl ? " (dont " + fmtN(dbl) + " doublons fusionnés)" : "") + ", " +
      fmtTaille(Math.max(0, o)) + " de gagnés. Ctrl+Z pour annuler.");
  });

  // Outil de la vue : "mesure", "point" ou aucun (même commande : bascule)
  function outil(nom){
    var o = vue.outil(vue.outil() === nom ? null : nom);
    etat(o === "mesure" ? "Mesure : clique deux points. Accroche aux sommets (carré), milieux (triangle), arêtes (losange), sinon à la face (rond) : depuis une face, la mesure part perpendiculairement à elle. Échap pour annuler ou quitter."
      : o === "point" ? "Coordonnées : clique un sommet, un milieu ou une arête pour ses trois coordonnées, une face pour sa seule altitude. Unités et repère : Outils > Préférences. Échap pour quitter."
      : "Outil terminé.");
    maj();
  }

  // ================= Commandes (menus et raccourcis) =================
  var remplacer = false;
  function vider(){
    fichiers = []; parUid.clear(); histo = []; aRefaire = []; choix = new Set(); caches = new Set(); plies = new Set(); actif = ""; lignes = [];
    vue.modeles([]);
  }
  function comme(test, quoi){
    var d = lireCle(actif), r = IFC.infos(d.f.m, d.id), n = 0;
    lignes.forEach(function(l){ if (l.i && l.i.supprimable && test(l.i, r) && !choix.has(l.cle)){ choix.add(l.cle); n++; } });
    majLignes(); maj();
    etat(n ? pluriel(n, "élément ajouté", "éléments ajoutés") + " à la sélection (" + quoi + " que « " + nomAff(r) + " »)." : "Aucun autre élément avec " + quoi + ".");
  }
  // ================= Mode Viewer / Éditeur =================
  // Viewer : consulter (naviguer, sélectionner, mesurer, couper, colorier). Éditeur : en plus, modifier la
  // maquette (menus Édition et Modifier, commandes du clic droit, propriétés modifiables, export de l'IFC).
  var modeEd = lire("ifc.mode", ["viewer", "editeur"]) === "editeur", ciblesCtx = null;
  function poserMode(ed){
    modeEd = !!ed;
    garder("ifc.mode", modeEd ? "editeur" : "viewer");
    document.body.classList.toggle("mode-ed", modeEd);
    [].forEach.call(document.querySelectorAll("[data-mode]"), function(b){ b.setAttribute("aria-pressed", String((b.getAttribute("data-mode") === "editeur") === modeEd)); });
    if (!modeEd && vue.enSaisie()) vue.saisir(null);
    afficherProps(); maj();
  }
  function annoncerMode(){
    etat(modeEd ? "Mode Éditeur : menus Édition et Modifier, clic droit « Modifier », propriétés modifiables dans le panneau. Ctrl+Z annule."
      : "Mode Viewer : consultation seule, la maquette ne peut pas être modifiée.");
  }
  [].forEach.call(document.querySelectorAll("[data-mode]"), function(b){
    b.addEventListener("click", function(){
      var ed = b.getAttribute("data-mode") === "editeur";
      if (ed !== modeEd){ poserMode(ed); annoncerMode(); }
    });
  });
  // une commande de modification n'agit qu'en mode Éditeur
  function seulEd(fn){
    return function(b){
      if (!modeEd){ etat("Passe en mode Éditeur (bouton en haut, ou touche E) pour modifier la maquette."); return; }
      fn(b);
    };
  }

  // ================= Éditeur : cibles, application, annulation =================
  function editable(c){ var d = lireCle(c), i = d.f && d.f.m.ent.has(d.id) && IFC.infos(d.f.m, d.id); return !!(i && i.supprimable && i.genre !== "spatial"); }
  // éléments visés : ceux du clic droit, sinon la sélection, sinon l'élément actif
  function ciblesEdition(){
    var l = ciblesCtx || (choix.size ? Array.from(choix) : actif && existe(actif) ? [actif] : []);
    return l.filter(editable);
  }
  function nomCle(c){ var d = lireCle(c); return nomAff(IFC.infos(d.f.m, d.id)); }
  function decrire(cles){ return cles.length === 1 ? "« " + nomCle(cles[0]) + " »" : pluriel(cles.length, "élément"); }
  function sansCible(){ etat("Sélectionne d'abord un ou plusieurs éléments (clic dans la vue 3D ou dans la liste)."); }
  function groupesFichiers(cles){
    var g = new Map();
    cles.forEach(function(c){ var d = lireCle(c); if (!d.f) return; var l = g.get(d.f); if (!l) g.set(d.f, l = []); l.push(d.id); });
    return g;
  }
  // faire(f, ids, app) rend un résultat d'IFCEdition, ou en applique plusieurs à la suite par app(résultat) ;
  // le tout fait une seule entrée d'annulation (txt : « Annuler la … »)
  function editer(txt, cles, faire){
    var parts = [], tot = { nb: 0, ignores: 0, refuse: 0, copies: [], fait: false };
    function app(f, r){
      if (!r) return;
      tot.nb += r.nb || 0; tot.ignores += r.ignores || 0; tot.refuse += r.refuse || 0;
      (r.copies || []).forEach(function(id){ tot.copies.push(cle(f, id)); });
      if (!r.changement) return;
      IFC.appliquer(f.m, r.changement);
      if (r.ids && r.ids.length) vue.oublier(f.m, r.ids);
      parts.push({ f: f, ch: r.changement, ids: r.ids && r.ids.length ? r.ids : null });
    }
    groupesFichiers(cles).forEach(function(ids, f){
      var r = faire(f, ids, function(x){ app(f, x); });
      if (r) app(f, r);
    });
    if (parts.length){
      var n = 0;
      parts.forEach(function(p){ n += p.ch.avant.length + p.ch.apres.length; });
      histo.push({ parts: parts, txt: txt, e: n });
      aRefaire = [];
      reconstruire();
      if (parts.some(function(p){ return p.ids; })) calculerWebIfc();
      tot.fait = true;
    }
    return tot;
  }
  var FIN_EDITION = " Ctrl+Z pour annuler ; exporte l'IFC pour garder le résultat.";
  function bilanIgnores(n, pourquoi){ return n ? " " + pluriel(n, "élément ignoré", "éléments ignorés") + " (" + pourquoi + ")." : ""; }

  // ================= Unités de saisie =================
  function uniteSaisie(){ var u0 = fichiers[0].unite; return prefs.lu === "auto" || !UNITES[prefs.lu] ? u0 : { nom: prefs.lu, f: UNITES[prefs.lu] }; }
  function nombreSaisi(v){ var t = String(v).replace(/[\s']/g, "").replace(",", "."); if (t === "") return 0; var x = Number(t); return isFinite(x) ? x : NaN; }
  function texteNombre(v){ return String(Math.round(v*1e6)/1e6).replace(".", ","); }
  function unitesAffichees(){ var n = uniteSaisie().nom; [].forEach.call(document.querySelectorAll("[data-unite]"), function(s){ s.textContent = n ? "(" + n + ")" : ""; }); return n; }
  function ouvrirFenetre(d, champ){
    d.returnValue = "";
    d.showModal();
    if (champ) setTimeout(function(){ champ.focus(); if (champ.select) champ.select(); }, 30);
  }

  // ================= Déplacer, copier, tourner =================
  var transfoCibles = [];
  function ouvrirTransfo(mode){
    var cles = ciblesEdition(), d = $("#transfo");
    if (!cles.length){ sansCible(); return; }
    if (typeof d.showModal !== "function") return;
    transfoCibles = cles;
    $("#transfo-titre").textContent = mode === "copier" ? "Copier" : mode === "tourner" ? "Rotation" : "Déplacer";
    $("#transfo-cible").textContent = decrire(cles) + ". Rotation, puis translation ; le tout peut être copié plusieurs fois (chaque copie décalée de la précédente).";
    unitesAffichees();
    ["#tr-dx", "#tr-dy", "#tr-dz", "#tr-angle"].forEach(function(s){ $(s).value = "0"; });
    $("#tr-copier").checked = mode === "copier";
    $("#tr-nb").value = "1";
    $("#tr-note").textContent = "Les ouvertures suivent leur mur, les pièces d'un assemblage suivent l'assemblage.";
    ouvrirFenetre(d, $(mode === "tourner" ? "#tr-angle" : "#tr-dx"));
  }
  $("#transfo").addEventListener("close", function(){
    var v = $("#transfo").returnValue, cles = transfoCibles.filter(existe);
    transfoCibles = [];
    if (!cles.length) return;
    var copie = $("#tr-copier").checked, nb = copie ? Math.max(1, Math.min(200, parseInt($("#tr-nb").value, 10) || 1)) : 0;
    if (v === "points"){ deuxPoints(copie, cles, nb); return; }
    if (v !== "oui") return;
    var u = uniteSaisie(), dx = nombreSaisi($("#tr-dx").value), dy = nombreSaisi($("#tr-dy").value), dz = nombreSaisi($("#tr-dz").value), ang = nombreSaisi($("#tr-angle").value);
    if ([dx, dy, dz, ang].some(isNaN)){ etat("Valeur illisible : écris des nombres (virgule ou point)."); return; }
    if (!dx && !dy && !dz && !ang && !copie){ etat("Rien à faire : translation et rotation sont à 0."); return; }
    transformerCles(cles, function(f){ var k = u.f/f.unite.f; return [dx*k, dy*k, dz*k]; }, ang*Math.PI/180, $("#tr-centre").value, nb);
  });
  // vecteur(f) : déplacement dans les unités du fichier f ; angle en radians autour de la verticale passant par le
  // centre de la sélection ("sel") ou de chaque élément ("chacun") ; nb copies (0 : déplacer)
  function transformerCles(cles, vecteur, angle, centre, nb, txt, quoi){
    var bSel = angle && centre !== "chacun" ? vue.boite(cles) : null;
    if (angle && centre !== "chacun" && !bSel){ etat("Rotation impossible : les éléments visés ne sont pas affichés dans la vue 3D."); return; }
    function milieu(b){ return [(b.min[0] + b.max[0])/2, (b.min[1] + b.max[1])/2, 0]; }
    function faire(f, ids, T){ return nb ? IFCEdition.copier(f.m, ids, T, nb) : IFCEdition.transformer(f.m, ids, T); }
    var r = editer(txt || (nb ? "copie" : angle ? "rotation" : "translation"), cles, function(f, ids, app){
      var D = IFCEdition.translation(vecteur(f));
      if (!angle) return faire(f, ids, D);
      if (centre !== "chacun") return faire(f, ids, IFCEdition.mul(D, IFCEdition.rotationZ(angle, milieu(bSel))));
      ids.forEach(function(id){
        var b = vue.boite([cle(f, id)]);
        if (b) app(faire(f, [id], IFCEdition.mul(D, IFCEdition.rotationZ(angle, milieu(b)))));
      });
      return null;
    });
    if (!r.fait){ etat("Rien n'a été modifié." + bilanIgnores(r.ignores, "sans placement local modifiable")); return; }
    if (nb && r.copies.length){
      choix = new Set(r.copies.filter(function(c){ var d = lireCle(c), i = IFC.infos(d.f.m, d.id); return i && i.genre === "element"; }));
      actif = choix.size ? choix.values().next().value : actif;
      majLignes(); afficherProps(); maj();
    }
    etat((quoi || (nb ? (nb > 1 ? fmtN(nb) + " copies de " : "Copie de ") + decrire(cles) + " faite" + (nb > 1 ? "s" : "") + " (copies sélectionnées)."
      : (angle ? "Rotation de " : "Translation de ") + decrire(cles) + " faite.")) + bilanIgnores(r.ignores, "sans placement local modifiable") + FIN_EDITION);
  }
  // Vecteur choisi en cliquant deux points accrochés (sommets, milieux, arêtes) dans la vue
  function deuxPoints(copie, cles, nb){
    cles = cles || ciblesEdition();
    if (!cles.length){ sansCible(); return; }
    var quoi = copie ? "Copier" : "Déplacer";
    function fini(){ etat(quoi + " : annulé."); maj(); }
    vue.saisir({ annule: fini, choisi: function(A){
      etat(quoi + " : clique le point d'arrivée (Échap pour annuler).");
      vue.saisir({ depuis: A.p, typeDepuis: A.type, annule: fini, choisi: function(B){
        vue.saisir(null);
        var d = [B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]];
        if (!d[0] && !d[1] && !d[2]){ etat(quoi + " : les deux points sont confondus, rien à faire."); maj(); return; }
        transformerCles(cles.filter(existe), function(){ return d; }, 0, null, copie ? (nb || 1) : 0);
      } });
    } });
    etat(quoi + " " + decrire(cles) + " : clique le point de départ (sommets, milieux et arêtes accrochés ; Échap pour annuler).");
    maj();
  }
  // Aligner : une face de référence, puis les faces à amener dessus (à la suite, jusqu'à Échap)
  function alignerFace(){
    if (!fichiers.length) return;
    function fini(){ etat("Aligner : terminé."); maj(); }
    vue.saisir({ faces: true, annule: fini, choisi: function(Ref){
      if (!Ref.n) return;
      etat("Aligner : clique la face de l'élément à amener sur la référence (plusieurs à la suite ; Échap pour terminer).");
      vue.saisir({ faces: true, annule: fini, choisi: function(F){ alignerSur(Ref, F); } });
    } });
    etat("Aligner : clique d'abord la face de référence, celle qui ne bouge pas (Échap pour annuler).");
    maj();
  }
  function alignerSur(Ref, F){
    var n = Ref.n, k = n[0]*(Ref.p[0] - F.p[0]) + n[1]*(Ref.p[1] - F.p[1]) + n[2]*(Ref.p[2] - F.p[2]);
    if (!F.cle || !editable(F.cle)){ etat("Aligner : cet élément ne peut pas être déplacé (structure spatiale). Clique une autre face, ou Échap."); return; }
    if (Math.abs(k) < 1e-9){ etat("Aligner : déjà sur la référence. Clique une autre face, ou Échap."); return; }
    var cles = choix.has(F.cle) ? Array.from(choix).filter(editable) : [F.cle], d = [n[0]*k, n[1]*k, n[2]*k];
    var paral = !F.n || Math.abs(n[0]*F.n[0] + n[1]*F.n[1] + n[2]*F.n[2]) > .999;
    transformerCles(cles, function(){ return d; }, 0, null, 0, "mise en alignement",
      "Aligné : " + decrire(cles) + " déplacé" + (cles.length > 1 ? "s" : "") + " de " + formatsMesure().longueur(Math.abs(k)) +
      (paral ? "" : " perpendiculairement à la référence (faces non parallèles)") + ". Clique une autre face à aligner, ou Échap.");
  }

  // ================= Changer d'étage =================
  var etageCibles = [];
  function ouvrirEtage(){
    var cles = ciblesEdition(), d = $("#etage");
    if (!cles.length){ sansCible(); return; }
    var r = lireCle(cles[0]), ets = IFCEdition.etages(r.f.m);
    if (!ets.length){ etat("Cette maquette n'a pas d'étage (IfcBuildingStorey)."); return; }
    etageCibles = cles;
    var actuel = IFC.index(r.f.m).conteneur.get(r.id), k = r.f.unite.f/fichiers[0].unite.f, lg = formatsMesure().longueur;
    $("#etage-liste").innerHTML = ets.map(function(e){
      var z = e.elevation != null ? e.elevation : e.z;
      return '<option value="' + e.id + '"' + (e.id === actuel ? " selected" : "") + ">" + esc(e.nom + " (" + lg(z*k) + ")" + (e.id === actuel ? " · actuel" : "")) + "</option>";
    }).join("");
    $("#etage-cible").textContent = decrire(cles) + (fichiers.length > 1 ? ". Dans les autres maquettes, l'étage du même nom est utilisé." : ".");
    $("#etage-note").textContent = "Seuls les éléments rattachés directement à un étage changent ; leurs ouvertures et leurs pièces d'assemblage suivent.";
    ouvrirFenetre(d, $("#etage-liste"));
  }
  $("#etage").addEventListener("close", function(){
    var cles = etageCibles.filter(existe);
    etageCibles = [];
    if ($("#etage").returnValue !== "oui" || !cles.length) return;
    var fRef = lireCle(cles[0]).f, id = +$("#etage-liste").value, suivre = $("#etage-suivre").checked;
    var nomE = (IFCEdition.etages(fRef.m).filter(function(e){ return e.id === id; })[0] || {}).nom;
    var r = editer("mise à l'étage", cles, function(f, ids){
      var cible = f === fRef ? id : (IFCEdition.etages(f.m).filter(function(e){ return e.nom === nomE; })[0] || {}).id;
      if (!cible) return { changement: null, nb: 0, ignores: ids.length };
      return IFCEdition.changerEtage(f.m, ids, cible, suivre);
    });
    etat(r.fait ? decrire(cles) + " rattaché" + (cles.length > 1 ? "s" : "") + " à « " + nomE + " »" + (suivre ? ", décalé" + (cles.length > 1 ? "s" : "") + " en hauteur avec l'étage" : ", position gardée") + "." +
      bilanIgnores(r.ignores, "pas rattachés directement à un étage, ou étage absent de leur maquette") + FIN_EDITION
      : "Rien n'a changé : les éléments sont déjà à cet étage." + bilanIgnores(r.ignores, "pas rattachés directement à un étage"));
  });

  // ================= Dimensions des extrusions =================
  var dimsEtat = null;
  function ouvrirDims(){
    var cles = ciblesEdition(), d = $("#dims");
    if (!cles.length){ sansCible(); return; }
    var ref = cles.indexOf(actif) >= 0 ? actif : cles[0], r = lireCle(ref), ex = IFCEdition.extrusions(r.f.m, r.id);
    if (!ex.length){ etat("« " + nomCle(ref) + " » : pas d'extrusion modifiable (forme maillée ou balayage). Seuls placement, attributs et propriétés peuvent changer."); return; }
    var u = uniteSaisie(), k = r.f.unite.f/u.f, montre = ex.slice(0, 4);
    dimsEtat = { cles: cles, ref: ref, u: u };
    $("#dims-cible").textContent = "« " + nomCle(ref) + " » : " + pluriel(ex.length, "solide extrudé", "solides extrudés") + (ex.length > 4 ? " (les 4 premiers montrés)" : "") + ". Valeurs en " + (u.nom || "unités du fichier") + ".";
    $("#dims-corps").innerHTML = montre.map(function(x, n){
      function champ(cleV, lib, v){
        var t = texteNombre(v*k);
        return '<label><span>' + esc(lib) + '</span><input class="champ" inputmode="decimal" autocomplete="off" data-n="' + n + '" data-k="' + cleV + '" data-v0="' + t + '" value="' + t + '"></label>';
      }
      return '<div class="dims-gr"><div class="dims-titre">Extrusion ' + (n + 1) + (x.typeProfil ? " <i>· profil " + esc(x.typeProfil) + "</i>" : "") + '</div><div class="trois">' +
        champ("prof", "Longueur d'extrusion", x.profondeur) + x.params.map(function(p){ return champ(p.k, p.nom, p.v); }).join("") + "</div></div>";
    }).join("");
    $("#dims-tous-l").hidden = cles.length < 2;
    $("#dims-tous").checked = false;
    $("#dims-tous-t").textContent = "Appliquer aussi aux " + pluriel(cles.length - 1, "autre élément sélectionné", "autres éléments sélectionnés") + " (même extrusion)";
    ouvrirFenetre(d, $("#dims-corps input"));
  }
  $("#dims").addEventListener("close", function(){
    var s = dimsEtat;
    dimsEtat = null;
    if ($("#dims").returnValue !== "oui" || !s || !existe(s.ref)) return;
    var chg = [], faux = false;
    [].forEach.call($("#dims-corps").querySelectorAll("input"), function(i){
      if (i.value.trim() === i.getAttribute("data-v0")) return;
      var v = nombreSaisi(i.value), n = +i.getAttribute("data-n"), c = i.getAttribute("data-k");
      if (!(v > 0)){ faux = true; return; }
      var x = chg[n] || (chg[n] = { prof: null, params: {} });
      if (c === "prof") x.prof = v; else x.params[c] = v;
    });
    if (faux){ etat("Dimensions : chaque valeur doit être un nombre positif. Rien n'a été modifié."); return; }
    if (!chg.some(Boolean)){ etat("Dimensions : aucune valeur changée."); return; }
    var cles = $("#dims-tous").checked ? s.cles.filter(existe) : [s.ref];
    var r = editer("modification des dimensions", cles, function(f, ids, app){
      var k = s.u.f/f.unite.f;
      chg.forEach(function(x, n){
        if (!x) return;
        var p = {};
        Object.keys(x.params).forEach(function(c){ p[c] = x.params[c]*k; });
        app(IFCEdition.dimensionner(f.m, ids, n, x.prof != null ? x.prof*k : null, p));
      });
      return null;
    });
    etat(r.fait ? "Dimensions modifiées : " + decrire(cles) + "." + bilanIgnores(r.ignores, "sans cette extrusion") + " Les quantités (Qto) du fichier ne sont pas recalculées." + FIN_EDITION
      : "Dimensions : rien n'a pu être modifié." + bilanIgnores(r.ignores, "sans cette extrusion"));
  });

  // ================= Attributs et propriétés de la sélection =================
  var attrsEtat = null, ATTRS = { 2: "nom", 3: "description", 4: "objectType", 7: "tag" };
  function ouvrirAttrs(){
    var cles = ciblesEdition(), d = $("#attrs");
    if (!cles.length){ sansCible(); return; }
    var infos = cles.map(function(c){ var x = lireCle(c); return IFC.infos(x.f.m, x.id); });
    Object.keys(ATTRS).forEach(function(k){
      var vals = infos.map(function(i){ return i[ATTRS[k]] || ""; }), meme = vals.every(function(v){ return v === vals[0]; }), inp = $("#at-" + k);
      inp.value = meme ? vals[0] : "";
      inp.placeholder = meme ? "" : "(valeurs différentes : inchangé)";
      inp.setAttribute("data-v0", meme ? vals[0] : "\u0000");
    });
    var ref = cles.indexOf(actif) >= 0 ? actif : cles[0], r = lireCle(ref), props = IFCEdition.proprietesEditables(r.f.m, r.id);
    attrsEtat = { cles: cles, props: props };
    $("#at-prop").innerHTML = '<option value="">(aucune)</option>' + props.map(function(p, k){ return '<option value="' + k + '">' + esc(p.jeu + " › " + p.nom) + "</option>"; }).join("");
    $("#at-val").value = ""; $("#at-val").disabled = true;
    $("#attrs-cible").textContent = decrire(cles) + (props.length ? "" : ". Pas de propriété simple modifiable sur « " + nomCle(ref) + " ».");
    ouvrirFenetre(d, $("#at-2"));
  }
  $("#at-prop").addEventListener("change", function(){
    var p = attrsEtat && attrsEtat.props[+this.value];
    $("#at-val").disabled = !p;
    $("#at-val").value = p ? p.texte : "";
  });
  $("#attrs").addEventListener("close", function(){
    var s = attrsEtat;
    attrsEtat = null;
    if ($("#attrs").returnValue !== "oui" || !s) return;
    var valeurs = {}, cles = s.cles.filter(existe);
    Object.keys(ATTRS).forEach(function(k){
      var inp = $("#at-" + k), v0 = inp.getAttribute("data-v0"), v = inp.value;
      if (v0 === "\u0000" ? v !== "" : v !== v0) valeurs[k] = v;
    });
    var p = $("#at-prop").value !== "" ? s.props[+$("#at-prop").value] : null, val = $("#at-val").value;
    if (p && val === p.texte) p = null;
    if (!Object.keys(valeurs).length && !p){ etat("Attributs : rien n'a changé."); return; }
    var r = editer(p && !Object.keys(valeurs).length ? "modification de propriété" : "modification des attributs", cles, function(f, ids, app){
      if (Object.keys(valeurs).length) app(IFCEdition.attributs(f.m, ids, valeurs));
      if (p) app(IFCEdition.propriete(f.m, ids, p.jeu, p.nom, val));
      return null;
    });
    etat(r.refuse ? "Valeur refusée pour « " + p.nom + " » : elle doit garder son type (nombre, oui/non…)." + (r.fait ? " Le reste est modifié." : "")
      : r.fait ? "Attributs modifiés : " + decrire(cles) + "." + (p && r.ignores ? " " + pluriel(r.ignores, "élément n'a", "éléments n'ont") + " pas la propriété « " + p.nom + " »." : "") + FIN_EDITION
      : "Rien n'a changé.");
  });
  // Propriétés modifiables dans le panneau (mode Éditeur, un élément) : validées à la sortie du champ ou par Entrée
  $("#props").addEventListener("change", function(e){
    var t = e.target;
    if (!t.classList || !t.classList.contains("pv") || !modeEd || !actif || !existe(actif)) return;
    var c = actif, r;
    if (t.hasAttribute("data-attr")){
      var v = {}; v[t.getAttribute("data-attr")] = t.value;
      r = editer("modification des attributs", [c], function(f, ids){ return IFCEdition.attributs(f.m, ids, v); });
    } else r = editer("modification de propriété", [c], function(f, ids){ return IFCEdition.propriete(f.m, ids, t.getAttribute("data-jeu"), t.getAttribute("data-prop"), t.value); });
    if (r.refuse){ etat("Valeur refusée : elle doit garder son type (nombre, oui/non…)."); afficherProps(); }
    else if (r.fait) etat("« " + (t.getAttribute("data-prop") || t.getAttribute("data-lib")) + " » modifié." + FIN_EDITION);
  });
  $("#props").addEventListener("keydown", function(e){
    var t = e.target;
    if (!t.classList || !t.classList.contains("pv")) return;
    if (e.key === "Enter"){ e.preventDefault(); t.blur(); }
    else if (e.key === "Escape"){ e.preventDefault(); t.value = t.getAttribute("data-v0") || ""; t.blur(); }
  });

  // ================= Classe IFC =================
  var classeCibles = [];
  function ouvrirClasse(){
    var cles = ciblesEdition(), d = $("#classe");
    if (!cles.length){ sansCible(); return; }
    classeCibles = cles;
    var r = lireCle(cles[0]), t = r.f.m.ent.get(r.id).type, C = IFCEdition.CLASSES;
    $("#classe-liste").innerHTML = Object.keys(C).sort(function(a, b){ return C[a][0].localeCompare(C[b][0]); }).map(function(k){
      return '<option value="' + k + '"' + (k === t ? " selected" : "") + ">" + esc(C[k][0] + " (" + IFC.nomType(k) + ")") + "</option>";
    }).join("");
    $("#classe-cible").textContent = decrire(cles) + " · classe actuelle : " + IFC.nomType(t) + (cles.length > 1 ? " (premier élément)" : "") + ".";
    ouvrirFenetre(d, $("#classe-liste"));
  }
  $("#classe").addEventListener("close", function(){
    var cles = classeCibles.filter(existe);
    classeCibles = [];
    if ($("#classe").returnValue !== "oui" || !cles.length) return;
    var t = $("#classe-liste").value;
    var r = editer("modification de classe IFC", cles, function(f, ids){ return IFCEdition.changerClasse(f.m, ids, t); });
    etat(r.fait ? pluriel(r.nb, "élément passé", "éléments passés") + " en " + IFC.nomType(t) + "." + bilanIgnores(r.ignores, "déjà de cette classe, ou ouverture") + FIN_EDITION
      : "Rien n'a changé (déjà de cette classe).");
  });

  // ================= Couleurs selon un critère (légende cliquable) =================
  var colorer = lire("ifc.colorer", ["", "type", "famille", "etage", "materiau", "maquette"]), teintesCat = null, catsLegende = [], catDe = null;
  var NOMS_COLORER = { type: "Type IFC", famille: "Famille : type", etage: "Étage", materiau: "Matériau", maquette: "Fichier" };
  function categorie(l){
    if (colorer === "type") return l.i.typeLib;
    if (colorer === "famille") return l.i.objectType || "(sans famille : type)";
    if (colorer === "etage") return etageDe(l.f.m, l.id) || "(sans étage)";
    if (colorer === "materiau") return l.i.materiau || "(sans matériau)";
    if (colorer === "maquette") return l.f.m.nom;
    return "";
  }
  function calculerCouleurs(){
    var leg = $("#legende");
    if (!colorer || !fichiers.length){ teintesCat = null; catDe = null; leg.hidden = true; leg.innerHTML = ""; return; }
    var compte = new Map(), teinte = new Map();
    catDe = new Map();
    lignes.forEach(function(l){
      if (!l.i || !l.i.vue3D) return;
      var c = categorie(l);
      catDe.set(l.cle, c);
      compte.set(c, (compte.get(c) || 0) + 1);
    });
    catsLegende = Array.from(compte.keys()).sort(function(a, b){ return compte.get(b) - compte.get(a) || a.localeCompare(b); });
    // teintes réparties à l'angle d'or : voisines bien distinctes ; au-delà de 36 catégories, couleur par défaut
    catsLegende.forEach(function(c, k){ if (k < 36) teinte.set(c, Math.round((k*137.508 + 210) % 360)); });
    teintesCat = new Map();
    catDe.forEach(function(c, k){ teintesCat.set(k, teinte.has(c) ? teinte.get(c) : null); });
    var MAX = 14;
    leg.innerHTML = '<div class="legende-titre"><span>' + esc(NOMS_COLORER[colorer]) + '</span><button type="button" data-leg-fermer title="Revenir aux couleurs des maquettes" aria-label="Fermer la légende">×</button></div><ul>' +
      catsLegende.slice(0, MAX).map(function(c, k){
        return '<li><button type="button" data-cat="' + k + '" title="Sélectionner ces éléments"><i style="--t:' + (teinte.has(c) ? pastille(teinte.get(c)) : "var(--texte-faible)") + '"></i><span>' + esc(c) + "</span><b>" + fmtN(compte.get(c)) + "</b></button></li>";
      }).join("") + "</ul>" + (catsLegende.length > MAX ? '<div class="autres">+ ' + pluriel(catsLegende.length - MAX, "autre catégorie", "autres catégories") + "</div>" : "");
    leg.hidden = false;
  }
  function poserColorer(v){
    colorer = v || "";
    garder("ifc.colorer", colorer);
    calculerCouleurs();
    majVue();
    if (colorer) etat("Couleurs par " + NOMS_COLORER[colorer].toLowerCase() + " : " + pluriel(catsLegende.length, "catégorie") + ". Clique une ligne de la légende pour sélectionner ses éléments.");
  }
  $("#legende").addEventListener("click", function(e){
    if (e.target.closest("[data-leg-fermer]")){ poserColorer(""); etat("Couleurs des maquettes rétablies."); return; }
    var b = e.target.closest("[data-cat]");
    if (!b || !catDe) return;
    var c = catsLegende[+b.getAttribute("data-cat")], n = 0;
    choix = new Set();
    catDe.forEach(function(x, k){ if (x === c && supprimable(k)){ choix.add(k); n++; } });
    actif = n ? choix.values().next().value : "";
    majLignes(); afficherProps(); maj();
    etat("« " + c + " » : " + pluriel(n, "élément sélectionné", "éléments sélectionnés") + ".");
  });

  poserMode(modeEd);

  // ================= Sélectionner similaires =================
  // Fenêtre de critères (tous ceux cochés doivent correspondre), ouverte depuis un élément de référence.
  function etageDe(m, id){
    var I = IFC.index(m), x = id, n = 0;
    while (x && n++ < 64){
      var e = m.ent.get(x);
      if (e && e.type === "IFCBUILDINGSTOREY") return nomAff(IFC.infos(m, x));
      x = I.parent.get(x) || I.conteneur.get(x) || I.perce.get(x);
    }
    return "";
  }
  function typeRelie(m, id){
    var t = IFC.index(m).typeObjet.get(id), i = t && m.ent.has(t) ? IFC.infos(m, t) : null;
    return i ? i.nom || i.typeLib : "";
  }
  // [code, libellé, valeur comparée, valeur affichée]
  var CRITERES_SIM = [
    ["type", "Type IFC", function(f, id, i){ return i.type; }, function(f, id, i){ return i.typeLib; }],
    ["type-relie", "Type", function(f, id){ return typeRelie(f.m, id); }],
    ["type-objet", "Famille : type", function(f, id, i){ return i.objectType; }],
    ["nom", "Nom", function(f, id, i){ return i.nom; }],
    ["etage", "Étage", function(f, id){ return etageDe(f.m, id); }],
    ["materiau", "Matériau", function(f, id, i){ return i.materiau; }],
    ["maquette", "Maquette", function(f){ return fichiers.length > 1 ? String(f.uid) : ""; }, function(f){ return f.m.nom; }]
  ];
  var simRef = null, simProps = [], simCoches = (function(){
    try { var v = JSON.parse(localStorage.getItem("ifc.similaires") || "null"); if (Array.isArray(v)) return v; } catch (e){}
    return ["type", "type-objet"];
  })();
  function valeurPropriete(m, id, jeu, nom){
    var out = null;
    IFC.proprietes(m, id).some(function(p){
      if (p.nom !== jeu) return false;
      return p.props.some(function(x){ if (x[0] === nom){ out = x[1]; return true; } return false; });
    });
    return out;
  }
  function similaires(c){
    var d = $("#similaires");
    if (!c || !existe(c) || typeof d.showModal !== "function") return;
    var r = lireCle(c), i = IFC.infos(r.f.m, r.id);
    simRef = { cle: c, f: r.f, id: r.id, i: i };
    $("#sim-ref").textContent = "Comme « " + nomAff(i) + " » : tous les critères cochés doivent correspondre.";
    $("#sim-criteres").innerHTML = CRITERES_SIM.map(function(k){
      var v = k[2](r.f, r.id, i), aff = v ? (k[3] ? k[3](r.f, r.id, i) : v) : "—";
      return '<label class="coche' + (v ? "" : " vide") + '" title="' + esc(k[1] + " : " + aff) + '"><input type="checkbox" data-sim="' + k[0] + '"' +
        (v ? (simCoches.indexOf(k[0]) >= 0 ? " checked" : "") : " disabled") + "><span>" + esc(k[1]) + "</span><b>" + esc(aff) + "</b></label>";
    }).join("");
    // propriétés de la référence portant une valeur lisible
    simProps = [];
    IFC.proprietes(r.f.m, r.id).forEach(function(p){
      p.props.forEach(function(x){ if (x[1] && x[1] !== "—" && x[1] !== "(tableau)") simProps.push({ jeu: p.nom, nom: x[0], v: x[1] }); });
    });
    var sel = $("#sim-prop");
    sel.innerHTML = simProps.length ? simProps.map(function(p, k){
      return '<option value="' + k + '">' + esc(p.jeu + " › " + p.nom + " = " + p.v) + "</option>";
    }).join("") : "<option>Aucune propriété lisible</option>";
    $("#sim-prop-oui").checked = false;
    $("#sim-prop-oui").disabled = sel.disabled = !simProps.length;
    $("#sim-prop-ligne").classList.toggle("vide", !simProps.length);
    $("#sim-ajouter").checked = false;
    d.returnValue = "";
    d.showModal();
    bilanSimilaires();
  }
  function cochesSim(){ return [].map.call(document.querySelectorAll("#sim-criteres input:checked"), function(x){ return x.getAttribute("data-sim"); }); }
  function trouverSimilaires(){
    var ref = simRef, codes = cochesSim(), tests = CRITERES_SIM.filter(function(k){ return codes.indexOf(k[0]) >= 0; }), attendu = {};
    tests.forEach(function(k){ attendu[k[0]] = k[2](ref.f, ref.id, ref.i); });
    var prop = $("#sim-prop-oui").checked ? simProps[+$("#sim-prop").value] : null, affiches = $("#sim-visibles").checked, out = [];
    if (!tests.length && !prop) return out;
    lignes.forEach(function(l){
      if (!l.i || !l.i.supprimable || l.i.genre === "spatial") return;
      if (affiches && (!l.f.visible || caches.has(l.cle))) return;
      for (var k = 0; k < tests.length; k++) if (tests[k][2](l.f, l.id, l.i) !== attendu[tests[k][0]]) return;
      if (prop && valeurPropriete(l.f.m, l.id, prop.jeu, prop.nom) !== prop.v) return;
      out.push(l.cle);
    });
    return out;
  }
  var minuteSim = 0;
  function bilanSimilaires(){
    clearTimeout(minuteSim);
    $("#sim-bilan").textContent = "Calcul…";
    minuteSim = setTimeout(function(){
      if (!simRef) return;
      var n = trouverSimilaires().length;
      $("#sim-bilan").textContent = !cochesSim().length && !$("#sim-prop-oui").checked ? "Coche au moins un critère." :
        n ? pluriel(n, "élément correspond", "éléments correspondent") + " (référence comprise)." : "Aucun élément ne correspond.";
      $("#sim-oui").disabled = !n;
    }, 20);
  }
  $("#similaires").addEventListener("change", function(e){
    if (e.target.id === "sim-prop") $("#sim-prop-oui").checked = true;
    if (e.target.id !== "sim-ajouter") bilanSimilaires();
  });
  $("#similaires").addEventListener("close", function(){
    var ref = simRef;
    if ($("#similaires").returnValue !== "oui" || !ref){ simRef = null; return; }
    simCoches = cochesSim();
    garder("ifc.similaires", JSON.stringify(simCoches));
    var t = trouverSimilaires(), ajout = $("#sim-ajouter").checked, avant = choix.size;
    simRef = null;
    if (!ajout) choix.clear();
    t.forEach(function(x){ choix.add(x); });
    actif = choix.has(ref.cle) ? ref.cle : actif;
    majLignes(); afficherProps(); maj();
    var crit = simCoches.map(function(c){ return CRITERES_SIM.filter(function(k){ return k[0] === c; })[0][1].toLowerCase(); });
    if ($("#sim-prop-oui").checked) crit.push("propriété");
    etat(pluriel(t.length, "élément similaire", "éléments similaires") + " à « " + nomAff(ref.i) + " » (" + crit.join(", ") + ")" +
      (ajout ? " : " + pluriel(choix.size - avant, "ajouté", "ajoutés") + " à la sélection." : " sélectionnés."));
  });
  function aide(titre, html){
    $("#aide-titre").textContent = titre;
    $("#aide-corps").innerHTML = html;
    var d = $("#aide");
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  var COMMANDES = {
    ouvrir: function(){
      if (fichiers.some(modifie) && !confirm("Les modifications non exportées seront perdues. Ouvrir d'autres fichiers à la place ?")) return;
      remplacer = true; choisir();
    },
    ajouter: function(){ remplacer = false; choisir(); },
    fusionner: seulEd(fusionnerTout),
    retailler: seulEd(retailler),
    purger: seulEd(purger),
    deplacer: seulEd(function(){ ouvrirTransfo("deplacer"); }),
    copier: seulEd(function(){ ouvrirTransfo("copier"); }),
    tourner: seulEd(function(){ ouvrirTransfo("tourner"); }),
    "deplacer-points": seulEd(function(){ deuxPoints(false); }),
    "copier-points": seulEd(function(){ deuxPoints(true); }),
    "aligner-face": seulEd(alignerFace),
    etage: seulEd(ouvrirEtage),
    dimensions: seulEd(ouvrirDims),
    attributs: seulEd(ouvrirAttrs),
    classe: seulEd(ouvrirClasse),
    mode: function(){ poserMode(!modeEd); annoncerMode(); },
    lecteur: function(b){
      lecteurVoulu = b.getAttribute("data-lecteur"); garder("ifc.lecteur", lecteurVoulu); maj();
      etat("Lecture des prochains fichiers : " + (lecteurVoulu === "rust" ? "module Rust (WebAssembly)." : "lecteur JavaScript.") + " Rouvre le fichier pour comparer les temps.");
    },
    colorer: function(b){ poserColorer(b ? b.getAttribute("data-colorer") : ""); },
    mesurer: function(){ outil("mesure"); },
    coordonnees: function(){ outil("point"); },
    "effacer-mesures": function(){ vue.effacerMesures(); etat("Mesures et coordonnées effacées."); maj(); },
    preferences: preferences,
    exporter: function(){ exporter(null); },
    "exporter-zip": function(){ exporter(null, true); },
    "exporter-fichier": function(b){ var f = parUid.get(+b.getAttribute("data-uid")); if (f) exporter(f); },
    "fermer-tout": function(){
      if (fichiers.some(modifie) && !confirm("Les modifications non exportées seront perdues. Tout fermer ?")) return;
      vider();
      modeEditeur(false);
      etat(""); window.scrollTo(0, 0);
    },
    annuler: annuler, retablir: retablir, supprimer: seulEd(supprimer),
    tout: function(){ $("#sel-tout").click(); },
    rien: function(){ var n = choix.size; choix.clear(); oublierActif(); if (n) etat(pluriel(n, "élément désélectionné", "éléments désélectionnés") + "."); },
    inverser: function(){ $("#sel-inv").click(); },
    "meme-type": function(){ comme(function(i, r){ return i.type === r.type; }, "le même type"); },
    "meme-materiau": function(){ comme(function(i, r){ return !!r.materiau && i.materiau === r.materiau; }, "le même matériau"); },
    similaires: function(){ if (actif) similaires(actif); },
    "meme-nom": function(){ comme(function(i, r){ return !!r.nom && i.nom === r.nom; }, "le même nom"); },
    recadrer: function(){ vue.recadrer(); },
    "vue-iso": function(){ vue.orienter(-Math.PI/4, Math.atan(Math.SQRT1_2)); },
    "vue-dessus": function(){ vue.orienter(0, 1.55); },
    "vue-face": function(){ vue.orienter(0, 0); },
    "vue-cote": function(){ vue.orienter(Math.PI/2, 0); },
    masquer: function(){ masquerCles(cibles()); },
    isoler: function(){ isolerCles(cibles()); },
    zoomer: function(){ zoomerCles(cibles()); },
    coupe: function(){ couperCles(cibles()); },
    "sans-coupe": sansCoupe,
    "dxf-axes": exporterDxfAxes,
    "equerre-coupe": equerreCoupe,
    "cadre-coupe": function(){
      var v = vue.cadre(!vue.cadre());
      etat(v ? "Boîte de coupe affichée." : "Boîte de coupe masquée : la coupe reste active.");
      maj();
    },
    "figer-coupe": function(){
      var f = vue.figer(!vue.fige());
      etat(f ? "Boîte de coupe figée : poignées masquées." : "Boîte de coupe libérée : tire les poignées pour la retoucher.");
      maj();
    },
    "tout-reduire": function(){ fichiers.forEach(function(f){ f.plie = true; }); rendreListe(); },
    "tout-developper": function(){ fichiers.forEach(function(f){ f.plie = false; }); plies.clear(); rendreListe(); },
    theme: function(b){ if (choisirTheme) choisirTheme(b.getAttribute("data-choix-theme")); },
    moteur: function(b){
      var v = b.getAttribute("data-moteur"), nom = b.querySelector("span").textContent;
      if (INDISPO[v]){ etat(nom + " indisponible : " + INDISPO[v]); return; }
      if (v === vue.moteur()) return;
      etat("Démarrage du moteur " + nom + "…");
      vue.moteur(v).then(function(n){
        moteurVoulu = v; garder("ifc.moteur", v);
        majVue();
        etat("Moteur d'affichage : " + n + ".");
      }).catch(function(err){
        INDISPO[v] = err && err.message || String(err); marquerIndispo();
        etat(nom + " n'a pas démarré (" + INDISPO[v] + ") : le moteur actuel reste en place.");
      });
    },
    geometrie: function(b){
      var v = b.getAttribute("data-geo");
      if (INDISPO[v]){ etat("web-ifc indisponible : " + INDISPO[v]); return; }
      geoVoulue = v; garder("ifc.geometrie", v);
      vue.sourceGeo(v === "webifc" ? "externe" : "maison");
      majVue();
      if (v === "webifc"){ echecsWebIfc.clear(); calculerWebIfc(); }
      else etat("Géométrie : lecteur de l'outil.");
    },
    site: function(){ location.href = "/"; },
    "tout-afficher": function(){ var n = caches.size; caches = new Set(); majVue(); if (n) etat(pluriel(n, "élément de nouveau affiché", "éléments de nouveau affichés") + "."); },
    raccourcis: function(){
      aide("Raccourcis clavier", '<div class="aide-table">' + [
        ["Ctrl+O", "Ouvrir des fichiers (remplace ceux ouverts)"], ["Ctrl+Maj+O", "Ajouter des fichiers"], ["Ctrl+S", "Exporter"],
        ["Ctrl+Z / Ctrl+Y", "Annuler / Rétablir"], ["Suppr", "Supprimer la sélection"], ["Ctrl+A", "Tout sélectionner"], ["Échap", "Ne rien sélectionner"],
        ["F", "Recadrer"], ["1 · 2 · 3 · 4", "Vue isométrique, dessus, face, côté"], ["H · I · Maj+H", "Masquer, isoler, tout afficher"],
        ["Z", "Zoomer sur la sélection"], ["B · Maj+B", "Boîte de coupe autour de la sélection, la retirer"],
        ["M", "Mesurer (deux clics ; Échap : annuler le point, puis quitter)"],
        ["C", "Coordonnées d'un point (X Y Z ; sur une face : Z seul)"],
        ["Glisser", "Tourner autour du point visé (Maj ou clic droit : déplacer)"], ["Molette, pincement", "Zoom"], ["Double-clic", "Recadrer"],
        ["E", "Basculer Viewer / Éditeur"],
        ["D · Maj+D", "Déplacer (valeurs, ou deux points accrochés)"], ["K · Maj+K", "Copier (valeurs, ou deux points accrochés)"],
        ["R", "Rotation autour de la verticale"], ["A", "Aligner : face de référence, puis faces à amener dessus"], ["L", "Changer d'étage"],
        ["Clic droit (liste)", "Réduire, développer, couleur de la maquette"],
        ["Clic droit (3D)", "Masquer, isoler, zoomer, boîte de coupe, sélectionner similaires ; en Éditeur : modifier"]
      ].map(function(x){ return "<kbd>" + esc(x[0]) + "</kbd><span>" + esc(x[1]) + "</span>"; }).join("") + "</div>");
    },
    "a-propos": function(){
      aide("Éditeur IFC", "<p>Ouvre des maquettes IFC2X3 ou IFC4, sélectionne des éléments, supprime-les proprement (relations, géométrie et propriétés devenues orphelines partent avec eux) et réécris le fichier.</p>" +
        "<p>Deux modes (bouton en haut, touche E). Viewer : naviguer, sélectionner, mesurer, couper, colorier par type, étage ou matériau. Éditeur : en plus déplacer, copier, tourner, aligner sur une face, changer d'étage, modifier les dimensions des extrusions, les attributs, les propriétés et la classe IFC, supprimer ; tout s'annule par Ctrl+Z.</p>" +
        "<p>Tout se passe dans ton navigateur : aucun fichier n'est envoyé, l'outil ne contacte aucun autre site.</p>" +
        "<p>Moteurs optionnels (menu Affichage), hébergés sur ce site et téléchargés au premier choix : Three.js (licence MIT) et web-ifc de That Open Company (licence MPL-2.0).</p>");
    }
  };
  function activerCmd(c, ok){ [].forEach.call(document.querySelectorAll('[data-cmd="' + c + '"]'), function(b){ b.disabled = !ok; }); }

  // ================= Barre de menus =================
  var mb = $("#mb"), groupes = [].slice.call(mb.querySelectorAll(".mb-gr")), ouvert = null;
  // boutons atteignables au clavier : actifs et affichés (un sous-menu fermé ne compte pas)
  function itemsDe(liste){ return [].filter.call(liste.querySelectorAll("button"), function(b){ return !b.disabled && b.getClientRects().length > 0; }); }
  function fermerMenu(){
    $("#infobulle").hidden = true;
    if (!ouvert) return;
    ouvert.liste.hidden = true;
    ouvert.titre.setAttribute("aria-expanded", "false");
    ouvert = null;
  }
  function ouvrirMenu(gr, focus){
    fermerMenu();
    var titre = gr.querySelector(".mb-titre"), liste = gr.querySelector(".mb-liste");
    maj();
    liste.hidden = false;
    titre.setAttribute("aria-expanded", "true");
    ouvert = { gr: gr, titre: titre, liste: liste };
    liste.style.left = "";
    var r = liste.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) liste.style.left = (window.innerWidth - 8 - r.right) + "px";
    if (focus){ var b = itemsDe(liste)[0]; if (b) b.focus(); }
  }
  groupes.forEach(function(gr){
    var titre = gr.querySelector(".mb-titre");
    titre.addEventListener("click", function(e){
      e.stopPropagation();
      if (ouvert && ouvert.gr === gr) fermerMenu(); else ouvrirMenu(gr, e.detail === 0);
    });
    titre.addEventListener("mouseenter", function(){ if (ouvert && ouvert.gr !== gr) ouvrirMenu(gr, false); });
  });
  mb.addEventListener("click", function(e){
    var b = e.target.closest("[data-cmd]");
    if (!b || b.disabled) return;
    fermerMenu();
    var f = COMMANDES[b.getAttribute("data-cmd")];
    if (f) f(b);
  });
  document.addEventListener("click", function(e){ if (ouvert && !mb.contains(e.target)) fermerMenu(); });
  // un sous-menu qui sortirait de l'écran à droite s'ouvre à gauche
  mb.addEventListener("mouseover", function(e){
    var sm = e.target.closest(".mb-sm");
    if (!sm) return;
    var sl = sm.querySelector(".mb-sl");
    sl.classList.remove("a-gauche");
    if (sl.getBoundingClientRect().right > window.innerWidth - 8) sl.classList.add("a-gauche");
  });
  // infobulle des choix de moteur : data-aide (description), data-alerte (avertissements séparés par |)
  var bulle = $("#infobulle");
  function montrerBulle(b){
    var aide = b.getAttribute("data-aide");
    if (!aide){ bulle.hidden = true; return; }
    var k = b.getAttribute("data-moteur") || b.getAttribute("data-geo"), al = (b.getAttribute("data-alerte") || "").split("|").filter(Boolean);
    bulle.innerHTML = "<p>" + esc(aide) + "</p>" + (al.length || INDISPO[k] ? "<ul>" +
      (INDISPO[k] ? '<li class="indispo">' + esc("Indisponible ici : " + INDISPO[k]) + "</li>" : "") +
      al.map(function(a){ return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>" : "");
    bulle.hidden = false;
    // à côté du sous-menu, du côté où il reste de la place ; sinon sous la ligne survolée
    var L = b.closest(".mb-liste").getBoundingClientRect(), r = b.getBoundingClientRect(), w = bulle.offsetWidth, h = bulle.offsetHeight;
    var x = L.right + 6, y = r.top;
    if (x + w > window.innerWidth - 8) x = L.left - 6 - w;
    if (x < 8){ x = Math.max(8, Math.min(r.left, window.innerWidth - 8 - w)); y = r.bottom + 4; }
    bulle.style.left = x + "px";
    bulle.style.top = Math.max(8, Math.min(y, window.innerHeight - 8 - h)) + "px";
  }
  mb.addEventListener("mouseover", function(e){ var b = e.target.closest("button"); if (b) montrerBulle(b); });
  mb.addEventListener("focusin", function(e){ montrerBulle(e.target); });
  mb.addEventListener("mouseleave", function(){ bulle.hidden = true; });
  mb.addEventListener("focusout", function(e){ if (!mb.contains(e.relatedTarget)) bulle.hidden = true; });
  mb.addEventListener("keydown", function(e){
    if (!ouvert) return;
    var its = itemsDe(ouvert.liste), i = its.indexOf(document.activeElement), gi = groupes.indexOf(ouvert.gr);
    if (e.key === "ArrowDown"){ e.preventDefault(); if (its.length) its[(i + 1) % its.length].focus(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); if (its.length) its[(i - 1 + its.length) % its.length].focus(); }
    else if (e.key === "ArrowRight" && document.activeElement.classList.contains("mb-sm-titre")){
      // entrer dans le sous-menu
      e.preventDefault();
      var sl = document.activeElement.parentNode.querySelector(".mb-sl button:not(:disabled)");
      if (sl) sl.focus();
    }
    else if (e.key === "ArrowLeft" && document.activeElement.closest(".mb-sl")){
      e.preventDefault();
      document.activeElement.closest(".mb-sm").querySelector(".mb-sm-titre").focus();
    }
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft"){
      e.preventDefault();
      // menus masqués en mode Viewer (Édition, Modifier) sautés
      var pas = e.key === "ArrowRight" ? 1 : -1, j = gi;
      for (var n = 0; n < groupes.length; n++){ j = (j + pas + groupes.length) % groupes.length; if (groupes[j].offsetParent) break; }
      ouvrirMenu(groupes[j], true);
    }
    else if (e.key === "Escape"){ e.preventDefault(); var t = ouvert.titre; fermerMenu(); t.focus(); }
  });

  // ================= Raccourcis clavier =================
  document.addEventListener("keydown", function(e){
    if (!fichiers.length || $("#editeur").hidden || ouvert || !ctx.hidden || document.querySelector("dialog[open]")) return;
    var t = e.target.tagName, saisie = t === "INPUT" || t === "SELECT" || t === "TEXTAREA";
    var k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey, c = null;
    if (mod && k === "o") c = e.shiftKey ? "ajouter" : "ouvrir";
    else if (mod && k === "s") c = "exporter";
    else if (saisie) return;
    else if (mod && k === "z" && !e.shiftKey) c = "annuler";
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) c = "retablir";
    else if (mod && k === "a") c = "tout";
    else if (mod || e.altKey) return;
    else if (e.key === "Delete" && choix.size && modeEd) c = "supprimer";
    else if (e.key === "Escape" && vue.enSaisie()){ e.preventDefault(); vue.annulerMesure(); maj(); return; }
    else if (e.key === "Escape" && vue.annulerMesure()){ e.preventDefault(); etat(vue.outil() ? "Point de départ annulé." : "Outil terminé."); maj(); return; }
    else if (e.key === "Escape" && choix.size) c = "rien";
    else if (k === "m") c = "mesurer";
    else if (k === "c") c = "coordonnees";
    else if (k === "f") c = "recadrer";
    else if (k === "1") c = "vue-iso";
    else if (k === "2") c = "vue-dessus";
    else if (k === "3") c = "vue-face";
    else if (k === "4") c = "vue-cote";
    else if (k === "h") c = e.shiftKey ? "tout-afficher" : "masquer";
    else if (k === "i") c = "isoler";
    else if (k === "z") c = "zoomer";
    else if (k === "b") c = e.shiftKey ? "sans-coupe" : "coupe";
    else if (k === "e") c = "mode";
    else if (k === "d") c = e.shiftKey ? "deplacer-points" : "deplacer";
    else if (k === "k") c = e.shiftKey ? "copier-points" : "copier";
    else if (k === "r") c = "tourner";
    else if (k === "a") c = "aligner-face";
    else if (k === "l") c = "etage";
    else if (e.key === "?") c = "raccourcis";
    if (!c) return;
    e.preventDefault();
    var b = document.querySelector('[data-cmd="' + c + '"]');
    maj();
    if (b && b.disabled) return;
    COMMANDES[c]();
  });

  window.addEventListener("beforeunload", function(e){
    if (fichiers.some(modifie)){ e.preventDefault(); e.returnValue = ""; }
  });

  // ================= Fichiers : bouton et glisser-déposer =================
  var entree = $("#fichier");
  function choisir(){ entree.value = ""; entree.click(); }
  $("#choisir").addEventListener("click", choisir);
  entree.addEventListener("change", function(){ if (entree.files && entree.files.length) charger(entree.files); });

  function deposeFichiers(e){ var t = e.dataTransfer && e.dataTransfer.types; return !!t && [].indexOf.call(t, "Files") >= 0; }
  var profondeur = 0;
  window.addEventListener("dragenter", function(e){
    if (!deposeFichiers(e)) return;
    e.preventDefault(); profondeur++;
    $("#depot").classList.add("survol");
  });
  window.addEventListener("dragover", function(e){
    if (!deposeFichiers(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", function(e){
    if (!deposeFichiers(e)) return;
    if (--profondeur <= 0){ profondeur = 0; $("#depot").classList.remove("survol"); }
  });
  window.addEventListener("drop", function(e){
    if (!deposeFichiers(e)) return;
    e.preventDefault(); profondeur = 0;
    $("#depot").classList.remove("survol");
    if (e.dataTransfer.files && e.dataTransfer.files.length) charger(e.dataTransfer.files);
  });

  // ================= Onglets (smartphone) =================
  function onglet(id){
    ["p-liste", "p-vue", "p-props"].forEach(function(p){ $("#" + p).classList.toggle("montre", p === id); });
    [].forEach.call(document.querySelectorAll("[data-onglet]"), function(b){ b.setAttribute("aria-selected", String(b.getAttribute("data-onglet") === id)); });
    if (id === "p-vue") vue.redessiner();
  }
  [].forEach.call(document.querySelectorAll("[data-onglet]"), function(b){
    b.addEventListener("click", function(){ onglet(b.getAttribute("data-onglet")); });
  });

  // ================= Thème sombre / clair / système =================
  var choisirTheme = null;
  (function(){
    var btn = $("#theme-btn"), menu = $("#menu-theme"), FOND = { clair: "#F3F0E8", sombre: "#050505" };
    function choisi(){ try { return localStorage.getItem("ifc.theme") || "sombre"; } catch (e){ return "sombre"; } }
    function applique(c){
      var eff = c === "systeme" ? (matchMedia("(prefers-color-scheme: light)").matches ? "clair" : "sombre") : c;
      document.documentElement.setAttribute("data-theme", eff);
      var m = document.querySelector("meta[name=theme-color]"); if (m) m.setAttribute("content", FOND[eff]);
      [].forEach.call(document.querySelectorAll("[data-choix-theme]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-choix-theme") === c)); });
    }
    // aussi dans le menu Affichage de l'éditeur
    choisirTheme = function(c){
      try { localStorage.setItem("ifc.theme", c); } catch (e){}
      applique(c);
    };
    function ouvre(o){ menu.hidden = !o; btn.setAttribute("aria-expanded", String(o)); }
    btn.addEventListener("click", function(e){ e.stopPropagation(); ouvre(menu.hidden); });
    document.addEventListener("click", function(e){ if (!menu.hidden && !menu.contains(e.target)) ouvre(false); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape" && !menu.hidden){ ouvre(false); btn.focus(); } });
    [].forEach.call(menu.querySelectorAll("[data-choix-theme]"), function(b){
      b.addEventListener("click", function(){
        var c = b.getAttribute("data-choix-theme");
        try { localStorage.setItem("ifc.theme", c); } catch (e){}
        applique(c); ouvre(false); btn.focus();
      });
    });
    try { matchMedia("(prefers-color-scheme: light)").addEventListener("change", function(){ if (choisi() === "systeme") applique("systeme"); }); } catch (e){}
    applique(choisi());
  })();

  // Révélation de l'accueil (dessin du pied de poteau)
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ $("#accueil").classList.add("vu"); }); });
})();
