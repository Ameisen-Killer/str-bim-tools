// Moteurs d'affichage supplémentaires de /ifc/ : WebGPU (écrit pour l'outil) et Three.js (bibliothèque
// hébergée sur le site, chargée seulement si on la choisit). Même contrat que les moteurs d'ifc-vue.js :
// { nom, charger, teinter, dessiner, viser, coupe, perdu, restaurer, liberer }. Aucun appel réseau
// hors de str-bim-tools.com. La sélection passe par le processeur (rayon sur les triangles). Les sections
// dans la boîte de coupe sont remplies en rouge comme avec WebGL (méthode du pochoir).
(function(){
  "use strict";
  if (!window.IFCVue) return;

  // Couleurs par élément (même règle que le moteur WebGL) : faces RVBA, arêtes RVBA
  function couleurs(liste, plages, nv, nl, sel, actif, coul, O){
    var col = new Uint8Array(4*nv), lcol = new Uint8Array(4*nl);
    liste.forEach(function(it, e){
      var pl = plages[e];
      if (!pl) return;
      var t = it.h != null ? coul.pastel(it.h) : null, s1 = sel.has(it.id);
      var c = s1 ? O.OR : t ? t.piece : it.rgb || coul.piece;     // couleur choisie, sinon celle du fichier (web-ifc)
      var l = s1 ? (it.id === actif ? coul.actifRGBA : coul.areteOrRGBA) : it.id === actif ? coul.areteActiveRGBA : t ? t.areteRGBA : coul.areteRGBA;
      for (var v = pl[0]; v < pl[1]; v++){ col[4*v] = c[0]; col[4*v+1] = c[1]; col[4*v+2] = c[2]; col[4*v+3] = 255; }
      for (var w = pl[2]; w < pl[3]; w++){ lcol[4*w] = l[0]; lcol[4*w+1] = l[1]; lcol[4*w+2] = l[2]; lcol[4*w+3] = l[3]; }
    });
    return { col: col, lcol: lcol };
  }
  // Sommets relatifs à l'origine (précision float32), normales par face, arêtes vives ; plages par élément
  function maillage(liste, orig, O, orienter){
    var nv = 0, nl = 0;
    liste.forEach(function(it){ nv += O.triangles(it.geo).length/3; nl += O.aretesVives(it.geo).length/3; });
    var pos = new Float32Array(3*nv), nor = new Float32Array(3*nv), lpos = new Float32Array(3*nl), plages = [], v = 0, w = 0;
    liste.forEach(function(it){
      var T = it.geo.T, TF = it.geo.TF, A = it.geo.A, faces = it.geo.faces, v0 = v, w0 = w;
      for (var k = 0; k < T.length; k += 9){
        var n = faces[TF[(k/9) | 0]].n, a = 0, b = 3, c = 6;
        if (orienter){
          // sens des sommets accordé à la normale (Three.js calcule recto et verso d'après ce sens)
          var ux = T[k+3] - T[k], uy = T[k+4] - T[k+1], uz = T[k+5] - T[k+2], wx = T[k+6] - T[k], wy = T[k+7] - T[k+1], wz = T[k+8] - T[k+2];
          if ((uy*wz - uz*wy)*n[0] + (uz*wx - ux*wz)*n[1] + (ux*wy - uy*wx)*n[2] < 0){ b = 6; c = 3; }
        }
        [a, b, c].forEach(function(o){
          pos[3*v] = T[k+o] - orig[0]; pos[3*v+1] = T[k+o+1] - orig[1]; pos[3*v+2] = T[k+o+2] - orig[2];
          nor[3*v] = n[0]; nor[3*v+1] = n[1]; nor[3*v+2] = n[2];
          v++;
        });
      }
      for (k = 0; k < A.length; k += 3, w++){ lpos[3*w] = A[k] - orig[0]; lpos[3*w+1] = A[k+1] - orig[1]; lpos[3*w+2] = A[k+2] - orig[2]; }
      plages.push([v0, v, w0, w]);
    });
    return { pos: pos, nor: nor, lpos: lpos, plages: plages, nv: nv, nl: nl };
  }

  // ================= WebGPU =================
  var WGSL = [
    "struct U { m: mat4x4<f32>, l: vec4<f32>, k: vec4<f32>, b0: vec4<f32>, b1: vec4<f32> };",
    "@group(0) @binding(0) var<uniform> u: U;",
    "struct S { @builtin(position) p: vec4<f32>, @location(0) c: vec4<f32>, @location(1) w: vec3<f32> };",
    "fn proj(p: vec3<f32>) -> vec4<f32> { var q = u.m * vec4<f32>(p, 1.0); q.z = q.z * 0.5 + 0.5 * q.w; return q; }",
    "@vertex fn vFaces(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>, @location(2) c: vec4<f32>) -> S {",
    "  var o: S; o.p = proj(p); let l = abs(dot(n, u.l.xyz)); o.c = vec4<f32>(c.rgb * (0.34 + 0.66 * l), 1.0); o.w = p; return o; }",
    "@vertex fn vPos(@location(0) p: vec3<f32>) -> S {",
    "  var o: S; o.p = proj(p); o.c = vec4<f32>(0.0); o.w = p; return o; }",
    "@vertex fn vLignes(@location(0) p: vec3<f32>, @location(2) c: vec4<f32>) -> S {",
    "  var o: S; o.p = proj(p); o.c = c; o.w = p; return o; }",
    "@fragment fn f(i: S) -> @location(0) vec4<f32> {",
    "  if (u.k.x > 0.5 && (any(i.w < u.b0.xyz) || any(i.w > u.b1.xyz))) { discard; }",
    "  return vec4<f32>(i.c.rgb * i.c.a, i.c.a); }"
  ].join("\n");

  function webgpu(cv, O){
    if (!navigator.gpu) return null;
    return navigator.gpu.requestAdapter().then(function(ad){
      if (!ad) return null;
      return ad.requestDevice().then(function(dev){
        var ctx = cv.getContext("webgpu");
        if (!ctx) return null;
        var format = navigator.gpu.getPreferredCanvasFormat(), ECH = 4;
        ctx.configure({ device: dev, format: format, alphaMode: "premultiplied" });
        var mod = dev.createShaderModule({ code: WGSL });
        var bgl = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }] });
        var layout = dev.createPipelineLayout({ bindGroupLayouts: [bgl] });
        var MELANGE = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
        function pipe(vs, buffers, topo, o){
          return dev.createRenderPipeline({
            layout: layout,
            vertex: { module: mod, entryPoint: vs, buffers: buffers },
            fragment: { module: mod, entryPoint: "f", targets: [{ format: format, blend: o.melange ? MELANGE : undefined, writeMask: o.muet ? 0 : GPUColorWrite.ALL }] },
            primitive: { topology: topo },
            depthStencil: {
              format: "depth24plus-stencil8", depthWriteEnabled: !!o.ecrit, depthCompare: o.toujours ? "always" : "less-equal",
              depthBias: o.biais || 0, depthBiasSlopeScale: o.biais ? 1 : 0,
              stencilFront: o.pochoir || {}, stencilBack: o.pochoir || {},
              stencilReadMask: o.masque || 0xff, stencilWriteMask: o.pochoir && o.pochoir.passOp === "invert" ? o.masque : 0
            },
            multisample: { count: ECH }
          });
        }
        var bP = { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] };
        var bN = { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] };
        var bC = { arrayStride: 4, attributes: [{ shaderLocation: 2, offset: 0, format: "unorm8x4" }] };
        var pFaces = pipe("vFaces", [bP, bN, bC], "triangle-list", { ecrit: true, biais: 1 });
        var pLignes = pipe("vLignes", [bP, bC], "line-list", { melange: true });
        var pCadre = pipe("vLignes", [bP, bC], "line-list", { melange: true, toujours: true });
        // Sections remplies en rouge (méthode du pochoir, comme le moteur WebGL) : un bit de pochoir par axe,
        // pour traiter les trois faces de la boîte tournées vers l'œil dans la même passe.
        // 1) la géométrie coupée par le seul plan de la face inverse le bit à chaque surface traversée ;
        // 2) le rectangle de la face est peint là où le bit vaut 1 (plan à l'intérieur d'un solide).
        var pPochoir = [0, 1, 2].map(function(a){
          return pipe("vPos", [bP], "triangle-list", { muet: true, toujours: true, masque: 1 << a, pochoir: { compare: "always", passOp: "invert" } });
        });
        var pRouge = [0, 1, 2].map(function(a){
          return pipe("vLignes", [bP, bC], "triangle-list", { ecrit: true, masque: 1 << a, pochoir: { compare: "equal", passOp: "keep" } });
        });
        // uniformes du demi-espace de chaque axe
        var UA = [0, 1, 2].map(function(){ return dev.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); });
        var GA = UA.map(function(u){ return dev.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: u } }] }); });
        var U1 = dev.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var U2 = dev.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var G1 = dev.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: U1 } }] });
        var G2 = dev.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: U2 } }] });
        function tampon(data, usage){
          var b = dev.createBuffer({ size: Math.max(4, Math.ceil(data.byteLength/4)*4), usage: usage | GPUBufferUsage.COPY_DST });
          if (data.byteLength) dev.queue.writeBuffer(b, 0, data);
          return b;
        }
        var VB = GPUBufferUsage.VERTEX;
        var liste = [], origine = [0, 0, 0], m = { nv: 0, nl: 0, plages: [] }, B = {}, coupe = null, cadre = null, cadreCol = null, tex = null, perdu = false;
        var quad = dev.createBuffer({ size: 18*12, usage: VB | GPUBufferUsage.COPY_DST }), quadCol = null;
        dev.lost.then(function(){ perdu = true; });
        function detruire(){ Object.keys(B).forEach(function(k){ if (B[k]) B[k].destroy(); }); B = {}; }
        function charger(l, orig){
          liste = l; origine = orig;
          detruire();
          m = maillage(l, orig, O, false);
          B.pos = tampon(m.pos, VB); B.nor = tampon(m.nor, VB); B.lpos = tampon(m.lpos, VB);
          B.col = tampon(new Uint8Array(4*m.nv), VB); B.lcol = tampon(new Uint8Array(4*m.nl), VB);
          m.pos = m.nor = m.lpos = null;
          poserCoupe(coupe);
        }
        function teinter(l, sel, actif, coul){
          if (!B.col) return;
          var k = couleurs(liste, m.plages, m.nv, m.nl, sel, actif, coul, O);
          if (k.col.byteLength) dev.queue.writeBuffer(B.col, 0, k.col);
          if (k.lcol.byteLength) dev.queue.writeBuffer(B.lcol, 0, k.lcol);
          var a = coul.cadreRGBA, cc = new Uint8Array(4*24);
          for (var i = 0; i < 24; i++){ cc[4*i] = a[0]; cc[4*i+1] = a[1]; cc[4*i+2] = a[2]; cc[4*i+3] = a[3]; }
          if (cadreCol) cadreCol.destroy();
          cadreCol = tampon(cc, VB);
          var r = coul.coupeRGB, qc = new Uint8Array(4*18);
          for (i = 0; i < 18; i++){ qc[4*i] = r[0]; qc[4*i+1] = r[1]; qc[4*i+2] = r[2]; qc[4*i+3] = 255; }
          if (quadCol) quadCol.destroy();
          quadCol = tampon(qc, VB);
        }
        function poserCoupe(b){
          coupe = b;
          if (cadre){ cadre.destroy(); cadre = null; }
          if (b) cadre = tampon(new Float32Array(O.aretesBoite(b).map(function(v, k){ return v - origine[k % 3]; })), VB);
        }
        function textures(){
          var w = cv.width, h = cv.height;
          if (tex && tex.w === w && tex.h === h) return;
          if (tex){ tex.c.destroy(); tex.d.destroy(); }
          tex = { w: w, h: h,
            c: dev.createTexture({ size: [w, h], sampleCount: ECH, format: format, usage: GPUTextureUsage.RENDER_ATTACHMENT }),
            d: dev.createTexture({ size: [w, h], sampleCount: ECH, format: "depth24plus-stencil8", usage: GPUTextureUsage.RENDER_ATTACHMENT }) };
        }
        function uniformes(buf, M, c, oui, b0, b1){
          var u = new Float32Array(32);
          u.set(M, 0);
          u[16] = c.lumiere[0]; u[17] = c.lumiere[1]; u[18] = c.lumiere[2];
          u[20] = oui && coupe ? 1 : 0;
          if (coupe) for (var a = 0; a < 3; a++){
            u[24 + a] = b0 ? b0[a] : coupe.min[a] - origine[a];
            u[28 + a] = b1 ? b1[a] : coupe.max[a] - origine[a];
          }
          dev.queue.writeBuffer(buf, 0, u);
        }
        // faces de la boîte tournées vers l'œil : [{ axe, demi-espace gardé b0/b1 }] et leurs rectangles dans quad
        function facesVues(c, M){
          var versOeil = [c.cb*c.sa, -c.cb*c.ca, c.sb], G = 1e7, vues = [], q = new Float32Array(18*3);
          for (var f = 0; f < 6; f++){
            var ax = f >> 1, max = f & 1;
            if ((max ? 1 : -1)*versOeil[ax] <= 1e-6) continue;
            var b0 = [-G, -G, -G], b1 = [G, G, G];
            if (max) b1[ax] = coupe.max[ax] - origine[ax]; else b0[ax] = coupe.min[ax] - origine[ax];
            uniformes(UA[ax], M, c, true, b0, b1);
            var u = (ax + 1) % 3, v = (ax + 2) % 3, w = max ? coupe.max[ax] : coupe.min[ax];
            [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]].forEach(function(k, n){
              var p = [0, 0, 0];
              p[ax] = w; p[u] = k[0] ? coupe.max[u] : coupe.min[u]; p[v] = k[1] ? coupe.max[v] : coupe.min[v];
              for (var a = 0; a < 3; a++) q[3*(6*ax + n) + a] = p[a] - origine[a];
            });
            vues.push(ax);
          }
          dev.queue.writeBuffer(quad, 0, q);
          return vues;
        }
        function dessiner(c){
          if (perdu || !cv.width || !cv.height || !B.pos) return;
          textures();
          var M = O.matriceVue(c, origine);
          uniformes(U1, M, c, true); uniformes(U2, M, c, false);
          var enc = dev.createCommandEncoder();
          var pass = enc.beginRenderPass({
            colorAttachments: [{ view: tex.c.createView(), resolveTarget: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "discard" }],
            depthStencilAttachment: { view: tex.d.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard",
              stencilClearValue: 0, stencilLoadOp: "clear", stencilStoreOp: "discard" }
          });
          if (m.nv){
            pass.setPipeline(pFaces); pass.setBindGroup(0, G1);
            pass.setVertexBuffer(0, B.pos); pass.setVertexBuffer(1, B.nor); pass.setVertexBuffer(2, B.col);
            pass.draw(m.nv);
          }
          if (m.nl){
            pass.setPipeline(pLignes); pass.setBindGroup(0, G1);
            pass.setVertexBuffer(0, B.lpos); pass.setVertexBuffer(1, B.lcol);
            pass.draw(m.nl);
          }
          if (coupe && m.nv && quadCol) facesVues(c, M).forEach(function(ax){
            pass.setStencilReference(1 << ax);
            pass.setPipeline(pPochoir[ax]); pass.setBindGroup(0, GA[ax]);
            pass.setVertexBuffer(0, B.pos);
            pass.draw(m.nv);
            pass.setPipeline(pRouge[ax]); pass.setBindGroup(0, G2);
            pass.setVertexBuffer(0, quad); pass.setVertexBuffer(1, quadCol);
            pass.draw(6, 1, 6*ax);
          });
          if (coupe && cadre && cadreCol){
            pass.setPipeline(pCadre); pass.setBindGroup(0, G2);
            pass.setVertexBuffer(0, cadre); pass.setVertexBuffer(1, cadreCol);
            pass.draw(24);
          }
          pass.end();
          dev.queue.submit([enc.finish()]);
        }
        return {
          nom: "WebGPU", charger: charger, teinter: teinter, dessiner: dessiner,
          viser: function(c, x, y){ return O.viserCPU(liste, c, x, y, coupe); },
          coupe: poserCoupe,
          perdu: function(){ return perdu; }, restaurer: function(){},
          liberer: function(){ detruire(); try { dev.destroy(); } catch (e){} }
        };
      });
    });
  }

  // ================= Three.js =================
  var THREE_URL = "/ifc/vendor/three/three.module.js";
  function three(cv, O){
    return import(THREE_URL).then(function(T){
      var R;
      try { R = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, stencil: true }); }
      catch (e){ return null; }
      if (T.ColorManagement) T.ColorManagement.enabled = false;      // couleurs prises telles quelles
      R.outputColorSpace = T.LinearSRGBColorSpace;
      R.setPixelRatio(1);
      R.setClearColor(0x000000, 0);
      R.localClippingEnabled = true;
      var scene = new T.Scene();
      var ciel = new T.HemisphereLight(0xffffff, 0x77736c, 1.4);
      var soleil = new T.DirectionalLight(0xffffff, 2.3);
      scene.add(ciel); scene.add(soleil); scene.add(soleil.target);
      var cam = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
      cam.matrixAutoUpdate = false;
      var plans = [0, 1, 2, 3, 4, 5].map(function(){ return new T.Plane(new T.Vector3(1, 0, 0), 0); });
      var matF = new T.MeshStandardMaterial({ vertexColors: true, side: T.DoubleSide, roughness: .62, metalness: .06, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      var matL = new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
      var matC = new T.LineBasicMaterial({ color: 0xd6a85c, transparent: true, opacity: .75, depthTest: false });
      // Sections remplies en rouge (pochoir, un bit par axe) : la géométrie coupée par le seul plan de la face
      // vue inverse le bit à chaque surface traversée, puis le rectangle de la face est peint là où il vaut 1
      var demi = [0, 1, 2].map(function(){ return new T.Plane(new T.Vector3(1, 0, 0), 0); });
      var matP = [0, 1, 2].map(function(a){
        return new T.MeshBasicMaterial({ side: T.DoubleSide, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: [demi[a]],
          stencilWrite: true, stencilFunc: T.AlwaysStencilFunc, stencilRef: 1 << a, stencilWriteMask: 1 << a,
          stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp, stencilZPass: T.InvertStencilOp });
      });
      var matR = [0, 1, 2].map(function(a){
        return new T.MeshBasicMaterial({ color: 0xc4302a, side: T.DoubleSide,
          stencilWrite: true, stencilFunc: T.EqualStencilFunc, stencilRef: 1 << a, stencilFuncMask: 1 << a, stencilWriteMask: 0,
          stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp, stencilZPass: T.KeepStencilOp });
      });
      var quads = matR.map(function(mat, a){
        var g = new T.BufferGeometry();
        g.setAttribute("position", new T.BufferAttribute(new Float32Array(18), 3));
        var q = new T.Mesh(g, mat);
        q.renderOrder = 3 + 2*a; q.frustumCulled = false; q.visible = false;
        scene.add(q);
        return q;
      });
      var liste = [], origine = [0, 0, 0], m = { nv: 0, nl: 0, plages: [] }, objets = [], pochoirs = [], coupe = null, cadre = null, taille = [0, 0];
      function vider(){
        pochoirs.forEach(function(o){ scene.remove(o); }); pochoirs = [];
        objets.forEach(function(o){ scene.remove(o); o.geometry.dispose(); }); objets = [];
      }
      function charger(l, orig){
        liste = l; origine = orig;
        vider();
        m = maillage(l, orig, O, true);
        var gf = new T.BufferGeometry();
        gf.setAttribute("position", new T.BufferAttribute(m.pos, 3));
        gf.setAttribute("normal", new T.BufferAttribute(m.nor, 3));
        gf.setAttribute("color", new T.BufferAttribute(new Uint8Array(4*m.nv), 4, true));
        var gl = new T.BufferGeometry();
        gl.setAttribute("position", new T.BufferAttribute(m.lpos, 3));
        gl.setAttribute("color", new T.BufferAttribute(new Uint8Array(4*m.nl), 4, true));
        var faces = new T.Mesh(gf, matF), aretes = new T.LineSegments(gl, matL);
        faces.frustumCulled = aretes.frustumCulled = false;
        aretes.renderOrder = 1;
        objets = [faces, aretes];
        scene.add(faces); scene.add(aretes);
        pochoirs = matP.map(function(mat, a){
          var p = new T.Mesh(gf, mat);
          p.renderOrder = 2 + 2*a; p.frustumCulled = false; p.visible = false;
          scene.add(p);
          return p;
        });
        m.pos = m.nor = m.lpos = null;
        poserCoupe(coupe);
      }
      function teinter(l, sel, actif, coul){
        if (!objets.length) return;
        var k = couleurs(liste, m.plages, m.nv, m.nl, sel, actif, coul, O);
        var cf = objets[0].geometry.getAttribute("color"), cl = objets[1].geometry.getAttribute("color");
        cf.array.set(k.col); cf.needsUpdate = true;
        cl.array.set(k.lcol); cl.needsUpdate = true;
        var a = coul.cadreRGBA;
        matC.color.setRGB(a[0]/255, a[1]/255, a[2]/255); matC.opacity = a[3]/255;
        var r = coul.coupeRGB;
        matR.forEach(function(mat){ mat.color.setRGB(r[0]/255, r[1]/255, r[2]/255); });
      }
      function poserCoupe(b){
        coupe = b;
        if (cadre){ scene.remove(cadre); cadre.geometry.dispose(); cadre = null; }
        if (!b){ matF.clippingPlanes = null; matL.clippingPlanes = null; matF.needsUpdate = matL.needsUpdate = true; return; }
        for (var a = 0; a < 3; a++){
          var n = [0, 0, 0];
          n[a] = 1; plans[2*a].normal.set(n[0], n[1], n[2]); plans[2*a].constant = -(b.min[a] - origine[a]);
          n[a] = -1; plans[2*a + 1].normal.set(n[0], n[1], n[2]); plans[2*a + 1].constant = b.max[a] - origine[a];
        }
        matF.clippingPlanes = plans; matL.clippingPlanes = plans; matF.needsUpdate = matL.needsUpdate = true;
        var g = new T.BufferGeometry();
        g.setAttribute("position", new T.BufferAttribute(new Float32Array(O.aretesBoite(b).map(function(v, k){ return v - origine[k % 3]; })), 3));
        cadre = new T.LineSegments(g, matC);
        cadre.renderOrder = 10; cadre.frustumCulled = false;
        scene.add(cadre);
      }
      // faces de la boîte tournées vers l'œil : plan du demi-espace gardé et rectangle de la face
      function sections(c){
        var vo = [c.cb*c.sa, -c.cb*c.ca, c.sb];
        for (var ax = 0; ax < 3; ax++){
          var vue = !!coupe && pochoirs.length > 0 && Math.abs(vo[ax]) > 1e-6, max = vo[ax] > 0;
          quads[ax].visible = vue;
          if (pochoirs[ax]) pochoirs[ax].visible = vue;
          if (!vue) continue;
          var n = [0, 0, 0], w = max ? coupe.max[ax] : coupe.min[ax];
          n[ax] = max ? -1 : 1;
          demi[ax].normal.set(n[0], n[1], n[2]);
          demi[ax].constant = max ? w - origine[ax] : -(w - origine[ax]);
          var u = (ax + 1) % 3, v = (ax + 2) % 3, at = quads[ax].geometry.getAttribute("position");
          [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]].forEach(function(k, i){
            var p = [0, 0, 0];
            p[ax] = w; p[u] = k[0] ? coupe.max[u] : coupe.min[u]; p[v] = k[1] ? coupe.max[v] : coupe.min[v];
            at.setXYZ(i, p[0] - origine[0], p[1] - origine[1], p[2] - origine[2]);
          });
          at.needsUpdate = true;
        }
      }
      function dessiner(c){
        if (!cv.width || !cv.height) return;
        if (taille[0] !== cv.width || taille[1] !== cv.height){ R.setSize(cv.width, cv.height, false); taille = [cv.width, cv.height]; }
        // caméra orthographique : mêmes axes écran que les autres moteurs (droite r0, haut r1, profondeur r2)
        var r0 = [c.ca, c.sa, 0], r1 = [-c.sb*c.sa, c.sb*c.ca, c.cb], r2 = [-c.cb*c.sa, c.cb*c.ca, -c.sb];
        var K = 3*c.prof, C = [c.centre[0] - origine[0], c.centre[1] - origine[1], c.centre[2] - origine[2]];
        var P = [C[0] - r2[0]*K, C[1] - r2[1]*K, C[2] - r2[2]*K];
        cam.matrix.set(r0[0], r1[0], -r2[0], P[0], r0[1], r1[1], -r2[1], P[1], r0[2], r1[2], -r2[2], P[2], 0, 0, 0, 1);
        cam.matrixWorldNeedsUpdate = true;
        cam.left = -(c.W/2 + c.px)/c.s; cam.right = (c.W/2 - c.px)/c.s;
        cam.top = (c.H/2 + c.py)/c.s; cam.bottom = (c.py - c.H/2)/c.s;
        cam.near = K - 1.5*c.prof; cam.far = K + 1.5*c.prof;
        cam.updateProjectionMatrix();
        // lumière fixée par rapport à l'écran
        var L = c.lumiere;
        soleil.position.set(C[0] + L[0]*K, C[1] + L[1]*K, C[2] + L[2]*K);
        soleil.target.position.set(C[0], C[1], C[2]);
        soleil.target.updateMatrixWorld();
        sections(c);
        R.render(scene, cam);
      }
      return {
        nom: "Three.js r" + T.REVISION, charger: charger, teinter: teinter, dessiner: dessiner,
        viser: function(c, x, y){ return O.viserCPU(liste, c, x, y, coupe); },
        coupe: poserCoupe,
        perdu: function(){ return false; }, restaurer: function(){},
        liberer: function(){
          vider();
          quads.forEach(function(q){ q.geometry.dispose(); });
          matP.concat(matR, [matF, matL, matC]).forEach(function(mat){ mat.dispose(); });
          try { R.dispose(); R.forceContextLoss(); } catch (e){}
        }
      };
    });
  }

  IFCVue.ajouterMoteur("webgpu", webgpu);
  IFCVue.ajouterMoteur("three", three);
})();
