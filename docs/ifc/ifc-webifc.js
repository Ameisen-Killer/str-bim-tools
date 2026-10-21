// Web Worker de /ifc/ : géométrie calculée par web-ifc (That Open Company, licence MPL-2.0, hébergé sur
// le site dans /ifc/vendor/web-ifc/). Reçoit { buffer } (octets IFC), renvoie { progres } de temps en
// temps, des lots { lot: [ids], tri: [Float64Array] } (triangles à plat, 9 nombres par triangle, dans le
// repère de web-ifc), puis { fin: true } ou { erreur }. Aucune requête hors du site.
importScripts("/ifc/vendor/web-ifc/web-ifc-api-iife.js");

onmessage = function(e){
  var api = new WebIFC.IfcAPI();
  api.SetWasmPath("/ifc/vendor/web-ifc/", true);
  // un seul fil : pas besoin d'isolation cross-origin ni de workers imbriqués
  api.Init(undefined, true).then(function(){
    var id = api.OpenModel(new Uint8Array(e.data.buffer), { COORDINATE_TO_ORIGIN: false });
    if (id < 0) throw new Error("fichier refusé par web-ifc");
    var lotIds = [], lotT = [], taille = 0, vus = 0, total = 0;
    function envoyer(){
      if (!lotIds.length) return;
      postMessage({ lot: lotIds, tri: lotT }, lotT.map(function(T){ return T.buffer; }));
      lotIds = []; lotT = []; taille = 0;
    }
    api.StreamAllMeshes(id, function(mesh, n, nb){
      var pgs = mesh.geometries, morceaux = [], long = 0;
      for (var g = 0; g < pgs.size(); g++){
        var pg = pgs.get(g), geo = api.GetGeometry(id, pg.geometryExpressID);
        var V = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        var I = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        var m = pg.flatTransformation, T = new Float64Array(I.length*3);
        // sommets : x, y, z, nx, ny, nz ; matrice 4×4 rangée par colonnes
        for (var i = 0; i < I.length; i++){
          var o = I[i]*6, x = V[o], y = V[o+1], z = V[o+2];
          T[3*i]   = m[0]*x + m[4]*y + m[8]*z  + m[12];
          T[3*i+1] = m[1]*x + m[5]*y + m[9]*z  + m[13];
          T[3*i+2] = m[2]*x + m[6]*y + m[10]*z + m[14];
        }
        if (geo.delete) geo.delete();
        if (T.length){ morceaux.push(T); long += T.length; }
      }
      if (long){
        var tout = morceaux.length === 1 ? morceaux[0] : new Float64Array(long), k = 0;
        if (morceaux.length > 1) morceaux.forEach(function(T){ tout.set(T, k); k += T.length; });
        lotIds.push(mesh.expressID); lotT.push(tout); taille += long;
      }
      vus++;
      if (nb) total = nb;
      if (taille > 2e6){ envoyer(); postMessage({ progres: total ? vus/total : 0 }); }
    }, false);
    envoyer();
    api.CloseModel(id);
    postMessage({ fin: true });
  }).catch(function(err){
    postMessage({ erreur: err && err.message || String(err) });
  });
};
