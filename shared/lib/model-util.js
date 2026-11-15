/**
 * Isomorphic `becise`-style domain model utilities.
 *
 * Zero Vue imports here so `shared/models/*` runs identically inside Hono /
 * Node 24 / MCP handlers and inside Vue 3.5 `reactive()` proxies on the client.
 */

const isPrimitive = (v) =>
  v === null || v === undefined || (typeof v !== 'object' && typeof v !== 'function');

const isEmptyVal = (v) => {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
};

/**
 * Unwraps a Vue 3 reactive/readonly Proxy (`__v_raw`) without importing `vue`.
 */
export function raw(value) {
  let cur = value;
  while (cur && typeof cur === 'object' && cur.__v_raw) {
    cur = cur.__v_raw;
  }
  return cur;
}

/**
 * Extracts plain serializable `.def` from a domain model instance (or null).
 */
export function getDef(instance) {
  const inst = raw(instance);
  if (!inst) return null;
  return typeof inst === 'object' && 'def' in inst ? inst.def : inst;
}

/**
 * Builds a plain object from `inst.constructor.props` (plus optional `addlProps`).
 * Parent back-references (`house`, `room`, `turn`) MUST NOT appear in `static props`.
 */
export function buildDef(inst, addlProps = [], skipEmpty = false) {
  const target = raw(inst);
  const props = target?.constructor?.props ?? [];
  const entries = [];

  for (const prop of [...props, ...addlProps]) {
    const val = raw(target[prop]);
    if (skipEmpty ? isEmptyVal(val) : val === null || val === undefined) {
      continue;
    }
    if (Array.isArray(val)) {
      entries.push([prop, val.map((item) => deepPlain(item))]);
    } else if (val && typeof val === 'object' && 'def' in val) {
      entries.push([prop, getDef(val)]);
    } else {
      entries.push([prop, deepPlain(val)]);
    }
  }
  return Object.fromEntries(entries);
}

/**
 * Hydrates declared `static props` onto `inst` from a plain `def` object.
 */
export function buildInstanceFromDef(inst, def = {}) {
  if (!def || typeof def !== 'object') return inst;
  const props = inst?.constructor?.props ?? [];
  for (const prop of props) {
    if (def[prop] !== undefined) {
      inst[prop] = def[prop];
    }
  }
  return inst;
}

/**
 * Deep unreactive plain copy safe against Vue proxies.
 */
export function deepPlain(value) {
  const v = raw(value);
  if (isPrimitive(v)) return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(deepPlain);
  if (v instanceof Map) {
    return Array.from(v.entries()).map(([k, val]) => [deepPlain(k), deepPlain(val)]);
  }
  if (v instanceof Set) {
    return Array.from(v.values()).map(deepPlain);
  }
  if (typeof v === 'object' && 'def' in v && typeof v.constructor?.create === 'function') {
    return v.def;
  }
  const out = {};
  for (const [k, child] of Object.entries(v)) {
    if (typeof child !== 'function') {
      out[k] = deepPlain(child);
    }
  }
  return out;
}

/**
 * Fast deterministic 53-bit hash (`becise` heritage) for local dirty/change checks.
 */
export function cyrb53(str, seed = 0) {
  const input = typeof str === 'string' ? str : canonicalJson(str);
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Deterministic canonical JSON string (sorted object keys) used for SHA-256
 * read receipts and Ed25519 manual packet digests on both client and server.
 */
export function canonicalJson(value) {
  const v = raw(value);
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v.normalize('NFC'));
  if (Array.isArray(v)) {
    return `[${v.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined && typeof v[k] !== 'function')
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(String(v));
}

/**
 * Isomorphic WebCrypto SHA-256 hex digest (works in Node 24 and modern browsers).
 */
export async function sha256Hex(input) {
  const text = typeof input === 'string' ? input : canonicalJson(input);
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function cleanseText(s = '') {
  return String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .normalize('NFC');
}

export function slugify(input = '') {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
