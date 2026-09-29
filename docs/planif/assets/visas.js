/* Visas — analyse de l'export « Tableau de suivi » de la GED Kairnial.
   Tout se passe dans le navigateur : le fichier n'est envoyé nulle part.

   lire(octets)      .xlsx -> classeur { feuilles:[{ nom, lignes }] }, sans bibliothèque :
                     le zip est ouvert à la main et décompressé par DecompressionStream,
                     le XML lu par expressions régulières.
   parse(classeur)   classeur -> jeu compact (tableaux, chaînes mises en commun), à garder tel quel
   inflate(jeu)      jeu compact -> objets de travail
   analyse(D, f)     indicateurs, selon le filtre { circuit, type, auteur, dernierSeul } ; l'auteur est celui
                     qui a déposé l'indice : un plan suit son dernier indice, un visa l'indice visé

   Les dates restent en numéros de série Excel (jours) : Kairnial compte ses délais
   en jours entiers, et l'export porte des décalages de quelques heures selon les
   colonnes. Raisonner en jours évite ces deux pièges.

   Particularités de l'export Kairnial, relevées sur un vrai fichier (29.09.2026) :
   - les commentaires sont du texte enrichi dont les balises portent un préfixe
     (<d:r><d:t>…) : un lecteur qui ne cherche que <r><t> les perd ;
   - les vrais en-têtes sont sur la ligne « Libellé du document », sous la forme
     « Champ\nIntervenant » ; la ligne au-dessus est incohérente et ignorée ;
   - la colonne « Visa » mêle le code rendu (texte) et, pour un visa attendu,
     un compte à rebours en jours (nombre, négatif = retard) ;
   - « Dernier indice » ne vaut que pour la chaîne d'indices de son circuit : un même
     plan peut vivre dans deux circuits, on recalcule donc le vrai dernier indice. */
(function (global) {
  "use strict";

  /* ============================================================ lecture .xlsx */

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  // Répertoire du zip, dans l'ordre du fichier : de quoi lire chaque élément, et le recopier tel quel
  function repertoire(u8) {
    var i = u8.length - 22, fin = Math.max(0, u8.length - 22 - 65535);
    while (i >= fin && u32(u8, i) !== 0x06054b50) i--;
    if (i < fin) throw new Error("pas-xlsx");
    var n = u16(u8, i + 10), o = u32(u8, i + 16), td = new TextDecoder("utf-8"), l = [];
    for (var k = 0; k < n; k++) {
      if (u32(u8, o) !== 0x02014b50) throw new Error("pas-xlsx");
      var ln = u16(u8, o + 28), le = u16(u8, o + 30), lc = u16(u8, o + 32);
      l.push({ nom: td.decode(u8.subarray(o + 46, o + 46 + ln)).replace(/^\/+/, ""), meth: u16(u8, o + 10),
        crc: u32(u8, o + 16), taille: u32(u8, o + 20), usz: u32(u8, o + 24), local: u32(u8, o + 42) });
      o += 46 + ln + le + lc;
    }
    return l;
  }
  function entrees(u8) {
    var f = {};
    repertoire(u8).forEach(function (e) { f[e.nom.toLowerCase()] = e; });
    return f;
  }
  function donnees(u8, e) {
    var o = e.local;
    if (u32(u8, o) !== 0x04034b50) throw new Error("pas-xlsx");
    var d = o + 30 + u16(u8, o + 26) + u16(u8, o + 28);
    return u8.subarray(d, d + e.taille);
  }

  function extrait(u8, e) {
    var brut;
    try { brut = donnees(u8, e); } catch (err) { return Promise.reject(err); }
    if (e.meth === 0) return Promise.resolve(brut);
    if (e.meth !== 8) return Promise.reject(new Error("pas-xlsx"));
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("navigateur"));
    var flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(flux).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  var ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function texteXml(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, function (m, e) {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITES[e] !== undefined ? ENTITES[e] : m;
    }).replace(/_x([0-9a-f]{4})_/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  // Texte d'un élément riche (<si>, <is>) : la suite de ses <t>, sans la phonétique (<rPh>)
  function textes(xml) {
    xml = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
    var r = /<(?:\w+:)?t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g, m, s = "";
    while ((m = r.exec(xml))) if (m[1]) s += m[1];
    return texteXml(s);
  }
  function attr(a, nom) { var m = new RegExp("(?:^|\\s)" + nom + '="([^"]*)"').exec(a); return m ? texteXml(m[1]) : null; }
  function colonne(lettres) { var c = 0; for (var i = 0; i < lettres.length; i++) c = c * 26 + lettres.charCodeAt(i) - 64; return c - 1; }

  function feuille(xml, partages) {
    var lignes = [], rRow = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g, m, suite = 0;
    while ((m = rRow.exec(xml))) {
      var num = attr(m[1], "r"), li = num ? parseInt(num, 10) - 1 : suite;
      suite = li + 1;
      var ligne = [], rC = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g, c, col = 0;
      var corps = m[2] || "";
      while ((c = rC.exec(corps))) {
        var ref = attr(c[1], "r"), t = attr(c[1], "t") || "n", dedans = c[2] || "";
        if (ref) col = colonne(ref.replace(/\d+$/, ""));
        var v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(dedans), val = null;
        if (t === "inlineStr") { var is = /<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(dedans); val = is ? textes(is[1]) : null; }
        else if (v) {
          if (t === "s") val = partages[parseInt(v[1], 10)];
          else if (t === "str") val = texteXml(v[1]);
          else if (t === "b") val = v[1] === "1";
          else if (t === "e") val = null;
          else if (t === "d") { var d = Date.parse(v[1]); val = isNaN(d) ? null : d / 86400000 + 25569; }
          else { val = parseFloat(v[1]); if (isNaN(val)) val = null; }
        }
        if (val !== null && val !== undefined) ligne[col] = val;
        col++;
      }
      for (var k = 0; k < ligne.length; k++) if (ligne[k] === undefined) ligne[k] = null;
      lignes[li] = ligne;
    }
    return lignes;
  }

  // Le classeur tel qu'il est écrit : ses feuilles (nom, chemin, XML) et ses chaînes partagées
  function classeurBrut(u8) {
    var f;
    try { f = entrees(u8); } catch (e) { return Promise.reject(e); }
    var td = new TextDecoder("utf-8");
    function xml(nom) {
      var e = f[nom.toLowerCase()];
      return e ? extrait(u8, e).then(function (b) { return td.decode(b); }) : Promise.resolve(null);
    }
    return Promise.all([xml("xl/workbook.xml"), xml("xl/_rels/workbook.xml.rels"), xml("xl/sharedStrings.xml")]).then(function (r) {
      if (!r[0]) throw new Error("pas-xlsx");
      var cibles = {}, m, rRel = /<(?:\w+:)?Relationship\b([^>]*)\/?>/g;
      while ((m = rRel.exec(r[1] || ""))) {
        var cible = attr(m[1], "Target") || "";
        cibles[attr(m[1], "Id")] = cible[0] === "/" ? cible.slice(1) : "xl/" + cible.replace(/^\.\//, "");
      }
      var partages = [], rSi = /<(?:\w+:)?si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g;
      while ((m = rSi.exec(r[2] || ""))) partages.push(m[1] ? textes(m[1]) : "");
      var feuilles = [], rSh = /<(?:\w+:)?sheet\b([^>]*)\/?>/g;
      while ((m = rSh.exec(r[0]))) {
        var id = /\s[\w]+:id="([^"]*)"/.exec(m[1]);
        feuilles.push({ nom: attr(m[1], "name"), chemin: id ? cibles[id[1]] : null });
      }
      return Promise.all(feuilles.map(function (s) {
        return s.chemin ? xml(s.chemin).then(function (x) { s.xml = x; return s; }) : s;
      })).then(function (fs) { return { feuilles: fs, partages: partages }; });
    });
  }

  function lire(octets) {
    var u8 = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
    return classeurBrut(u8).then(function (cb) {
      return { feuilles: cb.feuilles.map(function (s) { return { nom: s.nom, lignes: s.xml ? feuille(s.xml, cb.partages) : [] }; }) };
    });
  }

  /* ============================================================ écriture .xlsx
     annote(octets, marque, titre) : le même classeur, avec une colonne de plus
     (« Traité ») au bout de chaque feuille de nomenclature. marque(code, indice)
     donne le texte de la cellule, ou rien. Tout le reste est recopié octet pour
     octet ; seules les feuilles touchées sont réécrites, puis recompressées
     (CompressionStream). Les lignes sont reconnues comme à la lecture : même
     en-tête (« Libellé du document »), même numéro de plan, même indice. */
  function lettres(i) { var s = ""; i++; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
  function echappe(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function ecritFeuille(xml, h, marques, col, titre) {
    var L = lettres(col), suite = 0;
    var out = xml.replace(/(<(\w+:)?row\b)([^>]*?)(\/>|>([\s\S]*?)(<\/(?:\w+:)?row>))/g, function (tout, debut, p, attrs, fin, corps, ferme) {
      var n = attr(attrs, "r"), li = n ? parseInt(n, 10) - 1 : suite, num = li + 1;
      suite = li + 1;
      var txt = li === h ? titre : marques[li];
      if (!txt || fin === "/>") return tout;
      p = p || "";
      var a2 = attrs.replace(/spans="(\d+):(\d+)"/, function (m, x, y) { return 'spans="' + x + ":" + Math.max(+y, col + 1) + '"'; });
      // la cellule prend le style de sa voisine : l'en-tête reste un en-tête
      var cs = corps.match(/<(?:\w+:)?c\b[^>]*>/g), s = cs ? attr(cs[cs.length - 1], "s") : null;
      return debut + a2 + ">" + corps + "<" + p + 'c r="' + L + num + '"' + (s ? ' s="' + s + '"' : "") + ' t="inlineStr"><' + p + "is><" + p + 't xml:space="preserve">' +
        echappe(txt) + "</" + p + "t></" + p + "is></" + p + "c>" + ferme;
    });
    out = out.replace(/(<(?:\w+:)?dimension\s+ref="[A-Z]+\d+:)([A-Z]+)(\d+")/, function (m, a, c, d) { return colonne(c) < col ? a + L + d : m; });
    // Largeur de la nouvelle colonne, si le classeur déclare les siennes et qu'aucune ne la couvre déjà
    var cols = /<((?:\w+:)?)cols>([\s\S]*?)<\/(?:\w+:)?cols>/.exec(out);
    if (cols) {
      var maxi = 0, rM = /\bmax="(\d+)"/g, mm;
      while ((mm = rM.exec(cols[2]))) maxi = Math.max(maxi, +mm[1]);
      if (maxi < col + 1) out = out.replace(/<\/((?:\w+:)?)cols>/, '<$1col min="' + (col + 1) + '" max="' + (col + 1) + '" width="38" customWidth="1"/></$1cols>');
    }
    return out;
  }

  var TABLE_CRC = null;
  function crc32(u8) {
    if (!TABLE_CRC) {
      TABLE_CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABLE_CRC[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = TABLE_CRC[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function comprime(brut) {
    if (typeof CompressionStream === "undefined") return Promise.resolve({ meth: 0, data: brut });   // stocké tel quel : plus lourd, mais valable
    var flux = new Blob([brut]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Response(flux).arrayBuffer().then(function (b) { return { meth: 8, data: new Uint8Array(b) }; });
  }
  function zippe(els) {
    var te = new TextEncoder(), noms = els.map(function (e) { return te.encode(e.nom); }), total = 22;
    els.forEach(function (e, i) { total += 30 + 46 + 2 * noms[i].length + e.data.length; });
    var out = new Uint8Array(total), dv = new DataView(out.buffer), o = 0, offs = [];
    els.forEach(function (e, i) {
      offs.push(o);
      dv.setUint32(o, 0x04034b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 0x0800, true);
      dv.setUint16(o + 8, e.meth, true); dv.setUint16(o + 10, 0, true); dv.setUint16(o + 12, 0x21, true);
      dv.setUint32(o + 14, e.crc, true); dv.setUint32(o + 18, e.data.length, true); dv.setUint32(o + 22, e.usz, true);
      dv.setUint16(o + 26, noms[i].length, true); dv.setUint16(o + 28, 0, true);
      out.set(noms[i], o + 30); out.set(e.data, o + 30 + noms[i].length);
      o += 30 + noms[i].length + e.data.length;
    });
    var debut = o;
    els.forEach(function (e, i) {
      dv.setUint32(o, 0x02014b50, true); dv.setUint16(o + 4, 20, true); dv.setUint16(o + 6, 20, true); dv.setUint16(o + 8, 0x0800, true);
      dv.setUint16(o + 10, e.meth, true); dv.setUint16(o + 12, 0, true); dv.setUint16(o + 14, 0x21, true);
      dv.setUint32(o + 16, e.crc, true); dv.setUint32(o + 20, e.data.length, true); dv.setUint32(o + 24, e.usz, true);
      dv.setUint16(o + 28, noms[i].length, true);
      out.set(noms[i], o + 46);
      dv.setUint32(o + 42, offs[i], true);
      o += 46 + noms[i].length;
    });
    dv.setUint32(o, 0x06054b50, true); dv.setUint16(o + 8, els.length, true); dv.setUint16(o + 10, els.length, true);
    dv.setUint32(o + 12, o - debut, true); dv.setUint32(o + 16, debut, true);
    return out;
  }

  function annote(octets, marque, titre) {
    var u8 = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
    var liste;
    try { liste = repertoire(u8); } catch (e) { return Promise.reject(e); }
    return classeurBrut(u8).then(function (cb) {
      var modifs = {}, nbMarques = 0;
      cb.feuilles.forEach(function (s) {
        if (!s.xml || !s.chemin) return;
        var rows = feuille(s.xml, cb.partages), h = -1, r, j;
        for (r = 0; r < Math.min(rows.length, 20); r++) if ((rows[r] || []).indexOf("Libellé du document") >= 0) { h = r; break; }
        if (h < 0) return;
        var entete = rows[h], iInd = -1, iLib = -1, visas = false;
        entete.forEach(function (c, j) {
          if (typeof c !== "string") return;
          if (c.indexOf("\n") > 0) visas = true;
          else if (c.trim() === "Indice") iInd = j;
          else if (c.trim() === "Libellé du document") iLib = j;
        });
        if (iInd < 0 || !visas) return;                         // feuille hors circuit : ses plans ne sont pas dans la liste
        var nomenc = [], col = 0, marques = {};
        for (j = 0; j < iInd; j++) if (entete[j]) nomenc.push(j);
        rows.forEach(function (a) { if (a && a.length > col) col = a.length; });
        for (r = h + 1; r < rows.length; r++) {
          var a = rows[r];
          if (!a || vide(a[iLib])) continue;
          var code = nomenc.map(function (j) { return a[j] === null || a[j] === undefined ? "" : String(a[j]); }).join("-");
          var t = marque(code, parseInt(a[iInd], 10) || 0);
          if (t) { marques[r] = t; nbMarques++; }
        }
        modifs[s.chemin.toLowerCase()] = ecritFeuille(s.xml, h, marques, col, titre || "Traité");
      });
      var te = new TextEncoder();
      return Promise.all(liste.map(function (e) {
        var neuf = modifs[e.nom.toLowerCase()];
        if (neuf === undefined) return { nom: e.nom, meth: e.meth, crc: e.crc, usz: e.usz, data: donnees(u8, e) };
        var brut = te.encode(neuf);
        return comprime(brut).then(function (c) { return { nom: e.nom, meth: c.meth, crc: crc32(brut), usz: brut.length, data: c.data }; });
      })).then(function (els) { return { octets: zippe(els), marques: nbMarques }; });
    });
  }

  /* ============================================================ jeu de données */

  var CHAMPS = {
    "Date demande visa": "dd", "Retard visa": "ret", "Date visa": "dv", "Visa": "v",
    "Commentaire visa": "com", "Réponse commentaire visa": "rep", "Pièces jointes visa": "pj"
  };

  var FAMILLE = {
    VSO: "bon", BPE: "bon", BPD: "bon",
    VAO: "obs", OBS: "obs",
    REF: "mauvais", "R&R": "mauvais", REJ: "mauvais"
  };
  function famille(code) { return FAMILLE[code] || "neutre"; }

  function vide(x) { return x === null || x === undefined || (typeof x === "string" && x.trim() === ""); }
  function num(x) { return typeof x === "number" && isFinite(x) ? x : null; }
  function txt(x) { return vide(x) ? null : String(x).trim(); }

  function parse(classeur) {
    var strs = [], strIdx = Object.create(null);
    function S(s) {
      if (s === null) return -1;
      if (!(s in strIdx)) { strIdx[s] = strs.length; strs.push(s); }
      return strIdx[s];
    }
    var circuits = [], docs = [], visas = [], edition = null, extras = 0;

    classeur.feuilles.forEach(function (fe) {
      var rows = fe.lignes, meta = {}, r, j;
      for (r = 0; r < Math.min(rows.length, 6); r++) {
        var a = rows[r] || [];
        if (typeof a[0] === "string") {
          if (/^Charte/i.test(a[0])) meta.charte = txt(a[1]);
          if (/^Circuit de visa/i.test(a[0])) meta.circuit = txt(a[1]);
          if (/^Date .dition/i.test(a[0])) meta.edition = num(a[1]);
        }
      }
      // L'export porte l'heure de sa première feuille (cellule B4) : Kairnial écrit les
      // feuilles l'une après l'autre, la dernière peut avoir une minute de plus.
      if (meta.edition && edition === null) edition = meta.edition;
      var h = -1;
      for (r = 0; r < Math.min(rows.length, 20); r++) if ((rows[r] || []).indexOf("Libellé du document") >= 0) { h = r; break; }
      if (h < 0) return;
      var entete = rows[h], col = {}, blocs = {}, ordre = [];
      entete.forEach(function (c, j) {
        if (typeof c !== "string") return;
        var k = c.indexOf("\n");
        if (k > 0) {
          var champ = CHAMPS[c.slice(0, k).trim()], qui = c.slice(k + 1).trim();
          if (!champ) return;
          if (!blocs[qui]) { blocs[qui] = {}; ordre.push(qui); }
          blocs[qui][champ] = j;
        } else col[c.trim()] = j;
      });
      var iLib = col["Libellé du document"], iInd = col["Indice"];
      if (!ordre.length || iInd === undefined) {
        // Dépôts hors charte ou sans visa (maquettes…) : seulement comptés
        for (r = h + 1; r < rows.length; r++) if (rows[r] && !vide(rows[r][iLib])) extras++;
        return;
      }
      var nomenc = [];
      for (j = 0; j < iInd; j++) if (entete[j]) nomenc.push(j);
      var ci = circuits.length;
      circuits.push({ nom: meta.circuit || fe.nom, feuille: fe.nom, charte: meta.charte, inters: ordre.map(S), edition: meta.edition });
      var iType = col["Type de Document"], iNiv = col["Niveau"], iZone = col["Zone"];
      for (r = h + 1; r < rows.length; r++) {
        var a = rows[r];
        if (!a || vide(a[iLib])) continue;
        var di = docs.length;
        docs.push([ci, nomenc.map(function (j) { return a[j] === null || a[j] === undefined ? "" : String(a[j]); }).join("-"),
          txt(a[iType]) || "", txt(a[iNiv]) || "", txt(a[iZone]) || "",
          parseInt(a[iInd], 10) || 0, S(txt(a[iLib])), txt(a[col["Dernier indice"]]) === "DI" ? 1 : 0,
          num(a[col["Date dépôt GED"]]), S(txt(a[col["Ajouté par"]])), S(txt(a[col["Commentaire libre"]]))]);
        ordre.forEach(function (qui, k) {
          var b = blocs[qui];
          var dd = num(a[b.dd]), dv = num(a[b.dv]), v = a[b.v], ret = num(a[b.ret]);
          var code = null, cpt = null;
          if (typeof v === "string" && v.trim() !== "") code = v.trim();
          else if (typeof v === "number" && dv !== null) code = String(v);
          else if (typeof v === "number") cpt = v;
          if (code === null && cpt === null && dd === null) return;   // hors circuit
          visas.push([di, k, dd, dv, code === null ? -1 : S(code), cpt, ret, S(txt(a[b.com])), S(txt(a[b.pj]))]);
        });
      }
    });
    return { v: 1, edition: edition, circuits: circuits, docs: docs, visas: visas, strs: strs, extras: extras };
  }

  function inflate(J) {
    var s = function (i) { return i < 0 ? null : J.strs[i]; };
    var circuits = J.circuits.map(function (c) { return { nom: c.nom, feuille: c.feuille, inters: c.inters.map(s), edition: c.edition || null }; });
    var docs = J.docs.map(function (d, i) {
      return { id: i, circuit: circuits[d[0]].nom, circ: circuits[d[0]], code: d[1], type: d[2], niveau: d[3], zone: d[4],
        ind: d[5], lib: s(d[6]), di: !!d[7], dep: d[8], auteur: s(d[9]), comLibre: s(d[10]), visas: [] };
    });
    var visas = J.visas.map(function (x) {
      var d = docs[x[0]];
      var v = { doc: d, qui: d.circ.inters[x[1]], dd: x[2], dv: x[3],
        code: s(x[4]), cpt: x[5], ret: x[6], com: s(x[7]), pj: s(x[8]) };
      v.etat = v.code !== null ? "rendu" : (v.cpt !== null ? "attente" : "abandon");
      d.visas.push(v);
      return v;
    });
    var D = { edition: J.edition, circuits: circuits, docs: docs, visas: visas, extras: J.extras || 0 };
    prepare(D);
    return D;
  }

  function mode(arr) {
    var n = {}, best = null, bn = 0;
    arr.forEach(function (x) { n[x] = (n[x] || 0) + 1; if (n[x] > bn) { bn = n[x]; best = x; } });
    return best;
  }

  /* Ce qui ne dépend pas des filtres : vrai dernier indice, délais, statut de chaque plan */
  function prepare(D) {
    var parCode = {};
    D.docs.forEach(function (d) { (parCode[d.code] = parCode[d.code] || []).push(d); });
    D.parCode = parCode;
    D.codes = Object.keys(parCode);
    D.codes.forEach(function (c) {
      var l = parCode[c], mx = Math.max.apply(null, l.map(function (d) { return d.ind; }));
      l.forEach(function (d) { d.maxInd = mx; d.depasse = d.ind < mx; });
    });
    // Délai contractuel de chaque intervenant, retrouvé à partir des chiffres de Kairnial :
    // visa rendu en retard : délai = retard + jours écoulés ; visa attendu : délai = compte à rebours + âge.
    var cand = {};
    D.visas.forEach(function (v) {
      var k = v.doc.circuit + "|" + v.qui;
      if (v.etat === "rendu" && v.dd !== null && v.dv !== null && v.ret !== null) (cand[k] = cand[k] || []).push(v.ret + Math.floor(v.dv - v.dd));
      else if (v.etat === "attente" && v.dd !== null && (v.doc.circ.edition || D.edition)) {
        // le compte à rebours date de l'écriture de SA feuille
        (cand[k] = cand[k] || []).push(v.cpt + Math.floor((v.doc.circ.edition || D.edition) - v.dd));
      }
    });
    D.delai = {};
    Object.keys(cand).forEach(function (k) { D.delai[k] = mode(cand[k]); });
    D.visas.forEach(function (v) {
      var dl = D.delai[v.doc.circuit + "|" + v.qui];
      v.delai = dl === undefined ? null : dl;
      if (v.etat === "rendu") {
        v.jours = v.dd !== null && v.dv !== null ? Math.max(0, Math.floor(v.dv - v.dd)) : null;
        v.retard = v.ret !== null ? -v.ret : 0;
        v.famille = famille(v.code);
      } else if (v.etat === "attente") v.retard = v.cpt < 0 ? -v.cpt : 0;
    });
    // Un plan = son indice le plus élevé, tous circuits confondus
    D.plans = D.codes.map(function (c) {
      var l = parCode[c].slice().sort(function (a, b) { return a.ind - b.ind || (a.dep || 0) - (b.dep || 0); });
      var d = l[l.length - 1];
      var p = { code: c, doc: d, versions: l, statut: statutDe(d) };
      p.premierDepot = Math.min.apply(null, l.map(function (x) { return x.dep || Infinity; }));
      return p;
    });
    renumerotes(D);
  }

  /* Plans refaits sous un autre numéro : même type, même niveau, même zone et
     même libellé, mais un autre numéro à quatre chiffres. Kairnial y voit deux
     plans, et l'ancien garde ses visas (souvent un refus). Le plus récemment
     déposé est tenu pour le plan en cours ; les autres sont marqués remplacés,
     indices compris, et sortent des comptes quand on masque ce qui est remplacé. */
  function libelleNormalise(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\.(pdf|dwg|zip|xlsx?)$/, "")
      .replace(/^[a-z0-9]+(?:[-_][a-z0-9]+){4,}\s*-\s*/, "")        // numéro GED recopié en tête du libellé
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  function renumerotes(D) {
    var groupes = {};
    D.plans.forEach(function (p) {
      var lib = libelleNormalise(p.doc.lib);
      if (!lib) return;
      var k = [p.doc.type, p.doc.niveau, p.doc.zone, lib].join("|");
      (groupes[k] = groupes[k] || []).push(p);
    });
    Object.keys(groupes).forEach(function (k) {
      var l = groupes[k];
      if (l.length < 2) return;
      l.sort(function (a, b) { return (b.doc.dep || 0) - (a.doc.dep || 0) || (a.code < b.code ? -1 : 1); });
      var actuel = l[0];
      actuel.remplace = l.slice(1).map(function (p) { return p.code; });
      l.slice(1).forEach(function (p) {
        p.renumerote = true;
        p.remplacePar = actuel.code;
        p.versions.forEach(function (d) { d.renumerote = true; });
      });
    });
  }

  function trouver(d, qui) {
    for (var i = 0; i < d.visas.length; i++) if (d.visas[i].qui === qui) return d.visas[i];
    return null;
  }

  var STATUTS = [
    { id: "valide", nom: "Validé par le MO (VSO)", groupe: "bon" },
    { id: "valide_obs", nom: "Validé avec observations (VAO)", groupe: "obs" },
    { id: "attente", nom: "En attente du MO", groupe: "cours" },
    { id: "sas_cours", nom: "En cours au SAS", groupe: "cours" },
    { id: "reprendre", nom: "Refusé par le MO (REF, R&R)", groupe: "mauvais" },
    { id: "sas_rejet", nom: "Rejeté au SAS", groupe: "mauvais" },
    { id: "autre", nom: "Autre (stoppé, non visé, hors circuit)", groupe: "neutre" }
  ];

  /* Le circuit fixe la règle : là où le MO vise, son visa décide ; dans un circuit
     à Doc Control (le « SAS »), le Doc Control puis les autres ; ailleurs, tous les visas. */
  function statutDe(d) {
    var inters = d.visas;
    if (d.circ.inters.indexOf("MO") >= 0) {
      var mo = trouver(d, "MO");
      if (!mo) return "autre";
      if (mo.etat === "attente") return "attente";
      if (mo.etat !== "rendu") return "autre";
      if (mo.code === "VSO") return "valide";
      if (mo.code === "VAO") return "valide_obs";
      if (famille(mo.code) === "mauvais") return "reprendre";
      return "autre";
    }
    if (d.circ.inters.indexOf("DOC CONTROL") >= 0) {
      var dc = trouver(d, "DOC CONTROL");
      if (!dc) return "autre";
      if (dc.etat === "rendu" && dc.famille === "mauvais") return "sas_rejet";
      if (dc.etat === "attente") return "sas_cours";
      var autres = inters.filter(function (v) { return v !== dc; });
      if (autres.some(function (v) { return v.etat === "rendu" && v.famille === "mauvais"; })) return "sas_rejet";
      if (autres.some(function (v) { return v.etat === "attente"; })) return "sas_cours";
      return "autre";
    }
    if (inters.some(function (v) { return v.etat === "rendu" && v.famille === "mauvais"; })) return "reprendre";
    if (inters.some(function (v) { return v.etat === "attente"; })) return "attente";
    if (inters.length && inters.every(function (v) { return v.etat === "rendu"; })) {
      return inters.some(function (v) { return v.famille === "obs"; }) ? "valide_obs" : "valide";
    }
    return "autre";
  }

  /* ============================================================ indicateurs */

  function trie(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  function mediane(a) {
    if (!a.length) return null;
    var s = trie(a), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(a, q) {
    if (!a.length) return null;
    var s = trie(a), p = (s.length - 1) * q, b = Math.floor(p);
    return s[b] + (s[Math.min(b + 1, s.length - 1)] - s[b]) * (p - b);
  }
  function moyenne(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function serialVersDate(s) { return new Date(Math.round((s - 25569) * 86400000)); }
  function mois(s) { var d = serialVersDate(s); return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2); }
  function trimestre(s) { var d = serialVersDate(s); return d.getUTCFullYear() + " T" + (Math.floor(d.getUTCMonth() / 3) + 1); }

  // Motifs des retours du Doc Control, lus dans ses commentaires
  var MOTIFS = [
    ["Ingénieur façade absent du cartouche", /fa[çc]ade/i],
    ["Plan absent de la LID", /\bLID\b/i],
    ["Zone ou étage différent de la nomenclature", /zone|[ée]tage|niveau/i],
    ["Cartouche obsolète, « provisoire » ou mal placé", /obsol|provisoire|d[ée]placer le cartouche|page de garde|logo/i],
    ["Type de document différent", /type d/i],
    ["Numéro de document différent", /num[ée]ro/i],
    ["Indice différent", /indice ne corr|erreur d.indice|corriger l.indice/i],
    ["Indice supérieur déjà déposé", /sup[ée]rieur|en attente de l/i]
  ];

  var TRANCHES = [["Dans le délai", 0, 0], ["1 à 7 j de retard", 1, 7], ["8 à 30 j", 8, 30], ["31 à 90 j", 31, 90], ["Plus de 90 j", 91, 1e9]];

  var SANS_NOM = "(sans-nom)";                          // dépôt sans « Ajouté par »
  function auteurDe(d) { return d.auteur || SANS_NOM; }

  function analyse(D, f) {
    f = f || {};
    // dernierSeul : les indices remplacés (un indice plus élevé existe, dans ce circuit ou un autre)
    // sortent de tous les comptes ; un plan, lui, est toujours pris à son dernier indice.
    var okBase = function (d) {
      return (!f.circuit || f.circuit === "tous" || d.circuit === f.circuit) && (!f.type || f.type === "tous" || d.type === f.type) &&
        (!f.auteur || f.auteur === "tous" || auteurDe(d) === f.auteur);
    };
    var ok = function (d) { return okBase(d) && (!f.dernierSeul || (!d.depasse && !d.renumerote)); };
    var R = { edition: D.edition };
    var plans = D.plans.filter(function (p) { return ok(p.doc); });
    R.plans = plans;
    R.nbPlans = plans.length;
    R.statuts = STATUTS.map(function (s) {
      return { id: s.id, nom: s.nom, groupe: s.groupe, n: plans.filter(function (p) { return p.statut === s.id; }).length };
    });
    var visas = D.visas.filter(function (v) { return ok(v.doc); });

    // Intervenants
    var parInter = {};
    visas.forEach(function (v) {
      var k = v.doc.circuit + "|" + v.qui;
      var o = parInter[k] = parInter[k] || { circuit: v.doc.circuit, qui: v.qui, delai: v.delai, rendus: [], attente: [], abandon: 0 };
      if (v.etat === "rendu") o.rendus.push(v); else if (v.etat === "attente") o.attente.push(v); else o.abandon++;
    });
    R.inters = Object.keys(parInter).map(function (k) {
      var o = parInter[k];
      var j = o.rendus.map(function (v) { return v.jours; }).filter(function (x) { return x !== null; });
      var late = o.rendus.filter(function (v) { return v.retard > 0; });
      var att = o.attente.filter(function (v) { return !v.doc.depasse; });
      var attRet = att.filter(function (v) { return v.retard > 0; });
      return {
        circuit: o.circuit, qui: o.qui, delai: o.delai, n: o.rendus.length,
        mediane: mediane(j), horsDelai: o.rendus.length ? late.length / o.rendus.length : null,
        retardMoyen: moyenne(late.map(function (v) { return v.retard; })),
        attente: att.length, attenteRetard: attRet.length,
        attenteRetardMedian: mediane(attRet.map(function (v) { return v.retard; })),
        attenteDepassee: o.attente.length - att.length, abandon: o.abandon
      };
    }).filter(function (o) { return o.n + o.attente + o.attenteDepassee > 0; });

    // Visas en attente par ancienneté
    R.tranches = TRANCHES.map(function (t) { return t[0]; });
    R.attente = R.inters.filter(function (o) { return o.attente + o.attenteDepassee > 0; }).map(function (o) {
      var l = visas.filter(function (v) { return v.etat === "attente" && v.qui === o.qui && v.doc.circuit === o.circuit; });
      var compte = function (liste) {
        return TRANCHES.map(function (t) { return liste.filter(function (v) { return v.retard >= t[1] && v.retard <= t[2]; }).length; });
      };
      return { circuit: o.circuit, qui: o.qui, delai: o.delai,
        valides: compte(l.filter(function (v) { return !v.doc.depasse; })), toutes: compte(l) };
    });

    // Visas du MO par mois ; relève aussi le passage d'un code défavorable à un autre (REF puis R&R)
    var moV = visas.filter(function (v) { return v.qui === "MO" && v.etat === "rendu" && v.dv !== null; });
    var pm = {};
    moV.forEach(function (v) {
      var m = mois(v.dv), o = pm[m] = pm[m] || { mois: m, VSO: 0, VAO: 0, mauvais: 0, neutre: 0, codes: {} };
      if (v.code === "VSO") o.VSO++; else if (v.code === "VAO") o.VAO++;
      else if (famille(v.code) === "mauvais") o.mauvais++; else o.neutre++;
      o.codes[v.code] = (o.codes[v.code] || 0) + 1;
    });
    R.moMois = Object.keys(pm).sort().map(function (k) { var o = pm[k]; o.n = o.VSO + o.VAO + o.mauvais + o.neutre; return o; });
    // Premier mois où R&R dépasse REF, après des mois où REF servait seul : le MO a changé de code
    R.moRelais = null;
    var refSeul = false;
    R.moMois.forEach(function (o) {
      var ref = o.codes.REF || 0, rr = o.codes["R&R"] || 0;
      if (ref && !rr) refSeul = true;
      if (!R.moRelais && refSeul && rr > ref) R.moRelais = { mois: o.mois, de: "REF", vers: "R&R" };
    });

    // Plans déposés par mois et par personne (« Ajouté par ») : tous les dépôts comptent,
    // anciens indices et plans remplacés compris — c'est l'activité de l'équipe qu'on mesure.
    var depMois = {}, depQui = {}, depTotal = 0;
    D.docs.forEach(function (d) {
      if (!okBase(d) || d.dep === null) return;
      var m = mois(d.dep), a = auteurDe(d);
      var o = depMois[m] = depMois[m] || { mois: m, n: 0, par: {} };
      o.n++; o.par[a] = (o.par[a] || 0) + 1;
      depQui[a] = (depQui[a] || 0) + 1;
      depTotal++;
    });
    R.depots = {
      total: depTotal,
      mois: Object.keys(depMois).sort().map(function (k) { return depMois[k]; }),
      parQui: depQui
    };

    // Parcours jusqu'à la validation du MO
    var cycles = [], refusAvant = [0, 0, 0, 0], premier = {}, nbAvecMo = 0;
    plans.forEach(function (p) {
      var mv = [];
      D.parCode[p.code].forEach(function (d) { var m = trouver(d, "MO"); if (m && m.etat === "rendu") mv.push(m); });
      if (!mv.length) return;
      nbAvecMo++;
      mv.sort(function (a, b) { return a.doc.ind - b.doc.ind || (a.dv || 0) - (b.dv || 0); });
      premier[mv[0].code] = (premier[mv[0].code] || 0) + 1;
      var fav = mv.filter(function (v) { return v.code === "VSO" || v.code === "VAO"; });
      if (!fav.length) return;
      var i0 = fav[0].doc.ind;
      refusAvant[Math.min(3, mv.filter(function (v) { return famille(v.code) === "mauvais" && v.doc.ind < i0; }).length)]++;
      var dvMin = Math.min.apply(null, fav.map(function (v) { return v.dv; }));
      if (isFinite(p.premierDepot)) cycles.push(Math.floor(dvMin - p.premierDepot));
    });
    R.parcours = {
      nbAvecMo: nbAvecMo, nbValides: cycles.length, premier: premier, refusAvant: refusAvant,
      mediane: mediane(cycles), q1: quantile(cycles, 0.25), q3: quantile(cycles, 0.75),
      histo: [[0, 20], [21, 40], [41, 90], [91, 180], [181, 1e9]].map(function (b) {
        return cycles.filter(function (c) { return c >= b[0] && c <= b[1]; }).length;
      })
    };

    // Doc Control : taux de rejet par trimestre, motifs
    var dcV = visas.filter(function (v) { return v.qui === "DOC CONTROL" && v.etat === "rendu" && v.dv !== null; });
    var pt = {};
    dcV.forEach(function (v) {
      var t = trimestre(v.dv), o = pt[t] = pt[t] || { t: t, n: 0, rej: 0, obs: 0 };
      o.n++; if (v.famille === "mauvais") o.rej++; if (v.famille === "obs") o.obs++;
    });
    R.dcTrim = Object.keys(pt).sort().map(function (k) { return pt[k]; });
    var dcRet = dcV.filter(function (v) { return v.famille !== "bon"; });
    R.dcRetours = dcRet.length;
    R.motifs = MOTIFS.map(function (m) {
      return { nom: m[0], n: dcRet.filter(function (v) { return v.com && m[1].test(v.com); }).length };
    }).sort(function (a, b) { return b.n - a.n; });
    R.motifsAutres = dcRet.filter(function (v) { return !MOTIFS.some(function (m) { return v.com && m[1].test(v.com); }); }).length;

    // Points de vigilance : la qualité de tout l'export, indices remplacés compris
    var docsF = D.docs.filter(okBase), circuitsParCode = {}, libs = {}, indices = {};
    var visasB = f.dernierSeul ? D.visas.filter(function (v) { return okBase(v.doc); }) : visas;
    docsF.forEach(function (d) {
      (circuitsParCode[d.code] = circuitsParCode[d.code] || {})[d.circuit] = 1;
      (libs[d.code] = libs[d.code] || {})[d.lib] = 1;
      (indices[d.code] = indices[d.code] || {})[d.ind] = 1;
    });
    R.qualite = {
      attenteFantomes: visasB.filter(function (v) { return v.etat === "attente" && v.doc.depasse; }).length,
      diFaux: docsF.filter(function (d) { return d.di && d.depasse; }).length,
      aSupprimer: docsF.filter(function (d) { return d.di && !d.depasse && d.comLibre && /supprimer|obsol/i.test(d.comLibre); }).length,
      deuxCircuits: Object.keys(circuitsParCode).filter(function (c) { return Object.keys(circuitsParCode[c]).length > 1; }).length,
      libellesVariables: Object.keys(libs).filter(function (c) { return Object.keys(libs[c]).length > 1; }).length,
      indicesManquants: Object.keys(indices).filter(function (c) {
        var k = Object.keys(indices[c]).map(Number); return k.length < Math.max.apply(null, k) + 1;
      }).length,
      visaAvantDemande: visasB.filter(function (v) { return v.etat === "rendu" && v.dd !== null && v.dv !== null && v.dv < v.dd; }).length,
      renduTotal: visas.filter(function (v) { return v.etat === "rendu"; }).length,
      renduTous: visasB.filter(function (v) { return v.etat === "rendu"; }).length,
      indicesComptes: f.dernierSeul ? docsF.filter(function (d) { return !d.depasse && !d.renumerote; }).length : docsF.length,
      renumerotes: D.plans.filter(function (p) { return p.renumerote && okBase(p.doc); }).length,
      lignes: docsF.length
    };
    return R;
  }

  global.Visas = { lire: lire, parse: parse, inflate: inflate, analyse: analyse, famille: famille, STATUTS: STATUTS, serialVersDate: serialVersDate,
    SANS_NOM: SANS_NOM, auteurDe: auteurDe, annote: annote };
  if (typeof module !== "undefined" && module.exports) module.exports = global.Visas;
})(typeof window !== "undefined" ? window : globalThis);
