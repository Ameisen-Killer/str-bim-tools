/* Client Supabase minimal — authentification et accès aux tables.
   ---------------------------------------------------------------------------
   Écrit à la main plutôt qu'emprunté à la bibliothèque officielle : le site
   n'embarque aucune dépendance, et l'outil n'a besoin que de six appels REST.
   Deux objets sont exposés :
     Sb       la session (connexion, déconnexion, jeton) et la requête brute
     Sb.ADAPT l'adaptateur de stockage attendu par donnees.js
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var cfg = (global.PLANIF_CONFIG || {}).supabase || {};
  var URL_BASE = (cfg.url || "").replace(/\/+$/, "");
  var CLE = cfg.cle || "";
  var CLE_SESSION = "planif.session";
  var configure = !!(URL_BASE && CLE);

  function erreur(m) { var e = new Error(m); e.metier = true; return e; }

  /* ------------------------------------------------------------- session */

  var session = null;
  try { session = JSON.parse(global.localStorage.getItem(CLE_SESSION) || "null"); } catch (e) { session = null; }

  function poseSession(s) {
    session = s;
    try {
      if (s) global.localStorage.setItem(CLE_SESSION, JSON.stringify(s));
      else global.localStorage.removeItem(CLE_SESSION);
    } catch (e) {}
    return s;
  }

  /** Normalise la réponse du serveur d'authentification. */
  function depuisJeton(j) {
    return {
      jeton: j.access_token,
      rafraichissement: j.refresh_token,
      expire: Date.now() + (j.expires_in || 3600) * 1000,
      email: (j.user && j.user.email) || (session && session.email) || "",
      userId: (j.user && j.user.id) || null,
      // Préférences d'affichage (thème…) : rangées dans le compte, elles suivent l'utilisateur d'un appareil à l'autre
      preferences: (j.user && j.user.user_metadata) || (session && session.preferences) || {}
    };
  }

  /** Recopie localement le thème du compte, pour qu'il soit posé dès le premier rendu. */
  function cacheTheme(s) {
    var t = s && s.preferences && s.preferences.theme;
    if (!t) return;
    try {
      global.localStorage.setItem("planif.theme:" + s.email, t);
      global.localStorage.setItem("planif.theme", t);
    } catch (e) {}
  }

  function appelAuth(chemin, corps) {
    return fetch(URL_BASE + "/auth/v1/" + chemin, {
      method: "POST",
      headers: { apikey: CLE, "Content-Type": "application/json" },
      body: JSON.stringify(corps)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        throw erreur(messageAuth(j, r.status));
      });
    });
  }

  /* Les messages de Supabase sont en anglais : on les retraduit pour l'écran. */
  function messageAuth(j, statut) {
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || "";
    if (/invalid login credentials/i.test(m)) return "Adresse ou mot de passe incorrect.";
    if (/email not confirmed/i.test(m)) return "Adresse non confirmée : ouvre le courriel de confirmation avant de te connecter.";
    if (/user already registered/i.test(m)) return "Un compte existe déjà pour cette adresse.";
    if (/signups not allowed/i.test(m)) return "Les inscriptions sont fermées sur ce projet.";
    if (/password should be at least/i.test(m)) return "Mot de passe trop court : six caractères au minimum.";
    if (/rate limit|too many/i.test(m)) return "Trop de tentatives. Patiente quelques minutes.";
    if (statut === 0) return "Serveur injoignable. Vérifie ta connexion.";
    return m || "Connexion impossible (" + statut + ").";
  }

  function connexion(email, motDePasse) {
    return appelAuth("token?grant_type=password", { email: email, password: motDePasse })
      .then(function (j) { var s = poseSession(depuisJeton(j)); cacheTheme(s); return s; });
  }

  function inscription(email, motDePasse) {
    return appelAuth("signup", { email: email, password: motDePasse })
      .then(function (j) {
        if (j.access_token) return { session: poseSession(depuisJeton(j)), confirmation: false };
        return { session: null, confirmation: true };   // confirmation par courriel demandée
      });
  }

  function rafraichis() {
    if (!session || !session.rafraichissement) return Promise.reject(erreur("Session expirée."));
    return appelAuth("token?grant_type=refresh_token", { refresh_token: session.rafraichissement })
      .then(function (j) { return poseSession(depuisJeton(j)); })
      .catch(function (e) { poseSession(null); throw e; });
  }

  function deconnexion() {
    var s = session;
    poseSession(null);
    if (!s) return Promise.resolve();
    return fetch(URL_BASE + "/auth/v1/logout", {
      method: "POST",
      headers: { apikey: CLE, Authorization: "Bearer " + s.jeton }
    }).catch(function () {}).then(function () {});
  }

  /** Relit le compte (préférences à jour, par exemple changées depuis un autre appareil). */
  function utilisateur() {
    return jeton().then(function (t) {
      return fetch(URL_BASE + "/auth/v1/user", { headers: { apikey: CLE, Authorization: "Bearer " + t } });
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) {
        if (u && session) { session.preferences = u.user_metadata || {}; poseSession(session); }
        return u;
      });
  }

  /** Fusionne des préférences dans le compte ({ theme: "clair" }…). */
  function enregistrePreferences(p) {
    return jeton().then(function (t) {
      return fetch(URL_BASE + "/auth/v1/user", {
        method: "PUT",
        headers: { apikey: CLE, Authorization: "Bearer " + t, "Content-Type": "application/json" },
        body: JSON.stringify({ data: p })
      });
    }).then(function (r) {
      if (!r.ok) throw erreur("Préférence non enregistrée sur le compte.");
      return r.json();
    }).then(function (u) {
      if (session) { session.preferences = (u && u.user_metadata) || p; poseSession(session); }
      return u;
    });
  }

  /** Jeton valide, rafraîchi si besoin. */
  function jeton() {
    if (!session) return Promise.reject(erreur("Aucune session."));
    if (session.expire - Date.now() > 60000) return Promise.resolve(session.jeton);
    return rafraichis().then(function (s) { return s.jeton; });
  }

  /* ------------------------------------------------------------- requêtes */

  function requete(chemin, options) {
    options = options || {};
    return jeton().then(function (t) {
      var entetes = {
        apikey: CLE, Authorization: "Bearer " + t,
        "Content-Type": "application/json"
      };
      if (options.prefer) entetes.Prefer = options.prefer;
      return fetch(URL_BASE + "/rest/v1/" + chemin, {
        method: options.methode || "GET",
        headers: entetes,
        body: options.corps ? JSON.stringify(options.corps) : undefined
      });
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (txt) {
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
        if (r.ok) return j;
        if (r.status === 401 || r.status === 403) {
          throw erreur("Accès refusé. Ton adresse est-elle bien dans la liste des accès ?");
        }
        throw erreur((j && (j.message || j.hint)) || ("Erreur " + r.status + " sur " + chemin));
      });
    });
  }

  var lit    = function (t, q) { return requete(t + "?" + (q || "select=*")); };
  var insere = function (t, l) { return requete(t, { methode: "POST", corps: l, prefer: "return=minimal" }); };
  var modifie = function (t, id, v) { return requete(t + "?id=eq." + encodeURIComponent(id), { methode: "PATCH", corps: v, prefer: "return=minimal" }); };
  var efface = function (t, id) { return requete(t + "?id=eq." + encodeURIComponent(id), { methode: "DELETE", prefer: "return=minimal" }); };

  /* ------------------------------------------------- traduction des champs */

  function vide(v) { return v === "" ? null : v; }

  var VERS_BASE = {
    membres: function (m) {
      return { id: m.id, nom: m.nom, prenom: m.prenom, email: m.email,
               role: m.role, capacite: m.capacite, actif: m.actif };
    },
    affaires: function (a) {
      return { id: a.id, code: a.code, nom: a.nom, note: a.note || "",
               teinte: a.teinte, statut: a.statut, echeance: vide(a.echeance) };
    },
    taches: function (t) {
      return { id: t.id, affaire_id: t.affaireId, titre: t.titre, note: t.note || "",
               charge_inge: t.chargeInge, charge_dessin: t.chargeDessin,
               debut: vide(t.debut), echeance: t.echeance,
               ingenieur_id: vide(t.ingenieurId), dessinateur_id: vide(t.dessinateurId),
               statut: t.statut, avancement: t.avancement };
    }
  };

  /* ------------------------------------------------------------ lecture */

  function charge() {
    return Promise.all([
      lit("membres", "select=*"),
      lit("absences", "select=*"),
      lit("affaires", "select=*"),
      lit("affaire_membres", "select=*"),
      lit("taches", "select=*"),
      lit("reglages", "select=*")
    ]).then(function (r) {
      var membres = r[0] || [], absences = r[1] || [], affaires = r[2] || [],
          liens = r[3] || [], taches = r[4] || [], reglages = (r[5] || [])[0] || {};

      var role = {};
      membres.forEach(function (m) { role[m.id] = m.role; });

      return {
        version: 1,
        reglages: {
          canton: reglages.canton || "VD",
          capaciteDefaut: parseFloat(reglages.capacite_defaut) || 5,
          demo: false
        },
        membres: membres.map(function (m) {
          return {
            id: m.id, nom: m.nom, prenom: m.prenom, email: m.email, role: m.role,
            capacite: parseFloat(m.capacite), actif: m.actif,
            absences: absences.filter(function (a) { return a.membre_id === m.id; })
              .map(function (a) { return { id: a.id, debut: a.debut, fin: a.fin, motif: a.motif }; })
          };
        }),
        affaires: affaires.map(function (a) {
          var equipe = liens.filter(function (l) { return l.affaire_id === a.id; });
          return {
            id: a.id, code: a.code, nom: a.nom, note: a.note || "",
            teinte: a.teinte, statut: a.statut, echeance: a.echeance,
            ingenieurs: equipe.filter(function (l) { return role[l.membre_id] === "ingenieur"; })
              .map(function (l) { return l.membre_id; }),
            dessinateurs: equipe.filter(function (l) { return role[l.membre_id] === "dessinateur"; })
              .map(function (l) { return l.membre_id; })
          };
        }),
        taches: taches.map(function (t) {
          return {
            id: t.id, affaireId: t.affaire_id, titre: t.titre, note: t.note || "",
            chargeInge: parseFloat(t.charge_inge), chargeDessin: parseFloat(t.charge_dessin),
            debut: t.debut, echeance: t.echeance,
            ingenieurId: t.ingenieur_id, dessinateurId: t.dessinateur_id,
            statut: t.statut, avancement: t.avancement,
            cree: t.cree_le, maj: t.maj_le
          };
        })
      };
    });
  }

  /* ------------------------------------------------------------ écriture
     donnees.js modifie l'état en mémoire puis demande l'enregistrement en
     fournissant l'état précédent. On en déduit les seules lignes à toucher :
     pas de réécriture complète, et l'ordre respecte les clés étrangères. */

  function parId(liste) {
    var m = {}; (liste || []).forEach(function (o) { m[o.id] = o; }); return m;
  }
  function memeChose(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /** Opérations à mener sur une collection plate. */
  function compare(avant, apres, versBase) {
    var a = parId(avant), b = parId(apres);
    var ajouts = [], modifs = [], retraits = [];
    apres.forEach(function (o) {
      var ligne = versBase(o);
      if (!a[o.id]) ajouts.push(ligne);
      else if (!memeChose(versBase(a[o.id]), ligne)) modifs.push(ligne);
    });
    avant.forEach(function (o) { if (!b[o.id]) retraits.push(o.id); });
    return { ajouts: ajouts, modifs: modifs, retraits: retraits };
  }

  function appliqueTable(table, d) {
    var suite = Promise.resolve();
    if (d.ajouts.length) suite = suite.then(function () { return insere(table, d.ajouts); });
    d.modifs.forEach(function (l) {
      suite = suite.then(function () {
        var v = {}; Object.keys(l).forEach(function (k) { if (k !== "id") v[k] = l[k]; });
        return modifie(table, l.id, v);
      });
    });
    return suite;
  }

  function toutesAbsences(etat) {
    var out = [];
    etat.membres.forEach(function (m) {
      (m.absences || []).forEach(function (a) {
        out.push({ id: a.id, membre_id: m.id, debut: a.debut, fin: a.fin, motif: a.motif });
      });
    });
    return out;
  }

  function tousLiens(etat) {
    var out = [];
    etat.affaires.forEach(function (a) {
      a.ingenieurs.concat(a.dessinateurs).forEach(function (m) {
        out.push({ id: a.id + "|" + m, affaire_id: a.id, membre_id: m });
      });
    });
    return out;
  }

  function ecrire(etat, precedent) {
    var av = precedent || { membres: [], affaires: [], taches: [], reglages: {} };

    var dMembres  = compare(av.membres || [], etat.membres, VERS_BASE.membres);
    var dAffaires = compare(av.affaires || [], etat.affaires, VERS_BASE.affaires);
    var dTaches   = compare(av.taches || [], etat.taches, VERS_BASE.taches);
    var dAbsences = compare(toutesAbsences(av), toutesAbsences(etat), function (a) { return a; });
    var liensAv = tousLiens(av), liensAp = tousLiens(etat);
    var cleAv = parId(liensAv), cleAp = parId(liensAp);
    var liensNeufs = liensAp.filter(function (l) { return !cleAv[l.id]; })
      .map(function (l) { return { affaire_id: l.affaire_id, membre_id: l.membre_id }; });
    var liensMorts = liensAv.filter(function (l) { return !cleAp[l.id]; });

    // Ordre : on retire ce qui dépend avant ce dont ça dépend, on ajoute l'inverse.
    var suite = Promise.resolve();

    dTaches.retraits.forEach(function (id) { suite = suite.then(function () { return efface("taches", id); }); });
    dAbsences.retraits.forEach(function (id) { suite = suite.then(function () { return efface("absences", id); }); });
    liensMorts.forEach(function (l) {
      suite = suite.then(function () {
        return requete("affaire_membres?affaire_id=eq." + l.affaire_id + "&membre_id=eq." + l.membre_id,
          { methode: "DELETE", prefer: "return=minimal" });
      });
    });
    dAffaires.retraits.forEach(function (id) { suite = suite.then(function () { return efface("affaires", id); }); });
    dMembres.retraits.forEach(function (id) { suite = suite.then(function () { return efface("membres", id); }); });

    suite = suite.then(function () { return appliqueTable("membres", dMembres); });
    suite = suite.then(function () { return appliqueTable("affaires", dAffaires); });
    suite = suite.then(function () { return appliqueTable("taches", dTaches); });
    suite = suite.then(function () { return appliqueTable("absences", dAbsences); });
    if (liensNeufs.length) suite = suite.then(function () { return insere("affaire_membres", liensNeufs); });

    var rAv = av.reglages || {}, rAp = etat.reglages;
    if (rAv.canton !== rAp.canton || rAv.capaciteDefaut !== rAp.capaciteDefaut) {
      suite = suite.then(function () {
        return requete("reglages?id=eq.true", {
          methode: "PATCH", prefer: "return=minimal",
          corps: { canton: rAp.canton, capacite_defaut: rAp.capaciteDefaut }
        });
      });
    }
    return suite.then(function () {});
  }

  global.Sb = {
    configure: configure,
    session: function () { return session; },
    connecte: function () { return !!session; },
    email: function () { return session ? session.email : ""; },
    connexion: connexion,
    inscription: inscription,
    deconnexion: deconnexion,
    rafraichis: rafraichis,
    utilisateur: utilisateur,
    enregistrePreferences: enregistrePreferences,
    requete: requete,
    ADAPT: {
      nom: "supabase",
      semeSiVide: false,
      lire: charge,
      ecrire: ecrire
    }
  };
})(window);
