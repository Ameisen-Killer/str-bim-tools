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
     Enrico est ingénieur, administrateur et chef de projet ; Christophe est
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

  // Du plus large au plus étroit : c'est l'ordre d'affichage des étiquettes.
  var ORDRE_STATUTS = ["administrateur", "chef_secteur", "chef_projet"];
  var STATUTS = {
    administrateur: "Administrateur", chef_secteur: "Chef de secteur", chef_projet: "Chef de projet"
  };
  // Version courte, pour les listes denses (colonne de la console, étiquettes)
  var STATUTS_COURTS = {
    administrateur: "Admin.", chef_secteur: "Secteur", chef_projet: "Projet"
  };
  // « Chefs de secteur », et non « chef de secteurs » : le pluriel ne s'ajoute pas à la fin
  var STATUTS_PLURIEL = {
    administrateur: "Administrateurs", chef_secteur: "Chefs de secteur", chef_projet: "Chefs de projet"
  };
  function libelleStatut(s) { return STATUTS[s] || s; }

  /* Les droits accordés aux groupes, cochés bureau par bureau dans la console.
     Qui ne porte aucun statut n'en a aucun : c'est l'utilisateur « lambda ».
     Ajouter un droit se fait ici — la base accepte n'importe quel code, elle ne
     juge que ce qu'elle sait appliquer (a_droit, base-supabase.sql). */
  var ORDRE_DROITS = ["affaires_creer", "taches_autrui", "absences_autrui"];
  var DROITS = {
    affaires_creer: {
      titre: "Ouvrir une affaire",
      aide: "Créer une nouvelle affaire, et la retirer. Sans ce droit, on travaille normalement sur les affaires existantes."
    },
    taches_autrui: {
      titre: "Créer des tâches pour les autres",
      aide: "Sans ce droit, on ne crée et ne modifie que les tâches dont une part chargée est la sienne — en désignant librement qui tient l'autre part, et en pouvant passer la main à un collègue."
    },
    absences_autrui: {
      titre: "Poser les absences des autres",
      aide: "Et régler leurs jours travaillés. Sans ce droit, chacun ne gère que ses propres absences et ses propres jours."
    }
  };

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
    // Avant toute phase SIA : l'offre du bureau (espace AB, module Inter-secteurs)
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

  /* Appels d'offres et leur agenda (espace AB, module Inter-secteurs, 06.10.2026) */
  var TYPES_AO = { public: "Public", prive: "Privé" };
  var RESULTATS_AO = { en_cours: "En cours", gagne: "Gagné", perdu: "Perdu", abandonne: "Abandonné" };
  var GENRES_AGENDA = {
    visite: "Visite des lieux", questions: "Questions", remise: "Remise de l'offre",
    ouverture: "Ouverture des offres", presentation: "Présentation", seance: "Séance", autre: "Autre"
  };
  var RE_HEURE = /^\d\d:\d\d$/;
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
      membres: [], affaires: [], taches: [], contacts: [], avis: [], agenda: [], rdv: []
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
  var abonnes = [], rechargements = [];
  var chargement = null;

  /* ---------------------------------------------------------------- profil
     Qui est connecté, dans quel bureau, avec quels droits. En mode local :
     un seul bureau, et tous les droits. */

  var profil = null, profilEnCours = null;

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
        profil = { multi: false, superAdmin: false, peutTout: true, metier: "", statuts: [],
                   droits: ORDRE_DROITS.slice(), bureau: null, bureaux: [] };
        return profil;
      }
      if (!brut.autorise) throw erreur(REFUS[brut.motif] || REFUS.inconnu);
      profil = {
        multi: true, email: brut.email || "", superAdmin: !!brut.superAdmin,
        // Fiche du planning rattachée à cette adresse dans la console (vide : accès sans fiche)
        membreId: brut.membreId || null,
        // Métier et statuts de cette fiche : sur quoi s'appuieront les droits d'accès
        metier: METIERS[brut.metier] ? brut.metier : "",
        statuts: ORDRE_STATUTS.filter(function (s) {
          return (brut.statuts || []).indexOf(s) >= 0;
        }),
        /* Les droits que ses statuts lui accordent, réunis par la base. Ils
           servent à ne pas proposer l'impossible ; c'est la base qui tranche. */
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

  function previens() { abonnes.forEach(function (f) { try { f(etat); } catch (e) { console.error(e); } }); }

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
      previens();
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
    var l = (Array.isArray(m.statuts) ? m.statuts : []).map(texte);
    if (m.metier === undefined && texte(m.role) === "administrateur") l.push("administrateur");
    return ORDRE_STATUTS.filter(function (s) { return l.indexOf(s) >= 0; });
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
        aoType: TYPES_AO[a.aoType] ? a.aoType : null,
        demandeurId: texte(a.demandeurId) || null,
        aoResultat: RESULTATS_AO[a.aoResultat] ? a.aoResultat : null,
        aoMontant: a.aoMontant == null || a.aoMontant === "" ? null : Math.max(0, nombre(a.aoMontant, 0)),
        secteurs: (a.secteurs || []).map(texte).filter(Boolean),
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
        // 1 la plus importante, 5 par défaut. Réglée par le curseur du formulaire
        // de tâche (version AB) ; colonne taches.priorite en base.
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
    (e.rdv || []).forEach(function (r) { r.id = neuf(r.id); r.participants = r.participants.map(neuf); r.creePar = neuf(r.creePar); });
    e.affaires.forEach(function (a) { a.demandeurId = neuf(a.demandeurId); });

    // Références orphelines : la base les refuserait, on les coupe ici.
    var vraisM = {}, vraisA = {};
    e.membres.forEach(function (m) { vraisM[m.id] = true; });
    e.affaires.forEach(function (a) { vraisA[a.id] = true; });
    e.affaires.forEach(function (a) {
      a.ingenieurs = a.ingenieurs.filter(function (x) { return vraisM[x]; });
      a.dessinateurs = a.dessinateurs.filter(function (x) { return vraisM[x]; });
    });
    e.taches = e.taches.filter(function (t) { return vraisA[t.affaireId]; });
    e.avis = (e.avis || []).filter(function (a) { return vraisM[a.membreId]; });
    e.agenda = (e.agenda || []).filter(function (r) { return vraisA[r.affaireId]; });
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
    if (!texte(o.code)) throw erreur("Le numéro d'affaire est obligatoire.");
    if (!texte(o.nom)) throw erreur("Le libellé de l'affaire est obligatoire.");
    var code = texte(o.code);
    var double = etat.affaires.some(function (a) {
      return a.id !== idExistant && a.code.toLowerCase() === code.toLowerCase();
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
    if ("aoResultat" in o) v.aoResultat = RESULTATS_AO[o.aoResultat] ? o.aoResultat : null;
    if ("aoMontant" in o) {
      var mt = texte(o.aoMontant).replace(/['’\s]/g, "");
      if (mt && !(parseFloat(mt.replace(",", ".")) >= 0)) throw erreur("Le montant de l'offre doit être un nombre (CHF).");
      v.aoMontant = mt ? Math.round(parseFloat(mt.replace(",", "."))) : null;
    }
    if ("secteurs" in o) v.secteurs = (o.secteurs || []).map(texte).filter(Boolean);
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
    // seulement quand le formulaire la porte (version AB), sinon elle reste telle quelle
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
    PARTS: PARTS,
    source: ADAPTATEUR.nom,

    /** Profil de la personne connectée (bureau, droits), sans charger les données : la console s'en contente. */
    chargeProfil: chargeProfil,
    profil: function () { return profil; },
    /** Tout effacer, importer : réservés au super admin quand la base compte plusieurs bureaux. */
    peutToutGerer: function () { return !profil || profil.peutTout; },

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
    reglages: function () { return etat.reglages; },
    canton: function () { return etat.reglages.canton; },

    surChangement: function (f) { abonnes.push(f); return function () { abonnes = abonnes.filter(function (x) { return x !== f; }); }; },
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
    recharge: function () {
      var lecture = file.then(function () {
        return ADAPTATEUR.lire().then(function (brut) {
          if (!brut) throw erreur("Lecture vide.");
          etat = normalise(brut);
          precedent = copie(etat);
          version++;
          previens();
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

    /** Le super admin a tous les droits : c'est lui qui les distribue. */
    aDroit: function (code) {
      if (!profil) return true;                       // profil pas encore lu
      if (profil.superAdmin) return true;
      return (profil.droits || []).indexOf(code) >= 0;
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
    suppAvis: function (i) {
      return Promise.resolve().then(function () {
        etat.avis = (etat.avis || []).filter(function (a) { return a.id !== i; });
        return sauve();
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
        Object.keys(champs).forEach(function (k) { if (k in t) t[k] = champs[k]; });
        accordeParts(t, partsNommees(champs), etait);
        t.maj = new Date().toISOString();
        return sauve().then(function () { return t; });
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

    /* ------------------------------------------------ rendez-vous du bureau
       L'agenda interne (espace AB, module Communication) : un rendez-vous, ses
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
       Un appel d'offres est une affaire en phase « AO » (espace AB, module
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

    estDemo: function () { return !!(etat && etat.reglages.demo); }
  };

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
  function nomAffaire(i) { var a = D.affaire(i); return a ? "l'affaire " + a.code : "l'affaire"; }
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
    function (o) { return "création de l'affaire " + texte(o.code); },
    function (a) { return [{ coll: "affaires", id: a.id, avant: null }]; });
  annulable("majAffaire", function (i) { return [photo("affaires", i)]; },
    function (i) { return "modification de " + nomAffaire(i); });
  // Supprimer une affaire emporte ses tâches : elles reviennent avec elle
  annulable("suppAffaire", function (i) {
    return [photo("affaires", i)].concat(etat.taches
      .filter(function (t) { return t.affaireId === i; })
      .map(function (t) { return { coll: "taches", id: t.id, avant: copie(t) }; }));
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
  annulable("suppAvis", function (i) { return [photo("avis", i)]; },
    function () { return "retrait de l'avis d'absence"; });

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

    function a(code, nom, teinte, ings, dess, phase, adresse) {
      var o = { id: id(), code: code, nom: nom, note: "", teinte: teinte, statut: "active",
                echeance: null, phase: phase, adresse: adresse || "", ingenieurs: ings, dessinateurs: dess };
      e.affaires.push(o); return o.id;
    }
    var a1 = a("24-118", "Immeuble de logements — gros œuvre", 1, [i1], [d1, d2], "51", "Avenue de la Gare 10, 1003 Lausanne");
    var a2 = a("25-004", "Halle industrielle — charpente béton", 2, [i2], [d2, d3], "32", "Route de Divonne 50, 1260 Nyon");
    var a3 = a("25-031", "Passerelle piétonne", 3, [i1, i2], [d1], "31");

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
