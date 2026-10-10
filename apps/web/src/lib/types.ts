/** Types shared between the web client and the server WebSocket protocol. */

export interface PlayerInfo {
  id: string;
  kind: "user" | "bot" | "agent";
  handle: string;
  avatar?: string;
  rating?: number;
  color: "w" | "b";
}

export interface ChainRailEntry {
  ply: number;
  san: string;
  state: "queued" | "sent" | "complete" | "final";
  txHash?: string;
  block?: number;
  finalMs?: number;
  explorerUrl?: string;
}

/** Full game state sent over WS */
export interface WsGameState {
  type: "game_state";
  gameId: string;
  fen: string;
  turn: "w" | "b";
  plyCount: number;
  moves: string[];          // UCI list
  status: "waiting" | "live" | "ended" | "aborted";
  result?: string;
  reason?: string;
  white: PlayerInfo;
  black: PlayerInfo;
  clockWMs: number;
  clockBMs: number;
  chainRail: ChainRailEntry[];
}

export interface WsMoveMsg {
  type: "move";
  gameId: string;
  ply: number;
  uci: string;
  fen: string;
  clockMs: { w: number; b: number };
}

export interface WsChainMsg {
  type: "chain";
  gameId: string;
  ply: number;
  txHash: string;
  state: "sent" | "complete" | "final";
  finalMs?: number;
}

export interface WsGameEndMsg {
  type: "game_end";
  gameId: string;
  result: string;
  reason: string;
}

export interface WsClockMsg {
  type: "clock";
  gameId: string;
  wMs: number;
  bMs: number;
}

export interface WsDrawOfferedMsg {
  type: "draw_offered";
  gameId: string;
  byPlayerId: string;
}

export interface WsRatingDeltaMsg {
  type: "rating_delta";
  gameId: string;
  white: number;
  black: number;
}

export interface WsRematchCreatedMsg {
  type: "rematch_created";
  gameId: string;
  newGameId: string;
}

export interface WsRematchOfferedMsg {
  type: "rematch_offered";
  gameId: string;
  byPlayerId: string;
}

export type WsServerMsg =
  | WsGameState
  | WsMoveMsg
  | WsChainMsg
  | WsGameEndMsg
  | WsClockMsg
  | WsDrawOfferedMsg
  | WsRatingDeltaMsg
  | WsRematchCreatedMsg
  | WsRematchOfferedMsg;

export interface WsClientMove {
  type: "move";
  gameId: string;
  uci: string;
}

export interface WsClientJoin {
  type: "join";
  gameId: string;
  playerId: string;
}
