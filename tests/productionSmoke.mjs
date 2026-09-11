// Public release verification. No sign-in, credentials, provider calls, or saved writes.
// Run from a checkout of the intended production commit after npm ci.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

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
  const protectedResponse = await fetch(`${backend}/api/deals`, { signal: AbortSignal.timeout(45000), redirect: 'error' });
  // Never read/log a body if the boundary unexpectedly fails.
  await protectedResponse.body?.cancel();
  assert.ok([401, 403].includes(protectedResponse.status), `Saved list allowed unauthenticated access: ${protectedResponse.status}`);
  check('Saved-deal list rejects unauthenticated access', { status: protectedResponse.status });
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL';
  evidence.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(output, 'production-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
}
