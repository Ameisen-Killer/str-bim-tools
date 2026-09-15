// Menu et pied de page communs à toutes les pages de str-bim-tools.com
// - Pour ajouter une page au menu : l'ajouter à PAGES.
// - À chaque publication : mettre MISE_A_JOUR à la date du jour (AAAA-MM-JJ).
(function(){
  "use strict";
  var MISE_A_JOUR = "2026-09-14";

  var PAGES = [
    {href:"/", nom:"Accueil", desc:"STR Bim Tools"},
    {href:"/can241/", nom:"CAN 241", desc:"Métré béton coulé sur place"},
    {href:"/a-propos/", nom:"À propos", desc:"de Tony Varin"},
    {href:"/mentions-legales/", nom:"Mentions légales", desc:"Éditeur, hébergeur, données"}
  ];

  // ---------- Pied de page : date de mise à jour ----------
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(MISE_A_JOUR);
  [].forEach.call(document.querySelectorAll("[data-maj]"), function(el){
    if (m) el.textContent = m[3] + "." + m[2] + "." + m[1];
  });

  // ---------- Adresse de contact protégée des robots de collecte ----------
  // L'adresse n'apparaît jamais en clair dans le HTML : elle est stockée à l'envers
  // dans data-courriel et reconstituée ici. Sans JavaScript, le texte de repli
  // « contact (arobase) str-bim-tools.com » reste lisible par un humain.
  [].forEach.call(document.querySelectorAll("a[data-courriel]"), function(a){
    var adresse = a.getAttribute("data-courriel").split("").reverse().join("").replace("|", "@");
    var long = a.querySelector(".long");   // pied de page : adresse complète sur ordinateur, « Contact » sur smartphone
    if (long){ long.textContent = adresse; a.setAttribute("aria-label", "Écrire à " + adresse); }
    else a.textContent = adresse;
    a.href = "mai" + "lto:" + adresse;
    a.removeAttribute("data-courriel");
  });

  // ---------- Menu ----------
  var bouton = document.querySelector(".menu-btn");
  if (!bouton) return;

  var chemin = location.pathname.replace(/index\.html$/, "");
  if (chemin.charAt(chemin.length - 1) !== "/") chemin += "/";
  var accueil = chemin === "/";

  var nav = document.createElement("nav");
  nav.className = "menu"; nav.id = "menu"; nav.setAttribute("aria-label", "Menu principal");
  nav.hidden = true;
  var ol = document.createElement("ol");
  var n = 0;
  PAGES.forEach(function(p){
    if (accueil && p.href === "/") return;   // pas de lien « Accueil » depuis l'accueil
    n++;
    var li = document.createElement("li");
    li.style.setProperty("--d", (.38 + n*.09).toFixed(2) + "s");
    var a = document.createElement("a"); a.href = p.href;
    var ici = chemin === p.href;
    if (ici) a.setAttribute("aria-current", "page");
    var num = document.createElement("span"); num.className = "num"; num.textContent = ("0" + n).slice(-2);
    var nom = document.createElement("span"); nom.className = "nom"; nom.textContent = p.nom;
    var desc = document.createElement("span"); desc.className = "desc" + (ici ? " ici" : ""); desc.textContent = ici ? "Vous êtes ici" : p.desc;
    a.appendChild(num); a.appendChild(nom); a.appendChild(desc);
    li.appendChild(a); ol.appendChild(li);
  });
  nav.appendChild(ol);
  var pied = document.createElement("div"); pied.className = "menu-pied";
  pied.innerHTML = "<span>str-bim-tools.com</span><span>by Tony Varin</span>";
  nav.appendChild(pied);
  var trait = document.createElement("div"); trait.className = "menu-trait"; trait.setAttribute("aria-hidden", "true");
  document.body.appendChild(nav); document.body.appendChild(trait);

  bouton.setAttribute("aria-controls", "menu");
  bouton.setAttribute("aria-expanded", "false");
  var racine = document.documentElement, ouvert = false, masquage = null;

  function basculer(etat){
    if (etat === ouvert) return;
    ouvert = etat;
    clearTimeout(masquage);
    if (ouvert){
      nav.hidden = false; void nav.offsetWidth;   // rendu avant la transition d'ouverture
    } else {
      masquage = setTimeout(function(){ nav.hidden = true }, 950);   // hors de la navigation clavier une fois replié
    }
    racine.classList.toggle("menu-ouvert", ouvert);
    bouton.setAttribute("aria-expanded", String(ouvert));
    racine.style.overflow = ouvert ? "hidden" : "";
    trait.classList.remove("descend", "monte"); void trait.offsetWidth;
    trait.classList.add(ouvert ? "descend" : "monte");
    if (ouvert){ var premier = nav.querySelector("a"); if (premier) setTimeout(function(){ premier.focus({preventScroll:true}) }, 500); }
    else bouton.focus({preventScroll:true});
  }
  bouton.addEventListener("click", function(){ basculer(!ouvert) });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape" && ouvert) basculer(false) });
  nav.addEventListener("click", function(e){
    var a = e.target.closest("a");
    if (a && a.getAttribute("aria-current") === "page"){ e.preventDefault(); basculer(false); }
  });
})();
