import assert from 'node:assert/strict';

// Temporary Clerk replacement only. Existing delayed-token fixture is retained.
export const sessionClerkFixture = `
import {useSyncExternalStore} from 'react';
const signedIn=!new URLSearchParams(location.search).has('fixtureSignedOut');
let state={isSignedIn:signedIn,isLoaded:!new URLSearchParams(location.search).has('fixtureAuthLoading'),userId:signedIn?'browser-fixture':null,sessionId:signedIn?'session-browser-fixture':null};
const listeners=new Set();
window.switchFixtureUser=userId=>{state={isSignedIn:Boolean(userId),isLoaded:true,userId,sessionId:userId?'session-'+userId:null};listeners.forEach(fn=>fn());};
window.switchFixtureSession=sessionId=>{state={...state,sessionId};listeners.forEach(fn=>fn());};
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
const getToken=async options=>{
  const user=state.userId;
  const fixture=window.authFixture;
  if(fixture){fixture.calls++;await new Promise(resolve=>setTimeout(resolve,fixture.delayMs));}
  const recovery=window.sessionTokenFixture;
  if(recovery){
    recovery.options.push(options??null);
    if(options?.skipCache){
      recovery.refreshes++;
      if(recovery.delayMs)await new Promise(resolve=>setTimeout(resolve,recovery.delayMs));
      if(recovery.mode==='null')return null;
      if(recovery.mode==='reject')throw new Error('private Clerk detail');
      if(recovery.mode==='hold')await new Promise(resolve=>window.releaseSessionToken=resolve);
    }
  }
  return user;
};
export const useAuth=()=>({...useSyncExternalStore(subscribe,()=>state),getToken});
export const SignedIn=({children})=>useAuth().isSignedIn?children:null;
export const SignedOut=({children})=>useAuth().isSignedIn?null:children;
export const ClerkProvider=({children})=>children;
export const UserButton=()=>null;
export const SignInButton=({children})=>children;
export const SignUpButton=({children})=>children;
`;

const networkFixture = `
window.sessionRequests=[];window.sessionFaults={};
window.sessionTokenFixture={options:[],refreshes:0,mode:'normal',delayMs:0};
const sessionFetch=window.fetch;
window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  const method=init.method??'GET';
  if(url.origin!=='http://127.0.0.1:8000'||!url.pathname.startsWith('/api/items'))return sessionFetch(input,init);
  const row={path:url.pathname,method,body:init.body??null,auth:init.headers?.Authorization};
  window.sessionRequests.push(row);
  const fault=window.sessionFaults[method+' '+url.pathname];
  if(fault?.remaining>0){
    fault.remaining--;row.injected=true;
    if(fault.mode==='network')throw new TypeError('Failed to fetch');
    if(fault.mode==='drop-after-write'){await sessionFetch(input,init);throw new TypeError('Lost response');}
    if(fault.mode==='hang')return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    return new Response(JSON.stringify({detail:'Invalid token: private raw jose error'}),{status:fault.status??401,headers:{'Content-Type':'application/json'}});
  }
  return sessionFetch(input,init);
};
`;

export async function runSessionChecks({ cdp, evaluate, until, fill, click, pause, checks, api }) {
  const input = id => `document.getElementById(${JSON.stringify(id)})`;
  const marker = `sessionStorage.getItem('flipforge:item-assessment:browser-fixture')`;
  const rows = (path, method = 'GET') => `window.sessionRequests.filter(r=>r.path===${JSON.stringify(path)}&&r.method===${JSON.stringify(method)})`;
  const measure = kind => `performance.getEntriesByName('flipforge.items.${kind}_ms')`;
  const faults = async (path, method='GET', remaining=1, extra={}) => evaluate(`window.sessionFaults[${JSON.stringify(method+' '+path)}]=${JSON.stringify({remaining,...extra})}`);
  const refreshes = () => evaluate('window.sessionTokenFixture.refreshes');
  const noRaw = async () => assert.equal(await evaluate(`/Token has expired|Invalid token:|private Clerk detail|Token missing sub/.test(document.body.textContent)`),false);
  const fixture = await cdp('Page.addScriptToEvaluateOnNewDocument',{source:networkFixture});
  async function navigate(path='/items', startup='') {
    await evaluate(`Object.keys(sessionStorage).filter(k=>k.startsWith('flipforge:item-assessment:')).forEach(k=>sessionStorage.removeItem(k));window.beforeSessionNavigation=true`);
    let setup;
    if(startup) setup=await cdp('Page.addScriptToEvaluateOnNewDocument',{source:startup});
    await cdp('Page.navigate',{url:'http://127.0.0.1:5173'+path});
    await until(`!window.beforeSessionNavigation && Boolean(document.querySelector('main')) && Boolean(window.sessionRequests)`);
    if(setup)await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:setup.identifier});
  }
  async function ready() { await until(`document.querySelector('[data-quick-assess]') && !document.querySelector('[aria-label="Buying preferences"] fieldset')?.disabled && !document.body.textContent.includes('Checking AI availability…')`); }
  async function photo() {
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=20;c.height=20;const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const d=new DataTransfer();d.items.add(new File([blob],'session-chair.jpg',{type:'image/jpeg'}));const e=document.querySelector('input[type=file]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelectorAll('.quick-photo img').length===1 && !document.querySelector('[data-quick-assess]').disabled`);
  }
  async function estimate() { await evaluate(`document.querySelector('[data-quick-assess]').click()`); }
  async function complete() { await until(`Boolean(document.querySelector('.quick-resale')) && !document.querySelector('[aria-label="Confirm estimate"] fieldset')?.disabled`); }
  async function checkCount(path, method, count) { assert.equal(await evaluate(`${rows(path,method)}.length`),count); }
  async function sameBodies(path, method) {
    const sent=await evaluate(rows(path,method));assert.equal(sent.length,2);assert.equal(sent[0].body,sent[1].body);return JSON.parse(sent[0].body);
  }
  async function allItems() {
    const items=[];let offset=0;
    while(offset!==null){const page=await api('/api/items?limit=20&offset='+offset);items.push(...page.items);offset=page.next_offset;}
    return items;
  }
  const originalHouses=await api('/api/deals');
  await fetch('http://127.0.0.1:8000/browser-fixture/ai/normal',{method:'POST'});
  await fetch('http://127.0.0.1:8000/browser-fixture/preferences',{method:'DELETE'});
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await navigate('/items',`window.sessionFaults={'GET /api/items/ai-budget':{remaining:1},'GET /api/items/preferences':{remaining:1}};window.sessionTokenFixture.delayMs=120;`);
  await ready();
  await checkCount('/api/items/ai-budget','GET',2);await checkCount('/api/items/preferences','GET',2);
  assert.equal(await refreshes(),2); await noRaw();
  const availability=await evaluate(measure('availability_latest'));
  assert.equal(availability.length,1);assert.ok(availability[0].duration>=120);
  assert.equal((await evaluate(measure('availability_first'))).length,1);
  checks.push('Expired availability and preferences GET each refresh exactly once; one Speed measurement includes refresh time; raw auth details never render');

  await photo();await fill(input('quick-description'),'My owned chair, keep this text');await fill(input('quick-location'),'Atlanta, GA');await fill(input('quick-asking'),'20');
  await faults('/api/items/assess','POST');
  await evaluate(`window.sessionTokenFixture.mode='hold'`);
  const providerBefore=(await api('/browser-fixture/ai')).calls;
  await estimate();await until(`typeof window.releaseSessionToken==='function'`);
  await checkCount('/api/items/assess','POST',1);
  assert.equal((await api('/browser-fixture/ai')).calls,providerBefore);
  assert.equal(await evaluate(input('quick-description')+'.value'),'My owned chair, keep this text');
  assert.equal(await evaluate(input('quick-location')+'.value'),'Atlanta, GA');
  assert.equal(await evaluate('document.querySelectorAll(".quick-photo img").length'),1);
  assert.equal(await evaluate(`document.querySelector('[data-quick-assess]').disabled`),true);
  await evaluate(`window.sessionTokenFixture.mode='normal';window.releaseSessionToken()`);await complete();
  const assessmentBody=await sameBodies('/api/items/assess','POST');
  assert.equal((await api('/browser-fixture/ai')).calls,providerBefore+1);
  assert.equal(assessmentBody.description,'My owned chair, keep this text');assert.equal(assessmentBody.location,'Atlanta, GA');
  assert.equal((await evaluate(measure('assessment'))).length,1);
  checks.push('Assessment 401 keeps photo/text/location and locks in memory; identical request_id and payload retry once; exactly one simulated provider call and one Speed timing');

  await fill(input('item-notes'),'Private note survives refresh');
  await evaluate(`document.querySelector('[data-quick-calculate]').click()`);
  await until(`Boolean(document.querySelector('[data-quick-status]'))`);
  const itemsBefore=(await allItems()).length;
  await faults('/api/items/save','POST');await click('button','Save item');
  await until(`document.querySelector('[aria-label="Save item"] [role=status]')?.textContent.startsWith('Saved version #')`);
  const saveBody=await sameBodies('/api/items/save','POST');
  assert.equal(saveBody.notes,'Private note survives refresh');assert.equal((await allItems()).length,itemsBefore+1);
  const saved=(await api('/api/items')).items[0];
  checks.push('Estimate save retries the identical UUID, inputs and private notes only after 401, producing exactly one saved version');

  await navigate('/my-flips',`window.sessionFaults={'GET /api/items':{remaining:1}}`);
  await until(`Boolean(document.querySelector('[data-saved-item="${saved.id}"]'))`);await checkCount('/api/items','GET',2);
  await faults(`/api/items/${saved.root_item_id}/outcomes`);await click('button','Track this find');
  await until(`Boolean(document.getElementById('outcome-purchase_price')) && !document.querySelector('.item-outcome fieldset')?.disabled`);
  await checkCount(`/api/items/${saved.root_item_id}/outcomes`,'GET',2);
  await click('button','Bought');await fill(input('outcome-purchase_price'),'12');
  await faults(`/api/items/${saved.root_item_id}/outcomes`,'POST');await click('button','Save tracking');
  await until(`document.body.textContent.includes('Tracking saved. Showing the latest outcome.')`);
  const outcomeBody=await sameBodies(`/api/items/${saved.root_item_id}/outcomes`,'POST');
  assert.equal((await api(`/api/items/${saved.root_item_id}/outcomes`)).id,outcomeBody.request_id);
  checks.push('My Flips and tracking GET recover once; tracking POST keeps the same request ID, previous ID and captured facts');

  for(const query of [`?find=${saved.id}`,`?saved=${saved.id}`]){
    await navigate('/items'+query,`window.sessionFaults={'GET /api/items/${saved.id}':{remaining:1}}`);
    await until(`Boolean(document.getElementById(${JSON.stringify(query.includes('find')?'quick-resale_low':'item-resale_low')}))`);
    await checkCount(`/api/items/${saved.id}`,'GET',2); await noRaw();
  }
  checks.push('Single-item GET recovers in both photo and manual reopened editors without saving or reassessing');

  await navigate();await ready();await click('summary','My buying preferences');await fill(input('preference-pickup'),'13');
  await faults('/api/items/preferences','PUT');await click('button','Save preferences');
  await until(`document.body.textContent.includes('Preferences saved for your next find.')`);
  const preferenceBody=await sameBodies('/api/items/preferences','PUT');assert.equal(preferenceBody.pickup,13);
  assert.equal((await api('/api/items/preferences')).pickup,13);
  checks.push('Preferences PUT retries the same captured whole replacement once and stores the expected values');
  await evaluate(`window.sessionRequests=[]`);await fill(input('preference-pickup'),'14');
  await faults('/api/items/preferences','PUT',2);await click('button','Save preferences');
  await until(`document.body.textContent.includes('Sign in again to continue.')`);
  await sameBodies('/api/items/preferences','PUT');await noRaw();
  assert.equal((await api('/api/items/preferences')).pickup,13);
  assert.equal(await evaluate(input('preference-pickup')+'.value'),'14');
  checks.push('Second preferences PUT 401 stops, preserves edited values and the existing uncertainty warning, and leaves the stored profile unchanged');

  // Second 401 POST is definitively unspent; second 401 GET cannot settle a prior POST.
  await navigate();await ready();await photo();await faults('/api/items/assess','POST',2);
  const beforeRejected=(await api('/browser-fixture/ai')).calls;
  await estimate();await until(`document.body.textContent.includes('Sign in again to continue.')`);
  await checkCount('/api/items/assess','POST',2);assert.equal(await evaluate(marker),null);
  assert.equal((await api('/browser-fixture/ai')).calls,beforeRejected);await noRaw();
  assert.equal(await evaluate('document.querySelectorAll(".quick-photo img").length'),1);
  checks.push('Second assessment POST 401 clears recovery, spends nothing, retains the in-memory photo and gives plain sign-in guidance');

  await navigate();await ready();await photo();await faults('/api/items/assess','POST',1,{mode:'drop-after-write'});
  await estimate();await until(`document.body.textContent.includes('Check estimate status')`);
  const retained=await evaluate(marker);assert.ok(retained);
  const lost=await evaluate(rows('/api/items/assess','POST'));const id=JSON.parse(lost[0].body).request_id;
  await faults('/api/items/assessments/'+id,'GET',2);await click('button','Check estimate status');
  await until(`document.body.textContent.includes('Sign in again to continue.')`);
  assert.equal(await evaluate(marker),retained);await checkCount('/api/items/assess','POST',1);await checkCount('/api/items/assessments/'+id,'GET',2);
  await click('button','Check estimate status');await complete();
  await checkCount('/api/items/assess','POST',1);
  checks.push('Lost assessment response is never retried; second status GET 401 retains recovery ID; a later free GET recovers the result without another POST');
  const recoverySetup=await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.sessionFaults={'GET /api/items/assessments/${id}':{remaining:1}};window.sessionTokenFixture.delayMs=120;`});
  await evaluate(`window.beforeRecoveryReload=true`);await cdp('Page.reload');
  await until(`!window.beforeRecoveryReload && document.body.textContent.includes('Recovered your photo estimate')`);
  await until(`${measure('status')}.length===1`);
  await checkCount('/api/items/assessments/'+id,'GET',2);await checkCount('/api/items/assess','POST',0);
  assert.ok((await evaluate(measure('status')))[0].duration>=120);
  assert.equal(await evaluate(marker),retained);
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:recoverySetup.identifier});
  checks.push('Automatic recovery GET refreshes once under StrictMode, keeps the same ID, sends no POST and records one status timing including refresh');

  for(const mode of ['null','reject','hold']){
    await navigate();await ready();await photo();await fill(input('quick-description'),'Keep after failed refresh');
    await faults('/api/items/assess','POST');
    await evaluate(`window.sessionTokenFixture.mode=${JSON.stringify(mode)};${mode==='hold'?`const prior=setTimeout;window.setTimeout=(fn,ms,...args)=>prior(fn,ms===10000?50:ms,...args);`:''}`);
    await estimate();await until(`document.body.textContent.includes('Sign in again to continue.')`);
    await checkCount('/api/items/assess','POST',1);assert.equal(await evaluate(marker),null);await noRaw();
    assert.equal(await evaluate(input('quick-description')+'.value'),'Keep after failed refresh');
    if(mode==='hold'){await evaluate(`window.releaseSessionToken()`);await pause(50);await checkCount('/api/items/assess','POST',1);}
  }
  checks.push('Null, rejected and timed-out Clerk refresh each stop before a second POST, retain inputs, and suppress raw errors; late tokens cannot restart the request');

  for(const change of [`window.switchFixtureUser('other-user')`,`window.switchFixtureUser(null)`,`window.switchFixtureSession('replacement-session')`]){
    await navigate();await ready();await photo();await fill(input('quick-description'),'Private old session');
    await faults('/api/items/assess','POST');await evaluate(`window.sessionTokenFixture.mode='hold'`);
    await estimate();await until(`typeof window.releaseSessionToken==='function'`);
    await evaluate(`${change};window.releaseSessionToken()`);await pause(100);
    await checkCount('/api/items/assess','POST',1);
    assert.equal(await evaluate(input('quick-description')+'?.value'),'');
    assert.equal(await evaluate('document.querySelectorAll(".quick-photo img").length'),0);
    assert.equal(await evaluate(`Boolean(document.querySelector('.quick-resale'))`),false);
  }
  checks.push('Account switch, sign-out and same-user session replacement during refresh prevent retry and clear old photos/text/results');

  // Fire the original deadline deterministically after refresh; no wall-clock race.
  await navigate();await ready();await photo();await faults('/api/items/assess','POST');
  await evaluate(`window.operationDeadlines=[];window.sessionTokenFixture.mode='hold';const prior=setTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===120000){window.operationDeadlines.push(()=>fn(...args));return prior(()=>{},120000);}return prior(fn,ms,...args);};const priorFetch=window.fetch;window.fetch=async(input,init)=>{const response=await priorFetch(input,init);if(new URL(input).pathname==='/api/items/assess'&&response.status===401)window.sessionFaults['POST /api/items/assess']={remaining:1,mode:'hang'};return response;};`);
  await estimate();await until(`typeof window.releaseSessionToken==='function'`);
  assert.equal(await evaluate('window.operationDeadlines.length'),1);
  await evaluate(`window.releaseSessionToken()`);await until(`${rows('/api/items/assess','POST')}.length===2`);
  assert.equal(await evaluate('window.operationDeadlines.length'),1,'Refresh must not start a new operation deadline');
  await evaluate(`window.operationDeadlines[0]()`);
  await until(`document.body.textContent.includes('Check estimate status') && !document.body.textContent.includes('Finding similar listings.')`);
  await checkCount('/api/items/assess','POST',2);assert.ok(await evaluate(marker));
  assert.equal((await evaluate(measure('assessment'))).length,1);
  checks.push('Retry shares the original operation deadline; an unconfirmed second HTTP attempt keeps status recovery and one timing');

  await noRaw();assert.deepEqual(await api('/api/deals'),originalHouses);
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixture.identifier});
}
