export const ITEM_SIGN_IN_MESSAGE = 'Sign in again to continue.';
export class ItemSignInError extends Error {
  readonly status = 401;
  constructor() { super(ITEM_SIGN_IN_MESSAGE); }
}
export class ItemSessionChangedError extends Error {
  constructor() { super('The signed-in session changed.'); }
}
type TokenGetter = (options?: { skipCache?: boolean }) => Promise<string | null>;
type SessionOperation = {
  getToken: TokenGetter;
  isCurrent: () => boolean;
  signal: AbortSignal;
};

async function tokenWithinDeadline(operation: SessionOperation, refresh: boolean): Promise<string> {
  if (!operation.isCurrent()) throw new ItemSessionChangedError();
  // Bound Clerk as well as fetch. A failed refresh is a definite auth failure,
  // never an excuse to replay a write that had an uncertain response.
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, token?: string) => {
      clearTimeout(timer); operation.signal.removeEventListener('abort', aborted);
      if (!operation.isCurrent()) reject(new ItemSessionChangedError());
      else if (error) reject(error);
      else resolve(token!);
    };
    const aborted = () => finish(new ItemSignInError());
    const timer = setTimeout(aborted, 10_000);
    operation.signal.addEventListener('abort', aborted, { once: true });
    if (operation.signal.aborted) { aborted(); return; }
    Promise.resolve().then(() => {
      if (!operation.isCurrent() || operation.signal.aborted) throw new ItemSignInError();
      return operation.getToken(refresh ? { skipCache: true } : undefined);
    }).then(token => token ? finish(undefined, token) : finish(new ItemSignInError()), () => finish(new ItemSignInError()));
  });
}

/** One captured closure, at most two HTTP attempts, one total operation deadline.
 * Only an explicit 401 proves that the server did not run the authenticated handler.
 * Unknown failures and all other statuses leave the existing recovery rules intact.
 */
export async function runItemSession<T>(operation: SessionOperation,
  request: (token: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  const check = () => { if (!operation.isCurrent()) throw new ItemSessionChangedError(); };
  check();
  let token = await tokenWithinDeadline(operation, false);
  for (let attempt = 0; attempt < 2; attempt++) {
    check();
    if (operation.signal.aborted) throw new ItemSignInError();
    try {
      const result = await request(token, operation.signal);
      check();
      return result;
    } catch (error) {
      check();
      if (!(error instanceof Error && 'status' in error && error.status === 401)) throw error;
      if (attempt === 1) throw new ItemSignInError();
      check();
      token = await tokenWithinDeadline(operation, true);
    }
  }
  throw new ItemSignInError();
}
