import assert from 'node:assert/strict';

// Real local assessment processing/calculator/saves; only sign-in, paid provider,
// clipboard and explicitly named legacy/display-only GET variants are simulated.
export async function runNationalPriceChecks({ cdp, evaluate, until, fill, click, measure, screenshot, pause, checks }) {
  const owner = 'national-price-fixture';
  const nationalLabel = 'National used asking prices; shipping excluded. Not confirmed sales. Local prices and condition may differ.';
  const input = id => `document.getElementById(${JSON.stringify(id)})`;
  const marker = `sessionStorage.getItem('flipforge:item-assessment:${owner}')`;
  const api = async path => {
    const r = await fetch('http://127.0.0.1:8000' + path, { headers: { Authorization: 'Bearer ' + owner } });
    assert.equal(r.status, 200); return r.json();
  };
  const setMode = async mode => {
    const r = await fetch('http://127.0.0.1:8000/browser-fixture/ai/' + mode, { method: 'POST' });
    assert.equal(r.status, 200);
  };
  const history = [];
  const fixture = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.sessionFixtureUser=${JSON.stringify(owner)};
    window.nationalRequests=[];window.nationalResponses=[];window.nationalCopyMode='fail';window.nationalCopied=null;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{
      if(window.nationalCopyMode==='fail')throw new Error('Clipboard denied');window.nationalCopied=text;
    }}});
    const originalNationalFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin!=='http://127.0.0.1:8000'||!url.pathname.startsWith('/api/'))return originalNationalFetch(input,init);
      window.nationalRequests.push({path:url.pathname,method:init.method??'GET',body:init.body??null});
      const response=await originalNationalFetch(input,init);
      if(url.pathname==='/api/items/assess'&&response.ok)window.nationalResponses.push(await response.clone().json());
      if(/^\\/api\\/items\\/\\d+$/.test(url.pathname)&&response.ok){
        const flags=new URLSearchParams(location.search);
        if(flags.has('nationalLegacy')||flags.has('nationalFuture')||flags.has('nationalCount')){
          const row=await response.json(),e=row.assessment.evidence;
          if(flags.has('nationalLegacy')){
            delete e.national_resale;row.assessment.confirmation.resale_source='user_estimate';
            for(const listing of e.listings)for(const k of ['condition_type','price_basis','national_eligible','national_exclusion_reason'])delete listing[k];
            e.listings[1].national_eligible=false;
            e.listings[2].national_exclusion_reason='not_recorded';
          }
          if(flags.has('nationalFuture')){e.listings[0].national_eligible=false;e.listings[0].national_exclusion_reason='future_code';}
          if(flags.has('nationalCount'))e.national_resale.eligible_count=17;
          return Response.json(row);
        }
      }
      return response;
    };` });
  const requests = () => evaluate('window.nationalRequests??[]');
  const writes = async () => (await requests()).filter(r => !['GET','HEAD','OPTIONS'].includes(r.method));
  async function navigate(path='/items', recoveryId=null) {
    history.push(...await requests());
    await evaluate(`Object.keys(sessionStorage).filter(k=>k.startsWith('flipforge:item-assessment:')).forEach(k=>sessionStorage.removeItem(k));window.beforeNationalNav=true`);
    let recovery;
    if (recoveryId) recovery = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('flipforge:item-assessment:${owner}',${JSON.stringify(recoveryId)});` });
    await cdp('Page.navigate', { url:'http://127.0.0.1:5173'+path });
    await until(`!window.beforeNationalNav && Boolean(window.nationalRequests) && Boolean(document.querySelector('.items-quick,.my-flips'))`);
    if (recovery) await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:recovery.identifier});
  }
  async function ready() {
    await until(`Boolean(document.querySelector('[data-quick-assess]')) && !document.querySelector('[aria-label="Buying preferences"] fieldset')?.disabled && !document.body.textContent.includes('Checking AI availability…')`);
  }
  async function settled() {
    await until(`Boolean(document.querySelector('[aria-label="Confirm estimate"]')) && !document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled && !document.body.textContent.includes('Checking AI availability…')`);
  }
  async function assess(mode) {
    await setMode(mode); await navigate(); await ready();
    await fill(input('quick-description'), 'My owned wood chair');
    await fill(input('quick-asking'), '20');
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=20;c.height=20;const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const d=new DataTransfer();d.items.add(new File([blob],'national-chair.jpg',{type:'image/jpeg'}));const e=document.querySelector('input[type=file]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelectorAll('.quick-photo img').length===1 && !document.querySelector('[data-quick-assess]').disabled`);
    const before = (await api('/browser-fixture/ai')).calls;
    await evaluate(`document.querySelector('[data-quick-assess]').click()`);
    await settled();
    assert.equal((await api('/browser-fixture/ai')).calls, before+1);
    const sent = (await requests()).filter(r=>r.path==='/api/items/assess');
    assert.equal(sent.length,1);
    return evaluate('window.nationalResponses[0]');
  }
  async function calculate() {
    await evaluate(`document.querySelector('[data-quick-calculate]').click()`);
    await until(`Boolean(document.querySelector('[data-quick-status]')) && !document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled`);
  }
  async function save(label) {
    await click('button',label);await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Saved')`);
    const rows = (await api('/api/items?limit=100')).items;
    return rows[0];
  }
  async function noWrites() { assert.deepEqual(await writes(), []); }
  const originalRows = (await api('/api/items?limit=100')).items;
  assert.equal(originalRows.length,0);
  const originalHouses = await api('/api/deals');
  const providerBefore = (await api('/browser-fixture/ai')).calls;
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const assessed = await assess('national');
  assert.equal(await evaluate(input('quick-resale_low')+'.value'),'');
  assert.equal(await evaluate(`Boolean(${input('quick-resale_high')})`),false);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status]'))`),false);
  assert.ok(await evaluate(`document.querySelector('[data-national-reference]').textContent.includes('3 shipped used listings')`));
  const beforePanels = await requests();
  await evaluate(`document.querySelector('.quick-sources').open=true;document.querySelector('.quick-inspection details').open=true`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-national-reason]').length`),3);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-national-reason]')).every(e=>e.textContent==='National reference: eligible price evidence.')`));
  const positions=await measure(`(()=>{const n=document.querySelector('.quick-repairs .quick-notice'),r=${input('quick-repairs')},b=document.querySelector('[data-quick-calculate]');return[n.getBoundingClientRect().top,r.getBoundingClientRect().top,b.getBoundingClientRect().top]})()`);
  assert.ok(positions[0]<positions[1]&&positions[1]<positions[2]);
  assert.deepEqual(await requests(),beforePanels);
  checks.push('National reference never fills sale values on arrival; sources/check panels make zero requests and repair unknowns remain above repairs at 390px');

  const beforeApply=await requests();
  await evaluate(`document.querySelector('[data-use-national]').click();document.querySelector('[data-use-national]').click()`);
  assert.equal(await evaluate(input('quick-resale_low')+'.value'),'150');
  assert.equal(await evaluate(input('quick-resale_high')+'.value'),'250');
  assert.equal(await evaluate(`document.querySelector('[data-sale-input-source]').textContent`),nationalLabel);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status]'))`),false);
  assert.deepEqual(await requests(),beforeApply);
  await fill(input('quick-repairs'),'15');await calculate();
  let sent=await writes();
  assert.equal(sent.filter(r=>r.path==='/api/items/analyze').length,1);
  const calculation=JSON.parse(sent.find(r=>r.path==='/api/items/analyze').body);
  assert.deepEqual([calculation.resale_low,calculation.resale_high],[150,250]);
  assert.ok(await evaluate(`document.querySelector('[data-buying-summary]').value.includes(${JSON.stringify(nationalLabel)})`));
  checks.push('Explicit national selection applies exact server bounds in memory once; only Calculate sends a calculation and labels the result and summary nationally');

  const goal=input('quick-target_profit');
  await evaluate(`(()=>{const e=${goal};e.closest('details').open=true;e.scrollIntoView({block:'center',behavior:'instant'});e.focus({preventScroll:true});e.setSelectionRange(e.value.length,e.value.length)})()`);
  const top=await measure(`${goal}.getBoundingClientRect().top`), beforeTyping=await requests();
  assert.ok(top>=0&&top<844);
  await cdp('Input.insertText',{text:'1'});await until(`!document.querySelector('[data-quick-status]')`);
  const afterTop=await measure(`${goal}.getBoundingClientRect().top`);
  assert.ok(afterTop>=0&&afterTop<844&&Math.abs(afterTop-top)<=8);
  assert.equal(await evaluate(`document.activeElement===${goal}`),true);
  assert.equal(await evaluate(`document.querySelector('[data-sale-input-source]').textContent`),nationalLabel);
  assert.deepEqual(await requests(),beforeTyping);
  await fill(goal,'30');await calculate();
  await evaluate(`document.querySelector('.quick-buying-summary').open=true`);
  const summary=await evaluate(`document.querySelector('[data-buying-summary]').value`), beforeCopy=await requests();
  await click('button','Copy buying summary');await until(`Boolean(document.querySelector('.quick-buying-summary [role=alert]'))`);
  assert.equal(await evaluate(`document.querySelector('[data-buying-summary]').value`),summary);
  assert.equal(await evaluate(`document.querySelector('[data-buying-summary]').readOnly`),true);
  await evaluate(`window.nationalCopyMode='ok'`);await click('button','Copy buying summary');
  await until(`Boolean(document.querySelector('.quick-buying-summary [role=status]'))`);
  assert.equal(await evaluate('window.nationalCopied'),summary);
  assert.deepEqual(await requests(),beforeCopy);
  assert.ok(await measure('document.documentElement.scrollWidth<=innerWidth'));
  await screenshot('photo-national-reference-390.png');
  checks.push('National cost editing preserves source/focus and moves at most 8px at 390x844; clipboard failure and success retain selectable exact summary with zero requests');

  const original=await save('Save item');
  assert.deepEqual([original.inputs.resale_low,original.inputs.resale_high],[150,250]);
  assert.equal(original.assessment.confirmation.resale_source,'national_reference');
  assert.equal(original.assessment.evidence.inputs.resale_low,null);
  assert.equal(original.assessment.evidence.inputs.resale_high,null);
  sent=await writes();assert.equal(sent.filter(r=>r.path==='/api/items/save').length,1);
  assert.equal(JSON.parse(sent.find(r=>r.path==='/api/items/save').body).assessment_confirmation.resale_source,'national_reference');
  await navigate('/items?find='+original.id);await settled();await noWrites();
  assert.equal(await evaluate(input('quick-resale_low')+'.value'),'150');
  assert.equal(await evaluate(input('quick-resale_high')+'.value'),'250');
  assert.ok(await evaluate(`document.querySelector('[data-buying-summary]').value.includes(${JSON.stringify(nationalLabel)})`));
  assert.deepEqual((await requests()).map(r=>r.path).sort(),['/api/items/'+original.id,'/api/items/ai-budget'].sort());
  checks.push('One explicit save retains national provenance and immutable evidence; reopening uses only the existing two reads and restores both bounds and summary label');

  await fill(input('quick-resale_high'),'251');
  assert.ok(await evaluate(`document.querySelector('[data-sale-input-source]').textContent.startsWith('Your sale estimate.')`));
  assert.equal(await evaluate(input('quick-resale_low')+'.value'),'150');
  await fill(input('quick-resale_high'),'250');await calculate();
  assert.ok(await evaluate(`document.querySelector('[data-buying-summary]').value.includes('Your sale estimate, not a confirmed sale price.')`));
  const child=await save('Save new version');
  assert.equal(child.assessment.confirmation.resale_source,'user_estimate');
  assert.deepEqual(child.analysis_result,original.analysis_result);
  assert.deepEqual(await api('/api/items/'+original.id),original);
  await navigate('/my-flips');await until(`Boolean(document.querySelector('[data-saved-item="${child.id}"]'))`);
  await evaluate(`document.querySelector('[data-saved-item="${child.id}"] [aria-controls="comparison-${child.id}"]').click()`);
  await until(`Boolean(document.querySelector('[data-comparison-row="resale_source"]'))`);
  assert.equal(await evaluate(`document.querySelector('[data-comparison-row="resale_source"]').dataset.changed`),'true');
  assert.ok(await evaluate(`document.querySelector('[data-comparison-row="resale_source"]').textContent.includes(${JSON.stringify(nationalLabel)})`));
  assert.ok(await evaluate(`document.querySelector('[data-comparison-row="resale_source"]').textContent.includes('Your sale estimate')`));
  await noWrites();
  checks.push('Editing the high bound downgrades provenance even after restoring identical numbers; saved version comparison exposes the source-only change without requests that write');

  await navigate('/items?find='+original.id);await settled();
  await fill(input('quick-resale_low'),'149');
  assert.ok(await evaluate(`document.querySelector('[data-sale-input-source]').textContent.startsWith('Your sale estimate.')`));
  assert.equal(await evaluate(input('quick-resale_high')+'.value'),'250');
  await fill(input('quick-resale_high'),'');await calculate();
  await evaluate(`document.querySelector('[data-field-target="quick-resale_high"]').click()`);
  assert.equal(await evaluate(`document.activeElement===${input('quick-resale_high')}`),true);
  const beforeInvalid=await requests();await fill(input('quick-resale_high'),'100');
  await evaluate(`document.querySelector('[data-quick-calculate]').click()`);
  assert.ok(await evaluate(`Boolean(document.getElementById('quick-resale_high-error'))`));
  assert.deepEqual(await requests(),beforeInvalid);
  await fill(input('quick-resale_low'),'');await fill(input('quick-resale_high'),'');await calculate();
  assert.equal(await evaluate(`document.querySelectorAll('[data-field-target="quick-resale_low"],[data-field-target="quick-resale_high"]').length`),2);
  const beforeOwn=await requests();await click('button','Enter my own estimate');
  assert.equal(await evaluate(input('quick-resale_low')+'.value'),'');assert.equal(await evaluate(input('quick-resale_high')+'.value'),'');
  assert.deepEqual(await requests(),beforeOwn);
  checks.push('Editing the low bound also downgrades provenance; separate missing-bound navigation works and reversed bounds fail locally without a request');

  for(const [query,phrase] of [['nationalLegacy','National eligibility was not recorded'],['nationalFuture','a recognized reason is unavailable'],['nationalCount','17 shipped used listings']]) {
    await navigate('/items?find='+original.id+'&'+query+'=1');await settled();
    await evaluate(`document.querySelector('.quick-sources').open=true`);
    assert.ok(await evaluate(`document.body.textContent.includes(${JSON.stringify(phrase)})`));
    if(query==='nationalLegacy'){
      assert.equal(await evaluate(`Boolean(document.querySelector('[data-national-reference]'))`),false);
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-national-reason]')).filter(e=>e.textContent.includes('not recorded')).length`),3);
    }
    await noWrites();
  }
  assert.deepEqual(await api('/api/items/'+original.id),original);
  checks.push('Legacy absent fields show not recorded, future reason codes have a safe fallback, and the national count comes from the server; GET variants leave saved rows unchanged');

  await navigate('/items',assessed.id);await settled();
  assert.equal(await evaluate(input('quick-resale_low')+'.value'),'');
  assert.equal(await evaluate(`Boolean(${input('quick-resale_high')})`),false);
  assert.ok(await evaluate(`Boolean(document.querySelector('[data-national-reference]'))`));
  await noWrites();
  assert.equal((await requests()).filter(r=>r.path==='/api/items/assessments/'+assessed.id).length,1);
  await evaluate(`document.querySelector('[data-use-national]').click()`);await fill(input('quick-repairs'),'15');await calculate();
  await evaluate(`window.switchFixtureUser('other-user')`);
  await until(`!document.querySelector('[data-national-reference]')&&!document.querySelector('[data-quick-status]')`);
  assert.equal(await evaluate(`document.querySelectorAll('.quick-photo img').length`),0);
  assert.equal(await evaluate(`document.querySelector('[data-buying-summary]')?.value??''`),'');
  assert.equal(await evaluate(marker),null);
  checks.push('Free status recovery presents the national choice again without restoring unsaved selection; account switch clears the range, result, summary and recovery marker');

  for(const mode of ['national_mixed','national_local','national_reasons']) {
    await assess(mode);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-national-reference]'))`),false);
    if(mode==='national_mixed')assert.equal(await evaluate(input('quick-resale_low')+'.value'),'');
    if(mode==='national_local')assert.ok(await evaluate(`document.querySelector('#quick-resale-reference').textContent.includes('$70.00 - $82.50')`));
    if(mode==='national_reasons'){
      await evaluate(`document.querySelector('.quick-sources').open=true`);
      assert.equal(await evaluate(`document.querySelectorAll('[data-national-reason]').length`),12);
      for(const reason of ['eligible price evidence','Used condition was not established','Identified as new','unclear whether this price excludes shipping','price includes shipping','Not identified as a shipped listing','Not a comparable single item','listed price is zero','No supporting search quote verifies this price'])
        assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-national-reason]')).some(e=>e.textContent.includes(${JSON.stringify(reason)}))`),reason);
      await screenshot('photo-national-reasons-390.png');
    }
  }
  checks.push('Real local processing confirms mixed 2+2 pools give no range, local evidence wins, and every retained listing displays its server national eligibility/reason');

  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate('/items?find='+original.id);await settled();
  assert.ok(await measure('document.documentElement.scrollWidth<=innerWidth'));
  assert.ok(await evaluate(`document.querySelector('[data-sale-input-source]').textContent.includes('National used asking prices')`));
  await screenshot('photo-national-reference-1440.png');await noWrites();
  assert.deepEqual(await api('/api/items/'+original.id),original);assert.deepEqual(await api('/api/items/'+child.id),child);
  assert.equal((await api('/api/items?limit=100')).items.length,2);
  assert.deepEqual(await api('/api/deals'),originalHouses);
  assert.equal((await api('/browser-fixture/ai')).calls,providerBefore+4);
  history.push(...await requests());
  assert.equal(history.filter(r=>r.path==='/api/items/assess'&&r.method==='POST').length,4);
  assert.equal(history.filter(r=>r.path==='/api/items/save'&&r.method==='POST').length,2);
  assert.equal(history.filter(r=>!['GET','HEAD','OPTIONS'].includes(r.method)&&!['/api/items/assess','/api/items/save','/api/items/analyze'].includes(r.path)).length,0);
  checks.push('National UI fits 1440px; only four explicit simulated assessments and two explicit saves occurred, with no preferences/outcome/Houses writes and original snapshots unchanged');
  await setMode('normal');
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixture.identifier});
  await pause(50);
}
