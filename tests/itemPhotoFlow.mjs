import assert from "node:assert/strict";

// Appended ONLY to the temporary browser fixture, never imported by the app.
// The real API, budget ledger, analysis engine and persistence run locally.
// Only the paid provider and sign-in are substituted. No real credentials.
export const photoBackendFixture = `
import json, httpx
from app.services import item_assessment_service as ai
from app.services import item_ai_budget_service as budget
from app.db.session import SessionLocal
from app.db.models.item_ai_budget import ItemAIMonth
os.environ.update(ITEMS_AI_ALLOWED_USER_IDS='browser-fixture,other-user', ITEMS_ANTHROPIC_API_KEY='browser-test-only', ITEMS_ANTHROPIC_WORKSPACE_ID='browser-test', ITEMS_AI_WORKSPACE_LIMIT_CONFIRMED='20', ITEMS_REPAIR_CATALOG_APPROVED='2026-10-06-draft1')
fixture_ai = {'mode': 'normal', 'calls': 0}
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
    report = dict(item_name='Wood dining chair', category='Chair', asking_price=text.get('asking_price', 20), repairs=[dict(job_id='sand_seat', reason='Visible scratches on the seat')], repair_unknowns=[], listings=listings)
    return dict(stop_reason='end_turn', usage=dict(input_tokens=12000, output_tokens=1000, server_tool_use=dict(web_search_requests=2)), content=[dict(type='text', text=json.dumps(report), citations=[dict(type='web_search_result_location', url=row['url'], cited_text='Used chair $' + str(row['price']) + ', local pickup.') for row in listings])])
ai.call_provider = photo_provider
@app.post('/browser-fixture/ai/{mode}')
def ai_mode(mode: str):
    fixture_ai['mode'] = mode
    os.environ['ITEMS_REPAIR_CATALOG_APPROVED'] = '' if mode == 'disabled' else '2026-10-06-draft1'
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
  }
  async function runAI() {
    await until(`document.querySelector('[data-quick-assess]') && !document.querySelector('[data-quick-assess]').disabled`);
    await evaluate(`document.querySelector('[data-quick-assess]').click()`);
    await until(`Boolean(document.querySelector('.quick-resale')) || Boolean(document.querySelector('[role=alert]')) || Boolean(document.getElementById('quick-resale_low'))`);
    await until(`!document.querySelector('[aria-label="Confirm estimate"] fieldset')?.disabled`);
  }
  async function calculate(status) {
    await evaluate(`document.querySelector('[data-quick-calculate]').click()`);
    await until(`document.querySelector('[data-quick-status]')?.dataset.quickStatus === ${JSON.stringify(status)}`);
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
    await fill(input('quick-asking'), '20');
    await upload();
    await geometry(); await screenshot(`photo-entry-${width}.png`);
    assert.equal(await calls(), count);
    await evaluate(`window.switchFixtureUser('browser-fixture')`);
    await until(`Boolean(document.querySelector('[data-quick-assess]'))`);
    assert.equal(await evaluate(`${input('quick-description')}.value`), 'Wood chair, scratched seat, they want twenty.');
    assert.equal(await evaluate(`${input('quick-asking')}.value`), '20');
    assert.equal(await evaluate(`document.querySelectorAll('.quick-photo img').length`), 1);
    await runAI();
    assert.equal(await calls(), count + 1);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status]'))`), false, 'No offer before repairs are confirmed');
    await fill(input('item-notes'), 'Scratched seat. Check the joints.');
    await calculate('within_budget');
    assert.ok(await evaluate(`document.querySelector('[aria-label="Your offer"]').textContent.includes('Good buy at $20.00.')`));
    assert.equal(await evaluate(`document.querySelector('[data-quick-offer]').textContent`), '$22');
    assert.equal(await evaluate(`document.querySelector('[data-quick-cash]').textContent`), '$32.75');
    assert.equal(await evaluate(`document.querySelector('[data-quick-profit]').textContent`), '$32.75');
    assert.equal(await evaluate(`${input('item-notes')}.value`), 'Scratched seat. Check the joints.');
    await geometry(); await screenshot(`photo-answer-${width}.png`);
    await evaluate(`document.querySelector('.quick-sources').open=true`);
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.quick-sources a')).every(a=>a.rel==='noopener noreferrer'&&a.protocol==='https:')`));
    await click('button', 'Save item');
    await until(`document.body.textContent.includes('Saved version #')`);
    savedFind = (await api('/api/items')).items[0];
    assert.equal(savedFind.inputs.repairs, 15); assert.equal(savedFind.notes, 'Scratched seat. Check the joints.');
    assert.equal(savedFind.assessment.confirmation.preset_acknowledged, true);
    assert.equal(savedFind.assessment.evidence.listings.length, 3);
    assert.equal(savedFind.assessment.confirmation.resale_source, 'assessment');
    assert.ok(!JSON.stringify(savedFind).includes('base64'));
    await open(`?find=${savedFind.id}`);
    await until(`Boolean(document.querySelector('[data-quick-status]'))`);
    await fill(input('item-notes'), 'Notes-only new version.');
    await click('button', 'Save new version'); await until(`document.body.textContent.includes('Saved version #')`);
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
  await click('button', 'Save item'); await until(`document.body.textContent.includes('Saved version #')`);
  assert.equal((await api('/api/items')).items[0].inputs.fee_pct, .143);
  checks.push('Photo requests reject invalid numbers before spending, lock before token lookup, ignore duplicate taps, and recalculate 14.3% through the server without losing notes');

  await mode('short'); await open(); await upload(); await runAI();
  await until(`Boolean(document.getElementById('quick-resale_low'))`);
  await fill(input('quick-resale_low'), '90'); await calculate('within_budget');
  await click('button', 'Save item'); await until(`document.body.textContent.includes('Saved version #')`);
  const own = (await api('/api/items')).items[0];
  assert.equal(own.assessment.confirmation.resale_source, 'user_estimate');
  assert.equal(own.inputs.resale_low, 90); assert.equal(own.inputs.resale_high, 90);
  checks.push('Fewer than three comparables asks one sale-price question and saves its provenance as the user estimate');

  for (const kind of ['disabled', 'cap']) {
    await mode(kind); const before = await calls(); await open();
    await until(`Boolean(document.getElementById('quick-resale_low'))`);
    if (kind === 'cap') assert.ok(await evaluate(`document.body.textContent.includes('AI estimates are paused until the 1st')`));
    await fill(input('quick-resale_low'), '65'); await fill(input('quick-repairs'), '15');
    await calculate('offer_only');
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-cash]'))`), false);
    await fill(input('quick-purchase_price'), '60'); await calculate('skip');
    assert.ok(await evaluate(`document.body.textContent.includes("doesn't necessarily mean a cash loss")`));
    assert.equal(await calls(), before);
    await geometry(); await screenshot(`photo-${kind}-fallback.png`);
  }
  checks.push('Disabled AI and paused budget preserve the public short calculator, offer-only results and honest skip wording without any provider call');

  await mode('overloaded'); await open(); await upload(); await runAI();
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
