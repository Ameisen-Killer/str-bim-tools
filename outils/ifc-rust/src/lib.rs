//! Lecteur IFC de str-bim-tools.com/ifc/, compilé en WebAssembly (cible wasm32-unknown-unknown, sans dépendance).
//!
//! Fait exactement ce que fait `analyser` dans docs/ifc/ifc-core.js, en plus rapide et en moins de mémoire :
//! découpe la section DATA en instructions (chaînes '…' avec apostrophes doublées, commentaires /* */),
//! lit pour chaque entité son id, sa classe et ses références #n, et range le tout dans des tableaux
//! que la page lit directement dans la mémoire du module. Les en-têtes, la déclaration DATA et les entités
//! qui contiennent un commentaire sont rendus par leurs positions : la page en tire le texte elle-même.
//!
//! Appels (depuis ifc-lecteur.js) : `reserver(n)` → adresse où copier les octets du fichier ; `analyser(n)`
//! → 0 si tout va bien, sinon un code d'erreur (voir ERR_*) ; puis les accesseurs `res_*` ; `liberer()`.
//! Code 99 : cas que ce lecteur ne traite pas lui-même (identifiant hors limites, classe non ASCII) :
//! la page repasse alors par le lecteur JavaScript, qui fait foi.

mod maillage;
mod tess;

use std::collections::HashMap;
use std::collections::HashSet;

#[link(wasm_import_module = "env")]
extern "C" {
    /// avancement 0–1, appelé tous les 4 Mo environ
    fn progres(f: f64);
}

const ERR_CHAINE: i32 = 1; // chaîne jamais refermée
const ERR_COMMENTAIRE: i32 = 2; // commentaire jamais refermé
const ERR_ENTITE: i32 = 3; // entité illisible (identifiant)
const ERR_PARENTHESES: i32 = 4; // entité incomplète
const ERR_LIGNE: i32 = 5; // ligne inattendue dans DATA
const ERR_ISO: i32 = 6; // première instruction sans ISO-10303-21
const ERR_HEADER: i32 = 7; // section HEADER absente
const ERR_DATA: i32 = 8; // section DATA absente
const ERR_JS: i32 = 99; // à confier au lecteur JavaScript

#[derive(Default)]
struct Res {
    entree: Vec<u8>,
    ids: Vec<i32>,
    deb: Vec<i32>,
    fin: Vec<i32>,
    typ: Vec<i32>,
    rdeb: Vec<i32>,
    refs: Vec<i32>,
    types: Vec<u8>, // noms des classes séparés par \n
    noms: HashMap<Vec<u8>, i32>,
    nb_types: i32,
    entetes: Vec<i32>, // triplets (début, fin, avec commentaire 0/1)
    data: [i32; 3],
    max_id: i32,
    doublons: i32,
    etat: i32,
    err: [i32; 4], // code, début, fin, id
    vus_bits: Vec<u64>,
    vus_grands: HashSet<i64>,
}

static mut RES: Option<Res> = None;

fn res() -> &'static mut Res {
    unsafe {
        let r = &mut *std::ptr::addr_of_mut!(RES);
        if r.is_none() {
            *r = Some(Res::default());
        }
        r.as_mut().unwrap()
    }
}

/// Les blancs que trim() retire en JavaScript, pour un octet (le fichier est lu octet = caractère)
#[inline]
fn blanc(c: u8) -> bool {
    c == 32 || (9..=13).contains(&c) || c == 160
}
fn rogner(s: &[u8]) -> (usize, usize) {
    let (mut d, mut f) = (0, s.len());
    while d < f && blanc(s[d]) {
        d += 1;
    }
    while f > d && blanc(s[f - 1]) {
        f -= 1;
    }
    (d, f)
}
fn mot(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}
fn contient(s: &[u8], m: &[u8]) -> bool {
    s.len() >= m.len() && s.windows(m.len()).any(|w| w == m)
}

#[no_mangle]
pub extern "C" fn reserver(n: usize) -> *mut u8 {
    let r = res();
    *r = Res::default();
    r.entree = vec![0u8; n];
    r.entree.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn liberer() {
    unsafe {
        *std::ptr::addr_of_mut!(RES) = None;
    }
}

impl Res {
    fn erreur(&mut self, code: i32, deb: usize, fin: usize, id: i64) -> i32 {
        self.err = [code, deb as i32, fin as i32, id as i32];
        code
    }
    fn deja_vu(&mut self, id: i64) -> bool {
        if id < (1i64 << 26) {
            let k = (id >> 6) as usize;
            if k >= self.vus_bits.len() {
                self.vus_bits.resize((k + 1).max(self.vus_bits.len() * 2), 0);
            }
            let b = 1u64 << (id & 63);
            let v = self.vus_bits[k] & b != 0;
            self.vus_bits[k] |= b;
            v
        } else {
            !self.vus_grands.insert(id)
        }
    }
    fn type_num(&mut self, nom: &[u8]) -> i32 {
        if let Some(&t) = self.noms.get(nom) {
            return t;
        }
        let t = self.nb_types;
        self.nb_types += 1;
        self.noms.insert(nom.to_vec(), t);
        self.types.extend_from_slice(nom);
        self.types.push(b'\n');
        t
    }

    /// Une entité « #id=CLASSE(…) » (s : instruction débarrassée de ses blancs et commentaires).
    /// deb, fin : positions à rendre à la page ; brut : étendue de l'instruction (messages d'erreur).
    fn entite(&mut self, s: &[u8], deb: i32, fin: i32, brut: (usize, usize)) -> i32 {
        let n = s.len();
        let eq = match s.iter().position(|&c| c == b'=') {
            Some(e) => e,
            None => return self.erreur(ERR_ENTITE, brut.0, brut.1, 0),
        };
        // parseInt(s.slice(1, eq), 10)
        let mut id: i64 = -1;
        if eq > 1 {
            let mut i = 1;
            while i < eq && blanc(s[i]) {
                i += 1;
            }
            let mut signe = 1;
            if i < eq && (s[i] == b'+' || s[i] == b'-') {
                if s[i] == b'-' {
                    signe = -1;
                }
                i += 1;
            }
            let mut v: i64 = 0;
            let mut chiffres = 0;
            while i < eq && s[i].is_ascii_digit() {
                v = v * 10 + (s[i] - b'0') as i64;
                chiffres += 1;
                if v > i32::MAX as i64 {
                    return self.erreur(ERR_JS, brut.0, brut.1, 0);
                }
                i += 1;
            }
            if chiffres > 0 {
                id = v * signe;
            }
        }
        if id <= 0 {
            return self.erreur(ERR_ENTITE, brut.0, brut.1, 0);
        }
        let mut i = eq + 1;
        while i < n && s[i] <= 32 {
            i += 1;
        }
        let p = match s[i.min(n)..].iter().position(|&c| c == b'(') {
            Some(k) => i + k,
            None => return self.erreur(ERR_PARENTHESES, brut.0, brut.1, id),
        };
        if s[n - 1] != b')' {
            return self.erreur(ERR_PARENTHESES, brut.0, brut.1, id);
        }
        let (td, tf) = rogner(&s[i..p]);
        let nom = &s[i + td..i + tf];
        if nom.iter().any(|&c| c >= 128) {
            return self.erreur(ERR_JS, brut.0, brut.1, id);
        }
        if self.deja_vu(id) {
            self.doublons += 1;
            return 0;
        }
        let t = if nom.is_empty() {
            self.type_num(b"(COMPLEXE)")
        } else {
            let maj: Vec<u8> = nom.iter().map(|c| c.to_ascii_uppercase()).collect();
            self.type_num(&maj)
        };
        self.ids.push(id as i32);
        self.deb.push(deb);
        self.fin.push(fin);
        self.typ.push(t);
        self.rdeb.push(self.refs.len() as i32);
        // références #n hors chaînes, à partir de la parenthèse
        let mut k = p;
        while k < n {
            let c = s[k];
            if c == b'\'' {
                k += 1;
                while k < n {
                    if s[k] == b'\'' {
                        if k + 1 < n && s[k + 1] == b'\'' {
                            k += 2;
                            continue;
                        }
                        break;
                    }
                    k += 1;
                }
                k += 1;
                continue;
            }
            if c == b'#' {
                k += 1;
                let mut v: i64 = 0;
                while k < n && s[k].is_ascii_digit() {
                    v = v.wrapping_mul(10).wrapping_add((s[k] - b'0') as i64);
                    k += 1;
                }
                if v > 0 {
                    self.refs.push(v as i32);
                }
                continue;
            }
            k += 1;
        }
        if id as i32 > self.max_id {
            self.max_id = id as i32;
        }
        0
    }

    /// Une instruction terminée par « ; ». morceaux : étendues hors commentaires ; fin_brute : position du « ; ».
    /// Rend 0 pour continuer, -1 pour s'arrêter (fin du fichier), un code d'erreur sinon.
    fn instruction(&mut self, txt: &[u8], morceaux: &[(usize, usize)], fin_brute: usize) -> i32 {
        let pur = morceaux.len() == 1;
        let brut = (morceaux[0].0, fin_brute);
        let tampon: Vec<u8>;
        let (s, d, f): (&[u8], i32, i32) = if pur {
            let (a, b) = morceaux[0];
            let (x, y) = rogner(&txt[a..b]);
            (&txt[a + x..a + y], (a + x) as i32, (a + y) as i32)
        } else {
            let mut v = Vec::new();
            for &(a, b) in morceaux {
                v.extend_from_slice(&txt[a..b]);
            }
            tampon = v;
            let (x, y) = rogner(&tampon);
            // avec commentaire : la page refait le texte depuis l'étendue brute (début codé en négatif)
            (&tampon[x..y], -(brut.0 as i32) - 2, brut.1 as i32)
        };
        match self.etat {
            3 => {
                if !s.is_empty() && s[0] == b'#' {
                    return self.entite(s, d, f, brut);
                }
                if s == b"ENDSEC" {
                    self.etat = 4;
                    return 0;
                }
                if s.is_empty() {
                    return 0;
                }
                self.erreur(ERR_LIGNE, brut.0, brut.1, 0)
            }
            0 => {
                if !contient(s, b"ISO-10303-21") {
                    return self.erreur(ERR_ISO, brut.0, brut.1, 0);
                }
                self.etat = 1;
                0
            }
            1 => {
                if s == b"HEADER" {
                    self.etat = 2;
                    return 0;
                }
                self.erreur(ERR_HEADER, brut.0, brut.1, 0)
            }
            2 => {
                if s == b"ENDSEC" {
                    self.etat = 25;
                    return 0;
                }
                self.entetes.extend_from_slice(&[d, f, if pur { 0 } else { 1 }]);
                0
            }
            _ => {
                // 25 (entre HEADER et DATA) ou 4 (après une section DATA)
                if s.len() >= 4 && &s[..4] == b"DATA" && (s.len() == 4 || !mot(s[4])) {
                    if self.etat == 25 {
                        self.data = [d, f, if pur { 0 } else { 1 }];
                    }
                    self.etat = 3;
                    return 0;
                }
                if s == b"END-ISO-10303-21" {
                    self.etat = 5;
                    return -1;
                }
                if self.etat == 25 {
                    return self.erreur(ERR_DATA, brut.0, brut.1, 0);
                }
                0
            }
        }
    }
}

/// Lit les n octets copiés à l'adresse rendue par reserver(n). 0 si la lecture va au bout (l'état final
/// dit si le fichier est complet), sinon un code d'erreur ; détails par res_err(k).
#[no_mangle]
pub extern "C" fn analyser(n: usize) -> i32 {
    let r = res();
    let txt = std::mem::take(&mut r.entree);
    let n = n.min(txt.len());
    r.etat = 0;
    let mut i = 0usize;
    let mut deb = 0usize;
    let mut morceaux: Vec<(usize, usize)> = Vec::with_capacity(4);
    let mut prochain = 4_000_000usize;
    let mut code = 0;
    while i < n {
        if i >= prochain {
            unsafe { progres(i as f64 / n as f64) };
            prochain = i + 4_000_000;
        }
        let c = txt[i];
        if c == b'\'' {
            i += 1;
            loop {
                if i >= n {
                    code = r.erreur(ERR_CHAINE, 0, 0, 0);
                    break;
                }
                if txt[i] == b'\'' {
                    if i + 1 < n && txt[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            if code != 0 {
                break;
            }
            i += 1;
            continue;
        }
        if c == b'/' && i + 1 < n && txt[i + 1] == b'*' {
            morceaux.push((deb, i));
            let mut f = i + 2;
            let mut trouve = false;
            while f + 1 < n {
                if txt[f] == b'*' && txt[f + 1] == b'/' {
                    trouve = true;
                    break;
                }
                f += 1;
            }
            if !trouve {
                code = r.erreur(ERR_COMMENTAIRE, 0, 0, 0);
                break;
            }
            i = f + 2;
            deb = i;
            continue;
        }
        if c == b';' {
            morceaux.push((deb, i));
            let x = r.instruction(&txt[..n], &morceaux, i);
            if x == -1 {
                break;
            }
            if x != 0 {
                code = x;
                break;
            }
            morceaux.clear();
            i += 1;
            deb = i;
            continue;
        }
        i += 1;
    }
    r.rdeb.push(r.refs.len() as i32);
    r.entree = txt;
    code
}

#[no_mangle]
pub extern "C" fn res_etat() -> i32 { res().etat }
#[no_mangle]
pub extern "C" fn res_nb() -> i32 { res().ids.len() as i32 }
#[no_mangle]
pub extern "C" fn res_nr() -> i32 { res().refs.len() as i32 }
#[no_mangle]
pub extern "C" fn res_max_id() -> i32 { res().max_id }
#[no_mangle]
pub extern "C" fn res_doublons() -> i32 { res().doublons }
#[no_mangle]
pub extern "C" fn res_err(k: usize) -> i32 { res().err[k.min(3)] }
/// 0 ids, 1 deb, 2 fin, 3 typ, 4 rdeb, 5 refs, 6 entetes : adresse du tableau (Int32)
#[no_mangle]
pub extern "C" fn res_tableau(k: i32) -> *const i32 {
    let r = res();
    match k {
        0 => r.ids.as_ptr(),
        1 => r.deb.as_ptr(),
        2 => r.fin.as_ptr(),
        3 => r.typ.as_ptr(),
        4 => r.rdeb.as_ptr(),
        5 => r.refs.as_ptr(),
        _ => r.entetes.as_ptr(),
    }
}
#[no_mangle]
pub extern "C" fn res_nb_entetes() -> i32 { (res().entetes.len() / 3) as i32 }
#[no_mangle]
pub extern "C" fn res_data(k: usize) -> i32 { res().data[k.min(2)] }
#[no_mangle]
pub extern "C" fn res_types() -> *const u8 { res().types.as_ptr() }
#[no_mangle]
pub extern "C" fn res_types_long() -> i32 { res().types.len() as i32 }
