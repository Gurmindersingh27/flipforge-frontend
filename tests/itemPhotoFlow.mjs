import assert from "node:assert/strict";

const fallbackLabels = [
  'Legacy plain title', 'Title (nested (scope))', 'Title (scope) trailing',
  'Title(scope)', 'Title - Included in  (scope)', 'Title (scope)\n',
  'Title - Included in Host - Included in Other (scope)', 'Title ()',
  ' Title (scope)', 'Title ( scope)',
];

// Appended ONLY to the temporary browser fixture, never imported by the app.
// The real API, budget ledger, analysis engine and persistence run locally.
// Only the paid provider and sign-in are substituted. No real credentials.
export const photoBackendFixture = `
import json, httpx
from app.services import item_assessment_service as ai
from app.services import item_ai_budget_service as budget
from app.db.session import SessionLocal
from app.db.models.item_ai_budget import ItemAIMonth
from app.services.item_repair_catalog import CATALOG
os.environ.update(ITEMS_AI_ALLOWED_USER_IDS='browser-fixture,other-user', ITEMS_ANTHROPIC_API_KEY='browser-test-only', ITEMS_ANTHROPIC_WORKSPACE_ID='browser-test', ITEMS_AI_WORKSPACE_LIMIT_CONFIRMED='20', ITEMS_REPAIR_CATALOG_APPROVED='2026-10-06-draft2')
fixture_ai = {'mode': 'normal', 'calls': 0}
# Only the legacy fixture substitutes the old catalog to create a real draft1
# assessment/save before switching back to the current server catalog.
current_suggestions = ai.suggestions
def fixture_suggestions(report):
    if fixture_ai['mode'] == 'label_fallback':
        rows, unknowns = current_suggestions(report)
        for row, label in zip(rows, json.loads(${JSON.stringify(JSON.stringify(fallbackLabels))})):
            row['label'] = label
        return rows, unknowns
    if fixture_ai['mode'] != 'legacy':
        return current_suggestions(report)
    old = {'clean': ('Clean and degrease', 5), 'paint_dresser': ('Prep and paint a small dresser', 35), 'refinish_top': ('Sand and refinish a small top', 25)}
    return [dict(job_id=r.job_id, label=old[r.job_id][0], materials_cost=old[r.job_id][1], reason=r.reason, confirmed=False) for r in report.repairs], []
ai.suggestions = fixture_suggestions
def photo_provider(payload):
    fixture_ai['calls'] += 1
    mode = fixture_ai['mode']
    if mode == 'overloaded':
        response = httpx.Response(529, request=httpx.Request('POST', 'https://api.anthropic.com/v1/messages'))
        response.raise_for_status()
    if mode == 'timeout':
        raise httpx.ReadTimeout('fixture timeout')
    text = json.loads(payload['messages'][0]['content'][-1]['text'])
    prices = [65, 75] if mode == 'short' else [65, 75, 90]
    listings = [dict(title='Used wood dining chair', url='https://example.com/chair/' + str(i), price=p, currency='USD', condition='Used, good condition', comparable=True, single_item=True, market='local_pickup', location='Atlanta') for i, p in enumerate(prices)]
    asking = text.get('asking_price')
    if asking is None and 'twenty' in text.get('description', ''):
        asking = 20
    report = dict(item_name='Wood dining chair', category='Chair', asking_price=asking, repairs=[dict(job_id='sand_seat', reason='Visible scratches on the seat')], repair_unknowns=[], listings=listings)
    jobs = {
        'paint_chair': ['clean', 'scratch_touchup', 'paint_chair'],
        'paint_dresser': ['clean', 'scratch_touchup', 'paint_dresser'],
        'surfaces': ['clean', 'scratch_touchup', 'sand_seat', 'refinish_top'],
        'overlap': ['clean', 'paint_dresser', 'refinish_top'],
        'legacy': ['clean', 'paint_dresser', 'refinish_top'],
        'catalog': list(CATALOG),
        'label_fallback': list(CATALOG),
    }.get(mode)
    if jobs:
        report['repairs'] = [dict(job_id=job, reason='Visible work: ' + job) for job in jobs]
    return dict(stop_reason='end_turn', usage=dict(input_tokens=12000, output_tokens=1000, server_tool_use=dict(web_search_requests=2)), content=[dict(type='text', text=json.dumps(report), citations=[dict(type='web_search_result_location', url=row['url'], cited_text='Used chair $' + str(row['price']) + ', local pickup.') for row in listings])])
ai.call_provider = photo_provider
@app.post('/browser-fixture/ai/{mode}')
def ai_mode(mode: str):
    fixture_ai['mode'] = mode
    ai.VERSION = '2026-10-06-draft1' if mode == 'legacy' else '2026-10-06-draft2'
    os.environ['ITEMS_REPAIR_CATALOG_APPROVED'] = '' if mode == 'disabled' else ai.VERSION
    with SessionLocal() as db:
        row = db.get(ItemAIMonth, budget.month_key())
        if row is None:
            row = ItemAIMonth(month=budget.month_key(), spent_micros=0, held_micros=0)
            db.add(row)
        row.spent_micros = 20000000 if mode == 'cap' else 0
        db.commit()
    return fixture_ai
@app.get('/browser-fixture/ai')
def ai_state():
    return fixture_ai
`;

export async function runPhotoItemChecks({ cdp, evaluate, until, fill, click, measure, screenshot, pause, checks, api }) {
  const input = id => `document.getElementById(${JSON.stringify(id)})`;
  const mode = async value => (await fetch(`http://127.0.0.1:8000/browser-fixture/ai/${value}`, { method: 'POST' })).json();
  const calls = async () => (await (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json()).calls;
  async function open(query = '') {
    await evaluate('window.beforeQuickNavigation = true');
    await cdp('Page.navigate', { url: `http://127.0.0.1:5173/items${query}` });
    await until(`!window.beforeQuickNavigation && Boolean(document.querySelector('.items-quick'))`);
  }
  async function upload() {
    await until(`Boolean(document.querySelector('input[type=file]'))`);
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=1800;c.height=1200;const x=c.getContext('2d');x.fillStyle='#ded5c4';x.fillRect(0,0,1800,1200);x.strokeStyle='#765536';x.lineWidth=45;x.strokeRect(620,240,560,390);x.beginPath();x.moveTo(620,630);x.lineTo(560,950);x.moveTo(1180,630);x.lineTo(1240,950);x.moveTo(590,760);x.lineTo(1210,760);x.stroke();const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg'));const d=new DataTransfer();d.items.add(new File([blob],'chair-fixture.jpg',{type:'image/jpeg'}));const e=document.querySelector('input[type=file]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelectorAll('.quick-photo img').length === 1 && !document.body.textContent.includes('Preparing your photos')`);
    await until(`document.querySelector('.quick-photo img')?.naturalWidth === 1568`);
  }
  async function runAI() {
    const before = await calls();
    await until(`document.querySelector('[data-quick-assess]') && !document.querySelector('[data-quick-assess]').disabled`);
    await evaluate(`document.querySelector('[data-quick-assess]').click()`);
    for (let attempt = 0; attempt < 80 && await calls() === before; attempt++) await pause(50);
    assert.equal(await calls(), before + 1);
    await until(`Boolean(document.querySelector('.quick-resale')) || Boolean(document.querySelector('[role=alert]')) || Boolean(document.querySelector('.quick-sources'))`);
    await until(`!document.querySelector('[aria-label="Confirm estimate"] fieldset')?.disabled`);
  }
  async function calculate(status) {
    await evaluate(`document.querySelector('[data-quick-calculate]').click()`);
    await until(`document.querySelector('[data-quick-status]')?.dataset.quickStatus === ${JSON.stringify(status)}`);
  }
  async function savedConfirmation() {
    await until(`document.querySelector('[aria-label="Save item"] [role="status"]')?.textContent.startsWith('Saved version #')`);
  }
  async function geometry() {
    assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'), 'Photo flow must not overflow');
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.items-quick input,.items-quick textarea')).filter(e=>e.getBoundingClientRect().width).every(e=>e.getAttribute('aria-label')||e.labels?.length)`), 'Visible inputs need labels');
  }
  await mode('normal');
  let savedFind;
  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await open('?fixtureSignedOut=1');
    await until(`Boolean(${input('quick-description')})`);
    const count = await calls();
    await fill(input('quick-description'), 'Wood chair, scratched seat, they want twenty.');
    const askingInput = width === 390 ? '20' : '';
    await fill(input('quick-asking'), askingInput);
    await upload();
    await geometry(); await screenshot(`photo-entry-${width}.png`);
    assert.equal(await calls(), count);
    await evaluate(`window.switchFixtureUser('browser-fixture')`);
    await until(`Boolean(document.querySelector('[data-quick-assess]'))`);
    assert.equal(await evaluate(`${input('quick-description')}.value`), 'Wood chair, scratched seat, they want twenty.');
    assert.equal(await evaluate(`${input('quick-asking')}.value`), askingInput);
    assert.equal(await evaluate(`document.querySelectorAll('.quick-photo img').length`), 1);
    await runAI();
    assert.equal(await calls(), count + 1);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status]'))`), false, 'No offer before repairs are confirmed');
    await fill(input('item-notes'), 'Scratched seat. Check the joints.');
    await calculate('within_budget');
    assert.ok(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes('Good buy at $20.')`));
    assert.equal(await evaluate(`document.querySelector('[data-quick-offer]').textContent`), '$22');
    assert.equal(await evaluate(`document.querySelector('[data-quick-keep]').textContent`), '$32.75');
    assert.ok(await evaluate(`document.querySelector('.quick-high')?.textContent.startsWith('If it sells well at ')`), 'Different resale estimates retain the higher-sale line');
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Profit goal: $30 · Change')`));
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-cash], [data-quick-profit]'))`), false);
    assert.ok(await evaluate(`document.querySelector('.quick-assumptions').textContent.includes('Assumes local pickup, no fees, $30 profit goal')`));
    if (width === 390) {
      await evaluate(`document.querySelector('.quick-assumptions button').click()`);
      assert.equal(await evaluate(`document.activeElement.id`), 'quick-target_profit');
      await fill(input('quick-hours'), '1');
      await calculate('skip');
      assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-keep]'))`), false);
      assert.equal(await evaluate(`document.querySelector('[data-quick-cash]').textContent`), '$32.75');
      assert.ok(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes("That doesn't necessarily mean a cash loss.")`), 'Positive server cash retains the existing skip explanation');
      assert.equal(await evaluate(`document.querySelector('[data-quick-profit]').textContent`), '$12.75');
      assert.ok(await evaluate(`document.querySelector('.quick-assumptions').textContent.includes('Uses your entered costs')`));
      await fill(input('quick-hours'), '0'); await calculate('within_budget');
      await evaluate(`document.querySelector('.quick-details').open=false`);
    }
    assert.equal(await evaluate(`${input('item-notes')}.value`), 'Scratched seat. Check the joints.');
    await geometry(); await screenshot(`photo-answer-${width}.png`);
    await evaluate(`document.querySelector('.quick-sources').open=true`);
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.quick-sources a')).every(a=>a.rel==='noopener noreferrer'&&a.protocol==='https:')`));
    await click('button', 'Save item');
    await savedConfirmation();
    savedFind = (await api('/api/items')).items[0];
    assert.equal(savedFind.inputs.repairs, 15); assert.equal(savedFind.notes, 'Scratched seat. Check the joints.');
    assert.equal(savedFind.assessment.confirmation.preset_acknowledged, true);
    assert.equal(savedFind.assessment.evidence.listings.length, 3);
    assert.equal(savedFind.assessment.confirmation.resale_source, 'assessment');
    assert.ok(!JSON.stringify(savedFind).includes('base64'));
    await open(`?find=${savedFind.id}`);
    await until(`Boolean(document.querySelector('[data-quick-status]'))`);
    await fill(input('item-notes'), 'Notes-only new version.');
    await click('button', 'Save new version'); await savedConfirmation();
    const child = (await api('/api/items')).items[0];
    assert.equal(child.parent_item_id, savedFind.id); assert.equal(child.root_item_id, savedFind.root_item_id);
    assert.deepEqual(child.analysis_result, savedFind.analysis_result);
    assert.deepEqual(child.assessment.evidence, savedFind.assessment.evidence);
    assert.equal(await calls(), count + 1, 'Reopen/save must not call the provider again');
    await geometry(); await screenshot(`photo-reopened-${width}.png`);
    await evaluate(`window.switchFixtureUser('other-user')`);
    await until(`document.body.textContent.includes('Item not found.')`);
    assert.equal(await evaluate(`Boolean(document.getElementById('item-notes'))`), false);
  }
  checks.push('Photo UI at 390/1440 preserves anonymous photos/text through sign-in, confirms repairs before real server math, and shows matching low/high money without overflow');
  checks.push('Photo finds save evidence, confirmed repairs and inputs through the real API; notes-only linked versions preserve results without another paid request');
  checks.push('Photo reopen ownership is enforced; switching accounts clears private inputs, results and notes');
  checks.push('Zero-hour results show one keep amount; entered hours restore distinct cash/profit, compact assumptions reflect edits, and Change focuses the costs');

  const repairRows = () => evaluate(`Array.from(document.querySelectorAll('.quick-repairs li')).map(e=>({label:e.querySelector('.quick-repair-label').textContent,reason:e.querySelector('.quick-repair-reason').textContent,cost:e.querySelector('.quick-repair-price').textContent}))`);
  const normalJobs = new Set(), includedPairs = new Set();
  async function repairEvidence(saved, rows) {
    const original = saved.assessment.evidence.repair_suggestions;
    assert.deepEqual(rows.map(r=>r.label), original.map(r=>r.label), 'Display must preserve every character of every server label');
    assert.deepEqual(rows.map(r=>r.reason), original.map(r=>r.reason), 'AI reasons must remain unchanged');
    for (const row of original) {
      if (row.label.includes(' - Included in ')) includedPairs.add(row.job_id + ':' + row.label.split(' - Included in ')[1].split(' (')[0]);
      else normalJobs.add(row.job_id);
    }
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.quick-repair-label')).every(e=>e.querySelector('.quick-repair-scope') && !e.querySelector('strong').textContent.includes('('))`));
  }
  const supplyNote = "Assumes supplies you already own; if buying new, replace the allowance with what you'll spend, including tax.";
  async function repairGeometry() {
    await geometry();
    assert.ok(await measure(`Array.from(document.querySelectorAll('.quick-repairs li')).every(e=>{
      const row=e.getBoundingClientRect(),text=e.querySelector('.quick-repair-copy').getBoundingClientRect(),price=e.querySelector('.quick-repair-price').getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(e.querySelector('.quick-repair-copy'));
      return row.left>=0 && row.right<=innerWidth && text.right<=price.left && price.right<=row.right &&
        e.scrollWidth<=e.clientWidth && [...range.getClientRects()].every(r=>r.left>=text.left-1 && r.right<=price.left);
    })`), 'Titles, scopes, inclusion text and reasons must wrap without covering or clipping the price');
    assert.ok(await measure(`Array.from(document.querySelectorAll('.quick-repair-scope')).every(e=>{
      const s=getComputedStyle(e),title=getComputedStyle(e.parentElement.querySelector('strong'));
      return s.display==='block' && Number(s.fontWeight)<Number(title.fontWeight) && parseFloat(s.fontSize)<parseFloat(title.fontSize);
    })`), 'Scopes must be separate, smaller and lighter than job titles');
    assert.ok(await measure(`Array.from(document.querySelectorAll('.quick-repair-included')).every(e=>e.textContent.includes('Included in ') && getComputedStyle(e).display==='block' && e.getBoundingClientRect().height>0)`));
    assert.ok(await measure(`Array.from(document.querySelectorAll('.quick-repair-included')).every(e=>{
      const punctuation=e.querySelector('.quick-repair-punctuation'),s=getComputedStyle(punctuation);
      return punctuation.textContent===' - ' && s.clipPath==='inset(50%)' && s.position==='absolute' && s.overflow==='hidden' &&
        e.lastChild.textContent.startsWith('Included in ');
    })`), 'Only the leading dash is visually hidden; exact stored label text remains intact');
    assert.ok(await evaluate(`document.querySelector('.quick-repairs').textContent.includes(${JSON.stringify(supplyNote)})`));
  }
  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    for (const [kind, total] of [['paint_chair', 25], ['paint_dresser', 50], ['surfaces', 58]]) {
      await mode(kind); await open(); await upload(); await fill(input('quick-asking'), '20'); await runAI();
      const rows = await repairRows();
      assert.equal(rows.length, kind === 'surfaces' ? 4 : 3);
      assert.deepEqual(rows.slice(0, 2).map(r=>r.cost), kind === 'surfaces' ? ['$5.00', '$8.00'] : ['$0.00', '$0.00']);
      assert.deepEqual(rows.slice(0, 2).map(r=>r.reason), ['Visible work: clean', 'Visible work: scratch_touchup']);
      assert.equal(rows.filter(r=>r.label.includes('Included in')).length, kind === 'surfaces' ? 0 : 2);
      if (kind === 'surfaces') assert.equal(rows.filter(r=>r.label.includes('This surface only')).length, 2);
      assert.equal(await evaluate(`Boolean(${input('quick-repairs')})`), false);
      await calculate(kind === 'paint_chair' ? 'stretch' : 'skip');
      await click('button', 'Save item'); await savedConfirmation();
      const suggested = (await api('/api/items')).items[0];
      await repairEvidence(suggested, rows);
      assert.equal(suggested.inputs.repairs, total);
      assert.equal(suggested.assessment.evidence.repair_catalog_version, '2026-10-06-draft2');
      assert.equal(suggested.assessment.confirmation.repairs.length, rows.length);
      await repairGeometry(); await screenshot(`photo-${kind}-${width}.png`);
      await click('button', 'Change repair budget');
      assert.equal(await evaluate(`${input('quick-repairs')}.value`), total.toFixed(2));
      assert.deepEqual(await repairRows(), rows, 'Changing the budget must not hide any repair evidence');
      await fill(input('quick-repairs'), String(total + 10));
      await calculate('skip');
      await click('button', 'Save new version'); await savedConfirmation();
      const custom = (await api('/api/items')).items[0];
      assert.equal(custom.inputs.repairs, total + 10);
      assert.deepEqual(custom.assessment.confirmation.repairs, [{job_id:'custom', materials_cost:total + 10}]);
      assert.deepEqual(custom.assessment.evidence, suggested.assessment.evidence);
      assert.deepEqual(await api(`/api/items/${suggested.id}`), suggested, 'The earlier saved version must not change');
      await repairGeometry();
    }

    await mode('overlap'); await open(); await upload(); await fill(input('quick-asking'), '20');
    const before = await calls(); await runAI();
    const rows = await repairRows();
    assert.deepEqual(rows.map(r=>r.cost), ['$0.00', '$50.00', '$30.00']);
    assert.ok(rows[0].label.includes('Included in Prep and paint a small dresser'));
    assert.equal(rows[0].reason, 'Visible work: clean');
    assert.equal(await evaluate(`${input('quick-repairs')}.value`), '', 'Mixed dresser/top work must start empty, never $80');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Change repair budget')`), false);
    assert.ok(await evaluate(`document.querySelector('.quick-repairs').textContent.includes('enter one total repair budget')`));
    await evaluate(`document.querySelector('[data-quick-calculate]').click()`);
    await until(`${input('quick-repairs')}.getAttribute('aria-invalid') === 'true'`);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status]'))`), false);
    await repairGeometry(); await screenshot(`photo-overlap-empty-${width}.png`);
    await fill(input('quick-repairs'), '0'); await calculate('within_budget');
    await fill(input('quick-repairs'), '72'); await calculate('skip');
    await click('button', 'Save item'); await savedConfirmation();
    const mixed = (await api('/api/items')).items[0];
    await repairEvidence(mixed, rows);
    assert.equal(mixed.inputs.repairs, 72);
    assert.deepEqual(mixed.assessment.confirmation.repairs, [{job_id:'custom', materials_cost:72}]);
    assert.equal(mixed.assessment.evidence.inputs.repairs, null);
    await open(`?find=${mixed.id}`); await until(`Boolean(document.querySelector('[data-quick-status]'))`);
    assert.equal(await evaluate(`${input('quick-repairs')}.value`), '72');
    assert.deepEqual(await repairRows(), rows);
    await fill(input('item-notes'), 'Keep the painted body and stained top budget.');
    await click('button', 'Save new version'); await savedConfirmation();
    const child = (await api('/api/items')).items[0];
    assert.equal(child.parent_item_id, mixed.id); assert.equal(child.root_item_id, mixed.root_item_id);
    assert.deepEqual(child.analysis_result, mixed.analysis_result);
    assert.deepEqual(child.assessment, mixed.assessment);
    assert.deepEqual(await api(`/api/items/${mixed.id}`), mixed);
    assert.equal(await calls(), before + 1, 'Calculations, reopen and saves must not make another provider call');
    await repairGeometry(); await screenshot(`photo-overlap-reopened-${width}.png`);
  }
  checks.push('At 390/1440 all four paint-only included-work pairs stay visible at $0 with original reasons; seat/top combinations still sum');
  checks.push('Long catalog scopes wrap clear of prices; the supplies sentence and all repair evidence stay visible while editing budgets');
  checks.push('Dresser/top overlap opens empty with no $80 prefill; blank blocks calculation, explicit zero works, and entered $72 saves as one custom total');
  checks.push('Mixed-finish save/reopen and notes-only versions preserve evidence, confirmed total and server results without another provider call or changing old records');

  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', {width, height:1000, deviceScaleFactor:1, mobile:width === 390});
    await mode('catalog'); await open(); await upload(); await runAI();
    await fill(input('quick-repairs'), '100'); await calculate('offer_only');
    const rows = await repairRows();
    assert.equal(rows.length, 10);
    await click('button', 'Save item'); await savedConfirmation();
    await repairEvidence((await api('/api/items')).items[0], rows);
    await repairGeometry(); await screenshot(`photo-catalog-${width}.png`);
    if (width === 390) assert.ok(await measure(`Array.from(document.querySelectorAll('.quick-repair-scope')).some(e=>e.getBoundingClientRect().height>parseFloat(getComputedStyle(e).lineHeight)*2)`), 'Phone scope text must visibly wrap');

    await mode('label_fallback'); await open(); await upload(); await runAI();
    assert.deepEqual((await repairRows()).map(r=>r.label), fallbackLabels);
    assert.equal(await evaluate(`document.querySelectorAll('.quick-repair-scope,.quick-repair-included').length`), 0, 'Unknown label formats must remain intact');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.quick-repair-label strong')).map(e=>e.textContent)`), fallbackLabels);
    await repairGeometry();
  }
  assert.equal(normalJobs.size, 10, 'Every catalog job must be checked without absorption');
  assert.equal(includedPairs.size, 4, 'All four absorbed pairs must preserve their full labels');
  checks.push('All 10 catalog jobs and four absorbed pairs preserve exact label text, visible AI reasons and saved evidence; scopes have a lighter hierarchy at 390/1440');
  checks.push('Ten unrecognized label formats remain intact without split styling at 390/1440');

  await mode('legacy'); await open(); await upload(); await fill(input('quick-asking'), '20'); await runAI();
  await calculate('skip'); await click('button', 'Save item'); await savedConfirmation();
  const legacy = (await api('/api/items')).items[0];
  assert.equal(legacy.inputs.repairs, 65);
  assert.equal(legacy.assessment.evidence.repair_catalog_version, '2026-10-06-draft1');
  await mode('normal'); const beforeLegacy = await calls();
  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', {width, height:1000, deviceScaleFactor:1, mobile:width === 390});
    await open(`?find=${legacy.id}`); await until(`Boolean(document.querySelector('[data-quick-status]'))`);
    assert.equal(await evaluate(`${input('quick-repairs')}.value`), '65');
    const rows = await repairRows();
    assert.deepEqual(rows.map(r=>r.cost), ['$5.00', '$35.00', '$25.00']);
    assert.deepEqual(rows.map(r=>r.label), legacy.assessment.evidence.repair_suggestions.map(r=>r.label));
    assert.equal(await evaluate(`document.querySelectorAll('.quick-repair-scope,.quick-repair-included').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('.quick-repairs .quick-notice').length`), 0);
    await fill(input('item-notes'), `Draft1 notes-only version at ${width}.`);
    await click('button', 'Save new version'); await savedConfirmation();
    const child = (await api('/api/items')).items[0];
    assert.deepEqual(child.assessment, legacy.assessment);
    assert.deepEqual(child.analysis_result, legacy.analysis_result);
    assert.deepEqual(await api(`/api/items/${legacy.id}`), legacy);
    await repairGeometry(); await screenshot(`photo-draft1-reopened-${width}.png`);
  }
  assert.equal(await calls(), beforeLegacy);
  checks.push('Draft1 snapshots reopen at 390/1440 with original $65 budget, labels, prices and evidence; notes-only saving does not apply draft2 rules');

  await open(`?find=${savedFind.id}&fixtureSignedOut=1`);
  await until(`document.body.textContent.includes('Sign in to reopen item')`);
  assert.equal(await evaluate(`Boolean(document.getElementById('item-notes'))`), false);
  checks.push('Signed-out photo reopen shows a sign-in prompt without fetching private data');

  await mode('normal'); await open(); await upload();
  await fill(input('quick-asking'), '1e3'); const invalidCount = await calls();
  await evaluate(`document.querySelector('[data-quick-assess]').click()`);
  await until(`document.querySelector('[role=alert]')?.textContent.includes('plain number')`);
  assert.equal(await calls(), invalidCount);
  await fill(input('quick-asking'), '20');
  await evaluate(`window.authFixture={calls:0,delayMs:250};const b=document.querySelector('[data-quick-assess]');b.click();b.click();`);
  await until(`Boolean(document.querySelector('.quick-resale'))`);
  assert.equal(await calls(), invalidCount + 1);
  await calculate('within_budget');
  await fill(input('item-notes'), 'Keep this note through cost changes.');
  await evaluate(`document.querySelector('.quick-details').open=true`);
  await fill(input('quick-fee_pct'), '14.3');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status]'))`), false);
  await calculate('stretch');
  assert.equal(await evaluate(`${input('item-notes')}.value`), 'Keep this note through cost changes.');
  await click('button', 'Save item'); await savedConfirmation();
  assert.equal((await api('/api/items')).items[0].inputs.fee_pct, .143);
  checks.push('Photo requests reject invalid numbers before spending, lock before token lookup, ignore duplicate taps, and recalculate 14.3% through the server without losing notes');

  await mode('short'); await open(); await upload(); await fill(input('quick-asking'), '20'); await runAI();
  await until(`Boolean(document.getElementById('quick-resale_low'))`);
  await fill(input('quick-resale_low'), '90'); await calculate('within_budget');
  await click('button', 'Save item'); await savedConfirmation();
  const own = (await api('/api/items')).items[0];
  assert.equal(own.assessment.confirmation.resale_source, 'user_estimate');
  assert.equal(own.inputs.resale_low, 90); assert.equal(own.inputs.resale_high, 90);
  checks.push('Fewer than three comparables asks one sale-price question and saves its provenance as the user estimate');

  for (const kind of ['disabled', 'cap']) {
    await mode(kind); const before = await calls(); await open();
    await until(`Boolean(document.getElementById('quick-resale_low'))`);
    assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Photo estimate"], [data-quick-assess]'))`), false, 'Known unavailable AI must not show a dead photo box');
    if (kind === 'cap') assert.ok(await evaluate(`document.body.textContent.includes('AI estimates are paused until the 1st')`));
    await fill(input('quick-resale_low'), '65'); await fill(input('quick-repairs'), '15');
    await calculate('offer_only');
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-cash]'))`), false);
    await fill(input('quick-purchase_price'), '60'); await calculate('skip');
    assert.ok(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes("I'd pass at $60. Offer $17 or walk.")`));
    assert.equal(await evaluate(`document.querySelector('[data-quick-keep]').textContent`), '-$12.25');
    assert.ok(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes("At their price, you'd likely lose money.")`));
    assert.equal(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes("doesn't necessarily mean a cash loss")`), false);
    assert.equal(await evaluate(`Boolean(document.querySelector('.quick-high'))`), false, 'Equal resale estimates do not repeat the result');
    assert.equal(await calls(), before);
    await geometry(); await screenshot(`photo-${kind}-fallback.png`);
    for (const [price,cash] of [['47.75','$0.00'],['40','$7.75']]) {
      await fill(input('quick-purchase_price'), price); await calculate('skip');
      assert.equal(await evaluate(`document.querySelector('[data-quick-keep]').textContent`), cash);
      assert.ok(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes("That doesn't necessarily mean a cash loss.")`));
      assert.equal(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes("you'd likely lose money")`), false);
    }
    await evaluate(`document.querySelector('.quick-details').open=true`);
    for (const [goal,headline] of [['40.50','$40.50'],['30','$30']]) {
      await fill(input('quick-target_profit'), goal); await calculate('skip');
      assert.ok(await evaluate(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent===${JSON.stringify(`Profit goal: ${headline} · Change`)})`));
    }
    assert.equal(await calls(), before, 'Display polish and recalculation make no provider calls');
  }
  checks.push('Disabled AI and paused budget preserve the public short calculator, offer-only results and honest skip wording without any provider call');
  checks.push('Skip wording follows negative, zero and positive server cash; equal resale estimates hide the repeated line while different estimates show it');
  checks.push('Result profit goals omit whole-dollar cents but preserve $40.50 without changing server calculations');

  await mode('overloaded'); await open(); await upload(); await fill(input('quick-asking'), '20'); await runAI();
  await until(`document.querySelector('[role=alert]')?.textContent.includes("AI couldn't finish")`);
  assert.ok(await evaluate(`!document.querySelector('[data-quick-assess]').disabled`));
  await mode('normal'); await runAI(); await calculate('within_budget');
  checks.push('Returned provider failure displays the manual fallback and permits a fresh user-requested assessment');

  await mode('normal'); await open(); await upload();
  await evaluate(`window.authFixture={calls:0,delayMs:500};document.querySelector('[data-quick-assess]').click();window.switchFixtureUser('other-user');`);
  const beforeSwitch = await calls(); await pause(650);
  assert.equal(await calls(), beforeSwitch);
  assert.equal(await evaluate(`${input('quick-description')}.value`), '');
  assert.equal(await evaluate(`document.querySelectorAll('.quick-photo').length`), 0);
  checks.push('Account changes while waiting for the sign-in token cancel photo submissions and clear uploaded photos');

  await open(); await upload();
  await evaluate(`(()=>{const original=window.fetch;window.fetch=async(input,init)=>{const response=await original(input,init);if(new URL(typeof input==='string'?input:input.url).pathname==='/api/items/assess')await new Promise(resolve=>setTimeout(resolve,600));return response;};})()`);
  const onWire = await calls();
  await evaluate(`document.querySelector('[data-quick-assess]').click()`);
  for (let i=0;i<80 && await calls()===onWire;i++) await pause(25);
  assert.equal(await calls(), onWire + 1);
  await evaluate(`window.switchFixtureUser('other-user')`); await pause(800);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status], .quick-sources'))`), false);
  assert.equal(await evaluate(`document.querySelectorAll('.quick-photo').length`), 0);
  checks.push('An assessment response arriving after an account switch cannot restore the previous account\'s evidence or photos');

  // Last because the real timeout intentionally holds the shared budget gate.
  await mode('timeout'); await open(); await upload(); const beforeTimeout = await calls(); await runAI();
  await until(`document.body.textContent.includes("Your photo estimate hasn't finished")`);
  await click('button', 'Check estimate status');
  await until(`!document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled`);
  assert.equal(await calls(), beforeTimeout + 1);
  await fill(input('quick-resale_low'), '80'); await fill(input('quick-repairs'), '10'); await calculate('offer_only');
  assert.equal(await calls(), beforeTimeout + 1);
  checks.push('Uncertain assessments are never retried; status checks use GET and the manual calculator remains usable while the hold is active');
}
