import { attacks, fen, makeSquare, san, squareRank, variant } from './vendor/chessops.bundle.js';
import { detectCapture, standardUci } from './game-state.js';
import { fenAt, legalMove, positionAt, positionFromFen } from './studio-game.js';

const CENTER = new Set(['d4', 'd5', 'e4', 'e5']);
const PIECE_VALUE = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 20 };
const ADVANTAGE = 60;
export const REVIEW_VERSION = 2;
export const MOVE_GRADES = {
  Brilliant: 'Brilliant moves',
  'Best move': 'Best moves',
  Excellent: 'Excellent moves',
  Good: 'Good moves',
  Inaccuracy: 'Inaccuracies',
  Mistake: 'Mistakes',
  Blunder: 'Blunders',
};

export function winningChance(score) {
  if (score.type === 'mate') return score.value > 0 ? 100 : 0;
  return 100 / (1 + Math.exp(-0.0037 * score.value));
}

function forkTargets(piece, square, next) {
  const attackedSquares = attacks(piece, square, next.board.occupied).intersect(next.board[next.turn]);
  return [...attackedSquares].map(target => next.board.get(target).role)
    .filter(role => PIECE_VALUE[role] > PIECE_VALUE[piece.role]);
}

function tacticalIdea(position, move, next, piece) {
  if (next.isCheckmate()) return 'Delivers checkmate.';
  if (move.promotion) return `Promotes the pawn to a ${move.promotion}.`;

  const threats = forkTargets(piece, move.to, next);
  if (threats.length >= 2) return `Forks two higher-value targets, including the ${threats[0]} and ${threats[1]}.`;
  const capture = detectCapture(position, move);
  if (capture) return `Captures a ${capture.role}${next.isCheck() ? ' with check' : ''}.`;
  if (next.isCheck()) return 'Gives check and forces a reply to the threat against the king.';
  return null;
}

function positionalIdea(move, piece) {
  const startingRank = piece.color === 'white' ? 0 : 7;
  const minorPiece = ['bishop', 'knight'].includes(piece.role);
  if (minorPiece && squareRank(move.from) === startingRank) return `Develops the ${piece.role} from the back rank.`;
  if (CENTER.has(makeSquare(move.to))) return `Places the ${piece.role} in the center.`;
  return 'Try the continuation to see how the position can develop.';
}

function describeIdea(position, move, next) {
  if (variant.castlingSide(position, move)) return 'Castles to bring the king to safety and activate a rook.';
  const piece = position.board.get(move.from);
  return tacticalIdea(position, move, next, piece) ?? positionalIdea(move, piece);
}

function describeMove(position, uci) {
  const move = legalMove(position, uci);
  if (!move) return null;
  const next = position.clone();
  const moveSan = san.makeSan(position, move);
  next.play(move);
  return {
    uci: standardUci(position, move),
    san: moveSan,
    fen: fen.makeFen(next.toSetup()),
    idea: describeIdea(position, move, next),
    next,
  };
}

function continuation(position, moves) {
  const steps = [];
  for (const uci of moves.slice(0, 7)) {
    const step = describeMove(position, uci);
    if (!step) break;
    const { next, idea, ...boardStep } = step;
    steps.push(boardStep);
    position = next;
  }
  return steps;
}

function describeLine(position, { pv, score }) {
  const first = describeMove(position, pv[0]);
  if (!first) return null;
  const { next, ...move } = first;
  return { ...move, chance: winningChance(score), continuation: continuation(next, pv.slice(1)) };
}

function terminalChance(game, ply) {
  if (ply !== game.moves.length) return null;
  const { outcome } = game;
  if (!outcome || outcome.reason === 'Resignation' || outcome.claimed) return null;
  if (!outcome.winner) return 50;
  return outcome.winner === positionAt(game, ply - 1).turn ? 100 : 0;
}

function moveQuality(accuracy) {
  if (accuracy >= 98) return 'Excellent';
  if (accuracy >= 90) return 'Good';
  if (accuracy >= 75) return 'Inaccuracy';
  return accuracy >= 55 ? 'Mistake' : 'Blunder';
}

function estimatePlayedChance(played, candidates, afterScore) {
  const matching = candidates.find(line => line.uci === played.uci);
  return matching?.chance ?? (afterScore ? 100 - winningChance(afterScore) : null);
}

function materialLead(position, color) {
  let lead = 0;
  for (const [, piece] of position.board) {
    lead += PIECE_VALUE[piece.role] * (piece.color === color ? 1 : -1);
  }
  return lead;
}

function acceptedSacrifice(position, best) {
  const [reply, followUp] = best.continuation;
  if (!followUp || reply.uci.slice(2, 4) !== best.uci.slice(2, 4)) return false;
  const before = materialLead(position, position.turn);
  const after = materialLead(positionFromFen(followUp.fen), position.turn);
  return before - after >= PIECE_VALUE.knight;
}

function classifyMove(accuracy, played, candidates, position) {
  const [best, runnerUp] = candidates;
  if (best.uci !== played.uci || accuracy < 98) return moveQuality(accuracy);
  if (!runnerUp) return 'Best move';
  if (best.chance < ADVANTAGE || best.chance - runnerUp.chance < 8) return 'Best move';
  return acceptedSacrifice(position, best) ? 'Brilliant' : 'Best move';
}

function reviewResult(played, candidates, after, position) {
  const best = candidates[0];
  if (!best || after === null) throw new Error('Stockfish did not return a score for this move.');
  const alternatives = candidates.filter(line => line.uci !== played.uci);
  const topAlternative = alternatives[0];
  const overriddenTop = best.uci === played.uci && after < best.chance;
  const reference = overriddenTop ? (topAlternative && topAlternative.chance > after ? topAlternative : { ...best, chance: after }) : best;
  const drop = Math.max(0, reference.chance - after);
  const accuracy = Math.round(100 * Math.exp(-0.0435 * drop));
  return {
    accuracy, grade: classifyMove(accuracy, played, overriddenTop && reference !== best ? [reference, ...alternatives.slice(1)] : candidates, position),
    preferred: reference.san,
    before: reference.chance, after, lostAdvantage: reference.chance >= ADVANTAGE && after <= 55,
    alternatives,
  };
}

export function assessMove(game, ply, beforeLines, afterLines) {
  const position = positionAt(game, ply - 1);
  const played = describeMove(position, game.moves[ply - 1].uci);
  const candidates = beforeLines.map(line => describeLine(position, line)).filter(Boolean);
  const after = terminalChance(game, ply) ?? estimatePlayedChance(played, candidates, afterLines[0]?.score);
  return {
    ply, color: position.turn, san: played.san, uci: played.uci, idea: played.idea,
    ...reviewResult(played, candidates, after, position),
  };
}

export function moveCounts(game, rows) {
  const counts = Object.fromEntries(Object.keys(MOVE_GRADES).map(grade => [grade, 0]));
  for (const row of rows) {
    if (row.color === game.human) counts[row.grade]++;
  }
  return counts;
}

export async function analyzeGame(game, search, onMove) {
  const rows = [];
  let before = await search(fenAt(game, 0), 0);
  for (let ply = 1; ply <= game.moves.length; ply++) {
    const after = terminalChance(game, ply) === null ? await search(fenAt(game, ply), ply) : [];
    const row = assessMove(game, ply, before, after);
    rows.push(row);
    onMove(row);
    before = after;
  }
  return rows;
}

export function summarize(game, rows) {
  const player = rows.filter(row => row.color === game.human);
  if (!player.length) return { average: null, best: null, weakest: null, lost: [] };
  return {
    average: Math.round(player.reduce((total, row) => total + row.accuracy, 0) / player.length),
    best: player.reduce((best, row) => row.accuracy > best.accuracy ? row : best),
    weakest: player.reduce((worst, row) => row.accuracy < worst.accuracy ? row : worst),
    lost: player.filter(row => row.lostAdvantage),
  };
}

export function practiceFeedback(row, uci) {
  const alternative = row.alternatives.find(line => line.uci === uci);
  if (alternative) {
    const top = alternative.chance >= row.before ? 'Top recommendation. ' : 'Reviewed alternative. ';
    return top + alternative.idea;
  }
  if (uci === row.uci) return `This was played in the game and scored ${row.accuracy}% accuracy. ${row.idea}`;
  return null;
}

export function practiceEstimate(reference, opponentScore) {
  const estimate = 100 - winningChance(opponentScore);
  const difference = Math.round(Math.abs(estimate - reference));
  if (difference < 3) return 'Stockfish found this close to the saved top move.';
  const direction = estimate > reference ? 'higher' : 'lower';
  return `Stockfish estimated this move about ${difference} points ${direction} than the saved top move.`;
}
