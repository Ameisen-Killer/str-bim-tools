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
  var CHARGE_MAX = 999.9;                          // plafond de numeric(4,1) en base

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
     juge que ce qu'elle sait appliquer (voir migration-droits-groupes.sql). */
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
      aide: "Sans ce droit, chacun ne gère que ses propres absences."
    }
  };
  function libelleDroit(d) { return (DROITS[d] || {}).titre || d; }

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

  // Listes d'origine : mode local, et base qui n'est pas encore passée en multi-bureaux
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
      membres: [], affaires: [], taches: [], contacts: []
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
     Qui est connecté, dans quel bureau, avec quels droits. Sans base
     multi-bureaux (mode local, ou migration pas encore exécutée) : un seul
     bureau, et tous les droits, comme avant. */

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
           servent à ne pas proposer l'impossible ; c'est la base qui tranche.
           Absents (migration des droits pas encore passée) : tout est permis,
           comme avant. */
        droits: brut.droits ? (brut.droits || []).map(texte) : ORDRE_DROITS.slice(),
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

  function enFile(ecrire, instantane) {
    var gen = generation;
    var ecriture = file.then(function () {
      if (gen !== generation) throw erreur("Modification abandonnée : l'enregistrement précédent a échoué.");
      return ecrire();
    }).then(function () {
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
    var triees = etat.taches.slice().sort(function (a, b) {
      return (a.echeance || "9999") < (b.echeance || "9999") ? -1 : 1;
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

    // Références orphelines : la base les refuserait, on les coupe ici.
    var vraisM = {}, vraisA = {};
    e.membres.forEach(function (m) { vraisM[m.id] = true; });
    e.affaires.forEach(function (a) { vraisA[a.id] = true; });
    e.affaires.forEach(function (a) {
      a.ingenieurs = a.ingenieurs.filter(function (x) { return vraisM[x]; });
      a.dessinateurs = a.dessinateurs.filter(function (x) { return vraisM[x]; });
    });
    e.taches = e.taches.filter(function (t) { return vraisA[t.affaireId]; });
    e.taches.forEach(function (t) {
      if (!vraisM[t.ingenieurId]) t.ingenieurId = null;
      if (!vraisM[t.dessinateurId]) t.dessinateurId = null;
    });
    return e;
  }

  /* ----------------------------------------------------------- validations */

  var RE_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var MSG_ANNUAIRE = "L'annuaire n'est pas encore installé dans la base : migration-annuaire.sql reste à exécuter dans Supabase — relance-la si tu l'as déjà passée, elle ajoute l'adresse postale.";

  function valideMembre(o, idExistant) {
    if (!texte(o.nom)) throw erreur("Le nom est obligatoire.");
    if (!texte(o.prenom)) throw erreur("Le prénom est obligatoire.");
    var mail = texte(o.email).toLowerCase();              // facultative
    if (mail && !RE_MAIL.test(mail)) throw erreur("Cette adresse e-mail n'est pas valide.");
    var metier = texte(o.metier);
    if (metier && !METIERS[metier]) throw erreur("Métier inconnu.");
    var statuts = ORDRE_STATUTS.filter(function (s) {
      return (Array.isArray(o.statuts) ? o.statuts : []).indexOf(s) >= 0;
    });
    var succ = texte(o.succursale), disc = texte(o.discipline);
    if (succ && !SUCCURSALES[succ]) throw erreur("Succursale inconnue.");
    if (disc && !DISCIPLINES[disc]) throw erreur("Discipline inconnue.");
    if (succ && disc && disciplinesDe(succ).indexOf(disc) < 0) {
      throw erreur("La discipline « " + DISCIPLINES[disc] + " » n'existe pas à " + SUCCURSALES[succ] + ".");
    }
    var double = mail && etat.membres.some(function (m) { return m.id !== idExistant && m.email.toLowerCase() === mail; });
    if (double) throw erreur("Un membre utilise déjà cette adresse e-mail.");
    var cap = dixieme(nombre(o.capacite, etat.reglages.capaciteDefaut));
    if (!(cap >= 0.5 && cap <= 7)) throw erreur("La capacité doit être comprise entre 0,5 et 7 jours par semaine.");
    return {
      nom: texte(o.nom), prenom: texte(o.prenom), email: mail,
      metier: metier, statuts: statuts,
      succursale: succ, discipline: disc, capacite: cap, actif: o.actif !== false
    };
  }

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

  /** « Rue de la Gare 12, 1003 Lausanne (VD) » — ce qui est rempli, dans l'ordre. */
  function adressePostale(c) {
    var ville = [texte(c.npa), texte(c.localite)].filter(Boolean).join(" ");
    var lieu = ville + (texte(c.canton) ? (ville ? " " : "") + "(" + c.canton + ")" : "");
    return [texte(c.adresse), lieu, texte(c.pays)].filter(Boolean).join(", ");
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
    return {
      code: code, nom: texte(o.nom), note: texte(o.note),
      teinte: Math.min(8, Math.max(1, parseInt(o.teinte, 10) || 1)),
      statut: STATUTS_AFFAIRE[o.statut] ? o.statut : "active",
      echeance: texte(o.echeance) || null,
      ingenieurs: (o.ingenieurs || []).filter(Boolean),
      dessinateurs: (o.dessinateurs || []).filter(Boolean)
    };
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
    return {
      affaireId: texte(o.affaireId), titre: texte(o.titre), note: texte(o.note),
      chargeInge: ci, chargeDessin: cd,
      debut: null, echeance: texte(o.echeance),
      ingenieurId: texte(o.ingenieurId) || null,
      dessinateurId: texte(o.dessinateurId) || null,
      statut: STATUTS_TACHE[o.statut] ? o.statut : "a_faire",
      avancement: Math.min(100, Math.max(0, nombre(o.avancement, 0))),
      finiInge: o.finiInge === true,
      finiDessin: o.finiDessin === true
    };
  }

  /* ------------------------------------------------------------ API publique */

  var D = {
    METIERS: METIERS,
    ORDRE_METIERS: ORDRE_METIERS,
    TITRES_METIERS: TITRES_METIERS,
    PLANIFIES: PLANIFIES,
    cote: cote,
    libelleMetier: libelleMetier,
    STATUTS: STATUTS,
    STATUTS_COURTS: STATUTS_COURTS,
    STATUTS_PLURIEL: STATUTS_PLURIEL,
    ORDRE_STATUTS: ORDRE_STATUTS,
    libelleStatut: libelleStatut,
    statutsDe: statutsDe,
    aStatut: aStatut,
    DROITS: DROITS,
    ORDRE_DROITS: ORDRE_DROITS,
    libelleDroit: libelleDroit,
    compareMembres: compareMembres,
    parMetier: parMetier,
    SUCCURSALES: SUCCURSALES,
    DISCIPLINES: DISCIPLINES,
    DISCIPLINES_PAR_SUCCURSALE: DISCIPLINES_PAR_SUCCURSALE,
    disciplinesDe: disciplinesDe,
    STATUTS_TACHE: STATUTS_TACHE,
    STATUTS_AFFAIRE: STATUTS_AFFAIRE,
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

    ajouteMembre: function (o) {
      return Promise.resolve().then(function () {
        var v = valideMembre(o, null);
        v.id = id(); v.absences = [];
        etat.membres.push(v);
        return sauve().then(function () { return v; });
      });
    },
    majMembre: function (i, o) {
      return Promise.resolve().then(function () {
        var m = D.membre(i); if (!m) throw erreur("Membre introuvable.");
        var v = valideMembre(o, i);
        Object.keys(v).forEach(function (k) { m[k] = v[k]; });
        return sauve().then(function () { return m; });
      });
    },
    suppMembre: function (i) {
      return Promise.resolve().then(function () {
        etat.membres = etat.membres.filter(function (m) { return m.id !== i; });
        etat.affaires.forEach(function (a) {
          a.ingenieurs = a.ingenieurs.filter(function (x) { return x !== i; });
          a.dessinateurs = a.dessinateurs.filter(function (x) { return x !== i; });
        });
        etat.taches.forEach(function (t) {
          if (t.ingenieurId === i) t.ingenieurId = null;
          if (t.dessinateurId === i) t.dessinateurId = null;
        });
        return sauve();
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
    /* La table est arrivée après les autres, et sa migration se lance à la
       main : tant qu'elle n'est pas passée, l'annuaire se lit vide et refuse
       d'écrire, plutôt que d'envoyer vers une table qui n'existe pas. */
    annuaireEnBase: function () {
      return !ADAPTATEUR.annuaireEnBase || ADAPTATEUR.annuaireEnBase();
    },

    adressePostale: adressePostale,
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
        if (!D.annuaireEnBase()) throw erreur(MSG_ANNUAIRE);
        var v = valideContact(o);
        v.id = id();
        etat.contacts.push(v);
        return sauve().then(function () { return v; });
      });
    },
    majContact: function (i, o) {
      return Promise.resolve().then(function () {
        if (!D.annuaireEnBase()) throw erreur(MSG_ANNUAIRE);
        var c = D.contact(i); if (!c) throw erreur("Fiche introuvable.");
        var v = valideContact(o);
        Object.keys(v).forEach(function (k) { c[k] = v[k]; });
        return sauve().then(function () { return c; });
      });
    },
    suppContact: function (i) {
      return Promise.resolve().then(function () {
        if (!D.annuaireEnBase()) throw erreur(MSG_ANNUAIRE);
        etat.contacts = etat.contacts.filter(function (c) { return c.id !== i; });
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
    chargeDemo: function () {
      return Promise.resolve().then(function () { etat = demo(); return sauve(); });
    },
    estDemo: function () { return !!(etat && etat.reglages.demo); }
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
    m("Nicolet", "Fabienne", "administratif", 4);

    function a(code, nom, teinte, ings, dess) {
      var o = { id: id(), code: code, nom: nom, note: "", teinte: teinte, statut: "active",
                echeance: null, ingenieurs: ings, dessinateurs: dess };
      e.affaires.push(o); return o.id;
    }
    var a1 = a("24-118", "Immeuble de logements — gros œuvre", 1, [i1], [d1, d2]);
    var a2 = a("25-004", "Halle industrielle — charpente béton", 2, [i2], [d2, d3]);
    var a3 = a("25-031", "Passerelle piétonne", 3, [i1, i2], [d1]);

    function t(aff, titre, ci, cd, ing, des, debut, ech, statut, av) {
      e.taches.push({
        id: id(), affaireId: aff, titre: titre, note: "",
        chargeInge: ci, chargeDessin: cd,
        debut: null, echeance: ech, ingenieurId: ing, dessinateurId: des,
        statut: statut, avancement: av, finiInge: false, finiDessin: false,
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
