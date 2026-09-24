/* Buro — Amicale de Douvaine : l'application.
   ---------------------------------------------------------------------------
   Reprise du prototype V5 (mêmes écrans, mêmes règles, même charte), branchée
   sur la couche de données de donnees.js : démonstration dans le navigateur,
   ou base Supabase partagée après connexion.
   Règles d'accès (doublées côté base par la RLS, voir kevin/base-supabase.sql) :
     - le Président (et le super admin) crée et modifie les projets ;
     - un projet privé n'est vu que par ses personnes autorisées, son
       responsable, son adjoint et le Président ;
     - l'attributaire déclare une tâche faite, le responsable ou l'adjoint la
       valide ou la renvoie ;
     - les bilans d'événement sont réservés au Président ;
     - le Président et le super admin gèrent les membres (qui peut se connecter).
   --------------------------------------------------------------------------- */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const isoDate=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const fmt=d=>d?new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${String(d).slice(0,10)}T12:00:00`)):'—';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const S=()=>Store.state;
const EMOJIS=['👍','🔥','💡','❤️'];

let route='dashboard';
let routeParam=null;
let calendarCursor=new Date();
let showArchivedTasks=false;
let started=false;

/* ------------------------------------------------------------ outils */

function me(){return S().members.find(u=>u.id===Store.meId)||{id:null,name:'—',role:'bureau'}}
function user(id){return S().members.find(u=>u.id===id)}
function activeMembers(){return S().members.filter(u=>u.active)}
function roleLabel(r){return {superadmin:'Super admin',president:'Président',etat_major:'État-major',bureau:'Membre du bureau'}[r]||r}
function isPresident(u=me()){return u.role==='president'||u.role==='superadmin'}
function isAdmin(u=me()){return isPresident(u)}
function project(id){return S().projects.find(p=>p.id===id)}
function canSeeProject(p){const u=me();return !p.is_private||isPresident(u)||(p.visible_to||[]).includes(u.id)||p.manager_id===u.id||p.deputy_id===u.id}
function visibleProjects(){return S().projects.filter(canSeeProject)}
function projectTasks(pid){return S().tasks.filter(t=>t.project_id===pid)}
function progress(pid){const ts=projectTasks(pid);return ts.length?Math.round(ts.filter(t=>t.status==='done').length/ts.length*100):0}
function isManager(p,u=me()){return !!p&&(isPresident(u)||p.manager_id===u.id||p.deputy_id===u.id)}
function taskTone(t){if(t.status==='done')return 'ok'; if(t.status==='pending_validation')return 'warn'; return t.due<isoDate()?'danger':''}
function statusLabel(s){return {todo:'À faire',pending_validation:'À valider',done:'Validée'}[s]||s}
function material(id){return S().materials.find(x=>x.id===id)}
function euros(n){return Number(n||0).toLocaleString('fr-FR')}
function fmtAt(ts){if(!ts)return '';const d=new Date(ts);const h=new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(d);return isoDate(d)===isoDate()?h:`${fmt(isoDate(d))} ${h}`}
let toastTimer=null;
function toast(msg){const e=$('#toast');e.textContent=msg;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),msg.length>60?4500:2000)}
function nav(to,param=null){route=to;routeParam=param;render();window.scrollTo({top:0,behavior:'smooth'})}
function visibleTasks(){const ids=new Set(visibleProjects().map(p=>p.id));return S().tasks.filter(t=>ids.has(t.project_id))}
function taskCounts(){
  const vis=visibleTasks();
  const mine=vis.filter(t=>(t.assignee_ids||[]).includes(me().id)&&t.status!=='done');
  const pending=vis.filter(t=>t.status==='pending_validation'&&isManager(project(t.project_id)));
  return {mine, pending, overdue:mine.filter(t=>t.due<isoDate())};
}
/* Écriture : l'écran est redessiné tout de suite ; un refus de la base est affiché et l'écran réaligné */
function run(p,ok){render();if(ok)toast(ok);return p.then(()=>true,err=>{render();toast(err.message||'Enregistrement impossible.');return false})}
function shell(title,subtitle,content,actions=''){return `<section class="hero"><div class="title-stack"><div><div class="eyebrow">Buro · ${esc(roleLabel(me().role))}</div><h1>${esc(title)}</h1><p>${esc(subtitle||'')}</p><div class="retro-line"></div></div></div>${actions?`<div class="hero-actions">${actions}</div>`:''}</section>${content}`}

/* ------------------------------------------------------------ tâches */

function projectCard(p){return `<article class="card project-card" onclick="nav('project','${p.id}')"><div class="row"><h3>${esc(p.name)}</h3><span class="badge">${progress(p.id)}%</span></div><p class="muted">${esc(p.description||'')}</p><div class="progress"><i style="width:${progress(p.id)}%"></i></div><div class="meta"><span class="chip">Resp. ${esc(user(p.manager_id)?.name||'—')}</span>${p.deputy_id?`<span class="chip">Adj. ${esc(user(p.deputy_id)?.name)}</span>`:''}${p.is_private?'<span class="chip warn">Privé</span>':''}${p.chat_enabled?'<span class="chip">Chat actif</span>':''}</div></article>`}
function taskIsUrgent(t){if(t.status==='done')return false;const today=new Date(`${isoDate()}T12:00:00`);const due=new Date(`${t.due}T12:00:00`);const days=Math.ceil((due-today)/86400000);return days<=7}
function sortTasks(a,b){
  const doneA=a.status==='done',doneB=b.status==='done';if(doneA!==doneB)return doneA?1:-1;
  const urgentA=taskIsUrgent(a),urgentB=taskIsUrgent(b);if(urgentA!==urgentB)return urgentA?-1:1;
  return (a.due||'9999-12-31').localeCompare(b.due||'9999-12-31');
}
function taskItem(t,context='default'){const p=project(t.project_id);const urgent=taskIsUrgent(t);const archiveAction=context==='global'&&t.status==='done'&&!t.hidden_from_list?`<button class="btn ghost" onclick="hideTaskFromGlobal('${t.id}')">Retirer de la liste</button>`:'';const restoreAction=context==='archived'?`<button class="btn secondary" onclick="restoreTaskToGlobal('${t.id}')">Réafficher</button>`:'';return `<div class="list-item ${urgent?'task-urgent':''} ${t.status==='done'?'task-done':''}"><div class="row"><div><div class="task-title">${esc(t.title)}</div><div class="muted" style="font-size:12px">${esc(p?.name||'')} · ${fmt(t.due)}</div></div><span class="chip ${taskTone(t)}">${urgent&&t.status!=='done'?'Urgent · ':''}${statusLabel(t.status)}</span></div><div class="meta"><span class="chip">${(t.assignee_ids||[]).map(id=>esc(user(id)?.name||'—')).join(' + ')||'Personne'}</span></div><div class="actions" style="margin-top:10px">${taskActions(t)}${archiveAction}${restoreAction}</div></div>`}
function taskActions(t){
  const p=project(t.project_id);const mine=(t.assignee_ids||[]).includes(me().id);let out='';
  if(t.status==='todo'&&mine)out+=`<button class="btn secondary" onclick="completeTask('${t.id}')">Je l'ai fait</button>`;
  if(t.status==='pending_validation'&&isManager(p))out+=`<button class="btn" onclick="validateTask('${t.id}')">Valider</button>`;
  if(t.status==='pending_validation'&&isManager(p))out+=`<button class="btn ghost" onclick="reopenTask('${t.id}')">Remettre à faire</button>`;
  return out;
}
function projectOptionTags(selected=''){return visibleProjects().map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}
function userChecks(selected=[]){return `<div class="checks">${activeMembers().map(u=>`<label class="checkpill"><input type="checkbox" name="users" value="${u.id}" ${selected.includes(u.id)?'checked':''}>${esc(u.name)}</label>`).join('')}</div>`}
function userOptions(selected=''){return `<option value="">—</option>${activeMembers().map(u=>`<option value="${u.id}" ${u.id===selected?'selected':''}>${esc(u.name)}</option>`).join('')}`}

/* ------------------------------------------------------------ discussions */

function discussionChannels(){
  const channels=[{id:'general',emoji:'💬',title:'Discussion générale',sub:'Conversation du bureau'}];
  visibleProjects().filter(p=>p.chat_enabled).forEach(p=>channels.push({id:p.id,emoji:'📁',title:p.name,sub:'Discussion projet'}));
  return channels;
}
function channelMessages(id){const pid=id==='general'?null:id;return S().messages.filter(m=>(m.project_id||null)===pid).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))}
function lastChannelMessage(id){const ms=channelMessages(id); return ms[ms.length-1];}

function quickLauncher(){
  return `<div class="card"><div class="section-title" style="margin-top:0"><h2>Accès rapide</h2></div>
    <div class="icon-grid">
      <button class="quick-tile" onclick="openTaskForm()"><div class="big">✅</div><div class="label">Nouvelle tâche</div></button>
      <button class="quick-tile" onclick="${isPresident()?'openProjectForm()':'nav(\'projects\')'}"><div class="big">📋</div><div class="label">Projet</div></button>
      <button class="quick-tile" onclick="openIdeaForm()"><div class="big">💡</div><div class="label">Idée</div></button>
      <button class="quick-tile" onclick="nav('calendar')"><div class="big">🗓️</div><div class="label">Planning</div></button>
    </div></div>`;
}

/* ------------------------------------------------------------ pages */

function dashboardPage(){
  const counts=taskCounts();
  const upcoming=counts.mine.sort((a,b)=>a.due.localeCompare(b.due)).slice(0,4);
  const projects=visibleProjects().slice(0,4);
  const chats=discussionChannels().slice(0,3);
  return shell('Accueil','Vue rapide du bureau : discussions, tâches et projets en cours.',`
    <div class="grid grid-3">
      <div class="card kpi"><div><div class="muted">Mes tâches</div><strong>${counts.mine.length}</strong></div><div class="icon">✅</div></div>
      <div class="card kpi"><div><div class="muted">En retard</div><strong class="${counts.overdue.length?'danger-text':''}">${counts.overdue.length}</strong></div><div class="icon">⏰</div></div>
      <div class="card kpi"><div><div class="muted">À valider</div><strong>${counts.pending.length}</strong></div><div class="icon">🧐</div></div>
    </div>
    ${quickLauncher()}
    <div class="section-title"><h2>Discussions récentes</h2><button class="btn secondary" onclick="nav('discussions')">Voir toutes les discussions</button></div>
    <div class="list">${chats.map(channelTile).join('')}</div>
    <div class="section-title"><h2>Projets en cours</h2><button class="btn secondary" onclick="nav('projects')">Tous les projets</button></div>
    <div class="grid grid-2">${projects.map(projectCard).join('') || '<div class="empty">Aucun projet visible.</div>'}</div>
    <div class="section-title"><h2>Mes prochaines tâches</h2></div>
    <div class="list">${upcoming.length?upcoming.map(t=>taskItem(t)).join(''):'<div class="empty">Aucune tâche en attente.</div>'}</div>
  `);
}

function discussionsPage(){
  const n=discussionChannels().length;
  return shell('Discussions','Choisis une conversation pour l’ouvrir en plein écran.',`
    <div class="section-title"><h2>Toutes les conversations</h2><span class="muted">${n} discussion${n>1?'s':''}</span></div>
    <div class="list">${discussionChannels().map(channelTile).join('')}</div>
  `)
}
function channelTile(ch){const last=lastChannelMessage(ch.id);return `<div class="card chat-tile" onclick="nav('chat','${ch.id}')"><div class="chat-badge">${ch.emoji}</div><div class="chat-meta"><h3>${esc(ch.title)}</h3><p>${last?esc(last.body):'Aucun message pour le moment.'}</p><div class="sub muted">${esc(ch.sub)}${last?` · ${esc(user(last.author_id)?.name||'—')} · ${esc(fmtAt(last.created_at))}`:''}</div></div><span class="badge">›</span></div>`}

function chatThreadHtml(channelId){const messages=channelMessages(channelId);return messages.length?messages.map(m=>messageBubble(channelId,m)).join(''):'<div class="empty">Aucun message. Lance la conversation.</div>'}
function chatPage(channelId){
  const ch=discussionChannels().find(c=>c.id===channelId);
  if(!ch) return shell('Discussion introuvable','Cette conversation n’est pas accessible.','<div class="empty">Conversation introuvable.</div>',`<button class="btn secondary" onclick="nav('discussions')">← Discussions</button>`);
  const projectId=channelId==='general'?'':channelId;
  return `<section class="full-chat-page">
    <div class="chat-page-head">
      <button class="chat-back" onclick="nav('discussions')">‹</button>
      <div class="chat-page-avatar">${ch.emoji}</div>
      <div class="chat-page-title"><strong>${esc(ch.title)}</strong><small>${esc(ch.sub)}</small></div>
      <button class="chat-task-btn" onclick="openTaskForm('${projectId}')">+ Tâche</button>
    </div>
    <div class="chat-page-thread" id="chatThread">${chatThreadHtml(channelId)}</div>
    <div class="chat-page-compose">
      <button class="attach-btn" title="Pièce jointe : à venir" onclick="toast('Les pièces jointes arrivent dans une prochaine version.')">＋</button>
      <input id="chatInput" placeholder="Message…" autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();sendMessage('${channelId}')}">
      <button class="send-btn" onclick="sendMessage('${channelId}')">➤</button>
    </div>
  </section>`;
}

function tasksPage(){
  const all=visibleTasks().slice().sort(sortTasks);
  const shown=all.filter(t=>!t.hidden_from_list);
  const urgent=shown.filter(t=>t.status!=='done'&&taskIsUrgent(t));
  const upcoming=shown.filter(t=>t.status!=='done'&&!taskIsUrgent(t));
  const done=shown.filter(t=>t.status==='done');
  const archived=all.filter(t=>t.status==='done'&&t.hidden_from_list);
  return shell('Toutes les tâches','Vue commune du bureau : urgentes d’abord, puis par échéance, puis les tâches validées.',`
    <div class="grid grid-3">
      <div class="card kpi"><div><div class="muted">Urgentes</div><strong class="${urgent.length?'danger-text':''}">${urgent.length}</strong></div><div class="icon">🔥</div></div>
      <div class="card kpi"><div><div class="muted">À venir</div><strong>${upcoming.length}</strong></div><div class="icon">📅</div></div>
      <div class="card kpi"><div><div class="muted">Validées</div><strong>${done.length}</strong></div><div class="icon">✅</div></div>
    </div>
    <section class="task-group"><div class="task-group-head"><h2>🔥 Urgentes</h2><span class="muted">Échéance dans 7 jours ou moins</span></div><div class="list">${urgent.length?urgent.map(t=>taskItem(t,'global')).join(''):'<div class="empty">Aucune tâche urgente.</div>'}</div></section>
    <section class="task-group"><div class="task-group-head"><h2>📅 À venir</h2><span class="muted">Classées par date</span></div><div class="list">${upcoming.length?upcoming.map(t=>taskItem(t,'global')).join(''):'<div class="empty">Aucune autre tâche à venir.</div>'}</div></section>
    <section class="task-group"><div class="task-group-head"><h2>✅ Validées</h2><span class="muted">Toujours en dessous des tâches actives</span></div><div class="list">${done.length?done.map(t=>taskItem(t,'global')).join(''):'<div class="empty">Aucune tâche validée visible.</div>'}</div></section>
    ${archived.length?`<section class="task-group"><div class="task-group-head"><h2>🗄️ Retirées de cette liste</h2><button class="btn secondary" onclick="toggleArchivedTasks()">${showArchivedTasks?'Masquer':'Afficher'} (${archived.length})</button></div>${showArchivedTasks?`<div class="archived-list">${archived.map(t=>taskItem(t,'archived')).join('')}</div>`:''}</section>`:''}
  `,`<button class="btn" onclick="openTaskForm()">+ Nouvelle tâche</button>`)
}
function hideTaskFromGlobal(id){const t=S().tasks.find(x=>x.id===id);if(!t||t.status!=='done')return;run(Store.update('tasks',{id},{hidden_from_list:true}),'Tâche retirée de la liste globale, conservée dans le projet')}
function restoreTaskToGlobal(id){if(!S().tasks.find(x=>x.id===id))return;run(Store.update('tasks',{id},{hidden_from_list:false}),'Tâche réaffichée')}
function toggleArchivedTasks(){showArchivedTasks=!showArchivedTasks;render()}

function projectsPage(){
  const actions=isPresident()?`<button class="btn pink" onclick="openProjectForm()">+ Nouveau projet</button>`:'';
  return shell('Projets','Chaque projet regroupe discussion, tâches, budget et avancement.',`<div class="grid grid-2">${visibleProjects().map(projectCard).join('')||'<div class="empty">Aucun projet visible.</div>'}</div>`,actions)
}

function projectPage(id){
  const p=project(id); if(!p||!canSeeProject(p)) return shell('Projet introuvable','Tu n’as pas accès à ce projet.','<div class="empty">Projet introuvable.</div>');
  const tasks=projectTasks(id).slice().sort(sortTasks);
  return shell(p.name,'Vue projet complète.',`
    <div class="card">
      <div class="row"><div><div class="muted">Responsable</div><h3>${esc(user(p.manager_id)?.name||'—')}</h3></div><div><div class="muted">Adjoint</div><h3>${esc(user(p.deputy_id)?.name||'—')}</h3></div><div><div class="muted">Budget</div><h3>${euros(p.budget)} €</h3></div></div>
      <p class="muted">${esc(p.description||'')}</p>
      <div class="progress"><i style="width:${progress(id)}%"></i></div>
      <div class="meta"><span class="chip">${progress(id)}% réalisé</span>${p.is_private?'<span class="chip warn">Projet masqué</span>':''}${p.chat_enabled?'<span class="chip">Chat activé</span>':'<span class="chip">Pas de chat dédié</span>'}</div>
      <div class="actions" style="margin-top:12px">${p.chat_enabled?`<button class="btn" onclick="nav('chat','${p.id}')">💬 Ouvrir la discussion</button>`:''}<button class="btn secondary" onclick="openTaskForm('${p.id}')">+ Tâche</button>${isPresident()?`<button class="btn ghost" onclick="openProjectForm('${p.id}')">Modifier</button>`:''}</div>
    </div>
    <div class="section-title"><h2>Tâches du projet</h2></div>
    <div class="list">${tasks.length?tasks.map(t=>taskItem(t)).join(''):'<div class="empty">Aucune tâche dans ce projet.</div>'}</div>
  `,`<button class="btn secondary" onclick="nav('projects')">← Projets</button>`)
}

function calendarPage(){
  const d=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1);const y=d.getFullYear(),m=d.getMonth();const first=new Date(y,m,1);const last=new Date(y,m+1,0);const start=(first.getDay()+6)%7;const cells=[];
  for(let i=0;i<start;i++)cells.push('');for(let day=1;day<=last.getDate();day++)cells.push(String(day));while(cells.length%7)cells.push('');
  const rentals=S().rentals.slice().sort((a,b)=>a.start_date.localeCompare(b.start_date));
  return shell('Rétroplanning','Tâches et réservations de matériel dans le même calendrier.',`
    <div class="card">
      <div class="row"><div class="actions"><button class="btn secondary" onclick="shiftCalendarMonth(-1)">‹ Mois précédent</button><button class="btn secondary" onclick="goCalendarToday()">Aujourd’hui</button><button class="btn secondary" onclick="shiftCalendarMonth(1)">Mois suivant ›</button></div><h2>${new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(d)}</h2></div>
      <div class="calendar-legend"><span class="legend-pill"><i class="legend-dot"></i>Tâche</span><span class="legend-pill"><i class="legend-dot rental"></i>Réservation matériel</span></div>
      <div class="calendar-grid" style="margin-top:12px">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(x=>`<div class="calendar-head">${x}</div>`).join('')}${cells.map(day=>calendarCell(y,m,day)).join('')}</div>
    </div>
    <div class="section-title"><h2>Réservations matériel</h2><button class="btn secondary" onclick="openRentalForm()">+ Réservation</button></div>
    <div class="list">${rentals.length?rentals.map(calendarRentalItem).join(''):'<div class="empty">Aucune réservation de matériel.</div>'}</div>
    <div class="section-title"><h2>Échéances des tâches</h2></div>
    <div class="list">${visibleTasks().slice().sort(sortTasks).map(t=>taskItem(t)).join('')||'<div class="empty">Aucune tâche.</div>'}</div>
  `,`<button class="btn" onclick="openTaskForm()">+ Nouvelle tâche</button>`)
}
function shiftCalendarMonth(delta){calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+delta,1);render()}
function goCalendarToday(){calendarCursor=new Date();render()}
function calendarCell(y,m,day){if(!day)return '<div class="day"></div>';const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;const tasks=visibleTasks().filter(t=>t.due===ds).sort(sortTasks);const rentals=S().rentals.filter(r=>r.start_date<=ds&&r.end_date>=ds);return `<div class="day${ds===isoDate()?' today':''}"><div class="n">${day}</div>${tasks.map(t=>`<div class="cal-task ${t.status==='done'?'done':''}" title="${esc(t.title)}">${esc(t.title)}</div>`).join('')}${rentals.map(r=>{const mat=material(r.material_id);return `<div class="cal-rental" title="${esc(r.renter)} — ${esc(mat?.name||'Matériel')}">📦 ${esc(mat?.name||'Matériel')}</div>`}).join('')}</div>`}
function rentalLabel(r,planned='Réservé'){return r.status==='returned'?'Rendu':r.status==='out'?'Sorti':planned}
function calendarRentalItem(r){const m=material(r.material_id);return `<div class="list-item"><div class="row"><div><b>📦 ${esc(m?.name||'Matériel')}</b><div class="muted">${esc(r.renter)} · ${fmt(r.start_date)} → ${fmt(r.end_date)}</div></div><span class="chip">${rentalLabel(r)}</span></div></div>`}

function ideasPage(){
  const ideas=S().ideas.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  return shell('Boîte à idées','Le fourre-tout du bureau : idées, réactions, commentaires.',`
    <div class="section-title"><h2>Idées proposées</h2><button class="btn pink" onclick="openIdeaForm()">+ Nouvelle idée</button></div>
    <div class="list">${ideas.length?ideas.map(ideaCard).join(''):'<div class="empty">Aucune idée pour le moment.</div>'}</div>
  `)
}
function ideaCard(i){
  const reacts=S().idea_reactions.filter(r=>r.idea_id===i.id);
  const comments=S().idea_comments.filter(c=>c.idea_id===i.id).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  return `<div class="card"><div class="row"><div><h3>${esc(i.title)}</h3><div class="muted">Par ${esc(user(i.author_id)?.name||'—')} · ${fmt(i.created_at)}</div></div></div><p>${esc(i.body)}</p><div class="idea-score">${EMOJIS.map(e=>{const rs=reacts.filter(r=>r.emoji===e);return `<button class="emoji-btn ${rs.some(r=>r.member_id===me().id)?'on':''}" onclick="toggleReaction('${i.id}','${e}')">${e} ${rs.length}</button>`}).join('')}</div><div class="divider"></div><div class="list">${comments.map(c=>`<div class="list-item"><b>${esc(user(c.author_id)?.name||'—')}</b><div>${esc(c.body)}</div></div>`).join('')||'<div class="muted">Aucun commentaire.</div>'}</div><div class="actions" style="margin-top:10px"><button class="btn secondary" onclick="openIdeaComment('${i.id}')">Commenter</button></div></div>`}

function morePage(){
  const last=Store.enLigne
    ?`<div class="card more-tile" onclick="logout()"><div class="big">🚪</div><h3>Se déconnecter</h3><p class="muted">Fermer la session sur cet appareil.</p></div>`
    :`<div class="card more-tile" onclick="reset()"><div class="big">↺</div><h3>Réinitialiser</h3><p class="muted">Revenir aux données de démonstration.</p></div>`;
  return shell('Plus','Modules complémentaires et administration légère.',`
    <div class="more-grid">
      <div class="card more-tile" onclick="nav('materials')"><div class="big">📦</div><h3>Matériel & locations</h3><p class="muted">Inventaire, prise, retour, signatures.</p></div>
      <div class="card more-tile" onclick="nav('feedback')"><div class="big">📊</div><h3>Feedback événements</h3><p class="muted">KPI, retours, archives par année.</p></div>
      <div class="card more-tile" onclick="nav('documents')"><div class="big">📁</div><h3>Documents</h3><p class="muted">Arborescence globale avec sous-dossiers.</p></div>
      <div class="card more-tile" onclick="nav('members')"><div class="big">👥</div><h3>Membres</h3><p class="muted">Rôles du bureau et accès.</p></div>
      <div class="card more-tile" onclick="nav('ideas')"><div class="big">💡</div><h3>Boîte à idées</h3><p class="muted">Idées, réactions et commentaires.</p></div>
      ${last}
    </div>
  `)
}

function materialsPage(){return shell('Matériel & locations','Inventaire défini par le bureau et suivi des prêts.',`
  <div class="section-title"><h2>Inventaire</h2><div class="actions"><button class="btn secondary" onclick="openMaterialForm()">+ Matériel</button><button class="btn pink" onclick="openRentalForm()">+ Location</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>Matériel</th><th>Catégorie</th><th>Qté</th><th>Situation</th><th>Notes</th></tr></thead><tbody>${S().materials.map(m=>`<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.category)}</td><td>${m.quantity}</td><td>${materialStatus(m.id)}</td><td>${esc(m.notes)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Aucun matériel.</td></tr>'}</tbody></table></div>
  <div class="section-title"><h2>Locations</h2></div><div class="list">${S().rentals.length?S().rentals.map(rentalItem).join(''):'<div class="empty">Aucune location.</div>'}</div>`)}
function materialStatus(id){const active=S().rentals.some(r=>r.material_id===id&&r.status!=='returned'&&r.start_date<=isoDate()&&r.end_date>=isoDate());return active?'<span><i class="status-dot status-rented"></i>Loué</span>':'<span><i class="status-dot status-available"></i>Disponible</span>'}
function rentalItem(r){const m=material(r.material_id);return `<div class="list-item"><div class="row"><div><b>${esc(r.renter)}</b><div class="muted">${esc(m?.name)} × ${r.quantity} · ${fmt(r.start_date)} → ${fmt(r.end_date)}</div></div><span class="chip">${rentalLabel(r,'Prévu')}</span></div><div class="actions" style="margin-top:10px"><button class="btn secondary" onclick="openRentalSheet('${r.id}')">Fiche</button>${r.status==='planned'?`<button class="btn" onclick="openHandover('${r.id}','departure')">Prise</button>`:''}${r.status==='out'?`<button class="btn" onclick="openHandover('${r.id}','return')">Retour</button>`:''}</div></div>`}

function feedbackPage(){
  if(!isPresident())return shell('Feedback événements','Conserver un retour d’expérience structuré, classé par année.','<div class="empty">Les feedbacks archivés sont réservés au président.</div>');
  const list=S().feedbacks.slice().sort((a,b)=>b.event_date.localeCompare(a.event_date));
  return shell('Feedback événements','Conserver un retour d’expérience structuré, classé par année.',`
  <div class="section-title"><h2>Archives</h2><button class="btn pink" onclick="openFeedbackForm()">+ Nouveau feedback</button></div>
  ${list.length?`<div class="list">${list.map(f=>`<div class="list-item"><div class="row"><div><b>${esc(f.event_name)}</b><div class="muted">${fmt(f.event_date)} · ${String(f.event_date).slice(0,4)}</div></div><span class="badge">${f.global_score}/10</span></div><div class="meta"><span class="chip">${f.attendance||0} participants</span><span class="chip">Budget ${euros(f.budget_actual)} €</span></div><div class="actions" style="margin-top:10px"><button class="btn secondary" onclick="viewFeedback('${f.id}')">Voir / imprimer</button></div></div>`).join('')}</div>`:'<div class="empty">Aucun feedback archivé.</div>'}`)}

function documentsPage(){return shell('Documents','Espace global de fichiers avec sous-dossiers.',`<div class="section-title"><h2>Fichiers</h2><div class="actions"><button class="btn secondary" onclick="openFolderForm()">+ Dossier</button><button class="btn pink" onclick="openDocumentForm()">+ Fichier</button></div></div><div class="card file-tree">${tree(null)}</div>`)}
function tree(parent){const nodes=S().documents.filter(d=>(d.parent_id||null)===parent).sort((a,b)=>(a.type===b.type?0:a.type==='folder'?-1:1)||a.name.localeCompare(b.name,'fr'));if(!nodes.length)return '<div class="muted">Dossier vide</div>';return `<ul>${nodes.map(n=>n.type==='folder'?`<li><span class="folder open">📁 ${esc(n.name)}</span>${tree(n.id)}</li>`:`<li>${n.storage_path?`<button class="file-link" onclick="openStoredFile('${n.id}')">📄 ${esc(n.name)}</button>`:`📄 ${esc(n.name)}`}</li>`).join('')}</ul>`}

function membersPage(){
  const list=S().members.slice().sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name,'fr'));
  const n=S().members.filter(u=>u.active).length;
  const sub=Store.enLigne?`${n} compte${n>1?'s':''} actif${n>1?'s':''}. Seules ces adresses peuvent se connecter.`:'10 comptes prévus au lancement.';
  const admin=isAdmin();
  return shell('Membres du bureau',sub,`<div class="grid grid-2">${list.map(u=>`<div class="card${admin?' project-card':''}${u.active?'':' task-done'}"${admin?` onclick="openMemberForm('${u.id}')"`:''}><div class="row"><div><h3>${esc(u.name)}</h3><div class="muted">${esc(u.email)}</div></div><span class="badge">${esc(roleLabel(u.role))}</span></div>${u.active?'':'<div class="meta"><span class="chip danger">Accès fermé</span></div>'}</div>`).join('')}</div>`,
    admin?`<button class="btn pink" onclick="openMemberForm()">+ Membre</button>`:'')
}

/* Écran d'une adresse connectée mais absente de la liste des membres */
function refusePage(){
  return shell('Accès non ouvert',`Ton adresse ${Store.email} n’est pas dans la liste des membres du bureau.`,
    `<div class="card"><p>Demande au président de t’ajouter, puis reconnecte-toi.</p><div class="actions"><button class="btn" onclick="logout()">Se déconnecter</button></div></div>`)
}

/* ------------------------------------------------------------ rendu */

function renderUser(){
  const sw=$('#userSwitch'),name=$('#userName'),out=$('#logoutBtn');
  if(Store.enLigne){sw.hidden=true;name.hidden=false;out.hidden=false;name.textContent=me().name}
  else{sw.hidden=false;name.hidden=true;out.hidden=true;sw.innerHTML=activeMembers().map(u=>`<option value="${u.id}" ${u.id===Store.meId?'selected':''}>${esc(u.name)}</option>`).join('')}
  $('#roleBadge').textContent=roleLabel(me().role);
}
function render(){
  if(!started)return;
  renderUser();
  if(!Store.meId){$('#app').innerHTML=refusePage();$('.bottom-nav').hidden=true;$('#fab').style.display='none';return}
  const map={dashboard:dashboardPage,discussions:discussionsPage,chat:()=>chatPage(routeParam),tasks:tasksPage,projects:projectsPage,project:()=>projectPage(routeParam),calendar:calendarPage,ideas:ideasPage,more:morePage,materials:materialsPage,feedback:feedbackPage,documents:documentsPage,members:membersPage};
  $('#app').innerHTML=(map[route]||dashboardPage)();
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.route===route||(['materials','feedback','documents','members','ideas'].includes(route)&&b.dataset.route==='more')||(route==='project'&&b.dataset.route==='projects')||(route==='chat'&&b.dataset.route==='discussions')));
  const fab=$('#fab'); if(fab) fab.style.display=route==='chat'?'none':'';
  if(route==='chat') setTimeout(()=>{const t=$('#chatThread');if(t)t.scrollTop=t.scrollHeight},0);
}

function modal(title,body){$('#modalContent').innerHTML=`<div class="modal-head"><h2>${esc(title)}</h2><button class="x" onclick="closeModal()">×</button></div><div class="modal-body">${body}</div>`;$('#modal').showModal()}
function closeModal(){const m=$('#modal');if(m.open)m.close()}
/* Formulaire envoyé : bouton bloqué pendant l'enregistrement, fenêtre fermée s'il réussit */
function onSubmit(id,handler){const f=$('#'+id);f.onsubmit=e=>{e.preventDefault();const b=f.querySelector('button:not([type=button])');if(b&&b.disabled)return;const r=handler(new FormData(f),f);if(r&&r.then){if(b)b.disabled=true;r.then(ok=>{if(b)b.disabled=false;if(ok!==false)closeModal()})}else if(r!==false)closeModal()}}

/* ------------------------------------------------------------ discussions */

function messageBubble(channelId,m){const mine=m.author_id===me().id;const projectId=channelId==='general'?'':channelId;return `<div class="msg ${mine?'me':''}"><header><span class="author">${esc(user(m.author_id)?.name||'—')}</span><small>${esc(fmtAt(m.created_at))}</small></header><div class="text">${esc(m.body)}</div><div class="msg-actions"><button class="mini-btn" onclick="openTaskFromMessage('${projectId}','${m.id}')">➕ En faire une tâche</button></div></div>`}
function sendMessage(channelId){const input=$('#chatInput');const text=input?.value.trim();if(!text)return;route='chat';routeParam=channelId;run(Store.insert('messages',{project_id:channelId==='general'?null:channelId,author_id:me().id,body:text}))}
function openTaskFromMessage(projectId,messageId){const m=S().messages.find(x=>x.id===messageId);openTaskForm(projectId,m?m.body:'')}

/* ------------------------------------------------------------ projets et tâches */

function openProjectForm(id=''){
  if(!isPresident()) return toast('Seul le président peut créer ou modifier un projet.');
  const p=id?project(id):null;
  modal(p?'Modifier le projet':'Nouveau projet',`<form id="projectForm" class="form-grid">
    <div class="field full"><label>Nom</label><input name="name" required value="${esc(p?.name||'')}"></div>
    <div class="field full"><label>Description</label><textarea name="description">${esc(p?.description||'')}</textarea></div>
    <div class="field"><label>Responsable</label><select name="managerId" required>${userOptions(p?.manager_id||'')}</select></div>
    <div class="field"><label>Adjoint éventuel</label><select name="deputyId">${userOptions(p?.deputy_id||'')}</select></div>
    <div class="field"><label>Budget estimé / alloué (€)</label><input type="number" name="budget" min="0" step="any" value="${p?.budget||0}"></div>
    <div class="field"><label><input type="checkbox" name="chatEnabled" ${p?.chat_enabled?'checked':''}> Activer un chat dédié</label><label><input type="checkbox" name="private" ${p?.is_private?'checked':''}> Projet à visibilité restreinte</label></div>
    <div class="field full"><label>Personnes autorisées si privé</label>${userChecks(p?.visible_to||[])}</div>
    <div class="field full"><button class="btn pink">Enregistrer</button></div></form>`);
  onSubmit('projectForm',fd=>{
    const data={name:fd.get('name').trim(),description:fd.get('description').trim(),manager_id:fd.get('managerId'),deputy_id:fd.get('deputyId')||null,budget:Number(fd.get('budget')||0),is_private:fd.get('private')==='on',visible_to:fd.getAll('users'),chat_enabled:fd.get('chatEnabled')==='on'};
    route='projects';routeParam=null;
    return run(p?Store.update('projects',{id:p.id},data):Store.insert('projects',{...data,owner_id:me().id,status:'active'}),p?'Projet modifié':'Projet créé');
  });
}

function openTaskForm(projectId='',prefill=''){
  const defaultProject=projectId && project(projectId)?projectId:(visibleProjects()[0]?.id||'');
  if(!defaultProject)return toast('Aucun projet visible : crée d’abord un projet.');
  modal('Nouvelle tâche',`<form id="taskForm" class="form-grid"><div class="field full"><label>Projet</label><select name="projectId" required>${projectOptionTags(defaultProject)}</select></div><div class="field full"><label>Titre</label><input name="title" required value="${esc(prefill||'')}"></div><div class="field"><label>Échéance</label><input type="date" name="due" value="${isoDate(new Date(Date.now()+7*86400000))}" required></div><div class="field full"><label>Personnes concernées</label>${userChecks([me().id])}</div><div class="field full"><button class="btn pink">Créer la tâche</button></div></form>`);
  onSubmit('taskForm',fd=>run(Store.insert('tasks',{project_id:fd.get('projectId'),title:fd.get('title').trim(),assignee_ids:fd.getAll('users'),due:fd.get('due'),status:'todo',hidden_from_list:false,created_by:me().id,completed_by:null,completed_at:null,validated_by:null,validated_at:null}),'Tâche créée'));
}
function completeTask(id){if(!S().tasks.find(x=>x.id===id))return;run(Store.update('tasks',{id},{status:'pending_validation',completed_by:me().id,completed_at:isoDate()}),'Tâche terminée, en attente de validation')}
function validateTask(id){if(!S().tasks.find(x=>x.id===id))return;run(Store.update('tasks',{id},{status:'done',validated_by:me().id,validated_at:new Date().toISOString()}),'Tâche validée')}
function reopenTask(id){if(!S().tasks.find(x=>x.id===id))return;run(Store.update('tasks',{id},{status:'todo',completed_by:null,completed_at:null}),'Tâche remise à faire')}

/* ------------------------------------------------------------ idées */

function openIdeaForm(){modal('Nouvelle idée',`<form id="ideaForm" class="form-grid"><div class="field full"><label>Titre</label><input name="title" required></div><div class="field full"><label>Détail</label><textarea name="body"></textarea></div><div class="field full"><button class="btn pink">Publier</button></div></form>`);onSubmit('ideaForm',fd=>run(Store.insert('ideas',{title:fd.get('title').trim(),body:fd.get('body'),author_id:me().id}),'Idée ajoutée'))}
function toggleReaction(id,emoji){const f={idea_id:id,member_id:me().id,emoji};const on=S().idea_reactions.some(r=>r.idea_id===id&&r.member_id===f.member_id&&r.emoji===emoji);run(on?Store.remove('idea_reactions',f):Store.insert('idea_reactions',f))}
function openIdeaComment(id){modal('Commenter l’idée',`<form id="commentForm" class="form-grid"><div class="field full"><label>Commentaire</label><textarea name="text" required></textarea></div><div class="field full"><button class="btn pink">Publier</button></div></form>`);onSubmit('commentForm',fd=>run(Store.insert('idea_comments',{idea_id:id,author_id:me().id,body:fd.get('text').trim()}),'Commentaire ajouté'))}

/* ------------------------------------------------------------ matériel et locations */

function openMaterialForm(){modal('Nouveau matériel',`<form id="materialForm" class="form-grid"><div class="field full"><label>Nom</label><input name="name" required></div><div class="field"><label>Catégorie</label><input name="category"></div><div class="field"><label>Quantité</label><input type="number" name="quantity" value="1" min="1"></div><div class="field full"><label>Notes</label><textarea name="notes"></textarea></div><div class="field full"><button class="btn pink">Créer</button></div></form>`);onSubmit('materialForm',fd=>run(Store.insert('materials',{name:fd.get('name').trim(),category:fd.get('category'),quantity:Math.max(1,Number(fd.get('quantity'))||1),notes:fd.get('notes')}),'Matériel ajouté'))}
function openRentalForm(){
  if(!S().materials.length)return toast('Ajoute d’abord du matériel à l’inventaire.');
  modal('Nouvelle location',`<form id="rentalForm" class="form-grid"><div class="field full"><label>Locataire</label><input name="renter" required></div><div class="field"><label>Matériel</label><select name="materialId" required>${S().materials.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label>Quantité</label><input type="number" name="quantity" min="1" value="1" required></div><div class="field"><label>Date de prise</label><input type="date" name="start" required></div><div class="field"><label>Date de retour</label><input type="date" name="end" required></div><div class="field full"><label>Remarque</label><textarea name="remarks"></textarea></div><div class="field full"><button class="btn pink">Créer</button></div></form>`);
  onSubmit('rentalForm',fd=>{if(fd.get('end')<fd.get('start')){toast('La date de retour précède la date de prise.');return false}
    return run(Store.insert('rentals',{renter:fd.get('renter').trim(),material_id:fd.get('materialId'),quantity:Number(fd.get('quantity')),start_date:fd.get('start'),end_date:fd.get('end'),departure_state:'',return_state:'',photos:[],remarks:fd.get('remarks'),status:'planned',signature_departure:'',signature_return:'',created_by:me().id}),'Location créée')});
}
function openHandover(id,type){const r=S().rentals.find(x=>x.id===id),departure=type==='departure';
  modal(departure?'Fiche de prise':'Fiche de retour',`<form id="handoverForm" class="form-grid"><div class="field full"><label>${departure?'État au départ':'État au retour'}</label><textarea name="state" required>${esc(departure?r.departure_state:r.return_state)}</textarea></div><div class="field full"><label>Photo(s)</label><input type="file" name="photos" accept="image/*" multiple>${Store.enLigne?'':'<div class="muted" style="font-size:11px">En démonstration, seul le nom des photos est conservé.</div>'}</div><div class="field full"><label>Remarques</label><textarea name="remarks">${esc(r.remarks)}</textarea></div><div class="field full"><label>Signature tactile</label><canvas id="signature" class="signature" width="600" height="180"></canvas><button type="button" class="btn ghost" onclick="clearSignature()">Effacer la signature</button></div><div class="field full"><button class="btn pink">Enregistrer ${departure?'la prise':'le retour'}</button></div></form>`);
  setupSignature();
  onSubmit('handoverForm',(fd,form)=>{
    const files=[...form.photos.files];const signature=$('#signature').toDataURL('image/png');
    return Promise.all(files.map(f=>Store.envoieFichier('locations/'+r.id,f).then(path=>({name:f.name,path}))))
      .then(photos=>{const champs={remarks:fd.get('remarks'),photos:(r.photos||[]).concat(photos)};
        if(departure)Object.assign(champs,{departure_state:fd.get('state'),signature_departure:signature,status:'out'});
        else Object.assign(champs,{return_state:fd.get('state'),signature_return:signature,status:'returned'});
        return run(Store.update('rentals',{id:r.id},champs),departure?'Prise enregistrée':'Retour enregistré')})
      .catch(err=>{toast(err.message||'Envoi des photos impossible.');return false});
  });
}
let sigCtx=null,sigDown=false;function setupSignature(){const c=$('#signature');sigCtx=c.getContext('2d');sigCtx.lineWidth=2;sigCtx.strokeStyle='#111';const p=e=>{const r=c.getBoundingClientRect();const t=e.touches?.[0]||e;return{x:(t.clientX-r.left)*(c.width/r.width),y:(t.clientY-r.top)*(c.height/r.height)}};const start=e=>{sigDown=true;const q=p(e);sigCtx.beginPath();sigCtx.moveTo(q.x,q.y);e.preventDefault()};const move=e=>{if(!sigDown)return;const q=p(e);sigCtx.lineTo(q.x,q.y);sigCtx.stroke();e.preventDefault()};const end=()=>sigDown=false;c.addEventListener('mousedown',start);c.addEventListener('mousemove',move);window.addEventListener('mouseup',end);c.addEventListener('touchstart',start,{passive:false});c.addEventListener('touchmove',move,{passive:false});c.addEventListener('touchend',end)}
function clearSignature(){const c=$('#signature');c.getContext('2d').clearRect(0,0,c.width,c.height)}
function photoList(r){const ps=r.photos||[];if(!ps.length)return '—';return ps.map((p,i)=>typeof p==='string'?esc(p):p.path?`<button class="file-link" onclick="openRentalPhoto('${r.id}',${i})">${esc(p.name)}</button>`:esc(p.name)).join(', ')}
function openRentalSheet(id){const r=S().rentals.find(x=>x.id===id),m=material(r.material_id);
  const sig=(src,label)=>src&&src.length>2000?`<p><b>${label} :</b><br><img class="signature-img" src="${src}" alt="${label}"></p>`:'';
  modal('Fiche de location',`<div id="printRental"><div class="card"><h2>Fiche de location — ${esc(r.renter)}</h2><p><b>Matériel :</b> ${esc(m?.name)} × ${r.quantity}</p><p><b>Dates :</b> ${fmt(r.start_date)} → ${fmt(r.end_date)}</p><p><b>État départ :</b> ${esc(r.departure_state||'Non renseigné')}</p><p><b>État retour :</b> ${esc(r.return_state||'Non renseigné')}</p><p><b>Remarques :</b> ${esc(r.remarks||'—')}</p><p><b>Photos :</b> ${photoList(r)}</p>${sig(r.signature_departure,'Signature à la prise')}${sig(r.signature_return,'Signature au retour')}</div></div><div class="actions no-print" style="margin-top:12px"><button class="btn" onclick="window.print()">Imprimer / enregistrer PDF</button><button class="btn secondary" onclick="queueEmail('location','${r.id}')">Préparer l’envoi mail</button></div><p class="muted no-print" style="font-size:11px">L’envoi automatique sera activé quand le service mail sera connecté.</p>`)}
function openRentalPhoto(id,i){const r=S().rentals.find(x=>x.id===id);const p=r&&(r.photos||[])[i];if(p&&p.path)downloadStored(p.path,p.name)}
function queueEmail(type,id){run(Store.insert('mail_queue',{kind:type,ref_id:id,created_by:me().id}),'Demande d’envoi mail enregistrée')}

/* ------------------------------------------------------------ feedbacks */

function openFeedbackForm(){if(!isPresident())return toast('Le feedback archivé est réservé au président.');modal('Feedback événement',`<form id="feedbackForm" class="form-grid"><div class="field full"><label>Événement</label><input name="eventName" required></div><div class="field"><label>Date</label><input type="date" name="date" value="${isoDate()}" required></div><div class="field"><label>Note globale /10</label><input type="number" min="0" max="10" name="globalScore" value="8" required></div><div class="field"><label>Participants</label><input type="number" min="0" name="attendance"></div><div class="field"><label>Budget réel (€)</label><input type="number" min="0" step="any" name="budgetActual"></div><div class="field"><label>Respect du planning /10</label><input type="number" min="0" max="10" name="scheduleScore" value="8"></div><div class="field"><label>Mobilisation bénévoles /10</label><input type="number" min="0" max="10" name="volunteerScore" value="8"></div><div class="field"><label>Satisfaction organisation /10</label><input type="number" min="0" max="10" name="orgScore" value="8"></div><div class="field full"><label>Points forts</label><textarea name="positives"></textarea></div><div class="field full"><label>Points à améliorer</label><textarea name="improvements"></textarea></div><div class="field full"><label>Incidents / difficultés</label><textarea name="incidents"></textarea></div><div class="field full"><label>Actions à prévoir l’année suivante</label><textarea name="nextActions"></textarea></div><div class="field full"><button class="btn pink">Archiver le feedback</button></div></form>`);
  onSubmit('feedbackForm',fd=>{const n=k=>Number(fd.get(k)||0);const f={event_name:fd.get('eventName').trim(),event_date:fd.get('date'),global_score:n('globalScore'),attendance:n('attendance'),budget_actual:n('budgetActual'),schedule_score:n('scheduleScore'),volunteer_score:n('volunteerScore'),org_score:n('orgScore'),positives:fd.get('positives'),improvements:fd.get('improvements'),incidents:fd.get('incidents'),next_actions:fd.get('nextActions'),created_by:me().id};
    return Store.insert('feedbacks',f).then(()=>Store.insert('mail_queue',{kind:'feedback',ref_id:f.id,created_by:me().id})).then(()=>{render();toast('Feedback archivé');return true},err=>{render();toast(err.message||'Enregistrement impossible.');return false})})}
function viewFeedback(id){const f=S().feedbacks.find(x=>x.id===id);modal('Feedback archivé',`<div class="card"><h2>${esc(f.event_name)} — ${fmt(f.event_date)}</h2><div class="grid grid-3"><div><div class="muted">Note globale</div><h3>${f.global_score}/10</h3></div><div><div class="muted">Participants</div><h3>${f.attendance}</h3></div><div><div class="muted">Budget réel</div><h3>${euros(f.budget_actual)} €</h3></div></div><p><b>Planning :</b> ${f.schedule_score}/10 · <b>Bénévoles :</b> ${f.volunteer_score}/10 · <b>Organisation :</b> ${f.org_score}/10</p><div class="divider"></div><p><b>Points forts</b><br>${esc(f.positives||'—')}</p><p><b>À améliorer</b><br>${esc(f.improvements||'—')}</p><p><b>Incidents / difficultés</b><br>${esc(f.incidents||'—')}</p><p><b>Actions année suivante</b><br>${esc(f.next_actions||'—')}</p></div><div class="actions no-print" style="margin-top:12px"><button class="btn" onclick="window.print()">Imprimer / enregistrer PDF</button><button class="btn secondary" onclick="queueEmail('feedback','${f.id}')">Préparer l’envoi mail</button></div>`)}

/* ------------------------------------------------------------ documents */

function folderOptions(){return `<option value="">Racine</option>${S().documents.filter(d=>d.type==='folder').map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}`}
function openFolderForm(){modal('Nouveau dossier',`<form id="folderForm" class="form-grid"><div class="field full"><label>Nom</label><input name="name" required></div><div class="field full"><label>Dossier parent</label><select name="parent">${folderOptions()}</select></div><div class="field full"><button class="btn pink">Créer</button></div></form>`);onSubmit('folderForm',fd=>run(Store.insert('documents',{name:fd.get('name').trim(),type:'folder',parent_id:fd.get('parent')||null,storage_path:null,created_by:me().id})))}
function openDocumentForm(){modal('Ajouter un fichier',`<form id="docForm" class="form-grid"><div class="field full"><label>Fichier</label><input type="file" name="file" required></div><div class="field full"><label>Dossier</label><select name="parent">${folderOptions()}</select></div><div class="field full"><button class="btn pink">Ajouter</button></div></form>`);
  onSubmit('docForm',(fd,form)=>{const file=form.file.files[0];if(!file)return false;
    return Store.envoieFichier('documents',file).then(path=>run(Store.insert('documents',{name:file.name,type:'file',parent_id:fd.get('parent')||null,storage_path:path,mime:file.type||null,size:file.size,created_by:me().id}),Store.enLigne?'Fichier ajouté':'Fichier ajouté (démonstration : nom seul)'))
      .catch(err=>{toast(err.message||'Envoi impossible.');return false})})}
function openStoredFile(id){const d=S().documents.find(x=>x.id===id);if(d&&d.storage_path)downloadStored(d.storage_path,d.name)}
function downloadStored(path,name){toast('Téléchargement…');Store.litFichier(path).then(blob=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name||'fichier';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}).catch(err=>toast(err.message))}

/* ------------------------------------------------------------ membres (accès) */

function openMemberForm(id=''){
  if(!isAdmin())return;
  const u=id?user(id):null;const sa=me().role==='superadmin';
  if(u&&u.role==='superadmin'&&!sa)return toast('Seul un super admin modifie un super admin.');
  const roles=['bureau','etat_major','president'].concat(sa?['superadmin']:[]);
  const self=u&&u.id===me().id;
  modal(u?'Modifier le membre':'Nouveau membre',`<form id="memberForm" class="form-grid">
    <div class="field"><label>Nom affiché</label><input name="name" required value="${esc(u?.name||'')}"></div>
    <div class="field"><label>Adresse e-mail de connexion</label><input type="email" name="email" required autocapitalize="none" spellcheck="false" value="${esc(u?.email||'')}"></div>
    <div class="field"><label>Rôle</label><select name="role" ${self?'disabled':''}>${roles.map(r=>`<option value="${r}" ${(u?.role||'bureau')===r?'selected':''}>${roleLabel(r)}</option>`).join('')}</select></div>
    <div class="field"><label><input type="checkbox" name="active" ${!u||u.active?'checked':''} ${self?'disabled':''}> Accès ouvert</label>${self?'<div class="muted" style="font-size:11px">Ton propre rôle et ton accès ne se modifient pas ici.</div>':''}</div>
    ${Store.enLigne&&!u?'<div class="field full muted" style="font-size:12px">La personne ouvre ensuite la page de connexion, saisit cette adresse puis « Première connexion ou mot de passe oublié » : elle reçoit un lien pour choisir son mot de passe.</div>':''}
    <div class="field full"><button class="btn pink">Enregistrer</button></div></form>`);
  onSubmit('memberForm',fd=>{
    const data={name:fd.get('name').trim(),email:fd.get('email').trim().toLowerCase()};
    if(!self){data.role=fd.get('role');data.active=fd.get('active')==='on'}
    if(S().members.some(m=>m.id!==u?.id&&(m.email||'').toLowerCase()===data.email)){toast('Cette adresse est déjà celle d’un autre membre.');return false}
    return run(u?Store.update('members',{id:u.id},data):Store.insert('members',{...data,role:data.role||'bureau',active:data.active!==false}),u?'Membre modifié':'Membre ajouté');
  });
}

/* ------------------------------------------------------------ divers */

function openQuickCreate(){
  modal('Créer rapidement',`<div class="grid grid-2">
    <button class="quick-tile" onclick="closeModal();openTaskForm()"><div class="big">✅</div><div class="label">Nouvelle tâche</div></button>
    <button class="quick-tile" onclick="closeModal();${isPresident()?'openProjectForm()':'nav(\'projects\')'}"><div class="big">📋</div><div class="label">Nouveau projet</div></button>
    <button class="quick-tile" onclick="closeModal();openIdeaForm()"><div class="big">💡</div><div class="label">Nouvelle idée</div></button>
    <button class="quick-tile" onclick="closeModal();openRentalForm()"><div class="big">📦</div><div class="label">Nouvelle location</div></button>
  </div>`)
}
function reset(){Store.reinitialise().then(()=>{route='dashboard';routeParam=null;render();toast('Données de démo réinitialisées')})}
function logout(){Store.deconnexion().then(()=>location.replace('connexion/'))}
function versConnexion(motif){location.replace('connexion/'+(motif?'?motif='+encodeURIComponent(motif):''))}

/* Rafraîchissement en ligne : fil de discussion ouvert toutes les 6 s, tout au retour sur l'onglet */
let lastThread='';
function refreshChat(){
  if(!Store.enLigne||route!=='chat'||document.hidden)return;
  Store.recharge(['messages']).then(()=>{const t=$('#chatThread');if(!t)return;const html=chatThreadHtml(routeParam);if(html!==lastThread){lastThread=html;const bas=t.scrollHeight-t.scrollTop-t.clientHeight<40;t.innerHTML=html;if(bas)t.scrollTop=t.scrollHeight}}).catch(()=>{});
}
function refreshAll(){
  if(!Store.enLigne||document.hidden)return;
  Store.recharge().then(()=>{if($('#modal').open)return;if(route==='chat'){refreshChat()}else render()}).catch(err=>{if(err.session)versConnexion('Session expirée : reconnecte-toi.')});
}

$('#userSwitch').addEventListener('change',e=>{Store.changeUtilisateur(e.target.value);render()});
$('#logoutBtn').addEventListener('click',logout);
$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.route,null)));
$('#fab').addEventListener('click',openQuickCreate);
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal()});
Store.onChange=render;

if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').then(reg=>reg.update()).catch(()=>{});navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!sessionStorage.getItem('buro_sw_reloaded')){sessionStorage.setItem('buro_sw_reloaded','1');location.reload();}})}

if(Store.enLigne&&!Sb.session()){versConnexion()}
else{
  Store.init().then(()=>{started=true;render();
    if(Store.enLigne){setInterval(refreshChat,6000);document.addEventListener('visibilitychange',refreshAll)}
  }).catch(err=>{
    if(err.session)return versConnexion('Session expirée : reconnecte-toi.');
    $('#app').innerHTML=`<div class="empty">Chargement impossible : ${esc(err.message||'erreur inconnue')}<br><br><button class="btn" onclick="location.reload()">Réessayer</button> <button class="btn secondary" onclick="logout()">Se déconnecter</button></div>`;
  });
}
