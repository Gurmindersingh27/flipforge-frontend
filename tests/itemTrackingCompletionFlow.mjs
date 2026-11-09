import assert from 'node:assert/strict';

// Exercise the owner's incomplete-profit case through the released backend.
export async function runTrackingCompletionChecks({ cdp, evaluate, until, fill, click, measure, screenshot, checks, api }) {
  const post = async (path, body) => {
    const response = await fetch('http://127.0.0.1:8000'+path, {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer browser-fixture'},body:JSON.stringify(body)});
    assert.equal(response.status,201,await response.clone().text()); return response.json();
  };
  const beforeAI = await api('/browser-fixture/ai');
  const item = await post('/api/items/save',{inputs:{item_name:'TEST — tracking completion',purchase_price:20,resale_low:100,resale_high:100,repairs:0,pickup:0,delivery:0,storage:0,fee_pct:0,fee_fixed:0,hours:0,hourly_value:20,target_profit:30}});
  const initial = await post(`/api/items/${item.id}/outcomes`,{status:'sold',purchase_price:20,sale_price:100,materials:5,based_on_item_id:item.id,expected_previous_id:null,request_id:crypto.randomUUID()});
  const fixture = await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.completionWrites=[];window.completionLoseSave=false;
    const originalCompletionFetch=window.fetch;
    window.fetch=async (input,init={})=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      if(init.method==='POST'&&path.endsWith('/outcomes')){
        window.completionWrites.push(JSON.parse(init.body));
        const response=await originalCompletionFetch(input,init);
        if(window.completionLoseSave){window.completionLoseSave=false;await response.text();return Response.json({detail:'Lost confirmation fixture'},{status:503});}
        return response;
      }
      return originalCompletionFetch(input,init);
    };
  `});
  const field = key => `document.getElementById('outcome-${key}')`;
  const ready = `Boolean(document.querySelector('.item-outcome fieldset')) && !document.querySelector('.item-outcome fieldset').disabled`;
  const result = key => `document.querySelector('[data-project-actual="${key}"]')?.textContent`;
  await cdp('Page.navigate',{url:`http://127.0.0.1:5173/my-flips/${item.id}`});
  await click('button','Complete your profit figures'); await until(ready);
  assert.equal(await evaluate(field('hired_labor')+'.value'),'');
  assert.equal(await evaluate(result('cash_profit')),'Not complete');
  assert.ok(await evaluate(`document.querySelector('.outcome-completion').textContent.includes('Cash profit needs 6 more amounts')`));
  assert.ok(await evaluate(`document.querySelector('.item-outcome summary').textContent.includes('6 not recorded')`));
  await click('button','Go to first missing amount');
  assert.equal(await evaluate('document.activeElement.id'),'outcome-hired_labor');
  assert.equal(await evaluate(field('hired_labor')+`.closest('details').open`),true);
  for (const width of [390,1440]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:1000,deviceScaleFactor:1,mobile:width===390});
    await evaluate(`document.querySelector('.outcome-completion').scrollIntoView({block:'start'})`);
    assert.ok(await measure('document.documentElement.scrollWidth<=innerWidth'));
    assert.ok(await measure(`Array.from(document.querySelectorAll('.outcome-completion button,.outcome-zero-confirm button')).every(e=>e.getBoundingClientRect().height>=44)`));
    await screenshot(`photo-tracking-completion-${width}.png`);
  }
  checks.push('Incomplete sold results lead directly to tracking; missing amounts open and focus the right field at 390/1440 without overflow');
  await fill(field('pickup'),'bad');
  await click('button','Set unrecorded expenses to $0');
  for(const key of ['hired_labor','delivery','storage','selling_fees','other_expenses'])assert.equal(await evaluate(field(key)+'.value'),'0');
  assert.equal(await evaluate(field('materials')+'.value'),'5');
  assert.equal(await evaluate(field('pickup')+'.value'),'bad');
  for(const key of ['hours','hourly_value','purchased_on','listed_on','sold_on'])assert.equal(await evaluate(field(key)+'.value'),'');
  assert.deepEqual(await evaluate('window.completionWrites'),[]);
  assert.equal(await evaluate(result('cash_profit')),'Not complete','Draft zeros cannot change saved figures');
  await evaluate(field('pickup')+`.closest('details').open=false`);
  await click('button','Save tracking');
  assert.equal(await evaluate('document.activeElement.id'),'outcome-pickup');
  assert.equal(await evaluate(field('pickup')+`.closest('details').open`),true);
  assert.deepEqual(await evaluate('window.completionWrites'),[]);
  checks.push('Explicit zero confirmation affects only blank expenses, preserves known and invalid values, infers no time or dates, and makes no write; hidden invalid fields open on Save');
  await fill(field('pickup'),'0');
  await evaluate('window.completionLoseSave=true');
  await click('button','Save tracking');
  await until(`document.body.textContent.includes('This outcome may already be saved')`);
  assert.equal(await evaluate(`document.querySelector('.item-outcome fieldset').disabled`),true);
  const attempts = await evaluate('window.completionWrites'); assert.equal(attempts.length,1);
  assert.equal(attempts[0].expected_previous_id,initial.id);
  assert.equal(attempts[0].hours,null); assert.equal(attempts[0].hourly_value,null);
  await click('button','Retry this save');
  await until(`${ready} && ${result('cash_profit')}==='$75.00'`);
  const retried = await evaluate('window.completionWrites'); assert.equal(retried.length,2); assert.deepEqual(retried[0],retried[1]);
  assert.equal((await api(`/api/items/${item.id}/outcomes`)).revision_number,2);
  assert.equal(await evaluate(result('profit_after_time')),'Not complete');
  checks.push('Confirmed zero expenses survive a lost save response with the exact request ID/payload retried once and no duplicate revision; missing time does not block cash profit');
  await click('button','Go to first missing amount');
  assert.equal(await evaluate('document.activeElement.id'),'outcome-hours');
  await fill(field('hours'),'0'); await fill(field('hourly_value'),'20');
  await click('button','Save tracking'); await until(`${ready} && ${result('profit_after_time')}==='$75.00'`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Complete your profit figures')`),false);
  await evaluate('window.completionLeaving=true');await cdp('Page.reload');
  await until(`!window.completionLeaving && ${result('cash_profit')}==='$75.00' && ${result('profit_after_time')}==='$75.00'`);
  assert.equal(await evaluate(result('cash_invested')),'$25.00');
  assert.equal(await evaluate(result('days_held')),'Not complete');
  assert.equal(await evaluate(result('days_to_sell')),'Not complete');
  assert.equal(await evaluate(`document.querySelector('.project-stages [aria-current=step]').dataset.stage`),'sold');
  checks.push('Saving time completes profit and removes the completion action; refresh preserves Sold and all financial results while optional day counts remain unknown');
  assert.deepEqual(await api('/api/items/'+item.id),item);
  const afterAI=await api('/browser-fixture/ai');assert.equal(afterAI.calls,beforeAI.calls);assert.equal(afterAI.posts,beforeAI.posts);
  checks.push('Tracking guidance leaves the saved estimate unchanged and sends zero assessment or provider calls');
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixture.identifier});
}
