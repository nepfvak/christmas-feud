/**
 * Rehearsal bots: fill a room with pretend players so you can practise hosting alone.
 *
 *   npm run bots -- ABCD          (4 bots join room ABCD on localhost:3000)
 *   npm run bots -- ABCD 6 http://192.168.1.20:3000
 *
 * Bots buzz, answer (sometimes right, sometimes hilariously wrong), choose play,
 * steal and play the Snowball Sprint. Ctrl+C removes them.
 */
import { io } from "socket.io-client";
import data from "../data/questions.json";
import type { GameSnapshot, JoinResult } from "../shared/types";
import { randomAvatar } from "../shared/avatar";

const [code = "", countArg = "4", url = "http://localhost:3000"] = process.argv.slice(2);
if (!code) {
  console.log("Usage: npm run bots -- <ROOM CODE> [count] [server url]");
  process.exit(1);
}
const NAMES = ["Tinsel Tim", "Cocoa Kai", "Frosty Fay", "Jingle Jo", "Elfie", "Sprout", "Nutmeg", "Blitzen B", "Holly H", "Snowy Sam"];
const WRONG = ["socks", "a banana", "pickles", "my grandma", "spaghetti", "the moon", "um… taxes?"];
const SKILL = 0.6; // chance a bot gives a real answer

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const later = (min: number, max: number, fn: () => void) => setTimeout(fn, min + Math.random() * (max - min));
const byPrompt = new Map(data.questions.map((q) => [q.prompt, q]));
const byShort = new Map(data.questions.map((q) => [q.short, q]));

function guessFor(prompt: string, pool: Map<string, (typeof data.questions)[number]>, depth = 8) {
  const q = pool.get(prompt);
  if (!q || Math.random() > SKILL) return pick(WRONG);
  return pick(q.answers.slice(0, depth)).label;
}

for (let i = 0; i < Number(countArg); i++) {
  const s = io(url);
  const name = NAMES[i % NAMES.length];
  let me = "";
  let busyKey = "";
  s.on("connect", () => {
    s.emit("player:join", { code, name, avatar: randomAvatar() }, (r: JoinResult) => {
      if (!r.ok) return console.log(`${name}: ${r.error}`);
      me = r.playerId!;
      console.log(`🤖 ${name} joined ${code}`);
    });
  });
  s.on("state", (snap: GameSnapshot) => {
    if (!me) return;
    const r = snap.round;
    const key = `${snap.phase}|${r?.number}|${r?.faceoff.stage}|${r?.activePlayerId}|${snap.timer?.endsAt}|${snap.fm?.cursor}|${snap.fm?.turn}`;
    if (key === busyKey) return;
    busyKey = key;
    if (snap.phase === "faceoff" && r?.faceoff.stage === "live" && r.faceoff.players.includes(me)) later(400, 2500, () => s.emit("player:buzz"));
    if (["faceoff", "play", "steal"].includes(snap.phase) && r?.activePlayerId === me) later(1500, 4500, () => s.emit("player:answer", guessFor(r.question, byPrompt)));
    if (snap.phase === "playOrPass" && r?.faceoffWinner === me) later(800, 2000, () => s.emit("player:choose", true));
    if (snap.phase === "fmPlay" && snap.fm && snap.fm.players[snap.fm.turn] === me) {
      const prompt = snap.fm.prompts[snap.fm.cursor];
      later(3300, 5000, () => s.emit("player:answer", guessFor(prompt, byShort, 12)));
    }
  });
  s.on("connect_error", (e) => console.log(`${name}: can't reach ${url} (${e.message})`));
}
