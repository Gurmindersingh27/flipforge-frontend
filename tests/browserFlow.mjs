// Real browser -> frontend -> backend -> isolated SQLite. No production credentials.
// Uses Node 24 WebSocket and the runner's Chrome; no new package dependencies.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const backend = resolve(process.env.BACKEND_DIR ?? "../flipforge-backend");
const temp = mkdtempSync(join(tmpdir(), "flipforge-browser-"));
const artifacts = resolve("browser-artifacts");
mkdirSync(artifacts, { recursive: true });
const children = [], errors = [], checks = [];
let socket, sequence = 0, sessionId;
const pending = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(command, args, extraEnv = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.on("error", error => errors.push(error.message));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => process.stderr.write(data));
  return child;
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try { const res = await fetch(url); if (res.ok) return await res.text(); } catch {}
    await pause(250);
  }
  throw new Error(`Server unavailable: ${url}`);
}
function cdp(method, params = {}, attached = true) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: err => { clearTimeout(timer); reject(err); } });
    socket.send(JSON.stringify({ id, method, params, ...(attached && sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await pause(200); }
  throw new Error(`UI condition timed out: ${expression}`);
}
const byText = (tag, text) => `Array.from(document.querySelectorAll(${JSON.stringify(tag)})).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
async function click(tag, text) {
  const expr = byText(tag, text);
  await until(`Boolean(${expr})`);
  await evaluate(`(${expr}).click()`);
}
async function fill(expression, value) {
  await until(`Boolean(${expression})`);
  await evaluate(`(()=>{const e=${expression}; const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
const labelInput = text => `(${byText("label", text)})?.parentElement.querySelector('input')`;
const scopeInput = label => `document.querySelector('section[aria-label="Itemized rehab scope"] [aria-label=${JSON.stringify(label)}]')`;
const scoped = (label, value) => fill(scopeInput(label), value);
const api = async path => { const res = await fetch(`http://127.0.0.1:8000${path}`); assert.equal(res.status, 200); return res.json(); };
async function screenshot(name) {
  const { cssContentSize } = await cdp("Page.getLayoutMetrics");
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
  writeFileSync(join(artifacts, name), Buffer.from(data, "base64"));
}

try {
  writeFileSync(join(temp, "fixture.py"), `import os\nos.environ['DATABASE_URL'] = ${JSON.stringify(`sqlite:///${temp}/fixture.db`)}\nos.environ['CLERK_JWKS_URL'] = ''\nfrom app.main import app\nfrom app.auth import get_current_user_id\napp.dependency_overrides[get_current_user_id] = lambda: 'browser-fixture'\n`);
  writeFileSync(join(temp, "clerk.ts"), `const auth={getToken:async()=>"browser-fixture",isSignedIn:true,isLoaded:true};export const useAuth=()=>auth;export const SignedIn=({children})=>children;export const SignedOut=()=>null;export const ClerkProvider=({children})=>children;export const UserButton=()=>null;export const SignInButton=({children})=>children;export const SignUpButton=({children})=>children;`);
  writeFileSync(join(temp, "vite.mjs"), `import base from ${JSON.stringify(join(root, "vite.config.ts"))};export default {...base,root:${JSON.stringify(root)},resolve:{alias:{'@clerk/clerk-react':${JSON.stringify(join(temp, "clerk.ts"))}}},server:{host:'127.0.0.1',port:5173,strictPort:true,fs:{allow:[${JSON.stringify(root)},${JSON.stringify(temp)}]}}};`);
  start(process.env.PYTHON ?? "python", ["-m", "uvicorn", "fixture:app", "--host", "127.0.0.1", "--port", "8000"], { PYTHONPATH: `${backend}:${temp}` });
  start(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--config", join(temp, "vite.mjs"), "--configLoader", "native"], { VITE_API_BASE_URL: "http://127.0.0.1:8000" });
  await Promise.all([ready("http://127.0.0.1:8000/api/health"), ready("http://127.0.0.1:5173/")]);
  start(process.env.CHROME_BIN ?? "google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--remote-debugging-port=9222", `--user-data-dir=${temp}/chrome`, "about:blank"]);
  const version = JSON.parse(await ready("http://127.0.0.1:9222/json/version"));
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { const waiter = pending.get(msg.id); if (!waiter) return; pending.delete(msg.id); msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(msg.params.exceptionDetails));
  };
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" }, false);
  ({ sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true }, false));
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: "http://127.0.0.1:5173/" });
  await click("button", "Analyze without address lookup ↓");
  for (const [label, value] of [["Purchase Price", "150000"], ["ARV", "270000"], ["Rehab Budget", "50000"], ["Est. Monthly Rent (optional)", ""]]) await fill(labelInput(label), value);
  await click("button", "Start itemized budget");
  await click("button", "Generate Investor Memo");
  await until(`Boolean(${byText("button", "Save Deal")})`);
  await scoped("Unit cost 1", "67000");
  await click("button", "Save Deal"); await until(`Boolean(${byText("button", "Saved!")})`);
  const first = (await api("/api/deals"))[0];
  assert.equal(first.rehab_scope.items[0].unit_cost, 50000);
  assert.equal(first.draft_input.rehab_budget.value, 50000);
  assert.equal(first.analysis_result.max_safe_offer, 155600);
  assert.equal(first.analysis_result.net_profit, 34900);
  checks.push("Manual flow saves the submitted $50K scope after editing the live scope to $67K");
  await click("a", "View saved version →"); await until(`Boolean(${byText("a", "Resume Deal")})`);
  await cdp("Page.reload"); await until(`Boolean(${byText("a", "Resume Deal")})`);
  await until(`Boolean(${scopeInput("Unit cost 1")})`);
  assert.equal(await evaluate(`(${scopeInput("Unit cost 1")}).value`), "50000");
  checks.push("Scope persists through saved-deal reload");
  await click("a", "Resume Deal");
  await until(`location.pathname === '/' && Boolean(${scopeInput("Unit cost 1")}) && !(${scopeInput("Unit cost 1")}).matches(':disabled')`);
  await scoped("Unit cost 1", "67000"); await scoped("Basis 1", "quote");
  await click("button", "Generate Investor Memo");
  await until(`document.body.textContent.includes('Each quoted item needs a source and quote date.')`);
  checks.push("Incomplete quote blocked in UI");
  await scoped("Source 1", "Contractor fixture"); await scoped("Quote date 1", "2026-09-10");
  await fill(labelInput("Holding Months"), "8");
  await fill(`document.querySelector('[aria-label="Revision note"]')`, "Quotes + two months");
  await click("button", "Generate Investor Memo");
  await until(`Boolean(${byText("button", "Save New Revision")})`);
  await scoped("Unit cost 1", "70000");
  await click("button", "Save New Revision"); await until(`Boolean(${byText("button", "Saved!")})`);
  const second = (await api("/api/deals"))[0];
  assert.equal(second.parent_deal_id, first.id);
  assert.equal(second.rehab_scope.items[0].unit_cost, 67000);
  assert.equal(second.revision_note, "Quotes + two months");
  assert.equal(second.draft_input.holding_months, 8);
  assert.ok(second.analysis_result.max_safe_offer < first.analysis_result.max_safe_offer);
  assert.ok(second.analysis_result.net_profit < first.analysis_result.net_profit);
  assert.deepEqual(await api(`/api/deals/${first.id}`), first);
  checks.push("Draft flow saves $67K quoted scope + 8 months, links the parent, lowers offer/profit and preserves original");
  await click("a", "View saved version →"); await until(`Boolean(document.querySelector('[aria-label="Revision comparison"]'))`);
  await screenshot("desktop-saved.png");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await screenshot("mobile-saved.png");
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await click("a", "Resume Deal");
  await until(`location.pathname === '/' && Boolean(${scopeInput("Unit cost 1")}) && !(${scopeInput("Unit cost 1")}).matches(':disabled')`); await until(`Boolean(${scopeInput("Unit cost 1")})`);
  assert.equal(await evaluate(`(${scopeInput("Unit cost 1")}).value`), "67000");
  await screenshot("mobile-editor.png");
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  checks.push("Saved comparison and restored editor fit 390px viewport");
  assert.deepEqual(errors, []);
  checks.push("No browser runtime exceptions");
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ checks, first: first.analysis_result, second: second.analysis_result }, null, 2));
  console.log(JSON.stringify({ result: "PASS", checks }));
} catch (error) {
  console.error(error);
  if (socket && sessionId) {
    try { writeFileSync(join(artifacts, "failure.html"), await evaluate("document.documentElement.outerHTML")); await screenshot("failure.png"); } catch {}
  }
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const child of children) child.kill("SIGTERM");
  for (const waiter of pending.values()) waiter.reject(new Error("Browser test closed"));
  setTimeout(() => { rmSync(temp, { recursive: true, force: true }); }, 1000).unref();
}
