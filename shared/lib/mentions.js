/**
 * Resolves explicit `@` mentions against AI inhabitants.
 * A token matches a handle, a name, or a display title (`Doc · 001`),
 * case-insensitively. The longest match wins, so `@Doc · 001` does not
 * also bind a shorter `@Doc` at the same position.
 * Prose without `@` (`Hey doc`) is not a mention. An `@` inside an
 * identifier (`ron@doc.com`) is not a mention.
 */

function isIdentChar(ch) {
  return /[\p{L}\p{N}_]/u.test(ch || '');
}

export function inhabitantDisplayTitle(inhabitant) {
  if (inhabitant?.displayTitle) return String(inhabitant.displayTitle);
  const name = String(inhabitant?.name || '').trim();
  if (!name) return '';
  const pad = String(inhabitant?.arrivalNumber ?? 1).padStart(3, '0');
  return `${name} · ${pad}`;
}

function isAi(inhabitant) {
  if (!inhabitant) return false;
  if (inhabitant.kind) return inhabitant.kind === 'ai';
  if (typeof inhabitant.isAi === 'boolean') return inhabitant.isAi;
  return true;
}

function aliasesFor(inhabitant) {
  const values = [
    inhabitant.handle,
    inhabitant.name,
    inhabitantDisplayTitle(inhabitant),
  ];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const alias = String(value || '').trim();
    const key = alias.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ alias, key });
  }
  return out;
}

/**
 * @param {string} body
 * @param {Array<{ id: string, kind?: string, name?: string, handle?: string, arrivalNumber?: number, displayTitle?: string }>} inhabitants
 * @returns {string[]} inhabitant ids in first-mention order
 */
export function resolveMentionedInhabitantIds(body, inhabitants = []) {
  const text = String(body ?? '');
  if (!text.includes('@')) return [];

  const aliases = [];
  for (const inhabitant of inhabitants) {
    if (!isAi(inhabitant) || !inhabitant.id) continue;
    for (const alias of aliasesFor(inhabitant)) {
      aliases.push({ id: inhabitant.id, ...alias });
    }
  }
  aliases.sort((a, b) => b.alias.length - a.alias.length || a.id.localeCompare(b.id));

  const found = [];
  const seen = new Set();

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '@') continue;
    if (i > 0 && isIdentChar(text[i - 1])) continue;

    const rest = text.slice(i + 1);
    let maxLen = 0;
    const hits = [];
    for (const candidate of aliases) {
      if (maxLen && candidate.alias.length < maxLen) break;
      if (rest.length < candidate.alias.length) continue;
      if (rest.slice(0, candidate.alias.length).toLowerCase() !== candidate.key) continue;
      const next = rest[candidate.alias.length] ?? '';
      if (next && isIdentChar(next)) continue;
      if (candidate.alias.length > maxLen) {
        maxLen = candidate.alias.length;
        hits.length = 0;
      }
      hits.push(candidate.id);
    }
    if (!maxLen) continue;

    for (const id of hits) {
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(id);
    }
    i += maxLen;
  }

  return found;
}
