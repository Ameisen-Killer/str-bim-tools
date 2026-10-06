/* Palette de commandes — Ctrl+K (⌘K sur Mac), sur toutes les pages de l'outil.
   ---------------------------------------------------------------------------
   Une seule barre pour tout faire (27.09.2026) :
     - trouver : une tâche (sa fiche rapide s'ouvre sur place), une affaire,
       un collègue, une fiche de l'annuaire, une page ;
     - agir : nouvelle tâche, poser une absence, rafraîchir, thème, quitter ;
     - créer une tâche en une phrase : « dalle B12 Marc vendredi 3j ».
       La phrase est lue au fil de la frappe — affaire (son code), personne
       (prénom ou nom), charge (« 3j », « calcul 2j dessin 1j »), échéance
       (« vendredi », « demain », « 12.10 », « s42 », « fin du mois »,
       « dans 2 semaines »…) ; ce qui reste fait le libellé. L'aperçu montre ce
       qui a été compris avant qu'on valide. Entrée crée la tâche si tout y est,
       sinon ouvre le formulaire pré-rempli ; Maj+Entrée ouvre toujours le
       formulaire, pour vérifier ou compléter.
   « / » garde la recherche de la page ; Ctrl+K est à la palette.
   La base applique ses règles comme partout : sans le droit de créer des
   tâches pour les autres, une tâche créée ici porte la part de son auteur.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var D = global.Donnees, C = global.Cal, UI = global.UI;
  if (!D || !C || !UI) return;
  var el = UI.el, vide = UI.vide;
  var MAC = /Mac|iPhone|iPad/.test(global.navigator.platform || global.navigator.userAgent || "");

  function plie(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function donnees() { try { return !!D.etat(); } catch (e) { return false; } }
  function canton() { try { return D.canton(); } catch (e) { return "VD"; } }
  function majuscule(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ================================================ lire une phrase ===== */

  var JOURS = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
                lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 };
  var MOIS = { janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4,
               mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9,
               octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12 };
  var COTE_CALCUL = { calcul: 1, calc: 1, ing: 1, inge: 1, ingenieur: 1, statique: 1 };
  var COTE_DESSIN = { dessin: 1, dess: 1, dao: 1 };
  // Mots de liaison qu'on retire quand ils précèdent ce qui a été reconnu
  var LIENS = { pour: 1, a: 1, avec: 1, par: 1, chez: 1, le: 1, la: 1, au: 1, avant: 1, dici: 1,
                "d'ici": 1, sur: 1, de: 1, du: 1, echeance: 1, affaire: 1, pr: 1, en: 1, et: 1 };

  function aujourdhui() { return C.isoAuj(); }
  function ouvreAvant(s) {                 // une échéance tombe un jour ouvré : on recule
    for (var g = 0; g < 30 && !C.estOuvre(s, canton()); g++) s = C.ajoute(s, -1);
    return s;
  }
  function prochainJour(num) {             // le prochain lundi, mardi… (jamais aujourd'hui)
    var s = C.ajoute(aujourdhui(), 1);
    for (var g = 0; g < 7 && C.dt(s).getDay() !== num; g++) s = C.ajoute(s, 1);
    return s;
  }
  function vendrediDe(s) { return C.ajoute(C.lundi(s), 4); }
  function finDuMois(s) {
    var d = C.dt(s);
    return C.iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  }
  function dateValide(a, m, j) {
    var d = new Date(a, m - 1, j, 12);
    return d.getMonth() === m - 1 && d.getDate() === j ? C.iso(d) : null;
  }
  // Sans année : la prochaine occurrence (un 3 janvier tapé en décembre, c'est l'an prochain)
  function sansAnnee(m, j) {
    var auj = C.dt(aujourdhui()), a = auj.getFullYear();
    var s = dateValide(a, m, j);
    if (s && C.diff(aujourdhui(), s) < -14) s = dateValide(a + 1, m, j);
    return s;
  }
  function annee(y) { y = +y; return y < 100 ? 2000 + y : y; }
  function semaineNum(n) {                 // vendredi de la semaine ISO n, cette année ou la suivante
    var auj = aujourdhui(), a = C.dt(auj).getFullYear();
    function vendredi(an) {
      var j4 = C.iso(new Date(an, 0, 4, 12));      // le 4 janvier est toujours en semaine 1
      return C.ajoute(C.lundi(j4), (n - 1) * 7 + 4);
    }
    var s = vendredi(a);
    if (C.diff(auj, s) < 0) s = vendredi(a + 1);
    return s;
  }

  /** Une date à partir du mot i. Renvoie { iso, n } (n mots lus) ou null. */
  function lisDate(m, i) {
    var t = m[i], s = m[i + 1] || "", u = m[i + 2] || "", r;
    if (t === "aujourd'hui" || t === "aujourdhui" || t === "auj") return { iso: aujourdhui(), n: 1 };
    if (t === "demain") return { iso: C.ajoute(aujourdhui(), 1), n: 1 };
    if (t === "apres-demain" || (t === "apres" && s === "demain")) return { iso: C.ajoute(aujourdhui(), 2), n: t === "apres" ? 2 : 1 };
    if (JOURS[t] != null && t.length >= 3) {
      return { iso: prochainJour(JOURS[t]), n: (s === "prochain" || s === "prochaine") ? 2 : 1 };
    }
    if (t === "fin" && (s === "semaine" || ((s === "de" || s === "du") && u === "semaine"))) {
      var v = vendrediDe(aujourdhui());
      return { iso: C.diff(aujourdhui(), v) < 0 ? C.ajoute(v, 7) : v, n: s === "semaine" ? 2 : 3 };
    }
    if (t === "fin" && (s === "mois" || ((s === "de" || s === "du") && u === "mois"))) {
      return { iso: finDuMois(aujourdhui()), n: s === "mois" ? 2 : 3 };
    }
    if (t === "semaine" && (s === "prochaine" || s === "pro")) return { iso: C.ajoute(vendrediDe(aujourdhui()), 7), n: 2 };
    if (t === "dans" && /^\d{1,3}$/.test(s)) {
      if (/^(j|jr|jrs|jour|jours)$/.test(u)) return { iso: C.ajoute(aujourdhui(), +s), n: 3 };
      if (/^(sem|semaine|semaines|s)$/.test(u)) return { iso: C.ajoute(aujourdhui(), 7 * s), n: 3 };
      if (/^mois$/.test(u)) { var d = C.dt(aujourdhui()); d.setMonth(d.getMonth() + (+s)); return { iso: C.iso(d), n: 3 }; }
    }
    if ((r = /^(?:s|sem|sem\.)(\d{1,2})$/.exec(t)) && +r[1] >= 1 && +r[1] <= 53) return { iso: semaineNum(+r[1]), n: 1 };
    if ((t === "semaine" || t === "sem") && /^\d{1,2}$/.test(s) && +s >= 1 && +s <= 53) return { iso: semaineNum(+s), n: 2 };
    if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) { var x = dateValide(+r[1], +r[2], +r[3]); if (x) return { iso: x, n: 1 }; }
    if ((r = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\.?$/.exec(t))) {
      var y = r[3] ? dateValide(annee(r[3]), +r[2], +r[1]) : sansAnnee(+r[2], +r[1]);
      if (y) return { iso: y, n: 1 };
    }
    if (/^\d{1,2}$/.test(t) && MOIS[s.replace(/\.$/, "")]) {
      var mo = MOIS[s.replace(/\.$/, "")];
      if (/^\d{4}$/.test(u)) { var z = dateValide(+u, mo, +t); if (z) return { iso: z, n: 3 }; }
      var w = sansAnnee(mo, +t); if (w) return { iso: w, n: 2 };
    }
    return null;
  }

  /** Une charge à partir du mot i : « 3j », « 2,5 j », « 1 jour ». */
  function lisCharge(m, i) {
    var r = /^(\d+(?:[.,]\d+)?)(j|jr|jrs|jour|jours)$/.exec(m[i]);
    if (r) return { v: parseFloat(r[1].replace(",", ".")), n: 1 };
    if (/^\d+(?:[.,]\d+)?$/.test(m[i]) && /^(j|jr|jrs|jour|jours)$/.test(m[i + 1] || "")) {
      return { v: parseFloat(m[i].replace(",", ".")), n: 2 };
    }
    return null;
  }

  /** Une personne à partir du mot i : prénom, nom, ou prénom + nom. */
  function lisPersonne(m, i) {
    var t = m[i].replace(/^@/, ""), arobase = m[i].charAt(0) === "@";
    if (t.length < 3 && !arobase) return null;
    var gens = D.membres({ planifies: true });
    var suivant = m[i + 1] || "";
    var complet = gens.filter(function (p) { return plie(p.prenom) === t && plie(p.nom) === suivant; });
    if (complet.length === 1) return { membre: complet[0], n: 2 };
    var parPrenom = gens.filter(function (p) { return plie(p.prenom) === t; });
    if (parPrenom.length === 1) return { membre: parPrenom[0], n: 1 };
    var parNom = gens.filter(function (p) { return plie(p.nom) === t; });
    if (parNom.length === 1) return { membre: parNom[0], n: 1 };
    return null;
  }

  function lisAffaire(m, i) {
    var t = m[i].replace(/^#/, "");
    if (!t) return null;
    var liste = D.affaires({ tous: true }).filter(function (a) { return plie(a.code) === t; });
    if (liste.length > 1) liste = liste.filter(function (a) { return a.statut === "active"; });
    return liste.length === 1 ? { affaire: liste[0], n: 1 } : null;
  }

  /**
   * « dalle B12 Marc vendredi 3j » → ce qu'il faut pour créer la tâche.
   * reconnus : nombre d'éléments compris (affaire, personne, charge, date).
   */
  function lisPhrase(q) {
    var bruts = q.trim().split(/\s+/).filter(Boolean);
    var m = bruts.map(function (b) { return plie(b).replace(/[,;:!?]+$/, ""); });
    var pris = m.map(function () { return false; });
    var r = { affaire: null, personnes: [], charges: [], echeance: null, reconnus: 0 };

    for (var i = 0; i < m.length; i++) {
      if (pris[i]) continue;
      var x, k;
      if (!r.echeance && (x = lisDate(m, i))) { r.echeance = ouvreAvant(x.iso); r.dateLue = x.iso; for (k = 0; k < x.n; k++) pris[i + k] = true; r.reconnus++; i += x.n - 1; continue; }
      if ((x = lisCharge(m, i))) {
        var cote = "";
        if (COTE_CALCUL[m[i - 1]] && !pris[i - 1]) { cote = "ingenieur"; pris[i - 1] = true; }
        else if (COTE_DESSIN[m[i - 1]] && !pris[i - 1]) { cote = "dessinateur"; pris[i - 1] = true; }
        else if (COTE_CALCUL[m[i + x.n]]) { cote = "ingenieur"; pris[i + x.n] = true; }
        else if (COTE_DESSIN[m[i + x.n]]) { cote = "dessinateur"; pris[i + x.n] = true; }
        r.charges.push({ v: x.v, cote: cote });
        for (k = 0; k < x.n; k++) pris[i + k] = true;
        r.reconnus++; i += x.n - 1; continue;
      }
      if (!r.affaire && (x = lisAffaire(m, i))) { r.affaire = x.affaire; pris[i] = true; r.reconnus++; continue; }
      if (r.personnes.length < 2 && (x = lisPersonne(m, i))) {
        if (!r.personnes.some(function (p) { return p.id === x.membre.id; })) r.personnes.push(x.membre);
        for (k = 0; k < x.n; k++) pris[i + k] = true;
        r.reconnus++; i += x.n - 1; continue;
      }
    }
    // Les mots de liaison juste avant un élément reconnu partent avec lui
    for (var j = m.length - 2; j >= 0; j--) {
      if (!pris[j] && pris[j + 1] && LIENS[m[j]]) pris[j] = true;
    }
    r.titre = majuscule(bruts.filter(function (b, n) { return !pris[n]; }).join(" ").replace(/\s+/g, " ").trim());
    return r;
  }

  /** De la phrase lue au brouillon de tâche : qui porte quelle charge. */
  function brouillon(r) {
    var libre = D.aDroit("taches_autrui");
    var moi = D.monMembre();
    var maCote = moi ? D.cote(moi.metier) : "";
    var b = { affaireId: r.affaire ? r.affaire.id : "", titre: r.titre, echeance: r.echeance || "",
              ingenieurId: "", dessinateurId: "", chargeInge: 0, chargeDessin: 0 };
    r.personnes.forEach(function (p) {
      var c = D.cote(p.metier);
      if (c === "ingenieur" && !b.ingenieurId) b.ingenieurId = p.id;
      else if (c === "dessinateur" && !b.dessinateurId) b.dessinateurId = p.id;
    });
    var seul = r.personnes.length === 1 ? D.cote(r.personnes[0].metier) : "";
    r.charges.forEach(function (c) {
      var cote = c.cote || seul || maCote || "ingenieur";
      if (cote === "dessinateur") b.chargeDessin += c.v; else b.chargeInge += c.v;
    });
    // Sans le droit, ma part est la mienne : une charge de mon côté sans personne me revient
    if (!libre && moi && maCote) {
      if (maCote === "ingenieur" && b.chargeInge > 0 && !b.ingenieurId) b.ingenieurId = moi.id;
      if (maCote === "dessinateur" && b.chargeDessin > 0 && !b.dessinateurId) b.dessinateurId = moi.id;
    }
    b.complet = !!(b.affaireId && b.titre && b.echeance && (b.chargeInge + b.chargeDessin) > 0);
    if (b.complet && !libre) {
      var id = moi && moi.id;
      b.complet = !!id && ((b.ingenieurId === id && b.chargeInge > 0) || (b.dessinateurId === id && b.chargeDessin > 0));
    }
    return b;
  }

  /* ===================================================== les résultats ===== */

  var PAGES = [
    { nom: "Accueil", href: "/planif/", mots: "bienvenue salut aujourd'hui mes taches avis" },
    { nom: "Tableau de bord", href: "/planif/planning/", mots: "planning barres semaines" },
    { nom: "Carte de charge", href: "/planif/charge/", mots: "charge occupation disponibilite qui est libre surcharge semaines" },
    { nom: "Tâches", href: "/planif/taches/", mots: "liste" },
    { nom: "Affaires", href: "/planif/affaires/", mots: "projets" },
    { nom: "Équipe", href: "/planif/equipe/", mots: "membres personnes" },
    { nom: "Absences", href: "/planif/absences/", mots: "vacances conges calendrier" },
    { nom: "Annuaire", href: "/planif/annuaire/", mots: "contacts adresses carnet" }
  ];

  function commandes() {
    var liste = [];
    if (donnees()) {
      liste.push({ nom: "Nouvelle tâche", mots: "creer ajouter tache", glyphe: "+", action: function () { ferme(); UI.formulaireTache(null, { surEnregistrement: D.redessine }); } });
      if (D.monMembre && D.monMembre()) {
        liste.push({ nom: "Mes jours travaillés", mots: "semaine jours off temps partiel mercredi capacite horaire", glyphe: "▦", action: function () { ferme(); UI.joursTravailles(null, D.redessine); } });
      }
      liste.push({ nom: "Prévenir le bureau d'une absence", mots: "avis absent rendez-vous medecin retard heure prevenir bureau", glyphe: "!", action: function () { ferme(); va("/planif/#prevenir"); } });
      liste.push({ nom: "Poser une absence", mots: "vacances conge maladie formation absence", glyphe: "◐", action: function () { ferme(); UI.nouvelleAbsence({ surChangement: D.redessine }); } });
      liste.push({ nom: "Rafraîchir les données", mots: "recharger actualiser mise a jour", glyphe: "↻", action: function () { ferme(); UI.rafraichit(false); } });
    }
    if (UI.choisitTheme) {
      [["sombre", "Thème sombre"], ["clair", "Thème clair"], ["systeme", "Thème du système"]].forEach(function (t) {
        liste.push({ nom: t[1], mots: "theme couleur apparence mode", glyphe: "◑", action: function () { UI.choisitTheme(t[0]); ferme(); UI.toast(t[1] + "."); } });
      });
    }
    if (UI.avecBase && UI.deconnecte) {
      liste.push({ nom: "Se déconnecter", mots: "quitter deconnexion sortir", glyphe: "⎋", action: function () { ferme(); UI.deconnecte(); } });
    }
    return liste;
  }

  function pages() {
    var p = D.profil ? D.profil() : null;
    return PAGES.concat(p && p.multi && p.superAdmin ? [{ nom: "Console", href: "/planif/console/", mots: "administration reglages bureaux utilisateurs droits" }] : []);
  }

  /* Le texte de recherche de chaque objet, plié une fois par ouverture */
  var index = null;
  function construitIndex() {
    index = { taches: [], affaires: [], membres: [], contacts: [] };
    if (!donnees()) return;
    D.taches({}).forEach(function (t) {
      var a = D.affaire(t.affaireId);
      index.taches.push({ o: t, a: a, foin: plie([t.titre, a && a.code, a && a.nom,
        t.ingenieurId && D.nomMembre(t.ingenieurId), t.dessinateurId && D.nomMembre(t.dessinateurId)].filter(Boolean).join(" | ")) });
    });
    D.affaires({ tous: true }).forEach(function (a) { index.affaires.push({ o: a, foin: plie(a.code + " | " + a.nom) }); });
    D.membres({ tous: true }).forEach(function (m) { index.membres.push({ o: m, foin: plie(m.prenom + " " + m.nom + " | " + D.libelleMetier(m.metier)) }); });
    (D.contacts ? D.contacts() : []).forEach(function (c) {
      index.contacts.push({ o: c, foin: plie([c.prenom, c.nom, c.societe, c.role, c.localite].filter(Boolean).join(" | ")) });
    });
  }

  function contient(foin, mots) {
    for (var i = 0; i < mots.length; i++) if (foin.indexOf(mots[i]) < 0) return false;
    return true;
  }
  // Un mot qui commence le texte, ou un mot du texte, pèse plus qu'un bout de mot
  function note(foin, mots) {
    var s = 0;
    mots.forEach(function (m) {
      if (foin.indexOf(m) === 0) s += 3;
      else if (new RegExp("(^|[\\s|·.-])" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(foin)) s += 2;
      else s += 1;
    });
    return s;
  }
  function cherche(liste, mots, max, tri) {
    return liste.filter(function (x) { return contient(x.foin, mots); })
      .map(function (x) { x.s = note(x.foin, mots) + (tri ? tri(x) : 0); return x; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, max);
  }

  /** Échéance lisible et relative : « ven. 3 oct. · dans 4 j » */
  function quand(iso) {
    if (!iso) return "";
    var d = C.diff(aujourdhui(), iso);
    var rel = d === 0 ? "aujourd'hui" : d === 1 ? "demain" : d === -1 ? "hier" : d > 0 ? "dans " + d + " j" : "il y a " + (-d) + " j";
    return C.jourCourt(iso) + " " + C.fmtCourt(iso) + " · " + rel;
  }

  function terminee(t) { return t.statut === "termine"; }

  /** Les groupes à afficher pour la saisie q. */
  function resultats(q) {
    var mots = plie(q).split(/\s+/).filter(Boolean);
    var groupes = [];

    if (!mots.length) {
      if (donnees()) {
        var moi = D.monMembre();
        if (moi) {
          var miennes = D.taches({ membreId: moi.id, sansTerminees: true }).slice(0, 4);
          if (miennes.length) groupes.push({ titre: "Mes prochaines échéances", lignes: miennes.map(ligneTache) });
        }
      }
      groupes.push({ titre: "Actions", lignes: commandes().filter(function (c) { return !/^Thème/.test(c.nom); }).map(ligneCommande) });
      groupes.push({ titre: "Aller à", lignes: pages().map(lignePage) });
      return groupes;
    }

    /* Une date ou une charge dans la phrase, c'est qu'on écrit une tâche : la
       ligne « Créer » passe en tête. Un code d'affaire ou un prénom seuls
       ressemblent autant à une recherche : elle vient alors après les résultats. */
    var phrase = donnees() && mots.length >= 2 ? lisPhrase(q) : null;
    var creer = null, enTete = false;
    if (phrase && phrase.reconnus >= 1 && phrase.titre) {
      creer = ligneCreer(phrase);
      enTete = !!(phrase.echeance || phrase.charges.length);
    }
    if (creer && enTete) groupes.push({ titre: "Créer", lignes: [creer] });

    var cmd = commandes().map(function (c) { return { o: c, foin: plie(c.nom + " | " + c.mots) }; });
    var cmdTrouvees = cherche(cmd, mots, 4);
    if (cmdTrouvees.length) groupes.push({ titre: "Actions", lignes: cmdTrouvees.map(function (x) { return ligneCommande(x.o, mots); }) });

    if (donnees()) {
      if (!index) construitIndex();
      var t = cherche(index.taches, mots, 6, function (x) { return terminee(x.o) ? -3 : 0; });
      if (t.length) groupes.push({ titre: "Tâches", lignes: t.map(function (x) { return ligneTache(x.o, mots); }) });
      var a = cherche(index.affaires, mots, 4, function (x) { return x.o.statut === "active" ? 1 : 0; });
      if (a.length) groupes.push({ titre: "Affaires", lignes: a.map(function (x) { return ligneAffaire(x.o, mots); }) });
      var m = cherche(index.membres, mots, 4, function (x) { return x.o.actif ? 1 : 0; });
      if (m.length) groupes.push({ titre: "Équipe", lignes: m.map(function (x) { return ligneMembre(x.o, mots); }) });
      var c = cherche(index.contacts, mots, 4);
      if (c.length) groupes.push({ titre: "Annuaire", lignes: c.map(function (x) { return ligneContact(x.o, mots); }) });
    }
    var p = cherche(pages().map(function (x) { return { o: x, foin: plie(x.nom + " | " + x.mots) }; }), mots, 3);
    if (p.length) groupes.push({ titre: "Aller à", lignes: p.map(function (x) { return lignePage(x.o, mots); }) });

    if (creer && !enTete) groupes.push({ titre: "Créer", lignes: [creer] });
    // Rien de compris dans la phrase : on propose quand même d'en faire une tâche
    if (!creer && donnees() && q.trim().length >= 3) {
      groupes.push({ titre: "Créer", lignes: [ligneCreer({ titre: majuscule(q.trim()), affaire: null, personnes: [], charges: [], echeance: null, reconnus: 0 })] });
    }
    return groupes;
  }

  /* ---------------------------------------------------- une ligne par objet */

  function lib(texte, mots) {
    return el("span", { class: "pal-lib" }, [UI.surligne(texte, mots || [])]);
  }
  function meta(texte) { return texte ? el("span", { class: "pal-meta", text: texte }) : null; }
  function glyphe(g, couleur) {
    return el("span", { class: "pal-ico", "aria-hidden": "true", style: couleur ? "color:" + couleur : null, text: g || "" });
  }
  function pastille(teinte) {
    return el("span", { class: "pal-ico", "aria-hidden": "true" }, [el("span", { class: "pal-teinte", style: "background:" + UI.teinte(teinte) })]);
  }

  function ligneTache(t, mots) {
    var a = D.affaire(t.affaireId);
    var qui = [t.ingenieurId && D.nomMembre(t.ingenieurId), t.dessinateurId && D.nomMembre(t.dessinateurId)].filter(Boolean).join(", ");
    return {
      noeud: [pastille(a ? a.teinte : 1),
        el("span", { class: "pal-lib" }, [
          UI.surligne(t.titre, mots || []),
          el("span", { class: "pal-sous" }, [a ? UI.surligne(a.code, mots || []) : "", qui ? " · " + qui : ""])
        ]),
        meta(terminee(t) ? "Terminée" : quand(t.echeance))],
      classe: terminee(t) ? "eteinte" : "",
      action: function () { ferme(); UI.ficheTache(t.id, { surEnregistrement: D.redessine }); }
    };
  }
  function ligneAffaire(a, mots) {
    var n = D.taches({ affaireId: a.id, sansTerminees: true }).length;
    return {
      noeud: [pastille(a.teinte), el("span", { class: "pal-lib" }, [
        el("b", { class: "pal-code" }, [UI.surligne(a.code, mots || [])]), " ", UI.surligne(a.nom, mots || [])]),
        meta((a.phase ? "Phase " + a.phase + " · " : "") + (a.statut !== "active" ? D.STATUTS_AFFAIRE[a.statut] + " · " : "") + n + (n > 1 ? " tâches ouvertes" : " tâche ouverte"))],
      action: function () { va("/planif/taches/?affaire=" + encodeURIComponent(a.id) + "&membre="); }
    };
  }
  function ligneMembre(m, mots) {
    var n = D.taches({ membreId: m.id, sansTerminees: true }).length;
    return {
      noeud: [glyphe(m.prenom.charAt(0) + m.nom.charAt(0)), lib(m.prenom + " " + m.nom, mots),
        meta(D.libelleMetier(m.metier) + (D.PLANIFIES[m.metier] ? " · " + n + (n > 1 ? " tâches" : " tâche") : ""))],
      classe: m.actif ? "" : "eteinte",
      action: function () { va("/planif/taches/?membre=" + encodeURIComponent(m.id)); }
    };
  }
  function ligneContact(c, mots) {
    var nom = [c.prenom, c.nom].filter(Boolean).join(" ");
    return {
      noeud: [glyphe("@"), el("span", { class: "pal-lib" }, [
        UI.surligne(nom || c.societe, mots || []),
        nom && c.societe ? el("span", { class: "pal-sous" }, [UI.surligne(c.societe, mots || [])]) : null]),
        meta(c.natel || c.telephone || c.localite || "")],
      action: function () { va("/planif/annuaire/?q=" + encodeURIComponent(nom || c.societe)); }
    };
  }
  function lignePage(p, mots) {
    return { noeud: [glyphe("→"), lib(p.nom, mots), meta(location.pathname === (UI.chemin ? UI.chemin(p.href) : p.href) ? "Ici" : "")],
             action: function () { va(p.href); } };
  }
  function ligneCommande(c, mots) {
    return { noeud: [glyphe(c.glyphe), lib(c.nom, mots)], action: c.action };
  }

  /* La ligne « Créer » : ce qui a été compris, en étiquettes. Ce qui manque est
     en pointillé : Entrée ouvrira alors le formulaire pour le compléter. */
  function ligneCreer(r) {
    var b = brouillon(r);
    function etiq(texte, ok, teinte) {
      return el("span", { class: "pal-etiq" + (ok ? "" : " manque"), style: teinte ? "border-left-color:" + UI.teinte(teinte) : null, text: texte });
    }
    var etiquettes = [
      r.affaire ? etiq(r.affaire.code, true, r.affaire.teinte) : etiq("affaire ?", false),
      b.ingenieurId ? etiq(D.nomMembre(b.ingenieurId) + (b.chargeInge ? " · " + C.fmtJours(b.chargeInge) + " j" : ""), true) : (b.chargeInge ? etiq("calcul · " + C.fmtJours(b.chargeInge) + " j · à affecter", true) : null),
      b.dessinateurId ? etiq(D.nomMembre(b.dessinateurId) + (b.chargeDessin ? " · " + C.fmtJours(b.chargeDessin) + " j" : ""), true) : (b.chargeDessin ? etiq("dessin · " + C.fmtJours(b.chargeDessin) + " j · à affecter", true) : null),
      (b.chargeInge + b.chargeDessin) > 0 ? null : etiq("charge ?", false),
      b.echeance ? etiq(quand(b.echeance), true) : etiq("échéance ?", false)
    ];
    return {
      noeud: [glyphe("+"), el("span", { class: "pal-lib pal-creer" }, [
        el("span", {}, ["Créer « ", el("b", { text: b.titre || "…" }), " »"]),
        el("span", { class: "pal-etiqs" }, etiquettes)
      ]), meta(b.complet ? "Entrée crée" : "Entrée complète")],
      classe: "creer",
      action: function (formulaire) {
        if (b.complet && !formulaire) return creeDirect(b);
        ferme();
        UI.formulaireTache(null, { brouillon: b, affaireId: b.affaireId, surEnregistrement: D.redessine });
      }
    };
  }

  function creeDirect(b) {
    ferme();
    D.ajouteTache({
      affaireId: b.affaireId, titre: b.titre, echeance: b.echeance,
      ingenieurId: b.ingenieurId, dessinateurId: b.dessinateurId,
      chargeInge: b.chargeInge, chargeDessin: b.chargeDessin, statut: "a_faire", avancement: 0
    }).then(function (t) {
      D.redessine();
      UI.toast("Tâche créée : " + b.titre + ", " + C.fmtLong(b.echeance) + ".", {
        label: "Ouvrir", action: function () { UI.ficheTache(t.id, { surEnregistrement: D.redessine }); }
      });
    }).catch(function (e) { UI.toast(e.message); });
  }

  function va(href) { ferme(); location.href = UI.chemin ? UI.chemin(href) : href; }

  /* ========================================================= la fenêtre ===== */

  var racine = null, champ = null, liste = null, curseur = null, pied = null;
  var lignes = [], choix = 0, dernierFocus = null;

  function construit() {
    champ = el("input", {
      type: "text", class: "pal-champ", autocomplete: "off", spellcheck: "false",
      placeholder: "Chercher, aller, agir — ou écrire une tâche",
      role: "combobox", "aria-expanded": "true", "aria-controls": "pal-liste", "aria-autocomplete": "list",
      enterkeyhint: "go"
    });
    liste = el("div", { class: "pal-liste", id: "pal-liste", role: "listbox" });
    curseur = el("div", { class: "pal-curseur", "aria-hidden": "true" });
    pied = el("div", { class: "pal-pied" });
    racine = el("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Palette de commandes", hidden: true }, [
      el("div", { class: "pal-fond", onclick: function () { ferme(); } }),
      el("div", { class: "pal-boite" }, [
        el("div", { class: "pal-saisie" }, [
          el("span", { class: "recherche-loupe", "aria-hidden": "true" }), champ,
          el("kbd", { class: "pal-echap", text: "Échap" })
        ]),
        liste, pied
      ])
    ]);
    document.body.appendChild(racine);

    champ.addEventListener("input", dessine);
    champ.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); bouge(1); }
      else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); bouge(-1); }
      else if (e.key === "PageDown") { e.preventDefault(); bouge(5); }
      else if (e.key === "PageUp") { e.preventDefault(); bouge(-5); }
      else if (e.key === "Enter") { e.preventDefault(); if (!e.repeat) active(choix, e.shiftKey); }
      else if (e.key === "Escape") { e.preventDefault(); if (champ.value) { champ.value = ""; dessine(); } else ferme(); }
    });
    liste.addEventListener("scroll", placeCurseur, { passive: true });
    global.addEventListener("resize", placeCurseur);
  }

  function exemple() {
    if (!donnees()) return "";
    var a = D.affaires({}).filter(function (x) { return x.statut === "active"; })[0];
    var moi = D.monMembre();
    var p = moi && D.PLANIFIES[moi.metier] ? moi : D.membres({ planifies: true })[0];
    if (!a || !p) return "";
    return "Plans coffrage " + a.code + " " + p.prenom + " vendredi 2j";
  }

  function dessinePied() {
    vide(pied);
    var ex = exemple();
    pied.appendChild(el("span", { class: "pal-touches" }, [
      el("kbd", { text: "↑↓" }), " choisir  ", el("kbd", { text: "Entrée" }), " ouvrir  ",
      el("kbd", { text: "Maj+Entrée" }), " formulaire"
    ]));
    if (ex) {
      pied.appendChild(el("button", {
        type: "button", class: "pal-exemple", title: "Essayer cet exemple",
        onclick: function () { champ.value = ex; dessine(); champ.focus(); }
      }, ["Essaie : ", el("span", { text: "« " + ex + " »" })]));
    }
  }

  function dessine() {
    var q = champ.value;
    var groupes = resultats(q);
    vide(liste);
    liste.appendChild(curseur);
    lignes = [];
    groupes.forEach(function (g) {
      if (!g.lignes.length) return;
      liste.appendChild(el("div", { class: "pal-groupe", role: "presentation", text: g.titre }));
      g.lignes.forEach(function (l) {
        var n = lignes.length;
        var noeud = el("div", {
          class: "pal-ligne" + (l.classe ? " " + l.classe : ""), role: "option", id: "pal-o" + n,
          onmousemove: function () { if (choix !== n) choisit(n, false); },
          onclick: function (e) { active(n, e.shiftKey); }
        }, l.noeud);
        l.el = noeud;
        lignes.push(l);
        liste.appendChild(noeud);
      });
    });
    if (!lignes.length) {
      liste.appendChild(el("div", { class: "pal-vide", text: "Rien trouvé pour « " + q.trim() + " »." }));
    }
    choix = 0;
    choisit(0, true);
  }

  function choisit(n, defile) {
    if (!lignes.length) { curseur.style.opacity = "0"; champ.removeAttribute("aria-activedescendant"); return; }
    choix = (n + lignes.length) % lignes.length;
    lignes.forEach(function (l, i) { l.el.setAttribute("aria-selected", String(i === choix)); });
    champ.setAttribute("aria-activedescendant", "pal-o" + choix);
    if (defile) {
      var l = lignes[choix].el;
      var haut = l.offsetTop, bas = haut + l.offsetHeight;
      if (choix === 0) liste.scrollTop = 0;
      else if (haut < liste.scrollTop + 30) liste.scrollTop = haut - 30;
      else if (bas > liste.scrollTop + liste.clientHeight - 8) liste.scrollTop = bas - liste.clientHeight + 8;
    }
    placeCurseur();
  }
  function bouge(d) {
    if (!lignes.length) return;
    // Aux bords, on reboucle ; avec Page haut/bas, on s'arrête au bord
    var n = Math.abs(d) > 1 ? Math.max(0, Math.min(lignes.length - 1, choix + d)) : choix + d;
    choisit(n, true);
  }
  /* Le surlignage glisse d'une ligne à l'autre au lieu de sauter */
  function placeCurseur() {
    if (!lignes.length || !lignes[choix]) return;
    var l = lignes[choix].el;
    curseur.style.opacity = "1";
    curseur.style.height = l.offsetHeight + "px";
    curseur.style.transform = "translateY(" + l.offsetTop + "px)";
  }

  function active(n, formulaire) {
    var l = lignes[n];
    if (!l) return;
    l.action(!!formulaire);
  }

  function ouvre(texte) {
    if (!racine) construit();
    if (document.querySelector(".modale.ouverte")) return;
    index = null;                                 // les données ont pu changer depuis la dernière fois
    dernierFocus = document.activeElement;
    racine.hidden = false;
    document.documentElement.classList.add("palette-ouverte");
    champ.value = texte || "";
    dessinePied();
    dessine();
    setTimeout(function () { champ.focus(); champ.select(); placeCurseur(); }, 0);
  }

  function ferme() {
    if (!racine || racine.hidden) return;
    racine.hidden = true;
    document.documentElement.classList.remove("palette-ouverte");
    if (dernierFocus && dernierFocus.focus && document.contains(dernierFocus)) {
      try { dernierFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key || "").toLowerCase() === "k") {
      if (document.querySelector(".modale.ouverte")) return;
      e.preventDefault();
      if (racine && !racine.hidden) ferme(); else ouvre();
    }
  });

  global.Palette = {
    ouvre: ouvre, ferme: ferme, touche: MAC ? "⌘K" : "Ctrl K",
    lisPhrase: lisPhrase, brouillon: brouillon            // exposés pour les essais
  };
})(window);
