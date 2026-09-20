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

Authentication > Emails > SMTP Settings > **Enable custom SMTP** :

| Champ | Avec la boîte IONOS du domaine |
|---|---|
| Sender email | `contact@str-bim-tools.com` (la boîte elle-même, ou un alias de cette boîte) |
| Sender name | `STR Bim Tools` |
| Host | le serveur sortant indiqué par IONOS pour ta boîte (souvent `smtp.ionos.fr` ou `smtp.ionos.de`) |
| Port | `465` (SSL) ou `587` (STARTTLS) |
| Username | l'adresse complète de la boîte |
| Password | le mot de passe de la boîte (à saisir toi-même, dans Supabase uniquement) |

Il faut une vraie boîte chez IONOS, pas une simple redirection. À défaut : un service d'envoi
comme Brevo (gratuit jusqu'à 300 courriels par jour), qui demande d'ajouter quelques
enregistrements DNS chez IONOS.

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

1. Console > Nouvel utilisateur : une adresse à toi qui n'est pas encore inscrite, dans un bureau
   d'essai (ou le bureau d'essai de `jeu-essai.sql`), « Envoyer tout de suite le lien de bienvenue » coché.
2. Le courriel arrive, le lien ouvre « Bienvenue », tu choisis un mot de passe, tu entres dans le planning
   de ce bureau, et seulement lui.
3. Déconnexion, puis « Mot de passe oublié ou première connexion » avec la même adresse : second courriel,
   nouveau mot de passe.
4. Avec une adresse qui n'est pas dans la console : « Cette adresse n'est pas autorisée ».

## 8. Un courriel n'arrive pas

Dans l'ordre, du plus fréquent au plus rare.

- **Mis en quarantaine par le filtre du destinataire.** Constaté le 19.09.2026 avec un filtre d'entreprise :
  sujet en anglais, expéditeur `noreply@mail.app.supabase.io`, motif « Spam ». Cette adresse d'envoi par
  défaut est partagée par tous les projets Supabase et ne s'appuie pas sur le domaine du lien : beaucoup de
  filtres la retiennent. Faire les étapes 4 et 5 : l'expéditeur devient l'adresse du domaine, signée SPF et
  DKIM par lui, le texte passe en français et le lien ne transite plus par `supabase.co`. Puis demander au
  destinataire (ou à son informatique) de libérer le message et de mettre `str-bim-tools.com` en liste
  blanche — le domaine d'envoi, pas l'adresse Supabase partagée.
- **Adresse hors de l'équipe Supabase, sans SMTP à soi.** Supabase refuse l'envoi et la console ouvre
  « Courriel non envoyé ». Seule l'étape 4 y remédie.
- **Limite d'envoi.** 2 courriels par heure sans SMTP à soi, 30 avec ; et 60 secondes entre deux demandes
  pour une même adresse. La console affiche le message d'attente.
- **Refus du serveur d'envoi** (mot de passe de la boîte, expéditeur différent de la boîte) : la réponse
  exacte d'IONOS est dans Supabase, partie Logs, rubrique Auth.

État du domaine au 19.09.2026, vérifié dans les DNS publics : SPF `include:_spf-eu.ionos.com`,
DKIM `s1-ionos` et `s2-ionos` publiés, DMARC `p=none`. Rien à corriger de ce côté ; un `p=quarantine`
avec adresse de rapport pourra venir plus tard, une fois quelques envois aboutis.
