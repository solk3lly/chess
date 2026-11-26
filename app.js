import { Chessground } from 'https://cdn.jsdelivr.net/npm/@lichess-org/chessground@10.1.0/dist/chessground.min.js';
import { compat, fen, san } from './vendor/chessops.bundle.js';
import { detectCapture, standardUci } from './game-state.js';
import { Engine } from './engine.js';
import { OUTCOME_ICONS, gradeBadge, icon } from './icons.js';
import { DEFAULT_SETTINGS, openStore, preferences, readLocal, saveGame, savePreferences, writeLocal } from './local-store.js';
import { analyzeGame, practiceFeedback, REVIEW_VERSION, summarize, winningChance } from './review.js';
import { renderAccuracy, renderGameOverCounts, showReviewDetail } from './review-view.js';
import {
  BOT_PROFILES, DIFFICULTY_ORDER, LEVELS, botSearchConfig,
  fenAt, legalMove, needsPromotion, newGame, opposite, playMove,
  positionAt, positionFromFen, resign, rookieMove, setDifficulty, undoTurn, validExercise, validGame,
} from './studio-game.js';
import {
  byId, capitalize, labelReviewMove, moveLabel,
  renderPlayedMoves, renderReviewMoves, selectReviewMove, setOptions, setText, show,
} from './studio-view.js';

import { mountStudio } from './studio-layout.js';
import { applyButtonVariant } from './ui/button.js';
import { choosePromotion, closeDialog, confirmAction, isDialogOpen, showGameOverDialog, showSettingsDialog } from './studio-dialogs.js';
import { activateReviewTab, bindDifficultyPicker, closeDifficultyPopover, renderProgress, renderReplay, renderSlider, sliderMarkers } from './studio-widgets.js';

mountStudio();

const state = {
  mode: 'play', settings: DEFAULT_SETTINGS, db: null, game: null, games: new Map(),
  reviews: new Map(), review: { id: null, ply: 1, variation: null }, pendingResultId: null,
  practice: new Map(), exercise: null, attempt: null, flipped: false, promoting: false,
};
const EMPTY_REVIEW = { rows: [], error: '' };
const darkMode = matchMedia('(prefers-color-scheme: dark)');
const gameDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const singleColumn = matchMedia('(max-width: 760px)');
const boardShell = byId('chessground');
const board = Chessground(boardShell, {
  coordinates: true,
  highlight: { lastMove: true, check: true },
  premovable: { enabled: false },
  drawable: { enabled: false },
  movable: { free: false, events: { after: (from, to) => void enterMove(from + to) } },
});
let playEngine = new Engine();
let reviewEngine = new Engine();
let practiceEngine = new Engine();
let botRequest = null;
let reviewRequest = null;
let practiceRequest = null;
let botError = '';
let difficultyPreviewing = false;

function storageWarning() {
  setText('storage-message', 'Browser storage is unavailable. Some changes may only last for this visit.');
  show('storage-message', true);
}

function persist(write) {
  if (state.db) void write(state.db).catch(storageWarning);
}

function applySettings() {
  const { theme, board: boardStyle, pieces } = state.settings;
  document.documentElement.dataset.theme = theme === 'system' ? (darkMode.matches ? 'dark' : 'light') : theme;
  boardShell.dataset.boardStyle = boardStyle;
  boardShell.dataset.pieceStyle = pieces;
}

function activeBotChoice() {
  const { game, settings } = state;
  if (!game || game.outcome) return { difficulty: settings.difficulty, bot: settings.bot };
  return { difficulty: game.difficulty, bot: game.bot ?? 'default' };
}

function renderDifficultySlider(difficulty) {
  const value = DIFFICULTY_ORDER.indexOf(difficulty);
  const label = LEVELS[difficulty].label;
  setText('difficulty-active-label', label);
  for (const step of byId('difficulty-slider-view').querySelectorAll('[data-difficulty-step]')) {
    step.dataset.active = String(step.dataset.difficultyStep === difficulty);
  }
  renderSlider(byId('difficulty-slider-shell'), {
    value, min: 0, max: DIFFICULTY_ORDER.length - 1, step: 1, thumbId: 'difficulty-slider',
    label: 'Bot difficulty', valueText: label, markers: sliderMarkers(DIFFICULTY_ORDER.length, value),
    onValueChange: previewDifficulty, onValueCommit: commitDifficulty,
  });
}

function previewDifficulty(value) {
  difficultyPreviewing = true;
  const difficulty = DIFFICULTY_ORDER[value];
  renderDifficultySlider(difficulty);
  setText('difficulty-trigger-level', LEVELS[difficulty].label);
}

function commitDifficulty(value) {
  difficultyPreviewing = false;
  applyBotSelection(DIFFICULTY_ORDER[value], activeBotChoice().bot);
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
      const description = document.createElement('span');
      description.className = 'bot-option-desc';
      description.id = 'bot-profile-description-' + key;
      description.textContent = profile.description;
      text.append(name, description);
      option.append(text, icon('check', 'bot-option-check'));
      option.setAttribute('aria-labelledby', name.id);
      option.setAttribute('aria-describedby', description.id);
      option.addEventListener('click', () => {
        difficultyPreviewing = false;
        const { difficulty } = activeBotChoice();
        applyBotSelection(difficulty, key);
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
  const config = botSearchConfig(difficulty, bot);
  setText('difficulty-trigger-bot', config.botLabel);
  if (!difficultyPreviewing) setText('difficulty-trigger-level', config.label);
  if (!byId('difficulty-popover')) return;
  setText('difficulty-active-bot', config.botLabel);
  if (!difficultyPreviewing) renderDifficultySlider(difficulty);
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
  const wasPreviewing = difficultyPreviewing;
  difficultyPreviewing = false;
  if (open) {
    renderDifficultyControls();
    showDifficultyView('slider');
    bindBotPickerControls();
  } else if (wasPreviewing) {
    setText('difficulty-trigger-level', LEVELS[activeBotChoice().difficulty].label);
  }
}

function applyBotSelection(difficulty, bot) {
  if (state.settings.difficulty !== difficulty || state.settings.bot !== bot) {
    state.settings = { ...state.settings, difficulty, bot };
    try {
      savePreferences(state.settings);
    } catch {
      storageWarning();
    }
  }
  const next = setDifficulty(state.game, difficulty, bot);
  if (next !== state.game) {
    cancelBot();
    botError = '';
    updateGame(next);
    void requestBot();
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
  state.settings = settings;
  applySettings();
  try {
    savePreferences(state.settings);
  } catch {
    storageWarning();
  }
  const colorChanged = state.settings.color !== previous.color;
  const botChanged = state.settings.difficulty !== active.difficulty || state.settings.bot !== active.bot;
  if (colorChanged && !state.game.moves.length) {
    startGame();
  } else if (botChanged) {
    applyBotSelection(state.settings.difficulty, state.settings.bot);
  } else {
    renderPlayIfActive();
  }
}

function playPosition() {
  const { game } = state;
  const position = positionAt(game, game.moves.length);
  if (game.outcome) return { position, orientation: game.human, text: outcomeTitle(game), last: game.moves.at(-1)?.uci };
  const humanTurn = position.turn === game.human;
  const text = humanTurn ? `Your turn · ${capitalize(game.human)}` : (botError ? 'Stockfish paused' : 'Stockfish to move');
  return { position, orientation: game.human, text, last: game.moves.at(-1)?.uci, canMove: humanTurn };
}

function reviewPosition() {
  const { id, ply, variation } = state.review;
  const game = state.games.get(id);
  if (!game) return { position: positionAt(state.game, 0), orientation: state.game.human, text: 'Game review' };
  if (variation) {
    const step = variation.steps[variation.index];
    return {
      position: positionFromFen(step.fen), orientation: game.human, last: step.uci,
      text: `Alternative line · ${variation.index} of ${variation.steps.length - 1}`,
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

function renderBoard() {
  const { position, text, orientation, last, canMove } = boardPositions[state.mode]();
  const enabled = canMove && !state.promoting;
  board.set({
    fen: fen.makeFen(position.toSetup()),
    orientation: state.flipped ? opposite(orientation) : orientation,
    turnColor: position.turn,
    check: position.isCheck(),
    lastMove: last?.match(/[a-h][1-8]/g),
    movable: { color: enabled ? position.turn : undefined, dests: enabled ? compat.chessgroundDests(position) : new Map() },
  });
  byId('turn-dot').dataset.color = position.turn;
  setText('board-status', text);
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

async function enterMove(uci) {
  if (state.promoting) return;
  const originalMode = state.mode;
  const view = boardPositions[originalMode]();
  if (!view.canMove) return renderBoard();

  if (needsPromotion(view.position, uci)) {
    state.promoting = true;
    renderBoard();
    const choice = await choosePromotion(view.position.turn);
    state.promoting = false;
    if (!choice) return renderBoard();
    uci += choice;
  }
  const move = legalMove(view.position, uci);
  if (!move) {
    moveError('Enter a legal move, for example e2e4.');
    return renderBoard();
  }
  moveError();
  byId('move-input').value = '';
  if (originalMode === 'play') recordMove(uci);
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
  return compact ? 'Loss' : 'Stockfish won';
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
    setText('result-reason', game.outcome.reason);
  }
  show('bot-error', Boolean(botError));
  setText('bot-message', botError);
  byId('undo').disabled = undoTurn(game) === game;
  byId('resign').disabled = Boolean(game.outcome) || !game.moves.length;
  renderPlayedMoves(game.moves);
  renderBoard();
}

function cancelBot() {
  if (!botRequest) return;
  botRequest.abort();
  botRequest = null;
  playEngine.terminate();
  playEngine = new Engine();
}

function updateGame(game) {
  const justFinished = game.outcome && !state.game.outcome;
  state.game = game;
  if (game.outcome) state.games.set(game.id, game);
  persist(db => saveGame(db, game));
  renderPlayIfActive();
  if (justFinished) {
    state.pendingResultId = game.id;
    maybeShowGameOver();
  }
}

function maybeShowGameOver() {
  if (state.mode !== 'play' || state.pendingResultId !== state.game.id) return;
  if (isDialogOpen()) return;
  closeDifficultyPopover();
  const { game } = state;
  state.pendingResultId = null;
  void showGameOverDialog({
    title: outcomeTitle(game), reason: game.outcome.reason, outcome: outcomeKind(game),
    openReview: openCurrentReview, retry: () => requestReview(game),
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

function recordMove(uci) {
  const { game } = state;
  const position = positionAt(game, game.moves.length);
  const move = legalMove(position, uci);
  const next = playMove(game, uci);
  if (!next) return;

  if (state.settings.sound && state.mode === 'play') {
    const capture = detectCapture(position, move);
    const name = soundFor(next, capture);
    void new Audio(`./assets/sound/futuristic/${name}.ogg`).play().catch(() => {});
  }
  updateGame(next);
  void requestBot();
}

function soundFor(game, capture) {
  if (game.outcome && !game.outcome.winner) return 'Draw';
  if (positionAt(game, game.moves.length).isCheck()) return 'Check';
  return capture ? 'Capture' : 'Move';
}

function enginePosition(moves) {
  return moves.length ? 'startpos moves ' + moves.map(move => move.uci).join(' ') : 'startpos';
}

function stockfishTurn(game) {
  return !game.outcome && positionAt(game, game.moves.length).turn !== game.human;
}

function renderPlayIfActive() {
  if (state.mode === 'play') renderPlay();
}

async function requestBot() {
  const { game } = state;
  if (botRequest || !stockfishTurn(game)) return;
  const { bot, time, skill, elo, depth, lines = 1 } = botSearchConfig(game.difficulty, game.bot);
  const request = new AbortController();
  botRequest = request;
  botError = '';
  renderPlayIfActive();
  try {
    const result = await playEngine.search(enginePosition(game.moves), {
      time, skill, elo, depth, lines, fresh: !game.moves.length, signal: request.signal,
    });
    if (request.signal.aborted) return;
    const position = positionAt(game, game.moves.length);
    const move = bot === 'elo250' ? rookieMove(position, result) : result.move;
    if (!move || !legalMove(position, move)) throw new Error('Stockfish returned an invalid move.');
    botRequest = null;
    recordMove(move);
  } catch (error) {
    if (request.signal.aborted) return;
    botError = error.message;
    botRequest = null;
    renderPlayIfActive();
  }
}

function startGame() {
  cancelBot();
  botError = '';
  state.pendingResultId = null;
  if (state.mode === 'play') state.flipped = false;
  updateGame(newGame(state.settings));
  void requestBot();
}

async function askNewGame() {
  closeDifficultyPopover();
  const { game } = state;
  if (!game.outcome && game.moves.length) {
    const confirmed = await confirmAction('Start a new game?', 'Your current game will be discarded.', 'Start new game');
    if (!confirmed) return;
  }
  moveError();
  startGame();
}

async function askResign() {
  closeDifficultyPopover();
  if (!await confirmAction('Resign this game?', 'You can review the moves you played after resigning.', 'Resign game')) return;
  cancelBot();
  botError = '';
  updateGame(resign(state.game));
}

function undo() {
  const game = undoTurn(state.game);
  if (game === state.game) return;
  cancelBot();
  botError = '';
  moveError();
  updateGame(game);
  void requestBot();
}

function reviewGames() {
  return [...state.games.values()].sort((a, b) => b.finishedAt - a.finishedAt);
}

function reviewLabel(game) {
  const date = gameDate.format(game.finishedAt);
  return `${outcomeTitle(game, true)}, ${date}`;
}

function cancelReview() {
  if (!reviewRequest) return;
  reviewRequest.abort();
  reviewRequest = null;
  reviewEngine.terminate();
  reviewEngine = new Engine();
}

function reviewProgress(id) {
  return state.reviews.get(id) ?? EMPTY_REVIEW;
}

function renderReviewProgress(game) {
  const { rows, error } = reviewProgress(game.id);
  const pending = rows.length < game.moves.length;
  show('review-progress', pending);
  show('review-retry', Boolean(error));
  show('review-meter', !error);
  setText('review-message', error || `Analyzing moves · ${rows.length} of ${game.moves.length}`);
  if (pending && !error) renderProgress('review-meter', rows.length, game.moves.length);
}

function renderReview() {
  const { id, ply, variation } = state.review;
  const game = state.games.get(id);
  show('review-empty', !game);
  show('review-content', Boolean(game));
  show('review-games', Boolean(game));
  renderBoard();
  if (!game) return;

  const { rows } = reviewProgress(id);
  renderReviewProgress(game);
  selectReviewMove(ply);
  renderReplay(variation?.index ?? ply, variation ? variation.steps.length - 1 : game.moves.length, replayTo);
  showReviewDetail({
    ply, row: rows[ply - 1], variation,
    preview: line => previewLine(line, game),
    practice: () => saveExercise(game, rows[ply - 1]),
    showMoves: () => activateReviewTab('moves', true),
  });
}

async function loadReview(id) {
  if (!state.db) return null;
  const saved = await readLocal(state.db, 'reviews', id).catch(storageWarning);
  return saved?.version === REVIEW_VERSION ? saved.rows : null;
}

function updateReviewViews(game, row) {
  const progress = reviewProgress(game.id);
  if (isDialogOpen('game-over-dialog') && state.game.id === game.id) renderGameOverCounts(game, progress);
  if (state.mode !== 'review' || state.review.id !== game.id) return;
  if (row) {
    labelReviewMove(row);
    renderReviewProgress(game);
    if (progress.rows.length === game.moves.length) renderAccuracy(summarize(game, progress.rows), inspectPly);
    if (row.ply === state.review.ply) renderReview();
    return;
  }
  renderReviewMoves(game.moves, inspectPly);
  progress.rows.forEach(labelReviewMove);
  if (progress.rows.length === game.moves.length) renderAccuracy(summarize(game, progress.rows), inspectPly);
  renderReview();
}

function requestReview(game) {
  if (reviewRequest?.gameId === game.id || reviewProgress(game.id).rows.length === game.moves.length) return;
  cancelReview();
  const controller = new AbortController();
  reviewRequest = { gameId: game.id, abort: () => controller.abort() };
  void runReview(game, controller.signal);
}

async function runReview(game, signal) {
  const engine = reviewEngine;
  const progress = { rows: [], error: '' };
  state.reviews.set(game.id, progress);
  updateReviewViews(game);
  try {
    const saved = await loadReview(game.id);
    signal.throwIfAborted();
    if (saved?.length === game.moves.length) {
      progress.rows = saved;
      return updateReviewViews(game);
    }

    const search = async (_fen, ply) => {
      const position = enginePosition(game.moves.slice(0, ply));
      const result = await engine.search(position, { time: 190, lines: 3, signal });
      signal.throwIfAborted();
      return result.lines;
    };
    await analyzeGame(game, search, row => {
      progress.rows.push(row);
      updateReviewViews(game, row);
    });
    const savedReview = { version: REVIEW_VERSION, rows: progress.rows };
    persist(db => writeLocal(db, 'reviews', game.id, savedReview));
  } catch (error) {
    if (signal.aborted) return;
    progress.error = error.message || 'Analysis could not finish. Try again.';
    updateReviewViews(game);
  } finally {
    if (!signal.aborted) reviewRequest = null;
  }
}

function chooseReview(id, ply = 1) {
  const games = reviewGames();
  const matched = state.games.get(id);
  const game = matched ?? games[0];
  const clampedPly = game ? Math.max(0, Math.min(game.moves.length, matched ? ply : 1)) : 1;
  state.review = { id: game?.id ?? null, ply: clampedPly, variation: null };
  setOptions('review-games', games, state.review.id, reviewLabel);
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
  renderReview();
}

function inspectPly(ply) {
  activateReviewTab('inspect', true);
  selectPly(ply);
}

function previewLine(line, game) {
  const initial = { fen: fenAt(game, state.review.ply - 1) };
  state.review.variation = { index: 1, steps: [initial, line, ...line.continuation], line };
  renderReview();
  byId('replay-ply').focus({ preventScroll: true });
  if (singleColumn.matches) byId('board-status').scrollIntoView({ block: 'start' });
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
    const label = `${moveLabel(row.ply, row.san)} · ${row.grade}`;
    return game ? label + ' · ' + gameDate.format(game.finishedAt) : label;
  });
  show('practice-content', Boolean(state.exercise));
  show('practice-empty', !state.exercise);
  resetPractice();
}

function resetPractice() {
  cancelPractice();
  state.attempt = null;
  moveError();
  show('practice-feedback', false);
  show('practice-hint-text', false);
  if (state.exercise) {
    const { row } = state.exercise;
    setText('practice-task-title', `Find a move for ${capitalize(row.color)}`);
    if (row.grade) byId('practice-task-grade').replaceChildren(gradeBadge(row.grade));
    show('practice-task-grade', Boolean(row.grade));
    setText('practice-task-text', row.lostAdvantage ? 'Find a way to keep the advantage from the original game.' :
      'Try a move and compare it with the reviewed lines.');
  } else {
    show('practice-task-grade', false);
  }
  renderBoard();
}

function hint() {
  const { row } = state.exercise;
  const best = ['Best move', 'Brilliant'].includes(row.grade);
  const candidate = best ? row : row.alternatives[0] ?? row;
  setText('practice-hint-text', `${candidate.san}. ${candidate.idea}`);
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
    const { lines } = await practiceEngine.search('fen ' + value, { time: 250, signal: request.signal });
    request.signal.throwIfAborted();
    const chance = 100 - winningChance(lines[0].score);
    const difference = Math.round(row.before - chance);
    const message = difference < 3 ? 'Stockfish found this close to the top reviewed move.' :
      `Stockfish estimated about ${difference} fewer winning-chance points than the top reviewed move.`;
    setText('practice-feedback', message);
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
  if (state.mode !== mode) state.flipped = false;
  state.mode = mode;
  moveError();
  renderNavigation(mode);
  openMode[mode](id, ply);
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
    difficultyPreviewing = false;
    applyBotSelection(DEFAULT_SETTINGS.difficulty, DEFAULT_SETTINGS.bot);
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

function bindControls() {
  bindDifficultyPicker(difficultyPickerChanged);
  const actions = {
    home: () => switchMode('play'),
    'settings-open': settingsDialog,
    'new-game': askNewGame,
    'flip-board': () => { state.flipped = !state.flipped; renderBoard(); },
    undo, resign: askResign,
    'bot-retry': requestBot,
    'review-open': openCurrentReview,
    'past-reviews': () => switchMode('review'),
    'review-retry': () => requestReview(state.games.get(state.review.id)),
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
  document.addEventListener('studio-dialog-closed', () => requestAnimationFrame(maybeShowGameOver));
  byId('review-games').addEventListener('change', event => chooseReview(event.target.value));
  byId('practice-positions').addEventListener('change', event => chooseExercise(event.target.value));
  byId('move-form').addEventListener('submit', event => {
    event.preventDefault();
    void enterMove(byId('move-input').value.trim().toLowerCase());
  });
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
  if (validGame(game)) state.game = game;
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
