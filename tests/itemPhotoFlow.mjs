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
fixture_ai = {'mode': 'normal', 'calls': 0, 'reads': 0, 'posts': 0}
@app.middleware('http')
async def count_assessment_requests(request, call_next):
    if request.url.path == '/api/items/assess' and request.method == 'POST':
        fixture_ai['posts'] += 1
    if request.url.path.startswith('/api/items/assessments/') and request.method == 'GET':
        fixture_ai['reads'] += 1
    return await call_next(request)
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
  async function open(query = '', recover = false) {
    // Independent existing scenarios start a fresh find; recovery checks opt in.
    if (!recover) await evaluate(`Object.keys(sessionStorage).filter(k=>k.startsWith('flipforge:item-assessment:')).forEach(k=>sessionStorage.removeItem(k))`);
    await evaluate('window.beforeQuickNavigation = true');
    await cdp('Page.navigate', { url: `http://127.0.0.1:5173/items${query}` });
    await until(`!window.beforeQuickNavigation && Boolean(document.querySelector('.items-quick'))`);
  }
  async function upload({ gallery = false, count = 1, expected = 1 } = {}) {
    await until(`Boolean(document.querySelector('input[type=file]'))`);
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=1800;c.height=1200;const x=c.getContext('2d');x.fillStyle='#ded5c4';x.fillRect(0,0,1800,1200);x.strokeStyle='#765536';x.lineWidth=45;x.strokeRect(620,240,560,390);x.beginPath();x.moveTo(620,630);x.lineTo(560,950);x.moveTo(1180,630);x.lineTo(1240,950);x.moveTo(590,760);x.lineTo(1210,760);x.stroke();const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg'));const d=new DataTransfer();for(let i=0;i<${count};i++)d.items.add(new File([blob],'chair-fixture-'+i+'.jpg',{type:'image/jpeg'}));const e=document.querySelector(${JSON.stringify(gallery ? '[aria-label="Choose item photos"]' : '[aria-label="Take item photo"]')});e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.querySelectorAll('.quick-photo img').length === ${expected} && !document.body.textContent.includes('Preparing your photos')`);
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
    await until(`!document.body.textContent.includes('Checking AI availability…')`);
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
  const speedRows = `Object.fromEntries([...document.querySelectorAll('.quick-speed dl > div')].map(e=>[e.querySelector('dt').textContent,e.querySelector('dd').textContent]))`;
  const speedEntries = `performance.getEntriesByType('measure').filter(e=>e.name.startsWith('flipforge.items.'))`;
  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await open('?fixtureSignedOut=1');
    await until(`Boolean(document.querySelector('.quick-speed'))`);
    assert.equal(await evaluate(`document.querySelector('.quick-speed').open`), false);
    assert.deepEqual(await evaluate(speedRows), {});
    const before = await (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json();
    assert.ok(await evaluate(`(()=>{const c=document.querySelector('[aria-label="Take item photo"]'),g=document.querySelector('[aria-label="Choose item photos"]');return c.getAttribute('capture')==='environment'&&!c.multiple&&g.multiple&&!g.hasAttribute('capture')})()`));
    // Simulated picker cancellation, not proof of physical camera behaviour.
    await evaluate(`document.querySelectorAll('.quick-photo-actions input').forEach(e=>{e.files=new DataTransfer().files;e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('cancel',{bubbles:true}));})`);
    assert.deepEqual(await evaluate(speedRows), {});
    await fill(input('quick-description'), 'Keep this description'); await fill(input('quick-asking'), '20');
    await upload();
    await until(`Boolean((${speedRows})['Photo preparation'])`);
    await evaluate(`document.querySelector('.quick-speed').open=true`);
    await geometry(); await screenshot(`photo-camera-speed-${width}.png`);
    await upload({ gallery: true, count: 3, expected: 1 });
    await until(`document.body.textContent.includes('Use up to three photos.')`);
    await upload({ gallery: true, count: 2, expected: 3 });
    assert.equal(await evaluate(`document.querySelectorAll('.quick-photo-actions input').length`), 0);
    assert.equal(await evaluate(`${input('quick-description')}.value`), 'Keep this description');
    assert.equal(await evaluate(`${input('quick-asking')}.value`), '20');
    await evaluate(`document.querySelector('[aria-label="Remove photo 3"]').click()`);
    await until(`document.querySelectorAll('.quick-photo-actions input').length===2`);
    const after = await (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json();
    assert.equal(after.posts, before.posts); assert.equal(after.calls, before.calls);
    await geometry();
  }
  checks.push('390/1440 camera and gallery inputs preserve text, support cancel/remove and the three-photo limit, show local preparation timing and send zero assessment POSTs');

  await mode('normal');
  const timingScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.speedClock=1000;performance.now=()=>window.speedClock;
    window.speedReleases=[];window.speedGets=0;
    const original=window.fetch;
    window.fetch=async(input,init)=>{
      if(new URL(typeof input==='string'?input:input.url).pathname!=='/api/items/ai-budget')return original(input,init);
      const n=++window.speedGets;const response=await original(input,init);
      await new Promise(resolve=>window.speedReleases.push(resolve));
      if(n===1)return new Response(JSON.stringify({...await response.json(),available:false,reason:'assessment_busy',message:null}),{status:200});
      return response;
    };` });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await open(); await until(`window.speedReleases.length===1`);
  assert.deepEqual(await evaluate(speedRows), {});
  await evaluate(`window.speedClock=42200;window.speedReleases.shift()()`);
  await until(`(${speedRows})['First availability check']==='41.2s'`);
  assert.equal(await evaluate(`document.querySelector('.quick-speed').open`), false);
  await click('button', 'Check AI availability'); await until(`window.speedReleases.length===1`);
  await evaluate(`window.speedClock=42400;window.speedReleases.shift()()`);
  await until(`(${speedRows})['Latest availability check']==='0.2s'`);
  assert.equal(await evaluate(`(${speedRows})['First availability check']`), '41.2s');
  await evaluate(`document.querySelector('.quick-speed').open=true`);
  await geometry(); await screenshot('photo-speed-availability-390.png');
  assert.equal(await evaluate(`${speedEntries}.length`), 2);
  // An old account's held response cannot repopulate cleared timing values.
  await evaluate(`window.switchFixtureUser('other-user')`);
  await until(`window.speedReleases.length===1`);
  assert.deepEqual(await evaluate(speedRows), {});
  await evaluate(`window.switchFixtureUser(null)`);
  await until(`document.body.textContent.includes('Sign in for a photo estimate')`);
  await evaluate(`window.speedClock=50000;window.speedReleases.shift()()`); await pause(100);
  assert.deepEqual(await evaluate(speedRows), {});
  assert.equal(await evaluate(`${speedEntries}.length`), 0);
  await upload(); await until(`(${speedRows})['Photo preparation']==='0.0s'`);
  await evaluate(`document.querySelector('.quick-nav a[href="/"]').click()`);
  await until(`!document.querySelector('.items-quick')`);
  assert.equal(await evaluate(`${speedEntries}.length`), 0);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: timingScript.identifier });
  checks.push('390px Speed panel starts collapsed/empty, shows exact first/latest availability seconds, retains the initial wait and clears on account changes and route exit despite late responses');

  const deadlineScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.speedClock=1000;performance.now=()=>window.speedClock;
    const nativeTimeout=window.setTimeout,original=window.fetch;
    window.setTimeout=(fn,ms,...args)=>nativeTimeout(ms===120000?()=>{window.speedClock+=120000;fn(...args)}:fn,ms===120000?100:ms,...args);
    window.fetch=(input,init)=>new URL(typeof input==='string'?input:input.url).pathname==='/api/items/ai-budget'
      ?new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Fixture abort','AbortError')),{once:true}))
      :original(input,init);` });
  const beforeDeadline = await (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json();
  await open();
  await until(`(${speedRows})['First availability check']==='120.0s'`);
  assert.equal(await evaluate(`(${speedRows})['Latest availability check']`), '120.0s');
  assert.ok(await evaluate(`document.body.textContent.includes("The estimate wasn't confirmed in time.")`));
  const afterDeadline = await (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json();
  assert.equal(afterDeadline.posts, beforeDeadline.posts); assert.equal(afterDeadline.calls, beforeDeadline.calls);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: deadlineScript.identifier });
  checks.push('Browser-side deadline records elapsed time on an aborted availability request without any assessment POST');

  await mode('normal');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await open(); await upload();
  await fill(input('quick-description'), 'Keep this chair description'); await fill(input('quick-asking'), '20');
  const beforeStall = await (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json();
  await evaluate(`(()=>{
    const NativeImage=window.Image, nativeTimeout=window.setTimeout;
    window.photoBeforeStall=document.querySelector('.quick-photo img').src;
    window.Image=class { onload=null; onerror=null; src=''; };
    window.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===20000?1000:ms,...args);
    window.restorePhotoLoad=()=>{window.Image=NativeImage;window.setTimeout=nativeTimeout;};
    const files=new DataTransfer();files.items.add(new File(['stalled fixture'],'stalled.jpg',{type:'image/jpeg'}));
    const input=document.querySelector('input[type=file]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  try {
    await until(`document.body.textContent.includes('Preparing your photos…')`);
    assert.ok(await evaluate(`${input('quick-description')}.matches(':disabled')`));
    await until(`document.body.textContent.includes('That photo took too long to open. Try another, or enter details below.') && !${input('quick-description')}.matches(':disabled')`);
    assert.equal(await evaluate(`document.body.textContent.includes('Preparing your photos…')`), false);
    assert.equal(await evaluate(`${input('quick-description')}.value`), 'Keep this chair description');
    assert.equal(await evaluate(`${input('quick-asking')}.value`), '20');
    assert.ok(await evaluate(`document.querySelectorAll('.quick-photo img').length===1 && document.querySelector('.quick-photo img').src===window.photoBeforeStall && !document.querySelector('input[type=file]').matches(':disabled')`));
    const afterStall = await (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json();
    assert.equal(afterStall.posts, beforeStall.posts); assert.equal(afterStall.calls, beforeStall.calls);
    await geometry(); await screenshot('photo-load-timeout-390.png');
  } finally { await evaluate('window.restorePhotoLoad()'); }
  checks.push('390px stalled photo load times out, unlocks the editor and preserves existing photo/text without an assessment POST');
  let savedFind;
  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await open('?fixtureSignedOut=1');
    await until(`Boolean(${input('quick-description')})`);
    assert.equal(await evaluate(`document.querySelector('.quick-intro > p:last-child').textContent`), 'Snap a photo. Tell us what you know.Get a starting offer and a plan for the work.', 'Signed-out photo entry keeps its photo-first intro');
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
    assert.ok(await evaluate(`Boolean((${speedRows})['Estimate request'])`));
    assert.ok(await evaluate(`${speedEntries}.length<=5`));
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
    assert.equal(await evaluate(`document.querySelector('.quick-intro > p:last-child').textContent`), "Enter what you know.We'll help you work out an offer.", 'Unavailable AI uses the manual intro with the photo form hidden');
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

  const recoveryKey = 'flipforge:item-assessment:browser-fixture';
  const storedId = () => evaluate(`sessionStorage.getItem(${JSON.stringify(recoveryKey)})`);
  const requests = async () => (await fetch('http://127.0.0.1:8000/browser-fixture/ai')).json();
  const restoreMarker = async id => evaluate(`sessionStorage.setItem(${JSON.stringify(recoveryKey)}, ${JSON.stringify(id)})`);
  // Control only the free readiness response. Assessments still use the real
  // local API and simulated provider, with backend POST/provider counters.
  await mode('normal');
  const readinessScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.budgetTest={mode:'hold',gets:0,releases:[]};
    const original=window.fetch;
    window.fetch=async(input,init)=>{
      if(new URL(typeof input==='string'?input:input.url).pathname!=='/api/items/ai-budget')return original(input,init);
      const test=window.budgetTest;test.gets++;const mode=test.mode;
      const response=await original(input,init);
      if(mode==='hold')await new Promise(resolve=>test.releases.push(resolve));
      if(mode==='failed')throw new TypeError('Fixture network failure');
      if(mode==='denied')return new Response(JSON.stringify({detail:"AI isn't available"}),{status:403});
      if(['assessment_busy','budget_paused','not_configured'].includes(mode)){
        const body=await response.json();return new Response(JSON.stringify({...body,available:false,reason:mode,message:null}),{status:200});
      }
      return response;
    };` });
  const budgetRetry = `Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Check AI availability')`;
  const paidDisabled = `!document.querySelector('[data-quick-assess]') || document.querySelector('[data-quick-assess]').disabled`;
  const beforeReadiness = await requests();
  await open();
  await until(`window.budgetTest.releases.length>0`);
  assert.ok(await evaluate(paidDisabled));
  await upload(); await fill(input('quick-description'), 'Keep my chair description'); await fill(input('quick-asking'), '22');
  await evaluate(`document.querySelector('[data-quick-assess]').click();${budgetRetry}.click();${budgetRetry}.click()`);
  const initialGets = await evaluate('window.budgetTest.gets');
  await evaluate(`window.budgetTest.releases.splice(0).forEach(fn=>fn())`);
  await until(`!document.querySelector('[data-quick-assess]').disabled`);
  assert.equal(await evaluate('window.budgetTest.gets'), initialGets);
  assert.equal((await requests()).posts, beforeReadiness.posts);
  checks.push('Loading readiness disables paid submission and retry; neither button sends an assessment POST while checking');

  // Re-enter with a failed initial check, then test every unavailable reason.
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: readinessScript.identifier });
  const failedScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.failBudgetOnce=true;const original=window.fetch;window.fetch=(input,init)=>{if(window.failBudgetOnce&&new URL(typeof input==='string'?input:input.url).pathname==='/api/items/ai-budget')return Promise.reject(new TypeError('Fixture network failure'));return original(input,init);};` });
  await open(); await until(`Boolean(${budgetRetry}) && !${budgetRetry}.disabled`);
  assert.ok(await evaluate(paidDisabled));
  await upload(); await fill(input('quick-description'), 'Keep my chair description'); await fill(input('quick-asking'), '22');
  await fill(input('quick-resale_low'), '95'); await fill(input('quick-repairs'), '12');
  await evaluate(`window.failBudgetOnce=false;window.budgetTest={mode:'hold',afterHold:'assessment_busy',gets:0,releases:[]};const previous=window.fetch;window.fetch=async(input,init)=>{
    if(new URL(typeof input==='string'?input:input.url).pathname!=='/api/items/ai-budget')return previous(input,init);
    const test=window.budgetTest;test.gets++;let mode=test.mode;const response=await previous(input,init);
    if(mode==='hold'){await new Promise(resolve=>test.releases.push(resolve));mode=test.afterHold||'normal';}
    if(mode==='failed')throw new TypeError('Fixture network failure');
    if(mode==='denied')return new Response(JSON.stringify({detail:"AI isn't available"}),{status:403});
    if(['assessment_busy','budget_paused','not_configured'].includes(mode)){const body=await response.json();return new Response(JSON.stringify({...body,available:false,reason:mode,message:null}),{status:200});}
    return response;
  };`);
  await evaluate(`${budgetRetry}.click();${budgetRetry}.click();${budgetRetry}.click()`);
  await until(`window.budgetTest.releases.length===1`);
  assert.equal(await evaluate('window.budgetTest.gets'), 1);
  assert.ok(await evaluate(paidDisabled));
  await evaluate(`window.budgetTest.releases.splice(0).forEach(fn=>fn())`);
  await until(`Boolean(${budgetRetry}) && !${budgetRetry}.disabled`);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Photo estimate"]'))`), false);
  await evaluate(`window.budgetTest.afterHold=null;${budgetRetry}.click()`);
  await until(`window.budgetTest.releases.length===1`);
  assert.equal(await evaluate('window.budgetTest.gets'), 2);
  await evaluate(`window.budgetTest.releases.splice(0).forEach(fn=>fn())`);
  await until(`!document.querySelector('[data-quick-assess]').disabled`);
  assert.equal(await evaluate(`${input('quick-description')}.value`), 'Keep my chair description');
  assert.equal(await evaluate(`${input('quick-asking')}.value`), '22');
  assert.equal(await evaluate(`${input('quick-resale_low')}.value`), '95');
  assert.equal(await evaluate(`${input('quick-repairs')}.value`), '12');
  assert.equal(await evaluate(`document.querySelectorAll('.quick-photo').length`), 1);
  checks.push('Failed readiness blocks POST; repeated retry clicks send one free GET and restore availability without resetting photos or numbers');

  // Account remounts trigger a fresh check. Force unavailability for that check,
  // then exercise retries from each reason, including allowlist denial.
  for(const reason of ['assessment_busy','budget_paused','not_configured','denied','failed']) {
    await evaluate(`window.budgetTest.mode=${JSON.stringify(reason)};window.switchFixtureUser('other-user')`);
    await until(`Boolean(${budgetRetry}) && !${budgetRetry}.disabled`);
    assert.ok(await evaluate(paidDisabled));
    const beforeGets = await evaluate('window.budgetTest.gets');
    await evaluate(`window.budgetTest.mode='hold';${budgetRetry}.click();${budgetRetry}.click()`);
    await until(`window.budgetTest.releases.length===1`);
    assert.equal(await evaluate('window.budgetTest.gets'), beforeGets+1);
    assert.ok(await evaluate(paidDisabled));
    await evaluate(`window.budgetTest.releases.splice(0).forEach(fn=>fn())`);
    await until(`!document.querySelector('[data-quick-assess]').disabled`);
    await evaluate(`window.switchFixtureUser('browser-fixture')`);
    await until(`window.budgetTest.releases.length===1`);
    await evaluate(`window.budgetTest.mode='normal';window.budgetTest.releases.splice(0).forEach(fn=>fn())`);
    await until(`!document.querySelector('[data-quick-assess]').disabled`);
  }
  assert.equal((await requests()).posts, beforeReadiness.posts);
  assert.equal(await calls(), beforeReadiness.calls);
  checks.push('Busy, paused, unconfigured, not-allowlisted and failed checks each expose a free single-GET retry; availability returns with zero assessment POSTs');

  await evaluate(`window.budgetTest.mode='hold';window.switchFixtureUser('other-user')`);
  await until(`window.budgetTest.releases.length===1`);
  await evaluate(`window.budgetTest.mode='denied';window.switchFixtureUser('browser-fixture')`);
  await until(`Boolean(${budgetRetry}) && !${budgetRetry}.disabled`);
  await evaluate(`window.budgetTest.releases.splice(0).forEach(fn=>fn())`); await pause(100);
  assert.ok(await evaluate(paidDisabled), 'Old account availability must not override the new account denial');
  await evaluate(`window.budgetTest.mode='hold';${budgetRetry}.click()`);
  await until(`window.budgetTest.releases.length===1`);
  const beforeSignoutGets = await evaluate('window.budgetTest.gets');
  await evaluate(`window.switchFixtureUser(null);window.budgetTest.releases.splice(0).forEach(fn=>fn())`);
  await until(`document.body.textContent.includes('Sign in for a photo estimate')`);
  assert.equal(await evaluate('window.budgetTest.gets'), beforeSignoutGets);
  assert.equal(await evaluate(`Boolean(${budgetRetry})`), false);
  assert.equal((await requests()).posts, beforeReadiness.posts);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: failedScript.identifier });
  checks.push('Late readiness responses cannot enable AI for another account or after sign-out; signed-out users get the sign-in prompt without a budget request');

  await mode('normal'); await open(); await upload(); await fill(input('quick-asking'), '20');
  // Inspect storage at the actual fetch boundary, then hold the response while
  // navigating away. The provider and database are still the real fixture path.
  await evaluate(`(()=>{const original=window.fetch;window.fetch=async(input,init)=>{
    if(new URL(typeof input==='string'?input:input.url).pathname==='/api/items/assess'){
      window.idBeforePost=sessionStorage.getItem(${JSON.stringify(recoveryKey)});
      window.sentId=JSON.parse(init.body).request_id;
      const response=await original(input,init);await new Promise(resolve=>setTimeout(resolve,3000));return response;
    }return original(input,init);
  };})()`);
  const beforeRecovery = await requests();
  await evaluate(`document.querySelector('[data-quick-assess]').click()`);
  await until(`Boolean(window.sentId)`);
  const recoveryId = await storedId();
  assert.equal(await evaluate('window.idBeforePost'), recoveryId);
  assert.equal(await evaluate('window.sentId'), recoveryId, 'UUID must be stored before the POST');
  for(let i=0;i<80 && await calls()===beforeRecovery.calls;i++) await pause(25);
  await open('', true);
  await until(`document.body.textContent.includes('Recovered your photo estimate.')`);
  await until(`!document.querySelector('[data-quick-calculate]').disabled`);
  let afterRecovery = await requests();
  assert.equal(afterRecovery.posts, beforeRecovery.posts + 1);
  assert.equal(afterRecovery.calls, beforeRecovery.calls + 1);
  assert.equal(afterRecovery.reads, beforeRecovery.reads + 1, 'Exactly one automatic recovery GET');
  assert.equal(await storedId(), recoveryId, 'Completion must retain the ID until save/dismiss/new find');
  assert.ok(await evaluate(`Boolean(document.querySelector('.quick-sources'))`));
  assert.equal(await evaluate(`document.querySelectorAll('.quick-photo').length`), 0, 'Photos are not stored');
  checks.push('ID is stored before POST; refresh while awaiting the response restores the same result through exactly one GET and no extra paid request');

  await fill(input('item-notes'), 'Unsaved note should not survive refresh');
  await calculate('within_budget');
  await open('', true);
  await until(`document.body.textContent.includes('Recovered your photo estimate.')`);
  await until(`!document.querySelector('[data-quick-calculate]').disabled`);
  assert.equal(await storedId(), recoveryId);
  assert.equal(await evaluate(`${input('item-notes')}.value`), '');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-quick-status]'))`), false, 'Repairs require fresh confirmation');
  afterRecovery = await requests();
  assert.equal(afterRecovery.posts, beforeRecovery.posts + 1);
  assert.equal(afterRecovery.reads, beforeRecovery.reads + 2);
  await calculate('within_budget'); await click('button', 'Save item'); await savedConfirmation();
  assert.equal(await storedId(), null, 'Confirmed save clears recovery');
  const recoveredSave = (await api('/api/items')).items[0];
  assert.equal(recoveredSave.assessment.assessment_id, recoveryId);
  checks.push('Completed unsaved estimates survive refresh without a POST; edits are not restored and a confirmed find save clears recovery');

  const recoveryBudgetScript = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.recoveryBudgetBlocked=true;const original=window.fetch;
    window.fetch=async(input,init)=>{const response=await original(input,init);
      if(window.recoveryBudgetBlocked&&new URL(typeof input==='string'?input:input.url).pathname==='/api/items/ai-budget'){
        const body=await response.json();return new Response(JSON.stringify({...body,available:false,reason:'assessment_busy',message:null}));
      }return response;};` });
  await restoreMarker(recoveryId); await open('', true);
  await until(`document.body.textContent.includes('Recovered your photo estimate.') && Boolean(${budgetRetry}) && !${budgetRetry}.disabled`);
  await fill(input('item-notes'), 'Keep recovered note');
  await calculate('within_budget');
  const beforeRecoveredRetry = await requests();
  await evaluate(`window.recoveryBudgetBlocked=false;${budgetRetry}.click()`);
  await until(`!${budgetRetry}`);
  assert.equal(await evaluate(`${input('item-notes')}.value`), 'Keep recovered note');
  assert.ok(await evaluate(`Boolean(document.querySelector('.quick-sources')) && Boolean(document.querySelector('[data-quick-status]'))`));
  assert.equal(await storedId(), recoveryId);
  assert.equal((await requests()).posts, beforeRecoveredRetry.posts);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: recoveryBudgetScript.identifier });
  checks.push('A free availability retry preserves recovered evidence, confirmed calculation, unsaved notes and the recovery ID');

  await restoreMarker(recoveryId);
  const beforeSavedReopen = await requests();
  await open(`?find=${savedFind.id}`, true);
  await until(`Boolean(document.querySelector('[data-quick-status]'))`);
  assert.equal((await requests()).reads, beforeSavedReopen.reads, 'Saved find does not GET recovery');
  assert.equal(await storedId(), recoveryId);
  assert.equal(await evaluate(`${input('item-notes')}.value`), savedFind.notes);
  await fill(input('item-notes'), 'An unrelated saved find revision');
  await click('button', 'Save new version'); await savedConfirmation();
  assert.equal(await storedId(), recoveryId, 'Saving a different snapshot cannot discard recovery');
  await click('a', 'Start another find');
  await until(`Boolean(document.querySelector('[data-quick-assess]')) && !document.querySelector('.quick-sources')`);
  assert.equal(await storedId(), null, 'Explicit fresh start from a saved snapshot also dismisses old recovery');
  await restoreMarker(recoveryId);
  checks.push('Saved-find reopen wins over recovery, and saving an unrelated revision leaves the recoverable estimate intact');

  await open('', true); await until(`document.body.textContent.includes('Recovered your photo estimate.')`);
  await until(`!document.querySelector('[data-quick-calculate]').disabled`);
  await click('button', 'Dismiss estimate recovery');
  assert.equal(await storedId(), null);
  await restoreMarker(recoveryId); await open('', true);
  await until(`document.body.textContent.includes('Recovered your photo estimate.')`);
  await until(`!document.querySelector('[data-quick-calculate]').disabled`);
  await click('a', 'Start another find');
  await until(`Boolean(document.querySelector('[data-quick-assess]')) && !document.querySelector('.quick-sources')`);
  assert.equal(await storedId(), null);
  checks.push('Explicit dismissal and Start another find clear the retained ID without another provider request');

  await restoreMarker('not-a-uuid');
  const beforeGarbage = await requests(); await open('', true);
  await until(`sessionStorage.getItem(${JSON.stringify(recoveryKey)}) === null`);
  assert.equal((await requests()).reads, beforeGarbage.reads);
  assert.equal((await requests()).posts, beforeGarbage.posts);
  await restoreMarker('12345678-1234-4234-8234-123456789abc');
  const beforeMissing = await requests(); await open('', true);
  await until(`document.body.textContent.includes("Estimate not found. It wasn't submitted again.")`);
  assert.equal(await storedId(), null);
  assert.equal((await requests()).reads, beforeMissing.reads + 1);
  assert.equal((await requests()).posts, beforeMissing.posts);
  checks.push('Garbage IDs are discarded without GET/POST; a missing assessment clears recovery after one 404 GET and is never resubmitted');

  await restoreMarker(recoveryId); await open('', true);
  await until(`document.body.textContent.includes('Recovered your photo estimate.')`);
  await evaluate(`window.switchFixtureUser('other-user')`);
  await until(`sessionStorage.getItem(${JSON.stringify(recoveryKey)}) === null && !document.querySelector('.quick-sources')`);
  await evaluate(`window.switchFixtureUser('browser-fixture')`);
  await until(`Boolean(document.querySelector('[data-quick-assess]'))`);
  await restoreMarker(recoveryId); await open('', true);
  await until(`document.body.textContent.includes('Recovered your photo estimate.')`);
  await evaluate(`window.switchFixtureUser(null)`);
  await until(`sessionStorage.getItem(${JSON.stringify(recoveryKey)}) === null && !document.querySelector('.quick-sources')`);
  checks.push('Account switching and sign-out clear the previous account marker and recovered evidence');

  await open(); await restoreMarker(recoveryId);
  const delayedRecovery = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `const original=window.fetch;window.fetch=async(input,init)=>{const response=await original(input,init);if(new URL(typeof input==='string'?input:input.url).pathname.startsWith('/api/items/assessments/')){window.recoveryReceived=true;await new Promise(resolve=>setTimeout(resolve,700));}return response;};` });
  await open('', true); await until(`window.recoveryReceived === true`);
  await evaluate(`window.switchFixtureUser('other-user')`); await pause(850);
  assert.equal(await storedId(), null);
  assert.equal(await evaluate(`Boolean(document.querySelector('.quick-sources'))`), false);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: delayedRecovery.identifier });
  checks.push('A recovery GET completing after an account switch cannot restore the previous account evidence');

  const blockedStorage = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'sessionStorage',{get(){throw new Error('Storage denied')}});` });
  await open('', true); await upload(); await fill(input('quick-asking'), '20');
  await runAI(); await calculate('within_budget');
  assert.ok(await evaluate(`Boolean(document.querySelector('.quick-sources'))`));
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockedStorage.identifier });
  await open('', true);
  await until(`Boolean(document.querySelector('[data-quick-assess]'))`);
  assert.equal(await storedId(), null);
  checks.push('Unavailable sessionStorage preserves the existing in-memory photo assessment and calculation flow');

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

  // Save retries use the real isolated database. Only response delivery is lost;
  // the photo provider remains simulated and is never called by saving/retrying.
  const saveFixture = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    const original=window.fetch.bind(window);window.photoSaveMode='pass';window.photoSaveRequests=[];
    window.fetch=async(input,init={})=>{
      if(new URL(typeof input==='string'?input:input.url,location.href).pathname!=='/api/items/save')return original(input,init);
      window.photoSaveRequests.push({body:JSON.parse(init.body),auth:new Headers(init.headers).get('Authorization')});
      const mode=window.photoSaveMode;
      if(['401','403','404','409','422','429','500','503'].includes(mode))return Response.json({detail:'Rejected fixture'},{status:Number(mode)});
      const response=await original(input,init);
      if(mode==='lost'){window.committedPhotoSave=await response.json();throw new TypeError('Confirmation lost');}
      if(mode==='held'){const saved=await response.json();await new Promise(resolve=>window.releasePhotoSave=resolve);return Response.json(saved,{status:201});}
      return response;
    };` });
  const retryButton = `Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Retry this save')`;
  const saveUncertain = `Boolean(${retryButton}) && !${retryButton}.disabled`;
  for(const width of [390,1440]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390});
    await open(`?find=${savedFind.id}`); await until(`Boolean(document.querySelector('[data-quick-status]'))`);
    await fill(input('item-notes'),'Captured photo note'); await fill(input('item-listing-url'),'https://example.com/photo-save');
    const beforeCalls=await calls();
    await evaluate(`window.photoSaveMode='lost'`); await click('button','Save new version'); await until(saveUncertain);
    const committed=await evaluate('window.committedPhotoSave'), captured=await evaluate('window.photoSaveRequests[0].body');
    assert.equal(captured.assessment_id,savedFind.assessment.assessment_id);
    for(const selector of ['#quick-resale_low','#item-notes','#item-listing-url']) {
      // Assessed resale can be presented as text; every present editor is locked.
      assert.ok(await evaluate(`!document.querySelector(${JSON.stringify(selector)}) || document.querySelector(${JSON.stringify(selector)}).matches(':disabled')`));
    }
    assert.ok(await evaluate(`document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled`));
    await geometry(); await screenshot(`photo-save-retry-${width}.png`);
    await click('button','Retry this save'); await until(saveUncertain);
    assert.deepEqual(await evaluate('window.committedPhotoSave'),committed);
    await evaluate(`window.photoSaveMode='pass';window.authFixture={calls:0,delayMs:70}`);
    await evaluate(`(()=>{const b=${retryButton};b.click();b.click()})()`); await savedConfirmation();
    assert.equal(await evaluate('window.authFixture.calls'),1);
    const sent=await evaluate('window.photoSaveRequests');
    assert.equal(sent.length,3); assert.ok(sent.every(r=>JSON.stringify(r.body)===JSON.stringify(captured)));
    assert.deepEqual((await api('/api/items')).items[0],committed);
    assert.equal(committed.parent_item_id,savedFind.id); assert.equal(committed.root_item_id,savedFind.root_item_id);
    assert.deepEqual(committed.assessment,savedFind.assessment);
    assert.deepEqual(await api(`/api/items/${savedFind.id}`),savedFind);
    assert.ok(await evaluate(`!${input('item-notes')}.matches(':disabled')`));
    await fill(input('item-notes'),'New photo version'); await click('button','Save new version'); await savedConfirmation();
    const child=(await api('/api/items')).items[0];
    assert.equal(child.parent_item_id,committed.id);
    assert.notEqual(await evaluate('window.photoSaveRequests.at(-1).body.request_id'),captured.request_id);
    assert.equal(await calls(),beforeCalls);

    await open(`?find=${savedFind.id}`); await until(`Boolean(document.querySelector('[data-quick-status]'))`);
    await fill(input('item-notes'),'Photo discard draft');
    await evaluate(`window.photoSaveMode='lost'`); await click('button','Save new version'); await until(saveUncertain);
    const discarded=await evaluate('window.committedPhotoSave'), discardedId=await evaluate('window.photoSaveRequests[0].body.request_id');
    await click('button','Discard and edit');
    assert.ok(await evaluate(`!document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled && !${input('item-notes')}.matches(':disabled')`));
    assert.equal(await evaluate(`${input('item-notes')}.value`),'Photo discard draft');
    await fill(input('item-notes'),'Edited photo discard');
    assert.ok(await evaluate(`document.body.textContent.includes('discarded attempt may already be saved')`));
    await evaluate(`window.photoSaveMode='pass'`); await click('button','Save new version'); await savedConfirmation();
    assert.notEqual(await evaluate('window.photoSaveRequests[1].body.request_id'),discardedId);
    assert.deepEqual(await api(`/api/items/${discarded.id}`),discarded);
    assert.equal(await calls(),beforeCalls); await geometry();
  }
  checks.push('390/1440 photo saves retry the identical payload and evidence after repeated lost commits, preserve version links, and discard safely without provider calls');

  async function enterQuickManual() {
    await until(`!document.body.textContent.includes('Checking AI availability…')`);
    if(!await evaluate(`Boolean(${input('quick-item-name')})`)) await click('button',"I'll enter my own estimate");
  }
  async function quickSaveDraft() {
    await open(); await enterQuickManual();
    await fill(input('quick-item-name'),'Private pending chair');
    await fill(input('quick-resale_low'),'80'); await fill(input('quick-repairs'),'10'); await calculate('offer_only');
    await fill(input('item-notes'),'Private pending photo-page note');
  }
  for(const nextUser of [null,'save-retry-user']) {
    await quickSaveDraft(); await evaluate(`window.photoSaveMode='500'`);
    await click('button','Save item'); await until(saveUncertain);
    const oldId=await evaluate('window.photoSaveRequests[0].body.request_id');
    await evaluate(`window.switchFixtureUser(${JSON.stringify(nextUser)})`);
    await until(`!document.querySelector('[data-quick-status]') && !(${input('item-notes')}?.value)`);
    assert.ok(await evaluate(`!document.body.textContent.includes('Retry this save')`));
    if(nextUser===null)await evaluate(`window.switchFixtureUser('browser-fixture')`);
    await enterQuickManual();
    await fill(input('quick-resale_low'),'80'); await fill(input('quick-repairs'),'10'); await calculate('offer_only');
    await evaluate(`window.photoSaveMode='pass'`); await click('button','Save item'); await savedConfirmation();
    const sent=await evaluate('window.photoSaveRequests');
    assert.equal(sent.length,2); assert.notEqual(sent[1].body.request_id,oldId);
    assert.equal(sent[1].auth,`Bearer ${nextUser??'browser-fixture'}`);
    assert.ok(!JSON.stringify(sent[1].body).includes('Private pending'));
  }
  await quickSaveDraft(); await evaluate(`window.photoSaveMode='500'`);
  await click('button','Save item'); await until(saveUncertain);
  const uncertainPayload=await evaluate('window.photoSaveRequests[0].body');
  for(const status of ['503','401','403','429']) {
    await evaluate(`window.photoSaveMode=${JSON.stringify(status)}`); await click('button','Retry this save'); await until(saveUncertain);
    assert.ok(await evaluate(`document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled && ${input('item-notes')}.matches(':disabled') && ${input('item-listing-url')}.matches(':disabled')`));
    assert.ok(await evaluate(`document.body.textContent.includes('may already be saved') && Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Discard and edit' && !e.disabled)`));
    assert.deepEqual(await evaluate('window.photoSaveRequests.at(-1).body'),uncertainPayload);
  }
  for(const status of ['422','404','409']) {
    const rejectedId=await evaluate('window.photoSaveRequests.at(-1).body.request_id');
    await evaluate(`window.photoSaveMode=${JSON.stringify(status)}`); await click('button','Retry this save');
    await until(`!${retryButton} && !${input('item-notes')}.matches(':disabled')`);
    assert.ok(await evaluate(`!document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled && !${input('item-listing-url')}.matches(':disabled')`));
    await evaluate(`window.photoSaveMode='500'`); await click('button','Save item'); await until(saveUncertain);
    assert.notEqual(await evaluate('window.photoSaveRequests.at(-1).body.request_id'),rejectedId);
  }
  const beforeTokenSwitch=await evaluate('window.photoSaveRequests.length');
  await evaluate(`window.photoSaveMode='pass';window.authFixture={calls:0,delayMs:350}`);
  await click('button','Retry this save'); await evaluate(`window.switchFixtureUser('save-retry-user')`); await pause(450);
  assert.equal(await evaluate('window.photoSaveRequests.length'),beforeTokenSwitch);
  await quickSaveDraft(); await evaluate(`window.photoSaveMode='held'`); await click('button','Save item');
  await until(`typeof window.releasePhotoSave==='function'`);
  await evaluate(`window.switchFixtureUser('save-retry-user');window.releasePhotoSave()`); await pause(200);
  // A non-allowlisted account can receive the empty manual fallback editor.
  // Neither the old account's draft nor its late save may populate that editor.
  assert.ok(await evaluate(`!document.querySelector('[data-quick-status]') && !(${input('item-notes')}?.value) && !(${input('quick-item-name')}?.value)`));
  assert.ok(await evaluate(`!document.body.textContent.includes('Saved version #') && !document.body.textContent.includes('Retry this save')`));
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:saveFixture.identifier});
  checks.push('/items retry 503/401/403/429 preserves the pending payload, locks and warning; retry 422/404/409 releases it; account changes cancel pre-token retries and suppress old-account responses');

  await runOutcomeChecks({ cdp, evaluate, until, fill, click, measure, screenshot, pause, checks, api });

  // Last because the real timeout intentionally holds the shared budget gate.
  await mode('timeout'); await open(); await upload(); const beforeTimeout = await calls(); await runAI();
  await until(`document.body.textContent.includes("Your photo estimate hasn't finished")`);
  assert.ok(await evaluate(`Boolean((${speedRows})['Estimate request'])`));
  const uncertainId = await storedId();
  const beforePendingRefresh = await requests();
  await open('', true);
  await until(`document.body.textContent.includes("Your photo estimate hasn't finished") && Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Check estimate status' && !e.disabled)`);
  assert.ok(await evaluate(`Boolean((${speedRows})['Status check'])`));
  assert.equal(await evaluate(`Boolean((${speedRows})['Estimate request'])`), false);
  assert.equal(await storedId(), uncertainId);
  assert.equal((await requests()).reads, beforePendingRefresh.reads + 1);
  assert.equal((await requests()).posts, beforePendingRefresh.posts);
  await click('button', 'Check estimate status');
  await until(`!document.querySelector('[aria-label="Confirm estimate"] fieldset').disabled`);
  assert.equal(await calls(), beforeTimeout + 1);
  await fill(input('quick-resale_low'), '80'); await fill(input('quick-repairs'), '10'); await calculate('offer_only');
  assert.equal(await calls(), beforeTimeout + 1);
  checks.push('Uncertain assessments are never retried; status checks use GET and the manual calculator remains usable while the hold is active');
}

// Outcomes use real local routes and persistence. Only transport failures and
// sign-in are simulated. No real provider calls or production saves.
async function runOutcomeChecks({ cdp, evaluate, until, fill, click, measure, screenshot, pause, checks, api }) {
  const post = async (path, body, expected = 201) => {
    const response = await fetch(`http://127.0.0.1:8000${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture' }, body: JSON.stringify(body) });
    assert.equal(response.status, expected); return response.json();
  };
  await evaluate(`sessionStorage.setItem('outcome-test-writes','[]')`);
  const fixture = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    const original=window.fetch.bind(window), timer=window.setTimeout;
    window.setTimeout=(callback,ms,...args)=>timer(callback,ms===120000&&window.outcomeReadMode==='timeout'?80:ms,...args);
    window.outcomePosts=[];window.outcomeReads=[];window.outcomeWrites=[];window.outcomeMode='pass';window.outcomeReadMode='pass';
    window.fetch=async(input,init={})=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      const method=init.method||'GET';
      if(path.startsWith('/api/')&&method!=='GET'){window.outcomeWrites.push(path);const audit=JSON.parse(sessionStorage.getItem('outcome-test-writes')||'[]');audit.push(path);sessionStorage.setItem('outcome-test-writes',JSON.stringify(audit));}
      if(!(path.startsWith('/api/items/')&&path.endsWith('/outcomes')))return original(input,init);
      if(method==='GET'){
        window.outcomeReads.push(path);const mode=window.outcomeReadMode;
        if(mode==='503')return Response.json({detail:'Fixture outage'},{status:503});
        if(mode==='timeout')return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
        const response=await original(input,init);
        if(mode==='held'){const data=await response.json();await new Promise(resolve=>window.releaseOutcomeRead=resolve);return Response.json(data);}
        return response;
      }
      window.outcomePosts.push({path,body:JSON.parse(init.body),auth:new Headers(init.headers).get('Authorization')});
      const mode=window.outcomeMode;
      if(['401','403','404','409','422','429','500','503'].includes(mode))return Response.json({detail:'Fixture rejection'},{status:Number(mode)});
      if(mode==='malformed')return Response.json({});
      const response=await original(input,init);
      if(mode==='lost'){window.committedOutcome=await response.json();throw new TypeError('Lost after commit');}
      if(mode==='held'){const data=await response.json();await new Promise(resolve=>window.releaseOutcomePost=resolve);return Response.json(data,{status:response.status});}
      return response;
    };` });
  const field = key => `document.getElementById('outcome-${key}')`;
  const button = label => `Array.from(document.querySelectorAll('.item-outcome button')).find(e=>e.textContent===${JSON.stringify(label)})`;
  const ready = `${button('Save tracking')} && !document.querySelector('.item-outcome fieldset').disabled`;
  const uncertain = `${button('Retry this save')} && !document.querySelector('.item-outcome').getAttribute('aria-busy').includes('true')`;
  const conflict = `Boolean(${button('Save my version')})`;
  const saved = `document.querySelector('.item-outcome [role=status]')?.textContent.includes('Tracking saved.') && ${ready}`;
  const revision = `document.querySelector('[data-outcome-revision]')?.dataset.outcomeRevision`;
  const figure = key => `document.querySelector('[data-outcome-figure="${key}"]').textContent`;
  async function open(item) {
    await evaluate('window.beforeOutcomeNavigation=true');
    await cdp('Page.navigate', { url: 'http://127.0.0.1:5173/my-flips' });
    await until(`!window.beforeOutcomeNavigation && Boolean(document.querySelector('[data-saved-item="${item.id}"]'))`);
    assert.equal(await evaluate('window.outcomeReads.length'), 0, 'No outcomes loaded per card');
    await evaluate(`document.querySelector('[aria-controls="tracking-${item.id}"]').click()`);
    await until(ready);
    assert.equal(await evaluate('window.outcomeReads.length'), 1, 'One GET when opened');
  }
  async function save() { await click('button', 'Save tracking'); await until(saved); }
  async function geometry() {
    assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'));
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.item-outcome input,.item-outcome select')).every(e=>e.labels?.length)`));
  }
  const housesBefore = await api('/api/deals');
  const aiBefore = await api('/browser-fixture/ai');
  let item;
  for (const width of [390, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    const root = await post('/api/items/save', { inputs: { item_name: `Outcome chair ${width}`, purchase_price: 999, repairs: 333, personal_defaults: { hourly_value: 100 } } });
    item = await post('/api/items/save', { inputs: { ...root.inputs, purchase_price: 888 }, parent_item_id: root.id });
    await open(item);
    assert.ok(await evaluate(`${button('Bought')}.getAttribute('aria-pressed')==='true'`));
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.item-outcome input')).every(e=>e.value==='')`));
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.item-outcome details')).every(e=>!e.open)`));
    assert.equal(await evaluate('window.outcomeWrites.length'), 0);
    await fill(field('purchase_price'), '25'); await geometry(); await screenshot(`photo-outcome-entry-${width}.png`);
    await save();
    let outcome = await api(`/api/items/${root.id}/outcomes`);
    assert.equal(outcome.inputs.purchase_price, 25); assert.equal(outcome.inputs.materials, null);
    assert.equal(outcome.based_on_item_id, item.id); assert.equal(outcome.calculated.cash_profit, null);
    assert.equal(await evaluate(figure('cash_profit')), 'Not calculated');
    assert.equal(await evaluate('window.outcomePosts[0].path'), `/api/items/${root.id}/outcomes`);
    assert.equal(await evaluate('window.outcomePosts[0].body.expected_previous_id'), null);
    assert.equal(await evaluate('window.outcomeReads.length'), 2);
    await click('button', 'Listed');
    await evaluate(`Array.from(document.querySelectorAll('.item-outcome details')).find(e=>e.querySelector('summary').textContent==='Dates').open=true`);
    await fill(field('purchased_on'), '2026-10-01'); await fill(field('listed_on'), '2026-10-02'); await save();
    outcome = await api(`/api/items/${root.id}/outcomes`);
    assert.equal(outcome.inputs.status, 'listed'); assert.equal(outcome.calculated.cash_profit, null);
    await click('button', 'Sold');
    await fill(field('sale_price'), '20'); await fill(field('sale_channel'), 'facebook_marketplace'); await fill(field('sold_on'), '2026-10-04');
    await evaluate(`document.querySelectorAll('.item-outcome details').forEach(e=>e.open=true)`);
    for (const key of ['materials', 'hired_labor', 'pickup', 'delivery', 'storage', 'selling_fees', 'other_expenses']) await fill(field(key), key === 'materials' ? '10' : '0');
    await fill(field('hours'), '2'); await fill(field('hourly_value'), '10'); await save();
    outcome = await api(`/api/items/${root.id}/outcomes`);
    assert.equal(outcome.calculated.cash_profit, -15); assert.equal(outcome.calculated.profit_after_time, -35);
    assert.equal(outcome.calculated.days_held, 3); assert.equal(outcome.calculated.days_to_sell, 2);
    assert.equal(await evaluate(figure('cash_profit')), '-$15.00');
    await evaluate(`document.querySelectorAll('.item-outcome details').forEach(e=>e.open=false)`);
    await fill(field('purchase_price'), '30');
    assert.equal(await evaluate(figure('cash_profit')), '-$15.00');
    assert.ok(await evaluate(`document.querySelector('.outcome-saved').textContent.includes('not your unsaved entries')`));
    await save(); outcome = await api(`/api/items/${root.id}/outcomes`);
    assert.equal(outcome.inputs.materials, 10); assert.equal(outcome.inputs.hours, 2); assert.equal(outcome.inputs.listed_on, '2026-10-02');
    assert.equal(outcome.calculated.cash_profit, -20);
    await geometry(); await screenshot(`photo-outcome-sold-${width}.png`);
    await evaluate(`document.querySelector('[aria-controls="tracking-${root.id}"]').click()`);
    await until(ready);
    assert.equal(await evaluate('document.querySelectorAll(".item-outcome").length'), 1);
    assert.equal(await evaluate(revision), outcome.id);
    assert.ok(await evaluate(`document.querySelector('.outcome-shared').textContent==='Tracking applies to all versions of this find · based on estimate #${item.id}'`));
    assert.equal(await evaluate(field('purchase_price') + '.value'), '30');
    await fill(field('purchase_price'), '0'); await save(); outcome = await api(`/api/items/${root.id}/outcomes`);
    assert.equal(outcome.based_on_item_id, root.id); assert.equal(outcome.inputs.purchase_price, 0);
    await evaluate(`document.querySelector('[aria-controls="tracking-${item.id}"]').click()`); await until(ready);
    assert.equal(await evaluate(revision), outcome.id); assert.equal(await evaluate(field('purchase_price') + '.value'), '0');
    assert.ok(await evaluate(`document.querySelector('.outcome-shared').textContent.includes('based on estimate #${root.id}')`));
    await evaluate(`window.confirm=()=>false`); await click('button', 'Bought');
    assert.equal(await evaluate(field('sale_price') + '.value'), '20');
    await evaluate(`window.confirm=()=>true`); await click('button', 'Listed');
    assert.equal(await evaluate(`Boolean(${field('sale_price')})`), false);
    assert.equal(await evaluate(field('listed_on') + '.value'), '2026-10-02');
    await click('button', 'Bought'); await save(); outcome = await api(`/api/items/${root.id}/outcomes`);
    for (const key of ['listed_on', 'sold_on', 'sale_price', 'sale_channel']) assert.equal(outcome.inputs[key], null);
    assert.equal(outcome.inputs.materials, 10); assert.equal(outcome.inputs.purchased_on, '2026-10-01');
    assert.deepEqual(await api(`/api/items/${root.id}`), root); assert.deepEqual(await api(`/api/items/${item.id}`), item);
    assert.ok(await evaluate(`window.outcomeWrites.every(path=>path==='/api/items/${root.id}/outcomes')`));
  }
  checks.push('Outcome entry at 390/1440 loads only on open, logs Bought plus price with all extras collapsed, and never imports estimate defaults');
  checks.push('Bought/Listed/Sold saves preserve hidden actuals, server losses/unknowns/zeroes and calendar days; unsaved editing leaves Last saved figures unchanged');
  checks.push('Two versions share the exact outcome, use root paths and explicit viewed-estimate basis, show the shared label and never modify saved estimates');
  checks.push('Backward status changes ask before clearing only incompatible sale/listing fields; cancelling keeps the entire draft');

  await open(item); await fill(field('purchase_price'), '41');
  await evaluate(`window.outcomeMode='lost'`); await click('button', 'Save tracking'); await until(uncertain);
  const committed = await api(`/api/items/${item.root_item_id}/outcomes`), captured = await evaluate('window.outcomePosts[0].body');
  for (const status of ['503', '401', '403', '429']) {
    await evaluate(`window.outcomeMode=${JSON.stringify(status)}`); await click('button', 'Retry this save'); await until(uncertain);
    assert.ok(await evaluate(`document.querySelector('.item-outcome fieldset').disabled`));
    assert.ok(await evaluate(`document.querySelector('.item-outcome').textContent.includes('may already be saved')`));
    assert.deepEqual(await evaluate('window.outcomePosts.at(-1).body'), captured);
  }
  await evaluate(`window.outcomeMode='pass'`); await click('button', 'Retry this save'); await until(saved);
  assert.equal(await evaluate(revision), committed.id);
  assert.ok(await evaluate('window.outcomePosts.every(r=>JSON.stringify(r.body)===JSON.stringify(window.outcomePosts[0].body))'));
  checks.push('Lost outcome confirmations retry the identical UUID/payload; 503/401/403/429 retain the lock, warning and discard escape');

  // Replay returns the original even when another session has since saved.
  await fill(field('purchase_price'), '42'); await evaluate(`window.outcomeMode='lost'`); await click('button', 'Save tracking'); await until(uncertain);
  const original = await api(`/api/items/${item.root_item_id}/outcomes`);
  const newer = await post(`/api/items/${item.root_item_id}/outcomes`, { ...original.inputs, purchase_price: 99, based_on_item_id: item.id,
    request_id: crypto.randomUUID(), expected_previous_id: original.id });
  await evaluate(`window.outcomeMode='pass'`); await click('button', 'Retry this save'); await until(saved);
  assert.equal(await evaluate(revision), newer.id); assert.equal(await evaluate(field('purchase_price') + '.value'), '99');
  checks.push('Successful replay refreshes latest before editing, so an old replay cannot hide a newer outcome');

  for (const action of ['Use latest', 'Save my version']) {
    await open(item); await fill(field('purchase_price'), '51');
    const latest = await api(`/api/items/${item.root_item_id}/outcomes`);
    const other = await post(`/api/items/${item.root_item_id}/outcomes`, { ...latest.inputs, purchase_price: 77,
      request_id: crypto.randomUUID(), expected_previous_id: latest.id, based_on_item_id: item.id });
    if (action === 'Save my version') await evaluate(`window.outcomeReadMode='503'`);
    await click('button', 'Save tracking');
    if (action === 'Save my version') {
      await until(`Boolean(${button('Reload tracking')})`);
      assert.equal(await evaluate(field('purchase_price') + '.value'), '51');
      assert.equal(await evaluate('window.outcomePosts.length'), 1);
      await evaluate(`window.outcomeReadMode='pass'`); await click('button', 'Reload tracking');
    }
    await until(conflict);
    assert.equal(await evaluate(field('purchase_price') + '.value'), '51');
    assert.equal(await evaluate(revision), other.id);
    assert.ok(await evaluate(`document.querySelector('.item-outcome').textContent.includes('This find was updated since you started editing. Your unsaved changes are kept.')`));
    assert.equal(await evaluate('window.outcomePosts.length'), 1, 'Reload never automatically saves');
    await geometry(); await screenshot(`photo-outcome-conflict-${action.replaceAll(' ', '-')}.png`);
    await click('button', action); await until(action === 'Use latest' ? ready : saved);
    assert.equal(await evaluate(field('purchase_price') + '.value'), action === 'Use latest' ? '77' : '51');
    const sent = await evaluate('window.outcomePosts');
    assert.equal(sent.length, action === 'Use latest' ? 1 : 2);
    if (sent.length === 2) { assert.notEqual(sent[1].body.request_id, sent[0].body.request_id); assert.equal(sent[1].body.expected_previous_id, other.id); }
  }
  checks.push('Real stale-write 409 reloads latest while keeping the draft; Use latest discards it, Save my version explicitly submits a new UUID, and failed reload retries GET only');

  await open(item); await fill(field('purchase_price'), '61');
  await evaluate(`window.outcomeMode='lost'`); await click('button', 'Save tracking'); await until(uncertain);
  const discardedId = await evaluate('window.outcomePosts[0].body.request_id');
  await evaluate(`window.outcomeReadMode='503'`); await click('button', 'Discard and edit');
  await until(`Boolean(${button('Reload tracking')})`);
  assert.equal(await evaluate(field('purchase_price') + '.value'), '61');
  assert.equal(await evaluate('window.outcomePosts.length'), 1);
  await evaluate(`window.outcomeReadMode='pass';window.outcomeMode='pass'`); await click('button', 'Reload tracking'); await until(conflict);
  await click('button', 'Use latest'); await until(ready);
  assert.ok(await evaluate(`document.querySelector('.item-outcome').textContent.includes('discarded attempt may already be saved')`));
  await fill(field('purchase_price'), '62'); await save();
  assert.notEqual(await evaluate('window.outcomePosts.at(-1).body.request_id'), discardedId);
  checks.push('Discarding an uncertain outcome retains its warning and entries, requires a reload before editing and uses a new UUID only on a later explicit save');

  await open(item); await fill(field('purchase_price'), '63'); await evaluate(`window.outcomeReadMode='503'`); await click('button', 'Save tracking');
  await until(`Boolean(${button('Reload tracking')})`);
  assert.ok(await evaluate(`document.querySelector('.item-outcome').textContent.includes('Your save was confirmed.')`));
  assert.equal(await evaluate(`Boolean(${button('Retry this save')})`), false);
  await evaluate(`window.outcomeReadMode='pass'`); await click('button', 'Reload tracking'); await until(saved);
  assert.equal(await evaluate('window.outcomePosts.length'), 1);
  checks.push('A confirmed POST followed by a failed refresh offers GET reload, never another POST');

  for (const [index, mode] of ['500', '503', 'malformed'].entries()) {
    await open(item); await fill(field('purchase_price'), String(70 + index)); await evaluate(`window.outcomeMode=${JSON.stringify(mode)}`);
    await click('button', 'Save tracking'); await until(uncertain);
    await evaluate(`window.outcomeMode='pass';window.authFixture={calls:0,delayMs:70}`);
    await evaluate(`(()=>{const b=${button('Retry this save')};b.click();b.click()})()`); await until(saved);
    assert.equal(await evaluate('window.authFixture.calls'), 2, 'One POST token and one refresh token');
    assert.equal(await evaluate('window.outcomePosts.length'), 2);
  }
  for (const [index, status] of ['404', '422'].entries()) {
    await open(item); await fill(field('purchase_price'), String(80 + index)); await evaluate(`window.outcomeMode='500'`);
    await click('button', 'Save tracking'); await until(uncertain);
    const old = await evaluate('window.outcomePosts[0].body.request_id');
    await evaluate(`window.outcomeMode=${JSON.stringify(status)}`); await click('button', 'Retry this save'); await until(ready);
    assert.equal(await evaluate(`Boolean(${button('Retry this save')})`), false);
    assert.equal(await evaluate(field('purchase_price') + '.value'), String(80 + index));
    await evaluate(`window.outcomeMode='pass'`); await save();
    assert.notEqual(await evaluate('window.outcomePosts.at(-1).body.request_id'), old);
  }
  checks.push('First 500/503 and malformed confirmations stay uncertain; duplicate retry clicks send one POST; definite 404/422 release the attempt without losing entries');

  // Timeout and outage on initial loading, with no write or inferred default save.
  for (const mode of ['timeout', '503']) {
    await open(item); await click('button', 'Close tracking');
    await evaluate(`window.outcomeReadMode=${JSON.stringify(mode)};document.querySelector('[aria-controls="tracking-${item.id}"]').click()`);
    await until(`Boolean(${button('Reload tracking')})`);
    assert.equal(await evaluate('window.outcomePosts.length'), 0);
    await evaluate(`window.outcomeReadMode='pass'`); await click('button', 'Reload tracking'); await until(ready);
  }
  checks.push('Outcome loading timeout/outage blocks saving and supports an explicit read-only retry');

  for (const nextUser of [null, 'outcome-other-user']) {
    await open(item); await click('button', 'Close tracking');
    await evaluate(`window.outcomeReadMode='held';document.querySelector('[aria-controls="tracking-${item.id}"]').click()`);
    await until(`typeof window.releaseOutcomeRead==='function'`);
    await evaluate(`window.switchFixtureUser(${JSON.stringify(nextUser)});window.releaseOutcomeRead()`);
    await until(`!document.querySelector('.item-outcome') && !document.querySelector('[data-saved-item]')`);
    assert.equal(await evaluate('window.outcomePosts.length'), 0);

    await open(item); await fill(field('purchase_price'), '66'); await evaluate(`window.outcomeMode='500'`); await click('button', 'Save tracking'); await until(uncertain);
    await evaluate(`window.authFixture={calls:0,delayMs:350};window.outcomeMode='pass'`);
    await click('button', 'Retry this save'); await evaluate(`window.switchFixtureUser(${JSON.stringify(nextUser)})`); await pause(450);
    assert.equal(await evaluate('window.outcomePosts.length'), 1);
    assert.equal(await evaluate(`Boolean(document.querySelector('.item-outcome'))`), false);

    await open(item); await fill(field('purchase_price'), nextUser ? '69' : '67'); await evaluate(`window.outcomeMode='held'`); await click('button', 'Save tracking');
    await until(`typeof window.releaseOutcomePost==='function'`);
    await evaluate(`window.switchFixtureUser(${JSON.stringify(nextUser)});window.releaseOutcomePost()`); await pause(200);
    assert.equal(await evaluate(`Boolean(document.querySelector('.item-outcome'))`), false);
    assert.equal(await evaluate('window.outcomeReads.length'), 1, 'Old POST must not refresh under a different account');
  }
  checks.push('Sign-out/account change clear drafts and pending UUIDs, cancel pre-token retries and drop late GET/POST results without cross-account follow-up requests');
  const photo = (await api('/api/items')).items.find(row => row.assessment);
  assert.ok(photo); await open(photo);
  assert.equal(await evaluate('window.outcomePosts.length'), 0);
  assert.ok(await evaluate(`document.querySelector('.outcome-shared').textContent.includes('Tracking applies to all versions')`));
  checks.push('Photo finds use the same tracking panel with no assessment regeneration or automatic outcome save');
  assert.ok(await evaluate(`JSON.parse(sessionStorage.getItem('outcome-test-writes')).every(path=>path.startsWith('/api/items/')&&path.endsWith('/outcomes'))`));
  const aiAfter = await api('/browser-fixture/ai');
  assert.equal(aiAfter.calls, aiBefore.calls); assert.equal(aiAfter.posts, aiBefore.posts);
  assert.deepEqual(await api('/api/deals'), housesBefore);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  checks.push('Outcome tracking makes zero assessment/analyze/estimate-save calls and leaves Houses unchanged; all evidence uses simulated finds');
}
