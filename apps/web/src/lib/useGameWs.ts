"use client";
/**
 * WebSocket hook that connects to the server game room.
 * Reconnects automatically with exponential backoff.
 */
import { useEffect, useRef, useCallback, useState } from "react";
import type { WsServerMsg, WsGameState, ChainRailEntry } from "./types";

export interface GameWsState {
  connected: boolean;
  gameState: WsGameState | null;
  chainRail: ChainRailEntry[];
  sendMove: (uci: string) => void;
  drawOfferedBy: string | null;
  ratingDelta: { white: number; black: number } | null;
  rematchGameId: string | null;
}

export function useGameWs(gameId: string, playerId: string): GameWsState {
  const [connected, setConnected]       = useState(false);
  const [gameState, setGameState]       = useState<WsGameState | null>(null);
  const [chainRail, setChainRail]       = useState<ChainRailEntry[]>([]);
  const [drawOfferedBy, setDrawOfferedBy] = useState<string | null>(null);
  const [ratingDelta, setRatingDelta]   = useState<{ white: number; black: number } | null>(null);
  const [rematchGameId, setRematchGameId] = useState<string | null>(null);
  const wsRef                         = useRef<WebSocket | null>(null);
  const retryRef                      = useRef(0);
  const deadRef                       = useRef(false);

  const connect = useCallback(() => {
    if (deadRef.current) return;
    // NEXT_PUBLIC_WS_URL: explicit WebSocket base (e.g. wss://api.finalmove.io)
    //   — used in the separate-origin deploy (API behind its own domain/port).
    // When absent, fall back to same-origin /ws so a reverse proxy or the
    //   sandbox proxy.mjs can handle the upgrade transparently.
    const explicitWsUrl = process.env.NEXT_PUBLIC_WS_URL;
    const url = explicitWsUrl
      ? `${explicitWsUrl}/ws`
      : (() => {
          const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
          return `${proto}//${window.location.host}/ws`;
        })();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryRef.current = 0;
      ws.send(JSON.stringify({ type: "join", gameId, playerId }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsServerMsg;
        handleMsg(msg);
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      if (deadRef.current) return;
      const delay = Math.min(8000, 500 * 2 ** retryRef.current++);
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, [gameId, playerId]);

  const handleMsg = useCallback((msg: WsServerMsg) => {
    switch (msg.type) {
      case "game_state":
        setGameState(msg);
        setChainRail(msg.chainRail ?? []);
        break;
      case "move":
        setGameState((prev) => {
          if (!prev) return prev;
          return { ...prev, fen: msg.fen, plyCount: msg.ply, clockWMs: msg.clockMs.w, clockBMs: msg.clockMs.b, turn: msg.ply % 2 === 0 ? "w" : "b" };
        });
        setChainRail((prev) => {
          const exists = prev.find((e) => e.ply === msg.ply);
          if (exists) return prev;
          return [{ ply: msg.ply, san: msg.uci, state: "queued" }, ...prev];
        });
        break;
      case "chain":
        setChainRail((prev) =>
          prev.map((e) =>
            e.ply === msg.ply
              ? { ...e, state: msg.state, txHash: msg.txHash, finalMs: msg.finalMs }
              : e,
          ),
        );
        break;
      case "game_end":
        setGameState((prev) =>
          prev ? { ...prev, status: "ended", result: msg.result, reason: msg.reason } : prev,
        );
        break;
      case "clock":
        setGameState((prev) =>
          prev ? { ...prev, clockWMs: msg.wMs, clockBMs: msg.bMs } : prev,
        );
        break;
      case "draw_offered":
        setDrawOfferedBy(msg.byPlayerId);
        break;
      case "rating_delta":
        setRatingDelta({ white: msg.white, black: msg.black });
        break;
      case "rematch_created":
        setRematchGameId(msg.newGameId);
        break;
      case "rematch_offered":
        // Handled by UI polling
        break;
    }
  }, []);

  useEffect(() => {
    deadRef.current = false;
    connect();
    return () => {
      deadRef.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMove = useCallback(
    (uci: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "move", gameId, uci }));
      }
    },
    [gameId],
  );

  return { connected, gameState, chainRail, sendMove, drawOfferedBy, ratingDelta, rematchGameId };
}
