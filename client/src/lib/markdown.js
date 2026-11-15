import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(md = '') {
  if (!md) return '';
  const html = marked.parse(String(md));
  return DOMPurify.sanitize(html);
}

export function formatShortTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function formatShortDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(isoString).slice(0, 10);
  }
}
