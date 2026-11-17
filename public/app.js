'use strict';
const $ = (s, root=document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
 chart:'<path d="M4 3v18h17M8 16v-4m5 4V7m5 9v-6"/>',
 file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8m-8 4h5"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0"/>',
 arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 location:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 logout:'<path d="M9 3H4v18h5m5-14 5 5-5 5m-5-5h10"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
 book:'<path d="M12 5v16M3 3c4-1 7 0 9 2 2-2 5-3 9-2v16c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>'
};
const icon = (name, cls='') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.file}</svg>`;
const navs = [['home','Главная','home'],['schedule','Расписание','calendar'],['grades','Успеваемость','chart'],['requests','Заявки и справки','file'],['notifications','Уведомления','bell']];
const kinds={study:'Справка об обучении',scholarship:'Справка о стипендии',application:'Заявление в деканат'};
const pairs = n => n+' '+(n===1?'пара':n>=2&&n<=4?'пары':'пар');
let state=null, page='home', selectedDay=0, week=false, notificationFilter='all', requestFilter='all';
let activeModal=null, detailVersion=0, requestSubmitting=false, loginEntrancePlayed=false;
let scrollPositions={};
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
async function api(path, data) {
 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
 const requestState=state;
 let response,body;
 try {
  response=await fetch('/api/'+path, {method:data?'POST':'GET', signal:controller.signal, headers:data?{'Content-Type':'application/json','X-CSRF-Token':requestState?.csrf||''}:{}, body:data?JSON.stringify(data):undefined});
  body=await response.json();
 }
 catch(e){if(e instanceof SyntaxError)throw Error('Сервер вернул непонятный ответ. Попробуй ещё раз.');throw Error(e.name==='AbortError'?'Сервер отвечает слишком долго. Попробуй ещё раз.':'Нет связи с сервером. Проверь подключение и повтори действие.');}
 finally {clearTimeout(timer);}
 if(!response.ok) { if(response.status===401 && path!=='login' && requestState && state===requestState)renderLogin('Сессия завершена. Войдите снова.'); throw Error(body?.error||'Не удалось выполнить запрос'); }
 return body;
}
function hideToast({immediate=false}={}){
 const element=$('#toast');clearTimeout(toast.timer);clearTimeout(toast.clearTimer);
 const version=toast.version=(toast.version||0)+1;
 if(immediate)element.classList.add('no-motion');
 element.classList.remove('visible');
 const clear=()=>{if(version===toast.version)element.textContent='';};
 if(immediate||reducedMotion()){clear();getComputedStyle(element).opacity;element.classList.remove('no-motion');}
 else toast.clearTimer=setTimeout(clear,220);
}
function toast(text){
 const element=$('#toast');clearTimeout(toast.timer);clearTimeout(toast.clearTimer);
 toast.version=(toast.version||0)+1;element.textContent=text;element.classList.add('visible');
 toast.timer=setTimeout(()=>hideToast(),Math.max(6500,Math.min(12000,text.length*65)));
}
function dateText(s, opts={day:'numeric',month:'long'}){return new Date(s+'T12:00:00').toLocaleDateString('ru-RU',opts);}
function unread(){return state.notifications.filter(n=>!n.is_read).length;}
function brand(){return '<span class="brand-mark">'+icon('chart')+'</span><span>пульс<span class="brand-dot">.</span></span>';}
function renderLogin(error=''){
 closeModal({immediate:true,restoreFocus:false});state=null;page='home';notificationFilter='all';requestFilter='all';week=false;scrollPositions={};
 $('#app').innerHTML=`<div class="login-layout ${loginEntrancePlayed?'':'login-enter'}"><section class="login-story"><div class="brand">${brand()}</div><div class="login-pitch"><div class="eyebrow">ТВОЙ ЦИФРОВОЙ ДЕКАНАТ</div><h1>Меньше суеты.<br>Больше студенческой<br><span>жизни.</span></h1><p>Расписание, оценки и документы.<br>Всё, что нужно, уже рядом.</p><div class="orbit-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-center">п.</div><span class="art-card art-a">${icon('check')} Справка готова</span><span class="art-card art-b">${icon('calendar')} Всё по плану</span><span class="art-star">✳</span></div></div><small>Конкурсный концепт · Неофициальный сервис</small></section><main id="main" class="login-main"><div class="login-form-wrap"><span class="pill lavender">Рады видеть тебя</span><h2>Привет, студент!</h2><p class="muted">Войди, чтобы быть в курсе своего учебного дня.</p><form id="login-form"><label for="login">Логин</label><input id="login" name="login" autocomplete="username" placeholder="Например, alisa" required maxlength="80"><label for="password">Пароль</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Введи пароль" required maxlength="200"><button type="button" class="password-toggle" id="show-password" aria-label="Показать пароль">Показать</button></div><p id="login-error" class="form-error" role="alert">${esc(error)}</p><button class="button primary full" type="submit">Войти в кабинет ${icon('arrow')}</button></form><div class="demo-box"><div class="demo-title">${icon('spark')} Попробуй без регистрации</div><p>Два вымышленных студента, два разных кабинета.</p><div class="demo-buttons"><button data-demo="alisa">Алиса <span>2 курс</span> ${icon('arrow')}</button><button data-demo="mark">Марк <span>3 курс</span> ${icon('arrow')}</button></div><details><summary>Данные тестовых аккаунтов</summary><p>alisa / PulseDemo1!<br>mark / PulseDemo2!</p><small>Только демонстрационные пароли. Не вводи настоящие данные.</small></details></div><div class="login-safety">${icon('shield')} Конкурсный концепт · Неофициальный сервис. Все данные вымышлены.</div></div></main></div>`;
 loginEntrancePlayed=true;
 $('#login-form').onsubmit=async e=>{e.preventDefault();await login($('#login').value,$('#password').value);};
 $('#show-password').onclick=()=>{const input=$('#password');input.type=input.type==='password'?'text':'password';const visible=input.type==='text';$('#show-password').textContent=visible?'Скрыть':'Показать';$('#show-password').setAttribute('aria-label',visible?'Скрыть пароль':'Показать пароль');};
 document.querySelectorAll('[data-demo]').forEach(b=>b.onclick=()=>{const alisa=b.dataset.demo==='alisa';$('#login').value=alisa?'alisa':'mark';$('#password').value=alisa?'PulseDemo1!':'PulseDemo2!';$('#login-form').requestSubmit();});
}
async function login(name,password){
 hideToast({immediate:true});
 const button=$('#login-form button[type=submit]');if(button.disabled)return;document.querySelectorAll('[data-demo]').forEach(b=>b.disabled=true);button.disabled=true;button.textContent='Входим…';$('#login-error').textContent='';
 try{await api('login',{login:name,password});await load({afterLogin:true});}catch(e){$('#login-error').textContent=e.message;button.disabled=false;button.innerHTML='Войти в кабинет '+icon('arrow');document.querySelectorAll('[data-demo]').forEach(b=>b.disabled=false);}
}
async function load({afterLogin=false}={}){state=await api('bootstrap');const route=location.hash.slice(1);if(navs.some(n=>n[0]===route)||route==='profile')page=route;selectedDay=Math.max(0,state.schedule.findIndex(d=>d.today));render({homeEntrance:page==='home',navigation:!afterLogin&&page!=='home'});if(afterLogin){window.scrollTo({top:0,behavior:'instant'});$('#page-title')?.focus({preventScroll:true});}}
function navigate(next,{fromHistory=false}={}){
 const changed=next!==page;if(changed)scrollPositions[page]=window.scrollY;
 page=next;if(!fromHistory&&changed)history.pushState(null,'','#'+next);closeModal({immediate:true,restoreFocus:false});render({navigation:changed});
 if(changed)window.scrollTo({top:scrollPositions[next]||0,behavior:'instant'});
 $('#page-title')?.focus({preventScroll:true});
}
window.addEventListener('popstate',()=>{
 if(!state)return;
 const route=location.hash.slice(1);
 navigate(navs.some(n=>n[0]===route)||route==='profile'?route:'home',{fromHistory:true});
});
function render({homeEntrance=false,navigation=false,taskId=null,notificationId=null,notificationUpdated=false}={}){
 if(!state)return;
 const user=state.user;
 $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><a href="#home" class="brand" aria-label="Пульс, главная">${brand()}</a><div class="workspace-label">СТУДЕНЧЕСКИЙ КАБИНЕТ</div><nav class="desktop-nav" aria-label="Основная навигация">${navs.map(([id,label,ic])=>`<a href="#${id}" class="nav-item ${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span>${id==='notifications'&&unread()?`<b class="nav-count">${unread()}</b>`:''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="semester-note"><span class="tiny-spark">✳</span><strong>В твоём ритме</strong><p>Всё важное для учёбы.<br>И немного спокойствия.</p><span>Осенний семестр 2026</span></div><button class="sidebar-profile" data-action="profile"><span class="avatar">${esc(user.initials)}</span><span><strong>${esc(user.first_name)}</strong><small>${esc(user.student_group)} · ${user.course} курс</small></span>${icon('chevron')}</button><button class="logout-button" data-action="logout">${icon('logout')} Выйти из аккаунта</button></div></aside><div class="app-body"><header class="topbar"><div class="breadcrumb">Мой кабинет <span>/</span> <strong>${esc(page==='profile'?'Профиль':navs.find(n=>n[0]===page)?.[1])}</strong></div><div class="topbar-right"><span class="today-label">${dateText(state.today,{day:'numeric',month:'long',weekday:'short'})}</span><button class="notification-button" data-go="notifications" aria-label="Уведомления, непрочитанных: ${unread()}">${icon('bell')}${unread()?'<i></i>':''}</button><button class="avatar small" data-action="profile" aria-label="Открыть профиль">${esc(user.initials)}</button></div></header><main id="main" class="content">${renderPage()}</main><footer class="footer"><span><span class="footer-dot"></span> Пульс · Конкурсный концепт</span><span>Неофициальный сервис. Все данные вымышлены.</span></footer></div><nav class="mobile-nav" aria-label="Мобильная навигация">${navs.map(([id,label,ic])=>`<a href="#${id}" class="${page===id?'active':''}" aria-label="${label}" ${page===id?'aria-current="page"':''}>${icon(ic)}<span>${({home:'Главная',schedule:'Расписание',grades:'Оценки',requests:'Заявки',notifications:'Важное'})[id]}</span></a>`).join('')}</nav></div>`;
 bind();
 if(homeEntrance)$('#main').classList.add('home-enter');
 if(navigation)$('.app-shell').classList.add('nav-change');
 // Animate only real navigation/entry, never replays caused by a checkbox or API refresh.
 if(homeEntrance||navigation){
  $('#main').classList.add('section-enter');
  [...$('#main').children].forEach((el,i)=>el.classList.add('motion-step-'+Math.min(i,7)));
 }
 if(taskId!==null)$('[data-task="'+taskId+'"]')?.classList.add('just-updated');
 if(notificationUpdated)$('.app-shell').classList.add('notice-updated');
 if(notificationId!==null)$('[data-notice="'+notificationId+'"]')?.closest('.notification-card')?.classList.add('just-read');
}
function title(kicker,heading,description,action=''){return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1 id="page-title" tabindex="-1">${heading}</h1><p>${description}</p></div>${action}</div>`;}
function renderPage(){return ({home:homePage,schedule:schedulePage,grades:gradesPage,requests:requestsPage,notifications:notificationsPage,profile:profilePage})[page]();}
function homePage(){
 const today=state.schedule.find(d=>d.today), lessons=today?.items||[], pending=state.requests.filter(r=>r.status!=='ready').length, done=state.tasks.filter(t=>t.done).length;
 return `${title('ВСЁ ПОД РУКОЙ',`Привет, ${esc(state.user.first_name)} <span class="wave">✳</span>`,'Хороший день начинается с понятного плана.',`<span class="semester-pill">${icon('book')} Осенний семестр</span>`)}<section class="welcome-banner"><div class="welcome-copy"><span class="pill banner-pill">ТВОЙ УЧЕБНЫЙ РИТМ</span><h2>Учёба — по плану.<span class="welcome-extra"><br>Жизнь — в удовольствие.</span></h2><p>Самое важное на сегодня уже здесь.<br>Остальное успеется.</p><button class="button dark" data-go="schedule">Открыть расписание ${icon('arrow')}</button></div><div class="banner-art" aria-hidden="true"><div class="banner-grid"></div><div class="book-shape book-back"></div><div class="book-shape book-front"><span>MAKE<br>IT<br>HAPPEN<span class="book-period">.</span></span><div class="book-rule"></div><small>ONE DAY AT A TIME</small></div><div class="art-disc">✳</div><div class="mini-card">${icon('check')} Всё под контролем</div></div></section><div class="stat-grid"><button class="stat-card" data-go="schedule"><span class="stat-icon purple">${icon('calendar')}</span><div><span class="stat-label">Занятий сегодня</span><strong>${lessons.length}<small>${lessons.length?'до '+lessons[lessons.length-1].end:'можно выдохнуть'}</small></strong></div>${icon('chevron','stat-chevron')}</button><button class="stat-card" data-go="grades"><span class="stat-icon green">${icon('chart')}</span><div><span class="stat-label">Средний балл</span><strong>${(state.grades.filter(g=>g.grade!=='Зачёт').reduce((a,g)=>a+Number(g.grade),0)/state.grades.filter(g=>g.grade!=='Зачёт').length).toFixed(2).replace('.',',')}<small>из 5,00</small></strong></div>${icon('chevron','stat-chevron')}</button><button class="stat-card" data-go="requests"><span class="stat-icon peach">${icon('file')}</span><div><span class="stat-label">Мои заявки</span><strong>${pending}<small>сохранены в демо</small></strong></div>${icon('chevron','stat-chevron')}</button></div><div class="dashboard-grid"><section class="panel schedule-panel"><div class="section-heading"><h2>Сегодня в расписании <span class="sub-count">${lessons.length}</span></h2><button class="text-button" data-week>Вся неделя ${icon('arrow')}</button></div><div class="section-subtitle">${dateText(state.today,{weekday:'long',day:'numeric',month:'long'})}</div>${lessons.length?lessons.map((l,i)=>lesson(l,i)).join(''):'<div class="empty-state">'+icon('calendar')+'<h3>Сегодня без пар</h3><p>Самое время отдохнуть. План на неделю — в расписании.</p></div>'}<div class="schedule-foot">${icon('info')} Учебное расписание заполнено для демонстрации</div></section><section class="panel tasks-panel"><div class="section-heading"><h2>Не забыть</h2><span class="soft-label">${done} из ${state.tasks.length}</span></div><p class="section-subtitle">Отметки сохранятся после перезагрузки</p>${state.tasks.map(t=>`<button class="task ${t.done?'done':''}" data-task="${t.id}" aria-pressed="${!!t.done}"><span class="checkbox">${t.done?icon('check'):''}</span><span><strong>${esc(t.title)}</strong><small>${esc(t.due)} · ${t.done?'Выполнено':'Нужно сделать'}</small></span></button>`).join('')}<div class="calm-note">${icon('spark')}<p>${done===state.tasks.length?'Все дела выполнены. Можно выдохнуть!':'Не нужно успевать всё.<br>Начни с одного дела.'}</p></div></section>${documentNextStep()}<section class="panel notice-panel"><div class="section-heading"><h2>На связи с деканатом</h2><button class="text-button" data-go="notifications">Все ${icon('arrow')}</button></div>${state.notifications.slice(0,2).map(n=>`<button class="notice-preview" data-notice="${n.id}"><span class="notice-symbol ${n.category==='schedule'?'purple':'peach'}">${icon(n.category==='schedule'?'calendar':'bell')}</span><span><strong>${esc(n.title)}</strong><small>${esc(n.body)}</small></span>${!n.is_read?'<i class="unread-dot"></i>':''}</button>`).join('')}</section></div>`;
}
function documentNextStep(){
 const r=state.requests[0];
 return `<section class="panel documents-panel"><div class="section-heading"><h2>Твой следующий шаг</h2>${icon('file')}</div>${r?`<p class="next-step-title">${esc(kinds[r.kind])}</p><p>${r.status==='ready'?'Демообразец готов. Его можно скачать и посмотреть.':'Заявка сохранена. Проверь данные; обработка в демоверсии недоступна.'}</p><button class="button secondary" data-request="${esc(r.id)}">${icon(r.status==='ready'?'download':'arrow')} ${r.status==='ready'?'Посмотреть образец':'Проверить заявку'}</button>`:'<p>Здесь появится следующий шаг по твоей заявке.</p>'}<button class="text-button" data-action="new-request">${icon('plus')} Заказать справку</button></section>`;
}
function lesson(l,i=0){return `<article class="lesson"><div class="lesson-time"><strong>${esc(l.start)}</strong><span>${esc(l.end)}</span></div><div class="lesson-line color-${i%3}"></div><div class="lesson-info"><div class="lesson-meta"><span>${esc(l.type)}</span>${l.changed?'<span class="change-pill">Изменение</span>':''}</div><h3>${esc(l.name)}</h3><p>${icon('location')} ${esc(l.room)} · ${esc(l.building)} <span class="teacher">· ${esc(l.teacher)}</span></p>${l.changed?`<small class="change-note">${esc(l.change)}</small>`:''}</div></article>`;}
function schedulePage(){return `${title('УЧЁБА В ТВОЁМ РИТМЕ','Расписание','Пары, аудитории и изменения — в одном месте.')}<section class="panel full-panel"><div class="section-heading"><h2>${dateText(state.schedule[0].date)} — ${dateText(state.schedule[6].date)}</h2><div class="segmented"><button class="${!week?'selected':''}" data-view="day" aria-pressed="${!week}">День</button><button class="${week?'selected':''}" data-view="week" aria-pressed="${week}">Неделя</button></div></div><div class="week-picker">${state.schedule.map((d,i)=>`<button data-day="${i}" class="${selectedDay===i?'selected':''} ${d.today?'is-today':''}" aria-pressed="${selectedDay===i}"><span>${dateText(d.date,{weekday:'short'})}</span><strong>${dateText(d.date,{day:'numeric'})}</strong><i>${d.today?'Сегодня':pairs(d.items.length)}</i></button>`).join('')}</div>${(week?state.schedule:[state.schedule[selectedDay]]).map(d=>`<div class="day-block"><h3 class="day-title">${dateText(d.date,{weekday:'long',day:'numeric',month:'long'})}${d.today?' <span class="pill lavender">Сегодня</span>':''}</h3>${d.items.length?d.items.map((l,i)=>lesson(l,i)).join(''):'<div class="empty-state">'+icon('spark')+'<h3>День без занятий</h3><p>В расписании нет пар. Время для себя.</p></div>'}</div>`).join('')}</section>`;}
function gradesPage(){const average=Math.round(state.grades.reduce((s,g)=>s+g.score,0)/state.grades.length);return `${title('ВИДЕН КАЖДЫЙ ШАГ','Успеваемость','Понятная картина твоего учебного прогресса.')}<div class="grade-summary"><section class="panel grade-highlight"><span class="stat-icon green">${icon('chart')}</span><div><p>Средний результат</p><h2>${average}<small> / 100 баллов</small></h2><span class="pill green">Хороший темп</span></div></section><section class="panel"><span class="eyebrow">ОСЕННИЙ СЕМЕСТР</span><h2>6 дисциплин</h2><p class="muted">Оценки ниже — демонстрационные результаты.<br>Сессия начинается 18 декабря.</p></section></div><section class="panel full-panel"><div class="section-heading"><h2>Мои дисциплины</h2><span class="soft-label">2026 / 2027</span></div><div class="grade-list">${state.grades.map(g=>`<article class="grade-row"><div class="subject-icon">${icon('book')}</div><div class="grade-subject"><h3>${esc(g.name)}</h3><p>${g.exam} · ${g.exam_date}</p><div class="score-track"><span class="score-width-${g.score}"></span></div></div><div class="grade-score"><strong>${g.score}<small> / 100</small></strong><span class="pill ${g.grade==='4'?'peach':'green'}">${g.grade==='Зачёт'?'Зачёт':g.grade==='5'?'5 · Отлично':'4 · Хорошо'}</span></div></article>`).join('')}</div></section><div class="info-strip">${icon('info')} Даты сессии и баллы вымышлены. Это демонстрация, а не ведомость университета.</div>`;}
function requestCard(r){return `<button class="request-card" data-request="${esc(r.id)}"><span class="request-card-icon ${r.status==='ready'?'green':'purple'}">${icon('file')}</span><div><h3>${esc(kinds[r.kind])}</h3><p>№ ${esc(r.id.slice(0,8).toUpperCase())} · ${dateText(r.created.slice(0,10))}</p><span class="pill ${r.status==='ready'?'green':'lavender'}">${r.status==='ready'?'Готов образец':'Сохранена в прототипе'}</span><p class="request-next-step">${r.status==='ready'?'Следующий шаг: скачать демообразец':'Следующий шаг: проверить назначение и экземпляры'}</p></div>${icon('chevron')}</button>`;}
function requestsPage(){let items=state.requests.filter(r=>requestFilter==='all'||(requestFilter==='ready'?r.status==='ready':r.status!=='ready'));return `${title('ДЕКАНАТ БЕЗ ОЧЕРЕДИ','Заявки и справки','Твой документ начинается с пары кликов.',`<button class="button primary" data-action="new-request">${icon('plus')} Новая заявка</button>`)}<div class="info-strip lavender">${icon('spark')} Каждая заявка показывает следующий шаг. Тебе не нужно гадать, что делать дальше.</div><section class="panel full-panel"><div class="section-heading"><h2>Мои заявки</h2><span class="soft-label">${state.requests.length}</span></div><div class="filter-tabs">${[['all','Все'],['pending','Сохранённые'],['ready','Готовые']].map(([v,l])=>`<button data-request-filter="${v}" class="${requestFilter===v?'selected':''}" aria-pressed="${requestFilter===v}">${l}</button>`).join('')}</div><div class="request-list">${items.length?items.map(requestCard).join(''):'<div class="empty-state">'+icon('file')+'<h3>Здесь пока пусто</h3><p>Заявки появятся после отправки формы.</p><button class="button secondary" data-action="new-request">Создать заявку</button></div>'}</div></section><div class="info-strip">${icon('info')} Это конкурсный прототип. Заявки сохраняются, но не отправляются в настоящий деканат.</div>`;}
function notificationsPage(){const items=state.notifications.filter(n=>notificationFilter==='all'||!n.is_read);return `${title('НИЧЕГО НЕ УПУСТИТЬ','Уведомления','Объявления, изменения и напоминания.',`<button class="button secondary" data-action="read-all">${icon('check')} Прочитать все</button>`)}<section class="panel full-panel"><div class="filter-tabs">${[['all','Все уведомления'],['unread','Непрочитанные · '+unread()]].map(([v,l])=>`<button data-notice-filter="${v}" class="${notificationFilter===v?'selected':''}" aria-pressed="${notificationFilter===v}">${l}</button>`).join('')}</div>${items.length?items.map(n=>`<article class="notification-card ${!n.is_read?'unread':''}"><span class="stat-icon ${n.category==='schedule'?'purple':n.category==='request'?'green':'peach'}">${icon(n.category==='schedule'?'calendar':n.category==='request'?'file':'bell')}</span><div><div class="notification-meta">${({schedule:'РАСПИСАНИЕ',request:'ДОКУМЕНТЫ',deadline:'ВАЖНОЕ'})[n.category]} ${!n.is_read?'<i class="unread-dot"></i>':''}</div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><div class="notification-actions"><button class="text-button" data-notice="${n.id}">${({schedule:'Открыть расписание',request:'Посмотреть справку',deadline:'Перейти к делам'})[n.category]} ${icon('arrow')}</button>${!n.is_read?`<button class="text-button" data-read="${n.id}">Отметить прочитанным ${icon('check')}</button>`:'<small class="muted">Прочитано</small>'}</div></div></article>`).join(''):'<div class="empty-state">'+icon('check')+'<h3>Ты всё прочитал</h3><p>Ничего важного не осталось за кадром.</p></div>'}</section>`;}
function profilePage(){const u=state.user;return `${title('ТВОЙ КАБИНЕТ','Мой профиль','Вся информация об учёбе в одном месте.')}<section class="panel profile-card"><span class="avatar large">${esc(u.initials)}</span><h2>${esc(u.full_name)}</h2><span class="pill lavender">Студент · ${u.course} курс</span><dl>${[['Институт',u.faculty],['Направление',u.direction],['Группа',u.student_group],['Номер зачётной книжки',u.record_number],['Логин',u.login]].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><div class="info-strip">${icon('shield')} Это вымышленный профиль для демонстрации. Демоаккаунт общий для всех, кто входит под этим логином.</div><button class="button secondary" data-action="logout">${icon('logout')} Выйти из аккаунта</button></section>`;}
function bind(){
 document.querySelectorAll('a[href^="#"]').forEach(a=>a.onclick=e=>{const p=a.getAttribute('href').slice(1);if(navs.some(n=>n[0]===p)){e.preventDefault();navigate(p);}});
 document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));
 document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
 document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{selectedDay=Number(b.dataset.day);week=false;render();$('[data-day="'+b.dataset.day+'"]')?.focus({preventScroll:true});});
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{week=b.dataset.view==='week';render();$('[data-view="'+b.dataset.view+'"]')?.focus({preventScroll:true});});
 document.querySelectorAll('[data-task]').forEach(b=>b.onclick=async()=>{const session=state,id=Number(b.dataset.task);b.disabled=true;try{await api('tasks/toggle',{id});if(state!==session)return;state.tasks.find(t=>t.id===id).done^=1;const hadFocus=document.activeElement===b;render({taskId:id});if(hadFocus)$('[data-task="'+id+'"]')?.focus({preventScroll:true});}catch(e){if(state===session)toast(e.message);b.disabled=false;}});
 document.querySelectorAll('[data-request-filter]').forEach(b=>b.onclick=()=>{requestFilter=b.dataset.requestFilter;render();$('[data-request-filter="'+requestFilter+'"]')?.focus({preventScroll:true});});
 document.querySelectorAll('[data-notice-filter]').forEach(b=>b.onclick=()=>{notificationFilter=b.dataset.noticeFilter;render();$('[data-notice-filter="'+notificationFilter+'"]')?.focus({preventScroll:true});});
 document.querySelectorAll('[data-request]').forEach(b=>b.onclick=()=>requestDetail(b.dataset.request));
 document.querySelectorAll('[data-read]').forEach(b=>b.onclick=()=>readNotice(Number(b.dataset.read)));
 document.querySelectorAll('[data-notice]').forEach(b=>b.onclick=()=>openNotice(Number(b.dataset.notice),b));
 document.querySelectorAll('[data-week]').forEach(b=>b.onclick=()=>{week=true;navigate('schedule');});
}
async function readNotice(id){const session=state,sourcePage=page;try{await api('notifications/read',{id});if(state!==session)return;state.notifications.forEach(n=>{if(id==='all'||n.id===id)n.is_read=1;});render({notificationId:id,notificationUpdated:true});if(page===sourcePage)(id==='all'?$('[data-action="read-all"]'):$('[data-notice="'+id+'"]')||$('[data-notice-filter="unread"]'))?.focus({preventScroll:true});}catch(e){if(state===session)toast(e.message);}}
async function openNotice(id,button){
 const session=state,sourcePage=page;
 const notice=session.notifications.find(n=>n.id===id);if(!notice)return;
 button.disabled=true;
 try{
  if(!notice.is_read){await api('notifications/read',{id});if(state!==session)return;notice.is_read=1;}
  if(page!==sourcePage)return;
  if(notice.category==='schedule'){
   const changed=state.schedule.findIndex(day=>day.date>=state.today&&day.items.some(lesson=>lesson.changed));
   selectedDay=changed<0?Math.max(0,state.schedule.findIndex(day=>day.today)):changed;
   week=changed<0;
  }
  navigate(({schedule:'schedule',request:'requests',deadline:'home'})[notice.category]);
  if(notice.category==='deadline'){$('.tasks-panel')?.scrollIntoView({block:'center'});$('[data-task]')?.focus({preventScroll:true});}
  if(notice.category==='request'){const r=state.requests.find(r=>r.status==='ready');if(r)await requestDetail(r.id);}
 }catch(e){if(state===session)toast(e.message);}
 finally{button.disabled=false;}
}
async function action(a){if(a==='profile')navigate('profile');if(a==='new-request')newRequest();if(a==='read-all')await readNotice('all');if(a==='logout'){try{await api('logout',{});state=null;history.replaceState(null,'','#home');renderLogin();toast('Ты вышел из аккаунта');}catch(e){toast(e.message);}}}
function finishModal(owner,{restoreFocus=true}={}){
 if(!owner||activeModal!==owner)return;
 clearTimeout(owner.timer);owner.panel.removeEventListener('transitionend',owner.onEnd);owner.panel.removeEventListener('transitioncancel',owner.onEnd);
 owner.backdrop.remove();activeModal=null;document.body.classList.remove('modal-open');$('#app').inert=false;
 if(restoreFocus){const target=owner.opener?.isConnected?owner.opener:$('#page-title')||$('#login');target?.focus({preventScroll:true});}
}
function modal(content,{opener=document.activeElement,saved=false}={}){
 detailVersion++;
 if(activeModal){opener=activeModal.opener?.isConnected?activeModal.opener:opener;finishModal(activeModal,{restoreFocus:false});}
 $('#modal-root').innerHTML=`<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="modal-title" ${saved?'aria-describedby="request-status"':''} class="modal"><button class="close-button" data-close aria-label="Закрыть">${icon('close')}</button>${content}</section></div>`;
 const backdrop=$('.modal-backdrop'),panel=$('.modal',backdrop),owner={backdrop,panel,opener,closing:false};activeModal=owner;
 if(saved)panel.classList.add('just-saved');
 document.body.classList.add('modal-open');$('#app').inert=true;
 $('[data-close]',panel).onclick=()=>closeModal();
 backdrop.addEventListener('click',e=>{if(owner.closing){e.preventDefault();e.stopImmediatePropagation();return;}if(e.target===backdrop){if(e.detail<2)closeModal();else{e.preventDefault();$('[data-close]',panel).focus({preventScroll:true});}}},true);
 $('[data-close]',panel).focus({preventScroll:true});
 // A single style flush establishes the CSS start state; controls are live immediately.
 getComputedStyle(panel).opacity;backdrop.classList.add('is-open');
 return owner;
}
function closeModal({immediate=false,restoreFocus=true}={}){
 detailVersion++;
 const owner=activeModal;if(!owner)return;
 if(immediate||reducedMotion()){finishModal(owner,{restoreFocus});return;}
 if(owner.closing)return;
 owner.closing=true;owner.backdrop.classList.add('is-closing');owner.backdrop.classList.remove('is-open');
 owner.onEnd=e=>{if(e.target===owner.panel&&e.propertyName==='opacity')finishModal(owner,{restoreFocus});};
 owner.panel.addEventListener('transitionend',owner.onEnd);owner.panel.addEventListener('transitioncancel',owner.onEnd);
 owner.timer=setTimeout(()=>finishModal(owner,{restoreFocus}),220);
}
document.addEventListener('keydown',e=>{
 const panel=activeModal?.panel;if(!panel)return;
 if(e.key==='Escape'){e.preventDefault();closeModal();return;}
 if(e.key==='Tab'){
  const els=[...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')].filter(el=>el.getClientRects().length);
  const first=els[0],last=els[els.length-1];if(!first)return;
  if(!panel.contains(document.activeElement)){e.preventDefault();first.focus();}
  else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
});
function newRequest(){
 if(activeModal&&!activeModal.closing&&$('#request-form',activeModal.panel))return;
 const owner=modal(`<span class="modal-symbol purple">${icon('file')}</span><div class="eyebrow">БЕЗ БУМАЖНОЙ СУЕТЫ</div><h2 id="modal-title">Новая заявка</h2><p class="muted">Выбери документ — данные профиля добавятся сами.</p><form id="request-form"><label for="kind">Что тебе нужно?</label><select id="kind" name="kind">${Object.entries(kinds).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><label for="purpose">Куда или для чего нужен документ?</label><textarea id="purpose" name="purpose" rows="3" minlength="3" maxlength="500" required placeholder="Например, по месту требования"></textarea><label for="copies">Количество экземпляров</label><select id="copies" name="copies"><option value="1">1 экземпляр</option><option value="2">2 экземпляра</option><option value="3">3 экземпляра</option></select><div class="info-strip">${icon('info')} Это общий демоаккаунт. Используй вымышленное назначение без личных данных.</div><p id="request-error" class="form-error" role="alert"></p><button class="button primary full" type="submit">Отправить заявку ${icon('arrow')}</button></form>`);
 const form=$('#request-form'),button=$('[type=submit]',form);
 const setBusy=()=>{button.disabled=requestSubmitting;button.setAttribute('aria-busy',String(requestSubmitting));button.innerHTML=requestSubmitting?'Сохраняем…':'Отправить заявку '+icon('arrow');};setBusy();
 form.onsubmit=async e=>{
  e.preventDefault();if(requestSubmitting||activeModal!==owner||owner.closing)return;
  const session=state,payload={kind:$('#kind',form).value,purpose:$('#purpose',form).value.trim(),copies:Number($('#copies',form).value)};
  if(payload.purpose.length<3){$('#request-error',form).textContent='Укажи назначение: минимум 3 символа.';$('#purpose',form).focus();return;}
  const fingerprint=JSON.stringify(payload);
  owner.attempts??=new Map();
  if(!owner.attempts.has(fingerprint)){
   const bytes=crypto.getRandomValues(new Uint8Array(16));
   owner.attempts.set(fingerprint,Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''));
  }
  payload.retry_key=owner.attempts.get(fingerprint);
  requestSubmitting=true;setBusy();$('#request-error',form).textContent='';
  try{
   const result=await api('requests',payload);if(state!==session)return;
   if(!state.requests.some(r=>r.id===result.id))state.requests.unshift(result.request);
   if(activeModal===owner&&!owner.closing){closeModal({immediate:true,restoreFocus:false});requestFilter='all';navigate('requests');requestDetail(result.id,{saved:true,record:result.request});}
   else {if(!activeModal)render();toast('Заявка сохранена. Всё получилось!');}
  }catch(error){if(state!==session)return;if(activeModal===owner&&!owner.closing)$('#request-error',form).textContent=error.message;else toast(error.message);}
  finally{requestSubmitting=false;const current=$('#request-form [type=submit]');if(current){current.disabled=false;current.setAttribute('aria-busy','false');current.innerHTML='Отправить заявку '+icon('arrow');}}
 };

}
async function requestDetail(id,{saved=false,record=null}={}){const version=++detailVersion,session=state,opener=document.activeElement;try{const r=record??await api('requests/'+encodeURIComponent(id));if(version!==detailVersion||state!==session)return;const ready=r.status==='ready';modal(`<span class="modal-symbol ${ready?'green':'purple'}">${icon(ready||saved?'check':'file')}</span><span id="request-status" class="pill ${ready?'green':'lavender'}">${ready?'Готов образец':'Сохранена в прототипе'}</span><h2 id="modal-title">${esc(kinds[r.kind])}</h2><p class="muted">№ ${esc(r.id.slice(0,8).toUpperCase())} · ${dateText(r.created.slice(0,10))}</p><div class="request-timeline"><div class="timeline-step complete"><span>${icon('check')}</span><div><strong>Заявка сохранена</strong><p>Документ: ${esc(kinds[r.kind])}</p></div></div><div class="timeline-step ${ready?'complete':''}"><span>${icon(ready?'check':'clock')}</span><div><strong>${ready?'Демонстрационный образец готов':'Следующий шаг — проверить данные'}</strong><p>${ready?'Можно скачать текстовый образец.':'Проверь назначение и число экземпляров ниже. Больше ничего делать не нужно: обработка деканатом в демоверсии недоступна.'}</p></div></div></div><dl class="request-data"><div><dt>Назначение</dt><dd>${esc(r.purpose)}</dd></div><div><dt>Экземпляров</dt><dd>${r.copies}</dd></div></dl>${ready?`<a href="/api/requests/${esc(r.id)}/download" class="button primary full" download>${icon('download')} Скачать демообразец</a><p class="fine-print">Образец не имеет юридической силы.</p>`:'<div class="info-strip">'+icon('shield')+'Заявка сохранится в этом демоаккаунте после перезагрузки.</div>'}`,{opener,saved});}catch(e){if(version===detailVersion&&state===session)toast(e.message);}}
(async()=>{try{await load();}catch(e){if(!state)renderLogin(e.message.includes('Войдите')?'':e.message);}})();
