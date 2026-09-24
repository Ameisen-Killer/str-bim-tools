# Buro — Amicale de Douvaine

Outil interne du bureau de l'Amicale de Douvaine (discussions, tâches, projets, planning,
matériel et locations, feedbacks, documents, boîte à idées, membres).
Reprise en ligne du prototype local V5 : mêmes écrans, mêmes règles, même charte,
plus la connexion et une base partagée.

**Hébergement provisoire** : `https://str-bim-tools.com/kevin/`, en attendant la migration
vers le domaine, le GitHub et le Supabase de l'Amicale (voir plus bas).
Ce fichier est public : il ne contient aucune adresse réelle ni aucun mot de passe.

## Fichiers

```
docs/kevin/                    ← publié tel quel (GitHub Pages), autonome
├─ index.html                  l'application (une seule page, navigation en bas)
├─ connexion/index.html        connexion, première connexion, mot de passe oublié
├─ assets/styles.css           charte du prototype (jaune, traits noirs, ombres décalées)
├─ assets/config.js            URL + clé PUBLIABLE Supabase (vide = mode démonstration)
├─ assets/supabase.js          client REST écrit à la main (session, requêtes, fichiers)
├─ assets/donnees.js           couche de données : démonstration (navigateur) ou Supabase
├─ assets/app.js               écrans et règles métier
├─ manifest.webmanifest, icon.svg, service-worker.js   installation sur téléphone (PWA)
kevin/                         ← non publié
├─ base-supabase.sql           schéma complet : tables, RLS, gardes, hook, bucket
└─ README.md                   ce fichier
```

Tous les chemins sont **relatifs** : le dossier `docs/kevin/` fonctionne tel quel à la racine
d'un autre domaine. Aucune bibliothèque, aucun appel externe hors Supabase.
Chaque fichier de `assets/` est chargé avec `?v=N` : monter le numéro (dans `index.html`,
`connexion/index.html` et `service-worker.js`) à chaque modification.

## Deux modes

- **Démonstration** (`config.js` sans `url`) : données fictives du prototype dans le navigateur,
  sélecteur d'utilisateur en haut à droite, tuile « Réinitialiser ». Pas de connexion.
- **En ligne** (`url` + `cle` renseignées) : connexion obligatoire, données partagées dans Supabase,
  fichiers (documents, photos de location) dans le bucket privé `buro`.

## Rôles

| Rôle | Droits |
|---|---|
| Super admin | tout ce que fait le Président, plus nommer ou modifier un super admin |
| Président | crée et modifie les projets, voit les projets privés, valide toute tâche, feedbacks, gère les membres |
| État-major, Membre du bureau | voit les projets publics et ceux où il est autorisé, responsable ou adjoint ; crée des tâches ; déclare faites les siennes ; valide celles des projets dont il est responsable ou adjoint |

La liste des **membres** est aussi la liste blanche de connexion : une adresse absente,
ou dont l'accès est fermé, ne peut ni créer de compte ni lire quoi que ce soit.

## Mise en route du projet Supabase (une fois)

1. **Créer le projet** sur supabase.com : New project, nom `buro-amicale`, région *Central EU (Frankfurt)*,
   un mot de passe de base de données (à garder pour soi, il ne sert pas au site).
2. **Schéma** : SQL Editor > New query > coller `kevin/base-supabase.sql`, remplacer l'adresse
   d'exemple de la ligne `set_config('buro.super_admin', …)` par l'adresse du super admin
   (et son nom sur la ligne suivante), Run. Le tableau final doit montrer cette adresse en `superadmin`.
3. **Garde des comptes** : Authentication > Auth Hooks > Add hook > *Before User Created* >
   Postgres, schéma `public`, fonction `garde_creation_compte`.
4. **Inscriptions** : Authentication > Sign In / Providers : *Allow new users to sign up* activé
   (la garde filtre), fournisseur Email avec *Confirm email* activé.
5. **Adresse de retour** : Authentication > URL Configuration : *Site URL*
   `https://str-bim-tools.com/kevin/connexion/`, et la même adresse dans *Redirect URLs*.
6. **Clés** : Project Settings > API Keys : copier l'URL du projet et la clé **publishable**
   (`sb_publishable_…`) dans `docs/kevin/assets/config.js`. Jamais la clé secrète.
7. **Première connexion** : `https://str-bim-tools.com/kevin/connexion/`, saisir son adresse,
   « Première connexion ou mot de passe oublié », ouvrir le courriel, choisir son mot de passe.

Sans serveur d'envoi (SMTP), Supabase n'envoie ses courriels qu'aux membres de l'équipe du
projet Supabase (2 par heure) : suffisant pour le super admin, pas pour le bureau.
Avant d'ouvrir l'accès aux autres membres, brancher un SMTP (Resend, comme pour la planification :
voir `reglages-supabase.md` à la racine du dépôt, section 4) et, si on veut, des modèles de
courriels en français avec le jeton après le `#` (section 5, adresse `…/kevin/connexion/`).

## Ajouter un membre

Plus > Membres > « + Membre » (Président ou super admin) : nom, adresse, rôle.
La personne ouvre la page de connexion, saisit son adresse puis « Première connexion ou mot de
passe oublié ». Fermer l'accès (case décochée) coupe la connexion sans effacer son historique.

## Migration vers l'Amicale (plus tard)

1. **GitHub** : nouveau dépôt de l'Amicale ; y copier le contenu de `docs/kevin/` dans `docs/`
   (ou à la racine) et `kevin/*` à côté ; GitHub Pages sur ce dossier ; fichier `CNAME` avec le
   domaine de l'Amicale ; DNS du domaine vers GitHub Pages.
2. **Supabase** : transférer le projet `buro-amicale` dans l'organisation Supabase de l'Amicale
   (Project Settings > General > Transfer project) — données, comptes et fichiers suivent.
   Puis mettre à jour *Site URL* et *Redirect URLs* avec le nouveau domaine.
   Rien à changer dans `config.js` : l'URL et la clé du projet restent les mêmes.
3. Les sessions ouvertes sur `str-bim-tools.com/kevin/` ne suivent pas (autre domaine) :
   chacun se reconnecte une fois avec son mot de passe habituel.
4. Retirer `docs/kevin/` et `kevin/` de ce dépôt.

## Écarts assumés avec le prototype

- Les photos de location et les documents sont réellement stockés (bucket `buro`) et
  téléchargeables ; la fiche de location affiche les signatures.
- Les messages sont horodatés par la base ; la discussion ouverte se rafraîchit toutes les 6 s,
  tout se recharge au retour sur l'onglet. Entrée envoie un message.
- Les feedbacks archivés ne sont visibles que du Président (règle de `docs/architecture.md` du prototype).
- « Préparer l'envoi mail » dépose une demande dans la table `mail_queue` ; l'envoi réel viendra
  avec un service d'envoi.
- Pièce jointe dans la discussion : pas encore branchée (bouton présent, comme dans le prototype).
