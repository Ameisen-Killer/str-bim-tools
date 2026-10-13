/* Mandat, avancement et facturation (13.10.2026)
   ---------------------------------------------------------------------------
   Commun à la page Affaires (fiche de l'affaire, saisie), à la page Tâches
   (saisie de l'affaire filtrée) et à la page Facturation d'Inter-secteurs.
     Mandat.editeur(mandat)       les phases SIA du mandat et leurs disciplines,
                                  pour la fiche de l'affaire ; Mandat.litEditeur
                                  rend l'objet { "31": ["structure"], … }
     Mandat.saisie(id, opts)      fenêtre de saisie de l'avancement et de la
                                  facturation (%), phase par phase, discipline
                                  par discipline, avec l'historique
     Mandat.jauge(v, genre, opts) une jauge horizontale (avancement ou facturation)
   Les droits : Donnees (peutSaisirAvancement, peutSaisirFacturation,
   voitFacturation) ; la base applique les mêmes (peut_saisir_mandat).
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";
  var D = global.Donnees, UI = global.UI, C = global.Cal, el = UI.el;

  function pct(v) { return v == null ? "—" : v + " %"; }
  function nomDisc(c) { return D.DISCIPLINES[c] || c; }

  /** Une jauge. opts : alerte (facturé au-delà de l'avancement), court (libellé
   *  devant la barre, false pour aucun), titre (bulle). */
  function jauge(valeur, genre, opts) {
    opts = opts || {};
    var v = valeur == null ? 0 : Math.max(0, Math.min(100, valeur));
    var lib = opts.court === false ? null : (opts.court || (genre === "avancement" ? "Avancement" : "Facturé"));
    return el("div", {
      class: "mj mj-" + genre + (opts.alerte ? " alerte" : "") + (valeur == null ? " vide" : ""),
      role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(v),
      "aria-label": (genre === "avancement" ? "Avancement" : "Facturé") + " " + pct(valeur), title: opts.titre || null
    }, [
      lib ? el("span", { class: "mj-lib", text: lib }) : null,
      el("span", { class: "mj-piste" }, [el("span", { class: "mj-rempli", style: "width:" + v + "%" })]),
      el("span", { class: "mj-val", text: pct(valeur) })
    ]);
  }
  function majJauge(j, valeur, alerte) {
    var v = Math.max(0, Math.min(100, valeur || 0));
    j.querySelector(".mj-rempli").style.width = v + "%";
    j.querySelector(".mj-val").textContent = pct(v);
    j.setAttribute("aria-valuenow", String(v));
    j.classList.toggle("alerte", !!alerte);
    j.classList.remove("vide");
  }

  /** « 12.10.2026 à 14:05 · Camille Berger » */
  function quand(x) {
    var d = new Date(x.le);
    var h = isNaN(d) ? "" : " à " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    var jour = isNaN(d) ? "" : C.fmtCH(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
    return jour + h + (x.par ? " · " + D.nomMembre(x.par) : "");
  }

  /* ------------------------------------------------------------ éditeur */

  /** Administrateurs, Administration : des secteurs du bureau, pas des disciplines d'un mandat. */
  function administrative(c) {
    function plie(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
    return /^admin/.test(plie(c)) || /^admin/.test(plie(D.DISCIPLINES[c]));
  }

  /** Une ligne par phase SIA ; les disciplines du bureau en cases, par leur sigle. */
  function editeur(mandat) {
    var m = mandat || {};
    // Les disciplines techniques seules : pas de case pour l'administration (13.10.2026, demande de Tony)
    var codes = Object.keys(D.DISCIPLINES).filter(function (c) { return !administrative(c); });
    var phases = D.PHASES_MANDAT.concat(Object.keys(m).filter(function (p) { return D.PHASES_MANDAT.indexOf(p) < 0; })).sort();
    var boite = el("div", { class: "mj-editeur" });
    phases.forEach(function (p) {
      var choisis = m[p] || [];
      var ligne = el("div", { class: "mj-ed-ligne" + (choisis.length ? " pris" : "") });
      ligne.appendChild(el("div", { class: "mj-ed-phase" }, [el("b", { text: p }), el("span", { text: D.PHASES[p] || "" })]));
      var cases = el("div", { class: "mj-ed-disc" });
      codes.concat(choisis.filter(function (c) { return codes.indexOf(c) < 0; })).forEach(function (c) {
        var input = el("input", { type: "checkbox", value: c, "aria-label": "Phase " + p + " — " + nomDisc(c) });
        input.setAttribute("data-phase", p);
        input.checked = choisis.indexOf(c) >= 0;
        input.addEventListener("change", function () { ligne.classList.toggle("pris", !!ligne.querySelector("input:checked")); });
        cases.appendChild(el("label", { class: "case mj-case", title: nomDisc(c) }, [input, D.sigleDiscipline(c)]));
      });
      ligne.appendChild(cases);
      boite.appendChild(ligne);
    });
    // Les sigles en clair : sur téléphone, pas de bulle au survol
    boite.appendChild(el("p", { class: "aide mj-sigles" }, codes.map(function (c, i) {
      return el("span", {}, [el("b", { text: D.sigleDiscipline(c) }), " " + nomDisc(c) + (i < codes.length - 1 ? " · " : "")]);
    })));
    return boite;
  }
  function litEditeur(boite) {
    var out = {};
    [].forEach.call(boite.querySelectorAll("input[data-phase]:checked"), function (i) {
      var p = i.getAttribute("data-phase");
      (out[p] || (out[p] = [])).push(i.value);
    });
    return out;
  }

  /* ------------------------------------------------------------ saisie */

  /** opts : discipline (mise en avant), surEnregistrement (après une saisie). */
  function saisie(idAffaire, opts) {
    opts = opts || {};
    var a = D.affaire(idAffaire);
    if (!a) return;
    var phases = D.phasesMandat(a);
    var voitFact = D.voitFacturation();
    var corps = el("div", { class: "mj-saisie" });
    var titre = { surtitre: voitFact ? "Avancement et facturation" : "Avancement du mandat", titre: D.libelleAffaire(a) };

    /* En bas à gauche, vers le détail de l'affaire (13.10.2026, demande de Tony) :
       sa fiche dans la page Affaires — opts.detail l'ouvre sur place quand on y
       est déjà —, ou ses tâches pour qui n'a pas la page Affaires. */
    function boutonDetail() {
      if (opts.detail) return { label: "Détail de l'affaire", gauche: true, action: function () { setTimeout(opts.detail, 0); } };
      var vers = D.pagePermise && !D.pagePermise("affaires")
        ? { label: "Tâches de l'affaire", href: "/planif/taches/?affaire=" + encodeURIComponent(a.id) + "&membre=" }
        : { label: "Détail de l'affaire", href: "/planif/affaires/?q=" + encodeURIComponent(a.code || a.nom) + "&affaire=" + encodeURIComponent(a.id) };
      return { label: vers.label, gauche: true, action: function () { location.href = vers.href; return false; } };
    }

    if (!phases.length) {
      corps.appendChild(el("p", { class: "vide", text: "Aucune phase au mandat de cette affaire. Les phases SIA et leurs disciplines se cochent dans la fiche de l'affaire (page Affaires, « Modifier »)." }));
      UI.ouvre({ surtitre: titre.surtitre, titre: titre.titre, corps: corps, compacte: true, boutons: [boutonDetail(), { label: "Fermer" }] });
      return;
    }

    var champs = [];
    corps.appendChild(el("p", { class: "aide mj-intro", text: voitFact
      ? "Pourcentages par phase et par discipline. Chaque saisie est gardée dans l'historique ; la moyenne des disciplines donne celle de la phase."
      : "Avancement (%) par phase et par discipline. Chaque saisie est gardée dans l'historique." }));

    phases.forEach(function (p) {
      var bloc = el("section", { class: "mj-phase" });
      var moyAv = jauge(D.valeurPhase(a, p.phase, "avancement"), "avancement", { court: "Av." });
      var moyFa = voitFact ? jauge(D.valeurPhase(a, p.phase, "facturation"), "facturation", { court: "Fact." }) : null;
      bloc.appendChild(el("div", { class: "mj-phase-tete" }, [
        el("div", { class: "mj-phase-nom" }, [el("b", { text: p.phase }), el("span", { text: D.PHASES[p.phase] || "" })]),
        el("div", { class: "mj-phase-moy" }, [moyAv, moyFa])
      ]));
      var lignes = [];
      p.disciplines.forEach(function (d) {
        var cells = {};
        function cellule(genre) {
          var x = D.saisieMandat(a.id, p.phase, d, genre);
          var peut = genre === "facturation" ? D.peutSaisirFacturation() : D.peutSaisirAvancement(a, d);
          var input = el("input", { type: "number", min: "0", max: "100", step: "1", inputmode: "numeric", class: "mj-input",
            "aria-label": (genre === "avancement" ? "Avancement " : "Facturé ") + p.phase + " " + nomDisc(d) + " (%)",
            disabled: !peut, title: peut ? null : (genre === "facturation" ? "Demande le droit « Saisir la facturation »" :
              "Le responsable de l'affaire ou le chef du secteur saisit cet avancement") });
          input.value = x ? x.valeur : 0;
          var j = jauge(x ? x.valeur : 0, genre, { court: false });
          var c = { input: input, jauge: j, phase: p.phase, discipline: d, genre: genre, avant: x ? x.valeur : 0 };
          cells[genre] = c;
          champs.push(c);
          input.addEventListener("input", function () { recalcule(); });
          return el("div", { class: "mj-cell mj-cell-" + genre }, [
            el("div", { class: "mj-cell-l" }, [input, el("span", { class: "mj-pc", text: "%" }), j]),
            el("div", { class: "mj-meta", text: x ? quand(x) : "pas encore saisi" })
          ]);
        }
        var ligne = el("div", { class: "mj-ligne" + (opts.discipline === d ? " vise" : "") }, [
          el("div", { class: "mj-disc", title: nomDisc(d) }, [el("b", { text: D.sigleDiscipline(d) }), el("span", { text: nomDisc(d) })]),
          cellule("avancement"),
          voitFact ? cellule("facturation") : null
        ]);
        lignes.push(cells);
        bloc.appendChild(ligne);
      });
      function recalcule() {
        var sAv = 0, sFa = 0;
        lignes.forEach(function (cells) {
          var av = lu(cells.avancement), fa = cells.facturation ? lu(cells.facturation) : 0;
          sAv += av; sFa += fa;
          majJauge(cells.avancement.jauge, av);
          if (cells.facturation) majJauge(cells.facturation.jauge, fa, fa > av);
        });
        majJauge(moyAv, Math.round(sAv / lignes.length));
        if (moyFa) majJauge(moyFa, Math.round(sFa / lignes.length), sFa > sAv);
      }
      bloc.recalcule = recalcule;
      corps.appendChild(bloc);
      recalcule();
    });

    function lu(c) { var n = parseInt(c.input.value, 10); return isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }

    corps.appendChild(historique(a, voitFact));

    var peutQuelqueChose = champs.some(function (c) { return !c.input.disabled; });
    UI.ouvre({
      surtitre: titre.surtitre, titre: titre.titre, corps: corps,
      boutons: peutQuelqueChose ? [
        boutonDetail(),
        { label: "Annuler" },
        { label: "Enregistrer", or: true, entree: true, action: function () {
          var items = [], faux = null;
          champs.forEach(function (c) {
            if (c.input.disabled) return;
            var brut = String(c.input.value).trim(), n = Number(brut.replace(",", "."));
            if (brut === "" || !isFinite(n) || n < 0 || n > 100) { faux = faux || c; return; }
            if (Math.round(n) !== c.avant) items.push({ phase: c.phase, discipline: c.discipline, genre: c.genre, valeur: Math.round(n) });
          });
          if (faux) { faux.input.focus(); UI.toast("Un pourcentage va de 0 à 100."); return false; }
          if (!items.length) { UI.toast("Rien n'a changé."); return; }
          return D.saisitMandat(a.id, items).then(function (n) {
            UI.toast(n > 1 ? n + " pourcentages enregistrés." : "Pourcentage enregistré.");
            if (opts.surEnregistrement) opts.surEnregistrement();
          }).catch(function (e) { UI.toast(e.message); return false; });
        } }
      ] : [boutonDetail(), { label: "Fermer" }]
    });
  }

  /** L'historique des saisies de l'affaire : la plus récente d'abord, avec la valeur d'avant. */
  function historique(a, voitFact) {
    var toutes = D.historiqueMandat(a.id).filter(function (x) { return voitFact || x.genre === "avancement"; });
    var boite = el("details", { class: "mj-histo" });
    boite.appendChild(el("summary", { text: "Historique" + (toutes.length ? " (" + toutes.length + (toutes.length > 1 ? " saisies)" : " saisie)") : "") }));
    if (!toutes.length) {
      boite.appendChild(el("p", { class: "aide", text: "Aucune saisie pour l'instant." }));
      return boite;
    }
    // La valeur d'avant chaque saisie : la suivante dans la liste, pour la même case
    var avant = {};
    toutes.slice().reverse().forEach(function (x) {
      var k = x.phase + "|" + x.discipline + "|" + x.genre;
      x._avant = k in avant ? avant[k] : null;
      avant[k] = x.valeur;
    });
    var filtre = el("select", { class: "btn mj-histo-filtre", "aria-label": "Filtrer l'historique" }, [
      el("option", { value: "", text: "Toutes les saisies" }),
      el("option", { value: "avancement", text: "Avancement" }),
      voitFact ? el("option", { value: "facturation", text: "Facturation" }) : null
    ]);
    var liste = el("ol", { class: "mj-histo-liste" });
    function rend() {
      UI.vide(liste);
      toutes.filter(function (x) { return !filtre.value || x.genre === filtre.value; }).slice(0, 300).forEach(function (x) {
        liste.appendChild(el("li", { class: "mj-histo-" + x.genre }, [
          el("span", { class: "mj-histo-case" }, [el("b", { text: x.phase }), " " + D.sigleDiscipline(x.discipline)]),
          el("span", { class: "mj-histo-genre", text: x.genre === "avancement" ? "Avancement" : "Facturé" }),
          el("span", { class: "mj-histo-val" }, [x._avant != null ? el("span", { class: "is-faible", text: x._avant + " % → " }) : null, el("b", { text: x.valeur + " %" })]),
          el("span", { class: "mj-histo-qui", text: quand(x) })
        ]));
      });
    }
    filtre.addEventListener("change", rend);
    rend();
    boite.appendChild(el("div", { class: "mj-histo-outils" }, [filtre]));
    boite.appendChild(liste);
    return boite;
  }

  global.Mandat = { jauge: jauge, editeur: editeur, litEditeur: litEditeur, saisie: saisie };
})(window);
