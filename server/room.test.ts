import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Room, RULES } from "./room";

/** Plays a whole game against the real engine with fake timers. */
function setup(perTeam = 2) {
  const room = new Room("TEST", "127.0.0.1", () => {});
  const ids: string[][] = [[], []];
  for (let i = 0; i < perTeam * 2; i++) {
    const r = room.addPlayer(`Player${i}`, undefined, `s${i}`);
    if (!r.ok) throw new Error(r.error);
    ids[r.player.team!].push(r.player.id);
  }
  return { room, ids };
}
const answers = (room: Room) => room.round!.question.answers;
const toFaceoffLive = () => vi.advanceTimersByTime(RULES.ms.roundIntro + RULES.ms.faceoffReady + 10);

describe("Room engine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("balances teams on join and rejects rude names", () => {
    const { room, ids } = setup(2);
    expect(ids[0].length).toBe(2);
    expect(ids[1].length).toBe(2);
    expect(room.addPlayer("shithead", undefined, "x").ok).toBe(false);
  });

  it("face-off: top answer wins control immediately", () => {
    const { room } = setup(2);
    room.host({ type: "start" });
    expect(room.phase).toBe("roundIntro");
    toFaceoffLive();
    expect(room.round!.faceoff.stage).toBe("live");
    const [a] = room.round!.faceoff.players;
    room.buzz(a!);
    room.answer(a!, answers(room)[0].label);
    expect(room.phase).toBe("playOrPass");
    expect(room.round!.faceoffWinner).toBe(a);
    expect(room.round!.bank).toBe(answers(room)[0].points);
  });

  it("face-off: higher ranked second answer wins; double miss brings next pair", () => {
    const { room } = setup(2);
    room.host({ type: "start" });
    toFaceoffLive();
    const [a, b] = room.round!.faceoff.players;
    room.buzz(b!);
    room.answer(b!, "zzzz not an answer");
    expect(room.round!.faceoff.stage).toBe("second");
    room.answer(a!, "qqqq also wrong");
    expect(room.round!.faceoff.stage).toBe("ready");
    vi.advanceTimersByTime(RULES.ms.faceoffRetry + RULES.ms.faceoffReady + 10);
    const [a2, b2] = room.round!.faceoff.players;
    expect(a2).not.toBe(a);
    expect(b2).not.toBe(b);
    room.buzz(a2!);
    room.answer(a2!, answers(room)[2].label);
    room.answer(b2!, answers(room)[1].label);
    expect(room.round!.faceoffWinner).toBe(b2);
  });

  it("three strikes hands the steal to the other team; failed steal defends the bank", () => {
    const { room } = setup(2);
    room.host({ type: "start" });
    toFaceoffLive();
    const [a] = room.round!.faceoff.players;
    room.buzz(a!);
    room.answer(a!, answers(room)[0].label);
    room.choose(a!, true);
    expect(room.phase).toBe("play");
    expect(room.round!.controlling).toBe(0);
    // a correct answer
    room.answer(room.round!.activePlayerId!, answers(room)[1].label);
    // repeating it is not a strike
    const active = room.round!.activePlayerId!;
    room.answer(active, answers(room)[1].label);
    expect(room.round!.strikes).toBe(0);
    for (let i = 0; i < 3; i++) room.answer(room.round!.activePlayerId!, "absolutely not on the board");
    expect(room.phase).toBe("steal");
    // the 3rd strike and the steal arrive together: both must reach clients
    const types = room.snapshot().events.slice(-2).map((e) => e.type);
    expect(types).toEqual(["strike", "stealStart"]);
    const bank = room.round!.bank;
    room.answer(room.round!.stealPlayerId!, "still wrong haha");
    expect(room.phase).toBe("roundEnd");
    expect(room.scores[0]).toBe(bank);
  });

  it("a timeout counts as a strike", () => {
    const { room } = setup(1);
    room.host({ type: "start" });
    toFaceoffLive();
    const [a] = room.round!.faceoff.players;
    room.buzz(a!);
    room.answer(a!, answers(room)[0].label);
    room.choose(a!, true);
    vi.advanceTimersByTime(RULES.ms.playAnswer + 10);
    expect(room.round!.strikes).toBe(1);
  });

  it("plays a full game through the snowball sprint", () => {
    const { room } = setup(2);
    room.targetScore = 9999; // force all four rounds + sudden death
    room.host({ type: "start" });
    for (let round = 0; round < 5; round++) {
      toFaceoffLive();
      const r = room.round!;
      const [a] = r.faceoff.players;
      room.buzz(a!);
      room.answer(a!, answers(room)[0].label);
      if (!r.suddenDeath) {
        room.choose(a!, true);
        for (let i = 1; i < r.size; i++) room.answer(room.round!.activePlayerId!, answers(room)[i].label);
        expect(r.outcome?.reason).toBe("cleared");
      } else {
        expect(r.outcome?.reason).toBe("suddenDeath");
      }
      expect(room.phase).toBe("roundEnd");
      room.host({ type: "next" });
    }
    expect(room.phase).toBe("gameOver");
    expect(room.winner).toBe(0);
    room.host({ type: "next" });
    expect(room.phase).toBe("fmIntro");
    room.host({ type: "next" });
    expect(room.phase).toBe("fmPlay");
    const [p1, p2] = room.fm!.players;
    vi.advanceTimersByTime(RULES.ms.fmReady + 1);
    // player 1 passes the first question, answers the rest, then comes back
    room.fmPass(p1);
    expect(room.fm!.cursor).toBe(1);
    const fmQ = (room as any).fmQs;
    for (let i = 1; i < 5; i++) room.answer(p1, fmQ[i].answers[0].label);
    expect(room.fm!.cursor).toBe(0);
    room.answer(p1, fmQ[0].answers[0].label);
    expect(room.phase).toBe("fmReveal");
    vi.advanceTimersByTime(RULES.ms.fmRevealStep * 6);
    room.host({ type: "next" });
    expect(room.phase).toBe("fmPlay");
    vi.advanceTimersByTime(RULES.ms.fmReady + 1);
    // duplicate of player 1's answer is rejected
    room.answer(p2, fmQ[0].answers[0].label);
    expect(room.fm!.cursor).toBe(0);
    for (let i = 0; i < 5; i++) room.answer(p2, fmQ[i].answers[1].label);
    vi.advanceTimersByTime(RULES.ms.fmRevealStep * 7);
    expect(room.phase).toBe("fmEnd");
    const expected = fmQ.reduce((s: number, q: any) => s + q.answers[0].points + q.answers[1].points, 0);
    expect(room.fm!.total).toBe(expected);
    expect(room.fm!.won).toBe(expected >= 200);
  });

  it("skips a player whose phone disconnects, after a grace period, without a strike", () => {
    const { room } = setup(2);
    room.host({ type: "start" });
    toFaceoffLive();
    const [a] = room.round!.faceoff.players;
    room.buzz(a!);
    room.answer(a!, answers(room)[0].label);
    room.choose(a!, true);
    const active = room.round!.activePlayerId!;
    const sock = [...room.players.get(active)!.sockets][0];
    room.socketLeft(sock);
    vi.advanceTimersByTime(4000);
    expect(room.round!.activePlayerId).toBe(active);
    vi.advanceTimersByTime(1100);
    expect(room.round!.activePlayerId).not.toBe(active);
    expect(room.round!.strikes).toBe(0);
  });

  it("never leaks hidden answers in the public snapshot", () => {
    const { room } = setup(1);
    room.host({ type: "start" });
    toFaceoffLive();
    const json = JSON.stringify(room.snapshot());
    for (const a of answers(room).slice(0, room.round!.size)) expect(json).not.toContain(`"${a.label}"`);
  });
});
