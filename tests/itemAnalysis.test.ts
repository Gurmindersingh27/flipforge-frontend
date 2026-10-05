import assert from "node:assert/strict";
import test from "node:test";
import { buildItemRequest, emptyItemForm, formatItemMoney, formatItemPercent, hasPersonalDefault, ITEM_FIELDS, ITEM_PREFERENCES, parseItemNumber } from "../src/lib/itemAnalysis.ts";

test("blank and whitespace mean unknown, but plain zero is a number", () => {
  for (const value of ["", "  ", "\t"]) assert.equal(parseItemNumber(value, "repairs"), null);
  for (const value of ["0", "0.00", " 0 ", "000"]) assert.equal(parseItemNumber(value, "repairs"), 0);
  assert.equal(parseItemNumber(".5", "repairs"), 0.5);
  assert.equal(parseItemNumber("12.", "repairs"), 12);
});
test("every numeric field rejects non-decimal syntax before conversion", () => {
  for (const field of ITEM_FIELDS) for (const value of ["1e3", "12abc", "$1,200", "$12", "1,200", "0x10", "-1", "-0", "+1", "NaN", "Infinity", ".", "1 2", "1_000"]) {
    assert.throws(() => parseItemNumber(value, field), undefined, `${field}: ${value}`);
  }
});
test("percent conversions produce exact approved JSON wire text", () => {
  for (const [text, wire] of [["14.3", "0.143"], ["2.9", "0.029"], ["7.5", "0.075"], ["0.0001", "0.000001"], ["100", "1"], ["0", "0"], ["99.9999", "0.999999"]]) {
    for (const field of ["fee_pct", "contingency_pct"] as const) {
      assert.equal(JSON.stringify(parseItemNumber(text, field)), wire);
      const form = emptyItemForm(); form.useDefault[field] = false; form.values[field] = text;
      const request = buildItemRequest(form); assert.ok(request.ok);
      assert.ok(JSON.stringify(request.payload).includes(`"${field}":${wire}`));
      form.personalDefaults[field] = text; form.useDefault[field] = true;
      const inherited = buildItemRequest(form); assert.ok(inherited.ok);
      assert.equal(JSON.stringify(inherited.payload.personal_defaults?.[field]), wire);
      assert.equal(Object.hasOwn(inherited.payload, field), false);
    }
  }
});
test("percent and hours precision and all field bounds are checked", () => {
  for (const field of ITEM_FIELDS) {
    const max = field.endsWith("_pct") ? "100" : field === "hours" ? "10000" : field === "hourly_value" ? "1000" : "1000000";
    assert.doesNotThrow(() => parseItemNumber(max, field));
    assert.throws(() => parseItemNumber(`${max}.000000000000000001`, field));
  }
  for (const value of ["100.0001", "0.00001", "14.30000", "-0.1"]) assert.throws(() => parseItemNumber(value, "fee_pct"));
  assert.throws(() => parseItemNumber("2.001", "hours"));
  assert.equal(parseItemNumber("2.01", "hours"), 2.01);
  assert.equal(parseItemNumber("20.005", "hourly_value"), 20.005); // Backend normalizes money.
});
test("initial request omits only the two active application defaults", () => {
  const form = emptyItemForm(); const built = buildItemRequest(form); assert.ok(built.ok);
  for (const field of ITEM_FIELDS) {
    if (field === "hourly_value" || field === "contingency_pct") assert.equal(Object.hasOwn(built.payload, field), false);
    else assert.equal(built.payload[field], null);
  }
  assert.equal(Object.hasOwn(built.payload, "personal_defaults"), false);
});
test("default enabled omits, disabled blank sends null, disabled zero sends zero", () => {
  for (const field of ITEM_PREFERENCES) {
    const form = emptyItemForm(); form.personalDefaults[field] = "7.5";
    form.useDefault[field] = true; form.values[field] = "123abc"; // Ignored override text.
    let built = buildItemRequest(form); assert.ok(built.ok); assert.equal(Object.hasOwn(built.payload, field), false);
    form.useDefault[field] = false; form.values[field] = " ";
    built = buildItemRequest(form); assert.ok(built.ok); assert.equal(built.payload[field], null);
    form.values[field] = "0";
    built = buildItemRequest(form); assert.ok(built.ok); assert.equal(built.payload[field], 0);
    assert.equal(built.payload.personal_defaults?.[field], field.endsWith("_pct") ? 0.075 : 7.5);
  }
});
test("personal fee and target controls require a valid supplied default, including zero", () => {
  for (const field of ["fee_pct", "target_profit"] as const) {
    const form = emptyItemForm(); form.useDefault[field] = true;
    assert.equal(hasPersonalDefault(form, field), false);
    const built = buildItemRequest(form); assert.ok(built.ok); assert.equal(built.payload[field], null);
    form.personalDefaults[field] = "0"; assert.equal(hasPersonalDefault(form, field), true);
    form.personalDefaults[field] = "12abc"; assert.equal(hasPersonalDefault(form, field), false);
    assert.equal(buildItemRequest(form).ok, false);
  }
});
test("builder reports invalid defaults and field errors without mutating state", () => {
  const form = emptyItemForm(); form.values.repairs = "$1,200"; form.personalDefaults.fee_pct = "1e3";
  const original = structuredClone(form);
  const built = buildItemRequest(form); assert.equal(built.ok, false);
  if (!built.ok) assert.deepEqual(Object.keys(built.errors).sort(), ["personal_fee_pct", "repairs"]);
  assert.deepEqual(form, original);
});
test("builder validates resale ordering and metadata lengths", () => {
  const form = emptyItemForm(); form.values.resale_low = "300.004"; form.values.resale_high = "300.001";
  assert.equal(buildItemRequest(form).ok, false);
  form.values.resale_high = "300.004"; form.item_name = "x".repeat(200); form.category = "y".repeat(100);
  assert.equal(buildItemRequest(form).ok, true);
  form.category += "x"; assert.equal(buildItemRequest(form).ok, false);
  form.category = ""; form.item_name += "x"; assert.equal(buildItemRequest(form).ok, false);
});
test("Items money always has cents, correct signs and no negative zero", () => {
  for (const [value, expected] of [[0, "$0.00"], [-0, "$0.00"], [-0.004, "$0.00"], [-1.25, "-$1.25"], [100.4, "$100.40"], [1234.5, "$1,234.50"], [0.005, "$0.01"], [-0.005, "-$0.01"]] as const) assert.equal(formatItemMoney(value), expected);
  assert.equal(formatItemMoney(null), "Not available");
  assert.equal(formatItemMoney(-50, true), "-$50");
  assert.equal(formatItemMoney(77, true), "$77");
});
test("percent echoes remain readable at their own precision", () => {
  for (const [value, expected] of [[0.143, "14.3%"], [0.029, "2.9%"], [0.075, "7.5%"], [0.123456, "12.3456%"], [1, "100%"], [0, "0%"]] as const) assert.equal(formatItemPercent(value), expected);
});
