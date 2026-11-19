/**
 * The authoritative game engine for one room.
 *
 * Every rule lives here on the server so phones can't cheat and every screen sees
 * the same thing. Clients send intents (buzz, answer, choose...), the room updates
 * its state and calls `onChange`, and the server broadcasts a fresh snapshot.
 *
 * Flow (mirrors the classic TV survey show):
 *   lobby -> [roundIntro -> faceoff -> playOrPass -> play -> (steal) -> roundEnd] x4
 *         -> (sudden death if nobody reached the target) -> gameOver
 *         -> fmIntro -> fmPlay(P1) -> fmReveal -> fmPlay(P2) -> fmReveal -> fmEnd
 */
import { randomBytes } from "node:crypto";
import { matchAnswer, normalize } from "../shared/matcher";
import { sanitizeAvatar } from "../shared/avatar";
import type {
  AvatarConfig, FaceoffStage, FastMoneyView, GameEvent, GameEventType, GameSnapshot, GuessView,
  HostAction, HostSecret, Phase, PublicPlayer, RoundView, TeamId,
} from "../shared/types";
import { MAX_NAME } from "../shared/types";
import { DATA_NOTE, QUESTIONS, shuffle, type Question } from "./questions";

export const RULES = {
  rounds: [
    { multiplier: 1, size: 7 },
    { multiplier: 1, size: 6 },
    { multiplier: 2, size: 5 },
    { multiplier: 3, size: 4 },
  ],
  suddenDeath: { multiplier: 3, size: 1 },
  targetScore: 300,
  fmTarget: 200,
  fmQuestions: 5,
  ms: {
    roundIntro: 3200,
    faceoffReady: 2200,
    faceoffAnswer: 15000,
    faceoffRetry: 2200,
    playOrPass: 15000,
    playAnswer: 20000,
    steal: 30000,
    fmReady: 3000,
    fmTurn: [20000, 25000] as const,
    fmRevealStep: 1500,
  },
};

const DEFAULT_TEAM_NAMES: [string, string] = ["Team Gingerbread", "Team Peppermint"];
const BLOCKED = /(fuck|shit|bitch|cunt|dick|cock|pussy|nigg|fag|slut|whore|rape|nazi|penis|vagina|porn|sex)/i;
const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0);
const token = () => randomBytes(12).toString("base64url");

interface Player {
  id: string;
  token: string;
  name: string;
  avatar: AvatarConfig;
  team: TeamId | null;
  sockets: Set<string>;
}

interface Round {
  number: number;
  multiplier: number;
  suddenDeath: boolean;
  question: Question;
  size: number;
  revealed: boolean[];
  bank: number;
  strikes: number;
  controlling: TeamId | null;
  activePlayerId: string | null;
  faceoff: {
    stage: FaceoffStage;
    players: [string | null, string | null];
    buzzed: string | null;
    attempts: { playerId: string; text: string; slot: number | null }[];
  };
  faceoffWinner: string | null;
  stealPlayerId: string | null;
  lastPlayActive: string | null;
  lastGuess: GuessView | null;
  outcome: RoundView["outcome"];
}

interface FmEntry {
  text: string;
  index: number | null; // index into question.answers (full pool)
  points: number;
}
interface FastMoney {
  team: TeamId;
  players: [string, string];
  turn: 0 | 1;
  answers: [(FmEntry | null)[], (FmEntry | null)[]];
  passed: Set<number>;
  cursor: number;
  readyUntil: number;
  revealStep: number;
  revealed: [boolean[], boolean[]];
  total: number;
  won: boolean | null;
}

export class Room {
  readonly code: string;
  readonly hostToken = token();
  readonly hostIp: string;
  readonly createdAt = Date.now();
  lastActive = Date.now();

  hostSockets = new Set<string>();
  players = new Map<string, Player>();
  private order: string[] = [];
  teamNames: [string, string] = [...DEFAULT_TEAM_NAMES];
  scores: [number, number] = [0, 0];
  phase: Phase = "lobby";
  targetScore = RULES.targetScore;

  private used = new Set<string>();
  private mainQuestions: Question[] = [];
  private fmQs: Question[] = [];
  private roundIndex = -1;
  round: Round | null = null;
  fm: FastMoney | null = null;
  winner: TeamId | null = null;

  /** recent events, so two things happening at once (3rd strike + steal) both reach clients */
  private events: GameEvent[] = [];
  private eventSeq = 0;
  private timer: { endsAt: number; total: number; handle: ReturnType<typeof setTimeout> } | null = null;
  private aux: ReturnType<typeof setTimeout>[] = [];
  private faceoffPtr: [number, number] = [0, 0];
  private turnPtr: [number, number] = [0, 0];

  constructor(code: string, hostIp: string, private onChange: () => void) {
    this.code = code;
    this.hostIp = hostIp;
  }

  // ------------------------------------------------------------------ helpers

  private emit(type: GameEventType, extra: Omit<GameEvent, "id" | "type"> = {}) {
    this.events.push({ id: ++this.eventSeq, type, ...extra });
    if (this.events.length > 8) this.events.shift();
  }

  private changed() {
    this.lastActive = Date.now();
    this.onChange();
  }

  private setTimer(ms: number, fn: () => void) {
    this.clearTimer();
    const handle = setTimeout(() => {
      this.timer = null;
      fn();
      this.changed();
    }, ms);
    this.timer = { endsAt: Date.now() + ms, total: ms, handle };
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer.handle);
    this.timer = null;
  }

  /** one-off delayed transitions (e.g. pause after a double miss) */
  private later(ms: number, fn: () => void) {
    const h = setTimeout(() => {
      this.aux = this.aux.filter((x) => x !== h);
      fn();
      this.changed();
    }, ms);
    this.aux.push(h);
  }

  private clearAux() {
    this.aux.forEach(clearTimeout);
    this.aux = [];
  }

  dispose() {
    this.clearTimer();
    this.clearAux();
  }

  get connectedCount() {
    return [...this.players.values()].filter((p) => p.sockets.size > 0).length;
  }

  teamMembers(team: TeamId, connectedOnly = true): Player[] {
    return this.order
      .map((id) => this.players.get(id)!)
      .filter((p) => p && p.team === team && (!connectedOnly || p.sockets.size > 0));
  }

  private teamOf(playerId: string | null): TeamId | null {
    return playerId ? (this.players.get(playerId)?.team ?? null) : null;
  }

  /** next player in a team's speaking rotation (skips disconnected players) */
  private nextTurn(team: TeamId, skip?: string | null): string | null {
    const members = this.teamMembers(team);
    if (!members.length) return null;
    for (let i = 0; i < members.length; i++) {
      const p = members[this.turnPtr[team]++ % members.length];
      if (members.length === 1 || p.id !== skip) return p.id;
    }
    return members[0].id;
  }

  private judgeBoard(text: string) {
    const q = this.round!.question;
    const m = matchAnswer(text, q.answers);
    if (!m) return { slot: null as number | null, offBoard: undefined };
    if (m.index < this.round!.size) return { slot: m.index, offBoard: undefined };
    const a = q.answers[m.index];
    return { slot: null, offBoard: { label: a.label, points: a.points } };
  }

  private revealSlot(slot: number, team: TeamId | null, scoreIt = true) {
    const r = this.round!;
    if (r.revealed[slot]) return false;
    r.revealed[slot] = true;
    if (scoreIt) r.bank += r.question.answers[slot].points * r.multiplier;
    this.emit("reveal", { slot, team });
    return true;
  }

  private sanitizeName(raw: unknown): string | null {
    const name = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    if (!name || BLOCKED.test(name.replace(/[^a-z]/gi, ""))) return null;
    return name;
  }

  // ------------------------------------------------------------------ players

  addPlayer(nameRaw: unknown, avatar: Partial<AvatarConfig> | undefined, socketId: string) {
    const name = this.sanitizeName(nameRaw);
    if (!name) return { ok: false as const, error: "Please pick a friendlier name." };
    if (this.players.size >= 60) return { ok: false as const, error: "This room is full." };
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    const finalName = taken ? `${name.slice(0, MAX_NAME - 2)} ${this.players.size + 1}` : name;
    const t0 = this.teamMembers(0, false).length;
    const t1 = this.teamMembers(1, false).length;
    const p: Player = {
      id: token().slice(0, 10),
      token: token(),
      name: finalName,
      avatar: sanitizeAvatar(avatar),
      team: t0 <= t1 ? 0 : 1,
      sockets: new Set([socketId]),
    };
    this.players.set(p.id, p);
    this.order.push(p.id);
    this.emit("join", { playerId: p.id });
    this.changed();
    return { ok: true as const, player: p };
  }

  resumePlayer(playerId: string, tok: string, socketId: string) {
    const p = this.players.get(playerId);
    if (!p || p.token !== tok) return null;
    p.sockets.add(socketId);
    this.changed();
    return p;
  }

  updatePlayer(playerId: string, patch: { name?: unknown; avatar?: Partial<AvatarConfig>; team?: unknown }) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (patch.name !== undefined) {
      const n = this.sanitizeName(patch.name);
      if (n) p.name = n;
    }
    if (patch.avatar) p.avatar = sanitizeAvatar(patch.avatar);
    if ((patch.team === 0 || patch.team === 1) && this.phase === "lobby") p.team = patch.team;
    this.changed();
  }

  socketLeft(socketId: string) {
    let touched = false;
    if (this.hostSockets.delete(socketId)) touched = true;
    for (const p of this.players.values()) {
      if (p.sockets.delete(socketId)) {
        touched = true;
        // Phones drop off when screens lock. Give them a moment, then keep the game moving.
        if (p.sockets.size === 0) this.later(5000, () => this.skipIfGone(p.id));
      }
    }
    if (touched) this.changed();
  }

  private skipIfGone(id: string) {
    const p = this.players.get(id);
    const r = this.round;
    if (!p || p.sockets.size > 0 || !r) return;
    if (this.phase === "play" && r.activePlayerId === id && r.controlling !== null) {
      r.activePlayerId = this.nextTurn(r.controlling);
      this.setTimer(RULES.ms.playAnswer, () => this.playTimeout());
    } else if (this.phase === "steal" && r.stealPlayerId === id && r.controlling !== null) {
      const sub = this.teamMembers(other(r.controlling))[0];
      if (sub) r.stealPlayerId = r.activePlayerId = sub.id;
    } else if (this.phase === "faceoff" && (r.faceoff.stage === "ready" || r.faceoff.stage === "live") && p.team !== null) {
      const idx = r.faceoff.players.indexOf(id);
      if (idx >= 0) r.faceoff.players[idx] = this.teamMembers(p.team)[0]?.id ?? null;
    } else if (this.phase === "playOrPass" && r.faceoffWinner === id) {
      this.choose(id, true);
    }
  }

  // ------------------------------------------------------------------ host

  host(action: HostAction) {
    switch (action.type) {
      case "start":
        if (this.phase === "lobby") this.startGame();
        break;
      case "next":
        this.hostNext();
        break;
      case "award":
        this.hostAward(action.slot);
        break;
      case "undoStrike":
        this.undoStrike();
        break;
      case "faceoffWinner":
        if (this.phase === "faceoff" && this.round) {
          const pid = this.round.faceoff.players[action.team] ?? this.teamMembers(action.team)[0]?.id ?? null;
          if (pid) this.faceoffWon(pid);
        }
        break;
      case "skipRound":
        if (this.round && ["faceoff", "playOrPass", "play", "steal"].includes(this.phase)) this.endRound(null, "skipped");
        break;
      case "shuffleTeams": {
        if (this.phase !== "lobby") break;
        const ids = shuffle([...this.players.keys()]);
        ids.forEach((id, i) => (this.players.get(id)!.team = (i % 2) as TeamId));
        break;
      }
      case "setTeamName": {
        const n = this.sanitizeName(action.name);
        if (n && (action.team === 0 || action.team === 1)) this.teamNames[action.team] = n;
        break;
      }
      case "movePlayer": {
        const p = this.players.get(action.playerId);
        if (p && (action.team === 0 || action.team === 1)) p.team = action.team;
        break;
      }
      case "kick": {
        const p = this.players.get(action.playerId);
        if (p) {
          this.players.delete(p.id);
          this.order = this.order.filter((id) => id !== p.id);
        }
        break;
      }
      case "setTarget":
        if (this.phase === "lobby" && [100, 150, 200, 300, 400, 500].includes(action.target)) this.targetScore = action.target;
        break;
      case "toLobby":
        this.toLobby();
        break;
    }
    this.changed();
  }

  canStart() {
    return this.teamMembers(0).length > 0 && this.teamMembers(1).length > 0;
  }

  private startGame() {
    if (!this.canStart()) return;
    let pool = shuffle(QUESTIONS.filter((q) => !this.used.has(q.id)));
    const need = RULES.rounds.length + 1 + RULES.fmQuestions;
    if (pool.length < need) {
      this.used.clear();
      pool = shuffle(QUESTIONS);
    }
    this.mainQuestions = pool.slice(0, RULES.rounds.length + 1);
    this.fmQs = pool.slice(RULES.rounds.length + 1, need);
    pool.slice(0, need).forEach((q) => this.used.add(q.id));
    this.scores = [0, 0];
    this.winner = null;
    this.fm = null;
    this.roundIndex = -1;
    this.faceoffPtr = [0, 0];
    this.turnPtr = [0, 0];
    this.nextRound();
  }

  private toLobby() {
    this.clearTimer();
    this.clearAux();
    this.phase = "lobby";
    this.round = null;
    this.fm = null;
    this.winner = null;
    this.scores = [0, 0];
    this.roundIndex = -1;
  }

  private hostNext() {
    switch (this.phase) {
      case "lobby":
        this.startGame();
        break;
      case "roundIntro":
        this.clearTimer();
        this.startFaceoff();
        break;
      case "playOrPass":
        if (this.round?.faceoffWinner) this.choose(this.round.faceoffWinner, true);
        break;
      case "roundEnd": {
        const r = this.round!;
        const hidden = r.revealed.findIndex((v) => !v);
        if (hidden >= 0) this.revealSlot(hidden, null, false);
        else this.afterRound();
        break;
      }
      case "gameOver":
        this.startFastMoney();
        break;
      case "fmIntro":
        this.startFmTurn(0);
        break;
      case "fmReveal":
        if (this.fm && this.fm.revealStep >= RULES.fmQuestions && this.fm.turn === 0) this.startFmTurn(1);
        break;
      case "fmEnd":
        this.toLobby();
        break;
    }
  }

  private hostAward(slot: number) {
    const r = this.round;
    if (!r || slot < 0 || slot >= r.size || r.revealed[slot]) return;
    if (this.phase === "play" && r.controlling !== null) {
      this.revealSlot(slot, r.controlling);
      if (r.revealed.every(Boolean)) this.endRound(r.controlling, "cleared");
    } else if (this.phase === "steal" && r.controlling !== null) {
      this.revealSlot(slot, other(r.controlling));
      this.endRound(other(r.controlling), "stolen");
    } else if (this.phase === "faceoff" || this.phase === "playOrPass") {
      this.revealSlot(slot, null);
    } else if (this.phase === "roundEnd") {
      this.revealSlot(slot, null, false);
    }
  }

  private undoStrike() {
    const r = this.round;
    if (!r) return;
    if (this.phase === "play" && r.strikes > 0) r.strikes--;
    else if (this.phase === "steal") {
      r.strikes = 2;
      r.stealPlayerId = null;
      this.phase = "play";
      r.activePlayerId = r.lastPlayActive ?? this.nextTurn(r.controlling!);
      this.setTimer(RULES.ms.playAnswer, () => this.playTimeout());
    }
  }

  // ------------------------------------------------------------------ rounds

  private nextRound() {
    this.clearAux();
    this.roundIndex++;
    const sd = this.roundIndex >= RULES.rounds.length;
    const plan = sd ? RULES.suddenDeath : RULES.rounds[this.roundIndex];
    const question = this.mainQuestions[this.roundIndex];
    const size = Math.min(plan.size, question.answers.length);
    this.round = {
      number: this.roundIndex + 1,
      multiplier: plan.multiplier,
      suddenDeath: sd,
      question,
      size,
      revealed: Array(size).fill(false),
      bank: 0,
      strikes: 0,
      controlling: null,
      activePlayerId: null,
      faceoff: { stage: "ready", players: [null, null], buzzed: null, attempts: [] },
      faceoffWinner: null,
      stealPlayerId: null,
      lastPlayActive: null,
      lastGuess: null,
      outcome: null,
    };
    this.phase = "roundIntro";
    this.emit("roundStart");
    this.setTimer(RULES.ms.roundIntro, () => this.startFaceoff());
  }

  private startFaceoff() {
    const r = this.round!;
    this.phase = "faceoff";
    const pick = (t: TeamId) => {
      const m = this.teamMembers(t);
      return m.length ? m[this.faceoffPtr[t] % m.length].id : null;
    };
    r.faceoff = { stage: "ready", players: [pick(0), pick(1)], buzzed: null, attempts: [] };
    r.activePlayerId = null;
    r.lastGuess = null;
    this.setTimer(RULES.ms.faceoffReady, () => {
      r.faceoff.stage = "live";
      // if one team has nobody connected, the other side answers straight away
      const [a, b] = r.faceoff.players;
      if (!a || !b) {
        const solo = a ?? b;
        if (solo) this.buzz(solo, true);
      }
    });
  }

  buzz(playerId: string, silent = false) {
    const r = this.round;
    if (this.phase !== "faceoff" || !r || r.faceoff.stage !== "live") return;
    if (!r.faceoff.players.includes(playerId)) return;
    r.faceoff.buzzed = playerId;
    r.faceoff.stage = "first";
    r.activePlayerId = playerId;
    if (!silent) this.emit("buzz", { playerId, team: this.teamOf(playerId) });
    this.setTimer(RULES.ms.faceoffAnswer, () => this.faceoffAnswer(playerId, "", true));
    this.changed();
  }

  answer(playerId: string, textRaw: unknown) {
    const text = String(textRaw ?? "").trim().slice(0, 80);
    if (!text) return;
    if (this.phase === "faceoff") this.faceoffAnswer(playerId, text);
    else if (this.phase === "play") this.playAnswer(playerId, text);
    else if (this.phase === "steal") this.stealAnswer(playerId, text);
    else if (this.phase === "fmPlay") this.fmAnswer(playerId, text);
    this.changed();
  }

  private faceoffAnswer(playerId: string, text: string, timedOut = false) {
    const r = this.round!;
    const fo = r.faceoff;
    if (r.activePlayerId !== playerId || (fo.stage !== "first" && fo.stage !== "second")) return;
    this.clearTimer();
    const team = this.teamOf(playerId)!;
    let { slot, offBoard } = timedOut ? { slot: null, offBoard: undefined } : this.judgeBoard(text);
    if (slot !== null && r.revealed[slot]) slot = null; // repeating the opponent's answer doesn't count
    fo.attempts.push({ playerId, text, slot });
    r.lastGuess = { playerId, text, result: slot !== null ? "hit" : timedOut ? "timeout" : "miss", slot: slot ?? undefined, offBoard };
    if (slot !== null) this.revealSlot(slot, team);
    else this.emit("strike", { team, playerId, text });

    const opponent = fo.players[other(team)];
    if (fo.stage === "first") {
      if (slot === 0) return this.faceoffWon(playerId);
      if (!opponent) return slot !== null ? this.faceoffWon(playerId) : this.faceoffRetry();
      fo.stage = "second";
      r.activePlayerId = opponent;
      this.setTimer(RULES.ms.faceoffAnswer, () => this.faceoffAnswer(opponent, "", true));
      return;
    }
    // second answer decides it
    const first = fo.attempts[0];
    if (first.slot === null && slot === null) return this.faceoffRetry();
    if (first.slot === null) return this.faceoffWon(playerId);
    if (slot !== null && slot < first.slot) return this.faceoffWon(playerId);
    return this.faceoffWon(first.playerId);
  }

  /** both missed: the next pair of players steps up to the buzzers */
  private faceoffRetry() {
    const r = this.round!;
    r.activePlayerId = null;
    r.faceoff.stage = "ready";
    this.faceoffPtr = [this.faceoffPtr[0] + 1, this.faceoffPtr[1] + 1];
    this.later(RULES.ms.faceoffRetry, () => this.startFaceoff());
  }

  private faceoffWon(playerId: string) {
    const r = this.round!;
    this.clearTimer();
    this.clearAux();
    const team = this.teamOf(playerId) ?? 0;
    r.faceoffWinner = playerId;
    r.activePlayerId = null;
    this.faceoffPtr = [this.faceoffPtr[0] + 1, this.faceoffPtr[1] + 1];
    this.emit("faceoffWin", { team, playerId });
    if (r.suddenDeath) return this.endRound(team, "suddenDeath");
    if (r.revealed.every(Boolean)) return this.endRound(team, "cleared");
    this.phase = "playOrPass";
    this.setTimer(RULES.ms.playOrPass, () => this.choose(playerId, true));
  }

  choose(playerId: string, play: boolean) {
    const r = this.round;
    if (this.phase !== "playOrPass" || !r || r.faceoffWinner !== playerId) return;
    const team = this.teamOf(playerId) ?? 0;
    r.controlling = play ? team : other(team);
    this.emit("control", { team: r.controlling });
    this.phase = "play";
    r.strikes = 0;
    r.activePlayerId = this.nextTurn(r.controlling, play ? playerId : null);
    this.setTimer(RULES.ms.playAnswer, () => this.playTimeout());
    this.changed();
  }

  private playTimeout() {
    const r = this.round!;
    if (r.activePlayerId) this.playAnswer(r.activePlayerId, "", true);
  }

  private playAnswer(playerId: string, text: string, timedOut = false) {
    const r = this.round!;
    if (r.activePlayerId !== playerId || r.controlling === null) return;
    const { slot, offBoard } = timedOut ? { slot: null, offBoard: undefined } : this.judgeBoard(text);
    if (slot !== null && r.revealed[slot]) {
      // already on the board: no strike, try again (timer keeps running)
      r.lastGuess = { playerId, text, result: "dupe", slot };
      this.emit("dupe", { playerId, slot });
      return;
    }
    this.clearTimer();
    r.lastPlayActive = playerId;
    if (slot !== null) {
      r.lastGuess = { playerId, text, result: "hit", slot };
      this.revealSlot(slot, r.controlling);
      if (r.revealed.every(Boolean)) return this.endRound(r.controlling, "cleared");
    } else {
      r.lastGuess = { playerId, text, result: timedOut ? "timeout" : "miss", offBoard };
      r.strikes++;
      this.emit("strike", { team: r.controlling, playerId, text });
      if (r.strikes >= 3) return this.startSteal();
    }
    r.activePlayerId = this.nextTurn(r.controlling);
    this.setTimer(RULES.ms.playAnswer, () => this.playTimeout());
  }

  private startSteal() {
    const r = this.round!;
    const team = other(r.controlling!);
    const captain = r.faceoff.players[team];
    const members = this.teamMembers(team);
    r.stealPlayerId = captain && members.some((m) => m.id === captain) ? captain : (members[0]?.id ?? null);
    r.activePlayerId = r.stealPlayerId;
    this.phase = "steal";
    this.emit("stealStart", { team });
    if (!r.stealPlayerId) return this.endRound(r.controlling!, "defended");
    this.setTimer(RULES.ms.steal, () => this.stealAnswer(r.stealPlayerId!, "", true));
  }

  private stealAnswer(playerId: string, text: string, timedOut = false) {
    const r = this.round!;
    if (r.stealPlayerId !== playerId || r.controlling === null) return;
    this.clearTimer();
    const team = other(r.controlling);
    const { slot, offBoard } = timedOut ? { slot: null, offBoard: undefined } : this.judgeBoard(text);
    if (slot !== null && !r.revealed[slot]) {
      r.lastGuess = { playerId, text, result: "hit", slot };
      this.revealSlot(slot, team);
      return this.endRound(team, "stolen");
    }
    r.lastGuess = { playerId, text, result: timedOut ? "timeout" : "miss", offBoard };
    this.emit("strike", { team, playerId, text });
    this.endRound(r.controlling, "defended");
  }

  private endRound(team: TeamId | null, reason: NonNullable<RoundView["outcome"]>["reason"]) {
    const r = this.round!;
    this.clearTimer();
    this.clearAux();
    r.activePlayerId = null;
    const points = team === null ? 0 : r.bank;
    if (team !== null) this.scores[team] += points;
    r.outcome = { team, points, reason };
    this.phase = "roundEnd";
    // let the reveal/strike sound land before the celebration
    this.later(900, () => this.emit("roundWin", { team }));
  }

  private afterRound() {
    const r = this.round!;
    const reached = ([0, 1] as TeamId[]).filter((t) => this.scores[t] >= this.targetScore);
    if (r.suddenDeath && r.outcome?.team != null) return this.finishGame(r.outcome.team);
    if (reached.length) return this.finishGame(this.scores[0] >= this.scores[1] ? 0 : 1);
    if (this.roundIndex + 1 >= this.mainQuestions.length) {
      return this.finishGame(this.scores[0] >= this.scores[1] ? 0 : 1);
    }
    this.nextRound();
  }

  private finishGame(team: TeamId) {
    this.clearAux();
    this.winner = team;
    this.phase = "gameOver";
    this.emit("gameWin", { team });
  }

  // ------------------------------------------------------------------ fast money

  private startFastMoney() {
    const team = this.winner ?? 0;
    const m = this.teamMembers(team);
    if (!m.length || this.fmQs.length < RULES.fmQuestions) return this.toLobby();
    const p1 = m[0].id;
    const p2 = (m[1] ?? m[0]).id;
    this.fm = {
      team,
      players: [p1, p2],
      turn: 0,
      answers: [Array(RULES.fmQuestions).fill(null), Array(RULES.fmQuestions).fill(null)],
      passed: new Set(),
      cursor: 0,
      readyUntil: 0,
      revealStep: 0,
      revealed: [Array(RULES.fmQuestions).fill(false), Array(RULES.fmQuestions).fill(false)],
      total: 0,
      won: null,
    };
    this.phase = "fmIntro";
    this.emit("fmStart", { team });
  }

  /** host may swap which teammates play the Snowball Sprint before it starts */
  setFmPlayers(p1: string, p2: string) {
    if (this.phase !== "fmIntro" || !this.fm) return;
    const ok = (id: string) => this.players.get(id)?.team === this.fm!.team;
    if (ok(p1) && ok(p2)) this.fm.players = [p1, p2];
    this.changed();
  }

  private startFmTurn(turn: 0 | 1) {
    const fm = this.fm!;
    fm.turn = turn;
    fm.cursor = 0;
    fm.passed = new Set();
    fm.revealStep = 0;
    fm.readyUntil = Date.now() + RULES.ms.fmReady;
    this.phase = "fmPlay";
    this.emit("fmStart", { team: fm.team, playerId: fm.players[turn] });
    this.setTimer(RULES.ms.fmReady + RULES.ms.fmTurn[turn], () => this.startFmReveal());
  }

  private fmAnswer(playerId: string, text: string) {
    const fm = this.fm!;
    if (fm.players[fm.turn] !== playerId || Date.now() < fm.readyUntil) return;
    const qi = fm.cursor;
    if (fm.answers[fm.turn][qi]) return;
    const q = this.fmQs[qi];
    const m = matchAnswer(text, q.answers);
    const entry: FmEntry = { text, index: m?.index ?? null, points: m ? q.answers[m.index].points : 0 };
    if (fm.turn === 1) {
      const prev = fm.answers[0][qi];
      const dupe = prev && ((prev.index !== null && prev.index === entry.index) || normalize(prev.text) === normalize(text));
      if (dupe) {
        this.emit("fmDupe", { playerId });
        return;
      }
    }
    fm.answers[fm.turn][qi] = entry;
    fm.passed.delete(qi);
    this.advanceFmCursor();
  }

  fmPass(playerId: string) {
    const fm = this.fm;
    if (this.phase !== "fmPlay" || !fm || fm.players[fm.turn] !== playerId || Date.now() < fm.readyUntil) return;
    fm.passed.add(fm.cursor);
    this.advanceFmCursor();
    this.changed();
  }

  private advanceFmCursor() {
    const fm = this.fm!;
    const list = fm.answers[fm.turn];
    if (list.every(Boolean)) return this.startFmReveal();
    for (let step = 1; step <= RULES.fmQuestions; step++) {
      const i = (fm.cursor + step) % RULES.fmQuestions;
      if (!list[i]) {
        fm.cursor = i;
        return;
      }
    }
  }

  private startFmReveal() {
    const fm = this.fm!;
    this.clearTimer();
    this.phase = "fmReveal";
    fm.revealStep = 0;
    const step = () => {
      const i = fm.revealStep;
      const entry = fm.answers[fm.turn][i];
      fm.revealed[fm.turn][i] = true;
      fm.total += entry?.points ?? 0;
      fm.revealStep++;
      this.emit(entry && entry.points > 0 ? "fmReveal" : "fmZero", { slot: i });
      if (fm.revealStep < RULES.fmQuestions) this.later(RULES.ms.fmRevealStep, step);
      else if (fm.turn === 1) this.later(RULES.ms.fmRevealStep, () => this.finishFastMoney());
    };
    this.later(RULES.ms.fmRevealStep, step);
  }

  private finishFastMoney() {
    const fm = this.fm!;
    fm.won = fm.total >= RULES.fmTarget;
    this.phase = "fmEnd";
    this.emit(fm.won ? "fmWin" : "fmLose", { team: fm.team });
  }

  // ------------------------------------------------------------------ views

  snapshot(): GameSnapshot {
    const r = this.round;
    const players: PublicPlayer[] = this.order.map((id) => {
      const p = this.players.get(id)!;
      return { id: p.id, name: p.name, avatar: p.avatar, team: p.team, connected: p.sockets.size > 0 };
    });
    const round: RoundView | null = r && {
      number: r.number,
      multiplier: r.multiplier,
      suddenDeath: r.suddenDeath,
      question: this.phase === "roundIntro" ? "" : r.question.prompt,
      slots: r.revealed.map((rev, i) =>
        rev ? { revealed: true, label: r.question.answers[i].label, points: r.question.answers[i].points, views: r.question.answers[i].views } : { revealed: false },
      ),
      bank: r.bank,
      strikes: r.strikes,
      controlling: r.controlling,
      activePlayerId: r.activePlayerId,
      faceoff: { ...r.faceoff, attempts: [...r.faceoff.attempts] },
      faceoffWinner: r.faceoffWinner,
      stealPlayerId: r.stealPlayerId,
      lastGuess: r.lastGuess,
      outcome: r.outcome,
    };
    return {
      code: this.code,
      phase: this.phase,
      serverNow: Date.now(),
      targetScore: this.targetScore,
      teams: [0, 1].map((t) => ({ name: this.teamNames[t], score: this.scores[t] })),
      players,
      round,
      totalRounds: RULES.rounds.length,
      timer: this.timer ? { endsAt: this.timer.endsAt, total: this.timer.total } : null,
      fm: this.fmView(),
      winner: this.winner,
      event: this.events.at(-1) ?? null,
      events: [...this.events],
      hostConnected: this.hostSockets.size > 0,
      dataNote: DATA_NOTE,
    };
  }

  private fmView(): FastMoneyView | null {
    const fm = this.fm;
    if (!fm) return null;
    const view = (turn: 0 | 1) =>
      fm.answers[turn].map((e, i) => {
        const revealed = fm.revealed[turn][i];
        // Player 1's answers are covered while player 2 is up (like the show)
        const hide = this.phase === "fmPlay" && (fm.turn === 1 ? true : !revealed);
        const showText = !hide && (revealed || this.phase === "fmEnd");
        const q = this.fmQs[i];
        return {
          text: showText ? (e?.text ?? "—") : null,
          label: showText && e?.index != null ? q.answers[e.index].label : null,
          points: revealed ? (e?.points ?? 0) : null,
          revealed,
        };
      });
    return {
      team: fm.team,
      players: fm.players,
      turn: fm.turn,
      prompts: this.fmQs.map((q) => q.short),
      answers: [view(0), view(1)],
      cursor: fm.cursor,
      total: fm.total,
      target: RULES.fmTarget,
      revealStep: fm.revealStep,
      won: fm.won,
    };
  }

  /** what the active Snowball Sprint player has answered so far (for their phone only) */
  fmProgress(playerId: string) {
    const fm = this.fm;
    if (!fm || fm.players[fm.turn] !== playerId) return null;
    return { answered: fm.answers[fm.turn].map((e) => (e ? e.text : null)), passed: [...fm.passed], readyUntil: fm.readyUntil };
  }

  secret(): HostSecret {
    const r = this.round;
    return {
      question: r?.question.prompt ?? null,
      answers: r
        ? r.question.answers.slice(0, Math.max(r.size + 4, 8)).map((a, i) => ({
            label: a.label,
            points: a.points,
            views: a.views,
            onBoard: i < r.size,
            revealed: !!r.revealed[i],
          }))
        : [],
      fmQuestions: this.fmQs.map((q) => ({ prompt: q.prompt, answers: q.answers.slice(0, 8).map((a) => ({ label: a.label, points: a.points })) })),
    };
  }
}
