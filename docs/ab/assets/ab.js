/* Espace AB Ingénieurs — briques communes aux pages de /ab/ (06.10.2026)
   ---------------------------------------------------------------------------
   La V2 du bureau AB réutilise le moteur de la planification (calendrier.js,
   config.js, supabase.js, donnees.js, calculs.js : mêmes comptes, mêmes
   données) mais pas son interface (ui.js, planif.css) : elle a la sienne.
   Ce fichier porte ce que chaque page AB partage :
     AB.el, AB.vide         construction du DOM
     AB.session()           renvoie à la connexion si personne n'est connecté
     AB.echec(e)            erreur de chargement
     AB.entete(hote)        barre (accueil, retour), logo, date, menu du compte
     AB.surRetour(f)        relit la base au retour sur l'onglet après une minute
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var D = global.Donnees, C = global.Cal, SB = global.Sb;
  var avecBase = !!(SB && SB.configure);
  var SVG = "http://www.w3.org/2000/svg";
  var JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

  /* ------------------------------------------------------------ DOM */

  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (enfants || []).forEach(function (e) {
      if (e == null || e === false) return;
      n.appendChild(typeof e === "string" ? document.createTextNode(e) : e);
    });
    return n;
  }
  function vide(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  /** Un dessin SVG écrit en clair : AB.svg("0 0 64 64", "<path …/>"). */
  function svg(vue, contenu, classe) {
    var s = document.createElementNS(SVG, "svg");
    s.setAttribute("viewBox", vue);
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    if (classe) s.setAttribute("class", classe);
    s.innerHTML = contenu;
    return s;
  }

  function majuscule(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ------------------------------------------------------------ session */

  function versConnexion(motif) {
    location.replace("/planif/connexion/?retour=" + encodeURIComponent(location.pathname + location.search) +
      (motif ? "&motif=" + encodeURIComponent(motif) : ""));
  }

  function session() {
    if (!avecBase || SB.connecte()) return true;
    versConnexion();
    return false;
  }

  function echec(e) {
    var m = (e && e.message) || "Chargement impossible.";
    if (avecBase && /session|acc[eè]s refus/i.test(m)) {
      SB.deconnexion().then(function () { versConnexion(m); });
      return;
    }
    var page = document.querySelector("main") || document.body;
    page.appendChild(el("p", { class: "ab-message", role: "alert", text: m }));
  }

  function deconnecte() {
    if (!avecBase) { location.href = "/planif/"; return; }
    SB.deconnexion().then(function () { location.replace("/planif/connexion/?retour=" + encodeURIComponent("/ab/")); });
  }

  /* ------------------------------------------------------------ logo
     Le logo du bureau, dessiné (même tracé que planif/assets/logo-ab.js) :
     carré vert en haut, gris en bas, « AB » blanc à cheval sur la limite. */
  var LOGO =
    '<rect width="100" height="100" fill="#C8DE9A"/>' +
    '<rect y="58.5" width="100" height="41.5" fill="#8B8B8D"/>' +
    '<g fill="none" stroke="#fff" stroke-width="6.2" stroke-linejoin="miter">' +
    '<path d="M25.5 73.5 37.25 43.3 49 73.5"/>' +
    '<path d="M59.1 73.5V43.6h7.4a6.2 6.2 0 0 1 0 12.4h-7.4M59.1 56h8.5a7.2 7.2 0 0 1 0 14.4h-8.5"/>' +
    '</g>';

  /* ------------------------------------------------------------ en-tête */

  /** Prénom et nom de la personne connectée : sa fiche d'équipe, sinon son adresse. */
  function identite() {
    var moi = D && D.etat() ? D.monMembre() : null;
    if (moi) return { prenom: moi.prenom, nom: moi.nom };
    var p = D && D.profil(), mail = (p && p.email) || (avecBase ? SB.email() : "");
    var morceaux = (mail || "").split("@")[0].split(/[._-]/).filter(Boolean);
    if (!morceaux.length || morceaux[0] === "demo") return { prenom: "", nom: "" };
    return { prenom: majuscule(morceaux[0].toLowerCase()), nom: morceaux[1] ? majuscule(morceaux[1].toLowerCase()) : "" };
  }

  function initiales(id) {
    var s = ((id.prenom || "").charAt(0) + (id.nom || "").charAt(0)).toUpperCase();
    return s || "?";
  }

  function dateDuJour() {
    var d = new Date();
    return majuscule(JOURS[d.getDay()]) + " " + d.getDate() + " " + C.MOIS[d.getMonth()] + " " + d.getFullYear();
  }

  /** Barre (accueil, retour), logo et mots du bureau, date, menu du compte. */
  function entete(hote) {
    var accueil = location.pathname.replace(/\/+$/, "/") === "/ab/";
    var barre = el("nav", { class: "ab-barre", "aria-label": "Navigation" }, [
      el("a", { class: "ab-bouton-carre", href: "/ab/", title: "Accueil", "aria-label": "Accueil",
                "aria-current": accueil ? "page" : null }, [
        svg("0 0 24 24", '<path class="ab-maison" d="M12 3.2 2.6 11.1a.9.9 0 0 0 1.2 1.4l.7-.6V20a1 1 0 0 0 1 1H10v-5.5h4V21h4.5a1 1 0 0 0 1-1v-8.1l.7.6a.9.9 0 0 0 1.2-1.4z"/>')
      ]),
      el("button", { type: "button", class: "ab-bouton-carre gris", title: "Retour", "aria-label": "Retour",
                     onclick: function () { if (history.length > 1) history.back(); else location.href = "/ab/"; } }, [
        svg("0 0 24 24", '<path class="ab-fleche" d="M19.5 12h-15M10.5 6l-6 6 6 6"/>')
      ])
    ]);

    var marque = el("a", { class: "ab-marque", href: "/ab/", "aria-label": "AB Ingénieurs — accueil" }, [
      svg("0 0 100 100", LOGO, "ab-logo"),
      el("span", { class: "ab-mots", "aria-hidden": "true" }, [
        el("b", { text: "Ingénieurs" }),
        el("span", { text: "Bâtir aujourd'hui" }),
        el("span", { text: "les espaces de demain" })
      ])
    ]);

    var id = identite();
    var nom = [id.prenom, id.nom].filter(Boolean).join(" ") || (avecBase ? SB.email() : "Mode local");
    var mail = avecBase ? SB.email() : "";
    var bouton = el("button", { type: "button", class: "ab-moi-bouton", "aria-haspopup": "true", "aria-expanded": "false" }, [
      el("span", { class: "ab-avatar", "aria-hidden": "true", text: initiales(id) }),
      el("span", { class: "ab-moi-nom", text: nom }),
      svg("0 0 14 14", '<path d="M2.5 5 7 9.5 11.5 5"/>', "ab-chevron")
    ]);
    bouton.setAttribute("aria-label", "Compte : " + nom);
    var menu = el("ul", { class: "ab-menu", role: "menu", hidden: true }, [
      mail ? el("li", { class: "ab-menu-mail", role: "presentation", text: mail }) : null,
      el("li", { role: "none" }, [el("a", { role: "menuitem", href: "/planif/", text: "Version classique de la planification" })]),
      el("li", { role: "none" }, [el("button", { type: "button", role: "menuitem", text: "Se déconnecter", onclick: deconnecte })])
    ]);
    function ouvre(oui) {
      menu.hidden = !oui;
      bouton.setAttribute("aria-expanded", String(oui));
      if (oui) { var premier = menu.querySelector("a, button"); if (premier) premier.focus(); }
    }
    bouton.addEventListener("click", function (e) { e.stopPropagation(); ouvre(menu.hidden); });
    document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) ouvre(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { ouvre(false); bouton.focus(); } });

    var date = el("div", { class: "ab-date", text: dateDuJour() });
    setInterval(function () { date.textContent = dateDuJour(); }, 60000);

    vide(hote);
    hote.appendChild(barre);
    hote.appendChild(el("header", { class: "ab-entete" }, [
      marque,
      el("div", { class: "ab-qui" }, [date, el("div", { class: "ab-moi" }, [bouton, menu])])
    ]));
    return id;
  }

  /* ------------------------------------------------------------ fraîcheur
     L'équipe travaille à plusieurs : revenir sur l'onglet après une minute
     ailleurs relit la base, sans rien dire, puis la page se redessine. */
  function surRetour(redessine) {
    var cache = 0;
    D.surRechargement(redessine);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { cache = Date.now(); return; }
      var long = cache && Date.now() - cache > 60000;
      cache = 0;
      if (long && D.recharge) D.recharge().catch(function () {});
    });
  }

  global.AB = {
    el: el, vide: vide, svg: svg, majuscule: majuscule,
    avecBase: avecBase, session: session, echec: echec, deconnecte: deconnecte,
    identite: identite, entete: entete, surRetour: surRetour, JOURS: JOURS
  };
})(window);
