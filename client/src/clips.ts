/**
 * Recorded clips with automatic fallback.
 *
 * Drop an MP3 at public/audio/voice/<id>.mp3 or public/audio/sfx/<id>.mp3 and it is
 * used automatically. Anything missing falls back to the synthesized sound in
 * audio.ts (sfx) or the browser's text-to-speech (voice), so the game always works.
 *
 * Voice clips were generated with Scenario (ElevenLabs v4, "Brian" voice).
 * Prompts for the missing ones are the strings below - regenerate with the same
 * voice/seed settings: stability 0.35, seed 7, mp3_44100_128.
 */
import { isMuted, sfx } from "./audio";

export const VOICE_LINES = {
  welcome: "Welcome to Sleigh Says!",
  faceoff: "Face-off!",
  playOrPass: "Play... or pass?",
  goodAnswer: "Good answer!",
  topAnswer: "That's the top answer!",
  sleighSays: "The sleigh says...",
  coal: "Ooh... lump of coal!",
  steal: "Time to steal!",
  round1: "Round one!",
  round2: "Round two!",
  round3: "Round three... double points!",
  round4: "Round four... triple points!",
  suddenDeath: "Sudden death! Only the top answer counts.",
  sprint: "It's time for the Snowball Sprint!",
  winner: "We have a winner!",
  timesUp: "Time's up!",
  tryAgain: "Ooh, somebody already said that. Try again!",
  sprintWin: "Over two hundred points! You did it!",
} as const;
export type VoiceId = keyof typeof VOICE_LINES;

export type SfxId = keyof typeof sfx;

const available = new Map<string, boolean>();
const audioCache = new Map<string, HTMLAudioElement>();

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-cache" });
    // the production server answers unknown paths with index.html, so check the type too
    return res.ok && (res.headers.get("content-type") ?? "").startsWith("audio");
  } catch {
    return false;
  }
}

/**
 * Checks which recorded clips exist and preloads them. The host screen preloads
 * everything; phones pass just the few sounds they use.
 */
export async function preloadClips(only?: { sfx?: SfxId[]; voice?: VoiceId[] }) {
  const voiceIds = only ? (only.voice ?? []) : (Object.keys(VOICE_LINES) as VoiceId[]);
  const sfxIds = only ? (only.sfx ?? []) : (Object.keys(sfx) as SfxId[]);
  const urls = [...voiceIds.map((id) => `/audio/voice/${id}.mp3`), ...sfxIds.map((id) => `/audio/sfx/${id}.mp3`)];
  await Promise.all(
    urls.map(async (url) => {
      const ok = await probe(url);
      available.set(url, ok);
      if (ok) {
        const a = new Audio(url);
        a.preload = "auto";
        audioCache.set(url, a);
      }
    }),
  );
}

/** Starts a clip and resolves when it finishes (or is stopped). Returns null if the clip isn't recorded. */
function playFile(url: string, volume: number, track = false): Promise<void> | null {
  if (!available.get(url)) return null;
  const base = audioCache.get(url);
  if (!base) return null;
  // clone so overlapping plays (rapid reveals) don't cut each other off
  const a = base.cloneNode(true) as HTMLAudioElement;
  a.volume = volume;
  if (track) current = a; // only announcer steps can be interrupted
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(safety);
      if (current === a) current = null;
      resolve();
    };
    // safety net in case "ended" never fires (autoplay blocked, tab hidden...)
    const safety = setTimeout(done, ((isFinite(a.duration) ? a.duration : 4) + 1) * 1000);
    a.addEventListener("ended", done, { once: true });
    a.addEventListener("pause", done, { once: true });
    a.addEventListener("error", done, { once: true });
    a.play().catch(done);
  });
}

export function hasClip(id: VoiceId): boolean {
  return !!available.get(`/audio/voice/${id}.mp3`);
}

/** Quick sound effect, played immediately (it may overlap the announcer). Falls back to the synth. */
export function playSfx(id: SfxId) {
  if (isMuted()) return;
  if (!playFile(`/audio/sfx/${id}.mp3`, 0.8)) sfx[id]();
}

// ---------------------------------------------------------------- announcer queue
// Voice lines and long stingers (theme 5s, fanfare 4s) play one after another so
// nothing talks over anything else. Each step waits for its clip to really end.

export type Step = { voice: VoiceId; tts?: boolean } | { sfx: SfxId } | { speak: string };

/** rough lengths of the synth fallbacks, used when no recording exists */
const SYNTH_MS: Partial<Record<SfxId, number>> = { theme: 2500, fanfare: 1900, sad: 1800 };

let queue: Step[] = [];
let running = false;
let current: HTMLAudioElement | null = null;

function speakAndWait(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1.05;
    const safety = setTimeout(resolve, 12000);
    u.onend = u.onerror = () => {
      clearTimeout(safety);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function playStep(step: Step): Promise<void> {
  if (isMuted()) return;
  if ("voice" in step) {
    const p = playFile(`/audio/voice/${step.voice}.mp3`, 1, true);
    if (p) return p;
    if (step.tts) return speakAndWait(VOICE_LINES[step.voice]);
    return;
  }
  if ("sfx" in step) {
    const p = playFile(`/audio/sfx/${step.sfx}.mp3`, 0.8, true);
    if (p) return p;
    sfx[step.sfx]();
    return sleep(SYNTH_MS[step.sfx] ?? 700);
  }
  return speakAndWait(step.speak);
}

async function run() {
  running = true;
  while (queue.length) {
    await playStep(queue.shift()!);
    if (queue.length) await sleep(150);
  }
  running = false;
}

/**
 * Queue announcer steps.
 *  - interrupt: drop anything queued and cut off what's playing (big moments: a new round, a winner)
 *  - ifIdle:    skip entirely if the announcer is busy (quick reactions like "Good answer!")
 */
export function announce(steps: Step[], opts: { interrupt?: boolean; ifIdle?: boolean } = {}) {
  if (isMuted() || !steps.length) return;
  if (opts.ifIdle && (running || queue.length)) return;
  if (opts.interrupt) {
    queue = [];
    current?.pause();
    try {
      speechSynthesis.cancel();
    } catch {}
  }
  queue.push(...steps);
  if (!running) run();
}

/** One announcer line, queued so it never overlaps another (kept for convenience). */
export function playVoice(id: VoiceId, opts: { tts?: boolean; ifIdle?: boolean } = {}) {
  announce([{ voice: id, tts: opts.tts }], { ifIdle: opts.ifIdle });
}
