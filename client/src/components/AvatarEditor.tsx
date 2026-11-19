import type { AvatarConfig } from "../../../shared/types";
import { AVATAR_ACCESSORIES, AVATAR_BASES, AVATAR_COLORS, AVATAR_FACES, AVATAR_HATS, randomAvatar } from "../../../shared/avatar";
import { Avatar } from "./Avatar";

const ROWS: { key: keyof AvatarConfig; label: string; names: readonly string[] }[] = [
  { key: "base", label: "Character", names: AVATAR_BASES },
  { key: "hat", label: "Hat", names: AVATAR_HATS },
  { key: "accessory", label: "Extra", names: AVATAR_ACCESSORIES },
  { key: "face", label: "Face", names: AVATAR_FACES },
];

export function AvatarEditor({ value, onChange }: { value: AvatarConfig; onChange: (a: AvatarConfig) => void }) {
  const step = (key: keyof AvatarConfig, n: number, dir: number) => onChange({ ...value, [key]: (value[key] + dir + n) % n });
  return (
    <div className="avatar-editor">
      <div className="avatar-preview">
        <Avatar config={value} size={148} />
        <button type="button" className="btn-ghost dice" onClick={() => onChange(randomAvatar())} aria-label="Randomize avatar">
          🎲 Surprise me
        </button>
      </div>
      <div className="avatar-rows">
        {ROWS.map((row) => (
          <div className="avatar-row" key={row.key}>
            <button type="button" className="arrow" aria-label={`Previous ${row.label}`} onClick={() => step(row.key, row.names.length, -1)}>‹</button>
            <div className="avatar-row-text">
              <span className="avatar-row-label">{row.label}</span>
              <span className="avatar-row-value">{row.names[value[row.key]]}</span>
            </div>
            <button type="button" className="arrow" aria-label={`Next ${row.label}`} onClick={() => step(row.key, row.names.length, 1)}>›</button>
          </div>
        ))}
        <div className="swatches" role="radiogroup" aria-label="Color">
          {AVATAR_COLORS.map((c, i) => (
            <button
              type="button"
              key={c.name}
              role="radio"
              aria-checked={value.color === i}
              aria-label={c.name}
              className={`swatch ${value.color === i ? "on" : ""}`}
              style={{ background: c.hex }}
              onClick={() => onChange({ ...value, color: i })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
