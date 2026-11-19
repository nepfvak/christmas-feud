/**
 * Sleigh Says! game server.
 *  - serves the built web client (dist/) in production
 *  - runs every room in memory (no database needed -> free hosting)
 *  - Socket.IO for realtime play; it falls back to HTTP long-polling on
 *    networks (like some school Wi-Fi) that block WebSockets.
 */
import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { Server, type Socket } from "socket.io";
import { Room } from "./room";
import type { AvatarConfig, CreateResult, HostAction, JoinResult } from "../shared/types";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

const app = express();
app.set("trust proxy", true);
const http = createServer(app);
const io = new Server(http, { cors: { origin: true }, pingInterval: 10000, pingTimeout: 8000 });

const rooms = new Map<string, Room>();

// ---------------------------------------------------------------- utilities

// No vowels (avoids accidental words) and no look-alikes like 0/O or 1/I.
const CODE_CHARS = "BCDFGHJKLMNPQRSTVWXZ";
function newCode(): string {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    if (!rooms.has(code)) return code;
  }
}

function cleanIp(ip: string | undefined | null): string {
  return String(ip ?? "").split(",")[0].trim().replace(/^::ffff:/, "");
}
function isPrivate(ip: string): boolean {
  return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);
}
/** Two clients are "on the same network" if they share a public IP (school NAT),
 *  or both reach this server from a private LAN address (server running on a laptop). */
function sameNetwork(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (isPrivate(a) && isPrivate(b)) return true;
  return a === b;
}
function socketIp(socket: Socket): string {
  return cleanIp((socket.handshake.headers["x-forwarded-for"] as string) ?? socket.handshake.address);
}

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === "IPv4" && !ni.internal) out.push(`http://${ni.address}:${port}`);
  }
  return out;
}

function broadcast(room: Room) {
  const snap = room.snapshot();
  io.to(room.code).emit("state", snap);
  if (room.hostSockets.size) {
    const secret = room.secret();
    for (const id of room.hostSockets) io.to(id).emit("secret", secret);
  }
  // the Snowball Sprint player's phone gets its own private progress
  if (room.fm) {
    const pid = room.fm.players[room.fm.turn];
    const p = room.players.get(pid);
    const prog = room.fmProgress(pid);
    if (p && prog) for (const id of p.sockets) io.to(id).emit("fmProgress", prog);
  }
}

// ---------------------------------------------------------------- HTTP API

app.get("/api/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

app.get("/api/info", (_req, res) => {
  // When the host opens the game on http://localhost, phones can't use that address,
  // so tell the host screen the laptop's LAN IP(s) for the QR code.
  res.json({ lanIps: lanUrls(PORT).map((u) => new URL(u).hostname) });
});

app.get("/api/rooms", (req, res) => {
  const ip = cleanIp(req.ip);
  const list = [...rooms.values()]
    .filter((r) => r.hostSockets.size > 0 && sameNetwork(r.hostIp, ip))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)
    .map((r) => ({ code: r.code, players: r.connectedCount, phase: r.phase, teams: r.teamNames }));
  res.json({ rooms: list });
});

if (existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: "1h", index: false }));
  app.get(/^(?!\/(api|socket\.io)).*/, (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

// ---------------------------------------------------------------- sockets

io.on("connection", (socket) => {
  let room: Room | null = null;
  let playerId: string | null = null;
  let isHost = false;

  const attach = (r: Room) => {
    room = r;
    socket.join(r.code);
  };

  socket.on("host:create", (cb: (r: CreateResult) => void) => {
    const r = new Room(newCode(), socketIp(socket), () => broadcast(r));
    rooms.set(r.code, r);
    attach(r);
    isHost = true;
    r.hostSockets.add(socket.id);
    cb?.({ ok: true, code: r.code, hostToken: r.hostToken });
    broadcast(r);
  });

  socket.on("host:resume", (data: { code: string; hostToken: string }, cb: (ok: boolean) => void) => {
    const r = rooms.get(String(data?.code ?? "").toUpperCase());
    if (!r || r.hostToken !== data?.hostToken) return cb?.(false);
    attach(r);
    isHost = true;
    r.hostSockets.add(socket.id);
    cb?.(true);
    broadcast(r);
  });

  socket.on("host:action", (action: HostAction) => {
    if (room && isHost && action && typeof action.type === "string") room.host(action);
  });

  socket.on("host:fmPlayers", (d: { p1: string; p2: string }) => {
    if (room && isHost) room.setFmPlayers(d?.p1, d?.p2);
  });

  socket.on("room:peek", (code: string, cb: (r: { exists: boolean; phase?: string }) => void) => {
    const r = rooms.get(String(code ?? "").toUpperCase());
    cb?.(r ? { exists: true, phase: r.phase } : { exists: false });
  });

  socket.on("player:join", (data: { code: string; name: string; avatar: AvatarConfig }, cb: (r: JoinResult) => void) => {
    const r = rooms.get(String(data?.code ?? "").toUpperCase().trim());
    if (!r) return cb?.({ ok: false, error: "No game with that code. Check the big screen!" });
    const res = r.addPlayer(data?.name, data?.avatar, socket.id);
    if (!res.ok) return cb?.({ ok: false, error: res.error });
    attach(r);
    playerId = res.player.id;
    cb?.({ ok: true, code: r.code, playerId: res.player.id, token: res.player.token });
    broadcast(r);
  });

  socket.on("player:resume", (data: { code: string; playerId: string; token: string }, cb: (r: JoinResult) => void) => {
    const r = rooms.get(String(data?.code ?? "").toUpperCase());
    const p = r?.resumePlayer(data?.playerId, data?.token, socket.id);
    if (!r || !p) return cb?.({ ok: false });
    attach(r);
    playerId = p.id;
    cb?.({ ok: true, code: r.code, playerId: p.id, token: p.token });
    broadcast(r);
  });

  socket.on("player:update", (patch: { name?: string; avatar?: AvatarConfig; team?: 0 | 1 }) => {
    if (room && playerId) room.updatePlayer(playerId, patch ?? {});
  });
  socket.on("player:buzz", () => room && playerId && room.buzz(playerId));
  socket.on("player:answer", (text: string) => room && playerId && room.answer(playerId, text));
  socket.on("player:choose", (play: boolean) => room && playerId && room.choose(playerId, !!play));
  socket.on("player:fmPass", () => room && playerId && room.fmPass(playerId));
  socket.on("player:leave", () => {
    if (room && playerId) room.host({ type: "kick", playerId });
    playerId = null;
  });

  socket.on("disconnect", () => room?.socketLeft(socket.id));
});

// Clean up rooms nobody has touched for 45 minutes.
setInterval(() => {
  const cutoff = Date.now() - 45 * 60 * 1000;
  for (const [code, r] of rooms) {
    if (r.lastActive < cutoff && r.connectedCount === 0 && r.hostSockets.size === 0) {
      r.dispose();
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

http.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🎄 Sleigh Says! server running on http://localhost:${PORT}`);
  for (const u of lanUrls(PORT)) console.log(`   on your network: ${u}`);
  if (!existsSync(DIST)) console.log("   (dev mode: open the Vite URL, usually http://localhost:5173)");
});
