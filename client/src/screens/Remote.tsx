import { useEffect, useState } from "react";
import type { HostAction, TeamId } from "../../../shared/types";
import { emitAck, socket, useGame } from "../socket";
import { Logo, StrikeRow, TimerRing } from "../components/ui";

/** The host's private "answer card" on their own phone. */
export function Remote() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const code = hash.get("code") ?? "";
  const hostToken = hash.get("t") ?? "";
  const [status, setStatus] = useState<"connecting" | "ok" | "bad">("connecting");
  const { snap, secret } = useGame();

  useEffect(() => {
    const go = async () => setStatus((await emitAck<boolean>("host:resume", { code, hostToken })) ? "ok" : "bad");
    if (socket.connected) go();
    socket.on("connect", go);
    return () => void socket.off("connect", go);
  }, [code, hostToken]);

  const act = (a: HostAction) => socket.emit("host:action", a);
  if (status === "bad") return <div className="remote"><Logo size="sm" /><p className="error">This remote link has expired. Open a new one from the big screen.</p></div>;
  if (!snap || !secret) return <div className="remote"><Logo size="sm" /><p className="muted">Connecting…</p></div>;
  const r = snap.round;
  const inRound = ["faceoff", "playOrPass", "play", "steal", "roundEnd"].includes(snap.phase);
  return (
    <div className="remote">
      <header className="remote-top">
        <Logo size="sm" />
        <span className="code-pill">{snap.code}</span>
      </header>
      <div className="remote-scores">
        {[0, 1].map((t) => <div key={t} className={`team-${t}`}><span>{snap.teams[t].name}</span><b>{snap.teams[t].score}</b></div>)}
      </div>
      <p className="eyebrow">Phase: {snap.phase}</p>
      {r && inRound && (
        <>
          <h2 className="remote-q">{secret.question}</h2>
          <div className="remote-meta">
            <span>Stocking: <b>{r.bank}</b> (×{r.multiplier})</span>
            {snap.phase === "play" && <StrikeRow count={r.strikes} size={26} />}
            <TimerRing timer={snap.timer} size={48} />
          </div>
          {r.lastGuess?.text && <p className="remote-guess">Last guess: “{r.lastGuess.text}” → {r.lastGuess.result}</p>}
          <ol className="remote-answers">
            {secret.answers.map((a, i) => (
              <li key={i} className={`${a.onBoard ? "" : "off"} ${a.revealed ? "rev" : ""}`}>
                <span className="ra-label">{a.label}</span>
                <span className="ra-pts">{a.points}</span>
                {a.onBoard && !a.revealed && <button onClick={() => act({ type: "award", slot: i })}>Award</button>}
              </li>
            ))}
          </ol>
          <div className="remote-row">
            <button onClick={() => act({ type: "undoStrike" })}>↩ Undo strike</button>
            <button onClick={() => confirm("Skip this round?") && act({ type: "skipRound" })}>⏭ Skip</button>
          </div>
          {snap.phase === "faceoff" && (
            <div className="remote-row">
              {[0, 1].map((t) => <button key={t} onClick={() => act({ type: "faceoffWinner", team: t as TeamId })}>Face-off → {snap.teams[t].name}</button>)}
            </div>
          )}
        </>
      )}
      {snap.phase.startsWith("fm") && (
        <ol className="remote-answers">
          {secret.fmQuestions.map((q, i) => (
            <li key={i} className="fmq">
              <b>{q.prompt}</b>
              <span className="muted small">{q.answers.slice(0, 5).map((a) => `${a.label} ${a.points}`).join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
      <button className="btn-primary big remote-next" onClick={() => act(snap.phase === "lobby" ? { type: "start" } : { type: "next" })}>
        {snap.phase === "lobby" ? "Start game" : "Next ▶"}
      </button>
    </div>
  );
}
