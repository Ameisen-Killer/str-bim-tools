// Interface de /ifc/ : chargement du fichier, liste des éléments, propriétés, suppression avec
// confirmation, annuler / rétablir, export, onglets sur smartphone, thème clair / sombre.
// Le fichier ne quitte jamais le navigateur : aucune requête réseau ici.
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

  var M = null, lignes = [], choix = new Set(), actif = 0, histo = [], aRefaire = [], propre = 0;
  var tailleCache = { v: -1, t: 0 };

  var vue = IFCVue.creer($("#vue"), { surClic: cliqueVue });

  // ================= Messages =================
  function etat(msg){ $("#etat").textContent = msg || ""; }
  function erreur(msg){
    var b = $("#erreur");
    if (!msg){ b.hidden = true; b.innerHTML = ""; return; }
    b.innerHTML = "<b>Fichier refusé</b>" + esc(msg);
    b.hidden = false;
  }
  function nomAff(i){ return i.nom || i.objectType || i.tag || i.typeLib + " #" + i.id; }
  function modifie(){ return M && M.version !== propre; }

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
  function charger(f){
    if (!f) return;
    if (modifie() && !confirm("Les modifications non exportées de « " + M.nom + " » seront perdues. Ouvrir quand même « " + f.name + " » ?")) return;
    erreur("");
    $("#chargement").hidden = false;
    if (M) etat("Lecture de « " + f.name + " »…");
    lireFichier(f).then(function(buf){
      // laisse le temps d'afficher « Lecture du fichier… » avant le calcul
      return new Promise(function(ok){ setTimeout(function(){ ok(buf); }, 40); });
    }).then(function(buf){
      var t0 = performance.now();
      var m = IFC.lire(buf, f.name);
      ouvrir(m, performance.now() - t0);
    }).catch(function(err){
      $("#chargement").hidden = true;
      var msg = err && err.ifc ? err.message : "Lecture impossible : " + (err && err.message || err);
      if (window.console) console.error(err);
      if (M){ etat("Fichier refusé (« " + f.name + " ») : " + msg); return; }
      erreur(msg);
    });
  }

  function ouvrir(m, ms){
    M = m; choix = new Set(); actif = 0; histo = []; aRefaire = []; propre = M.version;
    vue.modele(M);
    $("#chargement").hidden = true;
    $("#accueil").hidden = true;
    $("#editeur").hidden = false;
    $("#f-nom").textContent = M.nom + " · " + M.schema;
    $("#f-nom").title = M.nom;
    $("#recherche").value = "";
    $("#filtre-type").value = "";
    reconstruire();
    vue.redessiner();
    vue.recadrer();
    afficherProps();
    var nbEl = lignes.filter(function(l){ return l.i.genre !== "spatial"; }).length;
    etat("Fichier lu : " + pluriel(M.nbOrigine, "entité") + ", " + pluriel(nbEl, "élément") + ", en " + Math.max(1, Math.round(ms)) + " ms" +
      (M.doublons ? " (attention : " + pluriel(M.doublons, "identifiant") + " en double, seule la première entité a été gardée)" : "") + ".");
    window.scrollTo(0, 0);
  }

  // ================= Liste des éléments =================
  function reconstruire(){
    lignes = IFC.arbre(M).map(function(l){
      var i = IFC.infos(M, l.id);
      return { id: l.id, niv: l.niv, i: i,
        cle: [nomAff(i), i.typeLib, i.type, i.materiau, i.globalId, i.tag, i.objectType, "#" + i.id].join(" ").toLowerCase() };
    });
    choix.forEach(function(id){ if (!M.ent.has(id)) choix.delete(id); });
    if (actif && !M.ent.has(actif)) actif = 0;
    remplirTypes();
    rendreListe();
    var ids = lignes.filter(function(l){ return l.i.genre === "element"; }).map(function(l){ return l.id; });
    infoVue(vue.afficher(ids));
    afficherProps();
    maj();
  }

  function remplirTypes(){
    var sel = $("#filtre-type"), avant = sel.value, compte = {};
    lignes.forEach(function(l){ if (l.i.supprimable) compte[l.i.type] = (compte[l.i.type] || 0) + 1; });
    var types = Object.keys(compte).sort(function(a, b){ return IFC.nomType(a).localeCompare(IFC.nomType(b)); });
    sel.innerHTML = '<option value="">Tous les types</option>' + types.map(function(t){
      return '<option value="' + esc(t) + '">' + esc(IFC.nomType(t)) + " (" + compte[t] + ")</option>";
    }).join("");
    sel.value = compte[avant] ? avant : "";
  }

  var visibles = [];
  function rendreListe(){
    var q = $("#recherche").value.trim().toLowerCase(), t = $("#filtre-type").value, filtre = !!(q || t);
    var html = [];
    visibles = [];
    lignes.forEach(function(l){
      var i = l.i;
      if (filtre){
        if (!i.supprimable) return;
        if (t && i.type !== t) return;
        if (q && l.cle.indexOf(q) < 0) return;
      }
      var c = choix.has(l.id);
      if (i.supprimable) visibles.push(l.id);
      var info = [i.typeLib, i.materiau, "#" + i.id].filter(Boolean).join(" · ");
      html.push('<div class="el ' + i.genre + (c ? " choisi" : "") + (l.id === actif ? " actif" : "") + '" role="listitem" data-id="' + l.id +
        '" style="--niv:' + (filtre ? 0 : Math.min(l.niv, 8)) + '">' +
        (i.supprimable ? '<input type="checkbox" aria-label="Sélectionner ' + esc(nomAff(i)) + '"' + (c ? " checked" : "") + ">" : '<span class="vide"></span>') +
        '<div><div class="el-nom">' + esc(nomAff(i)) + '</div><div class="el-info">' + esc(info) + "</div></div></div>");
    });
    $("#liste").innerHTML = html.join("") || '<p class="liste-vide">Aucun élément ne correspond.</p>';
    $("#compte").textContent = fmtN(visibles.length) + " affichés";
  }

  // Met à jour cases et surbrillances sans reconstruire la liste
  function majLignes(){
    [].forEach.call($("#liste").children, function(r){
      var id = +r.getAttribute("data-id");
      if (!id) return;
      var c = choix.has(id);
      r.classList.toggle("choisi", c);
      r.classList.toggle("actif", id === actif);
      var cb = r.querySelector("input");
      if (cb) cb.checked = c;
    });
  }

  function supprimable(id){ var i = IFC.infos(M, id); return !!(i && i.supprimable); }
  // Cocher un assemblage coche ses enfants (IFCRELAGGREGATES)
  function cocher(id, oui){
    [id].concat(IFC.descendants(M, id)).forEach(function(x){
      if (!supprimable(x)) return;
      if (oui) choix.add(x); else choix.delete(x);
    });
    majLignes(); maj();
  }
  function activer(id, defiler){
    actif = id;
    majLignes();
    afficherProps();
    maj();
    if (defiler){
      var r = $('#liste [data-id="' + id + '"]');
      if (r) r.scrollIntoView({ block: "nearest" });
    }
  }
  function cliqueVue(id){
    if (!id) return;
    var i = IFC.infos(M, id);
    if (choix.has(id)){ choix.delete(id); etat("« " + nomAff(i) + " » retiré de la sélection."); }
    else if (i.supprimable){ choix.add(id); etat("« " + nomAff(i) + " » ajouté à la sélection."); }
    activer(id, true);
  }

  $("#liste").addEventListener("click", function(e){
    var r = e.target.closest(".el");
    if (!r) return;
    var id = +r.getAttribute("data-id");
    if (e.target.tagName === "INPUT"){ cocher(id, e.target.checked); actif = id; majLignes(); afficherProps(); maj(); return; }
    activer(id, false);
  });
  $("#recherche").addEventListener("input", rendreListe);
  $("#filtre-type").addEventListener("change", rendreListe);
  $("#sel-tout").addEventListener("click", function(){
    visibles.forEach(function(id){ choix.add(id); IFC.descendants(M, id).forEach(function(x){ if (supprimable(x)) choix.add(x); }); });
    majLignes(); maj();
  });
  $("#sel-rien").addEventListener("click", function(){
    visibles.forEach(function(id){ choix.delete(id); });
    majLignes(); maj();
  });
  $("#sel-inv").addEventListener("click", function(){
    visibles.forEach(function(id){ if (choix.has(id)) choix.delete(id); else choix.add(id); });
    majLignes(); maj();
  });

  // ================= Propriétés =================
  function ligne(dt, dd, mono){ return dd ? "<dt>" + esc(dt) + "</dt><dd" + (mono ? ' class="mono"' : "") + ">" + esc(dd) + "</dd>" : ""; }
  function afficherProps(){
    var z = $("#props");
    if (!M || !actif || !M.ent.has(actif)){
      z.innerHTML = '<p class="props-vide">Clique un élément dans la liste ou dans la vue 3D.</p>';
      return;
    }
    var i = IFC.infos(M, actif), I = IFC.index(M);
    var enf = (I.enfants.get(actif) || []).length, ouv = (I.ouvertures.get(actif) || []).length;
    var parent = I.parent.get(actif) || I.conteneur.get(actif) || I.perce.get(actif), pi = parent && M.ent.has(parent) ? IFC.infos(M, parent) : null;
    var h = '<div class="type">' + esc(i.typeLib) + " · #" + i.id + "</div><h3>" + esc(nomAff(i)) + "</h3><dl>" +
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
    IFC.proprietes(M, actif).forEach(function(p){
      h += '<div class="pset"><div class="pset-nom">' + esc(p.nom) + (p.origine ? " · " + esc(p.origine) : "") + "</div><dl>" +
        (p.props.length ? p.props.map(function(x){ return "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd>"; }).join("") : "<dt>—</dt><dd>Aucune valeur lisible</dd>") +
        "</dl></div>";
    });
    z.innerHTML = h;
    z.scrollTop = 0;
  }

  // ================= Barre d'actions =================
  function maj(){
    if (!M) return;
    var n = choix.size;
    $("#b-suppr-n").textContent = n ? "(" + fmtN(n) + ")" : "";
    $("#b-suppr").disabled = !n;
    $("#b-annuler").disabled = !histo.length;
    $("#b-retablir").disabled = !aRefaire.length;
    $("#b-annuler").title = histo.length ? "Annuler : " + histo[histo.length - 1].txt + " (Ctrl+Z)" : "Annuler (Ctrl+Z)";
    $("#b-retablir").title = aRefaire.length ? "Rétablir : " + aRefaire[aRefaire.length - 1].txt + " (Ctrl+Y)" : "Rétablir (Ctrl+Y)";
    $("#compte").textContent = fmtN(visibles.length) + " affichés" + (n ? " · " + fmtN(n) + " cochés" : "");
    if (tailleCache.v !== M.version){ tailleCache = { v: M.version, t: IFC.taille(M) }; }
    $("#f-bilan").innerHTML = "Avant <b>" + fmtN(M.nbOrigine) + "</b> entités · " + fmtTaille(M.taille) +
      " → maintenant <b>" + fmtN(M.ent.size) + "</b> entités · " + fmtTaille(tailleCache.t);
    vue.selection(choix, actif);
  }

  function infoVue(b){
    var nl = Object.keys(b.nonLus);
    $("#vue-info").textContent = pluriel(b.elements, "élément dessiné", "éléments dessinés") + " · " + pluriel(b.faces, "face") +
      (nl.length ? " · géométrie non lue : " + nl.slice(0, 4).map(IFC.nomType).join(", ") + (nl.length > 4 ? "…" : "") : "") +
      (b.erreurs ? " · " + pluriel(b.erreurs, "élément illisible", "éléments illisibles") : "");
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
    if (!M || !choix.size) return;
    var plan = IFC.planifier(M, Array.from(choix));
    if (!plan.nbElements){ etat("Rien à supprimer : la sélection ne contient que des éléments de structure spatiale."); return; }
    var ajoutes = plan.nbElements - plan.nbDemandes;
    var texte = pluriel(plan.nbElements, "élément") + (ajoutes ? " (dont " + fmtN(ajoutes) + " ajouté" + (ajoutes > 1 ? "s" : "") + " d'office : enfants d'assemblage ou ouvertures)" : "") +
      " et " + pluriel(plan.nbEntites, "entité") + " au total vont partir du fichier" +
      (plan.nbModifiees ? " ; " + pluriel(plan.nbModifiees, "relation") + " " + (plan.nbModifiees > 1 ? "seront raccourcies" : "sera raccourcie") : "") + ".";
    confirmer(texte, function(){
      IFC.appliquer(M, plan.changement);
      var txt = "suppression de " + pluriel(plan.nbElements, "élément");
      histo.push({ ch: plan.changement, txt: txt, n: plan.nbElements, e: plan.nbEntites });
      aRefaire = [];
      reconstruire();
      etat(pluriel(plan.nbElements, "élément supprimé", "éléments supprimés") + ", " + pluriel(plan.nbEntites, "entité retirée", "entités retirées") +
        (plan.nbModifiees ? ", " + pluriel(plan.nbModifiees, "relation raccourcie", "relations raccourcies") : "") + ".");
    });
  }
  function annuler(){
    if (!histo.length) return;
    var h = histo.pop();
    IFC.appliquer(M, h.ch, true);
    aRefaire.push(h);
    reconstruire();
    etat("Annulé : " + h.txt + " (" + pluriel(h.e, "entité remise", "entités remises") + ").");
  }
  function retablir(){
    if (!aRefaire.length) return;
    var h = aRefaire.pop();
    IFC.appliquer(M, h.ch);
    histo.push(h);
    reconstruire();
    etat("Rétabli : " + h.txt + ".");
  }
  function exporter(){
    if (!M) return;
    var oct = IFC.versOctets(IFC.ecrire(M)), nom = IFC.nomExport(M.nom);
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([oct], { type: "application/x-step" }));
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    propre = M.version;
    etat("Exporté : « " + nom + " ». Avant " + fmtN(M.nbOrigine) + " entités · " + fmtTaille(M.taille) +
      " ; après " + fmtN(M.ent.size) + " entités · " + fmtTaille(oct.length) + ".");
  }

  $("#b-suppr").addEventListener("click", supprimer);
  $("#b-annuler").addEventListener("click", annuler);
  $("#b-retablir").addEventListener("click", retablir);
  $("#b-export").addEventListener("click", exporter);
  $("#b-recadrer").addEventListener("click", function(){ vue.recadrer(); });

  document.addEventListener("keydown", function(e){
    if (!M || $("#editeur").hidden) return;
    var t = e.target.tagName;
    if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA" || $("#confirmer").open) return;
    var k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z" && !e.shiftKey){ e.preventDefault(); annuler(); }
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))){ e.preventDefault(); retablir(); }
    else if (e.key === "Delete" && choix.size){ e.preventDefault(); supprimer(); }
  });

  window.addEventListener("beforeunload", function(e){
    if (modifie()){ e.preventDefault(); e.returnValue = ""; }
  });

  // ================= Fichier : bouton et glisser-déposer =================
  var entree = $("#fichier");
  function choisir(){ entree.value = ""; entree.click(); }
  $("#choisir").addEventListener("click", choisir);
  $("#b-autre").addEventListener("click", choisir);
  entree.addEventListener("change", function(){ if (entree.files && entree.files[0]) charger(entree.files[0]); });

  function fichiers(e){ var t = e.dataTransfer && e.dataTransfer.types; return !!t && [].indexOf.call(t, "Files") >= 0; }
  var profondeur = 0;
  window.addEventListener("dragenter", function(e){
    if (!fichiers(e)) return;
    e.preventDefault(); profondeur++;
    $("#depot").classList.add("survol");
  });
  window.addEventListener("dragover", function(e){
    if (!fichiers(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", function(e){
    if (!fichiers(e)) return;
    if (--profondeur <= 0){ profondeur = 0; $("#depot").classList.remove("survol"); }
  });
  window.addEventListener("drop", function(e){
    if (!fichiers(e)) return;
    e.preventDefault(); profondeur = 0;
    $("#depot").classList.remove("survol");
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) charger(f);
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
