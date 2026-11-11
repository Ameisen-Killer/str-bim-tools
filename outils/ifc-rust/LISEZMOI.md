# Lecteur IFC en Rust (WebAssembly)

Source du module `docs/ifc/ifc-lecteur.wasm`, chargé par `docs/ifc/ifc-lecteur.js` (lecture en arrière-plan de /ifc/).
Il fait la même découpe que `analyser` de `docs/ifc/ifc-core.js` (qui reste la référence et le secours), sans dépendance.

Compiler et publier :

    rustup target add wasm32-unknown-unknown
    cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/ifc_lecteur.wasm ../../docs/ifc/ifc-lecteur.wasm

puis monter `ifc-lecteur.wasm?v=` dans `docs/ifc/ifc-lecteur.js`.
