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

  function id() {
    return Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 7);
  }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function texte(v) { return String(v == null ? "" : v).trim(); }
  function nombre(v, defaut) { var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : defaut; }
  function erreur(m) { var e = new Error(m); e.metier = true; return e; }

  var ROLES = { ingenieur: "Ingénieur", dessinateur: "Dessinateur" };
  var STATUTS_TACHE = {
    a_faire: "À faire", en_cours: "En cours", attente: "En attente", termine: "Terminé"
  };
  var STATUTS_AFFAIRE = { active: "Active", suspendue: "Suspendue", terminee: "Terminée" };

  function etatVierge() {
    return {
      version: VERSION,
      reglages: { canton: "VD", capaciteDefaut: 5, demo: false },
      membres: [], affaires: [], taches: []
    };
  }

  /* ------------------------------------------------ adaptateur de stockage */

  var ADAPTATEUR = {
    nom: "navigateur",
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

  var etat = null;
  var abonnes = [];
  var chargement = null;

  function previens() { abonnes.forEach(function (f) { try { f(etat); } catch (e) { console.error(e); } }); }

  function sauve() {
    return ADAPTATEUR.ecrire(etat).then(function () { previens(); return etat; });
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
        role: ROLES[m.role] ? m.role : "dessinateur",
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
      e.taches.push({
        id: texte(t.id) || id(),
        affaireId: texte(t.affaireId),
        titre: texte(t.titre), note: texte(t.note),
        chargeInge: Math.max(0, nombre(t.chargeInge, 0)),
        chargeDessin: Math.max(0, nombre(t.chargeDessin, 0)),
        debut: texte(t.debut) || null,
        echeance: texte(t.echeance) || null,
        ingenieurId: texte(t.ingenieurId) || null,
        dessinateurId: texte(t.dessinateurId) || null,
        statut: STATUTS_TACHE[t.statut] ? t.statut : "a_faire",
        avancement: Math.min(100, Math.max(0, nombre(t.avancement, 0))),
        cree: texte(t.cree) || new Date().toISOString(),
        maj: texte(t.maj) || new Date().toISOString()
      });
    });
    return e;
  }

  /* ----------------------------------------------------------- validations */

  var RE_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function valideMembre(o, idExistant) {
    if (!texte(o.nom)) throw erreur("Le nom est obligatoire.");
    if (!texte(o.prenom)) throw erreur("Le prénom est obligatoire.");
    var mail = texte(o.email).toLowerCase();
    if (!mail) throw erreur("L'adresse e-mail est obligatoire.");
    if (!RE_MAIL.test(mail)) throw erreur("Cette adresse e-mail n'est pas valide.");
    if (!ROLES[o.role]) throw erreur("Le rôle doit être « ingénieur » ou « dessinateur ».");
    var double = etat.membres.some(function (m) { return m.id !== idExistant && m.email.toLowerCase() === mail; });
    if (double) throw erreur("Un membre utilise déjà cette adresse e-mail.");
    var cap = nombre(o.capacite, etat.reglages.capaciteDefaut);
    if (cap <= 0 || cap > 7) throw erreur("La capacité doit être comprise entre 0,5 et 7 jours par semaine.");
    return {
      nom: texte(o.nom), prenom: texte(o.prenom), email: mail,
      role: o.role, capacite: cap, actif: o.actif !== false
    };
  }

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
    var ci = Math.max(0, nombre(o.chargeInge, 0));
    var cd = Math.max(0, nombre(o.chargeDessin, 0));
    if (ci + cd <= 0) throw erreur("Indique au moins une durée estimée, côté ingénieur ou côté dessin.");
    if (ci > 0 && !texte(o.ingenieurId)) throw erreur("Une charge ingénieur est saisie : affecte un ingénieur.");
    if (cd > 0 && !texte(o.dessinateurId)) throw erreur("Une charge dessin est saisie : affecte un dessinateur.");
    if (texte(o.debut) && texte(o.echeance) && global.Cal.diff(o.debut, o.echeance) < 0) {
      throw erreur("Le début ne peut pas être postérieur à l'échéance.");
    }
    return {
      affaireId: texte(o.affaireId), titre: texte(o.titre), note: texte(o.note),
      chargeInge: ci, chargeDessin: cd,
      debut: texte(o.debut) || null, echeance: texte(o.echeance),
      ingenieurId: ci > 0 ? texte(o.ingenieurId) : (texte(o.ingenieurId) || null),
      dessinateurId: cd > 0 ? texte(o.dessinateurId) : (texte(o.dessinateurId) || null),
      statut: STATUTS_TACHE[o.statut] ? o.statut : "a_faire",
      avancement: Math.min(100, Math.max(0, nombre(o.avancement, 0)))
    };
  }

  /* ------------------------------------------------------------ API publique */

  var D = {
    ROLES: ROLES,
    STATUTS_TACHE: STATUTS_TACHE,
    STATUTS_AFFAIRE: STATUTS_AFFAIRE,
    source: ADAPTATEUR.nom,

    /** À appeler au chargement de chaque page. Renvoie l'état complet. */
    pret: function () {
      if (chargement) return chargement;
      chargement = ADAPTATEUR.lire().then(function (brut) {
        if (!brut) {
          etat = demo();                        // première visite : jeu de démonstration
          return ADAPTATEUR.ecrire(etat).then(function () { return etat; });
        }
        etat = normalise(brut);
        return etat;
      });
      return chargement;
    },

    etat: function () { return etat; },
    reglages: function () { return etat.reglages; },
    canton: function () { return etat.reglages.canton; },

    surChangement: function (f) { abonnes.push(f); return function () { abonnes = abonnes.filter(function (x) { return x !== f; }); }; },

    majReglages: function (o) {
      if (o.canton != null) etat.reglages.canton = texte(o.canton) || "VD";
      if (o.capaciteDefaut != null) etat.reglages.capaciteDefaut = nombre(o.capaciteDefaut, 5);
      if (o.demo != null) etat.reglages.demo = !!o.demo;
      return sauve();
    },

    /* --------------------------------------------------------- membres */
    membres: function (opts) {
      opts = opts || {};
      return etat.membres.filter(function (m) { return opts.tous ? true : m.actif; })
        .filter(function (m) { return opts.role ? m.role === opts.role : true; })
        .slice().sort(function (a, b) {
          return (a.nom + a.prenom).localeCompare(b.nom + b.prenom, "fr");
        });
    },
    membre: function (i) { return etat.membres.find(function (m) { return m.id === i; }) || null; },
    nomMembre: function (i) { var m = D.membre(i); return m ? m.prenom + " " + m.nom : "—"; },

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

    ajouteAbsence: function (i, o) {
      return Promise.resolve().then(function () {
        var m = D.membre(i); if (!m) throw erreur("Membre introuvable.");
        var debut = texte(o.debut), fin = texte(o.fin) || debut;
        if (!debut) throw erreur("Indique la date de début de l'absence.");
        if (global.Cal.diff(debut, fin) < 0) throw erreur("La fin de l'absence précède son début.");
        m.absences.push({ id: id(), debut: debut, fin: fin, motif: texte(o.motif) || "Absence" });
        m.absences.sort(function (a, b) { return a.debut < b.debut ? -1 : 1; });
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
    affaire: function (i) { return etat.affaires.find(function (a) { return a.id === i; }) || null; },

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
    taches: function (opts) {
      opts = opts || {};
      return etat.taches.filter(function (t) {
        if (opts.affaireId && t.affaireId !== opts.affaireId) return false;
        if (opts.membreId && t.ingenieurId !== opts.membreId && t.dessinateurId !== opts.membreId) return false;
        if (opts.sansTerminees && t.statut === "termine") return false;
        return true;
      }).slice().sort(function (a, b) {
        return (a.echeance || "9999") < (b.echeance || "9999") ? -1 : 1;
      });
    },
    tache: function (i) { return etat.taches.find(function (t) { return t.id === i; }) || null; },

    ajouteTache: function (o) {
      return Promise.resolve().then(function () {
        var v = valideTache(o);
        v.id = id(); v.cree = new Date().toISOString(); v.maj = v.cree;
        etat.taches.push(v);
        return sauve().then(function () { return v; });
      });
    },
    majTache: function (i, o) {
      return Promise.resolve().then(function () {
        var t = D.tache(i); if (!t) throw erreur("Tâche introuvable.");
        var v = valideTache(o);
        Object.keys(v).forEach(function (k) { t[k] = v[k]; });
        t.maj = new Date().toISOString();
        return sauve().then(function () { return t; });
      });
    },
    /** Écriture partielle, sans repasser par le formulaire (glisser-déposer, statut…). */
    retoucheTache: function (i, champs) {
      return Promise.resolve().then(function () {
        var t = D.tache(i); if (!t) throw erreur("Tâche introuvable.");
        Object.keys(champs).forEach(function (k) { if (k in t) t[k] = champs[k]; });
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

    /* ------------------------------------------------ sauvegarde / reprise */
    exporte: function () { return copie(etat); },
    importe: function (brut) {
      return Promise.resolve().then(function () {
        if (!brut || typeof brut !== "object" || !("membres" in brut)) {
          throw erreur("Ce fichier ne ressemble pas à une sauvegarde de la planification.");
        }
        etat = normalise(brut);
        etat.reglages.demo = false;
        return sauve();
      });
    },
    videTout: function () {
      return Promise.resolve().then(function () { etat = etatVierge(); return sauve(); });
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

    function m(nom, prenom, role, cap) {
      var o = { id: id(), nom: nom, prenom: prenom, role: role, capacite: cap, actif: true, absences: [],
                email: (prenom + "." + nom).toLowerCase().replace(/[^a-z.]/g, "") + "@exemple.ch" };
      e.membres.push(o); return o.id;
    }
    var i1 = m("Berger", "Camille", "ingenieur", 5);
    var i2 = m("Rossi", "Marc", "ingenieur", 4);
    var d1 = m("Favre", "Léa", "dessinateur", 5);
    var d2 = m("Dubois", "Yann", "dessinateur", 5);
    var d3 = m("Keller", "Sophie", "dessinateur", 3);

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
        debut: debut, echeance: ech, ingenieurId: ing, dessinateurId: des,
        statut: statut, avancement: av,
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

    return e;
  }

  global.Donnees = D;
})(window);
