/* Accès aux outils du chantier FGH (13.11.2026).
   ---------------------------------------------------------------------------
   Les outils /fgh/ demandent une connexion avec les identifiants de la
   planification : même projet Supabase, même session, rangée dans le
   navigateur sous « planif.session » (docs/planif/assets/supabase.js). Se
   connecter d'un côté ouvre donc aussi l'autre, et se déconnecter ferme les deux.

   Chargé dans le <head> de chaque page FGH, AVANT les scripts de l'outil :
     - sans session : renvoi immédiat vers /fgh/connexion/ (la page ne s'affiche pas) ;
     - avec session : la base dit si le compte a accès (fonction acces_fgh :
       super admin, ou accès rattaché au bureau du chantier) ; sinon, renvoi.
   data-garde="non" sur la balise <script> : pas de renvoi (page de connexion,
   organiseur), seulement les appels authentifiés.

   FghAcces.fetch(url, options) remplace fetch() pour les appels à la base : il
   ajoute la clé publiable et le jeton de la personne connectée, renouvelle le
   jeton quand il arrive à échéance, et ramène à la connexion si la base le
   refuse. Une panne réseau reste une panne réseau (l'outil ARM marche hors
   ligne) : elle ne déconnecte pas.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var URL_BASE = "https://hxhjkdfnoygrlbdhjkwc.supabase.co";
  var CLE = "sb_publishable_33G_BjGlKGUBhSVIc_QUmQ_QDKC64vA";
  var CLE_SESSION = "planif.session";
  var CONNEXION = "/fgh/connexion/";

  var balise = document.currentScript;
  var garde = !balise || balise.getAttribute("data-garde") !== "non";

  /* ------------------------------------------------------------- session */
  // Relue à chaque appel : un autre onglet (planification comprise) a pu la renouveler.
  function lit() {
    try { return JSON.parse(global.localStorage.getItem(CLE_SESSION) || "null"); } catch (e) { return null; }
  }
  function pose(s) {
    try {
      if (s) global.localStorage.setItem(CLE_SESSION, JSON.stringify(s));
      else global.localStorage.removeItem(CLE_SESSION);
    } catch (e) {}
    return s;
  }
  // Même forme que la planification (depuisJeton de supabase.js)
  function depuisJeton(j, avant) {
    return {
      jeton: j.access_token,
      rafraichissement: j.refresh_token,
      expire: Date.now() + (j.expires_in || 3600) * 1000,
      email: (j.user && j.user.email) || (avant && avant.email) || "",
      userId: (j.user && j.user.id) || (avant && avant.userId) || null,
      preferences: (j.user && j.user.user_metadata) || (avant && avant.preferences) || {}
    };
  }

  function erreur(m, quoi) { var e = new Error(m); e[quoi || "metier"] = true; return e; }

  /* Les messages de Supabase sont en anglais : on les retraduit pour l'écran. */
  function message(j, statut) {
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || "";
    if (/invalid login credentials/i.test(m)) return "Adresse ou mot de passe incorrect.";
    if (/email not confirmed/i.test(m)) return "Adresse pas encore activée : ouvre le lien reçu par courriel, ou passe par « Premier accès ».";
    if (/rate limit|too many/i.test(m)) return "Trop de tentatives. Patiente quelques minutes.";
    return m || "Connexion impossible (" + statut + ").";
  }

  function appelAuth(chemin, corps) {
    return fetch(URL_BASE + "/auth/v1/" + chemin, {
      method: "POST",
      headers: { apikey: CLE, "Content-Type": "application/json" },
      body: JSON.stringify(corps)
    }).catch(function () {
      throw erreur("Serveur injoignable. Vérifie ta connexion, puis réessaie.", "reseau");
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        throw erreur(message(j, r.status));
      });
    });
  }

  /* Un seul renouvellement à la fois. Un refus du serveur fait tomber la
     session ; une panne réseau la laisse (on réessaiera). */
  var renouvellement = null;
  function rafraichis(avant) {
    if (renouvellement) return renouvellement;
    if (!avant || !avant.rafraichissement) return Promise.reject(erreur("Session expirée.", "perdue"));
    renouvellement = appelAuth("token?grant_type=refresh_token", { refresh_token: avant.rafraichissement })
      .then(function (j) { return pose(depuisJeton(j, avant)); }, function (e) {
        if (e.reseau) throw e;
        // Un autre onglet a pu renouveler entre-temps avec le même jeton : on garde le sien
        var ici = lit();
        if (ici && ici.rafraichissement !== avant.rafraichissement && ici.expire - Date.now() > 60000) return ici;
        pose(null);
        throw erreur("Session expirée : reconnecte-toi.", "perdue");
      });
    var libere = function () { renouvellement = null; };
    renouvellement.then(libere, libere);
    return renouvellement;
  }

  function jeton(force) {
    var s = lit();
    if (!s || !s.jeton) return Promise.reject(erreur("Connexion requise.", "perdue"));
    if (!force && s.expire - Date.now() > 60000) return Promise.resolve(s.jeton);
    return rafraichis(s).then(function (n) { return n.jeton; });
  }

  /* --------------------------------------------------------- redirection */
  function vaConnexion(motif) {
    if (!garde) return;
    var retour = location.pathname + location.search + location.hash;
    location.replace(CONNEXION + "?retour=" + encodeURIComponent(retour) + (motif ? "&motif=" + motif : ""));
  }

  /* ------------------------------------------------- appels authentifiés */
  function avecJeton(t, o) {
    var h = {}, src = o.headers || {};
    Object.keys(src).forEach(function (k) { h[k] = src[k]; });
    h.apikey = CLE;
    h.Authorization = "Bearer " + t;
    var copie = {};
    Object.keys(o).forEach(function (k) { copie[k] = o[k]; });
    copie.headers = h;
    return copie;
  }
  // 401 avec un jeton : expiré ou révoqué (une RLS qui refuse répond 403 ou une liste vide)
  function appel(url, o) {
    o = o || {};
    return jeton().then(function (t) {
      return fetch(url, avecJeton(t, o)).then(function (r) {
        if (r.status !== 401) return r;
        return jeton(true).then(function (t2) { return fetch(url, avecJeton(t2, o)); });
      });
    }).then(function (r) {
      if (r.status === 401) { pose(null); vaConnexion("expire"); }
      return r;
    }, function (e) {
      if (e.perdue) vaConnexion("expire");
      throw e;
    });
  }

  /* ------------------------------------------- connexion et déconnexion */
  function connexion(email, motDePasse) {
    return appelAuth("token?grant_type=password", { email: email, password: motDePasse })
      .then(function (j) { return pose(depuisJeton(j, null)); });
  }
  function deconnexion() {
    var s = lit();
    pose(null);
    if (!s || !s.jeton) return Promise.resolve();
    return fetch(URL_BASE + "/auth/v1/logout", {
      method: "POST",
      headers: { apikey: CLE, Authorization: "Bearer " + s.jeton }
    }).catch(function () {}).then(function () {});
  }

  /* true : accès ; false : compte connecté sans accès ; null : on ne sait
     pas (hors ligne, ou fonction pas encore créée dans la base). */
  function verifie() {
    return appel(URL_BASE + "/rest/v1/rpc/acces_fgh", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) return r.status === 401 || r.status === 403 ? false : null;
      return r.json().then(function (v) { return v === true; }, function () { return null; });
    }, function (e) {
      if (e.perdue) throw e;
      return null;
    });
  }

  global.FghAcces = {
    fetch: appel,
    connexion: connexion,
    deconnexion: deconnexion,
    verifie: verifie,
    email: function () { var s = lit(); return (s && s.email) || ""; },
    connecte: function () { var s = lit(); return !!(s && s.jeton); },
    URL_BASE: URL_BASE
  };

  /* ---------------------------------------------------------------- garde */
  if (garde) {
    if (!lit()) {
      // Rien à montrer : la page reste masquée le temps du renvoi
      document.documentElement.style.visibility = "hidden";
      vaConnexion("");
    } else {
      verifie().then(function (ok) {
        if (ok === false) vaConnexion("refuse");
      }, function () { /* déjà renvoyé vers la connexion */ });
    }
  }
})(window);
