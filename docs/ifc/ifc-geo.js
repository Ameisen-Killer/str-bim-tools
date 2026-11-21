// Web Worker de /ifc/ : géométrie 3D d'une partie des éléments, en parallèle avec d'autres workers.
// Reçoit { buffer (copie des octets du fichier), nom, ids, lecteur } ; relit le fichier (même découpe que la
// page, donc mêmes identifiants), calcule avec le même code que la page (ifc-vue.js : formes, ouvertures,
// triangles, arêtes vives) et renvoie au fil de l'eau { paquet, fini, fait } : géométries mises à plat
// (format du cache, tableaux transférés sans copie), puis les bilans. { erreur } si quelque chose casse.
// Les versions d'ifc-core.js et d'ifc-vue.js viennent de la page, dans l'adresse du worker (?core=…&vue=…) :
// le worker charge ainsi toujours le même code qu'elle, sans numéro à tenir à jour ici.
var VERSIONS = (function(){
  var o = {};
  (self.location.search || "").replace(/^\?/, "").split("&").forEach(function(x){ var k = x.split("="); if (/^\d+$/.test(k[1] || "")) o[k[0]] = k[1]; });
  return o;
})();
importScripts("/ifc/ifc-core.js?v=" + (VERSIONS.core || "0"), "/ifc/ifc-vue.js?v=" + (VERSIONS.vue || "0"));

onmessage = function(e){
  var d = e.data;
  IFCVue.rustPret().then(function(W){
    var oct = new Uint8Array(d.buffer), r = null;
    if (W && d.lecteur === "rust"){ try { r = IFC.analyserRust(oct, W); } catch (x){ r = null; } }
    if (!r) r = IFC.analyser(oct);
    return IFC.lireParEtapes(r, oct, d.nom || "modele.ifc");
  }).then(function(m){
    IFCVue.calculerPour(m, d.ids, function(p, fini, fait){
      p.fini = fini; p.fait = fait;
      postMessage(p, [p.I.buffer, p.F.buffer]);
    });
  }).catch(function(err){ postMessage({ erreur: String(err && err.message || err) }); });
};
