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
import { isMuted, sfx, speak } from "./audio";

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

/** Call once on the host screen; checks which recorded clips exist and preloads them. */
export async function preloadClips() {
  const urls = [
    ...Object.keys(VOICE_LINES).map((id) => `/audio/voice/${id}.mp3`),
    ...Object.keys(sfx).map((id) => `/audio/sfx/${id}.mp3`),
  ];
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

function playFile(url: string, volume: number): boolean {
  if (!available.get(url)) return false;
  const base = audioCache.get(url);
  if (!base) return false;
  // clone so overlapping plays (rapid reveals) don't cut each other off
  const a = base.cloneNode(true) as HTMLAudioElement;
  a.volume = volume;
  a.play().catch(() => {});
  return true;
}

export function hasClip(id: VoiceId): boolean {
  return !!available.get(`/audio/voice/${id}.mp3`);
}

/**
 * Host announcer line. Plays the recorded clip if present. Falls back to browser
 * text-to-speech only when `tts` is set: robotic quick reactions ("Good answer!")
 * on every reveal would talk over the question being read, so those stay silent
 * until a real recording exists.
 */
export function playVoice(id: VoiceId, opts: { tts?: boolean } = {}) {
  if (isMuted()) return;
  if (!playFile(`/audio/voice/${id}.mp3`, 1) && opts.tts) speak(VOICE_LINES[id]);
}

/** Sound effect: recorded clip if present, otherwise the Web Audio synth version. */
export function playSfx(id: SfxId) {
  if (isMuted()) return;
  if (!playFile(`/audio/sfx/${id}.mp3`, 0.8)) sfx[id]();
}
