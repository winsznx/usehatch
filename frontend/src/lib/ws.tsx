/* Hatch WebSocket — single shared connection + per-channel subscriptions.
 *
 * The token travels via the WebSocket subprotocol slot (sec-websocket-protocol),
 * which is the only auth header the browser permits on `new WebSocket(url,
 * protocols)`. Backend reads it during the upgrade handshake.
 *
 * Lifecycle: provider opens a single socket, multiplexes subscriptions,
 * auto-reconnects with capped exponential backoff. Hooks register listeners
 * by topic; cleanup unsubscribes — the socket stays warm even if zero hooks
 * are active. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";

import { config } from "./config.js";
import { qk } from "./queries.js";
import { useSiweSession } from "./siwe.js";

export interface HatchRevealedEvent { type: "hatch:revealed"; uuid: number; revealedAt: string; publisherRootIp: Address }
export interface HatchStatusEvent   { type: "hatch:status";   uuid: number; status: "sealed" | "active" | "revealed" | "resolved" }
export interface NotificationEvent  { type: "notification:new"; id: string; wallet: Address; payload: unknown }
export type WsEvent = HatchRevealedEvent | HatchStatusEvent | NotificationEvent;

type Listener = (ev: WsEvent) => void;

interface WsContextValue {
  isConnected: boolean;
  subscribe: (listener: Listener) => () => void;
  send: (data: unknown) => void;
}

const WsContext = createContext<WsContextValue | null>(null);

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 750;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { session } = useSiweSession();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const closedManuallyRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  const send = useCallback((data: unknown) => {
    const s = socketRef.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(typeof data === "string" ? data : JSON.stringify(data));
  }, []);

  useEffect(() => {
    closedManuallyRef.current = false;

    function connect() {
      const wsBase = config.backendUrl.replace(/^http/, "ws");
      const protocols = session?.token ? [`hatch.bearer.${session.token}`] : undefined;
      const url = `${wsBase}/ws`;

      let s: WebSocket;
      try {
        s = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = s;

      s.addEventListener("open", () => {
        backoffRef.current = INITIAL_BACKOFF_MS;
        setIsConnected(true);
      });
      s.addEventListener("close", () => {
        setIsConnected(false);
        if (!closedManuallyRef.current) scheduleReconnect();
      });
      s.addEventListener("error", () => { /* close follows */ });
      s.addEventListener("message", (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : "";
        if (!raw) return;
        let parsed: WsEvent | null = null;
        try { parsed = JSON.parse(raw) as WsEvent; } catch { return; }
        if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
        for (const l of listenersRef.current) l(parsed);
      });
    }

    function scheduleReconnect() {
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    }

    connect();

    return () => {
      closedManuallyRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      const s = socketRef.current;
      socketRef.current = null;
      if (s && (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING)) s.close();
      setIsConnected(false);
    };
  }, [session?.token]);

  const value = useMemo<WsContextValue>(() => ({ isConnected, subscribe, send }), [isConnected, subscribe, send]);
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

function useWs(): WsContextValue {
  const v = useContext(WsContext);
  if (!v) throw new Error("WS hooks must be used inside <WebSocketProvider>");
  return v;
}

/** React to status flips for a single hatch — invalidates the hatch query
 *  when its status changes, so the consumer just calls useQuery(qk.hatch(uuid)). */
export function useHatchStatus(uuid: number | undefined): { isConnected: boolean } {
  const ws = useWs();
  const qc = useQueryClient();

  useEffect(() => {
    if (uuid === undefined) return;
    return ws.subscribe((ev) => {
      if (ev.type === "hatch:revealed" && ev.uuid === uuid) {
        qc.invalidateQueries({ queryKey: qk.hatch(uuid) });
        qc.invalidateQueries({ queryKey: qk.hatchReveal(uuid) });
      } else if (ev.type === "hatch:status" && ev.uuid === uuid) {
        qc.invalidateQueries({ queryKey: qk.hatch(uuid) });
      }
    });
  }, [uuid, ws, qc]);

  return { isConnected: ws.isConnected };
}

/** Followed publishers' feed — invalidates the global hatches list on any
 *  status flip from a followed publisher. The publisher filter happens at the
 *  query layer; we just refetch. */
export function useMyPublishersFeed(wallet: Address | undefined): { isConnected: boolean } {
  const ws = useWs();
  const qc = useQueryClient();

  useEffect(() => {
    if (!wallet) return;
    return ws.subscribe((ev) => {
      if (ev.type === "hatch:revealed" || ev.type === "hatch:status") {
        qc.invalidateQueries({ queryKey: qk.hatches() });
      }
    });
  }, [wallet, ws, qc]);

  return { isConnected: ws.isConnected };
}

/** Notification stream — caller's listener receives each new notification.
 *  Pair with React state in the bell-popover component. */
export function useNotifications(
  wallet: Address | undefined,
  onNotification: (ev: NotificationEvent) => void,
): { isConnected: boolean } {
  const ws = useWs();
  const handler = useRef(onNotification);
  handler.current = onNotification;

  useEffect(() => {
    if (!wallet) return;
    return ws.subscribe((ev) => {
      if (ev.type === "notification:new" && ev.wallet.toLowerCase() === wallet.toLowerCase()) {
        handler.current(ev);
      }
    });
  }, [wallet, ws]);

  return { isConnected: ws.isConnected };
}
