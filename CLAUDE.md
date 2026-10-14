# Consignes pour Claude

**Toujours travailler directement sur la version en ligne, sauf demande différente de Tony.**

- Enchaînement : lire le code → modifier → `node --check` sur les scripts touchés, monter les `?v=`
  → commit → **push sur `main`** → suivre le déploiement GitHub Pages jusqu'à `completed / success`
  → dire à Tony ce qu'il doit tester (Ctrl+F5).
- Session cloud : la branche `claude/…` imposée ne publie rien. Pousser le même commit sur `main`
  dans la foulée : `git push origin <branche>:main`.
- Interdit sans demande explicite : serveur local, capture Chromium/Playwright, jsdom, base Postgres
  jetable, faux serveur Supabase, script d'essai. La relecture se fait en lisant le code.
- Avant de toucher au site, charger le skill `str-bim-tools-site` : tout le reste y est.
