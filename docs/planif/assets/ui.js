/* Briques d'interface communes aux pages de /planif/ :
   barre et navigation, modale, confirmation, messages, sauvegarde du fichier.
   Aucune bibliothèque : de petites fonctions qui construisent du DOM. */
(function (global) {
  "use strict";

  var D = global.Donnees, C = global.Cal;

  /* ------------------------------------------------------------- éléments */

  /** el("div", {class:"x", text:"…"}, [enfants]) */
  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "class") n.className = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
      else n.setAttribute(k, v === true ? "" : v);
    });
    (enfants || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function vide(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  /**
   * Bouton-icône d'une ligne de liste (icônes SVG de docs/planif/icons, style dans planif.css).
   * type : "modifier", "supprimer", "absence" ou "taches" ; titre : l'action, en bulle au survol ;
   * quoi : l'objet visé, précisé pour les lecteurs d'écran.
   */
  function boutonIcone(type, titre, quoi, action) {
    return el("button", {
      class: "ico ico-" + type, type: "button", title: titre,
      "aria-label": quoi ? titre + " « " + quoi + " »" : titre,
      onclick: action
    });
  }

  /** Même chose pour un lien qui mène à une autre page (les tâches d'une affaire, par exemple). */
  /* nouvelOnglet : pour une adresse qui sort de l'outil (une carte, par
     exemple) — le planning reste ouvert derrière, et noopener garde la page
     cible à distance de la nôtre. */
  function lienIcone(type, titre, quoi, href, nouvelOnglet) {
    return el("a", {
      class: "ico ico-" + type, href: href, title: titre,
      "aria-label": quoi ? titre + " « " + quoi + " »" : titre,
      target: nouvelOnglet ? "_blank" : null,
      rel: nouvelOnglet ? "noopener noreferrer" : null
    });
  }

  function teinte(n) { return "var(--t" + Math.min(8, Math.max(1, n || 1)) + ")"; }

  /* --------------------------------------------------------------- messages */

  var boiteToast = null, minuterie = null, dernierAnnonce = 0;
  /** Message bref. action facultative : { label, action } — un bouton, « Annuler » par exemple.
   *  Sans action, le message qui suit un enregistrement tout frais porte « Annuler » (voir annule). */
  function toast(message, action) {
    if (!boiteToast) { boiteToast = el("div", { class: "toast", role: "status" }); document.body.appendChild(boiteToast); }
    var D = global.Donnees, geste = !action && D && D.annulable ? D.annulable() : null;
    if (geste && geste.quand > dernierAnnonce && Date.now() - geste.quand < 2500) {
      dernierAnnonce = geste.quand;
      action = { label: "Annuler", action: annule };
    }
    vide(boiteToast);
    boiteToast.appendChild(document.createTextNode(message));
    if (action) {
      boiteToast.appendChild(el("button", {
        type: "button", class: "toast-action", text: action.label,
        onclick: function () { boiteToast.classList.remove("vu"); action.action(); }
      }));
    }
    boiteToast.classList.toggle("actif", !!action);
    boiteToast.classList.add("vu");
    clearTimeout(minuterie);
    // Avec un bouton, le temps de le trouver
    minuterie = setTimeout(function () { boiteToast.classList.remove("vu"); }, action ? 6000 : 3200);
  }

  /* --------------------------------------------------------------- annuler
     Le dernier enregistrement (tâche, affaire, absence, fiche d'annuaire) se
     défait par « Annuler » dans son message ou par Ctrl+Z (⌘Z), autant de fois
     qu'il y a de gestes dans la page. Dans un champ de saisie, Ctrl+Z reste
     celui du navigateur ; fenêtre ou palette ouverte, il ne fait rien. */
  function annule() {
    var D = global.Donnees;
    if (!D || !D.annule) return;
    D.annule().then(function (libelle) {
      if (!libelle) { toast("Rien à annuler."); return; }
      D.redessine();
      toast("Annulé : " + libelle + ".");
    }).catch(function (e) { toast(e.message); });
  }
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== "z") return;
    var cible = e.target;
    if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;
    if (document.querySelector(".modale.ouverte, .palette:not([hidden])")) return;
    if (document.body.classList.contains("glisse-en-cours")) return;
    var D = global.Donnees;
    if (!D || !D.annulable || !D.annulable()) return;
    e.preventDefault();
    annule();
  });

  /* ---------------------------------------------------------------- modale */

  var modale = null, boite = null, fermeEnCours = null, dernierFocus = null, boutonEntree = null;

  function prepareModale() {
    if (modale) return;
    modale = el("div", { class: "modale", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "modale-fond", onclick: function () { ferme(); } }),
      boite = el("div", { class: "modale-boite" })
    ]);
    document.body.appendChild(modale);
    document.addEventListener("keydown", function (e) {
      if (!modale.classList.contains("ouverte")) return;
      if (e.key === "Escape") ferme();
      // Entrée dans un champ vaut un clic sur le bouton désigné ; dans une zone
      // de texte (note), elle garde son rôle : aller à la ligne. Une touche
      // maintenue ne compte pas : l'Entrée qui a ouvert la fenêtre (recherche)
      // ne doit pas l'enregistrer en se répétant.
      else if (e.key === "Enter" && !e.repeat && boutonEntree && !e.isComposing &&
               /^(INPUT|SELECT)$/.test(e.target.tagName) && boite.contains(e.target)) {
        e.preventDefault();
        boutonEntree.click();
      }
    });
  }

  /**
   * ouvre({surtitre, titre, corps:Node, compacte, boutons:[{label, or, rouge, gauche, entree, action}]})
   * L'action peut renvoyer une promesse ; renvoyer false empêche la fermeture.
   * compacte : fenêtre resserrée (planif.css) ; entree : bouton déclenché par la touche Entrée.
   */
  function ouvre(o) {
    prepareModale();
    dernierFocus = document.activeElement;
    fermeEnCours = o.surFermeture || null;
    boutonEntree = null;
    boite.className = "modale-boite" + (o.compacte ? " compacte" : "");
    vide(boite);

    boite.appendChild(el("div", { class: "modale-tete" }, [
      el("div", {}, [
        o.surtitre ? el("div", { class: "surtitre", text: o.surtitre }) : null,
        el("h2", { text: o.titre || "" })
      ]),
      el("button", { class: "btn btn-nu btn-ico", type: "button", "aria-label": "Fermer", onclick: function () { ferme(); } }, ["✕"])
    ]));

    if (o.corps) boite.appendChild(o.corps);

    var pied = el("div", { class: "modale-pied" });
    (o.boutons || []).forEach(function (b) {
      if (!b) return;                         // bouton absent selon les droits
      var bouton = el("button", {
        class: "btn" + (b.or ? " btn-or" : "") + (b.rouge ? " btn-rouge" : "") + (b.gauche ? " gauche" : ""),
        type: "button",
        onclick: function () {
          var r = b.action ? b.action() : true;
          // Une action qui part sur le réseau peut durer : le bouton le montre
          // au lieu de rester muet, et un second clic ne la relance pas.
          var attente = !!(r && typeof r.then === "function");
          if (attente) occupe(bouton, true);
          Promise.resolve(r).then(function (v) {
            if (attente) occupe(bouton, false);
            if (v !== false) ferme();
          }).catch(function (e) {
            if (attente) occupe(bouton, false);
            toast(e && e.message ? e.message : "Opération impossible.");
          });
        }
      }, [b.label]);
      if (b.entree) boutonEntree = bouton;
      pied.appendChild(bouton);
    });
    if (pied.childNodes.length) boite.appendChild(pied);

    modale.classList.add("ouverte");
    document.documentElement.style.overflow = "hidden";
    setTimeout(function () {
      var premier = boite.querySelector("input,select,textarea,button:not(.btn-ico)");
      if (premier) premier.focus();
    }, 60);
    return boite;
  }

  /** Action en cours : le bouton cliqué l'annonce, les autres sont bloqués. */
  function occupe(bouton, actif) {
    if (bouton.parentNode) {
      [].forEach.call(bouton.parentNode.querySelectorAll(".btn"), function (n) { n.disabled = actif; });
    }
    bouton.classList.toggle("occupe", actif);
  }

  function ferme() {
    if (!modale) return;
    modale.classList.remove("ouverte");
    document.documentElement.style.overflow = "";
    if (fermeEnCours) { var f = fermeEnCours; fermeEnCours = null; f(); }
    if (dernierFocus && dernierFocus.focus) dernierFocus.focus();
  }

  /** Confirmation. Renvoie une promesse résolue à true / false. */
  function confirme(titre, message, libelle, rouge) {
    return new Promise(function (res) {
      var repondu = false;
      ouvre({
        titre: titre,
        corps: el("p", { text: message, style: "color:var(--texte-doux);font-size:15px;max-width:46em" }),
        surFermeture: function () { if (!repondu) res(false); },
        boutons: [
          { label: "Annuler", action: function () { repondu = true; res(false); } },
          { label: libelle || "Confirmer", or: !rouge, rouge: !!rouge, action: function () { repondu = true; res(true); } }
        ]
      });
    });
  }

  /* ------------------------------------------------------- champs de saisie */

  function champ(o) {
    var ctrl;
    if (o.type === "select") {
      ctrl = el("select", { name: o.nom, id: "c-" + o.nom });
      var option = function (op) {
        return el("option", { value: op.valeur, selected: String(op.valeur) === String(o.valeur) }, [op.label]);
      };
      // Une entrée { groupe, options } devient un sous-groupe titré de la liste
      (o.options || []).forEach(function (op) {
        if (!op.options) { ctrl.appendChild(option(op)); return; }
        var g = el("optgroup", { label: op.groupe });
        op.options.forEach(function (sub) { g.appendChild(option(sub)); });
        ctrl.appendChild(g);
      });
    } else if (o.type === "textarea") {
      ctrl = el("textarea", { name: o.nom, id: "c-" + o.nom, rows: o.rows || 3, placeholder: o.exemple || "" });
      ctrl.value = o.valeur == null ? "" : o.valeur;
    } else {
      ctrl = el("input", {
        type: o.type || "text", name: o.nom, id: "c-" + o.nom,
        placeholder: o.exemple || "", step: o.pas, min: o.min, max: o.max,
        inputmode: o.inputmode, autocomplete: o.autocomplete || "off"
      });
      ctrl.value = o.valeur == null ? "" : o.valeur;
    }
    return el("div", { class: "champ" + (o.large ? " large" : "") }, [
      el("label", { for: "c-" + o.nom, text: o.label }),
      ctrl,
      o.aide ? el("div", { class: "aide", text: o.aide }) : null
    ]);
  }

  /** Options d'une liste de membres, en sous-groupes par métier et par ordre alphabétique dans chacun. */
  function optionsParMetier(membres, libelle) {
    libelle = libelle || function (m) { return m.prenom + " " + m.nom; };
    return D.parMetier(membres).map(function (g) {
      return { groupe: g.titre, options: g.membres.map(function (m) { return { valeur: m.id, label: libelle(m) }; }) };
    });
  }

  /** Étiquettes des statuts d'un membre, dans l'ordre ; rien s'il n'en porte aucun.
   *  courts : intitulés abrégés, pour les listes denses. */
  function etiquettesStatuts(m, courts) {
    return D.statutsDe(m).map(function (s) {
      return el("span", { class: "etiq statut " + s, title: D.STATUTS[s] },
                [courts ? D.STATUTS_COURTS[s] : D.STATUTS[s]]);
    });
  }

  /** Cases à cocher multiples, rendues comme des étiquettes. */
  function cases(nom, items, coches) {
    var boite = el("div", { class: "cases" });
    if (!items.length) boite.appendChild(el("div", { class: "aide", text: "Aucun membre disponible." }));
    items.forEach(function (it) {
      var input = el("input", { type: "checkbox", value: it.valeur, name: nom });
      input.checked = coches.indexOf(it.valeur) >= 0;
      boite.appendChild(el("label", { class: "case" }, [input, it.label]));
    });
    return boite;
  }

  /** Relit un formulaire en objet simple. */
  function lit(formulaire) {
    var o = {};
    [].forEach.call(formulaire.querySelectorAll("input,select,textarea"), function (n) {
      if (!n.name) return;
      if (n.type === "checkbox") { (o[n.name] || (o[n.name] = [])); if (n.checked) o[n.name].push(n.value); }
      else o[n.name] = n.value;
    });
    return o;
  }

  /* ------------------------------------------------------------- session */

  var SB = global.Sb;
  var avecBase = !!(SB && SB.configure);

  /* Version 2 (06.10.2026) : <html data-version="v2"> — charte claire,
     habillage.css, barre du haut avec logo et compte, modules Communication,
     Secteurs et Inter-secteurs. La version classique (noir et or) est
     archivée (archives/planif-classique-2026-10-06.zip) ; son code reste ici
     tant qu'une page sans data-version l'appelle. */
  var VERSION_AB = document.documentElement.getAttribute("data-version") === "v2";
  /** Les liens de l'outil restent tels quels (les pages vivent toutes sous /planif/). */
  function chemin(p) { return p; }

  function pageConnexion(parametres) {
    location.replace("/planif/connexion/?" + parametres);
  }

  /* ----------------------------------------------------------- marque
     « ab » ou « str » (Donnees.marque) : posée sur <html data-marque>, retenue
     pour ce compte (le script en tête de page la reprend avant le premier
     rendu), et l'icône de l'onglet suit. */
  var ICONE_STR = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="#1F4E85"/><path d="M28 82V27h24v55M52 82V46h21v36M20 82h60" fill="none" stroke="#A9CCF2" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/></svg>');
  function appliqueMarque() {
    if (!VERSION_AB || !D.marque) return;
    var m = D.marque(), r = document.documentElement;
    r.setAttribute("data-marque", m);
    try {
      var mail = avecBase && SB.connecte() ? SB.email() : "";
      if (mail) global.localStorage.setItem("planif.marque:" + mail, m);
      global.localStorage.setItem("planif.marque", m);
    } catch (e) {}
    var icone = document.querySelector("link[rel=icon]");
    if (icone) icone.href = m === "ab" ? "/planif/assets/logo-ab-marque.svg?v=1" : ICONE_STR;
  }

  /**
   * À appeler en tête de chaque page : renvoie false et redirige vers la
   * connexion si la base est branchée et que personne n'est connecté.
   */
  function session() {
    if (!avecBase || SB.connecte()) return true;
    pageConnexion("retour=" + encodeURIComponent(location.pathname));
    return false;
  }

  /** Traitement unique des erreurs de chargement. */
  function echec(e) {
    var m = (e && e.message) || "Chargement impossible.";
    if (avecBase && /session|acc[eè]s refus/i.test(m)) {
      SB.deconnexion();
      pageConnexion("retour=" + encodeURIComponent(location.pathname) + "&motif=" + encodeURIComponent(m));
      return;
    }
    toast(m);
  }

  function deconnecte() {
    confirme("Se déconnecter ?", "Tu devras saisir ton mot de passe pour revenir.", "Se déconnecter")
      .then(function (ok) {
        if (!ok) return;
        // La présence s'efface avant que le jeton ne parte : sinon on resterait
        // « en ligne » pour l'équipe jusqu'à l'oubli, deux minutes et demie plus tard.
        arretePresence();
        bat({ quitter: true })
          .then(function () { return SB.deconnexion(); })
          .then(function () { pageConnexion(""); });
      });
  }

  /* ---------------------------------------------------------------- thème
     Trois choix : sombre (la charte d'origine), clair, ou celui du système.
     Le choix est mémorisé par utilisateur :
       - dans le navigateur, sous une clé propre à l'adresse connectée, pour
         être posé dès le premier rendu (script en tête de page) ;
       - dans le compte Supabase (métadonnées), pour suivre l'utilisateur sur
         un autre appareil. À l'ouverture, le compte fait foi. */

  var THEMES = [
    { v: "sombre", l: "Sombre" },
    { v: "clair", l: "Clair" },
    { v: "systeme", l: "Système" }
  ];

  /* Couleur de la barre du navigateur, sur téléphone : celle du fond de page
     de chaque thème. Le même tableau est repris par le script en tête de
     page, qui pose le thème avant le premier rendu. */
  var FOND_THEME = { clair: "#F3F0E8", sombre: "#050505" };
  var mediaClair = global.matchMedia ? global.matchMedia("(prefers-color-scheme: light)") : null;

  function cleTheme() { return "planif.theme:" + (avecBase && SB.connecte() ? SB.email() : ""); }

  /* Un ancien thème « ab », retiré le 02.10.2026 : qui l'avait choisi passe au clair. */
  function propre(t) { return t === "ab" ? "clair" : t; }

  function themeChoisi() {
    try { return propre(global.localStorage.getItem(cleTheme()) || global.localStorage.getItem("planif.theme") || "sombre"); }
    catch (e) { return "sombre"; }
  }

  function appliqueTheme(choix) {
    var effectif = choix === "systeme" ? (mediaClair && mediaClair.matches ? "clair" : "sombre") : choix;
    if (VERSION_AB) effectif = "clair";        // la version 2 a une seule charte, claire
    document.documentElement.setAttribute("data-theme", effectif);
    var meta = document.querySelector("meta[name=theme-color]");
    if (meta) meta.setAttribute("content", VERSION_AB ? "#F4F5F2" : FOND_THEME[effectif] || FOND_THEME.sombre);
    [].forEach.call(document.querySelectorAll("[data-choix-theme]"), function (b) {
      b.setAttribute("aria-checked", String(b.getAttribute("data-choix-theme") === choix));
    });
  }

  function memoriseTheme(choix) {
    try {
      global.localStorage.setItem(cleTheme(), choix);
      global.localStorage.setItem("planif.theme", choix);
    } catch (e) {}
  }

  function choisitTheme(choix) {
    memoriseTheme(choix);
    appliqueTheme(choix);
    if (avecBase && SB.connecte()) {
      SB.enregistrePreferences({ theme: choix }).catch(function () {
        toast("Thème appliqué sur cet appareil, mais pas enregistré sur ton compte.");
      });
    }
  }

  /** Le compte fait foi : un choix fait sur un autre appareil est repris ici. */
  function synchroniseTheme() {
    if (!avecBase || !SB.connecte()) return;
    SB.utilisateur().then(function (u) {
      var t = u && u.user_metadata && u.user_metadata.theme;
      if (t === "ab") { choisitTheme("clair"); return; }        // thème retiré : le compte est remis au clair
      if (t && t !== themeChoisi()) { memoriseTheme(t); appliqueTheme(t); }
    }).catch(function () {});
  }

  // « Système » suit le réglage de l'appareil en direct (passage jour / nuit)
  if (mediaClair) {
    var suitSysteme = function () { if (themeChoisi() === "systeme") appliqueTheme("systeme"); };
    if (mediaClair.addEventListener) mediaClair.addEventListener("change", suitSysteme);
    else if (mediaClair.addListener) mediaClair.addListener(suitSysteme);
  }
  appliqueTheme(themeChoisi());

  /**
   * Menu déroulant de la barre (thème, bureau) : ouverture au clic, fermeture
   * au clic ailleurs ou par Échap, flèches pour passer d'un choix à l'autre.
   * Renvoie ouvre(etat).
   */
  function deroulant(bouton, menu) {
    function ouvre(etat) {
      menu.hidden = !etat;
      bouton.setAttribute("aria-expanded", String(etat));
      if (etat) { var c = menu.querySelector("[aria-checked=true]") || menu.querySelector("button,a"); if (c) c.focus(); }
    }
    bouton.addEventListener("click", function (e) { e.stopPropagation(); ouvre(menu.hidden); });
    document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) ouvre(false); });
    document.addEventListener("keydown", function (e) {
      if (menu.hidden) return;
      if (e.key === "Escape") { ouvre(false); bouton.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var items = [].slice.call(menu.querySelectorAll("button,a")), n = items.length, i = items.indexOf(document.activeElement);
        var bas = e.key === "ArrowDown";
        items[i < 0 ? (bas ? 0 : n - 1) : (i + (bas ? 1 : n - 1)) % n].focus();
      }
    });
    return ouvre;
  }

  /** Bouton « Thème » et son menu, pour la ligne du haut. */
  function menuTheme() {
    var bouton = el("button", {
      type: "button", class: "theme-btn", "aria-haspopup": "menu", "aria-expanded": "false", title: "Thème d'affichage"
    }, [
      el("span", { class: "theme-ico", "aria-hidden": "true", text: "◐" }),
      el("span", { class: "theme-lib", text: "Thème" })
    ]);
    var menu = el("div", { class: "menu-theme", role: "menu", hidden: true });
    var ouvre = deroulant(bouton, menu);
    var actuel = themeChoisi();
    THEMES.forEach(function (t) {
      menu.appendChild(el("button", {
        type: "button", role: "menuitemradio", "data-choix-theme": t.v, "aria-checked": String(t.v === actuel),
        onclick: function () { choisitTheme(t.v); ouvre(false); bouton.focus(); }
      }, [el("span", { class: "coche", "aria-hidden": "true" }), t.l]));
    });
    return el("div", { class: "theme" }, [bouton, menu]);
  }

  /* ---------------------------------------------------------- bureau courant
     À la suite du fil d'Ariane. Chacun voit le nom de son bureau ; le super
     admin passe d'un bureau à l'autre par ce menu : la base retient son choix
     et toutes les pages s'y rapportent (voir choisit_bureau en base). */

  function bureauCourant(p) {
    if (!p || !p.multi || !p.bureau) return null;
    var etat = function (actif) { return actif ? null : el("span", { class: "bureau-etat", text: "suspendu" }); };

    if (!p.superAdmin) {
      return el("span", { class: "bureau" }, [
        el("span", { class: "sep", text: "·" }),
        el("span", { class: "bureau-nom", text: p.bureau.nom, title: p.bureau.nom })
      ]);
    }

    var bouton = el("button", {
      type: "button", class: "bureau-btn", "aria-haspopup": "menu", "aria-expanded": "false",
      title: "Changer de bureau", "aria-label": "Bureau affiché : " + p.bureau.nom + ". Changer de bureau"
    }, [
      el("span", { class: "bureau-nom", text: p.bureau.nom }),
      etat(p.bureau.actif),
      el("span", { class: "fleche", "aria-hidden": "true", text: "▾" })
    ]);
    var menu = el("div", { class: "menu-bureau", role: "menu", hidden: true });
    var ouvre = deroulant(bouton, menu);

    p.bureaux.forEach(function (b) {
      var ici = b.id === p.bureau.id;
      menu.appendChild(el("button", {
        type: "button", role: "menuitemradio", "aria-checked": String(ici),
        onclick: function () {
          ouvre(false);
          if (ici) return bouton.focus();
          toast("Ouverture du bureau « " + b.nom + " »…");
          SB.rpc("choisit_bureau", { p_bureau: b.id })
            .then(function () { location.reload(); })
            .catch(function (e) { toast(e.message); });
        }
      }, [el("span", { class: "coche", "aria-hidden": "true" }), el("span", { class: "lib", text: b.nom }), etat(b.actif)]));
    });
    menu.appendChild(el("a", { href: "/planif/console/", role: "menuitem", class: "vers-console" }, ["Gérer les bureaux et les accès"]));

    return el("span", { class: "bureau choix" }, [el("span", { class: "sep", text: "·" }), bouton, menu]);
  }

  /* ------------------------------------------------------ rafraîchissement
     L'outil lit la base au chargement de la page, et l'équipe y travaille à
     plusieurs : sans cela, une tâche confiée par un collègue n'apparaît qu'au
     prochain F5. Le bouton relit à la demande ; revenir sur l'onglet après une
     minute ailleurs relit aussi, sans rien dire — c'est le moment où l'on
     découvre le travail des autres. Une fenêtre ouverte suspend le rattrapage
     automatique : on ne redessine pas sous une saisie en cours. */

  var rafraichitEnCours = false, cacheDepuis = 0;
  var REPOS = 60000;                       // au-delà, l'onglet a eu le temps de vieillir

  function rafraichit(silencieux) {
    if (rafraichitEnCours || !D.recharge || !D.etat()) return Promise.resolve();
    rafraichitEnCours = true;
    var bouton = document.querySelector("[data-rafraichir]");
    if (bouton) bouton.disabled = true;
    return D.recharge().then(function () {
      if (!silencieux) toast("Données à jour.");
    }).catch(function (e) {
      if (!silencieux) echec(e);
    }).then(function () {
      rafraichitEnCours = false;
      if (bouton) bouton.disabled = false;
    });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { cacheDepuis = Date.now(); passeDerriere(); return; }
    var absent = cacheDepuis && Date.now() - cacheDepuis > REPOS;
    cacheDepuis = 0;
    /* Le compteur des personnes en ligne, lui, repart à chaque retour : on
       redevient visible pour les autres, et c'est justement ce qu'on regarde
       en revenant. Une fenêtre ouverte ne l'empêche pas — il ne redessine
       rien d'autre que lui-même. */
    suitPresence();
    if (absent && !document.querySelector(".modale.ouverte")) rafraichit(true);
  });

  /* ----------------------------------------------------- qui est en ligne
     Un compteur à gauche de l'adresse connectée : combien de personnes ont
     l'outil SOUS LES YEUX en ce moment, et lesquelles au survol. Un onglet
     passé derrière, un téléphone en veille ne comptent pas. Le bureau affiché
     fait la limite — on ne voit pas les collègues d'un autre bureau.

     Un onglet visible bat toutes les 45 secondes (une seule requête, qui
     inscrit son état et rapporte la liste). Dès qu'il passe derrière, il le
     dit — la requête survit à la page si c'est une fermeture — et se tait
     jusqu'à son retour. La base oublie un onglet muet depuis 100 secondes :
     c'est le filet pour un navigateur tué sans prévenir.

     Chaque onglet a son identifiant (sessionStorage : il suit l'onglet d'une
     page de l'outil à l'autre), et chaque message l'heure de l'onglet. En
     changeant de page, le « je passe derrière » de l'ancienne peut arriver
     après le « je suis là » de la nouvelle : la base l'ignore, il est plus vieux.

     Rien ne s'affiche en mode local. */

  var BATTEMENT = 45000;
  var enLigne = null, battement = null;

  var ONGLET = (function () {
    var id = null;
    try { id = sessionStorage.getItem("planif.onglet"); } catch (e) { id = null; }
    if (!id) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { sessionStorage.setItem("planif.onglet", id); } catch (e) { /* onglet anonyme : l'id vit le temps de la page */ }
    }
    return id;
  })();

  function suitPresence() {
    if (!avecBase || !SB.connecte() || battement || document.hidden) return;
    bat({ visible: true });
    battement = setInterval(function () { bat({ visible: true }); }, BATTEMENT);
  }

  function arretePresence() {
    if (battement) { clearInterval(battement); battement = null; }
  }

  function passeDerriere() {
    arretePresence();
    bat({ visible: false });
  }

  function bat(o) {
    if (!avecBase || !SB.connecte()) return Promise.resolve();
    return SB.presence({
      onglet: ONGLET, horloge: Date.now(), visible: o.visible, quitter: o.quitter
    }).then(function (liste) {
      if (o.visible && !o.quitter) enLigne = liste;
      dessineEnLigne();
    }).catch(function () {
      /* Réseau ou session : le dernier compte reste affiché, le prochain
         battement corrigera. Ce compteur ne mérite aucun message d'erreur. */
    });
  }

  /** L'emplacement du compteur, rempli (et vidé) par dessineEnLigne. */
  function placeEnLigne() {
    if (!avecBase || !SB.connecte()) return null;
    return el("div", { class: "en-ligne", dataset: { enLigne: "" }, hidden: true });
  }

  function dessineEnLigne() {
    var hote = document.querySelector("[data-en-ligne]");
    if (!hote) return;
    vide(hote);
    if (!enLigne || !enLigne.length) { hote.hidden = true; return; }
    hote.hidden = false;
    var n = enLigne.length;
    var phrase = n > 1 ? n + " personnes en ligne" : "1 personne en ligne";
    /* Pas de title : la bulle du navigateur viendrait doubler la nôtre. Le
       bouton n'agit pas, il se survole — et se touche, ce qui lui donne le
       focus : c'est ce qui ouvre la bulle sur un téléphone. */
    hote.appendChild(el("button", {
      class: "en-ligne-btn", type: "button",
      "aria-label": phrase, "aria-describedby": "qui-en-ligne"
    }, [
      el("span", { class: "puce", "aria-hidden": "true" }),
      el("b", { text: String(n) }),
      el("span", { class: "en-ligne-lib", text: "en ligne" })
    ]));
    hote.appendChild(el("div", { class: "bulle-en-ligne", role: "tooltip", id: "qui-en-ligne" }, [
      el("p", { class: "bulle-titre", text: phrase }),
      el("ul", {}, enLigne.map(function (q) {
        return el("li", { class: q.moi ? "moi" : null, text: q.nom + (q.moi ? " (toi)" : "") });
      }))
    ]));
  }

  /* --------------------------------------------------------- barre et menu */

  var PAGES = [
    { cle: "accueil", href: "/planif/", nom: "Accueil", court: "Accueil" },
    { cle: "tableau", href: "/planif/planning/", nom: "Tableau de bord", court: "Planning" },
    { cle: "charge", href: "/planif/charge/", nom: "Charge", court: "Charge" },
    { cle: "taches", href: "/planif/taches/", nom: "Tâches", court: "Tâches" },
    { cle: "affaires", href: "/planif/affaires/", nom: "Affaires", court: "Affaires" },
    { cle: "equipe", href: "/planif/equipe/", nom: "Équipe", court: "Équipe" },
    { cle: "absences", href: "/planif/absences/", nom: "Absences", court: "Absences" },
    { cle: "annuaire", href: "/planif/annuaire/", nom: "Annuaire", court: "Annuaire" }
  ];

  /* ------------------------------------------------- barre de la version 2
     Accueil et retour, logo de la marque ; à droite la recherche, qui est en
     ligne, le bureau (super admin) et le compte : nom, rafraîchir, données,
     déconnexion. */
  /* Le pavé du logo « ab », relevé sur le fichier du bureau (assets/logo-ab-marque.svg) ;
     celui de STR Bim Tools, le bâtiment au trait. */
  var LOGO_STR = '<rect width="100" height="100" rx="16" fill="#1F4E85"/><path d="M28 82V27h24v55M52 82V46h21v36M20 82h60" fill="none" stroke="#A9CCF2" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>';
  var LOGO_AB = '<rect x="6.62" y="1.97" width="1491.7" height="1038.93" fill="#CAE09B"/><rect x="6.62" y="1040.9" width="1491.7" height="379.3" fill="#87868B"/><path fill="#fff" fill-rule="evenodd" d="M379.04 733.3H491.52L730.2 1269.8H607.91L434.68 844.11L258.75 1269.8H163.42ZM800.1 733.3H1159.76A154.36 154.36 0 0 1 1263.61 1001.86A154.33 154.33 0 0 1 1159.16 1269.8H800.1ZM908 814.34H1125.27A74.64 74.64 0 0 1 1125.27 963.62H908ZM908 1040.45H1123.81A74.52 74.52 0 0 1 1123.81 1189.49H908Z"/>';
  var VUE_AB = "6.62 1.97 1491.7 1418.23";

  function dessinAB(vue, contenu, classe) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", vue); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    if (classe) s.setAttribute("class", classe);
    s.innerHTML = contenu;
    return s;
  }

  function marqueAB() {
    return el("div", { class: "ab-fil" }, [
      el("a", { class: "ab-carre", href: "/planif/", title: "Accueil", "aria-label": "Accueil" }, [
        dessinAB("0 0 24 24", '<path class="ab-maison" d="M12 3.2 2.6 11.1a.9.9 0 0 0 1.2 1.4l.7-.6V20a1 1 0 0 0 1 1H10v-5.5h4V21h4.5a1 1 0 0 0 1-1v-8.1l.7.6a.9.9 0 0 0 1.2-1.4z"/>')
      ]),
      el("button", { type: "button", class: "ab-carre gris", title: "Retour", "aria-label": "Retour",
        onclick: function () { if (history.length > 1) history.back(); else location.href = "/planif/"; } }, [
        dessinAB("0 0 24 24", '<path class="ab-fleche" d="M19.5 12h-15M10.5 6l-6 6 6 6"/>')
      ]),
      el("a", { class: "ab-marque-barre", href: "/planif/", "aria-label": D.nomEspace() + " — accueil", title: D.nomEspace() + " — accueil" }, [
        D.marque() === "ab" ? dessinAB(VUE_AB, LOGO_AB, "ab-logo-barre")
          : el("span", { class: "marque-str ab-logo-str" }, [
              dessinAB("0 0 100 100", LOGO_STR),
              el("span", { class: "marque-mots" }, [el("b", { text: "STR Bim Tools" }), el("span", { text: D.enDemo() ? "Espace démo" : "Planification" })])
            ])
      ])
    ]);
  }

  function compteAB(profil) {
    var moi = D.etat() ? D.monMembre() : null;
    var mail = avecBase ? SB.email() : "";
    var nom = moi ? moi.prenom + " " + moi.nom : (mail || (D.estDemo() ? "Démonstration" : "Données locales"));
    var init = moi ? (moi.prenom.charAt(0) + moi.nom.charAt(0)).toUpperCase() : (nom.charAt(0) || "?").toUpperCase();
    var bouton = el("button", { type: "button", class: "ab-compte-btn", "aria-haspopup": "menu", "aria-expanded": "false",
                                "aria-label": "Compte : " + nom }, [
      el("span", { class: "ab-avatar", "aria-hidden": "true", text: init }),
      el("span", { class: "ab-compte-nom", text: nom }),
      el("span", { class: "fleche", "aria-hidden": "true", text: "▾" })
    ]);
    var menu = el("div", { class: "menu-bureau ab-menu-compte", role: "menu", hidden: true }, [
      mail ? el("p", { class: "ab-menu-mail", text: mail }) : null,
      D.etat() ? el("button", { type: "button", role: "menuitem", dataset: { rafraichir: "" },
        onclick: function () { ouvre(false); rafraichit(false); } }, ["Rafraîchir les données"]) : null,
      D.etat() ? el("button", { type: "button", role: "menuitem", onclick: function () { ouvre(false); ouvreDonnees(); } }, ["Données (export, import)"]) : null,
      avecBase ? el("button", { type: "button", role: "menuitem", onclick: function () { ouvre(false); deconnecte(); } }, ["Se déconnecter"]) : null
    ]);
    var ouvre = deroulant(bouton, menu);
    return el("div", { class: "ab-compte" }, [bouton, menu]);
  }

  /**
   * Construit barre + navigation dans l'élément [data-chrome].
   * Ligne du haut : fil d'Ariane à gauche, « Données » et « Quitter » à droite.
   * Ligne du bas : les quatre sections, puis les actions de la page. Sur
   * téléphone, l'action principale (or) devient un bouton flottant à portée de pouce.
   */
  function chrome(actif, actions) {
    var hote = document.querySelector("[data-chrome]");
    if (!hote) return;
    vide(hote);

    // Profil connu une fois les données (ou le seul profil, pour la console) chargées
    var profil = D.profil ? D.profil() : null;
    var superAdmin = !!(profil && profil.multi && profil.superAdmin);
    var pages = PAGES.concat(superAdmin ? [{ cle: "console", href: "/planif/console/", nom: "Console", court: "Console" }] : []);
    if (VERSION_AB) {
      appliqueMarque();
      // Communication (rendez-vous, absences, vision du bureau) juste après l'accueil ;
      // Secteurs et Inter-secteurs après la carte de charge
      pages.splice(1, 0, { cle: "communication", href: "/planif/communication/", nom: "Communication", court: "Comm." });
      var iCharge = pages.map(function (p) { return p.cle; }).indexOf("charge");
      pages.splice(iCharge + 1, 0, { cle: "secteurs", href: "/planif/secteurs/", nom: "Secteurs", court: "Secteurs" },
                                   { cle: "inter", href: "/planif/inter-secteurs/", nom: "Inter-secteurs", court: "AO" });
    }

    var nav = el("nav", { class: "nav-outil", "aria-label": "Sections de l'outil" });
    pages.forEach(function (p) {
      nav.appendChild(el("a", { href: chemin(p.href), "aria-current": p.cle === actif ? "page" : null }, [
        el("span", { class: "long", text: p.nom }),
        el("span", { class: "court", text: p.court })
      ]));
    });
    var pousse = el("div", { class: "pousse outils" });
    // a.icone : classe d'une icône (planif.css) posée devant le libellé
    (actions || []).forEach(function (a) {
      pousse.appendChild(el("button", { class: "btn" + (a.or ? " btn-or" : ""), type: "button", onclick: a.action }, [
        a.icone ? el("span", { class: "ico-txt " + a.icone, "aria-hidden": "true" }) : null,
        a.label
      ]));
    });
    nav.appendChild(pousse);

    var etiquette = avecBase ? SB.email()
      : (D.estDemo() ? "Jeu de démonstration" : "Données locales");

    /* La palette (palette.js) : le bouton la fait connaître, Ctrl+K la fait
       aimer. Absent si le script n'est pas chargé. */
    var palette = global.Palette ? el("button", {
      type: "button", class: "btn-palette", onclick: function () { global.Palette.ouvre(); },
      "aria-label": "Chercher ou agir (" + global.Palette.touche + ")", title: "Chercher, aller, agir — ou écrire une tâche"
    }, [
      el("span", { class: "recherche-loupe", "aria-hidden": "true" }),
      el("span", { class: "btn-palette-lib", text: "Chercher" }),
      el("kbd", { text: global.Palette.touche })
    ]) : null;

    var outilsHaut = el("div", { class: "barre-outils" }, [
      palette,
      placeEnLigne(),
      el("span", { class: "maj", text: etiquette }),
      menuTheme(),
      // Pas de données du planning chargées (console) : ni à relire, ni à sauvegarder d'ici
      D.etat() ? el("button", {
        type: "button", dataset: { rafraichir: "" }, text: "Rafraîchir",
        title: "Relire la base : voir ce que l'équipe a changé depuis l'ouverture de la page",
        onclick: function () { rafraichit(false); }
      }) : null,
      D.etat() ? el("button", { type: "button", onclick: ouvreDonnees, text: "Données" }) : null,
      avecBase ? el("button", { type: "button", onclick: deconnecte, text: "Quitter" }) : null
    ]);

    if (VERSION_AB) {
      outilsHaut = el("div", { class: "barre-outils" }, [
        palette, placeEnLigne(), bureauCourant(profil), compteAB(profil)
      ]);
    }

    hote.appendChild(el("div", { class: "barre" }, [
      VERSION_AB ? el("div", { class: "barre-h" }, [marqueAB(), outilsHaut]) :
      el("div", { class: "barre-h" }, [
        el("div", { class: "fil" + (superAdmin ? " avec-choix" : "") }, [
          el("span", { class: "marque" }, [
            el("a", { href: "/", text: "STR Bim Tools" }),
            el("span", { class: "sep", text: "·" })
          ]),
          el("a", { href: "/planif/", class: "ici", text: "Planification" }),
          bureauCourant(profil)
        ]),
        outilsHaut
      ]),
      nav
    ]));

    /* Cinq sections ne tiennent pas dans la largeur d'un téléphone : la barre
       défile, et la page ouverte est amenée sous les yeux plutôt que laissée
       hors champ. */
    var courant = nav.querySelector("[aria-current]");
    if (courant && nav.scrollWidth > nav.clientWidth + 4) {
      nav.scrollLeft = Math.max(0, courant.offsetLeft - (nav.clientWidth - courant.offsetWidth) / 2);
    }

    synchroniseTheme();
    suitPresence();
    dessineEnLigne();                       // le compte déjà connu, sans attendre le battement

    var ancien = document.querySelector(".fab");
    if (ancien) ancien.remove();
    var principale = (actions || []).filter(function (a) { return a.or; })[0];
    if (principale) {
      document.body.appendChild(el("button", {
        class: "fab", type: "button", onclick: principale.action, "aria-label": principale.label
      }, [
        principale.icone ? el("span", { class: "ico-txt " + principale.icone, "aria-hidden": "true" }) : el("b", { text: "+", "aria-hidden": "true" }),
        principale.label.replace(/^(Nouvelle|Nouveau|Nouvel) /, "")
      ]));
      document.body.classList.add("avec-fab");
    }

    mesureChrome(hote);
  }

  /* Hauteur de la barre du haut, publiée en --h-chrome : les en-têtes qui se
     collent sous elle (les semaines et les jours du planning) en ont besoin, et
     elle change avec la largeur de la fenêtre — la navigation passe sur deux
     lignes, l'encoche d'un téléphone ajoute sa marge. */
  var suiviChrome = null, hauteurChrome = 0;
  function mesureChrome(hote) {
    function pose() {
      hauteurChrome = Math.round(hote.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--h-chrome", hauteurChrome + "px");
    }
    pose();
    if (suiviChrome) suiviChrome.disconnect();
    if (window.ResizeObserver) {
      suiviChrome = new ResizeObserver(pose);
      suiviChrome.observe(hote);
    } else {
      window.addEventListener("resize", pose);
    }
  }

  /**
   * Pose la classe « collee » sur un bloc collant dès qu'il a rejoint la barre
   * du haut, et la retire quand on remonte. Ce qui s'y accroche peut alors se
   * resserrer — les filtres de la page Tâches rendent une soixantaine de pixels
   * à la liste tant qu'on la parcourt.
   *
   * Une mesure par image de défilement au plus. Rien ne peut osciller : le haut
   * du bloc, collé, vaut la hauteur de la barre, et décollé il dépend de ce qui
   * le précède — jamais de sa propre hauteur.
   */
  function colleSousBarre(bloc) {
    if (!bloc) return;
    var attend = false;

    /* Hauteur publiée en --h-collee : ce qui se colle en dessous — l'en-tête du
       planning et celui du calendrier des absences — s'appuie dessus, et elle
       change quand le bloc se resserre. Sans bloc collant, la variable reste
       absente et le repli à 0 px de calc() rend l'ancien comportement. */
    var derniere = null;
    function mesure() {
      var h = Math.round(bloc.getBoundingClientRect().height);
      if (h === derniere) return;        // écrire sur documentElement invalide le
      derniere = h;                      // style de toute la page : une fois par
      document.documentElement.style.setProperty("--h-collee", h + "px");   // changement, pas par image
    }
    function juge() {
      attend = false;
      bloc.classList.toggle("collee", bloc.getBoundingClientRect().top <= hauteurChrome + 1);
      mesure();
    }
    function surDefilement() {
      if (attend) return;
      attend = true;
      requestAnimationFrame(juge);
    }
    window.addEventListener("scroll", surDefilement, { passive: true });
    window.addEventListener("resize", surDefilement);
    // Le resserrement dure 0,18 s : sans observateur, l'en-tête d'en dessous
    // garderait la hauteur d'avant le temps de la transition.
    if (window.ResizeObserver) new ResizeObserver(mesure).observe(bloc);
    juge();
  }

  /* ------------------------------------------------------------- recherche
     Une barre commune aux listes (tâches, affaires, équipe), filtrée à chaque
     caractère. Insensible à la casse et aux accents (« beton » trouve
     « Béton »), plusieurs mots se cumulent (« coffrage kevin »).
     Raccourcis : « / » pour chercher (Ctrl+K ouvre la palette de commandes), Échap pour effacer,
     Entrée pour ouvrir le résultat quand il n'en reste qu'un. */

  /** Forme de comparaison : minuscules, sans accents. */
  function plie(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  /** Les mots cherchés, déjà pliés. */
  function termes(q) { return plie(q).split(/\s+/).filter(Boolean); }

  /** Vrai si chaque mot se trouve dans au moins un des champs. */
  function correspond(champs, mots) {
    if (!mots.length) return true;
    return contient(foin(champs), mots);
  }

  /** Texte de recherche d'une ligne, déjà plié : à calculer une fois, pas à chaque frappe. */
  function foin(champs) { return plie(champs.filter(Boolean).join(" | ")); }
  function contient(foinPlie, mots) {
    for (var i = 0; i < mots.length; i++) if (foinPlie.indexOf(mots[i]) < 0) return false;
    return true;
  }

  /**
   * Liste longue affichée par paquets : les premières lignes tout de suite,
   * les suivantes quand on approche du bas. Taper une recherche ne reconstruit
   * donc que le premier paquet, quelle que soit la taille de la liste.
   * paquets({ elements, taille, ajoute(element), hote })
   */
  function paquets(o) {
    var rang = 0, taille = o.taille || 150, observateur = null;
    var bouton = el("button", { type: "button", class: "btn suite-liste" });
    var pied = el("div", { class: "suite-liste-pied" }, [bouton]);

    function suite() {
      var fin = Math.min(o.elements.length, rang + taille);
      for (; rang < fin; rang++) o.ajoute(o.elements[rang]);
      var reste = o.elements.length - rang;
      if (reste <= 0) {
        if (observateur) observateur.disconnect();
        if (pied.parentNode) pied.parentNode.removeChild(pied);
        return;
      }
      bouton.textContent = "Afficher " + Math.min(reste, taille) + " de plus · " + reste + " restantes";
    }

    bouton.addEventListener("click", suite);
    suite();
    if (rang < o.elements.length) {
      o.hote.appendChild(pied);
      if (global.IntersectionObserver) {
        observateur = new IntersectionObserver(function (entrees) {
          if (entrees.some(function (e) { return e.isIntersecting; })) suite();
        }, { rootMargin: "800px 0px" });
        observateur.observe(pied);
      }
    }
    return {
      fin: function () { if (observateur) observateur.disconnect(); },
      /* Tout afficher d'un coup. L'impression ne voit que ce qui est dans le
         document : sans ça, un export PDF s'arrêterait au premier paquet. */
      tout: function () { while (rang < o.elements.length) suite(); }
    };
  }

  /**
   * Texte avec les passages trouvés surlignés. La recherche se fait sur la
   * forme pliée ; une table de correspondance ramène les positions au texte
   * d'origine, pour surligner « Béton » quand on a tapé « beton ».
   */
  function surligne(texte, mots) {
    texte = String(texte == null ? "" : texte);
    var frag = document.createDocumentFragment();
    if (!mots || !mots.length || !texte) { frag.appendChild(document.createTextNode(texte)); return frag; }

    var plat = "", origine = [];
    for (var i = 0; i < texte.length; i++) {
      var p = plie(texte.charAt(i));
      for (var k = 0; k < p.length; k++) { plat += p.charAt(k); origine.push(i); }
    }
    var zones = [];
    mots.forEach(function (m) {
      var depart = 0, pos;
      while (m && (pos = plat.indexOf(m, depart)) >= 0) {
        zones.push([origine[pos], origine[pos + m.length - 1] + 1]);
        depart = pos + m.length;
      }
    });
    if (!zones.length) { frag.appendChild(document.createTextNode(texte)); return frag; }

    zones.sort(function (a, b) { return a[0] - b[0]; });
    var fusion = [zones[0]];
    zones.slice(1).forEach(function (z) {
      var der = fusion[fusion.length - 1];
      if (z[0] <= der[1]) der[1] = Math.max(der[1], z[1]); else fusion.push(z);
    });

    var curseur = 0;
    fusion.forEach(function (z) {
      if (z[0] > curseur) frag.appendChild(document.createTextNode(texte.slice(curseur, z[0])));
      frag.appendChild(el("mark", { class: "trouve", text: texte.slice(z[0], z[1]) }));
      curseur = z[1];
    });
    if (curseur < texte.length) frag.appendChild(document.createTextNode(texte.slice(curseur)));
    return frag;
  }

  /** Nombre qui défile jusqu'à sa nouvelle valeur. */
  function defileNombre(noeud, cible) {
    var depart = parseInt(noeud.textContent, 10);
    noeud._cible = cible;
    cancelAnimationFrame(noeud._anim);
    if (isNaN(depart) || depart === cible || document.hidden) { noeud.textContent = String(cible); return; }
    var t0 = null, duree = 260;
    // Filet de sécurité : si l'affichage est suspendu (onglet caché), la valeur finale est posée quand même
    setTimeout(function () {
      if (noeud._cible !== cible) return;
      cancelAnimationFrame(noeud._anim);          // une étape en retard ne doit pas réécrire la valeur finale
      noeud.textContent = String(cible);
    }, duree + 60);
    function pas(t) {
      if (t0 === null) t0 = t;
      var x = Math.min(1, (t - t0) / duree), e = 1 - Math.pow(1 - x, 3);
      noeud.textContent = String(Math.round(depart + (cible - depart) * e));
      if (x < 1) noeud._anim = requestAnimationFrame(pas);
    }
    noeud._anim = requestAnimationFrame(pas);
  }

  /**
   * Barre de recherche.
   * recherche({ hote, exemple, surSaisie(q), surEntree() })
   * Renvoie { valeur(), compte(n, total), termes() }.
   * La requête est reflétée dans l'adresse (?q=…) : une recherche se garde en favori.
   */
  function recherche(o) {
    var initiale = new URLSearchParams(location.search).get("q") || "";

    var champ = el("input", {
      type: "search", class: "recherche-champ", placeholder: o.exemple || "Rechercher…",
      autocomplete: "off", spellcheck: "false", "aria-label": o.exemple || "Rechercher", enterkeyhint: "search"
    });
    champ.value = initiale;

    var loupe = el("span", { class: "recherche-loupe", "aria-hidden": "true" });
    var nb = el("b", { text: "0" }), total = el("span", { text: "0" });
    var compteur = el("span", { class: "recherche-compte", "aria-live": "polite" }, [nb, " / ", total]);
    var effacer = el("button", { type: "button", class: "recherche-effacer", "aria-label": "Effacer la recherche", text: "Effacer" });
    var touche = el("span", { class: "recherche-touche", "aria-hidden": "true" }, [el("kbd", { text: "/" })]);

    var bloc = el("div", { class: "recherche", role: "search" }, [loupe, champ, touche, effacer, compteur]);
    vide(o.hote).appendChild(bloc);

    function etat() {
      var plein = champ.value.length > 0;
      bloc.classList.toggle("remplie", plein);
      var url = new URL(location.href);
      if (champ.value.trim()) url.searchParams.set("q", champ.value.trim()); else url.searchParams.delete("q");
      // Le fragment reste : la console s'en sert pour retenir la section ouverte,
      // et le réécrire sans lui la renvoyait à la première à chaque chargement.
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }

    champ.addEventListener("input", function () { etat(); o.surSaisie(champ.value); });
    champ.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (champ.value) { e.preventDefault(); champ.value = ""; etat(); o.surSaisie(""); }
        else champ.blur();
      } else if (e.key === "Enter" && o.surEntree) {
        e.preventDefault(); o.surEntree();
      }
    });
    effacer.addEventListener("click", function () { champ.value = ""; etat(); o.surSaisie(""); champ.focus(); });

    // « / » depuis n'importe où, sauf pendant une saisie ou avec une fenêtre ouverte.
    // Ctrl+K appartient à la palette de commandes (palette.js), qui cherche partout.
    document.addEventListener("keydown", function (e) {
      var cible = e.target, enSaisie = /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName) || cible.isContentEditable;
      var fenetre = document.querySelector(".modale.ouverte, .palette:not([hidden])");
      if (fenetre) return;
      if (e.key === "/" && !enSaisie) {
        e.preventDefault(); champ.focus(); champ.select();
      }
    });

    etat();
    return {
      valeur: function () { return champ.value; },
      termes: function () { return termes(champ.value); },
      compte: function (n, t) { defileNombre(nb, n); defileNombre(total, t); bloc.classList.toggle("aucun", !!champ.value.trim() && n === 0); }
    };
  }

  /**
   * Mémoire des lignes affichées, pour ne faire apparaître en fondu que
   * celles qui entrent dans les résultats : les autres ne clignotent pas.
   */
  function suiviApparitions() {
    var avant = null, maintenant = null, rang = 0;
    return {
      /** À appeler au début de chaque rendu de la liste. */
      debut: function () { avant = maintenant; maintenant = {}; rang = 0; },
      /** Pose le fondu sur une ligne nouvelle ; rien au premier rendu ni sur une ligne déjà là. */
      marque: function (noeud, id) {
        maintenant[id] = true;
        if (!avant || avant[id]) return noeud;
        noeud.classList.add("apparait");
        noeud.style.setProperty("--d", Math.min(rang++, 10) * 22 + "ms");
        return noeud;
      }
    };
  }

  /* ------------------------------------------ tableaux lisibles sur téléphone
     Sur petit écran, chaque ligne de tableau devient une fiche (planif.css).
     L'en-tête disparaît : chaque cellule reçoit donc le libellé de sa colonne,
     affiché devant sa valeur. Posé automatiquement sur tout tableau inséré. */

  // Seules les lignes pas encore étiquetées sont traitées : les listes longues
  // s'allongent par paquets, et les lignes déjà posées ne sont pas reparcourues.
  function etiquetteTableau(table) {
    var titres = table._titres || (table._titres = [].map.call(table.querySelectorAll("thead th"), function (th) { return th.textContent.trim(); }));
    if (!titres.length) return;
    [].forEach.call(table.querySelectorAll("tbody tr:not([data-etiq])"), function (tr) {
      tr.setAttribute("data-etiq", "");
      [].forEach.call(tr.children, function (td, i) {
        if (i > 0 && titres[i] && !td.classList.contains("actions")) td.setAttribute("data-l", titres[i]);
      });
    });
  }

  if (global.MutationObserver) {
    new MutationObserver(function () {
      [].forEach.call(document.querySelectorAll("table.liste"), etiquetteTableau);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /** « Version du 6 octobre 2026 », d'après assets/version.js. */
  function versionAB() {
    var d = global.PLANIF_VERSION && C.dt(global.PLANIF_VERSION);
    return d ? "Version du " + d.getDate() + " " + C.MOIS[d.getMonth()] + " " + d.getFullYear() : "";
  }

  function pied() {
    var hote = document.querySelector("[data-pied]");
    if (!hote) return;
    vide(hote);
    hote.appendChild(el("footer", { class: "pied-outil" }, [
      VERSION_AB && D.nomEspace ? el("a", { href: "/planif/", text: "← " + D.nomEspace() }) : el("a", { href: "/", text: "← str-bim-tools.com" }),
      el("div", { class: "droite" }, [
        VERSION_AB && versionAB() ? el("span", { text: versionAB() }) : null,
        el("span", { class: "maj", text: avecBase ? "Base hébergée en Europe (Francfort)" : "Données enregistrées dans ce navigateur" }),
        el("a", { href: "/mentions-legales/", text: "Mentions légales" })
      ])
    ]));
  }

  /* ------------------------------------------------- sauvegarde du fichier */

  function nomFichier() {
    var d = new Date();
    return "planification-" + d.getFullYear() + "-" +
      ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + ".json";
  }

  function telecharge(nom, contenu, type) {
    var blob = new Blob([contenu], { type: type || "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: nom });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  function ouvreDonnees() {
    var e = D.etat();
    var profil = D.profil ? D.profil() : null;
    var nomBureau = profil && profil.multi && profil.bureau ? profil.bureau.nom : "";
    var pourTous = nomBureau ? "pour tout le bureau « " + nomBureau + " »" : "pour toute l'équipe";
    // Avec plusieurs bureaux, effacer ou remplacer tout un bureau est réservé au super admin
    var toutGerer = D.peutToutGerer ? D.peutToutGerer() : true;
    var entree = el("input", { type: "file", accept: ".json,application/json", style: "display:none" });
    entree.addEventListener("change", function () {
      var f = entree.files && entree.files[0];
      if (!f) return;
      var lecteur = new FileReader();
      lecteur.onload = function () {
        var brut;
        try { brut = JSON.parse(lecteur.result); }
        catch (err) { return toast("Fichier illisible : ce n'est pas du JSON."); }
        if (!brut || typeof brut !== "object" || !("membres" in brut)) {
          return toast("Ce fichier ne ressemble pas à une sauvegarde de la planification.");
        }
        // Importer REMPLACE tout : sans confirmation, un vieux fichier ou un jeu
        // de démonstration effaçait d'un clic le planning réel de toute l'équipe.
        function compte(o) {
          return (o.membres || []).length + " membres, " + (o.affaires || []).length + " affaires, " +
                 (o.taches || []).length + " tâches, " + (o.contacts || []).length + " fiches";
        }
        confirme("Remplacer toutes les données ?",
          "Le contenu actuel (" + compte(D.etat()) + ") sera remplacé par celui du fichier « " + f.name + " » (" + compte(brut) + ")" +
          (avecBase ? ", dans la base, " + pourTous : "") +
          (brut.reglages && brut.reglages.demo ? ". Attention : ce fichier est un jeu de démonstration" : "") +
          ". Ce qui n'est pas dans le fichier sera supprimé définitivement : exporte d'abord une sauvegarde si besoin.",
          "Remplacer", true
        ).then(function (ok) {
          if (!ok) return;
          toast("Import en cours…");
          D.importe(brut).then(function () { toast("Sauvegarde restaurée."); location.reload(); })
            .catch(function (err) { toast(err.message); });
        });
      };
      lecteur.readAsText(f);
    });

    var corps = el("div", {}, [
      el("p", {
        class: "aide",
        style: "font-size:14px;line-height:1.6;color:var(--texte-doux);max-width:48em",
        text: avecBase && nomBureau
          ? "Les données du bureau « " + nomBureau + " » sont enregistrées dans la base du projet, hébergée à Francfort, " +
            "et te suivent d'un poste à l'autre. Seuls les utilisateurs de ce bureau peuvent les lire ou les modifier. " +
            "L'export reste utile comme sauvegarde à toi, hors ligne."
          : avecBase
          ? "Les données sont enregistrées dans la base du projet, hébergée à Francfort, et te suivent d'un poste à l'autre. " +
            "Seules les adresses inscrites dans la liste des accès peuvent les lire ou les modifier. " +
            "L'export reste utile comme sauvegarde à toi, hors ligne."
          : "Les données de planification sont pour l'instant enregistrées dans ce navigateur, sur cet ordinateur. " +
            "Elles ne sont ni envoyées ni partagées. Vider les données du site, changer de machine ou " +
            "naviguer en privé revient donc à repartir de zéro : exporte régulièrement une sauvegarde."
      }),
      el("div", { class: "cles", style: "margin-top:22px" }, [
        el("div", { class: "cle" }, [el("div", { class: "v", text: String(e.membres.length) }), el("div", { class: "l", text: "Membres" })]),
        el("div", { class: "cle" }, [el("div", { class: "v", text: String(e.affaires.length) }), el("div", { class: "l", text: "Affaires" })]),
        el("div", { class: "cle" }, [el("div", { class: "v", text: String(e.taches.length) }), el("div", { class: "l", text: "Tâches" })]),
        // L'annuaire part dans la sauvegarde comme le reste : il se compte ici aussi
        el("div", { class: "cle" }, [el("div", { class: "v", text: String((e.contacts || []).length) }), el("div", { class: "l", text: "Fiches" })])
      ]),
      el("div", { class: "grille-champs", style: "margin-top:26px" }, [
        champ({
          nom: "canton", label: "Jours fériés", type: "select", valeur: e.reglages.canton,
          aide: "Sert à calculer les jours ouvrables. Indicatif : ce qui manque se rattrape par une absence.",
          options: C.CANTONS.map(function (c) { return { valeur: c.code, label: c.nom }; })
        }),
        champ({
          nom: "capaciteDefaut", label: "Capacité par défaut (j/sem.)", type: "number",
          pas: "0.5", min: "0.5", max: "7", valeur: e.reglages.capaciteDefaut,
          aide: "Proposée à la création d'un membre."
        })
      ])
    ]);

    ouvre({
      surtitre: "Sauvegarde et réglages",
      titre: "Données",
      corps: corps,
      boutons: [
        toutGerer ? {
          label: "Tout effacer", rouge: true, gauche: true, action: function () {
            return confirme("Tout effacer ?",
              "Membres, affaires, tâches et fiches de l'annuaire seront supprimés " + (avecBase ? "de la base, " + pourTous : "de ce navigateur") +
              ". Cette action est définitive : exporte d'abord une sauvegarde si tu veux pouvoir revenir en arrière.",
              "Effacer définitivement", true).then(function (ok) {
                if (!ok) return false;
                // La fenêtre de confirmation s'est refermée : sans ce mot,
                // l'écran resterait muet pendant l'aller-retour avec la base.
                toast("Effacement en cours…");
                return D.videTout().then(function () { location.reload(); });
              });
          }
        } : null,
        toutGerer ? { label: "Importer", action: function () { entree.click(); return false; } } : null,
        {
          label: "Exporter", action: function () {
            telecharge(nomFichier(), JSON.stringify(D.exporte(), null, 2));
            toast("Sauvegarde exportée.");
            return false;
          }
        },
        {
          label: "Enregistrer", or: true, action: function () {
            var v = lit(corps);
            return D.majReglages({ canton: v.canton, capaciteDefaut: v.capaciteDefaut })
              .then(function () { toast("Réglages enregistrés."); location.reload(); });
          }
        }
      ]
    });
  }

  /* ---------------------------------------------------------- absences
     Une seule fenêtre pour les absences, partagée par la page Équipe et le
     calendrier : la liste des périodes d'un membre, et dessous un formulaire
     qui sert aussi bien à ajouter qu'à modifier la période choisie. */

  /** absences(idMembre, surChangement) — surChangement() suit chaque écriture. */
  function absences(idMembre, surChangement) {
    var m = D.membre(idMembre);
    if (!m) return toast("Membre introuvable.");
    var previent = surChangement || function () {};
    /* Sans le droit, les absences d'un collègue se consultent mais ne se
       touchent pas. La base refuserait de toute façon : autant ne pas
       proposer les boutons. */
    var peutEcrire = D.peutAbsences(idMembre);

    var liste = el("div", { style: "margin-bottom:26px" });
    var champs = el("div", { class: "grille-champs" });
    var libelleForm = el("span", {});
    var annuler = el("button", {
      class: "btn btn-nu", type: "button", text: "Annuler la modification", hidden: true,
      onclick: function () { edite(null); }
    });
    var enCours = null;                       // période en cours de modification, sinon ajout
    var valider = null;                       // bouton principal, relu après ouverture

    function edite(a) {
      enCours = a;
      vide(champs);
      champs.appendChild(champ({ nom: "debut", label: "Du", type: "date", valeur: a ? a.debut : "" }));
      champs.appendChild(champ({ nom: "fin", label: "Au", type: "date", valeur: a ? a.fin : "", aide: "Laisser vide pour un seul jour." }));
      champs.appendChild(champ({ nom: "motif", label: "Motif", valeur: a ? a.motif : "Vacances", exemple: "Vacances, service, formation…" }));
      libelleForm.textContent = a ? "Modifier la période" : "Ajouter une période";
      annuler.hidden = !a;
      if (valider) valider.textContent = a ? "Enregistrer" : "Ajouter";
      rend();
    }

    function rend() {
      vide(liste);
      if (!m.absences.length) {
        liste.appendChild(el("div", { class: "vide", style: "padding:22px 0", text: "Aucune absence enregistrée" }));
        return;
      }
      var corps = el("tbody");
      m.absences.forEach(function (a) {
        var n = Calc.joursTravaillesEntre(m, a.debut, a.fin, D.canton());
        corps.appendChild(el("tr", { class: enCours && enCours.id === a.id ? "en-edition" : "" }, [
          el("td", {}, [
            el("div", { class: "principal", text: a.motif }),
            el("div", { class: "secondaire", text: C.fmtCH(a.debut) + " → " + C.fmtCH(a.fin) })
          ]),
          el("td", { class: "num", text: C.fmtJours(n) + (n > 1 ? " jours ouvrés" : " jour ouvré") }),
          el("td", { class: "actions" }, [
            peutEcrire ? boutonIcone("modifier", "Modifier", a.motif, function () { edite(a); }) : null,
            peutEcrire ? boutonIcone("supprimer", "Retirer", a.motif, function () {
              D.suppAbsence(m.id, a.id).then(function () {
                if (enCours && enCours.id === a.id) edite(null); else rend();
                previent();
                toast("Absence retirée.");
              }).catch(function (e) { toast(e.message); });
            }) : null
          ])
        ]));
      });
      liste.appendChild(el("table", { class: "liste", style: "min-width:0" }, [corps]));
    }

    var corps = el("div", {}, [
      el("p", { class: "aide", style: "margin-bottom:20px;font-size:14px;color:var(--texte-doux)", text: peutEcrire
        ? "Les jours d'absence sortent de la capacité disponible, apparaissent hachurés au tableau de bord et en barre au calendrier des absences."
        : "Les absences de " + m.prenom + " se consultent ici. Seuls " + m.prenom + " et les personnes qui en ont reçu le droit peuvent les modifier." }),
      liste,
      peutEcrire ? el("div", { class: "legende", style: "display:flex;align-items:baseline;gap:12px;margin-bottom:10px" }, [libelleForm, annuler]) : null,
      peutEcrire ? champs : null
    ]);

    var boite = ouvre({
      surtitre: "Absences",
      titre: m.prenom + " " + m.nom,
      corps: corps,
      boutons: peutEcrire ? [
        { label: "Fermer" },
        {
          label: "Ajouter", or: true, action: function () {
            var v = lit(champs);
            var p = enCours ? D.majAbsence(m.id, enCours.id, v) : D.ajouteAbsence(m.id, v);
            return p.then(function () {
              toast(enCours ? "Absence modifiée." : "Absence enregistrée.");
              edite(null);
              previent();
              return false;                   // la fenêtre reste ouverte : on enchaîne les périodes
            }).catch(function (e) { toast(e.message); return false; });
          }
        }
      ] : [{ label: "Fermer" }]
    });
    valider = boite.querySelector(".modale-pied .btn-or");
    edite(null);
  }

  /** Nouvelle absence sans passer par la fiche d'un membre : le membre se choisit dans la fenêtre. */
  /**
   * Sélecteur de la semaine type : un bouton par jour, du lundi au vendredi,
   * qui passe de plein à demi-journée, puis à non travaillé. Au moins un jour
   * reste travaillé. Commun à la fenêtre « Jours travaillés » et à la console.
   * { noeud, valeur() } ; valeur() : cinq poids.
   */
  function choixJours(jours, surChange, lectureSeule) {
    var j = (D.reprisJours(jours) || [1, 1, 1, 1, 1]).slice();
    var ETATS = { 1: ["", "plein", "jour plein"], 0.5: ["demi", "½ j", "demi-journée"], 0: ["off", "—", "non travaillé"] };
    var rangee = el("div", { class: "semaine", role: "group", "aria-label": "Jours travaillés" });
    D.JOURS_COURTS.forEach(function (court, i) {
      var etiquette = el("small");
      var b = el("button", { type: "button", disabled: !!lectureSeule,
        title: lectureSeule ? null : "Cliquer : plein → demi-journée → non travaillé" }, [court, etiquette]);
      function peint() {
        var e = ETATS[j[i]];
        b.className = e[0];
        etiquette.textContent = e[1];
        b.setAttribute("aria-label", D.JOURS_SEMAINE[i] + " : " + e[2]);
      }
      peint();
      b.addEventListener("click", function () {
        j[i] = j[i] === 1 ? 0.5 : j[i] > 0 ? 0 : 1;
        if (!j.some(function (x) { return x > 0; })) j[i] = 1;          // au moins un jour
        peint();
        if (surChange) surChange(j.slice());
      });
      rangee.appendChild(b);
    });
    return { noeud: rangee, valeur: function () { return j.slice(); } };
  }

  /**
   * Fenêtre « Jours travaillés » d'un membre : sa semaine type, et la capacité
   * qui en découle. Chacun règle les siens ; ceux d'un collègue demandent le
   * droit de poser ses absences. Sinon, lecture seule.
   */
  function joursTravailles(idMembre, surChangement) {
    var m = idMembre ? D.membre(idMembre) : D.monMembre();
    if (!m) {
      return toast(idMembre ? "Membre introuvable."
        : "Aucune fiche d'équipe n'est rattachée à ton adresse : demande à l'administrateur de l'outil.");
    }
    var previent = surChangement || function () {};
    var moi = D.monMembre();
    var soi = !!(moi && moi.id === m.id);
    var peut = D.peutJours(m.id);

    var capacite = el("b", { class: "num" });
    var detail = el("span", {});
    function montre(jours) {
      var cap = D.capaciteApres(m, jours);
      capacite.textContent = C.fmtJours(cap) + " j par semaine";
      detail.textContent = " — " + D.detailJours({ jours: jours }).replace(/^./, function (c) { return c.toLowerCase(); });
    }
    var choix = choixJours(m.jours, montre, !peut);
    montre(choix.valeur());

    var corps = el("div", {}, [
      el("div", { class: "champ" }, [el("label", { text: "Semaine type" }), choix.noeud]),
      el("p", { class: "aide", style: "margin:14px 0 0;font-size:13px;color:var(--texte-doux);line-height:1.5" }, [
        "Capacité : ", capacite, detail
      ]),
      el("p", { class: "aide", style: "margin:8px 0 0;font-size:12.5px;color:var(--texte-faible);line-height:1.5",
        text: !peut
          ? "Seuls " + m.prenom + " et les personnes qui posent les absences des autres règlent ces jours."
          : "Un clic par jour : plein, demi-journée, puis non travaillé. Aucune tâche ne se pose un jour non travaillé. Un changement de taux d'activité passe par l'administrateur de l'outil."
      })
    ]);

    ouvre({
      surtitre: "Jours travaillés",
      titre: soi ? "Tes jours" : m.prenom + " " + m.nom,
      corps: corps,
      compacte: true,
      boutons: peut ? [
        { label: "Annuler" },
        {
          label: "Enregistrer", or: true, entree: true, action: function () {
            return D.regleJours(m.id, choix.valeur()).then(function (apres) {
              toast((soi ? "Tes jours sont enregistrés" : "Jours de " + m.prenom + " enregistrés") +
                " : " + C.fmtJours(apres.capacite) + " j par semaine.");
              previent();
            }).catch(function (e) { toast(e.message); return false; });
          }
        }
      ] : [{ label: "Fermer", or: true }]
    });
  }

  function nouvelleAbsence(o) {
    o = o || {};
    var previent = o.surChangement || function () {};
    /* Sans le droit de poser les absences des autres, la liste se réduit à
       soi : on ne pose pas les vacances d'un collègue. */
    var membres = D.membres({});
    if (!D.aDroit("absences_autrui")) {
      var moi = D.monMembre();
      if (!moi) return toast("Aucune fiche d'équipe n'est rattachée à ton adresse : demande à l'administrateur de l'outil.");
      membres = [moi];
    }
    if (!membres.length) return toast("Aucun membre à l'effectif : commence par l'équipe.");

    var groupes = optionsParMetier(membres);
    var corps = el("div", { class: "grille-champs" }, [
      champ({
        nom: "membre", label: "Membre", type: "select", large: true,
        valeur: o.membreId || groupes[0].options[0].valeur, options: groupes
      }),
      champ({ nom: "debut", label: "Du", type: "date", valeur: o.debut || "" }),
      champ({ nom: "fin", label: "Au", type: "date", valeur: o.fin || "", aide: "Laisser vide pour un seul jour." }),
      champ({ nom: "motif", label: "Motif", valeur: "Vacances", exemple: "Vacances, service, formation…" })
    ]);

    ouvre({
      surtitre: "Nouvelle absence",
      titre: "Période d'absence",
      corps: corps,
      boutons: [
        { label: "Annuler" },
        {
          label: "Enregistrer", or: true, action: function () {
            var v = lit(corps);
            return D.ajouteAbsence(v.membre, v).then(function () {
              toast("Absence enregistrée.");
              previent();
            }).catch(function (e) { toast(e.message); return false; });
          }
        }
      ]
    });
  }

  /* ---------------------------------------------------------------- tâche
     Formulaire complet d'une tâche, commun à la page Tâches et au tableau de
     bord : il s'ouvre sur place, sans changer de page. */

  function selMembres(nom, role, valeur, affaireId) {
    var sel = el("select", { name: nom, id: "c-" + nom });
    sel.appendChild(el("option", { value: "" }, ["— À affecter —"]));

    var aff = affaireId ? D.affaire(affaireId) : null;
    var idsEquipe = aff ? (role === "ingenieur" ? aff.ingenieurs : aff.dessinateurs) : [];
    // Un inactif qui porte déjà la tâche reste proposé : absent de la liste, la
    // tâche ne pouvait plus être enregistrée sans lui choisir un remplaçant.
    var tous = D.membres({ cote: role, tous: true }).filter(function (m) { return m.actif || m.id === valeur; });
    var equipe = tous.filter(function (m) { return idsEquipe.indexOf(m.id) >= 0; });
    var autres = tous.filter(function (m) { return idsEquipe.indexOf(m.id) < 0; });

    function groupe(label, liste) {
      if (!liste.length) return;
      var g = el("optgroup", { label: label });
      liste.forEach(function (m) {
        g.appendChild(el("option", { value: m.id, selected: m.id === valeur }, [m.prenom + " " + m.nom + (D.aStatut(m, "administrateur") ? " · administrateur" : "") + (m.actif ? "" : " (inactif)")]));
      });
      sel.appendChild(g);
    }
    groupe("Équipe de l'affaire", equipe);
    groupe(equipe.length ? "Autres" : "Équipe", autres);
    sel.value = valeur || "";
    return sel;
  }

  /* ------------------------------------------------------- fiche rapide */

  /**
   * Décale l'échéance de `jours` jours ; le début se recalcule. Une échéance
   * posée sur un jour chômé glisse au prochain jour ouvré, dans le sens du
   * déplacement. `apres` : à rappeler pour redessiner la page.
   */
  function decaleTache(id, jours, apres) {
    var t = D.tache(id);
    if (!t) return Promise.resolve();
    var canton = D.canton(), ech = C.ajoute(t.echeance, jours), pas = jours > 0 ? 1 : -1, garde = 0;
    while (C.chome(ech, canton) && garde++ < 30) ech = C.ajoute(ech, pas);
    var delta = C.diff(t.echeance, ech);
    if (!delta) return Promise.resolve();
    return D.retoucheTache(id, { echeance: ech, debut: null }).then(function () {
      if (apres) apres();
      toast("Tâche décalée de " + (delta > 0 ? "+" : "") + delta + " j.");
    }).catch(function (e) { toast(e.message); });
  }

  /**
   * ficheTache(idTache, o) — fiche rapide : la version légère du formulaire.
   * Ce qui se règle au vol (statut, avancement, affectation, part terminée,
   * échéance décalée d'un ou sept jours), sans ouvrir le formulaire complet,
   * qui reste à un bouton de là.
   *
   * o.role, o.charge : la barre cliquée au tableau de bord, donc un seul métier
   *   — « Terminé » n'y ferme que cette part. Sans rôle (une ligne de la liste
   *   des tâches), la fiche mène la tâche entière : une affectation et une case
   *   par part chargée.
   * o.surEnregistrement : appelée après chaque écriture, pour redessiner la page.
   */
  function ficheTache(idTache, o) {
    o = o || {};
    var Calc = global.Calc;
    var t = D.tache(idTache);
    if (!t) return;
    var a = D.affaire(t.affaireId), canton = D.canton();
    var lectureSeule = !D.peutEcrireTache(t);

    // Les parts que cette fiche mène : celle de la barre cliquée, sinon toutes celles qui portent une charge
    var roles = ["ingenieur", "dessinateur"].filter(function (r) {
      return o.role ? o.role === r : t[D.PARTS[r].charge] > 0;
    });
    // Les autres gardent leur état — et tant qu'une reste ouverte, la tâche ne peut pas être terminée
    var horsFiche = ["ingenieur", "dessinateur"].filter(function (r) {
      return roles.indexOf(r) < 0 && t[D.PARTS[r].charge] > 0;
    });
    function autreOuverte() {
      return horsFiche.some(function (r) { return !t[D.PARTS[r].fini]; });
    }

    // Tâche enchaînée : le calcul a sa propre fin, la veille du début du dessin
    function periode(charge, idMembre, role) {
      var fin = Calc.finPart(t, role, canton);
      var d = Calc.debutPour(charge, fin, idMembre ? D.membre(idMembre) : null, canton);
      return "  ·  " + C.fmtCH(d) + " → " + C.fmtCH(fin);
    }

    function ligne(cle, valeur) {
      return el("div", { style: "display:flex;flex-wrap:wrap;gap:2px 16px;padding:9px 0;border-bottom:1px solid var(--ligne-faible)" }, [
        el("span", { style: "font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--texte-faible);min-width:120px;padding-top:3px", text: cle }),
        el("span", { style: "font-size:14.5px", text: valeur })
      ]);
    }

    var statut = el("select", { name: "statut" });
    Object.keys(D.STATUTS_TACHE).forEach(function (k) {
      statut.appendChild(el("option", { value: k, selected: k === t.statut }, [D.STATUTS_TACHE[k]]));
    });
    var avancement = el("input", { type: "number", name: "avancement", min: "0", max: "100", step: "5", inputmode: "numeric" });
    avancement.value = t.avancement;

    /* Une case par part menée ici : le calcul bouclé libère l'ingénieur sans
       retirer le dessin du planning. La tâche ne passe « Terminé » qu'une fois
       toutes ses parts fermées. */
    var coches = roles.map(function (r) {
      var p = D.PARTS[r];
      var input = el("input", { type: "checkbox", name: "fini", value: p.fini });
      input.checked = t[p.fini] === true;
      return { role: r, part: p, input: input, etiquette: el("label", { class: "case" }, [input, p.label + " terminé"]) };
    });
    function toutesCochees() {
      return coches.length > 0 && coches.every(function (c) { return c.input.checked; });
    }
    function cocheToutes(v) { coches.forEach(function (c) { c.input.checked = v; }); }

    coches.forEach(function (c) {
      c.input.addEventListener("change", function () {
        if (toutesCochees() && !autreOuverte()) statut.value = "termine";
        else if (statut.value === "termine") statut.value = "en_cours";
      });
    });
    statut.addEventListener("change", function () {
      if (statut.value === "termine") {
        cocheToutes(true);
        // Une part menée ailleurs reste ouverte : la tâche ne se clôt qu'avec elle
        if (autreOuverte()) statut.value = "en_cours";
      } else if (toutesCochees() && !autreOuverte()) cocheToutes(false);
    });

    // Réaffectation sans glisser-déposer : indispensable au doigt, pratique à la souris
    var confies = roles.map(function (r) {
      var p = D.PARTS[r];
      var sel = el("select", { name: p.membre }, [el("option", { value: "" }, ["— À affecter —"])]);
      D.membres({ cote: r, tous: true }).forEach(function (m) {
        if (!m.actif && m.id !== t[p.membre]) return;   // un inactif n'apparaît que s'il porte déjà la tâche
        sel.appendChild(el("option", { value: m.id, selected: m.id === t[p.membre] },
          [m.prenom + " " + m.nom + (D.aStatut(m, "administrateur") ? " · administrateur" : "") + (m.actif ? "" : " (inactif)")]));
      });
      sel.value = t[p.membre] || "";
      return { role: r, part: p, select: sel };
    });

    function decaleBouton(libelle, jours) {
      return el("button", {
        class: "btn", type: "button", text: libelle, style: "justify-content:center",
        onclick: function () { ferme(); decaleTache(t.id, jours, o.surEnregistrement); }
      });
    }

    var champs = [
      el("div", { class: "champ" }, [el("label", { text: "Statut" }), statut]),
      el("div", { class: "champ" }, [el("label", { text: "Avancement (%)" }), avancement])
    ].concat(confies.map(function (c) {
      return el("div", { class: "champ" }, [
        el("label", { text: (c.role === "ingenieur" ? "Ingénieur" : "Dessinateur") + " affecté" }), c.select
      ]);
    }));
    if (coches.length) {
      champs.push(el("div", { class: "champ" + (coches.length > 1 ? " large" : "") }, [
        el("span", { class: "legende", text: o.role ? "Cette part" : coches.length > 1 ? "Parts terminées" : "Part terminée" }),
        el("div", { class: "cases" }, coches.map(function (c) { return c.etiquette; })),
        horsFiche.length
          ? el("div", { class: "aide", text: "Ne ferme que " + D.PARTS[roles[0]].label.toLowerCase() + " ; la tâche se termine avec " + D.PARTS[horsFiche[0]].label.toLowerCase() + "." })
          : null
      ]));
    }

    /* La note se rédige ici. C'est souvent le vrai message de la tâche — « en
       attente des éléments de Kevin » —, et il changera plus souvent que la
       charge ou l'affaire : l'écrire ne doit pas demander le formulaire complet.
       Entrée y va à la ligne au lieu d'enregistrer (voir la modale). */
    var boiteNote = champ({
      nom: "note", label: "Note", type: "textarea", rows: 2, large: true,
      valeur: t.note, exemple: "Hypothèses, éléments en attente…"
    });
    var note = boiteNote.querySelector("textarea");
    champs.push(boiteNote);

    var corps = el("div", {}, [
      ligne("Affaire", a ? a.code + " · " + a.nom : "—"),
      ligne("Ingénieur", t.chargeInge > 0 ? (t.ingenieurId ? D.nomMembre(t.ingenieurId) : "À affecter") + " · " + C.fmtJours(t.chargeInge) + " j" + (t.finiInge ? "  ·  terminé" : periode(t.chargeInge, t.ingenieurId, "ingenieur")) : "—"),
      ligne("Dessin", t.chargeDessin > 0 ? (t.dessinateurId ? D.nomMembre(t.dessinateurId) : "À affecter") + " · " + C.fmtJours(t.chargeDessin) + " j" + (t.finiDessin ? "  ·  terminé" : periode(t.chargeDessin, t.dessinateurId, "dessinateur")) : "—"),
      ligne("Échéance", C.fmtLong(t.echeance)),
      lectureSeule
        ? el("p", { class: "aide", style: "margin-top:20px;font-size:14px;color:var(--texte-doux)", text: "Cette tâche ne te concerne pas : tu peux la consulter, pas la modifier." })
        : null,
      el("div", { class: "grille-champs", style: "margin-top:24px" }, champs),
      lectureSeule ? null : el("div", { class: "legende", style: "display:block;margin-top:24px", text: "Décaler l'échéance" }),
      lectureSeule ? null : el("div", { class: "outils decalages", style: "margin-top:10px" }, [
        decaleBouton("− 1 sem.", -7), decaleBouton("− 1 j", -1),
        decaleBouton("+ 1 j", 1), decaleBouton("+ 1 sem.", 7)
      ])
    ]);

    /* Tâche d'un collègue, sans le droit : on la lit, on n'y touche pas
       (la base applique la même règle). */
    if (lectureSeule) {
      [].forEach.call(corps.querySelectorAll("input,select,textarea"), function (n) { n.disabled = true; });
    }

    function enregistre() {
      var maj = {
        statut: statut.value,
        avancement: Math.min(100, Math.max(0, parseInt(avancement.value, 10) || 0)),
        note: note.value.trim()
      };
      // Seules les parts de cette fiche changent : les autres gardent la leur
      coches.forEach(function (c) { maj[c.part.fini] = c.input.checked; });
      var confiees = [], liberees = 0;
      confies.forEach(function (c) {
        if (c.select.value === (t[c.part.membre] || "")) return;
        maj[c.part.membre] = c.select.value || null;
        if (c.select.value) confiees.push(D.nomMembre(c.select.value));
        else liberees++;
      });
      return D.retoucheTache(t.id, maj).then(function () {
        if (o.surEnregistrement) o.surEnregistrement();
        toast(confiees.length ? "Tâche confiée à " + confiees.join(" et ") + "."
          : liberees ? (liberees > 1 ? "Charges remises à affecter." : "Charge remise à affecter.")
          : "Tâche mise à jour.");
      });
    }

    var detail = {
      label: lectureSeule ? "Voir en détail" : "Modifier en détail", gauche: true,
      // Le formulaire complet remplace la fiche, sans quitter la page
      action: function () { formulaireTache(t.id, { surEnregistrement: o.surEnregistrement }); return false; }
    };
    return ouvre({
      surtitre: o.role
        ? D.METIERS[o.role] + " · " + C.fmtJours(o.charge != null ? o.charge : t[D.PARTS[o.role].charge]) + " j"
        : "Tâche · " + C.fmtJours(Calc.chargeTotale(t)) + " j",
      titre: t.titre,
      corps: corps,
      boutons: lectureSeule
        ? [detail, { label: "Fermer" }]
        : [detail, { label: "Fermer" }, { label: "Enregistrer", or: true, entree: true, action: enregistre }]
    });
  }

  /**
   * formulaireTache(idTache, o) — idTache nul pour une nouvelle tâche.
   * o.affaireId : affaire proposée pour une nouvelle tâche
   * o.surEnregistrement : appelée après l'enregistrement, pour redessiner la page
   */
  /* Priorité (06.10.2026) : départage les tâches de même
     échéance. Curseur de 1, la plus importante, à 5, par défaut. */
  var NIVEAUX_PRIORITE = { 1: "la plus importante", 2: "haute", 3: "moyenne", 4: "basse", 5: "normale, par défaut" };
  function curseurPriorite(valeur) {
    var v = Math.min(5, Math.max(1, parseInt(valeur, 10) || 5));
    var entree = el("input", { type: "range", id: "c-priorite", name: "priorite", min: "1", max: "5", step: "1",
                               value: String(v), "aria-describedby": "c-priorite-lib" });
    var lib = el("span", { id: "c-priorite-lib", class: "priorite-lib" });
    function pose() {
      var n = parseInt(entree.value, 10);
      lib.textContent = n + " · " + NIVEAUX_PRIORITE[n];
      lib.setAttribute("data-niveau", String(n));
      entree.setAttribute("aria-valuetext", "Priorité " + n + ", " + NIVEAUX_PRIORITE[n]);
    }
    entree.addEventListener("input", pose);
    pose();
    return el("div", { class: "champ large champ-priorite" }, [
      el("label", { for: "c-priorite", text: "Priorité" }),
      el("div", { class: "priorite-ligne" }, [
        el("span", { class: "priorite-borne", "aria-hidden": "true", text: "1" }),
        entree,
        el("span", { class: "priorite-borne", "aria-hidden": "true", text: "5" }),
        lib
      ]),
      el("div", { class: "aide", text: "Entre deux tâches de même échéance, la priorité 1 passe devant." })
    ]);
  }

  function formulaireTache(idTache, o) {
    o = o || {};
    var Calc = global.Calc;
    var t = idTache ? D.tache(idTache) : null;
    // Tâche neuve pré-remplie : ce que la palette a compris d'une phrase
    var b = (!t && o.brouillon) || {};
    var affaires = D.affaires({ tous: true });
    if (!affaires.length) {
      return ouvre({
        titre: "Aucune affaire",
        corps: el("p", { style: "color:var(--texte-doux)", text: "Une tâche se rattache toujours à une affaire. Crée d'abord une affaire." }),
        boutons: [{ label: "Fermer" }, { label: "Aller aux affaires", or: true, action: function () { location.href = chemin("/planif/affaires/"); } }]
      });
    }

    /* Droits. Sans « créer des tâches pour les autres », on ne mène que les
       tâches dont une part chargée est la sienne. À la création, sa propre part
       est verrouillée sur soi, l'autre reste libre (un ingénieur confie le
       dessin, un dessinateur nomme son ingénieur). Sur une tâche déjà là, rien
       n'est verrouillé : on peut passer la main, c'est-à-dire confier sa part à
       un collègue du même métier ou la remettre à affecter — la tâche quitte
       alors son planning, et on n'y revient plus. Une tâche qui ne nous
       concerne pas s'ouvre en lecture seule. La base applique les mêmes règles. */
    var libre = D.aDroit("taches_autrui");
    var moi = libre ? null : D.monMembre();
    var maCote = libre ? "" : D.cote(moi && moi.metier);
    if (!libre && !t && !maCote) {
      return toast(moi
        ? "Ton métier n'est pas encore désigné : demande-le à l'administrateur de l'outil, ou fais-toi donner le droit de créer des tâches pour les autres."
        : "Aucune fiche d'équipe n'est rattachée à ton adresse : demande à l'administrateur de l'outil.");
    }
    var lectureSeule = !libre && !!t && !D.meConcerne(t);

    /* La part que je tiens dans cette tâche : celle que je peux passer à
       quelqu'un d'autre. Vide quand j'ai le droit, ou que la tâche est neuve. */
    var maPart = "";
    if (!libre && t && moi) {
      if (t.ingenieurId === moi.id && t.chargeInge > 0) maPart = "ingenieur";
      else if (t.dessinateurId === moi.id && t.chargeDessin > 0) maPart = "dessinateur";
    }

    var affaireInit = t ? t.affaireId : (D.affaire(o.affaireId) ? o.affaireId : affaires[0].id);

    var chAffaire = champ({
      nom: "affaireId", label: "Affaire", type: "select", valeur: affaireInit, large: true,
      options: affaires.map(function (a) { return { valeur: a.id, label: a.code + " · " + a.nom }; })
    });

    var boiteIng = el("div", { class: "champ" }, [el("label", { for: "c-ingenieurId", text: "Ingénieur" })]);
    var boiteDes = el("div", { class: "champ" }, [el("label", { for: "c-dessinateurId", text: "Dessinateur" })]);
    function rebranche() {
      var aff = chAffaire.querySelector("select").value;
      var vi = boiteIng.querySelector("select") ? boiteIng.querySelector("select").value : (t ? t.ingenieurId : (b.ingenieurId || ""));
      var vd = boiteDes.querySelector("select") ? boiteDes.querySelector("select").value : (t ? t.dessinateurId : (b.dessinateurId || ""));
      [boiteIng, boiteDes].forEach(function (b) {
        var s = b.querySelector("select"); if (s) s.remove();
        var a = b.querySelector(".aide"); if (a) a.remove();
      });
      // Ma part reste la mienne : le menu est posé sur moi et ne s'ouvre pas.
      if (maCote === "ingenieur" && !t) vi = moi.id;
      if (maCote === "dessinateur" && !t) vd = moi.id;
      boiteIng.appendChild(selMembres("ingenieurId", "ingenieur", vi, aff));
      boiteDes.appendChild(selMembres("dessinateurId", "dessinateur", vd, aff));
      if (maCote && !t) {
        var sien = (maCote === "ingenieur" ? boiteIng : boiteDes).querySelector("select");
        sien.value = moi.id;
        sien.disabled = true;
        sien.title = "Sans le droit de créer des tâches pour les autres, cette part est la tienne.";
      } else if (maPart) {
        (maPart === "ingenieur" ? boiteIng : boiteDes).appendChild(el("div", {
          class: "aide",
          text: "Ta part : désigne quelqu'un d'autre pour lui passer la main."
        }));
      }
    }
    rebranche();
    chAffaire.querySelector("select").addEventListener("change", rebranche);

    /* Les deux parts se terminent séparément : ces cases font foi, le statut
       n'en est que la synthèse (donnees.js les remet d'accord à l'écriture).
       Une part sans charge ne se coche pas : sa case se grise à la frappe. */
    var parts = [
      { cle: "finiInge", charge: "chargeInge", label: "Calcul terminé" },
      { cle: "finiDessin", charge: "chargeDessin", label: "Dessin terminé" }
    ].map(function (p) {
      var input = el("input", { type: "checkbox", name: "parts", value: p.cle });
      input.checked = !!(t && t[p.cle]);
      p.input = input;
      p.etiquette = el("label", { class: "case" }, [input, p.label]);
      return p;
    });
    var casesParts = el("div", { class: "cases" }, parts.map(function (p) { return p.etiquette; }));

    /* Le dessin attend-il le calcul ? Cochée, la part calcul doit être rendue la
       veille du jour où le dessin commence (Calc.finPart). Une tâche neuve l'est
       d'office. N'a de sens qu'avec les deux charges. */
    var entreeEnchaine = el("input", { type: "checkbox", name: "enchaine", value: "1" });
    entreeEnchaine.checked = t ? !!t.enchaine : !("enchaine" in b) || !!b.enchaine;
    var caseEnchaine = el("label", {
      class: "case", title: "Décoché : calcul et dessin avancent en parallèle jusqu'à l'échéance."
    }, [entreeEnchaine, "Le dessin commence quand le calcul est rendu"]);
    function partsPortees() { return parts.filter(function (p) { return !p.input.disabled; }); }
    /** Toutes les parts qui existent sont cochées — et il en existe au moins une. */
    function partsFinies() {
      var portees = partsPortees();
      return portees.length > 0 && portees.every(function (p) { return p.input.checked; });
    }

    // Début recalculé à chaque frappe : durée, échéance ou intervenant
    var apercu = el("div", { style: "font-size:14px;line-height:1.5;padding-top:7px" });
    function recalcule() {
      var v = lit(corps);
      vide(apercu);

      parts.forEach(function (p) {
        var porte = (parseFloat(String(v[p.charge]).replace(",", ".")) || 0) > 0;
        p.input.disabled = !porte;
        if (!porte) p.input.checked = false;
        p.etiquette.style.opacity = porte ? "" : ".4";
      });
      var deuxParts = parts.every(function (p) { return !p.input.disabled; });
      caseEnchaine.style.opacity = deuxParts ? "" : ".4";
      entreeEnchaine.disabled = !deuxParts;
      // Une charge ramenée à zéro peut suffire à terminer la tâche, ou la rouvrir.
      // Sans aucune charge, il n'y a pas encore de part : rien à conclure (une tâche
      // neuve s'ouvrait « Terminé », toutes ses parts… inexistantes étant finies).
      if (selStatut && partsPortees().length) {
        if (partsFinies()) selStatut.value = "termine";
        else if (selStatut.value === "termine") selStatut.value = "en_cours";
      }

      if (!v.echeance) {
        apercu.appendChild(el("span", { class: "aide", text: "Saisis l'échéance." }));
        return;
      }
      var lignes = [
        { role: "Ingénieur", charge: parseFloat(String(v.chargeInge).replace(",", ".")) || 0, id: v.ingenieurId },
        { role: "Dessin", charge: parseFloat(String(v.chargeDessin).replace(",", ".")) || 0, id: v.dessinateurId }
      ].filter(function (x) { return x.charge > 0; });
      if (!lignes.length) {
        apercu.appendChild(el("span", { class: "aide", text: "Saisis une charge." }));
        return;
      }
      // Même règle que le planning : la part calcul d'une tâche enchaînée finit
      // la veille du début du dessin
      var brouillon = {
        echeance: v.echeance, enchaine: entreeEnchaine.checked,
        chargeInge: parseFloat(String(v.chargeInge).replace(",", ".")) || 0,
        chargeDessin: parseFloat(String(v.chargeDessin).replace(",", ".")) || 0,
        dessinateurId: v.dessinateurId || null, statut: "a_faire",
        finiDessin: parts[1].input.checked
      };
      lignes.forEach(function (x) {
        var m = x.id ? D.membre(x.id) : null;
        var fin = Calc.finPart(brouillon, x.role === "Ingénieur" ? "ingenieur" : "dessinateur", D.canton());
        var debut = Calc.debutPour(x.charge, fin, m, D.canton());
        var ouvres = Calc.joursTravaillesEntre(m, debut, fin, D.canton());
        apercu.appendChild(el("div", {}, [
          el("span", { class: "mono", style: "font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--texte-faible)", text: x.role + " " }),
          el("span", { class: "or", text: C.fmtLong(debut) }),
          el("span", { class: "aide", text: "  " + C.fmtJours(x.charge) + " j sur " + C.fmtJours(ouvres) + (ouvres > 1 ? " jours ouvrés" : " jour ouvré") +
            (fin !== v.echeance ? " · rendu le " + C.fmtCourt(fin) : "") + (m ? "" : " · à affecter") })
        ]));
      });
    }

    // Affaire puis libellé sur toute la largeur, le reste sur deux colonnes (une sur téléphone) :
    // voir .compacte dans planif.css
    var corps = el("div", {}, [
      el("div", { class: "grille-champs" }, [
        chAffaire,
        champ({ nom: "titre", label: "Libellé de la tâche", valeur: t ? t.titre : (b.titre || ""), exemple: "Plans de coffrage niveau 1", large: true })
      ]),
      el("fieldset", {}, [
        el("div", { class: "legende", text: "Charges estimées et affectations" }),
        // Une ligne par métier : la personne, puis sa charge
        el("div", { class: "grille-champs" }, [
          boiteIng,
          champ({
            nom: "chargeInge", label: "Charge ingénieur (j)", type: "number", pas: "0.5", min: "0", inputmode: "decimal",
            valeur: t ? t.chargeInge : (b.chargeInge || ""), exemple: "0"
          }),
          boiteDes,
          champ({
            nom: "chargeDessin", label: "Charge dessin (j)", type: "number", pas: "0.5", min: "0", inputmode: "decimal",
            valeur: t ? t.chargeDessin : (b.chargeDessin || ""), exemple: "0"
          }),
          el("div", { class: "champ large" }, [caseEnchaine])
        ])
      ]),
      el("fieldset", {}, [
        el("div", { class: "legende", text: "Dates" }),
        el("div", { class: "grille-champs" }, [
          champ({
            nom: "echeance", label: "Échéance", type: "date", valeur: t ? t.echeance : (b.echeance || ""),
            aide: "C'est la date qui fait foi : le début s'en déduit."
          }),
          el("div", { class: "champ" }, [
            el("span", { class: "legende", text: "Début calculé" }),
            apercu
          ])
        ])
      ]),
      el("fieldset", {}, [
        el("div", { class: "legende", text: "Suivi" }),
        el("div", { class: "grille-champs" }, [
          champ({
            nom: "statut", label: "Statut", type: "select", valeur: t ? t.statut : "a_faire",
            options: Object.keys(D.STATUTS_TACHE).map(function (k) { return { valeur: k, label: D.STATUTS_TACHE[k] }; })
          }),
          champ({ nom: "avancement", label: "Avancement (%)", type: "number", pas: "5", min: "0", max: "100", inputmode: "numeric", valeur: t ? t.avancement : 0 }),
          VERSION_AB ? curseurPriorite(t ? t.priorite : (b.priorite || 5)) : null,
          el("div", { class: "champ large" }, [
            el("span", { class: "legende", text: "Parts terminées" }),
            casesParts
          ]),
          champ({ nom: "note", label: "Note", type: "textarea", rows: 2, valeur: t ? t.note : "", large: true, exemple: "Hypothèses, éléments en attente…" })
        ])
      ])
    ]);

    // Statut et parts restent d'accord sous les doigts : choisir « Terminé »
    // coche les parts portées, cocher la dernière passe le statut à « Terminé ».
    var selStatut = corps.querySelector("select[name=statut]");
    corps.addEventListener("change", function (e) {
      var toutes = partsFinies;
      if (e.target === selStatut) {
        var fini = selStatut.value === "termine";
        if (fini || toutes()) {
          parts.forEach(function (p) { if (!p.input.disabled) p.input.checked = fini; });
        }
      } else if (e.target.name === "parts") {
        if (toutes()) selStatut.value = "termine";
        else if (selStatut.value === "termine") selStatut.value = "en_cours";
      }
    });

    corps.addEventListener("input", recalcule);
    corps.addEventListener("change", recalcule);
    recalcule();

    /* Tâche d'un collègue, sans le droit : on la lit, on n'y touche pas. */
    if (lectureSeule) {
      corps.insertBefore(el("p", {
        class: "aide", style: "margin-bottom:16px;font-size:14px;color:var(--texte-doux)",
        text: "Cette tâche ne te concerne pas : tu peux la consulter, pas la modifier. Il faut pour cela en tenir une part, ou avoir reçu le droit de créer des tâches pour les autres."
      }), corps.firstChild);
      [].forEach.call(corps.querySelectorAll("input,select,textarea"), function (n) { n.disabled = true; });
    }

    function nombre(x) { return parseFloat(String(x).replace(",", ".")) || 0; }

    /* Sans le droit, une tâche neuve doit porter sa part : on ne crée pas du
       travail pour les autres. Le contrôle est refait par la base. */
    function resteMienne(v) {
      if (libre) return true;
      var id = moi && moi.id;
      return !!id && ((v.ingenieurId === id && nombre(v.chargeInge) > 0) ||
                      (v.dessinateurId === id && nombre(v.chargeDessin) > 0));
    }

    /* Passer la main : la part que je tenais change de mains, retourne à
       affecter, ou perd sa charge. La tâche quitte mon planning — et, sans le
       droit, je ne pourrai plus y revenir. Renvoie le message à annoncer. */
    function passageDeMain(v) {
      if (!maPart || resteMienne(v)) return null;   // tant qu'une part me reste, je n'ai rien lâché
      var cle = maPart === "ingenieur" ? "ingenieurId" : "dessinateurId";
      var charge = nombre(maPart === "ingenieur" ? v.chargeInge : v.chargeDessin);
      if (charge <= 0) return "Ta part n'a plus de charge : la tâche quitte ton planning.";
      return v[cle]
        ? "Tâche confiée à " + D.nomMembre(v[cle]) + " : elle quitte ton planning."
        : "Ta part est remise à affecter : la tâche quitte ton planning.";
    }

    return ouvre({
      surtitre: t ? (lectureSeule ? "Tâche" : "Modifier la tâche") : "Nouvelle tâche",
      titre: t ? t.titre : "Tâche",
      corps: corps,
      compacte: true,
      boutons: lectureSeule ? [{ label: "Fermer" }] : [
        { label: "Annuler" },
        {
          label: "Enregistrer", or: true, entree: true, action: function () {
            var v = lit(corps);
            v.finiInge = (v.parts || []).indexOf("finiInge") >= 0;
            v.finiDessin = (v.parts || []).indexOf("finiDessin") >= 0;
            // Case grisée (une seule part) : on garde le choix, il resservira si la seconde revient
            v.enchaine = entreeEnchaine.checked;
            if (!t && !resteMienne(v)) {
              toast(maCote === "dessinateur"
                ? "Une tâche que tu crées porte ta part : saisis une charge de dessin, et laisse-toi comme dessinateur."
                : "Une tâche que tu crées porte ta part : saisis une charge de calcul, et laisse-toi comme ingénieur.");
              return false;
            }
            var passe = t ? passageDeMain(v) : null;
            var p = t ? D.majTache(t.id, v) : D.ajouteTache(v);
            return p.then(function () {
              if (o.surEnregistrement) o.surEnregistrement();
              toast(passe || (t ? "Tâche modifiée." : "Tâche créée."));
            }).catch(function (e) { toast(e.message); return false; });
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------ transitions
     Les pages reconstruisent leur contenu à chaque rendu. Pour que ce qui
     bouge glisse au lieu de sauter, on photographie avant le rendu les
     éléments marqués, et on anime l'écart après (la technique « FLIP ») :
       data-anim="clé"     identité stable d'un rendu à l'autre (une barre, une ligne)
       data-anim-etat      état visible (« fini »…) : une tâche qui se termine
                           s'éteint en douceur au lieu de changer d'un coup
       data-anim-taille    la largeur peut changer (barre dont la charge bouge)
     Un élément marqué qui se trouve dans un autre élément marqué bouge avec
     lui : on n'anime que son écart propre (une barre dans sa ligne).
     Rien n'est animé au premier rendu, onglet caché, ni au-delà de MAX_ANIMS
     éléments visibles — un changement si vaste se lit mieux d'un coup. */

  var DUREE_FLIP = 460, COURBE = "cubic-bezier(.2,.75,.2,1)", MAX_ANIMS = 260;

  function photo(hote) {
    var p = { cles: Object.create(null), n: 0 };
    if (!hote || !hote.animate) return p;
    [].forEach.call(hote.querySelectorAll("[data-anim]"), function (n) {
      var r = n.getBoundingClientRect();
      if (!r.width && !r.height) return;
      p.cles[n.getAttribute("data-anim")] = { r: r, etat: n.getAttribute("data-anim-etat") || "" };
      p.n++;
    });
    return p;
  }

  function parentMarque(n, hote) {
    for (var q = n.parentElement; q && q !== hote; q = q.parentElement) {
      if (q.hasAttribute("data-anim")) return q.getAttribute("data-anim");
    }
    return null;
  }

  /** o.entrees : les éléments nouveaux apparaissent en fondu (sinon, rien). */
  function joue(hote, avant, o) {
    o = o || {};
    if (!avant || !avant.n || !hote || !hote.animate || document.hidden) return;
    var vh = global.innerHeight, vw = global.innerWidth;
    function visible(r) { return r.bottom > -60 && r.top < vh + 60 && r.right > -60 && r.left < vw + 60; }

    // Toutes les mesures d'abord, les animations ensuite : lire puis écrire
    var mesures = [], parCle = Object.create(null);
    [].forEach.call(hote.querySelectorAll("[data-anim]"), function (n) {
      var m = { n: n, cle: n.getAttribute("data-anim"), r: n.getBoundingClientRect(), parent: parentMarque(n, hote) };
      mesures.push(m); parCle[m.cle] = m;
    });
    // Déplacement visuel total d'un élément au départ de l'animation
    function cumul(m) {
      if (!m) return { x: 0, y: 0 };
      if (m.c) return m.c;
      var a = avant.cles[m.cle];
      m.c = a ? { x: a.r.left - m.r.left, y: a.r.top - m.r.top } : cumul(parCle[m.parent]);
      return m.c;
    }
    var travail = [];
    mesures.forEach(function (m) {
      var a = avant.cles[m.cle];
      if (!visible(m.r) && !(a && visible(a.r))) return;
      if (!a) { if (o.entrees) travail.push({ m: m, entree: true }); return; }
      var c = cumul(m), pc = cumul(parCle[m.parent]);
      var dx = c.x - pc.x, dy = c.y - pc.y;
      var sx = m.n.hasAttribute("data-anim-taille") && m.r.width > 0 ? a.r.width / m.r.width : 1;
      var bouge = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(sx - 1) > 0.01;
      var etat = m.n.getAttribute("data-anim-etat") || "";
      if (bouge || etat !== a.etat) travail.push({ m: m, dx: dx, dy: dy, sx: sx, bouge: bouge, etat: etat !== a.etat ? etat : null });
    });
    if (travail.length > MAX_ANIMS) return;

    travail.forEach(function (w, i) {
      var n = w.m.n;
      if (w.entree) {
        n.animate([{ opacity: 0, transform: "translateY(5px) scale(.97)" }, { opacity: 1, transform: "none" }],
                  { duration: 320, delay: Math.min(i, 12) * 14, easing: COURBE, fill: "backwards" });
        return;
      }
      if (w.bouge) {
        n.animate([
          { transform: "translate(" + w.dx + "px," + w.dy + "px)" + (w.sx !== 1 ? " scaleX(" + w.sx + ")" : ""), transformOrigin: "left center" },
          { transform: "none", transformOrigin: "left center" }
        ], { duration: DUREE_FLIP, easing: COURBE });
      }
      if (w.etat !== null) {
        // Une tâche qui se termine s'éteint : partie lumineuse, elle rejoint sa
        // demi-teinte. Une tâche rouverte, elle, se rallume d'un éclat bref.
        var fin = getComputedStyle(n).opacity;
        n.animate(w.etat === "fini"
          ? [{ opacity: 1, filter: "brightness(1.45) saturate(1.2)" }, { opacity: fin, filter: "none" }]
          : [{ opacity: .45, filter: "brightness(1.6)" }, { opacity: fin, filter: "none" }],
          { duration: w.etat === "fini" ? 900 : 520, easing: "cubic-bezier(.3,.6,.2,1)" });
      }
    });
  }


  /* Pendant la frappe d'une recherche, rien ne glisse : la liste change à
     chaque lettre, et des lignes en mouvement se lisent mal. */
  function enFrappe() {
    var a = document.activeElement;
    return !!(a && a.classList && (a.classList.contains("recherche-champ") || a.classList.contains("pal-champ")));
  }

  /**
   * Texte à nombres qui défilent : « 12,5 j » passe à « 14 j » en comptant.
   * Chaque nombre du texte glisse vers sa nouvelle valeur, le reste est posé
   * tel quel ; si la forme a changé (pas le même nombre de nombres), le texte
   * change d'un coup. ancien : le texte d'avant, quand le nœud vient d'être recréé.
   */
  var NOMBRES = /\d+(?:[.,]\d+)?/g;
  function defileTexte(noeud, texte, ancien) {
    if (ancien == null) ancien = noeud._texte != null ? noeud._texte : noeud.textContent;
    noeud._texte = texte;
    cancelAnimationFrame(noeud._defile);
    var a = String(ancien || "").match(NOMBRES) || [], b = texte.match(NOMBRES) || [];
    if (!ancien || ancien === texte || !b.length || a.length !== b.length || document.hidden) { noeud.textContent = texte; return; }
    var morceaux = texte.split(NOMBRES);
    function val(x) { return parseFloat(x.replace(",", ".")); }
    var de = a.map(val), vers = b.map(val);
    var dec = b.map(function (x) { var i = x.search(/[.,]/); return i < 0 ? 0 : x.length - i - 1; });
    var virgule = b.map(function (x) { return x.indexOf(",") >= 0; });
    var t0 = null, duree = 560;
    setTimeout(function () { if (noeud._texte === texte) { cancelAnimationFrame(noeud._defile); noeud.textContent = texte; } }, duree + 80);
    function pas(t) {
      if (t0 === null) t0 = t;
      var x = Math.min(1, (t - t0) / duree), e = 1 - Math.pow(1 - x, 3), sortie = morceaux[0];
      for (var i = 0; i < vers.length; i++) {
        var v = de[i] + (vers[i] - de[i]) * e;
        var f = dec[i] ? v.toFixed(dec[i]) : String(Math.round(v));
        sortie += (virgule[i] ? f.replace(".", ",") : f) + morceaux[i + 1];
      }
      noeud.textContent = x < 1 ? sortie : texte;
      if (x < 1) noeud._defile = requestAnimationFrame(pas);
    }
    noeud.textContent = ancien;
    noeud._defile = requestAnimationFrame(pas);
  }

  /* ------------------------------------------------------------ impression
     Pas de bibliothèque PDF : l'export passe par l'impression du navigateur,
     où « Enregistrer au format PDF » est proposé partout, y compris sur
     téléphone. Le titre du document donne le nom de fichier proposé. */

  function imprime(nom) {
    var avant = document.title, remis = false;
    function remet() {
      if (remis) return;
      remis = true;
      document.title = avant;
      global.removeEventListener("afterprint", remet);
    }
    if (nom) document.title = nom;
    global.addEventListener("afterprint", remet);
    // Le rendu doit être posé avant l'ouverture de la fenêtre d'impression
    setTimeout(function () {
      try { global.print(); } finally { setTimeout(remet, 1500); }
    }, 60);
  }

  /* ------------------------------------------------------------ lissage
     Case « Lisser la charge » du tableau de bord et de la carte de charge.
     Le choix vaut pour toutes les pages (Calc.lissage) ; le message dit ce
     qu'il a changé, en surcharges des quatre semaines à venir. */
  function caseLissage(surChange) {
    var D = global.Donnees, Calc = global.Calc;
    function surcharges() {
      return Calc.alertes(D.etat(), D.canton()).filter(function (a) { return a.membreId; }).length;
    }
    var entree = el("input", { type: "checkbox" });
    entree.checked = Calc.lissage();
    entree.addEventListener("change", function () {
      var avant = surcharges();
      Calc.poseLissage(entree.checked);
      var apres = surcharges();
      surChange();
      if (!entree.checked) {
        toast("Lissage retiré : chaque tâche repart au plus tard avant son échéance.");
      } else if (!avant) {
        toast("Charge lissée : aucune surcharge à résorber.");
      } else {
        var resorbees = avant - apres;
        toast("Charge lissée : " + (resorbees > 0
          ? resorbees + (resorbees > 1 ? " surcharges résorbées" : " surcharge résorbée")
          : "aucune surcharge résorbée") +
          (apres ? ", " + apres + (apres > 1 ? " restent." : " reste.") : "."));
      }
    });
    return el("label", {
      class: "case", style: "text-transform:none;letter-spacing:.04em",
      title: "Ce qui ne tient pas avant une échéance commence plus tôt, dans les jours encore libres (jamais avant aujourd'hui). Rien n'est modifié dans les tâches."
    }, [entree, " Lisser la charge"]);
  }

  /** Bandeau affiché tant que le jeu de démonstration n'a pas été effacé. */
  function bandeauDemo(hote) {
    if (!D.estDemo() || !hote) return;
    hote.appendChild(el("div", { class: "bandeau" }, [
      el("span", { class: "losange", "aria-hidden": "true" }),
      el("div", {}, [
        el("strong", { text: "Jeu de démonstration. " }),
        "Les membres, affaires et tâches affichés sont inventés, pour que l'outil ne soit pas vide au premier lancement. ",
        el("button", {
          class: "btn btn-nu", type: "button", style: "margin-left:6px",
          text: "Repartir à vide",
          onclick: function () {
            confirme("Repartir à vide ?", "Le jeu de démonstration sera supprimé et l'outil redémarrera vierge.", "Repartir à vide")
              .then(function (ok) { if (ok) D.videTout().then(function () { location.reload(); }); });
          }
        })
      ])
    ]));
  }

  global.UI = {
    el: el, vide: vide, teinte: teinte, toast: toast, boutonIcone: boutonIcone, lienIcone: lienIcone,
    ouvre: ouvre, ferme: ferme, confirme: confirme,
    champ: champ, cases: cases, lit: lit, optionsParMetier: optionsParMetier,
    etiquettesStatuts: etiquettesStatuts,
    chrome: chrome, pied: pied, bandeauDemo: bandeauDemo, rafraichit: rafraichit,
    choisitTheme: choisitTheme, deconnecte: deconnecte,
    colleSousBarre: colleSousBarre,
    absences: absences, nouvelleAbsence: nouvelleAbsence,
    choixJours: choixJours, joursTravailles: joursTravailles,
    formulaireTache: formulaireTache, ficheTache: ficheTache, decaleTache: decaleTache, imprime: imprime, caseLissage: caseLissage, annule: annule,
    session: session, echec: echec, avecBase: avecBase, chemin: chemin, versionAB: VERSION_AB,
    recherche: recherche, termes: termes, correspond: correspond, surligne: surligne,
    foin: foin, contient: contient, paquets: paquets,
    suiviApparitions: suiviApparitions,
    photo: photo, joue: joue, enFrappe: enFrappe, defileTexte: defileTexte
  };
})(window);
