# Bench — base de données

Ce dossier n'est pas publié. Il sert à régénérer `docs/bench/donnees.js`, la base du comparateur
`str-bim-tools.com/bench/`.

- `generer-donnees.py` : fusionne le jeu de données
  [cpu-gpu-data-crawler](https://github.com/lijieyu233/cpu-gpu-data-crawler) (scores PassMark,
  caractéristiques TechPowerUp) avec la base saisie à la main, et estime le mono-cœur manquant.
- `complements-cpu.txt`, `complements-gpu.txt` : base saisie à la main (graphiques intégrées,
  puces de portable récentes, répartition des cœurs P + E…). Corriger ici, jamais dans `donnees.js`.

Mise à jour :

```
git clone --depth 1 https://github.com/lijieyu233/cpu-gpu-data-crawler.git /tmp/ds
python3 bench/generer-donnees.py /tmp/ds/out AAAA-MM-JJ   # date du relevé du jeu de données
```

Puis monter `donnees.js?v=` dans `docs/bench/index.html`.
