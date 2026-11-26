import { Chess, fen, parseUci, san, squareRank, variant } from './vendor/chessops.bundle.js';
import { standardUci } from './game-state.js';

export const DIFFICULTY_ORDER = ['relaxed', 'standard', 'strong', 'maximum'];

export const LEVELS = {
  relaxed: { label: 'Relaxed', skill: 0, elo: null, depth: 1, time: 120 },
  standard: { label: 'Standard', skill: 2, elo: 1450, depth: 5, time: 240 },
  strong: { label: 'Strong', skill: 8, elo: 2050, depth: 10, time: 450 },
  maximum: { label: 'Maximum', skill: 20, elo: null, depth: null, time: 700 },
};

function eloProfile(label, elo, description, [relaxed, standard, strong, maximum]) {
  return {
    label,
    listLabel: `${label} · ${elo} Elo`,
    description,
    elo,
    depths: { relaxed, standard, strong, maximum },
  };
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
  elo1320: eloProfile('Beginner', 1320, 'Lowest native Stockfish target', [1, 4, 8, 12]),
  elo1450: eloProfile('Casual', 1450, 'Practice spotting simple tactics', [1, 4, 8, 13]),
  elo1600: eloProfile('Intermediate', 1600, 'Practice defending against threats', [2, 5, 9, 14]),
  elo1750: eloProfile('Club', 1750, 'Practice looking a few moves ahead', [2, 6, 10, 15]),
  elo1900: eloProfile('Advanced', 1900, 'Practice finding tactical opportunities', [3, 7, 11, 16]),
  elo2050: eloProfile('Competitive', 2050, 'Practice holding difficult positions', [3, 7, 11, 17]),
  elo2200: eloProfile('Expert', 2200, 'Practice calculating longer lines', [4, 8, 12, 18]),
  elo2500: eloProfile('Elite', 2500, 'Practice against a strong opponent', [5, 10, 14, 20]),
  elo2800: eloProfile('Champion', 2800, 'A high-strength Stockfish target', [6, 11, 16, 23]),
  elo3100: eloProfile('Extreme', 3100, 'Highest preset with an Elo target', [7, 13, 18, 26]),
  max: {
    label: 'Stockfish Max',
    listLabel: 'Stockfish Max',
    description: 'Stockfish Lite with strength limiting off',
    times: { relaxed: 150, standard: 350, strong: 700, maximum: 1200 },
  },
};

export function botSearchConfig(difficulty, bot = 'default') {
  const levelKey = Object.hasOwn(LEVELS, difficulty) ? difficulty : 'standard';
  const botKey = Object.hasOwn(BOT_PROFILES, bot) ? bot : 'default';
  const base = LEVELS[levelKey];
  const profile = BOT_PROFILES[botKey];

  if (botKey === 'default') return { ...base, bot: botKey, botLabel: profile.label };
  if (botKey === 'elo250') {
    return { ...base, bot: botKey, botLabel: profile.label, skill: 0, elo: null, lines: 3 };
  }
  if (botKey === 'blitz') {
    return {
      ...base,
      bot: botKey,
      botLabel: profile.label,
      depth: base.depth === null ? null : Math.max(1, Math.round(base.depth * 0.6)),
      time: Math.max(40, Math.round(base.time * 0.45)),
    };
  }
  if (botKey === 'classical') {
    return {
      ...base,
      bot: botKey,
      botLabel: profile.label,
      depth: base.depth === null ? null : base.depth + 2,
      time: Math.round(base.time * 1.75),
    };
  }
  if (botKey === 'max') {
    return {
      label: base.label,
      bot: botKey,
      botLabel: profile.label,
      skill: 20,
      elo: null,
      depth: null,
      time: profile.times[levelKey],
    };
  }
  return {
    label: base.label,
    bot: botKey,
    botLabel: profile.label,
    skill: base.skill,
    elo: profile.elo,
    depth: profile.depths[levelKey],
    time: base.time,
  };
}

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
  // Two tabs can finish different games from the same saved position.
  return { ...game, id: gameId(), outcome, finishedAt: Date.now() };
}

export function legalMove(position, uci) {
  const parsed = parseUci(uci);
  if (!parsed || !('from' in parsed)) return null;
  const move = variant.normalizeMove(position, parsed);
  if (parsed.promotion && move.promotion !== parsed.promotion) return null;
  return position.isLegal(move) ? move : null;
}

export function rookieMove(position, { move, lines }, random = Math.random) {
  const best = move && legalMove(position, move);
  if (!best) return null;
  const bestUci = standardUci(position, best);
  if (random() >= 0.70) return bestUci;

  const recommendations = new Set([bestUci]);
  for (const line of lines) {
    const candidate = legalMove(position, line.pv[0]);
    if (candidate) recommendations.add(standardUci(position, candidate));
  }

  const alternatives = [];
  const promotionRank = position.turn === 'white' ? 7 : 0;
  for (const [from, destinations] of position.allDests()) {
    const isPawn = position.board.getRole(from) === 'pawn';
    for (const to of destinations) {
      const candidate = isPawn && squareRank(to) === promotionRank
        ? { from, to, promotion: 'queen' }
        : { from, to };
      const uci = standardUci(position, candidate);
      if (!recommendations.has(uci)) alternatives.push(uci);
    }
  }
  if (!alternatives.length) return bestUci;
  return alternatives[Math.floor(random() * alternatives.length)];
}

export function needsPromotion(position, uci) {
  return uci.length === 4 && !legalMove(position, uci) && Boolean(legalMove(position, uci + 'q'));
}

function repetitionKey(value) {
  return value.split(' ', 4).join(' ');
}

function result(position, nextFen, moves) {
  if (position.isCheckmate()) return { winner: opposite(position.turn), reason: 'Checkmate' };
  if (position.isStalemate()) return { winner: null, reason: 'Stalemate' };
  if (position.isInsufficientMaterial()) return { winner: null, reason: 'Insufficient material' };
  if (position.halfmoves >= 100) return { winner: null, reason: 'Fifty-move rule' };

  const key = repetitionKey(nextFen);
  const priorPositions = [fen.INITIAL_FEN, ...moves.map(move => move.fen)];
  if (priorPositions.filter(value => repetitionKey(value) === key).length >= 2) {
    return { winner: null, reason: 'Threefold repetition' };
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
