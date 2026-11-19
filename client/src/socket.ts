import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { GameSnapshot, HostSecret } from "../../shared/types";

// Same origin as the page. Socket.IO starts with HTTP long-polling and upgrades to
// WebSockets when it can, so it keeps working on picky school networks.
export const socket = io({ autoConnect: true });

let clockOffset = 0;
/** server time estimate, so countdowns agree on every screen */
export const serverNow = () => Date.now() + clockOffset;

export interface FmProgress {
  answered: (string | null)[];
  passed: number[];
  readyUntil: number;
}

let lastSnap: GameSnapshot | null = null;
let lastSecret: HostSecret | null = null;
let lastFm: FmProgress | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

socket.on("state", (s: GameSnapshot) => {
  clockOffset = s.serverNow - Date.now();
  lastSnap = s;
  notify();
});
socket.on("secret", (s: HostSecret) => {
  lastSecret = s;
  notify();
});
socket.on("fmProgress", (p: FmProgress) => {
  lastFm = p;
  notify();
});
socket.on("connect", notify);
socket.on("disconnect", notify);

export function resetGameState() {
  lastSnap = null;
  lastSecret = null;
  lastFm = null;
  notify();
}

export function useGame() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { snap: lastSnap, secret: lastSecret, fmProgress: lastFm, connected: socket.connected };
}

/** re-render every `ms` (for countdowns) */
export function useTicker(ms = 250) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function emitAck<T>(event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => socket.emit(event, ...args, (r: T) => resolve(r)));
}

// ---- persisted sessions (survive refreshes and Wi-Fi blips)
export interface HostSession { code: string; hostToken: string }
export interface PlayerSession { code: string; playerId: string; token: string }

const read = <T,>(store: () => Storage, k: string): T | null => {
  try {
    return JSON.parse(store().getItem(k) ?? "null");
  } catch {
    return null;
  }
};
const write = (store: () => Storage, k: string, v: unknown) => {
  try {
    if (v === null) store().removeItem(k);
    else store().setItem(k, JSON.stringify(v));
  } catch {}
};
const local = () => localStorage;
// Player seats are per-tab: a refresh keeps your seat, but two tabs (or two kids
// sharing a laptop) never collide as the same player.
const tab = () => sessionStorage;
export const hostSession = { get: () => read<HostSession>(local, "ss-host"), set: (v: HostSession | null) => write(local, "ss-host", v) };
export const playerSession = { get: () => read<PlayerSession>(tab, "ss-player"), set: (v: PlayerSession | null) => write(tab, "ss-player", v) };

/** Returns events newer than the last one this caller saw (none on the first snapshot, so refreshes don't replay). */
export function takeNewEvents(snap: GameSnapshot | null, seen: { current: number }) {
  if (!snap || !snap.events.length) return [];
  const newest = snap.events[snap.events.length - 1].id;
  if (seen.current === -1) {
    seen.current = newest;
    return [];
  }
  const fresh = snap.events.filter((e) => e.id > seen.current);
  seen.current = Math.max(seen.current, newest);
  return fresh;
}
