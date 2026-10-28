import {parsePlan,validatePlan} from './plan-contract.js';
const $=id=>document.getElementById(id);
const element=(tag,content,className)=>{const el=document.createElement(tag);if(content!==undefined)el.textContent=content;if(className)el.className=className;return el;};
const storage={get(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,value);return true;}catch{return false;}},remove(key){try{localStorage.removeItem(key);}catch{}}};
let meals=[],selected=null,connection=null,activeId=null;
try{const saved=JSON.parse(storage.get('cooked.meals','[]'));if(Array.isArray(saved))meals=saved.filter(p=>!validatePlan(p).errors.length);}catch{}
let key=storage.get('cooked.key','');
async function api(path,options={},token=key){
 const response=await fetch(path,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'The connection could not be completed.');
 return result;
}
function renderMeals(){
 $('empty').hidden=meals.length>0;
 $('meals').replaceChildren(...meals.map(p=>{
  const card=element('article',undefined,'meal'+(p===selected?' selected':''));
  card.append(element('span',`${p.timeline.length} stages · ${p.dishes.length} ${p.dishes.length===1?'dish':'dishes'}`,'tag'),element('h3',p.menu.title),element('p',`${p.service.label} · Ready ${p.service.targetTime}`));
  const button=element('button','Review meal →','small');button.type='button';button.onclick=()=>review(p);card.append(button);return card;
 }));
}
function review(plan){
 selected=plan;renderMeals();$('review').hidden=false;
 $('reviewTitle').textContent=plan.menu.title;$('description').textContent=plan.menu.description;
 $('facts').replaceChildren(...[`${plan.service.date} · ${plan.service.label}`,`Ready ${plan.service.targetTime}`,plan.timezone].map(v=>element('span',v)));
 const note=plan.provenance?.notes;
 $('planNotes').hidden=typeof note!=='string';$('planNotes').textContent=typeof note==='string'?note:'';
 const {warnings}=validatePlan(plan);$('warningsBox').hidden=!warnings.length;$('warningsTitle').textContent=`${warnings.length} ${warnings.length===1?'quantity note':'quantity notes'} to review`;$('warnings').replaceChildren(...warnings.map(v=>element('li',v)));
 $('stages').replaceChildren(...plan.timeline.map(s=>{
  const row=element('li'),when=element('time',s.scheduledTime);when.dateTime=s.scheduledTime;
  const content=element('div');content.append(element('h3',s.shortLabel),element('p',s.instruction));
  if(s.ingredientAllocations.length){const list=element('ul');for(const a of s.ingredientAllocations){const i=plan.ingredients.find(i=>i.id===a.ingredientId);list.append(element('li',`${i.name} — ${a.quantity===null?'as needed':`${a.quantity} ${a.unit}`}${a.preparation?` · ${a.preparation}`:''}`));}content.append(list);}
  if(s.timer)content.append(element('p',`Timer in plan: ${s.timer.label} · ${Math.round(s.timer.durationSeconds/60*10)/10} min`,'note'));
  row.append(when,content);return row;
 }));
 $('ingredients').replaceChildren(...plan.ingredients.map(i=>{const row=element('li');row.append(element('span',i.name),element('strong',`${i.recipeTotal.quantity} ${i.recipeTotal.unit}`));return row;}));
 $('sendStatus').textContent='Saves this meal for the next time you open COOKED! on Echo.';
 $('review').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
async function refreshActive(){
 if(!key){$('activeLabel').textContent='Connect to see your selected meal.';return;}
 try{const {record}=await api('/api/active');activeId=record?.id||null;$('activeLabel').textContent=record?`${record.plan.menu.title} · Ready ${record.plan.service.targetTime}`:'Connected. Choose your first meal below.';$('openConnection').textContent='Kitchen connected';}
 catch(e){$('activeLabel').textContent='Connection unavailable. Your meals are saved on this browser.';$('openConnection').textContent='Reconnect';}
}
function openImport(){$('importError').textContent='';$('importDialog').showModal();}
$('openImport').onclick=openImport;$('firstImport').onclick=openImport;$('closeImport').onclick=()=>$('importDialog').close();
$('planFile').onchange=async()=>{const file=$('planFile').files[0];if(!file)return;if(file.size>131072){$('importError').textContent='Choose a JSON file smaller than 128 KB.';return;}$('planSource').value=await file.text();};
$('importForm').onsubmit=e=>{
 e.preventDefault();
 try{
  const {plan}=parsePlan($('planSource').value);
  const previous=meals;meals=[plan,...meals.filter(p=>p.planId!==plan.planId)];
  if(!storage.set('cooked.meals',JSON.stringify(meals))){meals=previous;throw new Error('This browser could not save the plan. Free some browser storage, then try again.');}
  $('importDialog').close();review(plan);
 }catch(error){$('importError').textContent=error.message;}
};
$('loadDemo').onclick=async()=>{
 try{const r=await fetch('data/roast-beef-demo.plan.v1.json');if(!r.ok)throw new Error('Demo could not be loaded.');$('planSource').value=JSON.stringify(await r.json(),null,2);$('importForm').requestSubmit();}
 catch(e){openImport();$('importError').textContent=e.message;}
};
$('closeReview').onclick=()=>{$('review').hidden=true;selected=null;renderMeals();};
function tab(showStages){$('stagesPanel').hidden=!showStages;$('ingredientsPanel').hidden=showStages;$('stagesTab').setAttribute('aria-selected',String(showStages));$('ingredientsTab').setAttribute('aria-selected',String(!showStages));}
$('stagesTab').onclick=()=>tab(true);$('ingredientsTab').onclick=()=>tab(false);
for(const id of ['stagesTab','ingredientsTab'])$(id).onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const showStages=id!=='stagesTab';tab(showStages);$(showStages?'stagesTab':'ingredientsTab').focus();}};
async function loadConnection(){
 connection=await api('/api/connection');$('echoSetup').hidden=false;
 const url=connection.publicUrl||location.origin;
 const local= !url.startsWith('https://');
 $('hostingNote').textContent=local?'Local test only: Alexa needs a public HTTPS address before it can fetch the plan. Download this configuration again after hosting.':'This file gives Echo read-only access to your plans. Keep it private.';
 $('downloadConfig').disabled=local;
}
$('openConnection').onclick=async()=>{
 $('connectionKey').value=key;$('connectionDialog').showModal();$('connectionStatus').textContent='';$('echoSetup').hidden=true;
 if(key)try{await loadConnection();}catch(e){$('connectionStatus').textContent=e.message;}
};
$('closeConnection').onclick=()=>$('connectionDialog').close();
$('connectionForm').onsubmit=async e=>{
 e.preventDefault();const candidate=$('connectionKey').value.trim();$('connectionStatus').textContent='Connecting…';
 try{await api('/api/connection',{},candidate);key=candidate;const saved=storage.set('cooked.key',key);await loadConnection();$('connectionStatus').textContent=saved?'Connected. You can now send a meal.':'Connected for this visit. This browser could not remember the key.';await refreshActive();}
 catch(error){$('connectionStatus').textContent=error.message;}
};
$('disconnect').onclick=()=>{key='';connection=null;storage.remove('cooked.key');$('connectionKey').value='';$('echoSetup').hidden=true;$('connectionStatus').textContent='Connection key forgotten on this browser.';$('openConnection').textContent='Connect Echo';refreshActive();};
$('downloadConfig').onclick=()=>{
 if(!connection)return;
 const data={apiUrl:(connection.publicUrl||location.origin).replace(/\/$/,''),readToken:connection.readToken};
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download='cooked-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('sendEcho').onclick=async()=>{
 if(!selected)return;
 if(!key){$('sendStatus').textContent='Connect your kitchen first, then tap Cook on Echo again.';$('openConnection').click();return;}
 const plan=selected,button=$('sendEcho');button.disabled=true;$('sendStatus').textContent='Saving your plan…';
 try{const {record}=await api('/api/active',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan)});activeId=record.id;await refreshActive();if(selected===plan)$('sendStatus').textContent=`Saved ${plan.menu.title}. Open COOKED! on your Echo to load it. A meal already open on Echo stays on its current plan.`;}
 catch(e){$('sendStatus').textContent=`Could not save: ${e.message} Your imported plan is still on this browser.`;}
 finally{button.disabled=false;}
};
renderMeals();refreshActive();
