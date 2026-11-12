//! Faces triangulées et polygonales IFC4 (IFCTRIANGULATEDFACESET, IFCPOLYGONALFACESET et leurs
//! IFCINDEXEDPOLYGONALFACE[WITHVOIDS]) pour la vue 3D de /ifc/.
//!
//! Copie fidèle de `tessellation` + `ajouterFace` de docs/ifc/ifc-vue.js : la page envoie le texte STEP
//! des entités (jeu de faces, liste de points, faces) et la matrice de placement ; le module lit les
//! nombres, place les points et rend les faces (boucles en coordonnées monde, normale). Tout ce qui sort
//! du cas courant (valeur typée, chaîne, index non entier…) renvoie un code : la page fait alors le travail
//! en JavaScript, qui fait foi.
//!
//! Appels : `t_entree(nb_octets, nb_textes)` ; la page écrit les textes bout à bout dans `t_octets()`, puis
//! dans `t_ent()` (entiers) : [triangulé (1/0), puis par texte : début, longueur, id attendu], et la matrice
//! dans `t_mat()` (12 réels). Textes : 0 = jeu de faces, 1 = liste de points, 2… = faces (jeu polygonal).
//! `t_calculer()` → 0 si tout va bien ; sorties : `t_sortie(0)` réels (par face : normale puis points),
//! `t_sortie(1)` entiers (par face : nb boucles, puis nb points de chaque boucle), `t_long(k)`.

#[derive(Default)]
struct Tess {
    octets: Vec<u8>,
    ent: Vec<i32>,
    mat: [f64; 12],
    sf: Vec<f64>,
    si: Vec<i32>,
}

static mut TESS: Option<Tess> = None;

fn tess() -> &'static mut Tess {
    unsafe {
        let r = &mut *std::ptr::addr_of_mut!(TESS);
        if r.is_none() {
            *r = Some(Tess::default());
        }
        r.as_mut().unwrap()
    }
}

#[no_mangle]
pub extern "C" fn t_entree(n: usize, nt: usize) -> i32 {
    let t = tess();
    t.octets.clear();
    t.octets.resize(n, 0);
    t.ent.clear();
    t.ent.resize(1 + 3 * nt, 0);
    0
}
#[no_mangle]
pub extern "C" fn t_octets() -> *mut u8 { tess().octets.as_mut_ptr() }
#[no_mangle]
pub extern "C" fn t_ent() -> *mut i32 { tess().ent.as_mut_ptr() }
#[no_mangle]
pub extern "C" fn t_mat() -> *mut f64 { tess().mat.as_mut_ptr() }
#[no_mangle]
pub extern "C" fn t_sortie(k: i32) -> usize {
    let t = tess();
    if k == 0 { t.sf.as_ptr() as usize } else { t.si.as_ptr() as usize }
}
#[no_mangle]
pub extern "C" fn t_long(k: i32) -> i32 {
    let t = tess();
    (if k == 0 { t.sf.len() } else { t.si.len() }) as i32
}
#[no_mangle]
pub extern "C" fn t_liberer() {
    unsafe { *std::ptr::addr_of_mut!(TESS) = None; }
}

// ================= Valeurs STEP =================
enum Val {
    Num(f64),
    Ref(u32),
    Liste(Vec<Val>),
    Rien, // $, *, énumération : N() donne NaN
}

struct Lecteur<'a> {
    s: &'a [u8],
    i: usize,
}

impl<'a> Lecteur<'a> {
    fn blancs(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\r' | b'\n') {
            self.i += 1;
        }
    }
    /// une valeur ; None = cas confié au JavaScript
    fn valeur(&mut self) -> Option<Val> {
        self.blancs();
        let c = *self.s.get(self.i)?;
        match c {
            b'(' => {
                self.i += 1;
                let mut l = Vec::new();
                self.blancs();
                if self.s.get(self.i) == Some(&b')') {
                    self.i += 1;
                    return Some(Val::Liste(l));
                }
                loop {
                    l.push(self.valeur()?);
                    self.blancs();
                    match *self.s.get(self.i)? {
                        b',' => self.i += 1,
                        b')' => {
                            self.i += 1;
                            return Some(Val::Liste(l));
                        }
                        _ => return None,
                    }
                }
            }
            b'#' => {
                self.i += 1;
                let d = self.i;
                while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                    self.i += 1;
                }
                let t = std::str::from_utf8(&self.s[d..self.i]).ok()?;
                Some(Val::Ref(t.parse().ok()?))
            }
            b'$' | b'*' => {
                self.i += 1;
                Some(Val::Rien)
            }
            b'.' if self.s.get(self.i + 1).map_or(false, |c| c.is_ascii_alphabetic()) => {
                // énumération .T. / .F. / .U.
                self.i += 1;
                while self.i < self.s.len() && self.s[self.i] != b'.' {
                    if !self.s[self.i].is_ascii_alphanumeric() && self.s[self.i] != b'_' {
                        return None;
                    }
                    self.i += 1;
                }
                if self.i >= self.s.len() {
                    return None;
                }
                self.i += 1;
                Some(Val::Rien)
            }
            b'0'..=b'9' | b'-' | b'+' => {   // (un « . » en tête est une énumération pour le JavaScript)
                let d = self.i;
                while self.i < self.s.len() && matches!(self.s[self.i], b'0'..=b'9' | b'-' | b'+' | b'.' | b'E' | b'e') {
                    self.i += 1;
                }
                let t = std::str::from_utf8(&self.s[d..self.i]).ok()?;
                Some(Val::Num(t.parse::<f64>().ok()?))
            }
            _ => None, // chaîne, valeur typée, binaire : JavaScript
        }
    }
}

/// arguments d'une entité « #id=TYPE(a,b,…) » : (TYPE, valeurs)
fn entite(s: &[u8]) -> Option<(&[u8], Vec<Val>)> {
    let eg = s.iter().position(|&c| c == b'=')?;
    let p = eg + s[eg..].iter().position(|&c| c == b'(')?;
    let mut ty = &s[eg + 1..p];
    while let [b' ' | b'\t' | b'\r' | b'\n', rest @ ..] = ty { ty = rest; }
    while let [rest @ .., b' ' | b'\t' | b'\r' | b'\n'] = ty { ty = rest; }
    let mut l = Lecteur { s, i: p };
    match l.valeur()? {
        Val::Liste(v) => {
            l.blancs();
            if l.i != s.len() { return None; }
            Some((ty, v))
        }
        _ => None,
    }
}

fn nombre(v: Option<&Val>) -> f64 {
    match v {
        Some(Val::Num(x)) => *x,
        _ => f64::NAN,
    }
}

#[no_mangle]
pub extern "C" fn t_calculer() -> i32 {
    let t = tess();
    t.sf.clear();
    t.si.clear();
    match calculer(t) {
        Some(()) => 0,
        None => {
            t.sf.clear();
            t.si.clear();
            1
        }
    }
}

fn texte<'a>(t: &'a Tess, k: usize) -> Option<(&'a [u8], u32)> {
    let b = 1 + 3 * k;
    if b + 2 >= t.ent.len() { return None; }
    let (d, n) = (t.ent[b] as usize, t.ent[b + 1] as usize);
    if d + n > t.octets.len() { return None; }
    Some((&t.octets[d..d + n], t.ent[b + 2] as u32))
}

fn calculer(t: &mut Tess) -> Option<()> {
    let tri = t.ent[0] == 1;
    let nt = (t.ent.len() - 1) / 3;
    let (fs, _) = texte(t, 0)?;
    let (_, a) = entite(fs)?;
    // liste de points : premier argument
    let ref_pts = match a.first()? { Val::Ref(r) => *r, _ => return None };
    let (ps, id_pts) = texte(t, 1)?;
    if id_pts != ref_pts { return None; }
    if ps.is_empty() { return Some(()); } // liste absente : aucune face (comme le JavaScript)
    let (_, ap) = entite(ps)?;
    let co = match ap.first() { Some(Val::Liste(l)) => l, _ => return Some(()) };
    let m = t.mat;
    let mut p = vec![0.0f64; co.len() * 3];
    for (i, c) in co.iter().enumerate() {
        let (x, y, z) = match c {
            Val::Liste(v) => (nombre(v.get(0)), nombre(v.get(1)), nombre(v.get(2))),
            Val::Rien => return None, // le JavaScript plante sur null : qu'il le fasse lui-même
            _ => (f64::NAN, f64::NAN, f64::NAN),
        };
        // N(x) || 0 : NaN et zéro (même négatif) donnent 0
        let (x, y, z) = (if x == 0.0 || x.is_nan() { 0.0 } else { x }, if y == 0.0 || y.is_nan() { 0.0 } else { y }, if z == 0.0 || z.is_nan() { 0.0 } else { z });
        p[3 * i] = m[0] * x + m[3] * y + m[6] * z + m[9];
        p[3 * i + 1] = m[1] * x + m[4] * y + m[7] * z + m[10];
        p[3 * i + 2] = m[2] * x + m[5] * y + m[8] * z + m[11];
    }
    let pn_v = if tri { a.get(4) } else { a.get(3) };
    let pn: Option<&Vec<Val>> = match pn_v { Some(Val::Liste(l)) if !l.is_empty() => Some(l), _ => None };
    let mut sortie = Sortie { sf: std::mem::take(&mut t.sf), si: std::mem::take(&mut t.si) };
    let r = (|| -> Option<()> {
        if tri {
            if let Some(Val::Liste(fl)) = a.get(3) {
                for f in fl.iter() {
                    if let Some(b) = boucle(f, pn, &p)? { sortie.face(&[b]); }
                }
            }
            return Some(());
        }
        // jeu polygonal : faces dans l'ordre de l'argument Faces
        let refs: Vec<u32> = match a.get(2) {
            Some(Val::Liste(l)) => l.iter().filter_map(|v| if let Val::Ref(r) = v { Some(*r) } else { None }).collect(),
            Some(Val::Ref(r)) => vec![*r],
            _ => Vec::new(),
        };
        if refs.len() != nt.saturating_sub(2) { return None; }
        for (j, &r) in refs.iter().enumerate() {
            let (fs, id) = texte(t, 2 + j)?;
            if id != r { return None; }
            if fs.is_empty() { continue; } // face absente du fichier
            let (ty, fa) = entite(fs)?;
            let b = match fa.get(0) { Some(v) => match boucle(v, pn, &p)? { Some(b) => b, None => continue }, None => continue };
            let mut bs = vec![b];
            if ty.eq_ignore_ascii_case(b"IFCINDEXEDPOLYGONALFACEWITHVOIDS") {
                if let Some(Val::Liste(vs)) = fa.get(1) {
                    for v in vs.iter() {
                        if let Some(x) = boucle(v, pn, &p)? { bs.push(x); }
                    }
                }
            }
            sortie.face(&bs);
        }
        Some(())
    })();
    t.sf = sortie.sf;
    t.si = sortie.si;
    r
}

/// points d'une boucle d'indices ; Some(None) = boucle refusée (comme `boucle` qui rend null),
/// None = cas confié au JavaScript
fn boucle(ix: &Val, pn: Option<&Vec<Val>>, p: &[f64]) -> Option<Option<Vec<f64>>> {
    let l = match ix { Val::Liste(l) => l, _ => return Some(None) };
    let mut b = Vec::with_capacity(l.len() * 3);
    for v in l.iter() {
        let mut k = nombre(Some(v));
        if let Some(pn) = pn {
            if k.is_nan() { return Some(None); }
            if k.fract() != 0.0 { return None; }
            let i = k - 1.0;
            k = if i >= 0.0 && (i as usize) < pn.len() { nombre(pn.get(i as usize)) } else { f64::NAN };
        }
        if k.is_nan() { return Some(None); }
        if k.fract() != 0.0 { return None; }
        let k = (k - 1.0) * 3.0;
        if !(k >= 0.0 && k + 2.0 < p.len() as f64) { return Some(None); }
        let k = k as usize;
        b.extend_from_slice(&p[k..k + 3]);
    }
    Some(Some(b))
}

struct Sortie { sf: Vec<f64>, si: Vec<i32> }
impl Sortie {
    /// `ajouterFace` : normale de Newell sur le contour extérieur, face écartée si elle est dégénérée
    fn face(&mut self, boucles: &[Vec<f64>]) {
        let b = &boucles[0];
        let n = b.len() / 3;
        if n < 3 { return; }
        let (mut nx, mut ny, mut nz) = (0.0f64, 0.0f64, 0.0f64);
        let mut j = n - 1;
        for i in 0..n {
            let (xi, yi, zi, xj, yj, zj) = (b[3 * i], b[3 * i + 1], b[3 * i + 2], b[3 * j], b[3 * j + 1], b[3 * j + 2]);
            nx += (yj - yi) * (zj + zi);
            ny += (zj - zi) * (xj + xi);
            nz += (xj - xi) * (yj + yi);
            j = i;
        }
        let l = (nx * nx + ny * ny + nz * nz).sqrt();
        if !(l > 1e-12) || !l.is_finite() { return; }
        self.si.push(boucles.len() as i32);
        for x in boucles.iter() { self.si.push((x.len() / 3) as i32); }
        self.sf.push(nx / l);
        self.sf.push(ny / l);
        self.sf.push(nz / l);
        for x in boucles.iter() { self.sf.extend_from_slice(x); }
    }
}
