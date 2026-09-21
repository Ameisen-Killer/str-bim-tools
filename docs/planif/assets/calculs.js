/* Calculs de planification : étalement des charges, capacité, alertes.
   Rien n'est stocké ici — tout est dérivé des tâches, des membres et du calendrier.
   Déplacer une tâche revient donc à changer deux dates, jamais à réécrire un planning. */
(function (global) {
  "use strict";

  var C = global.Cal;

  /** Capacité d'un membre, en jours, pour une date donnée. 0 si chômé ou absent. */
  function capaciteJour(membre, jour, canton) {
    if (!membre || !membre.actif) return 0;
    if (C.chome(jour, canton)) return 0;
    if (absenceLe(membre, jour)) return 0;
    return (membre.capacite || 5) / 5;
  }

  /** L'absence couvrant ce jour, ou null. */
  function absenceLe(membre, jour) {
    if (!membre || !membre.absences) return null;
    for (var i = 0; i < membre.absences.length; i++) {
      var a = membre.absences[i];
      if (a.debut <= jour && jour <= (a.fin || a.debut)) return a;
    }
    return null;
  }

  /** Charge totale d'une tâche, toutes casquettes confondues. */
  function chargeTotale(t) { return (t.chargeInge || 0) + (t.chargeDessin || 0); }

  /**
   * Une tâche porte deux parts, le calcul et le dessin, qui se terminent
   * séparément : l'ingénieur qui boucle sa note de calcul libère sa charge
   * sans fermer le dessin qui suit. Une part finie ne pèse donc plus sur le
   * planning, n'attend plus personne et ne déclenche plus d'alerte ; seule la
   * barre reste dessinée, marquée terminée.
   */
  function partFinie(t, role) { return role === "ingenieur" ? !!t.finiInge : !!t.finiDessin; }

  /** Charge encore à faire : les parts qui ne sont pas terminées. */
  function chargeOuverte(t) {
    if (t.statut === "termine") return 0;
    return (t.finiInge ? 0 : (t.chargeInge || 0)) + (t.finiDessin ? 0 : (t.chargeDessin || 0));
  }

  /** Les affectations réelles d'une tâche : [{membreId, role, charge, fini}] */
  function affectations(t) {
    var out = [];
    if (t.chargeInge > 0 && t.ingenieurId) out.push({ membreId: t.ingenieurId, role: "ingenieur", charge: t.chargeInge, fini: !!t.finiInge });
    if (t.chargeDessin > 0 && t.dessinateurId) out.push({ membreId: t.dessinateurId, role: "dessinateur", charge: t.chargeDessin, fini: !!t.finiDessin });
    return out;
  }

  /** Les charges d'une tâche qui attendent encore quelqu'un : [{role, charge}] */
  function nonAffectees(t) {
    var out = [];
    if (t.chargeInge > 0 && !t.ingenieurId && !t.finiInge) out.push({ role: "ingenieur", charge: t.chargeInge });
    if (t.chargeDessin > 0 && !t.dessinateurId && !t.finiDessin) out.push({ role: "dessinateur", charge: t.chargeDessin });
    return out;
  }

  /**
   * L'échéance fait foi ; le début s'en déduit.
   * On remonte le temps depuis l'échéance, jour par jour, en cumulant la
   * capacité réelle de la personne (0 le week-end, les jours fériés et pendant
   * ses absences, 0,8 par jour pour un 80 %) jusqu'à couvrir sa charge.
   * Changer la durée, l'échéance ou une absence redonne donc toujours un début juste.
   * Sans personne affectée (ou inactive), on compte un jour ouvré = un jour de travail.
   */
  function debutPour(charge, fin, membre, canton) {
    if (!fin) return null;
    if (membre && !membre.actif) membre = null;
    var cumul = 0, cur = fin, dernierTravaille = null;
    for (var garde = 0; garde < 1500; garde++) {
      var cap = membre ? capaciteJour(membre, cur, canton) : (C.estOuvre(cur, canton) ? 1 : 0);
      if (cap > 0) {
        cumul += cap;
        dernierTravaille = cur;
        if (cumul >= charge - 1e-6) return cur;
      }
      cur = C.ajoute(cur, -1);
    }
    return dernierTravaille || fin;
  }

  function membreParDefaut(id) {
    return (global.Donnees && global.Donnees.membre) ? global.Donnees.membre(id) : null;
  }

  /** Début de l'affectation d'un membre sur une tâche. */
  function debutAffectation(t, af, canton, trouve) {
    return debutPour(af.charge, t.echeance, (trouve || membreParDefaut)(af.membreId), canton);
  }

  /**
   * Début de la tâche : le plus tôt des débuts de ses intervenants.
   * Une charge non affectée compte aussi, sur le seul calendrier du canton.
   */
  function debutEffectif(t, canton, trouve) {
    if (!t.echeance) return null;
    trouve = trouve || membreParDefaut;
    var debuts = [];
    if (t.chargeInge > 0) debuts.push(debutPour(t.chargeInge, t.echeance, t.ingenieurId ? trouve(t.ingenieurId) : null, canton));
    if (t.chargeDessin > 0) debuts.push(debutPour(t.chargeDessin, t.echeance, t.dessinateurId ? trouve(t.dessinateurId) : null, canton));
    if (!debuts.length) return t.echeance;
    return debuts.sort()[0];
  }

  /** Fin effective : l'échéance. */
  function finEffective(t) { return t.echeance || null; }

  function somme(liste) { var s = 0; for (var i = 0; i < liste.length; i++) s += liste[i]; return s; }

  /**
   * Place la charge de chaque affectation dans les jours de sa période, comme
   * le ferait un planificateur : chaque tâche remplit d'abord la capacité
   * ENCORE LIBRE du membre, et les tâches les plus contraintes se servent en
   * premier (fenêtre la plus courte, puis échéance la plus proche).
   *
   * Un étalement à parts égales, tâche par tâche, fabriquait des surcharges
   * fictives : une tâche de 6 j sur 7 jours ouvrés posait 0,86 j sur un jour
   * déjà occupé par une tâche d'un jour, alors que les 7 j tenaient exactement.
   * Seul ce qui ne rentre vraiment pas dans la capacité libre apparaît en
   * surcharge, réparti au prorata de la capacité de chaque jour.
   *
   * Renvoie { membreId: { "AAAA-MM-JJ": { total, parts:[{tacheId, role, jours}] } } }
   */
  function repartition(taches, membres, canton) {
    var index = {}, lots = {};
    membres.forEach(function (m) { index[m.id] = m; });

    // 1. Chaque affectation devient un lot : sa période, et la capacité de chaque jour
    taches.forEach(function (t) {
      var fin = finEffective(t);
      if (!fin) return;

      affectations(t).forEach(function (af) {
        if (af.fini) return;                      // part bouclée : sa charge ne pèse plus sur la personne
        var membre = index[af.membreId];
        if (!membre) return;
        // Chaque intervenant a sa propre fenêtre : 0,5 j d'ingénieur ne s'étale pas sur les 4 j du dessin
        var debut = debutPour(af.charge, fin, membre, canton);
        var jours = [], base = [], cur = debut, garde = 0;
        while (garde++ < 800) {
          jours.push(cur);
          base.push(capaciteJour(membre, cur, canton));
          if (cur === fin) break;
          cur = C.ajoute(cur, 1);
        }
        (lots[af.membreId] || (lots[af.membreId] = [])).push({
          tacheId: t.id, role: af.role, charge: af.charge, fin: fin,
          jours: jours, base: base,
          ouvres: base.filter(function (c) { return c > 0; }).length
        });
      });
    });

    // 2. Remplissage, membre par membre
    var parMembre = {};
    Object.keys(lots).forEach(function (mid) {
      var occupe = {};
      var cible = parMembre[mid] = {};

      lots[mid].sort(function (a, b) {
        if (a.ouvres !== b.ouvres) return a.ouvres - b.ouvres;
        if (a.fin !== b.fin) return a.fin < b.fin ? -1 : 1;
        return a.tacheId < b.tacheId ? -1 : 1;          // ordre stable d'un rendu à l'autre
      });

      lots[mid].forEach(function (lot) {
        var parts = lot.jours.map(function () { return 0; });
        var reste = lot.charge;

        // D'abord la capacité encore libre, au prorata de ce qui reste chaque jour
        var libre = lot.jours.map(function (j, k) { return Math.max(0, lot.base[k] - (occupe[j] || 0)); });
        var totalLibre = somme(libre);
        if (totalLibre > 0) {
          var place = Math.min(reste, totalLibre);
          libre.forEach(function (l, k) { parts[k] += place * l / totalLibre; });
          reste -= place;
        }

        // Ce qui ne rentre pas : vraie surcharge, au prorata de la capacité du jour.
        // Période entièrement chômée ou en congé : on répartit quand même,
        // sinon la tâche disparaîtrait du planning sans prévenir.
        if (reste > 1e-9) {
          var poids = lot.base.slice(), s = somme(poids);
          if (s <= 0) { poids = lot.jours.map(function () { return 1; }); s = poids.length; }
          poids.forEach(function (p, k) { parts[k] += reste * p / s; });
        }

        lot.jours.forEach(function (j, k) {
          if (parts[k] <= 1e-9) return;
          occupe[j] = (occupe[j] || 0) + parts[k];
          var cell = cible[j] || (cible[j] = { total: 0, parts: [] });
          cell.total += parts[k];
          cell.parts.push({ tacheId: lot.tacheId, role: lot.role, jours: parts[k] });
        });
      });
    });
    return parMembre;
  }

  /** Charge et capacité d'un membre sur une liste de jours. */
  function bilan(membre, jours, rep, canton) {
    var charge = 0, capacite = 0;
    jours.forEach(function (j) {
      capacite += capaciteJour(membre, j, canton);
      if (rep && rep[j]) charge += rep[j].total;
    });
    return { charge: charge, capacite: capacite, taux: capacite > 0 ? charge / capacite : (charge > 0 ? 99 : 0) };
  }

  /** Découpe une liste de jours en semaines ISO : [{num, annee, jours:[]}] */
  function semaines(jours) {
    var out = [], cle = null;
    jours.forEach(function (j) {
      var s = C.semaineISO(j);
      var k = s.annee + "-" + s.num;
      if (k !== cle) { out.push({ annee: s.annee, num: s.num, jours: [] }); cle = k; }
      out[out.length - 1].jours.push(j);
    });
    return out;
  }

  /** Alertes classées du plus grave au moins grave. */
  function alertes(etat, canton) {
    var auj = C.isoAuj(), out = [];
    var affaires = {};
    etat.affaires.forEach(function (a) { affaires[a.id] = a; });

    etat.taches.forEach(function (t) {
      if (t.statut === "termine") return;
      var aff = affaires[t.affaireId];
      var libelle = (aff ? aff.code + " · " : "") + t.titre;
      if (t.echeance && t.echeance < auj) {
        out.push({ rang: 0, type: "grave", quoi: "En retard",
          texte: libelle, detail: "échéance du " + C.fmtCH(t.echeance), tacheId: t.id });
      } else if (t.echeance && C.diff(auj, t.echeance) <= 5) {
        out.push({ rang: 1, type: "proche", quoi: "Échéance proche",
          texte: libelle, detail: C.fmtLong(t.echeance), tacheId: t.id });
      }
      if (t.chargeInge > 0 && !t.ingenieurId && !t.finiInge) {
        out.push({ rang: 1, type: "proche", quoi: "Sans ingénieur", texte: libelle, detail: "charge non affectée", tacheId: t.id });
      }
      if (t.chargeDessin > 0 && !t.dessinateurId && !t.finiDessin) {
        out.push({ rang: 1, type: "proche", quoi: "Sans dessinateur", texte: libelle, detail: "charge non affectée", tacheId: t.id });
      }
    });

    // Surcharge sur les quatre semaines à venir
    var depart = C.lundi(auj);
    var jours = C.serie(depart, 28);
    var rep = repartition(etat.taches.filter(function (t) { return t.statut !== "termine"; }), etat.membres, canton);
    semaines(jours).forEach(function (s) {
      etat.membres.forEach(function (m) {
        if (!m.actif) return;
        var b = bilan(m, s.jours, rep[m.id], canton);
        if (b.charge > b.capacite + 0.05) {
          out.push({
            rang: b.capacite === 0 ? 1 : 2, type: b.taux > 1.4 ? "grave" : "proche",
            quoi: "Surcharge S" + s.num,
            texte: m.prenom + " " + m.nom,
            detail: C.fmtJours(b.charge) + " j affectés pour " + C.fmtJours(b.capacite) + " j disponibles",
            membreId: m.id
          });
        }
      });
    });

    return out.sort(function (a, b) { return a.rang - b.rang; });
  }

  global.Calc = {
    capaciteJour: capaciteJour,
    absenceLe: absenceLe,
    chargeTotale: chargeTotale,
    chargeOuverte: chargeOuverte,
    partFinie: partFinie,
    affectations: affectations, nonAffectees: nonAffectees,
    debutEffectif: debutEffectif,
    debutAffectation: debutAffectation,
    debutPour: debutPour,
    finEffective: finEffective,
    repartition: repartition,
    bilan: bilan,
    semaines: semaines,
    alertes: alertes
  };
})(window);
