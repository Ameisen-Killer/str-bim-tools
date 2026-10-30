// /fgh/ : validation des réservations FGH par l'ingénieur, sans Revit.
// - Ouvre l'IFC des réservations (jeu de propriétés STR_FGH_RES ajouté par le bouton Revit « Export IFC RES »)
//   et l'IFC light de la structure, superposés dans la même vue 3D (fgh-vue.js, copie de /ifc/).
// - L'ingénieur change PVA_RES_VAL_Statut, PVA_RES_VAL_Date et PVA_RES_VAL_Commentaire ; chaque changement
//   s'écrit aussitôt dans le fichier JSON branché (Chrome / Edge, format STR_FGH_RES_VALIDATION), que le
//   modeleur applique avec « Import Validation RES ». Sans fichier branché, la page est en lecture seule :
//   le navigateur ne garde aucune décision.
// - Clé d'échange : l'ADN (CONTROL_NE_PAS_TOUCHER), comme l'outil « Sync Reservations » ; le UniqueId Revit
//   voyage avec pour départager un ADN en double et repérer une demande resoumise.
// Aucun envoi réseau : les fichiers ne quittent pas le poste.
(function(){
  "use strict";

  var VERSION = "1.6.0";
  var FORMAT = "STR_FGH_RES_VALIDATION", PSET = "STR_FGH_RES", PSET_STR = "STR_FGH_STR";
  var P_ST = "PVA_RES_VAL_Statut", P_DATE = "PVA_RES_VAL_Date", P_COM = "PVA_RES_VAL_Commentaire";
  var PARAMS = [P_ST, P_DATE, P_COM];
  var LIB = {}; LIB[P_ST] = "Statut"; LIB[P_DATE] = "Date"; LIB[P_COM] = "Commentaire";
  // Valeurs proposées : lues par « Sync Reservations » (VALID… = copiée en STR, REFUS… = refusée, autre = non copiée)
  var STATUTS = [["", "En attente"], ["VALIDE", "Validée"], ["REFUSE", "Refusée"], ["A REVOIR", "À revoir"]];
  // teinte de la vue (remplissage pastel, arêtes du même ton plus soutenu) et classe des pastilles
  var TEINTE = { valide: 135, refuse: 4, revoir: 36, attente: 212, autre: 275 };
  var NOM_CLASSE = { valide: "Validée", refuse: "Refusée", revoir: "À revoir", attente: "En attente", autre: "Autre statut" };

  var $ = function(s){ return document.querySelector(s); };
  var C = IFC.champs, R = IFC.idRef, L = IFC.refsListe;
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pluriel(n, mot){ return n + " " + mot + (n > 1 ? "s" : ""); }
  function pause(){ return new Promise(function(ok){ setTimeout(ok, 0); }); }
  function lsGet(k, d){ try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e){ return d; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch (e){} }
  function lsDel(k){ try { localStorage.removeItem(k); } catch (e){} }

  $("#version").textContent = "v" + VERSION;

  // ================= État =================
  var fichiers = [], uidF = 1;             // { uid, m, nom, role: "res" | "str", ids }
  var RES = [], parCle = new Map();        // réservations ; clé de la vue → réservation
  var niveaux = [];                        // étages IFC { nom, z } triés par altitude
  var maquette = { nom: "", export_du: "" };
  var modifs = new Map();                  // clé stable (ADN) → { k, cle, uid, eid, num, famille, niveau, v: { param: { ancien, nouveau } } }
  var heritage = [];                       // décisions gardées dans le navigateur par les versions < 1.4 : à reprendre ou jeter
  var sel = new Set(), actif = null;
  var voirStructure = true, voirRes = true;
  var angleBat = 0;                        // orientation du bâtiment (IFC géoréférencés : axes tournés)
  var angleProjet = 0;                     // axes du projet Revit dans le fichier : orientation du cube de navigation
  var nivAuto = "";                        // niveau mis dans le filtre de la liste par la coupe par niveau

  var cube = null;
  var vue = IFCVue.creer($("#vue"), { surClic: cliqueVue, surMesure: etat, surCamera: function(l, p){ if (cube) cube.camera(l, p); } });
  vue.formats({
    longueur: function(v){ return (Math.round(v*1000)/1000).toFixed(3) + " m"; },
    point: function(p, zSeul){ return (zSeul ? ["Z"] : ["X", "Y", "Z"]).map(function(n){ return n + " " + p["XYZ".indexOf(n)].toFixed(3); }); }
  });
  function etat(t){ $("#etat").textContent = t || ""; }

  // Cube de navigation (comme le ViewCube de Revit) à la place des boutons « 3D » et « Dessus ». Vue de
  // départ (maison) : celle de la vue 3D par défaut de Revit, depuis le coin haut, avant, droite du projet.
  var PLONGEE_MAISON = Math.atan(Math.SQRT1_2);
  function vueMaison(){ vue.allerVers(angleProjet + Math.PI/4, PLONGEE_MAISON, null, true); }   // la maison recadre tout, comme Revit
  cube = FGHCube.creer($("#cube"), vue, { maison: vueMaison });
  // lissage des bords : actif par défaut, choix gardé dans ce navigateur (simple préférence d'affichage)
  vue.lissage(lsGet("fgh.lissage", "1") === "1"); $('[data-c="lissage"]').setAttribute("aria-pressed", String(vue.lissage()));
  // le cube se range sous la barre d'outils, plus haute quand les boutons passent sur plusieurs lignes
  function placerCube(){ var o = $("#outils"); $("#cube").style.top = (o.hidden ? 10 : o.offsetTop + o.offsetHeight + 10) + "px"; }
  if ("ResizeObserver" in window) new ResizeObserver(placerCube).observe($("#outils"));
  // Repère du projet Revit : axe X du placement du bâtiment (sinon du site), la structure d'abord ; nord
  // géographique : TrueNorth du contexte 3D du même fichier, +Y par défaut
  function repereProjet(){
    for (var i = 0; i < fichiers.length; i++){
      var m = fichiers[i].m, bat = 0, site = 0, ctx = null;
      m.ent.forEach(function(e){
        if (!bat && e.type === "IFCBUILDING") bat = e.id;
        else if (!site && e.type === "IFCSITE") site = e.id;
        else if (e.type === "IFCGEOMETRICREPRESENTATIONCONTEXT" && (!ctx || (IFC.chaine(C(e)[1]) === "Model" && IFC.chaine(C(ctx)[1]) !== "Model"))) ctx = e;
      });
      var a = bat ? vue.angleRepere(m, bat) : null;
      if (a == null && site) a = vue.angleRepere(m, site);
      if (a == null) continue;
      var d = ctx && m.ent.get(R(C(ctx)[5])), r = d && d.type === "IFCDIRECTION" ? C(d)[0] : null, nord = Math.PI/2;
      if (Array.isArray(r) && r.length > 1){
        var x = IFC.nombre(r[0]), y = IFC.nombre(r[1]);
        if (isFinite(x) && isFinite(y) && (x || y)) nord = Math.atan2(y, x);
      }
      return { angle: a, nord: nord };
    }
    return { angle: angleBat, nord: Math.PI/2 };
  }

  // ================= Statuts =================
  function classe(v){
    var u = String(v || "").trim().toUpperCase();
    if (!u) return "attente";
    if (/INVALID|NON VALID|PAS VALID/.test(u)) return "autre";
    if (u.indexOf("VALID") >= 0) return "valide";
    if (u.indexOf("REFUS") >= 0) return "refuse";
    if (u.indexOf("REVOIR") >= 0) return "revoir";
    return "autre";
  }
  // Entrée d'une modification : { ancien, nouveau, par, quand } ; retire : true = décision annulée, gardée pour que
  // la fusion d'un fichier partagé ne la fasse pas revenir
  function vive(x){ return !!x && !x.retire; }
  function vives(m){ return m ? PARAMS.filter(function(p){ return vive(m.v[p]); }) : []; }
  function valeur(r, p){ var m = modifs.get(r.k), x = m && m.v[p]; return vive(x) ? x.nouveau : (r.ifc[p] || ""); }
  function modifie(r, p){ var m = modifs.get(r.k); return p ? !!(m && vive(m.v[p])) : vives(m).length > 0; }
  function teinte(r){ return TEINTE[classe(valeur(r, P_ST))]; }
  function aujourdhui(){ var d = new Date(); return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear(); }
  function versIso(t){ var m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(String(t || "").trim()); return m ? m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2) : ""; }
  function depuisIso(t){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }

  // ================= Lecture des fichiers =================
  var avecWorker = typeof Worker !== "undefined";
  function lireFichier(f){ return f.arrayBuffer ? f.arrayBuffer() : new Promise(function(ok, ko){ var r = new FileReader(); r.onload = function(){ ok(r.result); }; r.onerror = function(){ ko(r.error); }; r.readAsArrayBuffer(f); }); }
  function lireClassique(f){ return lireFichier(f).then(function(b){ return pause().then(function(){ return IFC.lire(b, f.name); }); }); }
  function lecture(f, progres){
    if (!avecWorker) return lireClassique(f);
    return lireFichier(f).then(function(buf){
      return new Promise(function(ok, ko){
        var w;
        try { w = new Worker("/fgh/fgh-lecteur.js?v=2"); }
        catch (e){ avecWorker = false; lireClassique(f).then(ok, ko); return; }
        w.onmessage = function(e){
          var d = e.data;
          if (d.progres !== undefined){ progres(.7*d.progres); return; }
          w.terminate();
          if (d.erreur){ var err = new Error(d.erreur); err.ifc = d.ifc; ko(err); return; }
          IFC.lireParEtapes(d.resultat, new Uint8Array(d.buffer), f.name, function(p, etape){ progres(etape === "texte" ? .7 + .1*p : .8 + .2*p); }).then(ok, ko);
        };
        w.onerror = function(e){ if (e && e.preventDefault) e.preventDefault(); w.terminate(); avecWorker = false; lireClassique(f).then(ok, ko); };
        w.postMessage({ buffer: buf }, [buf]);
      });
    });
  }
  function progres(t, p){ $("#chargement").hidden = false; $("#chargement-txt").textContent = t; $("#prog").style.width = Math.round(100*p) + "%"; }

  // Réservations d'un modèle : éléments liés au jeu STR_FGH_RES → { id, p: { nom: texte } }
  function reservationsDe(m){
    var psets = new Map(), out = [];
    m.ent.forEach(function(e){
      if (e.type !== "IFCPROPERTYSET" || IFC.chaine(C(e)[2]) !== PSET) return;
      var p = {};
      L(C(e)[4]).forEach(function(r){ var x = m.ent.get(r); if (x && x.type === "IFCPROPERTYSINGLEVALUE"){ var a = C(x); p[IFC.chaine(a[0])] = IFC.chaine(a[2]); } });
      psets.set(e.id, p);
    });
    if (!psets.size) return null;
    m.ent.forEach(function(e){
      if (e.type !== "IFCRELDEFINESBYPROPERTIES") return;
      var a = C(e), p = psets.get(R(a[5]));
      if (p) L(a[4]).forEach(function(id){ out.push({ id: id, p: p }); });
    });
    return out;
  }
  // Structure : éléments construits en phase nouvelle → Set d'ids. Jeu STR_FGH_STR (Nouveau = 1) de « Export IFC RES »,
  // ou propriété Revit « Phase de création » / « Phase Created » = New Construction / Nouvelle construction (export natif)
  var PHASE_NOM = /^phase (de cr[ée]ation|created)$/i, PHASE_NEUVE = /new construction|nouv/i;
  function neufsDe(m){
    var neufs = new Set(), psets = new Set();
    m.ent.forEach(function(e){
      if (e.type !== "IFCPROPERTYSET") return;
      var nom = IFC.chaine(C(e)[2]);
      L(C(e)[4]).forEach(function(r){
        var x = m.ent.get(r);
        if (!x || x.type !== "IFCPROPERTYSINGLEVALUE") return;
        var n = IFC.chaine(C(x)[0]), v = IFC.chaine(C(x)[2]);
        if (nom === PSET_STR ? n === "Nouveau" && v === "1" : PHASE_NOM.test(n) && PHASE_NEUVE.test(v)) psets.add(e.id);
      });
    });
    if (psets.size) m.ent.forEach(function(e){
      if (e.type === "IFCRELDEFINESBYPROPERTIES" && psets.has(R(C(e)[5]))) L(C(e)[4]).forEach(function(id){ neufs.add(id); });
    });
    return neufs;
  }
  function elementsDe(m){
    return IFC.arbre(m).map(function(x){ return x.id; }).filter(function(id){ var i = IFC.infos(m, id); return i && i.genre === "element"; });
  }

  // apres : appelé une fois les IFC affichés (JSON glissé avec eux et lu sans y écrire)
  function ouvrir(liste, apres){
    liste = Array.prototype.filter.call(liste || [], function(f){ return /\.ifc$/i.test(f.name); });
    if (!liste.length){ etat("Choisis des fichiers .ifc."); return; }
    var suite = Promise.resolve(), nouveaux = [];
    liste.forEach(function(f, n){
      suite = suite.then(function(){
        var nom = "« " + f.name + " »" + (liste.length > 1 ? " (" + (n + 1) + "/" + liste.length + ")" : "");
        return lecture(f, function(p){ progres("Lecture de " + nom + "…", p); }).then(function(m){
          progres("Analyse de " + nom + "…", 1);
          return pause().then(function(){
            var r = reservationsDe(m);
            var fi = { uid: uidF++, m: m, nom: f.name, role: r ? "res" : "str", res: r, neufs: r ? null : neufsDe(m) };
            fi.ids = r ? r.map(function(x){ return x.id; }) : elementsDe(m);
            nouveaux.push(fi);
          });
        });
      });
    });
    suite.then(function(){
      // une seule maquette RES à la fois ; un fichier de même nom remplace l'ancien
      nouveaux.forEach(function(fi){
        fichiers = fichiers.filter(function(x){ return !(fi.role === "res" && x.role === "res") && x.nom !== fi.nom; });
        fichiers.push(fi);
      });
      fichiers.sort(function(a, b){ return a.role === b.role ? 0 : a.role === "str" ? -1 : 1; });
      vue.modeles(fichiers.map(function(x){ return x.m; }));
      var s = Promise.resolve();
      fichiers.forEach(function(fi){
        s = s.then(function(){ return vue.preparer(fi.m, fi.ids, function(p){ progres("Géométrie 3D de « " + fi.nom + " » : " + Math.round(100*p) + " %", p); }); });
      });
      return s;
    }).then(function(){
      $("#chargement").hidden = true;
      construire();
      var nRes = fichiers.filter(function(x){ return x.role === "res"; }).length;
      etat(fichiers.map(function(x){ return (x.role === "res" ? "Réservations : " : "Structure : ") + x.nom; }).join(" · ") +
        (nRes ? "" : " · Il manque l'IFC des réservations (…_RES.ifc, exporté par « Export IFC RES »)."));
      if (apres) apres();
    }).catch(function(err){
      $("#chargement").hidden = true;
      etat("Lecture impossible : " + (err && err.message || err));
      if (window.console) console.error(err);
    });
  }

  // ================= Construction des réservations et des niveaux =================
  function construire(){
    RES = []; parCle = new Map(); maquette = { nom: "", export_du: "" };
    var fr = fichiers.filter(function(x){ return x.role === "res"; })[0];
    if (fr){
      var vus = new Set();
      fr.res.forEach(function(x){
        if (vus.has(x.id)) return; vus.add(x.id);
        var p = x.p, r = {
          cle: "r" + fr.uid + ":" + x.id, f: fr, id: x.id, p: p,
          adn: (p["Cle ADN"] || "").trim(), uid: p["Revit UniqueId"] || "", eid: p["Revit ElementId"] || "",
          num: p["Numero"] || "", niveau: p["Niveau"] || p["Niveau associe"] || "", famille: p["Famille"] || "", type: p["Type"] || "",
          ifc: {}
        };
        PARAMS.forEach(function(k){ r.ifc[k] = p[k] || ""; });
        r.k = r.adn || ("uid:" + r.uid);
        // ignorée par « Sync Reservations », qui ne prend que les ADN « …_STATUT… » non mutualisés : la décision
        // s'écrit dans la RES mais n'ira pas dans la STR (« Mutualise » : exports à partir de la 1.5.0)
        r.horsSync = /^(oui|yes|true|1)$/i.test(String(p["Mutualise"] || "").trim()) ? "mutualisée (FGH_MUTUALISE)" :
          r.adn.indexOf("_STATUT") < 0 ? (r.adn ? "ADN sans « _STATUT »" : "sans ADN") : "";
        r.txt = [r.num, r.famille, r.niveau, p["Demandeur"], p["Commentaire demande"], p["RES Responsable"], r.ifc[P_COM], r.adn, r.horsSync ? "hors synchro" : ""].join(" ").toLowerCase();
        RES.push(r); parCle.set(r.cle, r);
        if (!maquette.nom && p["Maquette"]){ maquette.nom = p["Maquette"]; maquette.export_du = p["Export du"] || ""; }
      });
    }
    // niveaux : étages des fichiers, réunis par nom (altitude de la structure en priorité)
    var parNom = new Map();
    fichiers.forEach(function(fi){
      fi.m.ent.forEach(function(e){
        if (e.type !== "IFCBUILDINGSTOREY") return;
        var nom = IFC.chaine(C(e)[2]), o = vue.origine(fi.m, e.id);
        if (!nom || !o || parNom.has(nom)) return;
        parNom.set(nom, o[2]);
      });
    });
    niveaux = Array.from(parNom, function(x){ return { nom: x[0], z: x[1] }; }).sort(function(a, b){ return a.z - b.z; });
    chargerModifs();
    sel = new Set(); actif = null;
    remplirNiveaux();
    $("#accueil").hidden = fichiers.length > 0;
    $("#outils").hidden = $("#cube").hidden = !fichiers.length;
    nivAuto = "";
    afficher();
    angleBat = vue.angleDe(RES.length ? RES.map(function(r){ return r.cle; }) : null) || 0;
    var rp = repereProjet();
    angleProjet = rp.angle;
    cube.repere(angleProjet, rp.nord);
    placerCube();
    vue.orienter(angleProjet + Math.PI/4, PLONGEE_MAISON);
    renduListe(); renduFiche(); renduModifs(); legende(); titresBoutons(); majBoite();
    fsDemarrer();
  }

  // infobulles des boutons Structure / Réservations : nom des fichiers ouverts
  function titresBoutons(){
    [["structure", "str", "la structure"], ["res", "res", "les réservations"]].forEach(function(x){
      var noms = fichiers.filter(function(f){ return f.role === x[1]; }).map(function(f){ return f.nom; });
      var b = document.querySelector('[data-c="' + x[0] + '"]');
      if (b) b.title = "Afficher ou masquer " + x[2] + (noms.length ? " : " + noms.join(", ") : "");
    });
  }
  function rangNiveau(nom){ for (var i = 0; i < niveaux.length; i++) if (niveaux[i].nom === nom) return i; return 1e6; }
  function remplirNiveaux(){
    var noms = Array.from(new Set(RES.map(function(r){ return r.niveau; }))).sort(function(a, b){ return rangNiveau(a) - rangNiveau(b) || (a < b ? -1 : a > b ? 1 : 0); });
    $("#f-niv").innerHTML = '<option value="">Tous les niveaux</option>' + noms.map(function(n){ return '<option value="' + esc(n) + '">' + esc(n || "(sans niveau)") + "</option>"; }).join("");
    $("#c-niv").innerHTML = '<option value="">Coupe par niveau…</option>' + niveaux.map(function(n, i){ return '<option value="' + i + '">' + esc(n.nom) + "</option>"; }).join("");
  }

  // ================= Filtres et liste =================
  function filtrees(){
    var t = $("#f-txt").value.trim().toLowerCase(), n = $("#f-niv").value, s = $("#f-st").value, mots = t ? t.split(/\s+/) : [];
    return RES.filter(function(r){
      if (n && r.niveau !== n) return false;
      if (s === "modif"){ if (!modifie(r)) return false; }
      else if (s === "attente"){ if (classe(valeur(r, P_ST)) !== "attente") return false; }
      else if (s){ if (classe(valeur(r, P_ST)) !== classe(s)) return false; }
      for (var i = 0; i < mots.length; i++) if (r.txt.indexOf(mots[i]) < 0) return false;
      return true;
    });
  }
  function trier(l){ return l.sort(function(a, b){ return rangNiveau(a.niveau) - rangNiveau(b.niveau) || (a.num < b.num ? -1 : a.num > b.num ? 1 : 0); }); }
  var htmlLigne = new Map();               // dernier rendu de chaque ligne de la liste
  function ligneRes(r){
    var c = classe(valeur(r, P_ST)), st = valeur(r, P_ST);
    var h = '<div class="res' + (sel.has(r.cle) ? " sel" : "") + '" data-cle="' + esc(r.cle) + '"><span class="pastille s-' + c + '"></span>' +
      '<span class="num">' + esc(r.num || "(sans N°)") + (modifie(r) ? '<i title="Modifiée ici">●</i>' : "") + "</span>" +
      '<span class="st">' + esc(st || "En attente") + "</span>" +
      '<span class="sous">' + (r.horsSync ? '<b class="hs-l" title="Ignorée par « Sync Reservations » : ' + esc(r.horsSync) + '">hors synchro</b> · ' : "") +
      esc([r.niveau, r.famille, r.p["Demandeur"]].filter(Boolean).join(" · ")) + "</span></div>";
    htmlLigne.set(r.cle, h);
    return h;
  }
  var liste = [];
  function renduListe(){
    liste = trier(filtrees());
    $("#nb-res").textContent = RES.length;
    $("#f-compte").textContent = RES.length ? liste.length + " / " + pluriel(RES.length, "réservation") : "";
    $("#liste").innerHTML = RES.length ? (liste.length ? liste.map(ligneRes).join("") : '<div class="vide-liste">Aucune réservation ne correspond au filtre.</div>') :
      '<div class="vide-liste">' + (fichiers.length ? "Aucune réservation : ouvre aussi l'IFC …_RES.ifc exporté par « Export IFC RES »." : "Ouvre les IFC pour voir les réservations.") + "</div>";
  }
  // ligne remplacée seulement si elle change : un élément remplacé pendant un clic fait perdre ce clic
  function majLigne(r){
    var avant = htmlLigne.get(r.cle), h = ligneRes(r), el = $('#liste [data-cle="' + r.cle + '"]');
    if (el && h !== avant) el.outerHTML = h;
  }
  // la vue 3D suit la liste filtrée
  var minutFiltre = 0;
  function filtreChange(){
    renduListe();
    clearTimeout(minutFiltre);
    minutFiltre = setTimeout(afficher, 180);
  }
  $("#f-txt").addEventListener("input", filtreChange);
  $("#f-niv").addEventListener("change", function(){ nivAuto = ""; filtreChange(); });
  $("#f-st").addEventListener("change", filtreChange);
  $("#f-raz").addEventListener("click", function(){ $("#f-txt").value = ""; $("#f-niv").value = ""; $("#f-st").value = ""; nivAuto = ""; filtreChange(); });
  $("#liste").addEventListener("click", function(e){
    var el = e.target.closest(".res");
    if (!el) return;
    choisir(el.getAttribute("data-cle"), e.ctrlKey || e.metaKey, e.shiftKey);
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) vue.cadrer([el.getAttribute("data-cle")]);
  });

  // ================= Vue 3D =================
  function items(){
    var out = [];
    if (voirStructure) fichiers.forEach(function(fi){ if (fi.role === "str") fi.ids.forEach(function(id){ out.push({ cle: "s" + fi.uid + ":" + id, m: fi.m, id: id, h: null, rose: fi.neufs.has(id) }); }); });
    if (voirRes) filtrees().forEach(function(r){ out.push({ cle: r.cle, m: r.f.m, id: r.id, h: teinte(r) }); });
    return out;
  }
  function afficher(){
    var b = vue.afficher(items());
    vue.selection(sel, actif);
    return b;
  }
  function recolorer(){ vue.recolorer(function(cle){ var r = parCle.get(cle); return r ? teinte(r) : null; }); legende(); }
  function legende(){
    var neufs = 0;
    fichiers.forEach(function(fi){ if (fi.neufs) neufs += fi.neufs.size; });
    if (!RES.length && !neufs){ $("#legende").hidden = true; return; }
    var n = {};
    RES.forEach(function(r){ var c = classe(valeur(r, P_ST)); n[c] = (n[c] || 0) + 1; });
    $("#legende").innerHTML = ["attente", "valide", "refuse", "revoir", "autre"].filter(function(c){ return n[c]; })
      .map(function(c){ return '<span><i class="pastille s-' + c + '"></i>' + NOM_CLASSE[c] + " · " + n[c] + "</span>"; }).join("") +
      (neufs ? '<span><i class="pastille s-neuf"></i>Structure nouvelle</span>' : "");
    $("#legende").hidden = false;
  }
  function cliqueVue(cle, e){
    var plus = e && (e.ctrlKey || e.metaKey || e.shiftKey);
    if (cle && parCle.has(cle)){ choisir(cle, plus); var el = $('#liste [data-cle="' + cle + '"]'); if (el) el.scrollIntoView({ block: "nearest" }); return; }
    if (cle){
      var m = /^s(\d+):(\d+)$/.exec(cle), fi = m && fichiers.filter(function(x){ return x.uid === +m[1]; })[0], i = fi && IFC.infos(fi.m, +m[2]);
      if (i) etat("Structure : " + [i.typeLib, i.nom, i.objectType, fi.neufs && fi.neufs.has(+m[2]) ? "phase nouvelle" : ""].filter(Boolean).join(" · "));
    }
    if (!plus){ sel = new Set(); actif = null; vue.selection(sel, actif); renduListe(); renduFiche(); }
  }
  function choisir(cle, ajouter, plage){
    if (plage && actif && liste.length){
      var i0 = liste.findIndex(function(r){ return r.cle === actif; }), i1 = liste.findIndex(function(r){ return r.cle === cle; });
      if (i0 >= 0 && i1 >= 0){ for (var i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) sel.add(liste[i].cle); }
      else sel.add(cle);
    } else if (ajouter){ if (sel.has(cle)) sel.delete(cle); else sel.add(cle); }
    else sel = new Set([cle]);
    actif = sel.has(cle) ? cle : (sel.size ? Array.from(sel)[sel.size - 1] : null);
    vue.selection(sel, actif);
    Array.prototype.forEach.call(document.querySelectorAll("#liste .res"), function(el){ el.classList.toggle("sel", sel.has(el.getAttribute("data-cle"))); });
    renduFiche();
  }

  // Outils de la vue
  function boiteNiveau(i){
    var n = niveaux[i], b = vue.boiteDe(null, angleBat);
    if (!n || !b) return;
    // boîte centrée sur l'altitude du niveau Revit : la même distance dessous et dessus
    var marge = Math.max(0.05, parseFloat($("#c-marge").value) || 0), haut = n.z + marge;
    vue.coupeBoite({ min: [b.min[0] - 1, b.min[1] - 1, n.z - marge], max: [b.max[0] + 1, b.max[1] + 1, haut], a: angleBat });
    $("#c-niv").value = String(i);
    // la liste suit le niveau quand des réservations le portent (et revient à tous les niveaux sans la coupe)
    if (Array.prototype.some.call($("#f-niv").options, function(o){ return o.value === n.nom; })){ $("#f-niv").value = nivAuto = n.nom; filtreChange(); }
    etat("Coupe sur " + n.nom + " : de " + (n.z - marge).toFixed(2) + " à " + haut.toFixed(2) + " m.");
    majBoite();
  }
  // Boîte autour de réservations, à 1 m tout autour (demande de Tony), parallèle à elles (et non aux axes du fichier, tournés par le géoréférencement)
  function boiteAutour(cles){
    var a = vue.angleDe(cles);
    vue.orienterCoupe(a == null ? angleBat : a);
    vue.coupe(cles, 1);
    $("#c-niv").value = "";
    majBoite();
  }
  // boîte de coupe de l'ensemble des maquettes affichées
  function boiteTout(){
    var b = vue.boiteDe(null, angleBat);
    if (!b) return;
    vue.coupeBoite({ min: b.min.map(function(v){ return v - .5; }), max: b.max.map(function(v){ return v + .5; }), a: angleBat });
    $("#c-niv").value = "";
    majBoite();
  }
  // le bouton « Boîte de coupe » est enfoncé tant qu'une boîte est posée
  function majBoite(){ var b = document.querySelector('[data-c="boite"]'); if (b) b.setAttribute("aria-pressed", String(vue.aCoupe())); }
  // boîte enlevée : la liste quitte le niveau que la coupe par niveau y avait mis, si on n'y a pas touché
  function finCoupe(){
    vue.coupeBoite(null);
    $("#c-niv").value = "";
    if (nivAuto && $("#f-niv").value === nivAuto){ $("#f-niv").value = ""; filtreChange(); }
    nivAuto = "";
    majBoite();
  }
  $("#c-niv").addEventListener("change", function(){ var v = this.value; if (v === "") finCoupe(); else boiteNiveau(+v); });
  $("#c-marge").addEventListener("input", function(){ var v = $("#c-niv").value; if (v !== "") boiteNiveau(+v); });
  function outil(nom){
    var cur = vue.outil(), nv = cur === nom ? null : nom;
    vue.outil(nv);
    Array.prototype.forEach.call(document.querySelectorAll('[data-c="mesure"],[data-c="point"]'), function(b){ b.setAttribute("aria-pressed", String(b.getAttribute("data-c") === nv)); });
    etat(nv === "mesure" ? "Mesure : clique deux points (sommets, milieux, arêtes ou faces). Échap pour sortir." : nv === "point" ? "Coordonnées : clique un point." : "");
  }
  $("#outils").addEventListener("click", function(e){
    var b = e.target.closest("[data-c]");
    if (!b) return;
    var c = b.getAttribute("data-c"), v;
    if (c === "cadrer") vue.recadrer();
    else if (c === "lissage"){ var on = !vue.lissage(); vue.lissage(on); b.setAttribute("aria-pressed", String(on)); lsSet("fgh.lissage", on ? "1" : "0"); }
    else if (c === "niv-bas" || c === "niv-haut"){
      v = $("#c-niv").value;
      var i = v === "" ? (c === "niv-bas" ? niveaux.length - 1 : 0) : +v + (c === "niv-bas" ? -1 : 1);
      if (i >= 0 && i < niveaux.length) boiteNiveau(i);
    }
    else if (c === "boite"){
      if (vue.aCoupe()){ finCoupe(); vue.recadrer(); }
      else if (sel.size) boiteAutour(Array.from(sel));
      else boiteTout();
    }
    else if (c === "mesure" || c === "point") outil(c);
    else if (c === "effacer"){ vue.effacerMesures(); etat(""); }
    else if (c === "structure"){ voirStructure = !voirStructure; b.setAttribute("aria-pressed", String(voirStructure)); afficher(); }
    else if (c === "res"){ voirRes = !voirRes; b.setAttribute("aria-pressed", String(voirRes)); afficher(); }
  });
  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape" || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) return;
    if (vue.annulerMesure()){ if (!vue.outil()) outil(null); return; }
    if (sel.size){ sel = new Set(); actif = null; vue.selection(sel, actif); renduListe(); renduFiche(); }
  });

  // ================= Fiche =================
  function dl(lignes){ return "<dl>" + lignes.filter(function(l){ return l[1]; }).map(function(l){ return "<dt>" + esc(l[0]) + "</dt><dd>" + esc(l[1]) + "</dd>"; }).join("") + "</dl>"; }
  function dims(p){
    if (p["Diametre"] && parseFloat(p["Diametre"])) return "Ø " + p["Diametre"] + (p["Profondeur"] ? " · prof. " + p["Profondeur"] : "");
    var d = [p["Hauteur"], p["Longueur"], p["Profondeur"]].filter(Boolean);
    return d.length ? "H " + (p["Hauteur"] || "?") + " × L " + (p["Longueur"] || "?") + " × P " + (p["Profondeur"] || "?") : "";
  }
  function marque(r, p){
    var x = modifie(r, p) ? modifs.get(r.k).v[p] : null;
    return x ? '<span class="mod">modifié' + (x.par ? " par " + esc(x.par) : "") + ' (était « ' + esc(r.ifc[p] || "vide") + ' »)<button type="button" data-annuler="' + p + '" title="Revenir à la valeur de la maquette">↺</button></span>' : '<span class="p">' + p + "</span>";
  }
  // étiquette d'un champ ; data-m garde son contenu pour ne la refaire que s'il change
  function etiquette(r, p){ var h = esc(LIB[p]) + " " + marque(r, p); return '<label data-m="' + esc(h) + '">' + h + "</label>"; }
  function optionsStatut(v){
    var l = STATUTS.slice();
    if (v && !l.some(function(x){ return x[0] === v; })) l.push([v, v]);
    return l.map(function(x){ return '<option value="' + esc(x[0]) + '"' + (x[0] === v ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("");
  }
  function boutonsDecision(cl){
    return '<div class="decision">' +
      '<button type="button" class="s-valide" data-dec="VALIDE" aria-pressed="' + (cl === "valide") + '">✓ Valider</button>' +
      '<button type="button" class="s-refuse" data-dec="REFUSE" aria-pressed="' + (cl === "refuse") + '">✗ Refuser</button>' +
      '<button type="button" class="s-revoir" data-dec="A REVOIR" aria-pressed="' + (cl === "revoir") + '">À revoir</button></div>';
  }
  function choisis(){ return Array.from(sel).map(function(c){ return parCle.get(c); }).filter(Boolean); }
  // sans fichier branché, la page ne fait que montrer : le fichier est la seule mémoire des décisions
  function bandeauRO(){
    if (FS.actif) return "";
    var b = !FS.ok ? "" : FS.h ? '<button type="button" class="bt prim" data-m="fs-reprendre">Reprendre ' + esc(FS.nom) + "</button>" :
      '<button type="button" class="bt prim" data-m="fs-ouvrir">Ouvrir un JSON…</button><button type="button" class="bt prim" data-m="fs-nouveau">Créer un nouveau JSON…</button>';
    return '<div class="ro"><b>Lecture seule</b> · ' + (FS.ok ? "ouvre le JSON de validation, ou crée-le, pour décider." : "ce navigateur ne sait pas écrire dans un fichier : ouvre la page dans Chrome ou Edge pour décider.") +
      (b ? '<div class="actions">' + b + "</div>" : "") + "</div>";
  }
  function verrouille(){
    if (FS.actif) return false;
    etat("Lecture seule : ouvre ou crée le JSON de validation pour décider.");
    renduFiche();
    return true;
  }
  // avant toute décision : fichier branché, et nom de l'auteur pour la signer
  function pretADecider(){
    if (verrouille()) return false;
    exigerAuteur();
    return true;
  }
  // réservations que « Sync Reservations » ne reportera pas dans la STR
  function bandeauHorsSync(rs){
    var hs = rs.filter(function(r){ return r.horsSync; });
    if (!hs.length) return "";
    return '<div class="hs">⚠ <b>Hors synchro</b> · ' + (rs.length === 1 ? esc(hs[0].horsSync) + " : « Sync Reservations » ignore cette réservation, la décision ne sera pas reportée dans la STR." :
      pluriel(hs.length, "réservation") + " sur " + rs.length + " ignorée" + (hs.length > 1 ? "s" : "") + " par « Sync Reservations » : leur décision ne sera pas reportée dans la STR.") + "</div>";
  }
  function renduFiche(){
    var f = $("#fiche"), rs = choisis(), ro = FS.actif ? "" : " disabled";
    f.classList.toggle("vide", !rs.length);
    if (!rs.length){ f.innerHTML = bandeauRO() + '<div class="vide-fiche">Clique une réservation dans la liste ou dans la vue 3D. Ctrl + clic pour en choisir plusieurs, Maj + clic pour une plage de la liste.</div>'; return; }
    if (rs.length > 1){
      var cls = new Set(rs.map(function(r){ return classe(valeur(r, P_ST)); })), cl = cls.size === 1 ? Array.from(cls)[0] : "";
      f.innerHTML = '<div class="tete"><h2>' + pluriel(rs.length, "réservation") + '</h2><div class="fam">' + esc(rs.slice(0, 12).map(function(r){ return r.num; }).join(", ") + (rs.length > 12 ? "…" : "")) + '</div><button type="button" class="fermer" data-a="fermer" title="Fermer">×</button></div>' + bandeauRO() + bandeauHorsSync(rs) +
        '<div class="bloc"><h3>Décision pour toutes</h3><fieldset class="dec"' + ro + ">" + boutonsDecision(cl) +
        '<div class="fchamp"><label>Commentaire commun <span class="p">' + P_COM + '</span></label><textarea class="champ" id="com-multi" placeholder="Laisse vide pour garder le commentaire de chacune"></textarea></div></fieldset>' +
        '<div class="actions"><button type="button" class="bt" data-a="com-multi"' + ro + '>Appliquer le commentaire</button><button type="button" class="bt" data-a="boite">Boîte autour</button><button type="button" class="bt" data-a="centrer">Centrer</button></div>' +
        '<p class="note">La date de validation est mise à aujourd\'hui à chaque décision.</p></div>';
      return;
    }
    var r = rs[0], p = r.p, st = valeur(r, P_ST), d = valeur(r, P_DATE);
    f.innerHTML = '<div class="tete"><h2>' + esc(r.num || "(sans N°)") + '</h2><div class="fam">' + esc([r.famille, r.type].filter(Boolean).join(" · ")) + "<br>" + esc(r.niveau) +
      '</div><button type="button" class="fermer" data-a="fermer" title="Fermer">×</button></div>' + bandeauRO() + bandeauHorsSync(rs) +
      '<div class="bloc"><h3>Validation</h3><fieldset class="dec"' + ro + ">" + boutonsDecision(classe(st)) +
      '<div class="fchamp">' + etiquette(r, P_ST) + '<select class="champ" data-p="' + P_ST + '">' + optionsStatut(st) + "</select></div>" +
      '<div class="fchamp">' + etiquette(r, P_DATE) + '<input class="champ" type="date" data-p="' + P_DATE + '" value="' + esc(versIso(d)) + '">' +
      (d && !versIso(d) ? '<div class="note">Valeur actuelle : « ' + esc(d) + " »</div>" : "") + "</div>" +
      '<div class="fchamp">' + etiquette(r, P_COM) + '<textarea class="champ" data-p="' + P_COM + '" rows="3">' + esc(valeur(r, P_COM)) + "</textarea></div></fieldset>" +
      '<div class="actions"><button type="button" class="bt" data-a="centrer">Centrer</button><button type="button" class="bt" data-a="boite">Boîte autour</button><button type="button" class="bt" data-a="niveau">Coupe au niveau</button></div></div>' +
      '<div class="bloc"><h3>Demande</h3>' + dl([
        ["Demandeur", p["Demandeur"]], ["Date", p["Date demande"]], ["Commentaire", p["Commentaire demande"]],
        ["Dimensions", dims(p)], ["Carottage", p["Carottage"]], ["Calfeutrement", p["Calfeutrement"]],
        ["Paroi", p["Nature paroi"]], ["Niveau associé", p["Niveau associe"]], ["RES demandeur", p["RES Demandeur"]],
        ["Responsable", p["RES Responsable"]], ["Phasage", p["Phasage"]], ["ElementId", r.eid]
      ]) + '<div class="adn" title="Clé d\'échange avec Revit (CONTROL_NE_PAS_TOUCHER)">' + esc(r.adn || "⚠ Sans ADN : retrouvée par son UniqueId seulement") + "</div></div>";
  }
  $("#fiche").addEventListener("click", function(e){
    var b = e.target.closest("[data-dec],[data-a],[data-annuler],[data-m]");
    if (!b) return;
    if (b.hasAttribute("data-m")){ actionFichier(b.getAttribute("data-m")); return; }
    var rs = choisis();
    if ((b.hasAttribute("data-dec") || b.hasAttribute("data-annuler") || b.getAttribute("data-a") === "com-multi") && !pretADecider()) return;
    if (b.hasAttribute("data-dec")){ decider(rs, b.getAttribute("data-dec")); return; }
    if (b.hasAttribute("data-annuler")){ rs.forEach(function(r){ fixer(r, b.getAttribute("data-annuler"), null); }); apresModif(rs); return; }
    var a = b.getAttribute("data-a"), cles = rs.map(function(r){ return r.cle; });
    if (a === "fermer"){ sel = new Set(); actif = null; vue.selection(sel, actif); renduListe(); renduFiche(); }
    else if (a === "centrer") vue.cadrer(cles);
    else if (a === "boite") boiteAutour(cles);
    else if (a === "niveau"){ var i = rangNiveau(rs[0].niveau); if (i < niveaux.length) boiteNiveau(i); else etat("Niveau « " + rs[0].niveau + " » absent des étages IFC."); }
    else if (a === "com-multi"){ var t = $("#com-multi").value.trim(); if (!t) return; rs.forEach(function(r){ fixer(r, P_COM, t); }); apresModif(rs); }
  });
  // Date et commentaire : enregistrés sans redessiner la fiche. Le commentaire est validé quand il perd le
  // focus, c'est-à-dire pendant le clic suivant (« Valider »…) : refaire la fiche à ce moment ferait perdre ce clic.
  $("#fiche").addEventListener("change", function(e){
    var c = e.target.closest("[data-p]");
    if (!c) return;
    var rs = choisis(), p = c.getAttribute("data-p");
    if (rs.length !== 1) return;
    if (p === P_ST){ decider(rs, c.value); return; }
    if (!pretADecider()) return;
    if (p === P_COM){ clearTimeout(minutCom); comEnAttente = null; }
    fixer(rs[0], p, p === P_DATE ? depuisIso(c.value) : c.value);
    apresModif(rs, true);
    var ch = c.closest(".fchamp"), l = ch && ch.querySelector("label"), n = ch && ch.querySelector(".note"), h = esc(LIB[p]) + " " + marque(rs[0], p);
    if (l && l.getAttribute("data-m") !== h){ l.innerHTML = h; l.setAttribute("data-m", h); }
    if (n && p === P_DATE) n.remove();
  });
  // le commentaire s'enregistre aussi en cours de frappe
  var minutCom = 0, comEnAttente = null;
  $("#fiche").addEventListener("input", function(e){
    var c = e.target;
    if (c.getAttribute("data-p") !== P_COM || !FS.actif) return;
    var rs = choisis();
    clearTimeout(minutCom);
    comEnAttente = function(){ comEnAttente = null; if (rs.length === 1){ fixer(rs[0], P_COM, c.value); apresModif(rs, true); } };
    minutCom = setTimeout(comEnAttente, 400);
  });

  // ================= Modifications =================
  function fixer(r, p, v){
    var anc = r.ifc[p] || "", m = modifs.get(r.k);
    if (v === null || v === anc){
      if (m && vive(m.v[p])) m.v[p] = { ancien: m.v[p].ancien, nouveau: "", retire: true, par: auteur(), quand: new Date().toISOString() };
      return;
    }
    if (!m) modifs.set(r.k, m = { k: r.k, v: {} });
    m.cle = r.adn; m.uid = r.uid; m.eid = r.eid; m.num = r.num; m.famille = r.famille; m.niveau = r.niveau;
    m.v[p] = { ancien: vive(m.v[p]) ? m.v[p].ancien : anc, nouveau: v, par: auteur(), quand: new Date().toISOString() };
  }
  function retirer(m){
    var q = new Date().toISOString();
    vives(m).forEach(function(p){ m.v[p] = { ancien: m.v[p].ancien, nouveau: "", retire: true, par: auteur(), quand: q }; });
  }
  // le nom signe chaque décision : indispensable quand plusieurs ingénieurs partagent le fichier
  function exigerAuteur(){
    if (auteur()) return;
    var n = window.prompt("Ton nom (il signe tes décisions dans le fichier) :", "");
    if (n && n.trim()) lsSet("fgh.auteur", n.trim());
  }
  function decider(rs, statut){
    if (!pretADecider()) return;
    var d = aujourdhui();
    rs.forEach(function(r){
      fixer(r, P_ST, statut);
      // date de validation : aujourd'hui à chaque décision, celle de la maquette si on revient au statut d'origine
      fixer(r, P_DATE, statut === (r.ifc[P_ST] || "") && !modifie(r, P_ST) ? null : d);
    });
    apresModif(rs);
  }
  // sansFiche : date ou commentaire, la fiche reste en place et seul le filtre « Modifiées ici » peut changer
  function apresModif(rs, sansFiche){
    sauver();
    rs.forEach(majLigne);
    recolorer();
    if (!sansFiche) renduFiche();
    renduModifs();
    var s = $("#f-st").value;
    if (s && (!sansFiche || s === "modif")) filtreChange();
  }
  function cleStockage(){ return "fgh.res.modifs|" + (maquette.nom || "?"); }
  // clés de ces décisions anciennes : la maquette ouverte, ou un nom voisin (copie locale, nom du central)
  function clesHeritage(){
    var out = [], ici = cleStockage();
    try {
      for (var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if (k && k.indexOf("fgh.res.modifs|") === 0 && (k === ici || (maquette.nom && memeMaquette(k.slice(15), maquette.nom)))) out.push(k);
      }
    } catch (e){}
    return out;
  }
  function sauver(){
    $("#nb-mod").textContent = nbModifs();
    fsEcrire();
  }
  function nbModifs(){ var n = 0; modifs.forEach(function(m){ n += vives(m).length; }); return n; }
  // Au chargement d'un IFC : aucune décision gardée par le navigateur, seul le fichier branché fait foi.
  // Les décisions que la maquette contient déjà (import fait par le modeleur, puis nouvel export) disparaissent d'elles-mêmes.
  // Même maquette ? Comme « Import Validation RES » : un nom contient l'autre, sans tenir compte de la casse
  // (la copie locale d'une maquette partagée porte souvent en plus le nom de l'utilisateur)
  function memeMaquette(a, b){
    a = String(a || "").toLowerCase(); b = String(b || "").toLowerCase();
    return !a || !b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }
  function chargerModifs(){
    heritage = [];
    var cles = clesHeritage();
    cles.forEach(function(k){ try { (JSON.parse(lsGet(k, "[]")) || []).forEach(function(m){ if (m && m.k && m.v && vives(m).length) heritage.push(m); }); } catch (e){} });
    if (!heritage.length) cles.forEach(lsDel);
    if (FS.actif && memeMaquette(FS.maquette, maquette.nom)){
      if (maquette.nom) FS.maquette = maquette.nom;
      // même maquette, nouvel export : la mémoire reste le reflet du fichier, relu tout de suite
      elaguer(); FS.lu = 0;
      var h = FS.h;
      cycle = cycle.then(function(){ return fsRelire(h); }).catch(function(){});
    } else if (!FS.actif && FS.nonEcrit && FS.h && memeMaquette(FS.maquette, maquette.nom)){
      // écriture refusée plus tôt : les décisions pas encore écrites restent en mémoire pour « Reprendre »
      if (maquette.nom) FS.maquette = maquette.nom;
      elaguer();
    } else {
      if (FS.actif) etat("Autre maquette ouverte : fichier de validation débranché.");
      if (FS.actif || FS.minut) fsArreter(false);
      else { modifs = new Map(); FS.h = null; FS.nom = ""; FS.nonEcrit = false; }
    }
    $("#nb-mod").textContent = nbModifs();
  }
  // décisions des versions < 1.4 (gardées dans le navigateur) : versées une fois dans le fichier branché, ou jetées
  function reprendreHeritage(){
    if (!heritage.length || !pretADecider()) return;
    var n = chargerTexte(JSON.stringify(docModifs(heritage)));
    heritage = []; clesHeritage().forEach(lsDel);
    sauver();
    apresChargement(n, "ce navigateur");
  }
  function jeterHeritage(){
    if (!confirm("Jeter les " + pluriel(heritage.length, "réservation") + " décidées dans ce navigateur sans fichier ?")) return;
    heritage = []; clesHeritage().forEach(lsDel);
    renduModifs();
  }
  function elaguer(){
    var parK = new Map(), n = 0;
    RES.forEach(function(r){ parK.set(r.k, r); });
    modifs.forEach(function(m, k){
      var r = parK.get(k);
      if (!r) return;
      Object.keys(m.v).forEach(function(p){ if (vive(m.v[p]) && (r.ifc[p] || "") === m.v[p].nouveau){ delete m.v[p]; n++; } });
      if (!Object.keys(m.v).length) modifs.delete(k);
    });
    return n;
  }
  function auteur(){ return lsGet("fgh.auteur", ""); }
  function docModifs(liste){
    var out = [];
    (liste || Array.from(modifs.values())).sort(function(a, b){ return rangNiveau(a.niveau) - rangNiveau(b.niveau) || (a.num < b.num ? -1 : 1); }).forEach(function(m){
      PARAMS.forEach(function(p){
        var x = m.v[p];
        if (!x) return;
        var e = { cle: m.cle || "", unique_id: m.uid || "", element_id: m.eid || "", numero: m.num || "", famille: m.famille || "", niveau: m.niveau || "", parametre: p, ancien: x.ancien, nouveau: x.nouveau, par: x.par || "", quand: x.quand || "" };
        if (x.retire) e.retire = true;     // ignorée par Revit, garde l'annulation lors des fusions
        out.push(e);
      });
    });
    return { format: FORMAT, version: 1, outil: "str-bim-tools.com/fgh", version_page: VERSION, date: new Date().toISOString(), auteur: auteur(),
      maquette: { nom: maquette.nom, export_du: maquette.export_du }, modifications: out };
  }
  function nomFichier(){ return "FGH_Validation_RES_" + (maquette.nom || "maquette").replace(/[^\w\-]+/g, "_") + ".json"; }
  function telecharger(){
    var b = new Blob([JSON.stringify(docModifs(), null, 2)], { type: "application/json" }), a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = nomFichier();
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // Fichier relu (le sien, ou celui partagé avec d'autres ingénieurs) : fusion entrée par entrée, la décision
  // la plus récente gagne. Renvoie le nombre d'entrées reprises du fichier ; FS.remplacees liste les décisions
  // de cet utilisateur remplacées par celles d'un autre.
  function chargerTexte(txt){
    var d = JSON.parse(txt || "{}"), n = 0, moi = auteur(), dansFichier = {};
    FS.remplacees = [];
    if (d.format !== FORMAT) throw new Error("ce n'est pas un fichier de validation des réservations FGH");
    if (d.maquette && d.maquette.nom && !maquette.nom){ maquette.nom = d.maquette.nom; maquette.export_du = d.maquette.export_du || ""; }
    (d.modifications || []).forEach(function(x){
      if (!x || PARAMS.indexOf(x.parametre) < 0) return;
      var k = x.cle || ("uid:" + x.unique_id), m = modifs.get(k);
      if (!m) modifs.set(k, m = { k: k, cle: x.cle, uid: x.unique_id, eid: x.element_id, num: x.numero, famille: x.famille, niveau: x.niveau, v: {} });
      var loc = m.v[x.parametre], q = x.quand || "";
      dansFichier[k + "|" + x.parametre] = q;
      if (loc && (loc.quand || "") >= q) return;
      if (vive(loc) && x.par && x.par !== moi && String(x.nouveau) !== loc.nouveau) FS.remplacees.push((m.num || k) + " : " + LIB[x.parametre] + " « " + (x.retire ? "annulé" : x.nouveau || "vide") + " » par " + x.par);
      m.v[x.parametre] = { ancien: x.ancien, nouveau: x.nouveau == null ? "" : String(x.nouveau), par: x.par || "", quand: q };
      if (x.retire) m.v[x.parametre].retire = true;
      n++;
    });
    // décisions d'ici absentes du fichier ou plus récentes que lui (deux écritures presque simultanées) : à réécrire
    FS.aEcrire = false;
    modifs.forEach(function(m, k){ Object.keys(m.v).forEach(function(p){ var q = dansFichier[k + "|" + p]; if (q === undefined || (m.v[p].quand || "") > q) FS.aEcrire = true; }); });
    elaguer();
    return n;
  }
  function apresChargement(n, nom){
    $("#nb-mod").textContent = nbModifs();
    renduListe(); recolorer(); renduFiche(); renduModifs();
    etat(pluriel(n, "modification") + " reprise" + (n > 1 ? "s" : "") + " de « " + nom + " ».");
  }

  // Enregistrement continu (Chrome, Edge : File System Access), comme le rapport 3D CAN 241
  // ecriture : écritures en cours ; branche : choix ou autorisation d'un fichier en cours
  var FS = { ok: typeof window.showSaveFilePicker === "function", h: null, actif: false, nom: "", maquette: "", quand: null, err: "", minut: 0, lu: 0, nonEcrit: false, remplacees: [], ecriture: 0, branche: 0 };
  function cleFs(){ return "fichier|" + (maquette.nom || "?"); }
  function idb(mode, fn){
    return new Promise(function(ok, ko){
      var r = indexedDB.open("fgh-validation-res", 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore("fichiers"); };
      r.onerror = function(){ ko(r.error); };
      r.onsuccess = function(){
        var db = r.result, tx = db.transaction("fichiers", mode), q;
        try { q = fn(tx.objectStore("fichiers")); } catch (x){ db.close(); ko(x); return; }
        tx.oncomplete = function(){ db.close(); ok(q && q.result); };
        tx.onerror = function(){ db.close(); ko(tx.error); };
      };
    });
  }
  function heure(d){ return d ? ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2) : ""; }
  // Fichier partagé : avant chaque écriture, le fichier est relu et fusionné (un autre ingénieur a pu y écrire),
  // puis réécrit ; il est aussi relu toutes les 15 s pour montrer les décisions des autres.
  var cycle = Promise.resolve();
  function fsRelire(h){
    if (!h) return Promise.resolve(0);
    return h.getFile().then(function(f){
      if (f.lastModified === FS.lu) return 0;
      return f.text().then(function(t){
        FS.lu = f.lastModified;
        if (!t.trim()) return 0;
        var n = chargerTexte(t);
        if (n) recus(n);
        return n;
      });
    });
  }
  function recus(n){
    $("#nb-mod").textContent = nbModifs();
    renduListe(); recolorer(); renduModifs();
    if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest("#fiche")) renduFiche();
    var r = FS.remplacees || [];
    etat(r.length ? "⚠ Décision plus récente d'un autre ingénieur : " + r.slice(0, 3).join(" ; ") + (r.length > 3 ? "…" : "") :
      pluriel(n, "décision") + " reçue" + (n > 1 ? "s" : "") + " du fichier partagé.");
  }
  function fsEcrire(){
    if (!FS.actif || !FS.h) return;
    clearTimeout(FS.minut);
    FS.minut = setTimeout(fsEcrireMaintenant, 300);
  }
  function fsEcrireMaintenant(){
    clearTimeout(FS.minut); FS.minut = 0;
    if (!FS.actif || !FS.h) return cycle;
    var h = FS.h;
    FS.ecriture++;
    return cycle = cycle.then(function(){
        return fsRelire(h).then(function(){
          var txt = JSON.stringify(docModifs(), null, 2);
          return h.createWritable().then(function(w){ return w.write(txt).then(function(){ return w.close(); }); });
        }).then(function(){ return h.getFile(); }).then(function(f){
          FS.lu = f.lastModified; FS.quand = new Date(); FS.err = ""; FS.nonEcrit = false;
          var e = $("#fs-etat"); if (e) e.innerHTML = fsTexte();
        });
      }).catch(function(x){
        // plus d'écriture possible : lecture seule tout de suite, les dernières décisions restent en mémoire pour « Reprendre »
        FS.actif = false; FS.nonEcrit = true;
        FS.err = "Écriture refusée (" + (x && x.message || x) + "). Tes dernières décisions ne sont pas dans le fichier : clique « Reprendre ».";
        etat("⚠ " + FS.err);
        renduModifs(); renduFiche();
      }).then(function(){ FS.ecriture--; });
  }
  // avant de changer de fichier ou de le débrancher : écrire la dernière décision en attente dans l'ancien
  function fsFinir(){ return FS.minut ? fsEcrireMaintenant() : cycle; }
  setInterval(function(){
    if (!FS.actif || !FS.h || document.hidden) return;
    var h = FS.h;
    cycle = cycle.then(function(){ return fsRelire(h); }).then(function(){ if (FS.actif && FS.aEcrire){ FS.aEcrire = false; fsEcrire(); } }).catch(function(){});
  }, 15000);
  // garder : fusionner avec les décisions en mémoire (reprise après une écriture refusée) ; sinon on part du seul fichier
  function fsBrancher(h, lire, garder){
    var suite = fsFinir();
    FS.actif = false;
    suite = suite.then(function(){
      if (!garder) modifs = new Map();
      return lire ? h.getFile().then(function(f){ return f.text(); }).then(function(t){ return t.trim() ? chargerTexte(t) : 0; }) : 0;
    });
    suite = suite.then(function(n){
      FS.h = h; FS.nom = h.name; FS.maquette = maquette.nom; FS.actif = true; FS.err = "";
      if (window.indexedDB) idb("readwrite", function(st){ return st.put(h, cleFs()); }).catch(function(){});
      // le nom qui signera les décisions est demandé maintenant, pas au milieu du premier clic « Valider »
      exigerAuteur();
      sauver();
      apresChargement(n, h.name);
      renduFiche();
      etat("Validations enregistrées au fur et à mesure dans « " + h.name + " »" + (n ? " · " + pluriel(n, "modification") + " reprise" + (n > 1 ? "s" : "") : "") + ".");
    });
    cycle = suite.catch(function(){});
    return suite;
  }
  function fsErreur(x){ if (x && x.name === "AbortError") return; FS.err = (x && x.message) || String(x); etat("⚠ " + FS.err); renduModifs(); }
  // Choix d'un fichier en cours (sélecteur, autorisation) : la reprise automatique du fichier retenu attend.
  // Après une écriture refusée, les décisions pas encore écrites suivent dans le fichier choisi (garder).
  function enBranchement(p){
    FS.branche++;
    return p.then(function(x){ FS.branche--; return x; }, function(x){ FS.branche--; throw x; });
  }
  var TYPES_JSON = [{ description: "Validation des réservations FGH", accept: { "application/json": [".json"] } }];
  function fsNouveau(){ enBranchement(window.showSaveFilePicker({ suggestedName: nomFichier(), types: TYPES_JSON }).then(function(h){ return fsBrancher(h, true, FS.nonEcrit); })).catch(fsErreur); }
  function fsOuvrir(){
    if (typeof window.showOpenFilePicker === "function"){
      enBranchement(window.showOpenFilePicker({ types: TYPES_JSON }).then(function(l){ return fsAutoriser(l[0]); })).catch(fsErreur);
      return;
    }
    var i = document.createElement("input"); i.type = "file"; i.accept = ".json,application/json";
    i.onchange = function(){
      var f = i.files && i.files[0]; if (!f) return;
      lireJson(f);
    };
    i.click();
  }
  // JSON lu sans pouvoir y écrire (Firefox, Safari) : les décisions s'affichent, la page reste en lecture seule
  function lireJson(f){ f.text().then(function(t){ apresChargement(chargerTexte(t), f.name); }).catch(fsErreur); }
  // un fichier ouvert n'est autorisé qu'en lecture : l'écriture se demande tout de suite, pendant le clic,
  // sinon la première écriture (sans clic) serait refusée et la page repasserait en lecture seule
  function fsAutoriser(h){
    return h.requestPermission({ mode: "readwrite" }).then(function(p){
      if (p !== "granted") throw new Error("écriture dans « " + h.name + " » refusée : clique « Autoriser les modifications » quand Chrome le demande");
      return fsBrancher(h, true, FS.nonEcrit);
    });
  }
  function fsReprendre(){
    if (!FS.h) return;
    var h = FS.h;
    enBranchement(h.requestPermission({ mode: "readwrite" }).then(function(p){
      if (p !== "granted") throw new Error("accès au fichier refusé");
      return fsBrancher(h, true, FS.nonEcrit);
    })).catch(fsErreur);
  }
  // oublier : aussi le fichier retenu pour cette maquette ; la dernière décision en attente est d'abord écrite
  function fsArreter(oublier){
    var fin = fsFinir();
    FS.actif = false;
    if (oublier && window.indexedDB) idb("readwrite", function(st){ return st.delete(cleFs()); }).catch(function(){});
    cycle = fin.then(function(){
      FS.h = null; FS.nom = ""; FS.maquette = ""; FS.quand = null; FS.err = ""; FS.nonEcrit = false;
      modifs = new Map();
      $("#nb-mod").textContent = 0;
      renduListe(); recolorer(); renduFiche(); renduModifs();
    }).catch(function(){});
  }
  function fsDemarrer(){
    if (!FS.ok || !window.indexedDB || !maquette.nom || FS.actif || FS.branche) return;
    idb("readonly", function(st){ return st.getAllKeys(); }).then(function(cles){
      // le fichier retenu pour cette maquette, sinon pour un nom voisin (copie locale, nom du central)
      cles = (cles || []).map(String);
      var k = cles.indexOf(cleFs()) >= 0 ? cleFs() : cles.filter(function(c){ return c.indexOf("fichier|") === 0 && memeMaquette(c.slice(8), maquette.nom); })[0];
      return k ? idb("readonly", function(st){ return st.get(k); }) : null;
    }).then(function(h){
      if (!h || FS.actif || FS.branche) return;
      FS.h = h; FS.nom = h.name;
      return h.queryPermission({ mode: "readwrite" }).then(function(p){
        if (p === "granted") return fsBrancher(h, true, FS.nonEcrit);
        renduModifs(); renduFiche();
        etat("Lecture seule : clique « Reprendre " + h.name + " » pour décider.");
      });
    }).catch(function(){});
  }
  function fsTexte(){
    if (FS.actif) return "✓ Enregistrement continu dans <b>" + esc(FS.nom) + "</b>" + (FS.quand ? " · écrit à " + heure(FS.quand) : "") + ". C'est ce fichier qu'on donne au modeleur. Plusieurs ingénieurs peuvent travailler dans le même fichier (dossier partagé) : il est relu toutes les 15 s.";
    if (FS.h) return "Lecture seule. Fichier <b>" + esc(FS.nom) + "</b> : clique « Reprendre » pour réautoriser l'accès et décider.";
    if (!FS.ok) return "Lecture seule : ce navigateur ne sait pas écrire dans un fichier. Ouvre la page dans Chrome ou Edge pour décider ; ici tu peux seulement ouvrir un fichier pour le consulter.";
    return "Lecture seule. Ouvre le JSON de validation, ou crée-le, pour décider : le fichier est la seule mémoire des décisions, chaque changement s'y écrit tout seul.";
  }
  function renduModifs(){
    var b = FS.actif ? '<button type="button" class="bt" data-m="fs-ouvrir">Ouvrir un JSON…</button><button type="button" class="bt" data-m="fs-nouveau">Créer un nouveau JSON…</button><button type="button" class="bt" data-m="fs-stop">Arrêter</button>' :
      FS.h ? '<button type="button" class="bt prim" data-m="fs-reprendre">Reprendre ' + esc(FS.nom) + '</button><button type="button" class="bt" data-m="fs-ouvrir">Ouvrir un JSON…</button><button type="button" class="bt" data-m="fs-nouveau">Créer un nouveau JSON…</button><button type="button" class="bt" data-m="fs-stop">Oublier</button>' :
      FS.ok ? '<button type="button" class="bt prim" data-m="fs-ouvrir">Ouvrir un JSON…</button><button type="button" class="bt prim" data-m="fs-nouveau">Créer un nouveau JSON…</button>' :
      '<button type="button" class="bt" data-m="fs-ouvrir">Ouvrir un JSON (lecture seule)…</button>';
    var h = '<div class="carte"><h3>Fichier pour Revit</h3><div class="in"><div id="fs-etat" class="fs-etat' + (FS.actif ? " on" : FS.h ? " att" : "") + '">' + fsTexte() + "</div>" +
      (FS.err ? '<div class="fs-err">' + esc(FS.err) + "</div>" : "") + '<div class="actions">' + b + '<button type="button" class="bt" data-m="telecharger"' + (nbModifs() ? "" : " disabled") + ">Télécharger le JSON</button></div>" +
      '<div class="fchamp" style="margin:10px 0 0"><label>Ton nom (écrit dans le fichier)</label><input class="champ" id="auteur" value="' + esc(auteur()) + '" placeholder="Prénom Nom"></div>' +
      '<p class="note">Le modeleur applique ce fichier dans la maquette RES avec le bouton Revit « Import Validation RES » (dossier FGH), puis lance « Sync Reservations ».</p></div></div>';
    if (heritage.length) h += '<div class="carte"><h3>Décisions restées dans ce navigateur</h3><div class="in"><p class="note" style="margin-top:0">' +
      pluriel(heritage.length, "réservation") + " décidée" + (heritage.length > 1 ? "s" : "") + " sans fichier avec l'ancienne version de la page. Elles ne sont plus prises en compte : verse-les dans le fichier branché, ou jette-les.</p>" +
      '<div class="actions"><button type="button" class="bt prim" data-m="heritage-ok"' + (FS.actif ? "" : " disabled") + '>Les mettre dans le fichier</button><button type="button" class="bt" data-m="heritage-non">Les jeter</button></div></div></div>';
    var L = Array.from(modifs.values()).filter(function(m){ return vives(m).length; }).sort(function(a, b){ return rangNiveau(a.niveau) - rangNiveau(b.niveau) || (a.num < b.num ? -1 : 1); }), parK = new Map();
    RES.forEach(function(r){ parK.set(r.k, r); });
    if (!L.length) h += '<p class="note" style="padding:0 2px">Aucune décision pour l\'instant. Choisis une réservation et clique « Valider », « Refuser » ou « À revoir ».</p>';
    else {
      h += '<div class="carte"><h3>' + pluriel(L.length, "réservation") + " · " + pluriel(nbModifs(), "valeur") + '</h3><div class="in">' + L.map(function(m){
        var r = parK.get(m.k);
        return '<div class="ml"' + (r ? ' data-cle="' + esc(r.cle) + '"' : "") + '><span class="q">' + esc(m.num || m.cle || m.k) + (r ? "" : ' <span title="Absente de l\'IFC ouvert">?</span>') + " · " + esc(m.niveau || "") + "</span>" +
          '<span class="d">' + vives(m).map(function(p){ var x = m.v[p]; return esc(LIB[p]) + " : " + esc(x.ancien || "vide") + " → <b>" + esc(x.nouveau || "vide") + "</b>" + (x.par ? ' <span class="par">· ' + esc(x.par) + "</span>" : ""); }).join("<br>") + "</span>" +
          (FS.actif ? '<button type="button" class="x" data-retire="' + esc(m.k) + '" title="Retirer">×</button>' : "") + "</div>";
      }).join("") + '</div></div><div class="actions"><button type="button" class="bt" data-m="vider"' + (FS.actif ? "" : " disabled") + ">Tout effacer</button></div>";
    }
    $("#modifs").innerHTML = h;
    $("#nb-mod").textContent = nbModifs();
  }
  $("#modifs").addEventListener("click", function(e){
    var x = e.target.closest("[data-retire]");
    if (x){ e.stopPropagation(); if (!pretADecider()) return; retirer(modifs.get(x.getAttribute("data-retire")) || { v: {} }); sauver(); renduListe(); recolorer(); renduFiche(); renduModifs(); return; }
    var b = e.target.closest("[data-m]");
    if (b){ actionFichier(b.getAttribute("data-m")); return; }
    var l = e.target.closest(".ml[data-cle]");
    if (l){ choisir(l.getAttribute("data-cle")); vue.cadrer([l.getAttribute("data-cle")]); }
  });
  function actionFichier(a){
      if (a === "fs-nouveau") fsNouveau();
      else if (a === "fs-ouvrir") fsOuvrir();
      else if (a === "fs-reprendre") fsReprendre();
      else if (a === "fs-stop") fsArreter(true);
      else if (a === "telecharger") telecharger();
      else if (a === "heritage-ok") reprendreHeritage();
      else if (a === "heritage-non") jeterHeritage();
      else if (a === "vider" && !verrouille() && confirm("Effacer toutes les décisions prises ici (" + pluriel(nbModifs(), "valeur") + ") ?") && pretADecider()){ modifs.forEach(retirer); sauver(); renduListe(); recolorer(); renduFiche(); renduModifs(); }
  }
  $("#modifs").addEventListener("change", function(e){ if (e.target.id === "auteur"){ lsSet("fgh.auteur", e.target.value.trim()); sauver(); } });

  // ================= Onglets, ouverture, thème =================
  Array.prototype.forEach.call(document.querySelectorAll("[data-onglet]"), function(b){
    b.addEventListener("click", function(){
      var o = b.getAttribute("data-onglet");
      Array.prototype.forEach.call(document.querySelectorAll("[data-onglet]"), function(x){ x.setAttribute("aria-selected", String(x === b)); });
      $("#p-res").hidden = o !== "res"; $("#p-modifs").hidden = o !== "modifs";
      if (o === "modifs") renduModifs();
    });
  });
  function choisirFichiers(){ $("#fichier").click(); }
  $("#btn-ouvrir").addEventListener("click", choisirFichiers);
  $("#btn-ouvrir2").addEventListener("click", choisirFichiers);
  $("#fichier").addEventListener("change", function(){ ouvrir(this.files); this.value = ""; });
  var centre = $("#centre");
  ["dragenter", "dragover"].forEach(function(t){ document.addEventListener(t, function(e){ e.preventDefault(); centre.classList.add("survol"); }); });
  ["dragleave", "drop"].forEach(function(t){ document.addEventListener(t, function(e){ e.preventDefault(); if (t === "drop" || !e.relatedTarget) centre.classList.remove("survol"); }); });
  document.addEventListener("drop", function(e){
    var dt = e.dataTransfer, fs = dt && dt.files;
    if (!fs || !fs.length) return;
    var json = Array.prototype.filter.call(fs, function(f){ return /\.json$/i.test(f.name); });
    var ifc = Array.prototype.some.call(fs, function(f){ return /\.ifc$/i.test(f.name); });
    // Chrome / Edge : un JSON glissé, seul ou avec les IFC, se branche comme avec « Ouvrir un JSON… ». Sa
    // poignée ne se demande que pendant le dépôt ; le branchement suit en même temps que la lecture des IFC.
    var poignee = null;
    if (FS.ok && json.length === 1 && dt.items) for (var i = 0; i < dt.items.length && !poignee; i++){
      var it = dt.items[i], f = it.kind === "file" && it.getAsFileSystemHandle ? it.getAsFile() : null;
      if (f && /\.json$/i.test(f.name)) poignee = it.getAsFileSystemHandle();
    }
    if (poignee) enBranchement(poignee.then(function(h){ return h && h.kind === "file" ? fsAutoriser(h) : null; })).catch(fsErreur);
    // sinon lu sans y écrire, après les IFC s'il y en a (leur chargement repart de la seule maquette)
    var lire = poignee ? null : function(){ json.forEach(lireJson); };
    if (ifc) ouvrir(fs, lire);
    else if (lire) lire();
  });
  $("#btn-theme").addEventListener("click", function(){
    var c = document.documentElement.getAttribute("data-theme") === "clair" ? "sombre" : "clair";
    document.documentElement.setAttribute("data-theme", c);
    document.querySelector("meta[name=theme-color]").setAttribute("content", c === "clair" ? "#F3F0E8" : "#050505");
    lsSet("fgh.theme", c);
  });
  // fermeture de la page : la dernière décision (commentaire en cours de frappe compris) part tout de suite
  // dans le fichier, et le navigateur demande confirmation tant qu'elle n'y est pas
  window.addEventListener("beforeunload", function(e){
    if (comEnAttente){ clearTimeout(minutCom); comEnAttente(); }
    if (FS.minut) fsEcrireMaintenant();
    if (FS.nonEcrit || FS.ecriture){ e.preventDefault(); e.returnValue = ""; }
  });
  renduModifs();
})();
