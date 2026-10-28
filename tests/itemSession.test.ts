import test from 'node:test';
import assert from 'node:assert/strict';
import { runItemSession, ItemSignInError, ItemSessionChangedError, ITEM_SIGN_IN_MESSAGE } from '../src/lib/itemSession.ts';
const rejected = (status = 401) => Object.assign(new Error('Invalid token: private decoder detail'), { status });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const controller = new AbortController();
  let current = true;
  const options: unknown[] = [];
  return { controller, options, change: () => { current = false; },
    operation: { signal: controller.signal, isCurrent: () => current,
      getToken: async (option?: { skipCache?: boolean }) => { options.push(option); return option?.skipCache ? 'fresh' : 'old'; } } };
}

test('401 refreshes once with cache bypass, reuses captured closure/payload and signal', async () => {
  const f = fixture(), editable = { price: 20, request_id: 'one-id' };
  const payload = structuredClone(editable), attempts: unknown[] = [];
  const result = await runItemSession(f.operation, async (token, signal) => {
    attempts.push({ token, payload }); assert.equal(signal, f.controller.signal);
    if (token === 'old') { editable.price = 99; throw rejected(); }
    return payload;
  });
  assert.deepEqual(f.options, [undefined, { skipCache: true }]);
  assert.deepEqual(attempts, [{ token: 'old', payload }, { token: 'fresh', payload }]);
  assert.equal(result.price, 20); assert.equal(result.request_id, 'one-id');
});

test('second 401 stops and replaces all raw server text', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(runItemSession(f.operation, async () => { calls++; throw rejected(); }), error =>
    error instanceof ItemSignInError && error.status === 401 && error.message === ITEM_SIGN_IN_MESSAGE);
  assert.equal(calls, 2); assert.equal(f.options.length, 2);
});

for (const failure of [rejected(403), rejected(404), rejected(409), rejected(422), rejected(429), rejected(500), rejected(503), new TypeError('network lost'), new Error('uncertain save')]) {
  test(`never refresh or retry ${'status' in failure ? failure.status : failure.message}`, async () => {
    const f = fixture(); let calls = 0;
    await assert.rejects(runItemSession(f.operation, async () => { calls++; throw failure; }), error => error === failure);
    assert.equal(calls, 1); assert.deepEqual(f.options, [undefined]);
  });
}
for (const mode of ['null', 'reject', 'hang'] as const) {
  test(`refresh ${mode} gives sign-in guidance, no second HTTP request`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(); let calls = 0;
    f.operation.getToken = async option => {
      f.options.push(option); if (!option?.skipCache) return 'old';
      if (mode === 'reject') throw new Error('private SDK text');
      if (mode === 'hang') return new Promise<string>(() => {});
      return null as unknown as string;
    };
    const promise = runItemSession(f.operation, async () => { calls++; throw rejected(); });
    const check = assert.rejects(promise, error => error instanceof ItemSignInError && error.message === ITEM_SIGN_IN_MESSAGE);
    await flush(); t.mock.timers.tick(10_000); await check;
    assert.equal(calls, 1); assert.equal(f.options.length, 2);
  });
}

test('account/session change during refresh never retries with the arriving token', async () => {
  const f = fixture(); let release!: (token: string) => void, calls = 0;
  f.operation.getToken = async option => option?.skipCache ? new Promise<string>(resolve => { release = resolve; }) : 'old';
  const promise = runItemSession(f.operation, async () => { calls++; throw rejected(); });
  const check = assert.rejects(promise, ItemSessionChangedError);
  await flush(); f.change(); release('another-account-token'); await check; assert.equal(calls, 1);
});

test('identity invalidation before refresh and before result application both discard work', async () => {
  for (const succeed of [false, true]) {
    const f = fixture(); let calls = 0;
    await assert.rejects(runItemSession(f.operation, async () => {
      calls++; f.change(); if (!succeed) throw rejected(); return 'private result';
    }), ItemSessionChangedError);
    assert.equal(calls, 1); assert.deepEqual(f.options, [undefined]);
  }
});

test('operation deadline expires during refresh: no new request, late token ignored', async () => {
  const f = fixture(); let release!: (token: string) => void, calls = 0;
  f.operation.getToken = async option => option?.skipCache ? new Promise<string>(resolve => { release = resolve; }) : 'old';
  const promise = runItemSession(f.operation, async () => { calls++; throw rejected(); });
  const check = assert.rejects(promise, ItemSignInError);
  await flush(); f.controller.abort(); await check; release('fresh'); await flush(); assert.equal(calls, 1);
});

test('initial token failure sends nothing and cannot expose SDK details', async () => {
  const f = fixture(); let calls = 0;
  f.operation.getToken = async () => { throw new Error('private SDK detail'); };
  await assert.rejects(runItemSession(f.operation, async () => { calls++; }), ItemSignInError);
  assert.equal(calls, 0);
});
