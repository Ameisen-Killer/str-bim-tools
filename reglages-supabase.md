# Planification : réglages Supabase à faire une fois

Ces réglages accompagnent l'installation de la base (`base-supabase.sql`), dans l'ordre ci-dessous.
Tout se fait dans le tableau de bord Supabase du projet (Authentication).
Ce fichier est public : il ne contient aucune adresse réelle ni aucun mot de passe.

## 1. Installer la base

SQL Editor > New query > coller `base-supabase.sql`, remplacer l'adresse d'exemple
de la ligne `set_config('planif.super_admin', …)` par ton adresse de connexion, Run.
La console apparaît ensuite dans le menu (entrée « Console »).

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
  Passé ce délai, la page de connexion renvoie d'elle-même un lien neuf à l'adresse portée par le lien
  (19.11.2026) : l'invitation n'a donc pas de date limite pour la personne.

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
| Sender name | `Planificateur AB ingénieurs` (19.11.2026 ; avant : `STR Bim Tools`) |
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

Version sobre du 19.11.2026 (la première était « grossière » dans Outlook) : pas d'image, pas d'adresse
dans le texte (Outlook la souligne en bleu), bouton vert clair comme « Enregistrer » dans l'outil, marges
posées sur les cellules (Outlook ignore celles des liens).
Refonte du 19.11.2026 (demande de Tony) : charte du bureau comme dans l'outil (fond `#F4F5F2`, vert
`#4D7A1C`, bandeau vert en tête ; pas d'image : Outlook bloque les images distantes et montrait une case
vide à la place du logo, essai du 19.11.2026 — le PNG `docs/planif/assets/logo-ab-courriel.png` reste
disponible), un objet et un en-tête au nom du bureau pour qu'il ne soit pas pris pour un spam (l'encadré
« Ce message est bien réel » a été retiré à la demande de Tony), et aucune
date limite (le mail n'en parle plus, demande de Tony) : le lien porte l'adresse (`&adresse={{ .Email }}`), et quand son jeton a plus de
24 heures la page de connexion envoie d'elle-même un lien neuf. Ces modèles valent pour tous les
bureaux de la base : à revoir le jour où un autre bureau que celui-ci reçoit des invitations.
Dans **SMTP Settings**, mettre aussi **Sender name** = `Planificateur AB ingénieurs`.

### Confirm signup — invitation d'un nouvel utilisateur

Sujet : `Planificateur AB ingénieurs : ton accès est ouvert`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F4F5F2">Un accès à l'outil de planification du bureau vient d'être ouvert pour toi.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F5F2" style="background:#F4F5F2">
  <tr><td align="center" style="padding:32px 12px">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:520px;background:#FFFFFF;border:1px solid #E3E6DE">
      <tr><td bgcolor="#CAE09B" style="background:#CAE09B;height:4px;line-height:4px;font-size:4px">&nbsp;</td></tr>
      <tr><td style="padding:30px 36px 0 36px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;letter-spacing:.04em;color:#6B7065">
        <span style="color:#202020;font-weight:600">AB ingénieurs sa</span> &nbsp;·&nbsp; Planificateur
      </td></tr>
      <tr><td style="padding:22px 36px 0 36px">
        <p style="margin:0 0 16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:21px;line-height:1.3;font-weight:600;color:#202020">Ton accès au planificateur est ouvert</p>
        <p style="margin:0 0 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202020">Bonjour,</p>
        <p style="margin:0 0 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202020">AB ingénieurs utilise un outil de planification fait pour le bureau : les tâches et leurs échéances, le planning et la charge de l'équipe, les absences, les affaires.</p>
        <p style="margin:0 0 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202020">Un accès vient d'être ouvert pour toi. Il ne te reste qu'à choisir ton mot de passe : tu entres ensuite directement dans l'outil.</p>
      </td></tr>
      <tr><td style="padding:14px 36px 0 36px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#D5E8AC" style="background:#D5E8AC;border-radius:6px;padding:10px 20px"><a href="https://str-bim-tools.com/planif/connexion/#jeton={{ .TokenHash }}&type=signup&adresse={{ .Email }}" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#202020;text-decoration:none">Choisir mon mot de passe</a></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:22px 36px 30px 36px">
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#8A8F84">Message automatique du planificateur d'AB ingénieurs sa.</p>
  </td></tr>
</table>
```

### Magic Link — lien de connexion, mot de passe oublié

Sujet : `Planificateur AB ingénieurs : ton lien de connexion`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F4F5F2">Ton lien pour entrer dans le planificateur du bureau.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F5F2" style="background:#F4F5F2">
  <tr><td align="center" style="padding:32px 12px">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:520px;background:#FFFFFF;border:1px solid #E3E6DE">
      <tr><td bgcolor="#CAE09B" style="background:#CAE09B;height:4px;line-height:4px;font-size:4px">&nbsp;</td></tr>
      <tr><td style="padding:30px 36px 0 36px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;letter-spacing:.04em;color:#6B7065">
        <span style="color:#202020;font-weight:600">AB ingénieurs sa</span> &nbsp;·&nbsp; Planificateur
      </td></tr>
      <tr><td style="padding:22px 36px 0 36px">
        <p style="margin:0 0 16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:21px;line-height:1.3;font-weight:600;color:#202020">Ton lien de connexion</p>
        <p style="margin:0 0 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202020">Bonjour,</p>
        <p style="margin:0 0 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202020">Voici ton lien pour entrer dans le planificateur du bureau. Il t'ouvre l'outil et te fait choisir un mot de passe.</p>
      </td></tr>
      <tr><td style="padding:14px 36px 0 36px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#D5E8AC" style="background:#D5E8AC;border-radius:6px;padding:10px 20px"><a href="https://str-bim-tools.com/planif/connexion/#jeton={{ .TokenHash }}&type=magiclink&adresse={{ .Email }}" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#202020;text-decoration:none">Choisir mon mot de passe</a></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:22px 36px 30px 36px">
        <p style="margin:0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6B7065">Tu n'attendais pas ce message ? Ignore-le : ton mot de passe actuel reste valable.</p>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#8A8F84">Message automatique du planificateur d'AB ingénieurs sa.</p>
  </td></tr>
</table>
```

### Reset Password — réinitialisation lancée depuis Supabase

Sujet : `Planificateur AB ingénieurs : nouveau mot de passe`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F4F5F2">Un lien pour choisir un nouveau mot de passe du planificateur du bureau.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F5F2" style="background:#F4F5F2">
  <tr><td align="center" style="padding:32px 12px">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:520px;background:#FFFFFF;border:1px solid #E3E6DE">
      <tr><td bgcolor="#CAE09B" style="background:#CAE09B;height:4px;line-height:4px;font-size:4px">&nbsp;</td></tr>
      <tr><td style="padding:30px 36px 0 36px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;letter-spacing:.04em;color:#6B7065">
        <span style="color:#202020;font-weight:600">AB ingénieurs sa</span> &nbsp;·&nbsp; Planificateur
      </td></tr>
      <tr><td style="padding:22px 36px 0 36px">
        <p style="margin:0 0 16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:21px;line-height:1.3;font-weight:600;color:#202020">Nouveau mot de passe</p>
        <p style="margin:0 0 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202020">Bonjour,</p>
        <p style="margin:0 0 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#202020">Ce lien te permet de choisir un nouveau mot de passe pour le planificateur du bureau.</p>
      </td></tr>
      <tr><td style="padding:14px 36px 0 36px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#D5E8AC" style="background:#D5E8AC;border-radius:6px;padding:10px 20px"><a href="https://str-bim-tools.com/planif/connexion/#jeton={{ .TokenHash }}&type=recovery&adresse={{ .Email }}" style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#202020;text-decoration:none">Choisir un mot de passe</a></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:22px 36px 30px 36px">
        <p style="margin:0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6B7065">Tu n'attendais pas ce message ? Ignore-le : ton mot de passe actuel reste valable.</p>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#8A8F84">Message automatique du planificateur d'AB ingénieurs sa.</p>
  </td></tr>
</table>
```

## 6. Adresse de retour (facultatif)

Utile seulement tant que les modèles d'origine de Supabase restent en place.
Authentication > URL Configuration : **Site URL** `https://str-bim-tools.com/planif/connexion/`,
et la même adresse dans **Redirect URLs**.

## 7. Essai

1. Console > Nouvelle personne : un prénom et un nom, une adresse à toi qui n'est pas encore inscrite,
   dans un bureau d'essai. Coche « Se connecte à l'outil »,
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

## 9. Nom réseau des visites (page /stats/)

Base installée ou mise à jour depuis le 16.10.2026 :
Edge Functions > Deploy a new function > **Via Editor**, nom **`reseau`**, coller le contenu de
`supabase/functions/reseau/index.ts`, Deploy. Puis, dans la fonction > Details (ou Settings) :
**Enforce JWT Verification** désactivé, Save. Rien d'autre à régler : l'adresse et la clé de
service sont fournies d'office à la fonction.

Une visite faite ensuite affiche son nom réseau dans « 05 — Dernières visites » de /stats/
(« sans nom réseau » quand l'adresse n'en a pas, « — » pour les visites d'avant).

## 10. Fiches ARM par mail (outil /fgh/arm/)

Depuis le 03.11.2026, ARM n'utilise plus Microsoft 365 ni SharePoint : fiches et photos sont
sauvegardées dans Supabase (`migration-fgh-arm.sql`), et le bouton « M'envoyer la fiche par mail »
passe par une fonction qui envoie avec Resend, depuis une adresse du domaine.

1. SQL Editor : coller `migration-fgh-arm.sql`, Run (rejouable).
2. Resend > API Keys > Create API key, permission **Sending access**, domaine `str-bim-tools.com`.
   Copier la clé (elle ne s'affiche qu'une fois).
3. Supabase > Edge Functions > Secrets (ou Settings > Edge Functions) : ajouter
   - `RESEND_API_KEY` = la clé du point 2 ;
   - `FGH_MAIL_AUTORISES` = les adresses ou domaines qui peuvent recevoir une fiche, séparés par des
     virgules, par exemple `prenom.nom@exemple.ch, @mon-bureau.ch` (un domaine commence par `@`) ;
   - au choix `FGH_MAIL_DE` = l'expéditeur, par défaut `Contrôle armatures FGH <contact@str-bim-tools.com>`.
4. Edge Functions > Deploy a new function > **Via Editor**, nom **`fgh-arm-mail`**, coller le
   contenu de `supabase/functions/fgh-arm-mail/index.ts`, Deploy. Puis **Enforce JWT Verification**
   désactivé, Save.

Sans la fonction (ou hors réseau), ARM propose d'ouvrir l'appli Mail du téléphone avec la fiche jointe.
Une adresse hors de `FGH_MAIL_AUTORISES` est refusée : c'est ce qui empêche quiconque d'utiliser la
fonction pour écrire à n'importe qui depuis le domaine.
Depuis le 13.11.2026, la fonction exige en plus une personne connectée aux outils FGH : si elle
était déjà déployée, recoller la nouvelle version de `index.ts` **après** avoir exécuté
`migration-fgh-connexion.sql` (section 11).

## 11. Connexion aux outils du chantier FGH (13.11.2026)

Les pages /fgh/ demandent les identifiants de la planification (/fgh/connexion/, script
`docs/fgh/acces.js`, même session que /planif/). La base n'ouvre Visas, Plans FGH et Fiches ARM
qu'au super admin et aux accès actifs du bureau du chantier (fonction `acces_fgh`, table
`fgh_reglages`).

1. SQL Editor : coller `migration-fgh-connexion.sql`, Run. La dernière ligne affiche le nom du
   bureau retenu ; s'il n'est pas trouvé, écrire son nom exact dans `v_nom_bureau`, en tête du bloc.
2. Un collègue sans compte : console › Accès, ajouter son adresse dans ce bureau ; il crée son mot
   de passe par « Premier accès » (lien de la page de connexion).
3. Contrôle, sans connexion, avec la clé publiable : `fgh_plans`, `fgh_controles`,
   `fgh_controles_photos`, `visas_exports`, `visas_coches`, `visas_notes` rendent 0 ligne.
