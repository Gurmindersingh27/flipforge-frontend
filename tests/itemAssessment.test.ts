import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { buildAssessmentRequest, formatItemHeadlineMoney, itemDecision, newQuickItemForm, prepareItemPhoto, quickAssumptionsSummary, suggestedRepairTotal } from "../src/lib/itemAssessment.ts";
import { buildSavedItemInputs } from "../src/lib/savedItems.ts";
import type { ItemAnalyzeResponse, ItemAssessmentPhoto, ItemAssessmentResult } from "../src/lib/types.ts";

const photos: ItemAssessmentPhoto[] = [{ media_type: "image/jpeg", data: "fixture" }];

function photoEnvironment(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pictures: StubImage[] = [], revoked: string[] = [], calls: unknown[][] = [];
  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1800;
    naturalHeight = 1200;
    src = "";
    constructor() { pictures.push(this); }
  }
  const context = {
    fillStyle: "",
    fillRect: (...args: unknown[]) => calls.push(["fillRect", ...args]),
    drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
  };
  const canvas = {
    width: 0, height: 0,
    getContext: (kind: string) => { assert.equal(kind, "2d"); return context; },
    toDataURL: (...args: unknown[]) => { calls.push(["toDataURL", ...args]); return "data:image/jpeg;base64,encoded-fixture"; },
  };
  for (const [name, value] of Object.entries({ Image: StubImage, document: {
    createElement: (tag: string) => { calls.push(["createElement", tag]); assert.equal(tag, "canvas"); return canvas; },
  } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
  }
  t.mock.method(URL, "createObjectURL", () => "blob:photo-fixture");
  t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));
  return { pictures, revoked, calls, canvas, context };
}
const photoFile = () => new File(["fixture"], "chair.jpg", { type: "image/jpeg" });
const photoTimeout = "That photo took too long to open. Try another, or enter details below.";

test("stalled photo rejects at 20 seconds, detaches handlers and revokes its blob URL", async t => {
  const env = photoEnvironment(t);
  let settled = false;
  const pending = prepareItemPhoto(photoFile());
  const rejected = assert.rejects(pending, { message: photoTimeout }).then(() => { settled = true; });
  t.mock.timers.tick(19_999); await Promise.resolve();
  assert.equal(settled, false); assert.deepEqual(env.revoked, []);
  t.mock.timers.tick(1); await rejected;
  assert.equal(env.pictures[0].src, "");
  assert.equal(env.pictures[0].onload, null); assert.equal(env.pictures[0].onerror, null);
  assert.deepEqual(env.revoked, ["blob:photo-fixture"]); assert.deepEqual(env.calls, []);
});
test("a queued photo load callback after timeout cannot resume resizing or settle again", async t => {
  const env = photoEnvironment(t);
  const pending = prepareItemPhoto(photoFile());
  const lateLoad = env.pictures[0].onload!;
  const rejected = assert.rejects(pending, { message: photoTimeout });
  t.mock.timers.tick(20_000); await rejected;
  lateLoad(); t.mock.timers.tick(20_000); await Promise.resolve();
  await assert.rejects(pending, { message: photoTimeout });
  assert.deepEqual(env.calls, []); assert.deepEqual(env.revoked, ["blob:photo-fixture"]);
});
test("normal photo resize retains dimensions, white background and JPEG quality and clears its deadline", async t => {
  const env = photoEnvironment(t);
  const pending = prepareItemPhoto(photoFile());
  const picture = env.pictures[0]; picture.onload!();
  assert.deepEqual(await pending, { media_type: "image/jpeg", data: "encoded-fixture" });
  assert.equal(env.canvas.width, 1568); assert.equal(env.canvas.height, 1045);
  assert.equal(env.context.fillStyle, "#fff");
  assert.deepEqual(env.calls, [["createElement", "canvas"], ["fillRect", 0, 0, 1568, 1045],
    ["drawImage", picture, 0, 0, 1568, 1045], ["toDataURL", "image/jpeg", .82]]);
  t.mock.timers.tick(20_000);
  assert.equal(picture.src, "blob:photo-fixture", "Successful load must not be aborted later");
  assert.equal(picture.onload, null); assert.equal(picture.onerror, null);
  assert.deepEqual(env.revoked, ["blob:photo-fixture"]);
});
test("photo request leaves missing asking price omitted for extraction, preserves zero and rejects raw junk", () => {
  for (const blank of ["", "  "]) assert.equal(Object.hasOwn(buildAssessmentRequest("id", "They want $20", blank, photos), "asking_price"), false);
  assert.equal(buildAssessmentRequest("id", "Free chair", "0", photos).asking_price, 0);
  for (const bad of ["1e3", "12abc", "$1,200", "0x10", "-1", "Infinity"]) assert.throws(() => buildAssessmentRequest("id", "Chair", bad, photos));
});
test("photo request validates description and count without blocking ordinary emoji", () => {
  for (const text of ["x".repeat(501), "a\u0000b", "\ud800", "\udc00"]) assert.throws(() => buildAssessmentRequest("id", text, "", photos));
  assert.equal(buildAssessmentRequest("id", "Chair 🪑", "20", photos).description, "Chair 🪑");
  assert.doesNotThrow(() => buildAssessmentRequest("id", "x".repeat(500), "20", [...photos, ...photos, ...photos]));
  for (const set of [[], [...photos, ...photos, ...photos, ...photos]]) assert.throws(() => buildAssessmentRequest("id", "Chair", "", set));
});
test("quick preset is explicit and leaves unknown purchase, resale and repairs unknown", () => {
  const built = buildSavedItemInputs(newQuickItemForm());
  assert.equal(built.ok, true);
  if (!built.ok) throw Error("invalid preset");
  assert.equal(built.payload.target_profit, 30);
  assert.equal(built.payload.contingency_pct, .15);
  for (const key of ["pickup", "delivery", "storage", "fee_pct", "fee_fixed", "hours"] as const) assert.equal(built.payload[key], 0);
  for (const key of ["purchase_price", "resale_low", "resale_high", "repairs"] as const) assert.equal(built.payload[key], null);
});
test("quick editable percentages retain exact wire decimals", () => {
  for (const [percent, wire] of [["14.3", "0.143"], ["2.9", "0.029"], ["7.5", "0.075"]]) {
    const form = newQuickItemForm(); form.values.fee_pct = percent;
    const built = buildSavedItemInputs(form);
    assert.ok(built.ok);
    assert.equal(JSON.stringify(built.payload.fee_pct), wire);
  }
});
test("repair catalog cents sum without floating-point artifacts and empty suggestions total zero", () => {
  const report = { repair_suggestions: [{ materials_cost: .1 }, { materials_cost: .2 }, { materials_cost: 15.99 }] } as ItemAssessmentResult;
  assert.equal(suggestedRepairTotal(report), "16.29");
  assert.equal(suggestedRepairTotal({ repair_suggestions: [] } as unknown as ItemAssessmentResult), "0.00");
});
test("decision copy follows server status even when rounded ceiling equals asking price", () => {
  const result = { status: "skip", low: { max_offer: 100, raw_max_offer: 100.04 }, assumptions: { purchase_price: { value: 100.04 } } } as ItemAnalyzeResponse;
  assert.equal(itemDecision(result), "I'd pass at $100.04. Offer $100 or walk.");
  assert.equal(itemDecision({ ...result, status: "within_budget" }), "Good buy at $100.04.");
  assert.equal(itemDecision({ ...result, status: "stretch" }), "Offer up to $100.");
  assert.equal(itemDecision({ ...result, status: "offer_only" }), "Offer up to $100.");
  assert.equal(itemDecision({ ...result, status: "needs_info" }), "A couple of details first.");
});
test("negative offers stay negative in results and never become a positive buy headline", () => {
  const result = { status: "offer_only", low: { max_offer: -50 }, assumptions: { purchase_price: { value: null } } } as ItemAnalyzeResponse;
  assert.equal(itemDecision(result), "Even free is a tight flip.");
  assert.equal(itemDecision({ ...result, status: "stretch" }), "The profit is too tight at this price.");
  assert.equal(itemDecision({ ...result, status: "skip", assumptions: { purchase_price: { value: 60 } } } as ItemAnalyzeResponse), "I'd pass at $60. Even free misses your profit goal.");
  assert.equal(result.low?.max_offer, -50);
});
test("headline dollars omit only unnecessary cents, preserving fractional boundaries and money elsewhere", () => {
  assert.equal(formatItemHeadlineMoney(20), "$20");
  assert.equal(formatItemHeadlineMoney(20.01), "$20.01");
  assert.equal(formatItemHeadlineMoney(-50), "-$50");
  assert.equal(formatItemHeadlineMoney(0), "$0");
  assert.equal(formatItemHeadlineMoney(null), "Not available");
});
test("compact assumptions reflect changed goals and never describe edited costs as the preset", () => {
  const form = newQuickItemForm();
  assert.equal(quickAssumptionsSummary(form), "Assumes local pickup, no fees, $30 profit goal");
  form.values.target_profit = "40.50";
  assert.equal(quickAssumptionsSummary(form), "Assumes local pickup, no fees, $40.50 profit goal");
  form.values.fee_pct = "14.3";
  assert.equal(quickAssumptionsSummary(form), "Uses your entered costs, $40.50 profit goal");
  form.values.target_profit = "";
  assert.equal(quickAssumptionsSummary(form), "Uses your entered costs, profit goal unknown");
  form.values.target_profit = "1e3";
  assert.equal(quickAssumptionsSummary(form), "Check your costs and profit goal");
  form.useDefault.target_profit = true; form.personalDefaults.target_profit = "55";
  assert.equal(quickAssumptionsSummary(form), "Uses your entered costs, $55 profit goal");
});
