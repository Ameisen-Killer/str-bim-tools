/* News du bureau (13.10.2026) — module Communication
   ---------------------------------------------------------------------------
   Des articles mis en forme (titres, gras, listes, liens, couleurs, images…)
   en tête de Communication, à la place qu'occupait le tchat (passé dans une
   fenêtre volante). Table « news » de la base (base-supabase.sql), lue et
   écrite directement, hors de la file d'écritures de donnees.js.

   Droits du tableau des groupes (console) :
     news_rediger   créer une news, modifier les siennes (le super admin : toutes)
     news_archiver  archiver une news ou la remettre en ligne
     news_supprimer supprimer une news
   La base applique les mêmes règles (RLS et déclencheur garde_news).

   Le contenu est du HTML. Il est nettoyé par une liste blanche de balises et
   d'attributs (nettoie) à l'écriture ET à l'affichage : une news ne peut
   porter ni script, ni gestionnaire d'événement, ni lien javascript:.

   Le compte de démonstration, partagé et public, n'écrit jamais dans la base
   (la RLS le refuse aussi) : en démo et en mode local, les news restent dans
   ce navigateur, avec une news d'exemple au départ.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var D = global.Donnees, SB = global.Sb;
  var LIMITE = 100, MAX = 3000000, RELECTURE = 60000, APERCU = 420;
  var CLE_LOCAL = "planif.news.local:", CLE_BROUILLON = "planif.news.brouillon:";
  var CHAMPS = "id,titre,contenu,auteur_id,cree_le,maj_le,archive_le,archive_par";

  function email() { return SB && SB.connecte && SB.connecte() ? SB.email() : ""; }
  function compteDemo() { return /^demo@/i.test(email()); }
  function enBase() {
    var p = D && D.profil ? D.profil() : null;
    return !!(SB && SB.configure && SB.connecte() && p && p.multi) && !compteDemo();
  }
  function monId() {
    var moi = D && D.monMembre ? D.monMembre() : null;
    return moi ? moi.id : (enBase() ? "" : "local");
  }
  function lit(cle) { try { return global.localStorage.getItem(cle); } catch (e) { return null; } }
  function ecrit(cle, v) { try { global.localStorage.setItem(cle, v); } catch (e) { /* navigation privée, quota */ } }
  function oublie(cle) { try { global.localStorage.removeItem(cle); } catch (e) {} }
  function nouvelId() { return "l-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

  function depuisBase(x) {
    return {
      id: String(x.id), titre: String(x.titre || ""), contenu: String(x.contenu || ""),
      auteurId: x.auteur_id ? String(x.auteur_id) : "", creeLe: String(x.cree_le || ""),
      majLe: String(x.maj_le || x.cree_le || ""), archiveLe: x.archive_le ? String(x.archive_le) : "",
      archivePar: x.archive_par ? String(x.archive_par) : ""
    };
  }
  function recentesDabord(a, b) { return a.creeLe < b.creeLe ? 1 : a.creeLe > b.creeLe ? -1 : 0; }

  /* --------------------------------------------------------------- droits */

  function profilSuper() { var p = D && D.profil ? D.profil() : null; return !!(p && p.superAdmin); }
  function peutRediger() { return D.aDroit("news_rediger"); }
  function peutModifier(n) {
    if (profilSuper() || !enBase()) return peutRediger() || profilSuper();
    return D.aDroit("news_rediger") && !!n.auteurId && n.auteurId === monId();
  }
  function peutArchiver() { return D.aDroit("news_archiver"); }
  function peutSupprimer() { return D.aDroit("news_supprimer"); }

  /* ------------------------------------------------------------ nettoyage
     Liste blanche : ce que la barre d'outils sait produire, rien d'autre.
     Les balises inconnues sont remplacées par leur contenu ; script, style,
     iframe, objets… disparaissent avec le leur. */
  var BALISES = {
    P: [], BR: [], DIV: [], SPAN: [], B: [], STRONG: [], I: [], EM: [], U: [], S: [], STRIKE: [], DEL: [],
    H2: [], H3: [], H4: [], UL: [], OL: [], LI: [], BLOCKQUOTE: [], HR: [], SUB: [], SUP: [],
    A: ["href"], IMG: ["src", "alt"], FONT: ["color"]
  };
  var DETRUITES = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, MATH: 1, TEMPLATE: 1, NOSCRIPT: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1 };
  var COULEUR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;
  var ALIGNE = /^(left|center|right|justify|start|end)$/i;

  function styleSur(noeud) {
    var garde = [];
    var st = noeud.style;
    if (!st) return "";
    var c = st.color, f = st.backgroundColor, a = st.textAlign, m = st.marginLeft;
    if (c && COULEUR.test(c.trim())) garde.push("color:" + c.trim());
    if (f && COULEUR.test(f.trim()) && !/^(transparent|initial|inherit)$/i.test(f.trim())) garde.push("background-color:" + f.trim());
    if (a && ALIGNE.test(a.trim()) && /^(P|DIV|H2|H3|H4|LI|BLOCKQUOTE)$/.test(noeud.nodeName)) garde.push("text-align:" + a.trim());
    if (m && /^\d{1,3}px$/.test(m.trim()) && /^(P|DIV|BLOCKQUOTE)$/.test(noeud.nodeName)) garde.push("margin-left:" + m.trim());
    return garde.join(";");
  }

  function lienSur(href) {
    href = String(href || "").trim();
    if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
    if (/^www\./i.test(href)) return "https://" + href;
    return "";
  }
  function imageSure(src) {
    src = String(src || "").trim();
    return /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+\/=\s]+$/i.test(src) || /^https:\/\//i.test(src) ? src : "";
  }

  function nettoieNoeud(source, cible, doc) {
    [].forEach.call(source.childNodes, function (n) {
      if (n.nodeType === 3) { cible.appendChild(doc.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      var nom = n.nodeName.toUpperCase();
      if (DETRUITES[nom]) return;
      if (!BALISES.hasOwnProperty(nom)) { nettoieNoeud(n, cible, doc); return; }
      // <font color> (anciens navigateurs) devient un <span style="color">
      var sortie = doc.createElement(nom === "FONT" ? "span" : nom.toLowerCase());
      if (nom === "A") {
        var h = lienSur(n.getAttribute("href"));
        if (!h) { nettoieNoeud(n, cible, doc); return; }
        sortie.setAttribute("href", h);
        sortie.setAttribute("target", "_blank");
        sortie.setAttribute("rel", "noopener noreferrer");
      } else if (nom === "IMG") {
        var src = imageSure(n.getAttribute("src"));
        if (!src) return;
        sortie.setAttribute("src", src);
        sortie.setAttribute("alt", String(n.getAttribute("alt") || "").slice(0, 200));
      } else if (nom === "FONT") {
        var col = String(n.getAttribute("color") || "").trim();
        if (COULEUR.test(col)) sortie.setAttribute("style", "color:" + col);
      }
      var style = nom === "FONT" ? "" : styleSur(n);
      if (style) sortie.setAttribute("style", style);
      cible.appendChild(sortie);
      nettoieNoeud(n, sortie, doc);
    });
  }

  /** HTML sûr, d'après la liste blanche. */
  function nettoie(html) {
    var doc = document.implementation.createHTMLDocument("");
    var tmp = new DOMParser().parseFromString("<body>" + String(html || "") + "</body>", "text/html");
    var boite = doc.createElement("div");
    nettoieNoeud(tmp.body, boite, doc);
    // Paragraphes vides en fin de texte : retirés
    while (boite.lastChild && boite.lastChild.nodeType === 1 && /^(P|DIV|BR)$/.test(boite.lastChild.nodeName) && !boite.lastChild.textContent.trim() && !boite.lastChild.querySelector("img")) {
      boite.removeChild(boite.lastChild);
    }
    return boite.innerHTML;
  }
  function texteSeul(html) {
    var d = new DOMParser().parseFromString("<body>" + nettoie(html) + "</body>", "text/html");
    return (d.body.textContent || "").replace(/\s+/g, " ").trim();
  }

  /* --------------------------------------------------------------- local */

  function cleLocale() { return CLE_LOCAL + (email() || "local"); }
  function litLocal() {
    var l = null;
    try { l = JSON.parse(lit(cleLocale()) || "null"); } catch (e) { l = null; }
    if (!Array.isArray(l)) { l = exemples(); ecritLocal(l); }
    return l;
  }
  function ecritLocal(l) { ecrit(cleLocale(), JSON.stringify(l)); }
  function exemples() {
    if (!D || !D.enDemo || !D.enDemo()) return [];
    var moi = monId(), gens = D.membres({}).filter(function (m) { return m.id !== moi; });
    var auteur = gens[0] ? gens[0].id : "";
    var hier = new Date(Date.now() - 86400000).toISOString();
    return [{
      id: "ex-news-1", titre: "Bienvenue sur les news du bureau", auteurId: auteur, creeLe: hier, majLe: hier, archiveLe: "", archivePar: "",
      contenu: "<p>Cet espace remplace les notes punaisées au mur : <b>nouvelles du bureau</b>, rappels, arrivées dans l'équipe, sorties…</p>" +
        "<h3>Ce qu'on y trouve</h3><ul><li>Les <b>nouveaux projets</b> et les affaires gagnées</li><li>Les <i>rappels pratiques</i> (fermetures, horaires d'été)</li>" +
        "<li>Les événements : apéro, sortie d'équipe, formation</li></ul><blockquote>Une news se rédige avec la mise en forme complète : titres, couleurs, listes, liens et images.</blockquote>"
    }];
  }

  /* --------------------------------------------------------------- données */

  var liste = [];

  function charge() {
    if (!enBase()) {
      liste = litLocal().slice().sort(recentesDabord);
      return Promise.resolve(liste);
    }
    return SB.requete("news?select=" + CHAMPS + "&order=cree_le.desc&limit=" + LIMITE).then(function (r) {
      liste = (r || []).map(depuisBase).sort(recentesDabord);
      return liste;
    });
  }

  function valide(o) {
    var titre = String(o.titre || "").replace(/\s+/g, " ").trim();
    var contenu = nettoie(o.contenu);
    if (!titre) throw new Error("Donne un titre à la news.");
    if (titre.length > 200) throw new Error("Titre trop long (200 caractères au plus).");
    if (!texteSeul(contenu) && !/<img/i.test(contenu)) throw new Error("La news est vide : écris quelques lignes.");
    if (contenu.length > MAX) throw new Error("News trop lourde : allège ou retire une image.");
    return { titre: titre, contenu: contenu };
  }

  function cree(o) {
    return Promise.resolve().then(function () {
      var v = valide(o), maintenant = new Date().toISOString();
      if (!enBase()) {
        var n = { id: nouvelId(), titre: v.titre, contenu: v.contenu, auteurId: monId(), creeLe: maintenant, majLe: maintenant, archiveLe: "", archivePar: "" };
        var l = litLocal(); l.push(n); ecritLocal(l);
        return charge().then(function () { return n; });
      }
      if (!monId()) throw new Error("Ton accès n'est rattaché à aucune fiche de l'équipe : demande-le à l'administrateur.");
      return SB.requete("news", { methode: "POST", prefer: "return=representation", corps: v })
        .then(function (r) { return charge().then(function () { return depuisBase((r && r[0]) || {}); }); });
    });
  }

  function modifie(id, changements) {
    return Promise.resolve().then(function () {
      var corps = {};
      if (changements.titre !== undefined || changements.contenu !== undefined) {
        var v = valide(changements);
        corps.titre = v.titre; corps.contenu = v.contenu;
      }
      if (changements.archive !== undefined) corps.archive_le = changements.archive ? new Date().toISOString() : null;
      if (!enBase()) {
        var l = litLocal();
        l.forEach(function (n) {
          if (n.id !== id) return;
          if (corps.titre !== undefined) { n.titre = corps.titre; n.contenu = corps.contenu; n.majLe = new Date().toISOString(); }
          if (corps.archive_le !== undefined) { n.archiveLe = corps.archive_le || ""; n.archivePar = corps.archive_le ? monId() : ""; }
        });
        ecritLocal(l);
        return charge();
      }
      return SB.requete("news?id=eq." + encodeURIComponent(id), { methode: "PATCH", prefer: "return=representation", corps: corps })
        .then(function (r) {
          if (!r || !r.length) throw new Error("Modification refusée : vérifie tes droits sur les news.");
          return charge();
        });
    });
  }

  function supprime(id) {
    if (!enBase()) {
      ecritLocal(litLocal().filter(function (n) { return n.id !== id; }));
      return charge();
    }
    return SB.requete("news?id=eq." + encodeURIComponent(id), { methode: "DELETE", prefer: "return=representation" })
      .then(function (r) {
        if (Array.isArray(r) && !r.length) throw new Error("Suppression refusée : il faut le droit « Supprimer les news ».");
        return charge();
      });
  }

  /* --------------------------------------------------------------- dates */

  var MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function quand(iso) {
    if (!iso) return "";
    var d = new Date(iso), a = new Date();
    var jour = d.getDate() + " " + MOIS[d.getMonth()] + (d.getFullYear() !== a.getFullYear() ? " " + d.getFullYear() : "");
    if (d.toDateString() === a.toDateString()) jour = "aujourd'hui";
    else if (d.toDateString() === new Date(a.getTime() - 86400000).toDateString()) jour = "hier";
    return jour + " à " + deux(d.getHours()) + ":" + deux(d.getMinutes());
  }
  function nomDe(id) { var m = id && D ? D.membre(id) : null; return m ? m.prenom + " " + m.nom : (id === "local" ? "Moi" : "Ancien membre"); }
  function initiales(id) { var m = id && D ? D.membre(id) : null; return m ? (m.prenom.charAt(0) + m.nom.charAt(0)).toUpperCase() : "·"; }

  /* ============================================================ affichage */

  var etat = { archives: false, ouvertes: {} }, hoteCourant = null, relectureLancee = false;

  /** Monte la section dans hote (la carte « News du bureau » de Communication). */
  function monte(hote) {
    hoteCourant = hote;
    dessine();
    charge().then(dessine).catch(function (e) { erreur(e); });
    if (!relectureLancee) {
      relectureLancee = true;
      setInterval(function () {
        if (document.hidden || document.querySelector(".modale.ouverte")) return;
        relis();
      }, RELECTURE);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) relis(); });
    }
  }
  function relis() {
    var avant = JSON.stringify(liste.map(function (n) { return n.id + n.majLe + n.archiveLe; }));
    charge().then(function () {
      if (JSON.stringify(liste.map(function (n) { return n.id + n.majLe + n.archiveLe; })) !== avant) dessine();
    }).catch(function () {});
  }
  function erreur(e) {
    if (!hoteCourant) return;
    var UI = global.UI;
    UI.vide(hoteCourant.querySelector(".nw-liste") || hoteCourant).appendChild(UI.el("p", { class: "vide", text: e && e.message ? e.message : "Lecture des news impossible." }));
  }

  function dessine() {
    var hote = hoteCourant;
    if (!hote) return;
    var UI = global.UI, el = UI.el;
    var enLigne = liste.filter(function (n) { return !n.archiveLe; });
    var archivees = liste.filter(function (n) { return n.archiveLe; });
    if (etat.archives && !archivees.length) etat.archives = false;
    var montrees = etat.archives ? archivees : enLigne;

    UI.vide(hote);
    var outils = el("div", { class: "outils" }, [
      archivees.length || etat.archives ? el("button", { type: "button", class: "btn btn-nu nw-bascule", "aria-pressed": etat.archives ? "true" : "false",
        text: etat.archives ? "← News en ligne" : "Archives (" + archivees.length + ")",
        onclick: function () { etat.archives = !etat.archives; dessine(); } }) : null,
      peutRediger() ? el("button", { type: "button", class: "btn btn-or", onclick: function () { editeur(null); } }, [
        el("span", { class: "ico-txt ico-rediger", "aria-hidden": "true" }), "Rédiger une news"
      ]) : null
    ]);
    hote.appendChild(el("div", { class: "tete-section" }, [
      el("h2", { text: etat.archives ? "News archivées" : "News du bureau" }), outils
    ]));
    var l = el("div", { class: "nw-liste" });
    if (!montrees.length) {
      l.appendChild(el("p", { class: "nw-vide", text: etat.archives ? "Aucune news archivée."
        : peutRediger() ? "Aucune news pour l'instant. « Rédiger une news » publie la première." : "Aucune news pour l'instant." }));
    }
    montrees.forEach(function (n) { l.appendChild(carte(n)); });
    hote.appendChild(l);
    if (!enBase() && (compteDemo() || (D.enDemo && D.enDemo()))) {
      hote.appendChild(el("p", { class: "nw-aide", text: "Démo : les news que tu rédiges restent dans ce navigateur, personne d'autre ne les voit." }));
    }
  }

  function carte(n) {
    var UI = global.UI, el = UI.el;
    var contenu = el("div", { class: "nw-contenu" });
    contenu.innerHTML = nettoie(n.contenu);           // HTML passé par la liste blanche
    var longue = texteSeul(n.contenu).length > APERCU || contenu.querySelectorAll("img").length > 0 || contenu.children.length > 5;
    var ouverte = !!etat.ouvertes[n.id];
    if (longue && !ouverte) contenu.classList.add("replie");
    var modifiee = n.majLe && n.creeLe && (new Date(n.majLe) - new Date(n.creeLe)) > 60000;
    var actions = el("div", { class: "nw-actions" }, [
      peutModifier(n) ? UI.boutonIcone("modifier", "Modifier", n.titre, function () { editeur(n); }) : null,
      peutArchiver() ? el("button", { type: "button", class: "btn btn-nu nw-archiver", text: n.archiveLe ? "Remettre en ligne" : "Archiver",
        onclick: function () {
          var b = this; b.disabled = true;
          modifie(n.id, { archive: !n.archiveLe }).then(function () {
            UI.toast(n.archiveLe ? "News remise en ligne." : "News archivée.");
            dessine();
          }).catch(function (e) { b.disabled = false; UI.toast(e.message); });
        } }) : null,
      peutSupprimer() ? UI.boutonIcone("supprimer", "Supprimer", n.titre, function () {
        UI.confirme("Supprimer cette news ?", "« " + n.titre + " » disparaîtra pour tout le bureau, archives comprises.", "Supprimer", true).then(function (ok) {
          if (!ok) return;
          supprime(n.id).then(function () { UI.toast("News supprimée."); dessine(); }).catch(function (e) { UI.toast(e.message); });
        });
      }) : null
    ]);
    return el("article", { class: "nw-carte" + (n.archiveLe ? " archivee" : ""), dataset: { id: n.id } }, [
      el("div", { class: "nw-tete" }, [
        el("span", { class: "nw-init", "aria-hidden": "true", text: initiales(n.auteurId) }),
        el("div", { class: "nw-qui" }, [
          el("h3", { class: "nw-titre", text: n.titre }),
          el("div", { class: "nw-meta", text: nomDe(n.auteurId) + " · " + quand(n.creeLe) +
            (modifiee ? " · modifiée " + quand(n.majLe) : "") +
            (n.archiveLe ? " · archivée " + quand(n.archiveLe) + (n.archivePar ? " par " + nomDe(n.archivePar) : "") : "") })
        ]),
        actions
      ]),
      contenu,
      longue ? el("button", { type: "button", class: "btn btn-nu nw-suite", text: ouverte ? "Réduire" : "Lire la suite",
        onclick: function () { etat.ouvertes[n.id] = !etat.ouvertes[n.id]; dessine(); } }) : null
    ]);
  }

  /* ============================================================ rédaction
     Fenêtre de rédaction : le titre, puis une zone de texte riche
     (contenteditable) et sa barre d'outils. Les commandes passent par
     document.execCommand, en style CSS (couleurs en <span style>). Le
     brouillon d'une news neuve est gardé dans le navigateur à chaque frappe :
     une fenêtre fermée par mégarde ne perd rien. */

  var COULEURS_TEXTE = [
    { v: "#1E2226", n: "Noir" }, { v: "#6B7075", n: "Gris" }, { v: "#B3261E", n: "Rouge" }, { v: "#C25E00", n: "Orange" },
    { v: "#2E7D32", n: "Vert" }, { v: "#1565C0", n: "Bleu" }, { v: "#6A1B9A", n: "Violet" }, { v: "#7A5A2B", n: "Brun" }
  ];
  var SURLIGNAGES = [
    { v: "#FFF3A3", n: "Jaune" }, { v: "#D5E8AC", n: "Vert" }, { v: "#CFE3F7", n: "Bleu" }, { v: "#F9D3D0", n: "Rose" }, { v: "#EDE7F6", n: "Lilas" }
  ];

  function editeur(n) {
    var UI = global.UI, el = UI.el;
    var cleBrouillon = CLE_BROUILLON + (email() || "local");
    var brouillon = null;
    if (!n) { try { brouillon = JSON.parse(lit(cleBrouillon) || "null"); } catch (e) { brouillon = null; } }

    var inTitre = el("input", { type: "text", class: "nw-champ-titre", maxlength: "200", placeholder: "Titre de la news", "aria-label": "Titre de la news" });
    inTitre.value = n ? n.titre : (brouillon && brouillon.titre) || "";
    var zone = el("div", { class: "nw-editeur", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Texte de la news", spellcheck: "true" });
    zone.innerHTML = nettoie(n ? n.contenu : (brouillon && brouillon.contenu) || "<p><br></p>");
    if (!zone.innerHTML) zone.innerHTML = "<p><br></p>";

    // La sélection de la zone, gardée quand un bouton ou un menu prend le focus
    var plage = null;
    function garde() {
      var s = global.getSelection();
      if (s && s.rangeCount && zone.contains(s.anchorNode)) plage = s.getRangeAt(0).cloneRange();
    }
    function rend() {
      zone.focus();
      if (plage) { var s = global.getSelection(); s.removeAllRanges(); s.addRange(plage); }
    }
    function cmd(nom, valeur) {
      rend();
      try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
      document.execCommand(nom, false, valeur == null ? null : valeur);
      garde(); etatBoutons(); sauveBrouillon();
    }
    document.addEventListener("selectionchange", function surSel() {
      if (!document.body.contains(zone)) { document.removeEventListener("selectionchange", surSel); return; }
      var s = global.getSelection();
      if (s && s.rangeCount && zone.contains(s.anchorNode)) { plage = s.getRangeAt(0).cloneRange(); etatBoutons(); }
    });

    function bouton(titre, contenu, action, etatCmd) {
      var b = el("button", { type: "button", class: "nw-outil", title: titre, "aria-label": titre,
        onmousedown: function (e) { e.preventDefault(); },
        onclick: action }, Array.isArray(contenu) ? contenu : [contenu]);
      if (etatCmd) b.dataset.etat = etatCmd;
      return b;
    }
    function sep() { return el("span", { class: "nw-sep", "aria-hidden": "true" }); }

    // Style de paragraphe
    var selBloc = el("select", { class: "nw-bloc", "aria-label": "Style du paragraphe", title: "Style du paragraphe" }, [
      el("option", { value: "p", text: "Texte" }),
      el("option", { value: "h2", text: "Titre" }),
      el("option", { value: "h3", text: "Sous-titre" }),
      el("option", { value: "h4", text: "Petit titre" }),
      el("option", { value: "blockquote", text: "Citation" })
    ]);
    selBloc.addEventListener("mousedown", garde);
    selBloc.addEventListener("change", function () { cmd("formatBlock", "<" + selBloc.value + ">"); });

    // Palettes de couleurs (texte, surlignage)
    function palette(titre, icone, couleurs, commande, aucune) {
      var menu = el("div", { class: "nw-palette", hidden: true, role: "menu", "aria-label": titre },
        couleurs.map(function (c) {
          return el("button", { type: "button", class: "nw-pastille", title: c.n, "aria-label": c.n, style: "background:" + c.v,
            onmousedown: function (e) { e.preventDefault(); },
            onclick: function () { menu.hidden = true; cmd(commande, c.v); } });
        }).concat([el("button", { type: "button", class: "nw-pastille aucune", title: aucune, "aria-label": aucune, text: "✕",
          onmousedown: function (e) { e.preventDefault(); },
          onclick: function () { menu.hidden = true; cmd(commande, commande === "foreColor" ? "#1E2226" : "transparent"); } })]));
      var b = bouton(titre, icone, function () {
        [].forEach.call(barre.querySelectorAll(".nw-palette"), function (p) { if (p !== menu) p.hidden = true; });
        menu.hidden = !menu.hidden;
      });
      return el("span", { class: "nw-groupe-pal" }, [b, menu]);
    }

    // Lien : petite ligne de saisie sous la barre, plutôt qu'une boîte du navigateur
    var inLien = el("input", { type: "url", class: "nw-lien-champ", placeholder: "https://… ou adresse@exemple.ch", "aria-label": "Adresse du lien" });
    var ligneLien = el("div", { class: "nw-ligne-lien", hidden: true }, [
      inLien,
      el("button", { type: "button", class: "btn btn-or", text: "Poser le lien", onclick: poseLien }),
      el("button", { type: "button", class: "btn btn-nu", text: "Annuler", onclick: function () { ligneLien.hidden = true; rend(); } })
    ]);
    inLien.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); poseLien(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ligneLien.hidden = true; rend(); }
    });
    function poseLien() {
      var v = inLien.value.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) v = "mailto:" + v;
      v = lienSur(v);
      if (!v) { UI.toast("Adresse de lien invalide (http, https, mailto)."); return; }
      ligneLien.hidden = true;
      rend();
      var s = global.getSelection();
      if (!s || !s.rangeCount || s.isCollapsed) {
        // Rien de sélectionné : l'adresse devient le texte du lien
        var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
        document.execCommand("insertHTML", false, '<a href="' + esc(v) + '">' + esc(inLien.value.trim()) + "</a>&nbsp;");
        garde(); sauveBrouillon();
        return;
      }
      cmd("createLink", v);
    }

    // Image : choisie, réduite à 1400 px de large, en JPEG
    var inImage = el("input", { type: "file", accept: "image/*", style: "display:none" });
    inImage.addEventListener("change", function () {
      var f = inImage.files && inImage.files[0];
      inImage.value = "";
      if (!f) return;
      if (!/^image\//.test(f.type)) { UI.toast("Ce fichier n'est pas une image."); return; }
      reduitImage(f, 1400).then(function (url) { cmd("insertImage", url); })
        .catch(function () { UI.toast("Image illisible."); });
    });

    var barre = el("div", { class: "nw-barre", role: "toolbar", "aria-label": "Mise en forme" }, [
      selBloc, sep(),
      bouton("Gras (Ctrl+B)", el("b", { text: "G" }), function () { cmd("bold"); }, "bold"),
      bouton("Italique (Ctrl+I)", el("i", { text: "I" }), function () { cmd("italic"); }, "italic"),
      bouton("Souligné (Ctrl+U)", el("u", { text: "S" }), function () { cmd("underline"); }, "underline"),
      bouton("Barré", el("s", { text: "ab" }), function () { cmd("strikeThrough"); }, "strikeThrough"),
      bouton("Exposant", ["x", el("sup", { text: "2" })], function () { cmd("superscript"); }, "superscript"),
      sep(),
      palette("Couleur du texte", el("span", { class: "nw-a-couleur", text: "A" }), COULEURS_TEXTE, "foreColor", "Couleur normale"),
      palette("Surligner", el("span", { class: "nw-surligne", text: "ab" }), SURLIGNAGES, "hiliteColor", "Sans surlignage"),
      sep(),
      bouton("Liste à puces", "•≡", function () { cmd("insertUnorderedList"); }, "insertUnorderedList"),
      bouton("Liste numérotée", "1.≡", function () { cmd("insertOrderedList"); }, "insertOrderedList"),
      bouton("Réduire le retrait", "⇤", function () { cmd("outdent"); }),
      bouton("Augmenter le retrait", "⇥", function () { cmd("indent"); }),
      sep(),
      bouton("Aligner à gauche", el("span", { class: "nw-al g" }), function () { cmd("justifyLeft"); }, "justifyLeft"),
      bouton("Centrer", el("span", { class: "nw-al c" }), function () { cmd("justifyCenter"); }, "justifyCenter"),
      bouton("Aligner à droite", el("span", { class: "nw-al d" }), function () { cmd("justifyRight"); }, "justifyRight"),
      bouton("Justifier", el("span", { class: "nw-al j" }), function () { cmd("justifyFull"); }, "justifyFull"),
      sep(),
      bouton("Lien", "🔗", function () {
        garde();
        var s = global.getSelection(), a = s && s.anchorNode && s.anchorNode.parentElement && s.anchorNode.parentElement.closest("a");
        inLien.value = a && zone.contains(a) ? a.getAttribute("href").replace(/^mailto:/, "") : "";
        ligneLien.hidden = false; inLien.focus();
      }),
      bouton("Retirer le lien", el("span", { class: "nw-delier", text: "🔗" }), function () { cmd("unlink"); }),
      bouton("Image", "🖼", function () { garde(); inImage.click(); }),
      bouton("Ligne de séparation", "―", function () { cmd("insertHorizontalRule"); }),
      sep(),
      bouton("Effacer la mise en forme", "T̸", function () { cmd("removeFormat"); cmd("formatBlock", "<p>"); }),
      bouton("Annuler (Ctrl+Z)", "↶", function () { cmd("undo"); }),
      bouton("Rétablir (Ctrl+Y)", "↷", function () { cmd("redo"); })
    ]);

    function etatBoutons() {
      [].forEach.call(barre.querySelectorAll("[data-etat]"), function (b) {
        var actif = false;
        try { actif = document.queryCommandState(b.dataset.etat); } catch (e) {}
        b.classList.toggle("actif", !!actif);
        b.setAttribute("aria-pressed", actif ? "true" : "false");
      });
      var bloc = "";
      try { bloc = String(document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, ""); } catch (e) {}
      selBloc.value = /^(h2|h3|h4|blockquote)$/.test(bloc) ? bloc : "p";
    }

    // Coller : seulement ce que la liste blanche accepte (pas de styles de Word)
    zone.addEventListener("paste", function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var fichier = [].filter.call(cd.files || [], function (f) { return /^image\//.test(f.type); })[0];
      if (fichier) {
        e.preventDefault();
        reduitImage(fichier, 1400).then(function (url) { cmd("insertImage", url); }).catch(function () {});
        return;
      }
      var html = cd.getData("text/html");
      if (html) { e.preventDefault(); document.execCommand("insertHTML", false, nettoie(html)); }
    });
    zone.addEventListener("keydown", function (e) {
      // Entrée dans la zone ne déclenche jamais l'enregistrement ; Ctrl+Entrée, oui
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); publier.click(); }
      e.stopPropagation();
    });
    zone.addEventListener("input", function () { garde(); sauveBrouillon(); });
    inTitre.addEventListener("input", sauveBrouillon);
    inTitre.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); zone.focus(); } });

    var compte = el("span", { class: "nw-compte" });
    var minuterieBrouillon = null;
    function sauveBrouillon() {
      clearTimeout(minuterieBrouillon);
      minuterieBrouillon = setTimeout(function () {
        var mots = texteSeul(zone.innerHTML).split(" ").filter(Boolean).length;
        compte.textContent = mots + (mots > 1 ? " mots" : " mot") + (n ? "" : " · brouillon gardé dans ce navigateur");
        if (!n) ecrit(cleBrouillon, JSON.stringify({ titre: inTitre.value, contenu: zone.innerHTML }));
      }, 400);
    }

    var corps = el("div", { class: "nw-redaction" }, [
      inTitre,
      el("div", { class: "nw-cadre" }, [barre, ligneLien, zone]),
      el("div", { class: "nw-pied-edition" }, [compte, el("span", { class: "nw-astuce", text: "Ctrl+B gras · Ctrl+I italique · Ctrl+Entrée publie" })]),
      inImage
    ]);

    var publier = null;
    var boite = UI.ouvre({
      surtitre: n ? "Modifier la news" : "Nouvelle news",
      titre: n ? n.titre : "Rédiger une news",
      corps: corps,
      boutons: [
        n ? null : { label: "Vider", gauche: true, action: function () {
          inTitre.value = ""; zone.innerHTML = "<p><br></p>"; oublie(cleBrouillon); compte.textContent = ""; inTitre.focus(); return false;
        } },
        { label: "Annuler" },
        { label: n ? "Enregistrer" : "Publier", or: true, action: function () {
          var o = { titre: inTitre.value, contenu: zone.innerHTML };
          return (n ? modifie(n.id, o) : cree(o)).then(function () {
            if (!n) oublie(cleBrouillon);
            etat.archives = n ? etat.archives : false;
            dessine();
            UI.toast(n ? "News enregistrée." : "News publiée.");
          }).catch(function (e) { UI.toast(e.message); return false; });
        } }
      ]
    });
    boite.classList.add("nw-fenetre");
    var boutons = boite.querySelectorAll(".modale-pied .btn");
    publier = boutons[boutons.length - 1];
    sauveBrouillon();
    setTimeout(function () { if (n || inTitre.value) { zone.focus(); placeFin(zone); } else inTitre.focus(); etatBoutons(); }, 80);
  }

  function placeFin(zone) {
    var s = global.getSelection(), r = document.createRange();
    r.selectNodeContents(zone); r.collapse(false);
    s.removeAllRanges(); s.addRange(r);
  }

  /** Image réduite (largeur max), en JPEG data URL — une news reste légère. */
  function reduitImage(fichier, largeur) {
    return new Promise(function (ok, ko) {
      var lecteur = new FileReader();
      lecteur.onerror = ko;
      lecteur.onload = function () {
        var img = new Image();
        img.onerror = ko;
        img.onload = function () {
          var r = Math.min(1, largeur / img.width), w = Math.round(img.width * r), h = Math.round(img.height * r);
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          var g = c.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
          g.drawImage(img, 0, 0, w, h);
          ok(c.toDataURL("image/jpeg", 0.85));
        };
        img.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }

  global.News = {
    monte: monte,
    nettoie: nettoie,
    redige: function () { if (peutRediger()) editeur(null); }
  };
})(window);
