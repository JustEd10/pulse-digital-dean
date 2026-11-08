/* Isolated tests of the real app's async/modal logic; no browser or network.
 * Run with Node 18+: node tests/test_motion.js
 * This deliberately does not claim to test rendering, CSS or a screen reader.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function environment(){
 const timers=new Map(),connections=[],events={};let time=0,nextTimer=1,reduced=false;
 const doc={activeElement:null,addEventListener:(name,fn)=>events[name]=fn};
 class Element{
  constructor(name){this.name=name;this.children={};this.isConnected=true;this.disabled=false;this.attributes={};this.listeners={};this.textContent='';this.value='';this._html='';const set=new Set();this.classList={add:(...v)=>v.forEach(x=>set.add(x)),remove:(...v)=>v.forEach(x=>set.delete(x)),contains:x=>set.has(x),toggle:(x,value)=>value===false?set.delete(x):set.add(x)};}
  querySelector(s){return this.children[s]||null;}
  querySelectorAll(){return this.focusables||[];}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  getClientRects(){return this.isConnected?[{}]:[];}
  focus(){doc.activeElement=this;}
  contains(el){return el===this||(this.focusables||[]).includes(el);}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);}
  fire(type,event){for(const fn of [...(this.listeners[type]||[])])fn(event);}
  remove(){this.isConnected=false;if(this===nodes['.modal-backdrop']){for(const el of this.allChildren)el.isConnected=false;for(const key of ['.modal-backdrop','.modal','#request-form'])delete nodes[key];}}
  get innerHTML(){return this._html;}
  set innerHTML(html){this._html=html;if(this.name!=='root')return;createModal(html);}
 }
 const nodes={'#app':new Element('app'),'#toast':new Element('toast'),'#modal-root':new Element('root'),'#page-title':new Element('title'),'#login':new Element('login')};
 function createModal(html){
  const backdrop=new Element('backdrop'),panel=new Element('panel'),close=new Element('close');
  close.setAttribute('aria-label','Закрыть');backdrop.children['.modal']=panel;panel.children['[data-close]']=close;
  const all=[panel,close];panel.focusables=[close];
  if(html.includes('id="request-form"')){
   const form=new Element('form'),submit=new Element('submit'),error=new Element('error');
   for(const id of ['kind','purpose','copies']){const el=new Element(id);form.children['#'+id]=el;all.push(el);}
   form.children['#kind'].value='study';form.children['#purpose'].value='Тестовая заявка';form.children['#copies'].value='2';
   form.children['[type=submit]']=submit;form.children['#request-error']=error;panel.focusables.push(form.children['#kind'],form.children['#purpose'],form.children['#copies'],submit);
   panel.children['#request-form']=form;nodes['#request-form']=form;all.push(form,submit,error);
  }else if(html.includes('download')){const link=new Element('download');panel.focusables.push(link);all.push(link);}
  backdrop.allChildren=all;nodes['.modal-backdrop']=backdrop;nodes['.modal']=panel;
 }
 doc.querySelector=s=>s==='#request-form [type=submit]'?nodes['#request-form']?.querySelector('[type=submit]')||null:nodes[s]||null;
 doc.querySelectorAll=()=>[];doc.body=new Element('body');
 const opener=new Element('opener');doc.activeElement=opener;
 const context=vm.createContext({document:doc,window:{scrollY:0,scrollTo(){}},history:{replaceState(){}},location:{hash:''},matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({opacity:'0'}),setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:time+ms});return id;},clearTimeout:id=>timers.delete(id)});
 const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 const boot=source.lastIndexOf('(async()=>{try{await load();}');assert.ok(boot>0,'Find startup without executing requests');
 vm.runInContext(source.slice(0,boot),context);
 const run=code=>vm.runInContext(code,context);
 run("state={user:{id:1},requests:[]};render=()=>{};navigate=next=>{page=next;};");
 function advance(ms){const end=time+ms;while(true){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;time=entry[1].at;timers.delete(entry[0]);entry[1].fn();}time=end;}
 return {run,nodes,doc,context,opener,events,advance,reduce:value=>reduced=value,post:()=>nodes['#request-form'].onsubmit({preventDefault(){}})};
}
const saved={id:'motion-test',user_id:1,kind:'study',purpose:'Тестовая заявка',copies:2,status:'submitted',created:'2026-11-08T10:00:00+03:00'};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}

async function runChecks(){
 const results=[];
 async function check(name,fn){await fn();results.push(name);}
 await check('animated close retains background lock until completion and restores focus',()=>{
  const e=environment();e.run('newRequest()');assert.equal(e.nodes['#app'].inert,true);assert.equal(e.doc.activeElement.name,'close');e.run('closeModal()');e.advance(219);assert.ok(e.nodes['.modal']);e.advance(1);assert.equal(e.nodes['.modal'],undefined);assert.equal(e.nodes['#app'].inert,false);assert.equal(e.doc.activeElement,e.opener);
 });
 await check('reduced-motion branch closes immediately',()=>{const e=environment();e.reduce(true);e.run('newRequest();closeModal()');assert.equal(e.nodes['.modal'],undefined);assert.equal(e.nodes['#app'].inert,false);});
 await check('reopening cancels stale exit cleanup',()=>{const e=environment();e.run('newRequest();closeModal();newRequest()');const next=e.run('activeModal');e.advance(300);assert.equal(e.run('activeModal'),next);assert.equal(e.nodes['#app'].inert,true);});
 await check('double open preserves draft and trailing backdrop click restores focus',()=>{
  const e=environment();e.run('newRequest()');const owner=e.run('activeModal');e.nodes['#request-form'].children['#purpose'].value='Черновик';e.run('newRequest()');assert.equal(e.run('activeModal'),owner);assert.equal(e.nodes['#request-form'].children['#purpose'].value,'Черновик');e.doc.activeElement=e.opener;owner.backdrop.fire('click',{target:owner.backdrop,detail:2,preventDefault(){},stopImmediatePropagation(){}});assert.equal(e.doc.activeElement.name,'close');assert.equal(owner.closing,false);
 });
 await check('Tab and Escape preserve the modal focus contract',()=>{
  const e=environment();e.run('newRequest()');let prevented=false;e.events.keydown({key:'Tab',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(e.doc.activeElement.name,'submit');e.events.keydown({key:'Tab',shiftKey:false,preventDefault(){}});assert.equal(e.doc.activeElement.name,'close');e.events.keydown({key:'Escape',preventDefault(){}});const owner=e.run('activeModal');owner.panel.fire('transitionend',{target:owner.panel,propertyName:'opacity'});assert.equal(e.run('activeModal'),null);assert.equal(e.doc.activeElement,e.opener);
 });
 await check('double submit sends once; success waits for the server; toast holds 6500 ms',async()=>{
  const e=environment(),pending=deferred();let posts=0;e.context.api=async path=>{if(path==='requests'){posts++;return pending.promise;}return saved;};e.run('newRequest()');const first=e.post();await e.post();assert.equal(posts,1);assert.equal(e.run('state.requests.length'),0);assert.equal(e.nodes['#toast'].classList.contains('visible'),false);pending.resolve({id:saved.id,request:saved});await first;await Promise.resolve();assert.equal(e.run('state.requests.length'),1);assert.equal(e.nodes['#toast'].classList.contains('visible'),true);e.advance(6499);assert.equal(e.nodes['#toast'].classList.contains('visible'),true);e.advance(1);assert.equal(e.nodes['#toast'].classList.contains('visible'),false);e.advance(220);assert.equal(e.nodes['#toast'].textContent,'');
 });
 await check('server error enables retry without success or data mutation',async()=>{
  const e=environment();e.context.api=async()=>{throw Error('Ошибка сервера');};e.run('newRequest()');await e.post();const form=e.nodes['#request-form'];assert.equal(form.children['#request-error'].textContent,'Ошибка сервера');assert.equal(form.children['[type=submit]'].disabled,false);assert.equal(e.run('state.requests.length'),0);assert.equal(e.nodes['#toast'].classList.contains('visible'),false);
 });
 await check('late response cannot inject another account data',async()=>{
  const e=environment(),pending=deferred();e.context.api=()=>pending.promise;e.run('newRequest()');const first=e.post();e.run('state={user:{id:2},requests:[]}');pending.resolve({id:saved.id,request:saved});await first;assert.equal(e.run('state.requests.length'),0);assert.equal(e.nodes['#toast'].classList.contains('visible'),false);
 });
 await check('dismissed detail request cannot reopen a modal later',async()=>{
  const e=environment(),pending=deferred();e.context.api=()=>pending.promise;const request=e.run("requestDetail('motion-test')");e.run('closeModal({immediate:true})');pending.resolve(saved);await request;assert.equal(e.run('activeModal'),null);
 });
 await check('new toast survives the previous toast expiry',()=>{const e=environment();e.run("toast('Первое')");e.advance(6400);e.run("toast('Второе')");e.advance(200);assert.equal(e.nodes['#toast'].textContent,'Второе');assert.equal(e.nodes['#toast'].classList.contains('visible'),true);e.advance(6300);assert.equal(e.nodes['#toast'].classList.contains('visible'),false);});
 await check('closed pending form cannot replace a newly opened draft',async()=>{
  const e=environment(),pending=deferred();e.context.api=()=>pending.promise;e.run('newRequest()');const first=e.post();e.run('closeModal()');e.advance(220);e.run('newRequest()');const next=e.run('activeModal');e.nodes['#request-form'].children['#purpose'].value='Другой черновик';pending.resolve({id:saved.id,request:saved});await first;assert.equal(e.run('activeModal'),next);assert.equal(e.nodes['#request-form'].children['#purpose'].value,'Другой черновик');assert.equal(e.nodes['#request-form'].children['[type=submit]'].disabled,false);
 });
 return {passed:results.length,checks:results,scope:'isolated DOM/timer models, not browser rendering'};
}
module.exports={runChecks};
if(require.main===module)runChecks().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
