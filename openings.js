import { fen, san, squareRank } from './vendor/chessops.bundle.js';
import { standardUci } from './game-state.js';
import { positionAt } from './studio-game.js';

let cachedPromise = null;
let cachedDb = null;

export function setOpeningsData(data) {
  cachedDb = data;
  cachedPromise = Promise.resolve(data);
}

export async function loadOpenings() {
  if (cachedDb) return cachedDb;
  if (!cachedPromise) {
    cachedPromise = fetch(new URL('./assets/openings.json', import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error(`Opening book HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        cachedDb = data;
        return data;
      })
      .catch(() => {
        cachedPromise = null;
        return null;
      });
  }
  return cachedPromise;
}

export function epdFromPosition(position) {
  return fen.makeFen(position.toSetup(), { epd: true });
}

export function epdFromFen(value) {
  return value.split(' ', 4).join(' ');
}

function* legalMoves(position) {
  const promoRank = position.turn === 'white' ? 7 : 0;
  for (const [from, dests] of position.allDests()) {
    const isPawn = position.board.getRole(from) === 'pawn';
    for (const to of dests) {
      if (isPawn && squareRank(to) === promoRank) {
        yield { from, to, promotion: 'queen' };
      } else {
        yield { from, to };
      }
    }
  }
}

export function lookupOpening(position, db = cachedDb) {
  if (!db) return null;
  const entry = db[epdFromPosition(position)];
  if (!entry) return null;
  if (Array.isArray(entry)) return { eco: entry[0], name: entry[1], named: true };
  return { eco: null, name: null, named: false };
}

export function bookContinuations(position, db = cachedDb, limit = 4) {
  if (!db) return [];
  const results = [];
  for (const move of legalMoves(position)) {
    const next = position.clone();
    next.play(move);
    const entry = db[epdFromPosition(next)];
    if (!entry) continue;
    const named = Array.isArray(entry);
    results.push({
      uci: standardUci(position, move),
      san: san.makeSan(position, move),
      eco: named ? entry[0] : null,
      name: named ? entry[1] : null,
      named,
    });
  }
  results.sort((a, b) => Number(b.named) - Number(a.named) || a.san.localeCompare(b.san));
  return results.slice(0, limit);
}

export function analyzeOpening(game, db = cachedDb) {
  if (!db || !game.moves.length) {
    return { opening: null, bookPlies: new Set(), lastBookPly: 0, theoryExit: null };
  }

  const maxScan = Math.min(game.moves.length, 36);
  const bookPlies = new Set();
  let inContinuousBook = true;
  let lastBookPly = 0;
  let opening = null;

  for (let ply = 1; ply <= maxScan; ply++) {
    const epd = epdFromFen(game.moves[ply - 1].fen);
    const entry = db[epd];
    if (entry) {
      if (Array.isArray(entry) && (inContinuousBook || ply <= 24)) {
        opening = { eco: entry[0], name: entry[1], ply };
      }
      if (inContinuousBook) {
        bookPlies.add(ply);
        lastBookPly = ply;
      }
    } else if (inContinuousBook) {
      inContinuousBook = false;
    }
  }

  let theoryExit = null;
  if (lastBookPly >= 2 && lastBookPly < game.moves.length) {
    const exitPly = lastBookPly + 1;
    const posBefore = positionAt(game, exitPly - 1);
    const move = game.moves[exitPly - 1];
    const bookAlternatives = bookContinuations(posBefore, db, 4)
      .filter(candidate => candidate.uci !== move.uci);
    if (bookAlternatives.length) {
      theoryExit = {
        ply: exitPly,
        color: posBefore.turn,
        san: move.san,
        uci: move.uci,
        bookAlternatives,
      };
    }
  }

  return { opening, bookPlies, lastBookPly, theoryExit };
}
