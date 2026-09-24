/* Raccordement de Buro à sa base de données Supabase.
   ---------------------------------------------------------------------------
   La clé ci-dessous est la clé PUBLIABLE du projet : elle est faite pour vivre
   dans le code d'une page web, y compris dans un dépôt public. Elle n'ouvre
   rien par elle-même : la sécurité vient de la RLS et de la liste des membres
   (table « members »), vérifiées côté serveur. La clé SECRÈTE ne va jamais ici.

   url vide = mode démonstration : données fictives rangées dans le navigateur,
   sans connexion, avec le sélecteur d'utilisateur du prototype.
   --------------------------------------------------------------------------- */
window.BURO_CONFIG = {
  supabase: {
    url: "",
    cle: ""
  }
};
