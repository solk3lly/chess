import { Chess, fen, parseUci, san, squareRank, variant } from './vendor/chessops.bundle.js';
import { standardUci } from './game-state.js';

export const DIFFICULTY_ORDER = ['relaxed', 'standard', 'strong', 'maximum'];

export const LEVELS = {
  relaxed: { label: 'Relaxed', skill: 0, elo: null, time: 160 },
  standard: { label: 'Standard', skill: 2, elo: 1450, time: 350 },
  strong: { label: 'Strong', skill: 8, elo: 2050, time: 700 },
  maximum: { label: 'Maximum', skill: 20, elo: null, time: 1200 },
};

function eloProfile(label, elo, description) {
  return { label, listLabel: `${label} · ${elo} Elo target`, description, elo };
}

export const BOT_PROFILES = {
  default: {
    label: 'Stockfish 19',
    listLabel: 'Default',
    description: 'Balanced Stockfish 19',
  },
  blitz: {
    label: 'Stockfish Blitz',
    listLabel: 'Stockfish Blitz',
    description: 'Fast replies · shorter think time',
  },
  classical: {
    label: 'Stockfish Classical',
    listLabel: 'Stockfish Classical',
    description: 'Deep calculation · longer think time',
  },
  elo250: {
    label: 'Rookie',
    listLabel: 'Rookie · 250 Elo target',
    description: 'A forgiving opponent that sometimes misses simple moves.',
  },
  elo1320: eloProfile('Beginner', 1320, 'Lowest native Stockfish target'),
  elo1450: eloProfile('Casual', 1450, 'Practice spotting simple tactics'),
  elo1600: eloProfile('Intermediate', 1600, 'Practice defending against threats'),
  elo1750: eloProfile('Club', 1750, 'Practice looking a few moves ahead'),
  elo1900: eloProfile('Advanced', 1900, 'Practice finding tactical opportunities'),
  elo2050: eloProfile('Competitive', 2050, 'Practice holding difficult positions'),
  elo2200: eloProfile('Expert', 2200, 'Practice calculating longer lines'),
  elo2500: eloProfile('Elite', 2500, 'Practice against a strong opponent'),
  elo2800: eloProfile('Champion', 2800, 'A high-strength Stockfish target'),
  elo3100: eloProfile('Extreme', 3100, 'Highest preset with an Elo target'),
  max: {
    label: 'Stockfish Max',
    listLabel: 'Stockfish Max',
    description: 'Stockfish Lite with strength limiting off',
    times: { relaxed: 200, standard: 450, strong: 850, maximum: 1500 },
  },
};

export function botSearchConfig(difficulty, bot = 'default') {
  const levelKey = Object.hasOwn(LEVELS, difficulty) ? difficulty : 'standard';
  const botKey = Object.hasOwn(BOT_PROFILES, bot) ? bot : 'default';
  const profile = BOT_PROFILES[botKey];
  const base = { ...LEVELS[levelKey], depth: null, bot: botKey, botLabel: profile.label };

  if (botKey === 'elo250') {
    return { ...base, skill: 0, elo: null, lines: 3 };
  }
  if (botKey === 'blitz') {
    return { ...base, time: Math.round(base.time * 0.45) };
  }
  if (botKey === 'classical') {
    return { ...base, time: Math.round(base.time * 1.75) };
  }
  if (botKey === 'max') {
    return { ...base, skill: 20, elo: null, time: profile.times[levelKey] };
  }
  return { ...base, elo: profile.elo ?? base.elo };
}

export const botSearchTime = (difficulty, bot) => `${botSearchConfig(difficulty, bot).time / 1000} s per move`;

export const opposite = color => color === 'white' ? 'black' : 'white';
export const fenAt = (game, ply) => game.moves[ply - 1]?.fen ?? fen.INITIAL_FEN;
export const positionAt = (game, ply) => positionFromFen(fenAt(game, ply));
export const positionFromFen = value => Chess.fromSetup(fen.parseFen(value).unwrap()).unwrap();

function gameId() {
  return globalThis.crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
}

export function newGame({ color, difficulty, bot = 'default' }) {
  const validBot = Object.hasOwn(BOT_PROFILES, bot) ? bot : 'default';
  return { id: gameId(), human: color, difficulty, bot: validBot, moves: [], outcome: null, finishedAt: null };
}

function completeGame(game, outcome) {
  return { ...game, id: gameId(), outcome, finishedAt: Date.now() };
}

export function legalMove(position, uci) {
  const parsed = parseUci(uci);
  if (!parsed || !('from' in parsed)) return null;
  const move = variant.normalizeMove(position, parsed);
  if (parsed.promotion && move.promotion !== parsed.promotion) return null;
  return position.isLegal(move) ? move : null;
}

function* legalCandidates(position) {
  const promotionRank = position.turn === 'white' ? 7 : 0;
  for (const [from, destinations] of position.allDests()) {
    const isPawn = position.board.getRole(from) === 'pawn';
    for (const to of destinations) {
      if (isPawn && squareRank(to) === promotionRank) {
        for (const promotion of ['queen', 'rook', 'bishop', 'knight']) yield { from, to, promotion };
      } else {
        yield { from, to };
      }
    }
  }
}

export function rookieMove(position, { move, lines }, random = Math.random) {
  const best = move && legalMove(position, move);
  if (!best) return null;
  const bestUci = standardUci(position, best);
  const recommendations = new Set([bestUci]);
  for (const line of lines) {
    const candidate = legalMove(position, line.pv[0]);
    if (candidate) recommendations.add(standardUci(position, candidate));
  }

  const alternatives = [];
  for (const candidate of legalCandidates(position)) {
    const after = position.clone();
    after.play(candidate);
    const uci = standardUci(position, candidate);
    if (after.isCheckmate()) return uci;
    if (!recommendations.has(uci)) alternatives.push(uci);
  }
  if (!alternatives.length || random() >= 0.70) return bestUci;
  return alternatives[Math.floor(random() * alternatives.length)];
}

export function needsPromotion(position, uci) {
  return uci.length === 4 && !legalMove(position, uci) && Boolean(legalMove(position, uci + 'q'));
}

function repetitionKey(value) {
  return value.split(' ', 4).join(' ');
}

function repetitions(moves) {
  const counts = new Map([[repetitionKey(fen.INITIAL_FEN), 1]]);
  for (const { fen: value } of moves) {
    const key = repetitionKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function claimReason(halfmoves, count) {
  if (halfmoves >= 100) return 'Fifty-move rule';
  return count >= 3 ? 'Threefold repetition' : null;
}

export function drawClaims(game, position = positionAt(game, game.moves.length)) {
  const claims = { now: null, moves: [] };
  if (game.outcome || position.turn !== game.human ||
      (game.moves.length < 7 && position.halfmoves < 99)) return claims;
  const counts = repetitions(game.moves);
  const current = repetitionKey(fen.makeFen(position.toSetup()));
  claims.now = claimReason(position.halfmoves, counts.get(current));
  if (claims.now || (position.halfmoves < 99 && ![...counts.values()].some(count => count >= 2))) return claims;

  for (const move of legalCandidates(position)) {
    const after = position.clone();
    after.play(move);
    const key = repetitionKey(fen.makeFen(after.toSetup()));
    const reason = claimReason(after.halfmoves, (counts.get(key) ?? 0) + 1);
    if (reason) claims.moves.push({ uci: standardUci(position, move), san: san.makeSan(position, move), reason });
  }
  return claims;
}

export function claimDraw(game, uci) {
  const { now, moves } = drawClaims(game);
  const intended = moves.find(move => move.uci === uci);
  const reason = uci ? intended?.reason : now;
  if (!reason) return game;
  return completeGame(game, { winner: null, reason, claimed: true, ...(intended && { intendedMove: intended.san }) });
}

function result(position, nextFen, moves) {
  if (position.isCheckmate()) return { winner: opposite(position.turn), reason: 'Checkmate' };
  if (position.isStalemate()) return { winner: null, reason: 'Stalemate' };
  if (position.isInsufficientMaterial()) return { winner: null, reason: 'Insufficient material' };
  if (position.halfmoves >= 150) return { winner: null, reason: 'Seventy-five-move rule' };
  if (moves.length >= 15 && repetitions(moves).get(repetitionKey(nextFen)) >= 4) {
    return { winner: null, reason: 'Fivefold repetition' };
  }
  return null;
}

export function playMove(game, uci) {
  if (game.outcome) return null;
  const position = positionAt(game, game.moves.length);
  const move = legalMove(position, uci);
  if (!move) return null;

  const entry = { uci: standardUci(position, move), san: san.makeSan(position, move) };
  position.play(move);
  entry.fen = fen.makeFen(position.toSetup());
  const outcome = result(position, entry.fen, game.moves);
  const next = { ...game, moves: [...game.moves, entry] };
  return outcome ? completeGame(next, outcome) : next;
}

export function resign(game) {
  if (game.outcome || !game.moves.length) return game;
  return completeGame(game, { winner: opposite(game.human), reason: 'Resignation' });
}

export function undoTurn(game) {
  if (game.outcome) return game;
  let ply = game.moves.length;
  while (ply > 0 && positionAt(game, ply - 1).turn !== game.human) ply--;
  return ply ? { ...game, moves: game.moves.slice(0, ply - 1) } : game;
}

export function setDifficulty(game, difficulty, bot = game.bot ?? 'default') {
  if (game.outcome || !Object.hasOwn(LEVELS, difficulty) || !Object.hasOwn(BOT_PROFILES, bot)) return game;
  const currentBot = game.bot ?? 'default';
  if (game.difficulty === difficulty && currentBot === bot) return game;
  return { ...game, difficulty, bot };
}

export function validGame(game) {
  if (!game || typeof game !== 'object') return false;
  if (typeof game.id !== 'string' || !game.id) return false;
  if (game.human !== 'white' && game.human !== 'black') return false;
  if (!Object.hasOwn(LEVELS, game.difficulty) || !Array.isArray(game.moves)) return false;
  if (game.bot !== undefined && !Object.hasOwn(BOT_PROFILES, game.bot)) return false;
  try {
    positionAt(game, game.moves.length);
    return true;
  } catch {
    return false;
  }
}

export function validExercise(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) return false;
  if (!entry.row || (entry.row.color !== 'white' && entry.row.color !== 'black')) return false;
  if (typeof entry.fen !== 'string') return false;
  try {
    positionFromFen(entry.fen);
    return true;
  } catch {
    return false;
  }
}
