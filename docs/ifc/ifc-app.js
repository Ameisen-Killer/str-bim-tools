// Interface de /ifc/ : chargement d'un ou plusieurs fichiers, liste des éléments groupée par fichier,
// propriétés, suppression avec confirmation, annuler / rétablir, export, onglets sur smartphone,
// thème clair / sombre. Les fichiers ne quittent jamais le navigateur : aucune requête réseau ici.
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
  function pluriel(n, mot, mots){ return fmtN(n) + " " + (n > 1 ? (mots || mot + "s") : mot); }

  // fichier ouvert : { uid, m (modèle IFC), propre (version exportée), visible, plie, taille: {v, t} }
  var fichiers = [], parUid = new Map(), uidSuivant = 1;
  var lignes = [], choix = new Set(), caches = new Set(), actif = "", histo = [], aRefaire = [];

  var vue = IFCVue.creer($("#vue"), { surClic: cliqueVue });

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
  // Ajoute un ou plusieurs fichiers à ceux déjà ouverts
  function charger(liste){
    liste = [].slice.call(liste || []);
    if (!liste.length) return;
    erreur("");
    $("#chargement").hidden = false;
    $("#chargement").textContent = liste.length > 1 ? "Lecture de " + liste.length + " fichiers…" : "Lecture du fichier…";
    if (fichiers.length) etat("Lecture de " + (liste.length > 1 ? liste.length + " fichiers" : "« " + liste[0].name + " »") + "…");
    var ajoutes = [], refus = [], t0 = performance.now();
    // un fichier après l'autre, pour ne pas garder tous les octets en mémoire en même temps
    var suite = Promise.resolve();
    liste.forEach(function(fic){
      suite = suite.then(function(){
        return lireFichier(fic).then(function(buf){
          return new Promise(function(ok){ setTimeout(function(){ ok(buf); }, 30); });   // laisse l'écran se rafraîchir
        }).then(function(buf){
          ajoutes.push(IFC.lire(buf, fic.name));
        }).catch(function(err){
          if (window.console) console.error(err);
          refus.push("« " + fic.name + " » : " + (err && err.ifc ? err.message : "lecture impossible (" + (err && err.message || err) + ")"));
        });
      });
    });
    suite.then(function(){
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
      var f = { uid: uidSuivant++, m: m, propre: m.version, visible: true, plie: false, taille: { v: -1, t: 0 } };
      fichiers.push(f); parUid.set(f.uid, f);
    });
    vue.modeles(fichiers.map(function(f){ return f.m; }));
    $("#accueil").hidden = true;
    $("#editeur").hidden = false;
    if (premier){ $("#recherche").value = ""; $("#filtre-type").value = ""; }
    reconstruire();
    vue.redessiner();
    vue.recadrer();
    var ent = 0;
    modeles.forEach(function(m){ ent += m.nbOrigine; });
    var nom = modeles.length === 1 ? "« " + modeles[0].nom + " »" : pluriel(modeles.length, "fichier");
    var doublons = modeles.filter(function(m){ return m.doublons; }).length;
    etat(nom + " lu" + (modeles.length > 1 ? "s" : "") + " : " + pluriel(ent, "entité") + ", en " + Math.max(1, Math.round(ms)) + " ms" +
      (doublons ? " (attention : identifiants en double dans " + pluriel(doublons, "fichier") + ", seule la première entité a été gardée)" : "") + "." +
      (refus && refus.length ? " Refusé" + (refus.length > 1 ? "s" : "") + " : " + refus.join(" ") : ""));
    if (premier) window.scrollTo(0, 0);
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
      choix = new Set(); caches = new Set(); actif = ""; lignes = [];
      $("#editeur").hidden = true;
      $("#accueil").hidden = false;
      etat("");
      window.scrollTo(0, 0);
      return;
    }
    reconstruire();
    vue.recadrer();
    etat("« " + f.m.nom + " » fermé.");
  }

  // ================= Liste des éléments =================
  function reconstruire(){
    lignes = [];
    fichiers.forEach(function(f){
      lignes.push({ fichier: f });
      IFC.arbre(f.m).forEach(function(l){
        var i = IFC.infos(f.m, l.id);
        lignes.push({ cle: cle(f, l.id), f: f, id: l.id, niv: l.niv, i: i,
          rech: [nomAff(i), i.typeLib, i.type, i.materiau, i.globalId, i.tag, i.objectType, "#" + i.id].join(" ").toLowerCase() });
      });
    });
    choix.forEach(function(c){ if (!existe(c)) choix.delete(c); });
    caches.forEach(function(c){ if (!existe(c)) caches.delete(c); });
    if (actif && !existe(actif)) actif = "";
    remplirTypes();
    rendreListe();
    var items = [];
    lignes.forEach(function(l){ if (l.i && l.f.visible && l.i.genre === "element" && !caches.has(l.cle)) items.push({ cle: l.cle, m: l.f.m, id: l.id }); });
    infoVue(vue.afficher(items));
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
      '<div><div class="el-nom"><span class="pli" aria-hidden="true">▾</span> ' + esc(m.nom) + '</div><div class="el-info">' +
      esc(m.schema + " · " + fmtN(m.nbOrigine) + (m.ent.size !== m.nbOrigine ? " → " + fmtN(m.ent.size) : "") + " entités · " + fmtTaille(tailleDe(f))) + "</div></div>" +
      '<span class="fic-act"><button type="button" data-act="export" title="Exporter ce fichier">Exporter</button>' +
      '<button type="button" class="fermer" data-act="fermer" title="Fermer ce fichier" aria-label="Fermer ' + esc(m.nom) + '">×</button></span></div>';
  }

  var visibles = [];
  function rendreListe(){
    var q = $("#recherche").value.trim().toLowerCase(), t = $("#filtre-type").value, filtre = !!(q || t);
    var html = [], plusieurs = fichiers.length > 1, f = null;
    visibles = [];
    lignes.forEach(function(l){
      if (l.fichier){
        f = l.fichier;
        if (plusieurs) html.push(enteteFichier(f));
        return;
      }
      if (plusieurs && f.plie) return;
      var i = l.i;
      if (filtre){
        if (!i.supprimable) return;
        if (t && i.type !== t) return;
        if (q && l.rech.indexOf(q) < 0) return;
      }
      var c = choix.has(l.cle);
      if (i.supprimable) visibles.push(l.cle);
      var info = [i.typeLib, i.materiau, "#" + i.id].filter(Boolean).join(" · ");
      html.push('<div class="el ' + i.genre + (c ? " choisi" : "") + (caches.has(l.cle) ? " cache" : "") + (l.cle === actif ? " actif" : "") + '" role="listitem" data-cle="' + l.cle +
        '" style="--niv:' + (filtre ? 0 : Math.min(l.niv, 8)) + '">' +
        (i.supprimable ? '<input type="checkbox" aria-label="Sélectionner ' + esc(nomAff(i)) + '"' + (c ? " checked" : "") + ">" : '<span class="vide"></span>') +
        '<div><div class="el-nom">' + esc(nomAff(i)) + '</div><div class="el-info">' + esc(info) + "</div></div></div>");
    });
    $("#liste").innerHTML = html.join("") || '<p class="liste-vide">Aucun élément ne correspond.</p>';
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
    if (defiler){
      var r = $('#liste [data-cle="' + c + '"]');
      if (r) r.scrollIntoView({ block: "nearest" });
    }
  }
  function cliqueVue(c){
    if (!c) return;
    var d = lireCle(c), i = d.f && IFC.infos(d.f.m, d.id);
    if (!i) return;
    if (choix.has(c)){ choix.delete(c); etat("« " + nomAff(i) + " » retiré de la sélection."); }
    else if (i.supprimable){ choix.add(c); etat("« " + nomAff(i) + " » ajouté à la sélection."); }
    // déplie le fichier si besoin, pour retrouver l'élément dans la liste
    if (d.f.plie){ d.f.plie = false; rendreListe(); }
    activer(c, true);
  }

  $("#liste").addEventListener("click", function(e){
    var fic = e.target.closest(".fic");
    if (fic){
      var f = parUid.get(+fic.getAttribute("data-fic")), b = e.target.closest("[data-act]"), act = b && b.getAttribute("data-act");
      if (!f) return;
      if (act === "voir"){ f.visible = !f.visible; reconstruire(); etat("« " + f.m.nom + " » " + (f.visible ? "affiché" : "masqué") + " dans la vue 3D."); }
      else if (act === "export") exporter(f);
      else if (act === "fermer") fermer(f);
      else { f.plie = !f.plie; rendreListe(); }
      return;
    }
    var r = e.target.closest(".el");
    if (!r) return;
    var c = r.getAttribute("data-cle");
    if (e.target.tagName === "INPUT"){ cocher(c, e.target.checked); activer(c, false); return; }
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
    majLignes(); maj();
  });
  $("#sel-inv").addEventListener("click", function(){
    visibles.forEach(function(c){ if (choix.has(c)) choix.delete(c); else choix.add(c); });
    majLignes(); maj();
  });

  // ================= Propriétés =================
  function ligne(dt, dd, mono){ return dd ? "<dt>" + esc(dt) + "</dt><dd" + (mono ? ' class="mono"' : "") + ">" + esc(dd) + "</dd>" : ""; }
  function afficherProps(){
    var z = $("#props");
    if (!actif || !existe(actif)){
      z.innerHTML = '<p class="props-vide">Clique un élément dans la liste ou dans la vue 3D.</p>';
      return;
    }
    var d = lireCle(actif), m = d.f.m, id = d.id, i = IFC.infos(m, id), I = IFC.index(m);
    var enf = (I.enfants.get(id) || []).length, ouv = (I.ouvertures.get(id) || []).length;
    var parent = I.parent.get(id) || I.conteneur.get(id) || I.perce.get(id), pi = parent && m.ent.has(parent) ? IFC.infos(m, parent) : null;
    var h = '<div class="type">' + esc(i.typeLib) + " · #" + i.id + "</div><h3>" + esc(nomAff(i)) + "</h3><dl>" +
      ligne("Fichier", fichiers.length > 1 ? m.nom : "") +
      ligne("GlobalId", i.globalId, true) +
      ligne("Nom", i.nom) +
      ligne("Type IFC", i.type, true) +
      ligne("Type d'objet", i.objectType) +
      ligne("Description", i.description) +
      ligne("Repère", i.tag) +
      ligne("Nom long", i.nomLong) +
      ligne("Matériau", i.materiau || (i.genre === "spatial" ? "" : "—")) +
      ligne("Dans", pi ? nomAff(pi) + " (" + pi.typeLib + ")" : "") +
      ligne("Enfants", enf ? fmtN(enf) : "") +
      ligne("Ouvertures", ouv ? fmtN(ouv) : "") +
      ligne("Sélection", !i.supprimable ? "Structure spatiale, non supprimable" : choix.has(actif) ? "Cochée" : "") +
      "</dl>";
    IFC.proprietes(m, id).forEach(function(p){
      h += '<div class="pset"><div class="pset-nom">' + esc(p.nom) + (p.origine ? " · " + esc(p.origine) : "") + "</div><dl>" +
        (p.props.length ? p.props.map(function(x){ return "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd>"; }).join("") : "<dt>—</dt><dd>Aucune valeur lisible</dd>") +
        "</dl></div>";
    });
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
    activerCmd("masquer", n > 0 || a);
    activerCmd("isoler", n > 0 || a);
    activerCmd("tout-afficher", caches.size > 0);
    activerCmd("rien", n > 0);
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
    vue.selection(choix, actif);
  }

  function infoVue(b){
    var nl = Object.keys(b.nonLus);
    $("#vue-info").textContent = pluriel(b.elements, "élément dessiné", "éléments dessinés") + " · " + pluriel(b.faces, "face") +
      (nl.length ? " · géométrie non lue : " + nl.slice(0, 4).map(IFC.nomType).join(", ") + (nl.length > 4 ? "…" : "") : "") +
      (b.erreurs ? " · " + pluriel(b.erreurs, "élément illisible", "éléments illisibles") : "") +
      (caches.size ? " · " + fmtN(caches.size) + " masqués" : "") +
      " · moteur " + b.moteur;
  }

  function confirmer(texte, ok){
    var d = $("#confirmer");
    $("#confirmer-texte").textContent = texte;
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
      plans.forEach(function(x){ IFC.appliquer(x.f.m, x.p.changement); });
      var txt = "suppression de " + pluriel(nbEl, "élément");
      histo.push({ parts: plans.map(function(x){ return { f: x.f, ch: x.p.changement }; }), txt: txt, e: nbEnt });
      aRefaire = [];
      reconstruire();
      etat(pluriel(nbEl, "élément supprimé", "éléments supprimés") + ", " + pluriel(nbEnt, "entité retirée", "entités retirées") +
        (nbMod ? ", " + pluriel(nbMod, "relation raccourcie", "relations raccourcies") : "") + ".");
    });
  }
  function annuler(){
    if (!histo.length) return;
    var h = histo.pop();
    h.parts.slice().reverse().forEach(function(p){ IFC.appliquer(p.f.m, p.ch, true); });
    aRefaire.push(h);
    reconstruire();
    etat("Annulé : " + h.txt + " (" + pluriel(h.e, "entité remise", "entités remises") + ").");
  }
  function retablir(){
    if (!aRefaire.length) return;
    var h = aRefaire.pop();
    h.parts.forEach(function(p){ IFC.appliquer(p.f.m, p.ch); });
    histo.push(h);
    reconstruire();
    etat("Rétabli : " + h.txt + ".");
  }

  function telecharger(f){
    var m = f.m, oct = IFC.versOctets(IFC.ecrire(m)), nom = IFC.nomExport(m.nom);
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([oct], { type: "application/x-step" }));
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    f.propre = m.version;
    return "« " + nom + " » : avant " + fmtN(m.nbOrigine) + " entités · " + fmtTaille(m.taille) +
      ", après " + fmtN(m.ent.size) + " entités · " + fmtTaille(oct.length);
  }
  // Sans argument : le fichier ouvert s'il est seul, sinon tous les fichiers modifiés
  function exporter(f){
    var cibles = f ? [f] : fichiers.length === 1 ? fichiers.slice() : fichiers.filter(modifie);
    if (!cibles.length){ etat("Aucun fichier modifié. Pour exporter un fichier précis, utilise son bouton « Exporter » dans la liste."); return; }
    var bilans = [];
    // téléchargements espacés : certains navigateurs ignorent des clics trop rapprochés
    cibles.forEach(function(x, k){
      setTimeout(function(){
        bilans.push(telecharger(x));
        if (bilans.length === cibles.length){
          etat("Exporté" + (cibles.length > 1 ? "s" : "") + " : " + bilans.join(" ; ") + ".");
          rendreListe(); maj();
        }
      }, k*400);
    });
  }

  $("#b-recadrer").addEventListener("click", function(){ vue.recadrer(); });

  // ================= Masquer / isoler dans la vue 3D =================
  function elementsDe(liste){
    return liste.filter(function(c){ var d = lireCle(c), i = d.f && IFC.infos(d.f.m, d.id); return i && i.genre === "element"; });
  }
  function cibles(){ return elementsDe(choix.size ? Array.from(choix) : actif && existe(actif) ? [actif] : []); }
  function majVue(){
    var items = [];
    lignes.forEach(function(l){ if (l.i && l.f.visible && l.i.genre === "element" && !caches.has(l.cle)) items.push({ cle: l.cle, m: l.f.m, id: l.id }); });
    infoVue(vue.afficher(items));
    majLignes(); maj();
  }

  // ================= Commandes (menus et raccourcis) =================
  var remplacer = false;
  function vider(){
    fichiers = []; parUid.clear(); histo = []; aRefaire = []; choix = new Set(); caches = new Set(); actif = ""; lignes = [];
    vue.modeles([]);
  }
  function comme(test, quoi){
    var d = lireCle(actif), r = IFC.infos(d.f.m, d.id), n = 0;
    lignes.forEach(function(l){ if (l.i && l.i.supprimable && test(l.i, r) && !choix.has(l.cle)){ choix.add(l.cle); n++; } });
    majLignes(); maj();
    etat(n ? pluriel(n, "élément ajouté", "éléments ajoutés") + " à la sélection (" + quoi + " que « " + nomAff(r) + " »)." : "Aucun autre élément avec " + quoi + ".");
  }
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
    exporter: function(){ exporter(null); },
    "exporter-fichier": function(b){ var f = parUid.get(+b.getAttribute("data-uid")); if (f) exporter(f); },
    "fermer-tout": function(){
      if (fichiers.some(modifie) && !confirm("Les modifications non exportées seront perdues. Tout fermer ?")) return;
      vider();
      $("#editeur").hidden = true; $("#accueil").hidden = false;
      etat(""); window.scrollTo(0, 0);
    },
    annuler: annuler, retablir: retablir, supprimer: supprimer,
    tout: function(){ $("#sel-tout").click(); },
    rien: function(){ choix.clear(); majLignes(); maj(); },
    inverser: function(){ $("#sel-inv").click(); },
    "meme-type": function(){ comme(function(i, r){ return i.type === r.type; }, "le même type"); },
    "meme-materiau": function(){ comme(function(i, r){ return !!r.materiau && i.materiau === r.materiau; }, "le même matériau"); },
    "meme-nom": function(){ comme(function(i, r){ return !!r.nom && i.nom === r.nom; }, "le même nom"); },
    recadrer: function(){ vue.recadrer(); },
    "vue-iso": function(){ vue.orienter(-Math.PI/4, Math.atan(Math.SQRT1_2)); },
    "vue-dessus": function(){ vue.orienter(0, 1.55); },
    "vue-face": function(){ vue.orienter(0, 0); },
    "vue-cote": function(){ vue.orienter(Math.PI/2, 0); },
    masquer: function(){
      var c = cibles();
      c.forEach(function(x){ caches.add(x); });
      majVue();
      etat(pluriel(c.length, "élément masqué", "éléments masqués") + " dans la vue 3D (Maj+H pour tout afficher).");
    },
    isoler: function(){
      var c = new Set(cibles()), n = 0;
      caches = new Set();
      lignes.forEach(function(l){ if (l.i && l.i.genre === "element" && !c.has(l.cle)){ caches.add(l.cle); n++; } });
      majVue();
      etat(pluriel(c.size, "élément isolé", "éléments isolés") + ", " + fmtN(n) + " masqués.");
    },
    "tout-afficher": function(){ var n = caches.size; caches = new Set(); majVue(); if (n) etat(pluriel(n, "élément de nouveau affiché", "éléments de nouveau affichés") + "."); },
    raccourcis: function(){
      aide("Raccourcis clavier", '<div class="aide-table">' + [
        ["Ctrl+O", "Ouvrir des fichiers (remplace ceux ouverts)"], ["Ctrl+Maj+O", "Ajouter des fichiers"], ["Ctrl+S", "Exporter"],
        ["Ctrl+Z / Ctrl+Y", "Annuler / Rétablir"], ["Suppr", "Supprimer la sélection"], ["Ctrl+A", "Tout sélectionner"], ["Échap", "Ne rien sélectionner"],
        ["F", "Recadrer"], ["1 · 2 · 3 · 4", "Vue isométrique, dessus, face, côté"], ["H · I · Maj+H", "Masquer, isoler, tout afficher"],
        ["Glisser", "Tourner (Maj ou clic droit : déplacer)"], ["Molette, pincement", "Zoom"], ["Double-clic", "Recadrer"]
      ].map(function(x){ return "<kbd>" + esc(x[0]) + "</kbd><span>" + esc(x[1]) + "</span>"; }).join("") + "</div>");
    },
    "a-propos": function(){
      aide("Éditeur IFC", "<p>Ouvre des maquettes IFC2X3 ou IFC4, sélectionne des éléments, supprime-les proprement (relations, géométrie et propriétés devenues orphelines partent avec eux) et réécris le fichier.</p>" +
        "<p>Tout se passe dans ton navigateur : aucun fichier n'est envoyé, l'outil ne fait aucun appel réseau.</p>");
    }
  };
  function activerCmd(c, ok){ [].forEach.call(document.querySelectorAll('[data-cmd="' + c + '"]'), function(b){ b.disabled = !ok; }); }

  // ================= Barre de menus =================
  var mb = $("#mb"), groupes = [].slice.call(mb.querySelectorAll(".mb-gr")), ouvert = null;
  function itemsDe(liste){ return [].filter.call(liste.querySelectorAll("button"), function(b){ return !b.disabled; }); }
  function fermerMenu(){
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
  mb.addEventListener("keydown", function(e){
    if (!ouvert) return;
    var its = itemsDe(ouvert.liste), i = its.indexOf(document.activeElement), gi = groupes.indexOf(ouvert.gr);
    if (e.key === "ArrowDown"){ e.preventDefault(); if (its.length) its[(i + 1) % its.length].focus(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); if (its.length) its[(i - 1 + its.length) % its.length].focus(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft"){
      e.preventDefault();
      ouvrirMenu(groupes[(gi + (e.key === "ArrowRight" ? 1 : -1) + groupes.length) % groupes.length], true);
    }
    else if (e.key === "Escape"){ e.preventDefault(); var t = ouvert.titre; fermerMenu(); t.focus(); }
  });

  // ================= Raccourcis clavier =================
  document.addEventListener("keydown", function(e){
    if (!fichiers.length || $("#editeur").hidden || ouvert || $("#confirmer").open || $("#aide").open) return;
    var t = e.target.tagName, saisie = t === "INPUT" || t === "SELECT" || t === "TEXTAREA";
    var k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey, c = null;
    if (mod && k === "o") c = e.shiftKey ? "ajouter" : "ouvrir";
    else if (mod && k === "s") c = "exporter";
    else if (saisie) return;
    else if (mod && k === "z" && !e.shiftKey) c = "annuler";
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) c = "retablir";
    else if (mod && k === "a") c = "tout";
    else if (mod || e.altKey) return;
    else if (e.key === "Delete" && choix.size) c = "supprimer";
    else if (e.key === "Escape" && choix.size) c = "rien";
    else if (k === "f") c = "recadrer";
    else if (k === "1") c = "vue-iso";
    else if (k === "2") c = "vue-dessus";
    else if (k === "3") c = "vue-face";
    else if (k === "4") c = "vue-cote";
    else if (k === "h") c = e.shiftKey ? "tout-afficher" : "masquer";
    else if (k === "i") c = "isoler";
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
  (function(){
    var btn = $("#theme-btn"), menu = $("#menu-theme"), FOND = { clair: "#F3F0E8", sombre: "#050505" };
    function choisi(){ try { return localStorage.getItem("ifc.theme") || "sombre"; } catch (e){ return "sombre"; } }
    function applique(c){
      var eff = c === "systeme" ? (matchMedia("(prefers-color-scheme: light)").matches ? "clair" : "sombre") : c;
      document.documentElement.setAttribute("data-theme", eff);
      var m = document.querySelector("meta[name=theme-color]"); if (m) m.setAttribute("content", FOND[eff]);
      [].forEach.call(menu.querySelectorAll("[data-choix-theme]"), function(b){ b.setAttribute("aria-checked", String(b.getAttribute("data-choix-theme") === c)); });
    }
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
