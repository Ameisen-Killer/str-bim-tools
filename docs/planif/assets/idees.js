/* Boîte à idées de l'accueil (03.11.2026, demande de Tony après la
   présentation du planificateur)
   ---------------------------------------------------------------------------
   Chacun propose une idée ou une remarque, avec des captures d'écran
   (fichier choisi, collé avec Ctrl+V ou glissé dans la fenêtre). Le nom de
   l'auteur est celui du compte connecté : la base le pose elle-même
   (garde_idee, base-supabase.sql), l'écran ne fait que l'annoncer.
   Seuls les administrateurs du site (super admin, Donnees.niveauAcces() 3)
   lisent les idées, de tous les bureaux, changent leur état et les
   suppriment : règles RLS de la table idees et du seau « idees ».

   Hors base, et pour le compte de démonstration (partagé, public), les idées
   restent dans ce navigateur, comme les messages du tchat.

   Idees.monte(hote, identite) : remplit l'encadré de l'accueil.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var D = global.Donnees, SB = global.Sb, P = global.Portail, el = P.el;
  var MAX_CAPTURES = 6, MAX_TEXTE = 4000, SEAU = "idees";
  var CLE_LOCAL = "planif.idees.local:";
  var ETATS = [["nouvelle", "Nouvelle"], ["lue", "Lue"], ["retenue", "Pris en compte"], ["faite", "Réalisée"], ["ecartee", "Rejeté"]];
  var A_TRAITER = { nouvelle: 1, lue: 1, retenue: 1 };

  var hote = null, identite = {}, baseOk = true, idees = [], filtre = "traiter";

  /* ------------------------------------------------------------ où écrire */

  function email() { return SB && SB.connecte && SB.connecte() ? SB.email() : ""; }
  function compteDemo() { return /^demo@/i.test(email()); }
  /** Idées dans la base : connecté à un bureau réel, hors compte de démonstration. */
  function enBase() {
    var p = D && D.profil ? D.profil() : null;
    return !!(SB && SB.configure && SB.connecte() && p && p.multi) && !compteDemo();
  }
  function peutLire() { return D.niveauAcces() === 3; }
  function bureauId() { var p = D.profil(); return p && p.bureau ? p.bureau.id : ""; }

  function cleLocale() { return CLE_LOCAL + (email() || "local"); }
  function litLocal() {
    var l = null;
    try { l = JSON.parse(global.localStorage.getItem(cleLocale()) || "null"); } catch (e) { l = null; }
    return Array.isArray(l) ? l : [];
  }
  function ecritLocal(l) {
    try { global.localStorage.setItem(cleLocale(), JSON.stringify(l)); return true; }
    catch (e) { return false; }      // navigation privée, ou plus de place pour les captures
  }

  function nouvelId() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    var o = new Uint8Array(16);
    (global.crypto || {}).getRandomValues ? crypto.getRandomValues(o) : o.forEach(function (_, i) { o[i] = Math.random() * 256; });
    o[6] = (o[6] & 15) | 64; o[8] = (o[8] & 63) | 128;
    var h = [].map.call(o, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function nomAuteur() { return [identite.prenom, identite.nom].filter(Boolean).join(" "); }

  /* ------------------------------------------------------------ stockage */

  function cheminUrl(chemin) { return chemin.split("/").map(encodeURIComponent).join("/"); }

  function appelStockage(chemin, options) {
    options = options || {};
    var pr = SB.projet();
    return SB.jeton().then(function (t) {
      var entetes = { apikey: pr.cle, Authorization: "Bearer " + t };
      if (options.type) entetes["Content-Type"] = options.type;
      return fetch(pr.url + "/storage/v1/object/" + chemin, {
        method: options.methode || "GET", headers: entetes, body: options.corps
      }).catch(function () { throw new Error("Réseau indisponible : réessaie dans un instant."); });
    }).then(function (r) {
      if (r.ok) return r;
      return r.text().then(function (txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { j = null; }
        var m = (j && (j.message || j.error)) || ("Erreur " + r.status);
        if (/bucket not found/i.test(m)) m = "Le stockage des captures n'est pas encore créé (migration de la boîte à idées).";
        else if (/row-level security|unauthorized|403/i.test(m)) m = "Dépôt de la capture refusé par la base.";
        throw new Error(m);
      });
    });
  }

  function envoieCapture(chemin, dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
      return appelStockage(SEAU + "/" + cheminUrl(chemin), { methode: "POST", corps: blob, type: "image/jpeg" });
    });
  }

  var images = {};                       // chemin → URL locale de l'image lue
  function image(chemin) {
    if (/^data:/.test(chemin)) return Promise.resolve(chemin);
    if (images[chemin]) return Promise.resolve(images[chemin]);
    return appelStockage("authenticated/" + SEAU + "/" + cheminUrl(chemin))
      .then(function (r) { return r.blob(); })
      .then(function (b) { return (images[chemin] = URL.createObjectURL(b)); });
  }

  /* ------------------------------------------------------------ données */

  function depuisBase(x) {
    return { id: String(x.id), auteurNom: String(x.auteur_nom || x.auteur_email || "—"), texte: String(x.texte || ""),
             bureauNom: String(x.bureau_nom || ""), captures: x.captures || [], statut: x.statut || "nouvelle", creeLe: String(x.cree_le || "") };
  }

  function charge() {
    if (!enBase()) { idees = litLocal(); return Promise.resolve(idees); }
    return SB.requete("idees?select=id,auteur_nom,auteur_email,bureau_nom,texte,captures,statut,cree_le&order=cree_le.desc&limit=500")
      .then(function (l) { idees = (l || []).map(depuisBase); return idees; });
  }

  /** La table existe-t-elle ? (la RLS rend une liste vide à qui n'a pas le droit) */
  function sonde() {
    if (!enBase()) return Promise.resolve(true);
    return SB.requete("idees?select=id&limit=1").then(function () { return true; }, function (e) {
      return !(e && /PGRST205|42P01/.test(e.code || "")) && !/idees/.test(e && e.message || "");
    });
  }

  function enregistre(texte, captures) {
    var id = nouvelId();
    if (!enBase()) {
      var l = litLocal();
      l.unshift({ id: id, auteurNom: nomAuteur() || "Moi", texte: texte, captures: captures, statut: "nouvelle", creeLe: new Date().toISOString() });
      if (!ecritLocal(l)) return Promise.reject(new Error("Ce navigateur n'a plus de place pour ces captures : retire-en une ou deux."));
      return Promise.resolve();
    }
    var b = bureauId(), chemins = captures.map(function (_, i) { return b + "/" + id + "/" + (i + 1) + ".jpg"; });
    var suite = Promise.resolve();
    chemins.forEach(function (c, i) { suite = suite.then(function () { return envoieCapture(c, captures[i]); }); });
    return suite.then(function () {
      return SB.requete("idees", { methode: "POST", prefer: "return=minimal", corps: { id: id, texte: texte, captures: chemins } });
    });
  }

  function changeEtat(idee, statut) {
    if (!enBase()) {
      var l = litLocal();
      l.forEach(function (x) { if (x.id === idee.id) x.statut = statut; });
      ecritLocal(l);
      idee.statut = statut;
      return Promise.resolve();
    }
    return SB.requete("idees?id=eq." + encodeURIComponent(idee.id), { methode: "PATCH", prefer: "return=minimal", corps: { statut: statut } })
      .then(function () { idee.statut = statut; });
  }

  function supprime(idee) {
    if (!enBase()) {
      ecritLocal(litLocal().filter(function (x) { return x.id !== idee.id; }));
      return Promise.resolve();
    }
    var fichiers = idee.captures.length
      ? appelStockage(SEAU, { methode: "DELETE", type: "application/json", corps: JSON.stringify({ prefixes: idee.captures }) }).catch(function () {})
      : Promise.resolve();
    return fichiers.then(function () {
      return SB.requete("idees?id=eq." + encodeURIComponent(idee.id), { methode: "DELETE", prefer: "return=minimal" });
    });
  }

  /* ------------------------------------------------------------ images */

  /** Capture réduite (largeur max), en JPEG data URL : légère à envoyer et à garder. */
  function reduit(fichier, largeur, qualite) {
    return new Promise(function (ok, ko) {
      var lecteur = new FileReader();
      lecteur.onerror = function () { ko(new Error("Image illisible.")); };
      lecteur.onload = function () {
        var img = new Image();
        img.onerror = function () { ko(new Error("Ce fichier n'est pas une image lisible.")); };
        img.onload = function () {
          var r = Math.min(1, largeur / img.width), w = Math.round(img.width * r), h = Math.round(img.height * r);
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          var g = c.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
          g.drawImage(img, 0, 0, w, h);
          ok(c.toDataURL("image/jpeg", qualite));
        };
        img.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }

  /* ------------------------------------------------------------ fenêtres */

  var ICONE = '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>';

  function fenetre(titre, sous, classe) {
    var avant = document.activeElement;
    var fermer = el("button", { type: "button", class: "ab-fen-fermer", "aria-label": "Fermer", text: "×" });
    var corps = el("div", { class: "ab-id-corps" });
    var boite = el("div", { class: "ab-fen ab-fen-large " + (classe || ""), role: "dialog", "aria-modal": "true", "aria-labelledby": "ab-id-titre" }, [
      fermer,
      el("h2", { id: "ab-id-titre", class: "ab-fen-titre ab-id-titre" }, [P.svg("0 0 24 24", ICONE), titre]),
      sous ? el("p", { class: "ab-id-sous", text: sous }) : null,
      corps
    ]);
    var voile = el("div", { class: "ab-voile" }, [boite]);
    var surFerme = null;
    function ferme() {
      document.removeEventListener("keydown", touche);
      voile.remove();
      if (surFerme) surFerme();
      if (avant && avant.focus) avant.focus();
    }
    function touche(e) { if (e.key === "Escape" && !document.querySelector(".ab-visionneuse")) ferme(); }
    fermer.addEventListener("click", ferme);
    voile.addEventListener("mousedown", function (e) { if (e.target === voile) ferme(); });
    document.addEventListener("keydown", touche);
    document.body.appendChild(voile);
    return { boite: boite, corps: corps, ferme: ferme, quandFerme: function (f) { surFerme = f; } };
  }

  /** L'image en grand, par-dessus tout ; un clic ou Échap la ferme. */
  function visionneuse(src) {
    var v = el("div", { class: "ab-visionneuse", role: "dialog", "aria-label": "Capture d'écran" }, [
      el("img", { src: src, alt: "Capture d'écran" })
    ]);
    function ferme() { document.removeEventListener("keydown", touche, true); v.remove(); }
    function touche(e) { if (e.key === "Escape") { e.stopPropagation(); ferme(); } }
    v.addEventListener("click", ferme);
    document.addEventListener("keydown", touche, true);
    document.body.appendChild(v);
  }

  /* ------------------------------------------------------------ proposer */

  function proposer() {
    var demo = !enBase();
    var f = fenetre("Proposer une idée", nomAuteur() ? "De la part de " + nomAuteur() : "", "ab-id-proposer");
    var captures = [];                           // data URL réduites
    var zone = el("textarea", { class: "ab-id-texte", maxlength: String(MAX_TEXTE), rows: "6",
      placeholder: "Ton idée, ta remarque, ce qui coince ou ce qui manque… Dis aussi sur quelle page, si c'est utile.",
      "aria-label": "Ton idée" });
    var compteur = el("span", { class: "ab-id-compteur" });
    var vignettes = el("div", { class: "ab-id-vignettes" });
    var choix = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
    var depot = el("div", { class: "ab-id-depot" }, [
      el("button", { type: "button", class: "ab-id-btn", text: "Ajouter des captures", onclick: function () { choix.click(); } }),
      el("span", { text: "ou colle-les ici (Ctrl+V), ou glisse-les dans la fenêtre — " + MAX_CAPTURES + " au plus" }),
      choix
    ]);
    var erreur = el("p", { class: "ab-id-erreur", role: "alert", hidden: true });
    var envoyer = el("button", { type: "button", class: "ab-id-btn principal", text: "Envoyer" });
    var annuler = el("button", { type: "button", class: "ab-id-btn", text: "Annuler", onclick: function () { f.ferme(); } });

    [zone, el("div", { class: "ab-id-ligne" }, [
        el("span", { class: "ab-id-note", text: demo
          ? (compteDemo() || D.enDemo() ? "Démo : ton idée reste dans ce navigateur, personne d'autre ne la voit." : "Mode local : ton idée reste dans ce navigateur.")
          : "Seuls les administrateurs du site la liront." }),
        compteur
      ]),
      el("h3", { class: "ab-id-inter", text: "Captures d'écran" }),
      depot, vignettes, erreur,
      el("div", { class: "ab-id-pied" }, [annuler, envoyer])
    ].forEach(function (n) { f.corps.appendChild(n); });

    function etat() {
      var n = zone.value.trim().length;
      compteur.textContent = zone.value.length > MAX_TEXTE - 400 ? zone.value.length + " / " + MAX_TEXTE : "";
      envoyer.disabled = !n;
      depot.classList.toggle("plein", captures.length >= MAX_CAPTURES);
    }
    function dit(m) { erreur.textContent = m || ""; erreur.hidden = !m; }

    function dessineVignettes() {
      P.vide(vignettes);
      captures.forEach(function (src, i) {
        vignettes.appendChild(el("div", { class: "ab-id-vignette" }, [
          el("img", { src: src, alt: "Capture " + (i + 1), onclick: function () { visionneuse(src); } }),
          el("button", { type: "button", class: "ab-id-retire", "aria-label": "Retirer la capture " + (i + 1), text: "×",
            onclick: function () { captures.splice(i, 1); dessineVignettes(); etat(); } })
        ]));
      });
    }

    function ajoute(fichiers) {
      var l = [].filter.call(fichiers || [], function (x) { return /^image\//.test(x.type); });
      if (!l.length) return;
      dit("");
      var place = MAX_CAPTURES - captures.length;
      if (l.length > place) dit("Pas plus de " + MAX_CAPTURES + " captures par idée.");
      var suite = Promise.resolve();
      l.slice(0, Math.max(0, place)).forEach(function (x) {
        suite = suite.then(function () {
          return reduit(x, demo ? 1280 : 1920, demo ? 0.72 : 0.85).then(function (src) {
            if (captures.length < MAX_CAPTURES) captures.push(src);
            dessineVignettes(); etat();
          });
        });
      });
      suite.catch(function (e) { dit(e.message); });
    }

    choix.addEventListener("change", function () { ajoute(choix.files); choix.value = ""; });
    function colle(e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var fichiers = [].map.call(items, function (it) { return it.kind === "file" ? it.getAsFile() : null; }).filter(Boolean);
      if (fichiers.length) { e.preventDefault(); ajoute(fichiers); }
    }
    document.addEventListener("paste", colle);
    f.boite.addEventListener("dragover", function (e) { e.preventDefault(); f.boite.classList.add("survol"); });
    f.boite.addEventListener("dragleave", function (e) { if (e.target === f.boite) f.boite.classList.remove("survol"); });
    f.boite.addEventListener("drop", function (e) {
      e.preventDefault(); f.boite.classList.remove("survol");
      ajoute(e.dataTransfer && e.dataTransfer.files);
    });
    f.quandFerme(function () { document.removeEventListener("paste", colle); });
    zone.addEventListener("input", etat);

    envoyer.addEventListener("click", function () {
      var texte = zone.value.trim();
      if (!texte || envoyer.disabled) return;
      envoyer.disabled = true; annuler.disabled = true;
      envoyer.textContent = captures.length ? "Envoi des captures…" : "Envoi…";
      dit("");
      enregistre(texte, captures.slice()).then(function () {
        merci(f, demo);
        actualise();
      }).catch(function (e) {
        envoyer.disabled = false; annuler.disabled = false; envoyer.textContent = "Envoyer";
        dit(e.message || "Envoi impossible.");
      });
    });

    etat();
    setTimeout(function () { zone.focus(); }, 60);
  }

  /* Après l'envoi, la fenêtre dit merci (03.11.2026, demande de Tony) */
  function merci(f, demo) {
    var sous = f.boite.querySelector(".ab-id-sous");
    if (sous) sous.remove();
    var ok = el("button", { type: "button", class: "ab-id-btn principal", text: "Fermer", onclick: function () { f.ferme(); } });
    P.vide(f.corps).appendChild(el("div", { class: "ab-id-merci" }, [
      el("p", { class: "ab-id-merci-titre", text: "Merci !" }),
      el("p", { text: demo ? "Ton idée est enregistrée dans ce navigateur (démo) : personne d'autre ne la voit."
                           : "Ton idée a bien été transmise aux administrateurs du site." }),
      ok
    ]));
    setTimeout(function () { ok.focus(); }, 30);
  }

  /* ------------------------------------------------------------ lire */

  function quand(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) + " à " +
           d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  }

  function lire() {
    var f = fenetre("Boîte à idées / Problèmes", "", "ab-id-lire");
    var filtres = el("div", { class: "ab-id-filtres", role: "group", "aria-label": "Filtre" });
    var liste = el("div", { class: "ab-id-liste", "aria-live": "polite" });
    f.corps.appendChild(filtres);
    f.corps.appendChild(liste);
    f.quandFerme(actualise);

    function boutonsFiltre() {
      P.vide(filtres);
      var nT = idees.filter(function (x) { return A_TRAITER[x.statut]; }).length;
      [["traiter", "À traiter", nT], ["toutes", "Toutes", idees.length]].forEach(function (b) {
        filtres.appendChild(el("button", { type: "button", class: "ab-id-filtre" + (filtre === b[0] ? " actif" : ""),
          "aria-pressed": filtre === b[0] ? "true" : "false", text: b[1] + " · " + b[2],
          onclick: function () { filtre = b[0]; dessine(); } }));
      });
    }

    function dessine() {
      boutonsFiltre();
      P.vide(liste);
      var l = idees.filter(function (x) { return filtre === "toutes" || A_TRAITER[x.statut]; });
      if (!l.length) {
        liste.appendChild(el("p", { class: "ab-vide", text: idees.length ? "Rien à traiter : tout est réalisé ou écarté." : "Aucune idée pour l'instant." }));
        return;
      }
      l.forEach(function (x) { liste.appendChild(carte(x)); });
    }

    function carte(x) {
      var select = el("select", { class: "ab-id-etat " + x.statut, "aria-label": "État de l'idée" },
        ETATS.map(function (e) { var o = el("option", { value: e[0], text: e[1] }); if (e[0] === x.statut) o.selected = true; return o; }));
      select.addEventListener("change", function () {
        var avant = x.statut, v = select.value;
        select.disabled = true;
        changeEtat(x, v).then(function () {
          select.className = "ab-id-etat " + v;
        }).catch(function (e) { select.value = avant; annonce(e.message); })
          .then(function () { select.disabled = false; boutonsFiltre(); });
      });
      var suppr = el("button", { type: "button", class: "ab-id-suppr", text: "Supprimer" });
      suppr.addEventListener("click", function () {
        if (!suppr.classList.contains("confirme")) {
          suppr.classList.add("confirme"); suppr.textContent = "Confirmer la suppression";
          setTimeout(function () { suppr.classList.remove("confirme"); suppr.textContent = "Supprimer"; }, 4000);
          return;
        }
        suppr.disabled = true;
        supprime(x).then(function () {
          idees = idees.filter(function (y) { return y.id !== x.id; });
          dessine();
        }).catch(function (e) { suppr.disabled = false; annonce(e.message); });
      });
      function bouton(v, texte, genre) {
        var b = el("button", { type: "button", class: "ab-id-rep " + genre + (x.statut === v ? " actif" : ""),
          "aria-pressed": x.statut === v ? "true" : "false", text: texte });
        b.addEventListener("click", function () {
          if (x.statut === v) return;
          b.disabled = true;
          changeEtat(x, v).then(dessine).catch(function (e) { b.disabled = false; annonce(e.message); });
        });
        return b;
      }
      var vign = el("div", { class: "ab-id-vignettes" });
      x.captures.forEach(function (c, i) {
        var img = el("img", { alt: "Capture " + (i + 1), class: "charge" });
        var bloc = el("button", { type: "button", class: "ab-id-vignette", "aria-label": "Voir la capture " + (i + 1) }, [img]);
        image(c).then(function (src) {
          img.src = src; img.classList.remove("charge");
          bloc.addEventListener("click", function () { visionneuse(src); });
        }).catch(function () { img.replaceWith(el("span", { class: "ab-id-manque", text: "Capture illisible" })); });
        vign.appendChild(bloc);
      });
      return el("article", { class: "ab-id-idee" }, [
        el("div", { class: "ab-id-tete" }, [
          el("div", {}, [el("b", { text: x.auteurNom }),
            x.bureauNom ? el("span", { class: "ab-id-date", text: x.bureauNom }) : null,
            el("span", { class: "ab-id-date", text: quand(x.creeLe) })]),
          select
        ]),
        el("p", { class: "ab-id-texte-lu", text: x.texte }),
        x.captures.length ? vign : null,
        el("div", { class: "ab-id-actions" }, [
          // Les deux réponses courantes en un clic (05.11.2026, demande de Tony)
          bouton("retenue", "Pris en compte", "ok"), bouton("ecartee", "Rejeté", "non"), suppr])
      ]);
    }

    liste.appendChild(el("p", { class: "ab-vide", text: "Chargement…" }));
    charge().then(dessine).catch(function (e) {
      P.vide(liste);
      liste.appendChild(el("p", { class: "ab-id-erreur", text: e.message || "Lecture impossible." }));
    });
  }

  /* ------------------------------------------------------------ encadré */

  var boiteAnnonce = null, minuterie = 0;
  function annonce(texte) {
    if (!boiteAnnonce) { boiteAnnonce = el("div", { class: "ab-annonce", role: "status" }); document.body.appendChild(boiteAnnonce); }
    boiteAnnonce.textContent = texte;
    boiteAnnonce.classList.add("vu");
    clearTimeout(minuterie);
    minuterie = setTimeout(function () { boiteAnnonce.classList.remove("vu"); }, 4500);
  }

  function actualise() {
    if (!hote) return;
    var actions = P.vide(hote.querySelector(".ab-id-boutons"));
    if (!baseOk) {
      actions.appendChild(el("span", { class: "ab-id-note", text: "Base à mettre à jour : migration de la boîte à idées à lancer." }));
      return;
    }
    actions.appendChild(el("button", { type: "button", class: "ab-id-btn principal", onclick: proposer }, [
      P.svg("0 0 24 24", '<path d="M12 5v14M5 12h14"/>'), "Proposer une idée"
    ]));
    if (!peutLire()) return;
    var lireB = el("button", { type: "button", class: "ab-id-btn", onclick: lire }, ["Lire les idées"]);
    actions.appendChild(lireB);
    charge().then(function () {
      var n = idees.filter(function (x) { return x.statut === "nouvelle"; }).length;
      if (n) lireB.appendChild(el("span", { class: "ab-id-badge", text: n + (n > 1 ? " nouvelles" : " nouvelle") }));
    }).catch(function () {});
  }

  function monte(noeud, id) {
    hote = noeud;
    identite = id || {};
    if (!hote) return;
    var p = hote.querySelector(".ab-id-texte-intro");
    if (p && peutLire()) p.textContent = "Une idée, une remarque, quelque chose qui coince ? Écris-le, ajoute des captures d'écran. En administrateur du site, tu les lis toutes.";
    sonde().then(function (ok) { baseOk = ok; actualise(); });
  }

  global.Idees = { monte: monte };
})(window);
