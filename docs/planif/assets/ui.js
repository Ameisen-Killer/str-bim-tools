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

  function teinte(n) { return "var(--t" + Math.min(8, Math.max(1, n || 1)) + ")"; }

  /* --------------------------------------------------------------- messages */

  var boiteToast = null, minuterie = null;
  function toast(message) {
    if (!boiteToast) { boiteToast = el("div", { class: "toast", role: "status" }); document.body.appendChild(boiteToast); }
    boiteToast.textContent = message;
    boiteToast.classList.add("vu");
    clearTimeout(minuterie);
    minuterie = setTimeout(function () { boiteToast.classList.remove("vu"); }, 3200);
  }

  /* ---------------------------------------------------------------- modale */

  var modale = null, boite = null, fermeEnCours = null, dernierFocus = null;

  function prepareModale() {
    if (modale) return;
    modale = el("div", { class: "modale", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "modale-fond", onclick: function () { ferme(); } }),
      boite = el("div", { class: "modale-boite" })
    ]);
    document.body.appendChild(modale);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modale.classList.contains("ouverte")) ferme();
    });
  }

  /**
   * ouvre({surtitre, titre, corps:Node, boutons:[{label, or, rouge, gauche, action}]})
   * L'action peut renvoyer une promesse ; renvoyer false empêche la fermeture.
   */
  function ouvre(o) {
    prepareModale();
    dernierFocus = document.activeElement;
    fermeEnCours = o.surFermeture || null;
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
      (o.options || []).forEach(function (op) {
        ctrl.appendChild(el("option", { value: op.valeur, selected: String(op.valeur) === String(o.valeur) }, [op.label]));
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

  function pageConnexion(parametres) {
    location.replace("/planif/connexion/?" + parametres);
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
        SB.deconnexion().then(function () { pageConnexion(""); });
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
  var mediaClair = global.matchMedia ? global.matchMedia("(prefers-color-scheme: light)") : null;

  function cleTheme() { return "planif.theme:" + (avecBase && SB.connecte() ? SB.email() : ""); }

  function themeChoisi() {
    try { return global.localStorage.getItem(cleTheme()) || global.localStorage.getItem("planif.theme") || "sombre"; }
    catch (e) { return "sombre"; }
  }

  function appliqueTheme(choix) {
    var effectif = choix === "systeme" ? (mediaClair && mediaClair.matches ? "clair" : "sombre") : choix;
    document.documentElement.setAttribute("data-theme", effectif);
    var meta = document.querySelector("meta[name=theme-color]");
    if (meta) meta.setAttribute("content", effectif === "clair" ? "#F3F0E8" : "#050505");
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

  /** Bouton « Thème » et son menu, pour la ligne du haut. */
  function menuTheme() {
    var bouton = el("button", {
      type: "button", class: "theme-btn", "aria-haspopup": "menu", "aria-expanded": "false", title: "Thème d'affichage"
    }, [
      el("span", { class: "theme-ico", "aria-hidden": "true", text: "◐" }),
      el("span", { class: "theme-lib", text: "Thème" })
    ]);
    var menu = el("div", { class: "menu-theme", role: "menu", hidden: true });
    var actuel = themeChoisi();
    THEMES.forEach(function (t) {
      menu.appendChild(el("button", {
        type: "button", role: "menuitemradio", "data-choix-theme": t.v, "aria-checked": String(t.v === actuel),
        onclick: function () { choisitTheme(t.v); ouvre(false); bouton.focus(); }
      }, [el("span", { class: "coche", "aria-hidden": "true" }), t.l]));
    });

    function ouvre(etat) {
      menu.hidden = !etat;
      bouton.setAttribute("aria-expanded", String(etat));
      if (etat) { var c = menu.querySelector("[aria-checked=true]") || menu.firstChild; c.focus(); }
    }
    bouton.addEventListener("click", function (e) { e.stopPropagation(); ouvre(menu.hidden); });
    document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) ouvre(false); });
    document.addEventListener("keydown", function (e) {
      if (menu.hidden) return;
      if (e.key === "Escape") { ouvre(false); bouton.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var items = [].slice.call(menu.children), i = items.indexOf(document.activeElement);
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
      }
    });
    return el("div", { class: "theme" }, [bouton, menu]);
  }

  /* --------------------------------------------------------- barre et menu */

  var PAGES = [
    { cle: "tableau", href: "/planif/", nom: "Tableau de bord", court: "Planning" },
    { cle: "taches", href: "/planif/taches/", nom: "Tâches", court: "Tâches" },
    { cle: "affaires", href: "/planif/affaires/", nom: "Affaires", court: "Affaires" },
    { cle: "equipe", href: "/planif/equipe/", nom: "Équipe", court: "Équipe" },
    { cle: "absences", href: "/planif/absences/", nom: "Absences", court: "Absences" }
  ];

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

    var nav = el("nav", { class: "nav-outil", "aria-label": "Sections de l'outil" });
    PAGES.forEach(function (p) {
      nav.appendChild(el("a", { href: p.href, "aria-current": p.cle === actif ? "page" : null }, [
        el("span", { class: "long", text: p.nom }),
        el("span", { class: "court", text: p.court })
      ]));
    });
    var pousse = el("div", { class: "pousse outils" });
    (actions || []).forEach(function (a) {
      pousse.appendChild(el("button", { class: "btn" + (a.or ? " btn-or" : ""), type: "button", onclick: a.action, text: a.label }));
    });
    nav.appendChild(pousse);

    var etiquette = avecBase ? SB.email()
      : (D.estDemo() ? "Jeu de démonstration" : "Données locales");

    var outilsHaut = el("div", { class: "barre-outils" }, [
      el("span", { class: "maj", text: etiquette }),
      menuTheme(),
      el("button", { type: "button", onclick: ouvreDonnees, text: "Données" }),
      avecBase ? el("button", { type: "button", onclick: deconnecte, text: "Quitter" }) : null
    ]);

    hote.appendChild(el("div", { class: "barre" }, [
      el("div", { class: "barre-h" }, [
        el("div", {}, [
          el("span", { class: "marque" }, [
            el("a", { href: "/", text: "STR Bim Tools" }),
            el("span", { class: "sep", text: "·" })
          ]),
          el("a", { href: "/planif/", class: "ici", text: "Planification" })
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

    var ancien = document.querySelector(".fab");
    if (ancien) ancien.remove();
    var principale = (actions || []).filter(function (a) { return a.or; })[0];
    if (principale) {
      document.body.appendChild(el("button", {
        class: "fab", type: "button", onclick: principale.action, "aria-label": principale.label
      }, [el("b", { text: "+", "aria-hidden": "true" }), principale.label.replace(/^(Nouvelle|Nouveau|Nouvel) /, "")]));
      document.body.classList.add("avec-fab");
    }
  }

  /* ------------------------------------------------------------- recherche
     Une barre commune aux listes (tâches, affaires, équipe), filtrée à chaque
     caractère. Insensible à la casse et aux accents (« beton » trouve
     « Béton »), plusieurs mots se cumulent (« coffrage kevin »).
     Raccourcis : « / » ou Ctrl+K pour chercher, Échap pour effacer,
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
    return { fin: function () { if (observateur) observateur.disconnect(); } };
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
      history.replaceState(null, "", url.pathname + url.search);
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

    // « / » ou Ctrl+K depuis n'importe où, sauf pendant une saisie ou avec une fenêtre ouverte
    document.addEventListener("keydown", function (e) {
      var cible = e.target, enSaisie = /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName) || cible.isContentEditable;
      var fenetre = document.querySelector(".modale.ouverte");
      if (fenetre) return;
      if ((e.key === "/" && !enSaisie) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
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

  function pied() {
    var hote = document.querySelector("[data-pied]");
    if (!hote) return;
    vide(hote);
    hote.appendChild(el("footer", { class: "pied-outil" }, [
      el("a", { href: "/", text: "← str-bim-tools.com" }),
      el("div", { class: "droite" }, [
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
          return (o.membres || []).length + " membres, " + (o.affaires || []).length + " affaires, " + (o.taches || []).length + " tâches";
        }
        confirme("Remplacer toutes les données ?",
          "Le contenu actuel (" + compte(D.etat()) + ") sera remplacé par celui du fichier « " + f.name + " » (" + compte(brut) + ")" +
          (avecBase ? ", dans la base, pour toute l'équipe" : "") +
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
        text: avecBase
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
        el("div", { class: "cle" }, [el("div", { class: "v", text: String(e.taches.length) }), el("div", { class: "l", text: "Tâches" })])
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
        {
          label: "Tout effacer", rouge: true, gauche: true, action: function () {
            return confirme("Tout effacer ?",
              "Membres, affaires et tâches seront supprimés " + (avecBase ? "de la base, pour toute l'équipe" : "de ce navigateur") +
              ". Cette action est définitive : exporte d'abord une sauvegarde si tu veux pouvoir revenir en arrière.",
              "Effacer définitivement", true).then(function (ok) {
                if (!ok) return false;
                // La fenêtre de confirmation s'est refermée : sans ce mot,
                // l'écran resterait muet pendant l'aller-retour avec la base.
                toast("Effacement en cours…");
                return D.videTout().then(function () { location.reload(); });
              });
          }
        },
        { label: "Importer", action: function () { entree.click(); return false; } },
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
        var n = C.nbOuvres(a.debut, a.fin, D.canton());
        corps.appendChild(el("tr", { class: enCours && enCours.id === a.id ? "en-edition" : "" }, [
          el("td", {}, [
            el("div", { class: "principal", text: a.motif }),
            el("div", { class: "secondaire", text: C.fmtCH(a.debut) + " → " + C.fmtCH(a.fin) })
          ]),
          el("td", { class: "num", text: n + (n > 1 ? " jours ouvrés" : " jour ouvré") }),
          el("td", { class: "actions" }, [
            el("button", { class: "btn btn-nu", type: "button", text: "Modifier", onclick: function () { edite(a); } }),
            el("button", {
              class: "btn btn-nu btn-rouge", type: "button", text: "Retirer",
              onclick: function () {
                D.suppAbsence(m.id, a.id).then(function () {
                  if (enCours && enCours.id === a.id) edite(null); else rend();
                  previent();
                  toast("Absence retirée.");
                }).catch(function (e) { toast(e.message); });
              }
            })
          ])
        ]));
      });
      liste.appendChild(el("table", { class: "liste", style: "min-width:0" }, [corps]));
    }

    var corps = el("div", {}, [
      el("p", { class: "aide", style: "margin-bottom:20px;font-size:14px;color:var(--texte-doux)", text: "Les jours d'absence sortent de la capacité disponible, apparaissent hachurés au tableau de bord et en barre au calendrier des absences." }),
      liste,
      el("div", { class: "legende", style: "display:flex;align-items:baseline;gap:12px;margin-bottom:10px" }, [libelleForm, annuler]),
      champs
    ]);

    var boite = ouvre({
      surtitre: "Absences",
      titre: m.prenom + " " + m.nom,
      corps: corps,
      boutons: [
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
      ]
    });
    valider = boite.querySelector(".modale-pied .btn-or");
    edite(null);
  }

  /** Nouvelle absence sans passer par la fiche d'un membre : le membre se choisit dans la fenêtre. */
  function nouvelleAbsence(o) {
    o = o || {};
    var previent = o.surChangement || function () {};
    var membres = D.membres({});
    if (!membres.length) return toast("Aucun membre à l'effectif : commence par l'équipe.");

    var corps = el("div", { class: "grille-champs" }, [
      champ({
        nom: "membre", label: "Membre", type: "select", large: true, valeur: o.membreId || membres[0].id,
        options: membres.map(function (m) {
          return { valeur: m.id, label: m.prenom + " " + m.nom + " · " + D.libelleRole(m.role) };
        })
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

  /* ----------------------------------------------------------- conversions */

  function csv(lignes) {
    return "﻿" + lignes.map(function (l) {
      return l.map(function (c) {
        var s = c == null ? "" : String(c);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";");
    }).join("\r\n");
  }

  global.UI = {
    el: el, vide: vide, teinte: teinte, toast: toast,
    ouvre: ouvre, ferme: ferme, confirme: confirme,
    champ: champ, cases: cases, lit: lit,
    chrome: chrome, pied: pied, bandeauDemo: bandeauDemo,
    absences: absences, nouvelleAbsence: nouvelleAbsence, imprime: imprime,
    telecharge: telecharge, csv: csv, nomFichier: nomFichier,
    session: session, echec: echec, avecBase: avecBase,
    recherche: recherche, termes: termes, correspond: correspond, surligne: surligne,
    foin: foin, contient: contient, paquets: paquets,
    suiviApparitions: suiviApparitions
  };
})(window);
