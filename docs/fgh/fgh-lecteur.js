// Web Worker de /fgh/ (copie de /ifc/ifc-lecteur.js) : première étape de la lecture d'un IFC (contrôles, découpage des entités) en
// arrière-plan, pour que la page ne gèle pas sur les gros fichiers. Reçoit { buffer }, renvoie
// { progres } de temps en temps, puis { resultat, buffer } (tableaux typés et octets transférés sans
// copie) ou { erreur, ifc }. Aucune requête réseau : le fichier ne quitte pas le navigateur.
importScripts("/fgh/fgh-core.js?v=1");

onmessage = function(e){
  var buffer = e.data.buffer;
  try {
    var r = IFC.analyser(new Uint8Array(buffer), function(p){ postMessage({ progres: p }); });
    delete r.txt;             // le texte reste ici : la page le reconstruit depuis les octets rendus
    postMessage({ resultat: r, buffer: buffer }, [buffer, r.ids.buffer, r.deb.buffer, r.fin.buffer, r.typ.buffer, r.rdeb.buffer, r.refs.buffer]);
  } catch (err){
    postMessage({ erreur: err && err.message || String(err), ifc: !!(err && err.ifc) });
  }
};
