# Planification : réglages Supabase à faire une fois

Ces réglages accompagnent `migration-multi-bureaux.sql`, dans l'ordre ci-dessous.
Tout se fait dans le tableau de bord Supabase du projet (Authentication).
Ce fichier est public : il ne contient aucune adresse réelle ni aucun mot de passe.

## 1. Exécuter la migration

SQL Editor > New query > coller `migration-multi-bureaux.sql`, remplacer l'adresse d'exemple
de la ligne `set_config('planif.super_admin', …)` par ton adresse de connexion, Run.
Le tableau affiché à la fin doit montrer 1 bureau, tes accès, ton adresse en super admin, et 0 ligne sans bureau.
Le planning continue de fonctionner ; la console apparaît dans le menu (entrée « Console »).

## 2. Activer la garde des comptes

Authentication > Auth Hooks > Add a new hook > **Before User Created** > type **Postgres**,
schéma `public`, fonction `garde_creation_compte` > Create.

Elle refuse la création d'un compte pour toute adresse absente de la liste des accès de la console.

## 3. Ouvrir la création des comptes

Authentication > Sign In / Providers :

- **Allow new users to sign up** : activé (la garde filtre les adresses) ;
- fournisseur **Email** : **Confirm email** activé. Indispensable : sans confirmation, quelqu'un
  qui connaîtrait une adresse inscrite pourrait ouvrir le compte à sa place ;
- **Email OTP Expiration** : `86400` (24 h), pour que le lien de bienvenue reste valable une journée.

La console (rubrique « 03 — Mise en route ») vérifie seule les deux premiers points.

## 4. Brancher un serveur d'envoi (SMTP)

Sans lui, Supabase n'envoie ses courriels qu'aux membres de ton équipe Supabase, à 2 par heure :
les utilisateurs des autres bureaux ne recevraient rien.

**La boîte IONOS ne convient pas** : `contact@str-bim-tools.com` est une simple redirection vers
Gmail, et l'offre ne contient aucune boîte aux lettres (toutes payantes). Une redirection n'a pas
de mot de passe : IONOS répond `535 "Authentication credentials invalid"`.

Choix retenu le 20.09.2026 : **Resend** (gratuit, 3 000 courriels par mois, 100 par jour),
compte lié au compte GitHub, domaine vérifié en région Irlande, suivi des clics **désactivé** —
sinon Resend réécrirait les liens de connexion.

Trois enregistrements à ajouter dans la zone DNS du domaine, chez IONOS :

| Type | Nom | Valeur | Priorité |
|---|---|---|---|
| TXT | `resend._domainkey` | la clé DKIM donnée par Resend (`p=…`) | — |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

Ils ne touchent ni les MX du domaine, ni le SPF racine, ni les A de GitHub Pages : tout vit sur le
sous-domaine `send` et sur un sélecteur DKIM. **Ne pas ajouter** le quatrième enregistrement que
propose Resend (`MX @ inbound-smtp…`, section « Enable Receiving », à laisser désactivée) : il
détournerait le courrier entrant du domaine.

Puis Authentication > Emails > SMTP Settings > **Enable custom SMTP** :

| Champ | Valeur |
|---|---|
| Sender email | `contact@str-bim-tools.com` (n'importe quelle adresse du domaine vérifié) |
| Sender name | `STR Bim Tools` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | une clé API Resend, permission *Sending access* (à créer et coller soi-même) |

Ensuite, Authentication > Rate Limits : la limite d'envoi passe à 30 courriels par heure, ce qui suffit.

## 5. Modèles de courriels en français

Authentication > Emails > Templates. Pour chacun : remplacer le sujet et le corps (onglet Source).
Les liens pointent directement sur la page de connexion de l'outil, avec le jeton après le `#` :
il n'est jamais envoyé au serveur du site, et la page ne l'utilise qu'au moment où la personne
valide son mot de passe (un antivirus de messagerie qui ouvre les liens à l'avance ne le grille pas).

### Confirm signup — nouvel utilisateur

Sujet : `Ton accès à la planification STR Bim Tools`

```html
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#16130F;max-width:520px">
  <p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7A5312;margin:0 0 12px">STR Bim Tools · Planification</p>
  <h1 style="font-weight:300;font-size:26px;margin:0 0 16px">Bienvenue</h1>
  <p>Un accès à l'outil de planification vient d'être ouvert pour ton adresse. Clique sur le bouton
     pour choisir ton mot de passe : tu entreras ensuite directement dans l'outil.</p>
  <p style="margin:26px 0">
    <a href="https://str-bim-tools.com/planif/connexion/#jeton={{ .TokenHash }}&type=signup"
       style="display:inline-block;padding:12px 22px;border:1px solid #7A5312;color:#7A5312;text-decoration:none;letter-spacing:.12em;text-transform:uppercase;font-size:13px">Choisir mon mot de passe</a>
  </p>
  <p style="font-size:13px;color:#5B554C">Ce lien est personnel et ne sert qu'une fois. S'il a expiré :
     https://str-bim-tools.com/planif/connexion/, ton adresse, puis « Mot de passe oublié ou première connexion ».</p>
</div>
```

### Magic Link — mot de passe oublié

Sujet : `Ton lien de connexion à la planification`

```html
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#16130F;max-width:520px">
  <p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7A5312;margin:0 0 12px">STR Bim Tools · Planification</p>
  <h1 style="font-weight:300;font-size:26px;margin:0 0 16px">Nouveau mot de passe</h1>
  <p>Tu as demandé un lien pour te connecter à l'outil de planification. Clique sur le bouton pour
     choisir un nouveau mot de passe.</p>
  <p style="margin:26px 0">
    <a href="https://str-bim-tools.com/planif/connexion/#jeton={{ .TokenHash }}&type=magiclink"
       style="display:inline-block;padding:12px 22px;border:1px solid #7A5312;color:#7A5312;text-decoration:none;letter-spacing:.12em;text-transform:uppercase;font-size:13px">Choisir un mot de passe</a>
  </p>
  <p style="font-size:13px;color:#5B554C">Ce lien ne sert qu'une fois. Si tu n'as rien demandé, ignore ce courriel :
     ton mot de passe actuel reste valable.</p>
</div>
```

### Reset Password — réinitialisation lancée depuis Supabase

Sujet : `Nouveau mot de passe pour la planification`

```html
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#16130F;max-width:520px">
  <p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#7A5312;margin:0 0 12px">STR Bim Tools · Planification</p>
  <h1 style="font-weight:300;font-size:26px;margin:0 0 16px">Nouveau mot de passe</h1>
  <p>Clique sur le bouton pour choisir un nouveau mot de passe pour l'outil de planification.</p>
  <p style="margin:26px 0">
    <a href="https://str-bim-tools.com/planif/connexion/#jeton={{ .TokenHash }}&type=recovery"
       style="display:inline-block;padding:12px 22px;border:1px solid #7A5312;color:#7A5312;text-decoration:none;letter-spacing:.12em;text-transform:uppercase;font-size:13px">Choisir un mot de passe</a>
  </p>
  <p style="font-size:13px;color:#5B554C">Ce lien ne sert qu'une fois. Si tu n'as rien demandé, ignore ce courriel.</p>
</div>
```

## 6. Adresse de retour (facultatif)

Utile seulement tant que les modèles d'origine de Supabase restent en place.
Authentication > URL Configuration : **Site URL** `https://str-bim-tools.com/planif/connexion/`,
et la même adresse dans **Redirect URLs**.

## 7. Essai

1. Console > Nouvelle personne : un prénom et un nom, une adresse à toi qui n'est pas encore inscrite,
   dans un bureau d'essai (ou le bureau d'essai de `jeu-essai.sql`). Coche « Se connecte à l'outil »,
   mets l'accès sur « Ouvert » et coche « Envoyer tout de suite le lien de bienvenue ».
2. Le courriel arrive, le lien ouvre « Bienvenue », tu choisis un mot de passe, tu entres dans le planning
   de ce bureau, et seulement lui.
3. Déconnexion, puis « Mot de passe oublié ou première connexion » avec la même adresse : second courriel,
   nouveau mot de passe.
4. Avec une adresse qui n'est pas dans la console : « Cette adresse n'est pas autorisée ».

## 8. Un courriel n'arrive pas

Dans l'ordre, du plus fréquent au plus rare.

Premier réflexe : le journal d'envoi de Resend (resend.com > Emails) dit si le courriel est parti et
s'il a été accepté par le serveur du destinataire (`Delivered`). Ensuite seulement, chercher plus loin.

- **Mis en quarantaine par le filtre du destinataire.** Constaté le 19.09.2026 avec un filtre d'entreprise :
  sujet en anglais, expéditeur `noreply@mail.app.supabase.io`, motif « Spam ». Cette adresse d'envoi par
  défaut est partagée par tous les projets Supabase et ne s'appuie pas sur le domaine du lien : beaucoup de
  filtres la retiennent. Les étapes 4 et 5 y remédient : expéditeur du domaine, signé DKIM, SPF aligné,
  texte en français, lien direct vers le site. Si un message est encore retenu, demander au destinataire
  (ou à son informatique) de le libérer et de mettre `str-bim-tools.com` en liste blanche — le domaine
  d'envoi, jamais l'adresse Supabase partagée. `Delivered` chez Resend n'exclut pas la quarantaine :
  le filtre accepte le message, puis le met de côté.
- **Adresse hors de l'équipe Supabase, sans SMTP à soi.** Supabase refuse l'envoi et la console ouvre
  « Courriel non envoyé ». Seule l'étape 4 y remédie.
- **Limite d'envoi.** 2 courriels par heure sans SMTP à soi, 30 avec ; et 60 secondes entre deux demandes
  pour une même adresse. La console affiche le message d'attente. Côté Resend : 100 par jour, 3 000 par mois.
- **Refus du serveur d'envoi.** La réponse exacte est dans Supabase, partie Logs, rubrique Auth : ouvrir
  la ligne en erreur, champ `error`. `535 "Authentication credentials invalid"` = identifiant ou clé
  refusés ; avec Resend, l'identifiant est `resend` et le mot de passe une clé API valide.
- **Domaine Resend non vérifié** (statut autre que `Verified`) : l'envoi est refusé tant que les trois
  enregistrements DNS ne sont pas lus. Le bouton « Verify DNS Records » relance la vérification.

État du domaine au 20.09.2026, vérifié dans les DNS publics : SPF racine `include:_spf-eu.ionos.com`
(messagerie IONOS), DKIM IONOS `s1-ionos` / `s2-ionos`, DKIM Resend `resend._domainkey`,
sous-domaine d'envoi `send` (MX + SPF Amazon SES), DMARC `p=none`. Un `p=quarantine` avec adresse
de rapport pourra venir plus tard, une fois quelques semaines d'envois passées sans incident.
