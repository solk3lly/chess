export const ICON_SPRITE = './assets/icons/phosphor.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';

export const GRADE_META = {
  Brilliant: { icon: 'sparkle-duotone', slug: 'brilliant' },
  'Best move': { icon: 'star-duotone', slug: 'best' },
  Excellent: { icon: 'seal-check-duotone', slug: 'excellent' },
  Good: { icon: 'thumbs-up-duotone', slug: 'good' },
  Inaccuracy: { icon: 'question-duotone', slug: 'inaccuracy' },
  Mistake: { icon: 'warning-duotone', slug: 'mistake' },
  Blunder: { icon: 'x-circle-duotone', slug: 'blunder' },
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

const gradeMeta = grade => (Object.hasOwn(GRADE_META, grade) ? GRADE_META[grade] : null);

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
