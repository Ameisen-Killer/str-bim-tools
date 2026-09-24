/* Couche de données de Buro.
   ---------------------------------------------------------------------------
   L'écran travaille sur Store.state, une copie en mémoire de toutes les tables
   (les noms de champs sont ceux de la base). Chaque écriture modifie d'abord
   cette copie, pour un affichage immédiat, puis part vers le stockage :
     - mode démonstration (config.js sans url) : localStorage du navigateur,
       données fictives du prototype, sélecteur d'utilisateur ;
     - mode en ligne : Supabase, après connexion. Une écriture refusée par la
       base recharge tout, pour que l'écran ne mente pas.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var TABLES = ["members", "projects", "tasks", "messages", "ideas", "idea_reactions", "idea_comments",
                "materials", "rentals", "feedbacks", "documents", "mail_queue"];
  var ORDRE = { messages: "created_at", ideas: "created_at", idea_comments: "created_at", projects: "created_at.desc",
                tasks: "created_at.desc", members: "name", materials: "created_at", rentals: "created_at", documents: "name" };
  var CLE_DEMO = "buro.demo";

  var Sb = global.Sb;
  var enLigne = !!(Sb && Sb.configure);

  var nouvelId = function () {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  };

  /* ------------------------------------------------ données de démonstration
     Reprises telles quelles du prototype V5 (mêmes personnes, mêmes dates). */
  function demo() {
    var u = function (id, name, role) { return { id: id, name: name, role: role, email: "", active: true }; };
    var members = [
      u("u1", "Kévin", "president"), u("u2", "Nicolas", "etat_major"), u("u3", "Thomas", "bureau"),
      u("u4", "Camille", "bureau"), u("u5", "Julie", "bureau"), u("u6", "Maxime", "bureau"),
      u("u7", "Sophie", "bureau"), u("u8", "Alex", "bureau"), u("u9", "Manon", "bureau"), u("u10", "Lucas", "bureau")
    ];
    members.forEach(function (m) { m.email = (m.id === "u1" ? "president" : m.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")) + "@amicale.local"; });
    var p = function (id, name, description, manager, deputy, budget, prive, visible, chat, date) {
      return { id: id, name: name, description: description, owner_id: "u1", manager_id: manager, deputy_id: deputy || null,
               budget: budget, is_private: prive, visible_to: visible, chat_enabled: chat, status: "active", created_at: date + "T09:00:00" };
    };
    var t = function (id, projet, titre, qui, due, statut, par, fait, fin, valide, cree) {
      return { id: id, project_id: projet, title: titre, assignee_ids: qui, due: due, status: statut, hidden_from_list: false,
               created_by: par, completed_by: fait || null, completed_at: fin || null, validated_by: valide || null,
               validated_at: null, created_at: cree };
    };
    return {
      members: members,
      projects: [
        p("p1", "Cross départemental", "Organisation générale du cross.", "u2", "u3", 7000, false, [], true, "2026-09-01"),
        p("p2", "Sainte-Barbe", "Préparation de la soirée annuelle.", "u4", "", 6500, false, [], true, "2026-09-10"),
        p("p3", "Voyage Amicale 2028", "Préparation et mise en concurrence des agences.", "u1", "u5", 85000, true, ["u1", "u2", "u5"], false, "2026-09-15")
      ],
      tasks: [
        t("t1", "p1", "Finaliser la liste des bénévoles", ["u3", "u4"], "2026-10-10", "todo", "u2", "", "", "", "2026-09-20T10:05:00"),
        t("t2", "p1", "Commander les bols pour la soupe", ["u5"], "2026-10-15", "pending_validation", "u2", "u5", "2026-09-22", "", "2026-09-20T10:04:00"),
        t("t3", "p1", "Valider le vin d’honneur", ["u2"], "2026-09-30", "done", "u1", "u2", "2026-09-20", "u1", "2026-09-20T10:03:00"),
        t("t4", "p2", "Choisir le menu", ["u4", "u7"], "2026-10-20", "todo", "u1", "", "", "", "2026-09-20T10:02:00"),
        t("t5", "p3", "Préparer le cahier des charges agences", ["u1", "u5"], "2026-10-01", "todo", "u1", "", "", "", "2026-09-20T10:01:00")
      ],
      messages: [
        { id: "m1", project_id: null, author_id: "u1", body: "Bienvenue sur Buro 👋 Ici on discute puis on transforme les messages en actions.", created_at: "2026-09-23T09:00:00" },
        { id: "m2", project_id: "p1", author_id: "u2", body: "Pensez à compléter les tâches du Cross.", created_at: "2026-09-23T10:15:00" },
        { id: "m3", project_id: "p2", author_id: "u4", body: "Le thème de la Sainte-Barbe doit être validé cette semaine.", created_at: "2026-09-23T11:20:00" }
      ],
      ideas: [
        { id: "i1", title: "Soirée cinéma plein air", body: "Tester un format estival pour les familles.", author_id: "u7", created_at: "2026-09-21T12:00:00" },
        { id: "i2", title: "QR code inventaire matériel", body: "Une étiquette sur chaque matériel pour ouvrir directement sa fiche.", author_id: "u3", created_at: "2026-09-22T12:00:00" }
      ],
      idea_reactions: [
        { idea_id: "i1", member_id: "u1", emoji: "👍" }, { idea_id: "i1", member_id: "u3", emoji: "👍" }, { idea_id: "i1", member_id: "u4", emoji: "🔥" },
        { idea_id: "i2", member_id: "u1", emoji: "👍" }, { idea_id: "i2", member_id: "u2", emoji: "👍" }, { idea_id: "i2", member_id: "u5", emoji: "👍" },
        { idea_id: "i2", member_id: "u1", emoji: "💡" }
      ],
      idea_comments: [{ id: "c1", idea_id: "i1", author_id: "u2", body: "À chiffrer avec la commune.", created_at: "2026-09-21T13:00:00" }],
      materials: [
        { id: "mat1", name: "Barnum 3×6 m", category: "Réception", quantity: 2, notes: "Structure + bâches latérales", created_at: "2026-09-01T09:00:00" },
        { id: "mat2", name: "Percolateur 15 L", category: "Cuisine", quantity: 1, notes: "", created_at: "2026-09-01T09:01:00" },
        { id: "mat3", name: "Sono portable", category: "Animation", quantity: 1, notes: "2 micros inclus", created_at: "2026-09-01T09:02:00" }
      ],
      rentals: [{ id: "r1", renter: "Comité des fêtes", material_id: "mat1", quantity: 1, start_date: "2026-10-03", end_date: "2026-10-04",
                  departure_state: "Bon état", return_state: "", remarks: "", photos: [], status: "planned",
                  signature_departure: "", signature_return: "", created_by: "u1", created_at: "2026-09-20T09:00:00" }],
      feedbacks: [],
      documents: [
        { id: "d1", name: "Règlement intérieur", type: "file", parent_id: null, storage_path: null },
        { id: "f1", name: "Cross 2026", type: "folder", parent_id: null, storage_path: null },
        { id: "d2", name: "Liste fournisseurs", type: "file", parent_id: "f1", storage_path: null },
        { id: "f2", name: "Voyages", type: "folder", parent_id: null, storage_path: null }
      ],
      mail_queue: []
    };
  }

  /* ------------------------------------------------------------ état */

  var Store = {
    enLigne: enLigne,
    state: {},
    meId: null,          // membre connecté (ou choisi dans le sélecteur de démonstration)
    email: "",           // adresse de la session (mode en ligne)
    nouvelId: nouvelId
  };

  function trouve(table, f) {
    return (Store.state[table] || []).filter(function (l) {
      return Object.keys(f).every(function (k) { return l[k] === f[k]; });
    });
  }

  /* ------------------------------------------------ mode démonstration */

  function sauveDemo() {
    try { global.localStorage.setItem(CLE_DEMO, JSON.stringify({ state: Store.state, meId: Store.meId })); } catch (e) {}
  }

  function chargeDemo() {
    var brut = null;
    try { brut = JSON.parse(global.localStorage.getItem(CLE_DEMO) || "null"); } catch (e) { brut = null; }
    Store.state = (brut && brut.state) || demo();
    TABLES.forEach(function (t) { if (!Store.state[t]) Store.state[t] = []; });
    Store.meId = (brut && brut.meId) || "u1";
    sauveDemo();
    return Promise.resolve();
  }

  /* ------------------------------------------------ mode en ligne */

  function chargeEnLigne(tables) {
    tables = tables || TABLES;
    return Promise.all(tables.map(function (t) { return Sb.lit(t, ORDRE[t]); })).then(function (r) {
      tables.forEach(function (t, i) { Store.state[t] = r[i] || []; });
      var moi = (Store.state.members || []).filter(function (m) { return m.active && (m.email || "").toLowerCase() === Store.email; })[0];
      Store.meId = moi ? moi.id : null;
    });
  }

  /* Écriture refusée : on recharge pour réaligner l'écran sur la base, puis on remonte l'erreur */
  function ecrit(promesse) {
    if (!enLigne) { sauveDemo(); return Promise.resolve(); }
    return promesse().catch(function (err) {
      return chargeEnLigne().catch(function () {}).then(function () { if (Store.onChange) Store.onChange(); throw err; });
    });
  }

  /* ------------------------------------------------ interface publique */

  Store.init = function () {
    if (!enLigne) return chargeDemo();
    var s = Sb.session();
    if (!s) { var e = new Error("Aucune session."); e.session = true; return Promise.reject(e); }
    Store.email = (s.email || "").toLowerCase();
    return chargeEnLigne();
  };

  Store.recharge = function (tables) { return enLigne ? chargeEnLigne(tables) : Promise.resolve(); };

  Store.insert = function (table, ligne) {
    if (!ligne.id && table !== "idea_reactions") ligne.id = nouvelId();
    if (!ligne.created_at && table !== "idea_reactions" && table !== "members") ligne.created_at = new Date().toISOString();
    // Comme le prototype : un nouveau projet ou une nouvelle tâche passe en tête
    if (table === "projects" || table === "tasks") Store.state[table].unshift(ligne); else Store.state[table].push(ligne);
    return ecrit(function () { return Sb.insere(table, ligne); }).then(function () { return ligne; });
  };

  Store.update = function (table, f, champs) {
    trouve(table, f).forEach(function (l) { Object.assign(l, champs); });
    return ecrit(function () { return Sb.modifie(table, f, champs); });
  };

  Store.remove = function (table, f) {
    var aRetirer = trouve(table, f);
    Store.state[table] = Store.state[table].filter(function (l) { return aRetirer.indexOf(l) < 0; });
    return ecrit(function () { return Sb.efface(table, f); });
  };

  /* Fichier joint : stocké dans Supabase en ligne ; en démonstration, seul le nom est gardé (comme le prototype) */
  Store.envoieFichier = function (dossier, fichier) {
    if (!enLigne) return Promise.resolve(null);
    var nom = fichier.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
    return Sb.envoieFichier(dossier + "/" + nouvelId() + "-" + nom, fichier);
  };
  Store.litFichier = function (chemin) { return Sb.litFichier(chemin); };

  /* Démonstration uniquement */
  Store.changeUtilisateur = function (id) { Store.meId = id; sauveDemo(); };
  Store.reinitialise = function () {
    try { global.localStorage.removeItem(CLE_DEMO); } catch (e) {}
    return chargeDemo();
  };

  Store.deconnexion = function () { return enLigne ? Sb.deconnexion() : Promise.resolve(); };

  global.Store = Store;
})(window);
