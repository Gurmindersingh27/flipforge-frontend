import test from "node:test";
import assert from "node:assert/strict";
import { readAssessmentRecovery, rememberAssessment, clearAssessmentRecovery } from "../src/lib/itemAssessmentRecovery.ts";

const id = "12345678-1234-4234-8234-123456789abc";
const next = "12345678-1234-4234-8234-123456789abd";
const key = (user: string) => "flipforge:item-assessment:" + user;

test("recovery stores only a UUID under the account and ignores stale clears", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); },
    removeItem: (k: string) => { values.delete(k); },
  } });
  try {
    assert.equal(rememberAssessment("alice", id), true);
    assert.deepEqual([...values], [[key("alice"), id]]);
    assert.equal(readAssessmentRecovery("alice"), id);
    assert.equal(readAssessmentRecovery("bob"), null);
    rememberAssessment("alice", next);
    clearAssessmentRecovery("alice", id);
    assert.equal(readAssessmentRecovery("alice"), next);
    clearAssessmentRecovery("alice", next);
    assert.equal(readAssessmentRecovery("alice"), null);
    for (const invalid of ["", "not-a-uuid", id + "\n", JSON.stringify({ id }), "12345678-1234-4234-z234-123456789abc"]) {
      values.set(key("alice"), invalid);
      assert.equal(readAssessmentRecovery("alice"), null);
      assert.equal(values.has(key("alice")), false);
      assert.equal(rememberAssessment("alice", invalid), false);
    }
    rememberAssessment("alice", id); clearAssessmentRecovery("alice");
    assert.equal(values.size, 0);
  } finally { Reflect.deleteProperty(globalThis, "sessionStorage"); }
});

test("disabled storage getter and each throwing operation are harmless", () => {
  const fail = () => { throw new Error("Storage denied"); };
  for (const descriptor of [
    { get: fail },
    { value: { getItem: fail, setItem: fail, removeItem: fail } },
    { value: { getItem: () => "garbage", setItem: fail, removeItem: fail } },
  ]) {
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, ...descriptor });
    try {
      assert.equal(readAssessmentRecovery("alice"), null);
      assert.equal(rememberAssessment("alice", id), false);
      assert.doesNotThrow(() => clearAssessmentRecovery("alice"));
      assert.doesNotThrow(() => clearAssessmentRecovery("alice", id));
    } finally { Reflect.deleteProperty(globalThis, "sessionStorage"); }
  }
});
