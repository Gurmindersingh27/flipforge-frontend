// Public release verification. No sign-in, credentials, provider calls, or saved writes.
// Run from a checkout of the intended production commit after npm ci.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { SAMPLE_SCENARIOS } from '../src/lib/sampleDeal.ts';

const frontend = 'https://flipforge-frontend.vercel.app';
const backend = 'https://flipforge-backend.onrender.com';
const output = resolve(process.env.SMOKE_OUTPUT_DIR || 'release-evidence');
mkdirSync(output, { recursive: true });
const evidence = {
  checked_at: new Date().toISOString(),
  frontend, backend,
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  checks: [],
  signed_in_production_workflow: 'NOT RUN',
  database_durability_and_backups: 'NOT VERIFIED',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (name, detail = {}) => {
  evidence.checks.push({ name, ...detail });
  console.log(`PASS: ${name}`);
};
async function request(url, init = {}, expected = 200) {
  // One bounded retry accommodates a cold public service; POSTs here are stateless.
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45000), redirect: 'error' });
      assert.equal(response.status, expected, `${url}: HTTP ${response.status}`);
      return response;
    } catch (error) { last = error; }
  }
  throw last;
}
function assets(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1]).sort();
}

try {
  const html = await (await request(`${frontend}/`)).text();
  const paths = assets(html);
  assert.ok(paths.some(p => p.endsWith('.js')) && paths.some(p => p.endsWith('.css')), 'Expected Vite JS/CSS assets');
  // Direct requests exercise hosting rewrites, not Vite's local SPA fallback.
  // These load only the public shell, never a signed-in saved-deal record.
  for (const route of ['/deals', '/deal/1', '/items', '/my-flips', '/items?saved=1']) {
    const response = await request(`${frontend}${route}`);
    assert.ok(response.headers.get('content-type')?.includes('text/html'), `${route}: expected HTML`);
    const routeHtml = await response.text();
    assert.ok(routeHtml.includes('<div id="root"></div>'), `${route}: missing app root`);
    assert.deepEqual(assets(routeHtml), paths, `${route}: different app assets`);
    check('Direct application route serves the app shell', { route });
  }
  const privateItems = await request(`${backend}/api/items`, {}, 403);
  assert.equal((await privateItems.json()).detail, 'Not authenticated');
  check('Saved Items requires authentication without accessing or writing records');
  const deployed = new Map(await Promise.all(paths.map(async path => [path, Buffer.from(await (await request(frontend + path)).arrayBuffer())])));
  const javascript = [...deployed].filter(([p]) => p.endsWith('.js')).map(([, bytes]) => bytes.toString()).join('\n');
  assert.ok(javascript.includes(backend), 'Production bundle must target the expected API');
  for (const text of ['Save New Revision', 'Itemized rehab scope', 'What changed since the previous version', 'rehab_scope', 'parent_deal_id']) {
    assert.ok(javascript.includes(text), `Missing release feature: ${text}`);
  }
  check('Production HTML and assets load with expected API and revision features');

  // This is the public Clerk publishable key already shipped to every browser.
  // It is only used to reproduce static assets; no authentication is performed.
  const publicKeys = [...new Set(javascript.match(/pk_(?:test|live)_[A-Za-z0-9_=-]+/g) ?? [])];
  assert.equal(publicKeys.length, 1, 'Expected one public build key');
  execFileSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_API_BASE_URL: backend, VITE_CLERK_PUBLISHABLE_KEY: publicKeys[0] },
  });
  const builtPaths = assets(readFileSync('dist/index.html', 'utf8'));
  assert.deepEqual(builtPaths, paths, 'Deployed asset names differ from the intended source build');
  for (const path of paths) {
    const hash = sha(deployed.get(path));
    assert.equal(sha(readFileSync(resolve('dist/assets', basename(path)))), hash, `Deployed bytes differ: ${path}`);
    check('Deployed asset exactly matches source build', { path, sha256: hash });
  }

  const health = await (await request(`${backend}/api/health`)).json();
  assert.deepEqual(health, { status: 'ok' });
  check('Backend health');
  const schema = await (await request(`${backend}/openapi.json`)).json();
  for (const name of ['RehabScope', 'RehabScopeItem']) assert.ok(schema.components.schemas[name], `Missing ${name}`);
  for (const name of ['SaveDealRequest', 'SavedDealResponse']) {
    for (const field of ['rehab_scope', 'parent_deal_id', 'revision_note']) {
      assert.ok(schema.components.schemas[name].properties[field], `${name}.${field} missing`);
    }
  }
  check('Scope/revision save and read contracts live');

  const cors = await request(`${backend}/api/analyze`, { method: 'OPTIONS', headers: {
    Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
  } });
  assert.equal(cors.headers.get('access-control-allow-origin'), frontend);
  check('Production origin CORS preflight');

  const defaults = { closing_cost_pct: .03, selling_cost_pct: .08, holding_months: 6,
    annual_interest_rate: .10, loan_to_cost_pct: .90, required_profit_margin_pct: .12, est_monthly_rent: null };
  const fixtures = [
    ['S1', 185000, 240000, 45000, 'PASS', 137700, -25100, 12],
    ['S2', 135000, 240000, 45000, 'BUY', 137700, 28650, 86],
    ['S3', 200000, 345000, 50000, 'BUY', 212300, 50150, 93],
  ];
  for (const [name, purchase_price, arv, rehab_budget, verdict, offer, profit, confidence] of fixtures) {
    const input = { ...defaults, purchase_price, arv, rehab_budget };
    const result = await (await request(`${backend}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: frontend }, body: JSON.stringify(input),
    })).json();
    assert.equal(result.overall_verdict, verdict, `${name}: verdict`);
    assert.equal(result.max_safe_offer, offer, `${name}: offer`);
    assert.equal(result.net_profit, profit, `${name}: profit`);
    assert.equal(result.confidence_score, confidence, `${name}: confidence`);
    check(`Live locked scenario ${name}`, { input, result: { verdict, offer, profit, confidence } });
  }
  // Check production independently of browser CI's backend pin, including the
  // released required-return verdict policy (backend PR #20).
  const sampleVerdicts = { estimate: 'BUY', quote: 'CONDITIONAL', delay: 'CONDITIONAL' };
  for (const scenario of SAMPLE_SCENARIOS) {
    const result = await (await request(`${backend}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: frontend },
      body: JSON.stringify(scenario.input),
    })).json();
    for (const [field, expected] of Object.entries(scenario.result)) {
      assert.equal(result[field], expected, `Public sample ${scenario.id}: live ${field} differs from displayed preset`);
    }
    assert.ok(Object.hasOwn(sampleVerdicts, scenario.id), `Missing verdict expectation: ${scenario.id}`);
    assert.equal(result.overall_verdict, sampleVerdicts[scenario.id], `Public sample ${scenario.id}: live verdict`);
    check(`Live public sample ${scenario.id}`, {
      input: scenario.input, expected: scenario.result,
      result: { max_safe_offer: result.max_safe_offer, net_profit: result.net_profit,
        total_project_cost: result.total_project_cost, verdict: result.overall_verdict },
    });
  }
  const protectedResponse = await fetch(`${backend}/api/deals`, { signal: AbortSignal.timeout(45000), redirect: 'error' });
  // Never read/log a body if the boundary unexpectedly fails.
  await protectedResponse.body?.cancel();
  assert.ok([401, 403].includes(protectedResponse.status), `Saved list allowed unauthenticated access: ${protectedResponse.status}`);
  check('Saved-deal list rejects unauthenticated access', { status: protectedResponse.status });
  assert.ok(schema.paths['/api/items/analyze']?.post, 'Items endpoint must be deployed');
  const itemsCors = await request(`${backend}/api/items/analyze`, { method: 'OPTIONS', headers: {
    Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
  } });
  assert.equal(itemsCors.headers.get('access-control-allow-origin'), frontend);
  check('Public Items endpoint and production-origin CORS');
  const dresser = { resale_low:300,resale_high:450,repairs:60,pickup:40,delivery:0,storage:0,
    fee_fixed:0,fee_pct:0,contingency_pct:0,hours:5,hourly_value:20,target_profit:150 };
  const itemCases = [
    ['dresser free', {...dresser,purchase_price:0}, 'stretch', -50, 100],
    ['dresser above target', {...dresser,purchase_price:100.01}, 'skip', -50, -0.01],
    ['dresser offer-only', dresser, 'offer_only', -50, null],
    ['fractional ceiling', {...dresser,purchase_price:77,resale_high:300,repairs:40,pickup:15,fee_fixed:1.10,
      fee_pct:0.075,contingency_pct:0.1,hours:2,target_profit:100}, 'within_budget',77,100.40],
  ];
  for (const [name,input,status,offer,profit] of itemCases) {
    const response = await (await request(`${backend}/api/items/analyze`, {
      method:'POST',headers:{'Content-Type':'application/json',Origin:frontend},body:JSON.stringify(input),
    })).json();
    assert.equal(response.schema_version,1); assert.equal(response.status,status);
    assert.equal(response.low.max_offer,offer); assert.ok(Number.isInteger(response.low.max_offer));
    assert.equal(response.low.profit_after_time,profit);
    assert.deepEqual(response.missing_inputs,[]);
    check(`Live Items ${name}`,{status,offer,profit});
  }
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL';
  evidence.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(output, 'production-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
}
