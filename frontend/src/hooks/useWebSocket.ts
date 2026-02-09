import { useRef, useEffect, useCallback, useState } from "react";
import type { Message } from "../types/protocol";

type MessageHandler = (msg: Message) => void;

export function useWebSocket(
  projectId: string,
  token: string | null,
  onMessage: MessageHandler,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!projectId) return;

    // Use VITE_API_URL if set (cross-origin), otherwise same-origin
    const apiUrl = import.meta.env.VITE_API_URL;
    let wsBase: string;
    if (apiUrl) {
      // Convert http(s):// to ws(s)://
      wsBase = apiUrl.replace(/^http/, "ws");
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsBase = `${protocol}//${window.location.host}`;
    }
    // Token is optional - local mode works without auth
    const url = token
      ? `${wsBase}/ws/project/${projectId}?token=${token}`
      : `${wsBase}/ws/project/${projectId}`;

    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let reconnectDelay = 1000;

    function connect() {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay = 1000;
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimeout = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 10000);
          connect();
        }, reconnectDelay);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as Message;
          onMessageRef.current(msg);
        } catch {
          // ignore malformed messages
        }
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [projectId, token]);

  const send = useCallback((msg: Message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, send };
}
