import { gradeBadge, gradeIcon, icon } from './icons.js';
import { byId, capitalize, element, moveLabel, setText, show } from './studio-view.js';
import {
  CORE_GAME_OVER_GRADES, MOVE_GRADES, REVIEW_PRESETS,
  formatWhiteScore, moveCounts, toWhiteChance,
} from './review.js';
import { applyButtonVariant } from './ui/button.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let detailsOpen = false;

function action(label, onClick, { className, variant = 'outline', size, iconName } = {}) {
  const button = element('button', '', className);
  button.type = 'button';
  button.dataset.reviewFocus = label;
  applyButtonVariant(button, variant, size);
  if (iconName) button.append(icon(iconName));
  if (label) button.append(element('span', label));
  button.addEventListener('click', onClick);
  return button;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function sharpnessLabel(sharpness) {
  if (sharpness >= 0.7) return 'Razor-sharp';
  if (sharpness >= 0.45) return 'Sharp';
  if (sharpness >= 0.22) return 'Balanced';
  return 'Quiet';
}

function formatProb(prob) {
  if (typeof prob !== 'number' || !Number.isFinite(prob)) return '—';
  const pct = prob * 100;
  return pct < 1 && pct > 0 ? '<1%' : `${Math.round(pct)}%`;
}

export function renderGameOverCounts(game, progress) {
  const { rows = [], error = '', statusLabel = '', done = false } = progress;
  const counts = moveCounts(game, rows);
  const pending = !done && rows.length < game.moves.length;
  const anyCounts = Object.values(counts).some(count => count > 0);
  const visibleGrades = Object.entries(MOVE_GRADES).filter(([grade]) =>
    CORE_GAME_OVER_GRADES.has(grade) || counts[grade] > 0,
  );
  const entries = visibleGrades.map(([grade, label]) => {
    const pair = element('div');
    const term = element('dt');
    term.append(gradeBadge(grade, label));
    pair.append(term, element('dd', pending && !anyCounts ? '—' : String(counts[grade])));
    return pair;
  });
  byId('game-over-counts').replaceChildren(...entries);
  const statusText = error || statusLabel || `Analyzed ${rows.length} of ${game.moves.length} moves`;
  setText('game-over-status', statusText);
  show('game-over-status', Boolean(error || !done));
  show('game-over-retry', Boolean(error));
}

export function renderEvalBar({ visible, row, orientation = 'white' }) {
  const bar = byId('eval-bar');
  if (!bar) return;
  show('eval-bar', visible);
  if (!visible) return;

  const whiteChance = row?.whiteChance ?? 50;
  const whiteScore = row?.whiteScore ?? { type: 'cp', value: 0 };
  const clamped = whiteScore.type === 'mate'
    ? (whiteScore.value > 0 ? 100 : 0)
    : Math.max(4, Math.min(96, whiteChance));

  bar.dataset.orientation = orientation;
  bar.dataset.advantage = whiteChance >= 54 ? 'white' : whiteChance <= 46 ? 'black' : 'even';
  bar.style.setProperty('--eval-white', `${clamped}%`);

  const scoreText = row?.whiteScore ? formatWhiteScore(whiteScore) : '—';
  setText('eval-bar-label', scoreText);
  const sideDesc = whiteScore.type === 'mate'
    ? (whiteScore.value > 0 ? `White mates in ${Math.abs(whiteScore.value)}` : `Black mates in ${Math.abs(whiteScore.value)}`)
    : whiteChance >= 54 ? `${scoreText} for White`
      : whiteChance <= 46 ? `${scoreText} for Black` : `${scoreText}, even`;
  bar.setAttribute('aria-label', scoreText === '—' ? 'Position evaluation unavailable' : `Position evaluation: ${sideDesc}`);
}

export function renderReviewOverview({ rows, meta, currentPly, onSelect }) {
  const container = byId('review-overview');
  if (!container) return;
  const hasData = Boolean(rows?.length);
  show('review-overview', hasData);
  if (!hasData) return;

  // Opening & preset strip
  const openingEl = byId('review-opening');
  openingEl.replaceChildren();
  const hasOpening = Boolean(meta?.opening);
  const presetLabel = REVIEW_PRESETS[meta?.preset]?.label ?? null;
  if (hasOpening || presetLabel) {
    show('review-opening', true);
    if (hasOpening) {
      const nameEl = element('span', meta.opening.name, 'opening-name');
      nameEl.title = `${meta.opening.eco} · ${meta.opening.name}`;
      openingEl.append(
        element('span', meta.opening.eco, 'opening-eco'),
        nameEl,
      );
    } else {
      openingEl.append(element('span', 'Evaluation timeline', 'opening-name muted'));
    }
    if (meta?.maia?.enabled) {
      const maiaChip = element('span', '', 'overview-tag');
      maiaChip.append(icon('brain'), element('span', 'Maia-3'));
      openingEl.append(maiaChip);
    }
  } else {
    show('review-opening', false);
  }

  renderEvalGraph({ rows, meta, currentPly, onSelect });
}

function renderEvalGraph({ rows, meta, currentPly, onSelect }) {
  const host = byId('review-graph');
  host.replaceChildren();
  if (!rows.length) return;

  const W = 320;
  const H = 64;
  const total = rows.length;
  const xFor = ply => (total <= 1 ? W : (ply / total) * W);
  const yFor = whitePct => H - (Math.max(2, Math.min(98, whitePct)) / 100) * H;

  const svg = svgEl('svg', {
    class: 'eval-graph-svg',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': 'Game evaluation graph. Click to jump to any move.',
  });

  // Phase shading bands
  const midPly = meta?.phases?.middlePly;
  const endPly = meta?.phases?.endPly;
  if (midPly !== null && midPly !== undefined && midPly > 0 && midPly < total) {
    svg.append(svgEl('rect', {
      x: 0, y: 0, width: xFor(midPly), height: H, class: 'graph-phase-opening',
    }));
    svg.append(svgEl('line', {
      x1: xFor(midPly), y1: 0, x2: xFor(midPly), y2: H, class: 'graph-phase-divider',
    }));
  }
  if (endPly !== null && endPly !== undefined && endPly > 0 && endPly < total) {
    svg.append(svgEl('rect', {
      x: xFor(endPly), y: 0, width: W - xFor(endPly), height: H, class: 'graph-phase-endgame',
    }));
    svg.append(svgEl('line', {
      x1: xFor(endPly), y1: 0, x2: xFor(endPly), y2: H, class: 'graph-phase-divider',
    }));
  }

  // Center equality line (50%)
  svg.append(svgEl('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, class: 'graph-midline' }));

  // Build Stockfish polyline points starting at ply 0 (50%)
  const sfPoints = [[0, meta?.initialChance ?? (meta?.initialChance === null ? null : 50)],
    ...rows.map(r => [r.ply, r.whiteChance])].filter(([, value]) => Number.isFinite(value));
  if (sfPoints.length >= 2) {
    const linePts = sfPoints.map(([p, v]) => `${xFor(p).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
    const areaPts = `${xFor(sfPoints[0][0]).toFixed(1)},${H} ${linePts} ${xFor(sfPoints.at(-1)[0]).toFixed(1)},${H}`;
    svg.append(svgEl('polygon', { points: areaPts, class: 'graph-area-white' }));
    svg.append(svgEl('polyline', { points: linePts, class: 'graph-line-sf' }));
  }

  // Optional Maia-3 practical evaluation dashed overlay (spanning 0..total when available)
  const maiaPoints = rows
    .filter(r => r.maia && typeof r.maia.practicalChance === 'number')
    .map(r => [r.ply - 1, toWhiteChance(r.maia.practicalChance, r.color)]);
  if (typeof meta?.maia?.finalChance === 'number' && maiaPoints.length) {
    maiaPoints.push([total, meta.maia.finalChance]);
  }
  if (maiaPoints.length >= 2) {
    const mPts = maiaPoints.map(([p, v]) => `${xFor(p).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
    svg.append(svgEl('polyline', { points: mPts, class: 'graph-line-maia' }));
  }

  // Notable grade markers
  const markerGrades = new Set(['Brilliant', 'Great', 'Miss', 'Blunder']);
  for (const r of rows) {
    if (r.provisional || !markerGrades.has(r.grade) || !Number.isFinite(r.whiteChance)) continue;
    const slug = r.grade.toLowerCase();
    svg.append(svgEl('circle', {
      cx: xFor(r.ply).toFixed(1),
      cy: yFor(r.whiteChance).toFixed(1),
      r: 2.6,
      class: 'graph-dot',
      'data-grade': slug,
    }));
  }

  // Active ply cursor
  const clampedPly = Math.max(0, Math.min(total, currentPly));
  const curX = xFor(clampedPly);
  const curVal = clampedPly === 0 ? (meta?.initialChance ?? 50) : rows[clampedPly - 1]?.whiteChance;
  svg.append(svgEl('line', { x1: curX.toFixed(1), y1: 0, x2: curX.toFixed(1), y2: H, class: 'graph-cursor' }));
  if (Number.isFinite(curVal)) {
    svg.append(svgEl('circle', { cx: curX.toFixed(1), cy: yFor(curVal).toFixed(1), r: 3.8, class: 'graph-cursor-dot' }));
  }

  const jumpFromPointer = event => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const targetPly = Math.round(ratio * total);
    onSelect(targetPly);
  };
  svg.addEventListener('click', jumpFromPointer);

  host.append(svg);

  // Subtle legend row under the graph
  const legend = element('div', '', 'graph-legend');
  const left = element('span', 'White ↑ · Black ↓', 'graph-legend-axis');
  legend.append(left);
  if (maiaPoints.length >= 2) {
    const right = element('span', '', 'graph-legend-keys');
    right.append(
      element('span', 'Stockfish', 'legend-sf'),
      element('span', 'Maia practical', 'legend-maia'),
    );
    legend.append(right);
  }
  host.append(legend);
}

function accuracyLink(label, row, select, extra = '') {
  const button = action('', () => select(row.ply), { className: 'accuracy-link', variant: 'ghost' });
  const tag = element('span', '', 'accuracy-tag');
  button.dataset.reviewFocus = `moment-${row.ply}`;
  const badge = row.provisional ? null : gradeIcon(row.grade);
  if (badge) tag.append(badge);
  tag.append(element('span', label));
  const metricText = extra || `${row.accuracy}%`;
  button.append(tag, element('span', moveLabel(row.ply, row.san), 'accuracy-move'), element('strong', metricText));
  const assessment = row.provisional ? 'Provisional estimate' : `${row.accuracy}% accuracy`;
  button.setAttribute('aria-label', `${label}, ${moveLabel(row.ply, row.san)}, ${assessment}`);
  return button;
}

export function renderAccuracy(summary, game, select) {
  show('review-summary', true);
  show('review-accuracy-pending', false);
  const container = byId('accuracy-details');
  container.replaceChildren();

  const overall = summary.average === null ? '—' : `${summary.average}%`;
  setText('review-tab-score', overall);
  show('review-tab-score', summary.average !== null);
  const coverage = side => {
    const value = summary.coverage?.[side];
    return value?.total ? `${value.scored} of ${value.total} decisions scored` : 'No scored decisions';
  };

  // 1. Head-to-head accuracy header (You vs Bot + ACPL)
  const boardCard = element('div', '', 'accuracy-scoreboard');
  const youCol = element('div', '', 'accuracy-side accuracy-side-you');
  youCol.append(
    element('span', 'You', 'accuracy-side-label'),
    element('strong', overall, 'accuracy-number'),
    element('span', coverage('human'), 'accuracy-sub'),
  );
  if (summary.acpl !== null) youCol.append(element('span', `ACPL ${summary.acpl}`, 'accuracy-sub'));
  const botCol = element('div', '', 'accuracy-side');
  botCol.append(
    element('span', 'Bot', 'accuracy-side-label'),
    element('strong', summary.botAverage !== null ? `${summary.botAverage}%` : '—', 'accuracy-number accuracy-number-secondary'),
    element('span', coverage('bot'), 'accuracy-sub'),
  );
  if (summary.botAcpl !== null) botCol.append(element('span', `ACPL ${summary.botAcpl}`, 'accuracy-sub'));
  boardCard.append(youCol, botCol);
  container.append(boardCard);

  // 2. Phase accuracy strip
  const phaseGrid = element('div', '', 'phase-grid');
  for (const [key, label] of [['opening', 'Opening'], ['middlegame', 'Middlegame'], ['endgame', 'Endgame']]) {
    const val = summary.phases?.[key];
    const card = element('div', '', 'phase-card');
    card.append(
      element('span', label, 'phase-label'),
      element('strong', val !== null && val !== undefined ? `${val}%` : '—', 'phase-value'),
    );
    phaseGrid.append(card);
  }
  container.append(phaseGrid);

  // 3. Maia-3 Estimated Play Level card
  if (summary.maia?.enabled && summary.maia.estimate) {
    const { estimate, low, high, sampleCount, lowConfidence } = summary.maia;
    const card = element('div', '', 'maia-rating-card');
    const head = element('div', '', 'maia-rating-head');
    const title = element('span', '', 'maia-rating-title');
    title.append(icon('brain'), element('span', 'Estimated play level'));
    head.append(title, element('strong', `~${estimate}`, 'maia-rating-number'));
    const rangeNote = `Range ${low}–${high} (Lichess style · ${sampleCount} non-book moves${lowConfidence ? ', short sample' : ''})`;
    card.append(head, element('p', rangeNote, 'muted maia-rating-note'));
    container.append(card);
  }

  // 4. Opening & Theory Exit summary
  if (summary.opening) {
    const card = element('div', '', 'opening-summary-card');
    card.append(
      element('span', `${summary.opening.eco} · ${summary.opening.name}`, 'opening-summary-title'),
    );
    if (summary.theoryExit) {
      const exit = summary.theoryExit;
      const who = exit.color === game.human ? 'You' : 'Bot';
      const alts = exit.bookAlternatives.slice(0, 3).join(', ');
      const btn = action(
        `${who} left book on ${moveLabel(exit.ply, exit.san)}${alts ? ` · Book: ${alts}` : ''}`,
        () => select(exit.ply),
        { className: 'theory-exit-link', variant: 'ghost', size: 'sm' },
      );
      card.append(btn);
    }
    container.append(card);
  }

  // 5. Key Moments / Turning Points (deduplicated cleanly)
  const momentsHead = element('h3', 'Key moments', 'accuracy-section-title');
  const moments = element('div', '', 'accuracy-moments');
  for (const row of summary.turningPoints ?? []) {
    const label = row.provisional ? 'Decision to examine' : row.lostAdvantage ? 'Advantage lost'
      : row.color === game.human ? row.grade : `Bot ${row.grade.toLowerCase()}`;
    const extra = row.provisional ? 'Provisional' : row.drop >= 10 ? `-${Math.round(row.drop)} pts` : `${row.accuracy}%`;
    moments.append(accuracyLink(label, row, select, extra));
  }
  if (!summary.turningPoints?.length) {
    moments.append(element('p', 'No key comparisons available yet.', 'muted'));
  }
  container.append(momentsHead, moments);
}

function renderInsightChips(chips) {
  if (!chips?.length) return null;
  const list = element('div', '', 'insight-chips');
  for (const chip of chips) {
    const pill = element('span', chip.label, 'insight-chip');
    pill.dataset.tone = chip.tone || 'neutral';
    list.append(pill);
  }
  return list;
}

function alternativesView(alternatives, variation, preview, heading = 'Alternative moves') {
  const view = element('div', '', 'alternatives');
  const list = element('ul', '', 'alternative-list');
  for (const line of alternatives) {
    const item = element('li');
    const scoreStr = line.whiteScore ? formatWhiteScore(line.whiteScore) : `${Math.round(line.chance)}%`;
    const button = action('', () => preview(line), { className: 'alt-choice' });
    button.dataset.reviewFocus = `alt-${line.uci}`;
    button.append(
      element('span', line.san, 'alt-san'),
      element('span', scoreStr, 'alt-score'),
    );
    button.setAttribute('aria-label', `Preview line from ${line.san} (${scoreStr})`);
    button.setAttribute('aria-pressed', String(line.uci === variation?.line?.uci));
    item.append(button);
    list.append(item);
  }
  const active = alternatives.find(line => line.uci === variation?.line?.uci) ?? alternatives[0];
  view.append(element('h3', heading), list, element('p', `${active.san}. ${active.idea}`, 'muted'));
  if (variation && alternatives.some(line => line.uci === variation.line?.uci)) {
    const moves = [active.san, ...active.continuation.map(move => move.san)].join(' ');
    view.append(element('p', moves, 'variation-caption'));
  }
  return view;
}

function renderWdlBar(wdl) {
  if (!wdl) return null;
  const wPct = Math.round(wdl.win / 10);
  const dPct = Math.round(wdl.draw / 10);
  const lPct = Math.max(0, 100 - wPct - dPct);

  const wrap = element('div', '', 'wdl-wrap');
  const bar = element('div', '', 'wdl-bar');
  bar.setAttribute('aria-hidden', 'true');
  const wSeg = element('span', '', 'wdl-win');
  wSeg.style.width = `${wPct}%`;
  const dSeg = element('span', '', 'wdl-draw');
  dSeg.style.width = `${dPct}%`;
  const lSeg = element('span', '', 'wdl-loss');
  lSeg.style.width = `${lPct}%`;
  bar.append(wSeg, dSeg, lSeg);

  const labels = element('div', '', 'wdl-labels');
  labels.append(
    element('span', `Win ${wPct}%`),
    element('span', `Draw ${dPct}%`),
    element('span', `Loss ${lPct}%`),
  );
  wrap.append(bar, labels);
  return wrap;
}

function renderDetailsDrawer({ row, meta, onEnableMaia, maiaPreference }) {
  const details = document.createElement('details');
  details.className = 'review-details';
  details.open = detailsOpen;
  details.addEventListener('toggle', () => { detailsOpen = details.open; });

  const summary = document.createElement('summary');
  summary.dataset.reviewFocus = 'engine-details';
  summary.className = 'review-details-summary';
  summary.append(element('span', 'Engine & human details'), icon('caret-down', 'icon details-chevron'));
  details.append(summary);

  const body = element('div', '', 'review-details-body');

  // Stockfish Expected Score + WDL
  const sfBlock = element('dl', '', 'metric-grid');
  const addMetric = (label, value) => {
    const item = element('div', '', 'metric-item');
    item.append(element('dt', label), element('dd', value));
    sfBlock.append(item);
  };
  const metricScore = value => Number.isFinite(value) ? `${Math.round(value)}%` : '—';
  addMetric('Top move', metricScore(row.before));
  addMetric('Played move', metricScore(row.after));
  if (typeof row.sharpness === 'number') {
    addMetric('Sharpness', `${sharpnessLabel(row.sharpness)} (${Math.round(row.sharpness * 100)}%)`);
  }
  if (row.depth) {
    const presetName = REVIEW_PRESETS[meta?.preset]?.label ?? '';
    addMetric('Search', `Depth ${row.depth}${presetName ? ` · ${presetName}` : ''}`);
  }
  body.append(sfBlock);

  const wdlBar = renderWdlBar(row.wdl);
  if (wdlBar) body.append(wdlBar);

  // NNUE attribution
  if (row.nnueSummary || row.nnueNote) {
    const nnue = element('div', '', 'detail-subblock');
    nnue.append(element('strong', 'NNUE breakdown', 'detail-subhead'));
    if (row.nnueSummary) {
      const { psqt, positional } = row.nnueSummary;
      const fmt = v => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
      nnue.append(element('p', `Material (PSQT): ${fmt(psqt)} · Positional (Layers): ${fmt(positional)} (White POV)`, 'muted'));
    }
    if (row.nnueNote) {
      nnue.append(element('p', row.nnueNote, 'muted'));
    }
    body.append(nnue);
  }

  // Maia-3 human cognitive details
  if (row.maia) {
    const m = row.maia;
    const maiaBlock = element('div', '', 'detail-subblock');
    const head = element('strong', '', 'detail-subhead');
    head.append(icon('brain'), element('span', `Maia-3 (~${m.referenceElo} reference)`));
    maiaBlock.append(head);

    const grid = element('dl', '', 'metric-grid');
    const addM = (k, v) => {
      const item = element('div', '', 'metric-item');
      item.append(element('dt', k), element('dd', v));
      grid.append(item);
    };
    addM('Played likelihood', formatProb(m.playedProb));
    addM('Best findability', formatProb(m.bestProb));
    if (m.entropy !== null && m.entropy !== undefined) {
      addM('Choice ambiguity', `${m.entropy.toFixed(1)} bits`);
    }
    if (m.risk) {
      const { low, high, coverage } = m.risk;
      addM('Risk of a costly move', low === high ? formatProb(low) : `${formatProb(low)}–${formatProb(high)}`);
      addM('Maia choices evaluated', formatProb(coverage));
      addM('Known safe choices', formatProb(m.safeMass));
    }
    if (m.likelyReply) {
      addM('Likely reply after played move', `${m.likelyReply.san} · ${formatProb(m.likelyReply.probability)}`);
    }
    if (typeof m.practicalChance === 'number') {
      addM('Practical score before move', metricScore(m.practicalChance));
    }
    maiaBlock.append(grid);
    body.append(maiaBlock);
  } else if (meta?.maia?.error) {
    body.append(element('p', 'Maia insights could not finish. Stockfish analysis is ready.', 'muted'));
    if (onEnableMaia) body.append(action('Retry human insights', onEnableMaia, { size: 'sm' }));
  } else if (maiaPreference !== 'enabled' && onEnableMaia) {
    const cta = element('div', '', 'detail-maia-cta');
    cta.append(
      element('span', 'Human trap & findability insights are off.', 'muted'),
      action('Enable Maia-3', onEnableMaia, { variant: 'ghost', size: 'sm', iconName: 'brain' }),
    );
    body.append(cta);
  }

  details.append(body);
  return details;
}

function reviewedMoveHeader(row, practice) {
  const header = element('div', '', 'review-move-heading');
  const move = element('div', '', 'review-move-title');
  move.append(element('h2', moveLabel(row.ply, row.san)));
  if (!row.provisional) move.append(gradeBadge(row.grade));
  const scoreDisplay = row.provisional ? 'Provisional' : row.isBook ? 'Book' : row.isForced ? 'Forced' : `${row.accuracy}%`;
  const isTag = row.provisional || row.isBook || row.isForced;
  const accuracy = element('strong', scoreDisplay, isTag ? 'move-accuracy move-accuracy-tag' : 'move-accuracy');
  if (!isTag) accuracy.setAttribute('aria-label', `${row.accuracy}% move accuracy`);
  const button = action('Practice', practice, { variant: 'default', iconName: 'target' });
  button.setAttribute('aria-label', 'Practice this position');
  header.append(move, accuracy, button);
  return header;
}

function comparisonContent(comparison, variation, preview) {
  const panel = element('section', '', 'review-comparison');
  panel.append(element('h3', 'Compare moves'));
  const alternatives = element('div', '', 'comparison-branches');
  const branches = [];
  const add = (label, line) => {
    branches.push(line);
    const active = variation?.line?.uci === line.uci;
    const card = element('div', '', 'comparison-branch');
    card.dataset.active = String(active);
    const scoreStr = line.whiteScore ? formatWhiteScore(line.whiteScore) : '—';
    const pctStr = `${Math.round(line.chance)}%`;
    const head = element('div', '', 'comparison-branch-head');
    head.append(
      element('span', label, 'comparison-branch-role'),
      element('span', scoreStr, 'comparison-branch-eval'),
    );
    const button = action('', () => preview(line, line.evidenceIndex), {
      className: 'comparison-branch-btn',
      size: 'sm',
      variant: active ? 'default' : 'outline',
    });
    button.append(
      element('span', line.san, 'alt-san'),
      element('span', pctStr, 'comparison-branch-pct'),
    );
    button.dataset.reviewFocus = label;
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${label} move ${line.san}, eval ${scoreStr}, ${pctStr} expected score`);
    card.append(head, button);
    if (line.evidence) card.append(element('p', line.evidence, 'comparison-branch-copy'));
    else if (line.continuation.length) card.append(element('p', `Line continues with ${line.continuation[0].san}.`, 'comparison-branch-copy'));
    alternatives.append(card);
  };
  add('Played', comparison.played);
  if (comparison.recommended.uci !== comparison.played.uci) add('Recommended', comparison.recommended);
  else if (comparison.alternative) add('Alternative', comparison.alternative);
  panel.append(alternatives);

  const activeBranch = branches.find(line => line.uci === variation?.line?.uci);
  if (activeBranch) {
    const moves = [activeBranch.san, ...activeBranch.continuation.map(move => move.san)].join(' ');
    panel.append(element('p', moves, 'variation-caption'));
  }
  return panel;
}

export function showReviewDetail({
  ply, row, meta, variation, showThreat, toggleThreat,
  preview, practice, showMoves, onEnableMaia, maiaPreference, compare, comparisonBusy, comparing,
}) {
  const view = byId('review-detail');
  view.replaceChildren();
  if (!ply) {
    const intro = meta?.opening
      ? `Starting position · ${meta.opening.eco} ${meta.opening.name}.`
      : 'Choose a move or click the evaluation graph to inspect its analysis.';
    return view.append(
      element('p', intro, 'muted'),
      action('Browse moves', showMoves, { iconName: 'list-numbers' }),
    );
  }
  if (!row) return view.append(element('p', 'Analysis for this move is pending.', 'muted'));

  view.append(reviewedMoveHeader(row, practice));

  // Context meta strip: Phase · Endgame/Opening · Score
  const contextParts = [];
  if (row.phase) contextParts.push(capitalize(row.phase));
  if (row.endgameType && row.endgameType !== 'Endgame') contextParts.push(row.endgameType);
  if (row.whiteScore) contextParts.push(`Eval ${formatWhiteScore(row.whiteScore)}`);
  if (contextParts.length) {
    view.append(element('p', contextParts.join(' · '), 'review-context-meta'));
  }

  // Primary causal coach explanation
  const copy = row.explanation || row.idea || 'Stockfish evaluated this position.';
  view.append(element('p', copy, 'review-explanation'));

  if (row.comparison) view.append(comparisonContent(row.comparison, variation, preview));
  if (!row.comparison || row.provisional) {
    const label = comparing ? 'Searching…' : row.provisional ? 'Search deeper' : 'Compare moves';
    const button = action(label, () => {
      if (!comparisonBusy && !row.deepened) compare();
    }, { size: 'sm', iconName: 'magnifying-glass' });
    button.dataset.reviewFocus = 'compare-current-move';
    button.setAttribute('aria-disabled', String(Boolean(comparisonBusy || row.deepened)));
    if (row.deepened) {
      const note = element('p', '', 'deepened-note muted');
      note.append(icon('check'), element('span', 'Extra search complete'));
      view.append(note);
    } else {
      view.append(button);
    }
  } else if (row.deepened) {
    const note = element('p', '', 'deepened-note muted');
    note.append(icon('check'), element('span', 'Extra search complete'));
    view.append(note);
  }

  // Orthogonal insight chips + Show Threat toggle
  const chipsEl = renderInsightChips(row.chips);
  if (chipsEl || row.threat) {
    const bar = element('div', '', 'review-insights-row');
    if (chipsEl) bar.append(chipsEl);
    if (row.threat) {
      const threatLabel = row.threat.kind === 'refutation'
        ? `Show refutation (${row.threat.san})`
        : `Show threat (${row.threat.san})`;
      const btn = action(threatLabel, toggleThreat, {
        className: 'threat-toggle',
        variant: showThreat ? 'default' : 'outline',
        size: 'sm',
        iconName: 'crosshair',
      });
      btn.setAttribute('aria-pressed', String(Boolean(showThreat)));
      bar.append(btn);
    }
    view.append(bar);
  }

  // Alternatives with PV preview (deduplicating moves already in Compare moves)
  if (row.alternatives?.length) {
    const shownUcis = new Set();
    if (row.comparison) {
      shownUcis.add(row.comparison.played.uci);
      shownUcis.add(row.comparison.recommended.uci);
      if (row.comparison.alternative) shownUcis.add(row.comparison.alternative.uci);
    }
    const remaining = row.comparison
      ? row.alternatives.filter(line => !shownUcis.has(line.uci))
      : row.alternatives;
    if (remaining.length) {
      view.append(alternativesView(remaining, variation, preview, row.comparison ? 'Other lines' : 'Alternative moves'));
    }
  }

  // Collapsible Engine & Human Details strip
  view.append(renderDetailsDrawer({ row, meta, onEnableMaia, maiaPreference }));
}
