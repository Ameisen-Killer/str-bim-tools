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
- Base Supabase : Claude fait lui-même les modifications (demande de Tony, 16.11.2026), **par le
  connecteur Supabase** de la session (demande de Tony, 19.11.2026) : projet « Planif », SQL rejouable
  appliqué avec `apply_migration` (lecture et contrôle avec `execute_sql`), `base-supabase.sql` mis à
  jour dans le même commit. Sans connecteur dans la session : ancienne voie, `migration-<sujet>.sql`
  poussé sur `main`, tâche GitHub « Migration SQL » (`migration-sql.yml`, entrée `fichier`), journal
  relu, fichier retiré. Le connecteur ne règle pas l'authentification (modèles de courriels, SMTP) :
  c'est Tony qui le fait dans Supabase. Suppression ou réécriture de données : seulement avec
  l'accord explicite de Tony.
- Passations par sujet et façon de travailler avec Tony : dépôt privé `Ameisen-Killer/claude-memoire`
  (lire son `CLAUDE.md`). Le tenir à jour à chaque changement notable.
