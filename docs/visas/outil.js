/* Visas — briques d'interface et stockage de l'outil (/visas/).
   Reprises de la planification au moment où Visas en est sorti (01.10.2026),
   réduites à ce que la page utilise : barre, thème, messages, fenêtre,
   recherche, impression, tableaux lisibles sur téléphone.
   Aucune connexion, aucun serveur : les exports Kairnial sont gardés dans
   IndexedDB et les coches « Traité » dans localStorage, sur ce navigateur.
   Outil  : l'interface ;  Stock : exports et coches. */
(function (global) {
  "use strict";

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
      else n.setAttribute(k, v === true ? "" : v);
    });
    (enfants || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function vide(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  function erreur(message) { var e = new Error(message); e.metier = true; return e; }

  /* --------------------------------------------------------------- messages */

  var boiteToast = null, minuterie = null;
  /** Message bref. action facultative : { label, action } — un bouton, « Annuler » par exemple. */
  function toast(message, action) {
    if (!boiteToast) { boiteToast = el("div", { class: "toast", role: "status" }); document.body.appendChild(boiteToast); }
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
      else if (e.key === "Enter" && !e.repeat && boutonEntree && !e.isComposing &&
               /^(INPUT|SELECT)$/.test(e.target.tagName) && boite.contains(e.target)) {
        e.preventDefault();
        boutonEntree.click();
      }
    });
  }

  /**
   * ouvre({surtitre, titre, corps:Node, compacte, boutons:[{label, or, rouge, entree, action}], surFermeture})
   * L'action peut renvoyer une promesse ; renvoyer false empêche la fermeture.
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
      if (!b) return;
      var bouton = el("button", {
        class: "btn" + (b.or ? " btn-or" : "") + (b.rouge ? " btn-rouge" : ""),
        type: "button",
        onclick: function () {
          var r = b.action ? b.action() : true;
          Promise.resolve(r).then(function (v) {
            if (v !== false) ferme();
          }).catch(function (e) {
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

  /* ------------------------------------------------------------------ thème
     Sombre, clair, AB ingénieurs ou celui de l'appareil. Retenu dans ce
     navigateur ; à la première visite, celui de la planification s'il y en a un.
     Le même tableau est repris par le script en tête de page, qui pose le
     thème avant le premier rendu. */
  var THEMES = [
    { v: "sombre", l: "Sombre" },
    { v: "clair", l: "Clair" },
    { v: "ab", l: "AB ingénieurs" },
    { v: "systeme", l: "Système" }
  ];
  var FOND_THEME = { clair: "#F3F0E8", ab: "#F5F5F4", sombre: "#050505" };
  var CLE_THEME = "visas.theme";
  var mediaClair = global.matchMedia ? global.matchMedia("(prefers-color-scheme: light)") : null;

  function themeChoisi() {
    try { return global.localStorage.getItem(CLE_THEME) || global.localStorage.getItem("planif.theme") || "sombre"; }
    catch (e) { return "sombre"; }
  }

  function appliqueTheme(choix) {
    var effectif = choix === "systeme" ? (mediaClair && mediaClair.matches ? "clair" : "sombre") : choix;
    document.documentElement.setAttribute("data-theme", effectif);
    var meta = document.querySelector("meta[name=theme-color]");
    if (meta) meta.setAttribute("content", FOND_THEME[effectif] || FOND_THEME.sombre);
    [].forEach.call(document.querySelectorAll("[data-choix-theme]"), function (b) {
      b.setAttribute("aria-checked", String(b.getAttribute("data-choix-theme") === choix));
    });
  }

  function choisitTheme(choix) {
    try { global.localStorage.setItem(CLE_THEME, choix); } catch (e) {}
    appliqueTheme(choix);
  }

  // « Système » suit le réglage de l'appareil en direct (passage jour / nuit)
  if (mediaClair) {
    var suitSysteme = function () { if (themeChoisi() === "systeme") appliqueTheme("systeme"); };
    if (mediaClair.addEventListener) mediaClair.addEventListener("change", suitSysteme);
    else if (mediaClair.addListener) mediaClair.addListener(suitSysteme);
  }
  appliqueTheme(themeChoisi());

  /** Bouton « Thème » et son menu : ouverture au clic, fermeture ailleurs ou par Échap, flèches. */
  function menuTheme() {
    var bouton = el("button", {
      type: "button", class: "theme-btn", "aria-haspopup": "menu", "aria-expanded": "false", title: "Thème d'affichage"
    }, [
      el("span", { class: "theme-ico", "aria-hidden": "true", text: "◐" }),
      el("span", { class: "theme-lib", text: "Thème" })
    ]);
    var menu = el("div", { class: "menu-theme", role: "menu", hidden: true });
    function bascule(etat) {
      menu.hidden = !etat;
      bouton.setAttribute("aria-expanded", String(etat));
      if (etat) { var c = menu.querySelector("[aria-checked=true]") || menu.querySelector("button"); if (c) c.focus(); }
    }
    bouton.addEventListener("click", function (e) { e.stopPropagation(); bascule(menu.hidden); });
    document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) bascule(false); });
    document.addEventListener("keydown", function (e) {
      if (menu.hidden) return;
      if (e.key === "Escape") { bascule(false); bouton.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var items = [].slice.call(menu.querySelectorAll("button")), n = items.length, i = items.indexOf(document.activeElement);
        var bas = e.key === "ArrowDown";
        items[i < 0 ? (bas ? 0 : n - 1) : (i + (bas ? 1 : n - 1)) % n].focus();
      }
    });
    var actuel = themeChoisi();
    THEMES.forEach(function (t) {
      menu.appendChild(el("button", {
        type: "button", role: "menuitemradio", "data-choix-theme": t.v, "aria-checked": String(t.v === actuel),
        onclick: function () { choisitTheme(t.v); bascule(false); bouton.focus(); }
      }, [el("span", { class: "coche", "aria-hidden": "true" }), t.l]));
    });
    return el("div", { class: "theme" }, [bouton, menu]);
  }

  /* ------------------------------------------------------------------ barre
     Une seule ligne : « STR Bim Tools · Visas » à gauche ; les actions de la
     page puis le thème à droite. Sur téléphone, l'action principale (or)
     devient un bouton flottant à portée de pouce. */
  var hauteurChrome = 0, suiviChrome = null;

  function barre(actions) {
    var hote = document.querySelector("[data-chrome]");
    if (!hote) return;
    vide(hote);
    var actionsPage = el("div", { class: "actions-page" });
    (actions || []).forEach(function (a) {
      actionsPage.appendChild(el("button", { class: "btn" + (a.or ? " btn-or" : ""), type: "button", onclick: a.action }, [
        a.icone ? el("span", { class: "ico-txt " + a.icone, "aria-hidden": "true" }) : null,
        a.label
      ]));
    });
    hote.appendChild(el("div", { class: "barre" }, [
      el("div", { class: "barre-h" }, [
        el("div", { class: "fil" }, [
          el("span", { class: "marque" }, [
            el("a", { href: "/", text: "STR Bim Tools" }),
            el("span", { class: "sep", text: "·" })
          ]),
          el("a", { href: "/visas/", class: "ici", text: "Visas" })
        ]),
        el("div", { class: "barre-outils" }, [actionsPage, menuTheme()])
      ])
    ]));

    var ancien = document.querySelector(".fab");
    if (ancien) ancien.remove();
    var principale = (actions || []).filter(function (a) { return a.or; })[0];
    if (principale) {
      document.body.appendChild(el("button", {
        class: "fab", type: "button", onclick: principale.action, "aria-label": principale.label
      }, [
        principale.icone ? el("span", { class: "ico-txt " + principale.icone, "aria-hidden": "true" }) : null,
        principale.label
      ]));
      document.body.classList.add("avec-fab");
    }
    mesureChrome(hote);
  }

  /* Hauteur de la barre, publiée en --h-chrome : le bloc des filtres se colle dessous. */
  function mesureChrome(hote) {
    function pose() {
      hauteurChrome = Math.round(hote.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--h-chrome", hauteurChrome + "px");
    }
    pose();
    if (suiviChrome) suiviChrome.disconnect();
    if (global.ResizeObserver) { suiviChrome = new ResizeObserver(pose); suiviChrome.observe(hote); }
    else global.addEventListener("resize", pose);
  }

  /** Classe « collee » sur un bloc collant dès qu'il a rejoint la barre : il peut alors se resserrer. */
  function colleSousBarre(bloc) {
    if (!bloc) return;
    var attend = false;
    function juge() {
      attend = false;
      bloc.classList.toggle("collee", bloc.getBoundingClientRect().top <= hauteurChrome + 1);
    }
    function surDefilement() {
      if (attend) return;
      attend = true;
      requestAnimationFrame(juge);
    }
    global.addEventListener("scroll", surDefilement, { passive: true });
    global.addEventListener("resize", surDefilement);
    juge();
  }

  function pied() {
    var hote = document.querySelector("[data-pied]");
    if (!hote) return;
    vide(hote);
    hote.appendChild(el("footer", { class: "pied-outil" }, [
      el("a", { href: "/", text: "← str-bim-tools.com" }),
      el("div", { class: "droite" }, [
        el("span", { text: "Analyse et données dans ce navigateur" }),
        el("a", { href: "/mentions-legales/", text: "Mentions légales" })
      ])
    ]));
  }

  /* -------------------------------------------------------------- recherche
     Insensible à la casse et aux accents (« beton » trouve « Béton »),
     plusieurs mots se cumulent. « / » pour chercher, Échap pour effacer,
     Entrée pour ouvrir le résultat quand il n'en reste qu'un. */

  function plie(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function termes(q) { return plie(q).split(/\s+/).filter(Boolean); }

  /** Vrai si chaque mot se trouve dans au moins un des champs. */
  function correspond(champs, mots) {
    if (!mots.length) return true;
    var foin = plie(champs.filter(Boolean).join(" | "));
    for (var i = 0; i < mots.length; i++) if (foin.indexOf(mots[i]) < 0) return false;
    return true;
  }

  /** Nombre qui défile jusqu'à sa nouvelle valeur. */
  function defileNombre(noeud, cible) {
    var depart = parseInt(noeud.textContent, 10);
    noeud._cible = cible;
    cancelAnimationFrame(noeud._anim);
    if (isNaN(depart) || depart === cible || document.hidden) { noeud.textContent = String(cible); return; }
    var t0 = null, duree = 260;
    setTimeout(function () {
      if (noeud._cible !== cible) return;
      cancelAnimationFrame(noeud._anim);
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
      bloc.classList.toggle("remplie", champ.value.length > 0);
      var url = new URL(location.href);
      if (champ.value.trim()) url.searchParams.set("q", champ.value.trim()); else url.searchParams.delete("q");
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

    // « / » depuis n'importe où, sauf pendant une saisie ou avec une fenêtre ouverte
    document.addEventListener("keydown", function (e) {
      var cible = e.target, enSaisie = /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName) || cible.isContentEditable;
      if (document.querySelector(".modale.ouverte")) return;
      if (e.key === "/" && !enSaisie) { e.preventDefault(); champ.focus(); champ.select(); }
    });

    etat();
    return {
      valeur: function () { return champ.value; },
      termes: function () { return termes(champ.value); },
      compte: function (n, t) { defileNombre(nb, n); defileNombre(total, t); bloc.classList.toggle("aucun", !!champ.value.trim() && n === 0); }
    };
  }

  /* ------------------------------------------ tableaux lisibles sur téléphone
     Sur petit écran, chaque ligne de tableau devient une fiche (outil.css).
     L'en-tête disparaît : chaque cellule reçoit donc le libellé de sa colonne.
     Posé automatiquement sur tout tableau inséré ; les titres sont retenus au
     premier passage (table._titres), un tableau redessiné les remet à null. */
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

  /* ------------------------------------------------------------ impression
     Le PDF passe par l'impression du navigateur (« Enregistrer au format PDF »).
     Le titre du document donne le nom de fichier proposé. */
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
    setTimeout(function () {
      try { global.print(); } finally { setTimeout(remet, 1500); }
    }, 60);
  }

  /* ================================================================ stockage */

  function nouvelId() {
    return (global.crypto && global.crypto.randomUUID) ? global.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* Exports Kairnial gardés dans IndexedDB : un classeur de quelques Mo n'a pas
     sa place dans localStorage. Description : id, nom, taille, deposeLe,
     edition, projet, nbPlans, nbIndices, nbVisas ; le fichier à part. */
  var exportsKairnial = (function () {
    var BASE = "visas.exports", MAGASIN = "exports";
    function ouvreBase() {
      return new Promise(function (ok, ko) {
        if (!global.indexedDB) { ko(erreur("Ce navigateur ne sait pas garder de fichier.")); return; }
        var r = global.indexedDB.open(BASE, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(MAGASIN, { keyPath: "id" }); };
        r.onsuccess = function () { ok(r.result); };
        r.onerror = function () { ko(r.error); };
      });
    }
    function magasin(mode, fn) {
      return ouvreBase().then(function (db) {
        return new Promise(function (ok, ko) {
          var tx = db.transaction(MAGASIN, mode), req = fn(tx.objectStore(MAGASIN));
          tx.oncomplete = function () { ok(req && req.result); };
          tx.onerror = function () { ko(tx.error); };
        });
      });
    }
    function sansFichier(x) {
      var o = {};
      Object.keys(x).forEach(function (k) { if (k !== "fichier") o[k] = x[k]; });
      return o;
    }
    // Navigation privée de certains navigateurs : IndexedDB existe mais refuse de s'ouvrir
    var dispo = null;
    return {
      disponible: function () {
        if (!dispo) dispo = ouvreBase().then(function () { return true; }, function () { return false; });
        return dispo;
      },
      liste: function () {
        return magasin("readonly", function (s) { return s.getAll(); }).then(function (l) {
          return (l || []).map(sansFichier).sort(function (a, b) { return a.deposeLe < b.deposeLe ? 1 : -1; });
        });
      },
      depose: function (fichier, m) {
        return fichier.arrayBuffer().then(function (octets) {
          var x = { id: nouvelId(), nom: m.nom, taille: m.taille, deposeLe: new Date().toISOString(),
            edition: m.edition, projet: m.projet, nbPlans: m.nbPlans, nbIndices: m.nbIndices, nbVisas: m.nbVisas,
            fichier: octets };
          return magasin("readwrite", function (s) { return s.put(x); }).then(function () { return sansFichier(x); });
        });
      },
      lit: function (x) {
        return magasin("readonly", function (s) { return s.get(x.id); }).then(function (r) {
          if (!r) throw erreur("Fichier introuvable dans ce navigateur.");
          return r.fichier;
        });
      },
      supprime: function (x) {
        return magasin("readwrite", function (s) { return s.delete(x.id); }).then(function () {});
      }
    };
  })();

  /* Plans cochés « Traité » : { code, indice, traiteLe }, une liste dans localStorage. */
  var traites = (function () {
    var CLE = "visas.traites";
    function lit() {
      try { var l = JSON.parse(global.localStorage.getItem(CLE) || "[]"); return Array.isArray(l) ? l : []; } catch (e) { return []; }
    }
    function ecrit(l) {
      try { global.localStorage.setItem(CLE, JSON.stringify(l)); } catch (e) { throw erreur("Ce navigateur ne peut pas garder les coches."); }
    }
    function autre(t) { return function (x) { return x.code !== t.code || x.indice !== t.indice; }; }
    return {
      disponible: function () {
        try { global.localStorage.setItem(CLE + ".essai", "1"); global.localStorage.removeItem(CLE + ".essai"); return Promise.resolve(true); }
        catch (e) { return Promise.resolve(false); }
      },
      liste: function () { return Promise.resolve(lit()); },
      marque: function (t) {
        return Promise.resolve().then(function () {
          var l = lit(), deja = l.filter(function (x) { return !autre(t)(x); })[0];
          if (deja) return deja;
          var x = { code: t.code, indice: +t.indice || 0, traiteLe: new Date().toISOString() };
          l.unshift(x);
          ecrit(l);
          return x;
        });
      },
      demarque: function (t) {
        return Promise.resolve().then(function () { ecrit(lit().filter(autre({ code: t.code, indice: +t.indice || 0 }))); });
      }
    };
  })();

  global.Outil = {
    el: el, toast: toast, ouvre: ouvre, ferme: ferme, confirme: confirme,
    barre: barre, colleSousBarre: colleSousBarre, pied: pied,
    recherche: recherche, correspond: correspond, imprime: imprime
  };
  global.Stock = { exports: exportsKairnial, traites: traites };
})(window);
