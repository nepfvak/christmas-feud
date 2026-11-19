/**
 * All game audio is synthesized live with the Web Audio API: no copyrighted show
 * sounds, no files to download, works offline. The theme is "Jingle Bells"
 * (James Lord Pierpont, 1857 - public domain).
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem("ss-muted") === "1";
} catch {}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Browsers only allow audio after a user gesture - call this from any click. */
export function unlockAudio() {
  ac();
}
export function isMuted() {
  return muted;
}
export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem("ss-muted", v ? "1" : "0");
  } catch {}
}

function tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; attack?: number; detune?: number } = {}) {
  const c = ac();
  if (!c || !master || muted) return;
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (opts.detune) osc.detune.setValueAtTime(opts.detune, t);
  const peak = opts.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** a bell = a fundamental plus inharmonic partials that decay quickly */
function bell(freq: number, start = 0, dur = 1.2, gain = 0.22) {
  tone(freq, start, dur, { gain });
  tone(freq * 2.01, start, dur * 0.6, { gain: gain * 0.45 });
  tone(freq * 3.03, start, dur * 0.35, { gain: gain * 0.25 });
  tone(freq * 4.2, start, dur * 0.18, { gain: gain * 0.12 });
}

function noise(start: number, dur: number, gain = 0.15, freq = 6000) {
  const c = ac();
  if (!c || !master || muted) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(master);
  src.start(c.currentTime + start);
}

function sleighBells(start = 0, count = 6) {
  for (let i = 0; i < count; i++) noise(start + i * 0.07, 0.09, 0.12, 7000 + (i % 2) * 1500);
}

const N: Record<string, number> = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5,
};

export const sfx = {
  /** answer flips over */
  reveal() {
    bell(N.E5, 0, 1.1, 0.26);
    bell(N.C6, 0.09, 1.3, 0.2);
    sleighBells(0.02, 4);
  },
  /** a lump of coal (strike) */
  strike() {
    tone(98, 0, 0.75, { type: "sawtooth", gain: 0.22 });
    tone(103, 0, 0.75, { type: "sawtooth", gain: 0.18 });
    tone(49, 0, 0.75, { type: "square", gain: 0.12 });
  },
  buzz() {
    tone(660, 0, 0.12, { type: "square", gain: 0.12 });
    tone(990, 0.08, 0.22, { type: "square", gain: 0.12 });
  },
  dupe() {
    tone(330, 0, 0.12, { type: "triangle", gain: 0.2 });
    tone(262, 0.15, 0.18, { type: "triangle", gain: 0.2 });
  },
  tick() {
    tone(1400, 0, 0.05, { type: "square", gain: 0.05 });
  },
  yourTurn() {
    bell(N.G5, 0, 0.5, 0.18);
    bell(N.C6, 0.12, 0.7, 0.18);
  },
  fanfare() {
    const seq = [N.C5, N.E5, N.G5, N.C6];
    seq.forEach((f, i) => bell(f, i * 0.12, 1.4, 0.2));
    tone(N.C4, 0.36, 1.4, { type: "triangle", gain: 0.15 });
    sleighBells(0.3, 10);
  },
  sad() {
    tone(N.G4, 0, 0.4, { type: "triangle", gain: 0.2 });
    tone(392 * 0.94, 0.4, 0.4, { type: "triangle", gain: 0.2 });
    tone(392 * 0.84, 0.8, 0.9, { type: "triangle", gain: 0.2 });
  },
  /** "Jingle bells, jingle bells, jingle all the way" */
  theme() {
    const notes: [string, number][] = [
      ["E5", 1], ["E5", 1], ["E5", 2], ["E5", 1], ["E5", 1], ["E5", 2],
      ["E5", 1], ["G5", 1], ["C5", 1.5], ["D5", 0.5], ["E5", 3],
    ];
    let t = 0;
    const beat = 0.18;
    for (const [n, len] of notes) {
      bell(N[n], t, 0.6 + len * beat, 0.2);
      t += len * beat;
    }
    sleighBells(0, 18);
  },
  zero() {
    tone(180, 0, 0.35, { type: "sawtooth", gain: 0.12 });
  },
};

/** Optional host voice for reading questions aloud. */
export function speak(text: string) {
  if (muted || typeof speechSynthesis === "undefined" || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}
