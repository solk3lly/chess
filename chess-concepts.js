import {
  SquareSet, attacks, between, bishopAttacks, kingAttacks, knightAttacks,
  makeSquare, opposite, pawnAttacks, queenAttacks, ray, rookAttacks,
  squareFile, squareRank, variant,
} from './vendor/chessops.bundle.js';
import { detectCapture } from './game-state.js';
import { legalMove, positionAt } from './studio-game.js';

export const PIECE_VALUE = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 20 };
export const SEE_VALUE = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };
const ROLE_ORDER = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const CENTER = new Set(['d4', 'd5', 'e4', 'e5']);
const EXTENDED_CENTER = new Set(['c3', 'c4', 'c5', 'c6', 'd3', 'd4', 'd5', 'd6', 'e3', 'e4', 'e5', 'e6', 'f3', 'f4', 'f5', 'f6']);

// Precompute the 49 2x2 regions used by Lichess's scalachess Divider.
const MIXEDNESS_REGIONS = [];
for (let y = 0; y <= 6; y++) {
  for (let x = 0; x <= 6; x++) {
    let set = SquareSet.empty();
    set = set.with(x + 8 * y).with(x + 1 + 8 * y).with(x + 8 * (y + 1)).with(x + 1 + 8 * (y + 1));
    MIXEDNESS_REGIONS.push({ y: y + 1, set });
  }
}

export function materialLead(position, color) {
  let lead = 0;
  for (const [, piece] of position.board) {
    lead += PIECE_VALUE[piece.role] * (piece.color === color ? 1 : -1);
  }
  return lead;
}

export function totalMaterialCount(position) {
  const b = position.board;
  return b.pawn.size() + 3 * b.knight.size() + 3 * b.bishop.size() + 5 * b.rook.size() + 9 * b.queen.size();
}

export function pieceCount(position) {
  return position.board.occupied.size();
}

export function legalMoveCount(position) {
  let count = 0;
  for (const [from, dests] of position.allDests()) {
    const isPawn = position.board.getRole(from) === 'pawn';
    const promoRank = position.turn === 'white' ? 7 : 0;
    for (const to of dests) {
      count += isPawn && squareRank(to) === promoRank ? 4 : 1;
    }
  }
  return count;
}

function majorsAndMinors(board) {
  return board.occupied.diff(board.king.union(board.pawn)).size();
}

function backrankSparse(board) {
  return board.white.intersect(SquareSet.fromRank(0)).size() < 4 ||
    board.black.intersect(SquareSet.fromRank(7)).size() < 4;
}

function mixednessScore(y, w, b) {
  if (w === 0) {
    if (b === 1) return 1 + y;
    if (b === 2) return y < 6 ? 2 + (6 - y) : 0;
    if (b === 3 || b === 4) return y < 7 ? 3 + (7 - y) : 0;
    return 0;
  }
  if (w === 1) {
    if (b === 0) return 1 + (8 - y);
    if (b === 1) return 5 + Math.abs(4 - y);
    if (b === 2) return 4 + (7 - y);
    if (b === 3) return 5 + (7 - y);
    return 0;
  }
  if (w === 2) {
    if (b === 0) return y > 2 ? 2 + (y - 2) : 0;
    if (b === 1) return 4 + (y - 1);
    if (b === 2) return 7;
    return 0;
  }
  if (w === 3) {
    if (b === 0) return y > 1 ? 3 + (y - 1) : 0;
    if (b === 1) return 5 + (y - 1);
    return 0;
  }
  if (w === 4 && b === 0) return y > 1 ? 3 + (y - 1) : 0;
  return 0;
}

function mixedness(board) {
  let acc = 0;
  for (const { y, set } of MIXEDNESS_REGIONS) {
    acc += mixednessScore(y, board.white.intersect(set).size(), board.black.intersect(set).size());
  }
  return acc;
}

/**
 * Exact Lichess scalachess Divider phase split.
 * Returns { middlePly, endPly, phaseAt(ply) } where phase is 'opening' | 'middlegame' | 'endgame'.
 */
export function divideGamePhases(game) {
  const totalPlies = game.moves.length;
  let middlePly = null;
  let endPly = null;

  for (let ply = 0; ply <= totalPlies; ply++) {
    const { board } = positionAt(game, ply);
    const mm = majorsAndMinors(board);
    if (middlePly === null && (mm <= 10 || backrankSparse(board) || mixedness(board) > 150)) {
      middlePly = ply;
    }
    if (middlePly !== null && endPly === null && mm <= 6) {
      endPly = ply;
      break;
    }
  }
  if (middlePly !== null && endPly !== null && middlePly >= endPly) {
    middlePly = null;
  }

  function phaseAt(ply) {
    if (endPly !== null && ply >= endPly) return 'endgame';
    if (middlePly !== null && ply >= middlePly) return 'middlegame';
    return 'opening';
  }

  return { middlePly, endPly, phaseAt };
}

export function attackersTo(board, square, occupied = board.occupied) {
  const wp = pawnAttacks('black', square).intersect(board.white).intersect(board.pawn);
  const bp = pawnAttacks('white', square).intersect(board.black).intersect(board.pawn);
  const kn = knightAttacks(square).intersect(board.knight);
  const ki = kingAttacks(square).intersect(board.king);
  const diag = bishopAttacks(square, occupied).intersect(board.bishop.union(board.queen));
  const orth = rookAttacks(square, occupied).intersect(board.rook.union(board.queen));
  return wp.union(bp).union(kn).union(ki).union(diag).union(orth).intersect(occupied);
}

export function colorAttackers(board, square, color, occupied = board.occupied) {
  return attackersTo(board, square, occupied).intersect(board[color]);
}

function leastValuableAttacker(board, attackers, color) {
  const sideAttackers = attackers.intersect(board[color]);
  if (sideAttackers.isEmpty()) return null;
  for (const role of ROLE_ORDER) {
    const subset = sideAttackers.intersect(board[role]);
    const sq = subset.first();
    if (sq !== undefined) return { sq, role };
  }
  return null;
}

/**
 * Static Exchange Evaluation for playing `move` in `position` (centipawns, mover POV).
 * Positive => wins material; ~0 => equal trade; negative => loses material.
 */
export function seeMove(position, move) {
  if (!move || !('from' in move)) return 0;
  const board = position.board;
  const mover = board.get(move.from);
  if (!mover) return 0;
  if (variant.castlingSide(position, move)) return 0;

  const target = move.to;
  const captured = detectCapture(position, move);
  let occupied = board.occupied.without(move.from);

  // Handle en passant captured pawn square.
  if (captured && !board.get(target) && mover.role === 'pawn') {
    const epSq = squareFile(target) + 8 * squareRank(move.from);
    occupied = occupied.without(epSq);
  }

  let initialGain = captured ? SEE_VALUE[captured.role] : 0;
  let currentRole = mover.role;
  if (move.promotion) {
    initialGain += SEE_VALUE[move.promotion] - SEE_VALUE.pawn;
    currentRole = move.promotion;
  }

  const gain = [initialGain];
  let side = opposite(mover.color);
  let depth = 0;

  while (true) {
    const attackers = attackersTo(board, target, occupied);
    const lva = leastValuableAttacker(board, attackers, side);
    if (!lva) break;
    // King cannot recapture if the other side still defends the target square.
    if (lva.role === 'king') {
      const oppAttackers = attackers.intersect(board[opposite(side)]);
      if (oppAttackers.nonEmpty()) break;
    }
    depth++;
    gain[depth] = SEE_VALUE[currentRole] - gain[depth - 1];
    occupied = occupied.without(lva.sq);
    currentRole = lva.role;
    side = opposite(side);
    if (currentRole === 'king') break;
  }

  while (depth > 0) {
    gain[depth - 1] = -Math.max(-gain[depth - 1], gain[depth]);
    depth--;
  }
  return gain[0];
}

/**
 * Best static capture gain for `attackerColor` capturing the piece on `targetSq`.
 * Returns > 0 if the piece on `targetSq` can be won profitably right now.
 */
export function seeSquare(position, targetSq, attackerColor) {
  const board = position.board;
  const victim = board.get(targetSq);
  if (!victim || victim.color === attackerColor) return 0;
  const attackers = colorAttackers(board, targetSq, attackerColor);
  const lva = leastValuableAttacker(board, attackers, attackerColor);
  if (!lva) return 0;
  if (lva.role === 'king' && colorAttackers(board, targetSq, victim.color).nonEmpty()) return 0;
  // Simulate capture with least valuable attacker.
  const promoRank = attackerColor === 'white' ? 7 : 0;
  const promotion = lva.role === 'pawn' && squareRank(targetSq) === promoRank ? 'queen' : undefined;
  return seeMove(position, { from: lva.sq, to: targetSq, ...(promotion && { promotion }) });
}

/**
 * Returns non-king pieces belonging to `color` that the opponent can profitably capture (SEE >= 100).
 */
export function hangingPieces(position, color) {
  const opp = opposite(color);
  const result = [];
  for (const [sq, piece] of position.board) {
    if (piece.color !== color || piece.role === 'king') continue;
    const gain = seeSquare(position, sq, opp);
    if (gain >= 100) {
      const defended = colorAttackers(position.board, sq, color).nonEmpty();
      result.push({ sq, role: piece.role, gain, undefended: !defended });
    }
  }
  result.sort((a, b) => b.gain - a.gain || PIECE_VALUE[b.role] - PIECE_VALUE[a.role]);
  return result;
}

/**
 * Detects accepted, declined/poisoned, and counter/ignored-threat sacrifices.
 * Returns { kind: 'accepted' | 'declined' | 'counter', loss, square, pieceRole } | null.
 */
export function analyzeSacrifice(position, move, pvUcis = []) {
  if (!move || !('from' in move)) return null;
  const color = position.turn;
  const opp = opposite(color);
  const mover = position.board.get(move.from);
  if (!mover) return null;

  const beforeMat = materialLead(position, color);
  const next = position.clone();
  next.play(move);
  if (next.isCheckmate()) return null;

  // 1. Check multi-ply PV material balance after tactical captures settle (quiescence).
  let cursor = next.clone();
  let lastCapturePly = -1;
  let settledMat = materialLead(cursor, color);
  let oppAcceptedCapture = false;
  const playedSteps = [];
  for (let i = 0; i < Math.min(pvUcis.length, 6); i++) {
    const step = legalMove(cursor, pvUcis[i]);
    if (!step) break;
    const cap = detectCapture(cursor, step);
    if (i === 0 && cap && step.to === move.to) oppAcceptedCapture = true;
    cursor.play(step);
    playedSteps.push({ step, cap, mat: materialLead(cursor, color), check: cursor.isCheck(), mate: cursor.isCheckmate() });
    if (cap) lastCapturePly = i;
  }

  // Evaluate material after the capture chain ends (at least 1 reply deep, up to quiet ply).
  if (playedSteps.length >= 2) {
    const settleIdx = Math.min(playedSteps.length - 1, Math.max(1, lastCapturePly + (lastCapturePly % 2 === 0 ? 1 : 0)));
    settledMat = playedSteps[settleIdx].mat;
    const finalMat = playedSteps.at(-1).mat;
    const minRemainingDrop = Math.min(beforeMat - settledMat, beforeMat - finalMat);
    const pvDeliversMate = playedSteps.some((s, idx) => idx % 2 === 1 && s.mate);
    if (minRemainingDrop >= 2 || (oppAcceptedCapture && beforeMat - settledMat >= 2 && pvDeliversMate)) {
      return {
        kind: 'accepted',
        loss: Math.max(2, beforeMat - settledMat),
        square: move.to,
        pieceRole: mover.role,
      };
    }
  }

  // 2. Declined / Poisoned sacrifice: mover lands on a square where SEE loses >= 200 cp,
  //    yet opponent's best PV declines to take it (or taking it fails).
  const moveSee = seeMove(position, move);
  if (moveSee <= -200 && PIECE_VALUE[mover.role] >= 3) {
    // Verify opponent actually has a legal capture on move.to in `next`.
    let canLegallyTake = false;
    for (const [, dests] of next.allDests()) {
      if (dests.has(move.to)) { canLegallyTake = true; break; }
    }
    if (canLegallyTake) {
      return {
        kind: oppAcceptedCapture ? 'accepted' : 'declined',
        loss: Math.round(-moveSee / 100),
        square: move.to,
        pieceRole: mover.role,
      };
    }
  }

  // 3. Ignored-threat / counter-sacrifice: another valuable piece (>= minor) is left hanging
  //    (with legal capture available for opponent) while mover plays an active alternative.
  const leftHanging = hangingPieces(next, color)
    .filter(h => h.sq !== move.to && PIECE_VALUE[h.role] >= 3 && h.gain >= 220);
  if (leftHanging.length) {
    for (const target of leftHanging) {
      let canTake = false;
      for (const [, dests] of next.allDests()) {
        if (dests.has(target.sq)) { canTake = true; break; }
      }
      if (canTake) {
        return {
          kind: 'counter',
          loss: Math.round(target.gain / 100),
          square: target.sq,
          pieceRole: target.role,
        };
      }
    }
  }

  return null;
}

export function detectMatePattern(position, move, next) {
  if (!next.isCheckmate()) return null;
  const winner = position.turn;
  const loser = opposite(winner);
  const kingSq = next.board.kingOf(loser);
  if (kingSq === undefined) return { id: 'checkmate', label: 'Checkmate', squares: [move.to] };

  const mover = next.board.get(move.to);
  const kRank = squareRank(kingSq);
  const kFile = squareFile(kingSq);
  const backRank = loser === 'white' ? 0 : 7;
  const shieldRank = loser === 'white' ? 1 : 6;
  const ring = kingAttacks(kingSq);

  // Smothered mate: knight delivers mate and all squares around king are occupied by loser's pieces.
  if (mover?.role === 'knight') {
    const escapeBlockedByOwn = ring.diff(next.board[loser]).isEmpty();
    if (escapeBlockedByOwn) {
      return { id: 'smotheredMate', label: 'Smothered mate', squares: [move.to, kingSq] };
    }
  }

  // Back-rank mate: rook/queen mates on back rank while king is trapped by own pieces on shield rank.
  if ((mover?.role === 'rook' || mover?.role === 'queen') && kRank === backRank && squareRank(move.to) === backRank) {
    const shieldSquares = ring.intersect(SquareSet.fromRank(shieldRank));
    if (shieldSquares.nonEmpty() && shieldSquares.diff(next.board[loser]).isEmpty()) {
      return { id: 'backRankMate', label: 'Back-rank mate', squares: [move.to, kingSq] };
    }
  }

  // Also check SquareSet.corners() usage cleanly
  if (SquareSet.corners().has(kingSq) && (mover?.role === 'rook' || mover?.role === 'knight')) {
    const friendlyRooks = next.board[winner].intersect(next.board.rook);
    const friendlyKnights = next.board[winner].intersect(next.board.knight);
    const rookNear = friendlyRooks.intersects(ring);
    const knightAttacksRing = [...friendlyKnights].some(sq => knightAttacks(sq).intersects(ring));
    if (rookNear && knightAttacksRing) {
      return { id: 'arabianMate', label: 'Arabian mate', squares: [move.to, kingSq] };
    }
  }

  // Anastasia's mate: king on a/h file, knight controls two escape squares, rook/queen mates on file.
  if ((kFile === 0 || kFile === 7) && (mover?.role === 'rook' || mover?.role === 'queen') && squareFile(move.to) === kFile) {
    const friendlyKnights = next.board[winner].intersect(next.board.knight);
    if ([...friendlyKnights].some(sq => knightAttacks(sq).intersect(ring).size() >= 2)) {
      return { id: 'anastasiaMate', label: "Anastasia's mate", squares: [move.to, kingSq] };
    }
  }

  // Boden's / Double Bishop mate: two bishops control king + escape squares.
  if (mover?.role === 'bishop') {
    const bishops = [...next.board[winner].intersect(next.board.bishop)];
    if (bishops.length >= 2) {
      const other = bishops.find(sq => sq !== move.to);
      if (other !== undefined && bishopAttacks(other, next.board.occupied).intersects(ring)) {
        const kingBlocked = ring.intersect(next.board[loser]).size() >= 2;
        return {
          id: kingBlocked ? 'bodenMate' : 'doubleBishopMate',
          label: kingBlocked ? "Boden's mate" : 'Double-bishop mate',
          squares: [move.to, other, kingSq],
        };
      }
    }
  }

  // Hook mate: rook adjacent to king, protected by knight, knight protected by pawn.
  if (mover?.role === 'rook' && ring.has(move.to)) {
    const protectingKnights = knightAttacks(move.to).intersect(next.board[winner]).intersect(next.board.knight);
    if ([...protectingKnights].some(kSq => colorAttackers(next.board, kSq, winner).intersects(next.board.pawn))) {
      return { id: 'hookMate', label: 'Hook mate', squares: [move.to, kingSq] };
    }
  }

  // Dovetail mate: queen diagonally adjacent to king whose two rear diagonal squares are blocked by own pieces.
  if (mover?.role === 'queen' && ring.has(move.to) && squareFile(move.to) !== kFile && squareRank(move.to) !== kRank) {
    const ownBlockers = ring.intersect(next.board[loser]);
    if (ownBlockers.size() >= 2 && ownBlockers.size() <= 3 && colorAttackers(next.board, move.to, winner).nonEmpty()) {
      return { id: 'dovetailMate', label: 'Dovetail mate', squares: [move.to, kingSq] };
    }
  }

  return { id: 'checkmate', label: 'Checkmate', squares: [move.to, kingSq] };
}

function findPinsAndSkewers(board, attackerColor) {
  const defenderColor = opposite(attackerColor);
  const sliders = board[attackerColor].intersect(board.bishop.union(board.rook).union(board.queen));
  const pins = [];
  const skewers = [];

  for (const sliderSq of sliders) {
    const slider = board.get(sliderSq);
    const firstHits = attacks(slider, sliderSq, board.occupied).intersect(board[defenderColor]);
    for (const frontSq of firstHits) {
      const frontPiece = board.get(frontSq);
      const line = ray(sliderSq, frontSq);
      if (line.isEmpty()) continue;
      // Look past `frontSq` by removing it from occupied.
      const behindMask = attacks(slider, sliderSq, board.occupied.without(frontSq))
        .intersect(line)
        .diff(attacks(slider, sliderSq, board.occupied))
        .intersect(board[defenderColor]);
      const backSq = behindMask.first();
      if (backSq === undefined) continue;
      const backPiece = board.get(backSq);
      if (!backPiece) continue;

      if (backPiece.role === 'king') {
        pins.push({ sliderSq, pinnedSq: frontSq, behindSq: backSq, absolute: true, pinnedRole: frontPiece.role, behindRole: 'king' });
      } else if (PIECE_VALUE[backPiece.role] > PIECE_VALUE[frontPiece.role] && PIECE_VALUE[frontPiece.role] >= 3) {
        pins.push({ sliderSq, pinnedSq: frontSq, behindSq: backSq, absolute: false, pinnedRole: frontPiece.role, behindRole: backPiece.role });
      } else if (PIECE_VALUE[frontPiece.role] > PIECE_VALUE[backPiece.role] && PIECE_VALUE[backPiece.role] >= 3) {
        skewers.push({ sliderSq, frontSq, behindSq: backSq, frontRole: frontPiece.role, behindRole: backPiece.role });
      }
    }
  }
  return { pins, skewers };
}

function findDiscoveredAttacks(before, move, after) {
  const color = before.turn;
  const opp = opposite(color);
  const results = [];
  const sliders = before.board[color].intersect(before.board.bishop.union(before.board.rook).union(before.board.queen)).without(move.from);

  for (const sliderSq of sliders) {
    const slider = after.board.get(sliderSq);
    if (!slider) continue;
    const beforeAtk = attacks(slider, sliderSq, before.board.occupied);
    const afterAtk = attacks(slider, sliderSq, after.board.occupied);
    const newlyAttacked = afterAtk.diff(beforeAtk).intersect(after.board[opp]);
    for (const targetSq of newlyAttacked) {
      const target = after.board.get(targetSq);
      if (!target) continue;
      if (target.role === 'king') {
        results.push({ isCheck: true, sliderSq, targetSq, targetRole: 'king', sliderRole: slider.role });
      } else if (PIECE_VALUE[target.role] >= 3 && (PIECE_VALUE[target.role] > PIECE_VALUE[slider.role] || seeSquare(after, targetSq, color) >= 100)) {
        results.push({ isCheck: false, sliderSq, targetSq, targetRole: target.role, sliderRole: slider.role });
      }
    }
  }
  return results;
}

function findTrappedPieces(after, moverColor) {
  const opp = opposite(moverColor);
  const trapped = [];
  const oppPieces = after.board[opp].diff(after.board.pawn).diff(after.board.king);
  for (const sq of oppPieces) {
    const piece = after.board.get(sq);
    if (!piece) continue;
    if (seeSquare(after, sq, moverColor) < 100) continue;
    const dests = after.dests(sq);
    let hasSafeEscape = false;
    for (const dest of dests) {
      if (seeMove(after, { from: sq, to: dest }) >= -50) {
        hasSafeEscape = true;
        break;
      }
    }
    if (!hasSafeEscape) {
      trapped.push({ sq, role: piece.role });
    }
  }
  return trapped;
}

/**
 * Extracts tactical, checkmate, and PV-level motifs for playing `move` from `position`.
 */
export function extractTacticalMotifs(position, move, pvUcis = [], { ply = 1, prevCaptureSq = null } = {}) {
  const motifs = [];
  if (!move || !('from' in move)) return motifs;
  const color = position.turn;
  const opp = opposite(color);
  const piece = position.board.get(move.from);
  if (!piece) return motifs;

  const capture = detectCapture(position, move);
  const castling = variant.castlingSide(position, move);
  const next = position.clone();
  next.play(move);
  const movedPiece = next.board.get(move.to) ?? piece;
  const moveSee = seeMove(position, move);

  if (castling) {
    motifs.push({
      id: 'castling',
      label: castling === 'h' ? 'Kingside castling' : 'Queenside castling',
      category: 'special',
      squares: [move.to],
      priority: 32,
    });
  }

  // Checkmate patterns (immediate)
  if (next.isCheckmate()) {
    const mate = detectMatePattern(position, move, next);
    motifs.push({ ...mate, category: 'mate', priority: 100 });
    return motifs;
  }

  // Promotion / Underpromotion
  if (move.promotion) {
    const under = move.promotion !== 'queen';
    motifs.push({
      id: under ? 'underPromotion' : 'promotion',
      label: under ? `Underpromotion to ${move.promotion}` : 'Pawn promotion',
      category: 'tactical',
      squares: [move.to],
      pieceRole: move.promotion,
      priority: under ? 92 : 85,
    });
  }

  // En passant
  if (piece.role === 'pawn' && capture && !position.board.get(move.to)) {
    motifs.push({ id: 'enPassant', label: 'En passant', category: 'special', squares: [move.to], priority: 40 });
  }

  // Double check & Discovered check / attack
  const discovered = findDiscoveredAttacks(position, move, next);
  const checkers = next.ctx().checkers;
  if (checkers.size() >= 2) {
    motifs.push({
      id: 'doubleCheck',
      label: 'Double check',
      category: 'tactical',
      squares: [...checkers, next.board.kingOf(opp)].filter(s => s !== undefined),
      priority: 90,
    });
  } else if (discovered.some(d => d.isCheck)) {
    const d = discovered.find(item => item.isCheck);
    motifs.push({
      id: 'discoveredCheck',
      label: 'Discovered check',
      category: 'tactical',
      squares: [d.sliderSq, d.targetSq, move.to],
      arrows: [{ orig: makeSquare(d.sliderSq), dest: makeSquare(d.targetSq) }],
      priority: 86,
    });
  } else if (discovered.length) {
    const d = discovered.sort((a, b) => PIECE_VALUE[b.targetRole] - PIECE_VALUE[a.targetRole])[0];
    motifs.push({
      id: 'discoveredAttack',
      label: 'Discovered attack',
      category: 'tactical',
      squares: [d.sliderSq, d.targetSq],
      arrows: [{ orig: makeSquare(d.sliderSq), dest: makeSquare(d.targetSq) }],
      targetRole: d.targetRole,
      priority: 76,
    });
  }

  // SEE-verified Fork / Double Attack
  const attackedEnemies = attacks(movedPiece, move.to, next.board.occupied).intersect(next.board[opp]);
  const forkTargets = [];
  for (const sq of attackedEnemies) {
    const target = next.board.get(sq);
    if (!target) continue;
    const valuable = target.role === 'king' || PIECE_VALUE[target.role] > PIECE_VALUE[movedPiece.role];
    const undefended = target.role !== 'pawn' && colorAttackers(next.board, sq, opp).isEmpty();
    if (valuable || undefended) {
      forkTargets.push({ sq, role: target.role, value: PIECE_VALUE[target.role] });
    }
  }
  const safeFork = moveSee >= -50 || (next.isCheck() && forkTargets.some(t => t.role !== 'king' && colorAttackers(next.board, t.sq, opp).isEmpty()));
  if (forkTargets.length >= 2 && safeFork) {
    forkTargets.sort((a, b) => b.value - a.value);
    const [t1, t2] = forkTargets;
    motifs.push({
      id: 'fork',
      label: movedPiece.role === 'knight' ? 'Knight fork' : movedPiece.role === 'pawn' ? 'Pawn fork' : 'Fork',
      category: 'tactical',
      squares: [move.to, t1.sq, t2.sq],
      arrows: [
        { orig: makeSquare(move.to), dest: makeSquare(t1.sq) },
        { orig: makeSquare(move.to), dest: makeSquare(t2.sq) },
      ],
      targets: [t1.role, t2.role],
      targetSquares: [makeSquare(t1.sq), makeSquare(t2.sq)],
      pieceRole: movedPiece.role,
      priority: 82,
    });
  }

  // Newly created Pins & Skewers involving the moved piece (or uncovered slider)
  const beforePS = findPinsAndSkewers(position.board, color);
  const afterPS = findPinsAndSkewers(next.board, color);
  const beforePinKeys = new Set(beforePS.pins.map(p => `${p.sliderSq}:${p.pinnedSq}:${p.behindSq}`));
  const newPins = afterPS.pins.filter(p => !beforePinKeys.has(`${p.sliderSq}:${p.pinnedSq}:${p.behindSq}`));
  if (newPins.length && moveSee >= -80) {
    const p = newPins.sort((a, b) => Number(b.absolute) - Number(a.absolute) || PIECE_VALUE[b.behindRole] - PIECE_VALUE[a.behindRole])[0];
    motifs.push({
      id: 'pin',
      label: p.absolute ? 'Absolute pin' : 'Pin',
      category: 'tactical',
      squares: [p.sliderSq, p.pinnedSq, p.behindSq],
      arrows: [{ orig: makeSquare(p.sliderSq), dest: makeSquare(p.behindSq) }],
      pinnedRole: p.pinnedRole,
      behindRole: p.behindRole,
      pinnedSquare: makeSquare(p.pinnedSq),
      priority: p.absolute ? 74 : 68,
    });
  }
  const beforeSkewerKeys = new Set(beforePS.skewers.map(s => `${s.sliderSq}:${s.frontSq}:${s.behindSq}`));
  const newSkewers = afterPS.skewers.filter(s => !beforeSkewerKeys.has(`${s.sliderSq}:${s.frontSq}:${s.behindSq}`));
  if (newSkewers.length && moveSee >= -80) {
    const s = newSkewers.sort((a, b) => PIECE_VALUE[b.behindRole] - PIECE_VALUE[a.behindRole])[0];
    motifs.push({
      id: 'skewer',
      label: 'Skewer',
      category: 'tactical',
      squares: [s.sliderSq, s.frontSq, s.behindSq],
      arrows: [{ orig: makeSquare(s.sliderSq), dest: makeSquare(s.behindSq) }],
      frontRole: s.frontRole,
      behindRole: s.behindRole,
      priority: 79,
    });
  }

  // Trapped Piece
  const trapped = findTrappedPieces(next, color);
  if (trapped.length) {
    const t = trapped.sort((a, b) => PIECE_VALUE[b.role] - PIECE_VALUE[a.role])[0];
    motifs.push({
      id: 'trappedPiece',
      label: 'Trapped piece',
      category: 'tactical',
      squares: [t.sq],
      targetRole: t.role,
      targetSquare: makeSquare(t.sq),
      priority: 77,
    });
  }

  // Capturing an undefended / hanging piece
  if (capture && PIECE_VALUE[capture.role] >= 3) {
    const wasUndefended = colorAttackers(position.board, move.to, opp).isEmpty();
    if (wasUndefended && moveSee >= 250) {
      motifs.push({
        id: 'hangingPiece',
        label: 'Hanging piece',
        category: 'tactical',
        squares: [move.to],
        targetRole: capture.role,
        targetSquare: makeSquare(move.to),
        priority: 72,
      });
    }
  }

  // Attacking f2 / f7 in opening
  const weakSq = opp === 'black' ? 53 : 13; // f7 = 5 + 6*8 = 53, f2 = 5 + 1*8 = 13
  if (ply <= 24 && (move.to === weakSq || attacks(movedPiece, move.to, next.board.occupied).has(weakSq))) {
    const oppKing = next.board.kingOf(opp);
    if (oppKing !== undefined && squareRank(oppKing) === (opp === 'black' ? 7 : 0)) {
      const fAtk = colorAttackers(next.board, weakSq, color).size();
      const fDef = colorAttackers(next.board, weakSq, opp).size();
      if (move.to === weakSq || fAtk > fDef) {
        motifs.push({
          id: 'attackingF2F7',
          label: opp === 'black' ? 'Attacking f7' : 'Attacking f2',
          category: 'tactical',
          squares: [weakSq],
          priority: 55,
        });
      }
    }
  }

  // Multi-ply PV motif analysis (reply = pv[0], followUp = pv[1])
  const pvReply = pvUcis[0] ? legalMove(next, pvUcis[0]) : null;
  const afterReply = pvReply ? (() => { const c = next.clone(); c.play(pvReply); return c; })() : null;
  const pvFollow = afterReply && pvUcis[1] ? legalMove(afterReply, pvUcis[1]) : null;
  const afterFollow = pvFollow ? (() => { const c = afterReply.clone(); c.play(pvFollow); return c; })() : null;

  if (afterFollow) {
    // Forced mate along PV (check up to 6 plies)
    let mateCursor = next.clone();
    for (let i = 0; i < Math.min(pvUcis.length, 6); i++) {
      const step = legalMove(mateCursor, pvUcis[i]);
      if (!step) break;
      const beforeStep = mateCursor.clone();
      mateCursor.play(step);
      if (mateCursor.isCheckmate() && beforeStep.turn === color) {
        const pattern = detectMatePattern(beforeStep, step, mateCursor);
        if (pattern && pattern.id !== 'checkmate') {
          motifs.push({ ...pattern, label: `${pattern.label} threat`, category: 'mate', priority: 88 });
        }
        break;
      }
    }

    const followCapture = detectCapture(afterReply, pvFollow);

    // Capturing the defender: `move` captured a piece that defended pvFollow.to
    if (capture && followCapture && pvFollow.to !== move.to) {
      const capPieceDefendedTarget = attacks({ color: opp, role: capture.role }, move.to, position.board.occupied).has(pvFollow.to);
      if (capPieceDefendedTarget && seeMove(afterReply, pvFollow) >= 100) {
        motifs.push({
          id: 'capturingDefender',
          label: 'Removing the defender',
          category: 'tactical',
          squares: [move.to, pvFollow.to],
          targetRole: followCapture.role,
          priority: 80,
        });
      }
    }

    // Deflection: pvReply moved an enemy defender away from defending pvFollow.to
    if (pvReply && followCapture && pvFollow.to !== pvReply.to) {
      const movedDefender = next.board.get(pvReply.from);
      if (movedDefender && attacks(movedDefender, pvReply.from, next.board.occupied).has(pvFollow.to) &&
          !attacks(movedDefender, pvReply.to, afterReply.board.occupied).has(pvFollow.to)) {
        motifs.push({
          id: 'deflection',
          label: 'Deflection',
          category: 'tactical',
          squares: [move.to, pvReply.from, pvFollow.to],
          priority: 79,
        });
      }
    }

    // Attraction / Decoy: move lured enemy King or Queen onto pvReply.to where pvFollow forks/skewers/mates it
    const replyPiece = next.board.get(pvReply.from);
    if (replyPiece && (replyPiece.role === 'king' || replyPiece.role === 'queen') && pvReply.to === move.to) {
      const followMotifs = extractSinglePlyTactics(afterReply, pvFollow, afterFollow);
      if (afterFollow.isCheckmate() || followMotifs.includes('fork') || followMotifs.includes('skewer')) {
        motifs.push({
          id: 'attraction',
          label: 'Attraction',
          category: 'tactical',
          squares: [move.to, pvFollow.to],
          priority: 81,
        });
      }
    }

    // Interference: move.to lands between an enemy slider and a piece it defended, which pvFollow captures
    if (!capture && followCapture) {
      const enemySliders = position.board[opp].intersect(position.board.bishop.union(position.board.rook).union(position.board.queen));
      for (const sSq of enemySliders) {
        const sPiece = position.board.get(sSq);
        if (attacks(sPiece, sSq, position.board.occupied).has(pvFollow.to) &&
            between(sSq, pvFollow.to).has(move.to)) {
          motifs.push({
            id: 'interference',
            label: 'Interference',
            category: 'tactical',
            squares: [move.to, sSq, pvFollow.to],
            priority: 78,
          });
          break;
        }
      }
    }

    // Clearance: move vacates move.from and pvFollow either lands on move.from or slides through it
    if (pvFollow.from !== move.to && (pvFollow.to === move.from || between(pvFollow.from, pvFollow.to).has(move.from))) {
      motifs.push({
        id: 'clearance',
        label: 'Clearance',
        category: 'tactical',
        squares: [move.from, pvFollow.to],
        priority: 71,
      });
    }

    // Intermezzo / Zwischenzug: previous ply captured on prevCaptureSq, we insert a check/threat and recapture on pvFollow
    if (prevCaptureSq !== null && move.to !== prevCaptureSq && pvFollow.to === prevCaptureSq && (next.isCheck() || forkTargets.length >= 2)) {
      motifs.push({
        id: 'intermezzo',
        label: 'Intermezzo',
        category: 'tactical',
        squares: [move.to, prevCaptureSq],
        priority: 83,
      });
    }
  }

  // Sacrifice motif (accepted / declined / counter)
  const sac = analyzeSacrifice(position, move, pvUcis);
  if (sac) {
    const label = sac.kind === 'declined' ? 'Poisoned sacrifice'
      : sac.kind === 'counter' ? 'Counter-sacrifice' : 'Sacrifice';
    motifs.push({
      id: 'sacrifice',
      label,
      sacKind: sac.kind,
      category: 'tactical',
      squares: [sac.square],
      pieceRole: sac.pieceRole,
      loss: sac.loss,
      priority: 78,
    });
  }

  // Deduplicate by id, keep highest priority
  const byId = new Map();
  for (const m of motifs) {
    if (!byId.has(m.id) || m.priority > byId.get(m.id).priority) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => b.priority - a.priority);
}

function extractSinglePlyTactics(pos, move, next) {
  const tags = [];
  const piece = next.board.get(move.to);
  if (!piece) return tags;
  const opp = opposite(pos.turn);
  const atk = attacks(piece, move.to, next.board.occupied).intersect(next.board[opp]);
  let targets = 0;
  for (const sq of atk) {
    const t = next.board.get(sq);
    if (t && (t.role === 'king' || PIECE_VALUE[t.role] > PIECE_VALUE[piece.role])) targets++;
  }
  if (targets >= 2) tags.push('fork');
  const { skewers } = findPinsAndSkewers(next.board, pos.turn);
  if (skewers.some(s => s.sliderSq === move.to)) tags.push('skewer');
  return tags;
}

// --- Positional & Structural Analysis ---

function pawnFeatures(board, color) {
  const ownPawns = board[color].intersect(board.pawn);
  const enemyPawns = board[opposite(color)].intersect(board.pawn);
  const dir = color === 'white' ? 1 : -1;
  const passed = [];
  let isolated = 0;
  let doubled = 0;

  for (let f = 0; f < 8; f++) {
    const filePawns = ownPawns.intersect(SquareSet.fromFile(f));
    if (filePawns.size() > 1) doubled += filePawns.size() - 1;
    if (filePawns.isEmpty()) continue;
    const adjFiles = (f > 0 ? SquareSet.fromFile(f - 1) : SquareSet.empty())
      .union(f < 7 ? SquareSet.fromFile(f + 1) : SquareSet.empty());
    if (ownPawns.intersect(adjFiles).isEmpty()) isolated += filePawns.size();

    const frontFiles = adjFiles.union(SquareSet.fromFile(f));
    for (const sq of filePawns) {
      const r = squareRank(sq);
      let ahead = SquareSet.empty();
      for (let rr = r + dir; rr >= 0 && rr < 8; rr += dir) ahead = ahead.union(SquareSet.fromRank(rr));
      if (enemyPawns.intersect(frontFiles).intersect(ahead).isEmpty()) {
        const promoDist = color === 'white' ? 7 - r : r;
        const supported = colorAttackers(board, sq, color).intersects(ownPawns);
        passed.push({ sq, rank: r, promoDist, supported });
      }
    }
  }
  return { passed, isolated, doubled };
}

function isKnightOutpost(board, sq, color) {
  const rank = squareRank(sq);
  const file = squareFile(sq);
  const goodRank = color === 'white' ? (rank >= 3 && rank <= 5) : (rank >= 2 && rank <= 4);
  if (!goodRank) return false;
  const ownPawns = board[color].intersect(board.pawn);
  if (colorAttackers(board, sq, color).intersect(ownPawns).isEmpty()) return false;
  const enemyPawns = board[opposite(color)].intersect(board.pawn);
  const adjFiles = (file > 0 ? SquareSet.fromFile(file - 1) : SquareSet.empty())
    .union(file < 7 ? SquareSet.fromFile(file + 1) : SquareSet.empty());
  const dir = color === 'white' ? 1 : -1;
  let ahead = SquareSet.empty();
  for (let rr = rank + dir; rr >= 0 && rr < 8; rr += dir) ahead = ahead.union(SquareSet.fromRank(rr));
  return enemyPawns.intersect(adjFiles).intersect(ahead).isEmpty();
}

function kingSafetyMetrics(position, color) {
  const board = position.board;
  const kingSq = board.kingOf(color);
  if (kingSq === undefined) return { attackers: 0, shield: 0, castled: false };
  const file = squareFile(kingSq);
  const rank = squareRank(kingSq);
  const homeRank = color === 'white' ? 0 : 7;
  const castled = rank === homeRank && (file <= 2 || file >= 5);
  let shield = 0;
  if (castled) {
    const shieldRank = color === 'white' ? 1 : 6;
    const ownPawns = board[color].intersect(board.pawn);
    for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
      if (ownPawns.has(f + 8 * shieldRank)) shield++;
    }
  }
  const ring = kingAttacks(kingSq);
  const opp = opposite(color);
  let attackers = 0;
  for (const sq of ring) {
    attackers += colorAttackers(board, sq, opp).size();
  }
  return { attackers, shield, castled };
}

export function extractPositionalDeltas(before, move, after, phase = 'middlegame') {
  const deltas = [];
  if (!move || !('from' in move)) return deltas;
  const color = before.turn;
  const opp = opposite(color);
  const piece = before.board.get(move.from);
  if (!piece) return deltas;
  const movedPiece = after.board.get(move.to) ?? piece;

  // Passed pawn created or pushed to 6th/7th rank
  const pBefore = pawnFeatures(before.board, color);
  const pAfter = pawnFeatures(after.board, color);
  if (pAfter.passed.length > pBefore.passed.length) {
    const newest = pAfter.passed.find(p => p.sq === move.to) ?? pAfter.passed[0];
    deltas.push({
      id: 'passedPawn',
      label: newest.supported ? 'Protected passed pawn' : 'Passed pawn',
      squares: [newest.sq],
      square: makeSquare(newest.sq),
      positive: true,
      priority: 64,
    });
  } else if (piece.role === 'pawn') {
    const adv = pAfter.passed.find(p => p.sq === move.to && p.promoDist <= 2);
    if (adv) {
      deltas.push({
        id: 'advancedPassedPawn',
        label: 'Advanced passed pawn',
        squares: [adv.sq],
        square: makeSquare(adv.sq),
        positive: true,
        priority: 66,
      });
    }
  }

  // Knight outpost
  if (movedPiece.role === 'knight' && isKnightOutpost(after.board, move.to, color) &&
      !isKnightOutpost(before.board, move.from, color)) {
    deltas.push({
      id: 'knightOutpost',
      label: 'Knight outpost',
      squares: [move.to],
      square: makeSquare(move.to),
      positive: true,
      priority: 60,
    });
  }

  // Rook on open file / half-open file / 7th rank
  if (movedPiece.role === 'rook') {
    const file = squareFile(move.to);
    const rank = squareRank(move.to);
    const seventh = color === 'white' ? 6 : 1;
    const fileMask = SquareSet.fromFile(file);
    const ownPawnsOnFile = after.board[color].intersect(after.board.pawn).intersect(fileMask).nonEmpty();
    const oppPawnsOnFile = after.board[opp].intersect(after.board.pawn).intersect(fileMask).nonEmpty();
    if (rank === seventh && squareRank(move.from) !== seventh) {
      deltas.push({ id: 'rookSeventh', label: 'Rook on the 7th rank', squares: [move.to], square: makeSquare(move.to), positive: true, priority: 61 });
    } else if (!ownPawnsOnFile && !oppPawnsOnFile && squareFile(move.from) !== file) {
      deltas.push({ id: 'openFile', label: 'Controls open file', squares: [move.to], file: 'abcdefgh'[file], positive: true, priority: 52 });
    } else if (!ownPawnsOnFile && oppPawnsOnFile && squareFile(move.from) !== file) {
      deltas.push({ id: 'halfOpenFile', label: 'Half-open file', squares: [move.to], file: 'abcdefgh'[file], positive: true, priority: 44 });
    }
  }

  // Bishop pair won / lost
  const bpBefore = before.board[color].intersect(before.board.bishop).size() >= 2;
  const bpOppBefore = before.board[opp].intersect(before.board.bishop).size() >= 2;
  const bpOppAfter = after.board[opp].intersect(after.board.bishop).size() >= 2;
  if (bpOppBefore && !bpOppAfter) {
    deltas.push({ id: 'wonBishopPair', label: bpBefore ? 'Gains bishop pair' : 'Trades enemy bishop pair', squares: [move.to], positive: true, priority: 48 });
  }

  // Pawn structure damage / self-damage
  const oppBefore = pawnFeatures(before.board, opp);
  const oppAfter = pawnFeatures(after.board, opp);
  if (oppAfter.doubled > oppBefore.doubled || oppAfter.isolated > oppBefore.isolated) {
    deltas.push({ id: 'damagedEnemyPawns', label: 'Damages pawn structure', squares: [move.to], positive: true, priority: 45 });
  }
  if (pAfter.doubled > pBefore.doubled && !detectCapture(before, move)) {
    deltas.push({ id: 'selfWeakPawns', label: 'Doubles own pawns', squares: [move.to], positive: false, priority: 35 });
  }

  // King safety
  const ownKsBefore = kingSafetyMetrics(before, color);
  const ownKsAfter = kingSafetyMetrics(after, color);
  const lostCastlingRights = !variant.castlingSide(before, move) && piece.role === 'king' &&
    before.castles.castlingRights.intersect(SquareSet.backrank(color)).nonEmpty();
  if (lostCastlingRights) {
    deltas.push({ id: 'lostCastling', label: 'Loses castling rights', squares: [move.to], positive: false, priority: 50 });
  } else if (ownKsBefore.castled && ownKsAfter.shield < ownKsBefore.shield && phase !== 'endgame') {
    deltas.push({ id: 'weakenedKingShield', label: 'Weakens king shelter', squares: [move.to], positive: false, priority: 54 });
  }

  const oppKsBefore = kingSafetyMetrics(before, opp);
  const oppKsAfter = kingSafetyMetrics(after, opp);
  if (oppKsAfter.attackers >= oppKsBefore.attackers + 2 && phase !== 'endgame') {
    const oppKing = after.board.kingOf(opp);
    deltas.push({ id: 'kingPressure', label: 'Increases king pressure', squares: oppKing !== undefined ? [move.to, oppKing] : [move.to], positive: true, priority: 56 });
  }

  // Opening development & central control
  const backRank = color === 'white' ? 0 : 7;
  if (phase === 'opening' && (piece.role === 'knight' || piece.role === 'bishop') && squareRank(move.from) === backRank) {
    deltas.push({ id: 'development', label: `Develops the ${piece.role}`, squares: [move.to], pieceRole: piece.role, positive: true, priority: 38 });
  } else if (phase !== 'endgame' && CENTER.has(makeSquare(move.to)) && !CENTER.has(makeSquare(move.from))) {
    deltas.push({ id: 'centerControl', label: 'Claims central space', squares: [move.to], pieceRole: piece.role, square: makeSquare(move.to), positive: true, priority: 34 });
  } else if (phase === 'endgame' && piece.role === 'king' && EXTENDED_CENTER.has(makeSquare(move.to)) && !EXTENDED_CENTER.has(makeSquare(move.from))) {
    deltas.push({ id: 'kingActivity', label: 'Activates the king', squares: [move.to], positive: true, priority: 53 });
  }

  return deltas.sort((a, b) => b.priority - a.priority);
}

/**
 * Classifies endgame type & elementary endgame heuristics.
 */
export function classifyEndgame(position) {
  const b = position.board;
  if (majorsAndMinors(b) > 6) return null;

  const wQ = b.white.intersect(b.queen).size(), bQ = b.black.intersect(b.queen).size();
  const wR = b.white.intersect(b.rook).size(), bR = b.black.intersect(b.rook).size();
  const wB = b.white.intersect(b.bishop), bB = b.black.intersect(b.bishop);
  const wN = b.white.intersect(b.knight).size(), bN = b.black.intersect(b.knight).size();
  const q = wQ + bQ, r = wR + bR, bi = wB.size() + bB.size(), n = wN + bN;

  let type = 'Endgame';
  if (q === 0 && r === 0 && bi === 0 && n === 0) {
    type = 'Pawn endgame';
  } else if (q === 0 && r > 0 && bi === 0 && n === 0) {
    type = 'Rook endgame';
  } else if (q === 0 && r === 0 && wB.size() === 1 && bB.size() === 1 && n === 0) {
    const light = SquareSet.lightSquares();
    const wLight = wB.intersects(light);
    const bLight = bB.intersects(light);
    type = wLight !== bLight ? 'Opposite-colored bishops' : 'Same-colored bishops';
  } else if (q === 0 && r === 0 && bi === 0 && n > 0) {
    type = 'Knight endgame';
  } else if (q === 0 && r === 0 && ((wB.size() > 0 && bN > 0 && bB.size() === 0 && wN === 0) || (bB.size() > 0 && wN > 0 && wB.size() === 0 && bN === 0))) {
    type = 'Bishop vs. Knight';
  } else if (q === 0 && r === 0 && bi > 0 && n === 0) {
    type = 'Bishop endgame';
  } else if (q > 0 && r === 0 && bi === 0 && n === 0) {
    type = 'Queen endgame';
  } else if (q > 0 && r > 0 && bi === 0 && n === 0) {
    type = 'Queen & Rook endgame';
  } else if (q === 0 && r > 0 && (bi + n) > 0) {
    type = 'Rook & Minor piece endgame';
  } else if (q === 0 && r === 0) {
    type = 'Minor piece endgame';
  }

  const notes = [];
  const wk = b.kingOf('white'), bk = b.kingOf('black');

  // Direct opposition in pawn endgames
  if (type === 'Pawn endgame' && wk !== undefined && bk !== undefined) {
    const df = Math.abs(squareFile(wk) - squareFile(bk));
    const dr = Math.abs(squareRank(wk) - squareRank(bk));
    if ((df === 0 && dr === 2) || (dr === 0 && df === 2)) {
      notes.push(`${opposite(position.turn) === 'white' ? 'White' : 'Black'} holds direct opposition`);
    }
  }

  // Rule of the square for unstoppable passed pawn in pawn endgames
  if (type === 'Pawn endgame' && wk !== undefined && bk !== undefined) {
    for (const color of ['white', 'black']) {
      const oppKing = color === 'white' ? bk : wk;
      const { passed } = pawnFeatures(b, color);
      for (const p of passed) {
        const promoSq = squareFile(p.sq) + (color === 'white' ? 56 : 0);
        const kingDist = Math.max(Math.abs(squareFile(oppKing) - squareFile(promoSq)), Math.abs(squareRank(oppKing) - squareRank(promoSq)));
        const pawnSteps = p.promoDist - (position.turn === color ? 1 : 0);
        if (kingDist > Math.max(1, pawnSteps)) {
          notes.push(`${color === 'white' ? 'White' : 'Black'} has an outside unstoppable passed pawn on ${makeSquare(p.sq)}`);
          break;
        }
      }
    }
  }

  // Rook behind passed pawn
  if (type === 'Rook endgame') {
    for (const color of ['white', 'black']) {
      const { passed } = pawnFeatures(b, color);
      for (const p of passed) {
        const fileMask = SquareSet.fromFile(squareFile(p.sq));
        const rooks = b.rook.intersect(fileMask);
        for (const rSq of rooks) {
          const behind = color === 'white' ? squareRank(rSq) < squareRank(p.sq) : squareRank(rSq) > squareRank(p.sq);
          if (behind && between(rSq, p.sq).intersect(b.occupied).isEmpty()) {
            const owner = b.getColor(rSq);
            notes.push(`${owner === 'white' ? 'White' : 'Black'} rook stands behind the ${makeSquare(p.sq)} passed pawn`);
            break;
          }
        }
      }
    }
  }

  return { type, pieces: b.occupied.size(), notes };
}

/**
 * Generates Chessground autoShape primitives (circles & arrows) for the top tactical motif.
 */
export function motifBoardShapes(motifs, brush = 'yellow') {
  if (!motifs?.length) return [];
  const top = motifs[0];
  const shapes = [];
  if (top.arrows?.length) {
    for (const a of top.arrows.slice(0, 2)) {
      shapes.push({ orig: a.orig, dest: a.dest, brush });
    }
  } else if (top.squares?.length) {
    for (const sq of top.squares.slice(0, 3)) {
      const name = typeof sq === 'number' ? makeSquare(sq) : sq;
      shapes.push({ orig: name, brush });
    }
  }
  return shapes;
}
