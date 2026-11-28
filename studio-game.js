import { Chess, fen, parseUci, san, squareRank, variant } from './vendor/chessops.bundle.js';
import { standardUci } from './game-state.js';

export const DIFFICULTY_ORDER = ['relaxed', 'standard', 'strong', 'maximum'];

export const LEVELS = {
  relaxed: { label: 'Relaxed', elo: 1320, time: 200 },
  standard: { label: 'Standard', elo: 1450, time: 400 },
  strong: { label: 'Strong', elo: 2050, time: 800 },
  maximum: { label: 'Maximum', elo: null, time: 1600 },
};

function eloProfile(label, targets, time = 400) {
  return { label, listLabel: `${label} · ${targets[0]}–${targets.at(-1)} Elo target`, targets, time };
}

export const BOT_PROFILES = {
  default: {
    label: 'Stockfish 19',
    listLabel: 'Default',
    description: 'Standard search time',
  },
  blitz: {
    label: 'Stockfish Blitz',
    listLabel: 'Stockfish Blitz',
    description: 'Half the default search time',
    timeScale: 0.5,
  },
  classical: {
    label: 'Stockfish Classical',
    listLabel: 'Stockfish Classical',
    description: 'More time to calculate each move',
    timeScale: 1.5,
  },
  elo250: {
    label: 'Rookie',
    listLabel: 'Rookie · Maia-3',
    description: 'Human-like moves. The model downloads on first use.',
    maiaRatings: [600, 750, 900, 1000],
  },
  elo1320: eloProfile('Beginner', [1320, 1400, 1450, 1500]),
  elo1450: eloProfile('Casual', [1380, 1450, 1550, 1650]),
  elo1600: eloProfile('Intermediate', [1500, 1600, 1700, 1800]),
  elo1750: eloProfile('Club', [1650, 1750, 1850, 1950]),
  elo1900: eloProfile('Advanced', [1800, 1900, 2000, 2100]),
  elo2050: eloProfile('Competitive', [1950, 2050, 2150, 2250], 500),
  elo2200: eloProfile('Expert', [2100, 2200, 2300, 2400], 750),
  elo2500: eloProfile('Elite', [2400, 2500, 2600, 2700], 1200),
  elo2800: eloProfile('Champion', [2700, 2800, 2900, 3000], 2000),
  elo3100: eloProfile('Extreme', [3000, 3100, 3150, 3190], 2800),
  max: {
    label: 'Stockfish Max',
    listLabel: 'Stockfish Max',
    description: 'No Elo limit · twice the default search time',
    timeScale: 2,
    unlimited: true,
  },
};

export function botSearchConfig(difficulty, bot = 'default') {
  const levelKey = Object.hasOwn(LEVELS, difficulty) ? difficulty : 'standard';
  const botKey = Object.hasOwn(BOT_PROFILES, bot) ? bot : 'default';
  const profile = BOT_PROFILES[botKey];
  const { label, elo, time } = LEVELS[levelKey];
  const base = { label, bot: botKey, botLabel: profile.label };
  const index = DIFFICULTY_ORDER.indexOf(levelKey);

  if (profile.maiaRatings) {
    return { ...base, maiaRating: profile.maiaRatings[index] };
  }
  if (profile.targets) {
    return { ...base, elo: profile.targets[index], time: profile.time };
  }
  return { ...base, elo: profile.unlimited ? null : elo, time: time * (profile.timeScale ?? 1) };
}

export function botSearchSummary(difficulty, bot) {
  const { elo, time, maiaRating } = botSearchConfig(difficulty, bot);
  if (maiaRating !== undefined) return `Maia-3 · Lichess ${maiaRating} style`;
  const strength = elo === null ? 'No Elo limit' : `${elo} Elo target`;
  return `${strength} · up to ${time / 1000} s per move`;
}

export const opposite = color => color === 'white' ? 'black' : 'white';
export const fenAt = (game, ply) => game.moves[ply - 1]?.fen ?? fen.INITIAL_FEN;
export const positionAt = (game, ply) => positionFromFen(fenAt(game, ply));
export const positionFromFen = value => Chess.fromSetup(fen.parseFen(value).unwrap()).unwrap();

export function maiaPosition(game, selfElo) {
  const ply = game.moves.length;
  const start = Math.max(0, ply - 7);
  const priorFens = Array.from({ length: ply - start }, (_, index) => fenAt(game, start + index));
  return { fen: fenAt(game, ply), priorFens, selfElo };
}

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

export function mateInOne(position) {
  for (const move of legalCandidates(position)) {
    const after = position.clone();
    after.play(move);
    if (after.isCheckmate()) return standardUci(position, move);
  }
  return null;
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
