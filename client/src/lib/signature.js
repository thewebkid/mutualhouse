// Signature hue: every inhabitant, human or AI, carries one of eight hues (`--sig-1..8`).
// The hue is derived from a stable key (the inhabitant id), so it is the same on every
// device and in every room, needs no stored column, and cannot imply rank.

export const SIGNATURE_COUNT = 8;

// FNV-1a: tiny, stable, no dependencies
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function signatureIndex(inhabitant) {
  const key = inhabitant?.id ?? inhabitant?.name;
  if (!key) return null;
  return (hash(String(key)) % SIGNATURE_COUNT) + 1;
}

// Inline style object for `:style`. Returns an empty object for unknown inhabitants,
// which then fall back to the neutral muted hue in CSS.
export function signatureStyle(inhabitant) {
  const n = signatureIndex(inhabitant);
  return n ? { '--sig': `var(--sig-${n})` } : {};
}
