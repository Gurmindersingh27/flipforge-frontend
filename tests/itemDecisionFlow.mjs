import assert from 'node:assert/strict';

// Real saved rows from the local API. Legacy/evidence variants alter only GET
// delivery in this browser; no provider call, production request or row mutation.
export async function runDecisionChecks({ cdp, evaluate, until, fill, click, measure, screenshot, pause, checks, api }) {
  const rows = (await api('/api/items?limit=100')).items;
  const photo = rows.find(row => row.assessment && row.analysis_result.low);
  assert.ok(photo);
  const other = rows.find(row => row.id !== photo.id);
  assert.ok(other);
  const beforeAI = await api('/browser-fixture/ai');
  const fixture = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    const original=window.fetch.bind(window);
    window.decisionRequests=[];window.draftConfirm=false;window.draftPrompts=[];
    window.confirm=message=>{window.draftPrompts.push(message);return window.draftConfirm;};
    window.clipboardMode='fail';window.copiedListing=null;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{
      if(window.clipboardMode==='fail')throw new Error('Clipboard denied');
      if(window.clipboardMode==='hold')await new Promise(resolve=>window.releaseClipboard=resolve);
      window.copiedListing=text;
    }}});
    window.fetch=async(input,init={})=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      if(path.startsWith('/api/'))window.decisionRequests.push({path,method:init.method||'GET'});
      const response=await original(input,init);
      if(path==='/api/items/${photo.id}'&&response.ok){
        const row=await response.json(), evidence=row.assessment.evidence;
        evidence.repair_unknowns=['Check the rear joint in person.'];
        evidence.questions=['DO NOT RENDER THESE SERVER FORM PROMPTS'];
        if(evidence.resale)evidence.resale.eligible_count=17;
        evidence.listings=['unsupported_price','not_comparable','not_local_pickup','zero_price','older_code',null,'toString'].map((reason,i)=>({
          ...evidence.listings[0],url:'https://example.com/evidence/'+i,eligible:false,exclusion_reason:reason,
          supporting_quotes:['<b>Plain search text $75</b> '+ 'x'.repeat(300)]
        }));
        if(new URLSearchParams(location.search).has('noRange'))evidence.resale=null;
        return Response.json(row);
      }
      if(path==='/api/items'&&response.ok){
        const page=await response.json();
        page.items=page.items.map(row=>({...row,notes:'PRIVATE_NEGOTIATION_987',listing_url:'https://private.example/secret-source',inputs:{...row.inputs,item_name:'UNCONFIRMED_ANTIQUE_TEAK_987'}}));
        return Response.json(page);
      }
      return response;
    };` });
  const requests = () => evaluate('window.decisionRequests');
  const openPhoto = async suffix => {
    await evaluate('window.beforeDecisionNav=true');
    await cdp('Page.navigate', { url: `http://127.0.0.1:5173/items?find=${photo.id}${suffix}` });
    await until(`!window.beforeDecisionNav && Boolean(document.querySelector('.quick-inspection')) && Boolean(document.querySelector('[data-quick-status]')) && !document.body.textContent.includes('Checking AI availability…')`);
  };
  const draftInput = label => `Array.from(document.querySelectorAll('.listing-field')).find(e=>e.firstChild.textContent===${JSON.stringify(label)}).querySelector('input,textarea')`;
  const openDraft = id => evaluate(`document.querySelector('[data-saved-item="${id}"] [aria-controls="listing-${id}"]').click()`);
  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await openPhoto('');
    const initial = await requests();
    const expectedReads = [{ path: '/api/items/ai-budget', method: 'GET' }, { path: `/api/items/${photo.id}`, method: 'GET' }].sort((a,b)=>a.path.localeCompare(b.path));
    assert.deepEqual([...initial].sort((a,b)=>a.path.localeCompare(b.path)), expectedReads, 'Reopen keeps only the existing budget and saved-item GETs');
    assert.equal(await evaluate(`document.querySelectorAll('.quick-inspection li').length`), 6);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.quick-repairs .quick-notice')).map(e=>e.textContent)`), ['Check the rear joint in person.']);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.quick-inspection [data-assessment-unknown]')).map(e=>e.textContent)`), ['Check the rear joint in person.']);
    assert.equal(await evaluate(`document.body.textContent.includes('DO NOT RENDER')`), false);
    await evaluate(`document.querySelector('.quick-inspection summary').click();document.querySelector('.quick-sources summary').click();document.querySelector('.quick-result-details summary').click()`);
    assert.ok(await evaluate(`document.querySelector('.quick-sources').textContent.includes('17 listings support the range.')`), 'Use server count, not client recount');
    for (const phrase of ['price was not found in the cited search text','Not a comparable single item','Not identified as a local-pickup listing','listed price is zero','recognized reason is unavailable']) {
      assert.ok(await evaluate(`document.querySelector('.quick-sources').textContent.includes(${JSON.stringify(phrase)})`));
    }
    assert.equal(await evaluate(`document.querySelector('.quick-sources').textContent.split('Found during the assessment on').length-1`), 1);
    assert.equal(await evaluate(`document.querySelectorAll('.quick-sources blockquote b').length`), 0);
    assert.ok(await evaluate(`document.querySelector('.quick-sources blockquote').textContent.includes('<b>Plain search text $75</b>')`));
    assert.ok(await evaluate(`document.querySelector('.quick-sources blockquote').textContent.endsWith('…')`));
    const dollars = n => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:2 }).format(n);
    for (const [label, value] of [['Low sale estimate',photo.analysis_result.low.resale],['Your time value',photo.analysis_result.low.own_time_value],['Selling fees at low sale estimate',photo.analysis_result.low.selling_fees]]) {
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('.quick-result-details dl>div')).find(e=>e.querySelector('dt').textContent===${JSON.stringify(label)}).querySelector('dd').textContent`), dollars(value));
    }
    assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'));
    await screenshot(`photo-decision-evidence-${width}.png`);
    await pause(100); assert.deepEqual(await requests(), initial, 'Evidence/check/detail panels send zero requests');
    if (width === 390) {
      const goal = `document.getElementById('quick-target_profit')`;
      await evaluate(`(()=>{const e=${goal};e.closest('details').open=true;e.scrollIntoView({block:'center',behavior:'instant'});e.focus({preventScroll:true});e.setSelectionRange(e.value.length,e.value.length)})()`);
      const before = await measure(`${goal}.getBoundingClientRect().top`);
      assert.ok(before >= 0 && before < 844, 'Focused cost field starts on screen');
      await cdp('Input.insertText', { text: '1' });
      await until(`!document.querySelector('[data-quick-status]')`);
      await pause(100);
      const after = await measure(`(()=>{const e=${goal},r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,focused:document.activeElement===e}})()`);
      assert.equal(after.focused, true, 'First edit retains focus');
      assert.ok(after.top >= 0 && after.bottom <= 844, `Edited cost field stays on screen: ${JSON.stringify(after)}`);
      assert.ok(Math.abs(after.top - before) <= 8, `First edit must not move the focused field: ${before}px -> ${after.top}px`);
      assert.deepEqual(await requests(), initial, 'Editing a cost sends no request');
      await screenshot('photo-decision-edit-stable-390.png');
      checks.push('390x844 first cost-field keystroke after a reopened result retains focus and screen position within 8px without requests');
    }
    await openPhoto('&noRange=1');
    await evaluate(`document.querySelector('.quick-sources').open=true`);
    assert.ok(await evaluate(`document.querySelector('.quick-sources').textContent.includes('Not enough supported nearby listings to set a range.')`));
    assert.equal(await evaluate(`document.querySelector('.quick-sources').textContent.includes('17 listings support')`), false);
    assert.deepEqual((await requests()).sort((a,b)=>a.path.localeCompare(b.path)), expectedReads);

    await cdp('Page.navigate', { url: 'http://127.0.0.1:5173/my-flips' });
    await until(`Boolean(document.querySelector('[data-saved-item="${photo.id}"]')) && !document.body.textContent.includes('Loading saved items.')`);
    const listRequests = await requests();
    await openDraft(photo.id); await until(`Boolean(document.querySelector('[data-listing-text]'))`);
    assert.equal(await evaluate(`document.querySelector('[data-listing-text]').value`), '');
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.item-listing-draft input,.item-listing-draft textarea')).every(e=>e.value==='')`));
    await fill(draftInput('Confirmed item name / listing title'), 'My dining chair');
    await fill(draftInput('Known defects to disclose'), 'Scratch on seat, checked in person');
    await fill(draftInput('Buyer pickup arrangements'), 'Meet by agreement');
    await fill(draftInput('Your asking price ($)'), '0');
    const draft = await evaluate(`document.querySelector('[data-listing-text]').value`);
    assert.equal(draft, 'My dining chair\n\nKnown defects: Scratch on seat, checked in person\n\nAsking price: $0\n\nPickup: Meet by agreement');
    for (const privateText of ['PRIVATE_NEGOTIATION_987','https://private.example/secret-source','UNCONFIRMED_ANTIQUE_TEAK_987','repaired']) assert.ok(!draft.includes(privateText));
    await click('button','Copy listing text');
    await until(`document.querySelector('.item-listing-draft [role=alert]')?.textContent.includes('Couldn’t copy automatically')`);
    assert.equal(await evaluate(`document.querySelector('[data-listing-text]').readOnly`), false);
    await evaluate(`window.clipboardMode='ok'`); await click('button','Copy listing text');
    await until(`document.querySelector('.item-listing-draft [role=status]')?.textContent.startsWith('Copied.')`);
    assert.equal(await evaluate('window.copiedListing'), draft);
    await fill(`document.querySelector('[data-listing-text]')`, 'Edited public text only');
    await fill(draftInput('Your asking price ($)'), '55');
    assert.equal(await evaluate(`document.querySelector('[data-listing-text]').value`), 'Edited public text only');
    await click('button','Rebuild text from fields');
    assert.equal(await evaluate(`document.querySelector('[data-listing-text]').value`), 'Edited public text only');
    await evaluate(`window.draftConfirm=true`); await click('button','Rebuild text from fields');
    assert.ok(await evaluate(`document.querySelector('[data-listing-text]').value.includes('Asking price: $55')`));
    await evaluate(`window.draftConfirm=false`);
    await click('button','Close listing draft');
    await openDraft(other.id);
    assert.equal(await evaluate(`document.querySelectorAll('.item-listing-draft').length`), 1);
    assert.ok(await evaluate(`Boolean(document.querySelector('#listing-${photo.id} .item-listing-draft'))`));
    await evaluate(`document.querySelector('.flips-nav a[href="/items"]').click()`);
    assert.equal(await evaluate('location.pathname'), '/my-flips');
    assert.ok(await evaluate('window.draftPrompts.length >= 4'));
    assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'));
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.item-listing-draft input,.item-listing-draft textarea')).every(e=>e.labels.length>0)`));
    await screenshot(`photo-listing-draft-${width}.png`);
    assert.deepEqual(await requests(), listRequests, 'Listing open/edit/copy/discard prompts send zero requests');
    await evaluate(`window.draftConfirm=true`); await openDraft(other.id);
    await until(`Boolean(document.querySelector('#listing-${other.id} .item-listing-draft'))`);
    assert.equal(await evaluate(`document.querySelector('[data-listing-text]').value`), '');
    await click('button','Close listing draft');
    assert.equal(await evaluate(`document.querySelectorAll('.item-listing-draft').length`), 0);
    assert.deepEqual(await requests(), listRequests);
    await openDraft(photo.id);
    await fill(draftInput('Confirmed item name / listing title'), 'Account-private draft');
    await evaluate(`window.clipboardMode='hold'`); await click('button','Copy listing text');
    await until(`typeof window.releaseClipboard==='function'`);
    await evaluate(`window.switchFixtureUser('other-user');window.releaseClipboard()`);
    await until(`!document.querySelector('.item-listing-draft') && !document.body.textContent.includes('Loading saved items.')`);
    assert.equal(await evaluate(`document.body.textContent.includes('Account-private draft')`), false);
    await evaluate(`window.switchFixtureUser('browser-fixture')`);
    await until(`Boolean(document.querySelector('[data-saved-item="${photo.id}"]'))`);
    await openDraft(photo.id);
    assert.equal(await evaluate(`document.querySelector('[data-listing-text]').value`), '');
    assert.equal(await evaluate(`Boolean(document.querySelector('.item-listing-draft [role=status]'))`), false);
    await fill(draftInput('Confirmed item name / listing title'), 'Leave this draft');
    await evaluate(`window.draftConfirm=true;document.querySelector('.flips-nav a[href="/"]').click()`);
    await until(`location.pathname==='/'`);
  }
  checks.push('390/1440 reopened photo panels use only the existing budget/saved-item GETs: server counts/numbers, one timestamp, plain-text excerpts, legacy exclusion fallback, null range, one unknown copy per repair/checklist context and labeled general checks; zero interaction requests');
  checks.push('390/1440 sale drafts start empty, exclude private notes/source URLs/AI guesses, preserve explicit zero and independent pickup text, handle clipboard failure/success and preserve manual text until confirmed rebuild; zero API requests');
  checks.push('One listing draft at a time: close/switch/navigation discard prompts honor cancel and accept; account remount clears drafts and late clipboard UI results');
  const afterAI = await api('/browser-fixture/ai');
  assert.equal(afterAI.calls,beforeAI.calls); assert.equal(afterAI.posts,beforeAI.posts);
  for (const row of rows) assert.deepEqual(await api(`/api/items/${row.id}`),row);
  checks.push('Decision/listing checks leave all captured saved rows unchanged and make zero simulated-provider or assessment POST calls');
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
}
