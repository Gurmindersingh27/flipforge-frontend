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
const inputByAria = label => `document.querySelector('[aria-label=${JSON.stringify(label)}]')`;
async function toggle(label) { await evaluate(`(${inputByAria(label)}).click()`); }
async function resumeSaved(id) {
  await cdp("Page.navigate", { url: `http://127.0.0.1:5173/deal/${id}` });
  await click("a", "Resume Deal");
  await until(`location.pathname === '/' && Boolean(${scopeInput("Unit cost 1")}) && !(${scopeInput("Unit cost 1")}).matches(':disabled')`);
}
async function saveRevision(note) {
  await fill(inputByAria("Revision note"), note);
  await click("button", "Generate Investor Memo");
  await until(`Boolean(${byText("button", "Save New Revision")})`);
  await click("button", "Save New Revision");
  await until(`Boolean(${byText("button", "Saved!")})`);
  return (await api("/api/deals"))[0];
}
async function enterQuoteDetails(source, date) {
  await click("summary", "Apply quote details to selected lines");
  await fill(inputByAria("Bulk quote contractor"), source);
  await fill(inputByAria("Bulk quote date"), date);
  await toggle("Select quote line 1");
}
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
  await scoped("Notes 1", "Disposal excluded; owner allowance requires confirmation.");
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
  await until(`document.querySelector('[aria-label="Scope evidence changes"]')?.textContent.includes('Disposal excluded; owner allowance requires confirmation.')`);
  checks.push("Saved comparison displays the recorded exclusion evidence");
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
  await scoped("Notes 1", "Disposal now included after contractor confirmation. Price unchanged.");
  await click("button", "Generate Investor Memo");
  await until(`Boolean(${byText("button", "Save New Revision")})`);
  await click("button", "Save New Revision"); await until(`Boolean(${byText("button", "Saved!")})`);
  const third = (await api("/api/deals"))[0];
  assert.equal(third.parent_deal_id, second.id);
  assert.equal(third.analysis_result.net_profit, second.analysis_result.net_profit);
  assert.equal(third.analysis_result.max_safe_offer, second.analysis_result.max_safe_offer);
  assert.deepEqual(await api(`/api/deals/${second.id}`), second);
  await click("a", "View saved version →");
  await until(`document.querySelector('[aria-label="Scope evidence changes"]')?.textContent.includes('Disposal now included after contractor confirmation. Price unchanged.')`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Scope evidence changes"]').textContent.includes('Disposal excluded; owner allowance requires confirmation.')`));
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await screenshot("mobile-evidence-change.png");
  checks.push("Cost-neutral revision shows both exclusion passages, preserves economics and previous record, and fits mobile");

  // Build two quoted alternatives from one itemized baseline, using only the UI to write records.
  await resumeSaved(first.id);
  await scoped("Category 1", "Kitchen"); await scoped("Unit cost 1", "20000");
  await scoped("Description 1", "Kitchen planning scope");
  await click("button", "Add scope item");
  await scoped("Category 2", "Roof"); await scoped("Unit cost 2", "12000");
  await scoped("Source 2", "Owner roof allowance"); await scoped("Notes 2", "Retained roof allowance.");
  await scoped("Scope contingency", "10");
  await fill(labelInput("Holding Months"), "7");
  const baseline = await saveRevision("Itemized bid baseline fixture");
  assert.equal(baseline.draft_input.rehab_budget.value, 35200);
  assert.equal(baseline.draft_input.holding_months, 7);
  await click("a", "View saved version →"); await click("button", "Compare bids");
  await until(`Boolean(${byText("a", `baseline #${baseline.id}`)})`);
  assert.equal(await evaluate(`(${byText("a", `baseline #${baseline.id}`)}).getAttribute('href')`), `/deal/${baseline.id}`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Bid comparison"]').textContent.includes('Resume baseline #${baseline.id}')`));

  await resumeSaved(baseline.id);
  await scoped("Unit cost 1", "14000");
  await scoped("Notes 1", "Disposal excluded. Owner to arrange.");
  await click("button", "Add scope item");
  await scoped("Category 3", "Demo / Disposal"); await scoped("Unit cost 3", "6500");
  await scoped("Notes 3", "Reviewer demo allowance; confirm final scope.");
  await enterQuoteDetails("Builder A fixture", "2026-09-11");
  await click("button", "Apply quote details");
  await until(`document.body.textContent.includes('Confirm that the selected planning allowances')`);
  assert.equal(await evaluate(`(${scopeInput("Basis 1")}).value`), "allowance");
  await toggle("Confirm allowance conversion");
  await scoped("Unit cost 1", "14001");
  assert.equal(await evaluate(`(${inputByAria("Confirm allowance conversion")}).checked`), false);
  await click("button", "Apply quote details");
  assert.equal(await evaluate(`(${scopeInput("Basis 1")}).value`), "allowance");
  await scoped("Unit cost 1", "14000");
  await toggle("Confirm allowance conversion"); await click("button", "Apply quote details");
  await until(`(${scopeInput("Basis 1")}).value === 'quote'`);
  assert.equal(await evaluate(`(${scopeInput("Source 2")}).value`), "Owner roof allowance");
  assert.equal(await evaluate(`(${scopeInput("Basis 2")}).value`), "allowance");
  const bidA = await saveRevision("Bid A fixture");
  assert.equal(bidA.parent_deal_id, baseline.id);
  assert.equal(bidA.draft_input.rehab_budget.value, 35750);
  assert.equal(bidA.rehab_scope.items[0].source, "Builder A fixture");
  assert.equal(bidA.rehab_scope.items[2].basis, "allowance");
  checks.push("Bulk quote stamping requires price consent, invalidates it after a price edit and preserves unselected roof and demo allowances");

  await resumeSaved(baseline.id);
  await scoped("Unit cost 1", "18000"); await scoped("Notes 1", "Disposal included. Finish materials excluded.");
  await click("button", "Add scope item"); await scoped("Category 3", "Finishes"); await scoped("Unit cost 3", "1300");
  await scoped("Notes 3", "Reviewer finish allowance; selection pending.");
  await enterQuoteDetails("Builder B fixture", "2026-09-11");
  await toggle("Confirm allowance conversion"); await click("button", "Apply quote details");
  const bidB = await saveRevision("Bid B fixture");
  assert.equal(bidB.parent_deal_id, baseline.id);
  assert.equal(bidB.draft_input.rehab_budget.value, 34430);
  assert.ok(bidB.analysis_result.net_profit > bidA.analysis_result.net_profit);
  await click("a", "View saved version →"); await click("button", "Compare bids");
  await until(`Boolean(${byText("a", `baseline #${baseline.id}`)})`);
  await cdp("Page.navigate", { url: `http://127.0.0.1:5173/deal/${baseline.id}` });
  await click("button", "Compare bids");
  await until(`Boolean(${inputByAria("Bid A saved version")})`);
  assert.equal(await evaluate(`(${byText("a", `baseline #${baseline.id}`)}).getAttribute('href')`), `/deal/${baseline.id}`);
  const discovered = await evaluate(`Array.from((${inputByAria("Bid A saved version")}).options).map(option=>Number(option.value))`);
  assert.deepEqual(discovered.sort((a,b)=>a-b), [bidA.id,bidB.id].sort((a,b)=>a-b));
  await fill(inputByAria("Bid A saved version"), String(bidA.id));
  await fill(inputByAria("Bid B saved version"), String(bidB.id));
  await until(`Boolean(document.querySelector('[aria-label="Bid A impact"]'))`);
  const comparisonText = await evaluate(`document.querySelector('[aria-label="Bid comparison"]').textContent`);
  for (const value of ["Disposal excluded. Owner to arrange.", "Disposal included. Finish materials excluded.", "Not separately itemized", "$35,750.00", "$34,430.00"]) assert.ok(comparisonText.includes(value), value);
  for (const [label, bid] of [["Bid A", bidA], ["Bid B", bidB]]) {
    const savedText = await evaluate(`document.querySelector('[aria-label="${label} impact"]').textContent`);
    for (const value of [bid.analysis_result.max_safe_offer, bid.analysis_result.net_profit]) {
      assert.ok(savedText.includes(value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })));
    }
  }
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await screenshot("bid-impact-mobile.png");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await screenshot("bid-impact-desktop.png");
  checks.push("Two saved sibling bids compare exact quote evidence, allowances, retained costs, totals and canonical deal impact at 390px and desktop");
  checks.push("A revised baseline discovers both quoted children with its updated 7-month assumptions, not its 6-month parent");

  await resumeSaved(baseline.id);
  await enterQuoteDetails("Builder same-price fixture", "2026-09-11");
  await toggle("Confirm allowance conversion"); await click("button", "Apply quote details");
  const samePrice = await saveRevision("Quote matches original allowance fixture");
  assert.equal(samePrice.rehab_scope.items[0].unit_cost, 20000);
  assert.equal(samePrice.parent_deal_id, baseline.id);
  await click("a", "View saved version →"); await click("button", "Compare bids");
  await fill(inputByAria("Bid A saved version"), String(bidA.id));
  await fill(inputByAria("Bid B saved version"), String(samePrice.id));
  const confirmSamePrice = `Confirm Bid B amount for ${samePrice.rehab_scope.items[0].id}`;
  await until(`Boolean(${inputByAria(confirmSamePrice)})`);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Bid B impact"]'))`), false);
  assert.equal(await evaluate(`Boolean(${byText("a", "Continue with Bid B")})`), false);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
  await screenshot("bid-carried-allowance-review.png");
  await toggle(confirmSamePrice);
  await until(`Boolean(document.querySelector('[aria-label="Bid B impact"]'))`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Bid B impact"]').textContent.includes('$20,000.00')`));
  await toggle(confirmSamePrice);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Bid B impact"]'))`), false);
  await toggle(confirmSamePrice);
  await fill(inputByAria("Bid B saved version"), String(bidB.id));
  await fill(inputByAria("Bid B saved version"), String(samePrice.id));
  assert.equal(await evaluate(`(${inputByAria(confirmSamePrice)}).checked`), false);
  await toggle(confirmSamePrice); await click("button", "Refresh saved bids");
  await fill(inputByAria("Bid A saved version"), String(bidA.id));
  await fill(inputByAria("Bid B saved version"), String(samePrice.id));
  assert.equal(await evaluate(`(${inputByAria(confirmSamePrice)}).checked`), false);
  await toggle(confirmSamePrice); await cdp("Page.reload"); await click("button", "Compare bids");
  await fill(inputByAria("Bid A saved version"), String(bidA.id));
  await fill(inputByAria("Bid B saved version"), String(samePrice.id));
  assert.equal(await evaluate(`(${inputByAria(confirmSamePrice)}).checked`), false);
  assert.deepEqual(await api(`/api/deals/${samePrice.id}`), samePrice);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  checks.push("A relabeled allowance blocks bid impact until the exact unchanged price is confirmed; unchecking, changing bids, refresh and reload reset confirmation without saved writes");

  await resumeSaved(baseline.id);
  await scoped("Unit cost 1", "18000");
  await enterQuoteDetails("Builder mismatch fixture", "2026-09-11");
  await toggle("Confirm allowance conversion"); await click("button", "Apply quote details");
  await fill(labelInput("Holding Months"), "8");
  const mismatch = await saveRevision("Different holding period fixture");
  await click("a", "View saved version →"); await click("button", "Compare bids");
  await fill(inputByAria("Bid A saved version"), String(bidA.id));
  await fill(inputByAria("Bid B saved version"), String(mismatch.id));
  await until(`document.querySelector('[aria-label="Bid comparison"] [role="alert"]')?.textContent.includes('Holding months: baseline 7 · Bid A 7 · Bid B 8')`);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Bid A impact"]'))`), false);
  assert.equal(await evaluate(`Boolean(${byText("a", "Continue with Bid B")})`), false);
  await screenshot("bid-assumption-mismatch.png");
  checks.push("A sibling with different holding months is blocked from bid-only impact and continuation");

  await fill(inputByAria("Bid B saved version"), String(bidB.id));
  await click("a", "Continue with Bid B");
  await until(`location.pathname === '/' && Boolean(${scopeInput("Unit cost 1")}) && !(${scopeInput("Unit cost 1")}).matches(':disabled')`);
  assert.equal(await evaluate(`(${scopeInput("Source 1")}).value`), "Builder B fixture");
  await enterQuoteDetails("Builder B fixture", "2026-09-12");
  await click("button", "Apply quote details");
  await until(`document.body.textContent.includes('Confirm replacement of existing source / date')`);
  assert.equal(await evaluate(`(${scopeInput("Quote date 1")}).value`), "2026-09-11");
  await toggle("Confirm quote details replacement"); await click("button", "Apply quote details");
  const selected = await saveRevision("Selected Bid B; quote date reconfirmed fixture");
  assert.equal(selected.parent_deal_id, bidB.id);
  assert.equal(selected.rehab_scope.items[0].quote_date, "2026-09-12");
  assert.equal(selected.analysis_result.net_profit, bidB.analysis_result.net_profit);
  assert.equal(selected.analysis_result.max_safe_offer, bidB.analysis_result.max_safe_offer);
  for (const record of [first, baseline, bidA, bidB, samePrice]) assert.deepEqual(await api(`/api/deals/${record.id}`), record);
  await click("a", "View saved version →"); await cdp("Page.reload");
  await until(`(${scopeInput("Quote date 1")})?.value === '2026-09-12'`);
  checks.push("Continuing Bid B creates its child; confirmed provenance changes reopen correctly and all prior records stay unchanged");
  await click("button", "Compare bids");
  await click("button", `Start new bids from this version #${selected.id}`);
  await until(`Boolean(${byText("a", `baseline #${selected.id}`)})`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Bid comparison"]').textContent.includes('Resume baseline #${selected.id}')`));
  checks.push("A quoted revision can explicitly start a new baseline before it has any quoted children");
  assert.deepEqual(errors, []);
  checks.push("No browser runtime exceptions");
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ checks, first: first.analysis_result, second: second.analysis_result, bids: { baseline, bidA, bidB, samePrice, mismatch, selected } }, null, 2));
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
