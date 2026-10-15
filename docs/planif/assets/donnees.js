/* Couche de données de l'outil de planification.
   ---------------------------------------------------------------------------
   Tout passe par ici : aucune page ne touche directement au stockage.
   L'implémentation actuelle garde les données dans le navigateur
   (localStorage). Le jour où une vraie base est branchée (Supabase ou autre),
   seul l'objet ADAPTATEUR change : les pages, elles, ne bougent pas.
   C'est pour cela que toutes les méthodes renvoient une promesse, même
   lorsqu'elles répondent instantanément.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var CLE = "planif.str-bim-tools.v1";
  var VERSION = 1;

  /* ------------------------------------------------------------ utilitaires */

  // Identifiants au format UUID : c'est ce qu'attend la base, et cela permet
  // de créer une ligne côté navigateur sans aller demander son numéro au serveur.
  var RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function id() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function texte(v) { return String(v == null ? "" : v).trim(); }
  function nombre(v, defaut) { var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : defaut; }
  function erreur(m) { var e = new Error(m); e.metier = true; return e; }
  function dixieme(n) { return Math.round(n * 10) / 10; }
  /** « 2026-10-02T14:05 », en heure locale : la forme des avis d'absence. */
  function instantLocal(d) {
    function deux(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate()) +
      "T" + deux(d.getHours()) + ":" + deux(d.getMinutes());
  }
  var CHARGE_MAX = 999.9;                          // plafond de numeric(4,1) en base

  /* Semaine type d'un membre : un poids par jour, du lundi au vendredi —
     1 jour plein, 0,5 une demi-journée, 0 un jour où il ne travaille jamais.
     null : les cinq jours se valent, la capacité s'y répartit à parts égales
     (un 80 % sans jour fixe fait 0,8 j chaque jour). calculs.js s'en sert pour
     caler les tâches sur les vrais jours de chacun. */
  var JOURS_SEMAINE = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
  var JOURS_COURTS = ["Lu", "Ma", "Me", "Je", "Ve"];
  function reprisJours(v) {
    if (!Array.isArray(v) || v.length !== 5) return null;
    var j = v.map(function (x) { var n = nombre(x, 1); return n >= 0.75 ? 1 : n >= 0.25 ? 0.5 : 0; });
    if (j.every(function (x) { return x === 1; })) return null;    // semaine pleine : rien à retenir
    if (!j.some(function (x) { return x > 0; })) return null;
    return j;
  }
  function sommeJours(j) {
    return (j || [1, 1, 1, 1, 1]).reduce(function (a, b) { return a + b; }, 0);
  }
  /** « Lu Ma Je Ve », « Lu Ma Me½ Je Ve » ; vide pour une semaine pleine. */
  function libelleJours(m) {
    var j = reprisJours(m && m.jours);
    if (!j) return "";
    return j.map(function (p, i) { return p >= 1 ? JOURS_COURTS[i] : p > 0 ? JOURS_COURTS[i] + "½" : ""; })
      .filter(Boolean).join(" ");
  }
  /* Capacité après un changement de jours (la base fait le même calcul, dans
     regle_jours) : elle suit les jours quand elle les suivait déjà — retirer
     le mercredi d'un plein temps donne 4 j —, mais un temps partiel sans jour
     fixe ne monte jamais seul, il ne fait que redescendre sous les jours
     travaillés. Changer de taux d'activité reste l'affaire de la console. */
  function capaciteApres(m, jours) {
    var cap = (m && m.capacite) || 5;
    var avant = sommeJours(reprisJours(m && m.jours)), apres = sommeJours(reprisJours(jours));
    return dixieme(Math.abs(cap - avant) < 0.05 ? apres : Math.min(cap, apres));
  }
  /** « Ne travaille pas le mercredi. Demi-journée le vendredi. » */
  function detailJours(m) {
    var j = reprisJours(m && m.jours);
    if (!j) return "Travaille du lundi au vendredi.";
    function liste(p) {
      var l = JOURS_SEMAINE.filter(function (x, i) { return j[i] === p; })
        .map(function (x) { return "le " + x; });
      return l.length > 1 ? l.slice(0, -1).join(", ") + " et " + l[l.length - 1] : l[0];
    }
    var out = [];
    if (j.indexOf(0) >= 0) out.push("Ne travaille pas " + liste(0) + ".");
    if (j.indexOf(0.5) >= 0) out.push("Demi-journée " + liste(0.5) + ".");
    return out.join(" ");
  }

  /* Deux choses distinctes, et qui se cumulent :
     · le MÉTIER qu'on exerce — un seul, c'est lui qui décide de la place au
       planning (un ingénieur porte les charges de calcul, un dessinateur celles
       de dessin, un administratif n'est pas planifié) ;
     · les STATUTS qu'on porte dans la société — autant qu'il en faut, ou aucun.
     On peut être ingénieur, administrateur et chef de projet à la fois, ou
     « juste » dessinateur. */
  var METIERS = {
    ingenieur: "Ingénieur", dessinateur: "Dessinateur", administratif: "Administratif"
  };
  // Côté sur lequel un métier reçoit des charges (équipe d'une affaire, charge d'une tâche)
  var COTES = { ingenieur: "ingenieur", dessinateur: "dessinateur" };
  function cote(m) { return COTES[m] || ""; }
  // Seuls ces métiers portent des tâches et paraissent au tableau de bord
  var PLANIFIES = { ingenieur: true, dessinateur: true };
  function libelleMetier(m) { return METIERS[m] || "À désigner"; }

  // Ordre des métiers dans les listes : ceux qui portent des tâches d'abord
  var ORDRE_METIERS = ["ingenieur", "dessinateur", "administratif", ""];
  var TITRES_METIERS = {
    ingenieur: "Ingénieurs", dessinateur: "Dessinateurs",
    administratif: "Administratifs", "": "À désigner"
  };

  /* Les groupes du bureau (13.10.2026 : groupes libres, réglés dans la
     console). Les membres en portent les codes dans « statuts » ; chaque groupe
     a un nom, un groupe supérieur (parent) et un rang parmi ses voisins. Un
     groupe a aussi les droits des groupes placés sous lui ; « Tout le monde »
     (tous) est le socle commun à chaque membre. Les listes ci-dessous suivent
     les groupes du bureau (poseGroupes) : elles se remplissent sur place, les
     pages qui les ont gardées en main voient donc les bons noms. */
  var GROUPES_DEFAUT = [
    { code: "tous", nom: "Tout le monde", parent: null, ordre: 0,
      droits: ["page_tableau", "page_equipe", "page_absences", "page_annuaire", "voir_conges_equipe", "voir_absences_avenir"] },
    { code: "administrateur", nom: "Administrateur", parent: null, ordre: 0,
      droits: ["affaires_creer", "taches_autrui", "absences_autrui", "page_inter", "conges_tous",
               "news_rediger", "news_archiver", "news_supprimer", "page_facturation", "facturation_saisir", "avancement_tous"] },
    { code: "chef_secteur", nom: "Chef de secteur", parent: "administrateur", ordre: 0,
      droits: ["affaires_creer", "taches_autrui", "absences_autrui", "page_affaires", "page_charge",
               "planning_equipe", "taches_a_affecter", "conges_secteur", "avancement_secteur"] },
    { code: "chef_projet", nom: "Chef de projet", parent: "chef_secteur", ordre: 0,
      droits: ["affaires_creer", "taches_autrui", "absences_autrui"] }
  ];
  // Intitulés des trois groupes d'origine, tant qu'ils gardent leur nom
  var COURTS_ORIGINE = { administrateur: "Admin.", chef_secteur: "Secteur", chef_projet: "Projet" };
  // « Chefs de secteur », et non « chef de secteurs » : le pluriel ne s'ajoute pas à la fin
  var PLURIELS_ORIGINE = { administrateur: "Administrateurs", chef_secteur: "Chefs de secteur", chef_projet: "Chefs de projet" };

  var GROUPES = [];               // groupes du bureau, tels que lus
  var ORDRE_STATUTS = [];         // codes des groupes, dans l'ordre de la hiérarchie (sans « tous »)
  var STATUTS = {};               // code → nom
  var STATUTS_COURTS = {};        // code → intitulé court, pour les listes denses
  var STATUTS_PLURIEL = {};       // code → nom au pluriel
  function libelleStatut(s) { return STATUTS[s] || s; }

  function texteGroupe(v) { return v == null ? "" : String(v).trim(); }
  function normaliseGroupe(g) {
    return {
      code: texteGroupe(g.code || g.statut), nom: texteGroupe(g.nom) || texteGroupe(g.code || g.statut),
      parent: texteGroupe(g.parent) || null, ordre: Number(g.ordre) || 0,
      droits: Array.isArray(g.droits) ? g.droits.map(texteGroupe).filter(Boolean) : []
    };
  }

  /** Les groupes rangés comme un arbre, de haut en bas : chaque groupe suivi de
   *  ceux placés sous lui, voisins par rang puis par nom. Sans « Tout le monde ».
   *  Chaque élément reçoit « niveau » (0 en tête). Un supérieur inconnu vaut
   *  « pas de supérieur » ; une boucle éventuelle est coupée. */
  function rangeGroupes(liste) {
    var l = (liste || []).map(normaliseGroupe).filter(function (g) { return g.code && g.code !== "tous"; });
    var codes = {}; l.forEach(function (g) { codes[g.code] = true; });
    var vus = {}, out = [];
    function enfants(parent) {
      return l.filter(function (g) { return (codes[g.parent] ? g.parent : null) === parent; })
        .sort(function (a, b) { return a.ordre - b.ordre || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }); });
    }
    function descend(parent, niveau) {
      enfants(parent).forEach(function (g) {
        if (vus[g.code]) return;
        vus[g.code] = true;
        g.niveau = niveau;
        out.push(g);
        descend(g.code, niveau + 1);
      });
    }
    descend(null, 0);
    // Pris dans une boucle : rangés à la fin, en tête de leur branche
    l.forEach(function (g) { if (!vus[g.code]) { vus[g.code] = true; g.niveau = 0; out.push(g); descend(g.code, 1); } });
    return out;
  }

  /** Ce qu'un groupe peut faire : ses droits propres, et ceux qu'il tient de
   *  « Tout le monde » et des groupes placés sous lui, avec leur origine.
   *  { propres: [...], herites: { droit: [codes] }, tous: [...] } */
  function droitsGroupe(liste, code) {
    var l = (liste || []).map(normaliseGroupe), par = {};
    l.forEach(function (g) { par[g.code] = g; });
    var g = par[code] || { droits: [] };
    var herites = {};
    function note(d, source) { (herites[d] || (herites[d] = [])).indexOf(source) < 0 && herites[d].push(source); }
    var vus = {}; vus[code] = true;
    (function descend(c) {
      l.forEach(function (x) {
        if (x.parent !== c || vus[x.code] || x.code === "tous") return;
        vus[x.code] = true;
        x.droits.forEach(function (d) { note(d, x.code); });
        descend(x.code);
      });
    })(code);
    if (code !== "tous" && par.tous) par.tous.droits.forEach(function (d) { note(d, "tous"); });
    var tous = g.droits.slice();
    Object.keys(herites).forEach(function (d) { if (tous.indexOf(d) < 0) tous.push(d); });
    return { propres: g.droits.slice(), herites: herites, tous: tous };
  }

  /** Les droits de quelqu'un qui porte ces groupes (Tout le monde compris). */
  function droitsDesStatuts(liste, statuts) {
    var out = droitsGroupe(liste, "tous").tous.slice();
    (statuts || []).forEach(function (s) {
      droitsGroupe(liste, s).tous.forEach(function (d) { if (out.indexOf(d) < 0) out.push(d); });
    });
    return out;
  }

  /** Les groupes du bureau affiché : noms et ordre de toutes les listes. */
  function poseGroupes(liste) {
    GROUPES = (Array.isArray(liste) && liste.length ? liste : GROUPES_DEFAUT).map(normaliseGroupe);
    var ranges = rangeGroupes(GROUPES);
    ORDRE_STATUTS.length = 0;
    [STATUTS, STATUTS_COURTS, STATUTS_PLURIEL].forEach(function (o) { Object.keys(o).forEach(function (k) { delete o[k]; }); });
    ranges.forEach(function (g) {
      ORDRE_STATUTS.push(g.code);
      var origine = GROUPES_DEFAUT.filter(function (x) { return x.code === g.code && x.nom === g.nom; })[0];
      STATUTS[g.code] = g.nom;
      STATUTS_COURTS[g.code] = origine ? COURTS_ORIGINE[g.code] : g.nom;
      STATUTS_PLURIEL[g.code] = origine ? PLURIELS_ORIGINE[g.code] : g.nom;
    });
    vuEnCache = null;
  }

  /* Les droits que la console coche, groupe par groupe (13.10.2026 : tout ce
     qui était écrit en dur — pages, vues, congés, tchat — est devenu un droit).
     Ajouter un droit se fait ici — la base accepte n'importe quel code, elle ne
     juge que ce qu'elle sait appliquer (a_droit, base-supabase.sql). Les pages
     et les vues ne sont qu'un rangement de l'interface ; les actions, la base
     les applique aussi. */
  var CATEGORIES_DROITS = [
    { titre: "Pages", droits: ["page_tableau", "page_equipe", "page_absences", "page_annuaire",
                               "page_affaires", "page_charge", "page_inter",
                               "page_facturation"] },
    { titre: "Ce qu'on voit", droits: ["planning_equipe", "taches_a_affecter", "voir_conges_equipe", "voir_absences_avenir"] },
    { titre: "Ce qu'on peut faire", droits: ["affaires_creer", "taches_autrui", "absences_autrui",
                                             "conges_secteur", "conges_tous", "tchat_moderer"] },
    { titre: "Avancement et facturation", droits: ["avancement_secteur", "avancement_tous", "facturation_saisir"] },
    { titre: "News du bureau", droits: ["news_rediger", "news_archiver", "news_supprimer"] }
  ];
  var ORDRE_DROITS = [].concat.apply([], CATEGORIES_DROITS.map(function (c) { return c.droits; }));
  var DROITS = {
    page_tableau: { titre: "Tableau de bord", aide: "La page Tableau de bord (planning par personne)." },
    page_equipe: { titre: "Équipe", aide: "La page Équipe : les fiches et les téléphones de chacun." },
    page_absences: { titre: "Absences et congés", aide: "La page des absences et des congés de l'équipe." },
    page_annuaire: { titre: "Annuaire", aide: "Le carnet d'adresses du bureau." },
    page_affaires: { titre: "Affaires", aide: "La page Affaires (liste, équipes, carte)." },
    page_charge: { titre: "Tableau de charge", aide: "La carte de charge, une case par personne et par semaine." },
    page_inter: { titre: "Appels d'offres", aide: "Le module Inter-secteurs : appels d'offres, agenda des AO, veille simap.ch." },
    page_facturation: {
      titre: "Facturation",
      aide: "La page Facturation (Inter-secteurs) : avancement et facturation de chaque phase, secteur par secteur. Elle montre aussi les pourcentages facturés, que les autres ne voient pas."
    },
    avancement_secteur: {
      titre: "Avancement de son secteur",
      aide: "Saisir l'avancement (%) des phases pour sa discipline, sur toutes les affaires. Le responsable d'une affaire saisit toujours celui de son affaire."
    },
    avancement_tous: {
      titre: "Avancement de toutes les affaires",
      aide: "Saisir l'avancement (%) de chaque phase et de chaque discipline, sur toutes les affaires."
    },
    facturation_saisir: {
      titre: "Saisir la facturation",
      aide: "Saisir le pourcentage facturé de chaque phase et de chaque discipline. Ce droit fait aussi voir la facturation."
    },
    planning_equipe: {
      titre: "Planning de toute l'équipe",
      aide: "Le tableau de bord montre tout le monde, et la page Équipe la charge de chacun. Sans ce droit, on n'y voit que ses tâches et les personnes qui y travaillent."
    },
    taches_a_affecter: { titre: "Tâches à affecter", aide: "L'encadré « Tâches à affecter » de l'accueil." },
    voir_conges_equipe: {
      titre: "Demandes de l'équipe en attente",
      aide: "Dans Communication, les demandes de congé des collègues qui attendent une décision. Celles qu'on valide soi-même restent toujours affichées."
    },
    voir_absences_avenir: {
      titre: "Absences à venir",
      aide: "Dans Communication, les absences de l'équipe des quatre prochaines semaines. Celles en cours restent affichées pour tous."
    },
    affaires_creer: {
      titre: "Ouvrir une affaire",
      aide: "Créer une nouvelle affaire (et un appel d'offres), et la retirer. Sans ce droit, on travaille normalement sur les affaires existantes."
    },
    taches_autrui: {
      titre: "Créer des tâches pour les autres",
      aide: "Sans ce droit, on ne crée et ne modifie que les tâches dont une part chargée est la sienne — en désignant librement qui tient l'autre part, et en pouvant passer la main à un collègue."
    },
    absences_autrui: {
      titre: "Poser les absences des autres",
      aide: "Et régler leurs jours travaillés, modifier tous les rendez-vous. Sans ce droit, chacun ne gère que ses propres absences, ses jours et ses rendez-vous."
    },
    conges_secteur: {
      titre: "Valider les congés de son secteur",
      aide: "Accepter ou refuser les demandes de congé des personnes de sa discipline — jamais les siennes."
    },
    conges_tous: {
      titre: "Valider tous les congés",
      aide: "Accepter ou refuser toutes les demandes de congé du bureau — jamais les siennes."
    },
    news_rediger: {
      titre: "Rédiger les news",
      aide: "Publier une news dans Communication, et modifier les siennes. Sans ce droit, on lit les news."
    },
    news_archiver: {
      titre: "Archiver les news",
      aide: "Retirer une news de la une (elle reste lisible dans les archives), ou la remettre en ligne."
    },
    news_supprimer: {
      titre: "Supprimer les news",
      aide: "Effacer une news pour de bon, archives comprises."
    },
    tchat_moderer: {
      titre: "Retirer les messages des autres",
      aide: "Au tchat du bureau. Sans ce droit, chacun ne retire que ses propres messages."
    }
  };
  // Page → droit qui l'ouvre. Accueil, Communication et Tâches sont à tous ; la console au super admin.
  var DROIT_PAGE = {
    tableau: "page_tableau", equipe: "page_equipe", absences: "page_absences", annuaire: "page_annuaire",
    affaires: "page_affaires", charge: "page_charge",
    veille: "page_inter", ao_publics: "page_inter", ao_prives: "page_inter", agenda_ao: "page_inter",
    facturation: "page_facturation"
  };
  /* Les pages du module Inter-secteurs (13.10.2026 : la veille, les AO publics,
     les AO privés et leur agenda séparés ; la facturation). « inter » est le
     module : il s'ouvre dès qu'une de ses pages est permise, sur la première. */
  var PAGES_INTER = [
    { cle: "veille", href: "/planif/inter-secteurs/", nom: "Veille simap.ch" },
    { cle: "ao_publics", href: "/planif/inter-secteurs/?vue=publics", nom: "AO publics" },
    { cle: "ao_prives", href: "/planif/inter-secteurs/?vue=prives", nom: "AO privés" },
    { cle: "agenda_ao", href: "/planif/inter-secteurs/?vue=agenda", nom: "Agenda des AO" },
    { cle: "facturation", href: "/planif/inter-secteurs/?vue=facturation", nom: "Facturation" }
  ];
  poseGroupes(null);

  /* Démonstration : rôle choisi dans le menu du compte (07.10.2026), pour voir
     l'outil comme chacun le verra. Retenu sur ce navigateur ; par défaut
     « Administrateur », le statut de Laurent Mercier. Le super admin a le même
     choix partout (09.10.2026), sous sa propre clé, « Admin du site » par
     défaut : c'est lui.
     Depuis le 12.10.2026, le rôle choisi ne règle plus seulement les pages
     (barre, palette, cartes de l'accueil) : l'interface prend ses statuts et
     les droits que le bureau leur accorde (profilVu) — boutons, congés à
     valider, retrait de messages, choix du bureau… exactement ce que verrait
     une personne de ce rôle. La base, elle, garde les vrais droits. */
  /* Depuis le 13.10.2026, la liste suit les groupes du bureau : du plus
     étroit au plus large, entre « Collaborateur » (Tout le monde seulement)
     et « Admin du site ». */
  function rolesDemoListe() {
    return [{ code: "collaborateur", nom: "Collaborateur", statuts: [] }]
      .concat(rangeGroupes(GROUPES).reverse().map(function (g) {
        return { code: g.code, nom: g.nom, statuts: [g.code] };
      }))
      .concat([{ code: "admin_site", nom: "Admin du site", statuts: null }]);
  }
  var CLE_ROLE_DEMO = "planif.demo.role", CLE_ROLE_SUPER = "planif.super.role";

  /** Les statuts d'un membre, dans l'ordre, débarrassés des valeurs inconnues. */
  function statutsDe(m) {
    var l = (m && m.statuts) || [];
    return ORDRE_STATUTS.filter(function (s) { return l.indexOf(s) >= 0; });
  }
  function aStatut(m, s) { return statutsDe(m).indexOf(s) >= 0; }

  /* Ordre alphabétique : prénom, puis nom quand deux prénoms sont identiques —
     c'est l'ordre dans lequel les noms s'affichent. Les deux champs sont comparés
     l'un après l'autre : collés, un nom court se rangeait mal. */
  function compareMembres(a, b) {
    return a.prenom.localeCompare(b.prenom, "fr", { sensitivity: "base" }) ||
           a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" });
  }

  /** Membres regroupés par métier, dans l'ordre des métiers, alphabétiques dans chaque groupe :
   *  [{ metier, titre, membres }], sans les groupes vides. */
  function parMetier(membres) {
    return ORDRE_METIERS.map(function (r) {
      return {
        metier: r, titre: TITRES_METIERS[r],
        membres: membres.filter(function (m) { return (METIERS[m.metier] ? m.metier : "") === r; }).sort(compareMembres)
      };
    }).filter(function (g) { return g.membres.length; });
  }

  /* Succursales et disciplines : propres à chaque bureau, elles arrivent avec le
     profil (base multi-bureaux). Les pages lisent ces trois objets directement :
     ils sont remplis sur place, jamais remplacés. Les codes commencent par une
     lettre, sinon l'ordre des clés d'un objet JavaScript ne serait plus celui de la liste. */
  var SUCCURSALES = {}, DISCIPLINES = {}, DISCIPLINES_PAR_SUCCURSALE = {};

  // Listes d'origine : mode local
  var LISTES_ORIGINE = {
    disciplines: [
      { code: "administrateurs", nom: "Administrateurs" },
      { code: "structure", nom: "Structure et ouvrages d'art" },
      { code: "geotechnique", nom: "Géotechnique / travaux spéciaux" },
      { code: "environnement", nom: "Environnement et développement durable" },
      { code: "investigation", nom: "Investigation géotechnique" },
      { code: "genie_civil", nom: "Génie civil et infrastructures" },
      { code: "administration", nom: "Administration" }
    ],
    // Disciplines présentes dans chaque succursale, dans l'ordre de la liste téléphonique
    succursales: [
      { code: "geneve", nom: "Genève", disciplines: ["administrateurs", "structure", "geotechnique", "environnement", "investigation", "genie_civil", "administration"] },
      { code: "lausanne", nom: "Lausanne", disciplines: ["administrateurs", "structure"] },
      { code: "nyon", nom: "Nyon", disciplines: ["structure"] }
    ]
  };

  function poseListes(l) {
    [SUCCURSALES, DISCIPLINES, DISCIPLINES_PAR_SUCCURSALE].forEach(function (o) {
      Object.keys(o).forEach(function (k) { delete o[k]; });
    });
    (l.disciplines || []).forEach(function (d) { DISCIPLINES[d.code] = d.nom; });
    (l.succursales || []).forEach(function (s) {
      SUCCURSALES[s.code] = s.nom;
      DISCIPLINES_PAR_SUCCURSALE[s.code] = (s.disciplines || []).filter(function (c) { return DISCIPLINES[c]; });
    });
  }
  poseListes(LISTES_ORIGINE);

  /** Disciplines proposées pour une succursale : les siennes, ou toutes si aucune n'y est rattachée. */
  function disciplinesDe(succursale) {
    var l = succursale && DISCIPLINES_PAR_SUCCURSALE[succursale];
    return l && l.length ? l.slice() : Object.keys(DISCIPLINES);
  }
  var STATUTS_TACHE = {
    a_faire: "À faire", en_cours: "En cours", attente: "En attente", termine: "Terminé"
  };
  var STATUTS_AFFAIRE = { active: "Active", suspendue: "Suspendue", terminee: "Terminée" };

  /* Phases SIA 112 (modèle de prestations), par leur numéro : celles où un bureau
     d'ingénieurs structure intervient. Rangées par numéro dans la base. */
  var PHASES = {
    // Avant toute phase SIA : l'offre du bureau (module Inter-secteurs)
    "AO": "Appel d'offres (offre du bureau)",
    "21": "Étude de faisabilité",
    "31": "Avant-projet",
    "32": "Projet de l'ouvrage",
    "33": "Demande d'autorisation",
    "41": "Appel d'offres",
    "51": "Projet d'exécution",
    "52": "Exécution de l'ouvrage",
    "53": "Mise en service, achèvement"
  };
  // « AO » vient avant les phases SIA, rangées par numéro
  var ORDRE_PHASES = ["AO"].concat(Object.keys(PHASES).filter(function (k) { return k !== "AO"; }).sort());
  // Les phases d'un mandat : les phases SIA seules
  var PHASES_MANDAT = ORDRE_PHASES.filter(function (k) { return k !== "AO"; });
  var RE_CODE = /^[a-z][a-z0-9_]{0,39}$/;

  /* Le mandat d'une affaire (13.10.2026) : les phases SIA pour lesquelles le
     bureau est mandaté, et les disciplines de chacune —
     { "31": ["geotechnique", "structure"], "32": ["structure"] }. Phases par
     numéro, disciplines par code : la base garde la même forme (affaires.mandat). */
  function reprisMandat(m) {
    var out = {};
    if (!m || typeof m !== "object" || Array.isArray(m)) return out;
    Object.keys(m).filter(function (p) { return /^\d{2}$/.test(p); }).sort().forEach(function (p) {
      var vus = {}, l = (Array.isArray(m[p]) ? m[p] : []).map(texte).filter(function (c) {
        if (!RE_CODE.test(c) || vus[c]) return false;
        return (vus[c] = true);
      }).sort();
      if (l.length) out[p] = l;
    });
    return out;
  }
  var GENRES_SAISIE = { avancement: "Avancement", facturation: "Facturation" };

  /* Appels d'offres et leur agenda (module Inter-secteurs, 06.10.2026) */
  var TYPES_AO = { public: "Public", prive: "Privé" };
  var RESULTATS_AO = { en_cours: "En cours", gagne: "Gagné", perdu: "Perdu", abandonne: "Abandonné" };
  var GENRES_AGENDA = {
    visite: "Visite des lieux", questions: "Questions", remise: "Remise de l'offre",
    ouverture: "Ouverture des offres", presentation: "Présentation", seance: "Séance", autre: "Autre"
  };
  var RE_HEURE = /^\d\d:\d\d$/;

  /* Demandes de congé (module Communication) */
  var STATUTS_CONGE = { en_attente: "En attente", acceptee: "Acceptée", refusee: "Refusée", annulee: "Annulée" };
  var MOTIFS_CONGE = ["Vacances", "Récupération", "Congé sans solde", "Congé spécial", "Formation"];
  /** « 32 · Projet de l'ouvrage », ou "" sans phase. Un numéro inconnu reste lisible tel quel. */
  function libellePhase(p) { return p ? p + (PHASES[p] ? " · " + PHASES[p] : "") : ""; }

  /* Les deux parts d'une tâche : le calcul, côté ingénieur, et le dessin.
     Chacune se termine de son côté — l'ingénieur qui boucle sa note libère sa
     charge sans fermer le dessin qui suit. Le statut n'en est que la synthèse. */
  var PARTS = {
    ingenieur:   { charge: "chargeInge",   membre: "ingenieurId",   fini: "finiInge",   label: "Calcul" },
    dessinateur: { charge: "chargeDessin", membre: "dessinateurId", fini: "finiDessin", label: "Dessin" }
  };

  /** L'écriture nomme-t-elle les parts ? Si oui, ce sont elles qui décident. */
  function partsNommees(o) { return ("finiInge" in o) || ("finiDessin" in o); }

  /**
   * Remet d'accord les parts et le statut après une écriture.
   *  · une part de charge nulle n'existe pas : son drapeau retombe ;
   *  · la tâche est « Terminé » exactement quand toutes ses parts le sont ;
   *  · terminer ou rouvrir la tâche par son statut entraîne ses parts, alors
   *    qu'une écriture qui nomme les parts garde le dernier mot.
   */
  function accordeParts(t, parts, etaitTermine) {
    var aInge = t.chargeInge > 0, aDessin = t.chargeDessin > 0;
    if (!aInge && !aDessin) return t;                  // tâche sans charge : rien à accorder
    if (!parts) {
      if (t.statut === "termine") { t.finiInge = true; t.finiDessin = true; }
      else if (etaitTermine) { t.finiInge = false; t.finiDessin = false; }
    }
    t.finiInge = aInge && t.finiInge === true;
    t.finiDessin = aDessin && t.finiDessin === true;
    if ((!aInge || t.finiInge) && (!aDessin || t.finiDessin)) {
      t.statut = "termine";
      t.avancement = 100;
    } else if (t.statut === "termine") {
      t.statut = "en_cours";                           // une part rouverte rouvre la tâche
    } else if (t.statut === "a_faire" && (t.finiInge || t.finiDessin)) {
      t.statut = "en_cours";                           // une moitié bouclée : la tâche a bien démarré
    }
    return t;
  }

  function etatVierge() {
    return {
      version: VERSION,
      reglages: { canton: "VD", capaciteDefaut: 5, demo: false },
      membres: [], affaires: [], taches: [], contacts: [], avis: [], agenda: [], rdv: [], conges: [],
      veille: [], veilleSuivi: [],
      // Avancement et facturation (%) du mandat, une ligne par saisie (historique)
      saisies: []
    };
  }

  /* ------------------------------------------------ adaptateur de stockage */

  var ADAPTATEUR_LOCAL = {
    nom: "navigateur",
    semeSiVide: true,
    lire: function () {
      return new Promise(function (res) {
        var brut = null;
        try { brut = global.localStorage.getItem(CLE); } catch (e) { brut = null; }
        if (!brut) return res(null);
        try { res(JSON.parse(brut)); } catch (e) { res(null); }
      });
    },
    ecrire: function (etat) {
      return new Promise(function (res, rej) {
        try { global.localStorage.setItem(CLE, JSON.stringify(etat)); res(); }
        catch (e) { rej(erreur("Enregistrement impossible : l'espace de stockage du navigateur est plein ou bloqué.")); }
      });
    }
  };

  /* ------------------------------------------------------------ état vivant */

  // La base l'emporte dès qu'elle est configurée ; sinon, le navigateur.
  var ADAPTATEUR = (global.Sb && global.Sb.configure) ? global.Sb.ADAPT : ADAPTATEUR_LOCAL;

  var etat = null;
  var precedent = null;        // dernier état réellement enregistré, pour le calcul des écarts
  var rechargements = [];
  var chargement = null;

  /* ---------------------------------------------------------------- profil
     Qui est connecté, dans quel bureau, avec quels droits. En mode local :
     un seul bureau, et tous les droits. */

  var profil = null, profilEnCours = null;
  function avecBaseConnectee() { return !!(global.Sb && global.Sb.configure && global.Sb.connecte()); }

  // Les messages commencent par « Accès refusé » : UI.echec déconnecte et renvoie à la connexion
  var REFUS = {
    inconnu: "Accès refusé : ton adresse n'est pas autorisée. Demande l'accès à l'administrateur de l'outil.",
    suspendu: "Accès refusé : ton accès est suspendu.",
    bureau_suspendu: "Accès refusé : ton bureau est suspendu.",
    sans_bureau: "Accès refusé : ton adresse n'est rattachée à aucun bureau."
  };

  /** forcer : relit le profil (la console, après avoir créé ou renommé un bureau). */
  function chargeProfil(forcer) {
    if (profilEnCours && !forcer) return profilEnCours;
    var lecture = ADAPTATEUR.profil ? ADAPTATEUR.profil() : Promise.resolve(null);
    profilEnCours = lecture.then(function (brut) {
      if (!brut) {
        // Mode local : un seul utilisateur, sur sa propre machine — tous les droits.
        poseGroupes(null);
        profil = { multi: false, superAdmin: false, peutTout: true, metier: "", statuts: [],
                   droits: ORDRE_DROITS.slice(), bureau: null, bureaux: [] };
        return profil;
      }
      if (!brut.autorise) throw erreur(REFUS[brut.motif] || REFUS.inconnu);
      // Les groupes du bureau : noms, hiérarchie et droits de toutes les listes
      poseGroupes(brut.groupes);
      var statuts = (brut.statuts || []).map(texte).filter(function (s) { return STATUTS[s]; });
      profil = {
        multi: true, email: brut.email || "", superAdmin: !!brut.superAdmin,
        // Fiche du planning rattachée à cette adresse dans la console (vide : accès sans fiche)
        membreId: brut.membreId || null,
        // Métier et statuts de cette fiche : sur quoi s'appuieront les droits d'accès
        metier: METIERS[brut.metier] ? brut.metier : "",
        statuts: ORDRE_STATUTS.filter(function (s) { return statuts.indexOf(s) >= 0; }),
        /* Les droits que ses groupes lui accordent (hérités compris), réunis
           par la base. Ils servent à ne pas proposer l'impossible ; c'est la
           base qui tranche. */
        droits: (brut.droits || []).map(texte),
        // Tout effacer, importer : réservés au super admin quand il y a plusieurs bureaux
        peutTout: !!brut.superAdmin,
        bureau: brut.bureau || null, bureaux: brut.bureaux || []
      };
      poseListes({ succursales: brut.succursales || [], disciplines: brut.disciplines || [] });
      return profil;
    });
    profilEnCours.catch(function () { profilEnCours = null; });
    return profilEnCours;
  }

  /* Le profil tel que l'interface doit le voir : le vrai, ou celui du rôle
     choisi dans « Voir l'outil en tant que » — ni super admin, ni « tout
     gérer », le groupe du rôle et les droits que le bureau lui donne, hérités
     compris (droits_groupes ; à défaut, ceux d'un bureau neuf). */
  var vuEnCache = null;
  function profilVu() {
    if (!profil) return profil;
    var r = D.roleDemo();
    if (!r || !r.statuts) return profil;
    if (vuEnCache && vuEnCache.base === profil && vuEnCache.code === r.code) return vuEnCache.vu;
    var vu = {};
    Object.keys(profil).forEach(function (k) { vu[k] = profil[k]; });
    var droits = droitsDesStatuts(GROUPES, r.statuts);
    vu.superAdmin = false;
    vu.peutTout = false;
    vu.statuts = r.statuts.slice();
    vu.droits = ORDRE_DROITS.filter(function (d) { return droits.indexOf(d) >= 0; })
      .concat(droits.filter(function (d) { return ORDRE_DROITS.indexOf(d) < 0; }));
    vu.roleVu = r.code;
    vuEnCache = { base: profil, code: r.code, vu: vu };
    return vu;
  }

  /* Les écritures partent une par une, dans l'ordre des actions.
     Deux écritures simultanées calculaient leur écart depuis la même référence :
     deux décalages rapides pouvaient arriver dans le désordre, et une écriture
     réussie marquait comme enregistré ce qu'une autre, encore en route, allait
     peut-être rater. Chaque écriture emporte donc sa photo de l'état, et c'est
     cette photo — pas l'état du moment où elle se termine — qui devient la référence. */
  var file = Promise.resolve();
  var generation = 0;           // change à chaque échec : les écritures en attente qui en dépendaient sont abandonnées

  /* Écritures en cours et heure de la dernière : les mises à jour en direct
     (direct.js) reconnaissent ainsi l'écho de nos propres enregistrements. */
  var ecrituresEnCours = 0, derniereEcriture = 0;

  function enFile(ecrire, instantane) {
    var gen = generation;
    ecrituresEnCours++;
    var ecriture = file.then(function () {
      if (gen !== generation) throw erreur("Modification abandonnée : l'enregistrement précédent a échoué.");
      return ecrire();
    });
    ecriture.then(fini, fini);
    function fini() { ecrituresEnCours--; derniereEcriture = Date.now(); }
    ecriture = ecriture.then(function () {
      precedent = instantane;
      version++;
      return etat;
    }, function (e) {
      if (gen !== generation) throw e;
      generation++;
      return resynchronise().then(function () { throw e; });
    });
    file = ecriture.catch(function () {});
    return ecriture;
  }

  function sauve() {
    version++;                                     // l'état a bougé : index et calculs mis en cache sont périmés
    var instantane = copie(etat);
    return enFile(function () { return ADAPTATEUR.ecrire(instantane, precedent); }, instantane);
  }

  /* Écriture refusée ou interrompue : garder l'écran tel quel ferait croire à
     un enregistrement, et la même écriture serait rejouée — et refusée — à
     chaque action suivante. On relit la base, seule à savoir ce qui est
     vraiment passé (une écriture coupée à mi-chemin a pu en enregistrer une
     partie). Base injoignable : retour au dernier état confirmé. */
  function resynchronise() {
    return ADAPTATEUR.lire().then(function (brut) {
      if (!brut) throw erreur("Lecture vide.");
      etat = normalise(brut);
      precedent = copie(etat);
    }).catch(function () {
      etat = precedent ? copie(precedent) : etatVierge();
    }).then(function () {
      version++;
      rechargements.forEach(function (f) { try { f(etat); } catch (e) { console.error(e); } });
    });
  }

  /* ------------------------------------------------------------- index
     Avec des milliers de tâches, retrouver une affaire ou un membre en
     parcourant toute la liste, à chaque ligne affichée, coûtait des centaines
     de millisecondes par frappe. L'index est reconstruit à la demande quand
     l'état a changé : version, ou tableau remplacé ou rallongé. */

  var version = 0;
  var index = null;

  function idx() {
    if (index && index.v === version &&
        index.m === etat.membres && index.nm === etat.membres.length &&
        index.a === etat.affaires && index.na === etat.affaires.length &&
        index.t === etat.taches && index.nt === etat.taches.length) return index;

    var membres = Object.create(null), affaires = Object.create(null), taches = Object.create(null), parAffaire = Object.create(null);
    etat.membres.forEach(function (m) { membres[m.id] = m; });
    etat.affaires.forEach(function (a) { affaires[a.id] = a; });
    etat.taches.forEach(function (t) {
      taches[t.id] = t;
      (parAffaire[t.affaireId] || (parAffaire[t.affaireId] = [])).push(t);
    });
    // Par échéance ; à échéance égale, la priorité départage (1 devant 5)
    var triees = etat.taches.slice().sort(function (a, b) {
      var ea = a.echeance || "9999", eb = b.echeance || "9999";
      if (ea !== eb) return ea < eb ? -1 : 1;
      return (a.priorite || 5) - (b.priorite || 5);
    });
    index = {
      v: version, m: etat.membres, nm: etat.membres.length, a: etat.affaires, na: etat.affaires.length,
      t: etat.taches, nt: etat.taches.length,
      membres: membres, affaires: affaires, taches: taches, parAffaire: parAffaire, triees: triees
    };
    return index;
  }

  /* Ancienne sauvegarde : une seule colonne « role », où « administrateur »
     valait ingénieur associé. On la relit en métier d'un côté, statut de l'autre.
     Ni l'un ni l'autre : très vieille sauvegarde, où tout le monde dessinait. */
  function reprisMetier(m) {
    if (m.metier === undefined && m.role === undefined) return "dessinateur";
    var v = texte(m.metier !== undefined ? m.metier : m.role);
    if (v === "administrateur") return "ingenieur";
    return METIERS[v] ? v : "";
  }
  function reprisStatuts(m) {
    // Tous les codes sont gardés : les groupes du bureau ne sont peut-être pas encore lus
    var l = (Array.isArray(m.statuts) ? m.statuts : []).map(texte).filter(Boolean);
    if (m.metier === undefined && texte(m.role) === "administrateur" && l.indexOf("administrateur") < 0) l.push("administrateur");
    return l;
  }

  /** Complète un état lu du stockage : champs manquants, migrations. */
  function normalise(brut) {
    var e = etatVierge();
    if (!brut || typeof brut !== "object") return e;
    e.version = VERSION;
    if (brut.reglages) {
      e.reglages.canton = texte(brut.reglages.canton) || "VD";
      e.reglages.capaciteDefaut = nombre(brut.reglages.capaciteDefaut, 5);
      e.reglages.demo = !!brut.reglages.demo;
    }
    (brut.membres || []).forEach(function (m) {
      e.membres.push({
        id: texte(m.id) || id(),
        nom: texte(m.nom), prenom: texte(m.prenom), email: texte(m.email),
        metier: reprisMetier(m), statuts: reprisStatuts(m),
        succursale: SUCCURSALES[m.succursale] ? m.succursale : "",
        discipline: DISCIPLINES[m.discipline] ? m.discipline : "",
        capacite: nombre(m.capacite, e.reglages.capaciteDefaut),
        jours: reprisJours(m.jours),
        actif: m.actif !== false,
        telInterne: texte(m.telInterne), telExterne: texte(m.telExterne), telNatel: texte(m.telNatel),
        photo: /^data:image\//.test(texte(m.photo)) ? texte(m.photo) : null,
        absences: (m.absences || []).map(function (a) {
          return { id: texte(a.id) || id(), debut: texte(a.debut), fin: texte(a.fin) || texte(a.debut), motif: texte(a.motif) };
        })
      });
    });
    (brut.affaires || []).forEach(function (a) {
      e.affaires.push({
        id: texte(a.id) || id(),
        code: texte(a.code), nom: texte(a.nom), note: texte(a.note),
        teinte: Math.min(8, Math.max(1, parseInt(a.teinte, 10) || 1)),
        statut: STATUTS_AFFAIRE[a.statut] ? a.statut : "active",
        echeance: texte(a.echeance) || null,
        phase: texte(a.phase) || null,
        adresse: texte(a.adresse),
        succursale: SUCCURSALES[a.succursale] ? a.succursale : "",
        aoType: TYPES_AO[a.aoType] ? a.aoType : null,
        demandeurId: texte(a.demandeurId) || null,
        responsableId: texte(a.responsableId) || null,
        aoResultat: RESULTATS_AO[a.aoResultat] ? a.aoResultat : null,
        aoMontant: a.aoMontant == null || a.aoMontant === "" ? null : Math.max(0, nombre(a.aoMontant, 0)),
        secteurs: (a.secteurs || []).map(texte).filter(Boolean),
        mandat: reprisMandat(a.mandat),
        ingenieurs: (a.ingenieurs || []).map(texte),
        dessinateurs: (a.dessinateurs || []).map(texte)
      });
    });
    (brut.taches || []).forEach(function (t) {
      // accordeParts rattrape les tâches d'avant les parts : « Terminé » ferme les deux
      e.taches.push(accordeParts({
        id: texte(t.id) || id(),
        affaireId: texte(t.affaireId),
        titre: texte(t.titre), note: texte(t.note),
        chargeInge: Math.max(0, nombre(t.chargeInge, 0)),
        chargeDessin: Math.max(0, nombre(t.chargeDessin, 0)),
        debut: null,                            // toujours déduit de l'échéance (calculs.js)
        echeance: texte(t.echeance) || null,
        ingenieurId: texte(t.ingenieurId) || null,
        dessinateurId: texte(t.dessinateurId) || null,
        statut: STATUTS_TACHE[t.statut] ? t.statut : "a_faire",
        avancement: Math.min(100, Math.max(0, nombre(t.avancement, 0))),
        finiInge: t.finiInge === true,
        finiDessin: t.finiDessin === true,
        enchaine: t.enchaine === true,
        // Fin propre de la part calcul d'une tâche enchaînée (calculs.js, finPart) ; vide : elle suit le dessin
        finCalcul: texte(t.finCalcul) || null,
        // 1 la plus importante, 5 par défaut. Réglée par le curseur du formulaire
        // de tâche ; colonne taches.priorite en base.
        priorite: Math.min(5, Math.max(1, parseInt(t.priorite, 10) || 5)),
        cree: texte(t.cree) || new Date().toISOString(),
        maj: texte(t.maj) || new Date().toISOString()
        // À la lecture, « Terminé » prime : une tâche d'avant les parts, ou
        // reprise d'un jeu d'essai, retrouve ses deux parts fermées.
      }, t.statut !== "termine" && partsNommees(t), false));
    });
    (brut.contacts || []).forEach(function (c) {
      e.contacts.push({
        id: texte(c.id) || id(),
        nom: texte(c.nom), prenom: texte(c.prenom), societe: texte(c.societe),
        telephone: texte(c.telephone), natel: texte(c.natel), email: texte(c.email),
        site: texte(c.site), role: texte(c.role), adresse: texte(c.adresse), npa: texte(c.npa),
        localite: texte(c.localite), canton: texte(c.canton), pays: texte(c.pays),
        observations: texte(c.observations)
      });
    });
    (brut.avis || []).forEach(function (a) {
      var debut = texte(a.debut).slice(0, 16), fin = texte(a.fin).slice(0, 16);
      if (!RE_INSTANT.test(debut) || !RE_INSTANT.test(fin)) return;
      e.avis.push({ id: texte(a.id) || id(), membreId: texte(a.membreId), debut: debut, fin: fin,
                    motif: texte(a.motif) || "Absence", cree: texte(a.cree) || new Date().toISOString() });
    });
    // Veille simap.ch : publications en lecture seule (la tâche planifiée les écrit), suivi du bureau
    (brut.veille || []).forEach(function (v) {
      if (!texte(v.id)) return;
      e.veille.push({ id: texte(v.id), publicationId: texte(v.publicationId), titre: texte(v.titre),
        description: texte(v.description), adjudicateur: texte(v.adjudicateur), canton: texte(v.canton), lieu: texte(v.lieu),
        procedure: texte(v.procedure), typePublication: texte(v.typePublication), sousType: texte(v.sousType),
        cpv: (v.cpv || []).map(texte), bkp: (v.bkp || []).map(texte), publieLe: texte(v.publieLe).slice(0, 10) || null,
        delai: texte(v.delai) || null, lien: texte(v.lien), motifs: (v.motifs || []).map(texte) });
    });
    (brut.veilleSuivi || []).forEach(function (x) {
      if (!texte(x.aoId) || (x.etat !== "ecartee" && x.etat !== "retenue")) return;
      e.veilleSuivi.push({ id: texte(x.id) || id(), aoId: texte(x.aoId), etat: x.etat,
        affaireId: texte(x.affaireId) || null, par: texte(x.par) || null, le: texte(x.le) || new Date().toISOString() });
    });
    (brut.conges || []).forEach(function (c) {
      if (!texte(c.membreId) || !texte(c.debut)) return;
      e.conges.push({ id: texte(c.id) || id(), membreId: texte(c.membreId), debut: texte(c.debut).slice(0, 10),
                      fin: texte(c.fin || c.debut).slice(0, 10), motif: texte(c.motif) || "Vacances",
                      commentaire: texte(c.commentaire), statut: STATUTS_CONGE[c.statut] ? c.statut : "en_attente",
                      validePar: texte(c.validePar) || null, valideLe: texte(c.valideLe) || null,
                      reponse: texte(c.reponse), absenceId: texte(c.absenceId) || null,
                      cree: texte(c.cree) || new Date().toISOString() });
    });
    (brut.rdv || []).forEach(function (r) {
      if (!texte(r.jour) || !texte(r.titre)) return;
      var de = texte(r.debut).slice(0, 5), a = texte(r.fin).slice(0, 5);
      e.rdv.push({ id: texte(r.id) || id(), titre: texte(r.titre), jour: texte(r.jour).slice(0, 10),
                   debut: RE_HEURE.test(de) ? de : "", fin: RE_HEURE.test(a) ? a : "",
                   lieu: texte(r.lieu), note: texte(r.note),
                   participants: (r.participants || []).map(texte).filter(Boolean),
                   creePar: texte(r.creePar) || null, source: r.source === "outlook" ? "outlook" : "planif",
                   externeId: texte(r.externeId) || null });
    });
    (brut.saisies || []).forEach(function (x) {
      var v = parseInt(x.valeur, 10);
      if (!texte(x.affaireId) || !/^\d{2}$/.test(texte(x.phase)) || !RE_CODE.test(texte(x.discipline)) ||
          !GENRES_SAISIE[x.genre] || !(v >= 0 && v <= 100)) return;
      e.saisies.push({ id: texte(x.id) || id(), affaireId: texte(x.affaireId), phase: texte(x.phase),
                       discipline: texte(x.discipline), genre: x.genre, valeur: v,
                       par: texte(x.par) || null, le: texte(x.le) || new Date().toISOString() });
    });
    (brut.agenda || []).forEach(function (r) {
      if (!texte(r.jour) || !texte(r.affaireId)) return;
      var h = texte(r.heure).slice(0, 5);
      e.agenda.push({ id: texte(r.id) || id(), affaireId: texte(r.affaireId), jour: texte(r.jour).slice(0, 10),
                      heure: RE_HEURE.test(h) ? h : "", genre: GENRES_AGENDA[r.genre] ? r.genre : "autre",
                      titre: texte(r.titre), lieu: texte(r.lieu), note: texte(r.note) });
    });
    return e;
  }

  /**
   * Une sauvegarde faite avant le passage à la base porte des identifiants
   * courts, que PostgreSQL refuse. On les remplace par des UUID en reportant
   * la correspondance sur toutes les références, pour qu'une saisie faite en
   * local puisse être reversée telle quelle dans la base.
   * tout : renouvelle aussi les UUID. Un fichier exporté d'un autre bureau
   * porte les identifiants de lignes qui existent déjà là-bas : réécrits tels
   * quels, la base les aurait refusés en plein import, après l'effacement.
   */
  function renumerote(e, tout) {
    var vers = {};
    function neuf(ancien) {
      if (!ancien) return ancien;
      if (!tout && RE_UUID.test(ancien)) return ancien;
      if (!vers[ancien]) vers[ancien] = id();
      return vers[ancien];
    }
    e.membres.forEach(function (m) {
      m.id = neuf(m.id);
      m.absences.forEach(function (a) { a.id = neuf(a.id); });
    });
    e.affaires.forEach(function (a) {
      a.id = neuf(a.id);
      a.ingenieurs = a.ingenieurs.map(neuf);
      a.dessinateurs = a.dessinateurs.map(neuf);
    });
    e.taches.forEach(function (t) {
      t.id = neuf(t.id);
      t.affaireId = neuf(t.affaireId);
      t.ingenieurId = neuf(t.ingenieurId);
      t.dessinateurId = neuf(t.dessinateurId);
    });
    // Les fiches de l'annuaire ne pendent à rien : seul leur identifiant change
    (e.contacts || []).forEach(function (c) { c.id = neuf(c.id); });
    (e.avis || []).forEach(function (a) { a.id = neuf(a.id); a.membreId = neuf(a.membreId); });
    (e.agenda || []).forEach(function (r) { r.id = neuf(r.id); r.affaireId = neuf(r.affaireId); });
    (e.saisies || []).forEach(function (x) { x.id = neuf(x.id); x.affaireId = neuf(x.affaireId); x.par = neuf(x.par); });
    (e.rdv || []).forEach(function (r) { r.id = neuf(r.id); r.participants = r.participants.map(neuf); r.creePar = neuf(r.creePar); });
    (e.veilleSuivi || []).forEach(function (x) { x.id = neuf(x.id); x.affaireId = neuf(x.affaireId); x.par = neuf(x.par); });
    (e.conges || []).forEach(function (c) { c.id = neuf(c.id); c.membreId = neuf(c.membreId); c.validePar = neuf(c.validePar); c.absenceId = neuf(c.absenceId); });
    e.affaires.forEach(function (a) { a.demandeurId = neuf(a.demandeurId); a.responsableId = neuf(a.responsableId); });

    // Références orphelines : la base les refuserait, on les coupe ici.
    var vraisM = {}, vraisA = {};
    e.membres.forEach(function (m) { vraisM[m.id] = true; });
    e.affaires.forEach(function (a) { vraisA[a.id] = true; });
    e.affaires.forEach(function (a) {
      a.ingenieurs = a.ingenieurs.filter(function (x) { return vraisM[x]; });
      a.dessinateurs = a.dessinateurs.filter(function (x) { return vraisM[x]; });
      if (a.responsableId && !vraisM[a.responsableId]) a.responsableId = null;
    });
    e.taches = e.taches.filter(function (t) { return vraisA[t.affaireId]; });
    e.avis = (e.avis || []).filter(function (a) { return vraisM[a.membreId]; });
    e.agenda = (e.agenda || []).filter(function (r) { return vraisA[r.affaireId]; });
    e.saisies = (e.saisies || []).filter(function (x) { return vraisA[x.affaireId]; });
    e.saisies.forEach(function (x) { if (!vraisM[x.par]) x.par = null; });
    e.conges = (e.conges || []).filter(function (c) { return vraisM[c.membreId]; });
    (e.rdv || []).forEach(function (r) {
      r.participants = r.participants.filter(function (x) { return vraisM[x]; });
      if (!vraisM[r.creePar]) r.creePar = null;
    });
    var vraisC = {};
    (e.contacts || []).forEach(function (c) { vraisC[c.id] = true; });
    e.affaires.forEach(function (a) { if (!vraisC[a.demandeurId]) a.demandeurId = null; });
    e.taches.forEach(function (t) {
      if (!vraisM[t.ingenieurId]) t.ingenieurId = null;
      if (!vraisM[t.dessinateurId]) t.dessinateurId = null;
    });
    return e;
  }

  /* ----------------------------------------------------------- validations */

  var RE_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* Une absence est une période pleine : pas de demi-journée, et pas deux
     périodes sur le même jour — sinon les jours d'absence seraient comptés
     deux fois dans le calendrier, et la capacité, elle, ne tomberait qu'une. */
  function valideAbsence(m, o, idExistant) {
    var debut = texte(o.debut), fin = texte(o.fin) || debut;
    if (!debut) throw erreur("Indique la date de début de l'absence.");
    if (global.Cal.diff(debut, fin) < 0) throw erreur("La fin de l'absence précède son début.");
    var chevauche = m.absences.filter(function (a) {
      return a.id !== idExistant && a.debut <= fin && debut <= (a.fin || a.debut);
    })[0];
    if (chevauche) {
      throw erreur("Cette période en recouvre une autre : « " + chevauche.motif + " » du " +
        global.Cal.fmtCH(chevauche.debut) + " au " + global.Cal.fmtCH(chevauche.fin) + ".");
    }
    return { debut: debut, fin: fin, motif: texte(o.motif) || "Absence" };
  }

  /* Un avis d'absence prévient le bureau à l'heure près (un rendez-vous, un
     après-midi sur un chantier). Il ne touche pas au planning : les absences,
     en jours entiers, s'en chargent. Heures locales « AAAA-MM-JJTHH:MM ». */
  var RE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  function valideAvis(o) {
    var debut = texte(o.debut), fin = texte(o.fin);
    if (!RE_INSTANT.test(debut)) throw erreur("Indique le jour et l'heure du début.");
    if (!RE_INSTANT.test(fin)) throw erreur("Indique le jour et l'heure de la fin.");
    if (fin <= debut) throw erreur("La fin doit venir après le début.");
    var motif = texte(o.motif) || "Absence";
    if (motif.length > 200) throw erreur("Motif trop long : 200 caractères au plus.");
    return { membreId: texte(o.membreId), debut: debut, fin: fin, motif: motif };
  }

  /* Une fiche d'annuaire n'a presque rien d'obligatoire : on note ce qu'on a,
     un numéro griffonné vaut mieux qu'une fiche non créée. Mais sans nom ni
     société, elle ne se retrouverait pas — la base pose la même condition. */
  /* Le site s'écrit comme on veut — « uspi-ge.ch » ou « https://www.uspi-ge.ch » :
     le schéma est retiré à l'enregistrement, l'interface le rétablit pour le
     lien et n'affiche que le domaine. Ce qui ne ressemble pas à une adresse
     est refusé, sans quoi on stockerait un lien qui ne mène nulle part. */
  function valideSite(v) {
    var site = texte(v).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (!site) return "";
    if (/\s/.test(site) || !/^[^\s\/]+\.[^\s\/]{2,}/.test(site)) {
      throw erreur("Cette adresse de site n'est pas valide : « uspi-ge.ch », ou l'adresse complète copiée du navigateur.");
    }
    return site;
  }

  /** Adresse complète du site, pour un lien. Vide si la fiche n'en porte pas. */
  function urlSite(c) { return c && c.site ? "https://" + c.site : ""; }

  function valideContact(o) {
    var nom = texte(o.nom), societe = texte(o.societe);
    if (!nom && !societe) throw erreur("Donne au moins un nom ou une société : sans l'un ni l'autre, la fiche resterait introuvable.");
    var mail = texte(o.email).toLowerCase();
    if (mail && !RE_MAIL.test(mail)) throw erreur("Cette adresse e-mail n'est pas valide.");
    return {
      nom: nom, prenom: texte(o.prenom), societe: societe,
      telephone: texte(o.telephone), natel: texte(o.natel), email: mail,
      site: valideSite(o.site),
      role: texte(o.role), adresse: texte(o.adresse), npa: texte(o.npa),
      localite: texte(o.localite),
      // Le canton s'écrit en abrégé, et en majuscules : « vd » devient « VD »
      canton: texte(o.canton).toUpperCase(),
      pays: texte(o.pays), observations: texte(o.observations)
    };
  }

  /** Une fiche se range sous son nom, ou sous sa société quand elle n'en a pas. */
  function cleContact(c) { return ((c.nom || c.societe) + " " + c.prenom).trim(); }

  function valideAffaire(o, idExistant) {
    if (!texte(o.nom)) throw erreur("Le libellé de l'affaire est obligatoire.");
    var code = texte(o.code);
    // Le numéro est facultatif (13.10.2026) ; s'il est donné, il reste unique dans le bureau
    var double = !!code && etat.affaires.some(function (a) {
      return a.id !== idExistant && a.code && a.code.toLowerCase() === code.toLowerCase();
    });
    if (double) throw erreur("Une affaire porte déjà le numéro « " + code + " ».");
    var v = {
      code: code, nom: texte(o.nom), note: texte(o.note),
      teinte: Math.min(8, Math.max(1, parseInt(o.teinte, 10) || 1)),
      statut: STATUTS_AFFAIRE[o.statut] ? o.statut : "active",
      echeance: texte(o.echeance) || null,
      // Tant que la base ignore la colonne, la phase n'est pas retenue : elle se perdrait au rechargement
      phase: texte(o.phase) || null,
      adresse: texte(o.adresse).replace(/\s+/g, " "),
      ingenieurs: (o.ingenieurs || []).filter(Boolean),
      dessinateurs: (o.dessinateurs || []).filter(Boolean)
    };
    // Appel d'offres et secteurs : seulement quand le formulaire les porte (module
    // Inter-secteurs) ; le formulaire des affaires ne les connaît pas et les laisse en l'état.
    if ("aoType" in o) v.aoType = TYPES_AO[o.aoType] ? o.aoType : null;
    if ("demandeurId" in o) v.demandeurId = texte(o.demandeurId) || null;
    // Responsable d'affaire : seulement quand le formulaire le porte (13.10.2026)
    if ("responsableId" in o) {
      v.responsableId = texte(o.responsableId) || null;
      if (v.responsableId && !D.membre(v.responsableId)) throw erreur("Ce responsable n'est plus dans l'équipe.");
    }
    if ("aoResultat" in o) v.aoResultat = RESULTATS_AO[o.aoResultat] ? o.aoResultat : null;
    if ("aoMontant" in o) {
      var mt = texte(o.aoMontant).replace(/['’\s]/g, "");
      if (mt && !(parseFloat(mt.replace(",", ".")) >= 0)) throw erreur("Le montant de l'offre doit être un nombre (CHF).");
      v.aoMontant = mt ? Math.round(parseFloat(mt.replace(",", "."))) : null;
    }
    if ("secteurs" in o) v.secteurs = (o.secteurs || []).map(texte).filter(Boolean);
    // Succursale de l'affaire (13.10.2026), facultative : seulement quand le formulaire la porte
    if ("succursale" in o) v.succursale = SUCCURSALES[texte(o.succursale)] ? texte(o.succursale) : "";
    // Mandat : phases SIA et disciplines de chacune, seulement quand le formulaire le porte
    if ("mandat" in o) v.mandat = reprisMandat(o.mandat);
    return v;
  }

  function valideRdv(o) {
    if (!texte(o.titre)) throw erreur("Donne un intitulé au rendez-vous.");
    if (!texte(o.jour)) throw erreur("La date est obligatoire.");
    var de = texte(o.debut), a = texte(o.fin);
    if ((de && !RE_HEURE.test(de)) || (a && !RE_HEURE.test(a))) throw erreur("Heures à saisir sous la forme 14:30.");
    if (de && a && a <= de) throw erreur("La fin doit venir après le début.");
    var gens = (o.participants || []).map(texte).filter(function (x) { return x && idx().membres[x]; });
    return { titre: texte(o.titre).slice(0, 200), jour: texte(o.jour), debut: de, fin: de ? a : "",
             lieu: texte(o.lieu).slice(0, 200), note: texte(o.note), participants: gens };
  }

  function valideEvenement(o) {
    if (!texte(o.affaireId) || !etat.affaires.some(function (a) { return a.id === o.affaireId; })) throw erreur("Choisis l'appel d'offres concerné.");
    if (!texte(o.jour)) throw erreur("La date est obligatoire.");
    if (!texte(o.titre)) throw erreur("Donne un intitulé au rendez-vous.");
    var h = texte(o.heure);
    if (h && !RE_HEURE.test(h)) throw erreur("Heure à saisir sous la forme 14:30.");
    return { affaireId: texte(o.affaireId), jour: texte(o.jour), heure: h,
             genre: GENRES_AGENDA[o.genre] ? o.genre : "autre",
             titre: texte(o.titre).slice(0, 200), lieu: texte(o.lieu).slice(0, 200), note: texte(o.note) };
  }

  function valideTache(o) {
    if (!texte(o.titre)) throw erreur("Le libellé de la tâche est obligatoire.");
    if (!texte(o.affaireId)) throw erreur("Choisis l'affaire à laquelle la tâche se rattache.");
    if (!etat.affaires.some(function (a) { return a.id === o.affaireId; })) throw erreur("Cette affaire n'existe plus.");
    if (!texte(o.echeance)) throw erreur("L'échéance est obligatoire : c'est elle qui place la tâche au calendrier.");
    // Au dixième de jour : c'est la précision de la base (numeric(4,1)). Sans cet
    // arrondi, l'écran gardait 0,71 j quand la base enregistrait 0,7 j.
    var ci = dixieme(Math.max(0, nombre(o.chargeInge, 0)));
    var cd = dixieme(Math.max(0, nombre(o.chargeDessin, 0)));
    if (ci + cd <= 0) throw erreur("Indique au moins une durée estimée, côté ingénieur ou côté dessin (0,1 j au minimum).");
    if (ci > CHARGE_MAX || cd > CHARGE_MAX) throw erreur("Une charge ne peut pas dépasser " + String(CHARGE_MAX).replace(".", ",") + " j.");
    // Une charge sans personne est permise : elle attend son affectation (« À affecter » au tableau de bord)
    var v = {
      affaireId: texte(o.affaireId), titre: texte(o.titre), note: texte(o.note),
      chargeInge: ci, chargeDessin: cd,
      debut: null, echeance: texte(o.echeance),
      ingenieurId: texte(o.ingenieurId) || null,
      dessinateurId: texte(o.dessinateurId) || null,
      statut: STATUTS_TACHE[o.statut] ? o.statut : "a_faire",
      avancement: Math.min(100, Math.max(0, nombre(o.avancement, 0))),
      finiInge: o.finiInge === true,
      finiDessin: o.finiDessin === true,
      // Le dessin attend le calcul (calculs.js, finPart). Une tâche neuve est enchaînée
      // sauf avis contraire ; tant que la base ignore la colonne, rien n'est enchaîné.
      enchaine: "enchaine" in o ? o.enchaine === true : true
    };
    // Priorité entre tâches de même échéance (1 la plus importante, 5 par défaut) :
    // seulement quand le formulaire la porte (module Inter-secteurs), sinon elle reste telle quelle
    if (o.priorite != null && o.priorite !== "") v.priorite = Math.min(5, Math.max(1, parseInt(o.priorite, 10) || 5));
    return v;
  }

  /* ------------------------------------------------------------ API publique */

  var D = {
    METIERS: METIERS,
    ORDRE_METIERS: ORDRE_METIERS,
    TITRES_METIERS: TITRES_METIERS,
    PLANIFIES: PLANIFIES,
    cote: cote,
    libelleMetier: libelleMetier,
    JOURS_SEMAINE: JOURS_SEMAINE,
    JOURS_COURTS: JOURS_COURTS,
    reprisJours: reprisJours,
    sommeJours: sommeJours,
    libelleJours: libelleJours,
    detailJours: detailJours,
    STATUTS: STATUTS,
    STATUTS_COURTS: STATUTS_COURTS,
    STATUTS_PLURIEL: STATUTS_PLURIEL,
    ORDRE_STATUTS: ORDRE_STATUTS,
    libelleStatut: libelleStatut,
    statutsDe: statutsDe,
    aStatut: aStatut,
    DROITS: DROITS,
    ORDRE_DROITS: ORDRE_DROITS,
    CATEGORIES_DROITS: CATEGORIES_DROITS,
    GROUPES_DEFAUT: GROUPES_DEFAUT,
    rangeGroupes: rangeGroupes,
    droitsGroupe: droitsGroupe,
    /** Les groupes du bureau affiché, rangés en arbre (sans « Tout le monde »). */
    groupes: function () { return rangeGroupes(GROUPES); },
    compareMembres: compareMembres,
    parMetier: parMetier,
    SUCCURSALES: SUCCURSALES,
    DISCIPLINES: DISCIPLINES,
    DISCIPLINES_PAR_SUCCURSALE: DISCIPLINES_PAR_SUCCURSALE,
    disciplinesDe: disciplinesDe,
    STATUTS_TACHE: STATUTS_TACHE,
    STATUTS_AFFAIRE: STATUTS_AFFAIRE,
    PHASES: PHASES,
    ORDRE_PHASES: ORDRE_PHASES,
    libellePhase: libellePhase,
    /** « 26-801 · Immeuble… », ou le nom seul pour une affaire sans numéro (13.10.2026). */
    libelleAffaire: function (a) { return a ? (a.code ? a.code + " · " : "") + a.nom : "—"; },
    PARTS: PARTS,

    /** Profil de la personne connectée (bureau, droits), sans charger les données : la console s'en contente. */
    chargeProfil: chargeProfil,
    /** Le profil vu par l'interface : celui du rôle choisi dans « Voir
     *  l'outil en tant que », sinon le vrai. La console lit le vrai (chargeProfil). */
    profil: function () { return profilVu(); },
    /** Le rôle simulé (code), ou null quand on voit l'outil avec ses vrais droits. */
    roleVu: function () { var p = profilVu(); return (p && p.roleVu) || null; },
    /** Tout effacer, importer : réservés au super admin quand la base compte plusieurs bureaux. */
    peutToutGerer: function () { var p = profilVu(); return !p || p.peutTout; },

    /** À appeler au chargement de chaque page. Renvoie l'état complet.
     *  Le profil passe d'abord : ses listes servent à relire les membres. */
    pret: function () {
      if (chargement) return chargement;
      chargement = Promise.all([chargeProfil(), ADAPTATEUR.lire()]).then(function (r) {
        var brut = r[1];
        if (!brut && ADAPTATEUR.semeSiVide) {
          etat = demo();                        // première visite : jeu de démonstration
          precedent = null;
          return ADAPTATEUR.ecrire(etat, null).then(function () {
            precedent = copie(etat);
            return etat;
          });
        }
        etat = normalise(brut || etatVierge());
        precedent = copie(etat);
        return etat;
      });
      return chargement;
    },

    etat: function () { return etat; },
    canton: function () { return etat.reglages.canton; },

    /** Après un enregistrement refusé, l'état a été relu depuis la base : la page doit se redessiner. */
    surRechargement: function (f) { rechargements.push(f); },
    /** Vrai pendant une écriture de cette page, et dans les ms qui suivent sa fin. */
    ecritureRecente: function (ms) { return ecrituresEnCours > 0 || Date.now() - derniereEcriture < (ms || 2500); },
    /** Redessine la page sans relire la base : une écriture faite hors de la page
     *  (la palette de commandes) passe par ici pour apparaître aussitôt. */
    redessine: function () {
      rechargements.forEach(function (f) { try { f(etat); } catch (e) { console.error(e); } });
    },

    /**
     * Relit la base et redessine : ce qu'un collègue vient d'enregistrer
     * apparaît sans recharger la page. La lecture prend la file des écritures,
     * sinon elle remplacerait l'état sous les pieds d'une écriture en route,
     * dont l'écart se calcule justement sur l'état lu.
     */
    /** tables (facultatif) : seules ces tables de la base ont changé — le
     *  direct n'en relit pas plus (supabase.js garde les autres). */
    recharge: function (tables) {
      var lecture = file.then(function () {
        return ADAPTATEUR.lire(tables).then(function (brut) {
          if (!brut) throw erreur("Lecture vide.");
          etat = normalise(brut);
          precedent = copie(etat);
          version++;
          rechargements.forEach(function (f) { try { f(etat); } catch (e) { console.error(e); } });
          return etat;
        });
      });
      file = lecture.catch(function () {});
      return lecture;
    },

    majReglages: function (o) {
      if (o.canton != null) etat.reglages.canton = texte(o.canton) || "VD";
      if (o.capaciteDefaut != null) etat.reglages.capaciteDefaut = nombre(o.capaciteDefaut, 5);
      if (o.demo != null) etat.reglages.demo = !!o.demo;
      return sauve();
    },

    /* --------------------------------------------------------- membres */
    /** opts : tous (inactifs compris), metier (exact), statut (porté, parmi d'autres),
     *  cote (côté du planning), planifies (ceux qui portent des tâches) */
    membres: function (opts) {
      opts = opts || {};
      return etat.membres.filter(function (m) { return opts.tous ? true : m.actif; })
        .filter(function (m) { return opts.metier != null ? m.metier === opts.metier : true; })
        .filter(function (m) { return opts.statut ? aStatut(m, opts.statut) : true; })
        .filter(function (m) { return opts.cote ? cote(m.metier) === opts.cote : true; })
        .filter(function (m) { return opts.planifies ? !!PLANIFIES[m.metier] : true; })
        .slice().sort(compareMembres);
    },
    membre: function (i) { return idx().membres[i] || null; },
    nomMembre: function (i) { var m = D.membre(i); return m ? m.prenom + " " + m.nom : "—"; },

    /** La fiche d'équipe de la personne connectée. Le rattachement posé dans la
     *  console fait foi ; à défaut, l'adresse de connexion est cherchée parmi les
     *  fiches. null si personne n'est connecté, ou si aucune fiche ne lui revient
     *  (accès sans fiche, adresse de connexion différente et pas encore rattachée). */
    monMembre: function () {
      if (!etat) return null;
      if (profil && profil.membreId) {
        var lie = D.membre(profil.membreId);
        if (lie) return lie;
      }
      var mail = texte((profil && profil.email) || (global.Sb && global.Sb.connecte() ? global.Sb.email() : "")).toLowerCase();
      if (!mail) return null;
      var moi = null;
      etat.membres.forEach(function (m) { if (!moi && m.email && m.email.toLowerCase() === mail) moi = m; });
      return moi;
    },

    /* ----------------------------------------------------------- droits
       Ce que la personne connectée a le droit de faire. Les pages s'en
       servent pour ne pas proposer l'impossible ; c'est la base (RLS) qui
       tranche pour de bon, avec exactement les mêmes règles. */

    /* Accès aux pages (07.10.2026, par statut ; 13.10.2026, par droit) :
       chaque page s'ouvre avec son droit (DROIT_PAGE), coché groupe par groupe
       dans la console. Accueil, Communication et Tâches sont à tous, la
       console au super admin. Ce n'est qu'un rangement de l'interface : les
       données du bureau restent lisibles. */
    DROIT_PAGE: DROIT_PAGE,
    PAGES_INTER: PAGES_INTER,
    /** L'adresse d'un module : sa première page permise (Inter-secteurs), sinon la sienne. */
    lienModule: function (cle) {
      if (cle !== "inter") return null;
      var p = PAGES_INTER.filter(function (x) { return D.pagePermise(x.cle); })[0];
      return (p || PAGES_INTER[0]).href;
    },
    /** 3 : la console est ouverte (super admin, ou rôle « Admin du site ») ; 0 sinon. */
    niveauAcces: function () {
      var r = D.roleDemo();
      if (r) return r.code === "admin_site" ? 3 : 0;
      return profil && profil.multi && profil.superAdmin ? 3 : 0;
    },
    /** Rôle simulé : en démonstration, et pour le super admin partout ;
     *  null sinon. */
    roleDemo: function () {
      var sa = !!(profil && profil.multi && profil.superAdmin);
      if (!sa && !D.enDemo()) return null;
      var code = null;
      try { code = global.localStorage.getItem(sa ? CLE_ROLE_SUPER : CLE_ROLE_DEMO); } catch (e) {}
      var roles = rolesDemoListe();
      // Par défaut : l'admin du site pour lui, le groupe de tête en démonstration
      return roles.filter(function (r) { return r.code === code; })[0] ||
        roles.filter(function (r) { return r.code === (sa ? "admin_site" : "administrateur"); })[0] ||
        roles[sa ? roles.length - 1 : Math.max(0, roles.length - 2)];
    },
    /** Titre du choix de rôle dans le menu du compte. */
    titreRolesDemo: function () {
      return D.enDemo() ? "Voir la démo en tant que" : "Voir l'outil en tant que";
    },
    /** Les rôles du menu, avec « actif » ; null hors démonstration. */
    rolesDemo: function () {
      var r = D.roleDemo();
      return r ? rolesDemoListe().map(function (x) { return { code: x.code, nom: x.nom, actif: x.code === r.code }; }) : null;
    },
    choisitRoleDemo: function (code) {
      var sa = !!(profil && profil.multi && profil.superAdmin);
      try { global.localStorage.setItem(sa ? CLE_ROLE_SUPER : CLE_ROLE_DEMO, code); } catch (e) {}
    },
    /** cle : celle de la barre des pages (« tableau », « inter »…) ; inconnue : permise. */
    pagePermise: function (cle) {
      if (cle === "console") return D.niveauAcces() >= 3;
      if (cle === "inter") return PAGES_INTER.some(function (p) { return D.pagePermise(p.cle); });
      var d = DROIT_PAGE[cle];
      return !d || D.aDroit(d);
    },

    /** Le super admin a tous les droits : c'est lui qui les distribue. */
    aDroit: function (code) {
      var p = profilVu();
      if (!p) return true;                            // profil pas encore lu
      if (p.superAdmin) return true;
      return (p.droits || []).indexOf(code) >= 0;
    },

    /** Une tâche me concerne-t-elle ? C'est y tenir une part chargée : le
     *  calcul si j'en suis l'ingénieur, le dessin si j'en suis le dessinateur. */
    meConcerne: function (t) {
      var moi = D.monMembre();
      if (!moi || !t) return false;
      return (t.ingenieurId === moi.id && t.chargeInge > 0) ||
             (t.dessinateurId === moi.id && t.chargeDessin > 0);
    },

    /** Puis-je créer ou modifier cette tâche ? (t nul : une tâche à créer,
     *  dont on ne connaît pas encore les parts — seul le droit tranche.) */
    peutEcrireTache: function (t) {
      return D.aDroit("taches_autrui") || D.meConcerne(t);
    },

    /** Puis-je poser, modifier ou retirer les absences de ce membre ? */
    peutAbsences: function (idMembre) {
      if (D.aDroit("absences_autrui")) return true;
      var moi = D.monMembre();
      return !!(moi && moi.id === idMembre);
    },

    /** Puis-je régler les jours travaillés de ce membre ? Les siens, toujours ;
     *  ceux d'un collègue avec le même droit que ses absences. */
    peutJours: function (idMembre) { return D.peutAbsences(idMembre); },
    capaciteApres: capaciteApres,

    /**
     * Règle la semaine type d'un membre (cinq poids, ou null pour une semaine
     * pleine) ; la capacité suit (capaciteApres). L'outil n'écrit pas les
     * fiches de membres : la base passe par sa fonction regle_jours, qui
     * vérifie le droit. Promesse du membre à jour.
     */
    regleJours: function (idMembre, jours) {
      return Promise.resolve().then(function () {
        var m = D.membre(idMembre); if (!m) throw erreur("Membre introuvable.");
        if (!D.peutJours(idMembre)) throw erreur("Tu ne règles que tes propres jours.");
        var j = reprisJours(jours);
        if (Array.isArray(jours) && !j && !jours.some(function (x) { return nombre(x, 0) > 0; })) {
          throw erreur("Garde au moins un jour travaillé.");
        }
        m.capacite = capaciteApres(m, j);
        m.jours = j;
        if (!ADAPTATEUR.regleJours) return sauve().then(function () { return m; });
        version++;
        var instantane = copie(etat);
        return enFile(function () { return ADAPTATEUR.regleJours(idMembre, j); }, instantane)
          .then(function () { return D.membre(idMembre) || m; });
      });
    },



    /**
     * Mon profil (10.10.2026) : téléphones (interne, ligne directe, natel), photo (petite
     * image en data URL, null pour aucune) de sa propre fiche. Comme pour les
     * jours, la base passe par sa fonction regle_profil. Promesse du membre à jour.
     */
    regleProfil: function (idMembre, p) {
      return Promise.resolve().then(function () {
        var m = D.membre(idMembre); if (!m) throw erreur("Membre introuvable.");
        var moi = D.monMembre();
        if (!moi || moi.id !== idMembre) throw erreur("Tu ne règles que ton propre profil.");
        var neuf = {
          telInterne: texte(p.telInterne).trim().slice(0, 40),
          telExterne: texte(p.telExterne).trim().slice(0, 40),
          telNatel: p.telNatel === undefined ? m.telNatel : texte(p.telNatel).trim().slice(0, 40),
          photo: p.photo === undefined ? m.photo : (/^data:image\//.test(texte(p.photo)) ? texte(p.photo) : null)
        };
        if (neuf.photo !== m.photo && D.photoBloquee()) throw erreur("La photo ne se change pas dans la démonstration.");
        m.telInterne = neuf.telInterne; m.telExterne = neuf.telExterne; m.telNatel = neuf.telNatel; m.photo = neuf.photo;
        if (!ADAPTATEUR.regleProfil) return sauve().then(function () { return m; });
        version++;
        var instantane = copie(etat);
        return enFile(function () { return ADAPTATEUR.regleProfil(idMembre, neuf); }, instantane)
          .then(function () { return D.membre(idMembre) || m; });
      });
    },
    /** Compte de démonstration partagé : la photo, vue de tous les visiteurs, ne s'y change pas. */
    photoBloquee: function () {
      return !!ADAPTATEUR.regleProfil && /^demo@/i.test(texte(profil && profil.email) || (global.Sb && global.Sb.email ? global.Sb.email() : ""));
    },

    /**
     * Les absences croisant une fenêtre, la plus proche d'abord :
     * [{membre, absence}]. Sert au calendrier des absences.
     */
    absences: function (opts) {
      opts = opts || {};
      var out = [];
      etat.membres.forEach(function (m) {
        if (!opts.tous && !m.actif) return;
        if (opts.metier && m.metier !== opts.metier) return;
        if (opts.membreId && m.id !== opts.membreId) return;
        (m.absences || []).forEach(function (a) {
          if (opts.depuis && (a.fin || a.debut) < opts.depuis) return;
          if (opts.jusqu && a.debut > opts.jusqu) return;
          out.push({ membre: m, absence: a });
        });
      });
      return out.sort(function (x, y) {
        if (x.absence.debut !== y.absence.debut) return x.absence.debut < y.absence.debut ? -1 : 1;
        return compareMembres(x.membre, y.membre);
      });
    },

    ajouteAbsence: function (i, o) {
      return Promise.resolve().then(function () {
        var m = D.membre(i); if (!m) throw erreur("Membre introuvable.");
        var v = valideAbsence(m, o, null);
        v.id = id();
        m.absences.push(v);
        m.absences.sort(function (a, b) { return a.debut < b.debut ? -1 : 1; });
        return sauve();
      });
    },
    majAbsence: function (i, idAbs, o) {
      return Promise.resolve().then(function () {
        var m = D.membre(i); if (!m) throw erreur("Membre introuvable.");
        var a = m.absences.filter(function (x) { return x.id === idAbs; })[0];
        if (!a) throw erreur("Absence introuvable.");
        var v = valideAbsence(m, o, idAbs);
        a.debut = v.debut; a.fin = v.fin; a.motif = v.motif;
        m.absences.sort(function (x, y) { return x.debut < y.debut ? -1 : 1; });
        return sauve();
      });
    },
    suppAbsence: function (i, idAbs) {
      return Promise.resolve().then(function () {
        var m = D.membre(i); if (!m) throw erreur("Membre introuvable.");
        m.absences = m.absences.filter(function (a) { return a.id !== idAbs; });
        return sauve();
      });
    },

    /* ---------------------------------------------- avis d'absence
       Prévenir le bureau à l'heure près (accueil). */
    /** Avis pas encore échus, le plus proche d'abord. opts.membreId : ceux d'une personne ;
     *  opts.jusqu : qui commencent au plus tard ce jour-là (AAAA-MM-JJ). */
    avis: function (opts) {
      opts = opts || {};
      var maintenant = instantLocal(new Date());
      return (etat.avis || []).filter(function (a) {
        if (a.fin <= maintenant) return false;
        if (opts.membreId && a.membreId !== opts.membreId) return false;
        if (opts.jusqu && a.debut.slice(0, 10) > opts.jusqu) return false;
        var m = D.membre(a.membreId);
        return !!m && (opts.tous || m.actif);
      }).sort(function (x, y) { return x.debut < y.debut ? -1 : x.debut > y.debut ? 1 : 0; });
    },
    ajouteAvis: function (o) {
      return Promise.resolve().then(function () {
        var v = valideAvis(o);
        if (!D.membre(v.membreId)) throw erreur("Aucune fiche d'équipe n'est rattachée à ton adresse : demande à l'administrateur de l'outil.");
        if (!D.peutAbsences(v.membreId)) throw erreur("Tu ne préviens que pour toi-même.");
        v.id = id(); v.cree = new Date().toISOString();
        (etat.avis || (etat.avis = [])).push(v);
        return sauve().then(function () { return v; });
      });
    },

    /* -------------------------------------------------------- affaires */
    affaires: function (opts) {
      opts = opts || {};
      return etat.affaires.filter(function (a) { return opts.tous ? true : a.statut !== "terminee"; })
        .slice().sort(function (a, b) { return a.code.localeCompare(b.code, "fr", { numeric: true }); });
    },
    affaire: function (i) { return idx().affaires[i] || null; },

    ajouteAffaire: function (o) {
      return Promise.resolve().then(function () {
        var v = valideAffaire(o, null);
        v.id = id();
        etat.affaires.push(v);
        return sauve().then(function () { return v; });
      });
    },
    majAffaire: function (i, o) {
      return Promise.resolve().then(function () {
        var a = D.affaire(i); if (!a) throw erreur("Affaire introuvable.");
        var v = valideAffaire(o, i);
        Object.keys(v).forEach(function (k) { a[k] = v[k]; });
        return sauve().then(function () { return a; });
      });
    },
    suppAffaire: function (i) {
      return Promise.resolve().then(function () {
        etat.affaires = etat.affaires.filter(function (a) { return a.id !== i; });
        etat.taches = etat.taches.filter(function (t) { return t.affaireId !== i; });
        etat.agenda = (etat.agenda || []).filter(function (r) { return r.affaireId !== i; });
        etat.saisies = (etat.saisies || []).filter(function (x) { return x.affaireId !== i; });
        return sauve();
      });
    },

    /* ---------------------------------------------------------- tâches */
    /** Tâches triées par échéance. Liste neuve à chaque appel : l'appelant peut la modifier. */
    taches: function (opts) {
      opts = opts || {};
      var ix = idx();
      var source = opts.affaireId
        ? (ix.parAffaire[opts.affaireId] || []).slice().sort(function (a, b) {
            return (a.echeance || "9999") < (b.echeance || "9999") ? -1 : 1;
          })
        : ix.triees;
      return source.filter(function (t) {
        if (opts.membreId && t.ingenieurId !== opts.membreId && t.dessinateurId !== opts.membreId) return false;
        if (opts.sansTerminees && t.statut === "termine") return false;
        return true;
      });
    },
    tache: function (i) { return idx().taches[i] || null; },
    /** Numéro de version de l'état : change à chaque enregistrement. Sert de clé aux calculs mis en cache. */
    version: function () { return version; },

    ajouteTache: function (o) {
      return Promise.resolve().then(function () {
        var v = accordeParts(valideTache(o), partsNommees(o), false);
        if (!v.priorite) v.priorite = 5;
        v.id = id(); v.cree = new Date().toISOString(); v.maj = v.cree;
        etat.taches.push(v);
        return sauve().then(function () { return v; });
      });
    },
    majTache: function (i, o) {
      return Promise.resolve().then(function () {
        var t = D.tache(i); if (!t) throw erreur("Tâche introuvable.");
        var etait = t.statut === "termine";
        var v = valideTache(o);
        Object.keys(v).forEach(function (k) { t[k] = v[k]; });
        accordeParts(t, partsNommees(o), etait);
        t.maj = new Date().toISOString();
        return sauve().then(function () { return t; });
      });
    },
    /** Écriture partielle, sans repasser par le formulaire (glisser-déposer, statut…). */
    retoucheTache: function (i, champs) {
      return Promise.resolve().then(function () {
        var t = D.tache(i); if (!t) throw erreur("Tâche introuvable.");
        var etait = t.statut === "termine";
        Object.keys(champs).forEach(function (k) { if (k in t || k === "finCalcul") t[k] = champs[k]; });
        accordeParts(t, partsNommees(champs), etait);
        t.maj = new Date().toISOString();
        return sauve().then(function () { return t; });
      });
    },
    /**
     * Décale une part de `jours` jours (glisser-déposer, flèches, fiche rapide).
     * Demande de Tony (12.10.2026), pour une tâche enchaînée vue par sa part
     * calcul : avancer le calcul ne touche pas au dessin (le calcul prend sa
     * propre fin, finCalcul) ; le retarder jusque sur le dessin repousse le
     * dessin juste assez pour qu'il commence le jour travaillé qui suit la
     * fin du calcul. Autrement (part dessin, tâche non enchaînée), c'est
     * l'échéance de la tâche qui bouge, comme avant. Une date qui tombe un
     * jour chômé glisse au jour ouvré suivant, dans le sens du geste.
     * Promesse de { calcul, dessin } (jours de décalage de chaque part), ou null.
     */
    decalePart: function (i, role, jours) {
      return Promise.resolve().then(function () {
        var t = D.tache(i), Calc = global.Calc, C = global.Cal;
        if (!t || !jours) return null;
        var canton = D.canton();
        function glisse(d) {
          var pas = jours > 0 ? 1 : -1, garde = 0;
          while (C.chome(d, canton) && garde++ < 30) d = C.ajoute(d, pas);
          return d;
        }
        if (role !== "ingenieur" || !Calc || !Calc.enchainee(t)) {
          var ech = glisse(C.ajoute(t.echeance, jours)), delta = C.diff(t.echeance, ech);
          if (!delta) return null;
          var ch = { echeance: ech, debut: null };
          // Le dessin avancé rattrape la fin propre du calcul : elle n'a plus lieu d'être, il le suit de nouveau
          if (t.finCalcul && Calc && Calc.enchainee(t)) {
            var essai = {}; Object.keys(t).forEach(function (k) { essai[k] = t[k]; }); essai.echeance = ech;
            if (t.finCalcul >= Calc.finCalculMax(essai, canton)) ch.finCalcul = null;
          }
          return D.retoucheTache(i, ch)
            .then(function () { return { calcul: delta, dessin: delta }; });
        }
        var fin = Calc.finPart(t, "ingenieur", canton);
        var cible = glisse(C.ajoute(fin, jours));
        if (cible === fin) return null;
        var max = Calc.finCalculMax(t, canton);
        if (cible <= max) {
          return D.retoucheTache(i, { finCalcul: cible === max ? null : cible })
            .then(function () { return { calcul: C.diff(fin, cible), dessin: 0 }; });
        }
        // Le calcul déborde sur le dessin : le dessin commence le jour travaillé qui suit
        var des = t.dessinateurId ? D.membre(t.dessinateurId) : null;
        var nouvelle = Calc.finDepuis(t.chargeDessin, Calc.premierJourApres(cible, des, canton), des, canton);
        if (nouvelle < t.echeance) nouvelle = t.echeance;
        var avant = t.echeance, champs = { echeance: nouvelle, debut: null, finCalcul: cible };
        return D.retoucheTache(i, champs).then(function () {
          return { calcul: C.diff(fin, cible), dessin: C.diff(avant, nouvelle) };
        });
      });
    },
    suppTache: function (i) {
      return Promise.resolve().then(function () {
        etat.taches = etat.taches.filter(function (t) { return t.id !== i; });
        return sauve();
      });
    },

    /* -------------------------------------------------------- annuaire */
    /** Lien Google Maps de l'adresse d'une affaire, ou "" sans adresse. */
    lienCarte: function (a) {
      return a && a.adresse ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a.adresse) : "";
    },

    urlSite: urlSite,

    /** Fiches rangées par nom, société à défaut. Liste neuve : l'appelant peut la trier autrement. */
    contacts: function () {
      return (etat.contacts || []).slice().sort(function (a, b) {
        return cleContact(a).localeCompare(cleContact(b), "fr", { sensitivity: "base" });
      });
    },
    contact: function (i) {
      var l = etat.contacts || [];
      for (var k = 0; k < l.length; k++) if (l[k].id === i) return l[k];
      return null;
    },

    ajouteContact: function (o) {
      return Promise.resolve().then(function () {
        var v = valideContact(o);
        v.id = id();
        etat.contacts.push(v);
        return sauve().then(function () { return v; });
      });
    },
    majContact: function (i, o) {
      return Promise.resolve().then(function () {
        var c = D.contact(i); if (!c) throw erreur("Fiche introuvable.");
        var v = valideContact(o);
        Object.keys(v).forEach(function (k) { c[k] = v[k]; });
        return sauve().then(function () { return c; });
      });
    },
    suppContact: function (i) {
      return Promise.resolve().then(function () {
        etat.contacts = etat.contacts.filter(function (c) { return c.id !== i; });
        return sauve();
      });
    },

    /* ------------------------------------------------ veille simap.ch
       Publications d'appels d'offres retenues chaque matin par la tâche
       planifiée du dépôt (structure, génie civil ; GE, VD, VS). Le bureau les
       écarte ou en fait un appel d'offres (affaire en phase AO). */
    suiviVeille: function (idAo) {
      var l = etat.veilleSuivi || [];
      for (var k = 0; k < l.length; k++) if (l[k].aoId === idAo) return l[k];
      return null;
    },
    /** Publications, la plus récente d'abord. opts.etat : « nouvelle » (ni écartée ni retenue), « ecartee », « retenue ». */
    veille: function (opts) {
      opts = opts || {};
      return (etat.veille || []).filter(function (v) {
        var s = D.suiviVeille(v.id);
        if (opts.etat === "nouvelle") return !s;
        if (opts.etat) return !!s && s.etat === opts.etat;
        return true;
      }).sort(function (a, b) { return (b.publieLe || "") < (a.publieLe || "") ? -1 : (b.publieLe || "") > (a.publieLe || "") ? 1 : 0; });
    },
    /** Nouvelles publications dont la remise n'est pas passée : le badge de l'accueil. */
    veilleNouvelles: function () {
      var maintenant = new Date().toISOString();
      return D.veille({ etat: "nouvelle" }).filter(function (v) { return !v.delai || v.delai >= maintenant; });
    },
    marqueVeille: function (idAo, etatVeille, idAffaire) {
      return Promise.resolve().then(function () {
        var moi = D.monMembre(), s = D.suiviVeille(idAo);
        etat.veilleSuivi = etat.veilleSuivi || [];
        if (!etatVeille) {
          etat.veilleSuivi = etat.veilleSuivi.filter(function (x) { return x.aoId !== idAo; });
        } else if (s) {
          s.etat = etatVeille; s.affaireId = idAffaire || s.affaireId || null;
        } else {
          etat.veilleSuivi.push({ id: id(), aoId: idAo, etat: etatVeille, affaireId: idAffaire || null,
                                  par: moi ? moi.id : null, le: new Date().toISOString() });
        }
        return sauve();
      });
    },

    /* ------------------------------------------------ demandes de congé
       On demande pour soi ; un chef de secteur de la même discipline ou un
       administrateur décide (jamais pour soi-même) ; acceptée, la demande
       devient une absence du planning. La base fait la même vérification
       (peut_valider_conge, decide_conge). */
    STATUTS_CONGE: STATUTS_CONGE,
    MOTIFS_CONGE: MOTIFS_CONGE,
    /** Demandes, la plus proche d'abord. opts.membreId, opts.statut, opts.depuis (fin ≥ ce jour). */
    conges: function (opts) {
      opts = opts || {};
      return (etat.conges || []).filter(function (c) {
        if (opts.membreId && c.membreId !== opts.membreId) return false;
        if (opts.statut && c.statut !== opts.statut) return false;
        if (opts.depuis && c.fin < opts.depuis) return false;
        return !!D.membre(c.membreId);
      }).sort(function (a, b) { return a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : 0; });
    },
    conge: function (i) {
      var l = etat.conges || [];
      for (var k = 0; k < l.length; k++) if (l[k].id === i) return l[k];
      return null;
    },
    /** Puis-je décider des congés de ce membre ? */
    peutValiderConge: function (idMembre) {
      var p = profilVu();
      if (!p) return true;                               // mode local
      if (p.superAdmin) return true;
      var moi = D.monMembre(), lui = D.membre(idMembre);
      if (!moi || !lui || moi.id === lui.id) return false;
      // Rôle simulé : ses droits, avec la discipline de sa propre fiche
      return D.aDroit("conges_tous") ||
        (D.aDroit("conges_secteur") && !!moi.discipline && moi.discipline === lui.discipline);
    },
    /** Les demandes qui attendent ma décision. */
    congesAValider: function () {
      return D.conges({ statut: "en_attente" }).filter(function (c) { return D.peutValiderConge(c.membreId); });
    },
    demandeConge: function (o) {
      return Promise.resolve().then(function () {
        var moi = D.monMembre(), qui = texte(o.membreId) || (moi && moi.id);
        var m = D.membre(qui);
        if (!m) throw erreur("Aucune fiche d'équipe n'est rattachée à ton adresse : demande à l'administrateur de l'outil.");
        if (!D.peutAbsences(m.id)) throw erreur("Tu ne demandes un congé que pour toi-même.");
        var debut = texte(o.debut), fin = texte(o.fin) || debut;
        if (!debut) throw erreur("Choisis le premier jour du congé.");
        if (fin < debut) throw erreur("Le dernier jour vient avant le premier.");
        var v = { id: id(), membreId: m.id, debut: debut, fin: fin, motif: texte(o.motif) || "Vacances",
                  commentaire: texte(o.commentaire), statut: "en_attente", validePar: null, valideLe: null,
                  reponse: "", absenceId: null, cree: new Date().toISOString() };
        (etat.conges || (etat.conges = [])).push(v);
        return sauve().then(function () { return v; });
      });
    },
    annuleConge: function (i) {
      return Promise.resolve().then(function () {
        var c = D.conge(i); if (!c) throw erreur("Demande introuvable.");
        if (c.statut !== "en_attente") throw erreur("Cette demande a déjà été traitée.");
        c.statut = "annulee";
        return sauve().then(function () { return c; });
      });
    },
    /** Accepter (l'absence est inscrite au planning) ou refuser, avec un mot de réponse. */
    decideConge: function (i, accepte, reponse) {
      return Promise.resolve().then(function () {
        var c = D.conge(i); if (!c) throw erreur("Demande introuvable.");
        if (c.statut !== "en_attente") throw erreur("Cette demande a déjà été traitée.");
        if (!D.peutValiderConge(c.membreId)) throw erreur("Tu ne décides que des congés de ton secteur.");
        var moi = D.monMembre();
        c.statut = accepte ? "acceptee" : "refusee";
        c.validePar = moi ? moi.id : null; c.valideLe = new Date().toISOString(); c.reponse = texte(reponse);
        if (!ADAPTATEUR.decideConge) {
          if (accepte) {
            var m = D.membre(c.membreId), a = { id: id(), debut: c.debut, fin: c.fin, motif: c.motif };
            m.absences.push(a);
            m.absences.sort(function (x, y) { return x.debut < y.debut ? -1 : 1; });
            c.absenceId = a.id;
          }
          return sauve().then(function () { return c; });
        }
        // La base décide et inscrit l'absence : on relit ensuite pour la voir
        version++;
        var instantane = copie(etat);
        return enFile(function () { return ADAPTATEUR.decideConge(i, !!accepte, texte(reponse)); }, instantane)
          .then(function () { return D.recharge(); })
          .then(function () { return D.conge(i) || c; });
      });
    },

    /* ------------------------------------------------ rendez-vous du bureau
       L'agenda interne (module Communication) : un rendez-vous, ses
       participants. La réplication avec Outlook viendra (source, externeId). */
    /** Rendez-vous par date puis heure. opts.depuis / opts.jusqu (AAAA-MM-JJ), opts.membreId : ceux d'une personne. */
    rendezVous: function (opts) {
      opts = opts || {};
      return (etat.rdv || []).filter(function (r) {
        if (opts.depuis && r.jour < opts.depuis) return false;
        if (opts.jusqu && r.jour > opts.jusqu) return false;
        if (opts.membreId && r.participants.indexOf(opts.membreId) < 0 && r.creePar !== opts.membreId) return false;
        return true;
      }).sort(function (a, b) {
        return a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : (a.debut || "") < (b.debut || "") ? -1 : (a.debut || "") > (b.debut || "") ? 1 : 0;
      });
    },
    rdvParId: function (i) {
      var l = etat.rdv || [];
      for (var k = 0; k < l.length; k++) if (l[k].id === i) return l[k];
      return null;
    },
    /** Puis-je modifier ce rendez-vous ? Le mien (noté par moi, ou j'y participe), ou le droit sur les absences des autres. */
    peutRdv: function (r) {
      if (!r || D.aDroit("absences_autrui")) return true;
      var moi = D.monMembre();
      return !!moi && (r.creePar === moi.id || r.participants.indexOf(moi.id) >= 0);
    },
    ajouteRdv: function (o) {
      return Promise.resolve().then(function () {
        var v = valideRdv(o), moi = D.monMembre();
        v.id = id(); v.creePar = moi ? moi.id : null; v.source = "planif"; v.externeId = null;
        (etat.rdv || (etat.rdv = [])).push(v);
        return sauve().then(function () { return v; });
      });
    },
    majRdv: function (i, o) {
      return Promise.resolve().then(function () {
        var r = D.rdvParId(i); if (!r) throw erreur("Rendez-vous introuvable.");
        if (!D.peutRdv(r)) throw erreur("Seuls ses participants et la personne qui l'a noté modifient ce rendez-vous.");
        var v = valideRdv(o);
        Object.keys(v).forEach(function (k) { r[k] = v[k]; });
        return sauve().then(function () { return r; });
      });
    },
    suppRdv: function (i) {
      return Promise.resolve().then(function () {
        var r = D.rdvParId(i); if (!r) return;
        if (!D.peutRdv(r)) throw erreur("Seuls ses participants et la personne qui l'a noté retirent ce rendez-vous.");
        etat.rdv = etat.rdv.filter(function (x) { return x.id !== i; });
        return sauve();
      });
    },

    /* ------------------------------------------------ appels d'offres et agenda
       Un appel d'offres est une affaire en phase « AO » (module
       Inter-secteurs). Son agenda est attaché à l'affaire, pas à une personne. */
    TYPES_AO: TYPES_AO,
    RESULTATS_AO: RESULTATS_AO,
    GENRES_AGENDA: GENRES_AGENDA,
    /** Rendez-vous par date puis heure. opts.affaireId : ceux d'un AO ; opts.depuis : à partir de ce jour. */
    agenda: function (opts) {
      opts = opts || {};
      return (etat.agenda || []).filter(function (r) {
        if (opts.affaireId && r.affaireId !== opts.affaireId) return false;
        if (opts.depuis && r.jour < opts.depuis) return false;
        return !!D.affaire(r.affaireId);
      }).sort(function (a, b) {
        return a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : (a.heure || "99") < (b.heure || "99") ? -1 : (a.heure || "99") > (b.heure || "99") ? 1 : 0;
      });
    },
    evenement: function (i) {
      var l = etat.agenda || [];
      for (var k = 0; k < l.length; k++) if (l[k].id === i) return l[k];
      return null;
    },
    ajouteEvenement: function (o) {
      return Promise.resolve().then(function () {
        var v = valideEvenement(o);
        v.id = id();
        (etat.agenda || (etat.agenda = [])).push(v);
        return sauve().then(function () { return v; });
      });
    },
    majEvenement: function (i, o) {
      return Promise.resolve().then(function () {
        var r = D.evenement(i); if (!r) throw erreur("Rendez-vous introuvable.");
        var v = valideEvenement(o);
        Object.keys(v).forEach(function (k) { r[k] = v[k]; });
        return sauve().then(function () { return r; });
      });
    },
    suppEvenement: function (i) {
      return Promise.resolve().then(function () {
        etat.agenda = (etat.agenda || []).filter(function (r) { return r.id !== i; });
        return sauve();
      });
    },

    /* ------------------------------------------------ mandat, avancement, facturation
       Le mandat d'une affaire : ses phases SIA et les disciplines de chacune.
       Pour chaque case (phase × discipline), deux pourcentages — l'avancement
       et la facturation — saisis au fil du temps : chaque saisie est gardée,
       la plus récente fait foi (13.10.2026). La base applique les mêmes
       règles (peut_saisir_mandat) et ne montre la facturation qu'à ceux qui
       ont la page ou le droit de la saisir. */
    PHASES_MANDAT: PHASES_MANDAT,
    GENRES_SAISIE: GENRES_SAISIE,
    /** « STR », « GEO », « ENV », « GC » : le sigle d'une discipline, pour les cases serrées. */
    sigleDiscipline: function (code) {
      var mots = String(code || "").split("_").filter(Boolean);
      var sigle = mots.length > 1 ? mots.map(function (m) { return m.charAt(0); }).join("") : String(code || "").slice(0, 3);
      // Deux disciplines du même sigle (administrateurs, administration) : une lettre de plus
      var autres = Object.keys(DISCIPLINES).filter(function (c) { return c !== code; });
      if (mots.length <= 1 && autres.some(function (c) { return c.split("_").length <= 1 && c.slice(0, 3) === sigle; })) sigle = String(code).slice(0, 4);
      return sigle.toUpperCase();
    },
    /** Disciplines rangées comme la liste du bureau ; les codes inconnus à la fin. */
    rangeDisciplines: function (codes) {
      var ordre = Object.keys(DISCIPLINES);
      function rang(c) { var i = ordre.indexOf(c); return i < 0 ? 999 : i; }
      return (codes || []).slice().sort(function (a, b) { return rang(a) - rang(b) || (a < b ? -1 : 1); });
    },
    /** Les phases du mandat : [{ phase, disciplines }], dans l'ordre des phases. */
    phasesMandat: function (a) {
      var m = (a && a.mandat) || {};
      return Object.keys(m).sort().map(function (p) { return { phase: p, disciplines: D.rangeDisciplines(m[p]) }; });
    },
    /** La dernière saisie d'une case : { valeur, par, le… }, ou null. */
    saisieMandat: function (idAffaire, phase, discipline, genre) {
      return dernieresSaisies()[idAffaire + "|" + phase + "|" + discipline + "|" + genre] || null;
    },
    /** Pourcentage d'une case (0 sans saisie). */
    valeurMandat: function (idAffaire, phase, discipline, genre) {
      var x = D.saisieMandat(idAffaire, phase, discipline, genre);
      return x ? x.valeur : 0;
    },
    /** Pourcentage d'une phase : la moyenne de ses disciplines (ou de la seule
     *  discipline donnée). null si la phase n'est pas au mandat. */
    valeurPhase: function (a, phase, genre, discipline) {
      var l = ((a && a.mandat) || {})[phase];
      if (!l || !l.length) return null;
      if (discipline) return l.indexOf(discipline) >= 0 ? D.valeurMandat(a.id, phase, discipline, genre) : null;
      return Math.round(l.reduce(function (s, d) { return s + D.valeurMandat(a.id, phase, d, genre); }, 0) / l.length);
    },
    /** Les saisies d'une affaire, la plus récente d'abord (opts.phase, opts.discipline, opts.genre). */
    historiqueMandat: function (idAffaire, opts) {
      opts = opts || {};
      return (etat.saisies || []).filter(function (x) {
        return x.affaireId === idAffaire && (!opts.phase || x.phase === opts.phase) &&
          (!opts.discipline || x.discipline === opts.discipline) && (!opts.genre || x.genre === opts.genre);
      }).sort(function (x, y) { return instant(y.le) - instant(x.le); });
    },
    /** Voir la facturation : la page, ou le droit de la saisir. */
    voitFacturation: function () { return D.aDroit("page_facturation") || D.aDroit("facturation_saisir"); },
    peutSaisirFacturation: function () { return D.aDroit("facturation_saisir"); },
    /** Saisir l'avancement d'une discipline : le responsable de l'affaire, le
     *  chef de ce secteur, ou le droit sur toutes les affaires. */
    peutSaisirAvancement: function (a, discipline) {
      if (!a) return false;
      if (D.aDroit("avancement_tous")) return true;
      var moi = D.monMembre();
      if (!moi) return false;
      if (a.responsableId && a.responsableId === moi.id) return true;
      return D.aDroit("avancement_secteur") && !!moi.discipline && moi.discipline === discipline;
    },
    /** Peut-on saisir quoi que ce soit sur cette affaire ? */
    peutSaisirMandat: function (a) {
      if (!a) return false;
      if (D.peutSaisirFacturation()) return true;
      return D.phasesMandat(a).some(function (p) {
        return p.disciplines.some(function (d) { return D.peutSaisirAvancement(a, d); });
      });
    },
    /**
     * Enregistre des pourcentages : items [{ phase, discipline, genre, valeur }].
     * Une valeur égale à la valeur en cours n'est pas resaisie. Promesse du
     * nombre de saisies faites.
     */
    saisitMandat: function (idAffaire, items) {
      return Promise.resolve().then(function () {
        var a = D.affaire(idAffaire); if (!a) throw erreur("Affaire introuvable.");
        var moi = D.monMembre(), maintenant = new Date().toISOString(), neuves = [];
        (items || []).forEach(function (o) {
          var phase = texte(o.phase), disc = texte(o.discipline), genre = o.genre;
          if (!GENRES_SAISIE[genre]) return;
          if ((a.mandat[phase] || []).indexOf(disc) < 0) throw erreur("La phase " + phase + " n'est pas au mandat pour cette discipline.");
          var v = Math.round(nombre(o.valeur, NaN));
          if (!(v >= 0 && v <= 100)) throw erreur("Un pourcentage va de 0 à 100.");
          if (genre === "facturation" && !D.peutSaisirFacturation()) throw erreur("Saisir la facturation demande le droit « Saisir la facturation ».");
          if (genre === "avancement" && !D.peutSaisirAvancement(a, disc)) {
            throw erreur("L'avancement de " + (DISCIPLINES[disc] || disc) + " se saisit par le responsable de l'affaire ou le chef du secteur.");
          }
          var avant = D.saisieMandat(a.id, phase, disc, genre);
          if (avant ? avant.valeur === v : v === 0) return;
          neuves.push({ id: id(), affaireId: a.id, phase: phase, discipline: disc, genre: genre, valeur: v,
                        par: moi ? moi.id : null, le: maintenant });
        });
        if (!neuves.length) return 0;
        etat.saisies = (etat.saisies || []).concat(neuves);
        return sauve().then(function () { return neuves.length; });
      });
    },

    /* ------------------------------------------------ sauvegarde / reprise */
    exporte: function () { return copie(etat); },
    importe: function (brut) {
      return Promise.resolve().then(function () {
        if (!brut || typeof brut !== "object" || !("membres" in brut)) {
          throw erreur("Ce fichier ne ressemble pas à une sauvegarde de la planification.");
        }
        etat = renumerote(normalise(brut), true);
        etat.reglages.demo = false;
        return sauve();
      });
    },
    /**
     * Vide membres, affaires et tâches. Le canton et la capacité par défaut
     * sont des réglages, pas des données : ils survivent.
     * Quand le stockage sait se vider d'un bloc (la base le fait en deux
     * suppressions, grâce aux cascades), on ne repasse pas par le calcul
     * d'écart, qui listerait des milliers de lignes à effacer une à une.
     */
    videTout: function () {
      return Promise.resolve().then(function () {
        var avant = etat.reglages;
        etat = etatVierge();
        etat.reglages.canton = avant.canton;
        etat.reglages.capaciteDefaut = avant.capaciteDefaut;
        if (!ADAPTATEUR.videTout) return sauve();
        version++;
        var instantane = copie(etat);
        return enFile(function () { return ADAPTATEUR.videTout(); }, instantane);
      });
    },

    estDemo: function () { return !!(etat && etat.reglages.demo); },

    /* Marque de l'espace (06.10.2026) : « ab » pour le bureau qui a la sienne
       (logo et couleurs), « str » (STR Bim Tools, sable) pour tous les autres
       — et toujours pour la démonstration : rien n'y rappelle un bureau réel. */
    enDemo: function () {
      var p = profil;
      if (D.estDemo()) return true;                       // jeu de démonstration (mode local)
      if (!p || !p.multi) return !avecBaseConnectee();    // mode local sans jeu : pas un bureau réel non plus
      return /^demo@/i.test(p.email || "") || (!!p.bureau && /^bureau de test$/i.test(texte(p.bureau.nom)));
    },
    marque: function () {
      var p = profil;
      if (D.enDemo() || !p || !p.bureau) return "str";
      var nom = texte(p.bureau.nom).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return /\bab\b.*ingenieur/.test(nom) ? "ab" : "str";
    },
    /** « Espace Démo », ou « Espace » suivi du nom du bureau. */
    nomEspace: function () {
      if (D.enDemo()) return "Espace Démo";
      return "Espace " + texte(profil && profil.bureau && profil.bureau.nom || "de travail");
    }
  };

  /* La dernière saisie de chaque case, retrouvée d'un coup (« affaire|phase|
     discipline|genre ») et gardée tant que l'état ne bouge pas. */
  function instant(t) { var n = Date.parse(t); return isFinite(n) ? n : 0; }
  var cacheSaisies = null;
  function dernieresSaisies() {
    var l = (etat && etat.saisies) || [];
    if (cacheSaisies && cacheSaisies.v === version && cacheSaisies.l === l && cacheSaisies.n === l.length) return cacheSaisies.par;
    var par = Object.create(null);
    l.forEach(function (x) {
      var k = x.affaireId + "|" + x.phase + "|" + x.discipline + "|" + x.genre, p = par[k];
      if (!p || instant(x.le) >= instant(p.le)) par[k] = x;
    });
    cacheSaisies = { v: version, l: l, n: l.length, par: par };
    return par;
  }

  /* ---------------------------------------------------------- annuler
     Chaque écriture sur une tâche, une affaire, une absence ou une fiche
     d'annuaire garde la photo de ce qu'elle touche, telle qu'avant. Annuler
     remet ces photos en place et enregistre : l'écriture compare à l'état
     précédent (supabase.js, ecrire), elle envoie donc exactement l'inverse —
     champs rétablis, élément supprimé recréé sous le même identifiant,
     élément créé retiré. Seuls les éléments touchés reviennent : ce qu'un
     collègue a modifié ailleurs entre-temps ne bouge pas.
     La pile vit dans la page (30 gestes) ; elle repart vide à chaque page. */

  var PILE_MAX = 30, pile = [];

  function trouveDans(liste, i) {
    for (var k = 0; k < liste.length; k++) if (liste[k].id === i) return k;
    return -1;
  }
  /** Photo d'un élément d'une liste de l'état (null s'il n'existe pas encore). */
  function photo(coll, i) {
    var liste = etat[coll] || [], k = trouveDans(liste, i);
    return { coll: coll, id: i, avant: k >= 0 ? copie(liste[k]) : null };
  }
  /** Photo des absences d'un membre : elles vivent dans sa fiche. */
  function photoAbsences(i) {
    var m = D.membre(i);
    return { coll: "absences", id: i, avant: copie(m ? m.absences || [] : []) };
  }
  function nomTache(i) { var t = D.tache(i); return t ? "« " + t.titre + " »" : "la tâche"; }
  function nomAffaire(i) { var a = D.affaire(i); return a ? "l'affaire " + (a.code || a.nom) : "l'affaire"; }
  function nomContact(i) {
    var c = D.contact(i); return c ? "la fiche " + ((c.prenom ? c.prenom + " " : "") + (c.nom || c.societe)).trim() : "la fiche";
  }
  function nomAbsence(i) { var m = D.membre(i); return m ? "l'absence de " + m.prenom + " " + m.nom : "l'absence"; }

  /**
   * Rend une méthode d'écriture annulable.
   *   avant(args…)          → photos prises avant l'écriture ;
   *   apres(résultat, args…) → photos d'un élément créé (il n'existait pas avant) ;
   *   libelle(args…)        → ce que dira « Annulé : … », calculé avant l'écriture.
   */
  function annulable(nom, avant, libelle, apres) {
    var ecrit = D[nom];
    D[nom] = function () {
      var args = [].slice.call(arguments), photos, dit;
      try { photos = avant ? avant.apply(null, args) : []; dit = libelle.apply(null, args); }
      catch (e) { photos = null; }
      return ecrit.apply(D, args).then(function (res) {
        if (photos) {
          if (apres) photos = photos.concat(apres.apply(null, [res].concat(args)));
          pile.push({ libelle: dit, photos: photos, quand: Date.now() });
          if (pile.length > PILE_MAX) pile.shift();
        }
        return res;
      });
    };
  }

  annulable("ajouteTache", null,
    function (o) { return "création de « " + texte(o.titre) + " »"; },
    function (t) { return [{ coll: "taches", id: t.id, avant: null }]; });
  annulable("majTache", function (i) { return [photo("taches", i)]; },
    function (i) { return "modification de " + nomTache(i); });
  annulable("retoucheTache", function (i) { return [photo("taches", i)]; },
    function (i) { return "modification de " + nomTache(i); });
  annulable("suppTache", function (i) { return [photo("taches", i)]; },
    function (i) { return "suppression de " + nomTache(i); });

  annulable("ajouteAffaire", null,
    function (o) { return "création de l'affaire " + (texte(o.code) || texte(o.nom)); },
    function (a) { return [{ coll: "affaires", id: a.id, avant: null }]; });
  annulable("majAffaire", function (i) { return [photo("affaires", i)]; },
    function (i) { return "modification de " + nomAffaire(i); });
  // Supprimer une affaire emporte ses tâches : elles reviennent avec elle
  annulable("suppAffaire", function (i) {
    return [photo("affaires", i)].concat(etat.taches
      .filter(function (t) { return t.affaireId === i; })
      .map(function (t) { return { coll: "taches", id: t.id, avant: copie(t) }; }))
      .concat((etat.saisies || []).filter(function (x) { return x.affaireId === i; })
        .map(function (x) { return { coll: "saisies", id: x.id, avant: copie(x) }; }));
  }, function (i) { return "suppression de " + nomAffaire(i); });

  annulable("ajouteAbsence", function (i) { return [photoAbsences(i)]; },
    function (i) { return "ajout de " + nomAbsence(i); });
  annulable("majAbsence", function (i) { return [photoAbsences(i)]; },
    function (i) { return "modification de " + nomAbsence(i); });
  annulable("suppAbsence", function (i) { return [photoAbsences(i)]; },
    function (i) { return "suppression de " + nomAbsence(i); });

  annulable("ajouteAvis", null,
    function () { return "avis d'absence"; },
    function (a) { return [{ coll: "avis", id: a.id, avant: null }]; });
  annulable("ajouteContact", null,
    function (o) { return "création de la fiche " + (texte(o.nom) || texte(o.societe)); },
    function (c) { return [{ coll: "contacts", id: c.id, avant: null }]; });
  annulable("majContact", function (i) { return [photo("contacts", i)]; },
    function (i) { return "modification de " + nomContact(i); });
  annulable("suppContact", function (i) { return [photo("contacts", i)]; },
    function (i) { return "suppression de " + nomContact(i); });

  /** Le dernier geste annulable : { libelle, quand }, ou null. */
  D.annulable = function () {
    var g = pile[pile.length - 1];
    return g ? { libelle: g.libelle, quand: g.quand } : null;
  };

  /** Annule le dernier geste ; la promesse rend son libellé (null s'il n'y avait rien). */
  D.annule = function () {
    var g = pile.pop();
    if (!g) return Promise.resolve(null);
    return Promise.resolve().then(function () {
      g.photos.slice().reverse().forEach(function (p) {
        if (p.coll === "absences") {
          var m = D.membre(p.id);
          if (m) m.absences = copie(p.avant);
          return;
        }
        var liste = etat[p.coll] || (etat[p.coll] = []), k = trouveDans(liste, p.id);
        if (p.avant === null) { if (k >= 0) liste.splice(k, 1); }
        else if (k >= 0) liste[k] = copie(p.avant);
        else liste.push(copie(p.avant));
      });
      return sauve().then(function () { return g.libelle; });
    });
  };

  /* ------------------------------------------------------ jeu de démonstration */

  function demo() {
    var C = global.Cal;
    var l = C.lundi(C.isoAuj());                    // lundi de la semaine en cours
    var e = etatVierge();
    e.reglages.demo = true;

    function m(nom, prenom, metier, cap, statuts) {
      var o = { id: id(), nom: nom, prenom: prenom, metier: metier, statuts: statuts || [],
                capacite: cap, actif: true, absences: [],
                email: (prenom + "." + nom).toLowerCase().replace(/[^a-z.]/g, "") + "@exemple.ch" };
      e.membres.push(o); return o.id;
    }
    // Camille porte les trois casquettes, Marc et Yann mènent leurs projets,
    // les autres n'en portent aucune : de quoi voir le cumul à l'œuvre.
    var i1 = m("Berger", "Camille", "ingenieur", 5, ["administrateur", "chef_secteur", "chef_projet"]);
    var i2 = m("Rossi", "Marc", "ingenieur", 4, ["chef_projet"]);
    var d1 = m("Favre", "Léa", "dessinateur", 5);
    var d2 = m("Dubois", "Yann", "dessinateur", 5, ["chef_projet"]);
    var d3 = m("Keller", "Sophie", "dessinateur", 3);
    // Marc est à 80 % et ne vient jamais le mercredi ; Sophie ne travaille que trois jours
    e.membres.forEach(function (x) {
      if (x.id === i2) x.jours = [1, 1, 0, 1, 1];
      if (x.id === d3) x.jours = [1, 1, 0, 1, 0];
    });
    m("Nicolet", "Fabienne", "administratif", 4);

    function a(code, nom, teinte, ings, dess, phase, adresse, succursale) {
      var o = { id: id(), code: code, nom: nom, note: "", teinte: teinte, statut: "active",
                echeance: null, phase: phase, adresse: adresse || "", succursale: succursale || "",
                ingenieurs: ings, dessinateurs: dess };
      e.affaires.push(o); return o.id;
    }
    var a1 = a("24-118", "Immeuble de logements — gros œuvre", 1, [i1], [d1, d2], "51", "Avenue de la Gare 10, 1003 Lausanne", "lausanne");
    var a2 = a("25-004", "Halle industrielle — charpente béton", 2, [i2], [d2, d3], "32", "Route de Divonne 50, 1260 Nyon", "nyon");
    var a3 = a("25-031", "Passerelle piétonne", 3, [i1, i2], [d1], "31", "", "geneve");

    function t(aff, titre, ci, cd, ing, des, debut, ech, statut, av) {
      e.taches.push({
        id: id(), affaireId: aff, titre: titre, note: "",
        chargeInge: ci, chargeDessin: cd,
        debut: null, echeance: ech, ingenieurId: ing, dessinateurId: des,
        statut: statut, avancement: av, finiInge: false, finiDessin: false, enchaine: true,
        cree: new Date().toISOString(), maj: new Date().toISOString()
      });
    }
    t(a1, "Plans de coffrage niveau 1", 0.5, 4, i1, d1, l, C.ajoute(l, 4), "en_cours", 45);
    t(a1, "Plans d'armature dalle niveau 1", 1, 5, i1, d2, C.ajoute(l, 2), C.ajoute(l, 8), "a_faire", 0);
    t(a1, "Note de calcul dalle sur appuis", 2, 0, i1, null, C.ajoute(l, 7), C.ajoute(l, 11), "a_faire", 0);
    t(a2, "Prédimensionnement poutres de toiture", 3, 0, i2, null, C.ajoute(l, -3), C.ajoute(l, 1), "en_cours", 70);
    t(a2, "Coffrage des massifs de fondation", 0.5, 3, i2, d3, C.ajoute(l, 1), C.ajoute(l, 6), "a_faire", 0);
    t(a2, "Armature des voiles de contreventement", 1, 4, i2, d2, C.ajoute(l, 7), C.ajoute(l, 12), "a_faire", 0);
    t(a3, "Étude de variantes", 2.5, 1, i1, d1, C.ajoute(l, 3), C.ajoute(l, 9), "a_faire", 0);
    t(a3, "Dossier d'appel d'offres", 1, 2, i2, d1, C.ajoute(l, 10), C.ajoute(l, 16), "a_faire", 0);
    t(a1, "Reprise des plans après remarques", 0, 2, null, d1, C.ajoute(l, -5), C.ajoute(l, -1), "a_faire", 0);

    // Mandats, avancement et facturation : un historique de quelques mois pour la page Facturation
    function mandat(aff, m) { e.affaires.forEach(function (x) { if (x.id === aff) x.mandat = m; }); }
    mandat(a1, { "31": ["geotechnique", "structure"], "32": ["geotechnique", "structure"], "33": ["structure"],
                 "41": ["structure"], "51": ["genie_civil", "structure"], "52": ["structure"] });
    mandat(a2, { "31": ["structure"], "32": ["environnement", "structure"], "33": ["structure"] });
    mandat(a3, { "21": ["genie_civil", "structure"], "31": ["genie_civil", "geotechnique", "structure"] });
    function sa(aff, phase, disc, genre, valeurs, par) {
      // valeurs : une par mois, la dernière ce mois-ci
      valeurs.forEach(function (v, k) {
        var d = new Date(); d.setDate(5); d.setMonth(d.getMonth() - (valeurs.length - 1 - k));
        e.saisies.push({ id: id(), affaireId: aff, phase: phase, discipline: disc, genre: genre, valeur: v,
                         par: par, le: d.toISOString() });
      });
    }
    ["31", "32", "33", "41"].forEach(function (p) {
      sa(a1, p, "structure", "avancement", [60, 100], i1); sa(a1, p, "structure", "facturation", [50, 100], i1);
    });
    ["31", "32"].forEach(function (p) {
      sa(a1, p, "geotechnique", "avancement", [100], i1); sa(a1, p, "geotechnique", "facturation", [100], i1);
    });
    sa(a1, "51", "structure", "avancement", [20, 45, 70], i1); sa(a1, "51", "structure", "facturation", [20, 40, 60], i1);
    sa(a1, "51", "genie_civil", "avancement", [10, 30], i1); sa(a1, "51", "genie_civil", "facturation", [0, 40], i1);
    sa(a2, "31", "structure", "avancement", [80, 100], i2); sa(a2, "31", "structure", "facturation", [50, 100], i1);
    sa(a2, "32", "structure", "avancement", [25, 55], i2); sa(a2, "32", "structure", "facturation", [30], i1);
    sa(a2, "32", "environnement", "avancement", [40], i2);
    sa(a3, "21", "structure", "avancement", [100], i1); sa(a3, "21", "structure", "facturation", [100], i1);
    sa(a3, "21", "genie_civil", "avancement", [100], i1); sa(a3, "21", "genie_civil", "facturation", [80], i1);
    sa(a3, "31", "structure", "avancement", [15], i2);

    var sophie = e.membres.find(function (x) { return x.id === d3; });
    sophie.absences.push({ id: id(), debut: C.ajoute(l, 8), fin: C.ajoute(l, 12), motif: "Vacances" });
    // Un avis d'absence à l'heure près, pour que l'accueil en montre un
    var demain = C.ajoute(C.isoAuj(), 1);
    e.avis.push({ id: id(), membreId: i2, debut: demain + "T14:00", fin: demain + "T16:30",
                  motif: "Rendez-vous médical", cree: new Date().toISOString() });

    // Annuaire : de quoi montrer les trois cas — une personne dans une société,
    // une société seule, un indépendant sans société.
    function ct(nom, prenom, societe, tel, natel, mail, site, role, adr, npa, loc, canton, obs) {
      e.contacts.push({ id: id(), nom: nom, prenom: prenom, societe: societe, telephone: tel,
                        natel: natel, email: mail, site: site, role: role, adresse: adr, npa: npa,
                        localite: loc, canton: canton, pays: "Suisse", observations: obs });
    }
    ct("Devaud", "Claire", "Atelier Devaud architectes", "021 555 10 20", "079 555 10 21",
       "claire.devaud@exemple.ch", "www.exemple.ch", "Architecte", "Rue de la Gare 12", "1003", "Lausanne", "VD",
       "Interlocutrice pour l'immeuble de logements.");
    ct("", "", "Régie du Lac SA", "021 555 30 00", "", "contact@exemple.ch", "regie-exemple.ch",
       "Maître d'ouvrage", "Avenue du Léman 3", "1005", "Lausanne", "VD",
       "Passe par Mme Devaud pour les questions techniques.");
    ct("Ferreira", "Tiago", "", "", "078 555 44 12", "t.ferreira@exemple.ch", "", "Entreprise de gros œuvre",
       "", "1860", "Aigle", "VD", "Disponible tôt le matin.");

    return e;
  }

  global.Donnees = D;
})(window);
