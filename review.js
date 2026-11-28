import { fen, makeSquare, opposite, san } from './vendor/chessops.bundle.js';
import { detectCapture, standardUci } from './game-state.js';
import { botSearchConfig, fenAt, legalMove, positionAt, positionFromFen } from './studio-game.js';
import { analyzeOpening, loadOpenings } from './openings.js';
import {
  attackersTo, analyzeSacrifice, classifyEndgame, divideGamePhases, extractPositionalDeltas,
  extractTacticalMotifs, hangingPieces, legalMoveCount, motifBoardShapes,
  materialLead, pieceCount, seeMove, totalMaterialCount,
} from './chess-concepts.js';
import { buildInsightChips, buildPracticeHint, composeExplanation, describeCandidateIdea } from './explain.js';

export const REVIEW_VERSION = 4;
const ADVANTAGE = 60;
const MAIA_ELO_GRID = [700, 1000, 1300, 1600, 1900, 2200, 2500];

export const REVIEW_PRESETS = {
  quick: {
    key: 'quick',
    label: 'Quick',
    description: 'Fast two-pass scan (30k / 120k nodes)',
    pass1Nodes: 30_000,
    bookNodes: 10_000,
    pass2Nodes: 120_000,
    multiPv: 3,
    totalNodes: 4_000_000,
    timeLimit: 45_000,
  },
  standard: {
    key: 'standard',
    label: 'Standard',
    description: 'Balanced depth (60k / 250k nodes)',
    pass1Nodes: 60_000,
    bookNodes: 15_000,
    pass2Nodes: 250_000,
    multiPv: 3,
    totalNodes: 8_000_000,
    timeLimit: 75_000,
  },
  deep: {
    key: 'deep',
    label: 'Deep',
    description: 'High depth & 4 lines (120k / 500k nodes)',
    pass1Nodes: 120_000,
    bookNodes: 20_000,
    pass2Nodes: 500_000,
    multiPv: 4,
    totalNodes: 16_000_000,
    timeLimit: 120_000,
  },
};

export const PRESET_ORDER = ['quick', 'standard', 'deep'];

export const MOVE_GRADES = {
  Book: 'Book moves',
  Forced: 'Forced moves',
  Brilliant: 'Brilliant moves',
  Great: 'Great moves',
  'Best move': 'Best moves',
  Excellent: 'Excellent moves',
  Good: 'Good moves',
  Inaccuracy: 'Inaccuracies',
  Mistake: 'Mistakes',
  Miss: 'Misses',
  Blunder: 'Blunders',
};

export const CORE_GAME_OVER_GRADES = new Set([
  'Best move', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder',
]);

const ERROR_GRADES = new Set(['Inaccuracy', 'Mistake', 'Miss', 'Blunder']);

/**
 * Material-calibrated WDL polynomial from the pinned Stockfish.js browser build.
 * Used as fallback when a search line lacks explicit UCI_ShowWDL output (e.g. Practice or tests).
 */
export function stockfishWdlFromCp(cp, material = 58) {
  const m = Math.max(17, Math.min(78, material)) / 58;
  const a = (((-142.72052667 * m + 372.35176398) * m - 340.71073572) * m) + 415.23490212;
  const b = (((5.93832785 * m + 15.61267078) * m - 30.57816876) * m) + 69.63866711;
  // Stockfish scales cp = 100 * v / a => v = cp * a / 100
  const v = (Math.max(-4000, Math.min(4000, cp)) * a) / 100;
  const win = Math.round(1000 / (1 + Math.exp((a - v) / b)));
  const loss = Math.round(1000 / (1 + Math.exp((a + v) / b)));
  const draw = Math.max(0, 1000 - win - loss);
  return { win, draw, loss };
}

/**
 * Expected score in [0, 100] from side-to-move perspective.
 * Prefers Stockfish 19 native WDL; uses smooth mate-distance tiebreaker for forced mates.
 */
export function winningChance(score, wdl = null, material = 58) {
  if (!score) return 50;
  if (score.type === 'mate') {
    const dist = Math.min(25, Math.abs(score.value));
    if (score.value > 0) return Number((100 - 0.08 * Math.max(0, dist - 1)).toFixed(2));
    return Number((0.08 * Math.max(0, dist - 1)).toFixed(2));
  }
  const effectiveWdl = wdl ?? stockfishWdlFromCp(score.value, material);
  return Number(((effectiveWdl.win + 0.5 * effectiveWdl.draw) / 10).toFixed(2));
}

export function invertWdl(wdl) {
  if (!wdl) return null;
  return { win: wdl.loss, draw: wdl.draw, loss: wdl.win };
}

export function invertScore(score) {
  if (!score) return null;
  return { type: score.type, value: -score.value };
}

/**
 * Computes position sharpness in [0, 1]:
 * combines WDL double-edged decisiveness (high W & L, low D) and MultiPV top-gap narrowness.
 */
export function positionSharpness(wdl, lines = []) {
  let wdlSharp = 0;
  if (wdl) {
    const w = wdl.win / 1000;
    const d = wdl.draw / 1000;
    const l = wdl.loss / 1000;
    const nonDraw = 1 - d;
    const balance = (w + l) > 0.001 ? (4 * w * l) / ((w + l) * (w + l)) : 0;
    wdlSharp = nonDraw * balance;
  }
  let gapSharp = 0;
  if (lines.length >= 2) {
    const gap = Math.max(0, (lines[0].chance ?? 50) - (lines[1].chance ?? 50));
    gapSharp = Math.min(1, gap / 28);
  }
  return Number(Math.min(1, 0.55 * wdlSharp + 0.45 * gapSharp).toFixed(3));
}

/**
 * Lichess AccuracyPercent per-move exponential decay curve.
 */
export function moveAccuracyFromDrop(drop) {
  if (drop <= 0) return 100;
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/**
 * Formats an engine score from White's POV (+ favors White, - favors Black).
 */
export function formatWhiteScore(whiteScore) {
  if (!whiteScore) return '0.0';
  if (whiteScore.type === 'mate') {
    const sign = whiteScore.value > 0 ? '+' : '-';
    return `${sign}M${Math.abs(whiteScore.value)}`;
  }
  const pawns = whiteScore.value / 100;
  if (Math.abs(pawns) < 0.05) return '0.0';
  return (pawns > 0 ? '+' : '') + pawns.toFixed(1);
}

export function toWhiteScore(score, turn) {
  if (!score) return { type: 'cp', value: 0 };
  return turn === 'white' ? score : invertScore(score);
}

export function toWhiteChance(chance, turn) {
  return turn === 'white' ? chance : Number((100 - chance).toFixed(2));
}

function clampCp(score) {
  if (!score) return 0;
  if (score.type === 'mate') return score.value > 0 ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, score.value));
}

function describeMove(position, uci, pvRest = [], phase = 'middlegame', ply = 1) {
  const move = legalMove(position, uci);
  if (!move) return null;
  const next = position.clone();
  const moveSan = san.makeSan(position, move);
  const capture = detectCapture(position, move);
  next.play(move);
  const motifs = extractTacticalMotifs(position, move, pvRest, { ply });
  const deltas = extractPositionalDeltas(position, move, next, phase);
  const idea = describeCandidateIdea(moveSan, motifs, deltas, {
    isCheck: next.isCheck(),
    captureRole: capture?.role ?? null,
  });
  return {
    uci: standardUci(position, move),
    san: moveSan,
    fen: fen.makeFen(next.toSetup()),
    idea,
    motifs,
    deltas,
    move,
    next,
  };
}

function continuation(position, moves) {
  const steps = [];
  for (const uci of moves.slice(0, 7)) {
    const move = legalMove(position, uci);
    if (!move) break;
    const next = position.clone();
    const moveSan = san.makeSan(position, move);
    next.play(move);
    steps.push({ uci: standardUci(position, move), san: moveSan, fen: fen.makeFen(next.toSetup()) });
    position = next;
  }
  return steps;
}

function describeLine(position, line, phase, ply, material) {
  if (!line?.pv?.length) return null;
  const first = describeMove(position, line.pv[0], line.pv.slice(1), phase, ply);
  if (!first) return null;
  const wdl = line.wdl ?? (line.score.type === 'cp' ? stockfishWdlFromCp(line.score.value, material) : null);
  const chance = winningChance(line.score, wdl, material);
  return {
    uci: first.uci,
    san: first.san,
    fen: first.fen,
    idea: first.idea,
    chance,
    score: line.score,
    whiteScore: toWhiteScore(line.score, position.turn),
    wdl,
    depth: line.depth ?? 0,
    pv: line.pv,
    continuation: continuation(first.next, line.pv.slice(1)),
    _motifs: first.motifs,
    _deltas: first.deltas,
    _move: first.move,
    _next: first.next,
  };
}

function stripCandidateInternals(line) {
  return {
    uci: line.uci,
    san: line.san,
    fen: line.fen,
    idea: line.idea,
    chance: line.chance,
    score: line.score,
    whiteScore: line.whiteScore,
    wdl: line.wdl,
    continuation: line.continuation,
  };
}

export function terminalChance(game, ply) {
  if (ply !== game.moves.length) return null;
  const { outcome } = game;
  if (!outcome || outcome.reason === 'Resignation' || outcome.claimed) return null;
  if (!outcome.winner) return 50;
  return outcome.winner === positionAt(game, ply - 1).turn ? 100 : 0;
}

function inferBotElo(game) {
  const cfg = botSearchConfig(game.difficulty, game.bot);
  if (cfg.maiaRating !== undefined) return cfg.maiaRating;
  if (cfg.elo !== null && cfg.elo !== undefined) return Math.max(600, Math.min(2600, cfg.elo));
  return 2200;
}

function moveQualityFromDrop(drop, { before, after, prevOpponentError, missedMate }) {
  if (missedMate && drop >= 10) return after >= 35 ? 'Miss' : 'Blunder';
  if (drop <= 0.5) return 'Best move';
  if (drop <= 2.2) return 'Excellent';
  if (drop <= 5.5) return 'Good';
  if (drop <= 10.5) return 'Inaccuracy';
  // Miss: opponent just blundered/erred, handed us winning edge (>= 68%), we dropped >= 15% yet stayed >= 35%
  if (prevOpponentError && before >= 68 && drop >= 15 && after >= 35) return 'Miss';
  if (drop <= 20) return 'Mistake';
  return 'Blunder';
}

export function classifyMoveV3({
  isBook, isForced, drop, before, after, best, runnerUp, playedUci,
  sacrifice, emergedAtDepth = 1, maia = null, prevOpponentError = false, missedMate = null,
}) {
  if (isBook && drop <= 5.5) return 'Book';
  if (isForced) return 'Forced';

  const isTopChoice = best?.uci === playedUci;
  const gapToSecond = best && runnerUp ? Math.max(0, best.chance - runnerUp.chance) : 0;
  const maiaProb = maia?.bestProb ?? null;
  const obviousHuman = maiaProb !== null && maiaProb >= 0.45;
  const nonObvious = maiaProb !== null ? maiaProb < 0.25 : (gapToSecond >= 8 || emergedAtDepth >= 9);

  // Brilliant: top move + sound sacrifice (accepted, declined, or counter) + not already trivially winning + viable outcome + non-obvious
  if (isTopChoice && sacrifice && after >= 45 && (before < 88 || best?.score?.type === 'mate') &&
      (gapToSecond >= 7 || best?.score?.type === 'mate') && nonObvious) {
    return 'Brilliant';
  }

  // Great: the only good move in a critical spot (huge gap to #2, not a trivial human recapture)
  if (isTopChoice && gapToSecond >= 15 && after >= 40 && before < 92 && !obviousHuman) {
    return 'Great';
  }

  if (best && best.uci === playedUci && drop <= 1.0) return 'Best move';
  return moveQualityFromDrop(drop, { before, after, prevOpponentError, missedMate });
}

function buildEnginePosition(game, ply) {
  return ply ? 'startpos moves ' + game.moves.slice(0, ply).map(m => m.uci).join(' ') : 'startpos';
}

function maiaInputAt(game, ply, selfElo, oppoElo) {
  const start = Math.max(0, ply - 7);
  const priorFens = Array.from({ length: ply - start }, (_, index) => fenAt(game, start + index));
  return { fen: fenAt(game, ply), priorFens, selfElo, oppoElo };
}

function policyEntropy(movesObj) {
  if (!movesObj) return null;
  let h = 0;
  for (const p of Object.values(movesObj)) {
    if (p > 1e-6) h -= p * Math.log2(p);
  }
  return Number(h.toFixed(2));
}

/**
 * Estimates human play level via Maia-3 Maximum Likelihood over non-book, non-forced plies,
 * with a gentle prior anchored to the game's bot level and a likelihood-ratio confidence interval.
 */
async function estimateMaiaPlayLevel(game, bookPlies, forcedPlies, maiaEngine, signal) {
  const botElo = inferBotElo(game);
  const priorMean = Math.max(800, Math.min(2200, botElo));
  const priorSigma = 550;

  const eligiblePlies = [];
  for (let ply = 1; ply <= game.moves.length; ply++) {
    const pos = positionAt(game, ply - 1);
    if (pos.turn !== game.human) continue;
    if (bookPlies.has(ply) || forcedPlies.has(ply)) continue;
    eligiblePlies.push(ply);
  }

  if (eligiblePlies.length < 4) {
    return {
      estimate: Math.round(priorMean / 50) * 50,
      low: Math.max(600, Math.round((priorMean - 300) / 50) * 50),
      high: Math.min(2600, Math.round((priorMean + 300) / 50) * 50),
      sampleCount: eligiblePlies.length,
      lowConfidence: true,
    };
  }

  // Uniformly sample up to 16 plies to keep ONNX sweep fast (~2-3s).
  const maxSamples = 16;
  const sampled = [];
  if (eligiblePlies.length <= maxSamples) {
    sampled.push(...eligiblePlies);
  } else {
    for (let i = 0; i < maxSamples; i++) {
      const idx = Math.floor((i * (eligiblePlies.length - 1)) / (maxSamples - 1));
      sampled.push(eligiblePlies[idx]);
    }
  }

  // Batch all (ply x ratingTier) pairs into one sequential worker call.
  const batchItems = [];
  for (const ply of sampled) {
    for (const elo of MAIA_ELO_GRID) {
      batchItems.push(maiaInputAt(game, ply - 1, elo, botElo));
    }
  }
  const results = await maiaEngine.analyzeBatch(batchItems, signal);
  signal?.throwIfAborted();

  const logLik = new Array(MAIA_ELO_GRID.length).fill(0);
  for (let i = 0; i < sampled.length; i++) {
    const playedUci = game.moves[sampled[i] - 1].uci;
    for (let r = 0; r < MAIA_ELO_GRID.length; r++) {
      const pred = results[i * MAIA_ELO_GRID.length + r];
      const prob = pred?.moves?.[playedUci] ?? 0.002;
      logLik[r] += Math.log(Math.max(0.002, prob));
    }
  }

  // Add gentle prior to prevent extreme edge-collapsing on short games.
  const posterior = MAIA_ELO_GRID.map((elo, idx) => {
    const z = (elo - priorMean) / priorSigma;
    return logLik[idx] - 0.5 * z * z;
  });

  const maxLog = Math.max(...posterior);
  const weights = posterior.map(v => Math.exp(v - maxLog));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const probs = weights.map(w => w / sumW);

  const mean = MAIA_ELO_GRID.reduce((acc, elo, idx) => acc + elo * probs[idx], 0);
  const variance = MAIA_ELO_GRID.reduce((acc, elo, idx) => acc + probs[idx] * (elo - mean) * (elo - mean), 0);
  const sd = Math.max(120, Math.sqrt(variance));

  const estimate = Math.max(600, Math.min(2600, Math.round(mean / 25) * 25));
  const low = Math.max(600, Math.round((mean - 1.5 * sd) / 50) * 50);
  const high = Math.min(2600, Math.round((mean + 1.5 * sd) / 50) * 50);

  return {
    estimate,
    low,
    high,
    sampleCount: sampled.length,
    lowConfidence: sampled.length < 10,
  };
}

function maiaMoveInsights(prediction, { playedUci, preferredUci, before, compared, position, reply, refElo }) {
  const policy = prediction.moves ?? {};
  const practicalChance = Number((prediction.winProbability * 100).toFixed(1));
  const mass = value => Number(Math.max(0, Math.min(1, value)).toFixed(3));
  const known = new Map(compared.map(line => [line.uci, line.chance]));
  let evaluatedMass = 0;
  let safeMass = 0;
  for (const [uci, chance] of known) {
    if (!Number.isFinite(chance)) continue;
    const probability = policy[uci] ?? 0;
    evaluatedMass += probability;
    if (before !== null && before - chance < 10) safeMass += probability;
  }
  const risk = evaluatedMass > 0 && before !== null ? {
    low: mass(evaluatedMass - safeMass), high: mass(1 - safeMass), coverage: mass(evaluatedMass),
  } : null;
  const [replyUci, replyProbability] = Object.entries(reply?.moves ?? {}).sort((a, b) => b[1] - a[1])[0] ?? [];
  const replyMove = replyUci && legalMove(position, replyUci);
  return {
    referenceElo: refElo,
    playedProb: mass(policy[playedUci] ?? 0),
    bestProb: preferredUci ? mass(policy[preferredUci] ?? 0) : null,
    entropy: policyEntropy(policy),
    practicalChance,
    practicalGap: before === null ? null : Number((practicalChance - before).toFixed(1)),
    risk,
    safeMass: mass(safeMass),
    wdl: prediction.wdl,
    policy,
    likelyReply: replyMove ? { san: san.makeSan(position, replyMove), probability: replyProbability } : null,
  };
}

/**
 * Assesses a single ply from collected Stockfish, Null-Move, NNUE, Opening, and Maia data.
 */
export function buildMoveRow({
  game, ply, phase, openingInfo, isBook: bookKnown = false, isForced,
  beforeSearch, afterSearch, comparedSearch, nnueSummary = null, deepened = false,
  prevRow, prevCaptureSq, maiaData, maiaReply, refElo,
}) {
  const position = positionAt(game, ply - 1);
  const moveEntry = game.moves[ply - 1];
  const color = position.turn;
  const matBefore = totalMaterialCount(position);

  const afterLines = afterSearch?.lines ?? [];
  const pairedLines = comparedSearch?.iterations?.[0];
  const beforeLines = pairedLines ?? beforeSearch?.lines ?? [];
  const candidates = beforeLines.map(line => describeLine(position, line, phase, ply, matBefore)).filter(Boolean);
  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;
  const matchingCandidate = candidates.find(c => c.uci === moveEntry.uci) ?? null;
  const playedPvAfter = matchingCandidate?.pv.slice(1) ?? afterLines[0]?.pv ?? [];
  const playedDesc = describeMove(position, moveEntry.uci, playedPvAfter, phase, ply);
  const afterPos = playedDesc.next;
  const term = terminalChance(game, ply);
  const afterLine = afterLines[0];
  const matAfter = totalMaterialCount(afterPos);
  const afterScoreMover = term !== null
    ? { type: term === 50 ? 'cp' : 'mate', value: term === 50 ? 0 : term === 100 ? 1 : -1 }
    : matchingCandidate?.score ?? invertScore(afterLine?.score);
  const afterWdlMover = term !== null
    ? { win: term === 100 ? 1000 : 0, draw: term === 50 ? 1000 : 0, loss: term === 0 ? 1000 : 0 }
    : matchingCandidate?.wdl ?? invertWdl(afterLine?.wdl ??
      (afterLine?.score.type === 'cp' ? stockfishWdlFromCp(afterLine.score.value, matAfter) : null));
  const afterChance = term ?? matchingCandidate?.chance ??
    (afterLine ? 100 - winningChance(afterLine.score, afterLine.wdl, matAfter) : null);
  const alternatives = candidates.filter(c => c.uci !== playedDesc.uci);
  const exactWin = term === 100 && afterPos.isCheckmate();
  const reference = (!exactWin ? best : null) ?? {
    uci: playedDesc.uci, san: playedDesc.san, chance: afterChance,
    score: afterScoreMover, wdl: afterWdlMover, pv: [playedDesc.uci], _motifs: playedDesc.motifs, _deltas: playedDesc.deltas,
  };
  const beforeChance = reference.chance;
  const provisional = !isForced && !exactWin && (
    pairedLines ? !stableComparison(comparedSearch, playedDesc.uci, matBefore)
      : !matchingCandidate || !stableComparison(beforeSearch, playedDesc.uci, matBefore)
  );
  const drop = isForced || beforeChance === null || afterChance === null
    ? 0 : Math.max(0, Number((beforeChance - afterChance).toFixed(2)));
  const isBook = bookKnown && !provisional && !exactWin && drop <= 5.5;
  const accuracy = isBook || isForced ? 100 : moveAccuracyFromDrop(drop);

  // Centipawn loss (clamped +-1000 for ACPL)
  const cpBefore = clampCp(reference.score);
  const cpAfter = clampCp(afterScoreMover);
  const cpLoss = isBook || isForced ? 0 : Math.max(0, cpBefore - cpAfter);

  // Missed forced mate check
  const missedMate = reference.score?.type === 'mate' && reference.score.value > 0 &&
    !(afterScoreMover?.type === 'mate' && afterScoreMover.value > 0)
    ? reference.score.value : null;

  // Evaluate the sacrifice on the played line.
  const sacrifice = analyzeSacrifice(
    position,
    playedDesc.move,
    playedPvAfter,
  );

  const maia = maiaData ? maiaMoveInsights(maiaData, {
    playedUci: playedDesc.uci, preferredUci: reference.uci, before: beforeChance,
    compared: candidates, position: afterPos, reply: maiaReply, refElo,
  }) : null;

  const prevOpponentError = prevRow && prevRow.color !== color &&
    ['Mistake', 'Blunder'].includes(prevRow.grade);

  const grade = exactWin && !isForced ? 'Best move' : classifyMoveV3({
    isBook,
    isForced,
    drop,
    before: beforeChance,
    after: afterChance,
    best: reference,
    runnerUp: reference === best ? runnerUp : alternatives[1],
    playedUci: playedDesc.uci,
    sacrifice,
    emergedAtDepth: beforeSearch?.emergedAtDepth ?? 1,
    maia,
    prevOpponentError,
    missedMate,
  });

  const isError = !provisional && ERROR_GRADES.has(grade);
  const onlyDefense = !provisional && grade === 'Great' && beforeChance <= 58 && runnerUp && runnerUp.chance <= 32;

  // --- Symbolic Motifs & Counterfactual Threats ---
  const playedMotifs = extractTacticalMotifs(position, playedDesc.move, playedPvAfter, { ply, prevCaptureSq });
  const playedPositional = extractPositionalDeltas(position, playedDesc.move, afterPos, phase);

  // Refutation line analysis (what the opponent does in response to an error!)
  let refutationSan = null;
  let refutationUci = null;
  let refutationMotifs = [];
  if (playedPvAfter.length && term === null) {
    const refMove = legalMove(afterPos, playedPvAfter[0]);
    if (refMove) {
      refutationSan = san.makeSan(afterPos, refMove);
      refutationUci = standardUci(afterPos, refMove);
      if (isError) {
        refutationMotifs = extractTacticalMotifs(afterPos, refMove, playedPvAfter.slice(1), { ply: ply + 1 });
      }
    }
  }

  const hangingAfterPlayed = isError ? hangingPieces(afterPos, color) : [];

  const displayThreat = isError && refutationUci
    ? { uci: refutationUci, san: refutationSan, from: refutationUci.slice(0, 2), to: refutationUci.slice(2, 4), kind: 'refutation' }
    : null;
  const comparison = pairedLines && matchingCandidate && best ? {
    played: replayCandidate(position, matchingCandidate, matchingCandidate === best ? runnerUp : best),
    recommended: replayCandidate(position, best, matchingCandidate === best ? runnerUp : matchingCandidate),
    alternative: matchingCandidate === best && runnerUp ? replayCandidate(position, runnerUp, best) : null,
  } : null;
  const endgame = phase === 'endgame' ? classifyEndgame(afterPos) : null;
  const theoryExit = openingInfo?.theoryExit?.ply === ply ? openingInfo.theoryExit : null;

  const facts = {
    san: playedDesc.san,
    grade,
    isError,
    opening: openingInfo?.opening ?? null,
    theoryExit,
    endgame,
    preferredSan: reference.san,
    refutationSan,
    drop,
    before: beforeChance,
    after: afterChance,
    playedMotifs,
    refutationMotifs,
    bestMotifs: reference._motifs ?? [],
    playedPositional,
    bestPositional: reference._deltas ?? [],
    positionalDeltas: playedPositional,
    hangingAfterPlayed,
    missedMate,
    maia,
    sacrifice,
    onlyDefense,
  };

  const hasConcreteFacts = Boolean(
    missedMate ||
    refutationMotifs.length ||
    hangingAfterPlayed.length ||
    (reference._motifs?.length && isError) ||
    playedPositional.some(d => !d.positive),
  );
  const explanationText = provisional ? 'The available search does not settle this grade.'
    : comparison && playedDesc.uci !== reference.uci && !hasConcreteFacts ? explainComparison(comparison)
      : composeExplanation(facts);
  const chips = provisional ? [] : buildInsightChips(facts);
  const motifShapes = motifBoardShapes(isError ? (refutationMotifs.length ? refutationMotifs : reference._motifs) : playedMotifs);
  const sharpness = positionSharpness(reference.wdl, candidates);

  return {
    ply,
    color,
    phase,
    san: playedDesc.san,
    uci: playedDesc.uci,
    idea: playedDesc.idea,
    explanation: explanationText,
    chips,
    grade,
    accuracy,
    drop,
    cpLoss,
    preferred: reference.san,
    preferredUci: reference.uci,
    before: beforeChance,
    after: afterChance,
    whiteChance: afterChance === null ? null : toWhiteChance(afterChance, color),
    whiteScore: afterScoreMover ? toWhiteScore(afterScoreMover, color) : null,
    wdl: afterWdlMover,
    sharpness,
    depth: pairedLines?.[0]?.depth ?? beforeSearch?.depth ?? 0,
    provisional,
    deepened,
    comparison,
    lesson: displayThreat?.uci ?? comparison?.recommended.target ?? null,
    lostAdvantage: beforeChance >= ADVANTAGE && afterChance <= 55 && !isBook && !isForced,
    isBook,
    bookKnown,
    isForced,
    missedMate,
    threat: displayThreat,
    motifShapes: provisional ? [] : motifShapes,
    endgameType: endgame?.type ?? null,
    theoryExit: theoryExit ? { bookAlternatives: theoryExit.bookAlternatives.map(b => b.san) } : null,
    maia,
    nnueSummary,
    alternatives: alternatives.map(stripCandidateInternals),
  };
}

function stableComparison(search, playedUci, material) {
  const [latest, previous] = search?.iterations ?? [];
  if (!latest?.length || !previous?.length) return false;
  const gap = lines => {
    const played = lines.find(line => line.pv[0] === playedUci);
    if (!played) return null;
    const chance = line => winningChance(line.score, line.wdl, material);
    return Math.max(0, chance(lines[0]) - chance(played));
  };
  const now = gap(latest);
  const then = gap(previous);
  if (now === null || then === null) return false;
  const sameLeader = latest[0].pv[0] === previous[0].pv[0];
  return Math.abs(now - then) <= 4 && (sameLeader || (now <= 2 && then <= 2)) &&
    latest[0].score.type === previous[0].score.type;
}

function newTarget(position, candidate, alternative) {
  if (!alternative) return null;
  const { _move: move, _next: next } = candidate;
  const alternativesBoard = alternative._next.board;
  const enemy = opposite(position.turn);
  for (const [square, piece] of next.board) {
    if (piece.color !== enemy || piece.role === 'king') continue;
    if (attackersTo(next.board, square).has(move.to) &&
        !attackersTo(position.board, square).has(move.from) &&
        !attackersTo(alternativesBoard, square).has(alternative._move.to)) {
      return { role: piece.role, square: makeSquare(square) };
    }
  }
  return null;
}

function explainComparison({ played, recommended }) {
  if (recommended.chance - played.chance <= 2) return 'Stockfish scores these moves similarly at this depth.';
  const reply = played.continuation[0];
  if (reply && reply.uci === recommended.continuation[0]?.uci) {
    return `Stockfish favors ${recommended.san} when both lines begin with the reply ${reply.san}.`;
  }
  return `Stockfish favors ${recommended.san} in the compared lines.`;
}

function replayCandidate(position, candidate, alternative) {
  const line = stripCandidateInternals(candidate);
  const startLead = materialLead(position, position.turn);
  const steps = [line, ...line.continuation];
  const end = positionFromFen(steps.at(-1).fen);
  if (end.isCheckmate()) {
    return { ...line, evidenceIndex: steps.length, evidence: `The line ends in checkmate with ${steps.at(-1).san}.` };
  }
  const endLead = materialLead(end, position.turn);
  const change = endLead - startLead;
  if (Math.abs(change) >= 2) {
    const index = steps.findLastIndex(step =>
      materialLead(positionFromFen(step.fen), position.turn) !== endLead);
    const evidenceIndex = Math.min(steps.length, index + 2);
    const gainer = change > 0 ? position.turn : opposite(position.turn);
    const sideLabel = gainer === 'white' ? 'White' : 'Black';
    return {
      ...line, evidenceIndex,
      evidence: `After ${steps[evidenceIndex - 1].san}, ${sideLabel} is up ${Math.abs(change)} in material relative to this position.`,
    };
  }
  const target = newTarget(position, candidate, alternative);
  if (target) {
    return { ...line, evidenceIndex: 1, target: target.square,
      evidence: `${line.san} attacks the ${target.role} on ${target.square}.` };
  }
  return { ...line, evidenceIndex: Math.min(steps.length, 2), evidence: null };
}

function budgetSignal(parent, deadline) {
  const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function searchWithin(engine, position, options, deadline, signal) {
  signal?.throwIfAborted();
  if (Date.now() >= deadline) return null;
  const limit = budgetSignal(signal, deadline);
  try {
    const result = await engine.search(position, { ...options, showWdl: true, signal: limit });
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    if (!limit.aborted) throw error;
    return null;
  }
}

async function compareRoot(game, ply, engine, nodes, deadline, signal, policy, multiPv) {
  const position = positionAt(game, ply - 1);
  const played = game.moves[ply - 1].uci;
  const legalCount = legalMoveCount(position);
  if (legalCount === 1) {
    const search = await searchWithin(engine, buildEnginePosition(game, ply - 1), {
      nodes, lines: 1, fresh: true,
    }, deadline, signal);
    return search?.lines.length ? { ...search, iterations: [search.lines] } : null;
  }

  const setup = buildEnginePosition(game, ply - 1);
  const scoutNodes = Math.floor(nodes / 3);
  const scout = await searchWithin(engine, setup, {
    nodes: scoutNodes, lines: Math.min(legalCount, multiPv), fresh: true,
  }, deadline, signal);
  if (!scout?.lines.length) return null;
  const likely = Object.entries(policy ?? {}).sort((a, b) => b[1] - a[1])
    .find(([uci]) => legalMove(position, uci))?.[0];
  const shortlist = [...new Set([played, ...scout.lines.map(line => line.pv[0]), likely].filter(Boolean))];
  const compared = await searchWithin(engine, setup, {
    nodes: nodes - scoutNodes, lines: shortlist.length, searchmoves: shortlist, fresh: true,
  }, deadline, signal);
  if (compared?.iterations?.length) return compared;
  return scout.lines.some(line => line.pv[0] === played)
    ? { ...scout, iterations: [scout.lines] } : null;
}

export async function compareGameMove(game, { ply, engine, preset, row, previousRow, signal, readMaia = () => row?.maia }) {
  const cfg = REVIEW_PRESETS[preset] ?? REVIEW_PRESETS.quick;
  const deadline = Date.now() + 12_000;
  const search = await compareRoot(game, ply, engine, cfg.pass2Nodes * 2, deadline, signal, row?.maia?.policy, cfg.multiPv);
  signal?.throwIfAborted();
  if (!search) return row ? { ...row, deepened: true } : null;
  const position = positionAt(game, ply - 1);
  const human = readMaia();
  const compared = buildMoveRow({
    game, ply, phase: row?.phase ?? divideGamePhases(game).phaseAt(ply),
    isBook: row?.bookKnown ?? Boolean(row?.isBook), isForced: legalMoveCount(position) === 1,
    beforeSearch: search, comparedSearch: search, prevRow: previousRow, deepened: true,
    nnueSummary: row?.nnueSummary, refElo: human?.referenceElo,
    maiaData: human?.policy ? {
      moves: human.policy, winProbability: human.practicalChance / 100, wdl: human.wdl,
    } : null,
  });
  if (compared.maia && human.likelyReply) compared.maia.likelyReply = human.likelyReply;
  return compared;
}

export function keyReviewRows(rows, color) {
  const rated = rows.filter(row => row.comparison && !row.isBook && !row.isForced)
    .filter(row => row.drop >= 4 || row.grade === 'Great' || row.grade === 'Brilliant' ||
      row.comparison.played.evidence || row.comparison.recommended.evidence);
  return selectSeparatedRows(rated, color);
}

function selectSeparatedRows(rows, color) {
  const priority = row => row.drop * 2 + (row.color === color ? 9 : 0) +
    (row.grade === 'Brilliant' || row.grade === 'Great' ? 22 : 0) + (row.sharpness ?? 0) * 16;
  const selected = [];
  for (const row of [...rows].sort((a, b) => priority(b) - priority(a))) {
    if (row.lesson && selected.some(other => other.lesson === row.lesson && Math.abs(other.ply - row.ply) <= 2)) continue;
    selected.push(row);
    if (selected.length === 5) break;
  }
  return selected.sort((a, b) => a.ply - b.ply);
}

function reviewContext(game, db) {
  const openingInfo = analyzeOpening(game, db);
  const phases = divideGamePhases(game);
  const forcedPlies = new Set();
  const captureSquares = [];
  for (let ply = 1; ply <= game.moves.length; ply++) {
    const position = positionAt(game, ply - 1);
    if (legalMoveCount(position) === 1) forcedPlies.add(ply);
    const move = legalMove(position, game.moves[ply - 1].uci);
    if (move && detectCapture(position, move)) captureSquares[ply] = move.to;
  }
  return { openingInfo, phases, forcedPlies, captureSquares, botElo: inferBotElo(game) };
}

function moveRows(game, checkpoint, context, human) {
  const { openingInfo, phases, forcedPlies, captureSquares, botElo } = context;
  const rows = [];
  for (let ply = 1; ply <= game.moves.length; ply++) {
    const turn = positionAt(game, ply - 1).turn;
    rows.push(buildMoveRow({
      game, ply, phase: phases.phaseAt(ply), openingInfo,
      isBook: openingInfo.bookPlies.has(ply), isForced: forcedPlies.has(ply),
      beforeSearch: checkpoint.scans[ply - 1],
      afterSearch: checkpoint.scans[ply],
      comparedSearch: checkpoint.comparisons[ply]?.search, nnueSummary: checkpoint.comparisons[ply]?.nnue,
      prevRow: rows.at(-1), prevCaptureSq: captureSquares[ply - 1] ?? null,
      maiaData: human?.predictions[ply], maiaReply: human?.predictions[ply + 1],
      refElo: turn === game.human ? human?.estimate.estimate : botElo,
    }));
  }
  return rows;
}

async function scanGame(game, engine, cfg, checkpoint, context, deadline, signal, publish) {
  if (checkpoint.scanFinished) return;
  const total = game.moves.length;
  const pending = Array.from({ length: total + 1 }, (_, i) => total - i)
    .filter(ply => !checkpoint.scans[ply]);
  const scanLimit = Math.floor(cfg.totalNodes * 0.67);
  for (const [index, ply] of pending.entries()) {
    signal?.throwIfAborted();
    if (ply > 0 && terminalChance(game, ply) !== null) {
      checkpoint.scans[ply] = { lines: [] };
    } else {
      const earlyBook = context.openingInfo.bookPlies.has(ply) && ply < context.openingInfo.lastBookPly;
      const remaining = scanLimit - checkpoint.nodesUsed;
      const nodes = Math.min(earlyBook ? cfg.bookNodes : cfg.pass1Nodes, Math.floor(remaining / (pending.length - index)));
      if (nodes < 1) break;
      const result = await searchWithin(engine, buildEnginePosition(game, ply), {
        nodes, lines: 1, hash: 48, fresh: index === 0,
      }, deadline, signal);
      checkpoint.nodesUsed += nodes;
      if (!result) break;
      checkpoint.scans[ply] = result;
    }
    publish({ stage: 'pass1', done: total + 2 - pending.length + index, total: total + 1, label: 'Scanning game…' });
  }
  checkpoint.scanFinished = true;
  publish();
}

async function analyzeHuman(game, context, engine, signal) {
  const limited = budgetSignal(signal, Date.now() + 55_000);
  const { openingInfo, forcedPlies, botElo } = context;
  try {
    const estimate = await estimateMaiaPlayLevel(game, openingInfo.bookPlies, forcedPlies, engine, limited);
    const count = game.moves.length + Number(!positionAt(game, game.moves.length).isEnd());
    const items = Array.from({ length: count }, (_, index) => (
      positionAt(game, index).turn === game.human
        ? maiaInputAt(game, index, estimate.estimate, botElo)
        : maiaInputAt(game, index, botElo, estimate.estimate)
    ));
    const results = await engine.analyzeBatch(items, limited);
    const finalPred = results[game.moves.length];
    const finalChance = finalPred
      ? toWhiteChance(Number((finalPred.winProbability * 100).toFixed(1)), positionAt(game, game.moves.length).turn)
      : null;
    return { estimate, predictions: [null, ...results], finalChance };
  } catch (error) {
    return { error: signal?.aborted ? null : error.message };
  }
}

export async function analyzeReviewHuman(game, engine, signal, openingsDb = null) {
  const context = reviewContext(game, openingsDb ?? await loadOpenings());
  return analyzeHuman(game, context, engine, signal);
}

function mergeMaiaChip(existingChips, grade, provisional, maia) {
  const base = (existingChips ?? []).filter(c =>
    !['Common human trap', 'Hard to spot', 'Practical edge', 'Hard to play'].includes(c.label));
  if (provisional || !maia || base.length >= 4) return base;
  const isError = ERROR_GRADES.has(grade);
  if (isError && maia.playedProb >= 0.22) {
    return [...base, { label: 'Common human trap', tone: 'warn' }];
  }
  if (['Brilliant', 'Great', 'Best move'].includes(grade) && maia.bestProb !== null && maia.bestProb <= 0.12) {
    return [...base, { label: 'Hard to spot', tone: 'accent' }];
  }
  if (Math.abs(maia.practicalGap ?? 0) >= 12) {
    return [...base, { label: maia.practicalGap > 0 ? 'Practical edge' : 'Hard to play', tone: 'info' }];
  }
  return base;
}

export function applyReviewHuman(rows, game, human) {
  if (!human?.estimate) return rows;
  const botElo = inferBotElo(game);
  return rows.map(row => {
    const prediction = human.predictions[row.ply];
    if (!prediction) return row;
    const compared = [...(row.alternatives ?? [])];
    if (row.comparison?.played || (!row.provisional && row.preferredUci === row.uci)) {
      compared.push({ uci: row.uci, chance: row.after });
    }
    const maia = maiaMoveInsights(prediction, {
      playedUci: row.uci, preferredUci: row.preferredUci, before: row.before,
      compared, position: positionAt(game, row.ply), reply: human.predictions[row.ply + 1],
      refElo: row.color === game.human ? human.estimate.estimate : botElo,
    });
    const chips = mergeMaiaChip(row.chips, row.grade, row.provisional, maia);
    return { ...row, maia, chips };
  });
}

function reviewMeta(cfg, context, checkpoint, human) {
  const { openingInfo, phases } = context;
  const first = checkpoint.scans[0]?.lines?.[0];
  const theoryExit = openingInfo.theoryExit;
  return {
    preset: cfg.key,
    initialChance: first ? winningChance(first.score, first.wdl, 78) : null,
    opening: openingInfo.opening,
    lastBookPly: openingInfo.lastBookPly,
    theoryExit: theoryExit ? { ...theoryExit, bookAlternatives: theoryExit.bookAlternatives.map(move => move.san) } : null,
    phases: { middlePly: phases.middlePly, endPly: phases.endPly },
    maia: human?.estimate
      ? { ...human.estimate, enabled: true, finalChance: human.finalChance ?? null }
      : { enabled: false, error: human?.error },
  };
}

function chooseReviewDecisions(game, rows, scans) {
  const candidates = rows.filter(row => {
    if (row.isBook || row.isForced || !scans[row.ply - 1]?.lines.length) return false;
    if (row.drop >= 3.5 || row.sharpness >= 0.38 || row.missedMate !== null || (row.color === game.human && row.provisional)) return true;
    const position = positionAt(game, row.ply - 1);
    return pieceCount(position) <= 7 || seeMove(position, legalMove(position, row.uci)) <= -180;
  });
  return selectSeparatedRows(candidates, game.human).map(row => row.ply);
}

export async function analyzeGame(game, {
  pool, preset = 'quick', maiaEngine = null, enableMaia = false, openingsDb = null,
  signal, checkpoint: saved,
}, { onProgress, onPassComplete, onRowUpdate, onCheckpoint } = {}) {
  const cfg = REVIEW_PRESETS[preset] ?? REVIEW_PRESETS.quick;
  const deadline = Date.now() + cfg.timeLimit;
  const context = reviewContext(game, openingsDb ?? await loadOpenings());
  signal?.throwIfAborted();
  const checkpoint = saved?.version === REVIEW_VERSION && saved.preset === cfg.key ? saved : {
    version: REVIEW_VERSION, preset: cfg.key, scans: [], comparisons: {}, scanFinished: false, nodesUsed: 0,
  };
  const publish = progress => {
    onCheckpoint?.(checkpoint);
    if (progress) onProgress?.(progress);
  };
  await scanGame(game, pool.primary, cfg, checkpoint, context, deadline, signal, publish);

  let human = null;
  let rows = moveRows(game, checkpoint, context, human);
  const meta = () => reviewMeta(cfg, context, checkpoint, human);
  onPassComplete?.({ stage: 'pass1', rows, meta: meta() });
  const humanTask = enableMaia && maiaEngine && game.moves.length
    ? analyzeHuman(game, context, maiaEngine, signal).then(result => { human = result; })
    : null;

  checkpoint.selectedPlies ??= chooseReviewDecisions(game, rows, checkpoint.scans);
  const selected = checkpoint.selectedPlies;
  for (const [index, ply] of selected.entries()) {
    if (Object.hasOwn(checkpoint.comparisons, ply)) continue;
    const nodes = Math.min(cfg.pass2Nodes, cfg.totalNodes - checkpoint.nodesUsed);
    if (nodes < 3000 || Date.now() >= deadline) break;
    onProgress?.({ stage: 'pass2', done: index, total: selected.length, label: 'Comparing key decisions…' });
    const search = await compareRoot(game, ply, pool.primary, nodes, deadline, signal,
      human?.predictions?.[ply]?.moves, cfg.multiPv);
    checkpoint.nodesUsed += nodes;
    checkpoint.comparisons[ply] = { search, nnue: null };
    publish();
    const after = positionAt(game, ply);
    const trace = search && !after.isCheck() && Date.now() < deadline && pool.primary.evalTrace
      ? await pool.primary.evalTrace(buildEnginePosition(game, ply), budgetSignal(signal, deadline))
      : null;
    signal?.throwIfAborted();
    checkpoint.comparisons[ply] = { search, nnue: trace?.psqt == null ? null : {
      psqt: trace.psqt, positional: trace.positional,
    } };
    rows = moveRows(game, checkpoint, context, human?.estimate ? human : null);
    publish();
    onRowUpdate?.(rows[ply - 1], rows, meta());
  }
  if (humanTask) {
    onProgress?.({ stage: 'maia', done: 0, total: 1, label: 'Adding optional human insights…' });
    await humanTask;
    signal?.throwIfAborted();
    rows = moveRows(game, checkpoint, context, human?.estimate ? human : null);
  }
  return { version: REVIEW_VERSION, preset: cfg.key, rows, meta: meta() };
}

/**
 * Lichess AccuracyPercent.scala:
 * 50% volatility-weighted mean (sliding window std dev clamped to [0.5, 12]) + 50% harmonic mean.
 * Excludes Book and Forced moves from the denominator.
 */
function isScoredDecision(row) {
  return !row.isBook && !row.isForced && !row.provisional;
}

export function computeSideAccuracy(allRows, color) {
  const scored = allRows.filter(r => r.color === color && isScoredDecision(r));
  if (!scored.length) return null;

  const winSeries = allRows.map(r => r.whiteChance ?? 50);
  const windowSize = Math.max(2, Math.min(8, Math.floor(allRows.length / 10) || 2));

  let weightedSum = 0;
  let weightTotal = 0;
  let harmonicInvSum = 0;

  for (const row of scored) {
    const idx = row.ply - 1;
    const start = Math.max(0, idx - windowSize + 1);
    const slice = winSeries.slice(start, idx + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / slice.length;
    const weight = Math.max(0.5, Math.min(12, Math.sqrt(variance)));

    weightedSum += row.accuracy * weight;
    weightTotal += weight;
    harmonicInvSum += 1 / Math.max(1, row.accuracy);
  }

  const weightedMean = weightedSum / weightTotal;
  const harmonicMean = scored.length / harmonicInvSum;
  return Math.round(Math.max(0, Math.min(100, (weightedMean + harmonicMean) / 2)));
}

function phaseAccuracy(allRows, color, phase) {
  const subset = allRows.filter(r => r.color === color && r.phase === phase && isScoredDecision(r));
  if (!subset.length) return null;
  const avg = subset.reduce((acc, r) => acc + r.accuracy, 0) / subset.length;
  const harm = subset.length / subset.reduce((acc, r) => acc + 1 / Math.max(1, r.accuracy), 0);
  return Math.round((avg + harm) / 2);
}

function sideAcpl(allRows, color) {
  const scored = allRows.filter(r => r.color === color && isScoredDecision(r));
  if (!scored.length) return null;
  return Math.round(scored.reduce((acc, r) => acc + (r.cpLoss ?? 0), 0) / scored.length);
}

export function moveCounts(game, rows, color = game.human) {
  const counts = Object.fromEntries(Object.keys(MOVE_GRADES).map(grade => [grade, 0]));
  for (const row of rows) {
    if (row.color === color && !row.provisional && Object.hasOwn(counts, row.grade)) counts[row.grade]++;
  }
  return counts;
}

export function summarize(game, rows, meta = null) {
  const human = game.human;
  const bot = opposite(human);
  const player = rows.filter(row => row.color === human);
  if (!player.length) {
    return {
      average: null, botAverage: null, acpl: null, botAcpl: null,
      phases: { opening: null, middlegame: null, endgame: null },
      best: null, weakest: null, lost: [], turningPoints: [],
      opening: meta?.opening ?? null, theoryExit: meta?.theoryExit ?? null,
      maia: meta?.maia ?? null, counts: moveCounts(game, rows),
    };
  }

  const coverage = color => {
    const decisions = rows.filter(row => row.color === color && !row.isBook && !row.isForced);
    return { scored: decisions.filter(isScoredDecision).length, total: decisions.length };
  };

  return {
    average: computeSideAccuracy(rows, human),
    botAverage: computeSideAccuracy(rows, bot),
    acpl: sideAcpl(rows, human),
    botAcpl: sideAcpl(rows, bot),
    phases: {
      opening: phaseAccuracy(rows, human, 'opening'),
      middlegame: phaseAccuracy(rows, human, 'middlegame'),
      endgame: phaseAccuracy(rows, human, 'endgame'),
    },
    coverage: { human: coverage(human), bot: coverage(bot) },
    turningPoints: keyReviewRows(rows, human),
    opening: meta?.opening ?? null,
    theoryExit: meta?.theoryExit ?? null,
    maia: meta?.maia ?? null,
    counts: moveCounts(game, rows, human),
  };
}

// --- Practice Mode Helpers (100% compatible with saved v2 & v3 exercises) ---

export function practiceFeedback(row, uci) {
  const alternative = row.alternatives?.find(line => line.uci === uci);
  if (alternative) {
    const top = alternative.chance >= row.before - 1 ? 'Top recommendation. ' : 'Reviewed alternative. ';
    return top + (alternative.idea ?? '');
  }
  if (uci === row.uci) {
    const detail = row.explanation ?? row.idea ?? '';
    if (row.provisional) return `Played in the game. ${detail}`;
    return `Played in the game (${row.accuracy}% accuracy · ${row.grade}). ${detail}`;
  }
  return null;
}

export function practiceEstimate(reference, opponentScore, opponentWdl = null, material = 58) {
  const estimate = 100 - winningChance(opponentScore, opponentWdl, material);
  const difference = Math.round(Math.abs(estimate - reference));
  if (difference < 3) return 'Stockfish found this very close to the saved top move.';
  const direction = estimate > reference ? 'higher' : 'lower';
  return `Stockfish estimated this move about ${difference} expected-score points ${direction} than the saved top move.`;
}

export { buildPracticeHint };
