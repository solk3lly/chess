import { kingCastlesTo, makeUci, squareFile, variant } from './vendor/chessops.bundle.js';

export function detectCapture(position, move) {
  if (!('from' in move)) return null;
  const movingPiece = position.board.get(move.from);
  if (!movingPiece) return null;

  const captured = position.board.get(move.to);
  if (captured) return captured.color === movingPiece.color ? null : captured;

  if (movingPiece.role === 'pawn' && squareFile(move.from) !== squareFile(move.to)) {
    return { color: movingPiece.color === 'white' ? 'black' : 'white', role: 'pawn' };
  }

  return null;
}

export function standardUci(position, move) {
  const side = variant.castlingSide(position, move);
  return makeUci(side ? { ...move, to: kingCastlesTo(position.turn, side) } : move);
}
