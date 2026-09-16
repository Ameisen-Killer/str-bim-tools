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
          Promise.resolve(r).then(function (v) { if (v !== false) ferme(); })
            .catch(function (e) { toast(e && e.message ? e.message : "Opération impossible."); });
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

  /* --------------------------------------------------------- barre et menu */

  var PAGES = [
    { cle: "tableau", href: "/planif/", nom: "Tableau de bord", court: "Planning" },
    { cle: "taches", href: "/planif/taches/", nom: "Tâches", court: "Tâches" },
    { cle: "affaires", href: "/planif/affaires/", nom: "Affaires", court: "Affaires" },
    { cle: "equipe", href: "/planif/equipe/", nom: "Équipe", court: "Équipe" }
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

  /* ------------------------------------------ tableaux lisibles sur téléphone
     Sur petit écran, chaque ligne de tableau devient une fiche (planif.css).
     L'en-tête disparaît : chaque cellule reçoit donc le libellé de sa colonne,
     affiché devant sa valeur. Posé automatiquement sur tout tableau inséré. */

  function etiquetteTableau(table) {
    var titres = [].map.call(table.querySelectorAll("thead th"), function (th) { return th.textContent.trim(); });
    if (!titres.length) return;
    [].forEach.call(table.querySelectorAll("tbody tr"), function (tr) {
      [].forEach.call(tr.children, function (td, i) {
        if (i > 0 && titres[i] && !td.classList.contains("actions")) td.setAttribute("data-l", titres[i]);
      });
    });
  }

  if (global.MutationObserver) {
    new MutationObserver(function () {
      [].forEach.call(document.querySelectorAll("table.liste:not([data-etiq])"), function (t) {
        t.setAttribute("data-etiq", "");
        etiquetteTableau(t);
      });
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
        D.importe(brut).then(function () { toast("Sauvegarde restaurée."); location.reload(); })
          .catch(function (err) { toast(err.message); });
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
    telecharge: telecharge, csv: csv, nomFichier: nomFichier,
    session: session, echec: echec, avecBase: avecBase
  };
})(window);
