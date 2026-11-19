import { useId } from "react";
import type { AvatarConfig } from "../../../shared/types";
import { AVATAR_COLORS } from "../../../shared/avatar";

/**
 * Layered SVG avatar: background -> head (species) -> face -> nose -> accessory -> hat.
 * Everything is vector so it stays crisp from a 28px lobby chip to a 300px editor.
 */
const INK = "#2a1d18";

const HEADS = [
  { fill: "#f8fbff", shade: "#cfe3f2" }, // snowman
  { fill: "#a0703f", shade: "#7c5530" }, // reindeer
  { fill: "#f4c9a6", shade: "#e3a982" }, // elf
  { fill: "#232b3a", shade: "#151a24" }, // penguin
  { fill: "#c9803f", shade: "#a8642b" }, // gingerbread
  { fill: "#f6f2ea", shade: "#ddd5c6" }, // polar bear
  { fill: "#ea7a2c", shade: "#c95f17" }, // fox
  { fill: "#8f735f", shade: "#6f5646" }, // owl
];

function Head({ base, id }: { base: number; id: string }) {
  const h = HEADS[base] ?? HEADS[0];
  const head = <circle cx="60" cy="68" r="34" fill={`url(#${id}-head)`} />;
  switch (base) {
    case 1: // reindeer
      return (
        <g>
          <path d="M40 40 C30 20 22 26 18 14 M30 28 C24 26 20 30 14 28 M80 40 C90 20 98 26 102 14 M90 28 C96 26 100 30 106 28" stroke="#6b4423" strokeWidth="5" strokeLinecap="round" fill="none" />
          <ellipse cx="25" cy="58" rx="10" ry="6" transform="rotate(-30 25 58)" fill={h.shade} />
          <ellipse cx="95" cy="58" rx="10" ry="6" transform="rotate(30 95 58)" fill={h.shade} />
          {head}
          <ellipse cx="60" cy="84" rx="18" ry="13" fill="#d9b48c" />
        </g>
      );
    case 2: // elf
      return (
        <g>
          <path d="M28 62 L10 50 L30 74 Z" fill={h.shade} />
          <path d="M92 62 L110 50 L90 74 Z" fill={h.shade} />
          {head}
          <circle cx="42" cy="78" r="5" fill="#ff8a8a" opacity="0.55" />
          <circle cx="78" cy="78" r="5" fill="#ff8a8a" opacity="0.55" />
        </g>
      );
    case 3: // penguin
      return (
        <g>
          {head}
          <path d="M60 52 C50 42 34 48 34 66 C34 84 46 96 60 96 C74 96 86 84 86 66 C86 48 70 42 60 52 Z" fill="#fbfbf7" />
        </g>
      );
    case 4: // gingerbread
      return (
        <g>
          {head}
          <path d="M38 50 q5 -6 10 0 t10 0 t10 0 t10 0 t6 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="40" cy="80" r="3" fill="#fff" />
          <circle cx="80" cy="80" r="3" fill="#fff" />
        </g>
      );
    case 5: // polar bear
      return (
        <g>
          <circle cx="34" cy="42" r="11" fill={h.fill} />
          <circle cx="86" cy="42" r="11" fill={h.fill} />
          <circle cx="34" cy="42" r="5" fill={h.shade} />
          <circle cx="86" cy="42" r="5" fill={h.shade} />
          {head}
          <ellipse cx="60" cy="84" rx="15" ry="11" fill="#fffdf8" />
        </g>
      );
    case 6: // fox
      return (
        <g>
          <path d="M30 50 L26 18 L52 38 Z" fill={h.fill} />
          <path d="M90 50 L94 18 L68 38 Z" fill={h.fill} />
          <path d="M28 30 L26 18 L36 26 Z M92 30 L94 18 L84 26 Z" fill={INK} />
          {head}
          <path d="M26 72 C36 74 48 84 60 98 C72 84 84 74 94 72 C92 92 76 102 60 102 C44 102 28 92 26 72 Z" fill="#fff6ec" />
        </g>
      );
    case 7: // owl
      return (
        <g>
          <path d="M32 44 L30 24 L46 38 Z M88 44 L90 24 L74 38 Z" fill={h.shade} />
          {head}
          <circle cx="47" cy="64" r="13" fill="#f3e6cf" />
          <circle cx="73" cy="64" r="13" fill="#f3e6cf" />
        </g>
      );
    default: // snowman
      return (
        <g>
          {head}
          <circle cx="44" cy="82" r="4" fill="#ffc2c2" opacity="0.6" />
          <circle cx="76" cy="82" r="4" fill="#ffc2c2" opacity="0.6" />
        </g>
      );
  }
}

function Nose({ base }: { base: number }) {
  switch (base) {
    case 0:
      return <path d="M58 70 L84 76 L58 78 Z" fill="#f5821f" stroke="#d76a10" strokeWidth="1" strokeLinejoin="round" />;
    case 1:
      return (
        <g>
          <circle cx="60" cy="76" r="7" fill="#e3242b" />
          <circle cx="57.5" cy="73.5" r="2" fill="#fff" opacity="0.8" />
        </g>
      );
    case 3:
    case 7:
      return <path d="M54 72 L66 72 L60 81 Z" fill="#f7a823" />;
    case 5:
    case 6:
      return <ellipse cx="60" cy="76" rx="6" ry="4.5" fill={INK} />;
    case 2:
      return <ellipse cx="60" cy="74" rx="4" ry="3" fill="#e3a982" />;
    default:
      return null;
  }
}

function Face({ face, dark }: { face: number; dark: boolean }) {
  const ink = dark ? "#fff" : INK;
  const eyes = { l: [47, 64], r: [73, 64] };
  switch (face) {
    case 1: // grin
      return (
        <g>
          <path d={`M${eyes.l[0] - 5} 66 q5 -7 10 0 M${eyes.r[0] - 5} 66 q5 -7 10 0`} stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M48 84 Q60 98 72 84 Z" fill="#5a1f1f" />
          <path d="M53 90 Q60 95 67 90 Q60 87 53 90 Z" fill="#ff7a8a" />
        </g>
      );
    case 2: // wink
      return (
        <g>
          <ellipse cx={eyes.l[0]} cy={eyes.l[1]} rx="3.6" ry="4.6" fill={INK} />
          <path d={`M${eyes.r[0] - 5} 65 q5 -5 10 0`} stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M50 86 Q60 93 70 85" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case 3: // surprised
      return (
        <g>
          <circle cx={eyes.l[0]} cy={eyes.l[1]} r="5.5" fill="#fff" stroke={INK} strokeWidth="2" />
          <circle cx={eyes.r[0]} cy={eyes.r[1]} r="5.5" fill="#fff" stroke={INK} strokeWidth="2" />
          <circle cx={eyes.l[0]} cy={eyes.l[1] + 1} r="3" fill={INK} />
          <circle cx={eyes.r[0]} cy={eyes.r[1] + 1} r="3" fill={INK} />
          <ellipse cx="60" cy="89" rx="4.5" ry="5.5" fill="#5a1f1f" />
        </g>
      );
    case 4: // cool
      return (
        <g>
          <path d="M36 58 H84 V62 C84 70 78 73 73 73 C67 73 63 69 62 63 H58 C57 69 53 73 47 73 C42 73 36 70 36 62 Z" fill="#121418" />
          <path d="M41 61 L47 61" stroke="#fff" strokeWidth="2" opacity="0.5" strokeLinecap="round" />
          <path d="M51 87 Q62 92 70 84" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case 5: // sleepy
      return (
        <g>
          <path d={`M${eyes.l[0] - 5} 63 q5 5 10 0 M${eyes.r[0] - 5} 63 q5 5 10 0`} stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
          <ellipse cx="60" cy="88" rx="3.5" ry="2.5" fill="#5a1f1f" />
          <text x="86" y="44" fontSize="13" fontWeight="800" fill={dark ? "#fff" : "#5b7fa6"} fontFamily="Fredoka, sans-serif">z</text>
          <text x="95" y="34" fontSize="9" fontWeight="800" fill={dark ? "#fff" : "#5b7fa6"} fontFamily="Fredoka, sans-serif">z</text>
        </g>
      );
    default: // happy
      return (
        <g>
          <ellipse cx={eyes.l[0]} cy={eyes.l[1]} rx="3.6" ry="4.6" fill={INK} />
          <ellipse cx={eyes.r[0]} cy={eyes.r[1]} rx="3.6" ry="4.6" fill={INK} />
          <circle cx={eyes.l[0] + 1.2} cy={eyes.l[1] - 1.6} r="1.2" fill="#fff" />
          <circle cx={eyes.r[0] + 1.2} cy={eyes.r[1] - 1.6} r="1.2" fill="#fff" />
          <path d="M49 85 Q60 94 71 85" stroke={ink === "#fff" ? INK : INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
  }
}

function Accessory({ kind, color }: { kind: number; color: string }) {
  switch (kind) {
    case 1: // scarf
      return (
        <g>
          <path d="M30 96 C44 106 76 106 90 96 L92 106 C76 116 44 116 28 106 Z" fill={color} />
          <path d="M70 104 L80 104 L84 120 L72 120 Z" fill={color} />
          <path d="M40 104 L44 110 M52 107 L54 113 M66 107 L66 113" stroke="#fff" strokeWidth="3" opacity="0.7" strokeLinecap="round" />
        </g>
      );
    case 2: // bow tie
      return (
        <g>
          <path d="M60 106 L44 97 L44 115 Z M60 106 L76 97 L76 115 Z" fill={color} stroke="rgba(0,0,0,.2)" strokeWidth="1" />
          <circle cx="60" cy="106" r="4.5" fill={color} stroke="rgba(0,0,0,.25)" strokeWidth="1" />
        </g>
      );
    case 3: // glasses
      return (
        <g fill="none" stroke={color} strokeWidth="3">
          <circle cx="47" cy="64" r="9" fill="rgba(255,255,255,.18)" />
          <circle cx="73" cy="64" r="9" fill="rgba(255,255,255,.18)" />
          <path d="M56 63 Q60 60 64 63" />
        </g>
      );
    case 4: // jingle bell collar
      return (
        <g>
          <path d="M32 98 C46 106 74 106 88 98" stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" />
          <circle cx="60" cy="108" r="8" fill="#f4c25b" stroke="#b8862a" strokeWidth="1.5" />
          <path d="M54 109 H66" stroke="#8a5f12" strokeWidth="2" />
          <circle cx="60" cy="112" r="1.6" fill="#8a5f12" />
        </g>
      );
    case 5: // holly
      return (
        <g transform="translate(30 42) rotate(-20)">
          <path d="M0 0 C6 -8 14 -6 18 0 C12 2 6 4 0 0 Z" fill="#1f8a55" />
          <path d="M0 0 C-2 -10 4 -16 10 -16 C8 -10 6 -4 0 0 Z" fill="#167047" />
          <circle cx="2" cy="2" r="3.4" fill="#e3242b" />
          <circle cx="7" cy="4" r="3" fill="#c81d26" />
        </g>
      );
    case 6: // headphones
      return (
        <g>
          <path d="M26 68 C26 26 94 26 94 68" stroke={INK} strokeWidth="5" fill="none" />
          <rect x="18" y="58" width="14" height="24" rx="6" fill={color} />
          <rect x="88" y="58" width="14" height="24" rx="6" fill={color} />
        </g>
      );
    default:
      return null;
  }
}

function Hat({ kind, color }: { kind: number; color: string }) {
  switch (kind) {
    case 1: // santa
      return (
        <g>
          <path d="M30 42 C34 18 58 6 80 14 C92 18 100 30 102 46 L92 44 C88 32 82 28 76 28 C80 36 86 40 90 42 Z" fill="#d7263d" />
          <path d="M30 42 C38 14 72 10 88 40 Z" fill="#d7263d" />
          <rect x="24" y="36" width="72" height="14" rx="7" fill="#fff" />
          <circle cx="100" cy="48" r="7" fill="#fff" />
        </g>
      );
    case 2: // bobble beanie
      return (
        <g>
          <path d="M28 46 C28 18 92 18 92 46 Z" fill={color} />
          <rect x="25" y="40" width="70" height="12" rx="5" fill={color} stroke="rgba(0,0,0,.15)" strokeWidth="1" />
          <path d="M33 42 V50 M41 42 V50 M49 42 V50 M57 42 V50 M65 42 V50 M73 42 V50 M81 42 V50 M89 42 V50" stroke="rgba(0,0,0,.18)" strokeWidth="2" />
          <circle cx="60" cy="16" r="9" fill="#fff" />
        </g>
      );
    case 3: // elf hat
      return (
        <g>
          <path d="M28 46 C40 30 58 6 96 4 C80 14 76 30 92 46 Z" fill={color} />
          <path d="M26 46 L32 38 L38 46 L44 38 L50 46 L56 38 L62 46 L68 38 L74 46 L80 38 L86 46 L92 38 L96 46 Z" fill="#f4c25b" />
          <circle cx="97" cy="5" r="5" fill="#f4c25b" stroke="#b8862a" strokeWidth="1" />
        </g>
      );
    case 4: // top hat
      return (
        <g>
          <rect x="38" y="6" width="44" height="36" rx="3" fill="#1b1b22" />
          <rect x="38" y="30" width="44" height="8" fill={color} />
          <rect x="24" y="38" width="72" height="8" rx="4" fill="#1b1b22" />
        </g>
      );
    case 5: // crown
      return (
        <g>
          <path d="M32 44 L30 16 L44 30 L60 10 L76 30 L90 16 L88 44 Z" fill="#f4c25b" stroke="#c8902a" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="60" cy="32" r="4" fill={color} />
          <circle cx="44" cy="37" r="3" fill="#3fb8e6" />
          <circle cx="76" cy="37" r="3" fill="#3fb8e6" />
        </g>
      );
    case 6: // earmuffs
      return (
        <g>
          <path d="M26 66 C26 22 94 22 94 66" stroke="#c8902a" strokeWidth="5" fill="none" />
          <circle cx="25" cy="68" r="12" fill={color} />
          <circle cx="95" cy="68" r="12" fill={color} />
        </g>
      );
    case 7: // antler headband
      return (
        <g>
          <path d="M44 38 C38 20 30 22 28 8 M36 24 C30 22 26 26 20 22 M76 38 C82 20 90 22 92 8 M84 24 C90 22 94 26 100 22" stroke="#8a5a2b" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M30 44 C40 32 80 32 90 44" stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" />
        </g>
      );
    default:
      return null;
  }
}

export function Avatar({ config, size = 64, ring, className }: { config: AvatarConfig; size?: number; ring?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const color = AVATAR_COLORS[config.color]?.hex ?? AVATAR_COLORS[0].hex;
  const h = HEADS[config.base] ?? HEADS[0];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 120 120" role="img" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fffaf0" />
          <stop offset="100%" stopColor={color} stopOpacity="0.55" />
        </radialGradient>
        <radialGradient id={`${id}-head`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor={h.fill} />
          <stop offset="100%" stopColor={h.shade} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="60" cy="60" r="60" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="120" height="120" fill={`url(#${id}-bg)`} />
        <Head base={config.base} id={id} />
        <Face face={config.face} dark={config.base === 3 && false} />
        <Nose base={config.base} />
        <Accessory kind={config.accessory} color={color} />
        <Hat kind={config.hat} color={color} />
      </g>
      {ring && <circle cx="60" cy="60" r="57" fill="none" stroke={ring} strokeWidth="6" />}
    </svg>
  );
}
