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

  /** Les affectations réelles d'une tâche : [{membreId, role, charge}] */
  function affectations(t) {
    var out = [];
    if (t.chargeInge > 0 && t.ingenieurId) out.push({ membreId: t.ingenieurId, role: "ingenieur", charge: t.chargeInge });
    if (t.chargeDessin > 0 && t.dessinateurId) out.push({ membreId: t.dessinateurId, role: "dessinateur", charge: t.chargeDessin });
    return out;
  }

  /** Début effectif : celui saisi, sinon « au plus tard » en remontant depuis l'échéance. */
  function debutEffectif(t, canton) {
    if (t.debut) return t.debut;
    if (!t.echeance) return null;
    var j = Math.max(1, Math.ceil(chargeTotale(t)));
    return C.reculeOuvres(t.echeance, j, canton);
  }

  /** Fin effective : l'échéance. */
  function finEffective(t) { return t.echeance || t.debut || null; }

  /**
   * Étale la charge de chaque affectation sur les jours ouvrés de sa période,
   * au prorata de la capacité quotidienne du membre concerné.
   * Renvoie { membreId: { "AAAA-MM-JJ": { total, parts:[{tacheId, role, jours}] } } }
   */
  function repartition(taches, membres, canton) {
    var parMembre = {};
    var index = {};
    membres.forEach(function (m) { index[m.id] = m; });

    taches.forEach(function (t) {
      var debut = debutEffectif(t, canton), fin = finEffective(t);
      if (!debut || !fin) return;

      affectations(t).forEach(function (af) {
        var membre = index[af.membreId];
        if (!membre) return;

        // Jours de la période et poids de chacun
        var jours = [], poids = [], somme = 0, cur = debut, garde = 0;
        while (garde++ < 800) {
          jours.push(cur);
          var p = capaciteJour(membre, cur, canton);
          poids.push(p); somme += p;
          if (cur === fin) break;
          cur = C.ajoute(cur, 1);
        }
        // Période entièrement chômée ou en congé : on répartit quand même,
        // sinon la tâche disparaîtrait du planning sans prévenir.
        if (somme <= 0) { poids = jours.map(function () { return 1; }); somme = jours.length; }
        if (!somme) return;

        var cible = parMembre[af.membreId] || (parMembre[af.membreId] = {});
        jours.forEach(function (j, k) {
          if (poids[k] <= 0) return;
          var part = af.charge * poids[k] / somme;
          var cell = cible[j] || (cible[j] = { total: 0, parts: [] });
          cell.total += part;
          cell.parts.push({ tacheId: t.id, role: af.role, jours: part });
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
      if (t.chargeInge > 0 && !t.ingenieurId) {
        out.push({ rang: 1, type: "proche", quoi: "Sans ingénieur", texte: libelle, detail: "charge non affectée", tacheId: t.id });
      }
      if (t.chargeDessin > 0 && !t.dessinateurId) {
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
    affectations: affectations,
    debutEffectif: debutEffectif,
    finEffective: finEffective,
    repartition: repartition,
    bilan: bilan,
    semaines: semaines,
    alertes: alertes
  };
})(window);
