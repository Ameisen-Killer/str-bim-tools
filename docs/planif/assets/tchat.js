/* Tchat du bureau (06.10.2026) — module Communication
   ---------------------------------------------------------------------------
   Une conversation par bureau : tout le bureau lit, chacun écrit en son nom,
   on retire ses propres messages (le super admin, tous). Table « messages »
   de la base (migration-tchat.sql), lue et écrite directement, hors de la
   file d'écritures de donnees.js : un message part tout de suite.

   En direct : direct.js relaie chaque message reçu par l'événement
   « planif:message » (sans relire toute la base). Tant que le canal ne suit
   pas la table, le tchat se relit toutes les 15 s, onglet visible.

   Le compte de démonstration, partagé et public, n'écrit jamais dans la base
   (la RLS le refuse aussi) : en démo et en mode local, les messages restent
   dans ce navigateur, avec quelques messages d'exemple au départ.

   Non lus : la date du dernier message vu est retenue par compte
   (localStorage « planif.tchat.lu:<email> ») ; Tchat.nonLus() compte les
   messages plus récents des autres, pour le badge de l'accueil.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var D = global.Donnees, SB = global.Sb;
  var LIMITE = 150, MAX = 2000, RELECTURE = 15000;
  var CLE_LU = "planif.tchat.lu:", CLE_LOCAL = "planif.tchat.local:";

  function email() { return SB && SB.connecte && SB.connecte() ? SB.email() : ""; }
  function compteDemo() { return /^demo@/i.test(email()); }
  /** Messages dans la base : connecté à un bureau réel, hors compte de démonstration. */
  function enBase() {
    var p = D && D.profil ? D.profil() : null;
    return !!(SB && SB.configure && SB.connecte() && p && p.multi) && !compteDemo();
  }
  /** Qui écrit : sa fiche d'équipe ; hors base sans fiche, « local ». */
  function monId() {
    var moi = D && D.monMembre ? D.monMembre() : null;
    return moi ? moi.id : (enBase() ? "" : "local");
  }
  function lit(cle) { try { return global.localStorage.getItem(cle); } catch (e) { return null; } }
  function ecrit(cle, v) { try { global.localStorage.setItem(cle, v); } catch (e) { /* navigation privée */ } }

  function depuisBase(x) {
    return { id: String(x.id), auteurId: x.auteur_id ? String(x.auteur_id) : "", texte: String(x.texte || ""), creeLe: String(x.cree_le || "") };
  }
  function parDate(a, b) { return a.creeLe < b.creeLe ? -1 : a.creeLe > b.creeLe ? 1 : 0; }
  function nouvelId() {
    return "l-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* --------------------------------------------------------------- local */

  function cleLocale() { return CLE_LOCAL + (email() || "local"); }
  function litLocal() {
    var l = null;
    try { l = JSON.parse(lit(cleLocale()) || "null"); } catch (e) { l = null; }
    if (!Array.isArray(l)) { l = exemples(); ecritLocal(l); }
    return l;
  }
  function ecritLocal(l) { ecrit(cleLocale(), JSON.stringify(l.slice(-LIMITE))); }

  /** Démo : trois messages de collègues fictifs, ce matin. */
  function exemples() {
    if (!D || !D.enDemo || !D.enDemo()) return [];
    var moi = monId(), gens = D.membres({}).filter(function (m) { return m.id !== moi; });
    if (gens.length < 2) return [];
    var j = new Date(); j.setHours(8, 0, 0, 0);
    function a(min) { return new Date(j.getTime() + min * 60000).toISOString(); }
    return [
      { id: "ex-1", auteurId: gens[0].id, texte: "Bonjour à tous ! Je passe au chantier ce matin, joignable sur mon portable.", creeLe: a(12) },
      { id: "ex-2", auteurId: gens[1].id, texte: "Bien reçu. Quelqu'un a les derniers plans d'armature du niveau 2 ?", creeLe: a(41) },
      { id: "ex-3", auteurId: gens[0].id, texte: "Ils sont sur le serveur, dossier Plans › Armature. Je les ai mis à jour hier soir.", creeLe: a(47) }
    ];
  }

  /* --------------------------------------------------------------- données */

  var liste = [], plusAnciens = false, manqueBase = false;

  /** Les derniers messages. Résout la liste, du plus ancien au plus récent. */
  function charge() {
    if (!enBase()) {
      liste = litLocal().slice().sort(parDate);
      plusAnciens = false;
      return Promise.resolve(liste);
    }
    return SB.requete("messages?select=id,auteur_id,texte,cree_le&order=cree_le.desc&limit=" + LIMITE).then(function (r) {
      manqueBase = false;
      var recents = (r || []).map(depuisBase).sort(parDate);
      // Les plus anciens déjà chargés restent ; la page récente remplace le reste
      var debut = recents.length ? recents[0].creeLe : "";
      var anciens = debut ? liste.filter(function (m) { return m.creeLe < debut; }) : [];
      liste = anciens.concat(recents);
      if (!anciens.length) plusAnciens = recents.length >= LIMITE;
      return liste;
    }, function (e) {
      // Table absente : migration-tchat.sql pas encore passée
      if (e && /^(PGRST205|42P01)$/.test(e.code || "")) { manqueBase = true; liste = []; return liste; }
      throw e;
    });
  }

  function chargeAnciens() {
    if (!enBase() || !liste.length) return Promise.resolve(0);
    var avant = encodeURIComponent(liste[0].creeLe);
    return SB.requete("messages?select=id,auteur_id,texte,cree_le&order=cree_le.desc&limit=" + LIMITE + "&cree_le=lt." + avant).then(function (r) {
      var l = (r || []).map(depuisBase).sort(parDate);
      liste = l.concat(liste);
      plusAnciens = l.length >= LIMITE;
      return l.length;
    });
  }

  function ajoute(m) {
    if (liste.some(function (x) { return x.id === m.id; })) return false;
    liste.push(m);
    liste.sort(parDate);
    return true;
  }
  function retire(id) {
    var n = liste.length;
    liste = liste.filter(function (x) { return x.id !== id; });
    return liste.length !== n;
  }

  function envoie(texte) {
    texte = String(texte || "").replace(/\s+$/, "").replace(/^\s*\n/, "");
    if (!texte.trim()) return Promise.reject(new Error("Écris d'abord ton message."));
    if (texte.length > MAX) return Promise.reject(new Error("Message trop long (" + MAX + " caractères au plus)."));
    var moi = monId();
    if (!enBase()) {
      var m = { id: nouvelId(), auteurId: moi, texte: texte, creeLe: new Date().toISOString() };
      ajoute(m);
      ecritLocal(liste);
      return Promise.resolve(m);
    }
    if (!moi) return Promise.reject(new Error("Ton accès n'est rattaché à aucune fiche de l'équipe : demande-le à l'administrateur."));
    return SB.requete("messages", { methode: "POST", prefer: "return=representation", corps: { texte: texte } }).then(function (r) {
      var m = depuisBase((r && r[0]) || {});
      if (m.id) ajoute(m);
      return m;
    });
  }

  function efface(id) {
    if (!enBase()) {
      retire(id);
      ecritLocal(liste);
      return Promise.resolve();
    }
    return SB.requete("messages?id=eq." + encodeURIComponent(id), { methode: "DELETE" }).then(function () { retire(id); });
  }

  function peutRetirer(m) {
    var moi = monId(), p = D.profil ? D.profil() : null;
    return !!(moi && m.auteurId === moi) || !!(p && p.superAdmin && enBase());
  }

  /* --------------------------------------------------------------- non lus */

  function dernierLu() { return lit(CLE_LU + (email() || "local")) || ""; }
  function marqueLu(quand) {
    if (quand && quand > dernierLu()) ecrit(CLE_LU + (email() || "local"), quand);
  }
  /** Messages des autres arrivés depuis la dernière visite du tchat (promesse d'un nombre). */
  function nonLus() {
    var lu = dernierLu(), moi = monId();
    if (!enBase()) {
      return Promise.resolve(litLocal().filter(function (m) {
        return m.creeLe > lu && m.auteurId !== moi && !/^ex-/.test(m.id);
      }).length);
    }
    var filtre = "messages?select=id" + (lu ? "&cree_le=gt." + encodeURIComponent(lu) : "") +
      (moi ? "&auteur_id=neq." + encodeURIComponent(moi) : "");
    return SB.requete(filtre, { avecTotal: true, plage: "0-0", prefer: "count=exact" }).then(function (r) {
      return r && r.total != null ? r.total : (r && r.lignes ? r.lignes.length : 0);
    }, function () { return 0; });
  }

  /* --------------------------------------------------------------- affichage */

  var JOURS_ABR = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  var MOIS_ABR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function jourLocal(iso) { var d = new Date(iso); return d.getFullYear() + "-" + deux(d.getMonth() + 1) + "-" + deux(d.getDate()); }
  function heure(iso) { var d = new Date(iso); return deux(d.getHours()) + ":" + deux(d.getMinutes()); }
  function libelleJour(iso) {
    var d = new Date(iso), a = new Date(), h = new Date(); h.setDate(h.getDate() - 1);
    if (jourLocal(iso) === jourLocal(a.toISOString())) return "Aujourd'hui";
    if (jourLocal(iso) === jourLocal(h.toISOString())) return "Hier";
    return JOURS_ABR[d.getDay()] + " " + d.getDate() + " " + MOIS_ABR[d.getMonth()] + (d.getFullYear() !== a.getFullYear() ? " " + d.getFullYear() : "");
  }
  function nomDe(id) { var m = id ? D.membre(id) : null; return m ? m.prenom + " " + m.nom : "Ancien membre"; }
  function initiales(id) { var m = id ? D.membre(id) : null; return m ? (m.prenom.charAt(0) + m.nom.charAt(0)).toUpperCase() : "?"; }

  /** Texte avec liens cliquables (http, https, www.), sans jamais passer par innerHTML. */
  function texteAvecLiens(el, texte) {
    var morceaux = [], re = /\b(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/gi, dernier = 0, m;
    while ((m = re.exec(texte))) {
      var url = m[0].replace(/[.,;:!?)\]]+$/, "");
      if (m.index > dernier) morceaux.push(document.createTextNode(texte.slice(dernier, m.index)));
      morceaux.push(el("a", { href: /^www\./i.test(url) ? "https://" + url : url, target: "_blank", rel: "noopener noreferrer", text: url }));
      dernier = m.index + url.length;
      re.lastIndex = dernier;
    }
    if (dernier < texte.length) morceaux.push(document.createTextNode(texte.slice(dernier)));
    return morceaux;
  }

  /** Monte le tchat dans hote (vide). opts.surNouveau(n) : messages arrivés hors de vue. */
  function monte(hote, opts) {
    opts = opts || {};
    var UI = global.UI, el = UI.el;
    var fil = el("div", { class: "tc-fil", role: "log", "aria-live": "polite", "aria-label": "Messages du tchat" });
    var nouveaux = el("button", { type: "button", class: "tc-nouveaux", hidden: true, text: "Nouveaux messages ↓",
      onclick: function () { enBas(true); } });
    var zone = el("textarea", { class: "tc-saisie", rows: "1", maxlength: String(MAX), placeholder: "Écris au bureau…", "aria-label": "Message" });
    var bouton = el("button", { type: "button", class: "btn btn-or tc-envoyer", text: "Envoyer" });
    var aide = el("p", { class: "tc-aide" });
    var alerte = el("div", { class: "tc-alerte", hidden: true });
    UI.vide(hote);
    hote.appendChild(alerte);
    hote.appendChild(el("div", { class: "tc-cadre" }, [fil, nouveaux]));
    hote.appendChild(el("div", { class: "tc-pied" }, [zone, bouton]));
    hote.appendChild(aide);

    function pres() { return fil.scrollHeight - fil.scrollTop - fil.clientHeight < 60; }
    function enBas(doux) {
      fil.scrollTo ? fil.scrollTo({ top: fil.scrollHeight, behavior: doux ? "smooth" : "auto" }) : (fil.scrollTop = fil.scrollHeight);
      nouveaux.hidden = true;
      vu();
    }
    function vu() {
      if (document.hidden || !liste.length || !pres()) return;
      marqueLu(liste[liste.length - 1].creeLe);
    }
    fil.addEventListener("scroll", function () { if (pres()) { nouveaux.hidden = true; vu(); } });

    function dessine(garderPosition) {
      var etaitEnBas = pres(), hauteurAvant = fil.scrollHeight, hautAvant = fil.scrollTop;
      UI.vide(fil);
      if (plusAnciens) {
        fil.appendChild(el("button", { type: "button", class: "btn btn-nu tc-plus", text: "Messages plus anciens", onclick: function () {
          var b = this; b.disabled = true;
          chargeAnciens().then(function () { dessine(true); }).catch(function (e) { b.disabled = false; UI.toast(e.message); });
        } }));
      }
      if (!liste.length) {
        fil.appendChild(el("p", { class: "tc-vide", text: manqueBase ? "" : "Aucun message pour l'instant. Lance la conversation !" }));
      }
      var moi = monId(), jour = "", prec = null;
      liste.forEach(function (m) {
        var j = jourLocal(m.creeLe);
        if (j !== jour) { jour = j; prec = null; fil.appendChild(el("div", { class: "tc-jour" }, [el("span", { text: libelleJour(m.creeLe) })])); }
        var mien = !!(moi && m.auteurId === moi);
        // Messages qui se suivent, même auteur, à moins de 5 minutes : un seul en-tête
        var suite = prec && prec.auteurId === m.auteurId && (new Date(m.creeLe) - new Date(prec.creeLe)) < 5 * 60000;
        prec = m;
        var corps = el("div", { class: "tc-bulle" }, texteAvecLiens(el, m.texte));
        var ligne = el("div", { class: "tc-msg" + (mien ? " mien" : "") + (suite ? " suite" : ""), dataset: { id: m.id } }, [
          mien || suite ? null : el("span", { class: "tc-init", "aria-hidden": "true", text: initiales(m.auteurId) }),
          el("div", { class: "tc-corps" }, [
            suite ? null : el("div", { class: "tc-tete" }, [
              mien ? null : el("span", { class: "tc-nom", text: nomDe(m.auteurId) }),
              el("time", { class: "tc-heure", dateTime: m.creeLe, text: heure(m.creeLe) })
            ]),
            corps
          ])
        ]);
        corps.title = libelleJour(m.creeLe) + " à " + heure(m.creeLe);
        if (peutRetirer(m)) {
          corps.appendChild(el("button", { type: "button", class: "tc-retire", "aria-label": "Retirer ce message", title: "Retirer ce message", text: "×",
            onclick: function () {
              UI.confirme("Retirer ce message ?", "Il disparaîtra pour tout le bureau.", "Retirer", true).then(function (ok) {
                if (!ok) return;
                efface(m.id).then(function () { dessine(true); UI.toast("Message retiré."); }).catch(function (e) { UI.toast(e.message); });
              });
            } }));
        }
        fil.appendChild(ligne);
      });
      if (garderPosition === true) fil.scrollTop = hautAvant + (fil.scrollHeight - hauteurAvant);
      else if (garderPosition === "nouveau" && !etaitEnBas) nouveaux.hidden = false;
      else enBas(false);
    }

    function etatSaisie() {
      var bloque = manqueBase;
      zone.disabled = bouton.disabled = bloque;
      alerte.hidden = !manqueBase;
      if (manqueBase) {
        UI.vide(alerte);
        alerte.appendChild(el("b", { text: "Base à mettre à jour. " }));
        alerte.appendChild(document.createTextNode("Le tchat attend la migration migration-tchat.sql (Supabase › SQL Editor)."));
      }
      aide.textContent = !enBase()
        ? (compteDemo() || (D.enDemo && D.enDemo()) ? "Démo : tes messages restent dans ce navigateur, personne d'autre ne les voit." : "Mode local : les messages restent dans ce navigateur.")
        : "Entrée pour envoyer · Maj+Entrée pour aller à la ligne";
    }

    function ajuste() { zone.style.height = "auto"; zone.style.height = Math.min(zone.scrollHeight, 132) + "px"; }
    zone.addEventListener("input", ajuste);
    var envoiEnCours = false;
    function part() {
      if (envoiEnCours || !zone.value.trim()) return;
      envoiEnCours = true; bouton.disabled = true;
      envoie(zone.value).then(function () {
        zone.value = ""; ajuste();
        dessine(false);
      }).catch(function (e) { UI.toast(e.message); }).then(function () {
        envoiEnCours = false; bouton.disabled = manqueBase; zone.focus();
      });
    }
    bouton.addEventListener("click", part);
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); part(); }
    });

    // En direct : un message relayé par direct.js
    global.addEventListener("planif:message", function (e) {
      var d = e.detail || {};
      if (d.type === "DELETE") { if (retire(d.id)) dessine(true); return; }
      if (d.message && ajoute(d.message)) {
        dessine(d.message.auteurId === monId() ? false : "nouveau");
        if (opts.surNouveau) opts.surNouveau();
      }
    });

    // Sans direct sur la table : relecture discrète
    function suiviEnDirect() {
      return global.PlanifDirect && global.PlanifDirect.suit("messages") &&
        document.documentElement.getAttribute("data-direct") === "oui";
    }
    setInterval(function () {
      if (document.hidden || !enBase() || suiviEnDirect()) return;
      var avant = liste.length ? liste[liste.length - 1].id : "", n = liste.length;
      charge().then(function () {
        var apres = liste.length ? liste[liste.length - 1].id : "";
        if (apres !== avant || liste.length !== n) { dessine("nouveau"); etatSaisie(); }
      }).catch(function () {});
    }, RELECTURE);
    document.addEventListener("visibilitychange", vu);

    etatSaisie();
    fil.appendChild(el("p", { class: "tc-vide", text: "Chargement…" }));
    return charge().then(function () { etatSaisie(); dessine(false); }).catch(function (e) {
      UI.vide(fil); fil.appendChild(el("p", { class: "tc-vide", text: e.message }));
    });
  }

  global.Tchat = {
    monte: monte,
    nonLus: nonLus,
    depuisBase: depuisBase,
    /** Le message vient-il de la personne connectée ? (direct.js, pour ne pas s'annoncer à soi-même) */
    deMoi: function (m) { var moi = monId(); return !!(moi && m && m.auteurId === moi); },
    nomDe: function (id) { var m = id && D ? D.membre(id) : null; return m ? m.prenom + " " + m.nom : "un collègue"; }
  };
})(window);
