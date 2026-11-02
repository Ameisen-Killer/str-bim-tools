/* Bureau (/planif2/) — outillage commun des modules V2 (02.11.2026).
   ---------------------------------------------------------------------------
   Même philosophie partout : bandeau à gauche repliable par un chevron (comme
   la visionneuse IFC), avec recherche et arborescence de filtres ; contenu à
   droite ; détail dans un panneau qui glisse depuis la droite.
     M.el(tag, classe, texte)             construction du DOM
     M.bandeau()                          chevron du bandeau (choix gardé sur l'appareil)
     M.arbre(hote, entrees, actif, choix) entrées [{cle, nom, n, niv, titre}] (titre : intertitre)
     M.panneau.ouvre(tete, corps, teinte) / .ferme() / .ouvert()
     M.annonce(texte, annulable, apres)   bandeau en bas, « Annuler » (Donnees.annule)
     M.demarre(f)                         contrôle la session puis Donnees.pret() → f()
     M.sansAccents, M.jj, M.quand, M.fmtJ, M.avatar(m), M.cherche(texte, requête)
   S'appuie sur donnees.js, calendrier.js et calculs.js de /planif/ (non modifiés).
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";
  var D = global.Donnees, C = global.Cal, SB = global.Sb;
  var $ = function (s) { return document.querySelector(s); };
  var JOURS_ABR = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];

  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function jj(iso, an) { var d = C.dt(iso); return d ? deux(d.getDate()) + "." + deux(d.getMonth() + 1) + (an ? "." + d.getFullYear() : "") : "—"; }
  function quand(iso) {
    if (!iso) return "—";
    var n = C.diff(C.isoAuj(), iso), d = C.dt(iso);
    if (n < 0) return "Retard · " + jj(iso);
    if (n === 0) return "Aujourd'hui";
    if (n === 1) return "Demain";
    if (n < 7) return JOURS_ABR[d.getDay()] + " " + jj(iso);
    return jj(iso);
  }
  function fmtJ(x) { return (Math.round((x || 0) * 10) / 10).toString().replace(".", ","); }
  function cherche(texte, requete) {
    var mots = sansAccents(requete).split(/\s+/).filter(Boolean);
    if (!mots.length) return true;
    var t = sansAccents(texte);
    return mots.every(function (w) { return t.indexOf(w) >= 0; });
  }
  function avatar(m) {
    var av = el("span", "avatar");
    if (m && m.photo) { var img = el("img"); img.src = m.photo; img.alt = ""; av.appendChild(img); }
    else av.textContent = m ? (((m.prenom || "").charAt(0) + (m.nom || m.societe || "").charAt(0)).toUpperCase() || "?") : "?";
    if (m && (m.prenom || m.nom)) av.title = [m.prenom, m.nom].filter(Boolean).join(" ");
    return av;
  }

  /* ---------- Bandeau ---------- */
  function replie(oui) {
    var page = $("#page"), btn = $("#replier");
    if (!page || !btn) return;
    page.classList.toggle("replie", oui);
    btn.textContent = oui ? "›" : "‹";
    btn.title = oui ? "Afficher le bandeau" : "Réduire le bandeau";
    btn.setAttribute("aria-expanded", String(!oui));
    try { localStorage.setItem("planif2.equipes.replie", oui ? "1" : ""); } catch (e) {}
  }
  function bandeau(apres) {
    var garde = null;
    try { garde = localStorage.getItem("planif2.equipes.replie"); } catch (e) {}
    replie(garde === null ? innerWidth <= 700 : garde === "1");
    $("#replier").addEventListener("click", function () {
      replie(!$("#page").classList.contains("replie"));
      if (apres) setTimeout(apres, 260);
    });
  }
  function arbre(hote, entrees, actif, choix) {
    hote.textContent = "";
    entrees.forEach(function (x) {
      if (x.titre) { hote.appendChild(el("p", "titre-groupe", x.titre)); return; }
      var b = el("button", "entree niv" + (x.niv || 0)); b.type = "button";
      b.setAttribute("aria-current", String(actif === x.cle));
      b.appendChild(el("span", "nom", x.nom));
      if (x.n != null) b.appendChild(el("span", "n", x.n));
      b.addEventListener("click", function () { choix(x.cle); if (innerWidth <= 700) replie(true); });
      hote.appendChild(b);
    });
  }

  /* ---------- Panneau de détail ---------- */
  var voile = null, pan = null, surFerme = null;
  function construitPanneau() {
    if (pan) return;
    voile = el("div", "voile"); voile.hidden = true;
    pan = el("aside", "detail"); pan.setAttribute("aria-hidden", "true");
    pan.innerHTML = '<header><button type="button" class="fermer" aria-label="Fermer">×</button><div class="d-tete"></div></header><div class="corps"></div>';
    document.body.appendChild(voile); document.body.appendChild(pan);
    voile.addEventListener("click", ferme);
    pan.querySelector(".fermer").addEventListener("click", ferme);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && pan.classList.contains("ouvert")) ferme(); });
  }
  function ouvre(tete, corps, teinte, quandFerme) {
    construitPanneau();
    surFerme = quandFerme || null;
    var t = pan.querySelector(".d-tete"), c = pan.querySelector(".corps");
    t.textContent = ""; c.textContent = "";
    (Array.isArray(tete) ? tete : [tete]).forEach(function (n) { if (n) t.appendChild(n); });
    (Array.isArray(corps) ? corps : [corps]).forEach(function (n) { if (n) c.appendChild(n); });
    if (teinte) pan.style.setProperty("--teinte", teinte); else pan.style.removeProperty("--teinte");
    voile.hidden = false; pan.setAttribute("aria-hidden", "false");
    requestAnimationFrame(function () { pan.classList.add("ouvert"); });
    return c;
  }
  function ferme() {
    if (!pan) return;
    pan.classList.remove("ouvert"); pan.setAttribute("aria-hidden", "true"); voile.hidden = true;
    var f = surFerme; surFerme = null; if (f) f();
  }

  /* ---------- Annonce ---------- */
  var boite = null, minuterie = 0;
  function annonce(texte, annulable, apres) {
    if (!boite) { boite = el("div", "annonce"); boite.setAttribute("role", "status"); document.body.appendChild(boite); }
    boite.textContent = texte; boite.hidden = false;
    if (annulable && D.annule) {
      var a = el("button", null, "Annuler"); a.type = "button";
      a.addEventListener("click", function () {
        D.annule().then(function (lib) { if (apres) apres(); annonce(lib ? "Annulé." : "Rien à annuler."); })
          .catch(function (err) { annonce(err.message); });
      });
      boite.appendChild(a);
    }
    clearTimeout(minuterie);
    minuterie = setTimeout(function () { boite.hidden = true; }, 6000);
  }

  /* ---------- Démarrage ---------- */
  function demarre(f, hote) {
    hote = hote || $("#liste");
    if (SB && SB.configure && !SB.connecte()) { if (hote) hote.appendChild(el("p", "vide", "Connexion requise.")); return; }
    D.pret().then(f).catch(function (e) { if (hote) hote.appendChild(el("p", "vide", (e && e.message) || "Chargement impossible.")); });
  }

  /* ---------- Champs de formulaire ---------- */
  function champ(libelle, input, large) {
    var l = el("label", "fchamp" + (large ? " large" : ""));
    l.appendChild(el("span", null, libelle)); l.appendChild(input);
    return l;
  }
  function saisie(valeur, type, attrs) {
    var i = el(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") i.type = type || "text";
    i.value = valeur == null ? "" : valeur;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }

  global.M = {
    el: el, sansAccents: sansAccents, jj: jj, quand: quand, fmtJ: fmtJ, cherche: cherche, avatar: avatar,
    bandeau: bandeau, replie: replie, arbre: arbre,
    panneau: { ouvre: ouvre, ferme: ferme, ouvert: function () { return !!pan && pan.classList.contains("ouvert"); } },
    annonce: annonce, demarre: demarre, champ: champ, saisie: saisie
  };
})(window);
