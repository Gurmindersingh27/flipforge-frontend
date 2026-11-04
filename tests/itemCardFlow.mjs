import assert from 'node:assert/strict';

export async function runCardChecks({ cdp, evaluate, until, fill, click, measure, screenshot, checks, assess, navigate, settled, requests, save }) {
  const card = "document.querySelector('.quick-decision-card')";
  const drawer = "document.querySelector('.quick-result-drawer')";
  const primary = "document.querySelector('.quick-decision-card .quick-primary')";
  const field = id => `document.getElementById('quick-${id}')`;
  const text = () => evaluate(card + '.innerText');
  const conditionHints = () => evaluate("Array.from(document.querySelectorAll('.quick-sources article'), row => row.textContent.includes('Used condition unconfirmed'))");
  async function closeDetails() {
    await evaluate(`${drawer}.open && ${drawer}.querySelector('summary').click()`);
    await until(`!${drawer}.open`);
  }
  async function capture(state) {
    await closeDetails();
    const before = await requests();
    for (const width of [390, 1440]) {
      await cdp('Emulation.setDeviceMetricsOverride', {width, height:width === 390 ? 844 : 1000, deviceScaleFactor:1, mobile:width === 390});
      await evaluate("window.scrollTo({top:0,behavior:'instant'})");
      assert.ok(await measure(`document.documentElement.scrollWidth <= innerWidth &&
        ${card}.querySelector('h2').getBoundingClientRect().bottom < innerHeight &&
        Array.from(${card}.querySelectorAll('button')).every(e=>e.getBoundingClientRect().height>=44)`));
      await screenshot(`photo-card-${state}-${width}.png`, {width, height:width === 390 ? 844 : 1000});
    }
    assert.deepEqual(await requests(), before, 'Reading the card and changing viewport sends no requests');
  }

  const mixed = await assess('card_local_new', false);
  assert.deepEqual(mixed.result.listings.map(row => row.condition_type), ['used', 'used', 'new']);
  assert.deepEqual(mixed.result.listings.map(row => row.exclusion_reason), [null, null, 'condition_new']);
  assert.equal(mixed.result.resale, null);
  assert.match(await text(), /3 verified prices · 2 qualify · 3 needed/);
  assert.match(await text(), /No buying limit yet/);
  assert.doesNotMatch(await text(), /conditions? unconfirmed/i);
  await capture('local-new');
  await click('button','Review 3 price sources');
  const mixedRows = await evaluate("Array.from(document.querySelectorAll('.quick-sources article'), row => row.innerText)");
  assert.ok(mixedRows.slice(0, 2).every(row => row.includes('Eligible price evidence')));
  assert.ok(mixedRows.every(row => !row.includes('Used condition unconfirmed')));
  assert.match(mixedRows[2], /Reference only/);
  assert.match(mixedRows[2], /Main reason: Identified as new, not used\./);
  const rowExcerpts = () => evaluate("Array.from(document.querySelectorAll('.quick-sources article'), row => Array.from(row.querySelectorAll('blockquote'), quote => quote.lastChild.textContent))");
  const quotes = mixed.result.listings.map(row => row.supporting_quotes);
  assert.ok(quotes[0][0].indexOf('Asking $65') > 240);
  assert.equal(quotes[0][1], 'Collect from Decatur after 5 pm.');
  const preview = await rowExcerpts();
  assert.deepEqual(preview[0], [quotes[0][0].slice(0, 240) + '…']);
  const beforeReading = await requests();
  await click('button', 'Show full excerpts');
  assert.deepEqual(await rowExcerpts(), quotes);
  await click('button', 'Show short previews');
  assert.deepEqual(await rowExcerpts(), preview);
  assert.deepEqual(await requests(), beforeReading, 'Reading all excerpts makes no API requests');
  assert.equal((await requests()).filter(r => r.path === '/api/items/analyze').length, 0);
  checks.push('Two used and one new pickup listing produce three verified asks, two qualifying listings, the new-item reason and no buying limit');

  const unpriced = await assess('card_unpriced_repairs', false);
  assert.deepEqual(unpriced.result.repair_suggestions, []);
  assert.match(await text(), /Still unknown/);
  assert.doesNotMatch(await text(), /I checked the rest/);
  assert.equal(await evaluate(primary + '.textContent'), 'Enter a different total');
  await click('button','Enter a different total');
  await until(`document.activeElement === ${field('repairs')}`);
  assert.equal(await evaluate(field('repairs') + '.value'), '');
  await evaluate("document.querySelector('[data-quick-calculate]').click()");
  await until(`Boolean(document.getElementById('quick-repairs-error'))`);
  assert.equal((await requests()).filter(r => r.path === '/api/items/analyze').length, 0);
  await fill(field('repairs'), '0');
  await click('button','Confirm costs & calculate');
  await until(`${card}.querySelector('[data-quick-offer]')?.textContent === '$40'`);
  const calculations = (await requests()).filter(r => r.path === '/api/items/analyze');
  assert.deepEqual(calculations.map(r => JSON.parse(r.body).repairs), [0]);
  checks.push('With repair unknowns and no catalog jobs, the buyer must type a total; blank sends no calculation and explicit zero yields the offer');

  await assess('card_chair', false);
  assert.equal(await evaluate(drawer + '.open'), false);
  assert.match(await text(), /No buying limit yet/);
  assert.match(await text(), /1 verified price · 3 needed/);
  assert.match(await text(), /Still unknown/);
  assert.match(await text(), /About \$5 in materials/);
  assert.equal(await evaluate(card + ".querySelector('.quick-card-check p').textContent"), 'Seat lift operation is unconfirmed.');
  assert.match(await text(), /Review 1 price source\b/);
  assert.equal(await evaluate(field('repairs') + '.value'), '');
  await capture('chair');
  const beforeDetails = await requests();
  await click('button','Review 1 price source');
  assert.ok(await evaluate(`${drawer}.open && document.querySelector('.quick-sources').open &&
    document.activeElement === document.querySelector('.quick-sources summary')`));
  assert.equal(await evaluate("document.querySelectorAll('.quick-sources article').length"),1);
  assert.ok(await evaluate("document.querySelector('.quick-sources').innerText.includes('Not identified as a local-pickup listing.')"));
  await click('button','Enter a different total');
  await until(`document.activeElement === ${field('repairs')}`);
  assert.deepEqual(await requests(), beforeDetails);
  await closeDetails();
  await click('button','Use $5 — I checked the rest');
  await until(`document.querySelector('[data-quick-status]')?.dataset.quickStatus === 'needs_info'`);
  assert.equal(await evaluate(field('resale_low') + '.value'), '');
  assert.equal(JSON.parse((await requests()).filter(r=>r.path==='/api/items/analyze').at(-1).body).repairs,5);
  assert.match(await text(), /No buying limit yet/);
  assert.equal(await evaluate(card + ".querySelector('[data-quick-offer]')"), null);
  await click('button','Enter a different total');
  await until(`document.activeElement === ${field('repairs')}`);
  await fill(field('resale_low'),'200');
  await fill(field('repairs'),'5');
  await click('button','Confirm costs & calculate');
  await until(`${card}.querySelector('[data-quick-offer]')?.textContent==='$164'`);
  assert.ok(await evaluate(`${card}.querySelector('[data-manual-basis]').textContent==='Based on your $200 resale estimate' &&
    Boolean(${card}.querySelector('[data-manual-basis]').compareDocumentPosition(${card}.querySelector('[data-quick-offer]')) & Node.DOCUMENT_POSITION_FOLLOWING)`));
  assert.equal(await evaluate("document.querySelectorAll('[data-quick-offer]').length"),1);
  await capture('manual');

  const dresser = await assess('card_dresser', false);
  assert.match(await text(), /Still unknown/);
  assert.match(await text(), /\$180–\$220/);
  assert.match(await text(), /3 pickup listings · asking prices · 3 conditions unconfirmed/);
  await click('button','Review costs');
  await fill(field('pickup'),'10');
  await closeDetails();
  assert.equal(await evaluate(field('repairs') + '.value'), '');
  assert.equal(await evaluate("document.querySelector('[data-quick-status]')"),null);
  const beforeAccept = await requests();
  await evaluate(`{
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = original(input, init);
      if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname === '/api/items/analyze') {
        window.fetch = original;
        await new Promise(resolve => { window.releaseCardCalculation = resolve; });
      }
      return response;
    };
  }`);
  await evaluate(`${primary}.click();${primary}?.click()`);
  await until(`typeof window.releaseCardCalculation === 'function' && ${primary}?.disabled`);
  await click('button','Review 3 price sources');
  assert.ok(await evaluate(`${drawer}.open && document.querySelector('.quick-sources').open &&
    document.activeElement === document.querySelector('.quick-sources summary')`), 'Sources remain reachable during Calculate');
  assert.deepEqual(await conditionHints(), [true, true, true]);
  await evaluate('window.releaseCardCalculation()');
  await until(`${card}.querySelector('[data-quick-offer]')?.textContent==='$130'`);
  const sent=(await requests()).slice(beforeAccept.length);
  assert.deepEqual(sent.map(r=>[r.method,r.path]),[['POST','/api/items/analyze']]);
  assert.equal(JSON.parse(sent[0].body).repairs,8);
  assert.ok(!(await text()).includes('Still unknown'));
  await capture('complete');
  await click('summary','Details');
  const saved=await save('Save item');
  assert.deepEqual(saved.assessment.confirmation.repairs,[{job_id:'scratch_touchup',materials_cost:8}]);
  assert.equal(saved.inputs.repairs,8);
  assert.equal(saved.assessment.confirmation.resale_source,'assessment');
  await navigate('/items?find='+saved.id);await settled(false);
  assert.match(await text(), /Offer up to \$130/);
  assert.match(await text(), /3 conditions unconfirmed/);
  assert.deepEqual(await conditionHints(), [true, true, true]);
  assert.equal(await evaluate(field('repairs')+'.value'),'8');
  await navigate('/items?find='+saved.id+'&nationalLegacy');await settled(false);
  assert.deepEqual(await conditionHints(), [false, false, false], 'Older rows without a condition classification keep their original wording');
  assert.match(await text(), /Offer up to \$130/);
  await navigate('/items', dresser.id);await settled(false);
  assert.match(await text(), /Recovered estimate/);
  assert.match(await text(), /3 conditions unconfirmed/);
  assert.deepEqual(await conditionHints(), [true, true, true]);
  assert.match(await text(), /Still unknown/);
  assert.equal(await evaluate(field('repairs')+'.value'),'');
  assert.equal(await evaluate(card+".querySelector('[data-quick-offer]')"),null);
  assert.equal((await requests()).filter(r=>r.method==='POST').length,0);
  await capture('recovered');
  await click('summary','Details');
  await click('button','Dismiss estimate recovery');
  assert.deepEqual(await conditionHints(), [true, true, true]);

  await assess('national', false);
  assert.match(await text(), /No buying limit yet/);
  assert.match(await text(), /3 verified prices · 0 qualify · 3 needed/);
  assert.match(await text(), /national reference is available/);
  assert.equal(await evaluate(field('resale_low')+'.value'),'');
  await capture('national-offered');
  await click('button','Review national reference');
  assert.ok(await evaluate("document.activeElement === document.querySelector('[data-use-national]')"));
  assert.equal(await evaluate(field('resale_low')+'.value'),'');
  await assess('card_dresser', false, async () => {
    await click('button',"I'll enter my own estimate");
    await fill(field('repairs'),'37');
  });
  assert.equal(await evaluate(field('repairs')+'.value'),'37');
  assert.match(await text(), /Still unknown/, 'Earlier typing cannot acknowledge an inspection note the buyer has not yet seen');
  assert.equal((await requests()).filter(r=>r.path==='/api/items/analyze').length,0);
  checks.push('Decision card displays post-filter counts and verbatim checks, keeps manual offers labeled and requires explicit repair and national choices; save reopens the confirmed amount and free recovery clears it');
}
