/* Raccordement de l'outil de planification à sa base de données.
   ---------------------------------------------------------------------------
   La clé ci-dessous est la clé PUBLIABLE du projet Supabase : elle est faite
   pour vivre dans le code d'une page web, y compris dans un dépôt public.
   Elle n'ouvre aucun accès par elle-même — la sécurité vient de la RLS et de
   la liste blanche d'adresses (table « acces »), vérifiées côté serveur.
   La clé SECRÈTE, elle, ne doit jamais apparaître ici.

   Vider `url` fait retomber l'outil en mode local (données dans le navigateur).
   --------------------------------------------------------------------------- */
window.PLANIF_CONFIG = {
  supabase: {
    url: "https://hxhjkdfnoygrlbdhjkwc.supabase.co",
    cle: "sb_publishable_33G_BjGlKGUBhSVIc_QUmQ_QDKC64vA"
  }
};
