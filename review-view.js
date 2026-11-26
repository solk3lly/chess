import { gradeBadge, gradeIcon, icon } from './icons.js';
import { byId, element, moveLabel, setText, show } from './studio-view.js';
import { MOVE_GRADES, moveCounts } from './review.js';
import { applyButtonVariant } from './ui/button.js';

function action(label, onClick, { className, variant = 'outline', iconName } = {}) {
  const button = element('button', '', className);
  button.type = 'button';
  applyButtonVariant(button, variant);
  if (iconName) button.append(icon(iconName));
  if (label) button.append(element('span', label));
  button.addEventListener('click', onClick);
  return button;
}

export function renderGameOverCounts(game, { rows, error }) {
  const counts = moveCounts(game, rows);
  const pending = rows.length < game.moves.length;
  const anyCounts = Object.values(counts).some(count => count > 0);
  const entries = Object.entries(MOVE_GRADES).map(([grade, label]) => {
    const pair = element('div');
    const term = element('dt');
    term.append(gradeBadge(grade, label));
    pair.append(term, element('dd', pending && !anyCounts ? '—' : String(counts[grade])));
    return pair;
  });
  byId('game-over-counts').replaceChildren(...entries);
  setText('game-over-status', error || `Analyzed ${rows.length} of ${game.moves.length} moves`);
  show('game-over-status', pending);
  show('game-over-retry', Boolean(error));
}

export function renderAccuracy(summary, select) {
  show('review-summary', true);
  show('review-accuracy-pending', false);
  const container = byId('accuracy-details');
  if (summary.average === null) {
    setText('overall-accuracy', '—');
    container.replaceChildren(element('p', 'This game ended before you made a move.', 'muted'));
    return;
  }

  const overall = summary.average + '%';
  setText('overall-accuracy', overall);
  setText('review-tab-score', overall);
  show('review-tab-score', true);
  const details = [
    accuracyLink('Best move', summary.best, select),
    accuracyLink('Weakest move', summary.weakest, select),
  ];
  for (const row of summary.lost) details.push(accuracyLink('Advantage lost', row, select));
  if (!summary.lost.length) details.push(element('p', 'No clear advantage lost.', 'muted'));
  container.replaceChildren(...details);
}

function accuracyLink(label, row, select) {
  const button = action('', () => select(row.ply), { className: 'accuracy-link', variant: 'ghost' });
  const tag = element('span', '', 'accuracy-tag');
  const badge = gradeIcon(row.grade);
  if (badge) tag.append(badge);
  tag.append(element('span', label));
  button.append(tag, element('span', moveLabel(row.ply, row.san), 'accuracy-move'), element('strong', row.accuracy + '%'));
  button.setAttribute('aria-label', `${label}: ${moveLabel(row.ply, row.san)}, ${row.accuracy}% accuracy${row.grade ? `, ${row.grade}` : ''}`);
  return button;
}

function explanation(row) {
  const difference = Math.round(Math.max(0, row.before - row.after));
  const preferred = (row.preferred && row.preferred !== row.san ? row.preferred : row.alternatives[0]?.san) ?? 'the top line';
  if (row.lostAdvantage) return `This move gave up the advantage Stockfish found with ${preferred}.`;
  if (row.grade === 'Brilliant') return 'Stockfish’s top line gives up material and keeps an advantage.';
  if (row.grade === 'Best move') return row.idea;
  if (difference < 2) return 'Stockfish evaluated this move close to its preferred line.';
  return `Stockfish preferred ${preferred} (+${difference} points).`;
}

function alternativesView(alternatives, variation, preview) {
  const view = element('div', '', 'alternatives');
  const list = element('ul', '', 'alternative-list');
  for (const line of alternatives) {
    const item = element('li');
    const button = action(line.san, () => preview(line));
    button.setAttribute('aria-label', `Play line from ${line.san}`);
    button.setAttribute('aria-pressed', line.uci === variation?.line.uci);
    item.append(button);
    list.append(item);
  }
  const line = variation?.line ?? alternatives[0];
  view.append(element('h3', 'Alternative moves'), list, element('p', `${line.san}. ${line.idea}`, 'muted'));
  if (variation) {
    const moves = [line.san, ...line.continuation.map(move => move.san)].join(' ');
    view.append(element('p', moves, 'variation-caption'));
  }
  return view;
}

function reviewedMoveHeader(row, practice) {
  const header = element('div', '', 'review-move-heading');
  const move = element('div', '', 'review-move-title');
  move.append(element('h2', moveLabel(row.ply, row.san)), gradeBadge(row.grade));
  const accuracy = element('strong', row.accuracy + '%', 'move-accuracy');
  accuracy.setAttribute('aria-label', row.accuracy + '% move accuracy');
  const button = action('Practice', practice, { variant: 'default', iconName: 'target' });
  button.setAttribute('aria-label', 'Practice this position');
  header.append(move, accuracy, button);
  return header;
}

function estimatedChance(row) {
  const score = element('dl', '', 'review-eval');
  score.append(
    element('dt', 'Estimated winning chance'),
    element('dd', `Top move ${Math.round(row.before)}%`),
    element('dd', `Played ${Math.round(row.after)}%`),
  );
  return score;
}

export function showReviewDetail({ ply, row, variation, preview, practice, showMoves }) {
  const view = byId('review-detail');
  view.replaceChildren();
  if (!ply) return view.append(
    element('p', 'Choose a move to see its analysis.', 'muted'),
    action('Browse moves', showMoves, { iconName: 'list-numbers' }),
  );
  if (!row) return view.append(element('p', 'Analysis for this move is pending.', 'muted'));

  view.append(reviewedMoveHeader(row, practice), element('p', explanation(row)));
  if (row.alternatives.length) view.append(alternativesView(row.alternatives, variation, preview));
  view.append(estimatedChance(row));
}
