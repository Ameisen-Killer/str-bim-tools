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

  /* code : code d'erreur de la base ou de l'API (PGRST202…), quand il y en a un */
  function erreur(m, code) { var e = new Error(m); e.metier = true; if (code) e.code = code; return e; }

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

  /** Panne réseau (hors ligne, sortie de veille…) : à distinguer d'un refus du serveur. */
  function erreurReseau() {
    var e = erreur("Serveur injoignable. Vérifie ta connexion, puis réessaie.");
    e.reseau = true;
    return e;
  }

  function appelAuth(chemin, corps) {
    return fetch(URL_BASE + "/auth/v1/" + chemin, {
      method: "POST",
      headers: { apikey: CLE, "Content-Type": "application/json" },
      body: JSON.stringify(corps)
    }).catch(function () { throw erreurReseau(); }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        throw erreur(messageAuth(j, r.status));
      });
    });
  }

  /* Les messages de Supabase sont en anglais : on les retraduit pour l'écran.
     Celui de la garde des comptes (base) est déjà en français : il passe tel quel. */
  function messageAuth(j, statut) {
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || "";
    var attente = /after (\d+) seconds?/i.exec(m);
    if (/invalid login credentials/i.test(m)) return "Adresse ou mot de passe incorrect.";
    if (/email not confirmed/i.test(m)) return "Adresse pas encore activée : ouvre le lien reçu par courriel, ou redemande-le.";
    if (/user already registered/i.test(m)) return "Un compte existe déjà pour cette adresse.";
    if (/signups? not allowed/i.test(m)) return "La création de comptes est fermée sur ce projet.";
    if (/password should be at least/i.test(m)) return "Mot de passe trop court : six caractères au minimum.";
    if (/should be different from the old password/i.test(m)) return "Choisis un mot de passe différent de l'ancien.";
    if (/weak|known to be/i.test(m)) return "Mot de passe trop faible : choisis-en un plus long ou moins courant.";
    if (/invalid or has expired|otp_expired|token has expired/i.test(m)) return "Ce lien a expiré ou a déjà servi : redemande-en un.";
    if (/not authorized/i.test(m)) return "Courriel refusé par Supabase : sans serveur d'envoi à toi (SMTP), il ne livre qu'aux membres de ton équipe Supabase.";
    if (/error sending/i.test(m)) return "Envoi du courriel impossible : vérifie le serveur d'envoi (SMTP) du projet Supabase.";
    if (attente) return "Patiente " + attente[1] + " secondes avant de redemander un lien.";
    if (/email rate limit/i.test(m)) return "Limite d'envoi de courriels atteinte : réessaie plus tard.";
    if (/rate limit|too many/i.test(m)) return "Trop de tentatives. Patiente quelques minutes.";
    return m || "Connexion impossible (" + statut + ").";
  }

  function connexion(email, motDePasse) {
    return appelAuth("token?grant_type=password", { email: email, password: motDePasse })
      .then(function (j) { var s = poseSession(depuisJeton(j)); cacheTheme(s); return s; });
  }

  /* Plus d'inscription libre : un compte naît quand on demande un lien pour une
     adresse inscrite dans la liste des accès (console du super admin). */

  /**
   * Lien de connexion par courriel. Crée le compte s'il n'existe pas encore —
   * la garde de la base (hook « Before User Created ») refuse les adresses
   * absentes de la liste des accès. Nouveau compte : courriel « Confirm
   * signup » ; compte existant : « Magic Link ». Les deux ramènent sur la page
   * de connexion, qui fait choisir un mot de passe.
   */
  function envoieLien(email) {
    var retour = global.location.origin + "/planif/connexion/";
    return appelAuth("otp?redirect_to=" + encodeURIComponent(retour), { email: email, create_user: true });
  }

  /**
   * Jeton reçu dans un lien (modèles de courriels avec {{ .TokenHash }}) contre
   * une session. Valable une seule fois : la page ne l'échange qu'au moment où
   * la personne valide son mot de passe, jamais au chargement — un antivirus de
   * messagerie qui ouvre les liens à l'avance ne le consomme donc pas.
   */
  function verifieLien(jeton, type) {
    return appelAuth("verify", { type: type === "recovery" ? "recovery" : "email", token_hash: jeton });
  }

  /**
   * Mot de passe choisi depuis un lien reçu par courriel. jetons : réponse de
   * verifieLien, ou jetons lus dans l'adresse (#access_token=…). La session
   * s'ouvre dans la foulée.
   */
  function choisitMotDePasse(jetons, motDePasse) {
    return fetch(URL_BASE + "/auth/v1/user", {
      method: "PUT",
      headers: { apikey: CLE, Authorization: "Bearer " + jetons.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ password: motDePasse })
    }).catch(function () { throw erreurReseau(); }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (u) {
        if (r.status === 401 || r.status === 403) throw erreur("Ce lien a expiré : redemande-en un.");
        if (!r.ok) throw erreur(messageAuth(u, r.status));
        var s = poseSession(depuisJeton({
          access_token: jetons.access_token, refresh_token: jetons.refresh_token,
          expires_in: parseInt(jetons.expires_in, 10) || 3600, user: u
        }));
        cacheTheme(s);
        return s;
      });
    });
  }

  /* Un seul renouvellement à la fois : au chargement, six lectures partent
     ensemble et auraient chacune présenté le même jeton de renouvellement.
     Une panne réseau ne déconnecte pas : la session reste, on réessaiera.
     Seul un refus du serveur (jeton révoqué ou expiré) la fait tomber. */
  var renouvellement = null;

  function rafraichis() {
    if (renouvellement) return renouvellement;
    if (!session || !session.rafraichissement) return Promise.reject(erreur("Session expirée."));
    renouvellement = appelAuth("token?grant_type=refresh_token", { refresh_token: session.rafraichissement })
      .then(function (j) { return poseSession(depuisJeton(j)); }, function (e) {
        if (e.reseau) throw e;
        poseSession(null);
        throw erreur("Session expirée : reconnecte-toi.");
      });
    var libere = function () { renouvellement = null; };
    renouvellement.then(libere, libere);
    return renouvellement;
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
      if (options.plage) { entetes["Range-Unit"] = "items"; entetes.Range = options.plage; }
      return fetch(URL_BASE + "/rest/v1/" + chemin, {
        method: options.methode || "GET",
        headers: entetes,
        body: options.corps ? JSON.stringify(options.corps) : undefined
      }).catch(function () { throw erreurReseau(); });
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (txt) {
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
        if (r.ok) {
          if (!options.avecTotal) return j;
          var total = parseInt(((r.headers.get("Content-Range") || "").split("/")[1]), 10);
          return { lignes: j || [], total: isNaN(total) ? null : total };
        }
        var code = j && j.code;
        /* 42501 : la RLS a refusé l'écriture. C'est presque toujours un droit
           qui manque — créer une affaire, poser l'absence d'un collègue,
           toucher une tâche qui ne nous concerne pas. PostgREST répond 403,
           donc ce test passe AVANT celui du 401/403 : sinon le refus se lisait
           « ton adresse n'est pas dans la liste des accès », ce qui est faux et
           inquiète pour rien. Les pages posent déjà leurs garde-fous ; ce
           message-ci est le filet, quand l'écran est resté ouvert trop
           longtemps ou qu'on a contourné le formulaire. */
        if (code === "42501") {
          throw erreur("Tu n'as pas le droit de faire cela : cette action demande un droit que ton groupe n'a pas, ou ne porte pas sur ce qui te concerne. L'affichage a été rechargé.", code);
        }
        if (r.status === 401 || r.status === 403) {
          throw erreur("Accès refusé. Ton adresse est-elle bien dans la liste des accès ?", code);
        }
        // Codes PostgreSQL les plus probables, traduits pour l'écran
        if (code === "23505") throw erreur("Enregistrement refusé : ce numéro d'affaire ou cette adresse e-mail existe déjà (peut-être créé entre-temps par un collègue). L'affichage a été rechargé.", code);
        if (code === "23503") throw erreur("Enregistrement refusé : un élément lié (affaire ou membre) a été supprimé entre-temps, ou n'appartient pas au bureau affiché. L'affichage a été rechargé.", code);
        if (code === "23514" || code === "22003") throw erreur("Enregistrement refusé : une valeur sort des limites de la base. L'affichage a été rechargé.", code);
        // Les fonctions de la base (console, profil) répondent en français : le message passe tel quel
        throw erreur((j && (j.message || j.hint)) || ("Erreur " + r.status + " sur " + chemin), code);
      });
    });
  }

  /** Appel d'une fonction de la base (profil, console). */
  function rpc(nom, args) {
    return requete("rpc/" + nom, { methode: "POST", corps: args || {} });
  }

  /* Profil de la personne connectée : bureau, droits, succursales et
     disciplines du bureau. Tant que la migration multi-bureaux n'a pas été
     exécutée, la fonction n'existe pas (PGRST202) : null, et l'outil garde
     son fonctionnement d'avant. */
  function profil() {
    return rpc("mon_profil").catch(function (e) {
      if (e.code === "PGRST202") return null;
      throw e;
    });
  }

  /* Réglages publics du service de connexion : inscriptions ouvertes ou non,
     confirmation de l'adresse. La console s'en sert pour signaler un réglage manquant. */
  function reglagesAuth() {
    return fetch(URL_BASE + "/auth/v1/settings", { headers: { apikey: CLE } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /*
   * Lecture complète d'une table, par pages.
   * Supabase plafonne chaque réponse (1 000 lignes par défaut) : une lecture en
   * un seul appel tronquerait silencieusement les grosses tables. La première
   * page donne le total ; les suivantes partent ensuite en parallèle. La taille
   * de page réelle est lue sur la première réponse, au cas où le plafond du
   * projet serait plus bas que prévu. Le tri garantit des pages sans trou ni doublon.
   */
  var PAGE = 1000;

  function litTout(table, ordre) {
    var base = table + "?select=*&order=" + ordre;
    return requete(base, { plage: "0-" + (PAGE - 1), prefer: "count=exact", avecTotal: true }).then(function (p) {
      var lignes = p.lignes, total = p.total;
      if (total === null) return lignes.length ? suiteSequentielle(base, lignes, lignes.length) : lignes;
      if (lignes.length >= total) return lignes;
      var pas = Math.max(1, lignes.length);
      var pages = [];
      for (var debut = pas; debut < total; debut += pas) {
        pages.push(requete(base, { plage: debut + "-" + Math.min(total - 1, debut + pas - 1) }));
      }
      return Promise.all(pages).then(function (suites) {
        return suites.reduce(function (acc, l) { return acc.concat(l || []); }, lignes);
      });
    });
  }

  /** Total inconnu (en-tête absent) : on enchaîne tant que les pages reviennent pleines. */
  function suiteSequentielle(base, acc, pas) {
    return requete(base, { plage: acc.length + "-" + (acc.length + pas - 1) }).then(function (l) {
      acc = acc.concat(l || []);
      return (l && l.length === pas) ? suiteSequentielle(base, acc, pas) : acc;
    });
  }
  /* Insertion rejouable : si une écriture a été coupée après que la base a
     enregistré ces lignes, les renvoyer ne doit pas échouer sur un doublon de
     clé — la ligne existante est simplement mise à jour. */
  var insere = function (t, l) {
    return requete(t, { methode: "POST", corps: l, prefer: "resolution=merge-duplicates,return=minimal" });
  };

  /* Suppression par lots. PostgREST accepte une liste d'identifiants : effacer
     ligne par ligne, c'était un aller-retour par ligne, et vider un bureau
     chargé en demandait plusieurs milliers à la suite. Cent identifiants font
     une URL d'environ 3,7 ko, loin des limites des serveurs et des navigateurs. */
  var LOT = 100;

  function enLots(liste, taille) {
    var out = [];
    for (var i = 0; i < liste.length; i += taille) out.push(liste.slice(i, i + taille));
    return out;
  }

  function liste(ids) { return "(" + ids.map(encodeURIComponent).join(",") + ")"; }

  function effaceLot(table, ids) {
    var suite = Promise.resolve();
    enLots(ids, LOT).forEach(function (paquet) {
      suite = suite.then(function () {
        return requete(table + "?id=in." + liste(paquet), { methode: "DELETE", prefer: "return=minimal" });
      });
    });
    return suite;
  }

  /* Tout vider : deux suppressions suffisent. Les tâches et les liens d'équipe
     partent en cascade avec leur affaire, les absences avec leur membre
     (voir base-supabase.sql). Les réglages ne sont pas des données : le canton
     et la capacité par défaut restent en place. */
  function videTout() {
    return requete("affaires?id=not.is.null", { methode: "DELETE", prefer: "return=minimal" })
      .then(function () { return requete("membres?id=not.is.null", { methode: "DELETE", prefer: "return=minimal" }); })
      .then(function () {
        // L'annuaire ne pend à rien : aucune cascade ne l'emporte
        if (annuaireEnBase) return requete("contacts?id=not.is.null", { methode: "DELETE", prefer: "return=minimal" });
      })
      .then(function () {});
  }

  /* ------------------------------------------------- traduction des champs */

  function vide(v) { return v === "" ? null : v; }

  /* Les colonnes fini_inge / fini_dessin sont arrivées après coup (parts de
     tâche terminées séparément). Tant que la migration n'a pas été passée dans
     Supabase, les envoyer ferait refuser toute écriture de tâche : la lecture
     dit si la base les connaît. À simplifier une fois la migration en place. */
  var partsEnBase = true;

  /* Idem pour metier / statuts, arrivés quand le rôle unique s'est scindé en
     métier et statuts cumulables : tant que migration-roles-statuts.sql n'est
     pas passée, la base ne connaît que « role ». La lecture le dit.
     À simplifier une fois la migration en place. */
  var metiersEnBase = true;

  /* L'annuaire est arrivé après coup, et sa migration se lance à la main :
     tant que la table manque, PostgREST répond « table inconnue » (PGRST205,
     ou 42P01 sur les versions plus anciennes). Faire échouer toute la lecture
     pour cela priverait l'équipe de l'outil entier ; l'annuaire se montre donc
     vide, en annonçant la migration, et le reste fonctionne.
     À simplifier une fois la migration passée partout. */
  var annuaireEnBase = true;

  function tableAbsente(e) {
    return e && (e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42P01");
  }

  function litAnnuaire() {
    return litTout("contacts", "id").catch(function (e) {
      if (!tableAbsente(e)) throw e;
      annuaireEnBase = false;
      return [];
    });
  }

  var VERS_BASE = {
    membres: function (m) {
      var o = { id: m.id, nom: m.nom, prenom: m.prenom, email: vide(m.email),
                succursale: vide(m.succursale), discipline: vide(m.discipline),
                capacite: m.capacite, actif: m.actif };
      if (metiersEnBase) { o.metier = vide(m.metier); o.statuts = m.statuts || []; }
      else o.role = vide(m.metier);
      return o;
    },
    affaires: function (a) {
      return { id: a.id, code: a.code, nom: a.nom, note: a.note || "",
               teinte: a.teinte, statut: a.statut, echeance: vide(a.echeance) };
    },
    taches: function (t) {
      var o = { id: t.id, affaire_id: t.affaireId, titre: t.titre, note: t.note || "",
                charge_inge: t.chargeInge, charge_dessin: t.chargeDessin,
                debut: vide(t.debut), echeance: t.echeance,
                ingenieur_id: vide(t.ingenieurId), dessinateur_id: vide(t.dessinateurId),
                statut: t.statut, avancement: t.avancement };
      if (partsEnBase) { o.fini_inge = t.finiInge === true; o.fini_dessin = t.finiDessin === true; }
      return o;
    },
    contacts: function (c) {
      return { id: c.id, nom: c.nom, prenom: c.prenom, societe: c.societe,
               telephone: c.telephone, natel: c.natel, email: c.email,
               role: c.role, observations: c.observations };
    }
  };

  /* ------------------------------------------------------------ lecture */

  function charge() {
    return Promise.all([
      litTout("membres", "id"),
      litTout("absences", "id"),
      litTout("affaires", "id"),
      litTout("affaire_membres", "affaire_id,membre_id"),
      litTout("taches", "id"),
      litTout("reglages", "id"),
      litAnnuaire()
    ]).then(function (r) {
      var membres = r[0] || [], absences = r[1] || [], affaires = r[2] || [],
          liens = r[3] || [], taches = r[4] || [], reglages = (r[5] || [])[0] || {},
          contacts = r[6] || [];

      // La base connaît-elle déjà les parts terminées ? (colonnes fini_inge / fini_dessin)
      partsEnBase = !taches.length || ("fini_inge" in taches[0]);
      // … et le métier séparé des statuts ? (migration-roles-statuts.sql)
      metiersEnBase = !membres.length || ("metier" in membres[0]);

      // Avant la migration, « administrateur » était un rôle, planifié du côté ingénieur
      function metierDe(m) {
        var v = metiersEnBase ? m.metier : m.role;
        return v === "administrateur" ? "ingenieur" : (v || "");
      }
      function statutsDe(m) {
        if (!metiersEnBase) return m.role === "administrateur" ? ["administrateur"] : [];
        return Array.isArray(m.statuts) ? m.statuts : [];
      }

      // Côté de chacun dans l'équipe d'une affaire
      var cote = global.Donnees ? global.Donnees.cote : function (r) { return r; };
      var role = {};
      membres.forEach(function (m) { role[m.id] = cote(metierDe(m)); });

      return {
        version: 1,
        reglages: {
          canton: reglages.canton || "VD",
          capaciteDefaut: parseFloat(reglages.capacite_defaut) || 5,
          demo: false
        },
        membres: membres.map(function (m) {
          return {
            id: m.id, nom: m.nom, prenom: m.prenom, email: m.email || "",
            metier: metierDe(m), statuts: statutsDe(m),
            succursale: m.succursale || "", discipline: m.discipline || "",
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
            finiInge: t.fini_inge === true, finiDessin: t.fini_dessin === true,
            cree: t.cree_le, maj: t.maj_le
          };
        }),
        contacts: contacts.map(function (c) {
          return {
            id: c.id, nom: c.nom || "", prenom: c.prenom || "", societe: c.societe || "",
            telephone: c.telephone || "", natel: c.natel || "", email: c.email || "",
            role: c.role || "", observations: c.observations || ""
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
  function pareil(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /**
   * Opérations à mener sur une collection plate.
   * Une modification ne retient que les champs qui ont bougé : la base reçoit
   * le changement, pas toute la ligne. Deux collègues qui touchent deux
   * colonnes différentes de la même tâche ne s'écrasent donc plus.
   */
  function compare(avant, apres, versBase) {
    var a = parId(avant), b = parId(apres);
    var ajouts = [], modifs = [], retraits = [];
    apres.forEach(function (o) {
      var ligne = versBase(o);
      if (!a[o.id]) return ajouts.push(ligne);
      var vieux = versBase(a[o.id]), champs = null;
      Object.keys(ligne).forEach(function (k) {
        if (k !== "id" && !pareil(ligne[k], vieux[k])) (champs || (champs = {}))[k] = ligne[k];
      });
      if (champs) modifs.push({ id: o.id, champs: champs });
    });
    avant.forEach(function (o) { if (!b[o.id]) retraits.push(o.id); });
    return { ajouts: ajouts, modifs: modifs, retraits: retraits };
  }

  function appliqueTable(table, d) {
    var suite = Promise.resolve();
    if (d.ajouts.length) suite = suite.then(function () { return insere(table, d.ajouts); });

    /* Les lignes qui subissent le même changement partent ensemble : retirer un
       membre désaffecte toutes ses tâches de la même façon, c'était auparavant
       une requête par tâche. */
    var groupes = {};
    d.modifs.forEach(function (m) {
      var cle = JSON.stringify(m.champs);
      (groupes[cle] || (groupes[cle] = { champs: m.champs, ids: [] })).ids.push(m.id);
    });
    Object.keys(groupes).forEach(function (cle) {
      var g = groupes[cle];
      enLots(g.ids, LOT).forEach(function (paquet) {
        suite = suite.then(function () {
          return requete(table + "?id=in." + liste(paquet),
            { methode: "PATCH", corps: g.champs, prefer: "return=minimal" });
        });
      });
    });
    return suite;
  }

  /** { valeur de cle : [valeurs de champ] } */
  function groupe(liste, cle, champ) {
    var out = {};
    liste.forEach(function (l) { (out[l[cle]] || (out[l[cle]] = [])).push(l[champ]); });
    return out;
  }

  /** Nombre de requêtes qu'un regroupement demanderait. */
  function appels(groupes) {
    return Object.keys(groupes).reduce(function (n, k) { return n + Math.ceil(groupes[k].length / LOT); }, 0);
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
    var dContacts = compare(av.contacts || [], etat.contacts || [], VERS_BASE.contacts);
    var liensAv = tousLiens(av), liensAp = tousLiens(etat);
    var cleAv = parId(liensAv), cleAp = parId(liensAp);
    var liensNeufs = liensAp.filter(function (l) { return !cleAv[l.id]; })
      .map(function (l) { return { affaire_id: l.affaire_id, membre_id: l.membre_id }; });
    var liensMorts = liensAv.filter(function (l) { return !cleAp[l.id]; });

    // Ordre : on retire ce qui dépend avant ce dont ça dépend, on ajoute l'inverse.
    var suite = Promise.resolve();

    if (dTaches.retraits.length) suite = suite.then(function () { return effaceLot("taches", dTaches.retraits); });
    if (dAbsences.retraits.length) suite = suite.then(function () { return effaceLot("absences", dAbsences.retraits); });

    /* Les liens d'équipe n'ont pas d'identifiant propre : ils se suppriment par
       couple. On regroupe du côté qui fait le moins d'appels — retirer un membre
       du bureau tient en une requête, refaire l'équipe d'une affaire aussi. */
    if (liensMorts.length) {
      var parAffaire = groupe(liensMorts, "affaire_id", "membre_id");
      var parMembre = groupe(liensMorts, "membre_id", "affaire_id");
      var choix = appels(parMembre) < appels(parAffaire)
        ? { cle: "membre_id", autre: "affaire_id", groupes: parMembre }
        : { cle: "affaire_id", autre: "membre_id", groupes: parAffaire };
      Object.keys(choix.groupes).forEach(function (fixe) {
        enLots(choix.groupes[fixe], LOT).forEach(function (paquet) {
          suite = suite.then(function () {
            return requete("affaire_membres?" + choix.cle + "=eq." + encodeURIComponent(fixe) +
              "&" + choix.autre + "=in." + liste(paquet), { methode: "DELETE", prefer: "return=minimal" });
          });
        });
      });
    }

    if (dAffaires.retraits.length) suite = suite.then(function () { return effaceLot("affaires", dAffaires.retraits); });
    if (dMembres.retraits.length) suite = suite.then(function () { return effaceLot("membres", dMembres.retraits); });
    // Tant que la migration de l'annuaire n'est pas passée, rien ne part vers une table qui n'existe pas
    if (annuaireEnBase && dContacts.retraits.length) {
      suite = suite.then(function () { return effaceLot("contacts", dContacts.retraits); });
    }

    suite = suite.then(function () { return appliqueTable("membres", dMembres); });
    suite = suite.then(function () { return appliqueTable("affaires", dAffaires); });
    suite = suite.then(function () { return appliqueTable("taches", dTaches); });
    suite = suite.then(function () { return appliqueTable("absences", dAbsences); });
    if (annuaireEnBase) suite = suite.then(function () { return appliqueTable("contacts", dContacts); });
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
    envoieLien: envoieLien,
    verifieLien: verifieLien,
    choisitMotDePasse: choisitMotDePasse,
    deconnexion: deconnexion,
    rafraichis: rafraichis,
    utilisateur: utilisateur,
    enregistrePreferences: enregistrePreferences,
    requete: requete,
    rpc: rpc,
    reglagesAuth: reglagesAuth,
    ADAPT: {
      nom: "supabase",
      semeSiVide: false,
      lire: charge,
      ecrire: ecrire,
      videTout: videTout,
      profil: profil,
      annuaireEnBase: function () { return annuaireEnBase; }
    }
  };
})(window);
