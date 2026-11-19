// Types shared by the server and the browser client.

export type TeamId = 0 | 1;

export interface AvatarConfig {
  base: number; // index into AVATAR_BASES
  color: number; // index into AVATAR_COLORS
  hat: number; // index into AVATAR_HATS
  accessory: number; // index into AVATAR_ACCESSORIES
  face: number; // index into AVATAR_FACES
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: AvatarConfig;
  team: TeamId | null;
  connected: boolean;
}

export type Phase =
  | "lobby"
  | "roundIntro"
  | "faceoff"
  | "playOrPass"
  | "play"
  | "steal"
  | "roundEnd"
  | "gameOver"
  | "fmIntro"
  | "fmPlay"
  | "fmReveal"
  | "fmEnd";

export interface BoardSlot {
  revealed: boolean;
  label?: string;
  points?: number;
  /** real December pageviews behind this answer (shown after reveal) */
  views?: number;
}

export type FaceoffStage = "ready" | "live" | "first" | "second";

export interface FaceoffView {
  stage: FaceoffStage;
  /** [team0 player, team1 player] */
  players: [string | null, string | null];
  /** who buzzed first */
  buzzed: string | null;
  /** answers given so far in this face-off */
  attempts: { playerId: string; text: string; slot: number | null }[];
}

export interface GuessView {
  playerId: string;
  text: string;
  result: "hit" | "miss" | "timeout" | "dupe";
  slot?: number;
  /** when a guess matched a real survey answer that didn't make the board */
  offBoard?: { label: string; points: number };
}

export interface RoundView {
  number: number;
  multiplier: number;
  suddenDeath: boolean;
  question: string;
  slots: BoardSlot[];
  bank: number;
  strikes: number;
  controlling: TeamId | null;
  activePlayerId: string | null;
  faceoff: FaceoffView;
  faceoffWinner: string | null;
  stealPlayerId: string | null;
  lastGuess: GuessView | null;
  outcome: { team: TeamId | null; points: number; reason: "cleared" | "stolen" | "defended" | "suddenDeath" | "skipped" } | null;
}

export interface FmAnswerView {
  /** hidden while the other player is answering */
  text: string | null;
  label: string | null;
  points: number | null;
  revealed: boolean;
}

export interface FastMoneyView {
  team: TeamId;
  players: [string, string];
  turn: 0 | 1;
  prompts: string[];
  answers: [FmAnswerView[], FmAnswerView[]];
  /** index of the question the active player is looking at */
  cursor: number;
  total: number;
  target: number;
  revealStep: number;
  won: boolean | null;
}

export interface TimerView {
  endsAt: number;
  total: number;
}

export type GameEventType =
  | "join"
  | "roundStart"
  | "buzz"
  | "reveal"
  | "strike"
  | "dupe"
  | "faceoffWin"
  | "control"
  | "stealStart"
  | "roundWin"
  | "gameWin"
  | "fmStart"
  | "fmReveal"
  | "fmZero"
  | "fmDupe"
  | "fmWin"
  | "fmLose"
  | "tick";

export interface GameEvent {
  id: number;
  type: GameEventType;
  team?: TeamId | null;
  slot?: number;
  playerId?: string;
  text?: string;
}

export interface GameSnapshot {
  code: string;
  phase: Phase;
  serverNow: number;
  targetScore: number;
  teams: { name: string; score: number }[];
  players: PublicPlayer[];
  round: RoundView | null;
  totalRounds: number;
  timer: TimerView | null;
  fm: FastMoneyView | null;
  winner: TeamId | null;
  /** last event (convenience) */
  event: GameEvent | null;
  /** the last few events, oldest first; process every id you haven't seen */
  events: GameEvent[];
  hostConnected: boolean;
  dataNote: string;
}

/** Only sent to host sockets - the "host card" with every answer. */
export interface HostSecret {
  question: string | null;
  answers: { label: string; points: number; views: number; onBoard: boolean; revealed: boolean }[];
  fmQuestions: { prompt: string; answers: { label: string; points: number }[] }[];
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
  token?: string;
}

export interface CreateResult {
  ok: boolean;
  code: string;
  hostToken: string;
}

export type HostAction =
  | { type: "start" }
  | { type: "next" }
  | { type: "award"; slot: number }
  | { type: "undoStrike" }
  | { type: "faceoffWinner"; team: TeamId }
  | { type: "skipRound" }
  | { type: "shuffleTeams" }
  | { type: "setTeamName"; team: TeamId; name: string }
  | { type: "movePlayer"; playerId: string; team: TeamId }
  | { type: "kick"; playerId: string }
  | { type: "setTarget"; target: number }
  | { type: "toLobby" };

export const MAX_NAME = 16;
