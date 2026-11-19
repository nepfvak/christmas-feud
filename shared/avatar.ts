import type { AvatarConfig } from "./types";

export const AVATAR_BASES = ["Snowman", "Reindeer", "Elf", "Penguin", "Gingerbread", "Polar Bear", "Fox", "Owl"] as const;
export const AVATAR_COLORS = [
  { name: "Cranberry", hex: "#d7263d" },
  { name: "Pine", hex: "#1f8a55" },
  { name: "Gold", hex: "#f2b632" },
  { name: "Ice", hex: "#3fb8e6" },
  { name: "Plum", hex: "#8a3ffc" },
  { name: "Tangerine", hex: "#f77f00" },
  { name: "Bubblegum", hex: "#ff6fae" },
  { name: "Midnight", hex: "#2f4bb0" },
] as const;
export const AVATAR_HATS = ["None", "Santa Hat", "Bobble Beanie", "Elf Hat", "Top Hat", "Crown", "Earmuffs", "Antlers"] as const;
export const AVATAR_ACCESSORIES = ["None", "Scarf", "Bow Tie", "Glasses", "Jingle Bell", "Holly", "Headphones"] as const;
export const AVATAR_FACES = ["Happy", "Grin", "Wink", "Surprised", "Cool", "Sleepy"] as const;

export const AVATAR_OPTION_COUNTS: Record<keyof AvatarConfig, number> = {
  base: AVATAR_BASES.length,
  color: AVATAR_COLORS.length,
  hat: AVATAR_HATS.length,
  accessory: AVATAR_ACCESSORIES.length,
  face: AVATAR_FACES.length,
};

export function randomAvatar(): AvatarConfig {
  const r = (n: number) => Math.floor(Math.random() * n);
  return {
    base: r(AVATAR_BASES.length),
    color: r(AVATAR_COLORS.length),
    hat: r(AVATAR_HATS.length),
    accessory: r(AVATAR_ACCESSORIES.length),
    face: r(AVATAR_FACES.length),
  };
}

export function sanitizeAvatar(a: Partial<AvatarConfig> | undefined): AvatarConfig {
  const clamp = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : 0);
  return {
    base: clamp(a?.base, AVATAR_BASES.length),
    color: clamp(a?.color, AVATAR_COLORS.length),
    hat: clamp(a?.hat, AVATAR_HATS.length),
    accessory: clamp(a?.accessory, AVATAR_ACCESSORIES.length),
    face: clamp(a?.face, AVATAR_FACES.length),
  };
}
