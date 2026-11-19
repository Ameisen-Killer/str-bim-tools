/* Lecteur de présentation : lit presentation.mp3 et fait défiler la page en continu, bloc par bloc.
   Prérequis : chaque bloc à suivre porte l'attribut data-lecture="0", "1", "2"… dans l'ordre de lecture
   (autant de blocs que d'entrées dans timeline.json). */
(function(){
  var base=(document.currentScript&&document.currentScript.src||"").replace(/[^\/]*$/,"");
  fetch(base+"timeline.json?v=7").then(function(r){return r.json()}).then(function(TL){
    var d=document.createElement("div"); d.innerHTML="<div class=\"lecteur\" id=\"lecteur\" role=\"region\" aria-label=\"Lecture audio\"><button id=\"lp\" aria-label=\"Lire / pause\">\u25b6</button><div class=\"info\"><div class=\"titre\" id=\"lt\">Lancer la lecture</div><div class=\"barre-p\"><i id=\"lb\"></i></div></div><label title=\"D\u00e9filement automatique\"><input type=\"checkbox\" id=\"la\" checked><span>D\u00e9filement auto</span></label></div><audio id=\"aud\" preload=\"auto\"></audio>"; while(d.firstChild) document.body.appendChild(d.firstChild);
    document.getElementById("aud").src=base+"presentation.mp3?v=8";
    (function(){

  var N=TL.length, segs=[].slice.call(document.querySelectorAll("[data-lecture]"));
  var aud=document.getElementById("aud"), bp=document.getElementById("lp"), bt=document.getElementById("lt"), bb=document.getElementById("lb"), auto=document.getElementById("la");
  var actif=-1, veut=false, manuel=false, minuteur=null;
  var noms=segs.map(function(el,i){var t=el.querySelector("h1,h2,h3,.choc"); return (t?t.textContent.replace(/\s+/g," ").trim():"Bloc "+(i+1)).slice(0,60)});
  function haut(el){return el.getBoundingClientRect().top+scrollY}
  function courant(){
    var y=innerHeight*.4, best=0, bd=1e9;
    for(var i=0;i<segs.length;i++){var r=segs[i].getBoundingClientRect(); if(r.top<=y&&r.bottom>=y) return i; var d=Math.min(Math.abs(r.top-y),Math.abs(r.bottom-y)); if(d<bd){bd=d;best=i}}
    return best;
  }
  function visee(i,p){
    var el=segs[i], t=haut(el), h=el.offsetHeight, vh=innerHeight, m=vh*.14;
    var d=t-m, f=t+h-(vh-m);
    var y = f>d ? d+(f-d)*p : t+h/2-vh/2;
    return Math.max(0,Math.min(y,document.documentElement.scrollHeight-vh));
  }
  function seg(t){for(var i=0;i<N;i++){if(t<TL[i][1]) return i} return N-1}
  function etiquette(i){
    if(i===actif) return;
    if(actif>=0) segs[actif].classList.remove("lu-actif");
    actif=i; segs[i].classList.add("lu-actif"); bt.textContent=(i+1)+"/"+N+" · "+noms[i];
  }
  var yl=null;
  function boucle(){
    requestAnimationFrame(boucle);
    if(aud.paused) {yl=null; return}
    var t=aud.currentTime, i=seg(t); etiquette(i);
    if(aud.duration) bb.style.width=(100*t/aud.duration)+"%";
    if(manuel||!auto.checked) return;
    var s=TL[i][0], e=TL[i][1], p=Math.max(0,Math.min(1,(t-s)/(e-s)));
    var q0=Math.max(0,Math.min(1,(p-.08)/.77)); var y=visee(i,q0*q0*(3-2*q0));
    // fin de bloc : on glisse en continu vers le début du suivant, sans à-coup
    if(i<N-1 && p>.85){var q=(p-.85)/.15; q=q*q*(3-2*q); y=y+(visee(i+1,0)-y)*q}
    if(yl===null) yl=scrollY;
    yl+= (y-yl)*.12; scrollTo(0,yl);
  }
  boucle();
  var boite=document.getElementById("lecteur"), repli=null;
  function maj(){
    bp.textContent=aud.paused?"▶":"❚❚";
    // bandeau replié pendant la lecture (19.11.2026), un instant après le départ
    clearTimeout(repli);
    if(aud.paused) boite.classList.remove("replie");
    else repli=setTimeout(function(){boite.classList.add("replie")},1400);
  }
  // au toucher (téléphone), le bandeau replié se rouvre quelques secondes
  boite.addEventListener("touchstart",function(){ if(aud.paused) return; boite.classList.remove("replie"); clearTimeout(repli); repli=setTimeout(function(){ if(!aud.paused) boite.classList.add("replie") },3500) },{passive:true});
  bp.onclick=function(){
    if(!aud.paused){aud.pause();maj();return}
    manuel=false; auto.checked=true;
    var i=courant(); if(Math.abs(seg(aud.currentTime)-i)>0 && !aud.ended) aud.currentTime=TL[i][0]+.01;
    if(aud.ended) aud.currentTime=TL[i][0]+.01;
    var p=aud.play(); if(p&&p.catch) p.catch(function(){}); maj();
  };
  aud.onplay=aud.onpause=aud.onended=maj;
  function main(){ if(!aud.paused&&auto.checked){manuel=true;auto.checked=false} }
  addEventListener("wheel",main,{passive:true}); addEventListener("touchmove",main,{passive:true});
  addEventListener("keydown",function(e){ if(["ArrowDown","ArrowUp","PageDown","PageUp"," "].indexOf(e.key)>=0&&e.target===document.body) main() });
  // en manuel : la voix suit ce qu'on fait défiler
  addEventListener("scroll",function(){
    if(aud.paused||!manuel) return; clearTimeout(minuteur);
    minuteur=setTimeout(function(){var i=courant(); if(i!==seg(aud.currentTime)) aud.currentTime=TL[i][0]+.01},450);
  },{passive:true});
  auto.onchange=function(){ if(auto.checked){manuel=false; yl=null; if(!aud.paused){var i=courant(); aud.currentTime=TL[i][0]+.01}} };
    })();
  });
})();
