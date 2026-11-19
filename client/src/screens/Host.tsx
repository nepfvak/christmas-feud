import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { CreateResult, GameSnapshot, HostAction, HostSecret, PublicPlayer, TeamId } from "../../../shared/types";
import { emitAck, hostSession, resetGameState, serverNow, socket, takeNewEvents, useGame } from "../socket";
import { isMuted, setMuted, speak, unlockAudio } from "../audio";
import { hasClip, playSfx, playVoice, preloadClips, type VoiceId } from "../clips";
import { Avatar } from "../components/Avatar";
import { Board, Confetti, Logo, PlayerChip, Snow, StrikeFlash, StrikeRow, TimerRing, secondsLeft } from "../components/ui";

const act = (a: HostAction) => socket.emit("host:action", a);
const voicePref = () => {
  try {
    return localStorage.getItem("ss-voice") !== "0";
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------- session

function useHostSession() {
  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      const s = hostSession.get();
      if (s) {
        const ok = await emitAck<boolean>("host:resume", s);
        if (ok || cancelled) return;
      }
      const r = await emitAck<CreateResult>("host:create");
      if (!cancelled) hostSession.set({ code: r.code, hostToken: r.hostToken });
    };
    if (socket.connected) connect();
    socket.on("connect", connect);
    return () => {
      cancelled = true;
      socket.off("connect", connect);
    };
  }, []);
}

export function newRoom() {
  hostSession.set(null);
  resetGameState();
  window.location.reload();
}

function useJoinUrl(code: string | undefined) {
  const [base, setBase] = useState(window.location.origin);
  useEffect(() => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
    fetch("/api/info")
      .then((r) => r.json())
      .then((d: { lanIps: string[] }) => {
        const ip = d.lanIps.find((x) => x.startsWith("192.168.") || x.startsWith("10.")) ?? d.lanIps[0];
        if (ip) setBase(`${window.location.protocol}//${ip}${window.location.port ? ":" + window.location.port : ""}`);
      })
      .catch(() => {});
  }, []);
  const url = code ? `${base}/play?code=${code}` : "";
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: "#0b2a20", light: "#fff8ef" } }).then(setQr).catch(() => {});
  }, [url]);
  return { url, base, display: base.replace(/^https?:\/\//, ""), qr };
}

// ---------------------------------------------------------------- sounds

function useHostSounds(snap: GameSnapshot | null, voice: boolean) {
  const seen = useRef<number>(-1);
  const lastSpoken = useRef<string>("");
  const lastTick = useRef<number>(-1);

  // Recorded clips (public/audio/...) are detected once; anything missing falls back to the synth.
  useEffect(() => {
    preloadClips();
  }, []);

  useEffect(() => {
    const r = snap?.round;
    const say = (id: VoiceId, delay = 0, tts = false) => voice && setTimeout(() => playVoice(id, { tts }), delay);
    for (const e of takeNewEvents(snap, seen)) {
      switch (e.type) {
        case "reveal":
          playSfx("reveal");
          if (e.team != null) {
            if (e.slot === 0) say("topAnswer", 500);
            else if (Math.random() < 0.35) say("goodAnswer", 500);
          }
          break;
        case "fmReveal": playSfx("reveal"); break;
        case "strike":
          playSfx("strike");
          if (r?.lastGuess?.result === "timeout") say("timesUp", 400);
          break;
        case "buzz": playSfx("buzz"); break;
        case "dupe": playSfx("dupe"); break;
        case "fmDupe": playSfx("dupe"); say("tryAgain", 200); break;
        case "join": case "control": playSfx("yourTurn"); break;
        case "faceoffWin":
          playSfx("yourTurn");
          if (snap?.phase === "playOrPass") say("playOrPass", 900);
          break;
        case "roundStart":
          playSfx("theme");
          if (r?.suddenDeath) say("suddenDeath", 1500, true);
          else if (r?.number === 1) { say("welcome", 150); say("round1", 2300); }
          else if (r) say(`round${Math.min(r.number, 4)}` as VoiceId, 1500);
          break;
        case "stealStart":
          // the 3rd lump of coal arrives in the same update as the steal
          playSfx("strike");
          say("coal", 700);
          say("steal", 1700, true);
          break;
        case "roundWin": if (e.team != null) playSfx("fanfare"); break;
        case "gameWin":
          playSfx("fanfare");
          setTimeout(() => playSfx("theme"), 1400);
          say("winner", 600, true);
          break;
        case "fmWin":
          playSfx("fanfare");
          setTimeout(() => playSfx("theme"), 1400);
          say("sprintWin", 600, true);
          break;
        case "fmZero": playSfx("zero"); break;
        case "fmLose": playSfx("sad"); break;
        case "fmStart":
          playSfx("yourTurn");
          if (!e.playerId) say("sprint", 500, true); // the intro, not each player's turn
          break;
      }
    }
  }, [snap?.event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "The sleigh says..." before the Snowball Sprint answers flip
  useEffect(() => {
    if (voice && snap?.phase === "fmReveal") playVoice("sleighSays");
  }, [snap?.phase, snap?.fm?.turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Face-off!" then read each new question aloud once
  useEffect(() => {
    const q = snap?.round?.question;
    if (!voice || snap?.phase !== "faceoff" || !q || lastSpoken.current === q) return;
    lastSpoken.current = q;
    const read = () => speak(q.replace(/\.$/, ""));
    if (hasClip("faceoff")) {
      playVoice("faceoff");
      setTimeout(read, 1000);
    } else read();
  }, [snap?.phase, snap?.round?.question, voice]);

  // countdown ticks for the last five seconds
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.ceil(secondsLeft(snap?.timer ?? null));
      if (snap?.timer && s > 0 && s <= 5 && s !== lastTick.current) {
        lastTick.current = s;
        playSfx("tick");
      }
    }, 200);
    return () => clearInterval(t);
  }, [snap?.timer?.endsAt]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- main

export function Host() {
  useHostSession();
  const { snap, secret, connected } = useGame();
  const [voice, setVoice] = useState(voicePref);
  const [muted, setMutedState] = useState(isMuted());
  useHostSounds(snap, voice && !muted);
  const join = useJoinUrl(snap?.code);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        unlockAudio();
        act({ type: "next" });
      } else if (e.key.toLowerCase() === "f") toggleFullscreen();
      else if (e.key.toLowerCase() === "m") {
        setMuted(!isMuted());
        setMutedState(isMuted());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!snap) {
    return (
      <div className="host stage loading-screen">
        <Snow />
        <Logo size="lg" />
        <p className="muted">{connected ? "Setting up the stage…" : "Connecting to the North Pole…"}</p>
      </div>
    );
  }

  const fmPhase = snap.phase.startsWith("fm");
  return (
    <div className="host stage" onPointerDown={unlockAudio}>
      <Snow />
      {snap.phase === "lobby" ? (
        <HostLobby snap={snap} join={join} />
      ) : snap.phase === "gameOver" ? (
        <GameOver snap={snap} />
      ) : fmPhase ? (
        <FastMoneyScreen snap={snap} code={snap.code} />
      ) : (
        <GameScreen snap={snap} code={snap.code} joinDisplay={join.display} />
      )}
      <HostDock
        snap={snap}
        secret={secret}
        joinBase={join.base}
        voice={voice}
        muted={muted}
        onVoice={() => {
          const v = !voice;
          setVoice(v);
          try { localStorage.setItem("ss-voice", v ? "1" : "0"); } catch {}
        }}
        onMute={() => {
          setMuted(!muted);
          setMutedState(!muted);
        }}
      />
      {!connected && <div className="conn-banner">Reconnecting…</div>}
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// ---------------------------------------------------------------- lobby

function HostLobby({ snap, join }: { snap: GameSnapshot; join: ReturnType<typeof useJoinUrl> }) {
  const teams: TeamId[] = [0, 1];
  const ready = teams.every((t) => snap.players.some((p) => p.team === t && p.connected));
  return (
    <div className="lobby">
      <section className="lobby-join panel">
        <Logo size="lg" />
        <p className="lobby-tag">A holiday survey showdown</p>
        <div className="join-steps">
          <div className="join-qr">{join.qr && <img src={join.qr} alt={`QR code to join game ${snap.code}`} />}</div>
          <div className="join-text">
            <span className="eyebrow">Scan, or go to</span>
            <span className="join-url">{join.display}</span>
            <span className="eyebrow">and enter code</span>
            <span className="join-code" aria-label={`Game code ${snap.code.split("").join(" ")}`}>
              {snap.code.split("").map((ch, i) => <span key={i}>{ch}</span>)}
            </span>
          </div>
        </div>
      </section>

      <section className="lobby-teams">
        {teams.map((t) => {
          const members = snap.players.filter((p) => p.team === t);
          return (
            <div className={`team-card panel team-${t}`} key={t}>
              <input
                className="team-name-input"
                defaultValue={snap.teams[t].name}
                key={snap.teams[t].name}
                maxLength={16}
                aria-label={`Team ${t + 1} name`}
                onBlur={(e) => e.target.value.trim() && e.target.value !== snap.teams[t].name && act({ type: "setTeamName", team: t, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <span className="team-count">{members.length} {members.length === 1 ? "player" : "players"}</span>
              <div className="team-members">
                {members.length === 0 && <p className="muted small">Waiting for players…</p>}
                {members.map((p) => (
                  <div className="member" key={p.id}>
                    <PlayerChip p={p} size={52} onClick={() => act({ type: "movePlayer", playerId: p.id, team: t === 0 ? 1 : 0 })} title="Click to switch teams" />
                    <button className="kick" aria-label={`Remove ${p.name}`} onClick={() => confirm(`Remove ${p.name}?`) && act({ type: "kick", playerId: p.id })}>×</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <footer className="lobby-footer">
        <label className="target-select">
          Play to
          <select value={snap.targetScore} onChange={(e) => act({ type: "setTarget", target: Number(e.target.value) })}>
            {[150, 200, 300, 400, 500].map((n) => <option key={n} value={n}>{n} points</option>)}
          </select>
        </label>
        <button className="btn-ghost" onClick={() => act({ type: "shuffleTeams" })}>🔀 Shuffle teams</button>
        <button className="btn-primary big" disabled={!ready} onClick={() => { unlockAudio(); act({ type: "start" }); }}>
          {ready ? "Start the show" : "Need a player on each team"}
        </button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- game board screen

function playerName(snap: GameSnapshot, id: string | null | undefined) {
  return snap.players.find((p) => p.id === id)?.name ?? "Someone";
}

function RoundPill({ snap }: { snap: GameSnapshot }) {
  const r = snap.round;
  if (!r) return null;
  const label = r.suddenDeath ? "Sudden Death" : `Round ${r.number} of ${snap.totalRounds}`;
  const mult = r.multiplier === 2 ? "Double points" : r.multiplier === 3 ? "Triple points" : null;
  return (
    <div className="round-pill">
      <span>{label}</span>
      {mult && <span className="mult">{mult}</span>}
    </div>
  );
}

function TeamPanel({ snap, team }: { snap: GameSnapshot; team: TeamId }) {
  const r = snap.round;
  const members = snap.players.filter((p) => p.team === team);
  const controlling = r?.controlling === team && (snap.phase === "play" || snap.phase === "steal");
  const stealing = snap.phase === "steal" && r?.controlling !== team;
  const won = snap.phase === "roundEnd" && r?.outcome?.team === team;
  return (
    <aside className={`team-panel panel team-${team} ${controlling && snap.phase === "play" ? "controlling" : ""} ${stealing ? "stealing" : ""} ${won ? "won" : ""}`}>
      <div className="team-head">
        <span className="team-name">{snap.teams[team].name}</span>
        <AnimatedNumber className="team-score" value={snap.teams[team].score} />
      </div>
      <div className="team-badges">
        {controlling && snap.phase === "play" && <span className="badge">In control</span>}
        {stealing && <span className="badge steal">Steal!</span>}
        {won && <span className="badge win">+{r?.outcome?.points}</span>}
      </div>
      {r && controlling && <StrikeRow count={r.strikes} size={44} />}
      <ul className="team-list">
        {members.map((p) => {
          const active = r?.activePlayerId === p.id;
          const faceoff = snap.phase === "faceoff" && r?.faceoff.players.includes(p.id);
          return (
            <li key={p.id} className={`${active ? "active" : ""} ${faceoff ? "faceoff" : ""} ${p.connected ? "" : "offline"}`}>
              <Avatar config={p.avatar} size={40} />
              <span>{p.name}</span>
              {active && <span className="speaking" aria-label="answering">●</span>}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{shown}</span>;
}

function GameScreen({ snap, code, joinDisplay }: { snap: GameSnapshot; code: string; joinDisplay: string }) {
  const r = snap.round!;
  const strikeEvent = [...snap.events].reverse().find((e) => e.type === "strike" || e.type === "stealStart")?.id ?? null;
  const strikeCount = snap.phase === "play" || (snap.phase === "steal" && r.strikes >= 3) ? r.strikes : 1;
  return (
    <div className="game">
      <header className="host-top">
        <Logo size="sm" />
        <RoundPill snap={snap} />
        <div className="join-badge">
          <span>{joinDisplay}</span>
          <b>{code}</b>
        </div>
      </header>
      <main className="host-main">
        <TeamPanel snap={snap} team={0} />
        <section className="center">
          <div className={`question-card ${snap.phase === "roundIntro" ? "hidden" : ""}`}>
            <p>{r.question}</p>
          </div>
          <div className="bank-row">
            <div className="bank">
              <span>Stocking</span>
              <AnimatedNumber className="bank-num" value={r.bank} />
            </div>
          </div>
          <Board slots={r.slots} multiplier={r.multiplier} />
          <StatusBar snap={snap} />
        </section>
        <TeamPanel snap={snap} team={1} />
      </main>
      <div className="data-note">{snap.dataNote}</div>
      {snap.phase === "roundIntro" && <RoundIntro snap={snap} />}
      <StrikeFlash eventId={strikeEvent} count={strikeCount} />
    </div>
  );
}

function RoundIntro({ snap }: { snap: GameSnapshot }) {
  const r = snap.round!;
  return (
    <div className="overlay round-intro">
      <div className="round-intro-card">
        <span className="eyebrow">{r.suddenDeath ? "Nobody reached " + snap.targetScore + "!" : "Get ready"}</span>
        <h1>{r.suddenDeath ? "Sudden Death" : `Round ${r.number}`}</h1>
        <p>
          {r.suddenDeath ? "Only the #1 answer counts. Triple points!" : r.multiplier === 1 ? "Single points" : r.multiplier === 2 ? "Double points!" : "Triple points!"}
        </p>
      </div>
    </div>
  );
}

function GuessBubble({ snap }: { snap: GameSnapshot }) {
  const g = snap.round?.lastGuess;
  if (!g || !g.text) return g?.result === "timeout" ? <div className="guess miss" key={snap.event?.id}>⏰ {playerName(snap, g.playerId)} ran out of time</div> : null;
  const who = playerName(snap, g.playerId);
  let verdict: string;
  if (g.result === "hit") verdict = `#${(g.slot ?? 0) + 1} on the board!`;
  else if (g.result === "dupe") verdict = "Already up there — try again";
  else if (g.offBoard) verdict = `Real answer (${g.offBoard.points} pts) but not on the board`;
  else verdict = "Not on the board";
  return (
    <div className={`guess ${g.result}`} key={snap.event?.id}>
      <span className="guess-who">{who}:</span> <span className="guess-text">“{g.text}”</span> <span className="guess-verdict">{verdict}</span>
    </div>
  );
}

function StatusBar({ snap }: { snap: GameSnapshot }) {
  const r = snap.round!;
  const fo = r.faceoff;
  let msg: React.ReactNode = null;
  const team = (id: string | null) => {
    const t = snap.players.find((p) => p.id === id)?.team;
    return t == null ? "" : snap.teams[t].name;
  };
  switch (snap.phase) {
    case "faceoff": {
      const [a, b] = fo.players.map((id) => snap.players.find((p) => p.id === id));
      if (fo.stage === "ready" || fo.stage === "live") {
        msg = (
          <div className="versus">
            {a && <PlayerChip p={a} size={56} />}
            <span className={`vs ${fo.stage === "live" ? "live" : ""}`}>{fo.stage === "live" ? "BUZZ!" : "VS"}</span>
            {b && <PlayerChip p={b} size={56} />}
          </div>
        );
      } else msg = <span><b>{playerName(snap, r.activePlayerId)}</b> is answering for {team(r.activePlayerId)}…</span>;
      break;
    }
    case "playOrPass":
      msg = <span><b>{playerName(snap, r.faceoffWinner)}</b> won the face-off! Play or pass?</span>;
      break;
    case "play":
      msg = <span><b>{playerName(snap, r.activePlayerId)}</b>'s turn · {snap.teams[r.controlling!].name}</span>;
      break;
    case "steal":
      msg = <span className="steal-msg"><b>{snap.teams[r.controlling === 0 ? 1 : 0].name}</b> can steal! Huddle up — <b>{playerName(snap, r.stealPlayerId)}</b> answers.</span>;
      break;
    case "roundEnd": {
      const o = r.outcome!;
      const hidden = r.slots.some((s) => !s.revealed);
      const how = { cleared: "cleared the board", stolen: "stole it", defended: "held on", suddenDeath: "wins sudden death", skipped: "" }[o.reason];
      msg = (
        <span>
          {o.team == null ? "Round skipped." : <><b>{snap.teams[o.team].name}</b> {how} · <b className="gold">+{o.points}</b></>}
          {hidden && <span className="muted"> · Next reveals the rest</span>}
        </span>
      );
      break;
    }
  }
  const showTimer = snap.timer && ["faceoff", "playOrPass", "play", "steal"].includes(snap.phase) && !(snap.phase === "faceoff" && fo.stage === "ready");
  return (
    <div className="status">
      <div className="status-main">{msg}</div>
      {showTimer && <TimerRing timer={snap.timer} size={68} />}
      <GuessBubble snap={snap} />
    </div>
  );
}

// ---------------------------------------------------------------- game over

function GameOver({ snap }: { snap: GameSnapshot }) {
  const w = snap.winner ?? 0;
  const members = snap.players.filter((p) => p.team === w);
  return (
    <div className="center-screen">
      <Confetti active />
      <div className="winner-card panel">
        <span className="eyebrow">The sleigh says…</span>
        <h1 className={`team-${w}-text`}>{snap.teams[w].name} wins!</h1>
        <div className="final-scores">
          {[0, 1].map((t) => (
            <div key={t} className={`final-score ${t === w ? "win" : ""}`}>
              <span>{snap.teams[t].name}</span>
              <b>{snap.teams[t].score}</b>
            </div>
          ))}
        </div>
        <div className="winner-avatars">
          {members.map((p) => <PlayerChip key={p.id} p={p} size={72} />)}
        </div>
        <p className="muted">Up next: the <b className="gold">Snowball Sprint</b> — two players, five rapid questions, 200 points to win.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- snowball sprint (fast money)

function FastMoneyScreen({ snap, code }: { snap: GameSnapshot; code: string }) {
  const fm = snap.fm!;
  const players = fm.players.map((id) => snap.players.find((p) => p.id === id));
  const members = snap.players.filter((p) => p.team === fm.team);
  const ready = snap.phase === "fmPlay" && snap.timer ? serverNow() < snap.timer.endsAt - (fm.turn === 0 ? 20000 : 25000) : false;
  return (
    <div className="fm">
      <header className="host-top">
        <Logo size="sm" />
        <div className="round-pill"><span>Snowball Sprint</span><span className="mult">{snap.teams[fm.team].name}</span></div>
        <div className="join-badge"><b>{code}</b></div>
      </header>

      {snap.phase === "fmIntro" ? (
        <div className="fm-intro panel">
          <h1>Snowball Sprint</h1>
          <p className="lede">Five quick survey questions. Player one gets <b>20 seconds</b>, player two gets <b>25</b> — and can't repeat an answer. Together, score <b className="gold">200 points</b> to win!</p>
          <div className="fm-pickers">
            {[0, 1].map((i) => (
              <label key={i} className="fm-picker">
                <span className="eyebrow">Player {i + 1}</span>
                {players[i] && <Avatar config={players[i]!.avatar} size={96} />}
                <select
                  value={fm.players[i]}
                  onChange={(e) => {
                    const next = [...fm.players] as [string, string];
                    next[i] = e.target.value;
                    socket.emit("host:fmPlayers", { p1: next[0], p2: next[1] });
                  }}
                >
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="muted small">Player 2: look away from the screen while Player 1 answers!</p>
        </div>
      ) : (
        <div className="fm-board panel">
          <div className="fm-top">
            <div className="fm-total">
              <span className="eyebrow">Total</span>
              <AnimatedNumber className="fm-total-num" value={fm.total} />
              <span className="fm-target">/ {fm.target}</span>
            </div>
            {snap.phase === "fmPlay" && (
              <div className="fm-now">
                {players[fm.turn] && <Avatar config={players[fm.turn]!.avatar} size={72} ring="var(--gold)" />}
                <div>
                  <span className="eyebrow">Now answering</span>
                  <b>{players[fm.turn]?.name}</b>
                </div>
                {ready ? <div className="fm-ready">Get ready…</div> : <TimerRing timer={snap.timer} size={92} offsetMs={3000} />}
              </div>
            )}
          </div>
          <div className="fm-grid">
            <div className="fm-head"></div>
            <div className="fm-head">{players[0]?.name}</div>
            <div className="fm-head">{players[1]?.name}</div>
            {fm.prompts.map((prompt, i) => (
              <FmRow key={i} i={i} prompt={prompt} snap={snap} />
            ))}
          </div>
        </div>
      )}
      {snap.phase === "fmEnd" && (
        <div className="overlay">
          <Confetti active={!!fm.won} />
          <div className="round-intro-card">
            <span className="eyebrow">{fm.total} points</span>
            <h1>{fm.won ? "You did it!" : "So close!"}</h1>
            <p>{fm.won ? `${snap.teams[fm.team].name} conquered the Snowball Sprint!` : `Needed ${fm.target}. What a game, everyone!`}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function FmRow({ i, prompt, snap }: { i: number; prompt: string; snap: GameSnapshot }) {
  const fm = snap.fm!;
  const active = snap.phase === "fmPlay" && fm.cursor === i;
  const cell = (turn: 0 | 1) => {
    const a = fm.answers[turn][i];
    const covered = snap.phase === "fmPlay" && (turn === 0 ? fm.turn === 1 : true);
    if (covered || !a.revealed)
      return <div className={`fm-cell ${covered && turn === 0 && fm.turn === 1 ? "covered" : ""}`}><span className="fm-text">{turn === 0 && fm.turn === 1 && snap.phase === "fmPlay" ? "❄ ❄ ❄" : ""}</span><span className="fm-pts" /></div>;
    return (
      <div className={`fm-cell shown ${a.points ? "" : "zero"}`}>
        <span className="fm-text">{a.text}{a.label && a.label.toLowerCase() !== (a.text ?? "").toLowerCase() && <small> → {a.label}</small>}</span>
        <span className="fm-pts">{a.points}</span>
      </div>
    );
  };
  return (
    <>
      <div className={`fm-prompt ${active ? "active" : ""}`}>{prompt}</div>
      {cell(0)}
      {cell(1)}
    </>
  );
}

// ---------------------------------------------------------------- host controls

function nextLabel(snap: GameSnapshot): string | null {
  const r = snap.round;
  switch (snap.phase) {
    case "roundIntro": return "Skip intro";
    case "roundEnd": return r && r.slots.some((s) => !s.revealed) ? "Reveal answer" : "Continue";
    case "gameOver": return "Snowball Sprint";
    case "fmIntro": return "Start player 1";
    case "fmReveal": return snap.fm && snap.fm.turn === 0 && snap.fm.revealStep >= 5 ? "Start player 2" : null;
    case "fmEnd": return "Back to lobby";
    default: return null;
  }
}

function HostDock({ snap, secret, joinBase, voice, muted, onVoice, onMute }: {
  snap: GameSnapshot; secret: HostSecret | null; joinBase: string; voice: boolean; muted: boolean; onVoice: () => void; onMute: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState(false);
  const label = nextLabel(snap);
  const r = snap.round;
  const inRound = ["faceoff", "playOrPass", "play", "steal", "roundEnd"].includes(snap.phase);
  if (snap.phase === "lobby") {
    return (
      <div className="dock">
        <button className="icon-btn" onClick={onMute} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
        <button className="icon-btn" onClick={toggleFullscreen} aria-label="Fullscreen">⛶</button>
        <button className="icon-btn" onClick={() => setRemote(true)} aria-label="Host remote">📱</button>
        {remote && <RemoteModal code={snap.code} base={joinBase} onClose={() => setRemote(false)} />}
      </div>
    );
  }
  return (
    <div className="dock">
      {open && (
        <div className="dock-menu panel">
          {inRound && r && (
            <>
              <span className="eyebrow">Judge's override</span>
              <div className="award-grid">
                {r.slots.map((s, i) => (
                  <button key={i} disabled={s.revealed} onClick={() => act({ type: "award", slot: i })} title={secret?.answers[i]?.label}>
                    Reveal #{i + 1}
                  </button>
                ))}
              </div>
              <div className="dock-row">
                <button disabled={!(snap.phase === "play" && r.strikes > 0) && snap.phase !== "steal"} onClick={() => act({ type: "undoStrike" })}>↩ Undo strike</button>
                <button disabled={snap.phase === "roundEnd"} onClick={() => confirm("Skip this round? No points awarded.") && act({ type: "skipRound" })}>⏭ Skip round</button>
              </div>
              {snap.phase === "faceoff" && (
                <div className="dock-row">
                  {[0, 1].map((t) => (
                    <button key={t} onClick={() => act({ type: "faceoffWinner", team: t as TeamId })}>Face-off → {snap.teams[t].name}</button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="dock-row">
            <button onClick={() => setRemote(true)}>📱 Phone remote</button>
            <button onClick={() => confirm("End this game and go back to the lobby?") && act({ type: "toLobby" })}>🏠 Lobby</button>
          </div>
          <div className="dock-row">
            <button onClick={onVoice}>{voice ? "🗣 Voice on" : "🤐 Voice off"}</button>
            <button onClick={() => confirm("Close this room and make a brand new one? Players will need the new code.") && newRoom()}>✨ New room</button>
          </div>
          <p className="muted small">Shortcuts: Space = next · F = fullscreen · M = mute</p>
        </div>
      )}
      <button className="icon-btn" onClick={onMute} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
      <button className={`icon-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label="Host menu" aria-expanded={open}>☰</button>
      {label && (
        <button className="btn-primary" onClick={() => { unlockAudio(); act({ type: "next" }); }}>
          {label} <kbd>Space</kbd>
        </button>
      )}
      {remote && <RemoteModal code={snap.code} base={joinBase} onClose={() => setRemote(false)} />}
    </div>
  );
}

function RemoteModal({ code, base, onClose }: { code: string; base: string; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const session = hostSession.get();
  const url = useMemo(() => `${base}/remote#code=${code}&t=${session?.hostToken ?? ""}`, [base, code, session?.hostToken]);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 300 }).then(setQr).catch(() => {});
  }, [url]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel remote-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Host remote</h2>
        <p className="muted">Scan with <b>your</b> phone to see every answer and judge from anywhere in the room. Don't show this to players!</p>
        {qr && <img src={qr} alt="QR code for the host remote" />}
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export type { PublicPlayer };
