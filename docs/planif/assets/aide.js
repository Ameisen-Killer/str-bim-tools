/* Charlie, l'aide de la planification (09.11.2026, demande de Tony ; le nom aussi)
   ---------------------------------------------------------------------------
   Un assistant SANS IA : un bouton rond « ? » en bas à droite de chaque page
   de l'outil ouvre un panneau façon tchat. On y pose sa question avec ses
   mots ; l'aide la compare aux fiches d'aide-fiches.js et répond avec la
   fiche la plus proche, adaptée à la page où l'on se trouve.

   Comment une question trouve sa fiche :
     1. le texte est mis à plat (minuscules, sans accents ni ponctuation),
        les expressions connues sont soudées (« mot de passe » → motdepasse),
        les petits mots (le, de, comment…) tombent ;
     2. chaque mot est ramené à sa racine (tâches → tach) puis à son synonyme
        de référence (vacances → congé, projet → affaire, effacer → supprimer) ;
     3. chaque fiche reçoit une note : mot trouvé dans ses mots-clés (3), dans
        sa question ou ses variantes (2,5), dans sa réponse (0,6) ; un mot
        approché (début commun, faute de frappe) compte un peu moins ;
     4. une fiche de la page ouverte passe devant (× 1,3).
   La meilleure répond ; les suivantes sont proposées en « Tu cherchais
   peut-être… ». Rien d'assez proche : l'aide le dit, propose les questions de
   la page et, si on le veut, envoie la question à la boîte à idées.

   Adapté à la page :
     - à l'ouverture, les questions fréquentes de la page ouverte ;
     - une fiche peut avoir une réponse propre à une page (champ « ici ») ;
     - « Me montrer » éclaire le bouton ou la zone dont parle la fiche quand
       on est sur sa page ; sinon « Aller à … » y mène ;
     - une page que le groupe de la personne n'ouvre pas : l'aide le dit au
       lieu d'y envoyer.
   Adapté à l'habilitation (droits des groupes de la personne, rôle vu en
   démonstration) : texte « sansDroit » à la place de la réponse, phrases
   « selonDroit » ajoutées, note du droit manquant, questions hors de portée
   retirées des propositions et classées derrière (voir « selon les droits »).

   Le fil de la conversation suit l'onglet d'une page à l'autre
   (sessionStorage). F1 ouvre ou ferme l'aide, Échap la ferme.
   Pas monté dans une iframe (les fenêtres du bureau /planif2/).

   Les fiches vivent dans aide-fiches.js (global AideFiches) : à tenir à jour
   à CHAQUE modification d'une page de l'outil (consigne de Tony, skill).
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  if (global.self !== global.top) return;          // fenêtre du bureau /planif2/
  if (global.Aide) return;

  var FICHES = (global.AideFiches && global.AideFiches.fiches) || [];
  var SYNONYMES = (global.AideFiches && global.AideFiches.synonymes) || [];
  var EXPRESSIONS = (global.AideFiches && global.AideFiches.expressions) || [];
  var CLE_FIL = "planif.aide.fil", CLE_OUVERT = "planif.aide.ouvert";
  var SEUIL_REPONSE = 2.4, SEUIL_PISTE = 1.2;

  /* ------------------------------------------------------------ les pages */

  var PAGES = {
    accueil:       { nom: "Accueil", href: "/planif/" },
    communication: { nom: "Le bureau aujourd'hui", href: "/planif/communication/" },
    absences:      { nom: "Absences et congés", href: "/planif/absences/", droit: "page_absences" },
    equipe:        { nom: "Équipe", href: "/planif/equipe/", droit: "page_equipe" },
    annuaire:      { nom: "Annuaire", href: "/planif/annuaire/", droit: "page_annuaire" },
    taches:        { nom: "Tâches", href: "/planif/taches/" },
    tableau:       { nom: "Tableau de bord", href: "/planif/planning/", droit: "page_tableau" },
    affaires:      { nom: "Affaires", href: "/planif/affaires/", droit: "page_affaires" },
    carte:         { nom: "Carte des affaires", href: "/planif/carte/", droit: "page_affaires" },
    charge:        { nom: "Tableau de charge", href: "/planif/charge/", droit: "page_charge" },
    veille:        { nom: "Veille simap.ch", href: "/planif/inter-secteurs/", droit: "page_inter" },
    ao_publics:    { nom: "AO publics", href: "/planif/inter-secteurs/?vue=publics", droit: "page_inter" },
    ao_prives:     { nom: "AO privés", href: "/planif/inter-secteurs/?vue=prives", droit: "page_inter" },
    agenda_ao:     { nom: "Agenda des AO", href: "/planif/inter-secteurs/?vue=agenda", droit: "page_inter" },
    facturation:   { nom: "Facturation", href: "/planif/inter-secteurs/?vue=facturation", droit: "page_facturation" },
    profil:        { nom: "Mon profil", href: "/planif/profil/" },
    console:       { nom: "Console", href: "/planif/console/", console: true },
    activite:      { nom: "Activité", href: "/planif/console/activite/", console: true },
    connexion:     { nom: "Connexion", href: "/planif/connexion/" }
  };

  function pageCourante() {
    var p = location.pathname.replace(/index\.html$/, "");
    if (!/\/$/.test(p)) p += "/";
    var m = p.match(/^\/planif\/(.*)$/);
    var dossier = m ? m[1].replace(/\/$/, "") : "";
    if (dossier === "") return "accueil";
    if (dossier === "planning") return "tableau";
    if (dossier === "console/activite") return "activite";
    if (dossier === "inter-secteurs") {
      var vue = (location.search.match(/[?&]vue=([a-z]+)/) || [])[1];
      return { publics: "ao_publics", prives: "ao_prives", agenda: "agenda_ao", facturation: "facturation" }[vue] || "veille";
    }
    return PAGES[dossier] ? dossier : "accueil";
  }
  var ICI = pageCourante();

  /* ------------------------------------------------------- droits et profil */

  function D() { return global.Donnees || null; }
  function profilConnu() { var d = D(); try { return !!(d && d.profil && d.profil()); } catch (e) { return false; } }
  function aDroit(code) {
    var d = D();
    if (!code || !profilConnu() || !d.aDroit) return true;
    try { return d.aDroit(code); } catch (e) { return true; }
  }
  function pageOuverte(cle) {
    var p = PAGES[cle];
    if (!p) return false;
    var d = D();
    if (p.console) { try { return !!(d && d.niveauAcces && d.niveauAcces() >= 3); } catch (e) { return false; } }
    return aDroit(p.droit);
  }
  function titreDroit(code) {
    var d = D();
    return (d && d.DROITS && d.DROITS[code] && d.DROITS[code].titre) || code;
  }
  function prenom() {
    var d = D();
    try { var m = d && d.etat && d.etat() && d.monMembre ? d.monMembre() : null; return m ? m.prenom : ""; } catch (e) { return ""; }
  }

  /* ---------------------------------------------------------- mise à plat */

  var VIDES = {};
  ("a à au aux avec ce ces cet cette c ca ça cela ceci comme comment d de des du dans donc " +
   "elle elles en est es et etre être faire fait faut il ils j je l la le les leur leurs lui " +
   "m ma me mes moi mon n ne nous on ou où par pas peut peux puis pour pourquoi qu que quel " +
   "quelle quelles quels qui quoi s sa se ses si son sont suis sur t ta te tes toi ton tu " +
   "un une vos votre vous y estce sais savoir veux voudrais aimerais faudrait dois doit " +
   "possible quand bien tres très plus moins ici alors aussi encore deja déjà stp svp " +
   "fais faites fasse peut-on puis-je dois-je eux lui avoir ai as avez ont etait sera cest").split(/\s+/)
    .forEach(function (w) { VIDES[aplat(w)] = true; });
  // « merci », « bonjour »… restent : ils mènent au petit dialogue (fiches cachées)

  function aplat(s) {
    return String(s || "").toLowerCase()
      .replace(/œ/g, "oe").replace(/æ/g, "ae")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[’'`]/g, " ").replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // Expressions soudées : [« mot de passe », « motdepasse »] (aide-fiches.js)
  var EXPR = EXPRESSIONS.map(function (x) {
    return [new RegExp("(^| )" + aplat(x[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?= |$)", "g"), x[1]];
  })
    .sort(function (a, b) { return b[0].source.length - a[0].source.length; });

  var FINS = ["ements", "ement", "ations", "ation", "ateurs", "ateur", "atrice", "euses", "euse", "eurs", "eur",
              "ees", "ee", "es", "er", "ez", "e"];
  function racine(w) {
    if (/^[0-9]/.test(w) || w.length <= 3) return w;
    if (/[sx]$/.test(w) && w.length > 4) w = w.slice(0, -1);
    for (var i = 0; i < FINS.length; i++) {
      var f = FINS[i];
      if (w.length - f.length >= 4 && w.slice(-f.length) === f) return w.slice(0, -f.length);
    }
    return w;
  }

  // Synonymes : chaque groupe ramené à son premier mot (racines)
  var SYN = {};
  SYNONYMES.forEach(function (g) {
    var tete = racine(aplat(g[0]).replace(/ /g, ""));
    g.forEach(function (w) { SYN[racine(aplat(w).replace(/ /g, ""))] = tete; });
  });

  function mots(texte) {
    var s = " " + aplat(texte) + " ";
    EXPR.forEach(function (x) { s = s.replace(x[0], " " + x[1] + " ").replace(/\s+/g, " "); });
    var out = [];
    s.trim().split(" ").forEach(function (w) {
      if (!w || VIDES[w]) return;
      var r = racine(w);
      r = SYN[r] || r;
      if (out.indexOf(r) < 0) out.push(r);
    });
    return out;
  }

  /* --------------------------------------------------------------- l'index */

  function ajoute(index, texte, poids) {
    mots(texte).forEach(function (m) { if (!(index[m] >= poids)) index[m] = poids; });
  }
  var INDEX = FICHES.map(function (f) {
    var ix = {};
    ajoute(ix, f.reponse || "", 0.6);
    Object.keys(f.ici || {}).forEach(function (k) { ajoute(ix, f.ici[k], 0.4); });
    ajoute(ix, [f.question].concat(f.aussi || []).join(" . "), 2.5);
    ajoute(ix, f.mots || "", 3);
    return { fiche: f, mots: ix, phrases: [f.question].concat(f.aussi || []).map(aplat) };
  });
  var PAR_ID = {};
  FICHES.forEach(function (f) { PAR_ID[f.id] = f; });

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var v = [], i, j;
    for (j = 0; j <= b.length; j++) v[j] = j;
    for (i = 1; i <= a.length; i++) {
      var prec = v[0], minLigne = v[0] = i;
      for (j = 1; j <= b.length; j++) {
        var t = v[j];
        v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prec + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        prec = t;
        if (v[j] < minLigne) minLigne = v[j];
      }
      if (minLigne > max) return max + 1;
    }
    return v[b.length];
  }

  function proche(q, t) {
    if (q === t) return 1;
    var court = q.length < t.length ? q : t, long = court === q ? t : q;
    if (court.length >= 4 && long.indexOf(court) === 0) return 0.85;
    var tol = court.length >= 8 ? 2 : court.length >= 5 ? 1 : 0;
    if (tol && lev(q, t, tol) <= tol) return 0.7;
    return 0;
  }

  function sur(f, page) {
    var p = f.pages || [];
    return p.indexOf(page) >= 0;
  }

  /** Les fiches classées pour une question : [{ fiche, note }], la meilleure d'abord. */
  function cherche(question, page) {
    var q = mots(question);
    var plate = aplat(question);
    if (!q.length && !plate) return [];
    var res = INDEX.map(function (x) {
      var total = 0, trouves = 0;
      q.forEach(function (m) {
        var meilleur = 0;
        if (x.mots[m]) meilleur = x.mots[m];
        else Object.keys(x.mots).forEach(function (t) {
          var s = proche(m, t);
          if (s && s * x.mots[t] > meilleur) meilleur = s * x.mots[t];
        });
        if (meilleur) { total += meilleur; trouves++; }
      });
      /* Une question faite de petits mots seulement (« qui es-tu ? ») n'a plus
         rien à chercher une fois ceux-ci tombés : elle se reconnaît alors à sa
         phrase entière, comparée aux questions et variantes des fiches. */
      var phrase = plate.length >= 6 && x.phrases.some(function (p) {
        return p === plate || (p.length >= 8 && (" " + plate + " ").indexOf(" " + p + " ") >= 0);
      });
      if (!total && !phrase) return { fiche: x.fiche, note: 0 };
      var note = q.length ? total * (0.45 + 0.55 * trouves / q.length) : 0;
      if (phrase) note += 3;
      if (sur(x.fiche, page)) note *= 1.3;
      if (horsDePortee(x.fiche)) note *= 0.8;          // ce que la personne peut faire passe devant
      return { fiche: x.fiche, note: note };
    }).filter(function (r) { return r.note > 0; });
    res.sort(function (a, b) { return b.note - a.note; });
    return res;
  }

  /* ------------------------------------------------------------- outils DOM */

  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    [].concat(enfants || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  /** Texte d'une fiche → nœuds : **gras**, « - » en tête de ligne = liste, ligne vide = paragraphe. */
  function texteRiche(t) {
    var frag = document.createDocumentFragment(), liste = null, para = null;
    function enLigne(ligne, hote) {
      ligne.split(/(\*\*[^*]+\*\*)/).forEach(function (b) {
        if (/^\*\*[^*]+\*\*$/.test(b)) hote.appendChild(el("b", { text: b.slice(2, -2) }));
        else if (b) hote.appendChild(document.createTextNode(b));
      });
    }
    String(t || "").split("\n").forEach(function (ligne) {
      if (/^\s*-\s+/.test(ligne)) {
        para = null;
        if (!liste) { liste = el("ul"); frag.appendChild(liste); }
        var li = el("li");
        enLigne(ligne.replace(/^\s*-\s+/, ""), li);
        liste.appendChild(li);
      } else if (!ligne.trim()) {
        liste = null; para = null;
      } else {
        liste = null;
        if (!para) { para = el("p"); frag.appendChild(para); }
        else para.appendChild(el("br"));
        enLigne(ligne, para);
      }
    });
    return frag;
  }

  function estVisible(n) {
    if (!n || n.closest(".aide-panneau, .aide-bouton")) return false;
    var r = n.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    var s = global.getComputedStyle(n);
    return s.visibility !== "hidden" && s.display !== "none";
  }

  /** L'élément de la page dont parle une fiche : un sélecteur (#…, .…, […]) ou le début d'un libellé. */
  function trouveCible(cible) {
    if (!cible) return null;
    var liste = [].concat(cible);
    for (var i = 0; i < liste.length; i++) {
      var c = liste[i], n = null;
      if (/^[#.\[]/.test(c)) {
        try { n = [].filter.call(document.querySelectorAll(c), estVisible)[0] || null; } catch (e) { n = null; }
      } else {
        var cherche = aplat(c);
        n = [].filter.call(document.querySelectorAll("button, a, h1, h2, h3, label, select, summary, .bd-entree, [role=menuitem]"), function (x) {
          var t = aplat(x.textContent || x.getAttribute("aria-label") || x.getAttribute("title") || "");
          return t.indexOf(cherche) === 0 && estVisible(x);
        })[0] || null;
      }
      if (n) return n;
    }
    return null;
  }

  function montre(n) {
    if (!n) return;
    n.scrollIntoView({ block: "center", behavior: "smooth" });
    n.classList.remove("aide-repere");
    void n.offsetWidth;
    n.classList.add("aide-repere");
    setTimeout(function () { n.classList.remove("aide-repere"); }, 3600);
  }

  /* -------------------------------------------------------------- le fil */

  function litFil() {
    try { var l = JSON.parse(global.sessionStorage.getItem(CLE_FIL) || "[]"); return Array.isArray(l) ? l : []; }
    catch (e) { return []; }
  }
  function ecritFil(l) {
    try { global.sessionStorage.setItem(CLE_FIL, JSON.stringify(l.slice(-40))); } catch (e) {}
  }

  /* ------------------------------------------------------------ le panneau */

  var bouton, panneau, zoneFil, saisie, pistes, ouvert = false;

  function monte() {
    if (document.querySelector(".aide-bouton")) return;
    bouton = el("button", { type: "button", class: "aide-bouton", title: "Charlie, l'aide (F1)", "aria-label": "Charlie, l'aide : poser une question sur l'outil",
                            "aria-expanded": "false", onclick: function () { bascule(); } }, [
      el("span", { class: "aide-ico", "aria-hidden": "true" })
    ]);
    zoneFil = el("div", { class: "aide-fil", "aria-live": "polite" });
    saisie = el("textarea", { class: "aide-saisie", rows: "1", maxlength: "300", placeholder: "Pose ta question…", "aria-label": "Ta question" });
    pistes = el("div", { class: "aide-pistes", hidden: true });
    var envoi = el("button", { type: "submit", class: "aide-envoi", "aria-label": "Envoyer", title: "Envoyer (Entrée)" }, [el("span", { "aria-hidden": "true", text: "➤" })]);
    var forme = el("form", { class: "aide-pied", onsubmit: function (e) { e.preventDefault(); envoie(saisie.value); } }, [saisie, envoi]);
    saisie.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoie(saisie.value); }
    });
    var attente = null;
    saisie.addEventListener("input", function () {
      saisie.style.height = "auto";
      saisie.style.height = Math.min(saisie.scrollHeight, 96) + "px";
      clearTimeout(attente);
      attente = setTimeout(proposePistes, 140);
    });
    panneau = el("section", { class: "aide-panneau", role: "dialog", "aria-label": "Charlie, l'aide de la planification", hidden: true }, [
      el("header", { class: "aide-tete" }, [
        el("span", { class: "aide-ico aide-ico-tete", "aria-hidden": "true" }),
        el("div", { class: "aide-titres" }, [
          el("b", { text: "Charlie" }),
          el("span", { text: "L'aide · page " + PAGES[ICI].nom })
        ]),
        el("button", { type: "button", class: "aide-vider", title: "Effacer la conversation", onclick: function () { ecritFil([]); dessineFil(); saisie.focus(); } }, ["Effacer"]),
        el("button", { type: "button", class: "aide-fermer", "aria-label": "Fermer l'aide", title: "Fermer (Échap)", onclick: function () { bascule(false); } }, ["×"])
      ]),
      zoneFil, pistes, forme
    ]);
    panneau.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); bascule(false); bouton.focus(); }
    });
    document.body.appendChild(bouton);
    document.body.appendChild(panneau);
    document.addEventListener("keydown", function (e) {
      if (e.key === "F1") { e.preventDefault(); bascule(); }
    });
    var etaitOuvert = false;
    try { etaitOuvert = global.sessionStorage.getItem(CLE_OUVERT) === "1"; } catch (e) {}
    if (etaitOuvert) bascule(true, true);
  }

  function bascule(etat, sansFocus) {
    ouvert = typeof etat === "boolean" ? etat : !ouvert;
    panneau.hidden = !ouvert;
    bouton.setAttribute("aria-expanded", String(ouvert));
    bouton.classList.toggle("ouvert", ouvert);
    try { global.sessionStorage.setItem(CLE_OUVERT, ouvert ? "1" : "0"); } catch (e) {}
    if (ouvert) {
      dessineFil();
      if (!sansFocus) setTimeout(function () { saisie.focus(); }, 30);
    }
  }

  /** Les questions fréquentes d'une page (fiches « frequente » d'abord). */
  function frequentes(page, n) {
    var l = FICHES.filter(function (f) { return !f.cachee && sur(f, page) && !horsDePortee(f); });
    l.sort(function (a, b) { return (b.frequente ? 1 : 0) - (a.frequente ? 1 : 0); });
    return l.slice(0, n || 6);
  }

  function puce(f, page) {
    return el("button", { type: "button", class: "aide-puce", onclick: function () { demande(f, page); } }, [f.question]);
  }

  function bulleAide(enfants, classe) {
    return el("div", { class: "aide-msg aide-de-aide" + (classe ? " " + classe : "") }, enfants);
  }

  function accueil() {
    var p = prenom();
    var l = frequentes(ICI, 6);
    return bulleAide([
      /* Charlie se présente à chaque ouverture (09.11.2026, demande de Tony) */
      el("p", {}, [(p ? "Bonjour " + p + " ! " : "Bonjour ! ") + "Je suis ", el("b", { text: "Charlie" }), ", l'aide de la planification."]),
      el("p", { text: "Je connais chaque page de l'outil et je réponds selon la page où tu es et selon tes droits. Je ne suis pas une IA : je cherche dans mes fiches, tenues à jour à chaque évolution du site." }),
      el("p", { text: "Écris ta question avec tes mots, par exemple « comment décaler une tâche ? ». Si je ne sais pas, je te proposerai de l'envoyer à la boîte à idées." }),
      l.length ? el("p", { class: "aide-intro" }, ["Ici, sur ", el("b", { text: PAGES[ICI].nom }), ", on me demande souvent :"]) : null,
      l.length ? el("div", { class: "aide-puces" }, l.map(function (f) { return puce(f, ICI); })) : null
    ], "aide-accueil");
  }

  function dessineFil() {
    while (zoneFil.firstChild) zoneFil.removeChild(zoneFil.firstChild);
    zoneFil.appendChild(accueil());
    litFil().forEach(function (x) { zoneFil.appendChild(rendEntree(x)); });
    zoneFil.scrollTop = zoneFil.scrollHeight;
  }

  function rendEntree(x) {
    if (x.moi !== undefined) return el("div", { class: "aide-msg aide-de-moi" }, [x.moi]);
    if (x.fiche) { var f = PAR_ID[x.fiche]; return f ? rendFiche(f, x.page || ICI) : el("span"); }
    if (x.pistes) return rendPistes(x.pistes, x.page || ICI, x.aussi);
    if (x.rien !== undefined) return rendRien(x.rien, x.page || ICI, x.envoye);
    if (x.note) return bulleAide([el("p", { text: x.note })]);
    return el("span");
  }

  /* ------------------------------------------------- selon les droits
     09.11.2026 (demande de Tony) : la réponse suit l'habilitation de la
     personne connectée (droits de ses groupes, rôle choisi en démonstration).
       droit      code ou liste de codes (un seul suffit) ; admin : admin du site
       sansDroit  texte à la place de « reponse » quand le droit manque
                  (sans lui : la réponse, puis une note qui dit le droit manquant)
       selonDroit { code: ["si oui", "si non"] } : un paragraphe ajouté selon
                  chaque droit ("" = rien)
       perso      "groupes" : une ligne qui nomme les groupes de la personne */
  function estAdminSite() {
    var d = D();
    try { return !!(d && d.niveauAcces && d.niveauAcces() >= 3); } catch (e) { return false; }
  }
  function droitsOk(f) {
    if (f.admin) return !profilConnu() || estAdminSite();
    if (!f.droit) return true;
    return [].concat(f.droit).some(aDroit);
  }
  /** Une fiche que la personne ne peut pas suivre (ni texte pour elle, ni page ouverte). */
  function horsDePortee(f) {
    if (!droitsOk(f) && !f.sansDroit) return true;
    return !!(f.lien && PAGES[f.lien] && !pageOuverte(f.lien) && !f.sansDroit);
  }
  function mesGroupes() {
    var d = D();
    try {
      var p = d && d.profil ? d.profil() : null;
      if (!p) return "";
      if (estAdminSite()) return "Tu es administrateur du site : tu as tous les droits et la console.";
      var l = (p.statuts || []).map(function (s) { return d.libelleStatut ? d.libelleStatut(s) : s; });
      return l.length ? "Tes groupes : " + l.join(", ") + " (plus « Tout le monde »)."
        : "Tu n'es dans aucun groupe particulier : tu as les droits de « Tout le monde ».";
    } catch (e) { return ""; }
  }
  function texteSelonDroits(f, page) {
    var ok = droitsOk(f);
    var t = (!ok && f.sansDroit) ? f.sansDroit : ((f.ici && f.ici[page]) || f.reponse);
    if (profilConnu()) {
      Object.keys(f.selonDroit || {}).forEach(function (code) {
        var x = f.selonDroit[code][aDroit(code) ? 0 : 1];
        if (x) t += "\n\n" + x;
      });
      if (f.perso === "groupes") { var g = mesGroupes(); if (g) t += "\n\n" + g; }
    }
    return t;
  }

  /* Une réponse : son titre, son texte (celui de la page, celui des droits
     de la personne), le droit qui manque, puis « Me montrer » / « Aller à … »
     et les liées. */
  function rendFiche(f, page) {
    var texte = texteSelonDroits(f, page);
    var lien = f.lien && PAGES[f.lien] ? f.lien : null;
    var actions = [];
    var note = null;
    if (!droitsOk(f) && !f.sansDroit) {
      note = f.admin ? "C'est réservé aux administrateurs du site."
        : "Ton groupe n'a pas le droit « " + [].concat(f.droit).map(titreDroit).join(" » ni « ") + " ». Un administrateur le donne dans la console (Groupes et droits).";
    }
    if (!droitsOk(f) && f.sansDroit) lien = null;
    /* « Me montrer » : l'élément dont parle la fiche est sous les yeux, sur sa
       page (ou, fiche sans page attitrée, sur celle-ci). */
    if (f.montre && page === ICI && droitsOk(f) && (!lien || lien === ICI || sur(f, ICI)) && trouveCible(f.montre)) {
      actions.push(el("button", { type: "button", class: "aide-action", onclick: function () {
        montre(trouveCible(f.montre));
      } }, ["Me montrer"]));
    }
    if (lien && lien !== ICI) {
      if (pageOuverte(lien)) {
        actions.push(el("a", { class: "aide-action", href: PAGES[lien].href }, ["Aller à « " + PAGES[lien].nom + " » →"]));
      } else if (!note) {
        note = PAGES[lien].console ? "La console est réservée aux administrateurs du site."
          : "La page « " + PAGES[lien].nom + " » n'est pas ouverte à ton groupe : un administrateur peut te la donner dans la console (Groupes et droits).";
      }
    }
    var liees = (f.voir || []).map(function (id) { return PAR_ID[id]; }).filter(function (g) { return g && !horsDePortee(g); });
    return bulleAide([
      el("p", { class: "aide-q" }, [f.question]),
      el("div", { class: "aide-texte" }, [texteRiche(texte)]),
      note ? el("p", { class: "aide-note", text: note }) : null,
      actions.length ? el("div", { class: "aide-actions" }, actions) : null,
      liees.length ? el("div", { class: "aide-liees" }, [el("span", { text: "Voir aussi :" })].concat(liees.map(function (g) { return puce(g, page); }))) : null
    ]);
  }

  function rendPistes(ids, page, aussi) {
    var l = ids.map(function (id) { return PAR_ID[id]; }).filter(Boolean);
    return bulleAide([
      el("p", { text: aussi ? "Tu cherchais peut-être aussi :" : "Je ne suis pas sûr d'avoir compris. Tu cherches peut-être :" }),
      el("div", { class: "aide-puces" }, l.map(function (f) { return puce(f, page); }))
    ]);
  }

  function enBase() {
    var d = D(), SB = global.Sb;
    try {
      var p = d && d.profil ? d.profil() : null;
      var mail = SB && SB.connecte && SB.connecte() ? SB.email() : "";
      return !!(SB && SB.configure && SB.connecte() && p && p.multi) && !/^demo@/i.test(mail);
    } catch (e) { return false; }
  }

  function rendRien(question, page, envoye) {
    var l = frequentes(page, 4);
    var bloc = bulleAide([
      el("p", { text: "Je n'ai pas de réponse à cette question. Je ne connais que ce qui est écrit dans mes fiches : essaie avec d'autres mots, ou regarde ces questions-là." }),
      l.length ? el("div", { class: "aide-puces" }, l.map(function (f) { return puce(f, page); })) : null
    ]);
    if (enBase() && !envoye) {
      var b = el("button", { type: "button", class: "aide-action", onclick: function () {
        b.disabled = true;
        envoieIdee(question, page).then(function () {
          var fil = litFil();
          for (var i = fil.length - 1; i >= 0; i--) if (fil[i].rien === question) { fil[i].envoye = true; break; }
          fil.push({ note: "Merci, ta question est partie dans la boîte à idées : les fiches de l'aide seront complétées." });
          ecritFil(fil); dessineFil();
        }).catch(function () {
          b.disabled = false;
          b.textContent = "Envoi impossible, réessaie";
        });
      } }, ["Envoyer ma question à la boîte à idées"]);
      bloc.appendChild(el("div", { class: "aide-actions" }, [b]));
    }
    return bloc;
  }

  function nouvelId() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    var o = new Uint8Array(16);
    (global.crypto || {}).getRandomValues ? crypto.getRandomValues(o) : o.forEach(function (_, i) { o[i] = Math.random() * 256; });
    o[6] = (o[6] & 15) | 64; o[8] = (o[8] & 63) | 128;
    var h = [].map.call(o, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  /** La question sans réponse, dans la boîte à idées de l'accueil (table idees, lue par les admins du site). */
  function envoieIdee(question, page) {
    var texte = "Question posée à l'aide, page « " + PAGES[page].nom + " », sans réponse :\n« " + question + " »";
    return global.Sb.requete("idees", { methode: "POST", prefer: "return=minimal", corps: { id: nouvelId(), texte: texte, captures: [] } });
  }

  /* ------------------------------------------------------------ dialogue */

  function demande(f, page) {
    var fil = litFil();
    fil.push({ moi: f.question });
    fil.push({ fiche: f.id, page: page || ICI });
    ecritFil(fil);
    dessineFil();
  }

  function envoie(texte) {
    texte = String(texte || "").trim();
    if (!texte) return;
    saisie.value = "";
    saisie.style.height = "auto";
    pistes.hidden = true;
    var fil = litFil();
    fil.push({ moi: texte });
    var res = cherche(texte, ICI);
    var premier = res[0];
    if (premier && premier.note >= SEUIL_REPONSE) {
      fil.push({ fiche: premier.fiche.id, page: ICI });
      var autres = res.slice(1).filter(function (r) { return r.note >= Math.max(SEUIL_PISTE, premier.note * 0.6) && !r.fiche.cachee; })
        .slice(0, 3).map(function (r) { return r.fiche.id; });
      if (autres.length && !premier.fiche.cachee) fil.push({ pistes: autres, page: ICI, aussi: true });
    } else if (premier && premier.note >= SEUIL_PISTE) {
      fil.push({ pistes: res.filter(function (r) { return !r.fiche.cachee; }).slice(0, 4).map(function (r) { return r.fiche.id; }), page: ICI });
    } else {
      fil.push({ rien: texte, page: ICI });
    }
    ecritFil(fil);
    dessineFil();
  }

  /* Pendant la frappe : les trois questions les plus proches, à cliquer. */
  function proposePistes() {
    var t = saisie.value.trim();
    while (pistes.firstChild) pistes.removeChild(pistes.firstChild);
    if (t.length < 3) { pistes.hidden = true; return; }
    var l = cherche(t, ICI).filter(function (r) { return r.note >= SEUIL_PISTE && !r.fiche.cachee; }).slice(0, 3);
    if (!l.length) { pistes.hidden = true; return; }
    l.forEach(function (r) {
      pistes.appendChild(el("button", { type: "button", class: "aide-puce", onclick: function () {
        saisie.value = ""; pistes.hidden = true; demande(r.fiche, ICI);
      } }, [r.fiche.question]));
    });
    pistes.hidden = false;
  }

  global.Aide = {
    cherche: cherche, mots: mots, page: function () { return ICI; },
    ouvre: function () { bascule(true); }, ferme: function () { bascule(false); },
    pose: function (q) { bascule(true); envoie(q); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", monte);
  else monte();
})(window);
