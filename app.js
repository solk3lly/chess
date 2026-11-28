import { Chessground } from 'https://cdn.jsdelivr.net/npm/@lichess-org/chessground@10.1.0/dist/chessground.min.js';
import { compat, fen, makeSquare, san } from './vendor/chessops.bundle.js';
import { applyBoardTheme } from './board-themes.js';
import { totalMaterialCount } from './chess-concepts.js';
import { detectCapture, standardUci } from './game-state.js';
import { Engine, EnginePool, MaiaEngine, isMaiaModelCached } from './engine.js';
import { OUTCOME_ICONS, boardGradeSvg, gradeBadge, icon } from './icons.js';
import { shortcutAction } from './keyboard.js';
import { DEFAULT_SETTINGS, openStore, preferences, readLocal, saveGame, savePreferences, saveReview, writeLocal } from './local-store.js';
import {
  PRESET_ORDER, REVIEW_PRESETS, REVIEW_VERSION, analyzeGame, analyzeReviewHuman, applyReviewHuman, buildPracticeHint, compareGameMove, keyReviewRows,
  practiceEstimate, practiceFeedback, summarize, toWhiteChance,
} from './review.js';
import {
  renderAccuracy, renderEvalBar, renderGameOverCounts, renderReviewOverview, showReviewDetail,
} from './review-view.js';
import {
  BOT_PROFILES, DIFFICULTY_ORDER, LEVELS, botSearchConfig, botSearchSummary,
  claimDraw, drawClaims, fenAt, legalMove, maiaPosition, mateInOne, needsPromotion, newGame, opposite, playMove,
  positionAt, positionFromFen, resign, setDifficulty, undoTurn, validExercise, validGame,
} from './studio-game.js';
import {
  byId, capitalize, labelReviewMove, moveLabel,
  renderPlayedMoves, renderReviewMoves, selectReviewMove, setOptions, setText, show,
} from './studio-view.js';

import { mountStudio } from './studio-layout.js';
import { applyButtonVariant } from './ui/button.js';
import { chooseDrawMove, choosePromotion, closeDialog, confirmAction, isDialogOpen, showGameOverDialog, showSettingsDialog, showShortcutsDialog } from './studio-dialogs.js';
import { activateReviewTab, bindDifficultyPicker, closeDifficultyPopover, renderProgress, renderReplay, renderSlider, sliderMarkers } from './studio-widgets.js';

mountStudio();

const state = {
  mode: 'play', settings: DEFAULT_SETTINGS, db: null, game: null, games: new Map(),
  reviews: new Map(), review: { id: null, ply: 1, variation: null, showThreat: false }, pendingResultId: null,
  practice: new Map(), exercise: null, attempt: null, flipped: false, promoting: false,
  matchRevision: null, savingMatch: false, matchConflict: false, maiaCached: false,
};
const EMPTY_REVIEW = { rows: [], meta: null, preset: null, error: '', statusLabel: '', done: false, progress: { done: 0, total: 1 } };
const darkMode = matchMedia('(prefers-color-scheme: dark)');
const gameDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const singleColumn = matchMedia('(max-width: 760px)');
const landscapeReview = matchMedia('(531px <= width <= 760px) and (orientation: landscape)');
const boardShell = byId('chessground');
const board = Chessground(boardShell, {
  coordinates: true,
  highlight: { lastMove: true, check: true },
  premovable: { enabled: false },
  drawable: {
    enabled: false,
    visible: true,
    brushes: {
      best: { key: 'best', color: '#1f8a5b', opacity: 0.88, lineWidth: 10 },
      threat: { key: 'threat', color: '#cf2e2e', opacity: 0.88, lineWidth: 10 },
      variation: { key: 'variation', color: '#2b6cb0', opacity: 0.82, lineWidth: 9 },
      yellow: { key: 'y', color: '#d99b16', opacity: 0.78, lineWidth: 8 },
    },
  },
  movable: { free: false, events: { after: (from, to) => void enterMove(from + to) } },
});
let playEngine = new Engine();
const maiaEngine = new MaiaEngine();
let reviewPool = new EnginePool(1);
let practiceEngine = new Engine();
let botRequest = null;
let reviewRequest = null;
let decisionRequest = null;
let humanReviewRequest = null;
let practiceRequest = null;
let botError = '';
let difficultyPreview = null;
let botSelectionUpdate = Promise.resolve();

function storageWarning() {
  setText('storage-message', 'Browser storage is unavailable. Some changes may only last for this visit.');
  show('storage-message', true);
}

function persist(write) {
  if (state.db) void write(state.db).catch(storageWarning);
}

function persistSettings() {
  try {
    savePreferences(state.settings);
  } catch {
    storageWarning();
  }
}

function applySettings() {
  const { theme, board: boardStyle, pieces, reviewPreset } = state.settings;
  document.documentElement.dataset.theme = theme === 'system' ? (darkMode.matches ? 'dark' : 'light') : theme;
  applyBoardTheme(boardShell, boardStyle, pieces);
  const presetEl = byId('review-preset');
  if (presetEl) presetEl.value = reviewPreset;
}

function shouldUseMaiaInReview() {
  const pref = state.settings.maiaReview;
  if (pref === 'enabled') return true;
  if (pref === 'ask' && state.maiaCached) return true;
  return false;
}

function updateMaiaPrompt() {
  const visible = state.mode === 'review' &&
    state.review.id !== null &&
    state.settings.maiaReview === 'ask' &&
    !state.maiaCached;
  show('maia-review-prompt', visible);
}

function activeBotChoice() {
  const { game, settings } = state;
  if (!game || game.outcome) return { difficulty: settings.difficulty, bot: settings.bot };
  return { difficulty: game.difficulty, bot: game.bot ?? 'default' };
}

function renderDifficultySlider(difficulty, bot) {
  const value = DIFFICULTY_ORDER.indexOf(difficulty);
  const label = LEVELS[difficulty].label;
  const summary = botSearchSummary(difficulty, bot);
  setText('difficulty-active-label', label);
  setText('difficulty-time', summary);
  for (const step of byId('difficulty-slider-view').querySelectorAll('[data-difficulty-step]')) {
    step.dataset.active = String(step.dataset.difficultyStep === difficulty);
  }
  renderSlider(byId('difficulty-slider-shell'), {
    value, min: 0, max: DIFFICULTY_ORDER.length - 1, step: 1, thumbId: 'difficulty-slider',
    label: 'Bot difficulty', valueText: `${label}, ${summary}`, markers: sliderMarkers(DIFFICULTY_ORDER.length, value),
    onValueChange: previewDifficulty, onValueCommit: commitDifficulty,
  });
}

function previewDifficulty(value) {
  difficultyPreview = DIFFICULTY_ORDER[value];
  renderDifficultyControls();
}

function commitDifficulty(value) {
  applyBotSelection({ difficulty: DIFFICULTY_ORDER[value] });
}

function renderBotList(selectedBot) {
  const list = byId('difficulty-bot-list');
  if (!list.childElementCount) {
    const fragment = document.createDocumentFragment();
    for (const [key, profile] of Object.entries(BOT_PROFILES)) {
      const option = document.createElement('button');
      option.type = 'button';
      applyButtonVariant(option, 'ghost');
      option.className = 'bot-option';
      option.setAttribute('role', 'option');
      option.dataset.bot = key;

      const text = document.createElement('span');
      text.className = 'bot-option-text';
      const name = document.createElement('span');
      name.className = 'bot-option-name';
      name.textContent = profile.listLabel;
      name.id = 'bot-profile-name-' + key;
      text.append(name);
      if (profile.description) {
        const description = document.createElement('span');
        description.className = 'bot-option-desc';
        description.id = 'bot-profile-description-' + key;
        description.textContent = profile.description;
        text.append(description);
        option.setAttribute('aria-describedby', description.id);
      }
      option.append(text, icon('check', 'bot-option-check'));
      option.setAttribute('aria-labelledby', name.id);
      option.addEventListener('click', () => {
        applyBotSelection({ bot: key });
        showDifficultyView('slider', true);
      });
      fragment.append(option);
    }
    list.replaceChildren(fragment);
  }
  for (const option of list.querySelectorAll('.bot-option')) {
    const active = option.dataset.bot === selectedBot;
    option.setAttribute('aria-selected', String(active));
    option.tabIndex = active ? 0 : -1;
  }
}

function renderDifficultyControls() {
  const { difficulty, bot } = activeBotChoice();
  const displayedDifficulty = difficultyPreview ?? difficulty;
  const config = botSearchConfig(displayedDifficulty, bot);
  setText('difficulty-trigger-bot', config.botLabel);
  setText('difficulty-trigger-level', config.label);
  if (!byId('difficulty-popover')) return;
  setText('difficulty-active-bot', config.botLabel);
  renderDifficultySlider(displayedDifficulty, bot);
  byId('difficulty-reset').disabled = difficulty === DEFAULT_SETTINGS.difficulty && bot === DEFAULT_SETTINGS.bot;
  renderBotList(config.bot);
}

function showDifficultyView(view, focusControl = false) {
  const showingBots = view === 'bots';
  show('difficulty-slider-view', !showingBots);
  show('difficulty-bot-view', showingBots);
  const popover = byId('difficulty-popover');
  popover.dataset.view = view;
  popover.setAttribute('aria-label', showingBots ? 'Bot profile' : 'Bot difficulty');
  if (!focusControl) return;

  if (showingBots) {
    const list = byId('difficulty-bot-list');
    const selected = list.querySelector('[aria-selected="true"]');
    if (selected) focusBotOption(selected);
    else byId('difficulty-bot-back').focus({ preventScroll: true });
  } else {
    byId('difficulty-slider').focus({ preventScroll: true });
  }
}

function focusBotOption(option) {
  const list = option.parentElement;
  const previous = list.querySelector('[tabindex="0"]');
  if (previous) previous.tabIndex = -1;
  option.tabIndex = 0;
  option.focus({ preventScroll: true });
  const row = option.getBoundingClientRect();
  const view = list.getBoundingClientRect();
  if (row.top < view.top) list.scrollTop += Math.floor(row.top - view.top);
  else if (row.bottom > view.bottom) list.scrollTop += Math.ceil(row.bottom - view.bottom);
}

function difficultyPickerChanged(open) {
  const wasPreviewing = difficultyPreview !== null;
  difficultyPreview = null;
  if (open) {
    renderDifficultyControls();
    showDifficultyView('slider');
    bindBotPickerControls();
  } else if (wasPreviewing) {
    setText('difficulty-trigger-level', LEVELS[activeBotChoice().difficulty].label);
  }
}

function applyBotSelection(choice) {
  // A keyboard commit can arrive before its preview, and profile saves can overlap slider input.
  const update = botSelectionUpdate.then(() => saveBotSelection(choice));
  botSelectionUpdate = update.catch(() => {});
  return update;
}

async function saveBotSelection({ difficulty, bot }) {
  difficultyPreview = null;
  if (!canChangeMatch()) return renderPlayIfActive();
  const current = activeBotChoice();
  difficulty ??= current.difficulty;
  bot ??= current.bot;
  if (state.settings.difficulty !== difficulty || state.settings.bot !== bot) {
    state.settings = { ...state.settings, difficulty, bot };
    persistSettings();
  }
  const next = setDifficulty(state.game, difficulty, bot);
  if (next !== state.game) {
    cancelBot();
    botError = '';
    if (await updateGame(next)) void requestBot();
  } else {
    renderPlayIfActive();
  }
}

async function settingsDialog() {
  closeDifficultyPopover();
  const active = activeBotChoice();
  const initial = { ...state.settings, difficulty: active.difficulty, bot: active.bot };
  const settings = await showSettingsDialog(initial);
  if (!settings) return;
  const previous = state.settings;
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  if (!shouldUseMaiaInReview()) cancelHumanReview();
  applySettings();
  persistSettings();
  const colorChanged = state.settings.color !== previous.color;
  const botChanged = state.settings.difficulty !== active.difficulty || state.settings.bot !== active.bot;
  if (colorChanged && !state.game.moves.length) {
    await startGame();
  } else if (botChanged) {
    await applyBotSelection({ difficulty: state.settings.difficulty, bot: state.settings.bot });
  }
  if (state.mode === 'review' && state.review.id) {
    updateReviewViews(state.games.get(state.review.id));
    maybeAddHumanReview(state.games.get(state.review.id));
  } else if (!colorChanged && !botChanged) {
    updateMaiaPrompt();
    renderPlayIfActive();
  }
}

function playPosition() {
  const { game } = state;
  const position = positionAt(game, game.moves.length);
  if (game.outcome) return { position, orientation: game.human, text: outcomeTitle(game), last: game.moves.at(-1)?.uci };
  const humanTurn = position.turn === game.human;
  const engine = BOT_PROFILES[game.bot]?.maiaRatings ? 'Maia-3' : 'Stockfish';
  const turn = humanTurn ? `Your turn · ${capitalize(game.human)}` : `${engine} ${botError ? 'paused' : 'to move'}`;
  const text = state.matchConflict ? 'Saved match changed' : turn;
  return { position, orientation: game.human, text, last: game.moves.at(-1)?.uci, canMove: humanTurn && canChangeMatch() };
}

function reviewPosition() {
  const { id, ply, variation } = state.review;
  const game = state.games.get(id);
  if (!game) return { position: positionAt(state.game, 0), orientation: state.game.human, text: 'Game review' };
  if (variation) {
    const step = variation.steps[variation.index];
    return {
      position: positionFromFen(step.fen), orientation: game.human, last: step.uci,
      text: `${variation.line.san} line · ${variation.index} of ${variation.steps.length - 1}`,
    };
  }
  const move = game.moves[ply - 1];
  return {
    position: positionAt(game, ply), orientation: game.human, last: move?.uci,
    text: move ? `Reviewing ${moveLabel(ply, move.san)}` : 'Starting position',
  };
}

function practicePosition() {
  const { exercise, attempt } = state;
  if (!exercise) return { position: positionAt(state.game, 0), orientation: state.game.human, text: 'Practice' };
  const position = positionFromFen(attempt?.fen ?? exercise.fen);
  return {
    position, orientation: exercise.row.color, last: attempt?.uci, canMove: !attempt,
    text: attempt ? `You played ${attempt.san}` : `${capitalize(position.turn)} to move`,
  };
}

const boardPositions = { play: playPosition, review: reviewPosition, practice: practicePosition };

function reviewAutoShapes() {
  if (state.mode !== 'review' || !state.review.id) return [];
  const { id, ply, variation, showThreat } = state.review;
  const { rows } = reviewProgress(id);
  const shapes = [];

  if (variation) {
    const step = variation.steps[variation.index];
    if (variation.index > 0 && step?.uci && step.uci.length >= 4) {
      shapes.push({ orig: step.uci.slice(0, 2), dest: step.uci.slice(2, 4), brush: 'variation' });
      if (variation.index === variation.line.evidenceIndex && variation.line.target) {
        shapes.push({ orig: variation.line.target, brush: 'yellow' });
      }
    }
    return shapes;
  }

  const row = ply > 0 ? rows[ply - 1] : null;
  if (!row || row.provisional) return shapes;

  // Best move arrow when a better move existed (or highlight brilliant/great move)
  if (row.preferredUci && row.preferredUci.length >= 4 && row.preferredUci !== row.uci && !row.isBook && !row.isForced) {
    shapes.push({
      orig: row.preferredUci.slice(0, 2),
      dest: row.preferredUci.slice(2, 4),
      brush: 'best',
    });
  } else if (['Brilliant', 'Great'].includes(row.grade) && row.uci?.length >= 4) {
    shapes.push({
      orig: row.uci.slice(0, 2),
      dest: row.uci.slice(2, 4),
      brush: 'best',
    });
  }

  // Optional threat / refutation arrow + tactical motif geometry when "Show Threat" is active
  if (showThreat) {
    if (row.motifShapes?.length) {
      for (const s of row.motifShapes) shapes.push(s);
    }
    if (row.threat?.from && row.threat?.to) {
      shapes.push({ orig: row.threat.from, dest: row.threat.to, brush: 'threat' });
    }
  }

  // On-board move grade badge at destination square
  const svgHtml = boardGradeSvg(row.grade);
  if (svgHtml && row.uci?.length >= 4) {
    shapes.push({
      orig: row.uci.slice(2, 4),
      customSvg: { html: svgHtml, center: 'orig' },
    });
  }
  return shapes;
}

function renderBoard() {
  const { position, text, orientation, last, canMove } = boardPositions[state.mode]();
  const enabled = canMove && !state.promoting;
  const displayOrientation = state.flipped ? opposite(orientation) : orientation;
  board.set({
    fen: fen.makeFen(position.toSetup()),
    orientation: displayOrientation,
    turnColor: position.turn,
    check: position.isCheck(),
    lastMove: last?.match(/[a-h][1-8]/g),
    movable: { color: enabled ? position.turn : undefined, dests: enabled ? compat.chessgroundDests(position) : new Map() },
  });
  board.setAutoShapes(reviewAutoShapes());

  const reviewing = state.mode === 'review' && state.review.id !== null;
  let activeRow = null;
  if (reviewing && state.review.ply > 0) {
    const progress = reviewProgress(state.review.id);
    const row = progress.rows[state.review.ply - 1];
    if (state.review.variation?.line) {
      if (state.review.variation.index === 0) {
        activeRow = progress.rows[state.review.ply - 2] ?? { whiteChance: progress.meta?.initialChance ?? 50, whiteScore: null };
      } else {
        const { line } = state.review.variation;
        const color = row?.color ?? (state.review.ply % 2 ? 'white' : 'black');
        activeRow = {
          whiteChance: Number.isFinite(line.chance) ? toWhiteChance(line.chance, color) : null,
          whiteScore: line.whiteScore ?? null,
        };
      }
    } else {
      activeRow = row ?? null;
    }
  }
  renderEvalBar({ visible: reviewing, row: activeRow, orientation: displayOrientation });

  byId('turn-dot').dataset.color = position.turn;
  setText('board-status', text);
  const white = [], black = [];
  for (const [square, piece] of position.board) {
    const pieces = piece.color === 'white' ? white : black;
    pieces.push(`${piece.role} ${makeSquare(square)}`);
  }
  setText('board-white-pieces', `White · ${white.join(', ')}`);
  setText('board-black-pieces', `Black · ${black.join(', ')}`);
  renderBoardControls(enabled);
}

function renderBoardControls(enabled) {
  const practicing = state.mode === 'practice' && state.exercise !== null;
  show('move-form', state.mode === 'play' || practicing);
  byId('move-input').disabled = !enabled;
  byId('move-submit').disabled = !enabled;
  const reviewing = state.mode === 'review' && state.review.id !== null;
  show('replay-controls', reviewing);
  show('return-to-game', reviewing && Boolean(state.review.variation));
}

function moveError(message = '') {
  setText('move-error', message);
  show('move-error', Boolean(message));
}

function clearMoveInput() {
  byId('move-input').value = '';
  moveError();
}

async function enterMove(uci) {
  if (state.promoting) return;
  const originalMode = state.mode;
  const view = boardPositions[originalMode]();
  if (!view.canMove) return renderBoard();

  if (needsPromotion(view.position, uci)) {
    state.promoting = true;
    renderBoard();
    const choice = await choosePromotion(view.position.turn, state.settings.pieces);
    state.promoting = false;
    if (!choice) return renderBoard();
    uci += choice;
  }
  const move = legalMove(view.position, uci);
  if (!move) {
    moveError('Enter a legal move, for example e2e4.');
    return renderBoard();
  }
  clearMoveInput();
  if (originalMode === 'play') await recordMove(uci);
  else attemptPractice(view.position, move);
}

function outcomeKind(game) {
  if (!game.outcome.winner) return 'draw';
  return game.outcome.winner === game.human ? 'win' : 'loss';
}

function renderOutcomeIcon(id, game) {
  const slot = byId(id);
  const kind = outcomeKind(game);
  slot.dataset.outcome = kind;
  slot.replaceChildren(icon(OUTCOME_ICONS[kind], 'outcome-svg'));
}

function outcomeTitle(game, compact = false) {
  if (!game.outcome.winner) return 'Draw';
  if (game.outcome.winner === game.human) return compact ? 'Win' : 'You won';
  return compact ? 'Loss' : 'The bot won';
}

function outcomeReason(game) {
  const { reason, intendedMove } = game.outcome;
  return intendedMove ? `${reason} claimed with ${intendedMove}` : reason;
}

function renderPlay() {
  const { game } = state;
  setText('match-description', `You play ${capitalize(game.human)}`);
  renderDifficultyControls();
  show('game-result', Boolean(game.outcome));
  show('past-reviews', state.games.size > (game.outcome ? 1 : 0));
  if (game.outcome) {
    renderOutcomeIcon('result-icon', game);
    setText('result-title', outcomeTitle(game));
    setText('result-reason', outcomeReason(game));
  }
  show('bot-error', Boolean(botError));
  setText('bot-message', botError);
  show('match-conflict', state.matchConflict);
  const available = canChangeMatch();
  byId('difficulty-trigger').disabled = state.matchConflict;
  byId('new-game').disabled = !available;
  byId('undo').disabled = !available || undoTurn(game) === game;
  byId('resign').disabled = !available || Boolean(game.outcome) || !game.moves.length;
  const claims = drawClaims(game);
  show('claim-draw', Boolean(claims.now || claims.moves.length));
  byId('claim-draw').disabled = !available;
  renderPlayedMoves(game.moves);
  renderBoard();
}

function cancelBot() {
  if (!botRequest) return;
  botRequest.abort();
  botRequest = null;
  maiaEngine.terminate();
  playEngine.terminate();
  playEngine = new Engine();
}

function canChangeMatch() {
  return !state.savingMatch && !state.matchConflict;
}

async function updateGame(game) {
  if (!canChangeMatch()) return false;
  if (state.db) {
    state.savingMatch = true;
    renderPlayIfActive();
    try {
      const revision = await saveGame(state.db, game, state.matchRevision);
      if (revision === null) {
        state.matchConflict = true;
        cancelBot();
        closeDifficultyPopover();
      } else {
        state.matchRevision = revision;
      }
    } catch {
      storageWarning();
    } finally {
      state.savingMatch = false;
    }
    if (state.matchConflict) {
      renderPlayIfActive();
      return false;
    }
  }
  const justFinished = game.outcome && !state.game.outcome;
  state.game = game;
  if (game.outcome) state.games.set(game.id, game);
  renderPlayIfActive();
  if (justFinished) {
    state.pendingResultId = game.id;
    maybeShowGameOver();
  }
  return true;
}

function maybeShowGameOver() {
  if (state.mode !== 'play' || state.pendingResultId !== state.game.id) return;
  if (isDialogOpen()) return;
  closeDifficultyPopover();
  const { game } = state;
  state.pendingResultId = null;
  void showGameOverDialog({
    title: outcomeTitle(game), reason: outcomeReason(game), outcome: outcomeKind(game),
    openReview: openCurrentReview, retry: () => requestReview(game, { force: true }),
  });
  renderGameOverCounts(game, reviewProgress(game.id));
  requestReview(game);
}

function openCurrentReview() {
  const { game } = state;
  closeDialog('game-over-dialog');
  switchMode('review', game.id, game.moves.length);
  byId('review-title').focus({ preventScroll: true });
}

async function recordMove(uci) {
  const { game } = state;
  if (!canChangeMatch()) return;
  const position = positionAt(game, game.moves.length);
  const move = legalMove(position, uci);
  const next = playMove(game, uci);
  if (!next || !await updateGame(next)) return;
  if (state.mode === 'play') playSound(soundFor(next, detectCapture(position, move)));
  void requestBot();
}

function playSound(name) {
  if (state.settings.sound) void new Audio(`./assets/sound/futuristic/${name}.ogg`).play().catch(() => {});
}

function soundFor(game, capture) {
  if (game.outcome && !game.outcome.winner) return 'Draw';
  if (game.outcome?.reason === 'Checkmate') return 'Checkmate';
  if (positionAt(game, game.moves.length).isCheck()) return 'Check';
  return capture ? 'Capture' : 'Move';
}

function enginePosition(moves) {
  return moves.length ? 'startpos moves ' + moves.map(move => move.uci).join(' ') : 'startpos';
}

function botTurn(game) {
  return !game.outcome && positionAt(game, game.moves.length).turn !== game.human;
}

function renderPlayIfActive() {
  if (state.mode === 'play') renderPlay();
}

async function requestBot() {
  const { game } = state;
  if (!canChangeMatch() || botRequest || !botTurn(game)) return;
  const { time, elo, maiaRating } = botSearchConfig(game.difficulty, game.bot);
  const request = new AbortController();
  botRequest = request;
  botError = '';
  renderPlayIfActive();
  try {
    const position = positionAt(game, game.moves.length);
    const move = maiaRating === undefined
      ? (await playEngine.search(enginePosition(game.moves), {
        time, elo, fresh: !game.moves.length, signal: request.signal,
      })).move
      : mateInOne(position) ?? await maiaEngine.move(maiaPosition(game, maiaRating), request.signal);
    if (request.signal.aborted) return;
    if (maiaRating !== undefined) state.maiaCached = true;
    if (!move || !legalMove(position, move)) throw new Error('The bot returned an invalid move.');
    botRequest = null;
    await recordMove(move);
  } catch (error) {
    if (request.signal.aborted) return;
    botError = error.message;
    botRequest = null;
    renderPlayIfActive();
  }
}

async function startGame() {
  if (!canChangeMatch()) return;
  cancelBot();
  botError = '';
  state.pendingResultId = null;
  if (state.mode === 'play') {
    state.flipped = false;
    clearMoveInput();
  }
  if (await updateGame(newGame(state.settings))) void requestBot();
}

async function askNewGame() {
  closeDifficultyPopover();
  const { game } = state;
  if (!game.outcome && game.moves.length) {
    const confirmed = await confirmAction('Start a new game?', 'Your current game will be discarded.', 'Start new game');
    if (!confirmed) return;
  }
  await startGame();
}

async function askResign() {
  closeDifficultyPopover();
  if (!await confirmAction('Resign this game?', 'You can review the moves you played after resigning.', 'Resign game')) return;
  cancelBot();
  botError = '';
  const game = resign(state.game);
  if (game !== state.game) await updateGame(game);
}

async function askDrawClaim() {
  if (!canChangeMatch()) return;
  const { game } = state;
  const { now, moves } = drawClaims(game);
  if (!now && !moves.length) return;
  const choice = now
    ? (await confirmAction('Claim a draw?', `This position qualifies for a draw by ${now.toLowerCase()}.`, 'Claim draw') ? '' : undefined)
    : await chooseDrawMove(moves);
  if (choice === undefined || state.game !== game) return;
  const drawn = claimDraw(game, choice);
  if (drawn !== game && await updateGame(drawn)) playSound('Draw');
}

async function undo() {
  if (!canChangeMatch()) return;
  const game = undoTurn(state.game);
  if (game === state.game) return;
  cancelBot();
  botError = '';
  clearMoveInput();
  if (await updateGame(game)) void requestBot();
}

function reviewGames() {
  return [...state.games.values()].sort((a, b) => b.finishedAt - a.finishedAt);
}

function reviewLabel(game) {
  const date = gameDate.format(game.finishedAt);
  return `${outcomeTitle(game, true)}, ${date}`;
}

function reviewRecord(progress) {
  return { version: REVIEW_VERSION, preset: progress.preset, meta: progress.meta, rows: progress.rows };
}

function checkpointKey(gameId) {
  return `${gameId}:checkpoint`;
}

function cancelHumanReview() {
  if (!humanReviewRequest) return;
  humanReviewRequest.controller.abort();
  humanReviewRequest.engine.terminate();
  humanReviewRequest = null;
}

function cancelReview() {
  cancelHumanReview();
  if (decisionRequest) {
    decisionRequest.controller.abort();
    decisionRequest.engine.terminate();
    decisionRequest = null;
  }
  if (!reviewRequest) return;
  const { gameId, controller, checkpoint } = reviewRequest;
  reviewRequest = null;
  controller.abort();
  if (checkpoint) persist(db => writeLocal(db, 'reviews', checkpointKey(gameId), checkpoint));
  reviewPool.terminate();
  reviewPool = new EnginePool(1);
  const progress = state.reviews.get(gameId);
  if (progress) progress.running = false;
}

function reviewProgress(id) {
  return state.reviews.get(id) ?? EMPTY_REVIEW;
}

function renderReviewProgress(game) {
  const { error, statusLabel, running, progress, rows, done, preset } = reviewProgress(game.id);
  const comparing = decisionRequest?.gameId === game.id;
  const addingHuman = humanReviewRequest?.gameId === game.id;
  show('review-progress', running || comparing || addingHuman || Boolean(error) || !done);
  show('review-retry', Boolean(error));
  show('review-meter', running && !error);
  const reanalyzeBtn = byId('review-reanalyze');
  show('review-reanalyze', Boolean(rows.length || done));
  const busy = Boolean(running || comparing);
  reanalyzeBtn.setAttribute('aria-disabled', String(busy));
  const targetPreset = state.settings.reviewPreset;
  const presetMismatch = Boolean(done && !busy && preset && preset !== targetPreset);
  const presetLabel = REVIEW_PRESETS[targetPreset]?.label ?? targetPreset;
  applyButtonVariant(reanalyzeBtn, presetMismatch ? 'default' : 'outline');
  reanalyzeBtn.title = presetMismatch ? `Reanalyze with ${presetLabel} depth` : 'Reanalyze this game';
  reanalyzeBtn.setAttribute('aria-label', presetMismatch ? `Reanalyze with ${presetLabel} depth` : 'Reanalyze');
  const activity = comparing ? 'Searching this decision…' : addingHuman ? 'Adding optional human insights…' : statusLabel;
  setText('review-message', error || activity || 'Preparing analysis…');
  if (running && !error) {
    renderProgress('review-meter', progress?.done ?? 0, Math.max(1, progress?.total ?? game.moves.length));
  }
}

function displayedReview(gameId) {
  const progress = reviewProgress(gameId);
  if (state.settings.maiaReview !== 'disabled') return progress;
  return { ...progress, meta: { ...progress.meta, maia: null },
    rows: progress.rows.map(row => row.maia ? { ...row, maia: null } : row) };
}

function renderReview() {
  const { id, ply, variation, showThreat, updated } = state.review;
  const game = state.games.get(id);
  show('review-empty', !game);
  show('review-content', Boolean(game));
  show('review-toolbar-controls', Boolean(game));
  updateMaiaPrompt();
  renderBoard();
  if (!game) return;

  const { rows, meta, running } = displayedReview(id);
  const row = rows[ply - 1];
  renderReviewProgress(game);
  setText('review-analysis-updated', variation
    ? 'Analysis updated. Select a line to inspect the new result.'
    : 'This move’s analysis updated.');
  show('review-analysis-updated', updated);
  renderReviewOverview({ rows, meta, currentPly: ply, onSelect: selectPly });
  selectReviewMove(ply);
  renderReplay(variation?.index ?? ply, variation ? variation.steps.length - 1 : game.moves.length, replayTo);
  preserveReviewFocus('review-detail', () => showReviewDetail({
    ply, row, meta, variation, showThreat,
    toggleThreat: () => {
      state.review.showThreat = !state.review.showThreat;
      renderReview();
    },
    preview: (line, index) => previewLine(line, game, index),
    practice: () => saveExercise(game, row),
    showMoves: () => activateReviewTab('moves', true),
    onEnableMaia: enableMaiaInsights,
    maiaPreference: state.settings.maiaReview,
    compare: () => requestDecision(game, ply),
    comparisonBusy: running || Boolean(decisionRequest),
    comparing: decisionRequest?.ply === ply,
  }));
}

function preserveReviewFocus(id, render) {
  const container = byId(id);
  const focused = document.activeElement;
  const focusKey = container.contains(focused) ? focused.dataset?.reviewFocus : null;
  render();
  if (!focusKey || focused.isConnected) return;
  const replacement = [...container.querySelectorAll('[data-review-focus]')]
    .find(element => element.dataset.reviewFocus === focusKey);
  (replacement ?? (id === 'review-detail' ? byId('replay-ply') :
    document.querySelector('[data-review-tab="accuracy"]')))?.focus({ preventScroll: true });
}

function updateReviewViews(game) {
  const progress = reviewProgress(game.id);
  if (isDialogOpen('game-over-dialog') && state.game.id === game.id) renderGameOverCounts(game, progress);
  if (state.mode !== 'review' || state.review.id !== game.id) return;
  const list = byId('review-moves');
  if (list.dataset.gameId !== game.id) {
    renderReviewMoves(game.moves, inspectPly);
    list.dataset.gameId = game.id;
  }
  progress.rows.forEach(labelReviewMove);
  if (progress.rows.length === game.moves.length) {
    const { rows, meta } = displayedReview(game.id);
    preserveReviewFocus('accuracy-details', () => {
      renderAccuracy(summarize(game, rows, meta), game, inspectPly);
    });
  }
  renderReview();
}

function publishReview(game, progress, rows, meta, { silent = false } = {}) {
  const ply = state.review.ply;
  const old = progress.rows[ply - 1];
  const next = rows[ply - 1];
  const currentChanged = Boolean(old && next && (
    old.grade !== next.grade ||
    old.provisional !== next.provisional ||
    old.comparison?.recommended.uci !== next.comparison?.recommended.uci ||
    (state.review.variation && Boolean(next.comparison) && (
      !old.comparison ||
      old.comparison.played.uci !== next.comparison.played.uci ||
      old.deepened !== next.deepened
    ))
  ));
  if (!silent && state.mode === 'review' && state.review.id === game.id && currentChanged) {
    state.review.updated = true;
  }
  progress.rows = rows;
  progress.meta = meta;
  if (meta?.maia?.enabled) state.maiaCached = true;
  updateReviewViews(game);
}

function requestReview(game, { force = false } = {}) {
  const existing = state.reviews.get(game.id);
  if (!force && reviewRequest?.gameId === game.id) return;
  if (!force && existing?.done && existing.rows.length === game.moves.length) {
    updateReviewViews(game);
    maybeAddHumanReview(game);
    return;
  }
  cancelReview();
  const request = { gameId: game.id, controller: new AbortController(), checkpoint: null };
  reviewRequest = request;
  void runReview(game, request, force);
}

async function runReview(game, request, force) {
  const { signal } = request.controller;
  const preset = state.settings.reviewPreset;
  const existing = reviewProgress(game.id);
  const progress = {
    ...existing, preset, running: true, error: '', statusLabel: 'Preparing analysis…',
    progress: { done: 0, total: Math.max(1, game.moves.length) },
  };
  state.reviews.set(game.id, progress);
  updateReviewViews(game);
  try {
    const saved = state.db && !force
      ? await readLocal(state.db, 'reviews', game.id).catch(storageWarning)
      : null;
    signal.throwIfAborted();
    if (saved?.rows?.length === game.moves.length) {
      Object.assign(progress, { preset: saved.preset ?? preset, done: true, running: false, statusLabel: '' });
      publishReview(game, progress, saved.rows, saved.meta);
      maybeAddHumanReview(game);
      return;
    }
    if (force) progress.checkpoint = null;
    const checkpoint = force ? null : (existing.checkpoint ?? (state.db
      ? await readLocal(state.db, 'reviews', checkpointKey(game.id)).catch(storageWarning)
      : null));
    signal.throwIfAborted();
    const wasSaved = existing.done;
    const result = await analyzeGame(game, {
      pool: reviewPool, preset, signal, checkpoint,
    }, {
      onCheckpoint(data) {
        request.checkpoint = data;
        progress.checkpoint = data;
      },
      onProgress(info) {
        progress.statusLabel = info.label;
        progress.progress = { done: info.done, total: info.total };
        if (isDialogOpen('game-over-dialog') && state.game.id === game.id) renderGameOverCounts(game, progress);
        if (state.mode === 'review' && state.review.id === game.id) renderReviewProgress(game);
      },
      onPassComplete({ rows, meta }) {
        if (!wasSaved) publishReview(game, progress, rows, meta);
      },
      onRowUpdate(_row, rows, meta) {
        if (!wasSaved) publishReview(game, progress, rows, meta);
      },
    });
    signal.throwIfAborted();
    Object.assign(progress, { done: true, running: false, statusLabel: '', preset: result.preset, checkpoint: null });
    publishReview(game, progress, result.rows, result.meta);
    request.checkpoint = null;
    persist(db => saveReview(db, game.id, reviewRecord(progress), checkpointKey(game.id)));
    maybeAddHumanReview(game);
  } catch (error) {
    if (signal.aborted) return;
    progress.error = error.message || 'Analysis could not finish. Try again.';
    progress.running = false;
    if (request.checkpoint) persist(db => writeLocal(db, 'reviews', checkpointKey(game.id), request.checkpoint));
    updateReviewViews(game);
  } finally {
    if (reviewRequest === request) reviewRequest = null;
  }
}

async function requestDecision(game, ply) {
  const progress = reviewProgress(game.id);
  const row = progress.rows[ply - 1];
  if (!row || row.deepened || progress.running || decisionRequest) return;
  const controller = new AbortController();
  const engine = new Engine();
  const request = { gameId: game.id, ply, controller, engine };
  decisionRequest = request;
  progress.error = '';
  renderReview();
  try {
    const result = await compareGameMove(game, {
      ply, engine, row, previousRow: progress.rows[ply - 2], preset: progress.preset, signal: controller.signal,
      readMaia: () => progress.rows[ply - 1]?.maia,
    });
    controller.signal.throwIfAborted();
    const rows = [...progress.rows];
    rows[ply - 1] = result;
    publishReview(game, progress, rows, progress.meta, { silent: !state.review.variation });
    if (progress.done) persist(db => writeLocal(db, 'reviews', game.id, reviewRecord(progress)));
  } catch (error) {
    if (!controller.signal.aborted) progress.error = error.message || 'The comparison could not finish.';
  } finally {
    engine.terminate();
    if (decisionRequest === request) {
      decisionRequest = null;
      if (state.mode === 'review' && state.review.id === game.id) renderReview();
    }
  }
}

function reanalyzeCurrentReview() {
  const game = state.games.get(state.review.id);
  if (game && !reviewProgress(game.id).running && !decisionRequest) requestReview(game, { force: true });
}

function enableMaiaInsights() {
  state.settings = { ...state.settings, maiaReview: 'enabled' };
  persistSettings();
  updateMaiaPrompt();
  const game = state.games.get(state.review.id);
  if (game && reviewProgress(game.id).done) void requestHumanReview(game);
}

function maybeAddHumanReview(game) {
  const progress = reviewProgress(game.id);
  if (state.mode === 'review' && state.review.id === game.id && progress.done && !progress.running &&
      shouldUseMaiaInReview() && !progress.meta?.maia?.enabled && !progress.meta?.maia?.error) {
    void requestHumanReview(game);
  }
}

async function requestHumanReview(game) {
  if (humanReviewRequest || !game.moves.length) return;
  const progress = reviewProgress(game.id);
  const controller = new AbortController();
  const engine = new MaiaEngine();
  const request = { gameId: game.id, controller, engine };
  humanReviewRequest = request;
  renderReviewProgress(game);
  try {
    const human = await analyzeReviewHuman(game, engine, controller.signal);
    controller.signal.throwIfAborted();
    const maia = human.estimate
      ? { ...human.estimate, finalChance: human.finalChance ?? null, enabled: true }
      : { enabled: false, error: human.error };
    publishReview(game, progress, applyReviewHuman(progress.rows, game, human), { ...progress.meta, maia });
    if (human.estimate) persist(db => writeLocal(db, 'reviews', game.id, reviewRecord(progress)));
  } catch (error) {
    if (!controller.signal.aborted) {
      publishReview(game, progress, progress.rows, {
        ...progress.meta, maia: { enabled: false, error: error.message || 'Human insights are unavailable.' },
      });
    }
  } finally {
    engine.terminate();
    if (humanReviewRequest === request) {
      humanReviewRequest = null;
      renderReviewProgress(game);
    }
  }
}

function skipMaiaInsights() {
  state.settings = { ...state.settings, maiaReview: 'disabled' };
  cancelHumanReview();
  persistSettings();
  updateMaiaPrompt();
}

function chooseReview(id, ply = 1) {
  const games = reviewGames();
  const matched = state.games.get(id);
  const game = matched ?? games[0];
  const clampedPly = game ? Math.max(0, Math.min(game.moves.length, matched ? ply : 1)) : 1;
  if (reviewRequest && reviewRequest.gameId !== game?.id ||
      decisionRequest && decisionRequest.gameId !== game?.id ||
      humanReviewRequest && humanReviewRequest.gameId !== game?.id) cancelReview();
  state.review = { id: game?.id ?? null, ply: clampedPly, variation: null, showThreat: false, updated: false };
  setOptions('review-games', games, state.review.id, reviewLabel);
  byId('review-preset').value = state.settings.reviewPreset;
  show('review-summary', false);
  show('review-tab-score', false);
  show('review-accuracy-pending', true);
  if (!game) return renderReview();
  updateReviewViews(game);
  requestReview(game);
}

function selectPly(ply) {
  state.review.ply = ply;
  state.review.variation = null;
  state.review.updated = false;
  renderReview();
}

function inspectPly(ply) {
  activateReviewTab('inspect', true);
  selectPly(ply);
}

function previewLine(line, game, index = 1) {
  const initial = { fen: fenAt(game, state.review.ply - 1) };
  state.review.variation = { index, steps: [initial, line, ...line.continuation], line };
  state.review.updated = false;
  renderReview();
  byId('replay-ply').focus({ preventScroll: true });
  if (singleColumn.matches && !landscapeReview.matches) byId('board-status').scrollIntoView({ block: 'start' });
}

function replayTo(ply) {
  navigateReplay(() => ply);
}

function navigateReplay(value) {
  const { id, ply, variation } = state.review;
  if (!id) return;
  const index = variation?.index ?? ply;
  const limit = variation ? variation.steps.length - 1 : state.games.get(id).moves.length;
  const next = Math.max(0, Math.min(limit, value(index, limit)));
  if (!variation) return selectPly(next);
  variation.index = next;
  renderReview();
}

function saveExercise(game, row) {
  const id = `${game.id}:${row.ply}`;
  const exercise = { id, gameId: game.id, row, fen: fenAt(game, row.ply - 1) };
  state.practice.set(id, exercise);
  persist(db => writeLocal(db, 'practice', id, exercise));
  switchMode('practice', id);
}

function cancelPractice() {
  if (!practiceRequest) return;
  practiceRequest.abort();
  practiceRequest = null;
  practiceEngine.terminate();
  practiceEngine = new Engine();
}

function chooseExercise(id) {
  cancelPractice();
  const options = [...state.practice.values()].reverse();
  state.exercise = state.practice.get(id) ?? options[0] ?? null;
  state.attempt = null;
  setOptions('practice-positions', options, state.exercise?.id, exercise => {
    const { row } = exercise;
    const game = state.games.get(exercise.gameId);
    const label = `${moveLabel(row.ply, row.san)} · ${row.provisional ? "Provisional" : row.grade}`;
    return game ? label + ' · ' + gameDate.format(game.finishedAt) : label;
  });
  show('practice-content', Boolean(state.exercise));
  show('practice-empty', !state.exercise);
  resetPractice();
}

function resetPractice() {
  cancelPractice();
  state.attempt = null;
  clearMoveInput();
  show('practice-feedback', false);
  show('practice-hint-text', false);
  if (state.exercise) {
    const { row } = state.exercise;
    setText('practice-task-title', `Find a move for ${capitalize(row.color)}`);
    if (row.grade && !row.provisional) byId('practice-task-grade').replaceChildren(gradeBadge(row.grade));
    show('practice-task-grade', Boolean(row.grade && !row.provisional));
    setText('practice-task-text', row.lostAdvantage ? 'Find a way to keep the advantage from the original game.' :
      'Try a move and compare it with the reviewed lines.');
  } else {
    show('practice-task-grade', false);
  }
  renderBoard();
}

function hint() {
  const { row } = state.exercise;
  setText('practice-hint-text', buildPracticeHint(row));
  show('practice-hint-text', true);
}

async function attemptPractice(position, move) {
  const { row } = state.exercise;
  const uci = standardUci(position, move);
  const moveSan = san.makeSan(position, move);
  position.play(move);
  const value = fen.makeFen(position.toSetup());
  state.attempt = { uci, san: moveSan, fen: value };
  renderBoard();
  show('practice-feedback', true);

  const feedback = practiceFeedback(row, uci);
  if (feedback) return setText('practice-feedback', feedback);
  if (position.isEnd()) return setText('practice-feedback', position.isCheckmate() ? 'This move delivers checkmate.' : 'This move draws the position.');
  setText('practice-feedback', 'Evaluating your move…');
  const request = new AbortController();
  practiceRequest = request;
  try {
    const { lines } = await practiceEngine.search('fen ' + value, { nodes: 80_000, showWdl: true, signal: request.signal });
    request.signal.throwIfAborted();
    setText('practice-feedback', practiceEstimate(row.before, lines[0].score, lines[0].wdl, totalMaterialCount(position)));
  } catch {
    if (!request.signal.aborted) setText('practice-feedback', 'Legal move. Try a reviewed alternative for feedback.');
  } finally {
    if (practiceRequest === request) practiceRequest = null;
  }
}

function renderNavigation(mode) {
  const section = mode === 'review' ? 'play' : mode;
  for (const button of document.querySelectorAll('[data-mode]')) {
    if (button.dataset.mode === section) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const panel of Object.keys(openMode)) show(panel + '-panel', panel === mode);
}

const openMode = {
  play: renderPlay,
  review: (id, ply) => {
    if (id) activateReviewTab('inspect');
    chooseReview(id ?? state.review.id, ply ?? state.review.ply);
  },
  practice: id => chooseExercise(id ?? state.exercise?.id),
};

function switchMode(mode, id, ply) {
  closeDifficultyPopover();
  if (mode !== 'practice') cancelPractice();
  if (mode !== 'review') cancelReview();
  const changed = state.mode !== mode;
  if (changed) {
    clearMoveInput();
    state.flipped = false;
  }
  state.mode = mode;
  moveError();
  renderNavigation(mode);
  openMode[mode](id, ply);
  if (changed) byId(mode + '-title').focus({ preventScroll: true });
  maybeShowGameOver();
  if (singleColumn.matches) window.scrollTo({ top: 0 });
}

function bindBotPickerControls() {
  byId('difficulty-bot-open').addEventListener('click', () => showDifficultyView('bots', true));
  byId('difficulty-bot-back').addEventListener('click', () => {
    showDifficultyView('slider');
    byId('difficulty-bot-open').focus({ preventScroll: true });
  });
  byId('difficulty-reset').addEventListener('click', () => {
    applyBotSelection({ difficulty: DEFAULT_SETTINGS.difficulty, bot: DEFAULT_SETTINGS.bot });
    byId('difficulty-slider').focus({ preventScroll: true });
  });
  byId('difficulty-bot-list').addEventListener('keydown', event => {
    const options = [...byId('difficulty-bot-list').querySelectorAll('.bot-option')];
    const current = options.indexOf(document.activeElement);
    if (current < 0) return;
    let next = -1;
    if (event.key === 'ArrowDown') next = (current + 1) % options.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    focusBotOption(options[next]);
  });
}

function stepReviewGame(offset) {
  const games = reviewGames();
  const index = games.findIndex(game => game.id === state.review.id);
  const next = games[index + offset];
  if (!next) return false;
  chooseReview(next.id);
  byId('review-title').focus({ preventScroll: true });
  return true;
}

function stepKeyDecision(direction) {
  const game = state.games.get(state.review.id);
  if (!game) return false;
  const rows = keyReviewRows(reviewProgress(game.id).rows, game.human);
  const next = direction > 0 ? rows.find(row => row.ply > state.review.ply)
    : rows.findLast(row => row.ply < state.review.ply);
  if (!next) return false;
  inspectPly(next.ply);
  byId('review-title').focus({ preventScroll: true });
  return true;
}

function handleShortcut(event) {
  if (isDialogOpen() || event.target?.closest?.('[data-slot="popover-content"]')) return;
  const action = shortcutAction(event, state.mode, state.settings.shortcuts);
  if (!action) return;
  switch (action) {
    case 'previous-moment': if (!stepKeyDecision(-1)) return; break;
    case 'next-moment': if (!stepKeyDecision(1)) return; break;
    case 'older-review': if (!stepReviewGame(1)) return; break;
    case 'newer-review': if (!stepReviewGame(-1)) return; break;
    case 'go-play': switchMode('play'); break;
    case 'go-review': if (state.mode === 'review') return; switchMode('review'); break;
    case 'go-practice': switchMode('practice'); break;
    default: {
      const control = byId(action);
      if (!control || control.disabled || control.closest('[hidden]')) return;
      if (action === 'move-input') control.focus();
      else control.click();
    }
  }
  event.preventDefault();
}

function bindControls() {
  bindDifficultyPicker(difficultyPickerChanged);
  const actions = {
    home: () => switchMode('play'),
    'settings-open': settingsDialog,
    'shortcuts-open': () => showShortcutsDialog(state.settings.shortcuts),
    'new-game': askNewGame,
    'flip-board': () => { state.flipped = !state.flipped; renderBoard(); },
    undo, resign: askResign,
    'claim-draw': askDrawClaim,
    'reload-match': () => location.reload(),
    'bot-retry': requestBot,
    'review-open': openCurrentReview,
    'past-reviews': () => switchMode('review'),
    'review-retry': reanalyzeCurrentReview,
    'review-reanalyze': reanalyzeCurrentReview,
    'maia-prompt-enable': enableMaiaInsights,
    'maia-prompt-skip': skipMaiaInsights,
    'replay-start': () => navigateReplay(() => 0),
    'replay-back': () => navigateReplay(index => index - 1),
    'replay-next': () => navigateReplay(index => index + 1),
    'replay-end': () => navigateReplay((_, limit) => limit),
    'return-to-game': () => {
      selectPly(state.review.ply);
      byId('replay-ply').focus({ preventScroll: true });
    },
    'practice-reset': resetPractice,
    'practice-hint': hint,
    'practice-review': () => switchMode('review', state.exercise.gameId, state.exercise.row.ply),
  };
  for (const [id, action] of Object.entries(actions)) byId(id).addEventListener('click', action);
  for (const button of document.querySelectorAll('[data-mode], [data-go]')) {
    button.addEventListener('click', () => switchMode(button.dataset.mode ?? button.dataset.go));
  }
  document.addEventListener('studio-dialog-closed', () => requestAnimationFrame(() => {
    if (state.mode === 'play' && !isDialogOpen('game-over-dialog')) cancelReview();
    maybeShowGameOver();
  }));
  byId('review-games').addEventListener('change', event => chooseReview(event.target.value));
  byId('review-preset').addEventListener('change', event => {
    const preset = event.target.value;
    if (!PRESET_ORDER.includes(preset)) return;
    state.settings = { ...state.settings, reviewPreset: preset };
    persistSettings();
    const game = state.games.get(state.review.id);
    if (state.mode === 'review' && game) renderReviewProgress(game);
  });
  byId('practice-positions').addEventListener('change', event => chooseExercise(event.target.value));
  byId('move-form').addEventListener('submit', event => {
    event.preventDefault();
    void enterMove(byId('move-input').value.trim().toLowerCase());
  });
  document.addEventListener('keydown', handleShortcut);
  darkMode.addEventListener('change', applySettings);
}

async function restoreGames() {
  const db = await openStore();
  state.db = db;
  const [game, games, practice] = await Promise.all([
    readLocal(db, 'active', 'match'),
    readLocal(db, 'games'),
    readLocal(db, 'practice'),
  ]);
  state.matchRevision = game?.storageRevision ?? null;
  if (validGame(game)) {
    const { storageRevision, ...savedGame } = game;
    state.game = savedGame;
  }
  state.games = new Map(games.filter(validGame).map(entry => [entry.id, entry]));
  state.practice = new Map(practice.filter(validExercise).map(entry => [entry.id, entry]));
}

async function init() {
  try {
    state.settings = preferences();
  } catch {
    storageWarning();
  }
  applySettings();
  state.game = newGame(state.settings);
  state.maiaCached = await isMaiaModelCached();
  try {
    await restoreGames();
  } catch {
    storageWarning();
  }
  bindControls();
  renderPlay();
  if (new URLSearchParams(location.search).has('settings')) await settingsDialog();
  void requestBot();
}

void init();
