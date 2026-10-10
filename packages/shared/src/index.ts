// Wire protocol types and shared constants for Final Move.
// These flow between the server, browser client, and agent API.

export type Color = "w" | "b";
export type GameClass = "open" | "human";
export type GameStatus = "waiting" | "live" | "ended" | "aborted";
export type MoveState = "queued" | "submitted" | "sent" | "complete" | "final" | "failed" | "relayed";

export type TimeControl = "3+2" | "5+3" | "10+5";

export interface TimeControlConfig {
  baseSec: number;
  incSec: number;
  label: TimeControl;
}

export const TIME_CONTROLS: Record<TimeControl, TimeControlConfig> = {
  "3+2":  { baseSec: 180,  incSec: 2,  label: "3+2" },
  "5+3":  { baseSec: 300,  incSec: 3,  label: "5+3" },
  "10+5": { baseSec: 600,  incSec: 5,  label: "10+5" },
};

export type GameResult = "white" | "black" | "draw" | "aborted";

export type GameEndReason =
  | "checkmate"
  | "resignation"
  | "timeout"
  | "abandon"
  | "stalemate"
  | "repetition"
  | "fifty-move"
  | "insufficient-material"
  | "agreement"
  | "aborted";

/** On-chain result codes matching FinalMoveLedger.sol */
export const RESULT_CODES = {
  white: 1,
  black: 2,
  draw: 3,
  aborted: 4,
} as const;

// Arc chain ids
export const CHAIN_IDS = {
  testnet: 5042002,
  mainnet: 5042,
} as const;

// USDC on Arc (both networks — same address, 6 decimals ERC-20 view)
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;

// Circle chain codes
export const CIRCLE_CHAIN_TESTNET = "ARC-TESTNET";
export const CIRCLE_CHAIN_MAINNET = "ARC";

// Gas / top-up parameters (values from docs/arc-facts.md)
export const GAS_MIN_USDC6 = 100_000n;       // 0.10 USDC in 6-decimal units
export const GAS_TOPUP_USDC6 = 250_000n;     // 0.25 USDC
export const GAS_TOPUP_DAILY_CAP_USDC6 = 25_000_000n; // 25 USDC

// ── WebSocket / REST wire types ──────────────────────────────────────────────

export interface WsHello {
  type: "hello";
  agentId: string;
  name: string;
}

export interface WsGameStart {
  type: "game_start";
  gameId: string;
  color: Color;
  opponent: { name: string; kind: "human" | "agent" | "bot" };
  timeControl: TimeControlConfig;
}

export interface WsYourTurn {
  type: "your_turn";
  gameId: string;
  ply: number;
  fen: string;
  moves: string[];       // legal UCIs
  clockMs: { w: number; b: number };
}

export interface WsMoveAck {
  type: "move_ack";
  gameId: string;
  ply: number;
  uci: string;
}

export interface WsMoveRejected {
  type: "move_rejected";
  gameId: string;
  reason: string;
}

export interface WsOpponentMove {
  type: "opponent_move";
  gameId: string;
  ply: number;
  uci: string;
  fen: string;
  clockMs: { w: number; b: number };
}

export interface WsDrawOffered {
  type: "draw_offered";
  gameId: string;
}

export interface WsChainUpdate {
  type: "chain";
  gameId: string;
  ply: number;
  txHash: string;
  state: MoveState;
  finalMs?: number;
}

export interface WsGameEnd {
  type: "game_end";
  gameId: string;
  result: GameResult;
  reason: GameEndReason;
  ratingAfter?: { mu: number; sigma: number };
}

export type ServerToAgent =
  | WsHello
  | WsGameStart
  | WsYourTurn
  | WsMoveAck
  | WsMoveRejected
  | WsOpponentMove
  | WsDrawOffered
  | WsChainUpdate
  | WsGameEnd;

export interface AgentQueue {
  type: "queue";
  timeControl: TimeControl;
  stake: number;
}

export interface AgentMove {
  type: "move";
  gameId: string;
  uci: string;
}

export interface AgentResign {
  type: "resign";
  gameId: string;
}

export interface AgentOfferDraw {
  type: "offer_draw";
  gameId: string;
}

export interface AgentAcceptDraw {
  type: "accept_draw";
  gameId: string;
}

export interface AgentAcceptChallenge {
  type: "accept_challenge";
  challengeId: string;
}

export type AgentToServer =
  | AgentQueue
  | AgentMove
  | AgentResign
  | AgentOfferDraw
  | AgentAcceptDraw
  | AgentAcceptChallenge;
