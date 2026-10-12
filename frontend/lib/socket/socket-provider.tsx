"use client";

/**
 * Socket provider — one connection per authenticated session to the gateway
 * origin. Incoming events are written into the React Query cache (never
 * mirrored into local state), and blocked-message events are re-published on
 * a tiny event bus that the chat page subscribes to for its persistent toast.
 *
 * Note: the socket endpoint behind the gateway is unverified; the provider
 * fails silent-and-reconnecting by design so chat still works via polling of
 * the messages query (React Query refetch) when the socket is down.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { conversationKeys } from "@/lib/api/keys";
import { GATEWAY_URL, getAccessToken } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import type { Message } from "@/lib/api/types";

type SocketContextValue = { socket: Socket | null; connected: boolean };

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

/** Tiny pub/sub so the chat page can raise the blocked-message toast. */
const blockedListeners = new Set<(m: Message) => void>();
export function onBlockedMessage(fn: (m: Message) => void): () => void {
  blockedListeners.add(fn);
  return () => {
    blockedListeners.delete(fn);
  };
}

function mergeMessage(list: Message[] | undefined, msg: Message): Message[] {
  if (!list) return [msg];
  return list.some((m) => m.id === msg.id) ? list : [...list, msg];
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return;
    }
    // Same-origin socket path (Next rewrites /gw/... to the gateway). The JWT
    // travels in the auth payload since the gateway has no CORS headers.
    const socket = io("/gw", {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 10_000,
      auth: { token: getAccessToken() ?? undefined },
    });
    socketRef.current = socket;

    const onNew = (raw: unknown) => {
      const msg = raw as Message;
      if (!msg?.id || !msg.conversationId) return;
      queryClient.setQueryData<Message[]>(
        conversationKeys.messages(msg.conversationId),
        (old) => mergeMessage(old, msg),
      );
    };
    const onBlocked = (raw: unknown) => {
      const msg = raw as Message;
      if (!msg?.id || !msg.conversationId) return;
      queryClient.setQueryData<Message[]>(
        conversationKeys.messages(msg.conversationId),
        (old) => mergeMessage(old, msg),
      );
      blockedListeners.forEach((fn) => fn(msg));
    };

    socket.on("message:new", onNew);
    socket.on("message:blocked", onBlocked);
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [status, user, queryClient]);

  const value = useMemo<SocketContextValue>(
    () => ({ socket: socketRef.current, connected }),
    [connected],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/** Subscribe to one conversation's realtime events. */
export function useConversationSocket(conversationId: string) {
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!socket) return;
    const onEvent = (raw: unknown) => {
      const msg = raw as Message;
      if (!msg?.id || msg.conversationId !== conversationId) return;
      queryClient.setQueryData<Message[]>(conversationKeys.messages(conversationId), (old) =>
        mergeMessage(old, msg),
      );
    };
    socket.on("message:new", onEvent);
    socket.on("message:blocked", onEvent);
    return () => {
      socket.off("message:new", onEvent);
      socket.off("message:blocked", onEvent);
    };
  }, [socket, conversationId, queryClient]);
}
