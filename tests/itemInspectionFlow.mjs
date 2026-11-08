import assert from 'node:assert/strict';

// UI -> released inspection API -> disposable DB. Only network failures/auth are injected.
export async function runInspectionChecks({cdp,evaluate,until,fill,click,measure,screenshot,checks,api,pause}) {
  const post=async(path,body)=>{
    const res=await fetch('http://127.0.0.1:8000'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer browser-fixture'},body:JSON.stringify(body)});
    assert.equal(res.status,201,await res.clone().text());return res.json();
  };
  const root=await post('/api/items/save',{inputs:{item_name:'Inspection fixture — description says chair works'},notes:'Chair height works. Mirra 2. Do not infer this.'});
  const other=await post('/api/items/save',{inputs:{item_name:'Another inspection project'}});
  const path=`/api/items/${root.id}/inspections`;
  const beforeAI=await api('/browser-fixture/ai');
  const beforeProject=await api(`/api/items/${root.id}/project`);
  const fixture=await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.inspectionRows=[];window.inspectionFault={};window.inspectionGetFault={};window.allInspectionRequests=[];
    const inspectionFetch=window.fetch;
    window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href),method=init.method??'GET';
      if(url.origin!=='http://127.0.0.1:8000')return inspectionFetch(input,init);
      window.allInspectionRequests.push({path:url.pathname,method});
      if(!url.pathname.endsWith('/inspections'))return inspectionFetch(input,init);
      const row={path:url.pathname,method,body:init.body??null};window.inspectionRows.push(row);
      const fault=method==='POST'?window.inspectionFault:window.inspectionGetFault;
      if(fault.remaining>0){
        fault.remaining--;
        if(fault.mode==='network')throw new TypeError('Fixture offline');
        if(fault.mode==='lost'){await inspectionFetch(input,init);throw new TypeError('Fixture lost response');}
        if(fault.mode==='hold') { const response=await inspectionFetch(input,{...init,signal:undefined});await new Promise(resolve=>window.releaseInspection=resolve);return response; }
        if(fault.mode==='malformed'){const response=await inspectionFetch(input,init);const data=await response.json();return Response.json({...data,source:'ai'});}
        if(fault.mode==='mismatch'){const response=await inspectionFetch(input,init);const data=await response.json();return Response.json({...data,inputs:{...data.inputs,notes:'Wrong response contents'}});}
        return Response.json({detail:'Invalid token: private fixture detail'},{status:fault.status??503});
      }
      return inspectionFetch(input,init);
    };
  `});
  const field=key=>`document.getElementById('inspection-${key}')`;
  const ready=`document.querySelector('.inspection-editor fieldset') && !document.querySelector('.inspection-editor fieldset').disabled`;
  const message=text=>`document.querySelector('.inspection-editor')?.textContent.includes(${JSON.stringify(text)})`;
  const rows=()=>evaluate(`window.inspectionRows.filter(r=>r.method==='POST')`);
  const fault=(value,get=false)=>evaluate(`${get?'window.inspectionGetFault':'window.inspectionFault'}=${JSON.stringify({remaining:1,...value})}`);
  const saved=async()=>{await click('button','Save inspection');await until(message('Inspection saved. Latest revision confirmed.')+' && '+ready);};
  await cdp('Page.navigate',{url:'http://127.0.0.1:5173/my-flips'});
  await until(`Boolean(document.querySelector('[aria-label="Open project ${root.id}"]'))`);
  // Hold initial GET: loading must be read-only, then fail it deliberately.
  await fault({status:503},true);
  await evaluate(`document.querySelector('[aria-label="Open project ${root.id}"]').click()`);
  await until(message('Your observations have not been replaced.'));
  assert.ok(await evaluate(`document.querySelector('.inspection-editor fieldset').disabled`));
  assert.deepEqual(await rows(),[]);assert.equal(await api(path),null);
  await click('button','Reload inspection');await until(ready);
  assert.ok(await evaluate(message('No saved inspection yet')));
  assert.equal(await evaluate(field('kind')+'.value'),'general');
  assert.equal(await evaluate(field('label_text')+'.value'),'');assert.equal(await evaluate(field('notes')+'.value'),'');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.inspection-checks select')).every(e=>e.value==='unchecked')`));
  checks.push('Inspection load failure is retryable and read-only; empty project does not infer answers/model from old descriptions');

  await fill(field('kind'),'chair');await fill(field('brand_hint'),'herman_miller');
  const label='  <b>FO 12345</b>\n uncertain: ?  ';
  const notes='  Exact observations\n'+('Long notes beyond the paid description limit. '.repeat(25));
  await fill(field('label_text'),label);await fill(field('notes'),notes);await fill(field('chair-height'),'issue');
  await evaluate(`window.inspectionConfirm=window.confirm;window.confirmCalls=0;window.confirm=()=>{window.confirmCalls++;return false;}`);
  await click('a','My Flips');assert.equal(await evaluate('location.pathname'),`/my-flips/${root.id}`);
  await evaluate('history.back()');await until('window.confirmCalls===2');await until(`location.pathname==='/my-flips/${root.id}'`);
  assert.equal(await evaluate(field('notes')+'.value'),notes);
  await fill(field('kind'),'storage');assert.equal(await evaluate(field('kind')+'.value'),'chair');
  await evaluate('window.confirm=window.inspectionConfirm');
  await saved();
  let latest=await api(path);assert.equal(latest.revision_number,1);assert.equal(latest.inputs.label_text,label);assert.equal(latest.inputs.notes,notes);assert.equal(latest.inputs.inspected_on,null);
  assert.equal(latest.inputs.answers['chair-height'],'issue');assert.equal(latest.source,'user_reported');
  assert.equal(await evaluate(`Boolean(document.querySelector('.inspection-editor b'))`),false);
  checks.push('Explicit save persists exact plain text beyond 500 characters, unchecked answers and unknown date; cancelled links/Back/category switches preserve the draft');

  for(const width of [390,1440]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:width===390});
    await evaluate(`document.querySelector('.inspection-editor').scrollIntoView()`);
    assert.ok(await measure('document.documentElement.scrollWidth<=innerWidth'));
    assert.ok(await measure(`Array.from(document.querySelectorAll('.inspection-editor input,.inspection-editor select,.inspection-editor textarea,.inspection-editor button')).filter(e=>e.getBoundingClientRect().height).every(e=>e.getBoundingClientRect().height>=44)`));
    await screenshot(`photo-inspection-editor-${width}.png`);
  }
  checks.push('Inspection editor renders at 390/1440 without overflow, with labeled controls and 44px targets');
  await fill(field('label_text'),'x'.repeat(501));const beforeValidation=(await rows()).length;
  await click('button','Save inspection');await until(message('Check the highlighted'));
  assert.equal((await rows()).length,beforeValidation);assert.equal(await evaluate(field('label_text')+'.value.length'),501);
  await fill(field('label_text'),label);await fault({status:422});await click('button','Save inspection');await until(message('The inspection was rejected'));
  assert.equal(await evaluate(field('notes')+'.value'),notes);assert.ok(await evaluate(ready));
  await fill(field('notes'),'Failed save draft');await fault({mode:'network'});await click('button','Save inspection');await until(message('may already be saved'));
  const uncertain=(await rows()).at(-1).body;
  assert.ok(await evaluate(`document.querySelector('.inspection-editor fieldset').disabled`));
  // Even a synthetic input event cannot mutate the frozen retry snapshot.
  await fill(field('notes'),'Do not submit this edit');
  assert.equal(await evaluate(field('notes')+'.value'),'Failed save draft');
  await click('button','Retry same inspection save');await until(message('Latest revision confirmed.'));
  assert.equal((await rows()).at(-1).body,uncertain);assert.equal((await api(path)).inputs.notes,'Failed save draft');
  checks.push('Client/server validation keeps entries; network uncertainty freezes edits and manual retry sends byte-identical request ID/payload');

  await fill(field('notes'),'Lost response draft');await fault({mode:'lost'});await click('button','Save inspection');await until(message('may already be saved'));
  const lost=(await rows()).at(-1).body;latest=await api(path);
  const newer=await post(path,{...latest.inputs,notes:'Newer other-device observations <img src=x onerror=alert(1)>',request_id:crypto.randomUUID(),expected_previous_id:latest.id});
  await click('button','Retry same inspection save');await until(message('but a newer inspection is now saved'));
  assert.equal((await rows()).at(-1).body,lost);assert.equal(await evaluate(field('notes')+'.value'),'Lost response draft');
  assert.equal(await evaluate(`document.querySelector('[data-inspection-server]').dataset.inspectionServer`),newer.id);
  assert.equal(await evaluate(`document.querySelector('.inspection-snapshot img')`),null);
  assert.equal((await api(path)).id,newer.id);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await measure('document.documentElement.scrollWidth<=innerWidth'));await screenshot('photo-inspection-conflict-390.png');
  const count=(await rows()).length;
  await click('button','Keep my draft for next revision');assert.equal((await rows()).length,count);
  await saved();latest=await api(path);assert.equal(latest.previous_id,newer.id);assert.equal(latest.inputs.notes,'Lost response draft');
  checks.push('Lost-response replay returns its original revision while GET detects newer work; both versions remain visible and keeping the draft requires a separate explicit save');

  await fill(field('notes'),'409 retained draft');
  let external=await post(path,{...latest.inputs,notes:'External conflict notes',request_id:crypto.randomUUID(),expected_previous_id:latest.id});
  await fault({status:503},true);await click('button','Save inspection');await until(message('Your observations have not been replaced.'));
  assert.equal(await evaluate(field('notes')+'.value'),'409 retained draft');await click('button','Reload inspection');await until(message('This save conflicted'));
  assert.equal(await evaluate(field('notes')+'.value'),'409 retained draft');
  await evaluate('window.confirm=()=>false');await click('button','Use saved version');assert.equal(await evaluate(field('notes')+'.value'),'409 retained draft');
  await evaluate('window.confirm=()=>true');await click('button','Use saved version');await until(ready);assert.equal(await evaluate(field('notes')+'.value'),'External conflict notes');
  assert.equal((await api(path)).id,external.id);
  checks.push('409 and failed conflict reload preserve all draft entries; replacing them with server data requires an explicit confirmed choice');

  await fill(field('notes'),'Confirmed save, failed read');await fault({status:503},true);await click('button','Save inspection');await until(message('Your save was confirmed.'));
  assert.equal(await evaluate(field('notes')+'.value'),'Confirmed save, failed read');
  assert.ok(await evaluate(`document.querySelector('.inspection-editor fieldset').disabled`));
  const readCount=(await rows()).length;await click('button','Reload inspection');await until(message('Latest revision confirmed.'));
  assert.equal((await rows()).length,readCount);
  for(const mode of ['malformed','mismatch']){
    await fill(field('notes'),'Unconfirmed '+mode);await fault({mode});await click('button','Save inspection');await until(message('may already be saved'));
    const request=(await rows()).at(-1).body;await click('button','Retry same inspection save');await until(message('Latest revision confirmed.'));
    assert.equal((await rows()).at(-1).body,request);
  }
  checks.push('Confirmed-save read failure retains the draft and retries only GET; malformed schema/source or mismatched response facts remain uncertain until exact replay confirms');

  await fill(field('notes'),'Auth refresh snapshot');await fault({status:401});await saved();
  const authRows=(await rows()).slice(-2);assert.equal(authRows[0].body,authRows[1].body);
  await fill(field('notes'),'Double auth rejection');await fault({status:401,remaining:2});await click('button','Save inspection');await until(message('Sign in again to continue.'));
  assert.ok(await evaluate(ready));assert.equal(await evaluate(field('notes')+'.value'),'Double auth rejection');
  assert.equal(await evaluate(`document.body.textContent.includes('private fixture detail')`),false);
  // Pending uncertain request must not survive a same-account session change.
  await fault({mode:'network'});await click('button','Save inspection');await until(message('may already be saved'));
  await evaluate(`window.switchFixtureSession('inspection-new-session')`);await until(ready);
  assert.equal(await evaluate(field('notes')+'.value'),'Auth refresh snapshot');
  assert.equal(await evaluate(message('Retry same inspection save')),false);
  checks.push('401 refresh reuses the exact write; double-401 preserves editable draft without raw auth errors; session change clears uncertain pending payload and draft');

  // Hold a successful POST response across account changes; ignore abort deliberately.
  await fill(field('notes'),'Late old-account save');await fault({mode:'hold'});await click('button','Save inspection');await until(`typeof window.releaseInspection==='function'`);
  await evaluate(`window.switchFixtureUser('inspection-other-owner')`);await until(`document.body.textContent.includes('Item not found.')`);
  await evaluate('window.releaseInspection()');await pause(150);
  assert.equal(await evaluate(`document.querySelector('.inspection-editor')`),null);
  await evaluate(`window.switchFixtureUser('browser-fixture')`);await until(ready);
  assert.equal(await evaluate(field('notes')+'.value'),'Late old-account save','Only a new owned GET may load the saved record');
  // Hold a stale GET across a session change, then save in the new session.
  await evaluate(`window.releaseInspection=undefined`);await fault({mode:'hold'},true);await evaluate(`window.switchFixtureSession('inspection-held-read')`);
  await until(`typeof window.releaseInspection==='function'`);
  await evaluate(`window.switchFixtureSession('inspection-fresh-read')`);await until(ready);
  await fill(field('notes'),'Fresh session draft');await evaluate('window.releaseInspection()');await pause(150);
  assert.equal(await evaluate(field('notes')+'.value'),'Fresh session draft');
  checks.push('Late successful POST and held GET from old identities cannot repaint the next account/session or erase its draft');

  await saved();await click('a','My Flips');await until(`Boolean(document.querySelector('[aria-label="Open project ${other.id}"]'))`);
  await evaluate(`document.querySelector('[aria-label="Open project ${other.id}"]').click()`);await until(ready);
  assert.equal(await evaluate(field('notes')+'.value'),'');assert.equal(await api(`/api/items/${other.id}/inspections`),null);
  await fill(field('notes'),'Unsaved different root');await evaluate('window.confirm=()=>true');await click('a','My Flips');
  await until(`Boolean(document.querySelector('[aria-label="Open project ${root.id}"]'))`);await evaluate(`document.querySelector('[aria-label="Open project ${root.id}"]').click()`);await until(ready);
  assert.equal(await evaluate(field('notes')+'.value'),'Fresh session draft');
  await fill(field('kind'),'storage');await fill(field('storage-moving'),'okay');await fill(field('inspected_on'),'2026-11-08');await saved();latest=await api(path);
  assert.equal(latest.inputs.kind,'storage');assert.equal(latest.inputs.brand_hint,null);assert.equal(latest.inputs.inspected_on,'2026-11-08');
  assert.ok(Object.keys(latest.inputs.answers).every(key=>key.startsWith('storage-')));
  checks.push('Root switches discard only after confirmation and never copy drafts between items; explicit category/date change writes only the chosen category checks');

  assert.deepEqual(await api(`/api/items/${root.id}/project`),beforeProject);assert.deepEqual(await api('/api/items/'+root.id),root);
  const afterAI=await api('/browser-fixture/ai');assert.equal(afterAI.calls,beforeAI.calls);assert.equal(afterAI.posts,beforeAI.posts);
  const writes=await evaluate(`window.allInspectionRequests.filter(r=>r.method!=='GET')`);
  assert.ok(writes.every(row=>row.path.endsWith('/inspections')));
  assert.equal(await evaluate(`Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(k=>/inspection/i.test(k))`),false);
  checks.push('Inspection flow writes only inspections, preserves estimates/stage/outcomes/prices, stores no persistent drafts and makes zero assessment/provider calls');
  await evaluate('window.confirm=window.inspectionConfirm');
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixture.identifier});
}
