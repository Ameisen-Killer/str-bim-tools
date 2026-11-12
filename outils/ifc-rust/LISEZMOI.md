# Lecteur IFC en Rust (WebAssembly)

Source du module `docs/ifc/ifc-lecteur.wasm`, chargé par `docs/ifc/ifc-lecteur.js` (lecture en arrière-plan de /ifc/).
Il fait la même découpe que `analyser` de `docs/ifc/ifc-core.js` (qui reste la référence et le secours), sans dépendance.

Compiler et publier :

    rustup target add wasm32-unknown-unknown
    cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/ifc_lecteur.wasm ../../docs/ifc/ifc-lecteur.wasm

puis monter `ifc-lecteur.wasm?v=` dans `docs/ifc/ifc-lecteur.js`.

## Maillage (src/maillage.rs)

Le même module sert aussi à la vue 3D (`ifc-vue.js`) : arêtes vives et triangulation de chaque élément
(`m_entree`, `m_calculer`, `m_sortie`, `m_long`, `m_ferme`, `m_liberer`). C'est la copie fidèle de
`aretesVives`, `trianguler` et `triangles` : toute correction faite d'un côté se reporte de l'autre.
Si le module manque ou plante, ou si on a choisi le lecteur JavaScript, le code JavaScript reprend la main.

## Faces triangulées et polygonales (src/tess.rs)

`IFCTRIANGULATEDFACESET` et `IFCPOLYGONALFACESET` (faces `IFCINDEXEDPOLYGONALFACE[WITHVOIDS]`) : la vue envoie le
texte STEP des entités et la matrice, le module rend les faces placées (`t_entree`, `t_octets`, `t_ent`, `t_mat`,
`t_calculer`, `t_sortie`, `t_long`, `t_liberer`). Copie fidèle de `tessellation` et `ajouterFace` d'ifc-vue.js ;
une valeur hors du cas courant (typée, chaîne, index non entier) renvoie un code et le JavaScript reprend.
