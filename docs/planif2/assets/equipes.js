/* Bureau (/planif2/) — commun aux modules d'équipe (Équipe, Absences), 02.11.2026.
   ---------------------------------------------------------------------------
   Le bandeau de gauche, repliable par un chevron (comme la visionneuse IFC) :
   recherche, « Tous », « Administrateurs », puis chaque succursale et ses
   secteurs. La page fournit le HTML (#page, #replier, #q, #arbre) ; ce
   fichier tient le filtre et rappelle la page à chaque changement.
     Equipes.monte({ nom, surChange })  → met le bandeau en place
     Equipes.membres()                  → membres actifs du filtre et de la recherche,
                                          par prénom puis nom
     Equipes.titre()                    → intitulé du filtre
     Equipes.arbre()                    → redessine le bandeau (après relecture)
     Equipes.fonction(m), .lieu(m), .avatar(m), .presence(m, jour), .jj(iso)
   Lecture seule ; s'appuie sur donnees.js, calendrier.js et calculs.js de /planif/.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";
  var D = global.Donnees, C = global.Cal, Calc = global.Calc;
  var $ = function (s) { return document.querySelector(s); };

  var filtre = "tous";              // tous | admin | s:<succursale> | d:<succursale>|<discipline>
  var surChange = function () {};
  var nomCle = "equipe";

  function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function estAdminDisc(code) { return /^administrateur/.test(sansAccents(code)) || /^administrateur/.test(sansAccents(D.DISCIPLINES[code])); }
  // Les administrateurs : rangés à part, pas dans les secteurs des succursales
  function estAdmin(m) { return D.aStatut(m, "administrateur") || estAdminDisc(m.discipline); }

  function dansFiltre(m) {
    if (filtre === "tous") return true;
    if (filtre === "admin") return estAdmin(m);
    if (filtre.indexOf("s:") === 0) return (m.succursale || "_") === filtre.slice(2);
    var p = filtre.slice(2).split("|");
    return (m.succursale || "_") === p[0] && (m.discipline || "_") === p[1] && !estAdmin(m);
  }

  function fonction(m) {
    var f = [m.metier ? D.libelleMetier(m.metier) : ""].concat((D.statutsDe(m) || []).map(D.libelleStatut));
    return f.filter(Boolean).join(" · ") || "Fonction non renseignée";
  }
  function lieu(m) {
    return [m.succursale ? D.SUCCURSALES[m.succursale] : "Sans succursale",
            m.discipline ? D.DISCIPLINES[m.discipline] : "Secteur non renseigné"].join(" · ");
  }
  function cherche(m) {
    var q = $("#q"), mots = sansAccents(q ? q.value : "").split(/\s+/).filter(Boolean);
    if (!mots.length) return true;
    var t = sansAccents([m.prenom, m.nom, m.email, fonction(m), lieu(m)].join(" "));
    return mots.every(function (w) { return t.indexOf(w) >= 0; });
  }
  function membres() { return D.membres().filter(dansFiltre).filter(cherche); }

  function titre() {
    if (filtre === "tous") return "Tous";
    if (filtre === "admin") return "Administrateurs";
    if (filtre.indexOf("s:") === 0) { var s = filtre.slice(2); return s === "_" ? "Sans succursale" : D.SUCCURSALES[s]; }
    var p = filtre.slice(2).split("|");
    return (p[1] === "_" ? "Secteur non renseigné" : D.DISCIPLINES[p[1]]) + " · " + (p[0] === "_" ? "sans succursale" : D.SUCCURSALES[p[0]]);
  }

  function avatar(m) {
    var av = document.createElement("span"); av.className = "avatar";
    if (m.photo) { var img = document.createElement("img"); img.src = m.photo; img.alt = ""; av.appendChild(img); }
    else av.textContent = ((m.prenom || "").charAt(0) + (m.nom || "").charAt(0)).toUpperCase() || "?";
    return av;
  }
  /** Bloc nom / fonction / succursale et secteur */
  function qui(m) {
    var d = document.createElement("div"); d.className = "qui";
    d.innerHTML = "<b></b><span class=\"fonction\"></span><span class=\"lieu\"></span>";
    d.querySelector("b").textContent = m.prenom + " " + m.nom;
    d.querySelector(".fonction").textContent = fonction(m);
    d.querySelector(".lieu").textContent = lieu(m);
    return d;
  }

  function canton() { return D.canton ? D.canton() : undefined; }
  /** { p: 1 présent, 0.5 demi-journée, 0 sinon ; absence ; chome : motif du jour chômé } */
  function presence(m, jour) {
    var ch = C.chome(jour, canton()), a = ch ? null : Calc.absenceLe(m, jour);
    return { p: ch || a ? 0 : (Calc.poidsJour(m, jour) || 0), absence: a, chome: ch };
  }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function jj(iso) { var d = C.dt(iso); return deux(d.getDate()) + "." + deux(d.getMonth() + 1); }

  /* ---------- Le bandeau ---------- */
  function arbre() {
    var hote = $("#arbre"), l = D.membres();
    hote.textContent = "";
    function entree(cle, nom, n, niv) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "entree niv" + niv;
      b.setAttribute("aria-current", String(filtre === cle));
      b.innerHTML = '<span class="nom"></span><span class="n"></span>';
      b.querySelector(".nom").textContent = nom; b.querySelector(".n").textContent = n;
      b.addEventListener("click", function () {
        filtre = cle;
        try { sessionStorage.setItem("planif2." + nomCle + ".filtre", cle); } catch (e) {}
        arbre(); surChange();
        if (innerWidth <= 700) replie(true);
      });
      hote.appendChild(b);
    }
    entree("tous", "Tous", l.length, 0);
    var admins = l.filter(estAdmin);
    if (admins.length) entree("admin", "Administrateurs", admins.length, 0);

    var codes = Object.keys(D.SUCCURSALES);
    if (l.some(function (m) { return !m.succursale; })) codes.push("_");
    var ordreDisc = Object.keys(D.DISCIPLINES), titreFait = false;
    codes.forEach(function (s) {
      var dela = l.filter(function (m) { return (m.succursale || "_") === s; });
      if (!dela.length) return;
      if (!titreFait) { var t = document.createElement("p"); t.className = "titre-groupe"; t.textContent = "Succursales"; hote.appendChild(t); titreFait = true; }
      entree("s:" + s, s === "_" ? "Sans succursale" : D.SUCCURSALES[s], dela.length, 0);
      var discs = [];
      dela.forEach(function (m) { if (!estAdmin(m) && discs.indexOf(m.discipline || "_") < 0) discs.push(m.discipline || "_"); });
      discs.sort(function (a, b) {
        var ia = ordreDisc.indexOf(a), ib = ordreDisc.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      discs.forEach(function (d) {
        var n = dela.filter(function (m) { return !estAdmin(m) && (m.discipline || "_") === d; }).length;
        entree("d:" + s + "|" + d, d === "_" ? "Secteur non renseigné" : D.DISCIPLINES[d], n, 1);
      });
    });
  }

  /* ---------- Repli (choix gardé sur l'appareil, commun aux modules) ---------- */
  function replie(oui) {
    var page = $("#page"), btn = $("#replier");
    page.classList.toggle("replie", oui);
    btn.textContent = oui ? "›" : "‹";
    btn.title = oui ? "Afficher le bandeau" : "Réduire le bandeau";
    btn.setAttribute("aria-expanded", String(!oui));
    try { localStorage.setItem("planif2.equipes.replie", oui ? "1" : ""); } catch (e) {}
  }

  function monte(o) {
    nomCle = o.nom || nomCle;
    surChange = o.surChange || surChange;
    var garde = null;
    try { garde = localStorage.getItem("planif2.equipes.replie"); } catch (e) {}
    replie(garde === null ? innerWidth <= 700 : garde === "1");
    $("#replier").addEventListener("click", function () { replie(!$("#page").classList.contains("replie")); });
    var q = $("#q");
    q.addEventListener("input", function () { surChange(); });
    q.addEventListener("keydown", function (e) { if (e.key === "Escape") { q.value = ""; surChange(); } });
  }
  /** Après le chargement des données : reprend le filtre de l'onglet et dessine le bandeau. */
  function pret() {
    try { var f = sessionStorage.getItem("planif2." + nomCle + ".filtre"); if (f) filtre = f; } catch (e) {}
    if (filtre !== "tous" && !D.membres().some(dansFiltre)) filtre = "tous";
    arbre();
  }

  global.Equipes = {
    monte: monte, pret: pret, arbre: arbre, membres: membres, titre: titre,
    fonction: fonction, lieu: lieu, avatar: avatar, qui: qui, presence: presence, jj: jj
  };
})(window);
