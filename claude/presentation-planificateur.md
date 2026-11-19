# Présentation du planificateur : passation pour Claude

Fichier de référence pour toute session Claude (quel que soit le compte) qui reprend la page de
présentation du planificateur. À lire après `CLAUDE.md`. À tenir à jour à chaque changement notable.

## La page

- Dossier : `docs/planificateur-presentation-q7k3/`, en ligne sur
  https://str-bim-tools.com/planificateur-presentation-q7k3/
- Non référencée : noindex/nofollow, hors menu, hors sitemap, aucun lien entrant. Ne jamais en ajouter.
- Message voulu par Tony : outil sur mesure, l'IA ne remplace personne et amplifie les connaissances
  de chacun ; ton respectueux, phrases choc ; fin sur « La limite reste l'imagination... ».
- Thème AB (17.11.2026) : fond #F4F5F2, texte #202020, vert #5F9126, logo
  `/planif/assets/logo-ab-marque.svg` (grand pavé en haut à gauche, petit dans la barre).
  Ouverture : logo AB en volume filaire qui tourne (canvas `#scene`), sans décaler la bande son.
- Sections : 01 L'idée · 02 Tour de l'outil (Accueil, Communication, Tâches, Tableau de bord, Charge,
  Affaires, Équipe, Charlie aide, Téléphone ; plus de module Absences) · 03 Et l'IA dans tout ça ? ·
  04 Le Dashboard IA (ouvert pour la présentation) · 05 Ce qui change, ce qui reste ·
  06 Construit avec vous · fin.

## Captures

- Toujours le compte démo (bouton « Essayer la démo »), jamais de vraies données.
- Tâche GitHub « Captures de la présentation » : `.github/workflows/captures-presentation.yml`,
  `outils/presentation/captures.mjs` (Playwright sur le runner). Elle pousse les JPG sur `main`.
  Entrée `seulement=aide` pour ne refaire que la capture de Charlie (prise sur Tâches, jamais Absences).
- La démo publique reste aux couleurs STR : le logo AB n'est forcé que dans ce navigateur de capture.
- La session cloud ne joint pas le site (proxy) : cette tâche est la seule voie pour les images.

## Lecture audio

- `presentation/presentation.mp3` (deux voix, fournie par Tom) et `presentation/timeline.json`
  (`[début, fin]` en secondes, une entrée par bloc).
- Règle d'or : autant d'éléments `data-lecture="0..N"` dans `index.html` que d'entrées dans
  `timeline.json` (17 au 19.11.2026 ; Dashboard IA = 13).
- Quand Tom envoie un zip : ne reprendre que `presentation.mp3` et `timeline.json`. Ses
  `lecteur.js`/`lecteur.css`/`zoom-auto.js` sont plus anciens que la version en ligne.
- Tony veut 1 s de silence juste avant « Un outil sur mesure » (dans la pause après
  « …présenter le planificateur. », vers 6 s). L'ajouter à chaque nouvelle piste et décaler la
  timeline de +1 s (sauf le début du bloc 0). Mesurer la pause (silencedetect, comparaison avec
  l'ancienne piste), ne pas deviner : deux erreurs de placement déjà faites.
- Retouches avec ffmpeg (atrim/concat, anullsrc), sortie mp3 128k mono 44,1 kHz.
- `lecteur.js` : défilement automatique, bandeau replié pendant la lecture (19.11), repères
  `data-t="0.4"` pour caler le défilement d'un long bloc sur la voix (posés sur « L'idée », calés
  sur l'ancienne voix, à ajuster si besoin). `zoom-auto.js` : agrandit les captures pendant la lecture.
- Après toute modification : monter les `?v=` (timeline et mp3 dans `lecteur.js` et `zoom-auto.js`,
  scripts et css dans `index.html`).
- En attente : vérifier que « SIA » est bien épelé dans la piste de Tom.

## Façon de travailler avec Tony

- Tutoiement, français, réponses courtes en phrases simples : le résultat d'abord, puis le lien à
  tester (Ctrl+F5). Pas de liste de questions à la fin.
- Toujours en ligne (voir `CLAUDE.md`) : modifier, `node --check`, monter les `?v=`, commit,
  push sur `main`, suivre GitHub Pages jusqu'à `completed / success`.
- « Tu ne touches à rien d'autre » se prend au pied de la lettre.
- Faire sans demander ce qui se défait ; demander pour l'irréversible (données, base, envoi externe).
- Quand Tony signale un décalage, mesurer (transcription, silences, comparaison) avant de corriger.
