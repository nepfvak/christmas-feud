import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BoardSlot, PublicPlayer, TimerView } from "../../../shared/types";
import { serverNow, useTicker } from "../socket";
import { Avatar } from "./Avatar";

export const TEAM_COLORS = ["var(--team0)", "var(--team1)"] as const;

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`logo logo-${size}`} aria-label="Sleigh Says!">
      <span className="logo-sleigh">Sleigh</span>
      <span className="logo-says">Says!</span>
    </div>
  );
}

/** Lightweight canvas snowfall; respects reduced-motion. */
export function Snow({ count = 90 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const flakes = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() * 2.4 + 0.8,
      s: Math.random() * 0.6 + 0.3, d: Math.random() * Math.PI * 2,
    }));
    const loop = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const f of flakes) {
        f.y += f.s;
        f.d += 0.01;
        f.x += Math.sin(f.d) * 0.35;
        if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
        ctx.globalAlpha = 0.35 + f.r / 5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [count]);
  return <canvas ref={ref} className="snow" aria-hidden="true" />;
}

export function secondsLeft(timer: TimerView | null): number {
  if (!timer) return 0;
  return Math.max(0, (timer.endsAt - serverNow()) / 1000);
}

export function TimerRing({ timer, size = 84, offsetMs = 0, label }: { timer: TimerView | null; size?: number; offsetMs?: number; label?: string }) {
  useTicker(200);
  if (!timer) return null;
  const total = (timer.total - offsetMs) / 1000;
  const left = Math.min(total, secondsLeft(timer));
  const frac = total > 0 ? left / total : 0;
  const r = 42, c = 2 * Math.PI * r;
  const urgent = left <= 5;
  return (
    <div className={`timer ${urgent ? "urgent" : ""}`} style={{ width: size, height: size }} role="timer" aria-label={`${Math.ceil(left)} seconds left`}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} className="timer-track" />
        <circle cx="50" cy="50" r={r} className="timer-fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 50 50)" />
      </svg>
      <span className="timer-num">{Math.ceil(left)}</span>
      {label && <span className="timer-label">{label}</span>}
    </div>
  );
}

/** The answer board. Slots are laid out column-first like the TV board (1-4 left, 5-8 right). */
export function Board({ slots, multiplier, compact }: { slots: BoardSlot[]; multiplier: number; compact?: boolean }) {
  const rows = Math.ceil(slots.length / 2);
  const single = slots.length <= 1;
  return (
    <div className={`board ${compact ? "compact" : ""} ${single ? "single" : ""}`} style={{ "--rows": single ? 1 : rows } as CSSProperties}>
      {slots.map((s, i) => (
        <div
          key={i}
          className={`slot ${s.revealed ? "revealed" : ""}`}
          style={single ? undefined : { gridColumn: i < rows ? 1 : 2, gridRow: (i % rows) + 1 }}
        >
          <div className="slot-inner">
            <div className="slot-face slot-front">
              <span className="ribbon-v" />
              <span className="ribbon-h" />
              <span className="slot-num">{i + 1}</span>
            </div>
            <div className="slot-face slot-back">
              <span className="slot-label">{s.label}</span>
              <span className="slot-points">{s.points !== undefined ? s.points * (multiplier || 1) : ""}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lumps of coal replace the classic big red X. */
export function Coal({ size = 64, dim }: { size?: number; dim?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`coal ${dim ? "dim" : ""}`} aria-hidden="true">
      <path d="M10 38 L16 20 L30 12 L46 16 L56 30 L52 48 L36 56 L18 52 Z" fill="#23232a" />
      <path d="M16 20 L30 12 L32 28 Z M46 16 L56 30 L40 30 Z M18 52 L24 38 L36 56 Z" fill="#3a3a44" />
      <path d="M30 12 L46 16 L40 30 L32 28 Z" fill="#4b4b57" />
      <path d="M24 38 L32 28 L40 30 L52 48 L36 56 Z" fill="#17171c" />
      <circle cx="38" cy="22" r="2" fill="#9aa" opacity=".6" />
    </svg>
  );
}

export function StrikeRow({ count, max = 3, size = 40 }: { count: number; max?: number; size?: number }) {
  return (
    <div className="strike-row" aria-label={`${count} of ${max} strikes`}>
      {Array.from({ length: max }, (_, i) => <Coal key={i} size={size} dim={i >= count} />)}
    </div>
  );
}

/** Big full-screen coal drop when a strike happens. Keyed by event id. */
export function StrikeFlash({ eventId, count }: { eventId: number | null; count: number }) {
  const [show, setShow] = useState<{ id: number; count: number } | null>(null);
  useEffect(() => {
    if (eventId == null) return;
    setShow({ id: eventId, count: Math.max(1, count) });
    const t = setTimeout(() => setShow(null), 1300);
    return () => clearTimeout(t);
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  return (
    <div className="strike-flash" key={show.id}>
      {Array.from({ length: show.count }, (_, i) => (
        <div key={i} className="strike-flash-coal" style={{ animationDelay: `${i * 70}ms` }}>
          <Coal size={180} />
        </div>
      ))}
    </div>
  );
}

export function Confetti({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    const colors = ["#f4c25b", "#e23a4e", "#2fb37a", "#fff8ef", "#7fd3ff"];
    const bits = Array.from({ length: 180 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.4, y: h * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      r: Math.random() * 6 + 4, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0, frames = 0;
    const loop = () => {
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.vy += 0.32; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c;
        ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore();
      }
      if (++frames < 260) raf = requestAnimationFrame(loop);
      else ctx.clearRect(0, 0, w, h);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}

export function PlayerChip({ p, active, size = 44, onClick, title }: { p: PublicPlayer; active?: boolean; size?: number; onClick?: () => void; title?: string }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`chip ${active ? "active" : ""} ${p.connected ? "" : "offline"}`} onClick={onClick} title={title} type={onClick ? "button" : undefined}>
      <Avatar config={p.avatar} size={size} />
      <span className="chip-name">{p.name}</span>
    </Tag>
  );
}
