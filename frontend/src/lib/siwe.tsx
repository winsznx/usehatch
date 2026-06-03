/* SIWE session — React Context + module-level mirror.
 *
 * No localStorage / sessionStorage (Section 1.3). The Bearer token lives in
 * React state inside <SiweProvider>; non-React modules read it through the
 * module-level mirror updated by the provider.
 *
 * Page refresh wipes the session — that is the v1 trade-off until the
 * backend issues an httpOnly `hatch_session` cookie on /siwe/verify. Once
 * that lands, this provider will fetch /siwe/me on mount and restore the
 * session transparently; the API client already sends credentials:'include'. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Address } from "viem";

import { ApiUnauthorizedError, api } from "../api.js";

export interface SiweSession {
  token: string;
  wallet: Address;
}

interface SiweContextValue {
  session: SiweSession | null;
  isAuthed: boolean;
  setSession: (session: SiweSession | null) => void;
  signOut: () => Promise<void>;
}

const SiweContext = createContext<SiweContextValue | null>(null);

let moduleToken: string | null = null;
let moduleWallet: Address | null = null;
type Listener = (s: SiweSession | null) => void;
const listeners = new Set<Listener>();

export function getSiweToken(): string | null { return moduleToken; }
export function getSiweWallet(): Address | null { return moduleWallet; }

/** Update the session from non-React callers (legacy primitives, scripts).
 *  The provider subscribes via subscribeSiwe and reflects it into React state. */
export function setSiweSession(s: SiweSession | null): void {
  moduleToken = s?.token ?? null;
  moduleWallet = s?.wallet ?? null;
  for (const l of listeners) l(s);
}

export function subscribeSiwe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function SiweProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SiweSession | null>(null);

  const setSession = useCallback((s: SiweSession | null) => {
    setSiweSession(s);
  }, []);

  // Reflect module-level mirror into React state (covers updates from
  // non-React callers like legacy primitives or push.ts).
  useEffect(() => {
    return subscribeSiwe((s) => setSessionState(s));
  }, []);

  const signOut = useCallback(async () => {
    const t = session?.token;
    if (t) await api.signOut(t).catch(() => undefined);
    setSiweSession(null);
  }, [session?.token]);

  /* Try to restore from a backend-issued httpOnly cookie if one exists.
   * Backend /siwe/me is optional; absence is a no-op. */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    fetch(`${api.baseUrl}/siwe/me`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as { token?: string; wallet?: Address };
        if (data?.token && data?.wallet) setSiweSession({ token: data.token, wallet: data.wallet });
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo<SiweContextValue>(() => ({
    session,
    isAuthed: !!session,
    setSession,
    signOut,
  }), [session, setSession, signOut]);

  return <SiweContext.Provider value={value}>{children}</SiweContext.Provider>;
}

export function useSiweSession(): SiweContextValue {
  const v = useContext(SiweContext);
  if (!v) throw new Error("useSiweSession must be used inside <SiweProvider>");
  return v;
}

/** Build an auth header for non-React callers. */
export function authHeader(): Record<string, string> {
  return moduleToken ? { authorization: `Bearer ${moduleToken}` } : {};
}

/** Convenience: re-throw any 401 from a wrapped call after clearing the session. */
export async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      setSiweSession(null);
    }
    throw e;
  }
}
