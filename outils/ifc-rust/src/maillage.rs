//! Maillage d'un élément pour la vue 3D de /ifc/ : arêtes vives et triangles.
//!
//! Reprend à l'identique `aretesVives`, `trianguler` (ponts vers les trous, découpe en oreilles) et
//! `triangles` de docs/ifc/ifc-vue.js : mêmes tolérances, même ordre, mêmes cas particuliers. Les clés
//! des sommets sont des triplets d'entiers au lieu de chaînes, d'où le gain de vitesse.
//!
//! Appels (depuis ifc-vue.js) : `m_entree(ni, nf)` prépare les tableaux d'entrée ; la page y écrit
//!   - entiers `m_ent_i()` : [mode, nb faces, puis par face : nb boucles, nb points de chaque boucle…]
//!   - réels `m_ent_f()`   : [q, puis par face : normale (3), puis les points de ses boucles bout à bout]
//! (mode : 1 = arêtes, 2 = triangles, 3 = les deux) ; `m_calculer()` → 0 si tout va bien ; puis
//! `m_sortie(k)` / `m_long(k)` : 0 triangles (réels), 1 face de chaque triangle (entiers),
//! 2 arêtes vives (réels), 3 arêtes de chaque face (entiers : par face, n puis n paires boucle, sommet) ;
//! `m_ferme()` : 1 si chaque arête sert un nombre pair de fois.

use std::collections::HashMap;

const COS_VIF: f64 = 0.882_947_592_858_926_9; // cos 28°

#[derive(Default)]
struct Maille {
    ei: Vec<i32>,
    ef: Vec<f64>,
    t: Vec<f64>,
    tf: Vec<i32>,
    a: Vec<f64>,
    ar: Vec<i32>,
    ferme: i32,
}

static mut MAILLE: Option<Maille> = None;

fn maille() -> &'static mut Maille {
    unsafe {
        let r = &mut *std::ptr::addr_of_mut!(MAILLE);
        if r.is_none() {
            *r = Some(Maille::default());
        }
        r.as_mut().unwrap()
    }
}

struct Face {
    n: [f64; 3],
    deb: usize,          // premier réel de ses points dans ef
    boucles: Vec<usize>, // nb points de chaque boucle
}

#[no_mangle]
pub extern "C" fn m_entree(ni: usize, nf: usize) -> i32 {
    let m = maille();
    m.ei.clear();
    m.ei.resize(ni, 0);
    m.ef.clear();
    m.ef.resize(nf, 0.0);
    0
}
#[no_mangle]
pub extern "C" fn m_ent_i() -> *mut i32 { maille().ei.as_mut_ptr() }
#[no_mangle]
pub extern "C" fn m_ent_f() -> *mut f64 { maille().ef.as_mut_ptr() }
#[no_mangle]
pub extern "C" fn m_ferme() -> i32 { maille().ferme }
#[no_mangle]
pub extern "C" fn m_sortie(k: i32) -> usize {
    let m = maille();
    match k {
        0 => m.t.as_ptr() as usize,
        1 => m.tf.as_ptr() as usize,
        2 => m.a.as_ptr() as usize,
        _ => m.ar.as_ptr() as usize,
    }
}
#[no_mangle]
pub extern "C" fn m_long(k: i32) -> i32 {
    let m = maille();
    (match k {
        0 => m.t.len(),
        1 => m.tf.len(),
        2 => m.a.len(),
        _ => m.ar.len(),
    }) as i32
}
/// rend la mémoire des tableaux (après un gros élément)
#[no_mangle]
pub extern "C" fn m_liberer() {
    unsafe { *std::ptr::addr_of_mut!(MAILLE) = None; }
}

#[no_mangle]
pub extern "C" fn m_calculer() -> i32 {
    let m = maille();
    m.t.clear();
    m.tf.clear();
    m.a.clear();
    m.ar.clear();
    m.ferme = 1;
    if m.ei.len() < 2 || m.ef.is_empty() {
        return 1;
    }
    let mode = m.ei[0];
    let nfaces = m.ei[1].max(0) as usize;
    let mut faces: Vec<Face> = Vec::with_capacity(nfaces);
    let (mut pi, mut pf) = (2usize, 1usize);
    for _ in 0..nfaces {
        if pi >= m.ei.len() || pf + 3 > m.ef.len() {
            return 2;
        }
        let nb = m.ei[pi].max(0) as usize;
        pi += 1;
        if pi + nb > m.ei.len() {
            return 2;
        }
        let boucles: Vec<usize> = m.ei[pi..pi + nb].iter().map(|&x| x.max(0) as usize).collect();
        pi += nb;
        let n = [m.ef[pf], m.ef[pf + 1], m.ef[pf + 2]];
        pf += 3;
        let deb = pf;
        pf += boucles.iter().map(|&k| 3 * k).sum::<usize>();
        if pf > m.ef.len() {
            return 2;
        }
        faces.push(Face { n, deb, boucles });
    }
    let q = m.ef[0];
    if mode & 1 != 0 {
        aretes(&m.ef, &faces, q, &mut m.a, &mut m.ar, &mut m.ferme);
    }
    if mode & 2 != 0 {
        for (fi, f) in faces.iter().enumerate() {
            let ix = trianguler(&m.ef, f);
            let mut k = 0;
            while k + 2 < ix.len() {
                for j in 0..3 {
                    let v = f.deb + 3 * ix[k + j];
                    m.t.extend_from_slice(&m.ef[v..v + 3]);
                }
                m.tf.push(fi as i32);
                k += 3;
            }
        }
    }
    0
}

// ================= Arêtes vives =================
fn rond(x: f64) -> i64 { (x + 0.5).floor() as i64 } // Math.round

fn aretes(ef: &[f64], faces: &[Face], q: f64, seg: &mut Vec<f64>, ar_out: &mut Vec<i32>, ferme: &mut i32) {
    type Cle = (i64, i64, i64);
    let cle = |i: usize| -> Cle { (rond(ef[i] / q), rond(ef[i + 1] / q), rond(ef[i + 2] / q)) };
    // tableau des arêtes dans l'ordre où elles apparaissent (comme une Map JavaScript)
    let mut index: HashMap<(Cle, Cle), usize> = HashMap::new();
    let mut listes: Vec<Vec<u32>> = Vec::new();
    for (fi, f) in faces.iter().enumerate() {
        let mut d = f.deb;
        for (bi, &n) in f.boucles.iter().enumerate() {
            for i in 0..n {
                let j = (i + 1) % n;
                let a = cle(d + 3 * i);
                let c = cle(d + 3 * j);
                if a == c {
                    continue;
                }
                let k = if a < c { (a, c) } else { (c, a) };
                let l = match index.get(&k) {
                    Some(&x) => x,
                    None => {
                        index.insert(k, listes.len());
                        listes.push(Vec::new());
                        listes.len() - 1
                    }
                };
                let v = &mut listes[l];
                v.push(fi as u32);
                v.push(bi as u32);
                v.push(i as u32);
            }
            d += 3 * n;
        }
    }
    let mut ar: Vec<Vec<i32>> = vec![Vec::new(); faces.len()];
    *ferme = 1;
    let dot = |a: &[f64; 3], b: &[f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for l in listes.iter() {
        if (l.len() / 3) % 2 == 1 {
            *ferme = 0;
        }
        let mut vive = l.len() < 6;
        let mut r0 = 3;
        while !vive && r0 < l.len() {
            vive = dot(&faces[l[0] as usize].n, &faces[l[r0] as usize].n).abs() < COS_VIF;
            r0 += 3;
        }
        if !vive {
            continue;
        }
        let mut r = 0;
        while r < l.len() {
            ar[l[r] as usize].push(l[r + 1] as i32);
            ar[l[r] as usize].push(l[r + 2] as i32);
            r += 3;
        }
        let f = &faces[l[0] as usize];
        let bi = l[1] as usize;
        let d = f.deb + 3 * f.boucles[..bi].iter().sum::<usize>();
        let n = f.boucles[bi];
        let i = l[2] as usize;
        let j = (i + 1) % n;
        seg.extend_from_slice(&ef[d + 3 * i..d + 3 * i + 3]);
        seg.extend_from_slice(&ef[d + 3 * j..d + 3 * j + 3]);
    }
    for a in ar.iter() {
        ar_out.push((a.len() / 2) as i32);
        ar_out.extend_from_slice(a);
    }
}

// ================= Triangulation d'une face plane avec trous =================
fn aire(ix: &[usize], x: &[f64], y: &[f64]) -> f64 {
    let mut s = 0.0;
    let n = ix.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        s += (x[ix[j]] - x[ix[i]]) * (y[ix[j]] + y[ix[i]]);
        j = i;
    }
    s / 2.0
}
#[inline]
fn orient(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> f64 { (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) }
fn croise(x: &[f64], y: &[f64], a: usize, b: usize, c: usize, d: usize) -> bool {
    let d1 = orient(x[a], y[a], x[b], y[b], x[c], y[c]);
    let d2 = orient(x[a], y[a], x[b], y[b], x[d], y[d]);
    let d3 = orient(x[c], y[c], x[d], y[d], x[a], y[a]);
    let d4 = orient(x[c], y[c], x[d], y[d], x[b], y[b]);
    ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0)) && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
}
#[inline]
fn meme_point(x: &[f64], y: &[f64], a: usize, b: usize) -> bool { x[a] == x[b] && y[a] == y[b] }
fn sur_segment(x: &[f64], y: &[f64], a: usize, b: usize, q: usize) -> bool {
    let (ex, ey) = (x[b] - x[a], y[b] - y[a]);
    let l2 = ex * ex + ey * ey;
    let (qx, qy) = (x[q] - x[a], y[q] - y[a]);
    if !(l2 > 0.0) || (ex * qy - ey * qx).abs() > 1e-9 * l2 {
        return false;
    }
    let t = (ex * qx + ey * qy) / l2;
    t > 1e-12 && t < 1.0 - 1e-12
}
fn ponts(mut ext: Vec<usize>, mut trous: Vec<Vec<usize>>, x: &[f64], y: &[f64]) -> Vec<usize> {
    let maxx = |h: &Vec<usize>| h.iter().fold(f64::NEG_INFINITY, |m, &i| if x[i] > m { x[i] } else { m });
    trous.sort_by(|h, k| {
        let (mh, mk) = (maxx(h), maxx(k));
        (mk - mh).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    for ti in 0..trous.len() {
        let h = &trous[ti];
        let mut im = 0;
        for i in 1..h.len() {
            if x[h[i]] > x[h[im]] {
                im = i;
            }
        }
        let mm = h[im];
        let (mut best, mut best_d, mut secours, mut secours_d) = (usize::MAX, f64::INFINITY, usize::MAX, f64::INFINITY);
        for p in 0..ext.len() {
            let pp = ext[p];
            let d = (x[pp] - x[mm]) * (x[pp] - x[mm]) + (y[pp] - y[mm]) * (y[pp] - y[mm]);
            if d < secours_d {
                secours_d = d;
                secours = p;
            }
            if d >= best_d {
                continue;
            }
            let mut libre = true;
            let mut e = 0;
            while e < ext.len() && libre {
                let (u, v) = (ext[e], ext[(e + 1) % ext.len()]);
                e += 1;
                if u == pp || v == pp || meme_point(x, y, u, pp) || meme_point(x, y, v, pp) {
                    continue;
                }
                if croise(x, y, mm, pp, u, v) {
                    libre = false;
                }
            }
            let mut t = ti;
            while t < trous.len() && libre {
                let hh = &trous[t];
                let mut e = 0;
                while e < hh.len() && libre {
                    let (u, v) = (hh[e], hh[(e + 1) % hh.len()]);
                    e += 1;
                    if u == mm || v == mm {
                        continue;
                    }
                    if croise(x, y, mm, pp, u, v) {
                        libre = false;
                    }
                }
                t += 1;
            }
            let mut e = 0;
            while e < ext.len() && libre {
                let u = ext[e];
                e += 1;
                if !meme_point(x, y, u, pp) && !meme_point(x, y, u, mm) && sur_segment(x, y, mm, pp, u) {
                    libre = false;
                }
            }
            let mut t = ti;
            while t < trous.len() && libre {
                let hh = &trous[t];
                let mut e = 0;
                while e < hh.len() && libre {
                    let u = hh[e];
                    e += 1;
                    if !meme_point(x, y, u, pp) && !meme_point(x, y, u, mm) && sur_segment(x, y, mm, pp, u) {
                        libre = false;
                    }
                }
                t += 1;
            }
            if libre {
                best = p;
                best_d = d;
            }
        }
        if best == usize::MAX {
            best = secours;
        }
        if best == usize::MAX {
            continue; // contour extérieur vide : rien à relier (JavaScript : même résultat dégénéré)
        }
        let mut neuf = Vec::with_capacity(ext.len() + h.len() + 2);
        neuf.extend_from_slice(&ext[..best + 1]);
        neuf.extend_from_slice(&h[im..]);
        neuf.extend_from_slice(&h[..im + 1]);
        neuf.push(ext[best]);
        neuf.extend_from_slice(&ext[best + 1..]);
        ext = neuf;
    }
    ext
}
fn dans_tri(x: &[f64], y: &[f64], a: usize, b: usize, c: usize, p: usize) -> bool {
    orient(x[a], y[a], x[b], y[b], x[p], y[p]) >= 0.0
        && orient(x[b], y[b], x[c], y[c], x[p], y[p]) >= 0.0
        && orient(x[c], y[c], x[a], y[a], x[p], y[p]) >= 0.0
}
fn oreilles(poly: &[usize], x: &[f64], y: &[f64], out: &mut Vec<usize>) {
    let n = poly.len();
    let mut prev: Vec<usize> = (0..n).map(|k| (k + n - 1) % n).collect();
    let mut next: Vec<usize> = (0..n).map(|k| (k + 1) % n).collect();
    let (mut reste, mut i, mut essais) = (n, 0usize, 0usize);
    let coupe = |i: usize, prev: &mut Vec<usize>, next: &mut Vec<usize>, reste: &mut usize, essais: &mut usize, out: &mut Vec<usize>| -> usize {
        out.push(poly[prev[i]]);
        out.push(poly[i]);
        out.push(poly[next[i]]);
        let (p, s) = (prev[i], next[i]);
        next[p] = s;
        prev[s] = p;
        *reste -= 1;
        *essais = 0;
        next[i]
    };
    while reste > 3 {
        let (a, c) = (prev[i], next[i]);
        let (pa, pb, pc) = (poly[a], poly[i], poly[c]);
        let mut ok = false;
        if orient(x[pa], y[pa], x[pb], y[pb], x[pc], y[pc]) > 0.0 {
            ok = true;
            let mut p = next[c];
            while p != a && ok {
                let pp = poly[p];
                if !(meme_point(x, y, pp, pa) || meme_point(x, y, pp, pb) || meme_point(x, y, pp, pc)) && dans_tri(x, y, pa, pb, pc, pp) {
                    ok = false;
                }
                p = next[p];
            }
        }
        if ok {
            i = coupe(i, &mut prev, &mut next, &mut reste, &mut essais, out);
            continue;
        }
        i = c;
        essais += 1;
        if essais > reste {
            i = coupe(i, &mut prev, &mut next, &mut reste, &mut essais, out); // polygone dégénéré : on coupe quand même
        }
    }
    out.push(poly[prev[i]]);
    out.push(poly[i]);
    out.push(poly[next[i]]);
}
/// indices des sommets (boucles mises bout à bout) des triangles d'une face
fn trianguler(ef: &[f64], f: &Face) -> Vec<usize> {
    let b = &f.boucles;
    let n0 = if b.len() == 1 { b[0] } else { 0 };
    if b.len() == 1 && n0 == 3 {
        return vec![0, 1, 2];
    }
    if b.is_empty() {
        return Vec::new();
    }
    let (ax, ay, az) = (f.n[0].abs(), f.n[1].abs(), f.n[2].abs());
    let (iu, iv) = if az >= ax && az >= ay { (0, 1) } else if ax >= ay { (1, 2) } else { (2, 0) };
    let total: usize = b.iter().sum();
    let mut x = Vec::with_capacity(total);
    let mut y = Vec::with_capacity(total);
    let mut boucles: Vec<Vec<usize>> = Vec::with_capacity(b.len());
    let mut base = 0;
    let mut d = f.deb;
    for &n in b.iter() {
        let mut ix = Vec::with_capacity(n);
        for i in 0..n {
            x.push(ef[d + 3 * i + iu]);
            y.push(ef[d + 3 * i + iv]);
            ix.push(base + i);
        }
        base += n;
        d += 3 * n;
        boucles.push(ix);
    }
    if aire(&boucles[0], &x, &y) < 0.0 {
        for v in x.iter_mut() {
            *v = -*v; // contour extérieur dans le sens direct
        }
    }
    if b.len() == 1 && n0 == 4 {
        // quadrilatère : coupé par la diagonale qui reste à l'intérieur
        if orient(x[0], y[0], x[1], y[1], x[2], y[2]) > 0.0 && orient(x[0], y[0], x[2], y[2], x[3], y[3]) > 0.0 {
            return vec![0, 1, 2, 0, 2, 3];
        }
        return vec![1, 2, 3, 1, 3, 0];
    }
    let trous: Vec<Vec<usize>> = boucles[1..]
        .iter()
        .filter(|h| h.len() >= 3)
        .map(|h| if aire(h, &x, &y) > 0.0 { h.iter().rev().cloned().collect() } else { h.clone() })
        .collect();
    let ext = boucles.swap_remove(0);
    let poly = if trous.is_empty() { ext } else { ponts(ext, trous, &x, &y) };
    let mut out = Vec::new();
    if poly.len() >= 3 {
        oreilles(&poly, &x, &y, &mut out);
    }
    out
}
