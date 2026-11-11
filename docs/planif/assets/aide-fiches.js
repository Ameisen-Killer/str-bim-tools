/* Fiches de l'aide de la planification (09.11.2026) — lues par aide.js
   ---------------------------------------------------------------------------
   À TENIR À JOUR À CHAQUE MODIFICATION D'UNE PAGE DE L'OUTIL (consigne de
   Tony, rappelée dans le skill str-bim-tools-site) : un bouton, un menu, une
   règle ou un droit qui change → la fiche qui en parle change avec lui ; une
   nouveauté → une nouvelle fiche ; une page retirée → ses fiches partent.
   Puis monter aide-fiches.js?v= partout et MAJ ci-dessous.

   Une fiche :
     id        identifiant stable (page-sujet)
     pages     pages où elle sert ; ses questions y passent devant et y sont
               proposées à l'ouverture. Clés : accueil, communication, absences,
               equipe, annuaire, taches, tableau, affaires, carte, charge, veille,
               ao_publics, ao_prives, agenda_ao, facturation, profil, console,
               activite, connexion
     question  la question type, affichée en titre de la réponse
     aussi     d'autres façons de la poser (comptent beaucoup dans la recherche)
     mots      mots-clés (comptent le plus)
     reponse   le texte : **gras**, « - » en tête de ligne pour une liste,
               ligne vide pour un nouveau paragraphe. Tutoiement, phrases courtes.
     ici       { page: texte } : réponse propre à une page, à la place de « reponse »
     lien      page où ça se passe : « Aller à … » ailleurs, « Me montrer » sur place
     montre    ce que « Me montrer » éclaire : début du libellé d'un bouton ou d'un
               titre (« Nouvelle tâche »), ou sélecteur CSS (#id, .classe) ; une liste
               = le premier trouvé
     droit     code du droit nécessaire (donnees.js, DROITS), ou liste (un seul suffit) :
               sans lui, l'aide prévient, cache « Me montrer » et retire la question
               des propositions
     admin     réservé à l'admin du site (console)
     sansDroit texte pour qui n'a pas ce droit, à la place de « reponse »
     selonDroit { code: ["si la personne a le droit", "si elle ne l'a pas"] } :
               un paragraphe ajouté selon son habilitation ("" = rien)
     perso     "groupes" : ajoute « Tes groupes : … » d'après le compte connecté
   L'HABILITATION COMPTE (consigne de Tony, 09.11.2026) : toute fiche sur une
   action réservée dit ce que la personne connectée peut faire, elle.
     voir      fiches liées, proposées sous la réponse
     frequente proposée à l'ouverture de l'aide sur ses pages
     cachee    jamais proposée (petit dialogue : bonjour, merci…)
   Rien en dur sur un bureau réel : la démonstration lit les mêmes fiches.
   --------------------------------------------------------------------------- */
(function (global) {
  "use strict";

  var MAJ = "2026-11-11";   // Charlie

  /* Expressions de plusieurs mots soudées avant la recherche (mises à plat :
     sans accents ni apostrophes). Le mot soudé peut ensuite avoir des synonymes. */
  var expressions = [
    ["mot de passe", "motdepasse"], ["mots de passe", "motdepasse"],
    ["tableau de bord", "tableaudebord"], ["tableau de charge", "tableaucharge"], ["carte de charge", "tableaucharge"],
    ["carte des affaires", "cartesaffaires"],
    ["appel d offres", "ao"], ["appels d offres", "ao"], ["appel d offre", "ao"], ["appels d offre", "ao"],
    ["boite a idees", "boiteaidees"], ["boite a idee", "boiteaidees"],
    ["clic droit", "clicdroit"], ["click droit", "clicdroit"], ["bouton droit", "clicdroit"],
    ["a affecter", "aaffecter"], ["non affecte", "aaffecter"], ["non affectee", "aaffecter"], ["non affectees", "aaffecter"],
    ["sans personne", "aaffecter"], ["personne dessus", "aaffecter"],
    ["jours travailles", "semainetype"], ["jour travaille", "semainetype"], ["semaine type", "semainetype"],
    ["temps partiel", "semainetype"], ["mi temps", "semainetype"], ["jour off", "semainetype"], ["jours off", "semainetype"],
    ["taux d activite", "semainetype"], ["ne travaille pas", "semainetype"], ["demi journee", "demijournee"], ["demi jour", "demijournee"],
    ["rendez vous", "rendezvous"], ["prevenir le bureau", "avis"], ["je m absente", "avis"],
    ["en ligne", "presence"], ["qui est la", "presence"], ["qui est connecte", "presence"],
    ["mise a jour", "rafraichir"], ["pas a jour", "rafraichir"], ["a jour", "rafraichir"],
    ["ctrl k", "palette"], ["ctrl+k", "palette"], ["cmd k", "palette"],
    ["marche pas", "bug"], ["fonctionne pas", "bug"], ["marche plus", "bug"], ["ne s affiche pas", "bug"],
    ["date limite", "echeance"], ["date de rendu", "echeance"], ["date de fin", "echeance"],
    ["chef de secteur", "chefsecteur"], ["chefs de secteur", "chefsecteur"], ["chef de projet", "chefprojet"],
    ["super admin", "superadmin"], ["admin du site", "superadmin"],
    ["page d accueil", "accueil"], ["page precedente", "retour"],
    ["phase sia", "phasesia"], ["phases sia", "phasesia"],
    ["google maps", "googlemaps"], ["jours feries", "ferie"], ["jour ferie", "ferie"],
    ["le bureau aujourd hui", "bureauaujourdhui"], ["bureau aujourd hui", "bureauaujourdhui"],
    ["qui manque", "absentsdujour"], ["qui est absent", "absentsdujour"], ["qui n est pas la", "absentsdujour"],
    ["sous barre", "sousbarre"], ["barre du haut", "barrehaut"],
    ["en retard", "retard"], ["fiche rapide", "ficherapide"]
  ];

  /* Synonymes : le premier mot de chaque groupe représente les autres. */
  var synonymes = [
    ["conge", "conges", "vacance", "vacances", "recuperation", "recup", "pont", "sans solde"],
    ["absence", "absences", "absent", "absente", "absents", "malade", "maladie", "indisponible", "service militaire", "militaire"],
    ["tache", "taches", "travail", "boulot", "job", "todo", "mission"],
    ["affaire", "affaires", "projet", "projets", "dossier", "dossiers", "chantier", "chantiers"],
    ["membre", "membres", "collegue", "collegues", "personne", "personnes", "employe", "employes", "collaborateur", "collaborateurs", "equipier", "gens", "quelqu"],
    ["creer", "ajouter", "nouveau", "nouvelle", "nouvel", "rajouter", "inscrire", "poser", "mettre", "saisir", "enregistrer", "creation"],
    ["supprimer", "effacer", "retirer", "enlever", "virer", "suppression", "detruire"],
    ["modifier", "changer", "editer", "corriger", "renommer", "modification", "changement"],
    ["decaler", "deplacer", "repousser", "reporter", "glisser", "bouger", "retarder", "avancer", "decalage"],
    ["terminer", "finir", "fini", "finie", "termine", "terminee", "cloturer", "boucler", "achever", "rendu", "rendre", "pouce"],
    ["chercher", "rechercher", "trouver", "recherche", "retrouver", "loupe"],
    ["filtrer", "filtre", "filtres", "trier", "tri", "masquer", "cacher", "afficher", "voir"],
    ["pdf", "imprimer", "impression", "exporter", "export", "papier", "imprimante"],
    ["sauvegarde", "sauvegarder", "backup", "json", "importer", "import", "restaurer", "donnees"],
    ["telephone", "tel", "natel", "numero", "numeros", "joindre", "appeler", "interne", "ligne directe"],
    ["mail", "email", "courriel", "mails", "e mail"],
    ["motdepasse", "mdp", "password", "identifiant", "login"],
    ["connexion", "connecter", "connecte", "connection", "identifier", "entrer"],
    ["deconnecter", "deconnexion", "quitter", "logout", "sortir"],
    ["charge", "occupation", "surcharge", "surcharge", "deborde", "plein", "pleins", "taux"],
    ["disponible", "dispo", "libre", "disponibilite", "disponibilites", "capacite"],
    ["tableaudebord", "planning", "gantt", "plannings"],
    ["tchat", "chat", "message", "messages", "messagerie", "discuter", "discussion"],
    ["news", "actualite", "actualites", "actu", "annonce", "article", "articles", "info", "infos"],
    ["rendezvous", "rdv", "reunion", "reunions", "meeting", "seance", "seances", "visite", "evenement"],
    ["ao", "soumission", "soumissions", "offre", "offres", "concours"],
    ["veille", "simap", "publication", "publications", "marche", "marches"],
    ["facturation", "facture", "factures", "facturer", "facture", "honoraire", "honoraires"],
    ["avancement", "progression", "progres", "pourcentage", "jauge", "jauges"],
    ["droit", "droits", "acces", "permission", "permissions", "autorisation", "autorise", "interdit", "bloque"],
    ["groupe", "groupes", "role", "roles", "statut"],
    ["console", "administration", "parametre", "parametres", "reglage", "reglages", "configuration", "config"],
    ["profil", "photo", "avatar", "portrait"],
    ["aaffecter", "orphelin", "orpheline", "libres"],
    ["affecter", "attribuer", "assigner", "confier", "affectation", "reaffecter", "donner", "passer"],
    ["priorite", "urgent", "urgence", "important", "prioritaire", "priorites", "p1"],
    ["echeance", "deadline", "delai", "echeances", "remise"],
    ["annuaire", "contact", "contacts", "carnet", "fournisseur", "fournisseurs", "entreprise", "societe", "client", "clients", "regie"],
    ["carte", "map", "localiser", "emplacement", "situer", "plan"],
    ["presence", "led", "voyant", "connectes", "point vert"],
    ["secteur", "secteurs", "discipline", "disciplines", "departement", "metier"],
    ["succursale", "succursales", "agence", "filiale", "antenne"],
    ["demo", "demonstration", "essai", "test", "tester"],
    ["aide", "help", "assistant", "tutoriel", "explication", "explique", "fonctionne", "fonctionnement", "marche", "utiliser", "sert"],
    ["palette", "raccourci", "raccourcis", "clavier", "commande"],
    ["rafraichir", "actualiser", "recharger", "f5", "relire"],
    ["bug", "probleme", "erreur", "plante", "souci", "panne", "beug", "bugue"],
    ["idee", "idees", "suggestion", "proposition", "amelioration", "remarque", "boiteaidees"],
    ["semaine", "semaines", "hebdomadaire"],
    ["mois", "mensuel"],
    ["valider", "accepter", "refuser", "approuver", "decider", "validation", "refus"],
    ["telephone portable", "smartphone", "mobile", "iphone", "android", "galaxy"],
    ["ingenieur", "ingenieurs", "calcul", "calculs"],
    ["dessinateur", "dessinateurs", "dessin", "dessins", "plans"],
    ["clicdroit", "menu contextuel"],
    ["equipe", "collectif"],
    ["responsable", "chef", "pilote", "referent"],
    ["phasesia", "phase", "phases", "sia"],
    ["mandat", "mandats"],
    ["note", "commentaire", "commentaires", "remarques", "observation", "observations"]
  ];

  var fiches = [

    /* ================================================================ général */

    { id: "aide-quoi", pages: ["accueil"], frequente: true,
      question: "À quoi sert cet outil ?",
      aussi: ["c'est quoi la planification", "présentation de l'outil", "par où commencer", "comment ça marche"],
      mots: "outil planification sert presentation commencer debuter",
      reponse: "La planification montre **qui fait quoi, pour quand, avec quelle capacité**, et la vie du bureau autour.\n- **Tâches** : la liste des tâches, le tableau de bord (planning par personne), les affaires et le tableau de charge.\n- **Communication** : le bureau aujourd'hui (qui manque, rendez-vous, news, tchat), les absences et congés, l'équipe et l'annuaire.\n- **Inter-secteurs** : la veille simap.ch, les appels d'offres et la facturation.\nL'accueil résume ce qui te concerne : tes tâches prioritaires, les absents de la semaine et les tâches à affecter.",
      voir: ["nav-barre", "aide-utiliser"] },

    { id: "aide-utiliser", pages: [],
      question: "Qui est Charlie, et comment lui poser une question ?",
      aussi: ["comment te poser une question", "qui es-tu", "tu es qui", "tu es une IA", "comment tu marches", "qui est Charlie", "c'est quoi Charlie", "qui es tu", "t'es qui", "c'est qui", "qui êtes-vous", "tu t'appelles comment", "comment tu t'appelles", "quel est ton nom", "présente-toi", "que sais-tu faire", "tu sers à quoi", "tu fais quoi"],
      mots: "aide assistant question repondre fiche charlie appelle nom presente robot chatbot",
      reponse: "Je suis **Charlie**, l'aide de la planification. Écris ta question avec tes mots : je la compare à mes fiches et je réponds avec la plus proche. Je ne suis pas une IA : je ne connais que ce qui est écrit dans mes fiches, mais elles suivent chaque modification du site.\n- Mes réponses s'adaptent à la page où tu es, et **Me montrer** éclaire le bouton dont je parle.\n- **F1** m'ouvre ou me ferme, **Échap** me ferme.\n- Si je ne sais pas répondre, tu peux envoyer ta question à la boîte à idées pour qu'on complète mes fiches." },

    { id: "nav-barre", pages: ["accueil", "communication", "taches", "tableau"],
      question: "Comment passer d'une page à l'autre ?",
      aussi: ["où sont les menus", "naviguer dans l'outil", "barre du haut", "revenir à l'accueil", "changer de page"],
      mots: "naviguer barrehaut menu page module sousbarre maison accueil retour",
      reponse: "La **barre du haut** porte la maison (accueil) et les modules : Communication, Tâches, Inter-secteurs (et Console pour l'admin du site). La flèche à gauche de la maison revient à la page précédente.\nSous le titre de chaque page, une **sous-barre** donne les pages du module : par exemple, sous Tâches, la liste, le tableau de bord, les affaires et le tableau de charge.\nAstuce : **Ctrl+K** ouvre la recherche de la barre, qui mène aussi à n'importe quelle page.",
      voir: ["palette", "droits-page-absente"] },

    { id: "palette", pages: ["taches", "tableau", "accueil"], frequente: true,
      question: "À quoi sert la recherche Ctrl+K ?",
      aussi: ["chercher dans tout l'outil", "palette de commandes", "bouton chercher en haut", "raccourci clavier", "trouver une tâche rapidement"],
      mots: "palette chercher recherche barrehaut trouver aller",
      reponse: "Le bouton **Chercher** au milieu de la barre du haut (ou **Ctrl+K**, ⌘K sur Mac) ouvre une barre qui fait tout :\n- **trouver** une tâche (sa fiche rapide s'ouvre sur place), une affaire, un collègue, une fiche de l'annuaire, une page ;\n- **agir** : nouvelle tâche, poser une absence, rafraîchir, se déconnecter ;\n- **créer une tâche en une phrase**, par exemple « dalle B12 Marc vendredi 3j ».\nSur une page, la touche **/** va à la recherche de la page elle-même.",
      montre: ".btn-palette",
      voir: ["palette-phrase", "recherche-page"] },

    { id: "palette-phrase", pages: ["taches", "tableau"],
      question: "Comment créer une tâche en une phrase ?",
      aussi: ["écrire une tâche dans la recherche", "créer une tâche au clavier", "dalle B12 Marc vendredi 3j"],
      mots: "phrase palette creer tache rapide clavier",
      reponse: "Ouvre la recherche (**Ctrl+K**) et écris ta tâche d'un trait, par exemple « coffrage dalle B12 Marc vendredi 3j ». L'aide de la barre comprend :\n- l'**affaire** par son numéro exact (ou #numéro) ;\n- la **personne** par son prénom ou son nom ;\n- la **charge** : « 3j », « 2,5 j », ou « calcul 2j dessin 1j » ;\n- l'**échéance** : aujourd'hui, demain, vendredi, fin de semaine, fin du mois, semaine prochaine, dans 2 semaines, s42, 12.10, 12 oct…\nLe reste fait le libellé. Des étiquettes montrent ce qui a été compris. **Entrée** crée la tâche si tout y est, sinon ouvre le formulaire pré-rempli ; **Maj+Entrée** ouvre toujours le formulaire.",
      voir: ["palette", "tache-creer"] },

    { id: "recherche-page", pages: ["taches", "affaires", "equipe", "annuaire", "absences", "tableau"],
      question: "Comment chercher dans la page ?",
      aussi: ["filtrer la liste en tapant", "champ de recherche", "rechercher un nom"],
      mots: "chercher recherche champ taper filtrer liste",
      reponse: "Le champ de recherche (en haut du bandeau de gauche) filtre la page à chaque lettre tapée, sans tenir compte des majuscules ni des accents. Plusieurs mots se cumulent. La touche **/** y place le curseur, et **Entrée** ouvre le seul résultat restant.",
      ici: {
        taches: "Le champ de recherche du bandeau filtre la liste à chaque lettre : il porte sur le libellé, la note, l'affaire, les personnes et le statut des tâches filtrées. Plusieurs mots se cumulent, sans tenir compte des accents. **/** y place le curseur, **Entrée** ouvre la seule tâche restante.",
        tableau: "Le champ de recherche du bandeau retire les lignes du planning qui ne correspondent pas : une personne se retrouve par son nom ou par ce qu'elle porte dans la période. Les chiffres clés et les bilans portent alors sur ce qui reste affiché."
      },
      montre: ["[data-recherche] input", ".recherche input"],
      voir: ["bandeau-gauche"] },

    { id: "bandeau-gauche", pages: ["taches", "tableau", "affaires", "charge", "equipe", "absences", "facturation"], frequente: true,
      question: "À quoi sert le bandeau de gauche ?",
      aussi: ["le panneau à gauche", "filtrer par succursale ou secteur", "replier le bandeau", "voir une seule équipe"],
      mots: "bandeau gauche filtrer equipe succursale secteur replier administrateurs",
      reponse: "Le bandeau de gauche choisit **ce que montre la page** : la recherche, puis « Tous », « Administrateurs », chaque succursale et ses secteurs, avec leur nombre. Un clic choisit une entrée (une à la fois). Dessous, selon la page : l'affaire, le statut, « Masquer les terminées »…\nLa petite flèche **‹** le replie pour rendre de la place à la page ; ton choix est retenu sur cet appareil.",
      ici: {
        taches: "Sur Tâches, le bandeau choisit la liste : **Mes tâches**, **À affecter**, toute l'équipe, une personne, les administrateurs, une succursale ou un de ses secteurs. Dessous : l'affaire, le statut, « Masquer les terminées » et le rangement (par échéance ou par affaire). La flèche **‹** le replie.",
        tableau: "Sur le tableau de bord, le bandeau choisit les lignes : **Mon planning**, toute l'équipe, une succursale ou un secteur, puis la fonction (Tous, Ingénieurs, Dessinateurs) et l'affaire. La flèche **‹** le replie pour élargir le planning.",
        affaires: "Sur Affaires, le bandeau donne **Mes affaires**, toutes les affaires, chaque succursale et ses secteurs avec leur nombre d'affaires, puis « Voir les affaires terminées ». La flèche **‹** le replie.",
        charge: "Sur le tableau de charge, le bandeau choisit la fonction, l'équipe (succursale, secteur) avec son nombre de personnes, et « Ne compter qu'une affaire ». La flèche **‹** le replie.",
        absences: "Sur Absences, le bandeau choisit l'équipe (Tous, Administrateurs, une succursale, un secteur), le rôle, l'affaire, et « Masquer qui n'a rien ». La flèche **‹** le replie.",
        equipe: "Sur Équipe, le bandeau choisit l'équipe (Tous, Administrateurs, une succursale, un secteur), le rôle et l'affaire. La flèche **‹** le replie."
      },
      montre: ["#bd-bandeau", "#eq-bandeau"] },

    { id: "clic-droit", pages: ["taches", "tableau", "affaires", "equipe", "annuaire", "absences", "charge", "communication", "carte", "veille", "ao_publics", "ao_prives", "agenda_ao", "facturation", "console"],
      question: "Qu'est-ce que je peux faire au clic droit ?",
      aussi: ["menu du clic droit", "menu contextuel", "raccourcis sur une ligne"],
      mots: "clicdroit menu ligne barre raccourci",
      reponse: "Un **clic droit** sur une ligne, une barre ou une personne ouvre un petit menu avec ses actions : ouvrir, modifier, supprimer… Partout où l'on clique sur **une personne**, le menu est le même : **Ses tâches**, **Ses affaires**, **Ses absences**, **Ses jours travaillés**, puis ses téléphones. Il existe sur toutes les pages de l'outil, sauf l'accueil et Mon profil.",
      ici: {
        taches: "Sur une tâche : ouvrir la fiche, modifier, terminer ta part (ou la tâche), nouvelle tâche sur cette affaire, toutes les tâches de l'affaire, voir l'affaire, supprimer. Sur une pastille de personne : le menu de la personne (**Ses tâches** filtre la page sur elle), puis **Terminer la tâche** (sur une ancienne tâche à deux parts : **Terminer le calcul / le dessin**).",
        tableau: "Sur une barre : ouvrir la fiche, modifier la tâche, ajouter une dépendance (ou, sur une dépendance, ouvrir la tâche principale), terminer ou rouvrir la tâche, nouvelle tâche sur cette affaire, tâches de l'affaire, voir l'affaire, supprimer la tâche. Sur un nom ou un jour vide : son planning seul, **Nouvelle tâche pour …**, puis le menu de la personne. **Double-clic sur un jour vide** : nouvelle tâche pour cette personne, ce jour en échéance.",
        affaires: "Sur une affaire : la modifier (ou la consulter), nouvelle tâche sur cette affaire, tâches de l'affaire, avancement (et facturation si tu y as droit), Google Maps, supprimer. Sur un membre de l'équipe d'une affaire : le désigner responsable (si tu peux modifier l'affaire), puis le menu de la personne.",
        equipe: "Sur une personne : ses tâches, ses affaires, ses absences, ses jours travaillés, « Modifier la fiche » si tu en as le droit, et ses téléphones.",
        annuaire: "Sur une fiche : lui écrire (si elle a une adresse), la modifier, la supprimer.",
        absences: "Sur une absence : le menu de la personne, puis retirer cette absence. Sur un nom ou un jour vide : poser une absence ce jour-là, puis le menu de la personne.",
        charge: "Sur un nom : le menu de la personne. Sur une case : le détail de la semaine, puis le menu de la personne.",
        communication: "Sur une personne absente ou une demande de congé : le menu de la personne (et accepter ou refuser la demande). Sur un rendez-vous : l'ouvrir, en noter un autre le même jour.",
        carte: "Sur un losange : les détails, voir l'affaire, ses tâches, Google Maps, son responsable.",
        veille: "Sur une publication : l'ouvrir sur simap.ch, créer l'AO, écarter ou remettre en veille.",
        ao_publics: "Sur un appel d'offres : l'ouvrir, ajouter un rendez-vous, le demandeur dans l'annuaire, Google Maps, son responsable.",
        ao_prives: "Sur un appel d'offres : l'ouvrir, ajouter un rendez-vous, le demandeur dans l'annuaire, Google Maps, son responsable.",
        agenda_ao: "Sur un rendez-vous : l'ouvrir, ouvrir son appel d'offres, en ajouter un autre.",
        facturation: "Sur une affaire : avancement et facturation, voir l'affaire, ses tâches, son responsable.",
        console: "Sur un utilisateur : ouvrir sa fiche, envoyer un lien de connexion, le menu de la personne, supprimer."
      } },

    { id: "rafraichir", pages: ["taches", "tableau", "communication"],
      question: "Comment voir les changements des collègues ?",
      aussi: ["rafraîchir les données", "la page n'est pas à jour", "recharger", "actualiser", "mises à jour en direct"],
      mots: "rafraichir direct collegue changement relire",
      reponse: "L'outil se met à jour **en direct** : un changement d'un collègue arrive tout seul, avec un éclat sur la ligne et un message « Mise à jour par l'équipe ». En revenant sur l'onglet après une minute, la page relit aussi la base.\nPour forcer une relecture : menu de ton compte (ton nom, en haut à droite) › **Rafraîchir les données**. Après une mise à jour du site, fais **Ctrl+F5**.",
      montre: ".ab-compte-btn", voir: ["presence"] },

    { id: "presence", pages: ["equipe", "communication", "accueil"],
      question: "Comment savoir qui est en ligne ou présent ?",
      aussi: ["qui est connecté", "les points verts", "LED de présence", "qui est au bureau"],
      mots: "presence enligne led point vert connecte present",
      reponse: "Deux choses différentes :\n- **En ligne** : en haut à droite, la puce et « N en ligne » comptent les personnes qui ont l'outil sous les yeux ; leurs noms s'affichent au survol.\n- **Présent au bureau** : sur Équipe, les LED de la semaine (allumée présent, à moitié pour une demi-journée, éteinte absent ou jour non travaillé). Le bureau aujourd'hui liste aussi **qui manque**.",
      ici: { equipe: "Sur Équipe, chaque ligne porte les LED de la semaine en cours, du lundi au vendredi : **allumée** présent, **à moitié** une demi-journée, **éteinte** absent, jour non travaillé ou férié. Et en haut à droite, « N en ligne » compte qui a l'outil ouvert en ce moment." },
      voir: ["comm-qui-manque"] },

    { id: "compte-menu", pages: ["profil", "accueil"],
      question: "Que contient le menu de mon compte ?",
      aussi: ["menu avec mon nom", "en haut à droite", "se déconnecter", "quitter l'outil"],
      mots: "compte menu deconnecter nom haut droite",
      reponse: "Clique sur **ton nom** en haut à droite :\n- **Mon profil** : photo, téléphones, jours travaillés, mot de passe ;\n- **Rafraîchir les données** ;\n- **Données (export, import)** : sauvegarde du planning ;\n- **Se déconnecter**.\nEn démonstration (et pour l'admin du site), il permet aussi de **voir l'outil en tant que** collaborateur, chef de secteur, administrateur…",
      montre: ".ab-compte-btn", voir: ["profil-quoi", "donnees-export"] },

    { id: "donnees-export", pages: ["taches", "tableau"],
      question: "Comment sauvegarder ou exporter les données ?",
      aussi: ["faire une sauvegarde", "exporter en JSON", "importer une sauvegarde", "restaurer les données", "jours fériés du canton"],
      mots: "sauvegarde json exporter importer restaurer donnees canton ferie",
      reponse: "Menu de ton compte › **Données (export, import)** :\n- **Exporter** télécharge une sauvegarde complète (fichier JSON) ;\n- **Importer** **remplace tout** par le contenu du fichier, après confirmation : exporte d'abord une sauvegarde ;\n- on y règle aussi le **canton des jours fériés** et la capacité par défaut d'un nouveau membre.\nAvec plusieurs bureaux, importer ou tout effacer est réservé à l'admin du site.",
      voir: ["pdf-export"] },

    { id: "pdf-export", pages: ["taches", "tableau", "charge", "absences", "facturation"], frequente: false,
      question: "Comment imprimer ou exporter en PDF ?",
      aussi: ["imprimer la liste", "sortir un PDF", "imprimer le planning", "export papier"],
      mots: "pdf imprimer exporter papier",
      reponse: "Le bouton **Exporter en PDF** (à droite du titre) ouvre l'impression du navigateur : choisis « Enregistrer au format PDF ». Le papier reprend les filtres en cours et les rappelle en en-tête. Il existe sur Tâches, le tableau de bord, le tableau de charge, Absences et Facturation.",
      ici: {
        taches: "**Exporter en PDF** (à droite du titre) sort la liste en A4 portrait, serrée, une ligne par tâche ; l'en-tête rappelle tous les filtres, recherche comprise. La liste s'affiche par paquets : elle est déroulée en entier avant l'impression.",
        tableau: "**Exporter en PDF** sort le planning en A4 paysage ; l'en-tête dit la période et ce qui restreint l'affichage.",
        charge: "**Exporter en PDF** imprime la carte de charge avec **tous les pourcentages** visibles.",
        facturation: "**Exporter en PDF** imprime la facturation telle que filtrée, avec les filtres et la date d'édition en en-tête. Sur téléphone, le bouton est dans la page."
      },
      montre: "Exporter en PDF" },

    { id: "telephone-mobile", pages: ["accueil", "communication"],
      question: "L'outil marche-t-il sur téléphone ?",
      aussi: ["sur smartphone", "sur mon portable", "version mobile"],
      mots: "telephone portable mobile ecran",
      reponse: "Oui. Sur téléphone, les tableaux deviennent des fiches, l'action principale de la page devient un **bouton rond en bas à droite**, et les fenêtres s'ouvrent en plein écran. Au tableau de bord, on ne glisse pas les barres au doigt : un appui ouvre la fiche, qui permet de décaler et de réaffecter. Le tchat a sa bulle en bas à gauche de Communication." },

    { id: "bug-signaler", pages: ["accueil"], frequente: true,
      question: "Comment signaler un problème ou proposer une idée ?",
      aussi: ["ça ne marche pas", "j'ai trouvé un bug", "faire une suggestion", "boîte à idées"],
      mots: "bug probleme idee suggestion boiteaidees signaler capture",
      reponse: "Sur l'accueil, l'encadré **Boîte à idées / Problèmes** : écris ton idée ou ta remarque et ajoute des captures d'écran (fichier, **Ctrl+V** ou glisser dans la fenêtre). Ton nom est joint automatiquement. Seuls les administrateurs du site les lisent et les marquent « Pris en compte » ou « Rejeté ».\nAvant tout : un **Ctrl+F5** règle souvent un affichage bizarre après une mise à jour.",
      lien: "accueil", montre: ["#t-idees", "Boîte à idées"] },

    { id: "droits-page-absente", perso: "groupes",
      pages: ["accueil"],
      question: "Pourquoi je ne vois pas certaines pages ?",
      aussi: ["une page a disparu", "je n'ai pas accès", "page refusée", "il me manque le tableau de charge", "accès refusé"],
      mots: "droit acces page voir manque refuse groupe",
      reponse: "Chaque page s'ouvre selon les **droits de ton groupe** (collaborateur, chef de projet, chef de secteur, administrateur…). Une page non permise n'apparaît ni dans la barre ni sur l'accueil ; ouverte par son adresse, elle renvoie à l'accueil, qui le dit.\nLes droits se règlent par un administrateur du site dans la **Console › Groupes et droits**.",
      voir: ["console-droits"] },

    { id: "demo-quoi", pages: ["connexion", "accueil"],
      question: "C'est quoi la démonstration ?",
      aussi: ["essayer la démo", "compte démo", "voir en tant que", "les données de démo"],
      mots: "demo demonstration essayer compte fictif",
      reponse: "**Essayer la démo** (page de connexion) ouvre l'outil dans un **bureau de test** aux données fictives. Tu peux tout essayer ; le menu du compte permet de **voir la démo en tant que** collaborateur, chef de secteur, administrateur… Les messages du tchat, les news et les idées y restent dans ton navigateur.\nAttention : la démo remplace ta session dans tout le navigateur ; reconnecte-toi ensuite avec ton compte.",
      montre: "Essayer la démo" },

    { id: "version-maj", pages: ["accueil"],
      question: "Comment savoir si j'ai la dernière version ?",
      aussi: ["date de la version", "le site a changé", "nouveautés", "Ctrl+F5"],
      mots: "version rafraichir nouveaute f5 cache",
      reponse: "La date de la version est écrite **au pied de chaque page** (« Version du … »). Après une mise à jour annoncée, fais **Ctrl+F5** pour que le navigateur reprenne les nouveaux fichiers.",
      montre: [".pied-outil", "footer"] },

    { id: "base-donnees", pages: ["accueil"],
      question: "Où sont stockées les données ?",
      aussi: ["les données sont-elles sécurisées", "hébergement", "base de données", "qui voit mes données"],
      mots: "donnees base heberge securite europe stocke",
      reponse: "Dans une base hébergée **en Europe (Francfort)**, comme le rappelle le pied de page. Il faut un compte inscrit sur la liste des accès pour y entrer, et chaque bureau ne voit que ses données. Ce que chacun peut lire ou modifier est contrôlé par la base elle-même, selon les droits des groupes." },

    /* ================================================================ connexion */

    { id: "cx-premiere", pages: ["connexion"], frequente: true,
      question: "Comment me connecter la première fois ?",
      aussi: ["première connexion", "je n'ai pas de mot de passe", "créer mon compte", "recevoir un lien"],
      mots: "premiere connexion compte lien courriel creer",
      reponse: "Saisis ton adresse e-mail, puis **Mot de passe oublié ou première connexion** : tu reçois un lien par courriel qui te fait choisir ton mot de passe. Ton adresse doit avoir été inscrite par un administrateur ; sinon, demande-lui l'accès.",
      montre: "Mot de passe oublié" },

    { id: "cx-oubli", pages: ["connexion", "profil"], frequente: true,
      question: "J'ai oublié mon mot de passe",
      aussi: ["mot de passe perdu", "réinitialiser mon mot de passe", "je n'arrive pas à me connecter"],
      mots: "motdepasse oublie perdu reinitialiser connexion",
      reponse: "Sur la page de connexion, saisis ton adresse puis **Mot de passe oublié ou première connexion** : un lien arrive par courriel pour en choisir un nouveau. Déjà connecté, tu peux le changer dans **Mon profil**.",
      ici: { profil: "Ici, dans **Mon profil**, la section mot de passe le change directement. Si tu l'as oublié et que tu n'es plus connecté : page de connexion › **Mot de passe oublié ou première connexion**." },
      montre: "Mot de passe oublié" },

    { id: "cx-deconnexion", pages: ["profil"],
      question: "Comment me déconnecter ?",
      aussi: ["quitter l'outil", "fermer ma session"],
      mots: "deconnecter quitter session",
      reponse: "Clique sur **ton nom** en haut à droite, puis **Se déconnecter**. Tes onglets ouverts sur l'outil sont fermés côté présence.",
      montre: ".ab-compte-btn" },

    /* ================================================================ accueil */

    { id: "acc-encadres", pages: ["accueil"], frequente: true,
      question: "Que montre l'accueil ?",
      aussi: ["les encadrés de l'accueil", "page d'accueil", "mes tâches prioritaires", "absences de l'équipe"],
      mots: "accueil encadre resume prioritaire absents aaffecter pastille",
      reponse: "L'accueil résume ta journée :\n- les **icônes des pages** ouvertes à ton groupe, avec des pastilles chiffrées (congés à valider, messages non lus, nouvelles publications de la veille) ;\n- **Mes tâches prioritaires** : tes parts encore ouvertes, la plus urgente d'abord (échéance, puis priorité) ;\n- **Absences de l'équipe** : les absents de la semaine dans ton secteur ;\n- **Tâches à affecter** (chefs de secteur et au-delà) ;\n- la **Boîte à idées / Problèmes**.",
      voir: ["acc-prioritaires", "acc-absences", "acc-pastilles"] },

    { id: "acc-prioritaires", pages: ["accueil"],
      question: "Comment sont choisies mes tâches prioritaires ?",
      aussi: ["ordre de mes tâches prioritaires", "terminer depuis l'accueil", "le point rouge orange gris"],
      mots: "prioritaire ordre point rouge orange terminer pouce",
      reponse: "Ce sont **tes parts encore ouvertes** : le calcul si tu en es l'ingénieur, le dessin si tu en es le dessinateur. Ordre : échéance, puis priorité (1 devant), puis libellé. Le point est **rouge** à échéance ou en retard, **orange** dans la semaine, gris au-delà.\nLe **pouce** termine ta part d'un clic ; la ligne s'en va et « Annuler » la ramène. Un clic sur la ligne ouvre la tâche.",
      lien: "accueil", montre: ["#t-prio"], voir: ["tache-terminer"] },

    { id: "acc-absences", pages: ["accueil"],
      question: "Qui figure dans « Absences de l'équipe » ?",
      aussi: ["absences sur l'accueil", "absents de la semaine", "couleurs des absences de l'accueil"],
      mots: "absence equipe semaine accueil rouge orange gris",
      reponse: "Les **absents de la semaine en cours**, du lundi au vendredi : ton secteur, plus les administratifs et les personnes sans secteur (tout le bureau si tu n'as pas de secteur). **Rouge** : absent toute la semaine ; **orange** : une partie ; **gris** : jour off ou demi-journée de sa semaine type. Un clic mène à la personne dans Absences et congés.",
      lien: "accueil", montre: ["#t-abs"] },

    { id: "acc-pastilles", pages: ["accueil"],
      question: "Que veulent dire les pastilles chiffrées ?",
      aussi: ["le chiffre rouge sur les icônes", "badge", "notification"],
      mots: "pastille chiffre badge notification nombre",
      reponse: "Elles comptent ce qui t'attend :\n- sur **Absences et congés** : les demandes de congé à valider (si tu décides) ;\n- sur **Le bureau aujourd'hui** : les messages du tchat non lus ;\n- sur **Veille simap.ch** : les nouvelles publications pas encore traitées.\nLe détail s'affiche au survol. Dans la barre du haut, Communication porte aussi la pastille du tchat." },

    { id: "acc-a-affecter", sansDroit: "Une tâche est **à affecter** quand elle n'a pas encore de personne désignée (« À affecter (ingénieur) » ou « (dessinateur) » dans le formulaire). Ce sont les chefs de secteur (et au-delà) qui les suivent et les confient : l'encadré de l'accueil n'est pas ouvert à ton groupe. Sur la page Tâches, l'entrée **À affecter** du bandeau les liste.",
      pages: ["accueil", "taches", "tableau"],
      question: "Que sont les tâches à affecter ?",
      aussi: ["tâches sans personne", "qui doit prendre cette tâche", "attribuer les tâches libres"],
      mots: "aaffecter affecter libre personne tache",
      reponse: "Une tâche est **à affecter** quand elle n'a pas encore de personne désignée (« À affecter (ingénieur) » ou « (dessinateur) » dans le formulaire). On les retrouve :\n- sur l'accueil, encadré **Tâches à affecter** (droit « Tâches à affecter ») ;\n- sur Tâches, entrée **À affecter** du bandeau ;\n- au tableau de bord, en haut : une ligne par métier ; **glisse une barre sur une personne** pour la lui confier.",
      ici: { tableau: "Tout en haut du tableau de bord, la ligne **À affecter** (une par métier) montre les charges sans personne, semaine par semaine. **Glisse une barre sur la ligne d'une personne** pour la lui confier, ou clique pour ouvrir la fiche et choisir quelqu'un." },
      droit: "taches_a_affecter", voir: ["tache-affecter"] },

    /* ================================================================ tâches */

    { id: "tache-creer", selonDroit: { taches_autrui: ["Ton groupe peut créer des tâches pour tout le monde.", "Ton groupe ne crée que des tâches **dont tu es la personne désignée** ; ses **dépendances**, elles, vont à qui tu veux. Pour une tâche entièrement à un collègue, demande à ton chef de projet ou de secteur."] },
      pages: ["taches", "tableau", "affaires", "equipe", "charge"], frequente: true,
      question: "Comment créer une tâche ?",
      aussi: ["ajouter une tâche", "nouvelle tâche", "créer un travail", "créer une tâche pour quelqu'un"],
      mots: "creer tache nouvelle ajouter formulaire personne designee",
      reponse: "Bouton **Nouvelle tâche** à droite du titre (sur téléphone, le bouton rond en bas), ou clic droit sur une personne › **Nouvelle tâche pour …**. Remplis :\n- l'**affaire** puis le **libellé** ;\n- la **personne désignée** et sa **charge** en jours (pas de 0,5) ; « À affecter » si personne n'est encore choisi ;\n- au besoin, des **dépendances** : **+ Ajouter une dépendance**, une ligne par personne qui doit rendre quelque chose avant ;\n- l'**échéance** : c'est elle qui fait foi, le début se calcule ;\n- la priorité, le statut, l'avancement et une note si besoin.\n**Entrée** enregistre.",
      ici: {
        affaires: "Depuis Affaires, le plus rapide : clic droit sur l'affaire › **Nouvelle tâche sur cette affaire** — l'affaire est déjà choisie. Sinon, bouton **Nouvelle tâche** de la page Tâches.",
        tableau: "Le plus rapide : **double-clic sur un jour** de la ligne d'une personne — elle est désignée d'office et ce jour devient l'échéance. Sinon, bouton **Nouvelle tâche**, clic droit sur une personne › **Nouvelle tâche pour …**, ou clic droit sur une barre › **Nouvelle tâche sur cette affaire**.",
        taches: "Bouton **Nouvelle tâche** : si une personne est choisie dans le bandeau de gauche, elle est **désignée d'office**. Clic droit sur une personne › **Nouvelle tâche pour …** fait de même.",
        equipe: "Clic droit sur la personne › **Nouvelle tâche pour …** : le formulaire s'ouvre avec elle comme personne désignée."
      },
      lien: "taches", montre: "Nouvelle tâche",
      voir: ["tache-dependances", "tb-double-clic", "tache-echeance", "tache-droits"] },

    { id: "tb-double-clic", pages: ["tableau"], frequente: true,
      question: "Comment créer une tâche directement sur le planning ?",
      aussi: ["double-clic sur une date", "double clic sur un jour", "créer une tâche pour une personne au tableau de bord"],
      mots: "double clic doubleclic jour date creer tache planning ligne",
      reponse: "**Double-clic sur un jour vide** de la ligne d'une personne : le formulaire **Nouvelle tâche** s'ouvre avec cette personne désignée et ce jour comme **échéance** (une tâche de 1 j tombe pile dessus, une plus longue remonte avant). Sur la ligne **À affecter**, la tâche s'ouvre sans personne.",
      selonDroit: { taches_autrui: ["", "Sans le droit « Créer des tâches pour les autres », le double-clic ne marche que sur **ta** ligne ; à un collègue, tu peux en revanche confier une **dépendance** de ta tâche."] },
      lien: "tableau", voir: ["tache-creer", "tache-dependances"] },

    { id: "personne-nouvelle-tache", pages: ["equipe", "taches", "tableau", "charge", "absences", "annuaire", "communication"],
      question: "Comment créer une tâche pour une personne ?",
      aussi: ["nouvelle tâche pour", "donner une tâche à quelqu'un", "tâche depuis la liste des membres"],
      mots: "nouvelle tache pour personne membre designee clicdroit",
      reponse: "Clic droit sur la personne (partout où elle paraît) › **Nouvelle tâche pour …** : elle est la **personne désignée** d'office. Sur Tâches, choisir la personne dans le bandeau puis **Nouvelle tâche** revient au même ; au tableau de bord, **double-clic sur un jour** de sa ligne.",
      selonDroit: { taches_autrui: ["", "Sans le droit « Créer des tâches pour les autres », l'entrée **Nouvelle tâche pour …** n'apparaît que sur toi. Pour faire travailler un collègue sur ta tâche, ajoute-lui une **dépendance**."] },
      voir: ["tache-creer", "tache-dependances"] },

    { id: "tache-echeance", pages: ["taches", "tableau"], frequente: true,
      question: "Comment est calculé le début d'une tâche ?",
      aussi: ["pourquoi la date de début change", "l'échéance fait foi", "date de début calculée"],
      mots: "debut calcul echeance date capacite ferie",
      reponse: "L'**échéance fait foi**. En remontant depuis elle, la charge remplit la capacité réelle de la personne : rien le week-end, les jours fériés du canton, pendant ses absences et ses jours non travaillés ; sa capacité hebdomadaire est répartie sur sa semaine type. Le formulaire montre le début calculé de la tâche et de chaque dépendance pendant la saisie.\nUne charge sans personne s'étale sur les jours ouvrés.",
      voir: ["tache-dependances", "jours-travailles"] },

    { id: "tache-dependances", pages: ["taches", "tableau"], frequente: true,
      question: "C'est quoi une dépendance ?",
      aussi: ["dépendance d'une tâche", "à faire avant", "plusieurs personnes sur une tâche", "le calcul avant le dessin", "le dessin commence-t-il après le calcul", "tâche enchaînée"],
      mots: "dependance avant plusieurs personnes calcul dessin enchainee attendre",
      reponse: "Une tâche a **une personne désignée**. Si d'autres doivent rendre quelque chose avant qu'elle commence, ajoute des **dépendances** dans le formulaire (**+ Ajouter une dépendance**) : une ligne par personne, avec sa charge et, si tu veux, son propre libellé. Tu peux en mettre **autant que nécessaire**.\n- chaque dépendance est **à rendre la veille du jour où la tâche commence** : sa date se calcule toute seule et suit la tâche quand elle bouge ;\n- avancée à la main, une dépendance garde sa date ; retardée jusque sur la tâche, elle **repousse la tâche** juste assez ;\n- chaque dépendance est une tâche à part entière : sa barre chez sa personne, sa fiche, son « Terminé » ;\n- supprimer la tâche supprime ses dépendances.\nLa coche « Le dessin commence quand le calcul est rendu » a disparu : une dépendance est toujours faite avant.",
      selonDroit: { taches_autrui: ["", "Sans le droit « Créer des tâches pour les autres », tu mènes les dépendances des tâches dont tu es la personne désignée, et tu les confies à qui tu veux."] },
      voir: ["tache-creer", "tache-anciennes", "tache-fil"] },

    { id: "tache-anciennes", pages: ["taches", "tableau"],
      question: "Que deviennent les tâches avec un calcul et un dessin ?",
      aussi: ["ancienne tâche à deux parts", "charge ingénieur et charge dessin", "calcul et dessin dans la même tâche"],
      mots: "ancienne calcul dessin deux parts ingenieur dessinateur charge",
      reponse: "Les tâches créées avant les dépendances gardent leurs **deux parts** (calcul et dessin) tant qu'on ne les modifie pas. À l'ouverture du formulaire, le **dessin devient la tâche** et le **calcul sa dépendance** ; à l'enregistrement, elles sont rangées ainsi pour de bon (une tâche où calcul et dessin avançaient en parallèle passe alors en « calcul avant »).",
      voir: ["tache-dependances"] },

    { id: "tache-parts", pages: ["taches", "tableau"],
      question: "Qui porte une tâche ?",
      aussi: ["personne désignée", "c'est quoi les deux parts d'une tâche", "part calcul et part dessin"],
      mots: "personne designee porte part calcul dessin ingenieur dessinateur charge",
      reponse: "Une tâche a **une personne désignée**, ingénieur ou dessinateur, et **sa charge** en jours. Ceux qui doivent rendre quelque chose avant ont chacun leur **dépendance**. Seules les anciennes tâches gardent encore deux parts (calcul et dessin), jusqu'à leur prochaine modification.",
      voir: ["tache-dependances", "tache-anciennes", "tache-terminer"] },

    { id: "tache-terminer", pages: ["taches", "tableau", "accueil"], frequente: true,
      question: "Comment terminer une tâche ?",
      aussi: ["marquer terminé", "j'ai fini ma part", "cocher une tâche", "le pouce", "rouvrir une tâche"],
      mots: "terminer pouce fini part rouvrir cocher",
      reponse: "Le **pouce** de la ligne termine la tâche (sur une ancienne tâche à deux parts : **ta part**). Un nouveau clic la rouvre. Une **dépendance** se termine de la même façon, sur sa propre ligne.\nSur Tâches, un **clic droit sur l'étiquette d'une personne** › **Terminer la tâche** fait de même. Un clic gauche sur l'étiquette ouvre la fiche de la tâche.",
      ici: {
        tableau: "Ouvre la barre (clic) : dans la fiche, coche **Tâche terminée**. Ou clic droit › **Terminer la tâche**. La barre reste dessinée chez la personne, en demi-teinte avec une coche, mais ne pèse plus sur sa charge.",
        accueil: "Dans **Mes tâches prioritaires**, le **pouce** termine la tâche d'un clic ; « Annuler » la ramène."
      },
      voir: ["tache-parts", "tache-masquer-terminees"] },

    { id: "tache-modifier", selonDroit: { taches_autrui: ["", "Sans le droit « Créer des tâches pour les autres », les tâches où tu n'as aucune part s'ouvrent en lecture seule."] },
      pages: ["taches", "tableau"],
      question: "Comment modifier une tâche ?",
      aussi: ["changer une tâche", "fiche rapide", "modifier le statut", "modifier l'avancement"],
      mots: "modifier ficherapide statut avancement crayon",
      reponse: "Un **clic sur la ligne** ouvre la **fiche rapide** : statut, avancement, affectation, parts terminées, note et décalage de l'échéance. **Modifier en détail** (ou le crayon de la ligne) ouvre le formulaire complet.\nUne tâche qui ne te concerne pas s'ouvre en lecture seule si tu n'as pas le droit de mener celles des autres.",
      ici: { tableau: "Un **clic sur une barre** ouvre sa fiche rapide (statut, avancement, affectation, note, décalage) ; **Modifier en détail** ouvre le formulaire complet. Tu peux aussi **glisser** la barre pour la décaler ou la réaffecter." },
      voir: ["tache-droits", "tache-decaler"] },

    { id: "tache-supprimer", pages: ["taches", "tableau"],
      selonDroit: { taches_autrui: ["Ton groupe peut supprimer les tâches de tout le monde.", "Sans le droit « Créer des tâches pour les autres », tu ne supprimes que **tes** tâches (et leurs dépendances)."] },
      question: "Comment supprimer une tâche ?",
      aussi: ["effacer une tâche", "retirer une tâche", "supprimer une barre"],
      mots: "supprimer tache effacer corbeille barre",
      reponse: "Clic droit sur la tâche › **Supprimer la tâche** (ou la corbeille de la ligne), puis confirme. Ses **dépendances** partent avec elle (la question le dit). « Annuler » dans le message, ou Ctrl+Z, la ramène tout de suite ; pour la garder dans l'historique, marque-la plutôt **terminée**.",
      ici: { tableau: "Clic droit sur la barre › **Supprimer la tâche**, puis confirme. Ses **dépendances** partent avec elle. « Annuler » dans le message, ou Ctrl+Z, la ramène tout de suite." },
      voir: ["tache-terminer"] },

    { id: "tache-decaler", pages: ["tableau", "taches"], frequente: true,
      question: "Comment décaler une tâche ?",
      aussi: ["repousser une échéance", "déplacer une barre", "changer la date d'une tâche", "glisser une tâche"],
      mots: "decaler deplacer glisser echeance date barre repousser",
      reponse: "Au **tableau de bord**, glisse la barre vers la gauche ou la droite : l'échéance suit, avec « Annuler » dans le message. Partout, la **fiche rapide** (clic sur la ligne) a aussi des boutons de décalage de l'échéance.",
      ici: {
        tableau: "**Glisse la barre** de côté : l'échéance suit (« Annuler » dans le message). Glissée sur la ligne d'une autre personne, elle est aussi **réaffectée**. **Étire son bord gauche** pour changer la charge sans toucher l'échéance. Sur téléphone, un appui ouvre la fiche, qui permet de décaler.",
        taches: "Clique sur la ligne : la **fiche rapide** permet de décaler l'échéance. Pour glisser à la souris, va au **tableau de bord**."
      },
      lien: "tableau", voir: ["tb-etirer", "tache-affecter"] },

    { id: "tache-affecter", selonDroit: { taches_autrui: ["Ton groupe peut réaffecter n'importe quelle tâche.", ""] },
      pages: ["tableau", "taches"],
      question: "Comment confier une tâche à quelqu'un ?",
      aussi: ["réaffecter une tâche", "changer la personne d'une tâche", "attribuer une tâche", "passer la main"],
      mots: "affecter reaffecter personne confier attribuer designee",
      reponse: "Dans la fiche rapide ou le formulaire, choisis la **personne désignée** (ingénieur ou dessinateur, peu importe). Au **tableau de bord**, glisse la barre sur la ligne d'une autre personne, ingénieur ou dessinateur (ou sur la ligne « À affecter » pour la libérer).\nSans le droit « Créer des tâches pour les autres », tu ne mènes que les tâches dont tu es la personne désignée et leurs dépendances ; tu peux passer la main à un collègue.",
      voir: ["acc-a-affecter", "tache-droits"] },

    { id: "tache-priorite", pages: ["taches", "accueil"],
      question: "À quoi sert la priorité ?",
      aussi: ["P1 P2 P3", "pastille de priorité", "rendre une tâche urgente"],
      mots: "priorite urgent p1 curseur pastille",
      reponse: "Le curseur **Priorité** du formulaire va de 1 (la plus importante) à 5 (normale, par défaut). Entre deux tâches de **même échéance**, la priorité 1 passe devant, dans la liste comme dans « Mes tâches prioritaires ». Les priorités 1 à 4 s'affichent en pastille P1–P4 sur la ligne." },

    { id: "tache-statuts", pages: ["taches"],
      question: "Quels sont les statuts d'une tâche ?",
      aussi: ["à faire en cours en attente", "statut de la tâche", "filtrer par statut"],
      mots: "statut faire cours attente termine",
      reponse: "Quatre statuts : **À faire**, **En cours**, **En attente**, **Terminé**. Le statut global résume les parts : « Terminé » quand toutes les parts existantes sont finies, « En cours » dès qu'une moitié est bouclée. Le bandeau de gauche filtre par statut." },

    { id: "tache-masquer-terminees", pages: ["taches"],
      question: "Comment voir ou cacher les tâches terminées ?",
      aussi: ["afficher les terminées", "masquer les terminées", "retrouver une tâche finie"],
      mots: "masquer afficher terminee finie",
      reponse: "Dans le bandeau de gauche, la case **Masquer les terminées**. Elle cache aussi les tâches où la part de la personne regardée est rendue alors que l'autre métier travaille encore.",
      lien: "taches", montre: "Masquer les terminées" },

    { id: "tache-liste-lire", pages: ["taches"], frequente: true,
      question: "Comment est rangée la liste des tâches ?",
      aussi: ["ordre de la liste", "par semaine", "ranger par affaire", "trier les tâches"],
      mots: "liste ranger ordre semaine affaire echeance trier",
      reponse: "Par **semaine** : chaque tâche paraît une fois, dans la première semaine où il reste à y travailler (celle de son début, ou la semaine en cours si elle a commencé). Les retards passent devant, les tâches terminées ferment la liste.\nDans le bandeau, le rangement **Par échéance** ou **Par affaire** (les tâches d'une affaire ensemble) ; ton choix est retenu sur cet appareil.",
      lien: "taches", montre: "Par échéance" },

    { id: "tache-mes-taches", pages: ["taches", "equipe"],
      question: "Comment voir les tâches d'un collègue ?",
      aussi: ["mes tâches", "tâches d'une personne", "voir ses tâches"],
      mots: "taches collegue personne mes voir",
      reponse: "Sur Tâches, le bandeau de gauche : **Mes tâches**, ou une personne. Partout ailleurs : clic droit sur la personne › **Ses tâches**. Sur Tâches, un clic droit sur la pastille d'une personne › **Ses tâches** filtre la page sur elle.",
      lien: "taches" },

    { id: "tache-affaire", pages: ["taches", "affaires"],
      question: "Comment voir toutes les tâches d'une affaire ?",
      aussi: ["tâches d'un projet", "filtrer par affaire"],
      mots: "taches affaire filtrer projet",
      reponse: "Sur Tâches, choisis l'affaire dans le menu **Affaire** du bandeau. Depuis Affaires : clic droit › **Tâches de l'affaire**. Si l'affaire a un mandat, ses phases et son avancement s'affichent en tête, et le responsable de l'affaire peut y saisir l'avancement.",
      lien: "taches", voir: ["mandat-avancement"] },

    { id: "tache-droits", selonDroit: { taches_autrui: ["Toi, tu as ce droit : si une tâche reste en lecture seule, c'est sans doute une question de page ou de connexion (essaie Ctrl+F5).", ""] },
      pages: ["taches", "tableau"],
      question: "Pourquoi je ne peux pas modifier cette tâche ?",
      aussi: ["tâche en lecture seule", "je ne peux pas créer de tâche pour un collègue"],
      mots: "droit lecture seule modifier collegue bloque",
      reponse: "Sans le droit **« Créer des tâches pour les autres »**, tu ne crées et ne modifies que les tâches **dont tu es la personne désignée**, et leurs **dépendances** ; les autres s'ouvrent en lecture seule. Tu confies librement ces dépendances à des collègues. Le droit se donne par groupe dans la console.",
      droit: "taches_autrui" },

    { id: "tache-fil", pages: ["taches", "tableau"],
      question: "C'est quoi le trait entre deux barres ?",
      aussi: ["fil entre une tâche et ses dépendances", "fil entre calcul et dessin", "lien entre les étiquettes"],
      mots: "fil trait lien survol dependance calcul dessin",
      reponse: "Au tableau de bord, au survol d'une barre, un **fil** relie chaque **dépendance** à sa tâche (d'une ligne à l'autre), et les barres reliées s'entourent. Sur une ancienne tâche à deux parts, il relie le calcul à son dessin. Clic droit sur une dépendance › **Ouvrir la tâche principale** ; sur une tâche › **Ajouter une dépendance**." },

    /* ================================================================ tableau de bord */

    { id: "tb-lire", selonDroit: { planning_equipe: ["", "Ton groupe ne voit ici que **tes tâches** et les personnes qui en portent l'autre part (droit « Planning de toute l'équipe »)."] },
      pages: ["tableau"], frequente: true,
      question: "Comment lire le tableau de bord ?",
      aussi: ["c'est quoi le planning", "que montrent les barres", "les chiffres en haut du planning"],
      mots: "tableaudebord planning barre lire chiffre ligne",
      reponse: "Une **ligne par personne**, une **barre par part de tâche** placée sur les jours où elle est travaillée (remontée depuis l'échéance selon la capacité). En haut, les charges **à affecter** ; en tête, quatre chiffres : jours affectés, jours disponibles, taux d'occupation et tâches en retard. Les jours non travaillés sont grisés, la demi-journée à mi-hauteur. Dessous : les **alertes**.",
      voir: ["tb-periode", "tb-alertes", "tache-decaler"] },

    { id: "tb-periode", pages: ["tableau", "absences", "charge"],
      question: "Comment changer la période affichée ?",
      aussi: ["voir plus de semaines", "semaine suivante", "revenir à aujourd'hui"],
      mots: "periode semaine suivante precedente aujourd hui duree",
      reponse: "Les flèches **◀ ▶** passent d'une semaine à l'autre, **Aujourd'hui** y revient, et le menu à côté affiche **1, 2 ou 4 semaines**.",
      ici: {
        absences: "Les flèches **◀ ▶** avancent ou reculent, **Ce mois** revient au présent, et le menu choisit **1 semaine, 1, 2 ou 3 mois**.",
        charge: "Les flèches **◀ ▶** passent d'une semaine à l'autre, **Cette semaine** y revient, et le menu affiche **8, 12, 16 ou 26 semaines** (retenu sur cet appareil)."
      },
      montre: ["#duree", "#horizon"] },

    { id: "tb-etirer", pages: ["tableau"],
      question: "Comment changer la charge d'une barre ?",
      aussi: ["étirer une barre", "allonger une tâche", "modifier le nombre de jours"],
      mots: "etirer charge jours barre allonger bord",
      reponse: "**Étire la barre par son bord gauche** : l'échéance reste, la charge devient la capacité de la personne entre le jour visé et la fin de la barre (jours travaillés, absences, temps partiel), arrondie à la demi-journée. Le message propose « Annuler ». Tu peux aussi saisir la charge dans le formulaire." },

    { id: "tb-alertes", pages: ["tableau"],
      question: "Que veulent dire les alertes ?",
      aussi: ["alertes du tableau de bord", "en retard", "échéance proche", "sans ingénieur"],
      mots: "alerte retard proche sans ingenieur dessinateur",
      reponse: "Sous le planning, les **Alertes** listent :\n- **En retard** : échéance passée ;\n- **Calcul en retard** (anciennes tâches à deux parts) : le calcul doit être rendu à temps pour que le dessin tienne l'échéance ;\n- **Échéance proche** ;\n- **Sans ingénieur / Sans dessinateur** : tâche sans personne désignée.\nUn clic ouvre la tâche.",
      lien: "tableau", montre: ["#titre-alertes"] },

    { id: "tb-mon-planning", sansDroit: "Ton groupe n'a pas le droit **« Planning de toute l'équipe »** : le tableau de bord ne te montre que **tes tâches** et les personnes qui en portent l'autre part. C'est voulu ; pour voir l'équipe entière, demande ce droit à un administrateur.", selonDroit: { planning_equipe: ["Toi, tu as ce droit : choisis « Tous » ou une équipe dans le bandeau de gauche. Si tu ne vois que toi, l'entrée **Mon planning** est sélectionnée.", ""] },
      pages: ["tableau"],
      question: "Pourquoi je ne vois que mes tâches au tableau de bord ?",
      aussi: ["voir le planning de toute l'équipe", "je ne vois pas les autres"],
      mots: "planning equipe voir autres seulement mes droit",
      reponse: "Sans le droit **« Planning de toute l'équipe »**, le tableau de bord ne montre que **tes tâches** et les personnes qui en portent l'autre part. Avec lui, l'entrée « Mon planning » du bandeau et toutes les équipes sont proposées.",
      droit: "planning_equipe" },

    { id: "tb-clic-droit-autre-part", pages: ["tableau"],
      question: "Comment passer du calcul au dessin d'une même tâche ?",
      aussi: ["aller à l'autre part", "trouver le dessin d'un calcul", "aller à la tâche principale"],
      mots: "autre part calcul dessin aller sauter principale",
      reponse: "Sur une ancienne tâche à deux parts : clic droit sur la barre › **Aller au dessin** (ou **Aller au calcul**) : les filtres suivent (personne, métier, période) et l'autre barre est amenée sous les yeux, éclairée et reliée.\nSur une **dépendance** : clic droit › **Ouvrir la tâche principale**.",
      voir: ["tache-dependances"] },

    /* ================================================================ tableau de charge */

    { id: "ch-lire", pages: ["charge"], frequente: true,
      question: "Comment lire le tableau de charge ?",
      aussi: ["les couleurs du tableau de charge", "qui peut prendre du travail", "carte de charge"],
      mots: "tableaucharge couleur case pourcentage lire surcharge",
      reponse: "Une **case par personne et par semaine**, teintée selon son taux de charge (plus foncé = plus chargé, cinq paliers). Les chiffres sont ceux du planning.\n- **Rouge avec « ! »** : surcharge (plus de 100 %) ;\n- **hachuré** : semaine sans jour travaillé (absence, fériés) ;\n- la ligne **Équipe** fait la moyenne, la ligne **À affecter** compte les jours sans personne ;\n- **Libre dès** : première semaine sous 70 %.\nAu survol, la ligne affiche ses pourcentages et une bulle détaille la semaine.",
      voir: ["ch-clic", "ch-affaire"] },

    { id: "ch-clic", pages: ["charge"],
      question: "Que se passe-t-il quand je clique sur une case ?",
      aussi: ["détail d'une semaine", "voir au planning"],
      mots: "clic case detail semaine planning",
      reponse: "Un clic (ou Entrée) ouvre les **tâches de la semaine** de cette personne, chacune ouvrant sa fiche rapide. **Ses tâches** mène à sa liste ; **Voir au planning** ouvre le tableau de bord sur cette semaine et cette personne." },

    { id: "ch-affaire", pages: ["charge"],
      question: "Comment voir qui travaille sur une affaire ?",
      aussi: ["charge d'une seule affaire", "ne compter qu'une affaire"],
      mots: "affaire compter charge seule qui travaille",
      reponse: "Dans le bandeau, **Ne compter qu'une affaire** : la répartition reste calculée sur tout le travail de chacun, mais seule la part de cette affaire est comptée — « qui travaille sur B12, et quand ».",
      lien: "charge", montre: "Ne compter" },

    { id: "ch-acces", sansDroit: "Le tableau de charge n'est pas ouvert à ton groupe (droit **« Tableau de charge »**, donné au départ aux chefs de secteur et au-delà). Un administrateur peut te l'ouvrir dans la console.", selonDroit: { page_charge: ["Toi, tu y as accès.", ""] },
      pages: ["charge", "accueil"],
      question: "Qui a accès au tableau de charge ?",
      aussi: ["je ne vois pas le tableau de charge"],
      mots: "acces tableaucharge droit",
      reponse: "La page s'ouvre avec le droit **« Tableau de charge »**, donné au départ aux chefs de secteur et au-delà. Un administrateur du site peut l'ouvrir à d'autres groupes dans la console.",
      droit: "page_charge", lien: "charge" },

    /* ================================================================ affaires */

    { id: "aff-creer", sansDroit: "Ton groupe ne peut pas ouvrir d'affaire (droit **« Ouvrir une affaire »**) : demande à ton chef de projet, ton chef de secteur ou un administrateur de la créer. Tu travailles ensuite normalement dessus : tâches, avancement si tu en es le responsable.",
      pages: ["affaires"], frequente: true,
      question: "Comment créer une affaire ?",
      aussi: ["ouvrir une affaire", "nouvelle affaire", "ajouter un projet"],
      mots: "creer affaire nouvelle ouvrir projet",
      reponse: "Bouton **Nouvelle affaire** à droite du titre. Le formulaire demande le numéro (facultatif), la phase SIA, le libellé, l'adresse, le statut, l'échéance générale, la succursale, le responsable, une note, la **teinte**, l'**équipe** (ingénieurs et dessinateurs) et le **mandat** (phases et disciplines).\nIl faut le droit **« Ouvrir une affaire »**.",
      lien: "affaires", montre: "Nouvelle affaire", droit: "affaires_creer",
      voir: ["aff-mandat", "aff-responsable"] },

    { id: "aff-modifier", selonDroit: {
        affaires_modifier: ["", "Ton groupe n'a pas le droit **« Modifier les affaires »** : tu les **consultes** (la fiche s'ouvre en lecture seule), sauf celles dont tu es le **responsable**, que tu modifies toujours."],
        affaires_creer: ["Ton groupe peut aussi **supprimer** une affaire.", "Supprimer une affaire n'est pas ouvert à ton groupe (droit « Ouvrir une affaire »)."] },
      pages: ["affaires"],
      question: "Comment modifier ou supprimer une affaire ?",
      aussi: ["changer une affaire", "terminer une affaire", "suspendre une affaire", "supprimer une affaire"],
      mots: "modifier supprimer affaire statut suspendre terminer",
      reponse: "Clic droit sur l'affaire › **Modifier l'affaire** (ou l'icône de la ligne). Il faut le droit **« Modifier les affaires »**, ou être le responsable de l'affaire. Le **statut** la met active, suspendue ou terminée : une affaire terminée sort de la liste (case « Voir les affaires terminées » du bandeau).\n**Supprimer l'affaire** (clic droit) efface aussi ses tâches : préfère le statut « Terminée ». La suppression demande le droit « Ouvrir une affaire ».",
      voir: ["aff-creer"] },

    { id: "aff-responsable", pages: ["affaires"],
      question: "Comment désigner le responsable d'une affaire ?",
      aussi: ["responsable d'affaire", "chef de projet de l'affaire"],
      mots: "responsable affaire designer chefprojet",
      reponse: "Dans le formulaire de l'affaire, le champ **Responsable d'affaire**. Ou, plus vite : **clic droit sur un membre de l'équipe** de l'affaire › **Désigner responsable de l'affaire** (droit « Modifier les affaires », ou être déjà le responsable). Il n'y en a qu'un : l'ancien est remplacé. Le responsable saisit toujours l'avancement de son affaire." },

    { id: "aff-equipe", pages: ["affaires", "equipe"],
      question: "Comment ajouter quelqu'un à l'équipe d'une affaire ?",
      aussi: ["équipe de l'affaire", "ingénieurs de l'affaire", "dessinateurs de l'affaire"],
      mots: "equipe affaire ajouter ingenieur dessinateur membre",
      reponse: "Dans le formulaire de l'affaire, coche les **Ingénieurs de l'affaire** et les **Dessinateurs de l'affaire**. Être dans l'équipe ou porter une tâche de l'affaire, c'est « en être » : c'est ce que suivent les filtres par affaire d'Équipe et du tableau de bord. Ce sont aussi ces affaires-là qui passent en tête de tes menus (« Mes affaires »)." },

    { id: "aff-teinte", pages: ["affaires", "tableau"],
      question: "À quoi sert la teinte d'une affaire ?",
      aussi: ["couleur de l'affaire", "couleur des barres"],
      mots: "teinte couleur affaire barre",
      reponse: "Chaque affaire a une **teinte** (huit nuances) choisie dans son formulaire : elle colore son numéro et ses barres au planning, pour reconnaître ses tâches d'un coup d'œil." },

    { id: "aff-mandat", pages: ["affaires", "facturation"],
      question: "Comment saisir le mandat d'une affaire ?",
      aussi: ["phases SIA du mandat", "disciplines par phase", "mandat de l'affaire"],
      mots: "mandat phasesia discipline phase cocher",
      reponse: "Dans le formulaire de l'affaire, la partie **Mandat : phases SIA et disciplines** : une ligne par phase (21 à 53), une case par discipline (sigle STR, GEO, ENV…, légende dessous). Coche les disciplines concernées par chaque phase. L'avancement et la facturation se suivent ensuite phase par phase.",
      voir: ["mandat-avancement", "fa-lire"] },

    { id: "aff-phase", pages: ["affaires"],
      question: "Que veulent dire les phases SIA ?",
      aussi: ["phase de l'affaire", "numéros de phase", "phase AO"],
      mots: "phasesia phase numero",
      reponse: "Les phases du mandat selon la SIA :\n- **AO** : appel d'offres (l'offre du bureau, avant toute phase) ;\n- **21** étude de faisabilité ;\n- **31** avant-projet, **32** projet de l'ouvrage, **33** demande d'autorisation ;\n- **41** appel d'offres ;\n- **51** projet d'exécution, **52** exécution de l'ouvrage, **53** mise en service, achèvement.\nLa phase en cours se choisit dans le formulaire de l'affaire." },

    { id: "aff-mes-affaires", pages: ["affaires"],
      question: "Quelles sont « mes affaires » ?",
      aussi: ["mes affaires en tête", "affaires dont je fais partie"],
      mots: "mes affaire tete menu",
      reponse: "Tes affaires sont celles dont tu es **responsable**, où tu es dans **l'équipe de la fiche**, ou où tu portes une **tâche en cours**. Elles passent **en tête de tous les menus d'affaires** (groupe « Mes affaires »). Sur la page Affaires, un collaborateur arrive directement sur elles." },

    { id: "aff-carte", pages: ["affaires", "carte"], frequente: true,
      question: "Comment voir les affaires sur une carte ?",
      aussi: ["carte des affaires", "localiser une affaire", "Google Maps", "adresse de l'affaire"],
      mots: "carte cartesaffaires localiser adresse googlemaps",
      reponse: "Bouton **Carte des affaires** de la page Affaires : toutes les affaires qui ont une adresse, sur le fond de swisstopo. Glisse pour te déplacer, molette ou pincement pour zoomer. Un clic sur un losange : l'adresse, la phase, les tâches ouvertes, Google Maps et Tâches. Une affaire sans adresse n'y figure pas : complète son adresse dans sa fiche.\nPour une seule affaire : clic droit › **Voir sur Google Maps**.",
      ici: { carte: "Chaque affaire qui a une adresse est un **losange** à sa teinte, son numéro à côté. Glisse pour te déplacer, molette, double-clic ou pincement pour zoomer. Un clic ouvre une bulle : adresse, phase, tâches ouvertes, Google Maps et Tâches. Une adresse introuvable ? Complète-la dans la fiche de l'affaire (NPA et localité suffisent)." },
      lien: "carte", montre: "Carte des affaires" },

    { id: "aff-succursale", pages: ["affaires", "taches", "tableau"],
      question: "À quoi sert la succursale d'une affaire ?",
      aussi: ["filtrer par succursale", "succursale non renseignée"],
      mots: "succursale filtre affaire renseignee",
      reponse: "La **succursale** (facultative) range l'affaire ; elle est pré-remplie avec celle de qui la crée. Le bandeau de gauche de Tâches, Affaires, du tableau de bord, du tableau de charge et de Facturation filtre par succursale ; « Sans succursale » regroupe les affaires qui n'en ont pas." },

    /* ================================================================ mandat, avancement, facturation */

    { id: "mandat-avancement", selonDroit: { avancement_tous: ["Ton groupe saisit l'avancement de **toutes** les affaires.", ""], avancement_secteur: ["Ton groupe saisit l'avancement de **ta discipline** sur toutes les affaires.", ""], facturation_saisir: ["Tu saisis aussi le **facturé**, dans la même fenêtre.", ""] },
      pages: ["affaires", "taches", "facturation"], frequente: true,
      question: "Comment saisir l'avancement d'une affaire ?",
      aussi: ["mettre à jour l'avancement", "pourcentage d'avancement", "jauge d'avancement", "avancement par phase"],
      mots: "avancement saisir pourcentage jauge phase",
      reponse: "Ouvre la fenêtre d'avancement de l'affaire :\n- sur **Affaires**, l'icône **jauge** de la ligne (ou clic droit › Avancement) ;\n- sur **Tâches** filtrée sur l'affaire, le bandeau du mandat en tête ;\n- sur **Facturation**, un clic sur l'affaire.\nUne carte par phase, une ligne par discipline : saisis le **%** ; la date et ton nom s'enregistrent. Rien n'est écrasé : l'historique garde chaque saisie.",
      voir: ["mandat-qui", "fa-lire"] },

    { id: "mandat-qui", selonDroit: { avancement_tous: ["Toi : avancement de toutes les affaires.", ""], avancement_secteur: ["Toi : avancement de ta discipline.", ""], facturation_saisir: ["Toi : tu saisis la facturation.", ""], page_facturation: ["Tu vois la page Facturation.", "Tu ne vois pas le facturé."] },
      pages: ["affaires", "facturation"],
      question: "Qui peut saisir l'avancement et la facturation ?",
      aussi: ["droit de saisir l'avancement", "qui voit la facturation"],
      mots: "avancement facturation droit saisir voir qui",
      reponse: "- **Avancement** : le **responsable de l'affaire** (toujours), les chefs de secteur pour leur discipline (« Avancement de son secteur »), les administrateurs (« Avancement de toutes les affaires »). Tout le bureau le voit.\n- **Facturation** : le droit **« Saisir la facturation »** ; seuls ce droit et la page Facturation la font voir." },

    { id: "mandat-historique", pages: ["affaires", "facturation"],
      question: "Comment voir l'historique de l'avancement ?",
      aussi: ["qui a changé l'avancement", "ancienne valeur"],
      mots: "historique avancement ancien valeur qui date",
      reponse: "Dans la fenêtre d'avancement, l'**historique** repliable liste chaque saisie avec la valeur d'avant, la date et la personne ; il se filtre. La saisie la plus récente d'une case fait foi ; la phase vaut la moyenne de ses disciplines (case sans saisie = 0)." },

    /* ================================================================ facturation */

    { id: "fa-lire", pages: ["facturation"], frequente: true,
      question: "Comment lire la page Facturation ?",
      aussi: ["les jauges de facturation", "avancé au-delà du facturé", "facturé d'avance"],
      mots: "facturation jauge lire avance facture",
      reponse: "Un bloc par **secteur** (discipline du mandat), une ligne par affaire, **deux jauges par phase** : l'avancement (couleur de l'accent) et le facturé (bleu ; en rouge s'il dépasse l'avancement). En tête de chaque bloc, les signaux : **phases avancées au-delà du facturé** et **facturées d'avance**. Un clic sur une affaire ouvre la saisie.",
      voir: ["fa-filtres", "mandat-avancement"] },

    { id: "fa-filtres", pages: ["facturation"],
      question: "Comment filtrer la facturation ?",
      aussi: ["voir une succursale", "affaires sans mandat", "affaires terminées"],
      mots: "filtre succursale secteur affaire terminee mandat",
      reponse: "Le bandeau de gauche : **Mes affaires**, toutes les affaires, chaque succursale et, dessous, les secteurs de ses mandats ; une affaire ; « Voir les affaires terminées ». Le compteur du titre donne le nombre d'affaires montrées. En bas, la liste repliable des **affaires en cours sans mandat**.",
      montre: ["#bd-bandeau"] },

    /* ================================================================ inter-secteurs */

    { id: "inter-quoi", pages: ["veille", "ao_publics", "ao_prives", "agenda_ao", "facturation"],
      question: "Que contient le module Inter-secteurs ?",
      aussi: ["c'est quoi Inter-secteurs", "les pages AO"],
      mots: "inter secteur module ao page",
      reponse: "Cinq pages, dans la sous-barre :\n- **Veille simap.ch** : les appels d'offres publiés chaque matin ;\n- **AO publics** et **AO privés** : les offres du bureau ;\n- **Agenda des AO** : visites, questions, remises, ouvertures… ;\n- **Facturation** : avancement et facturé par phase et par secteur.\nChaque page s'ouvre selon les droits de ton groupe." },

    { id: "veille-quoi", pages: ["veille"], frequente: true,
      question: "Comment fonctionne la veille simap.ch ?",
      aussi: ["d'où viennent les publications", "veille des appels d'offres", "critères de la veille"],
      mots: "veille simap publication matin critere canton",
      reponse: "Chaque matin de semaine, l'outil relève sur **simap.ch** (marchés publics suisses) les appels d'offres de **Genève, Vaud et Valais** en **structure et génie civil** (mandats d'études et concours ; travaux et fournitures écartés). Chaque publication montre canton, type, procédure, date, adjudicateur, lieu, remise avec compte à rebours, et **pourquoi elle a été retenue** (code CPV, mot-clé, CFC).\nLe filtre : Nouvelles, Devenues des AO, Écartées, Toutes.",
      voir: ["veille-traiter"] },

    { id: "veille-traiter", selonDroit: { affaires_creer: ["", "**Créer l'AO** n'est pas ouvert à ton groupe (droit « Ouvrir une affaire ») : signale la publication à quelqu'un qui l'a."] },
      pages: ["veille"], frequente: true,
      question: "Que faire d'une publication de la veille ?",
      aussi: ["créer l'AO depuis la veille", "écarter une publication", "retenir une publication"],
      mots: "veille creer ao ecarter retenir publication",
      reponse: "Sur chaque publication :\n- **Créer l'AO** (droit « Ouvrir une affaire ») : ouvre le formulaire d'appel d'offres pré-rempli (objet, remise, demandeur retrouvé dans l'annuaire, note avec le lien) ; la publication devient « retenue » ;\n- **Écarter** : elle quitte les nouvelles ;\n- **Ouvrir AO-…** une fois retenue ; **Rétablir** / **Remettre en veille** pour revenir en arrière.\nLe badge de l'accueil compte les nouvelles dont la remise n'est pas passée." },

    { id: "ao-creer", sansDroit: "Créer un appel d'offres demande le droit **« Ouvrir une affaire »**, que ton groupe n'a pas. Signale l'AO (ou la publication de la veille) à ton chef de secteur ou à un administrateur.",
      pages: ["ao_publics", "ao_prives", "veille"], frequente: true,
      question: "Comment créer un appel d'offres ?",
      aussi: ["nouvel AO", "ajouter une offre", "nouvelle soumission"],
      mots: "creer ao nouvel offre soumission",
      reponse: "Bouton **Nouvel appel d'offres** (droit « Ouvrir une affaire »). Le formulaire : numéro (proposé **AO-AAAA-NN**), objet, type public ou privé, **remise de l'offre** (c'est l'échéance de l'affaire), demandeur (fiche de l'annuaire), honoraires offerts (CHF), secteurs, résultat et note. Un AO est une affaire en phase **AO**.",
      lien: "ao_publics", montre: "Nouvel appel d'offres", droit: "affaires_creer",
      voir: ["ao-resultat"] },

    { id: "ao-resultat", pages: ["ao_publics", "ao_prives"],
      question: "Que se passe-t-il quand un AO est gagné ou perdu ?",
      aussi: ["résultat d'un appel d'offres", "AO gagné", "AO perdu", "abandonner un AO"],
      mots: "resultat gagne perdu abandonne ao",
      reponse: "Le champ **Résultat** : en cours, gagné, perdu, abandonné.\n- **Perdu** ou **abandonné** : l'affaire passe « terminée » ;\n- **Gagné** : elle reste active en phase AO, à qui de lui donner sa phase SIA dans la page Affaires." },

    { id: "ao-public-prive", pages: ["ao_publics", "ao_prives"],
      question: "Quelle différence entre AO publics et AO privés ?",
      aussi: ["AO sans type", "type à préciser"],
      mots: "public prive type ao difference",
      reponse: "Les **AO publics** viennent des marchés publics (souvent de la veille simap.ch), les **AO privés** des maîtres d'ouvrage privés, sur invitation. Un AO sans type paraît dans les deux avec « type à préciser »." },

    { id: "ao-agenda", pages: ["agenda_ao"], frequente: true,
      question: "Comment ajouter un rendez-vous à l'agenda des AO ?",
      aussi: ["visite d'un AO", "date de remise", "ouverture des offres", "agenda des AO"],
      mots: "agenda ao rendezvous visite questions remise ouverture",
      reponse: "Bouton **Ajouter un rendez-vous** : l'appel d'offres, la date, l'heure, le type (visite, questions, remise, ouverture, présentation, séance, autre), l'intitulé, le lieu et une note. Tout le bureau lit et tient cet agenda.",
      lien: "agenda_ao", montre: "Ajouter un rendez-vous", droit: "page_inter" },

    /* ================================================================ communication */

    { id: "comm-quoi", pages: ["communication"], frequente: true,
      question: "Que montre « Le bureau aujourd'hui » ?",
      aussi: ["page communication", "le bureau aujourd'hui"],
      mots: "bureauaujourdhui communication page",
      reponse: "La vie du bureau : en haut, **aujourd'hui** (chiffres clés, **qui manque**, rendez-vous du jour) à côté des **news du bureau** ; puis l'**agenda** de la semaine, les **demandes de congé** et les **absences et congés** à venir. Le **tchat** s'ouvre par son bouton. Actions : Nouveau rendez-vous, Prévenir le bureau, Demander un congé.",
      voir: ["comm-qui-manque", "news-lire", "tchat-ouvrir"] },

    { id: "comm-qui-manque", pages: ["communication"],
      question: "Comment savoir qui manque aujourd'hui ?",
      aussi: ["qui est absent aujourd'hui", "absents du jour"],
      mots: "absentsdujour manque absent aujourd hui",
      reponse: "Dans **Le bureau aujourd'hui**, la liste **Qui manque** : les absences, les avis à l'heure près (« Prévenir le bureau »), les jours non travaillés et les demi-journées, chacun une fois. Un clic mène à la personne dans Absences et congés.",
      lien: "communication", montre: "Qui manque" },

    { id: "comm-avis", pages: ["communication"], frequente: true,
      question: "Comment prévenir que je m'absente quelques heures ?",
      aussi: ["prévenir le bureau", "je pars plus tôt", "rendez-vous chez le médecin", "absent cet après-midi"],
      mots: "avis heure partir tot chantier rendezvous medecin",
      reponse: "Bouton **Prévenir le bureau** : un avis à l'heure près (rendez-vous, chantier, départ plus tôt…), pour aujourd'hui. Il s'affiche dans **Qui manque** du jour. Pour une journée ou plus, pose plutôt une **absence**.",
      lien: "communication", montre: "Prévenir le bureau", voir: ["abs-poser"] },

    { id: "rdv-creer", selonDroit: { absences_autrui: ["Ton groupe peut modifier **tous** les rendez-vous.", "Tu modifies ceux que tu as créés et ceux où tu es participant."] },
      pages: ["communication"], frequente: true,
      question: "Comment ajouter un rendez-vous ?",
      aussi: ["nouveau rendez-vous", "agenda du bureau", "réunion", "ajouter une séance"],
      mots: "rendezvous agenda reunion creer",
      reponse: "Bouton **Nouveau rendez-vous**, ou le **+** d'un jour de l'agenda : intitulé, date, début et fin (sans début : toute la journée), lieu, participants et note. Tout le bureau le voit. Le créateur, les participants et le droit « Poser les absences des autres » le modifient. L'agenda a une case « seulement les miens ».",
      ici: { agenda_ao: "Ici c'est l'agenda des **appels d'offres** : bouton **Ajouter un rendez-vous**. L'agenda interne du bureau est dans **Le bureau aujourd'hui**." },
      lien: "communication", montre: "Nouveau rendez-vous" },

    { id: "news-lire", sansDroit: "Les **news du bureau** s'affichent en tête de Le bureau aujourd'hui ; tu les lis et ouvres les archives. Les publier demande le droit **« Rédiger les news »** : propose ton texte à quelqu'un qui l'a.", selonDroit: { news_archiver: ["Tu peux archiver une news ou la remettre en ligne.", ""], news_supprimer: ["Tu peux supprimer une news pour de bon.", ""] },
      pages: ["communication"],
      question: "Comment publier une news ?",
      aussi: ["rédiger une news", "news du bureau", "archiver une news", "annonce au bureau"],
      mots: "news rediger publier archiver annonce",
      reponse: "Dans **News du bureau**, **Rédiger une news** (droit « Rédiger les news ») : un article mis en forme (titres, gras, listes, liens, couleurs, images). Tu modifies les tiennes. **Archiver** la retire de la une (elle reste dans **Archives**) ; supprimer l'efface pour de bon. Chaque action a son droit.",
      lien: "communication", montre: ["Rédiger une news", "News du bureau"], droit: "news_rediger" },

    { id: "tchat-ouvrir", pages: ["communication", "accueil"], frequente: true,
      question: "Comment utiliser le tchat du bureau ?",
      aussi: ["envoyer un message", "tchat", "messages non lus", "discuter avec l'équipe"],
      mots: "tchat message envoyer lire nonlu",
      reponse: "Bouton **Tchat** de Le bureau aujourd'hui (sur téléphone, la bulle en bas à gauche) : une fenêtre volante, déplaçable par son titre. Tout le bureau lit ; **Entrée** envoie, **Maj+Entrée** va à la ligne. Tu retires tes messages avec la croix. Les messages non lus s'affichent en pastille sur Communication, et une annonce « Tchat » apparaît sur les autres pages.",
      lien: "communication", montre: "Tchat" },

    /* ================================================================ absences et congés */

    { id: "conge-demander", pages: ["communication", "absences", "accueil"], frequente: true,
      question: "Comment demander un congé ?",
      aussi: ["poser des vacances", "demande de congé", "prendre des vacances", "récupération"],
      mots: "conge demander vacances demande motif",
      reponse: "Bouton **Demander un congé** (Le bureau aujourd'hui) : premier et dernier jour, type (Vacances, Récupération, Congé sans solde, Congé spécial, Formation) et un commentaire. La demande attend une décision ; tu peux l'annuler tant qu'elle attend. **Acceptée, elle devient une absence** au planning.",
      lien: "communication", montre: "Demander un congé",
      voir: ["conge-valider", "abs-poser"] },

    { id: "conge-valider", droit: ["conges_secteur", "conges_tous"], sansDroit: "Ta demande est décidée par un **chef de secteur de ta discipline** ou un **administrateur** — jamais par toi-même. Tu vois son état dans Le bureau aujourd'hui (en attente, acceptée, refusée) ; acceptée, elle devient une absence au planning.", selonDroit: { conges_tous: ["Toi, tu décides de **toutes** les demandes du bureau (sauf les tiennes).", ""], conges_secteur: ["Toi, tu décides des demandes **de ton secteur** (sauf les tiennes).", ""] },
      pages: ["communication", "absences", "accueil"], frequente: true,
      question: "Qui valide les congés et comment ?",
      aussi: ["accepter un congé", "refuser une demande de congé", "congés à valider"],
      mots: "valider conge accepter refuser decider",
      reponse: "Décide : un **chef de secteur de la même discipline** (« Valider les congés de son secteur ») ou un **administrateur** (« Valider tous les congés ») — **jamais pour soi-même**. Les demandes à valider s'affichent dans un encadré orange en tête de **Absences et congés** et de **Le bureau aujourd'hui**, avec une pastille sur l'accueil. Accepter crée l'absence ; on peut joindre une réponse.",
      },

    { id: "abs-poser", selonDroit: { absences_autrui: ["Ton groupe peut aussi poser les absences de tes collègues.", "Tu poses **tes propres** absences ; pour un collègue, c'est lui (ou quelqu'un qui a le droit « Poser les absences des autres »)."] },
      pages: ["absences", "communication"], frequente: true,
      question: "Comment poser une absence ?",
      aussi: ["ajouter une absence", "noter une maladie", "absent demain", "service militaire"],
      mots: "absence poser ajouter malade jour",
      reponse: "Bouton **Nouvelle absence** (Absences et congés) ou **Poser une absence** : la personne, du … au … (vide = un seul jour), le motif. Sur le calendrier, **clique sur un jour libre** de la ligne (ou glisse sur plusieurs jours) pour commencer l'absence ce jour-là ; un clic sur le nom ouvre une absence pour cette personne.\nTu poses les tiennes ; celles des autres demandent le droit « Poser les absences des autres ».",
      ici: { communication: "Bouton **Poser une absence** de la section Absences et congés. Pour des vacances à faire valider, utilise plutôt **Demander un congé**." },
      lien: "absences", montre: ["Nouvelle absence", "Poser une absence"],
      voir: ["conge-demander", "abs-modifier"] },

    { id: "abs-modifier", selonDroit: { absences_autrui: ["Tu peux modifier les absences de tout le monde.", "Tu ne modifies que **tes** absences."] },
      pages: ["absences"],
      question: "Comment modifier ou retirer une absence ?",
      aussi: ["supprimer une absence", "corriger une absence", "annuler une absence"],
      mots: "absence modifier retirer supprimer annuler",
      reponse: "Clic droit sur l'absence › **Retirer cette absence**, ou **Ses absences** : la fenêtre liste les périodes de la personne, à corriger ou retirer. Une demande de congé qui attend s'annule depuis Le bureau aujourd'hui." },

    { id: "abs-lire", pages: ["absences"], frequente: true,
      question: "Comment lire le calendrier des absences ?",
      aussi: ["calendrier des absences", "couleurs du calendrier", "nombre d'absents"],
      mots: "calendrier absence lire ligne couleur absents",
      reponse: "Une **ligne par personne**, une case par jour ; les barres sont ses absences. Les week-ends sont resserrés, les jours non travaillés grisés, la demi-journée à mi-hauteur. La dernière ligne compte **les absents de chaque jour**. Sous le calendrier, la liste **Périodes** reprend les absences de la période affichée. Une absence ne compte que les jours que la personne aurait travaillés.",
      voir: ["tb-periode", "bandeau-gauche"] },

    { id: "abs-voir-avenir", pages: ["communication"],
      question: "Pourquoi je ne vois pas les absences à venir ?",
      aussi: ["absences des 4 prochaines semaines"],
      mots: "absence avenir venir semaines voir droit",
      reponse: "Dans Le bureau aujourd'hui, les absences de l'équipe des **quatre prochaines semaines** demandent le droit **« Absences à venir »**. Celles en cours restent affichées pour tous ; la page Absences et congés montre tout le calendrier.",
      droit: "voir_absences_avenir" },

    /* ================================================================ équipe */

    { id: "eq-lire", selonDroit: { planning_equipe: ["", "La colonne de charge n'est pas montrée à ton groupe (droit « Planning de toute l'équipe »)."] },
      pages: ["equipe"], frequente: true,
      question: "Que montre la page Équipe ?",
      aussi: ["liste du personnel", "fiches de l'équipe", "téléphones des collègues"],
      mots: "equipe liste fiche telephone collegue",
      reponse: "Une ligne par personne, rangée par métier (ingénieurs, dessinateurs, administratifs) : groupes, succursale, secteur, **téléphones** (interne, ligne directe, natel — cliquables), **présence de la semaine** (LED), absences en cours ou à venir, et la **charge** de chacun si tu as le droit « Planning de toute l'équipe ».",
      voir: ["presence", "eq-modifier", "jours-travailles"] },

    { id: "eq-modifier", sansDroit: "Modifier la fiche d'un collègue demande le droit **« Modifier les fiches des membres »**, que ton groupe n'a pas. Signale la correction à un administrateur. Ta propre photo et tes téléphones se règlent dans **Mon profil**.",
      pages: ["equipe"],
      question: "Comment modifier la fiche d'un collègue ?",
      aussi: ["changer le métier d'un collègue", "changer le secteur", "corriger un nom"],
      mots: "modifier fiche membre metier secteur nom capacite",
      reponse: "Clic droit sur la personne › **Modifier la fiche** (droit « Modifier les fiches des membres ») : prénom, nom, métier, succursale, secteur, capacité et téléphones. Les **groupes, l'accès et l'adresse e-mail** restent à la console. Ta propre photo et tes téléphones se règlent dans **Mon profil**.",
      droit: "membres_modifier", voir: ["profil-quoi"] },

    { id: "eq-ajouter", admin: true, sansDroit: "Un nouveau collaborateur est inscrit par un **administrateur du site**, dans la console : sa fiche et son accès. Il reçoit ensuite un lien de première connexion.",
      pages: ["equipe", "console"],
      question: "Comment ajouter un nouveau collaborateur ?",
      aussi: ["nouvel employé", "créer un membre", "ajouter quelqu'un à l'outil", "donner un accès"],
      mots: "ajouter collaborateur nouvel membre creer acces utilisateur",
      reponse: "Dans la **Console › Utilisateurs**, bouton **Nouvel utilisateur** (administrateur du site) : sa fiche au planning (prénom, nom, métier, groupes, succursale, secteur, capacité) et, s'il se connecte, son accès (adresse proposée d'après son nom). Il reçoit ensuite un lien de première connexion.",
      lien: "console", montre: "Nouvel utilisateur" },

    { id: "jours-travailles", selonDroit: { absences_autrui: ["Ton groupe peut aussi régler les jours de tes collègues (clic droit › Jours travaillés).", "Ceux de tes collègues, tu les vois en consultation seulement."] },
      pages: ["equipe", "profil", "absences"], frequente: true,
      question: "Comment régler mes jours travaillés ?",
      aussi: ["temps partiel", "je ne travaille pas le mercredi", "demi-journée", "semaine type", "taux d'activité"],
      mots: "semainetype demijournee capacite mercredi partiel",
      reponse: "**Mes jours** (page Équipe) ou **Mon profil** : un bouton par jour, du lundi au vendredi, qui passe de **plein** à **½** à **non travaillé**. La capacité suit en direct. Le planning et le calendrier grisent tes jours off, et une absence ne compte que les jours que tu aurais travaillés.\nCeux d'un collègue : clic droit › Jours travaillés (droit « Poser les absences des autres »). Un changement de taux d'activité passe par la console.",
      ici: { profil: "Ici, la section **jours travaillés** : un bouton par jour, du lundi au vendredi, qui passe de **plein** à **½** à **non travaillé** ; la capacité suit en direct." },
      lien: "equipe", montre: ["Mes jours"] },

    { id: "capacite", pages: ["equipe", "tableau", "charge"],
      question: "C'est quoi la capacité ?",
      aussi: ["jours par semaine", "capacité d'une personne", "80 pour cent"],
      mots: "capacite jours semaine taux pourcent",
      reponse: "La **capacité** est le nombre de jours de travail planifiable par semaine. Elle se répartit sur la semaine type : un 80 % sans jour fixe fait 0,8 j chaque jour, un 80 % sans mercredi fait 1 j les quatre autres jours. Elle se règle dans la console, jamais au-dessus de la somme des jours travaillés.",
      voir: ["jours-travailles"] },

    /* ================================================================ annuaire */

    { id: "ann-creer", pages: ["annuaire"], frequente: true,
      question: "Comment ajouter un contact à l'annuaire ?",
      aussi: ["nouvelle fiche", "ajouter une entreprise", "ajouter un client"],
      mots: "annuaire contact creer fiche nouvelle",
      reponse: "Bouton **Nouvelle fiche** : nom, prénom, société, rôle, téléphone fixe, natel, e-mail, site, adresse (rue, NPA, localité, canton, pays) et observations. Il faut **au moins un nom ou une société**. Tout le bureau lit et tient l'annuaire, sans droit particulier.",
      lien: "annuaire", montre: "Nouvelle fiche" },

    { id: "ann-modifier", pages: ["annuaire"],
      question: "Comment modifier ou supprimer un contact ?",
      aussi: ["corriger une fiche", "supprimer une fiche de l'annuaire", "écrire à un contact"],
      mots: "annuaire modifier supprimer contact ecrire",
      reponse: "Clic droit sur la fiche › **Modifier**, **Supprimer**, ou **Écrire à …** (si elle a une adresse). Les numéros sont cliquables pour appeler, l'adresse s'ouvre dans Google Maps." },

    /* ================================================================ profil */

    { id: "profil-quoi", pages: ["profil"], frequente: true,
      question: "Que puis-je régler dans Mon profil ?",
      aussi: ["régler mon profil", "mes téléphones", "mon profil"],
      mots: "profil photo telephone motdepasse",
      reponse: "**Mon profil** (menu de ton compte) : ta **photo** (carrée de préférence, recadrée et réduite), tes **téléphones** (interne, ligne directe, natel), tes **jours travaillés** et ton **mot de passe**. Le nom, le métier et l'adresse se changent dans la console. En démonstration, la photo ne se change pas.",
      lien: "profil" },

    { id: "profil-photo", pages: ["profil"],
      question: "Comment changer ma photo ?",
      aussi: ["ajouter une photo", "mettre mon portrait", "retirer ma photo"],
      mots: "photo profil avatar image ajouter retirer",
      reponse: "Dans **Mon profil**, **Ajouter une photo** (ou Changer la photo) : choisis une image, elle est recadrée au centre en carré et réduite. **Retirer** revient aux initiales. Ta photo s'affiche dans la barre et les listes.",
      lien: "profil", montre: ["Ajouter une photo", "Changer la photo"] },

    /* ================================================================ console */

    { id: "console-quoi", admin: true, sansDroit: "La console est réservée aux **administrateurs du site** : bureaux, utilisateurs, groupes et droits. Pour un réglage (nouvelle personne, droit, succursale), adresse-toi à eux, par exemple par la boîte à idées.",
      pages: ["console"], frequente: true,
      question: "À quoi sert la console ?",
      aussi: ["administration de l'outil", "réglages du bureau"],
      mots: "console administration reglage section",
      reponse: "La console est réservée aux **administrateurs du site**. Quatre sections, à gauche :\n- **Bureaux** : bureaux, succursales et disciplines ;\n- **Utilisateurs** : fiches et accès, réglés sur la ligne (métier, groupes, succursale, accès) ;\n- **Groupes et droits** : la hiérarchie des groupes et le tableau des droits ;\n- **Mise en route** : réglages de la base.\nLa page **Activité** montre qui utilise l'outil.",
      lien: "console" },

    { id: "console-droits", admin: true, sansDroit: "Les droits se donnent par **groupe**, dans la console, par un administrateur du site. Si une page ou une action te manque, demande-lui.", perso: "groupes",
      pages: ["console"], frequente: true,
      question: "Comment donner un droit à un groupe ?",
      aussi: ["groupes et droits", "ouvrir une page à un groupe", "créer un groupe"],
      mots: "droit groupe cocher tableau hierarchie",
      reponse: "**Console › Groupes et droits** : les groupes en colonnes, les fonctions en lignes ; **coche la case** au croisement (enregistré au clic). Un groupe a aussi tout ce qu'ont les groupes placés sous lui et « Tout le monde » : ces cases sont cochées d'office, en demi-teinte. On y crée, renomme, range et supprime les groupes. Les droits se donnent à des groupes, jamais à une personne.",
      lien: "console", montre: "Groupes et droits" },

    { id: "console-acces", admin: true, sansDroit: "Suspendre un accès se fait dans la console, par un administrateur du site.",
      pages: ["console"],
      question: "Comment suspendre l'accès d'une personne ?",
      aussi: ["bloquer un compte", "quelqu'un qui part", "désactiver un utilisateur"],
      mots: "suspendre acces bloquer depart desactiver",
      reponse: "**Console › Utilisateurs** : la bascule d'accès sur la ligne de la personne l'ouvre ou la suspend. Sa fiche peut aussi passer inactive. La colonne de droite dit où elle en est (sans accès, invitée, dernière connexion)." },

    { id: "console-activite", admin: true, sansDroit: "Le suivi de l'activité est réservé à l'administrateur du site.",
      pages: ["console", "activite"],
      question: "Comment voir qui utilise l'outil ?",
      aussi: ["statistiques d'utilisation", "page activité", "temps passé"],
      mots: "activite statistique utilisation temps journal",
      reponse: "**Console › Activité** (lien sous les sections) : qui ouvre l'outil, quand, combien de temps et sur quelles pages ; en ce moment, chiffres clés, courbe du temps, pages, équipe et journal. Réservé à l'admin du site.",
      lien: "activite" },

    { id: "console-demo", admin: true,
      pages: ["console"],
      question: "Comment remettre la démo à zéro ?",
      aussi: ["réinitialiser la démo", "recharger le bureau de test"],
      mots: "reinitialiser demo bureau test zero",
      reponse: "**Console › Bureaux**, sur la ligne du bureau de test : **Réinitialiser la démo** efface les affaires, absences et l'annuaire de ce bureau et recharge le jeu de départ, dates recalées sur la semaine.",
      lien: "console" },

    { id: "console-voir-en-tant", admin: true, sansDroit: "« Voir l'outil en tant que » est réservé à l'administrateur du site et à la démonstration.",
      pages: ["console", "accueil"],
      question: "Comment voir l'outil comme un collaborateur ?",
      aussi: ["voir en tant que", "tester les droits d'un groupe", "changer de rôle"],
      mots: "voir role tester groupe collaborateur",
      reponse: "Menu de ton compte › **Voir l'outil en tant que** (admin du site) ou **Voir la démo en tant que** (démonstration) : choisis un rôle, la page se recharge avec ses droits. Une pastille « Vue … » le rappelle à côté de ton nom ; reprends « Admin du site » pour revenir.",
      montre: ".ab-compte-btn" },

    /* ================================================================ compléments */

    { id: "raccourcis", pages: ["taches", "tableau", "accueil"],
      question: "Quels sont les raccourcis clavier ?",
      aussi: ["touches du clavier", "raccourcis", "aller plus vite au clavier"],
      mots: "raccourci clavier touche entree echap f1",
      reponse: "- **Ctrl+K** (⌘K) : la recherche de la barre, qui trouve et agit partout ;\n- **/** : la recherche de la page ;\n- **Entrée** : enregistre une fenêtre (sauf dans une note, où elle va à la ligne) ; dans une recherche, ouvre le seul résultat ;\n- **Maj+Entrée** : à la ligne (tchat), ou formulaire complet depuis Ctrl+K ;\n- **Échap** : ferme la fenêtre ouverte ;\n- **F1** : ouvre ou ferme l'aide." },

    { id: "annuler-action", pages: ["taches", "tableau", "accueil"],
      question: "Comment annuler ce que je viens de faire ?",
      aussi: ["revenir en arrière", "je me suis trompé", "annuler un décalage", "défaire"],
      mots: "annuler arriere trompe defaire erreur",
      reponse: "Après un geste rapide (décaler ou étirer une barre, terminer d'un pouce), le message en bas de l'écran propose **Annuler** pendant quelques secondes. Sinon, rouvre la tâche et remets la valeur d'avant. Les suppressions demandent une confirmation et ne se rattrapent pas." },

    { id: "tache-lien", pages: ["taches"],
      question: "Comment envoyer une tâche à un collègue ?",
      aussi: ["partager une tâche", "lien vers une tâche", "copier l'adresse d'une tâche"],
      mots: "partager lien adresse envoyer tache url",
      reponse: "Ouvre la tâche dans son formulaire : l'adresse de la page porte **?tache=…**. Copie cette adresse et envoie-la : chez ton collègue, la page Tâches s'ouvre directement sur ce formulaire. Le tchat du bureau rend les liens cliquables." },

    { id: "tache-note", pages: ["taches", "tableau"],
      question: "Où écrire une note sur une tâche ?",
      aussi: ["commentaire sur une tâche", "hypothèses en attente", "ajouter une remarque"],
      mots: "note commentaire remarque tache hypothese",
      reponse: "Le champ **Note** de la fiche rapide (clic sur la ligne) ou du formulaire : hypothèses, éléments en attente… Dans la note, **Entrée** va à la ligne. La note est cherchée par la recherche de la page Tâches." },

    { id: "tache-avancement", pages: ["taches", "tableau"],
      question: "À quoi sert l'avancement d'une tâche ?",
      aussi: ["pourcentage d'une tâche", "avancement en pour cent"],
      mots: "avancement pourcentage tache",
      reponse: "L'**avancement (%)** de la tâche se règle par pas de 5 dans la fiche rapide ou le formulaire. Il passe à 100 quand toutes les parts sont terminées. Ne pas confondre avec l'**avancement d'une affaire**, saisi phase par phase dans la fenêtre d'avancement.",
      voir: ["mandat-avancement"] },

    { id: "tache-rien-semaine", pages: ["taches"],
      question: "Que veut dire « Rien à faire ni à commencer cette semaine » ?",
      aussi: ["la semaine est vide", "aucune tâche cette semaine"],
      mots: "rien faire commencer semaine vide",
      reponse: "Pour la semaine en cours, aucune tâche de la liste filtrée n'est en cours ni à commencer. Les suivantes apparaissent dans leurs semaines plus bas. Vérifie aussi le bandeau : un filtre (personne, affaire, statut) restreint peut-être la liste." },

    { id: "tache-aucune", pages: ["taches", "affaires", "annuaire", "equipe"],
      question: "Pourquoi la liste est vide ?",
      aussi: ["je ne trouve plus rien", "aucun résultat", "tout a disparu"],
      mots: "vide aucun resultat disparu liste rien",
      reponse: "Un filtre est sans doute actif : le champ de recherche, une entrée du bandeau de gauche (personne, succursale, secteur, affaire, statut) ou « Masquer les terminées ». Sur Tâches, le message de la liste vide propose **Retirer les filtres**. Si le doute persiste : Ctrl+F5." },

    { id: "tb-grise", pages: ["tableau", "absences"],
      question: "Que veulent dire les jours grisés ?",
      aussi: ["cases grises", "colonne grise", "jour hachuré", "demi-hauteur"],
      mots: "gris grise jour off week end ferie hachure demijournee",
      reponse: "Le **week-end** et les **jours fériés** du canton sont grisés pour tous. Un **jour non travaillé** de la personne (sa semaine type) est grisé plus fort sur sa ligne, la **demi-journée** à mi-hauteur. La légende sous le planning les rappelle.",
      voir: ["jours-travailles"] },

    { id: "tb-barre-coche", pages: ["tableau"],
      question: "Pourquoi une barre est pâle avec une coche ?",
      aussi: ["barre en demi-teinte", "barre éteinte", "part terminée au planning"],
      mots: "barre pale coche demi teinte eteinte terminee",
      reponse: "C'est une **part terminée** : la barre reste dessinée chez la personne qui l'a rendue, en demi-teinte avec une coche, mais ne pèse plus sur sa charge. L'autre métier garde sa barre pleine tant qu'il n'a pas fini. Une tâche entièrement terminée s'éteint aussi.",
      voir: ["tache-parts"] },

    { id: "tb-chiffres", pages: ["tableau"],
      question: "Que veulent dire les chiffres en haut du tableau de bord ?",
      aussi: ["taux d'occupation", "jours affectés", "jours disponibles", "tâches en retard"],
      mots: "chiffre taux occupation jours affectes disponibles retard",
      reponse: "Sur ce qui est affiché (filtres et recherche compris) :\n- **Jours affectés** : la charge planifiée ;\n- **Jours disponibles** : la capacité des personnes (jours travaillés, absences et fériés déduits) ;\n- **Taux d'occupation** : l'un sur l'autre, en rouge au-delà de 100 % ;\n- **Tâches en retard**." },

    { id: "tb-fonction", pages: ["tableau", "charge"],
      question: "Comment voir seulement les ingénieurs ou les dessinateurs ?",
      aussi: ["filtrer par métier", "seulement le dessin", "seulement le calcul"],
      mots: "ingenieur dessinateur metier fonction filtrer seulement",
      reponse: "Dans le bandeau de gauche, l'interrupteur **Tous / Ingénieurs / Dessinateurs**.",
      montre: ["#bd-bandeau"] },

    { id: "ferie", pages: ["absences", "tableau", "taches"],
      question: "Comment sont comptés les jours fériés ?",
      aussi: ["jours fériés du canton", "férié pas pris en compte", "Ascension"],
      mots: "ferie canton jour",
      reponse: "Les jours fériés suivent le **canton** réglé pour le bureau (menu du compte › Données). Ce jour-là, personne n'a de capacité : les tâches se planifient autour, et une absence n'y compte pas.",
      voir: ["donnees-export"] },

    { id: "abs-masquer", pages: ["absences"],
      question: "Comment n'afficher que les personnes absentes ?",
      aussi: ["masquer qui n'a rien", "cacher les présents"],
      mots: "masquer absent seulement rien present",
      reponse: "Dans le bandeau de gauche, la case **Masquer qui n'a rien** : le calendrier ne garde que les personnes qui ont une absence dans la période affichée.",
      lien: "absences", montre: "Masquer qui" },

    { id: "abs-collegue", pages: ["equipe", "absences"],
      question: "Comment voir les absences d'un collègue ?",
      aussi: ["quand est-il en vacances", "absences d'une personne"],
      mots: "absence collegue personne quand vacances",
      reponse: "Sur Équipe : clic droit sur la personne › **Absences** (ses absences en cours et à venir sont aussi sur sa ligne). Sur Absences et congés, cherche son nom : sa ligne du calendrier montre tout.",
      lien: "absences" },

    { id: "conge-suivre", pages: ["communication"],
      question: "Où en est ma demande de congé ?",
      aussi: ["ma demande est-elle acceptée", "annuler ma demande de congé", "mes demandes"],
      mots: "demande conge etat accepte refuse annuler mes",
      reponse: "Dans Le bureau aujourd'hui, la section des demandes de congé montre **tes demandes** et leur état : en attente, acceptée, refusée (avec la réponse éventuelle) ou annulée. Tant qu'elle attend, tu peux l'**annuler**. Acceptée, elle apparaît comme absence dans le calendrier.",
      lien: "communication", montre: ["#conges"] },

    { id: "rdv-miens", pages: ["communication"],
      question: "Comment ne voir que mes rendez-vous ?",
      aussi: ["filtrer l'agenda", "seulement les miens", "agenda de la semaine"],
      mots: "rendezvous agenda miens seulement filtrer semaine",
      reponse: "L'**agenda** de Le bureau aujourd'hui montre la semaine en colonnes avec les participants ; la case **seulement les miens** ne garde que ceux où tu es. Les flèches ◀ ▶ et **Cette semaine** changent de semaine. Un clic sur un rendez-vous ouvre son formulaire.",
      lien: "communication", montre: ["Agenda"] },

    { id: "tchat-moderer", selonDroit: { tchat_moderer: ["Toi, tu peux aussi retirer les messages des autres.", ""] },
      pages: ["communication"],
      question: "Comment retirer un message du tchat ?",
      aussi: ["supprimer un message", "effacer un message du tchat"],
      mots: "retirer supprimer message tchat moderer",
      reponse: "La **croix** d'un message le retire, après confirmation. Chacun retire **ses** messages ; ceux des autres demandent le droit **« Retirer les messages des autres »**.",
      },

    { id: "news-archives", selonDroit: { news_archiver: ["", "Remettre une news en ligne n'est pas ouvert à ton groupe."] },
      pages: ["communication"],
      question: "Où retrouver une ancienne news ?",
      aussi: ["news archivées", "archives des news"],
      mots: "news archive ancienne retrouver",
      reponse: "Dans News du bureau, le bouton **Archives (N)** affiche les news retirées de la une ; **← News en ligne** revient. Remettre une news en ligne demande le droit « Archiver les news ».",
      lien: "communication", montre: ["Archives", "News du bureau"] },

    { id: "comm-chiffres", pages: ["communication"],
      question: "Que montrent les chiffres du bureau aujourd'hui ?",
      aussi: ["chiffres clés du jour", "la semaine du bureau"],
      mots: "chiffre cle jour semaine bureau",
      reponse: "En haut de la page, quatre **chiffres clés** du jour pour le bureau, puis **qui manque** (liste qui défile), les **rendez-vous du jour** et un résumé de la semaine. Tout se met à jour en direct." },

    { id: "eq-appeler", pages: ["equipe", "annuaire"],
      question: "Comment appeler un collègue ou un contact ?",
      aussi: ["numéro de téléphone", "numéro interne", "natel d'un collègue"],
      mots: "telephone appeler numero natel interne",
      reponse: "Les numéros d'**Équipe** (interne, ligne directe, natel) et de l'**Annuaire** sont cliquables : sur téléphone, un appui compose le numéro. Chacun tient ses propres numéros dans **Mon profil**.",
      voir: ["profil-quoi"] },

    { id: "eq-affaires", pages: ["equipe"],
      question: "Comment voir les affaires d'un collègue ?",
      aussi: ["sur quoi travaille-t-il", "ses affaires"],
      mots: "affaire collegue travaille ses",
      reponse: "Clic droit sur la personne (Équipe, Absences, Tâches, tableau de bord, charge…) › **Ses affaires** (page Affaires réduite à ses affaires) ou **Ses tâches**. Le tableau de charge montre aussi sur quoi elle est occupée, semaine par semaine." },

    { id: "groupes-quoi", perso: "groupes",
      pages: ["equipe", "console", "accueil"],
      question: "Que veulent dire les groupes (chef de secteur, chef de projet…) ?",
      aussi: ["administrateur chef de secteur chef de projet", "mon rôle", "à quoi sert mon groupe"],
      mots: "groupe chefsecteur chefprojet administrateur role",
      reponse: "Les **groupes** portent les droits : « Tout le monde » (le socle), puis par exemple chef de projet, chef de secteur, administrateur — chacun a aussi les droits des groupes placés sous lui. Ils sont libres et se règlent dans la console. Une personne peut en cumuler plusieurs ; ils s'affichent en étiquettes sur Équipe.",
      voir: ["console-droits", "droits-page-absente"] },

    { id: "secteur-quoi", pages: ["equipe", "facturation", "accueil"],
      question: "C'est quoi un secteur et une succursale ?",
      aussi: ["différence secteur succursale", "discipline"],
      mots: "secteur succursale discipline difference",
      reponse: "La **succursale** est le lieu (un bureau du réseau), le **secteur** est la discipline (structure, géotechnique, environnement…). Chaque personne a les deux ; une affaire a sa succursale et ses secteurs. Le bandeau de gauche range les équipes par succursale, puis par secteur." },

    { id: "aff-numero", pages: ["affaires"],
      question: "Le numéro d'affaire est-il obligatoire ?",
      aussi: ["numéro pas encore attribué", "échéance générale"],
      mots: "numero affaire obligatoire attribue echeance generale",
      reponse: "Non : le **numéro** est facultatif, à ajouter quand il est attribué. L'**échéance générale** aussi (simple repère d'ensemble). Seul le **libellé** est vraiment nécessaire." },

    { id: "aff-terminees", pages: ["affaires"],
      question: "Comment retrouver une affaire terminée ?",
      aussi: ["affaire disparue", "voir les affaires terminées", "réactiver une affaire"],
      mots: "affaire terminee disparue retrouver reactiver",
      reponse: "Coche **Voir les affaires terminées** dans le bandeau de gauche. Pour la réactiver, modifie-la et remets son statut sur **Active**.",
      lien: "affaires", montre: "Voir les affaires terminées" },

    { id: "carte-absente", pages: ["carte"],
      question: "Pourquoi une affaire n'est pas sur la carte ?",
      aussi: ["adresse introuvable", "affaire manquante sur la carte"],
      mots: "carte absente manque adresse introuvable",
      reponse: "La carte ne place que les affaires **qui ont une adresse** (suisse). L'adresse exacte est cherchée d'abord, sinon le NPA ou la localité. Complète l'adresse dans la fiche de l'affaire, puis rouvre la carte." },

    { id: "ch-libre", pages: ["charge"],
      question: "Que veut dire « Libre dès » ?",
      aussi: ["quand sera-t-il disponible", "première semaine libre"],
      mots: "libre disponible quand semaine",
      reponse: "**Libre dès** donne, pour chaque personne, la **première semaine où sa charge passe sous 70 %** : le bon moment pour lui confier du travail." },

    { id: "ch-hachure", pages: ["charge"],
      question: "Pourquoi une case est hachurée ?",
      aussi: ["case rayée", "semaine hachurée"],
      mots: "hachure rayee case semaine",
      reponse: "La personne n'a **aucun jour travaillé** cette semaine-là (absence, fériés, jours off) : pas de capacité, donc pas de taux." },

    { id: "veille-criteres", pages: ["veille"],
      question: "Pourquoi un appel d'offres manque dans la veille ?",
      aussi: ["publication manquante", "régler la veille", "changer les critères"],
      mots: "veille manque critere regler publication",
      reponse: "La veille ne garde que GE, VD et VS, les mandats d'études et concours, et les codes ou mots-clés de structure et génie civil (un code d'ingénierie générale seul ne suffit pas). Les critères se règlent par l'administrateur du site ; écris-lui par la boîte à idées avec l'exemple manquant. Un AO repéré ailleurs se crée à la main : **Nouvel appel d'offres**.",
      voir: ["ao-creer"] },

    { id: "fa-cache", selonDroit: { page_facturation: ["Toi, tu as la page Facturation : si une valeur manque, c'est qu'aucune saisie n'a encore été faite.", ""] },
      pages: ["facturation", "affaires"],
      question: "Pourquoi je ne vois pas les pourcentages facturés ?",
      aussi: ["facturation invisible", "seulement l'avancement"],
      mots: "facture voir invisible pourcentage droit",
      reponse: "Le facturé n'est visible qu'avec la page **Facturation** ou le droit **« Saisir la facturation »**. Sans eux, la fenêtre d'avancement ne montre que l'avancement.",
      droit: "page_facturation" },

    { id: "console-bureau", admin: true, sansDroit: "Succursales et disciplines se créent dans la console, par un administrateur du site : demande-lui.",
      pages: ["console"],
      question: "Comment ajouter une succursale ou une discipline ?",
      aussi: ["nouvelle succursale", "nouveau secteur", "créer un bureau"],
      mots: "succursale discipline secteur bureau creer ajouter",
      reponse: "**Console › Bureaux** : ouvre le bureau ; son formulaire tient les listes de **succursales** et de **disciplines** (une discipline peut être ouverte dans certaines succursales seulement). **Nouveau bureau** en crée un autre. Une succursale retirée l'est aussi des affaires (la console prévient).",
      lien: "console", montre: "Bureaux" },

    { id: "cx-pas-de-mail", pages: ["connexion"],
      question: "Je ne reçois pas le courriel de connexion",
      aussi: ["pas de lien reçu", "le lien ne marche pas", "lien expiré"],
      mots: "courriel recu lien expire spam",
      reponse: "Regarde dans les **indésirables**. Le lien n'est envoyé qu'à une adresse **inscrite par un administrateur** ; vérifie l'orthographe. Un lien sert une fois : redemande-en un avec **Mot de passe oublié ou première connexion**. Si rien n'arrive, contacte un administrateur.",
      montre: "Mot de passe oublié" },

    { id: "fenetres", pages: ["taches", "affaires"],
      question: "Comment fermer une fenêtre ou enregistrer ?",
      aussi: ["la fenêtre ne se ferme pas", "bouton enregistrer"],
      mots: "fenetre fermer enregistrer echap entree",
      reponse: "**Enregistrer** (ou **Entrée** dans un champ) valide, **Annuler** ou **Échap** ferme sans rien changer. Un message en bas de l'écran confirme l'enregistrement, ou dit ce qui manque (« Saisis l'échéance. »)." },

    /* ================================================================ petit dialogue */

    { id: "dlg-bonjour", pages: [], cachee: true,
      question: "Bonjour",
      aussi: ["salut", "hello", "coucou"],
      mots: "bonjour salut hello coucou",
      reponse: "Bonjour, c'est Charlie ! Pose-moi ta question sur l'outil : une page, un bouton, une règle…" },

    { id: "dlg-merci", pages: [], cachee: true,
      question: "Merci",
      aussi: ["merci beaucoup", "super merci", "top"],
      mots: "merci super top parfait genial",
      reponse: "Avec plaisir ! Je reste là, en bas à droite (ou **F1**)." }
  ];

  global.AideFiches = { MAJ: MAJ, fiches: fiches, synonymes: synonymes, expressions: expressions };
})(window);
