import { useCallback, useLayoutEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { runItemSession } from './itemSession';

/** Items only. No global fetch interceptor and no changes to Houses auth. */
export function useItemSession() {
  const { userId, sessionId, getToken } = useAuth();
  const current = useRef({ userId, sessionId, mounted: false });
  const controllers = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    current.current = { userId, sessionId, mounted: true };
    const pending = controllers.current;
    return () => {
      current.current.mounted = false;
      const outstanding = [...pending];
      // StrictMode immediately sets up the same identity again. Real unmounts
      // abort outstanding reads/writes; identity checks also guard every await.
      queueMicrotask(() => {
        if (!current.current.mounted || current.current.userId !== userId || current.current.sessionId !== sessionId) {
          for (const controller of outstanding) controller.abort();
        }
      });
    };
  }, [userId, sessionId]);
  return useCallback(async <T,>(request: (token: string, signal: AbortSignal) => Promise<T>, isActive: () => boolean = () => true): Promise<T> => {
    const controller = new AbortController();
    controllers.current.add(controller);
    // The original 120-second budget includes token acquisition, refresh, both
    // HTTP attempts and response consumption. Retrying never resets the clock.
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      return await runItemSession({ getToken, signal: controller.signal,
        isCurrent: () => Boolean(userId && sessionId && isActive() && current.current.mounted &&
          current.current.userId === userId && current.current.sessionId === sessionId),
      }, request);
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }, [userId, sessionId, getToken]);
}
