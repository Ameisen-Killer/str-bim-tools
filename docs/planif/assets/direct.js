/* Mises à jour en direct (27.09.2026)
   ---------------------------------------------------------------------------
   Quand un collègue enregistre, la base prévient toutes les pages ouvertes :
   elles se relisent d'elles-mêmes, et les transitions (UI.joue) font glisser
   ce qui a bougé ; un éclat d'or signale les tâches touchées, et un message
   bref dit ce qui vient de changer.

   Le canal : le service « Realtime » de Supabase, en WebSocket, écrit à la
   main comme le reste (protocole Phoenix, vsn 1.0.0) :
     - un abonnement aux changements (postgres_changes) des tables du
       planning, limité au bureau affiché ; la base n'envoie que ce que la
       RLS laisse lire à la personne connectée ;
     - un battement toutes les 25 s, le jeton renouvelé quand il change ;
     - reconnexion automatique, de plus en plus espacée (2 s → 30 s).
   Les tables doivent faire partie de la publication « supabase_realtime »
   (base-supabase.sql). Si le canal refuse, la page se rabat sur une relecture discrète toutes les 60 s,
   onglet visible.

   Jamais sous les doigts : une relecture attend qu'aucune fenêtre ne soit
   ouverte, que la palette soit fermée, qu'aucun glisser ne soit en cours.
   Nos propres enregistrements reviennent aussi par le canal : ils relisent
   la base comme les autres, mais sans éclat ni message.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var D = global.Donnees, UI = global.UI, SB = global.Sb;
  if (!D || !UI || !SB || !UI.avecBase || !SB.connecte()) return;
  if (/^\/planif\/(console|connexion)\//.test(location.pathname)) return;

  var TABLES = ["taches", "affaires", "affaire_membres", "membres", "absences", "avis", "contacts", "ao_agenda", "reglages"];
  var BATTEMENT = 25000, REPLI = 60000;

  var ws = null, ref = 0, joinRef = null, sujet = "", battement = null, jetonEnvoye = "";
  var essais = 0, abandon = false, repli = null;
  var enAttente = null, touches = { taches: {}, n: 0, noms: [] }, echo = true;
  var html = document.documentElement;

  function etat(v) { html.setAttribute("data-direct", v); }

  /* ------------------------------------------------------------- canal */

  function adresse() {
    var p = SB.projet();
    return p.url.replace(/^http/, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(p.cle) + "&vsn=1.0.0";
  }
  function envoie(topic, event, payload, avecJoin) {
    if (!ws || ws.readyState !== 1) return;
    var m = { topic: topic, event: event, payload: payload || {}, ref: String(++ref) };
    if (avecJoin) m.join_ref = joinRef;
    ws.send(JSON.stringify(m));
  }

  function connecte() {
    if (abandon || ws) return;
    SB.jeton().then(function (jeton) {
      var profil = D.profil ? D.profil() : null;
      var bureau = profil && profil.bureau ? profil.bureau.id : "";
      sujet = "realtime:planif-" + (bureau || "commun");
      try { ws = new WebSocket(adresse()); } catch (e) { return echec(); }
      ws.onopen = function () {
        joinRef = String(++ref);
        jetonEnvoye = jeton;
        ws.send(JSON.stringify({
          topic: sujet, event: "phx_join", ref: joinRef, join_ref: joinRef,
          payload: {
            config: {
              broadcast: { ack: false, self: false }, presence: { key: "" }, private: false,
              postgres_changes: TABLES.map(function (t) {
                var c = { event: "*", schema: "public", table: t };
                if (bureau) c.filter = "bureau_id=eq." + bureau;
                return c;
              })
            },
            access_token: jeton
          }
        }));
        clearInterval(battement);
        battement = setInterval(bat, BATTEMENT);
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (x) { return; }
        recoit(m);
      };
      ws.onclose = function () { ferme(); planifie(); };
      ws.onerror = function () { /* onclose suit */ };
    }).catch(function () { planifie(); });
  }

  function bat() {
    envoie("phoenix", "heartbeat", {});
    // Jeton renouvelé par la session : le canal doit le connaître, sinon il se ferme à l'expiration
    SB.jeton().then(function (j) {
      if (j && j !== jetonEnvoye) { jetonEnvoye = j; envoie(sujet, "access_token", { access_token: j }, true); }
    }).catch(function () {});
  }

  function ferme() {
    clearInterval(battement); battement = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} }
    ws = null;
    etat("non");
  }

  function planifie() {
    if (abandon) return;
    essais++;
    if (essais >= 4) demarreRepli();             // canal capricieux : le repli prend le relais en attendant
    var delai = Math.min(30000, 2000 * Math.pow(1.8, essais - 1));
    setTimeout(connecte, delai);
  }

  /* Le canal refuse l'abonnement (tables hors publication, ou réglage du
     projet) : on n'insiste pas, le repli suffit. */
  function echec(message) {
    abandon = true;
    ferme();
    etat("repli");
    demarreRepli();
    if (message && global.console) console.info("Planification — direct indisponible :", message);
  }

  function recoit(m) {
    if (m.topic === sujet && m.event === "phx_reply" && m.ref === joinRef) {
      if (m.payload && m.payload.status === "ok") { essais = 0; arreteRepli(); etat("oui"); }
      else echec(m.payload && m.payload.response && (m.payload.response.reason || JSON.stringify(m.payload.response)));
      return;
    }
    if (m.topic !== sujet) return;
    if (m.event === "system" && m.payload && m.payload.extension === "postgres_changes") {
      if (m.payload.status === "error") echec(m.payload.message);
      return;
    }
    if (m.event === "phx_error" || m.event === "phx_close") { ferme(); planifie(); return; }
    if (m.event === "postgres_changes" && m.payload && m.payload.data) change(m.payload.data);
  }

  /* ------------------------------------------------- une modification arrive */

  function change(d) {
    // Un enregistrement de cette page qui revient : on relit, sans rien annoncer
    var mienne = D.ecritureRecente && D.ecritureRecente(2500);
    if (!mienne) echo = false;
    var ligne = d.record || d["new"] || d.old_record || d.old || {};
    if (!mienne && d.table === "taches" && ligne.id) {
      if (!touches.taches[ligne.id]) {
        touches.taches[ligne.id] = true; touches.n++;
        var t = D.tache(ligne.id);
        touches.noms.push(ligne.titre || (t && t.titre) || "une tâche");
        if (d.type === "DELETE" || d.eventType === "DELETE") touches.retrait = true;
      }
    } else if (!mienne && d.table === "avis" && (d.type || d.eventType) === "INSERT") {
      touches.n++;
      var m = D.membre(ligne.membre_id);
      touches.noms.push("avis d'absence de " + (m ? m.prenom + " " + m.nom : "un collègue"));
    } else if (!mienne) {
      touches.n++;
    }
    clearTimeout(enAttente);
    enAttente = setTimeout(relis, 500);           // une rafale de changements = une seule relecture
  }

  function occupe() {
    return !!document.querySelector(".modale.ouverte, .palette:not([hidden])") ||
           document.body.classList.contains("glisse-en-cours");
  }

  function relis() {
    if (document.hidden) { enAttente = null; aRelire = true; return; }
    if (occupe()) { enAttente = setTimeout(relis, 1200); return; }
    enAttente = null;
    var t = touches, silencieux = echo;
    touches = { taches: {}, n: 0, noms: [] }; echo = true;
    D.recharge().then(function () {
      if (silencieux) return;
      eclat(Object.keys(t.taches));
      annonce(t);
    }).catch(function () {});
  }

  /* L'onglet était derrière : on relit au retour, une fois */
  var aRelire = false;
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && aRelire) { aRelire = false; relis(); }
  });

  /* Un éclat d'or sur ce qui vient de changer : barres du planning, lignes de
     la liste. Après les glissements (UI.joue), pour ne pas se marcher dessus. */
  function eclat(ids) {
    if (!ids.length) return;
    setTimeout(function () {
      ids.forEach(function (id) {
        var sel = '[data-anim^="b|' + id + '|"], [data-anim="t|' + id + '"]';
        [].forEach.call(document.querySelectorAll(sel), function (n) {
          if (!n.animate) return;
          n.animate([
            { boxShadow: "0 0 0 0 rgba(var(--or-rvb),.0)", filter: "brightness(1)" },
            { boxShadow: "0 0 0 3px rgba(var(--or-rvb),.75), 0 0 22px rgba(var(--or-rvb),.45)", filter: "brightness(1.35)", offset: .25 },
            { boxShadow: "0 0 0 0 rgba(var(--or-rvb),0)", filter: "brightness(1)" }
          ], { duration: 1600, easing: "ease-out" });
        });
      });
    }, 480);
  }

  function annonce(t) {
    if (!t.n) return;
    var noms = t.noms.filter(Boolean);
    if (noms.length === 1 && t.n === 1) {
      UI.toast((t.retrait ? "Retirée par l'équipe : " : "Mise à jour par l'équipe : ") + noms[0] + ".");
    } else {
      UI.toast(t.n > 1 ? t.n + " modifications de l'équipe, affichées." : "Modification de l'équipe, affichée.");
    }
  }

  /* ------------------------------------------------------------ repli */

  function demarreRepli() {
    if (repli) return;
    repli = setInterval(function () {
      if (document.hidden || occupe() || ws && ws.readyState === 1 && html.getAttribute("data-direct") === "oui") return;
      UI.rafraichit(true);
    }, REPLI);
  }
  function arreteRepli() { clearInterval(repli); repli = null; }

  etat("non");
  D.pret().then(function () { connecte(); }).catch(function () {});
  global.addEventListener("pagehide", function () { abandon = true; ferme(); });
  // Page rendue par le cache du navigateur (retour arrière) : on se reconnecte, et on relit
  global.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    abandon = false; essais = 0; connecte(); UI.rafraichit(true);
  });
  global.addEventListener("online", function () { if (!ws && !abandon) { essais = 0; connecte(); } });
})(window);
