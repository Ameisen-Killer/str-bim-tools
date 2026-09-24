/* Client Supabase minimal de Buro : session, requêtes REST, fichiers.
   ---------------------------------------------------------------------------
   Écrit à la main, sans bibliothèque (même principe que l'outil de
   planification de str-bim-tools.com, dont il reprend l'authentification) :
   e-mail + mot de passe, lien par courriel pour la première connexion ou un
   mot de passe oublié, jeton renouvelé automatiquement.
   Expose window.Sb ; Sb.configure est faux en mode démonstration.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var cfg = (global.BURO_CONFIG || {}).supabase || {};
  var URL_BASE = (cfg.url || "").replace(/\/+$/, "");
  var CLE = cfg.cle || "";
  var CLE_SESSION = "buro.session";
  var BUCKET = "buro";
  var configure = !!(URL_BASE && CLE);

  function erreur(m, code) { var e = new Error(m); e.metier = true; if (code) e.code = code; return e; }
  function erreurReseau() { var e = erreur("Serveur injoignable. Vérifie ta connexion, puis réessaie."); e.reseau = true; return e; }

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

  function depuisJeton(j) {
    return {
      jeton: j.access_token,
      rafraichissement: j.refresh_token,
      expire: Date.now() + (j.expires_in || 3600) * 1000,
      email: ((j.user && j.user.email) || (session && session.email) || "").toLowerCase()
    };
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

  /* Messages de Supabase (en anglais) retraduits pour l'écran */
  function messageAuth(j, statut) {
    var m = (j && (j.error_description || j.msg || j.message || j.error)) || "";
    var attente = /after (\d+) seconds?/i.exec(m);
    if (/invalid login credentials/i.test(m)) return "Adresse ou mot de passe incorrect.";
    if (/email not confirmed/i.test(m)) return "Adresse pas encore activée : ouvre le lien reçu par courriel, ou redemande-le.";
    if (/signups? not allowed/i.test(m)) return "La création de comptes est fermée sur ce projet.";
    if (/password should be at least/i.test(m)) return "Mot de passe trop court : six caractères au minimum.";
    if (/should be different from the old password/i.test(m)) return "Choisis un mot de passe différent de l'ancien.";
    if (/weak|known to be/i.test(m)) return "Mot de passe trop faible : choisis-en un plus long ou moins courant.";
    if (/invalid or has expired|otp_expired|token has expired/i.test(m)) return "Ce lien a expiré ou a déjà servi : redemande-en un.";
    if (/not authorized/i.test(m)) return "Courriel refusé par Supabase : sans serveur d'envoi (SMTP), il ne livre qu'aux membres de l'équipe du projet Supabase.";
    if (/error sending/i.test(m)) return "Envoi du courriel impossible : vérifie le serveur d'envoi (SMTP) du projet Supabase.";
    if (attente) return "Patiente " + attente[1] + " secondes avant de redemander un lien.";
    if (/email rate limit/i.test(m)) return "Limite d'envoi de courriels atteinte : réessaie plus tard.";
    if (/rate limit|too many/i.test(m)) return "Trop de tentatives. Patiente quelques minutes.";
    return m || "Connexion impossible (" + statut + ").";
  }

  function connexion(email, motDePasse) {
    return appelAuth("token?grant_type=password", { email: email, password: motDePasse })
      .then(function (j) { return poseSession(depuisJeton(j)); });
  }

  /* Adresse de la page de connexion, où que Buro soit publié (/kevin/ aujourd'hui, racine d'un domaine demain) */
  function pageConnexion() {
    var chemin = global.location.pathname.replace(/connexion\/?(index\.html)?$/, "").replace(/[^/]*$/, "");
    return global.location.origin + chemin + "connexion/";
  }

  /* Lien par courriel : première connexion ou mot de passe oublié. Le compte
     est créé s'il n'existe pas ; la garde de la base (hook « Before User
     Created ») refuse les adresses absentes de la liste des membres. */
  function envoieLien(email) {
    return appelAuth("otp?redirect_to=" + encodeURIComponent(pageConnexion()), { email: email, create_user: true });
  }

  function verifieLien(jeton, type) {
    return appelAuth("verify", { type: type === "recovery" ? "recovery" : "email", token_hash: jeton });
  }

  function choisitMotDePasse(jetons, motDePasse) {
    return fetch(URL_BASE + "/auth/v1/user", {
      method: "PUT",
      headers: { apikey: CLE, Authorization: "Bearer " + jetons.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ password: motDePasse })
    }).catch(function () { throw erreurReseau(); }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (u) {
        if (r.status === 401 || r.status === 403) throw erreur("Ce lien a expiré : redemande-en un.");
        if (!r.ok) throw erreur(messageAuth(u, r.status));
        return poseSession(depuisJeton({
          access_token: jetons.access_token, refresh_token: jetons.refresh_token,
          expires_in: parseInt(jetons.expires_in, 10) || 3600, user: u
        }));
      });
    });
  }

  /* Un seul renouvellement à la fois ; une panne réseau ne déconnecte pas */
  var renouvellement = null;
  function rafraichis() {
    if (renouvellement) return renouvellement;
    if (!session || !session.rafraichissement) return Promise.reject(erreur("Session expirée."));
    renouvellement = appelAuth("token?grant_type=refresh_token", { refresh_token: session.rafraichissement })
      .then(function (j) { return poseSession(depuisJeton(j)); }, function (e) {
        if (e.reseau) throw e;
        poseSession(null);
        var x = erreur("Session expirée : reconnecte-toi."); x.session = true; throw x;
      });
    var libere = function () { renouvellement = null; };
    renouvellement.then(libere, libere);
    return renouvellement;
  }

  function jeton() {
    if (!session) { var e = erreur("Aucune session."); e.session = true; return Promise.reject(e); }
    if (session.expire - Date.now() > 60000) return Promise.resolve(session.jeton);
    return rafraichis().then(function (s) { return s.jeton; });
  }

  function deconnexion() {
    var s = session;
    poseSession(null);
    if (!s) return Promise.resolve();
    return fetch(URL_BASE + "/auth/v1/logout", { method: "POST", headers: { apikey: CLE, Authorization: "Bearer " + s.jeton } })
      .catch(function () {}).then(function () {});
  }

  /* ------------------------------------------------------------- requêtes */

  function requete(chemin, options) {
    options = options || {};
    return jeton().then(function (t) {
      var entetes = { apikey: CLE, Authorization: "Bearer " + t, "Content-Type": "application/json" };
      if (options.prefer) entetes.Prefer = options.prefer;
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
        if (r.ok) return j;
        var code = j && j.code;
        if (code === "42501") throw erreur("Tu n'as pas le droit de faire cela. L'affichage a été rechargé.", code);
        if (r.status === 401 || r.status === 403) throw erreur("Accès refusé. Ton adresse fait-elle partie des membres ?", code);
        if (code === "23505") throw erreur("Enregistrement refusé : cette valeur existe déjà (adresse e-mail en double ?).", code);
        if (code === "23503") throw erreur("Enregistrement refusé : un élément lié a été supprimé entre-temps. L'affichage a été rechargé.", code);
        // Les gardes de la base répondent en français : le message passe tel quel
        throw erreur((j && (j.message || j.hint)) || ("Erreur " + r.status + " sur " + chemin), code);
      });
    });
  }

  /* Lecture d'une table entière (quelques centaines de lignes au plus pour une amicale) */
  function lit(table, ordre) {
    return requete(table + "?select=*" + (ordre ? "&order=" + ordre : ""));
  }

  function filtre(f) {
    return Object.keys(f).map(function (k) { return k + "=eq." + encodeURIComponent(f[k]); }).join("&");
  }

  function insere(table, ligne) {
    return requete(table, { methode: "POST", corps: ligne, prefer: "return=minimal" });
  }
  function modifie(table, f, champs) {
    return requete(table + "?" + filtre(f), { methode: "PATCH", corps: champs, prefer: "return=minimal" });
  }
  function efface(table, f) {
    return requete(table + "?" + filtre(f), { methode: "DELETE", prefer: "return=minimal" });
  }

  /* ------------------------------------------------------------- fichiers */

  function chemins(p) { return p.split("/").map(encodeURIComponent).join("/"); }

  function envoieFichier(chemin, fichier) {
    return jeton().then(function (t) {
      return fetch(URL_BASE + "/storage/v1/object/" + BUCKET + "/" + chemins(chemin), {
        method: "POST",
        headers: { apikey: CLE, Authorization: "Bearer " + t, "Content-Type": fichier.type || "application/octet-stream", "x-upsert": "false" },
        body: fichier
      }).catch(function () { throw erreurReseau(); });
    }).then(function (r) {
      if (r.ok) return chemin;
      return r.json().catch(function () { return {}; }).then(function (j) {
        throw erreur(r.status === 413 || /too large|size/i.test(j.message || "") ? "Fichier trop lourd pour le stockage." : "Envoi du fichier refusé (" + (j.message || r.status) + ").");
      });
    });
  }

  function litFichier(chemin) {
    return jeton().then(function (t) {
      return fetch(URL_BASE + "/storage/v1/object/authenticated/" + BUCKET + "/" + chemins(chemin), {
        headers: { apikey: CLE, Authorization: "Bearer " + t }
      }).catch(function () { throw erreurReseau(); });
    }).then(function (r) {
      if (!r.ok) throw erreur("Fichier introuvable ou accès refusé.");
      return r.blob();
    });
  }

  global.Sb = {
    configure: configure,
    session: function () { return session; },
    connexion: connexion,
    envoieLien: envoieLien,
    verifieLien: verifieLien,
    choisitMotDePasse: choisitMotDePasse,
    deconnexion: deconnexion,
    requete: requete,
    lit: lit, insere: insere, modifie: modifie, efface: efface,
    envoieFichier: envoieFichier, litFichier: litFichier
  };
})(window);
