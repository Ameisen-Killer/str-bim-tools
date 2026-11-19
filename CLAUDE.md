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
- Base Supabase : Claude fait lui-même les modifications (demande de Tony, 16.11.2026) —
  `migration-<sujet>.sql` rejouable poussé sur `main`, tâche GitHub « Migration SQL »
  (`migration-sql.yml`, entrée `fichier`), journal relu, fichier retiré, `base-supabase.sql` à jour.
  Suppression ou réécriture de données : seulement avec l'accord explicite de Tony.
- Passations par sujet et façon de travailler avec Tony : dépôt privé `Ameisen-Killer/claude-memoire`
  (lire son `CLAUDE.md`). Le tenir à jour à chaque changement notable.
