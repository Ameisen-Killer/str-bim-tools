// CSV Studio — noyau sans interface : décodage, détection du séparateur, lecture et écriture CSV,
// classeurs .xlsx (lecture et écriture, archive ZIP maison), JSON, nombres, dates, formules, profil de colonne.
// Tout se passe dans le navigateur : aucun appel réseau, aucune bibliothèque.
(function(){
  "use strict";
  var C = {};

  // ====================================================================================================
  // Encodages
  // ====================================================================================================
  // Windows-1252 : les 32 positions 0x80–0x9F qui ne suivent pas Latin-1
  var CP1252 = [0x20AC,0x81,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0160,0x2039,0x0152,0x8D,0x017D,0x8F,
                0x90,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,0x9D,0x017E,0x0178];
  var VERS_1252 = {};
  CP1252.forEach(function(u, i){ if (u > 0xFF) VERS_1252[u] = 0x80 + i; });

  C.ENCODAGES = [["utf-8", "UTF-8"], ["utf-8-bom", "UTF-8 avec BOM (Excel)"], ["windows-1252", "Windows-1252 (ANSI)"], ["utf-16le", "UTF-16"]];
  C.nomEncodage = function(e){
    for (var i = 0; i < C.ENCODAGES.length; i++) if (C.ENCODAGES[i][0] === e) return C.ENCODAGES[i][1];
    return e === "utf-16be" ? "UTF-16 BE" : String(e || "");
  };

  // Octets → texte. enc « auto » : BOM, puis UTF-16 sans BOM (zéros alternés), puis UTF-8 strict, sinon Windows-1252.
  C.decoder = function(tampon, enc){
    var o = new Uint8Array(tampon), bom = false, i;
    if (!enc || enc === "auto"){
      if (o[0] === 0xEF && o[1] === 0xBB && o[2] === 0xBF){ enc = "utf-8"; bom = true; }
      else if (o[0] === 0xFF && o[1] === 0xFE){ enc = "utf-16le"; bom = true; }
      else if (o[0] === 0xFE && o[1] === 0xFF){ enc = "utf-16be"; bom = true; }
      else {
        var pair = 0, impair = 0, lim = Math.min(o.length, 2000);
        for (i = 0; i < lim; i++) if (o[i] === 0){ if (i & 1) impair++; else pair++; }
        if (lim > 20 && impair > lim * 0.3 && pair < lim * 0.05) enc = "utf-16le";
        else if (lim > 20 && pair > lim * 0.3 && impair < lim * 0.05) enc = "utf-16be";
        else {
          try { return { texte: new TextDecoder("utf-8", { fatal: true }).decode(o), encodage: "utf-8" }; }
          catch (e){ enc = "windows-1252"; }
        }
      }
    }
    var texte = new TextDecoder(enc === "utf-8-bom" ? "utf-8" : enc).decode(o);
    return { texte: texte, encodage: enc === "utf-8" && bom ? "utf-8-bom" : enc };
  };

  // Morceaux de texte → octets. Renvoie { octets:[Uint8Array…], perdus } (caractères absents de Windows-1252).
  C.versOctets = function(morceaux, enc){
    var sortie = [], perdus = 0, te = new TextEncoder();
    if (enc === "utf-8-bom") sortie.push(new Uint8Array([0xEF, 0xBB, 0xBF]));
    if (enc === "utf-16le" || enc === "utf-16be") sortie.push(new Uint8Array([0xFF, 0xFE]));
    morceaux.forEach(function(t){
      var b, i, c, n = t.length;
      if (enc === "utf-16le" || enc === "utf-16be"){
        b = new Uint8Array(n * 2);
        for (i = 0; i < n; i++){ c = t.charCodeAt(i); b[2 * i] = c & 255; b[2 * i + 1] = c >> 8; }
      } else if (enc === "windows-1252"){
        b = new Uint8Array(n);
        for (i = 0; i < n; i++){
          c = t.charCodeAt(i);
          if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) b[i] = c;
          else if (VERS_1252[c]) b[i] = VERS_1252[c];
          else { b[i] = 63; perdus++; }
        }
      } else b = te.encode(t);
      sortie.push(b);
    });
    return { octets: sortie, perdus: perdus };
  };

  // ====================================================================================================
  // CSV : détection, lecture, écriture
  // ====================================================================================================
  // Nombre de champs de chaque enregistrement (guillemets respectés), pour un séparateur donné
  function compterChamps(t, sep, maxi){
    var res = [], n = t.length, nb = 1, dansQ = false, vide = true, c;
    for (var i = 0; i < n && res.length < maxi; i++){
      c = t.charCodeAt(i);
      if (dansQ){ if (c === 34){ if (t.charCodeAt(i + 1) === 34) i++; else dansQ = false; } continue; }
      if (c === 34){ dansQ = true; vide = false; }
      else if (c === sep){ nb++; vide = false; }
      else if (c === 10 || c === 13){
        if (c === 13 && t.charCodeAt(i + 1) === 10) i++;
        if (!vide) res.push(nb);
        nb = 1; vide = true;
      } else vide = false;
    }
    if (!vide && res.length < maxi) res.push(nb);
    return res;
  }

  // Séparateur et fin de ligne d'un texte. Une première ligne « sep=; » (Excel) est reconnue et signalée.
  C.detecter = function(t){
    var ech = t.length > 300000 ? t.slice(0, 300000) : t;
    if (ech.charCodeAt(0) === 0xFEFF) ech = ech.slice(1);
    var fin = ech.indexOf("\r\n") >= 0 ? "\r\n" : ech.indexOf("\n") >= 0 ? "\n" : ech.indexOf("\r") >= 0 ? "\r" : "\r\n";
    var m = /^sep=(.)\r?\n/.exec(ech);
    if (m) return { sep: m[1], fin: fin, ligneSep: true };
    var meilleur = ",", scoreMax = 0;
    ["\t", ";", ",", "|"].forEach(function(s){
      var l = compterChamps(ech, s.charCodeAt(0), 60);
      if (ech.length < t.length && l.length > 1) l.pop();          // le dernier enregistrement de l'échantillon peut être coupé
      if (!l.length) return;
      var freq = {}, mode = 1, fm = 0;
      l.forEach(function(k){ freq[k] = (freq[k] || 0) + 1; if (freq[k] > fm || (freq[k] === fm && k > mode)){ fm = freq[k]; mode = k; } });
      if (mode < 2) return;
      var score = fm / l.length * 1000 + Math.min(mode, 50);
      if (score > scoreMax){ scoreMax = score; meilleur = s; }
    });
    return { sep: meilleur, fin: fin, ligneSep: false };
  };

  // Texte → { lignes, nbCols, irregulieres, vides }. Champs entre guillemets ("" = guillemet), retours à la ligne
  // dans les champs, CRLF / LF / CR. Les lignes entièrement vides sont retirées ; les lignes courtes sont complétées.
  C.analyser = function(t, sep){
    var lignes = [], l = [], i = 0, n = t.length, sc = (sep || ",").charCodeAt(0), c, e, s, j, k, vides = 0;
    if (t.charCodeAt(0) === 0xFEFF) i = 1;
    while (i < n){
      c = t.charCodeAt(i);
      if (c === 34){
        s = ""; j = i + 1;
        for (;;){
          k = t.indexOf('"', j);
          if (k < 0){ s += t.slice(j); j = n; break; }
          s += t.slice(j, k);
          if (t.charCodeAt(k + 1) === 34){ s += '"'; j = k + 2; }
          else { j = k + 1; break; }
        }
        e = j;                                                     // texte collé après le guillemet fermant : gardé tel quel
        while (e < n){ c = t.charCodeAt(e); if (c === sc || c === 10 || c === 13) break; e++; }
        if (e > j) s += t.slice(j, e);
        l.push(s); i = e;
      } else {
        e = i;
        while (e < n){ c = t.charCodeAt(e); if (c === sc || c === 10 || c === 13) break; e++; }
        l.push(t.slice(i, e)); i = e;
      }
      if (i >= n){ lignes.push(l); l = null; break; }
      c = t.charCodeAt(i);
      if (c === sc){
        i++;
        if (i >= n){ l.push(""); lignes.push(l); l = null; }
      } else {
        i += (c === 13 && t.charCodeAt(i + 1) === 10) ? 2 : 1;
        lignes.push(l); l = [];
      }
    }
    var gardees = [], nbCols = 0;
    for (i = 0; i < lignes.length; i++){
      l = lignes[i];
      if (l.length === 1 && l[0] === ""){ vides++; continue; }
      if (l.length > nbCols) nbCols = l.length;
      gardees.push(l);
    }
    var irreg = C.completer(gardees, nbCols);
    return { lignes: gardees, nbCols: nbCols, irregulieres: irreg, vides: vides };
  };

  // Met toutes les lignes à nbCols cellules ; renvoie le nombre de lignes complétées
  C.completer = function(lignes, nbCols){
    var irreg = 0, l;
    for (var i = 0; i < lignes.length; i++){
      l = lignes[i];
      if (l.length < nbCols){ irreg++; while (l.length < nbCols) l.push(""); }
    }
    return irreg;
  };

  // La première ligne ressemble-t-elle à des titres de colonnes ? (toutes remplies, distinctes, ni nombre ni date)
  C.aEntete = function(lignes){
    if (!lignes.length) return false;
    var a = lignes[0], vus = new Set(), v;
    for (var i = 0; i < a.length; i++){
      v = a[i].trim();
      if (!v || vus.has(v) || !isNaN(C.nombre(v)) || !isNaN(C.date(v))) return false;
      vus.add(v);
    }
    return true;
  };

  function echapRe(s){ return s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&"); }
  C.echapRe = echapRe;

  // Tableau → morceaux de texte CSV. o = { sep, guillemets:"besoin"|"toujours", fin }
  C.ecrire = function(entete, lignes, o){
    var sep = o.sep, tous = o.guillemets === "toujours", fin = o.fin || "\r\n";
    var re = new RegExp('["\\r\\n' + echapRe(sep) + "]");
    function champ(v){
      v = v == null ? "" : String(v);
      if (tous || re.test(v) || (v && (v.charCodeAt(0) === 32 || v.charCodeAt(v.length - 1) === 32))) return '"' + v.replace(/"/g, '""') + '"';
      return v;
    }
    function ligne(l){
      var s = "";
      for (var i = 0; i < l.length; i++) s += (i ? sep : "") + champ(l[i]);
      return s + fin;
    }
    var morceaux = [], bloc = entete ? ligne(entete) : "";
    for (var i = 0; i < lignes.length; i++){
      bloc += ligne(lignes[i]);
      if (bloc.length > 1 << 20){ morceaux.push(bloc); bloc = ""; }
    }
    if (bloc) morceaux.push(bloc);
    return morceaux;
  };

  // ====================================================================================================
  // Nombres, dates, types
  // ====================================================================================================
  var RE_NB = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  var RE_MILLIERS = /^[+-]?\d{1,3}(?:[\s  '’]\d{3})+(?:[.,]\d+)?$/;
  var RE_MILLE_PT = /^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;      // 1.234.567,89
  var RE_MILLE_VG = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;      // 1,234,567.89

  // Chaîne → nombre, ou NaN. Accepte « 1234.5 », « 1234,5 », « 1'234.50 », « 1 234,5 », « 1.234,5 », « 1,234.5 », « 1e3 ».
  C.nombre = function(s){
    if (typeof s === "number") return s;
    if (!s) return NaN;
    if (RE_NB.test(s)) return +s;
    var t = s.trim();
    if (!t) return NaN;
    if (t.charCodeAt(0) === 0x2212) t = "-" + t.slice(1);          // signe moins typographique
    if (RE_MILLIERS.test(t)) t = t.replace(/[\s  '’]/g, "").replace(",", ".");
    else if (RE_MILLE_PT.test(t) && (t.indexOf(",") >= 0 || t.indexOf(".") !== t.lastIndexOf("."))) t = t.replace(/\./g, "").replace(",", ".");
    else if (RE_MILLE_VG.test(t) && (t.indexOf(".") >= 0 || t.indexOf(",") !== t.lastIndexOf(","))) t = t.replace(/,/g, "");
    else if (t.indexOf(",") >= 0 && t.indexOf(",") === t.lastIndexOf(",") && t.indexOf(".") < 0) t = t.replace(",", ".");
    return RE_NB.test(t) ? +t : NaN;
  };

  // Un code qui ressemble à un nombre mais doit rester du texte : « 0100 », « 007 »
  C.codeTexte = function(s){ return /^[+-]?0\d/.test(s); };

  var RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
  var RE_EU = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

  // Chaîne → millisecondes UTC, ou NaN. « 2026-11-21 », « 21.11.2026 », « 21/11/26 14:30 »…
  C.date = function(s){
    if (!s || s.length < 6 || s.length > 30) return NaN;
    var t = s.trim(), m = RE_ISO.exec(t), a, mo, j;
    if (m){ a = +m[1]; mo = +m[2]; j = +m[3]; }
    else {
      m = RE_EU.exec(t);
      if (!m) return NaN;
      j = +m[1]; mo = +m[2]; a = +m[3];
      if (m[3].length === 2) a += a < 70 ? 2000 : 1900;
    }
    var h = +(m[4] || 0), mi = +(m[5] || 0), se = +(m[6] || 0);
    if (mo < 1 || mo > 12 || j < 1 || j > 31 || h > 23 || mi > 59 || se > 59) return NaN;
    var ms = Date.UTC(a, mo - 1, j, h, mi, se);
    return new Date(ms).getUTCDate() === j ? ms : NaN;
  };

  function z2(x){ return (x < 10 ? "0" : "") + x; }
  // Millisecondes UTC → texte. fmt : "ch" jj.mm.aaaa · "fr" jj/mm/aaaa · "iso" aaaa-mm-jj ; l'heure suit si elle n'est pas 00:00
  C.formatDate = function(ms, fmt){
    var d = new Date(ms), a = d.getUTCFullYear(), m = z2(d.getUTCMonth() + 1), j = z2(d.getUTCDate());
    var s = fmt === "iso" ? a + "-" + m + "-" + j : fmt === "fr" ? j + "/" + m + "/" + a : j + "." + m + "." + a;
    var h = d.getUTCHours(), mi = d.getUTCMinutes(), se = d.getUTCSeconds();
    if (h || mi || se) s += " " + z2(h) + ":" + z2(mi) + (se ? ":" + z2(se) : "");
    return s;
  };
  // Numéro de série Excel → texte
  C.dateSerie = function(x){
    if (x >= 0 && x < 1){
      var sec = Math.round(x * 86400);
      return z2(Math.floor(sec / 3600)) + ":" + z2(Math.floor(sec / 60) % 60) + (sec % 60 ? ":" + z2(sec % 60) : "");
    }
    return C.formatDate(Math.round((x - 25569) * 86400) * 1000, "ch");
  };

  var RE_BOOL = /^(?:oui|non|vrai|faux|true|false|yes|no)$/i;
  // Type d'une colonne d'après un échantillon de valeurs : "entier", "nombre", "date", "bool", "texte"
  C.typeDe = function(vals){
    var n = 0, nNb = 0, nEnt = 0, nDate = 0, nBool = 0, nCode = 0, v, x;
    for (var i = 0; i < vals.length; i++){
      v = vals[i];
      if (v === "" || v == null) continue;
      n++;
      if (!isNaN(C.date(v))){ nDate++; continue; }
      x = C.nombre(v);
      if (!isNaN(x)){
        if (C.codeTexte(v.trim())) nCode++;
        else { nNb++; if (x === Math.floor(x) && !/[.,eE]/.test(v)) nEnt++; }
      } else if (RE_BOOL.test(v.trim())) nBool++;
    }
    if (!n) return "texte";
    if (nCode > n * 0.1) return "texte";
    if (nDate >= n * 0.9) return "date";
    if (nNb >= n * 0.9) return nEnt === nNb ? "entier" : "nombre";
    if (nBool >= n * 0.9) return "bool";
    return "texte";
  };

  var COLLATEUR = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
  C.comparer = COLLATEUR.compare;

  function sansAccent(s){ return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  C.sansAccent = sansAccent;

  // Nombre → texte sans bruit de virgule flottante (0.1 + 0.2 → « 0.3 »)
  C.texteNombre = function(x){ return isFinite(x) ? String(parseFloat(x.toPrecision(12))) : ""; };

  // ====================================================================================================
  // Archive ZIP (classeurs .xlsx)
  // ====================================================================================================
  var TABLE_CRC = (function(){
    var t = new Uint32Array(256), c;
    for (var n = 0; n < 256; n++){ c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crcSuite(crc, o){
    for (var i = 0; i < o.length; i++) crc = TABLE_CRC[(crc ^ o[i]) & 0xFF] ^ (crc >>> 8);
    return crc;
  }

  // [{ nom, morceaux:[Uint8Array…] }] → Blob ZIP. Compression « deflate » si le navigateur la propose, sinon stockage simple.
  C.zip = async function(fichiers, type){
    var parts = [], centre = [], pos = 0, tailleCentre = 0, te = new TextEncoder();
    for (var k = 0; k < fichiers.length; k++){
      var f = fichiers[k], crc = -1, taille = 0, donnees = f.morceaux, methode = 0, i;
      for (i = 0; i < f.morceaux.length; i++){ crc = crcSuite(crc, f.morceaux[i]); taille += f.morceaux[i].length; }
      crc = (crc ^ -1) >>> 0;
      if (typeof CompressionStream === "function" && taille > 200){
        try {
          var flux = new Blob(f.morceaux).stream().pipeThrough(new CompressionStream("deflate-raw"));
          donnees = [new Uint8Array(await new Response(flux).arrayBuffer())];
          methode = 8;
        } catch (e){ donnees = f.morceaux; methode = 0; }
      }
      var tc = 0;
      for (i = 0; i < donnees.length; i++) tc += donnees[i].length;
      var nom = te.encode(f.nom);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, methode, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, tc, true);
      h.setUint32(22, taille, true); h.setUint16(26, nom.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nom);
      for (i = 0; i < donnees.length; i++) parts.push(donnees[i]);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, methode, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
      c.setUint32(20, tc, true); c.setUint32(24, taille, true); c.setUint16(28, nom.length, true);
      c.setUint32(42, pos, true);                                  // les champs 30 à 41 restent à zéro
      centre.push(new Uint8Array(c.buffer), nom);
      tailleCentre += 46 + nom.length;
      pos += 30 + nom.length + tc;
    }
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, fichiers.length, true); e.setUint16(10, fichiers.length, true);
    e.setUint32(12, tailleCentre, true); e.setUint32(16, pos, true);
    return new Blob(parts.concat(centre, [new Uint8Array(e.buffer)]), { type: type || "application/zip" });
  };

  // Archive ZIP → fonction lire(nom) → Promise<Uint8Array|null>
  function dezip(tampon){
    var o = new Uint8Array(tampon), dv = new DataView(tampon), fin = -1, i;
    for (i = o.length - 22; i >= 0 && i >= o.length - 66000; i--) if (dv.getUint32(i, true) === 0x06054b50){ fin = i; break; }
    if (fin < 0) throw new Error("Ce fichier n'est pas un classeur .xlsx lisible (archive ZIP introuvable).");
    var n = dv.getUint16(fin + 10, true), p = dv.getUint32(fin + 16, true), entrees = {}, td = new TextDecoder();
    for (i = 0; i < n && p + 46 <= o.length; i++){
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      entrees[td.decode(o.subarray(p + 46, p + 46 + nl))] = { meth: dv.getUint16(p + 10, true), tc: dv.getUint32(p + 20, true), loc: dv.getUint32(p + 42, true) };
      p += 46 + nl + el + cl;
    }
    return async function(nom){
      var e = entrees[nom];
      if (!e) return null;
      var d = e.loc + 30 + dv.getUint16(e.loc + 26, true) + dv.getUint16(e.loc + 28, true), brut = o.subarray(d, d + e.tc);
      if (e.meth === 0) return brut;
      if (e.meth !== 8) throw new Error("Compression du classeur non prise en charge.");
      if (typeof DecompressionStream !== "function") throw new Error("Ce navigateur ne sait pas décompresser les classeurs .xlsx.");
      var flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(flux).arrayBuffer());
    };
  }

  // ====================================================================================================
  // Classeur .xlsx : écriture
  // ====================================================================================================
  function xml(s){
    s = String(s);
    if (s.length > 32767) s = s.slice(0, 32767);
    return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function lettre(i){
    var s = "";
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }
  C.lettre = lettre;

  // { nom, entete:[…]|null, lignes, types:[…], largeurs:[px…] } → { blob, tronque }
  // Une feuille : en-tête en gras et figé, filtre automatique, nombres et dates en vraies valeurs Excel.
  C.xlsx = async function(f){
    var te = new TextEncoder(), morceaux = [], MAX = 1048576, nc = f.entete ? f.entete.length : (f.lignes[0] || []).length;
    var types = f.types || [], lignes = f.lignes, tronque = false, dec = f.entete ? 1 : 0, i, c, s;
    if (lignes.length + dec > MAX){ lignes = lignes.slice(0, MAX - dec); tronque = true; }
    function cellule(ref, v, type){
      if (v === "" || v == null) return "";
      if ((type === "entier" || type === "nombre") && !C.codeTexte(v)){
        var x = C.nombre(v);
        if (isFinite(x) && v.replace(/\D/g, "").length <= 15) return '<c r="' + ref + '"><v>' + x + "</v></c>";
      } else if (type === "date"){
        var d = C.date(v), serie = d / 86400000 + 25569;
        if (!isNaN(d) && serie >= 61) return '<c r="' + ref + '" s="' + (d % 86400000 ? 3 : 2) + '"><v>' + serie + "</v></c>";
      }
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xml(v) + "</t></is></c>";
    }
    s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0">' + (f.entete ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : "") + "</sheetView></sheetViews>";
    if (nc){
      s += "<cols>";
      for (c = 0; c < nc; c++){
        var l = Math.max(6, Math.min(80, Math.round(((f.largeurs && f.largeurs[c]) || 100) / 7)));
        s += '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + l + '" customWidth="1"/>';
      }
      s += "</cols>";
    }
    s += "<sheetData>";
    if (f.entete){
      s += '<row r="1">';
      for (c = 0; c < nc; c++) s += '<c r="' + lettre(c) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + xml(f.entete[c]) + "</t></is></c>";
      s += "</row>";
    }
    var refs = [];
    for (c = 0; c < nc; c++) refs.push(lettre(c));
    for (i = 0; i < lignes.length; i++){
      var r = i + 1 + dec, li = lignes[i];
      s += '<row r="' + r + '">';
      for (c = 0; c < nc; c++) s += cellule(refs[c] + r, li[c], types[c]);
      s += "</row>";
      if (s.length > 1 << 20){ morceaux.push(te.encode(s)); s = ""; }
    }
    s += "</sheetData>";
    if (f.entete && nc) s += '<autoFilter ref="A1:' + lettre(nc - 1) + (lignes.length + 1) + '"/>';
    s += "</worksheet>";
    morceaux.push(te.encode(s));

    var nom = String(f.nom || "Feuil1").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Feuil1";
    var NS = "http://schemas.openxmlformats.org/", EN = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    function un(t){ return [te.encode(t)]; }
    var blob = await C.zip([
      { nom: "[Content_Types].xml", morceaux: un(EN + '<Types xmlns="' + NS + 'package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
      { nom: "_rels/.rels", morceaux: un(EN + '<Relationships xmlns="' + NS + 'package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { nom: "xl/workbook.xml", morceaux: un(EN + '<workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets><sheet name="' + xml(nom).replace(/"/g, "&quot;") + '" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { nom: "xl/_rels/workbook.xml.rels", morceaux: un(EN + '<Relationships xmlns="' + NS + 'package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
      { nom: "xl/styles.xml", morceaux: un(EN + '<styleSheet xmlns="' + NS + 'spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>') },
      { nom: "xl/worksheets/sheet1.xml", morceaux: morceaux }
    ], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return { blob: blob, tronque: tronque };
  };

  // ====================================================================================================
  // Classeur .xlsx : lecture (toutes les feuilles, valeurs calculées, dates reconnues par leur format)
  // ====================================================================================================
  C.lireXlsx = async function(tampon){
    var lire = dezip(tampon), td = new TextDecoder();
    async function doc(nom){
      var b = await lire(nom);
      return b ? new DOMParser().parseFromString(td.decode(b), "application/xml") : null;
    }
    function tous(n, nom){ return n ? n.getElementsByTagNameNS("*", nom) : []; }
    function texteDe(n){                                            // <t> directs et ceux des passages <r>, sans les lectures phonétiques
      var s = "";
      for (var e = n.firstElementChild; e; e = e.nextElementSibling){
        if (e.localName === "t") s += e.textContent;
        else if (e.localName === "r") for (var g = e.firstElementChild; g; g = g.nextElementSibling) if (g.localName === "t") s += g.textContent;
      }
      return s;
    }
    function colDe(ref){
      var n = 0, c;
      for (var i = 0; i < ref.length; i++){ c = ref.charCodeAt(i); if (c < 65 || c > 90) break; n = n * 26 + c - 64; }
      return n - 1;
    }
    var wb = await doc("xl/workbook.xml"), rels = await doc("xl/_rels/workbook.xml.rels");
    if (!wb || !rels) throw new Error("Classeur Excel illisible : sa table des feuilles est introuvable.");
    var cibles = {}, cheminChaines = null, cheminStyles = null, e;
    [].forEach.call(tous(rels, "Relationship"), function(r){
      var t = r.getAttribute("Target") || "", ty = r.getAttribute("Type") || "", ch = t.charAt(0) === "/" ? t.slice(1) : "xl/" + t;
      cibles[r.getAttribute("Id")] = ch;
      if (/\/sharedStrings$/.test(ty)) cheminChaines = ch;
      if (/\/styles$/.test(ty)) cheminStyles = ch;
    });
    var chaines = [], ss = cheminChaines ? await doc(cheminChaines) : null;
    if (ss && ss.documentElement) for (e = ss.documentElement.firstElementChild; e; e = e.nextElementSibling) chaines.push(texteDe(e));

    var estDate = [], st = cheminStyles ? await doc(cheminStyles) : null;
    if (st){
      var perso = {};
      [].forEach.call(tous(st, "numFmt"), function(nf){ perso[nf.getAttribute("numFmtId")] = nf.getAttribute("formatCode") || ""; });
      var xfs = tous(st, "cellXfs")[0];
      if (xfs) for (e = xfs.firstElementChild; e; e = e.nextElementSibling){
        var id = +e.getAttribute("numFmtId") || 0, code = perso[id];
        if (code != null){
          code = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
          estDate.push(/[dmyhs]/i.test(code) && !/general/i.test(code));
        } else estDate.push((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58));
      }
    }

    var feuilles = [], NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    var liste = tous(wb, "sheet");
    for (var k = 0; k < liste.length; k++){
      var sh = liste[k], ch = cibles[sh.getAttributeNS(NS_R, "id") || sh.getAttribute("r:id")];
      if (!ch) continue;
      var d = await doc(ch), sd = d ? tous(d, "sheetData")[0] : null;
      if (!sd) continue;
      var lignes = [], nbCols = 0;
      for (var row = sd.firstElementChild; row; row = row.nextElementSibling){
        if (row.localName !== "row") continue;
        var l = [], pos = 0, plein = false;
        for (var c = row.firstElementChild; c; c = c.nextElementSibling){
          if (c.localName !== "c") continue;
          var ref = c.getAttribute("r"), t = c.getAttribute("t"), v = null, is = null, val = "";
          if (ref) pos = Math.max(pos, colDe(ref));
          for (e = c.firstElementChild; e; e = e.nextElementSibling){ if (e.localName === "v") v = e.textContent; else if (e.localName === "is") is = e; }
          if (t === "s") val = chaines[+v] || "";
          else if (t === "inlineStr") val = is ? texteDe(is) : "";
          else if (t === "b") val = v === "1" ? "VRAI" : "FAUX";
          else if (v != null){
            val = v;
            if (t !== "str" && t !== "e"){
              var x = +v;
              if (v !== "" && isFinite(x)) val = estDate[+c.getAttribute("s") || 0] ? C.dateSerie(x) : String(parseFloat(x.toPrecision(15)));
            }
          }
          if (pos > 16384) break;
          while (l.length < pos) l.push("");
          l[pos] = val; pos++;
          if (val !== "") plein = true;
        }
        if (!plein) continue;
        if (l.length > nbCols) nbCols = l.length;
        lignes.push(l);
      }
      if (!lignes.length) continue;
      C.completer(lignes, nbCols);
      feuilles.push({ nom: sh.getAttribute("name") || "Feuille " + (k + 1), lignes: lignes, nbCols: nbCols });
    }
    return feuilles;
  };

  // ====================================================================================================
  // JSON
  // ====================================================================================================
  // Texte JSON → { entete:[…]|null, lignes }. Tableau d'objets (clés = colonnes), tableau de tableaux, ou objet
  // dont une propriété est un tableau.
  C.lireJson = function(texte){
    var j = JSON.parse(texte);
    if (!Array.isArray(j)){
      if (j && typeof j === "object"){
        var cle = Object.keys(j).filter(function(k){ return Array.isArray(j[k]); })[0];
        j = cle ? j[cle] : [j];
      } else j = [j];
    }
    function txt(v){ return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : typeof v === "boolean" ? (v ? "VRAI" : "FAUX") : String(v); }
    if (j.length && j.every(Array.isArray)) return { entete: null, lignes: j.map(function(l){ return l.map(txt); }) };
    var cles = [], vues = new Set();
    j.forEach(function(o){
      if (o && typeof o === "object" && !Array.isArray(o)) Object.keys(o).forEach(function(k){ if (!vues.has(k)){ vues.add(k); cles.push(k); } });
    });
    if (!cles.length) return { entete: ["Valeur"], lignes: j.map(function(v){ return [txt(v)]; }) };
    return { entete: cles, lignes: j.map(function(o){
      var obj = o && typeof o === "object" && !Array.isArray(o);
      return cles.map(function(k){ return obj && Object.prototype.hasOwnProperty.call(o, k) ? txt(o[k]) : ""; });
    }) };
  };

  // ====================================================================================================
  // Formules des colonnes calculées
  // ====================================================================================================
  function num(v){
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v == null || v === "") return 0;
    return C.nombre(v);
  }
  function txt(v){
    if (v == null) return "";
    if (typeof v === "number") return isFinite(v) ? String(parseFloat(v.toPrecision(12))) : "#VALEUR";
    if (typeof v === "boolean") return v ? "VRAI" : "FAUX";
    return String(v);
  }
  function vrai(v){
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0 && !isNaN(v);
    if (v == null) return false;
    var s = String(v).trim().toUpperCase();
    return !(s === "" || s === "0" || s === "FAUX" || s === "FALSE" || s === "NON");
  }
  function arrondi(x, n, mode){
    var f = Math.pow(10, Math.round(n || 0)), y = x * f;
    if (mode > 0) return Math.ceil(y - 1e-9) / f;
    if (mode < 0) return Math.floor(y + 1e-9) / f;
    return Math.round(y + (y >= 0 ? 1e-9 : -1e-9)) / f;
  }
  C.arrondi = arrondi;
  function nums(a){ var r = []; for (var i = 0; i < a.length; i++){ var x = num(a[i]); if (!isNaN(x) && a[i] !== "" && a[i] != null) r.push(x); } return r; }

  var FN = {
    ET: function(a){ return a.every(vrai); },
    OU: function(a){ return a.some(vrai); },
    NON: function(a){ return !vrai(a[0]); },
    ARRONDI: function(a){ return arrondi(num(a[0]), num(a[1]), 0); },
    "ARRONDI.SUP": function(a){ return arrondi(num(a[0]), num(a[1]), 1); },
    "ARRONDI.INF": function(a){ return arrondi(num(a[0]), num(a[1]), -1); },
    ENT: function(a){ return Math.floor(num(a[0])); },
    ABS: function(a){ return Math.abs(num(a[0])); },
    RACINE: function(a){ return Math.sqrt(num(a[0])); },
    PUISSANCE: function(a){ return Math.pow(num(a[0]), num(a[1])); },
    MOD: function(a){ var d = num(a[1]); return d ? num(a[0]) - d * Math.floor(num(a[0]) / d) : NaN; },
    PI: function(){ return Math.PI; },
    MIN: function(a){ var r = nums(a); return r.length ? Math.min.apply(null, r) : 0; },
    MAX: function(a){ var r = nums(a); return r.length ? Math.max.apply(null, r) : 0; },
    SOMME: function(a){ return nums(a).reduce(function(s, x){ return s + x; }, 0); },
    MOYENNE: function(a){ var r = nums(a); return r.length ? r.reduce(function(s, x){ return s + x; }, 0) / r.length : NaN; },
    NUM: function(a){ return num(a[0]); },
    TEXTE: function(a){ return a.length > 1 ? num(a[0]).toFixed(Math.max(0, Math.min(12, Math.round(num(a[1]))))) : txt(a[0]); },
    MAJUSCULE: function(a){ return txt(a[0]).toUpperCase(); },
    MINUSCULE: function(a){ return txt(a[0]).toLowerCase(); },
    NOMPROPRE: function(a){ return C.nomPropre(txt(a[0])); },
    SUPPRESPACE: function(a){ return txt(a[0]).replace(/\s+/g, " ").trim(); },
    SANSACCENT: function(a){ return sansAccent(txt(a[0])); },
    NBCAR: function(a){ return txt(a[0]).length; },
    GAUCHE: function(a){ return txt(a[0]).slice(0, Math.max(0, a.length > 1 ? num(a[1]) : 1)); },
    DROITE: function(a){ var s = txt(a[0]), n = Math.max(0, a.length > 1 ? num(a[1]) : 1); return n ? s.slice(-n) : ""; },
    STXT: function(a){ var d = Math.max(1, num(a[1])); return txt(a[0]).substr(d - 1, Math.max(0, num(a[2]))); },
    CHERCHE: function(a){ return txt(a[1]).toLowerCase().indexOf(txt(a[0]).toLowerCase()) + 1; },
    CONTIENT: function(a){ return txt(a[0]).toLowerCase().indexOf(txt(a[1]).toLowerCase()) >= 0; },
    REMPLACER: function(a){ var q = txt(a[1]); return q ? txt(a[0]).split(q).join(txt(a[2])) : txt(a[0]); },
    CONCAT: function(a){ return a.map(txt).join(""); },
    JOINDRE: function(a){ return a.slice(1).map(txt).filter(function(s){ return s !== ""; }).join(txt(a[0])); },
    PARTIE: function(a){ var p = txt(a[0]).split(txt(a[1]) || " "), n = Math.round(num(a[2])) || 1; return (n < 0 ? p[p.length + n] : p[n - 1]) || ""; },
    ZEROS: function(a){ var s = txt(a[0]), n = num(a[1]); while (s.length < n) s = "0" + s; return s; },
    REGEX: function(a){
      var m;
      try { m = new RegExp(txt(a[1])).exec(txt(a[0])); } catch (e){ return "#REGEX"; }
      return m ? (m[a.length > 2 ? Math.round(num(a[2])) : (m.length > 1 ? 1 : 0)] || "") : "";
    },
    ESTVIDE: function(a){ return txt(a[0]).trim() === ""; },
    ESTNUM: function(a){ return typeof a[0] === "number" || !isNaN(C.nombre(a[0])); },
    LIGNE: function(a, k){ return k + 1; }
  };
  var ALIAS = { AND: "ET", OR: "OU", NOT: "NON", ROUND: "ARRONDI", INT: "ENT", SQRT: "RACINE", SUM: "SOMME", AVERAGE: "MOYENNE", UPPER: "MAJUSCULE",
    LOWER: "MINUSCULE", TRIM: "SUPPRESPACE", LEN: "NBCAR", LEFT: "GAUCHE", RIGHT: "DROITE", MID: "STXT", ROW: "LIGNE", CONCATENER: "CONCAT" };

  C.nomPropre = function(s){ return s.toLowerCase().replace(/(^|[\s\-'’(])(\S)/g, function(m, a, b){ return a + b.toUpperCase(); }); };

  // Aide affichée dans la fenêtre « Colonne calculée »
  C.FONCTIONS = [
    ["SI(test; alors; sinon)", "condition"], ["ET(a; b…) · OU(a; b…) · NON(a)", "logique"],
    ["ARRONDI(x; décimales) · ARRONDI.SUP · ARRONDI.INF · ENT(x)", "arrondis"],
    ["ABS(x) · RACINE(x) · PUISSANCE(x; n) · MOD(x; d) · PI()", "calcul"],
    ["MIN(a; b…) · MAX(a; b…) · SOMME(a; b…) · MOYENNE(a; b…)", "sur plusieurs colonnes"],
    ["NUM(texte) · TEXTE(x; décimales) · ZEROS(x; longueur)", "conversion"],
    ["MAJUSCULE(t) · MINUSCULE(t) · NOMPROPRE(t) · SUPPRESPACE(t) · SANSACCENT(t)", "casse et espaces"],
    ["GAUCHE(t; n) · DROITE(t; n) · STXT(t; début; n) · NBCAR(t)", "découpe"],
    ["PARTIE(t; séparateur; n)", "n-ième morceau (-1 = dernier)"],
    ["CHERCHE(quoi; t) · CONTIENT(t; quoi) · REMPLACER(t; ancien; nouveau)", "recherche"],
    ["REGEX(t; motif; groupe)", "extraction par expression régulière"],
    ["CONCAT(a; b…) · JOINDRE(séparateur; a; b…)", "assemblage (ou a & b)"],
    ["ESTVIDE(x) · ESTNUM(x) · LIGNE()", "tests, numéro de ligne"]
  ];

  // Formule → fonction (ligne, rang) → texte. Lève une Error en français si la formule est fausse.
  // Colonnes : [Nom de colonne] ou le nom seul s'il est sans espace. Opérateurs : + - * / ^ & = <> < > <= >=
  C.formule = function(src, noms){
    var jetons = [], i = 0, n = src.length, m, reste;
    while (i < n){
      var ch = src.charAt(i);
      if (/\s/.test(ch)){ i++; continue; }
      if (ch === "["){
        var f = src.indexOf("]", i);
        if (f < 0) throw new Error("Crochet « [ » non fermé.");
        jetons.push({ t: "col", v: src.slice(i + 1, f) }); i = f + 1; continue;
      }
      if (ch === '"' || ch === "'"){
        var s = "", j = i + 1;
        for (;;){
          if (j >= n) throw new Error("Guillemet non fermé.");
          var c2 = src.charAt(j);
          if (c2 === ch){ if (src.charAt(j + 1) === ch){ s += ch; j += 2; continue; } break; }
          s += c2; j++;
        }
        jetons.push({ t: "txt", v: s }); i = j + 1; continue;
      }
      reste = src.slice(i);
      if ((m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(reste))){ jetons.push({ t: "nb", v: +m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*/.exec(reste))){ jetons.push({ t: "id", v: sansAccent(m[0]).toUpperCase() }); i += m[0].length; continue; }
      if ((m = /^(?:<>|<=|>=|!=|[-+*\/^&=<>(),;])/.exec(reste))){ jetons.push({ t: "op", v: m[0] }); i += m[0].length; continue; }
      throw new Error("Caractère inattendu : « " + ch + " ».");
    }
    var cles = noms.map(function(x){ return sansAccent(String(x)).toUpperCase().trim(); });
    function trouverCol(nom, souple){
      var k = noms.indexOf(nom);
      if (k < 0) k = cles.indexOf(sansAccent(nom).toUpperCase().trim());
      if (k < 0 && !souple) throw new Error("Colonne inconnue : [" + nom + "].");
      return k;
    }
    var p = 0;
    function vu(v){ var j = jetons[p]; return !!j && j.t === "op" && j.v === v; }
    function binaire(a, b, op){
      return function(l, k){
        var x = num(a(l, k)), y = num(b(l, k));
        return op === 0 ? x + y : op === 1 ? x - y : op === 2 ? x * y : op === 3 ? (y === 0 ? NaN : x / y) : Math.pow(x, y);
      };
    }
    function comparateur(op, a, b){
      function nb(x){ return typeof x === "number" ? x : (x === "" || x == null || typeof x === "boolean") ? NaN : C.nombre(x); }
      return function(l, k){
        var x = a(l, k), y = b(l, k), nx = nb(x), ny = nb(y), r;
        if (!isNaN(nx) && !isNaN(ny)) r = nx < ny ? -1 : nx > ny ? 1 : 0;
        else { var sx = txt(x).toLowerCase(), sy = txt(y).toLowerCase(); r = sx < sy ? -1 : sx > sy ? 1 : 0; }
        return op === "=" ? r === 0 : (op === "<>" || op === "!=") ? r !== 0 : op === "<" ? r < 0 : op === ">" ? r > 0 : op === "<=" ? r <= 0 : r >= 0;
      };
    }
    function appel(nom, args){
      if (nom === "SI" || nom === "IF"){
        if (args.length < 2) throw new Error("SI attend au moins un test et une valeur.");
        return function(l, k){ return vrai(args[0](l, k)) ? args[1](l, k) : (args[2] ? args[2](l, k) : ""); };
      }
      var fn = FN[nom] || FN[ALIAS[nom]];
      if (!fn) throw new Error("Fonction inconnue : " + nom + ".");
      return function(l, k){
        var v = new Array(args.length);
        for (var q = 0; q < args.length; q++) v[q] = args[q](l, k);
        return fn(v, k);
      };
    }
    function comparaison(){
      var a = concat();
      for (;;){
        var j = jetons[p];
        if (j && j.t === "op" && /^(?:=|<>|!=|<|>|<=|>=)$/.test(j.v)){ p++; a = comparateur(j.v, a, concat()); }
        else return a;
      }
    }
    function concat(){
      var a = somme();
      while (vu("&")){ p++; a = (function(x, y){ return function(l, k){ return txt(x(l, k)) + txt(y(l, k)); }; })(a, somme()); }
      return a;
    }
    function somme(){
      var a = produit();
      for (;;){
        if (vu("+")){ p++; a = binaire(a, produit(), 0); }
        else if (vu("-")){ p++; a = binaire(a, produit(), 1); }
        else return a;
      }
    }
    function produit(){
      var a = puissance();
      for (;;){
        if (vu("*")){ p++; a = binaire(a, puissance(), 2); }
        else if (vu("/")){ p++; a = binaire(a, puissance(), 3); }
        else return a;
      }
    }
    function puissance(){
      var a = unaire();
      if (vu("^")){ p++; a = binaire(a, puissance(), 4); }
      return a;
    }
    function unaire(){
      if (vu("-")){ p++; var a = unaire(); return function(l, k){ return -num(a(l, k)); }; }
      if (vu("+")){ p++; return unaire(); }
      return primaire();
    }
    function primaire(){
      var j = jetons[p++];
      if (!j) throw new Error("Formule incomplète.");
      if (j.t === "nb" || j.t === "txt"){ var v = j.v; return function(){ return v; }; }
      if (j.t === "col"){ var c = trouverCol(j.v); return function(l){ return l[c]; }; }
      if (j.t === "op" && j.v === "("){
        var a = comparaison();
        if (!vu(")")) throw new Error("Parenthèse non fermée.");
        p++; return a;
      }
      if (j.t === "id"){
        if (vu("(")){
          p++;
          var args = [];
          if (!vu(")")) for (;;){
            args.push(comparaison());
            if (vu(",") || vu(";")){ p++; continue; }
            break;
          }
          if (!vu(")")) throw new Error("Parenthèse non fermée après " + j.v + ".");
          p++;
          return appel(j.v, args);
        }
        if (j.v === "VRAI" || j.v === "TRUE") return function(){ return true; };
        if (j.v === "FAUX" || j.v === "FALSE") return function(){ return false; };
        var c2 = trouverCol(j.v, true);
        if (c2 >= 0) return function(l){ return l[c2]; };
        throw new Error("Nom inconnu : " + j.v + ". Une colonne s'écrit [Nom de colonne].");
      }
      throw new Error("Élément inattendu : « " + j.v + " ».");
    }
    if (!jetons.length) throw new Error("Formule vide.");
    var expr = comparaison();
    if (p < jetons.length) throw new Error("Élément en trop : « " + jetons[p].v + " ».");
    return function(l, k){ return txt(expr(l, k)); };
  };

  // ====================================================================================================
  // Profil d'une colonne
  // ====================================================================================================
  C.profil = function(vals){
    var n = vals.length, vides = 0, cpt = new Map(), nb = [], somme = 0, lmin = Infinity, lmax = 0, v, x, i;
    for (i = 0; i < n; i++){
      v = vals[i];
      if (v === "" || v == null){ vides++; continue; }
      cpt.set(v, (cpt.get(v) || 0) + 1);
      if (v.length < lmin) lmin = v.length;
      if (v.length > lmax) lmax = v.length;
      x = C.nombre(v);
      if (!isNaN(x)){ nb.push(x); somme += x; }
    }
    var p = { n: n, vides: vides, remplies: n - vides, distinctes: cpt.size, nNum: nb.length, lmin: lmin === Infinity ? 0 : lmin, lmax: lmax };
    p.type = C.typeDe(n > 3000 ? vals.slice(0, 3000) : vals);
    if (nb.length){
      var t = Float64Array.from(nb).sort(), m = t.length, moy = somme / m, ec = 0;
      for (i = 0; i < m; i++) ec += (t[i] - moy) * (t[i] - moy);
      p.somme = somme; p.moyenne = moy; p.min = t[0]; p.max = t[m - 1];
      p.mediane = m & 1 ? t[(m - 1) / 2] : (t[m / 2 - 1] + t[m / 2]) / 2;
      p.ecart = m > 1 ? Math.sqrt(ec / (m - 1)) : 0;
    }
    var top = [];
    cpt.forEach(function(k, val){ top.push([val, k]); });
    top.sort(function(a, b){ return b[1] - a[1] || C.comparer(a[0], b[0]); });
    p.doublons = 0;
    for (i = 0; i < top.length; i++){ if (top[i][1] > 1) p.doublons += top[i][1] - 1; else break; }
    p.top = top.slice(0, 12);
    return p;
  };

  window.CSV = C;
})();
