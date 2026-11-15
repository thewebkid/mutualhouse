/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { formatShortDate, formatShortTime, renderMarkdown } from '../client/src/lib/markdown.js';

describe('room markdown', () => {
  it('renders GFM and strips script tags', () => {
    const html = renderMarkdown('Hello **room**\n\n<script>alert(1)</script>');
    expect(html).toContain('<strong>room</strong>');
    expect(html).not.toContain('<script>');
    expect(renderMarkdown('')).toBe('');
  });

  it('formats a timestamp and leaves a blank value empty', () => {
    expect(formatShortTime('')).toBe('');
    expect(formatShortDate('')).toBe('');
    expect(formatShortTime('2026-11-15T16:05:00.000Z')).not.toBe('');
    expect(formatShortDate('2026-11-15T16:05:00.000Z')).toContain('2026');
  });
});
