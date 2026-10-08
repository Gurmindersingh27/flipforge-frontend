// Real browser -> frontend -> backend -> isolated SQLite. No production credentials.
// Uses Node 24 WebSocket and the runner's Chrome; no new package dependencies.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { SAMPLE_SCENARIOS } from "../src/lib/sampleDeal.ts";
import { restoreItemForm, buildSavedItemInputs } from "../src/lib/savedItems.ts";
import { formatItemMoney, ITEM_STATUS_TEXT } from "../src/lib/itemAnalysis.ts";
import { roundTripCases } from "./savedItems.test.ts";
import { photoBackendFixture, runPhotoItemChecks } from "./itemPhotoFlow.mjs";

const root = process.cwd();
const backend = resolve(process.env.BACKEND_DIR ?? "../flipforge-backend");
const temp = mkdtempSync(join(tmpdir(), "flipforge-browser-"));
const artifacts = resolve("browser-artifacts");
mkdirSync(artifacts, { recursive: true });
const children = [], errors = [], checks = [];
const browserApiRequests = [];
const browserApiWrites = [];
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
async function requireFonts() {
  // Vite can render React before the imported font stylesheet has registered its faces.
  await until(`["JetBrains Mono","DM Serif Display"].every(family=>[...document.fonts].some(f=>f.family.replaceAll('"','').replaceAll("'",'')===family))`);
  const fonts = await evaluate(`(async()=>{
    const required=[['JetBrains Mono','14px "JetBrains Mono"'],['DM Serif Display','16px "DM Serif Display"']];
    await Promise.all(required.map(([,spec])=>document.fonts.load(spec)));
    await document.fonts.ready;
    return required.map(([family,spec])=>({family,ready:document.fonts.check(spec),faces:[...document.fonts].filter(f=>f.family.replaceAll('"','').replaceAll("'",'')===family).map(f=>({status:f.status,weight:f.weight}))}));
  })()`);
  for (const font of fonts) {
    assert.ok(font.ready, `${font.family} must load before layout assertions`);
    // FontFaceSet.check alone can return true when the family is not registered at all.
    assert.ok(font.faces.some(f=>f.status === 'loaded' && f.weight === '400'), `A real ${font.family} regular face must be loaded, not a fallback: ${JSON.stringify(font)}`);
  }
  return fonts;
}
async function measure(expression) {
  await requireFonts();
  return evaluate(expression);
}
async function until(expression) {
  for (let i = 0; i < 80; i++) {
    try { if (await evaluate(expression)) return; }
    catch (error) {
      // A read poll can overlap an intentional reload. Keep the same bounded
      // wait, but never replay actions or suppress application/assertion errors.
      if (!(error instanceof Error) || error.message !== JSON.stringify({ code: -32000, message: "Inspected target navigated or closed" })) throw error;
    }
    await pause(200);
  }
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
const visible = expression => `(()=>{const e=${expression};if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';})()`;
const inputByAria = label => `Array.from(document.querySelectorAll('[aria-label], input')).find(e=>{const name=e.getAttribute('aria-label') ?? Array.from(e.labels ?? []).map(l=>l.textContent.trim()).join(' ');const r=e.getBoundingClientRect(),s=getComputedStyle(e);return name===${JSON.stringify(label)} && r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';})`;
async function clickVisible(expression) {
  assert.ok(await evaluate(visible(expression)), `Target must be visible: ${expression}`);
  await evaluate(`(${expression}).scrollIntoView({block:'center',inline:'nearest'})`);
  const point = await measure(`(()=>{const e=${expression},r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,inside:r.left>=0 && r.right<=innerWidth};})()`);
  assert.ok(point.inside, "Target must be reachable without horizontal scrolling");
  assert.ok(await evaluate(`(()=>{const e=${expression};return e.contains(document.elementFromPoint(${point.x},${point.y}));})()`), "Pointer must hit the visible target");
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}
// Normalize modern CSS color syntax through canvas rather than comparing serialization.
async function expectLinkStyle(expression, color, underline = false) {
  assert.ok(await evaluate(visible(expression)), "Style target must be visible");
  const result = await evaluate(`(()=>{const e=${expression},s=getComputedStyle(e),c=document.createElement('canvas'),x=c.getContext('2d');c.width=c.height=1;const pixel=v=>{x.clearRect(0,0,1,1);x.fillStyle=v;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data];};const probe=document.createElement('span');probe.style.color=${JSON.stringify(color)};document.body.append(probe);const expected=pixel(getComputedStyle(probe).color);probe.remove();return {actual:pixel(s.color),expected,decoration:s.textDecorationLine};})()`);
  result.actual.forEach((v,i)=>assert.ok(Math.abs(v-result.expected[i])<=1, `Link color: ${JSON.stringify(result)}`));
  if (underline === true) assert.ok(result.decoration.includes('underline'), "Link must render an underline");
  if (underline === "none") assert.equal(result.decoration, "none", "Unavailable text must not look like a link");
}
async function linkRenderPair(name) {
  // Reproduce only the two approved source differences for an identical-data baseline.
  await evaluate(`(()=>{const s=document.createElement('style');s.id='prior-anchor-rules';s.textContent='a {font-weight:500;color:inherit;text-decoration:inherit} a:hover {color:inherit}';document.head.append(s);const a=[...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='← My Deals');if(a){a.dataset.originalClass=a.className;a.className=a.className.replace('text-white/60','text-white/40');}})()`);
  await pause(200);
  await screenshot(`${name}-before.png`);
  await evaluate(`(()=>{document.getElementById('prior-anchor-rules').remove();const a=document.querySelector('[data-original-class]');if(a){a.className=a.dataset.originalClass;delete a.dataset.originalClass;}})()`);
  await pause(200);
  await screenshot(`${name}-after.png`);
  const contrast = await measure(`(()=>{const c=document.createElement('canvas'),x=c.getContext('2d');c.width=c.height=1;const rgba=v=>{x.clearRect(0,0,1,1);x.fillStyle=v;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data];};const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]/255+b[i]*(1-a[3]/255));const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);return [...document.querySelectorAll('a')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&getComputedStyle(e).visibility!=='hidden').map(e=>{const chain=[];for(let p=e;p;p=p.parentElement)chain.unshift(p);let bg=[0,0,0];for(const p of chain)bg=blend(rgba(getComputedStyle(p).backgroundColor),bg);const fg=blend(rgba(getComputedStyle(e).color),bg),a=luminance(fg),b=luminance(bg);return {text:e.textContent.trim(),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});})()`);
  console.log("LINK_CONTRAST", name, JSON.stringify(contrast));
  assert.ok(contrast.every(link=>link.ratio>=4.5), `Link contrast below 4.5:1: ${JSON.stringify(contrast.filter(link=>link.ratio<4.5))}`);

}
async function verifyDesktopHover(id, noDraftSource) {
  // Full-page screenshot/mobile emulation can reset headless pointer preferences.
  // Use a fresh desktop target before any screenshot or touch emulation in it.
  const originalSession = sessionId;
  const {targetId} = await cdp("Target.createTarget", {url:"about:blank",newWindow:true,width:1440,height:1000}, false);
  try {
    ({sessionId} = await cdp("Target.attachToTarget", {targetId,flatten:true}, false));
    await cdp("Page.enable"); await cdp("Runtime.enable");
    await cdp("Page.navigate", {url:"http://127.0.0.1:5173/deals"});
    for (const label of [`Open saved version ${id}`, `Create revision from version ${id}`]) {
      const action = inputByAria(label);
      await until(`Boolean(${action})`);
      assert.ok(await evaluate("matchMedia('(hover: hover)').matches"), "Fresh desktop must support hover");
      await cdp("Input.dispatchMouseEvent", {type:"mouseMoved",x:0,y:0});
      await pause(200);
      await expectLinkStyle(action, "rgb(255 255 255 / 0.7)", true);
      await evaluate(`(${action}).scrollIntoView({block:'center'})`);
      const point = await measure(`(()=>{const r=(${action}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await cdp("Input.dispatchMouseEvent", {type:"mouseMoved",pointerType:"mouse",...point});
      await until(`(${action}).matches(':hover')`);
      await pause(200);
      await expectLinkStyle(action, "rgb(255 255 255 / 0.8)", true);
    }
    await cdp("Page.addScriptToEvaluateOnNewDocument", {source:noDraftSource});
    await cdp("Page.reload");
    const row = `(${inputByAria(`Open saved version ${id}`)})?.closest('[data-saved-version]')`;
    const reason = `Array.from((${row})?.querySelectorAll('span') ?? []).find(e=>e.textContent.trim()==='Create revision (unavailable: no saved inputs)')`;
    await until(`Boolean(${reason})`);
    await cdp("Input.dispatchMouseEvent", {type:"mouseMoved",x:0,y:0});
    await pause(200);
    await expectLinkStyle(reason, "rgb(255 255 255 / 0.6)", "none");
    await evaluate(`(${reason}).scrollIntoView({block:'center',inline:'nearest'})`);
    const point = await measure(`(()=>{const r=(${reason}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await cdp("Input.dispatchMouseEvent", {type:"mouseMoved",pointerType:"mouse",...point});
    await until(`(${reason}).matches(':hover')`);
    await pause(200);
    await expectLinkStyle(reason, "rgb(255 255 255 / 0.6)", "none");
  } finally {
    await cdp("Target.closeTarget", {targetId}, false);
    sessionId = originalSession;
    await cdp("Page.bringToFront");
  }
}
async function toggle(label) { assert.ok(await evaluate(visible(inputByAria(label)))); await evaluate(`(${inputByAria(label)}).click()`); }
async function resumeSaved(id) {
  await cdp("Page.navigate", { url: `http://127.0.0.1:5173/deal/${id}` });
  await click("a", "Create revision");
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
  if (name !== "failure.png") {
    await requireFonts();
    assert.ok(await evaluate('innerWidth !== 390 || document.documentElement.scrollWidth <= innerWidth'), `${name}: page must fit the 390px viewport`);
  }
  const { cssContentSize } = await cdp("Page.getLayoutMetrics");
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
  writeFileSync(join(artifacts, name), Buffer.from(data, "base64"));
}

try {
  writeFileSync(join(temp, "fixture.py"), `import os\nos.environ['DATABASE_URL'] = ${JSON.stringify(`sqlite:///${temp}/fixture.db`)}\nos.environ['CLERK_JWKS_URL'] = ''\nfrom app.main import app\nfrom app.auth import get_current_user_id\nfrom fastapi import Header\ndef fixture_owner(authorization: str = Header(default='Bearer browser-fixture')):\n    return authorization.removeprefix('Bearer ')\napp.dependency_overrides[get_current_user_id] = fixture_owner\n${photoBackendFixture}`);
  // Signed-out selection exists only in this temporary fixture, never in production.
  writeFileSync(join(temp, "clerk.ts"), `import {useSyncExternalStore} from 'react';const signedIn=!new URLSearchParams(location.search).has('fixtureSignedOut');let state={isSignedIn:signedIn,isLoaded:!new URLSearchParams(location.search).has('fixtureAuthLoading'),userId:signedIn?'browser-fixture':null};const listeners=new Set();window.switchFixtureUser=userId=>{state={isSignedIn:Boolean(userId),isLoaded:true,userId};listeners.forEach(fn=>fn());};const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};const getToken=async()=>{const user=state.userId;const fixture=window.authFixture;if(fixture){fixture.calls++;await new Promise(resolve=>setTimeout(resolve,fixture.delayMs));}return user;};export const useAuth=()=>({...useSyncExternalStore(subscribe,()=>state),getToken});export const SignedIn=({children})=>useAuth().isSignedIn?children:null;export const SignedOut=({children})=>useAuth().isSignedIn?null:children;export const ClerkProvider=({children})=>children;export const UserButton=()=>null;export const SignInButton=({children})=>children;export const SignUpButton=({children})=>children;`);
  writeFileSync(join(temp, "vite.mjs"), `import base from ${JSON.stringify(join(root, "vite.config.ts"))};export default {...base,root:${JSON.stringify(root)},resolve:{alias:{'@clerk/clerk-react':${JSON.stringify(join(temp, "clerk.ts"))}}},server:{host:'127.0.0.1',port:5173,strictPort:true,fs:{allow:[${JSON.stringify(root)},${JSON.stringify(temp)}]}}};`);
  start(process.env.PYTHON ?? "python", ["-m", "uvicorn", "fixture:app", "--host", "127.0.0.1", "--port", "8000"], { PYTHONPATH: `${backend}:${temp}` });
  start(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--config", join(temp, "vite.mjs"), "--configLoader", "native"], { VITE_API_BASE_URL: "http://127.0.0.1:8000" });
  await Promise.all([ready("http://127.0.0.1:8000/api/health"), ready("http://127.0.0.1:5173/")]);
  start(process.env.CHROME_BIN ?? "google-chrome", ["--headless=new", "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--remote-debugging-port=9222", `--user-data-dir=${temp}/chrome`, "about:blank"]);
  const version = JSON.parse(await ready("http://127.0.0.1:9222/json/version"));
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { const waiter = pending.get(msg.id); if (!waiter) return; pending.delete(msg.id); msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(msg.params.exceptionDetails));
    if (msg.method === "Network.requestWillBeSent" && new URL(msg.params.request.url).origin === "http://127.0.0.1:8000") {
      browserApiRequests.push(msg.params.request.url);
      if (!["GET", "HEAD", "OPTIONS"].includes(msg.params.request.method)) browserApiWrites.push({url:msg.params.request.url,method:msg.params.request.method});
    }
  };
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" }, false);
  ({ sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true }, false));
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const beforeSample = await api("/api/deals");
  await cdp("Page.navigate", { url: "http://127.0.0.1:5173/?fixtureSignedOut=1" });
  await until(`Boolean(document.querySelector('section[aria-label="Sample deal"]'))`);
  assert.ok(await measure(`(()=>{const button=document.querySelector('[data-hero-analyze]');const sample=document.querySelector('section[aria-label="Sample deal"]');return button.textContent==='Analyze your own deal' && button.getBoundingClientRect().bottom < sample.getBoundingClientRect().top && button.getBoundingClientRect().bottom < innerHeight;})()`));
  await evaluate(`document.querySelector('[data-hero-analyze]').focus()`);
  assert.ok(await evaluate(`document.activeElement.matches('[data-hero-analyze]')`));
  const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  const metric = key => `document.querySelector('[data-sample-metric="${key}"]')?.textContent`;
  assert.equal(await evaluate(metric("max_safe_offer")), "$139,000");
  assert.equal(await evaluate(`(${inputByAria(SAMPLE_SCENARIOS[1].label)}).getAttribute('aria-pressed')`), "true");
  for (const scenario of SAMPLE_SCENARIOS) {
    const response = await fetch("http://127.0.0.1:8000/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scenario.input) });
    assert.equal(response.status, 200);
    const canonical = await response.json();
    for (const [key, expected] of Object.entries(scenario.result)) assert.equal(canonical[key], expected, `${scenario.id}: preset differs from engine`);
    await toggle(scenario.label);
    await until(`${metric("max_safe_offer")} === ${JSON.stringify(money(canonical.max_safe_offer))}`);
    assert.equal(await evaluate(metric("net_profit")), money(canonical.net_profit));
    assert.equal(await evaluate(`(${inputByAria(scenario.label)}).getAttribute('aria-pressed')`), "true");
    const offerChart = await measure(`(()=>{const figure=document.querySelector('figure[aria-labelledby="sample-offer-caption"]');return {caption:document.getElementById(figure.getAttribute('aria-labelledby')).textContent,text:figure.textContent,rows:Array.from(figure.querySelectorAll('[data-sample-offer-row]')).map(row=>{const bar=row.querySelector('[data-sample-offer-bar]');const marker=row.querySelector('[data-sample-purchase-marker]');return {text:row.textContent,width:bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width,marker:parseFloat(marker.style.left),hidden:bar.parentElement.getAttribute('aria-hidden')};})};})()`);
    assert.equal(offerChart.caption, "Modeled offer comparison");
    assert.ok(offerChart.text.includes(`Dashed marker: ${money(scenario.input.purchase_price)} purchase price`));
    assert.ok(offerChart.rows[0].text.includes(money(SAMPLE_SCENARIOS[0].result.max_safe_offer)));
    assert.ok(offerChart.rows[1].text.includes(`Selected: ${scenario.label}`));
    assert.ok(offerChart.rows[1].text.includes(money(canonical.max_safe_offer)));
    for (const [index, row] of offerChart.rows.entries()) {
      const offer = index === 0 ? SAMPLE_SCENARIOS[0].result.max_safe_offer : canonical.max_safe_offer;
      assert.ok(Math.abs(row.width - offer / 180000) < 0.001, "Bar must use the fixed zero-based scale");
      assert.ok(Math.abs(row.marker - scenario.input.purchase_price / 180000 * 100) < 0.001);
      assert.equal(row.hidden, "true", "Text carries the chart values, decorative bars are hidden from assistive technology");
    }
    if (scenario.id !== "estimate") assert.ok(await evaluate(`document.querySelector('#sample-deal-results').textContent.includes(${JSON.stringify(`${money(scenario.input.purchase_price - canonical.max_safe_offer)} above the modeled offer ceiling`)})`));
  }
  checks.push("All three signed-out presets match the real API; labeled offer bars share a fixed zero-based scale and purchase marker; hero CTA is visible and focusable");
  assert.equal(await evaluate(`Boolean(${byText("button", "Generate Investor Memo")})`), false);
  await click("summary", "Sample assumptions and limits");
  assert.ok(await evaluate(`document.querySelector('section[aria-label="Sample deal"] details').open`));
  assert.ok(await evaluate(`document.querySelector('section[aria-label="Sample deal"]').textContent.includes('Fictional deal')`));
  assert.ok(await evaluate(`document.querySelector('section[aria-label="Sample deal"]').textContent.includes('Taxes, insurance, utilities, lender fees and draw timing are not separately modeled.')`));
  await screenshot("sample-desktop.png");
  await linkRenderPair("links-public-1440");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await measure("document.documentElement.scrollWidth > innerWidth"), false);
  await screenshot("sample-mobile.png");
  await linkRenderPair("links-public-390");
  await cdp("Page.reload");
  await until(`${metric("max_safe_offer")} === '$139,000'`);
  await cdp("Page.bringToFront");
  await evaluate(`(${inputByAria(SAMPLE_SCENARIOS[0].label)}).focus()`);
  assert.ok(await evaluate(`document.activeElement === (${inputByAria(SAMPLE_SCENARIOS[0].label)})`));
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " ", text: "\r", unmodifiedText: "\r" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await until(`${metric("max_safe_offer")} === '$155,600'`);
  checks.push("Sample fits mobile, defaults and resets to the higher quote, and supports keyboard selection of the original estimate");
  assert.deepEqual(browserApiRequests, [], "Public sample must not call the backend");
  assert.deepEqual(await api("/api/deals"), beforeSample);
  checks.push("Signed-out sample makes no browser API requests or saved-record changes");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: "http://127.0.0.1:5173/" });
  await until(`Boolean(${byText("button", "Analyze without address lookup ↓")})`);
  console.log("SITE_FONTS", JSON.stringify(await requireFonts()));
  const railSteps = [
    ["Property", "Address or listing URL"],
    ["Photos / Rehab Intelligence", "Estimate visible scope"],
    ["Deal Assumptions", "Numbers, financing, criteria"],
    ["Generate Investor Memo", "Run the underwriting"],
    ["Investor Memo Results", "Verdict, offer, risk"],
  ];
  for (const width of [390, 768, 1024, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    const rail = await measure(`(()=>{
      const panel=(${byText("div", "Underwriting Flow")}).parentElement;
      const list=panel.querySelector('ol'), rows=[...list.children], box=panel.getBoundingClientRect();
      const inside=r=>r.left>=box.left && r.right<=box.right;
      return {
        panelStyled:panel.classList.contains('ff-panel'),
        noScroll:panel.scrollWidth<=panel.clientWidth && list.scrollWidth<=list.clientWidth && document.documentElement.scrollWidth<=innerWidth,
        lastInside:rows.at(-1).getBoundingClientRect().right<=box.right,
        interactive:panel.querySelectorAll('a,button,input,select,[tabindex]').length,
        steps:rows.map(row=>{
          const content=row.firstElementChild, heading=content.firstElementChild;
          const [number,label]=heading.children, hint=content.lastElementChild;
          const n=number.getBoundingClientRect(), r=row.getBoundingClientRect();
          const textFits=e=>{
            const range=document.createRange();range.selectNodeContents(e);
            return [...range.getClientRects()].every(t=>inside(t) && t.left>=r.left && t.right<=r.right && t.left>=n.right);
          };
          const connector=row.querySelector('[aria-hidden="true"]');
          return {tag:row.tagName,number:number.textContent,label:label.textContent,hint:hint.textContent,
            numberStyled:number.classList.contains('ff-step'),fits:inside(r)&&textFits(label)&&textFits(hint),
            left:r.left,top:r.top,bottom:r.bottom,
            connectorVisible:Boolean(connector && getComputedStyle(connector).display!=='none')};
        })
      };
    })()`);
    assert.ok(rail.panelStyled && rail.noScroll && rail.lastInside, `Rail must fit at ${width}: ${JSON.stringify(rail)}`);
    assert.equal(rail.interactive, 0, "Rail stays presentational, not a stepper");
    assert.equal(rail.steps.length, 5);
    rail.steps.forEach((step, i)=>{
      assert.equal(step.tag, "LI");
      assert.equal(step.number, String(i+1));
      assert.deepEqual([step.label,step.hint], railSteps[i], "Every label and hint stays verbatim");
      assert.ok(step.numberStyled && step.fits, `Step ${i+1} text fits without overlap at ${width}`);
      assert.equal(step.connectorVisible, width>=1024 && i<4);
      if(i && width<1024) {
        assert.equal(step.left, rail.steps[0].left);
        assert.ok(step.top>=rail.steps[i-1].bottom, "Stacked steps must not overlap");
      } else if(i) {
        assert.equal(step.top, rail.steps[0].top);
        assert.ok(step.left>rail.steps[i-1].left, "Wide rail keeps its left-to-right order");
      }
    });
    await screenshot(`workflow-rail-${width}.png`);
    checks.push(`Workflow rail preserves all five ordered labels/hints and dark styling without horizontal scroll or text overlap at ${width}px`);
  }
  for (const width of [390, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await screenshot(`analyzer-hero-${width}.png`);
  }
  await click("button", "Analyze without address lookup ↓");
  assert.equal(await evaluate(`Boolean(document.querySelector('section[aria-label="Sample deal"]'))`), false);
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
  for (const width of [390, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await expectLinkStyle(byText("a", "View saved version →"), "var(--color-emerald-400)");
    await linkRenderPair(`links-saved-analyzer-${width}`);
  }

  await click("a", "View saved version →"); await until(`Boolean(${byText("a", "Create revision")})`);
  await cdp("Page.reload"); await until(`Boolean(${byText("a", "Create revision")})`);
  await until(`Boolean(${scopeInput("Unit cost 1")})`);
  assert.equal(await evaluate(`(${scopeInput("Unit cost 1")}).value`), "50000");
  checks.push("Scope persists through saved-deal reload");
  await click("a", "Create revision");
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
  assert.equal(await measure("document.documentElement.scrollWidth > innerWidth"), false);
  await click("a", "Create revision");
  await until(`location.pathname === '/' && Boolean(${scopeInput("Unit cost 1")}) && !(${scopeInput("Unit cost 1")}).matches(':disabled')`); await until(`Boolean(${scopeInput("Unit cost 1")})`);
  assert.equal(await evaluate(`(${scopeInput("Unit cost 1")}).value`), "67000");
  await screenshot("mobile-editor.png");
  assert.equal(await measure("document.documentElement.scrollWidth > innerWidth"), false);
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
  assert.equal(await measure("document.documentElement.scrollWidth > innerWidth"), false);
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
  await expectLinkStyle(byText("a", `baseline #${baseline.id}`), "var(--color-amber-200)", true);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Bid comparison"]').textContent.includes('Create a revision from baseline #${baseline.id}')`));

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
  assert.equal(await measure("document.documentElement.scrollWidth > innerWidth"), false);
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
  assert.equal(await measure("document.documentElement.scrollWidth > innerWidth"), false);
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
  const longRevisionNote = ("Selected Bid B; quote date reconfirmed.\nKeep the original version unchanged.\n".repeat(30)).slice(0, 2000);
  const selected = await saveRevision(longRevisionNote);
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
  assert.ok(await evaluate(`document.querySelector('[aria-label="Bid comparison"]').textContent.includes('Create a revision from baseline #${selected.id}')`));
  checks.push("A quoted revision can explicitly start a new baseline before it has any quoted children");
  const recordsBeforeList = await api("/api/deals");
  await cdp("Page.navigate", { url: "http://127.0.0.1:5173/deals" });
  await until(`Boolean(${inputByAria(`Create revision from version ${selected.id}`)})`);
  assert.equal(await evaluate(`document.body.textContent.includes('Sign in to view yours')`), false);
  assert.ok(await evaluate(`document.body.textContent.includes('Annualized ROI')`));
  assert.ok(await evaluate(`document.body.textContent.includes('Untitled deal #${first.id}')`));
  const requestsBeforeComparison = browserApiRequests.length;
  // Cross the exact card/table boundary in both directions without losing selection.
  for (const width of [1279, 1280]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 1279 });
    const control = inputByAria(`Compare version #${first.id}`);
    assert.ok(await evaluate(visible(control)));
    assert.equal(await evaluate(`(${control}).closest('[data-saved-version]').tagName`), width === 1279 ? "LI" : "TR");
    assert.equal(await measure(`Array.from(document.querySelectorAll('input[type=checkbox]')).filter(e=>(e.getAttribute('aria-label') ?? e.closest('label')?.textContent.trim()) === 'Compare version #${first.id}' && e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0).length`), 1);
    assert.equal(await evaluate(`(${control}).getAttribute('aria-label') ?? (${control}).closest('label')?.textContent.trim()`), `Compare version #${first.id}`);
    if (width === 1279) assert.equal(await evaluate(`(${control}).hasAttribute('aria-label')`), false);
    assert.equal(await evaluate(`(${control}).checked`), width === 1280);
    await clickVisible(control);
    await until(`(${control}).checked === ${width === 1279}`);
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1279, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`(${inputByAria(`Compare version #${first.id}`)}).checked`), false);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`(${inputByAria(`Compare version #${first.id}`)}).checked`), false);
  for (const label of ['Est. profit', 'Annualized ROI', 'Verdict', 'Max offer', 'Date']) {
    assert.ok(await measure(`Array.from(document.querySelectorAll('[aria-label="Saved deal cards"] dt')).some(e=>e.textContent===${JSON.stringify(label)} && e.getBoundingClientRect().width>0)`));
  }
  assert.ok(await measure(`Array.from(document.querySelectorAll('p')).some(e=>e.textContent.includes('it is not a guaranteed return') && e.getBoundingClientRect().height>0)`));
  for (const label of [`Open saved version ${selected.id}`, `Create revision from version ${selected.id}`, `Compare version #${selected.id}`]) {
    const control = inputByAria(label);
    assert.ok(await evaluate(visible(control)));
    assert.ok(await measure(`(()=>{const e=${control};const r=(e.type==='checkbox'?e.closest('label'):e).getBoundingClientRect();return r.width>=44 && r.height>=44 && r.left>=0 && r.right<=innerWidth;})()`));
  }
  assert.deepEqual(await evaluate(`Array.from((${inputByAria(`Compare version #${first.id}`)}).closest('li').querySelectorAll('dd')).slice(0,4).map(e=>e.textContent)`), ["$34,900", `${(first.analysis_result.annualized_roi * 100).toFixed(1)}%`, "BUY", "$155,600"]);
  checks.push("Visible mobile and desktop controls share selection across resizing; cards label all metrics, preserve the ROI disclaimer and provide 44px tap areas");

  const comparison = `document.querySelector('section[aria-label="Saved deal comparison"]')`;
  await toggle(`Compare version #${first.id}`);
  assert.equal(await evaluate(`Boolean(${comparison})`), false);
  await toggle(`Compare version #${second.id}`);
  await until(`Boolean(${comparison})`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-comparison-metric="net_profit"] td')).map(cell=>cell.textContent)`), ["$34,900", "$13,880"]);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-comparison-metric="max_safe_offer"] td')).map(cell=>cell.textContent)`), ["$155,600", "$136,200"]);
  assert.ok(await evaluate(`${comparison}.textContent.includes('Holding period: different')`));
  await toggle(`Compare version #${third.id}`);
  assert.ok(await evaluate(`(${inputByAria(`Compare version #${baseline.id}`)}).disabled`));
  assert.equal(await evaluate(`(${inputByAria(`Compare version #${first.id}`)}).disabled`), false);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await screenshot("comparison-desktop.png");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await measure("document.documentElement.scrollWidth <= innerWidth"));
  await screenshot("comparison-mobile.png");
  console.log("COMPARISON_MOBILE_GEOMETRY", JSON.stringify(await measure(`Array.from(${comparison}.querySelectorAll('*')).filter(e=>getComputedStyle(e).overflowX==='auto').map(e=>({clientWidth:e.clientWidth,scrollWidth:e.scrollWidth}))`)));
  await toggle(`Compare version #${second.id}`);
  assert.equal(await evaluate(`(${inputByAria(`Compare version #${baseline.id}`)}).disabled`), false);
  assert.equal(await evaluate(`(${inputByAria(`Open compared version ${third.id}`)}).getAttribute('href')`), `/deal/${third.id}`);
  await click("button", "Clear comparison");
  assert.equal(await evaluate(`Boolean(${comparison})`), false);
  await evaluate(`(${inputByAria(`Compare version #${first.id}`)}).focus()`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  assert.ok(await evaluate(`(${inputByAria(`Compare version #${first.id}`)}).checked`));
  assert.equal(browserApiRequests.length, requestsBeforeComparison, "Comparison must not issue API requests");
  assert.deepEqual(await api("/api/deals"), recordsBeforeList);
  const comparisonDocumentTime = await evaluate("performance.timeOrigin");
  await cdp("Page.reload");
  await until(`performance.timeOrigin !== ${comparisonDocumentTime} && Boolean(${inputByAria(`Compare version #${first.id}`)})`);
  assert.equal(await evaluate(`(${inputByAria(`Compare version #${first.id}`)}).checked`), false);
  checks.push("Saved-deal comparison shows exact saved economics, flags different assumptions, limits selection to three, supports keyboard and mobile, clears on reload, and never requests or writes data");
  const selectedRow = `(${inputByAria(`Create revision from version ${selected.id}`)}).closest('[data-saved-version]')`;
  assert.ok(await evaluate(`(${selectedRow}).textContent.includes(${JSON.stringify(selected.revision_note)})`));
  assert.equal(await evaluate(`(${selectedRow}).querySelector('a[href="/deal/${bidB.id}"]').textContent`), `#${bidB.id}`);
  assert.equal(await evaluate(`(${selectedRow}).querySelector('a[href="/deal/${bidB.id}"]').getAttribute('aria-label')`), `Open version #${bidB.id}, the version this was revised from`);
  const noteButton = `(${selectedRow}).querySelector('button[aria-controls]')`;
  const noteElement = `document.getElementById((${noteButton}).getAttribute('aria-controls'))`;
  const requestsBeforeNotes = browserApiRequests.length;
  assert.equal(selected.revision_note.length, 2000);
  for (const width of [1440, 390]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await until(`Boolean(${noteButton})`);
    assert.ok(await evaluate(visible(noteButton)));
    assert.equal(await evaluate(`(${noteButton}).getAttribute('aria-expanded')`), "false");
    assert.equal(await evaluate(`getComputedStyle(${noteElement}).whiteSpace`), "pre-line");
    assert.ok(await measure(`(${noteElement}).clientHeight <= parseFloat(getComputedStyle(${noteElement}).lineHeight) * 2 + 1`));
    assert.equal(await evaluate(`(${inputByAria(`Create revision from version ${second.id}`)}).closest('[data-saved-version]').querySelector('button[aria-controls]')`), null);
    assert.ok(await measure(`document.documentElement.scrollWidth <= innerWidth`));
    await screenshot(`saved-deals-${width}.png`);
    await linkRenderPair(`links-deals-${width}`);
    await expectLinkStyle(`(${selectedRow}).querySelector('a[aria-label^="Open version"]')`, "rgb(255 255 255 / 0.6)", true);
    const action = inputByAria(`Create revision from version ${selected.id}`);
    await cdp("Input.dispatchMouseEvent", {type:"mouseMoved",x:0,y:0});
    await pause(200);
    await expectLinkStyle(action, width === 390 ? "#E8C547" : "rgb(255 255 255 / 0.7)", width !== 390);
    await expectLinkStyle(inputByAria(`Open saved version ${selected.id}`), width === 390 ? "#E8C547" : "rgb(255 255 255 / 0.7)", width !== 390);

    await evaluate(`(${noteButton}).focus()`);
    assert.ok(await evaluate(`document.activeElement === (${noteButton})`));
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await until(`(${noteButton}).getAttribute('aria-expanded') === 'true'`);
    assert.equal(await evaluate(`(${noteElement}).textContent`), longRevisionNote);
    assert.equal(await evaluate(`getComputedStyle(${noteElement}).whiteSpace`), "pre-line");
    assert.ok(await measure(`(${noteElement}).clientHeight >= (${noteElement}).scrollHeight - 1`));
    await screenshot(`saved-deals-expanded-${width}.png`);
    await clickVisible(noteButton);
    await until(`(${noteButton}).getAttribute('aria-expanded') === 'false'`);
  }
  assert.equal(browserApiRequests.length, requestsBeforeNotes, "Note expansion must not issue API requests");
  checks.push("A 2,000-character multiline note preserves line breaks, expands by keyboard and collapses at both widths; short notes have no toggle and parent links describe lineage");
  for (const width of [390, 768, 1023, 1024, 1279, 1280, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await cdp("Page.navigate", { url: "http://127.0.0.1:5173/deals" });
    await until(`Boolean(${inputByAria(`Open saved version ${selected.id}`)})`);
    await clickVisible(inputByAria(`Open saved version ${selected.id}`));
    await until(`(${scopeInput("Quote date 1")})?.value === '2026-09-12'`);
    await screenshot(`saved-deal-${width}.png`);
    await linkRenderPair(`links-detail-${width}`);
    await expectLinkStyle(byText("a", "Create revision"), "#E8C547");
    await expectLinkStyle(byText("a", "← My Deals"), "rgb(255 255 255 / 0.6)");

    await cdp("Page.navigate", { url: "http://127.0.0.1:5173/deals" });
    await until(`Boolean(${inputByAria(`Create revision from version ${selected.id}`)})`);
    await clickVisible(inputByAria(`Create revision from version ${selected.id}`));
    await until(`location.pathname === '/' && (${scopeInput("Quote date 1")})?.value === '2026-09-12' && !(${scopeInput("Unit cost 1")}).matches(':disabled')`);
    assert.equal(await evaluate(`(${scopeInput("Source 1")}).value`), "Builder B fixture");
    assert.deepEqual(await api("/api/deals"), recordsBeforeList);
  }
  checks.push("Computed link colors, desktop hover, parent/baseline underlines, gold actions and back-link contrast styles match the intended utilities; public, list, detail and saved-analyzer before/after renders captured");
  checks.push("Pointer clicks on visible Open and Create revision controls work at 390/768/1023/1024/1279/1280/1440 without changing saved data");
  await cdp("Page.navigate", { url: `http://127.0.0.1:5173/deal/${selected.id}` });
  await until(`(${scopeInput("Quote date 1")})?.value === '2026-09-12'`);
  // Test-only read fixture for a legacy saved record with no draft inputs.
  const longAddress = '12345 North Peachtree Industrial Boulevard, Building Twelve, Upper Courtyard Residence, Suite 987, Historic Chattahoochee Riverside Estates and Gardens, Sandy Springs, Fulton County, Georgia 30350, United States of America';
  const noDraftSource = `
    const nativeFetch = window.fetch.bind(window);
    const fixtureDraft = record => {
      const mode = new URLSearchParams(location.search).get('draftFixture');
      return mode === 'valid' ? record.draft_input : mode === 'object' ? {} : mode === 'string' ? 'invalid' : mode === 'array' ? [] : mode === 'present' ? {purchase_price:null} : null;
    };
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      if (new URL(args[0], location.href).pathname === '/api/deals' && response.ok) {
        const records = await response.json();
        return new Response(JSON.stringify(records.map(record=>record.id===${selected.id}?{...record,draft_input:fixtureDraft(record),address:${JSON.stringify(longAddress)},created_at:"2026-09-28T12:00:00Z",analysis_result:new URLSearchParams(location.search).get('layoutFixture') === 'wide' ? {...record.analysis_result,overall_verdict:"CONDITIONAL",net_profit:-123456,max_safe_offer:1234567} : record.analysis_result}:record)), {status:200,headers:{'Content-Type':'application/json'}});
      }
      if (new URL(args[0], location.href).pathname === '/api/deals/${selected.id}' && response.ok) {
        const record = await response.json();
        return new Response(JSON.stringify({...record, draft_input: fixtureDraft(record)}), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      return response;
    };
  `;
  await verifyDesktopHover(selected.id, noDraftSource);
  const { identifier: noDraftFixture } = await cdp("Page.addScriptToEvaluateOnNewDocument", {source:noDraftSource});
  for (const width of [390, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    for (const mode of ['null', 'object', 'string', 'array', 'present', 'valid']) {
      const writesBeforeDetailCase = browserApiWrites.length;
      await cdp("Page.navigate", { url: `http://127.0.0.1:5173/deal/${selected.id}?draftFixture=${mode}` });
      await until(`Boolean(${byText("button", "Lender Report")}) && (${scopeInput("Quote date 1")})?.value === '2026-09-12'`);
      const allowed = mode === 'present' || mode === 'valid';
      const revision = byText("a", "Create revision");
      const reason = byText("span", "Create revision (unavailable: no saved inputs)");
      assert.equal(await evaluate(`Boolean(${revision})`), allowed, `Detail guard mode ${mode} at ${width}`);
      assert.equal(await evaluate(`Boolean(${reason})`), !allowed);
      // The existing PDF summary still renders the same safe fallbacks.
      for (const [label, field] of [['Purchase Price', 'purchase_price'], ['ARV', 'arv'], ['Rehab Budget', 'rehab_budget'], ['Est. Monthly Rent', 'est_monthly_rent']]) {
        const value = mode === 'valid' ? selected.draft_input[field]?.value : null;
        const expected = value == null ? '—' : `$${value.toLocaleString('en-US', {maximumFractionDigits:0})}`;
        assert.equal(await evaluate(`(${byText("div", label)}).nextElementSibling.textContent`), expected);
      }
      assert.ok(await evaluate(visible(byText("button", "Lender Report"))));
      assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'));
      if (!allowed) {
        assert.ok(await evaluate(visible(reason)));
        assert.ok(await evaluate(`(()=>{const e=${reason};return e.tagName==='SPAN' && !e.hasAttribute('href') && !e.hasAttribute('tabindex') && e.tabIndex<0;})()`));
        if (mode === 'null' || mode === 'object') await screenshot(`detail-guard-${mode}-${width}.png`);
      } else {
        // Capture the payload before the analyzer consumes and clears router state.
        await evaluate(`(()=>{const push=history.pushState.bind(history);history.pushState=(state,...args)=>{window.detailResumeState=structuredClone(state?.usr);return push(state,...args);};})()`);
        await clickVisible(revision);
        await until(`location.pathname === '/' && (${scopeInput("Quote date 1")})?.value === '2026-09-12' && !(${scopeInput("Unit cost 1")}).matches(':disabled')`);
        assert.equal(await evaluate(`(${labelInput("Purchase Price")}).value`), mode === 'present' ? '' : String(selected.draft_input.purchase_price.value));
        assert.equal(await evaluate(`(${scopeInput("Source 1")}).value`), 'Builder B fixture');
        assert.equal(await evaluate('window.detailResumeState.resumeDeal.id'), selected.id);
        assert.deepEqual(await evaluate('window.detailResumeState.resumeDraft'), mode === 'present' ? {purchase_price:null} : selected.draft_input);
        if (mode === 'present') {
          await screenshot(`detail-guard-present-resumed-${width}.png`);
          await fill(labelInput('Purchase Price'), '150000');
          await fill(labelInput('ARV'), '270000');
          // Restored itemized scope owns the read-only rehab total; edit it through its control.
          await scoped('Unit cost 1', '19000');
          assert.ok(Number(await evaluate(`(${labelInput('Rehab Budget')}).value`)) > 0);
          assert.equal(await evaluate(`(${labelInput('Est. Monthly Rent (optional)')}).value`), '');
          await clickVisible(byText('button', 'Generate Investor Memo'));
          await until(`Boolean(${byText('button', 'Save New Revision')})`);
          assert.equal(await evaluate("document.querySelector('[role=alert]')?.textContent ?? ''"), '');
          assert.equal(await evaluate("document.body.textContent.includes('Cannot read properties')"), false);
          assert.ok(await evaluate(visible(byText('button', 'Lender Report'))));
          await screenshot(`detail-guard-present-analyzed-${width}.png`);
        }
      }
      assert.deepEqual(await api('/api/deals'), recordsBeforeList);
      assert.deepEqual(browserApiWrites.slice(writesBeforeDetailCase), mode === 'present'
        ? [{url:'http://127.0.0.1:8000/api/finalize-and-analyze',method:'POST'}]
        : [], `Detail mode ${mode} permits only the explicit stateless analysis, never a saved write`);
    }
  }
  for (const width of [390, 768, 1023, 1024, 1279, 1280, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    for (const mode of ['null', 'object', 'string', 'array']) {
      await cdp("Page.navigate", { url: `http://127.0.0.1:5173/deals?draftFixture=${mode}` });
      await until(`Boolean(${inputByAria(`Open saved version ${selected.id}`)})`);
      const row = `(${inputByAria(`Open saved version ${selected.id}`)}).closest('[data-saved-version]')`;
      const reason = `Array.from((${row}).querySelectorAll('span')).find(e=>e.textContent.trim()==='Create revision (unavailable: no saved inputs)')`;
      console.log("LAYOUT_FONTS", JSON.stringify(await requireFonts()));
      assert.ok(await evaluate(visible(reason)));
      assert.equal(await evaluate(`(${row}).querySelector('a[aria-label="Create revision from version ${selected.id}"]')`), null);
      assert.ok(await evaluate(`(()=>{const e=${reason};return e.tagName==='SPAN' && !e.hasAttribute('href') && !e.hasAttribute('tabindex') && e.tabIndex<0;})()`));
      await cdp("Input.dispatchMouseEvent", {type:"mouseMoved",x:0,y:0});
      await pause(200);
      await expectLinkStyle(reason, "rgb(255 255 255 / 0.6)", "none");
      await expectLinkStyle(inputByAria(`Open saved version ${selected.id}`), width < 1280 ? "#E8C547" : "rgb(255 255 255 / 0.7)", width >= 1280);
      if (mode === 'null') {
        const address = `(${row}).querySelector('[title]')`;
        const addressLayout = await measure(`(()=>{const e=${address},s=getComputedStyle(e),r=document.createRange();r.selectNodeContents(e);return {text:e.textContent,title:e.title,whiteSpace:s.whiteSpace,textOverflow:s.textOverflow,overflowX:s.overflowX,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,lineCount:new Set([...r.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>Math.round(r.top))).size,rowTag:(${row}).tagName};})()`);
        assert.equal(addressLayout.text, longAddress);
        assert.equal(addressLayout.title, longAddress);
        assert.equal(addressLayout.rowTag, width < 1280 ? "LI" : "TR");
        if (width < 1280) {
          assert.equal(addressLayout.whiteSpace, "normal");
          assert.notEqual(addressLayout.textOverflow, "ellipsis");
          assert.ok(addressLayout.lineCount > 1, "Long card address must wrap onto multiple lines");
          assert.ok(addressLayout.scrollHeight <= addressLayout.clientHeight + 1, "Full card address must be visible");
          assert.ok(addressLayout.scrollWidth <= addressLayout.clientWidth + 1, "Card address must not overflow horizontally");
        } else {
          assert.equal(addressLayout.whiteSpace, "nowrap");
          assert.equal(addressLayout.textOverflow, "ellipsis");
          assert.equal(addressLayout.overflowX, "hidden");
          assert.ok(addressLayout.scrollWidth > addressLayout.clientWidth, "Table fixture must exercise real address truncation");
        }
        console.log("ADDRESS_LAYOUT", width, JSON.stringify(addressLayout));
        assert.ok(await measure("document.documentElement.scrollWidth <= innerWidth"), "Table scrolling must stay inside its wrapper");
        if (width >= 1280) {
          const date = `(${row}).cells[6]`;
          const layout = await measure(`(()=>{const e=${date},r=document.createRange();r.selectNodeContents(e);const lines=[...r.getClientRects()].filter(r=>r.width>0&&r.height>0);const wrapper=e.closest('table').parentElement;return {date:e.textContent.trim(),whiteSpace:getComputedStyle(e).whiteSpace,lineCount:new Set(lines.map(r=>Math.round(r.top))).size,clientWidth:wrapper.clientWidth,scrollWidth:wrapper.scrollWidth,overflowX:getComputedStyle(wrapper).overflowX};})()`);
          assert.equal(layout.date, "Sep 28, 2026");
          assert.equal(layout.whiteSpace, "nowrap");
          assert.equal(layout.lineCount, 1, "Long date must occupy exactly one rendered line");
          assert.equal(layout.overflowX, "auto");
          console.log("TABLE_LAYOUT", width, JSON.stringify(layout));
          assert.ok(layout.scrollWidth <= layout.clientWidth + 1, "Desktop table must fit its container at 1280/1440");
        }
        await screenshot(`unavailable-list-${width}.png`);
        await clickVisible(inputByAria(`Open saved version ${selected.id}`));
        await until(`document.body.textContent.includes('Create revision (unavailable: no saved inputs)')`);
        assert.equal(await evaluate('location.pathname'), `/deal/${selected.id}`);
      }
    }
    // Presence, not validity of the numeric value, matches the analyzer guard exactly.
    await cdp("Page.navigate", { url: "http://127.0.0.1:5173/deals?draftFixture=present" });
    await until(`Boolean(${inputByAria(`Create revision from version ${selected.id}`)})`);
    assert.ok(await evaluate(visible(inputByAria(`Create revision from version ${selected.id}`))));
  }
  // Both live actions and the longer unavailable label must fit with real fonts.
  for (const width of [1280, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height:1000, deviceScaleFactor:1, mobile:false });
    for (const mode of ['null', 'valid']) {
      const writesBeforeWideCase = browserApiWrites.length;
      await cdp("Page.navigate", { url:`http://127.0.0.1:5173/deals?layoutFixture=wide&draftFixture=${mode}` });
      await until(`Boolean(${inputByAria(`Open saved version ${selected.id}`)})`);
      console.log("LAYOUT_FONTS", JSON.stringify(await requireFonts()));
      const wideRow = `(${inputByAria(`Open saved version ${selected.id}`)}).closest('tr')`;
      await evaluate(`(${wideRow}).scrollIntoView({block:'center'})`);
      const layout = await measure(`(()=>{
        const row=${wideRow},table=row.closest('table'),wrapper=table.parentElement,wr=wrapper.getBoundingClientRect();
        const textBox=e=>{const range=document.createRange();range.selectNodeContents(e);const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0),cell=e.closest('td').getBoundingClientRect();return {text:e.textContent.trim(),lines:new Set(rects.map(r=>Math.round(r.top))).size,complete:rects.length>0&&rects.every(r=>r.left>=Math.max(cell.left,wr.left)-1&&r.right<=Math.min(cell.right,wr.right)+1&&r.top>=cell.top-1&&r.bottom<=cell.bottom+1),visible:rects.every(r=>r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight)};};
        const metrics=[2,3,5,6].map(i=>textBox(row.cells[i]));
        const actions=[...row.cells[7].querySelectorAll('a,span')].map(textBox);
        const clientWidth=wrapper.clientWidth,scrollWidth=wrapper.scrollWidth,scrollLeft=wrapper.scrollLeft;
        const oldWidth=table.style.width;let requiredWidth;
        try {table.style.width='min-content';requiredWidth=table.getBoundingClientRect().width;} finally {table.style.width=oldWidth;}
        return {metrics,actions,verdict:row.cells[4].textContent,clientWidth,scrollWidth,scrollLeft,requiredWidth,margin:clientWidth-requiredWidth,pageWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth};
      })()`);
      console.log("WORST_CASE_TABLE_LAYOUT", width, mode, JSON.stringify(layout));
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'Worst-case table must fit without horizontal scrolling');
      assert.equal(layout.scrollLeft, 0);
      assert.ok(layout.pageWidth <= layout.viewportWidth);
      assert.equal(layout.verdict, 'CONDITIONAL');
      assert.deepEqual(layout.metrics.map(m=>m.text), ['-$123,456', `${(selected.analysis_result.annualized_roi * 100).toFixed(1)}%`, '$1,234,567', 'Sep 28, 2026']);
      for (const metric of layout.metrics) {
        assert.equal(metric.lines, 1, 'Amounts and date must stay on one line');
        assert.ok(metric.complete && metric.visible, 'Amounts and date must be complete and unclipped');
      }
      assert.deepEqual(layout.actions.map(a=>a.text), ['Open', mode === 'valid' ? 'Create revision' : 'Create revision (unavailable: no saved inputs)']);
      assert.ok(layout.actions.every(a=>a.complete && a.visible), 'Every action or unavailable label must be visible without scrolling');
      const { data } = await cdp("Page.captureScreenshot", {format:'png',captureBeyondViewport:false});
      writeFileSync(join(artifacts, `worst-case-list-${width}-${mode}.png`), Buffer.from(data, 'base64'));
      assert.deepEqual(await api('/api/deals'), recordsBeforeList);
      assert.deepEqual(browserApiWrites.slice(writesBeforeWideCase), [], 'Table fit checks must not write');
    }
  }
  checks.push("Cards wrap full addresses below 1280; standard and worst-case tables fit at 1280/1440 with loaded JetBrains Mono, complete amounts, one-line dates, visible actions/unavailable text and no writes");
  checks.push("Both visible layouts reject null/malformed drafts with nonfocusable reason text, retain Open, and match the analyzer purchase_price presence check without writes");
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: noDraftFixture });
  checks.push("Detail guard matches list/analyzer for null, object, string, array and purchase_price presence; PDF details render, valid/present drafts resume at 390/1440, minimal drafts analyze with blank rent, only the expected stateless analysis POST occurs, and saved records remain unchanged");
  // Read-only money fixtures persist across the list's Open navigation in this document.
  const moneyCases = [[-123456, '-$123,456'], [123456, '$123,456'], [0, '$0'], [-0.4, '$0'], [-2.5, '-$3'], [null, '—']];
  const { identifier: moneyFixture } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    const index = new URLSearchParams(location.search).get('moneyFixture');
    if (index !== null) {
      const value = ${JSON.stringify(moneyCases.map(([value]) => value))}[Number(index)];
      const nativeFetch = window.fetch.bind(window);
      const withMoney = (record, isDetail = false) => record.id !== ${selected.id} ? record : {
        ...record,
        // Detail results require numeric offers; null coverage belongs to nullable draft fields.
        analysis_result: isDetail && value === null ? record.analysis_result : {...record.analysis_result, net_profit:value, max_safe_offer:value},
        draft_input: {...record.draft_input, ...Object.fromEntries(['purchase_price','arv','rehab_budget','est_monthly_rent'].map(field => [field, {...record.draft_input[field], value}]))}
      };
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        const path = new URL(args[0], location.href).pathname;
        if (response.ok && (path === '/api/deals' || path === '/api/deals/${selected.id}')) {
          const data = await response.json();
          return new Response(JSON.stringify(Array.isArray(data) ? data.map(record=>withMoney(record)) : withMoney(data, true)), {status:200,headers:{'Content-Type':'application/json'}});
        }
        return response;
      };
    }
  ` });
  for (const width of [390, 1280, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height:1000, deviceScaleFactor:1, mobile:width === 390 });
    for (const [index, [value, expected]] of moneyCases.entries()) {
      const writesBeforeMoneyCase = browserApiWrites.length;
      await cdp("Page.navigate", { url:`http://127.0.0.1:5173/deals?moneyFixture=${index}` });
      const open = inputByAria(`Open saved version ${selected.id}`);
      await until(`Boolean(${open})`);
      const row = `(${open}).closest('li,tr')`;
      const amounts = await evaluate(`(()=>{const r=${row};return r.tagName==='TR' ? [r.cells[2].textContent,r.cells[5].textContent] : ['Est. profit','Max offer'].map(label=>[...r.querySelectorAll('dt')].find(e=>e.textContent===label).nextElementSibling.textContent);})()`);
      assert.deepEqual(amounts, [expected, expected], `List money ${value} at ${width}`);
      assert.equal(await evaluate(`(${row}).textContent.includes('$-')`), false);
      if (index === 0) {
        await evaluate(`(${row}).scrollIntoView({block:'start'})`);
        const { data } = await cdp("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
        writeFileSync(join(artifacts, `negative-money-list-${width}.png`), Buffer.from(data, "base64"));
      }
      await clickVisible(open);
      await until(`Boolean(${byText('button', 'Lender Report')}) && (${scopeInput('Quote date 1')})?.value === '2026-09-12'`);
      assert.equal(await evaluate('location.pathname'), `/deal/${selected.id}`);
      for (const label of ['Purchase Price','ARV','Rehab Budget','Est. Monthly Rent','Max Safe Offer']) {
        const amount = `(${byText('div', label)}).nextElementSibling`;
        assert.ok(await evaluate(visible(amount)));
        const detailExpected = label === 'Max Safe Offer' && value === null ? money(selected.analysis_result.max_safe_offer) : expected;
        assert.equal(await evaluate(`(${amount}).textContent`), detailExpected, `Detail ${label} ${value} at ${width}`);
      }
      if (index === 0) {
        await evaluate('window.scrollTo(0,0)');
        const { data } = await cdp("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
        writeFileSync(join(artifacts, `negative-money-detail-${width}.png`), Buffer.from(data, "base64"));
      }
      assert.deepEqual(await api('/api/deals'), recordsBeforeList);
      assert.deepEqual(browserApiWrites.slice(writesBeforeMoneyCase), [], 'Money display checks must not write');
    }
  }
  await cdp("Page.removeScriptToEvaluateOnNewDocument", {identifier:moneyFixture});
  checks.push("List and detail format negative, positive, zero, rounded-zero, negative-half and missing money at 390/1280/1440; Open preserves the fixture, no API writes or saved-record changes");
  await cdp("Page.navigate", { url: "http://127.0.0.1:5173/deals" });
  await until(`Boolean(${inputByAria(`Create revision from version ${selected.id}`)})`);
  await clickVisible(inputByAria(`Create revision from version ${selected.id}`));
  await until(`location.pathname === '/' && (${scopeInput("Quote date 1")})?.value === '2026-09-12' && !(${scopeInput("Unit cost 1")}).matches(':disabled')`);
  assert.equal(await evaluate(`(${scopeInput("Source 1")}).value`), "Builder B fixture");
  assert.deepEqual(await api("/api/deals"), recordsBeforeList);
  checks.push("Saved Deals identifies versions and parents, labels annualized ROI, fits mobile, and opens/resumes the selected snapshot without writes");

  // Read/analysis response fixtures only: never persist synthetic metric values.
  const metricCases = [
    {name:'saved-decimals', fields:{net_profit:selected.analysis_result.net_profit, max_safe_offer:selected.analysis_result.max_safe_offer, total_project_cost:selected.analysis_result.total_project_cost}},
    {name:'wide-loss', fields:{net_profit:-123456, max_safe_offer:1234567, total_project_cost:1234567.875}},
    {name:'positive-half', fields:{net_profit:13880.5,max_safe_offer:1234567.875,total_project_cost:13880.5}, meta:{purchase_price:150000.5,arv:270000.5}, expected:{offer:'$1,234,568',cost:'$13,881',profit:'$13,881'}, locale:'de-DE'},
    {name:'negative-half', fields:{net_profit:-2.5,max_safe_offer:150000,total_project_cost:13880.5}, expected:{offer:'$150,000',cost:'$13,881',profit:'-$3'}},
    {name:'rounded-zero-over', fields:{net_profit:-0.4,max_safe_offer:149999.6,total_project_cost:-0.4}, expected:{offer:'$150,000',cost:'$0',profit:'$0',gap:'$0 over',callout:'$0 over',negotiate:'NEGOTIATE FIRST • $0 over MAO'}},
    {name:'rounded-zero-under', fields:{net_profit:-0.4,max_safe_offer:150000.4,total_project_cost:-0.4}, expected:{offer:'$150,000',cost:'$0',profit:'$0',gap:'$0 under',callout:'within $0',negotiate:null}},
    {name:'rounded-zero-offer', fields:{net_profit:-0.4,max_safe_offer:-0.4,total_project_cost:-0.4}, expected:{offer:'$0',cost:'$0',profit:'$0'}},
    {name:'zero', fields:{net_profit:0,max_safe_offer:150000,total_project_cost:0}, expected:{offer:'$150,000',cost:'$0',profit:'$0'}},
    {name:'missing', fields:{net_profit:null,max_safe_offer:150000,total_project_cost:null}, expected:{offer:'$150,000',cost:'—',profit:'—'}},
  ];
  const {identifier: metricFixture} = await cdp('Page.addScriptToEvaluateOnNewDocument', {source:`
    const metricIndex = new URLSearchParams(location.search).get('metricFixture');
    if (metricIndex !== null) {
      const fields = ${JSON.stringify(metricCases.map(c=>c.fields))}[Number(metricIndex)];
      const meta = ${JSON.stringify(metricCases.map(c=>c.meta ?? null))}[Number(metricIndex)];
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        const path = new URL(args[0], location.href).pathname;
        if (response.ok && (path === '/api/deals/${selected.id}' || path === '/api/finalize-and-analyze')) {
          const data = await response.json();
          const patched = path === '/api/finalize-and-analyze' ? {...data,...fields} : {...data,analysis_result:{...data.analysis_result,...fields}};
          if (meta && path !== '/api/finalize-and-analyze') {
            patched.draft_input = {...data.draft_input};
            for (const [key,value] of Object.entries(meta)) patched.draft_input[key] = {...data.draft_input[key],value};
          }
          return new Response(JSON.stringify(patched), {status:200,headers:{'Content-Type':'application/json'}});
        }
        return response;
      };
    }
  `});
  const offerSection = `(${byText('div','Offer Safety')}).closest('section')`;
  const offerElement = `(${offerSection}).querySelector('.ff-heading')`;
  const supportSection = `(${byText('div','Supporting Detail')}).nextElementSibling`;
  const decisionSection = `(${offerSection}).previousElementSibling`;
  const shieldGrid = `document.querySelector('button[title="Click to copy"]').parentElement`;
  const metricLayoutFailures = [];
  async function checkMetricLayout(page, width, fixture) {
    const layout = await measure(`(()=>{
      const rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom});
      const text=e=>{const range=document.createRange();range.selectNodeContents(e);const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0),box=e.getBoundingClientRect();return {text:e.textContent.trim(),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,lines:new Set(rects.map(r=>Math.round(r.top))).size,complete:rects.length>0&&rects.every(r=>r.left>=box.left-0.5&&r.right<=box.right+0.5),rects:rects.map(rect)};};
      const grid=e=>{const values=[...e.children].map(cell=>text(cell.lastElementChild));return {columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,values,noOverlap:values.every((v,i)=>values.slice(i+1).every(w=>v.rects.every(a=>w.rects.every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top))))};};
      return {offer:text(${offerElement}),offerGrid:grid((${offerSection}).querySelector('.grid')),supportGrid:grid((${supportSection}).querySelector('.grid')),shield:${page === 'detail' ? `grid(${shieldGrid})` : 'null'},pageWidth:document.documentElement.scrollWidth,viewport:innerWidth};
    })()`);
    console.log('METRIC_LAYOUT',page,width,fixture.name,JSON.stringify(layout));
    try {
      assert.equal(layout.offer.text, fixture.expected?.offer ?? money(fixture.fields.max_safe_offer));
      assert.equal(layout.offer.lines,1,'Main offer must stay on one line');
      assert.ok(layout.offer.scrollWidth <= layout.offer.clientWidth, `Main offer overflows at ${width}: ${JSON.stringify(layout.offer)}`);
      assert.ok(layout.offer.complete,'Main offer glyphs must remain inside their element');
      assert.ok(layout.pageWidth <= layout.viewport, `${page} page must not scroll sideways at ${width}`);
      assert.equal(layout.offerGrid.columns,width < 640 ? 1 : width < 768 ? 2 : 3);
      assert.equal(layout.supportGrid.columns,width < 640 ? 1 : width < 768 ? 2 : width < 1024 ? 3 : 4);
      assert.equal(layout.offerGrid.values[2].text, fixture.expected?.cost ?? money(fixture.fields.total_project_cost),'Round displayed cost, not stored precision');
      assert.equal(layout.supportGrid.values[0].text, fixture.expected?.profit ?? money(fixture.fields.net_profit),'Round displayed profit and retain its sign');
      if (fixture.meta) {
        assert.equal(layout.offerGrid.values[0].text,'$150,001');
        assert.equal(layout.supportGrid.values[3].text,'$270,001');
        assert.equal(await evaluate('Intl.NumberFormat().resolvedOptions().locale'),'de-DE','Prove the browser default is non-US');
      }
      if (layout.shield) {
        assert.equal(layout.shield.columns,width < 640 ? 1 : width < 1024 ? 3 : 5);
        // ShieldHeader keeps its existing locale/negative-zero behavior for the separate component PR.
        if (!fixture.expected) {
          assert.equal(layout.shield.values[0].text,money(fixture.fields.net_profit));
          assert.equal(layout.shield.values[3].text,money(fixture.fields.max_safe_offer));
        }
      }
      for (const grid of [layout.offerGrid,layout.supportGrid,layout.shield].filter(Boolean)) {
        assert.ok(grid.noOverlap, `Metric text must not overlap at ${width}`);
        for (const value of grid.values) assert.ok(value.complete && value.scrollWidth <= value.clientWidth, `Clipped/overflowing metric on ${page} at ${width}: ${JSON.stringify(value)}`);
      }
      const ownedText = [layout.offer.text,...layout.offerGrid.values.map(v=>v.text),...layout.supportGrid.values.map(v=>v.text)].join(' ');
      assert.ok(!ownedText.includes('-$0'),'No negative rounded zero in AnalysisResult metrics');
      if (fixture.expected) {
        const copyText = await evaluate(`(async()=>{let copied;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});[...(${decisionSection}).querySelectorAll('button')].find(b=>b.textContent.trim()==='Copy Summary').click();await Promise.resolve();return copied;})()`);
        assert.ok(copyText.includes('Offer ' + fixture.expected.offer),copyText);
        if (fixture.fields.net_profit !== null) assert.ok(copyText.includes('Net ' + fixture.expected.profit),copyText);
        assert.ok(!copyText.includes('-$0'),'No negative rounded zero in copied AnalysisResult summary');
        if (fixture.expected.gap) {
          assert.equal(layout.offerGrid.values[1].text,fixture.expected.gap);
          assert.equal(await evaluate(`(${offerSection}).querySelector('p span.font-semibold').textContent`),fixture.expected.callout);
          const negotiate = await evaluate(`[...(${decisionSection}).querySelectorAll('span')].find(e=>e.textContent.startsWith('NEGOTIATE FIRST'))?.textContent ?? null`);
          assert.equal(negotiate,fixture.expected.negotiate,'Direction and decision threshold must follow the unrounded gap');
        }
      }
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      metricLayoutFailures.push(`${page} ${width} ${fixture.name}: ${error.message}`);
    }
    // Scroll targets into view and capture the viewport; offscreen CDP crops can shift on narrow pages.
    if (fixture.name === 'wide-loss' && [375,390,768,1023,1024,1440].includes(width)) {
      for (const [name,expr] of [['offer',`(${offerElement}).parentElement`],['support',supportSection],...(page === 'detail' ? [['shield',shieldGrid]] : [])]) {
        await evaluate(`(${expr}).scrollIntoView({block:'center',inline:'nearest'})`);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const {data} = await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(artifacts,`metrics-${page}-${name}-${width}.png`),Buffer.from(data,'base64'));
      }
    }
  }
  for (const width of [375,390,639,640,767,768,1023,1024,1440]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    for (const [index,fixture] of metricCases.entries()) {
      // Keep all nine layout widths; targeted rounding edges additionally run on both pages at phone/desktop widths.
      if (fixture.expected && ![375,1440].includes(width)) continue;
      await cdp('Emulation.setLocaleOverride',{locale:fixture.locale ?? 'en-US'});
      const writesBeforeMetrics = browserApiWrites.length;
      await cdp('Page.navigate',{url:`http://127.0.0.1:5173/deal/${selected.id}?metricFixture=${index}`});
      await until(`Boolean(${byText('button','Lender Report')}) && (${scopeInput('Quote date 1')})?.value === '2026-09-12'`);
      await checkMetricLayout('detail',width,fixture);
      assert.deepEqual(browserApiWrites.slice(writesBeforeMetrics),[],'Detail metric inspection must not write');
      await click('a','Create revision');
      await until(`location.pathname === '/' && (${scopeInput('Quote date 1')})?.value === '2026-09-12' && !(${scopeInput('Unit cost 1')}).matches(':disabled')`);
      await click('button','Generate Investor Memo');
      await until(`Boolean(${byText('button','Save New Revision')}) && Boolean(${byText('div','Supporting Detail')})`);
      await checkMetricLayout('analyzer',width,fixture);
      assert.deepEqual(browserApiWrites.slice(writesBeforeMetrics),[{url:'http://127.0.0.1:8000/api/finalize-and-analyze',method:'POST'}],'Only the explicit stateless analysis may write a request; never save');
      assert.deepEqual(await api('/api/deals'),recordsBeforeList);
    }
  }
  await cdp('Emulation.setLocaleOverride',{locale:''});
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:metricFixture});
  assert.deepEqual(metricLayoutFailures, [], 'Every metric layout must pass; collect all widths before failing');
  checks.push('Detail/analyzer whole-dollar numbers fit at all nine widths with both fonts loaded; half-dollar and tiny-negative rounding, missing values, unrounded gap direction, US format under de-DE and copied summaries pass; only explicit analysis requests occur and saved precision stays unchanged');

  // Test-only browser injection. Compress the two UI/network timers, and stall
  // reads before headers or during the body. No production auth or test hooks.
  const { identifier: recoveryFixture } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    const mode = new URLSearchParams(location.search).get('readFixture');
    if (mode) {
      const nativeFetch = window.fetch.bind(window);
      const nativeTimeout = window.setTimeout.bind(window);
      const path = location.pathname === '/deals' ? '/api/deals' : '/api/deals/' + location.pathname.split('/').pop();
      window.readFixture = { mode, calls: 0, authenticated: [] };
      window.setTimeout = (callback, ms, ...args) => nativeTimeout(callback, ms === 8000 ? 50 : ms === 120000 ? 1200 : ms, ...args);
      window.fetch = async (input, init = {}) => {
        const url = new URL(input, location.href);
        if (url.origin === 'http://127.0.0.1:8000' && url.pathname === path && (init.method || 'GET') === 'GET') {
          const fixture = window.readFixture;
          fixture.calls++;
          fixture.authenticated.push(new Headers(init.headers).get('Authorization') === 'Bearer browser-fixture');
          if (fixture.mode === 'slow') await new Promise(resolve => nativeTimeout(resolve, 500));
          if (fixture.mode === 'headers') return new Promise((resolve, reject) => {
            if (init.signal.aborted) reject(init.signal.reason);
            else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
          });
          if (fixture.mode === 'body') return new Response(new ReadableStream({ start(controller) {
            if (init.signal.aborted) controller.error(init.signal.reason);
            else init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
          }}), { headers: { 'Content-Type': 'application/json' } });
          if (fixture.mode === 'forbidden') return new Response('Forbidden fixture', { status: 403 });
        }
        return nativeFetch(input, init);
      };
    }
  ` });
  await cdp("Page.navigate", { url: "http://127.0.0.1:5173/deals?readFixture=slow" });
  await until(`document.querySelector('[role="status"]')?.textContent.includes('taking longer than usual')`);
  await until(`Boolean(${inputByAria(`Open saved version ${selected.id}`)})`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[role="status"]')).some(status => /Loading deals|taking longer than usual/.test(status.textContent))`), false);
  checks.push("A delayed saved list explains the wait and loads successfully without a retry");
  for (const [route, mode] of [["/deals", "headers"], ["/deals", "body"], [`/deal/${selected.id}`, "headers"], ["/deals", "forbidden"]]) {
    await cdp("Page.navigate", { url: `http://127.0.0.1:5173${route}?readFixture=${mode}` });
    if (mode !== "forbidden") await until(`document.querySelector('[role="status"]')?.textContent.includes('taking longer than usual')`);
    await until(`Boolean(${byText("button", "Try again")})`);
    const errorText = await evaluate(`document.querySelector('[role="alert"]').textContent`);
    assert.ok(errorText.includes(mode === "forbidden" ? "403" : "Loading saved deals took too long"));
    assert.equal(await evaluate(`document.body.textContent.includes('No saved deals yet')`), false);
    const calls = await evaluate("window.readFixture.calls");
    await pause(300);
    assert.equal(await evaluate("window.readFixture.calls"), calls, "No automatic retry after a failed read");
    assert.ok(await measure(`document.documentElement.scrollWidth <= innerWidth`));
    await evaluate("window.readFixture.mode = 'pass'");
    await click("button", "Try again");
    if (route === "/deals") await until(`Boolean(${inputByAria(`Open saved version ${selected.id}`)})`);
    else await until(`(${scopeInput("Quote date 1")})?.value === '2026-09-12'`);
    assert.equal(await evaluate("window.readFixture.calls"), calls + 1);
    assert.ok(await evaluate("window.readFixture.authenticated.every(Boolean)"));
    assert.equal(await evaluate(`Boolean(${byText("button", "Try again")})`), false);
  }
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: recoveryFixture });
  assert.deepEqual(await api("/api/deals"), recordsBeforeList);
  checks.push("List/detail timeout and 403 recovery require a user retry; stalled response bodies time out, auth is retained, and all saved records remain unchanged");

  // Test-only fault injection for first-use requests. Only the isolated test
  // backend can receive writes; URL drafts are fixtures and never scrape a site.
  const { identifier: analyzerFixture } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    if (new URLSearchParams(location.search).has('requestFixture')) {
      const nativeFetch = window.fetch.bind(window);
      const nativeTimeout = window.setTimeout.bind(window);
      window.requestFixture = null;
      window.setTimeout = (callback, ms, ...args) => nativeTimeout(callback, ms === 8000 ? 50 : ms === 120000 ? 1600 : ms, ...args);
      window.fetch = async (input, init = {}) => {
        const url = new URL(input, location.href);
        const fixture = window.requestFixture;
        if (!fixture || url.origin !== 'http://127.0.0.1:8000' || url.pathname !== fixture.path || init.method !== 'POST') return nativeFetch(input, init);
        fixture.calls++;
        fixture.payloads.push(JSON.parse(init.body));
        fixture.authenticated.push(new Headers(init.headers).get('Authorization') === 'Bearer browser-fixture');
        const mode = fixture.mode;
        const stalledBody = status => new Response(new ReadableStream({ start(controller) {
          if (init.signal.aborted) controller.error(init.signal.reason);
          else init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
        }}), { status, headers: { 'Content-Type': 'application/json' } });
        if (mode === 'headers') return new Promise((resolve, reject) => {
          if (init.signal.aborted) reject(init.signal.reason);
          else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
        if (mode === 'body') return stalledBody(200);
        if (mode === 'forbidden-body') return stalledBody(403);
        if (mode === 'forbidden') return new Response('Forbidden fixture', { status: 403 });
        if (mode === 'server-error') return new Response('Server error fixture', { status: 500 });
        if (mode === 'missing-id') return Response.json({});
        if (mode === 'missing-flat') return Response.json({ missing_fields: ['purchase_price'] }, { status: 422 });
        if (mode === 'missing-nested') return Response.json({ detail: { missing_fields: ['purchase_price'] } }, { status: 422 });
        if (mode.startsWith('committed-')) {
          const response = await nativeFetch(input, init);
          if (!response.ok) throw new Error('Fixture save failed');
          fixture.saved = await response.json();
          if (mode === 'committed-body') return stalledBody(200);
          if (mode === 'committed-network') throw new TypeError('Failed to fetch');
          return new Response('{', { headers: { 'Content-Type': 'application/json' } });
        }
        if (mode === 'slow') await new Promise(resolve => nativeTimeout(resolve, 650));
        if (url.pathname === '/api/draft-from-url') return Response.json({ draft: fixture.draft });
        return nativeFetch(input, init);
      };
    }
  ` });
  const configureRequest = (path, mode) => evaluate(`window.requestFixture = ${JSON.stringify({ path, mode, calls: 0, payloads: [], authenticated: [], draft: first.draft_input })}`);
  const hasStatus = text => `Array.from(document.querySelectorAll('[role="status"]')).some(e=>e.textContent.includes(${JSON.stringify(text)}))`;
  const hasAlert = text => `Array.from(document.querySelectorAll('[role="alert"]')).some(e=>e.textContent.includes(${JSON.stringify(text)}))`;
  async function openManual(mode) {
    await cdp("Page.navigate", { url: "http://127.0.0.1:5173/?requestFixture=1" });
    await click("button", "Analyze without address lookup ↓");
    for (const [label, value] of [["Purchase Price", "150000"], ["ARV", "270000"], ["Rehab Budget", "50000"], ["Est. Monthly Rent (optional)", ""]]) await fill(labelInput(label), value);
    await configureRequest("/api/analyze", mode);
  }
  async function openUrl(mode) {
    await cdp("Page.navigate", { url: "http://127.0.0.1:5173/?requestFixture=1" });
    await click("button", "URL");
    await fill(`document.querySelector('input[placeholder="https://..."]')`, "https://example.test/fixture");
    await configureRequest("/api/draft-from-url", mode);
  }
  async function openDraft(mode) {
    await openUrl("pass");
    await click("button", "Fetch Draft");
    await until(`Boolean(${byText("button", "Generate Investor Memo")})`);
    await configureRequest("/api/finalize-and-analyze", mode);
  }
  async function noReplay() {
    assert.equal(await evaluate("window.requestFixture.calls"), 1);
    await pause(250);
    assert.equal(await evaluate("window.requestFixture.calls"), 1, "Request must not replay automatically");
  }
  for (const prepare of [openManual, openDraft]) {
    await prepare("slow");
    await click("button", "Generate Investor Memo");
    await until(hasStatus("Still generating your memo"));
    await until(`Boolean(${byText("button", "Save Deal")})`);
    await noReplay();
    assert.equal(await evaluate(hasStatus("Still generating your memo")), false);
    for (const mode of ["headers", "body"]) {
      await prepare(mode);
      await click("button", "Generate Investor Memo");
      await until(hasStatus("Still generating your memo"));
      await until(hasAlert("Analysis took too long"));
      assert.equal(await evaluate(`(${labelInput("Purchase Price")}).value`), "150000");
      assert.equal(await evaluate(`Boolean(${byText("button", "Save Deal")})`), false);
      assert.equal(await evaluate(hasStatus("Still generating your memo")), false);
      await noReplay();
      await evaluate("window.requestFixture.mode = 'pass'");
      await click("button", "Generate Investor Memo");
      await until(`Boolean(${byText("button", "Save Deal")})`);
      assert.equal(await evaluate("window.requestFixture.calls"), 2);
      assert.equal(await evaluate(hasAlert("Analysis took too long")), false);
    }
  }
  checks.push("Manual and draft analysis explain slow responses, bound headers and bodies, retain inputs, and retry only on a user action");
  for (const mode of ["missing-flat", "missing-nested"]) {
    await openDraft(mode);
    await click("button", "Generate Investor Memo");
    await until(hasAlert("Missing: Purchase Price"));
    assert.equal(await evaluate(`Boolean(${byText("button", "Save Deal")})`), false);
    await noReplay();
  }
  for (const mode of ["slow", "headers", "body"]) {
    await openUrl(mode);
    await click("button", "Fetch Draft");
    await until(hasStatus("Fetching the listing is taking longer"));
    if (mode !== "slow") {
      await until(hasAlert("Fetching the draft took too long"));
      assert.equal(await evaluate(`document.querySelector('input[placeholder="https://..."]').value`), "https://example.test/fixture");
      await noReplay();
      await evaluate("window.requestFixture.mode = 'pass'");
      await click("button", "Fetch Draft");
    }
    await until(`Boolean(${byText("button", "Generate Investor Memo")})`);
    assert.equal(await evaluate(hasStatus("Fetching the listing is taking longer")), false);
  }
  assert.deepEqual(await api("/api/deals"), recordsBeforeList);
  checks.push("Both 422 missing-field shapes remain supported; URL drafts explain delays, time out, and recover without any saved writes");

  await openManual("pass");
  await click("button", "Generate Investor Memo");
  await until(`Boolean(${byText("button", "Save Deal")})`);
  await configureRequest("/api/deals/save", "slow");
  await evaluate("window.authFixture = { calls: 0, delayMs: 300 }");
  await evaluate(`(()=>{const button=${byText("button", "Save Deal")};button.click();button.click();})()`);
  await until(hasStatus("Still waiting for save confirmation"));
  await fill(labelInput("Rehab Budget"), "67000");
  await until(`Boolean(${byText("button", "Saved!")})`);
  await noReplay();
  assert.equal(await evaluate("window.authFixture.calls"), 1);
  assert.ok(await evaluate("window.requestFixture.authenticated.every(Boolean)"));
  assert.equal(await evaluate(hasStatus("Still waiting for save confirmation")), false);
  const delayedSave = (await api("/api/deals"))[0];
  assert.equal(delayedSave.draft_input.rehab_budget.value, 50000);
  assert.equal(delayedSave.analysis_result.net_profit, 34900);
  assert.equal((await api("/api/deals")).length, recordsBeforeList.length + 1);
  checks.push("Slow saves show progress, lock before token retrieval, send one authenticated write despite rapid clicks, and retain the analyzed snapshot");

  for (const mode of ["headers", "body", "committed-body", "committed-network", "committed-invalid", "missing-id", "server-error", "forbidden", "forbidden-body"]) {
    const beforeSave = await api("/api/deals");
    await openManual("pass");
    await click("button", "Generate Investor Memo");
    await until(`Boolean(${byText("button", "Save Deal")})`);
    await configureRequest("/api/deals/save", mode);
    await click("button", "Save Deal");
    if (mode === "headers" || mode.endsWith("body")) await until(hasStatus("Still waiting for save confirmation"));
    if (mode.startsWith("forbidden")) {
      await until(hasAlert("Save deal error 403"));
      assert.equal(await evaluate(`(${byText("button", "Save Deal")}).disabled`), false);
      assert.equal(await evaluate(`Boolean(${byText("a", "Check Saved Deals (opens in a new tab)")})`), false);
    } else {
      await until(hasAlert("This deal may already be saved"));
      assert.ok(await evaluate(`(${byText("button", "Save unconfirmed")}).disabled`));
      assert.ok(await evaluate(`Boolean(${byText("a", "Check Saved Deals (opens in a new tab)")})`));
      await click("button", "Save unconfirmed");
    }
    await noReplay();
    assert.equal(await evaluate(`Boolean(${byText("button", "Saved!")})`), false);
    assert.equal(await evaluate(hasStatus("Still waiting for save confirmation")), false);
    assert.ok(await evaluate("window.requestFixture.authenticated.every(Boolean)"));
    assert.ok(await measure("document.documentElement.scrollWidth <= innerWidth"));
    const saved = await evaluate("window.requestFixture.saved");
    const afterSave = await api("/api/deals");
    assert.equal(afterSave.length, beforeSave.length + (saved ? 1 : 0));
    if (saved) {
      assert.equal(saved.analysis_result.net_profit, 34900);
      const analyzerSession = sessionId;
      const analyzerUrl = await evaluate("location.href");
      const rehabBeforeCheck = await evaluate(`(${labelInput("Rehab Budget")}).value`);
      const beforeTargets = (await cdp("Target.getTargets", {}, false)).targetInfos.map(target => target.targetId);
      await cdp("Runtime.evaluate", { expression: `(${byText("a", "Check Saved Deals (opens in a new tab)")}).click()`, userGesture: true });
      let savedDealsTab;
      for (let i = 0; i < 80 && !savedDealsTab; i++) {
        savedDealsTab = (await cdp("Target.getTargets", {}, false)).targetInfos.find(target =>
          !beforeTargets.includes(target.targetId) && target.url === "http://127.0.0.1:5173/deals");
        if (!savedDealsTab) await pause(200);
      }
      assert.ok(savedDealsTab, "Saved Deals must open in a separate tab");
      ({ sessionId } = await cdp("Target.attachToTarget", { targetId: savedDealsTab.targetId, flatten: true }, false));
      await cdp("Runtime.enable");
      await until(`Boolean(${inputByAria(`Open saved version ${saved.id}`)})`);
      assert.equal(await evaluate("window.opener === null"), true);
      await cdp("Target.closeTarget", { targetId: savedDealsTab.targetId }, false);
      sessionId = analyzerSession;
      assert.equal(await evaluate("location.href"), analyzerUrl);
      assert.equal(await evaluate(`(${labelInput("Rehab Budget")}).value`), rehabBeforeCheck);
      assert.ok(await evaluate(`(${byText("button", "Save unconfirmed")}).disabled`));
      assert.ok(await evaluate("document.body.textContent.includes('If it is not there, return to this tab and generate the memo again to save.')"));
      assert.equal(await evaluate(hasStatus("Still waiting for save confirmation")), false);
    }
    for (const record of beforeSave) assert.deepEqual(await api(`/api/deals/${record.id}`), record);
  }
  checks.push("Lost save confirmations never report success or replay; committed records are found in a separate Saved Deals tab without losing analyzer inputs or the memo, while 403 rejections remain distinct and existing records stay intact");

  await openManual("pass");
  await click("button", "Generate Investor Memo");
  await until(`Boolean(${byText("button", "Save Deal")})`);
  await configureRequest("/api/deals/save", "pass");
  await evaluate("window.authFixture = { calls: 0, delayMs: 650 }");
  const beforeAbandonedSave = await api("/api/deals");
  await click("button", "Save Deal");
  await fill(labelInput("Rehab Budget"), "67000");
  await click("button", "Generate Investor Memo");
  await until(`Boolean(${byText("button", "Save Deal")})`);
  await pause(800);
  assert.equal(await evaluate("window.requestFixture.calls"), 0);
  assert.equal(await evaluate(`Boolean(${byText("button", "Saved!")})`), false);
  assert.deepEqual(await api("/api/deals"), beforeAbandonedSave);
  checks.push("Starting a new analysis during token retrieval cancels the obsolete save before any write");
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: analyzerFixture });

  // Items additions run after all prior house scenarios; the 36 existing checks
  // above/below remain intact. Backend CI is pinned to released Items #26.
  for (const width of [390, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await cdp("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await until(`Boolean(document.querySelector('a[href="/items"]'))`);
    await requireFonts();
    const bodyMetrics = () => measure(`(()=>{const nav=document.querySelector('a[href="/items"]').parentElement.parentElement;const top=nav.getBoundingClientRect().bottom;return [...nav.parentElement.children].filter(e=>e!==nav).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y-top,width:r.width,height:r.height,text:e.textContent};});})()`);
    const after = await bodyMetrics();
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), "House nav must not add overflow");
    await screenshot(`items-house-nav-${width}-after.png`);
    // Reproduce exactly the previous nav without changing house content or data.
    await evaluate(`(()=>{const a=document.querySelector('a[href="/items"]');a.style.display='none';a.parentElement.dataset.currentClass=a.parentElement.className;a.parentElement.className='flex items-center gap-5';})()`);
    const before = await bodyMetrics();
    assert.deepEqual(after, before, "House content outside nav must retain layout and text");
    await screenshot(`items-house-nav-${width}-before.png`);
    await evaluate(`(()=>{const a=document.querySelector('a[href="/items"]');a.style.display='';a.parentElement.className=a.parentElement.dataset.currentClass;})()`);
  }
  checks.push("House screens at 390/1440 retain content and layout outside the additive Items navigation; no overflow; before/after renders captured");

  const { identifier: itemsFixture } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    if (location.pathname === '/items') {
      const nativeFetch=window.fetch.bind(window), nativeTimeout=window.setTimeout.bind(window);
      window.itemRequests=[]; window.itemMode='pass'; window.itemRelease=null; window.itemHeld=false;
      window.setTimeout=(callback,ms,...args)=>nativeTimeout(callback,ms===8000?50:ms===120000?1400:ms,...args);
      window.fetch=async(input,init={})=>{
        const url=new URL(input,location.href);
        if(url.pathname!=='/api/items/analyze') return nativeFetch(input,init);
        window.itemRequests.push({body:JSON.parse(init.body),wire:init.body,auth:new Headers(init.headers).get('Authorization')});
        const mode=window.itemMode;
        if(mode==='headers') return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
        if(mode==='body') return new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});}}),{headers:{'Content-Type':'application/json'}});
        if(mode==='422') return Response.json({detail:[{loc:['body','fee_pct'],msg:'Value error, must have at most 6 decimal places'}]},{status:422});
        const response=await nativeFetch(input,init);
        if(mode==='hold') { const body=await response.text(); window.itemHeld=true; await new Promise(resolve=>window.itemRelease=resolve); return new Response(body,{status:response.status,headers:{'Content-Type':'application/json'}}); }
        return response;
      };
    }
  ` });
  const itemInput = field => `document.getElementById(${JSON.stringify(`item-${field}`)})`;
  const dresser = { purchase_price: '0', resale_low: '300', resale_high: '450', repairs: '60', pickup: '40', delivery: '0', storage: '0', fee_fixed: '0', hours: '5', hourly_value: '20', target_profit: '150', contingency_pct: '0', fee_pct: '0' };
  const fractional = { ...dresser, purchase_price: '77', resale_high: '300', repairs: '40', pickup: '15', fee_fixed: '1.10', hours: '2', target_profit: '100', contingency_pct: '10', fee_pct: '7.5' };
  const itemStatus = status => `document.querySelector('[data-item-status]')?.getAttribute('data-item-status') === ${JSON.stringify(status)}`;
  async function openItems(values) {
    await cdp("Page.navigate", { url: "http://127.0.0.1:5173/items?manual=1&fixtureSignedOut=1" });
    await until(`Boolean(${itemInput('purchase_price')})`);
    assert.ok(await evaluate(`!document.body.textContent.includes('Sign In')`), "Items must work signed out");
    await evaluate(`document.querySelectorAll('form input[type="checkbox"]:checked').forEach(e=>e.click())`);
    for (const [field, value] of Object.entries(values)) await fill(itemInput(field), value);
  }
  async function calculateItems(status) {
    await click("button", "Calculate my flip");
    await until(itemStatus(status));
  }
  const lowItem = selector => `document.querySelector('section[aria-label="Low resale results"] ${selector}')?.textContent`;
  const itemsSavedBefore = await api('/api/deals');
  const itemWriteStart = browserApiWrites.length;
  for (const width of [390, 1440]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await openItems(dresser);
    for (const [price,status,cash,profit,shortfall] of [['0','stretch','$200.00','$100.00','$50.00'],['40','stretch','$160.00','$60.00','$90.00'],['100','stretch','$100.00','$0.00','$150.00'],['100.01','skip','$99.99','-$0.01','$150.01']]) {
      await fill(itemInput('purchase_price'), price); await calculateItems(status);
      assert.equal(await evaluate(lowItem('[data-item-offer]')), '-$50');
      assert.equal(await evaluate(lowItem('[data-item-cash]')), cash);
      assert.equal(await evaluate(lowItem('[data-item-profit]')), profit);
      assert.equal(await evaluate(lowItem('[data-item-shortfall]')), shortfall);
    }
    await screenshot(`items-dresser-${width}.png`);
    await fill(itemInput('purchase_price'), ''); await calculateItems('offer_only');
    assert.equal(await evaluate(`document.querySelectorAll('[data-item-cash],[data-item-profit],[data-item-shortfall]').length`), 0);
    assert.equal(await evaluate(lowItem('[data-item-offer]')), '-$50');
    await screenshot(`items-offer-only-${width}.png`);
    await fill(itemInput('repairs'), ''); await calculateItems('needs_info');
    assert.equal(await evaluate(`document.querySelectorAll('[data-item-offer]').length`), 0);
    assert.ok(await evaluate(`document.querySelector('[data-item-status]').textContent.includes('Repairs and hired repair labor')`));
    await screenshot(`items-needs-info-${width}.png`);
    await openItems(fractional);
    for (const [price,status,profit] of [['77','within_budget','$100.40'],['77.40','within_budget','$100.00'],['77.41','skip','$99.99']]) {
      await fill(itemInput('purchase_price'), price); await calculateItems(status);
      assert.equal(await evaluate(lowItem('[data-item-offer]')), '$77');
      assert.equal(await evaluate(lowItem('[data-item-profit]')), profit);
    }
    await screenshot(`items-fractional-${width}.png`);
    for (const [percent,wire] of [['14.3','0.143'],['2.9','0.029'],['7.5','0.075']]) {
      await fill(itemInput('fee_pct'), percent); await calculateItems(percent === '2.9' ? 'within_budget' : 'skip');
      assert.ok((await evaluate('window.itemRequests.at(-1).wire')).includes(`"fee_pct":${wire}`));
    }
    assert.ok(await measure(`document.documentElement.scrollWidth <= innerWidth`));
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('input')).every(e=>e.labels.length>0 || e.getAttribute('aria-label'))`));
    assert.ok(await evaluate(`window.itemRequests.every(r=>r.auth===null)`));
    await screenshot(`items-percent-${width}.png`);
  }
  checks.push("Signed-out Items at 390/1440 passes all dresser and fractional-price rows, missing/offer-only states, exact percentage wire text, labels and overflow checks through the real backend");

  await openItems(fractional);
  await fill(itemInput('fee_pct'), '12abc');
  const invalidCalls = await evaluate('window.itemRequests.length');
  await click('button','Calculate my flip'); await until(`Boolean(document.querySelector('[role="alert"]'))`);
  assert.equal(await evaluate('window.itemRequests.length'),invalidCalls);
  await fill(itemInput('fee_pct'),'7.5');
  await evaluate(`Array.from(document.querySelectorAll('summary')).find(e=>e.textContent==='Personal defaults for this page').click()`);
  assert.equal(await evaluate(`Boolean(${inputByAria('Use my personal default for Selling fee (%)')})`),false);
  await fill(`document.getElementById('personal-fee_pct')`,'14.3');
  await toggle('Use my personal default for Selling fee (%)');
  await calculateItems('skip');
  const inheritedItem = await evaluate('window.itemRequests.at(-1).body');
  assert.equal(Object.hasOwn(inheritedItem,'fee_pct'),false);
  assert.equal(inheritedItem.personal_defaults.fee_pct,0.143);
  await toggle('Use my personal default for Selling fee (%)');
  await fill(itemInput('fee_pct'),''); await calculateItems('needs_info');
  assert.equal(await evaluate('window.itemRequests.at(-1).body.fee_pct'),null);
  assert.ok(await evaluate(`document.querySelector('[data-item-status]').textContent.includes('default is off and no value was entered')`));
  await fill(`document.getElementById('personal-fee_pct')`,'');
  assert.equal(await evaluate(`Boolean(${inputByAria('Use my personal default for Selling fee (%)')})`),false);
  await evaluate('window.itemsBeforeReload = true');
  await cdp('Page.reload');
  await until(`!window.itemsBeforeReload && Boolean(${itemInput('purchase_price')}) && Boolean(document.getElementById('personal-fee_pct'))`);
  assert.equal(await evaluate(`document.getElementById('personal-fee_pct').value`),'');
  assert.equal(await evaluate(`(${itemInput('hourly_value')}).disabled`),true);
  assert.equal(await evaluate(`(${itemInput('contingency_pct')}).disabled`),true);
  await calculateItems('needs_info');
  const initialItem = await evaluate('window.itemRequests.at(-1).body');
  assert.equal(Object.hasOwn(initialItem,'hourly_value'),false);
  assert.equal(Object.hasOwn(initialItem,'contingency_pct'),false);
  checks.push("Items rejects invalid text without a request, preserves default/null/zero semantics, exposes personal fee defaults only when supplied, and forgets page defaults on reload");

  await openItems({ ...dresser, purchase_price:'1', resale_low:'1',resale_high:'1',repairs:'0',pickup:'0',hours:'0',target_profit:'0',fee_pct:'0.01' });
  await calculateItems('skip');
  assert.equal(await evaluate(lowItem('[data-item-offer]')),'$0');
  assert.equal(await evaluate(lowItem('[data-item-profit]')),'$0.00');
  assert.ok(await evaluate(`document.querySelector('[data-item-status]').textContent.includes('does not necessarily mean a cash loss')`));
  checks.push("Items renders server skip at a sub-cent boundary without recomputing status from displayed zero profit or cent-rounded ceilings");

  await openItems(dresser);
  await evaluate(`window.itemMode='hold'; document.querySelector('form').requestSubmit(); document.querySelector('form').requestSubmit()`);
  await until('window.itemHeld');
  assert.equal(await evaluate('window.itemRequests.length'),1);
  await fill(itemInput('purchase_price'),'100.01');
  await evaluate(`window.itemMode='pass'`); await calculateItems('skip');
  await evaluate('window.itemRelease()'); await pause(150);
  assert.ok(await evaluate(itemStatus('skip')));
  assert.equal(await evaluate(lowItem('[data-item-profit]')),'-$0.01');
  await fill(itemInput('purchase_price'),'0');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-item-status]'))`),false);
  checks.push("Items locks duplicate submissions, clears edited results and ignores old responses after edit/resubmit");

  for (const mode of ['headers','body','422']) {
    await openItems(fractional); await evaluate(`window.itemMode=${JSON.stringify(mode)}`);
    await click('button','Calculate my flip');
    if(mode!=='422') await until(hasStatus('taking longer than usual'));
    await until(hasAlert(mode==='422'?'Selling fee (%)':'took too long'));
    assert.equal(await evaluate('window.itemRequests.length'),1);
    assert.equal(await evaluate(`(${itemInput('purchase_price')}).value`),'77');
    await evaluate(`window.itemMode='pass'`); await calculateItems('within_budget');
    assert.equal(await evaluate('window.itemRequests.length'),2);
  }
  checks.push("Items 120-second header/body deadlines and readable 422 errors preserve inputs, explain cold starts and retry only on user action");
  assert.deepEqual(await api('/api/deals'),itemsSavedBefore);
  assert.ok(browserApiWrites.slice(itemWriteStart).every(r=>r.url.endsWith('/api/items/analyze')));
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:itemsFixture});
  checks.push("Items makes only explicit public stateless analysis POSTs, with no authorization headers or saved-record changes");
  // Save/list/reopen additions. All preceding 43 checks retain their assertions.
  async function itemApi(path, body, owner = 'browser-fixture', expected = 200) {
    const res = await fetch(`http://127.0.0.1:8000${path}`, { headers: { 'Content-Type':'application/json', Authorization:`Bearer ${owner}` }, ...(body === undefined ? {} : { method:'POST', body:JSON.stringify(body) }) });
    assert.equal(res.status, expected, await res.clone().text()); return res.json();
  }
  for (const original of roundTripCases()) {
    const rebuilt = buildSavedItemInputs(restoreItemForm(original)); assert.ok(rebuilt.ok);
    const [before, after] = await Promise.all([itemApi('/api/items/analyze', original), itemApi('/api/items/analyze', rebuilt.payload)]);
    assert.deepEqual(after, before, `Real-engine round trip: ${JSON.stringify(original)}`);
  }
  checks.push('267 representative/generated restore-and-rebuild requests match the complete real backend analysis, including assumptions and sources');
  const { identifier: savedItemsFixture } = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    const nativeFetch=window.fetch.bind(window), nativeTimeout=window.setTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===120000?(window.savedItemMode==='hold-list'?10000:160):ms===8000?40:ms,...args);
    window.savedItemRequests=[];window.savedItemMode='pass';
    window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(!url.pathname.startsWith('/api/items') || url.pathname==='/api/items/analyze')return nativeFetch(input,init);
      const request={path:url.pathname,method:init.method??'GET',auth:new Headers(init.headers).get('Authorization'),body:init.body?JSON.parse(init.body):null};window.savedItemRequests.push(request);
      const mode=window.savedItemMode;
      if(mode==='headers')return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
      if(mode==='body')return new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')));}}),{status:200});
      if(['403','404','422','500'].includes(mode))return Response.json({detail:mode==='422'?[{loc:['body','notes'],msg:'Invalid notes fixture'}]:'Rejected fixture'},{status:Number(mode)});
      if(mode==='slow')await new Promise(resolve=>nativeTimeout(resolve,70));
      if(mode==='hold-list' && url.pathname==='/api/items')await new Promise(resolve=>window.releaseSavedItemList=resolve);
      const response=await nativeFetch(input,init);
      if(mode==='lost' && init.method==='POST'){window.lastCommittedItem=await response.json();throw new TypeError('Confirmation lost');}
      if(mode==='delayed-read' && request.method==='GET' && request.auth==='Bearer browser-fixture')await new Promise(resolve=>nativeTimeout(resolve,600));
      if(mode==='hostile-link' && url.pathname==='/api/items'){const data=await response.json();data.items=data.items.map(item=>({...item,listing_url:'javascript:alert(1)',notes:'<img src=x onerror=alert(1)>'}));return Response.json(data);}
      return response;
    };
  ` });
  async function signedItems(values = {}) {
    await evaluate('window.beforeSavedItemsNavigation = true');
    await cdp('Page.navigate', {url:'http://127.0.0.1:5173/items?manual=1'});
    await until(`!window.beforeSavedItemsNavigation && Boolean(${itemInput('purchase_price')})`);
    await evaluate(`document.querySelectorAll('form input[type="checkbox"]:checked').forEach(e=>e.click())`);
    await until(`!(${itemInput('hourly_value')}).disabled && !(${itemInput('contingency_pct')}).disabled`);
    for (const [field,value] of Object.entries(values)) await fill(itemInput(field), value);
  }
  async function saveCurrent(label='Save item') {
    await click('button',label); await until(hasStatus('Saved version #'));
    return (await api('/api/items')).items[0];
  }
  for (const width of [390,1440]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390});
    for (const loading of [false,true]) {
      await evaluate('window.beforeSignInDraft = true');
      await cdp('Page.navigate',{url:`http://127.0.0.1:5173/items?manual=1&fixtureSignedOut=1${loading ? '&fixtureAuthLoading=1' : ''}`});
      await until(`!window.beforeSignInDraft && Boolean(${itemInput('purchase_price')})`);
      await fill(itemInput('purchase_price'),'123');
      await fill(itemInput('resale_low'),'300');
      await fill(itemInput('item_name'),'Garage dresser');
      await fill(`document.getElementById('item-notes')`,'Check the drawer runners.');
      if (!loading) await click('button','Sign in to save item');
      assert.equal(await evaluate('window.savedItemRequests.length'),0);
      await evaluate(`window.switchFixtureUser(${loading ? 'null' : "'browser-fixture'"})`);
      await until(`document.body.textContent.includes(${JSON.stringify(loading ? 'Sign in to save item' : 'Save item')})`);
      assert.equal(await evaluate(`(${itemInput('purchase_price')}).value`),'123');
      assert.equal(await evaluate(`(${itemInput('resale_low')}).value`),'300');
      if (loading) {
        await click('button','Sign in to save item');
        await evaluate(`window.switchFixtureUser('browser-fixture')`);
      }
      await until(`Boolean(${byText('button','Save item')})`);
      const saved = await saveCurrent();
      assert.equal(saved.inputs.purchase_price,123);
      assert.equal(saved.inputs.resale_low,300);
      assert.equal(saved.inputs.item_name,'Garage dresser');
      assert.equal(saved.notes,'Check the drawer runners.');
      assert.equal(await evaluate('window.savedItemRequests.filter(r=>r.method==="POST").length'),1);
      await screenshot(`items-sign-in-preserved-${width}-${loading}.png`);
      await evaluate(`window.switchFixtureUser(null)`);
      await until(`document.body.textContent.includes('Sign in to save item')`);
      assert.equal(await evaluate(`(${itemInput('purchase_price')}).value`),'');
      assert.equal(await evaluate(`document.getElementById('item-notes').value`),'');
      assert.equal(await evaluate(`Boolean(document.querySelector('[data-item-status]'))`),false);
    }
  }
  checks.push('390/1440 anonymous drafts survive auth loading and sign-in, save the entered numbers and notes once, and clear private saved data on sign-out');
  const originalHouses = await api('/api/deals');
  let sourceItem;
  for (const width of [390,1440]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390});
    await signedItems(fractional);
    await fill(itemInput('item_name'),`Oak dresser ${width}\nSolid wood`);
    await fill(`document.getElementById('item-notes')`,'Small scratch; seller contact details excluded.');
    await fill(`document.getElementById('item-listing-url')`,'https://example.com/dresser');
    await fill(itemInput('fee_pct'),'14.3');
    await calculateItems('skip');
    const screen = await evaluate(`document.querySelector('[data-item-status]').getAttribute('data-item-status')`);
    const saved = await saveCurrent(); sourceItem=saved;
    assert.equal(saved.analysis_result.status,screen); assert.equal(saved.inputs.fee_pct,0.143);
    assert.equal(saved.inputs.item_name,`Oak dresser ${width}\nSolid wood`);
    assert.equal(await evaluate('window.savedItemRequests.filter(r=>r.method==="POST").length'),1);
    assert.ok(await evaluate('window.savedItemRequests.every(r=>r.auth==="Bearer browser-fixture")'));
    await screenshot(`items-saved-${width}.png`);
    await click('a','My Flips'); await until(`Boolean(document.querySelector('[data-saved-item="${saved.id}"]'))`);
    assert.equal(await evaluate(`document.querySelector('[data-saved-item="${saved.id}"] a[target="_blank"]').rel`),'noopener noreferrer');
    assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'));
    await screenshot(`items-my-flips-${width}.png`);
    await evaluate(`document.querySelector('[aria-label="Reopen saved item ${saved.id}"]').click()`);
    await until(`Boolean(document.getElementById('item-notes'))`);
    assert.equal(await evaluate(`(${itemInput('fee_pct')}).value`),'14.3');
    assert.equal(await evaluate(`document.getElementById('item-notes').value`),saved.notes);
    await fill(`document.getElementById('item-notes')`,'Notes-only new version.');
    const child = await saveCurrent('Save new version');
    assert.equal(child.parent_item_id,saved.id); assert.equal(child.root_item_id,saved.id);
    assert.deepEqual(child.analysis_result,saved.analysis_result);
    assert.deepEqual(await api(`/api/items/${saved.id}`),saved);
    assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'));
    await screenshot(`items-reopened-${width}.png`);
    await signedItems({...dresser,purchase_price:''});
    const offerOnly=await saveCurrent(); assert.equal(offerOnly.analysis_result.status,'offer_only');
    await signedItems();
    const incomplete=await saveCurrent(); assert.equal(incomplete.analysis_result.status,'needs_info');
  }
  checks.push('390/1440 real UI saves current inputs, lists and reopens versions, preserves notes-only results and root links, and saves offer-only/incomplete finds without changing originals');

  await signedItems(dresser);
  await fill(itemInput('repairs'),'12abc');
  await click('button','Save item'); await until(hasAlert('Check the highlighted inputs'));
  assert.equal(await evaluate('window.savedItemRequests.length'),0);
  await fill(itemInput('repairs'),'0'); await fill(itemInput('item_name'),'NUL\0name');
  await click('button','Save item'); await until(`document.body.textContent.includes('NUL')`);
  assert.equal(await evaluate('window.savedItemRequests.length'),0);
  await fill(itemInput('item_name'),'Valid');
  await evaluate('window.authFixture={calls:0,delayMs:250}');
  await evaluate(`(()=>{const b=${byText('button','Save item')};b.click();b.click();})()`);
  await until(hasStatus('Saved version #'));
  assert.equal(await evaluate('window.authFixture.calls'),1);
  assert.equal(await evaluate('window.savedItemRequests.filter(r=>r.method==="POST").length'),1);
  checks.push('Save blocks invalid screen values and NUL before requests, locks before token retrieval, and sends one write on duplicate clicks');

  for (const mode of ['headers','body','403','422','500','lost']) {
    await signedItems(dresser); await evaluate(`window.savedItemMode=${JSON.stringify(mode)}`);
    const before=(await api('/api/items')).items.map(i=>i.id);
    await click('button','Save item');
    await until(hasAlert(mode==='403'?'session':mode==='422'?'Invalid notes':'may already be saved'));
    assert.equal(await evaluate('window.savedItemRequests.length'),1);
    assert.equal(await evaluate(`(${itemInput('purchase_price')}).value`),'0');
    if (!['403','422'].includes(mode)) assert.ok(await evaluate(`(${byText('button','Save item')}).disabled`));
    else { await evaluate('window.savedItemMode="pass"'); await saveCurrent(); }
    if(mode==='lost') {
      const committed=await evaluate('window.lastCommittedItem'); assert.ok(!before.includes(committed.id));
      await evaluate('window.savedItemMode="pass"'); await click('a','My Flips');
      await until(`Boolean(document.querySelector('[data-saved-item="${committed.id}"]'))`);
    }
  }
  checks.push('Save header/body timeouts, server errors and lost confirmations never retry; definite 403/422 rejections allow correction, and committed lost saves are discoverable in My Flips');

  // Signed-out direct reopen and list make no authenticated read.
  for(const path of [`/items?saved=${sourceItem.id}&fixtureSignedOut=1`,'/my-flips?fixtureSignedOut=1']) {
    await cdp('Page.navigate',{url:`http://127.0.0.1:5173${path}`});
    await until(`document.body.textContent.includes('Sign in to')`);
    assert.equal(await evaluate('window.savedItemRequests.length'),0);
  }
  await signedItems();
  await evaluate(`window.switchFixtureUser('other-user')`);
  await click('a','My Flips'); await until(`document.body.textContent.includes('No saved items yet')`);
  await cdp('Page.navigate',{url:`http://127.0.0.1:5173/items?saved=9999999`});
  await until(hasAlert('Item not found.'));
  const missingText=await evaluate(`document.querySelector('[role="alert"] p').textContent`);
  await cdp('Page.navigate',{url:`http://127.0.0.1:5173/items?saved=${sourceItem.id}`});
  await until(`Boolean(document.getElementById('item-notes'))`);
  await evaluate(`window.switchFixtureUser('other-user')`);
  await until(hasAlert('Item not found.'));
  assert.equal(await evaluate(`document.querySelector('[role="alert"] p').textContent`),missingText);
  assert.equal(await evaluate(`document.body.textContent.includes('Saved result for')`),false);
  assert.equal(await evaluate(`Boolean(document.getElementById('item-notes'))`),false);
  checks.push('Signed-out reopen/list issue no requests, owner changes clear restored data, and foreign/missing IDs show identical not-found messages');

  await signedItems(dresser); await fill(`document.getElementById('item-notes')`,'private note');
  await calculateItems('stretch');
  await evaluate(`window.switchFixtureUser('other-user')`);
  await until(`document.getElementById('item-notes')?.value === ''`);
  assert.equal(await evaluate(`(${itemInput('purchase_price')}).value`),'');
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-item-status]'))`),false);
  await evaluate(`window.switchFixtureUser(null)`);
  await until(`document.body.textContent.includes('Sign in to save item')`);
  await signedItems(dresser); await evaluate(`window.authFixture={calls:0,delayMs:350}`);
  await click('button','Save item'); await evaluate(`window.switchFixtureUser('other-user')`); await pause(450);
  assert.equal(await evaluate('window.savedItemRequests.filter(r=>r.method==="POST").length'),0);
  // A read already on the wire may finish after the new account's 404.
  await signedItems(); await evaluate(`window.savedItemMode='delayed-read'`);
  await click('a','My Flips'); await until(`window.savedItemRequests.length>0`);
  await evaluate(`window.switchFixtureUser('other-user')`); await pause(750);
  assert.ok(await evaluate(`document.body.textContent.includes('No saved items yet')`));
  assert.equal(await evaluate(`document.querySelectorAll('[data-saved-item]').length`),0);
  checks.push('Account switches clear unsaved/restored forms, notes, results and lists, cancel pre-token saves and suppress stale owner responses');

  for(let i=0;i<22;i++) await itemApi('/api/items/save',{inputs:{item_name:`Paging ${i}`}},'browser-fixture',201);
  await cdp('Page.navigate',{url:'http://127.0.0.1:5173/my-flips'});
  await until(`document.querySelectorAll('[data-saved-item]').length===20`);
  const firstPage=await evaluate(`[...document.querySelectorAll('[data-saved-item]')].map(e=>Number(e.dataset.savedItem))`);
  await click('button','Load more'); await until(`document.querySelectorAll('[data-saved-item]').length>20`);
  const allPage=await evaluate(`[...document.querySelectorAll('[data-saved-item]')].map(e=>Number(e.dataset.savedItem))`);
  assert.deepEqual(allPage.slice(0,20),firstPage); assert.equal(new Set(allPage).size,allPage.length);
  assert.deepEqual(allPage,[...allPage].sort((a,b)=>b-a));
  await signedItems(); await evaluate(`window.savedItemMode='hostile-link'`); await click('a','My Flips');
  await until(`document.querySelectorAll('[data-saved-item]').length===20`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-saved-item] a[target="_blank"]').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-saved-item] img').length`),0);
  checks.push('My Flips paginates newest-first without fake grouping or duplicate cards and rejects hostile stored links while rendering notes as text');

  for(const mode of ['headers','body','403']) {
    await signedItems(); await evaluate(`window.savedItemMode=${JSON.stringify(mode)}`); await click('a','My Flips');
    await until(hasAlert(mode==='403'?'session':'took too long'));
    assert.equal(await evaluate('window.savedItemRequests.length'),1);
    await evaluate(`window.savedItemMode='pass'`); await click('button','Try loading again');
    await until(`document.querySelectorAll('[data-saved-item]').length>0`);
  }
  assert.deepEqual(await api('/api/deals'),originalHouses);
  checks.push('Saved list read deadlines and auth errors recover only on user retry; existing house records remain unchanged');

  // Styling coverage uses real isolated saves. The existing auth/paging checks
  // above stay intact; a held GET makes the loading state deterministic.
  const visualInputs = Object.fromEntries(Object.entries(dresser).map(([key,value])=>[key,Number(value)]));
  const visualParent = await itemApi('/api/items/save',{inputs:{...visualInputs,item_name:'Walnut dresser'}},'browser-fixture',201);
  const visualCases = [];
  for (const [name,changes] of [['Needs details',{repairs:null}],['Offer without asking price',{purchase_price:null}],['Within target',{hours:0,target_profit:30}],['Above target',{purchase_price:500}]]) {
    visualCases.push(await itemApi('/api/items/save',{inputs:{...visualInputs,...changes,item_name:name}},'browser-fixture',201));
  }
  const longTitle = 'Solid wood dresser with a very long description ' + 'X'.repeat(150);
  const multilineNotes = 'Check the drawer runners.\nKeep the original hardware.\n' + 'Finish condition needs a closer look. '.repeat(10);
  const visualChild = await itemApi('/api/items/save',{inputs:{...visualInputs,item_name:longTitle},parent_item_id:visualParent.id,notes:multilineNotes,listing_url:'https://example.com/dresser'},'browser-fixture',201);
  visualCases.push(visualChild);
  assert.equal(new Set(visualCases.map(item=>item.analysis_result.status)).size,5);
  const houseAppearance = () => measure(`(()=>{const b=getComputedStyle(document.body),r=getComputedStyle(document.getElementById('root'));return {background:b.backgroundColor,image:b.backgroundImage,color:b.color,padding:r.padding,maxWidth:r.maxWidth};})()`);
  async function flipsGeometry() {
    assert.ok(await measure('document.documentElement.scrollWidth <= innerWidth'), 'My Flips must fit the viewport');
    assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),'rgb(250, 246, 238)');
    assert.ok(await measure(`Array.from(document.querySelectorAll('.my-flips a,.my-flips button,.my-flips summary')).filter(e=>e.getBoundingClientRect().height).every(e=>e.getBoundingClientRect().height>=44)`),'Visible actions must retain 44px targets');
    assert.ok(await measure(`Array.from(document.querySelectorAll('[data-saved-item]')).every(e=>e.scrollWidth<=e.clientWidth)`),'No card may need sideways scrolling');
    assert.ok(await evaluate(`document.body.textContent.includes('Saved items can’t be deleted yet.')`));
  }
  for (const width of [390,1440]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390});
    await cdp('Page.navigate',{url:'http://127.0.0.1:5173/'});
    await until(`Boolean(document.querySelector('a[href="/items"]'))`);
    const darkHouse = await houseAppearance();
    assert.notEqual(darkHouse.background,'rgb(250, 246, 238)');
    await signedItems(); await evaluate(`window.savedItemMode='hold-list'`); await click('a','My Flips');
    await until(`typeof window.releaseSavedItemList==='function' && document.body.textContent.includes('Loading saved items.')`);
    await flipsGeometry(); await screenshot(`my-flips-loading-${width}.png`);
    await evaluate(`window.savedItemMode='pass';window.releaseSavedItemList()`);
    await until(`document.querySelectorAll('[data-saved-item]').length===20`);
    for (const item of visualCases) {
      const selector = `[data-saved-item="${item.id}"]`;
      assert.equal(await evaluate(`document.querySelector('${selector} .flips-status').textContent`),ITEM_STATUS_TEXT[item.analysis_result.status].title);
      assert.ok(await evaluate(`document.querySelector('${selector} .flips-meta').textContent.includes('Version #${item.id}')`));
      assert.equal(await evaluate(`document.querySelector('${selector} time').textContent`),await evaluate(`new Date(${JSON.stringify(item.created_at)}).toLocaleString('en-US')`));
      assert.equal(await evaluate(`document.querySelector('${selector} [aria-label="Reopen saved item ${item.id}"]').getAttribute('href')`),`/items?saved=${item.id}`);
      if(item.analysis_result.low) assert.equal(await evaluate(`document.querySelector('${selector} .flips-offer strong').textContent`),formatItemMoney(item.analysis_result.low.max_offer,true));
    }
    const childSelector = `[data-saved-item="${visualChild.id}"]`;
    assert.equal(await evaluate(`document.querySelector('${childSelector} h2').textContent`),longTitle);
    assert.equal(await evaluate(`document.querySelector('${childSelector} .flips-parent').textContent`),`New version of #${visualParent.id}`);
    assert.equal(await evaluate(`document.querySelector('${childSelector} .flips-offer strong').textContent`),'-$50');
    assert.equal(await measure(`getComputedStyle(document.querySelector('${childSelector} .flips-offer strong')).fontVariantNumeric`),'normal', 'Negative headline uses natural glyph spacing, not padded tabular figures');
    assert.ok(await evaluate(`document.querySelector('${childSelector} .flips-caution').textContent.includes('Even a free item misses')`));
    assert.equal(await evaluate(`document.querySelector('${childSelector} a[target="_blank"]').rel`),'noopener noreferrer');
    await evaluate(`document.querySelector('${childSelector} summary').click()`);
    assert.equal(await evaluate(`document.querySelector('${childSelector} details p').textContent`),multilineNotes);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${childSelector} details p')).whiteSpace`),'pre-wrap');
    await evaluate(`document.querySelector('${childSelector} .flips-primary').focus()`);
    assert.equal(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`),'solid');
    await flipsGeometry(); await screenshot(`my-flips-cards-${width}.png`);

    const firstIds = await evaluate(`Array.from(document.querySelectorAll('[data-saved-item]')).map(e=>Number(e.dataset.savedItem))`);
    const readCount = await evaluate('window.savedItemRequests.length');
    await evaluate(`window.savedItemMode='hold-list';const b=${byText('button','Load more')};b.click();b.click()`);
    await until(`window.savedItemRequests.length===${readCount+1} && ${byText('button','Load more')}.disabled`);
    await evaluate(`window.savedItemMode='pass';window.releaseSavedItemList()`);
    await until(`document.querySelectorAll('[data-saved-item]').length>20`);
    const nextIds = await evaluate(`Array.from(document.querySelectorAll('[data-saved-item]')).map(e=>Number(e.dataset.savedItem))`);
    assert.deepEqual(nextIds.slice(0,20),firstIds); assert.equal(new Set(nextIds).size,nextIds.length);
    assert.deepEqual(nextIds,[...nextIds].sort((a,b)=>b-a));
    await flipsGeometry();
    assert.ok(await evaluate(`window.savedItemRequests.every(r=>r.method==='GET')`),'Viewing and paging must not save');
    await click('a','Back to Houses'); await until(`!document.querySelector('.my-flips') && Boolean(document.querySelector('a[href="/items"]'))`);
    assert.deepEqual(await houseAppearance(),darkHouse,'Cream background and root sizing must not spill into Houses');
    await screenshot(`my-flips-back-to-houses-${width}.png`);

    await signedItems(); await evaluate(`window.savedItemMode='403'`); await click('a','My Flips');
    await until(hasAlert('session')); await flipsGeometry(); await screenshot(`my-flips-error-${width}.png`);
    assert.equal(await evaluate('window.savedItemRequests.length'),1);
    await evaluate(`window.savedItemMode='pass'`); await click('button','Try loading again');
    await until(`document.querySelectorAll('[data-saved-item]').length===20`);
    assert.equal(await evaluate('window.savedItemRequests.length'),2);
    await evaluate(`window.switchFixtureUser('empty-visual-user')`);
    await until(`document.body.textContent.includes('No saved items yet.')`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-saved-item]').length`),0);
    await flipsGeometry(); await screenshot(`my-flips-empty-${width}.png`);
    await cdp('Page.navigate',{url:'http://127.0.0.1:5173/my-flips?fixtureSignedOut=1&fixtureAuthLoading=1'});
    await until(`document.body.textContent.includes('Loading sign-in…')`);
    await flipsGeometry(); assert.equal(await evaluate('window.savedItemRequests.length'),0);
    await evaluate(`window.switchFixtureUser(null)`); await until(`Boolean(${byText('button','Sign in to view My Flips')})`);
    await flipsGeometry(); await screenshot(`my-flips-signed-out-${width}.png`);
    assert.equal(await evaluate('window.savedItemRequests.length'),0);
  }
  for(const item of [...visualCases,visualParent]) assert.deepEqual(await itemApi(`/api/items/${item.id}`),item);
  assert.deepEqual(await api('/api/deals'),originalHouses);
  checks.push('My Flips at 390/1440 preserves all five server status labels, negative offers, local timestamps, version lineage, long titles and multiline notes without overflow');
  checks.push('My Flips loading, empty, error/retry, Load more, auth-loading and signed-out states fit both widths; paging locks duplicates and viewing makes no writes');
  checks.push('My Flips cream theme and root sizing disappear on Back to Houses; house styles and all saved fixtures remain unchanged');
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:savedItemsFixture});
  await runPhotoItemChecks({ cdp, evaluate, until, fill, click, measure, screenshot, pause, checks, api });
  const photoFind = (await itemApi('/api/items')).items.find(item=>item.assessment);
  assert.ok(photoFind);
  await cdp('Page.navigate',{url:'http://127.0.0.1:5173/my-flips'});
  await until(`Boolean(document.querySelector('[aria-label="Reopen saved item ${photoFind.id}"]'))`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Reopen saved item ${photoFind.id}"]').getAttribute('href')`),`/items?find=${photoFind.id}`);
  await evaluate(`document.querySelector('[aria-label="Reopen saved item ${photoFind.id}"]').click()`);
  await until(`Boolean(document.querySelector('.items-quick')) && Boolean(document.getElementById('item-notes'))`);
  assert.deepEqual(await itemApi(`/api/items/${photoFind.id}`),photoFind);
  checks.push('Restyled My Flips retains the exact accessible Reopen link and opens photo finds in the photo screen without changing their snapshot');
  assert.deepEqual(errors, []);
  checks.push("No browser runtime exceptions");
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ checks, first: first.analysis_result, second: second.analysis_result, bids: { baseline, bidA, bidB, samePrice, mismatch, selected } }, null, 2));
  console.log(JSON.stringify({ result: "PASS", checks }));
} catch (error) {
  console.error(error);
  if (socket && sessionId) {
    try { console.error('FAILURE_UI', await evaluate(`JSON.stringify({path:location.pathname+location.search,text:document.body.innerText.slice(-7000),requests:window.savedItemRequests})`)); } catch {}
    try { writeFileSync(join(artifacts, "failure.html"), await evaluate("document.documentElement.outerHTML")); await screenshot("failure.png"); } catch {}
  }
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const child of children) child.kill("SIGTERM");
  for (const waiter of pending.values()) waiter.reject(new Error("Browser test closed"));
  setTimeout(() => { rmSync(temp, { recursive: true, force: true }); }, 1000).unref();
}
