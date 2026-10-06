/* Portail — l'accueil de la planification, version 2 (06.10.2026)
   ---------------------------------------------------------------------------
   L'accueil réutilise le moteur (calendrier.js, config.js, supabase.js,
   donnees.js, calculs.js) mais pas l'interface des autres pages (ui.js,
   planif.css) : il a la sienne (portail.css). Ce fichier porte :
     Portail.el, .vide         construction du DOM
     Portail.session()         renvoie à la connexion si personne n'est connecté
     Portail.echec(e)          erreur de chargement
     Portail.entete(hote)      barre (accueil, retour), logo de la marque, date, compte
     Portail.surRetour(f)      relit la base au retour sur l'onglet après une minute
   La marque (Donnees.marque : « ab » ou « str ») décide du logo et des couleurs.
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

  /** Un dessin SVG écrit en clair : Portail.svg("0 0 64 64", "<path …/>"). */
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
    SB.deconnexion().then(function () { location.replace("/planif/connexion/"); });
  }


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
  /** « Version du 6 octobre 2026 », d'après assets/version.js. */
  function versionPubliee() {
    var d = global.PLANIF_VERSION && C.dt(global.PLANIF_VERSION);
    return d ? "Version du " + d.getDate() + " " + C.MOIS[d.getMonth()] + " " + d.getFullYear() : "";
  }
  function pied() {
    var p = document.getElementById("pied"), v = versionPubliee();
    if (p) p.textContent = D.nomEspace() + (v ? " · " + v : "");
  }

  /* Marque de l'espace : posée sur <html>, retenue pour ce compte, icône de l'onglet. */
  var LOGO_STR = '<rect width="100" height="100" rx="16" fill="#6B5233"/><path d="M28 82V27h24v55M52 82V46h21v36M20 82h60" fill="none" stroke="#E9D6B0" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>';
  function appliqueMarque() {
    var m = D.marque(), r = document.documentElement;
    r.setAttribute("data-marque", m);
    try {
      var mail = avecBase && SB.connecte() ? SB.email() : "";
      if (mail) global.localStorage.setItem("planif.marque:" + mail, m);
      global.localStorage.setItem("planif.marque", m);
    } catch (e) {}
    var icone = document.querySelector("link[rel=icon]");
    if (icone) icone.href = m === "ab" ? "/planif/assets/logo-ab-marque.svg?v=1"
      : "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + LOGO_STR + "</svg>");
    return m;
  }

  function entete(hote) {
    var m = appliqueMarque();
    var accueil = location.pathname.replace(/\/+$/, "/") === "/planif/";
    var barre = el("nav", { class: "ab-barre", "aria-label": "Navigation" }, [
      el("a", { class: "ab-bouton-carre", href: "/planif/", title: "Accueil", "aria-label": "Accueil",
                "aria-current": accueil ? "page" : null }, [
        svg("0 0 24 24", '<path class="ab-maison" d="M12 3.2 2.6 11.1a.9.9 0 0 0 1.2 1.4l.7-.6V20a1 1 0 0 0 1 1H10v-5.5h4V21h4.5a1 1 0 0 0 1-1v-8.1l.7.6a.9.9 0 0 0 1.2-1.4z"/>')
      ]),
      el("button", { type: "button", class: "ab-bouton-carre gris", title: "Retour", "aria-label": "Retour",
                     onclick: function () { if (history.length > 1) history.back(); else location.href = "/planif/"; } }, [
        svg("0 0 24 24", '<path class="ab-fleche" d="M19.5 12h-15M10.5 6l-6 6 6 6"/>')
      ])
    ]);

    /* Le logo de la marque : celui du bureau tel quel (assets/logo-ab-horizontal.svg,
       relevé sur son fichier), ou STR Bim Tools (pavé et texte). */
    var marque = el("a", { class: "ab-marque", href: "/planif/", "aria-label": D.nomEspace() + " — accueil" }, [
      m === "ab"
        ? el("img", { class: "ab-logo", src: "/planif/assets/logo-ab-horizontal.svg?v=1", alt: "", width: "443", height: "150" })
        : el("span", { class: "marque-str ab-logo-str" }, [
            svg("0 0 100 100", LOGO_STR),
            el("span", { class: "marque-mots" }, [el("b", { text: "STR Bim Tools" }), el("span", { text: D.enDemo() ? "Espace démo" : "Planification" })])
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

    pied();
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

  global.Portail = {
    el: el, vide: vide, svg: svg, majuscule: majuscule,
    avecBase: avecBase, session: session, echec: echec, deconnecte: deconnecte,
    identite: identite, entete: entete, versionPubliee: versionPubliee, surRetour: surRetour, JOURS: JOURS
  };
})(window);
