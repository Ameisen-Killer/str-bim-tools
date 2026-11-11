// Web Worker de /ifc/ : première étape de la lecture d'un IFC (contrôles, découpage des entités) en
// arrière-plan, pour que la page ne gèle pas sur les gros fichiers. Reçoit { buffer, lecteur }, renvoie
// { progres } de temps en temps, puis { resultat, buffer } (tableaux typés et octets transférés sans
// copie) ou { erreur, ifc }. Aucune requête réseau hors de ce site : le fichier ne quitte pas le navigateur.
// lecteur "rust" : découpe par le module WebAssembly compilé depuis Rust (ifc-lecteur.wasm, source
// outils/ifc-rust), plusieurs fois plus rapide ; le lecteur JavaScript reprend la main s'il manque ou échoue.
importScripts("/ifc/ifc-core.js?v=10");

var module = null, rapport = null;
function chargerRust(){
  if (!module){
    module = typeof WebAssembly !== "object" ? Promise.reject(new Error("WebAssembly absent")) :
      fetch("/ifc/ifc-lecteur.wasm?v=2").then(function(r){
        if (!r.ok) throw new Error("module introuvable (" + r.status + ")");
        return r.arrayBuffer();
      }).then(function(b){
        return WebAssembly.instantiate(b, { env: { progres: function(f){ if (rapport) rapport(f); } } });
      }).then(function(x){ return x.instance.exports; });
    module.catch(function(){ module = null; });
  }
  return module;
}

onmessage = function(e){
  var buffer = e.data.buffer, t0 = Date.now();
  function avance(p){ postMessage({ progres: p }); }
  function envoyer(r, lecteur, note){
    delete r.txt;             // le texte reste ici : la page le reconstruit depuis les octets rendus
    r.lecteur = lecteur; r.noteLecteur = note || ""; r.msLecteur = Date.now() - t0;
    postMessage({ resultat: r, buffer: buffer }, [buffer, r.ids.buffer, r.deb.buffer, r.fin.buffer, r.typ.buffer, r.rdeb.buffer, r.refs.buffer]);
  }
  function javascript(note){
    try { envoyer(IFC.analyser(new Uint8Array(buffer), avance), "js", note); }
    catch (err){ postMessage({ erreur: err && err.message || String(err), ifc: !!(err && err.ifc) }); }
  }
  if (e.data.lecteur !== "rust"){ javascript(""); return; }
  chargerRust().then(function(W){
    var r;
    rapport = avance;
    try { r = IFC.analyserRust(new Uint8Array(buffer), W); }
    catch (err){
      rapport = null;
      if (err && err.ifc){ postMessage({ erreur: err.message, ifc: true }); return; }
      module = null;            // module planté : rechargé neuf la prochaine fois
      javascript("le lecteur Rust a échoué (" + (err && err.message || err) + "), lecture JavaScript");
      return;
    }
    rapport = null;
    if (!r){ javascript("cas particulier confié au lecteur JavaScript"); return; }
    envoyer(r, "rust");
  }, function(err){ javascript("lecteur Rust indisponible (" + (err && err.message || err) + "), lecture JavaScript"); });
};
