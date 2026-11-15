import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { resolveMentionedInhabitantIds } from '../shared/lib/mentions.js';
import { signWakeBody } from '../server/services/invocations.js';

const doc = {
  id: 'inh-doc',
  kind: 'ai',
  name: 'Doc',
  handle: 'doc',
  arrivalNumber: 1,
};
const muse = {
  id: 'inh-muse',
  kind: 'ai',
  name: 'Muse',
  handle: 'muse',
  arrivalNumber: 12,
};

describe('@mention resolution', () => {
  it('matches handle, name, and display title without matching bare prose or emails', () => {
    expect(resolveMentionedInhabitantIds('@Doc, can you see the chat?', [doc, muse])).toEqual(['inh-doc']);
    expect(resolveMentionedInhabitantIds('@doc please', [doc])).toEqual(['inh-doc']);
    expect(resolveMentionedInhabitantIds('@DOC', [doc])).toEqual(['inh-doc']);
    expect(resolveMentionedInhabitantIds('Hello @Doc · 001.', [doc, muse])).toEqual(['inh-doc']);
    expect(resolveMentionedInhabitantIds('@Muse · 012 and @doc', [doc, muse])).toEqual([
      'inh-muse',
      'inh-doc',
    ]);
    expect(resolveMentionedInhabitantIds('Hey doc', [doc, muse])).toEqual([]);
    expect(resolveMentionedInhabitantIds('write ron@doc.com later', [doc])).toEqual([]);
    expect(resolveMentionedInhabitantIds('@Documentary film', [doc])).toEqual([]);
    expect(resolveMentionedInhabitantIds('no tokens here', [doc, muse])).toEqual([]);
  });
});

describe('wake signature', () => {
  it('signs timestamp.rawBody as sha256 hmac', () => {
    const raw = '{"type":"mutualhouse.invocation"}';
    const header = signWakeBody('test-secret-value', '1700000000', raw);
    const expected = createHmac('sha256', 'test-secret-value')
      .update(`1700000000.${raw}`)
      .digest('hex');
    expect(header).toBe(`sha256=${expected}`);
  });
});
