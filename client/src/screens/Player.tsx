import { useEffect, useRef, useState } from "react";
import type { AvatarConfig, GameSnapshot, JoinResult, PublicPlayer, TeamId } from "../../../shared/types";
import { MAX_NAME } from "../../../shared/types";
import { randomAvatar, sanitizeAvatar } from "../../../shared/avatar";
import { emitAck, playerSession, resetGameState, serverNow, socket, takeNewEvents, useGame, useTicker, type FmProgress } from "../socket";
import { unlockAudio, vibrate } from "../audio";
import { playSfx } from "../clips";
import { Avatar } from "../components/Avatar";
import { AvatarEditor } from "../components/AvatarEditor";
import { Logo, Snow, StrikeRow, TimerRing } from "../components/ui";

const PROFILE_KEY = "ss-profile";
function loadProfile(): { name: string; avatar: AvatarConfig } {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
    if (p) return { name: String(p.name ?? ""), avatar: sanitizeAvatar(p.avatar) };
  } catch {}
  return { name: "", avatar: randomAvatar() };
}
function saveProfile(name: string, avatar: AvatarConfig) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, avatar }));
  } catch {}
}

export function Player() {
  const params = new URLSearchParams(window.location.search);
  const urlCode = (params.get("code") ?? "").toUpperCase();
  const [me, setMe] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const { snap, fmProgress, connected } = useGame();

  // Resume an existing seat after refresh / Wi-Fi drop.
  useEffect(() => {
    const tryResume = async () => {
      const s = playerSession.get();
      if (!s || (urlCode && s.code !== urlCode)) {
        setChecking(false);
        return;
      }
      const r = await emitAck<JoinResult>("player:resume", s);
      if (r.ok) setMe(r.playerId!);
      else playerSession.set(null);
      setChecking(false);
    };
    if (socket.connected) tryResume();
    socket.on("connect", tryResume);
    return () => void socket.off("connect", tryResume);
  }, [urlCode]);

  // kicked by host: we were in the player list, and now we're not
  const iAmInRoom = !!(me && snap?.players.some((p) => p.id === me));
  const seenSelf = useRef(false);
  useEffect(() => {
    if (iAmInRoom) seenSelf.current = true;
    else if (me && snap && seenSelf.current) {
      seenSelf.current = false;
      playerSession.set(null);
      setMe(null);
    }
  }, [me, snap, iAmInRoom]);

  if (checking || (me && !iAmInRoom && !seenSelf.current)) return <Shell><p className="muted center-text">Connecting…</p></Shell>;
  if (!me || !snap || !iAmInRoom) {
    return (
      <JoinForm
        initialCode={urlCode}
        onJoined={(id) => {
          setMe(id);
        }}
      />
    );
  }
  return <Controller snap={snap} me={me} fmProgress={fmProgress} connected={connected} onLeave={() => {
    socket.emit("player:leave");
    playerSession.set(null);
    resetGameState();
    setMe(null);
  }} />;
}

function Shell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`phone ${className}`}>
      <Snow count={30} />
      <div className="phone-inner">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- join

function JoinForm({ initialCode, onJoined }: { initialCode: string; onJoined: (id: string) => void }) {
  const profile = useRef(loadProfile()).current;
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState<AvatarConfig>(profile.avatar);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"code" | "profile">(initialCode.length === 4 ? "profile" : "code");

  const checkCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== 4) return setError("Codes are 4 letters.");
    const r = await emitAck<{ exists: boolean }>("room:peek", c);
    if (!r.exists) return setError("No game with that code. Check the big screen!");
    setError("");
    setStep("profile");
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (!name.trim()) return setError("Pick a name first!");
    setBusy(true);
    const r = await emitAck<JoinResult>("player:join", { code: code.trim().toUpperCase(), name, avatar });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't join.");
    saveProfile(name, avatar);
    playerSession.set({ code: r.code!, playerId: r.playerId!, token: r.token! });
    window.history.replaceState(null, "", `/play?code=${r.code}`);
    onJoined(r.playerId!);
  };

  if (step === "code") {
    return (
      <Shell>
        <Logo size="md" />
        <form className="card join-card" onSubmit={checkCode}>
          <label className="field">
            <span>Game code</span>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
              placeholder="ABCD"
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              autoFocus
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn-primary big" type="submit">Next</button>
        </form>
      </Shell>
    );
  }
  return (
    <Shell>
      <form className="card join-card" onSubmit={join}>
        <div className="join-head">
          <span className="eyebrow">Joining game</span>
          <button type="button" className="code-pill" onClick={() => setStep("code")}>{code} ✎</button>
        </div>
        <AvatarEditor value={avatar} onChange={setAvatar} />
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))} placeholder="Jolly Jamie" maxLength={MAX_NAME} autoComplete="nickname" enterKeyHint="go" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-primary big" type="submit" disabled={busy}>{busy ? "Joining…" : "Join the show!"}</button>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------- controller

function useMyFeedback(snap: GameSnapshot, me: string) {
  const [toast, setToast] = useState<{ id: number; kind: "hit" | "miss" | "dupe"; text: string } | null>(null);
  const seen = useRef<number>(-1);
  const wasMyTurn = useRef(false);
  const r = snap.round;
  const myTurn = !!r && r.activePlayerId === me && ["faceoff", "play", "steal"].includes(snap.phase);

  useEffect(() => {
    const g = snap.round?.lastGuess;
    const mine = g?.playerId === me;
    for (const e of takeNewEvents(snap, seen)) {
      if (e.type === "fmDupe" && e.playerId === me) {
        setToast({ id: e.id, kind: "dupe", text: "Your partner said that! Try another." });
        playSfx("dupe");
        vibrate([60, 40, 60]);
      } else if (mine && e.type === "reveal" && e.team != null) {
        setToast({ id: e.id, kind: "hit", text: `Nice! #${(g!.slot ?? 0) + 1} on the board` });
        vibrate(80);
      } else if (mine && (e.type === "strike" || e.type === "stealStart")) {
        setToast({ id: e.id, kind: "miss", text: g?.result === "timeout" ? "Out of time!" : "Not on the board" });
        vibrate([200]);
      } else if (mine && e.type === "dupe") {
        setToast({ id: e.id, kind: "dupe", text: "Already on the board — try again!" });
        vibrate([60, 40, 60]);
      }
    }
  }, [snap.event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      vibrate([120, 60, 120]);
      playSfx("yourTurn");
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);
  return toast;
}

function Controller({ snap, me, fmProgress, connected, onLeave }: { snap: GameSnapshot; me: string; fmProgress: FmProgress | null; connected: boolean; onLeave: () => void }) {
  const self = snap.players.find((p) => p.id === me)!;
  const team = self.team ?? 0;
  const toast = useMyFeedback(snap, me);
  return (
    <Shell className={`team-${team}-phone`}>
      <header className="phone-top">
        <div className="me">
          <Avatar config={self.avatar} size={40} />
          <div>
            <b>{self.name}</b>
            <span className={`team-tag team-${team}`}>{snap.teams[team].name}</span>
          </div>
        </div>
        {snap.phase !== "lobby" && (
          <div className="mini-scores" aria-label="Scores">
            <span className="team-0">{snap.teams[0].score}</span>
            <span className="team-1">{snap.teams[1].score}</span>
          </div>
        )}
      </header>
      <main className="phone-main">
        <PhaseView snap={snap} me={self} fmProgress={fmProgress} onLeave={onLeave} />
      </main>
      {toast && <div className={`toast ${toast.kind}`} key={toast.id} role="status">{toast.text}</div>}
      {!connected && <div className="conn-banner">Reconnecting…</div>}
    </Shell>
  );
}

function name(snap: GameSnapshot, id: string | null | undefined) {
  return snap.players.find((p) => p.id === id)?.name ?? "Someone";
}

function PhaseView({ snap, me, fmProgress, onLeave }: { snap: GameSnapshot; me: PublicPlayer; fmProgress: FmProgress | null; onLeave: () => void }) {
  const r = snap.round;
  const myTeam = me.team as TeamId;
  switch (snap.phase) {
    case "lobby":
      return <PhoneLobby snap={snap} me={me} onLeave={onLeave} />;
    case "roundIntro":
      return (
        <Big eyebrow={r?.suddenDeath ? "Sudden death" : `Round ${r?.number}`} title={r?.multiplier === 1 ? "Here we go!" : r?.multiplier === 2 ? "Double points!" : "Triple points!"}>
          <p className="muted">Eyes on the big screen.</p>
        </Big>
      );
    case "faceoff": {
      const fo = r!.faceoff;
      const inIt = fo.players.includes(me.id);
      if (r!.activePlayerId === me.id) return <AnswerBox snap={snap} title="Face-off! What's your answer?" />;
      if (inIt && fo.stage === "live") return <BuzzButton />;
      if (inIt && fo.stage === "ready") return <Big eyebrow="You're in the face-off" title="Hands on the buzzer…"><p className="muted">Wait for it…</p></Big>;
      if (inIt && fo.buzzed && fo.buzzed !== me.id && fo.stage === "first") return <Big eyebrow="Face-off" title={`${name(snap, fo.buzzed)} buzzed first`}><p className="muted">Get ready — you might answer next!</p></Big>;
      const [a, b] = fo.players;
      return <Big eyebrow="Face-off" title={`${name(snap, a)} vs ${name(snap, b)}`}><p className="muted">{fo.stage === "live" ? "Who will buzz first?" : r!.activePlayerId ? `${name(snap, r!.activePlayerId)} is answering…` : "Watch the big screen!"}</p></Big>;
    }
    case "playOrPass":
      if (r!.faceoffWinner === me.id) {
        return (
          <div className="choose">
            <span className="eyebrow">You won the face-off!</span>
            <h2>Play or pass?</h2>
            <TimerRing timer={snap.timer} size={64} />
            <button className="btn-primary huge" onClick={() => socket.emit("player:choose", true)}>🎁 PLAY</button>
            <button className="btn-ghost huge" onClick={() => socket.emit("player:choose", false)}>Pass to {snap.teams[myTeam === 0 ? 1 : 0].name}</button>
          </div>
        );
      }
      return <Big eyebrow="Face-off won" title={`${name(snap, r!.faceoffWinner)} is deciding…`}><p className="muted">Play or pass?</p></Big>;
    case "play": {
      if (r!.activePlayerId === me.id) return <AnswerBox snap={snap} title="Your turn! Name an answer" showStrikes />;
      const ours = r!.controlling === myTeam;
      return (
        <Big eyebrow={ours ? "Your team is playing" : "Other team is playing"} title={`${name(snap, r!.activePlayerId)}'s turn`}>
          <StrikeRow count={r!.strikes} size={40} />
          <p className="muted">{ours ? "Don't shout it out — wait for your turn!" : "Three strikes and your team can steal. Start thinking!"}</p>
        </Big>
      );
    }
    case "steal": {
      if (r!.stealPlayerId === me.id) return <AnswerBox snap={snap} title="Steal it! Huddle with your team, then answer" />;
      const stealing = r!.controlling !== myTeam;
      return (
        <Big eyebrow={stealing ? "Steal chance!" : "Uh oh…"} title={stealing ? `Huddle up! Tell ${name(snap, r!.stealPlayerId)} your best guess` : `${snap.teams[myTeam === 0 ? 1 : 0].name} is trying to steal`}>
          <TimerRing timer={snap.timer} size={64} />
        </Big>
      );
    }
    case "roundEnd": {
      const o = r!.outcome!;
      const ours = o.team === myTeam;
      return (
        <Big eyebrow={o.team == null ? "Round over" : ours ? "Your team scored!" : "Round over"} title={o.team == null ? "Skipped" : `${ours ? "+" : ""}${o.points} for ${snap.teams[o.team].name}`}>
          <p className="muted">Watch the board for the rest of the answers.</p>
        </Big>
      );
    }
    case "gameOver": {
      const won = snap.winner === myTeam;
      return <Big eyebrow={won ? "Victory!" : "Great game!"} title={won ? "Your team wins! 🎉" : `${snap.teams[snap.winner ?? 0].name} wins`}><p className="muted">{won ? "Two of you are headed to the Snowball Sprint…" : "Stick around for the Snowball Sprint!"}</p></Big>;
    }
    case "fmIntro": {
      const fm = snap.fm!;
      const idx = fm.players.indexOf(me.id);
      return <Big eyebrow="Snowball Sprint" title={idx >= 0 ? `You're player ${idx + 1}!` : "Bonus round!"}><p className="muted">{idx === 1 ? "Don't look at the big screen while player 1 answers!" : idx === 0 ? "Answer 5 questions fast. You'll have 20 seconds." : "Cheer them on!"}</p></Big>;
    }
    case "fmPlay": {
      const fm = snap.fm!;
      if (fm.players[fm.turn] === me.id) return <FastMoneyPad snap={snap} progress={fmProgress} />;
      const waiting = fm.players[1] === me.id && fm.turn === 0;
      return <Big eyebrow="Snowball Sprint" title={waiting ? "Look away from the screen! 🙈" : `${name(snap, fm.players[fm.turn])} is sprinting!`}><TimerRing timer={snap.timer} size={64} offsetMs={3000} /></Big>;
    }
    case "fmReveal":
      return <Big eyebrow="Snowball Sprint" title={`${snap.fm!.total} points so far`}><p className="muted">Eyes on the big screen!</p></Big>;
    case "fmEnd":
      return <Big eyebrow="Snowball Sprint" title={snap.fm!.won ? "WINNERS! 🎉" : "So close!"}><p className="muted">{snap.fm!.total} points. Thanks for playing!</p></Big>;
  }
}

function Big({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="big">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function PhoneLobby({ snap, me, onLeave }: { snap: GameSnapshot; me: PublicPlayer; onLeave: () => void }) {
  const [editing, setEditing] = useState(false);
  const [avatar, setAvatar] = useState(me.avatar);
  if (editing) {
    return (
      <div className="card">
        <AvatarEditor value={avatar} onChange={setAvatar} />
        <button className="btn-primary big" onClick={() => {
          socket.emit("player:update", { avatar });
          saveProfile(me.name, avatar);
          setEditing(false);
        }}>Save look</button>
      </div>
    );
  }
  return (
    <div className="phone-lobby">
      <button className="avatar-big" onClick={() => setEditing(true)} aria-label="Edit avatar">
        <Avatar config={me.avatar} size={140} />
        <span className="edit-hint">Tap to restyle</span>
      </button>
      <h2>You're in!</h2>
      <p className="muted">Pick a team, then wait for the host to start.</p>
      <div className="team-picker">
        {[0, 1].map((t) => (
          <button
            key={t}
            className={`team-pick team-${t} ${me.team === t ? "on" : ""}`}
            onClick={() => socket.emit("player:update", { team: t })}
            aria-pressed={me.team === t}
          >
            <b>{snap.teams[t].name}</b>
            <span>{(() => { const n = snap.players.filter((p) => p.team === t).length; return `${n} ${n === 1 ? "player" : "players"}`; })()}</span>
          </button>
        ))}
      </div>
      <button className="link-btn" onClick={() => confirm("Leave this game?") && onLeave()}>Leave game</button>
    </div>
  );
}

function BuzzButton() {
  const [pressed, setPressed] = useState(false);
  useEffect(() => vibrate([80, 40, 80]), []);
  return (
    <div className="buzz-wrap">
      <button
        className={`buzz ${pressed ? "pressed" : ""}`}
        onPointerDown={(e) => {
          e.preventDefault();
          unlockAudio();
          setPressed(true);
          socket.emit("player:buzz");
          vibrate(60);
        }}
      >
        BUZZ!
      </button>
      <p className="muted">First to buzz gets to answer</p>
    </div>
  );
}

function AnswerBox({ snap, title, showStrikes }: { snap: GameSnapshot; title: string; showStrikes?: boolean }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const turnKey = `${snap.round?.number}-${snap.phase}-${snap.round?.activePlayerId}-${snap.timer?.endsAt}`;
  useEffect(() => {
    setSent(false);
    setText("");
    inputRef.current?.focus();
  }, [turnKey]);
  // a "dupe" keeps your turn: let them type again
  useEffect(() => {
    if (snap.event?.type === "dupe") {
      setSent(false);
      setText("");
      inputRef.current?.focus();
    }
  }, [snap.event?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sent) return;
    socket.emit("player:answer", text.trim());
    setSent(true);
  };
  return (
    <form className="answer" onSubmit={submit}>
      <div className="answer-head">
        <TimerRing timer={snap.timer} size={60} />
        <h2>{title}</h2>
      </div>
      <p className="answer-q">{snap.round?.question}</p>
      {showStrikes && <StrikeRow count={snap.round?.strikes ?? 0} size={32} />}
      <input
        ref={inputRef}
        className="answer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your answer…"
        maxLength={80}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        disabled={sent}
        aria-label="Your answer"
      />
      <button className="btn-primary big" type="submit" disabled={!text.trim() || sent}>{sent ? "Sent! 🤞" : "Lock it in"}</button>
    </form>
  );
}

function FastMoneyPad({ snap, progress }: { snap: GameSnapshot; progress: FmProgress | null }) {
  useTicker(200);
  const fm = snap.fm!;
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = progress ? serverNow() < progress.readyUntil : true;
  useEffect(() => {
    setText("");
    inputRef.current?.focus();
  }, [fm.cursor, ready]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    socket.emit("player:answer", text.trim());
    setText("");
  };
  if (ready) {
    const s = Math.ceil(((progress?.readyUntil ?? 0) - serverNow()) / 1000);
    return <Big eyebrow="Snowball Sprint" title={s > 0 ? `${s}…` : "GO!"}><p className="muted">Answer fast. Tap “Pass” to come back to one later.</p></Big>;
  }
  return (
    <form className="answer fm-pad" onSubmit={submit}>
      <div className="answer-head">
        <TimerRing timer={snap.timer} size={64} offsetMs={3000} />
        <div className="fm-dots" aria-label="Progress">
          {fm.prompts.map((_, i) => (
            <span key={i} className={`dot ${progress?.answered[i] ? "done" : ""} ${i === fm.cursor ? "now" : ""}`} />
          ))}
        </div>
      </div>
      <span className="eyebrow">Question {fm.cursor + 1} of {fm.prompts.length}</span>
      <p className="answer-q big-q">{fm.prompts[fm.cursor]}</p>
      <input
        ref={inputRef}
        className="answer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type fast!"
        maxLength={80}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        aria-label="Your answer"
      />
      <div className="fm-actions">
        <button type="button" className="btn-ghost big" onClick={() => socket.emit("player:fmPass")}>Pass</button>
        <button className="btn-primary big" type="submit" disabled={!text.trim()}>Next ›</button>
      </div>
    </form>
  );
}
