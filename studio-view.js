import { gradeIcon } from './icons.js';
import { applyButtonVariant } from './ui/button.js';

export const byId = id => document.getElementById(id);
export const capitalize = value => value[0].toUpperCase() + value.slice(1);
export const moveLabel = (ply, san) => `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${san}`;

export function setText(id, value) {
  byId(id).textContent = value;
}

export function show(id, visible) {
  byId(id).hidden = !visible;
}

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function moveList(moves, select) {
  const fragment = document.createDocumentFragment();
  for (let offset = 0; offset < moves.length; offset += 2) {
    const pair = element('li');
    pair.append(element('span', Math.floor(offset / 2) + 1 + '.', 'move-index'));
    for (const [index, move] of moves.slice(offset, offset + 2).entries()) {
      pair.append(select ? reviewMove(move, offset + index + 1, select) : element('span', move.san, 'move-record'));
    }
    fragment.append(pair);
  }
  return fragment;
}

function reviewMove(move, ply, select) {
  const button = element('button', '', 'move-choice');
  button.type = 'button';
  applyButtonVariant(button, 'ghost', 'sm');
  button.dataset.ply = ply;
  const meta = element('span', '', 'move-choice-meta');
  meta.append(element('span', '…', 'move-choice-accuracy'));
  button.append(element('span', move.san, 'move-choice-san'), meta);
  button.addEventListener('click', () => select(ply));
  return button;
}

export function renderPlayedMoves(moves) {
  const list = byId('play-moves');
  list.replaceChildren(moveList(moves));
  list.scrollTop = list.scrollHeight;
  show('play-empty', !moves.length);
}

export function renderReviewMoves(moves, select) {
  byId('review-moves').replaceChildren(moveList(moves, select));
}

export function selectReviewMove(current) {
  const list = byId('review-moves');
  const selected = list.querySelector('[aria-current]');
  selected?.removeAttribute('aria-current');
  list.querySelector(`[data-ply="${current}"]`)?.setAttribute('aria-current', 'step');
}

export function labelReviewMove(row) {
  const button = byId('review-moves').querySelector(`[data-ply="${row.ply}"]`);
  if (!button) return;
  const display = row.provisional ? 'Provisional' : row.isBook ? 'Book' : row.isForced ? 'Forced' : row.accuracy + '%';
  const meta = button.lastElementChild;
  const iconNode = row.provisional ? null : gradeIcon(row.grade, 'move-grade-icon');
  const score = element('span', display, 'move-choice-accuracy');
  meta.replaceChildren(...(iconNode ? [iconNode, score] : [score]));
  const aria = row.provisional ? 'Provisional estimate' : row.isBook ? 'Opening book move' : row.isForced ? 'Forced move' : `${display} accuracy`;
  button.setAttribute('aria-label', `${moveLabel(row.ply, row.san)}, ${aria}${!row.provisional && row.grade ? `, ${row.grade}` : ''}`);
}

export function setOptions(id, entries, value, label) {
  const select = byId(id);
  const options = entries.map(entry => {
    const option = new Option(label(entry), entry.id);
    option.dataset.slot = 'native-select-option';
    return option;
  });
  select.replaceChildren(...options);
  select.value = value ?? '';
}
