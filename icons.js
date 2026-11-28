export const ICON_SPRITE = './assets/icons/phosphor.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';

export const GRADE_META = {
  Book: { icon: 'book-open-duotone', slug: 'book', badge: 'B', bg: '#7c5e3c' },
  Forced: { icon: 'arrow-fat-right-duotone', slug: 'forced', badge: '→', bg: '#5a6672' },
  Brilliant: { icon: 'sparkle-duotone', slug: 'brilliant', badge: '!!', bg: '#0b7a70' },
  Great: { icon: 'lightning-duotone', slug: 'great', badge: '!', bg: '#2563a6' },
  'Best move': { icon: 'star-duotone', slug: 'best', badge: '★', bg: '#246b47' },
  Excellent: { icon: 'seal-check-duotone', slug: 'excellent', badge: '✓', bg: '#2f6e4d' },
  Good: { icon: 'thumbs-up-duotone', slug: 'good', badge: '✓', bg: '#476278' },
  Inaccuracy: { icon: 'question-duotone', slug: 'inaccuracy', badge: '?!', bg: '#b07200' },
  Mistake: { icon: 'warning-duotone', slug: 'mistake', badge: '?', bg: '#c2510a' },
  Miss: { icon: 'prohibit-duotone', slug: 'miss', badge: '×', bg: '#b8324e' },
  Blunder: { icon: 'x-circle-duotone', slug: 'blunder', badge: '??', bg: '#b52626' },
};

export const OUTCOME_ICONS = {
  win: 'trophy-duotone',
  draw: 'handshake-duotone',
  loss: 'flag-duotone',
};

export function icon(name, className = '', doc = document) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className ? `icon ${className}` : 'icon');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = doc.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${ICON_SPRITE}#ph-${name}`);
  svg.append(use);
  return svg;
}

export const gradeMeta = grade => (Object.hasOwn(GRADE_META, grade) ? GRADE_META[grade] : null);

export function gradeIcon(grade, className = '', doc = document) {
  const meta = gradeMeta(grade);
  if (!meta) return null;
  const svg = icon(meta.icon, className ? `grade-icon ${className}` : 'grade-icon', doc);
  svg.setAttribute('data-grade', meta.slug);
  return svg;
}

export function gradeBadge(grade, label = grade, doc = document) {
  const meta = gradeMeta(grade);
  const badge = doc.createElement('span');
  badge.className = 'grade-badge';
  badge.setAttribute('data-slot', 'badge');
  if (meta) {
    badge.dataset.grade = meta.slug;
    badge.append(icon(meta.icon, 'grade-badge-icon', doc));
  }
  const text = doc.createElement('span');
  text.textContent = label;
  badge.append(text);
  return badge;
}

/**
 * Compact circular SVG badge for Chessground `customSvg` overlays anchored on a destination square.
 */
export function boardGradeSvg(grade) {
  const meta = gradeMeta(grade);
  if (!meta) return null;
  const fontSize = meta.badge.length > 1 ? 15 : 18;
  return `<g transform="translate(76,22)">` +
    `<circle r="19" fill="${meta.bg}" stroke="#fffdf7" stroke-width="3.2"/>` +
    `<text x="0" y="1" text-anchor="middle" dominant-baseline="central" ` +
    `fill="#fffdf7" font-family="system-ui,sans-serif" font-weight="800" font-size="${fontSize}">${meta.badge}</text>` +
    `</g>`;
}
