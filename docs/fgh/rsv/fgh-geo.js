// Web Worker de /fgh/rsv/ (repris de /ifc/ifc-geo.js) : géométrie 3D d'une partie des éléments, en parallèle
// avec d'autres workers. Reçoit { buffer (copie des octets du fichier), nom, ids } ; relit le fichier (même
// découpe que la page, donc mêmes identifiants), calcule avec le même code que la page (fgh-vue.js : formes,
// ouvertures, mise en mètres, triangles, arêtes vives) et renvoie au fil de l'eau { paquet, fini, fait } :
// géométries mises à plat (format du cache, tableaux transférés sans copie), puis les bilans. { erreur } si ça casse.
importScripts("/fgh/rsv/fgh-core.js?v=3", "/fgh/rsv/fgh-vue.js?v=22");

onmessage = function(e){
  var d = e.data;
  IFCVue.rustPret().then(function(W){
    var oct = new Uint8Array(d.buffer), r = null;
    if (W){ try { r = IFC.analyserRust(oct, W); } catch (x){ r = null; } }
    if (!r) r = IFC.analyser(oct);
    return IFC.lireParEtapes(r, oct, d.nom || "modele.ifc");
  }).then(function(m){
    IFCVue.calculerPour(m, d.ids, function(p, fini, fait){
      p.fini = fini; p.fait = fait;
      postMessage(p, [p.I.buffer, p.F.buffer]);
    });
  }).catch(function(err){ postMessage({ erreur: String(err && err.message || err) }); });
};
