/* Bandeau de gauche repliable des pages de la planification (02.11.2026,
   demande de Tony, repris du bureau /planif2/).
   ---------------------------------------------------------------------------
   La page fournit le HTML :
     <div class="wrap bd-page" id="bd-page">
       <aside class="bd-bandeau" id="bd-bandeau"> <div data-recherche></div> <nav class="bd-arbre" id="bd-arbre"></nav> </aside>
       <button type="button" class="bd-replier" id="bd-replier" aria-controls="bd-bandeau">‹</button>
       <div class="bd-contenu"> … </div>
     </div>
   puis :
     Bandeau.monte({ cle: "planif.taches.replie", apres: f })   chevron, choix gardé sur l'appareil
     Bandeau.vide()                     → l'arbre, vidé, pour y poser les entrées
     Bandeau.entree(hote, cle, nom, n, niv, actif, choix)
     Bandeau.titre(hote, texte)
     Bandeau.equipes(hote, { toute, nombre(cle), actif, choix })   Tous, Administrateurs,
                                        chaque succursale et ses secteurs (structure tirée de
                                        « toute », les nombres de nombre(cle))
     Bandeau.liste(hote, titre, options [[valeur, libellé]], valeur, choix)   un menu déroulant
     Bandeau.caseACocher(hote, texte, coche, choix, aide)
     Bandeau.mode(hote, options [[valeur, libellé]], valeur, choix)          interrupteur
     Bandeau.estAdmin(m), .dansEquipe(m, cle), .cleDe(membre), .titreCle(cle), .succursaleDe(cle)
   S'appuie sur donnees.js et ui.js.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";
  var D = global.Donnees;
  function el(tag, attrs, enfants) { return global.UI.el(tag, attrs, enfants); }
  function $(id) { return document.getElementById(id); }

  function sansAccents(x) { return String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function estAdminDisc(code) { return /^administrateur/.test(sansAccents(code)) || /^administrateur/.test(sansAccents(D.DISCIPLINES[code])); }
  /** Les administrateurs : rangés à part, pas dans les secteurs des succursales. */
  function estAdmin(m) { return !!m && (D.aStatut(m, "administrateur") || estAdminDisc(m.discipline)); }
  /** cle : tous | admin | s:<succursale> | d:<succursale>|<discipline> (« _ » : non renseignée). */
  function dansEquipe(m, cle) {
    if (!m) return false;
    if (!cle || cle === "tous") return true;
    if (cle === "admin") return estAdmin(m);
    if (cle.indexOf("s:") === 0) return (m.succursale || "_") === cle.slice(2);
    if (cle.indexOf("d:") !== 0) return false;
    var p = cle.slice(2).split("|");
    return (m.succursale || "_") === p[0] && (m.discipline || "_") === p[1] && !estAdmin(m);
  }
  /** L'équipe d'une personne : son secteur dans sa succursale (les administrateurs : « admin »). */
  function cleDe(m) {
    if (!m) return "tous";
    return estAdmin(m) ? "admin" : "d:" + (m.succursale || "_") + "|" + (m.discipline || "_");
  }
  function succursaleDe(cle) {
    if (!cle) return null;
    if (cle.indexOf("s:") === 0) return cle.slice(2);
    if (cle.indexOf("d:") === 0) return cle.slice(2).split("|")[0];
    return null;
  }
  function titreCle(cle) {
    if (!cle || cle === "tous") return "Toute l'équipe";
    if (cle === "admin") return "Administrateurs";
    if (cle.indexOf("s:") === 0) return cle.slice(2) === "_" ? "Sans succursale" : D.SUCCURSALES[cle.slice(2)];
    if (cle.indexOf("d:") === 0) {
      var p = cle.slice(2).split("|");
      return (p[1] === "_" ? "Secteur non renseigné" : D.DISCIPLINES[p[1]]) + " · " + (p[0] === "_" ? "sans succursale" : D.SUCCURSALES[p[0]]);
    }
    return "";
  }

  /* ---------- Chevron ---------- */
  var cleReplie = "planif.bandeau.replie", apres = null;
  function replie(oui) {
    var page = $("bd-page"), b = $("bd-replier");
    if (!page || !b) return;
    page.classList.toggle("replie", oui);
    var mobile = global.innerWidth <= 760;
    b.textContent = mobile ? (oui ? "Recherche et filtres ▾" : "Masquer ▴") : (oui ? "›" : "‹");
    b.title = oui ? "Afficher le bandeau" : "Réduire le bandeau";
    b.setAttribute("aria-expanded", String(!oui));
    try { localStorage.setItem(cleReplie, oui ? "1" : ""); } catch (e) {}
  }
  function monte(o) {
    o = o || {};
    cleReplie = o.cle || cleReplie; apres = o.apres || null;
    var garde = null;
    try { garde = localStorage.getItem(cleReplie); } catch (e) {}
    replie(garde === null ? global.innerWidth <= 760 : garde === "1");
    $("bd-replier").addEventListener("click", function () {
      replie(!$("bd-page").classList.contains("replie"));
      if (apres) setTimeout(apres, 30);
    });
  }

  /* ---------- Entrées ---------- */
  function vide() { var h = $("bd-arbre"); h.textContent = ""; return h; }
  function entree(hote, cle, nom, n, niv, actif, choix) {
    var b = el("button", { type: "button", class: "niv" + (niv || 0), "aria-current": String(!!actif) }, [
      el("span", { class: "nom", text: nom }), n != null ? el("span", { class: "n", text: String(n) }) : null
    ]);
    b.addEventListener("click", function () { choix(cle); if (global.innerWidth <= 760) replie(true); });
    hote.appendChild(b);
    return b;
  }
  function titre(hote, texte) { hote.appendChild(el("p", { class: "titre-groupe", text: texte })); }

  /** Tous, Administrateurs, puis chaque succursale et ses secteurs. */
  function equipes(hote, o) {
    var toute = o.toute || D.membres(), nombre = o.nombre || function () { return null; };
    entree(hote, "tous", o.libelleTous || "Toute l'équipe", nombre("tous"), 0, o.actif === "tous", o.choix);
    if (toute.some(estAdmin)) entree(hote, "admin", "Administrateurs", nombre("admin"), 0, o.actif === "admin", o.choix);
    var succ = Object.keys(D.SUCCURSALES);
    if (succ.length && toute.some(function (m) { return !m.succursale && !estAdmin(m); })) succ.push("_");
    var ordre = Object.keys(D.DISCIPLINES);
    (succ.length ? succ : ["_"]).forEach(function (s) {
      if (succ.length) entree(hote, "s:" + s, s === "_" ? "Sans succursale" : D.SUCCURSALES[s], nombre("s:" + s), 0, o.actif === "s:" + s, o.choix);
      var discs = {};
      toute.forEach(function (m) { if ((m.succursale || "_") === s && !estAdmin(m)) discs[m.discipline || "_"] = true; });
      Object.keys(discs).sort(function (a, b) { return (a === "_" ? 999 : ordre.indexOf(a)) - (b === "_" ? 999 : ordre.indexOf(b)); }).forEach(function (d) {
        var k = "d:" + s + "|" + d;
        entree(hote, k, d === "_" ? "Secteur non renseigné" : D.DISCIPLINES[d], nombre(k), succ.length ? 1 : 0, o.actif === k, o.choix);
      });
    });
  }

  function liste(hote, libelle, options, valeur, choix) {
    if (libelle) titre(hote, libelle);
    // Une entrée { groupe, options } devient un sous-groupe titré (mes affaires, puis les autres)
    var option = function (x) { return el("option", { value: x[0], text: x[1] }); };
    var sel = el("select", { "aria-label": libelle || "" }, options.map(function (x) {
      return x.options ? el("optgroup", { label: x.groupe }, x.options.map(option)) : option(x);
    }));
    sel.value = valeur == null ? "" : valeur;
    sel.addEventListener("change", function () { choix(sel.value); });
    hote.appendChild(el("label", { class: "bd-affaire" }, [sel]));
    return sel;
  }
  function caseACocher(hote, texte, coche, choix, aide) {
    var c = el("input", { type: "checkbox" }); c.checked = !!coche;
    c.addEventListener("change", function () { choix(c.checked); });
    hote.appendChild(el("label", { class: "bd-case", title: aide || null }, [c, texte]));
    return c;
  }
  function mode(hote, options, valeur, choix) {
    var g = el("div", { class: "bd-mode", role: "group" });
    options.forEach(function (x) {
      var b = el("button", { type: "button", "aria-pressed": String(x[0] === valeur), text: x[1] });
      b.addEventListener("click", function () { if (x[0] !== valeur) choix(x[0]); });
      g.appendChild(b);
    });
    hote.appendChild(g);
    return g;
  }

  global.Bandeau = {
    monte: monte, replie: replie, vide: vide, entree: entree, titre: titre, equipes: equipes,
    liste: liste, caseACocher: caseACocher, mode: mode,
    estAdmin: estAdmin, dansEquipe: dansEquipe, cleDe: cleDe, titreCle: titreCle, succursaleDe: succursaleDe
  };
})(window);
