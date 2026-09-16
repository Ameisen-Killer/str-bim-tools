/* Calendrier — semaines ISO, jours ouvrés et jours fériés suisses.
   Aucune dépendance. Toutes les dates circulent au format « AAAA-MM-JJ » (chaîne),
   converties en objet Date à midi pour rester insensibles aux changements d'heure. */
(function (global) {
  "use strict";

  var JOURS = ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"];
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
              "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                    "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  /* ------------------------------------------------------------- dates */

  function deux(n) { return (n < 10 ? "0" : "") + n; }

  /** Date -> "AAAA-MM-JJ" */
  function iso(d) {
    return d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate());
  }

  /** "AAAA-MM-JJ" -> Date locale à midi */
  function dt(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  }

  function aujourdhui() { var d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  function isoAuj() { return iso(aujourdhui()); }

  /** Décale une date ISO de n jours. */
  // Mémoire des pas d'un jour : les calculs de charge avancent ou reculent jour
  // par jour des milliers de fois sur les mêmes dates. Relire et réécrire une
  // date à chaque pas coûtait plus que le calcul lui-même.
  var memoPas = { "1": Object.create(null), "-1": Object.create(null) };

  function ajoute(s, n) {
    var memo = memoPas[n];
    if (memo && memo[s] !== undefined) return memo[s];
    var d = dt(s); if (!d) return null;
    d.setDate(d.getDate() + n);
    var r = iso(d);
    if (memo) memo[s] = r;
    return r;
  }

  /** Nombre de jours calendaires de a à b (b - a). */
  function diff(a, b) {
    var x = dt(a), y = dt(b);
    if (!x || !y) return 0;
    return Math.round((y - x) / 86400000);
  }

  /** Lundi de la semaine contenant la date. */
  function lundi(s) {
    var d = dt(s); if (!d) return null;
    var j = d.getDay() || 7;          // dimanche = 7
    d.setDate(d.getDate() - (j - 1));
    return iso(d);
  }

  /** Numéro de semaine ISO 8601 et son année. */
  function semaineISO(s) {
    var d = dt(s); if (!d) return { annee: 0, num: 0 };
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var j = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - j);          // jeudi de la semaine
    var annee = t.getUTCFullYear();
    var debut = Date.UTC(annee, 0, 1);
    return { annee: annee, num: Math.ceil(((t - debut) / 86400000 + 1) / 7) };
  }

  /** Liste de n dates ISO à partir de depart (inclus). */
  function serie(depart, n) {
    var out = [], d = dt(depart);
    for (var i = 0; i < n; i++) { out.push(iso(d)); d.setDate(d.getDate() + 1); }
    return out;
  }

  function estWeekend(s) { var d = dt(s); if (!d) return false; var j = d.getDay(); return j === 0 || j === 6; }

  /** Premier jour du mois contenant la date. */
  function premierMois(s) {
    var d = dt(s); if (!d) return null;
    d.setDate(1);
    return iso(d);
  }

  /** Nombre de jours du mois contenant la date. */
  function nbJoursMois(s) {
    var d = dt(s); if (!d) return 0;
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
  }

  /** Décale une date de n mois. Le quantième est ramené au dernier jour si le mois est plus court. */
  function ajouteMois(s, n) {
    var d = dt(s); if (!d) return null;
    var jour = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(jour, new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate()));
    return iso(d);
  }

  /** Découpe une liste de jours en mois : [{cle, jours:[]}] */
  function mois(jours) {
    var out = [], cle = null;
    jours.forEach(function (j) {
      var k = j.slice(0, 7);
      if (k !== cle) { out.push({ cle: k, premier: j, jours: [] }); cle = k; }
      out[out.length - 1].jours.push(j);
    });
    return out;
  }

  /* --------------------------------------------------------- affichage */

  function jourCourt(s) { var d = dt(s); return d ? JOURS[d.getDay()] : ""; }
  function quantieme(s) { var d = dt(s); return d ? d.getDate() : ""; }

  /** « 15 sept. » */
  function fmtCourt(s) { var d = dt(s); return d ? d.getDate() + " " + MOIS_COURT[d.getMonth()] : "—"; }

  /** « lundi 15 septembre 2026 » */
  function fmtLong(s) {
    var d = dt(s); if (!d) return "—";
    var noms = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    return noms[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()] + " " + d.getFullYear();
  }

  /** « septembre 2026 » */
  function fmtMois(s) {
    var d = dt(s); if (!d) return "—";
    return MOIS[d.getMonth()] + " " + d.getFullYear();
  }

  /** « sept. 26 », pour un en-tête étroit */
  function fmtMoisCourt(s) {
    var d = dt(s); if (!d) return "—";
    return MOIS_COURT[d.getMonth()] + " " + String(d.getFullYear()).slice(2);
  }

  /** « 15.09.2026 » */
  function fmtCH(s) {
    var d = dt(s); if (!d) return "—";
    return deux(d.getDate()) + "." + deux(d.getMonth() + 1) + "." + d.getFullYear();
  }

  /** Durée en jours, affichée sans décimale inutile : 2 / 2.5 */
  function fmtJours(n) {
    if (n == null || isNaN(n)) return "0";
    var x = Math.round(n * 100) / 100;
    return (Math.abs(x - Math.round(x)) < 0.005 ? String(Math.round(x)) : String(x).replace(".", ","));
  }

  /* ------------------------------------------------------------ fériés */

  /** Dimanche de Pâques (algorithme grégorien anonyme). */
  function paques(an) {
    var a = an % 19, b = Math.floor(an / 100), c = an % 100,
        d = Math.floor(b / 4), e = b % 4,
        f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
        h = (19 * a + b - d - g + 15) % 30,
        i = Math.floor(c / 4), k = c % 4,
        l = (32 + 2 * e + 2 * i - h - k) % 7,
        m = Math.floor((a + 11 * h + 22 * l) / 451),
        mois = Math.floor((h + l - 7 * m + 114) / 31),
        jour = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(new Date(an, mois - 1, jour, 12));
  }

  /** Lundi du Jeûne fédéral : lundi qui suit le 3e dimanche de septembre. */
  function jeuneFederal(an) {
    var d = new Date(an, 8, 1, 12), n = 0;
    while (true) { if (d.getDay() === 0 && ++n === 3) break; d.setDate(d.getDate() + 1); }
    d.setDate(d.getDate() + 1);
    return iso(d);
  }

  /** Jeûne genevois : jeudi qui suit le 1er dimanche de septembre. */
  function jeuneGenevois(an) {
    var d = new Date(an, 8, 1, 12);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + 4);
    return iso(d);
  }

  /* Jours fériés cantonaux, à titre indicatif : les usages varient d'une
     entreprise à l'autre. Ce qui manque se rattrape par une absence. */
  var CANTONS = [
    { code: "CH", nom: "Suisse — jours communs" },
    { code: "VD", nom: "Vaud" },
    { code: "GE", nom: "Genève" },
    { code: "VS", nom: "Valais" },
    { code: "FR", nom: "Fribourg" },
    { code: "NE", nom: "Neuchâtel" },
    { code: "JU", nom: "Jura" },
    { code: "BE", nom: "Berne" },
    { code: "ZH", nom: "Zurich" }
  ];

  var cacheFeries = {};

  /** { "AAAA-MM-JJ": "nom du jour férié" } pour une année et un canton. */
  function feries(an, canton) {
    var cle = an + "|" + (canton || "CH");
    if (cacheFeries[cle]) return cacheFeries[cle];

    var p = paques(an), f = {};
    function pose(d, nom) { if (d) f[d] = nom; }

    pose(an + "-01-01", "Nouvel An");
    pose(ajoute(p, -2), "Vendredi saint");
    pose(ajoute(p, 1), "Lundi de Pâques");
    pose(ajoute(p, 39), "Ascension");
    pose(ajoute(p, 50), "Lundi de Pentecôte");
    pose(an + "-08-01", "Fête nationale");
    pose(an + "-12-25", "Noël");

    switch (canton) {
      case "VD":
        pose(an + "-01-02", "Saint-Berchtold");
        pose(jeuneFederal(an), "Lundi du Jeûne fédéral");
        break;
      case "GE":
        pose(jeuneGenevois(an), "Jeûne genevois");
        pose(an + "-12-31", "Restauration de la République");
        break;
      case "VS":
        delete f[ajoute(p, -2)];                       // pas de Vendredi saint en Valais
        pose(an + "-03-19", "Saint-Joseph");
        pose(ajoute(p, 60), "Fête-Dieu");
        pose(an + "-08-15", "Assomption");
        pose(an + "-11-01", "Toussaint");
        pose(an + "-12-08", "Immaculée Conception");
        break;
      case "FR":
        pose(ajoute(p, 60), "Fête-Dieu");
        pose(an + "-08-15", "Assomption");
        pose(an + "-11-01", "Toussaint");
        pose(an + "-12-08", "Immaculée Conception");
        pose(an + "-12-26", "Saint-Étienne");
        break;
      case "NE":
        pose(an + "-01-02", "Saint-Berchtold");
        pose(an + "-03-01", "Instauration de la République");
        pose(jeuneFederal(an), "Lundi du Jeûne fédéral");
        break;
      case "JU":
        pose(an + "-05-01", "Fête du travail");
        pose(ajoute(p, 60), "Fête-Dieu");
        pose(an + "-06-23", "Commémoration du plébiscite");
        pose(an + "-11-01", "Toussaint");
        break;
      case "BE":
        pose(an + "-01-02", "Saint-Berchtold");
        pose(an + "-12-26", "Saint-Étienne");
        break;
      case "ZH":
        pose(an + "-01-02", "Saint-Berchtold");
        pose(an + "-05-01", "Fête du travail");
        pose(an + "-12-26", "Saint-Étienne");
        break;
    }

    cacheFeries[cle] = f;
    return f;
  }

  /** Nom du jour férié, ou null. */
  function ferie(s, canton) {
    var d = dt(s); if (!d) return null;
    return feries(d.getFullYear(), canton)[s] || null;
  }

  /** Motif de chômage du jour : « Samedi », « Noël »… ou null si ouvrable. */
  var memoChome = Object.create(null);

  function chome(s, canton) {
    var cle = (canton || "CH") + "|" + s;
    if (memoChome[cle] !== undefined) return memoChome[cle];
    var d = dt(s); if (!d) return null;
    var j = d.getDay();
    var r = j === 0 ? "Dimanche" : j === 6 ? "Samedi" : ferie(s, canton);
    memoChome[cle] = r;
    return r;
  }

  function estOuvre(s, canton) { return !chome(s, canton); }

  /** Nombre de jours ouvrés entre deux dates ISO incluses. */
  function nbOuvres(a, b, canton) {
    if (!a || !b || diff(a, b) < 0) return 0;
    var n = 0, cur = a;
    for (var garde = 0; garde < 4000; garde++) {
      if (estOuvre(cur, canton)) n++;
      if (cur === b) break;
      cur = ajoute(cur, 1);
    }
    return n;
  }

  /** Recule de n jours ouvrés depuis une date (incluse si ouvrée). */
  function reculeOuvres(fin, n, canton) {
    var cur = fin, restant = Math.max(1, Math.ceil(n));
    for (var garde = 0; garde < 4000; garde++) {
      if (estOuvre(cur, canton)) restant--;
      if (restant <= 0) return cur;
      cur = ajoute(cur, -1);
    }
    return cur;
  }

  global.Cal = {
    iso: iso, dt: dt, ajoute: ajoute, diff: diff, lundi: lundi,
    aujourdhui: aujourdhui, isoAuj: isoAuj, serie: serie,
    semaineISO: semaineISO, estWeekend: estWeekend,
    premierMois: premierMois, nbJoursMois: nbJoursMois, ajouteMois: ajouteMois, mois: mois,
    jourCourt: jourCourt, quantieme: quantieme,
    fmtCourt: fmtCourt, fmtLong: fmtLong, fmtCH: fmtCH, fmtJours: fmtJours,
    fmtMois: fmtMois, fmtMoisCourt: fmtMoisCourt,
    paques: paques, feries: feries, ferie: ferie, chome: chome,
    estOuvre: estOuvre, nbOuvres: nbOuvres, reculeOuvres: reculeOuvres,
    CANTONS: CANTONS, MOIS: MOIS
  };
})(window);
