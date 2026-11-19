import { useEffect, useState } from "react";
import { Logo, Snow } from "../components/ui";
import { navigate } from "../router";

interface NetRoom {
  code: string;
  players: number;
  phase: string;
  teams: [string, string];
}

export function Home() {
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState<NetRoom[]>([]);

  // Rooms hosted on the same network (same school Wi-Fi / same laptop LAN).
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/rooms")
        .then((r) => r.json())
        .then((d) => alive && setRooms(d.rooms ?? []))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="home stage">
      <Snow count={70} />
      <main className="home-inner">
        <Logo size="lg" />
        <p className="home-tag">The holiday survey game show. Two teams, real data, one big screen.</p>

        <div className="home-cards">
          <form
            className="panel home-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 4) navigate(`/play?code=${code}`);
            }}
          >
            <h2>Join a game</h2>
            <p className="muted">Enter the 4-letter code from the big screen.</p>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
              placeholder="ABCD"
              aria-label="Game code"
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button className="btn-primary big" disabled={code.length !== 4}>Join</button>
            {rooms.length > 0 && (
              <div className="net-rooms">
                <span className="eyebrow">Games on your network</span>
                {rooms.map((r) => (
                  <button type="button" key={r.code} className="net-room" onClick={() => navigate(`/play?code=${r.code}`)}>
                    <b>{r.code}</b>
                    <span>{r.teams[0]} vs {r.teams[1]}</span>
                    <span className="muted">{r.players} playing{r.phase !== "lobby" ? " · in progress" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </form>

          <div className="panel home-card host-card">
            <h2>Host a game</h2>
            <p className="muted">Open this on the laptop connected to the projector or TV. Everyone else joins on their phone.</p>
            <button className="btn-primary big" onClick={() => navigate("/host")}>Open the big screen</button>
            <ul className="how">
              <li><b>Face-off:</b> buzz in first and name the most popular answer.</li>
              <li><b>Play or pass:</b> your team takes turns until the board is clear…</li>
              <li><b>Three lumps of coal</b> and the other team can steal it all.</li>
              <li><b>Snowball Sprint:</b> five rapid questions, 200 points wins.</li>
            </ul>
          </div>
        </div>
        <p className="data-credit">Every answer is scored from real public data: how common it is in everyday English, and how much it spikes at the holidays.</p>
      </main>
    </div>
  );
}
