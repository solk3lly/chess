import { makeSquare } from './vendor/chessops.bundle.js';

function roleName(role) {
  return role || 'piece';
}

function formatSq(sq) {
  return typeof sq === 'number' ? makeSquare(sq) : sq;
}

function motifPhrase(motif, subject = 'move') {
  if (!motif) return null;
  switch (motif.id) {
    case 'smotheredMate': return 'delivers a smothered checkmate';
    case 'backRankMate': return 'delivers a back-rank checkmate';
    case 'arabianMate': return 'delivers an Arabian checkmate';
    case 'anastasiaMate': return "delivers Anastasia's checkmate";
    case 'bodenMate': return "delivers Boden's checkmate";
    case 'doubleBishopMate': return 'delivers a double-bishop checkmate';
    case 'hookMate': return 'delivers a hook checkmate';
    case 'dovetailMate': return 'delivers a dovetail checkmate';
    case 'checkmate': return 'delivers checkmate';
    case 'underPromotion': return `underpromotes to a ${roleName(motif.pieceRole)}`;
    case 'promotion': return 'promotes the pawn to a queen';
    case 'doubleCheck': return 'gives double check, forcing the king to move';
    case 'discoveredCheck': return 'unleashes a discovered check';
    case 'discoveredAttack': return `unleashes a discovered attack on the ${roleName(motif.targetRole)}`;
    case 'fork': {
      const [t1, t2] = motif.targets ?? [];
      return t1 && t2
        ? `forks the ${t1} and ${t2}`
        : 'forks two targets at once';
    }
    case 'pin':
      return motif.behindRole === 'king'
        ? `pins the ${roleName(motif.pinnedRole)} on ${motif.pinnedSquare} to the king`
        : `pins the ${roleName(motif.pinnedRole)} against the ${roleName(motif.behindRole)}`;
    case 'skewer':
      return `skewers the ${roleName(motif.frontRole)} to win the ${roleName(motif.behindRole)} behind it`;
    case 'trappedPiece':
      return `traps the ${roleName(motif.targetRole)} on ${motif.targetSquare}`;
    case 'hangingPiece':
      return `wins the undefended ${roleName(motif.targetRole)} on ${motif.targetSquare}`;
    case 'capturingDefender':
      return `removes the defender of the ${roleName(motif.targetRole)}`;
    case 'deflection':
      return 'deflects a key defender from its post';
    case 'attraction':
      return 'lures the opposing piece onto a vulnerable square';
    case 'interference':
      return 'cuts the line of defense between opposing pieces';
    case 'clearance':
      return 'clears a key square or line for the follow-up';
    case 'intermezzo':
      return 'inserts an in-between threat before recapturing';
    case 'attackingF2F7':
      return `targets the vulnerable ${motif.label.slice(-2)} square`;
    case 'castling':
      return subject === 'move' ? 'castles to shelter the king and connect the rooks' : 'gets the king to safety';
    case 'enPassant':
      return 'captures en passant';
    case 'sacrifice':
      if (motif.sacKind === 'declined') {
        return `offers a poisoned ${roleName(motif.pieceRole)} sacrifice on ${formatSq(motif.square)} that cannot safely be taken`;
      }
      if (motif.sacKind === 'counter') {
        return `ignores the attack on the ${roleName(motif.pieceRole)} on ${formatSq(motif.square)} for a stronger counter-strike`;
      }
      return `sacrifices the ${roleName(motif.pieceRole)} to break open the position`;
    default:
      return motif.label ? motif.label.toLowerCase() : null;
  }
}

function positionalPhrase(delta) {
  if (!delta) return null;
  switch (delta.id) {
    case 'passedPawn': return `creates a ${delta.label.toLowerCase()} on ${delta.square}`;
    case 'advancedPassedPawn': return `pushes the passed pawn dangerously close to promotion on ${delta.square}`;
    case 'knightOutpost': return `anchors a strong knight outpost on ${delta.square}`;
    case 'rookSeventh': return `invades the 7th rank on ${delta.square}`;
    case 'openFile': return `seizes the open ${delta.file}-file`;
    case 'halfOpenFile': return `places the rook on the half-open ${delta.file}-file`;
    case 'wonBishopPair': return 'secures the bishop pair advantage';
    case 'damagedEnemyPawns': return 'damages the opponent’s pawn structure';
    case 'selfWeakPawns': return 'creates structural pawn weaknesses';
    case 'lostCastling': return 'gives up castling rights, leaving the king less safe';
    case 'weakenedKingShield': return 'weakens the pawn shelter in front of the king';
    case 'kingPressure': return 'builds pressure around the enemy king';
    case 'development': return `develops the ${roleName(delta.pieceRole)} into the game`;
    case 'centerControl': return `claims central control on ${delta.square}`;
    case 'kingActivity': return 'centralizes the king for the endgame';
    default: return null;
  }
}

function capitalizeSentence(text) {
  if (!text) return '';
  const trimmed = text.trim();
  const capped = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : capped + '.';
}

function formatPercent(prob) {
  if (typeof prob !== 'number' || !Number.isFinite(prob)) return null;
  return `${Math.max(1, Math.round(prob * 100))}%`;
}

export function describeCandidateIdea(moveSan, motifs, deltas, { isCheck = false, captureRole = null } = {}) {
  const topMotif = motifs?.[0];
  if (topMotif) {
    const phrase = motifPhrase(topMotif, 'move');
    if (phrase) return capitalizeSentence(phrase);
  }
  const topPos = deltas?.find(d => d.positive);
  if (topPos) {
    const phrase = positionalPhrase(topPos);
    if (phrase) return capitalizeSentence(phrase);
  }
  if (captureRole) return `Captures the ${captureRole}${isCheck ? ' with check' : ''}.`;
  if (isCheck) return 'Gives check and forces a response.';
  return `Improves piece coordination with ${moveSan}.`;
}

/**
 * Builds concise, prioritized orthogonal insight chips (max 4).
 */
export function buildInsightChips(facts) {
  const chips = [];
  const seen = new Set();
  const push = (label, tone = 'neutral') => {
    if (!label || seen.has(label) || chips.length >= 4) return;
    seen.add(label);
    chips.push({ label, tone });
  };

  const {
    grade, isError, missedMate, zugzwang, onlyDefense, theoryExit,
    playedMotifs, refutationMotifs, bestMotifs, positionalDeltas,
    endgame, maia, sacrifice,
  } = facts;

  if (missedMate) push(`Missed mate in ${missedMate}`, 'danger');
  if (zugzwang) push('Zugzwang', 'accent');
  if (onlyDefense) push('Only defense', 'positive');
  if (theoryExit) push('Left theory', 'info');

  if (sacrifice && ['Brilliant', 'Great', 'Best move'].includes(grade)) {
    const sacLabel = sacrifice.kind === 'declined' ? 'Poisoned sacrifice'
      : sacrifice.kind === 'counter' ? 'Counter-sacrifice' : 'Sacrifice';
    push(sacLabel, 'accent');
  }

  // Primary tactical motif
  const motifSource = isError
    ? (refutationMotifs?.[0] ?? bestMotifs?.[0])
    : (playedMotifs?.[0] ?? bestMotifs?.[0]);
  if (motifSource && motifSource.id !== 'castling' && motifSource.id !== 'sacrifice') {
    push(motifSource.label, isError ? 'warn' : 'positive');
  }

  // Maia-3 human signals
  if (maia) {
    if (isError && maia.playedProb >= 0.22) {
      push('Common human trap', 'warn');
    } else if (['Brilliant', 'Great', 'Best move'].includes(grade) && maia.bestProb !== null && maia.bestProb <= 0.12) {
      push('Hard to spot', 'accent');
    } else if (Math.abs(maia.practicalGap ?? 0) >= 12) {
      push(maia.practicalGap > 0 ? 'Practical edge' : 'Hard to play', 'info');
    }
  }

  // Positional or endgame fallback chip
  const posChip = positionalDeltas?.find(d => isError ? !d.positive : d.positive);
  if (posChip && !['development', 'centerControl'].includes(posChip.id)) {
    push(posChip.label, posChip.positive ? 'neutral' : 'warn');
  } else if (endgame?.type && endgame.type !== 'Endgame') {
    push(endgame.type, 'neutral');
  }

  return chips;
}

/**
 * Composes a clear, consistent, engine-verified 2-sentence coach explanation.
 */
export function composeExplanation(facts) {
  const {
    san, grade, isError, opening, theoryExit, endgame,
    preferredSan, refutationSan, drop, before, after,
    playedMotifs, refutationMotifs, bestMotifs,
    playedPositional, bestPositional,
    hangingAfterPlayed, threat, zugzwang, missedMate,
    nnueNote, maia, sacrifice, onlyDefense,
  } = facts;

  // 1. Book move
  if (grade === 'Book') {
    const s1 = opening
      ? `Standard opening theory in the ${opening.name} (${opening.eco}).`
      : 'Standard opening book move.';
    const topPos = playedPositional?.find(d => d.positive);
    const s2 = topPos ? capitalizeSentence(positionalPhrase(topPos)) : '';
    return [s1, s2].filter(Boolean).join(' ');
  }

  // 2. Forced move
  if (grade === 'Forced') {
    const s1 = `${san} is the only legal move in this position.`;
    const s2 = endgame?.notes?.[0] ? capitalizeSentence(endgame.notes[0]) : '';
    return [s1, s2].filter(Boolean).join(' ');
  }

  // 3. Brilliant move
  if (grade === 'Brilliant') {
    const sacPhrase = sacrifice
      ? motifPhrase({ id: 'sacrifice', sacKind: sacrifice.kind, pieceRole: sacrifice.pieceRole, square: sacrifice.square })
      : 'gives up material for decisive initiative';
    const followMotif = playedMotifs?.find(m => m.id !== 'sacrifice');
    const s1 = followMotif
      ? `${san} ${sacPhrase} and ${motifPhrase(followMotif)}.`
      : `${san} ${sacPhrase}.`;
    let s2 = '';
    if (maia && maia.bestProb !== null && maia.bestProb <= 0.2) {
      s2 = `Maia assigns this move ${formatPercent(maia.bestProb)} probability at the ~${maia.referenceElo} reference level.`;
    } else if (nnueNote) {
      s2 = nnueNote;
    } else {
      s2 = after >= 60 ? 'Stockfish confirms the sacrifice keeps a clear advantage.' : 'Stockfish confirms the sacrifice saves the position.';
    }
    return `${s1} ${s2}`;
  }

  // 4. Great move
  if (grade === 'Great') {
    const goal = onlyDefense
      ? 'keeps the position alive'
      : (after >= 65 ? 'seizes a decisive edge' : 'holds the balance');
    const s1 = `Of the lines Stockfish compared, ${san} most clearly ${goal}.`;
    const parts = [];
    if (threat?.prevented && threat.san) {
      parts.push(`It neutralizes the threat of ${threat.san}`);
    } else if (playedMotifs?.[0]) {
      parts.push(`It ${motifPhrase(playedMotifs[0])}`);
    } else if (playedPositional?.find(d => d.positive)) {
      parts.push(`It ${positionalPhrase(playedPositional.find(d => d.positive))}`);
    }
    if (maia && maia.bestProb !== null && maia.bestProb <= 0.25) {
      parts.push(`Maia assigns it ${formatPercent(maia.bestProb)} probability at the ~${maia.referenceElo} reference level`);
    }
    const s2 = parts.length ? capitalizeSentence(parts.join(', ')) : (nnueNote || 'The other evaluated lines lose ground.');
    return `${s1} ${s2}`;
  }

  // 5. Miss (failed to punish opponent's blunder)
  if (grade === 'Miss') {
    let s1;
    if (missedMate) {
      s1 = `${san} misses a forced checkmate in ${missedMate} with ${preferredSan}.`;
    } else if (bestMotifs?.[0]) {
      s1 = `${san} misses a winning chance: ${preferredSan} ${motifPhrase(bestMotifs[0])}.`;
    } else {
      s1 = `${san} lets a big opportunity slip after your opponent's error.`;
    }
    const s2Parts = [];
    if (preferredSan && preferredSan !== san) {
      const bestPos = bestPositional?.find(d => d.positive);
      if (bestPos && !bestMotifs?.[0]) {
        s2Parts.push(`${preferredSan} instead ${positionalPhrase(bestPos)}`);
      } else {
        s2Parts.push(`${preferredSan} kept ${Math.round(before)}% expected score instead of dropping to ${Math.round(after)}%`);
      }
    }
    if (maia && maia.playedProb >= 0.22) {
      s2Parts.push(`Maia assigns the played move ${formatPercent(maia.playedProb)} probability at the ~${maia.referenceElo} reference level`);
    }
    return [s1, s2Parts.length ? capitalizeSentence(s2Parts.join(' — ')) : ''].filter(Boolean).join(' ');
  }

  // 6. Errors (Inaccuracy / Mistake / Blunder)
  if (isError) {
    let s1 = '';
    if (missedMate) {
      s1 = `${san} misses a forced checkmate in ${missedMate} with ${preferredSan}.`;
    } else if (refutationMotifs?.[0] && refutationSan) {
      s1 = `${san} allows ${refutationSan}, which ${motifPhrase(refutationMotifs[0])}.`;
    } else if (hangingAfterPlayed?.[0]) {
      const h = hangingAfterPlayed[0];
      const sq = formatSq(h.sq);
      s1 = refutationSan
        ? `${san} leaves the ${h.role} on ${sq} ${h.undefended ? 'undefended' : 'vulnerable'}, allowing ${refutationSan}.`
        : `${san} leaves the ${h.role} on ${sq} ${h.undefended ? 'undefended' : 'under-protected'}.`;
    } else if (threat?.ignored && threat.san) {
      s1 = `${san} overlooks the opponent's threat of ${threat.san}.`;
    } else if (playedPositional?.find(d => !d.positive)) {
      const neg = playedPositional.find(d => !d.positive);
      s1 = `${san} ${positionalPhrase(neg)}.`;
    } else if (theoryExit) {
      const bookAlts = theoryExit.bookAlternatives.slice(0, 2).map(a => a.san).join(' or ');
      s1 = `${san} leaves opening theory prematurely (book lines include ${bookAlts}).`;
    } else if (refutationSan) {
      s1 = `${san} concedes the initiative after ${refutationSan}.`;
    } else {
      s1 = `${san} gives up ${Math.round(drop)} points of expected score.`;
    }

    // Sentence 2: why the best move works (+ human trap context if salient)
    let s2 = '';
    if (preferredSan && preferredSan !== san) {
      if (threat?.prevented && threat.san) {
        s2 = `${preferredSan} instead stops ${threat.san} and keeps the position solid.`;
      } else if (bestMotifs?.[0]) {
        s2 = `${preferredSan} instead ${motifPhrase(bestMotifs[0])}.`;
      } else if (bestPositional?.find(d => d.positive)) {
        s2 = `${preferredSan} instead ${positionalPhrase(bestPositional.find(d => d.positive))}.`;
      } else {
        s2 = `Stockfish preferred ${preferredSan} (+${Math.round(drop)} expected-score points).`;
      }
    }
    if (maia && maia.playedProb >= 0.22 && grade !== 'Inaccuracy') {
      const trapNote = `Common trap: ${formatPercent(maia.playedProb)} of ~${maia.referenceElo} players make this move.`;
      s2 = s2 ? `${s2} ${trapNote}` : trapNote;
    }
    return [s1, s2].filter(Boolean).join(' ');
  }

  // 7. Best move / Excellent / Good
  let s1 = '';
  if (zugzwang) {
    s1 = `${san} puts the opponent in zugzwang, where every legal reply worsens their position.`;
  } else if (playedMotifs?.[0]) {
    s1 = `${san} ${motifPhrase(playedMotifs[0])}.`;
  } else if (threat?.prevented && threat.san) {
    s1 = `${san} proactively prevents the opponent's threat of ${threat.san}.`;
  } else if (playedPositional?.find(d => d.positive)) {
    s1 = `${san} ${positionalPhrase(playedPositional.find(d => d.positive))}.`;
  } else if (theoryExit) {
    const bookAlts = theoryExit.bookAlternatives.slice(0, 2).map(a => a.san).join(' or ');
    s1 = `${san} steps out of opening theory cleanly (main book options were ${bookAlts}).`;
  } else if (grade === 'Best move') {
    s1 = `${san} matches Stockfish's top choice and maintains optimal coordination.`;
  } else {
    s1 = `${san} keeps the position solid and close to Stockfish's top line.`;
  }

  let s2 = '';
  if (grade === 'Good' && preferredSan && preferredSan !== san && drop >= 2) {
    const bestAlt = bestMotifs?.[0] ? ` (${motifPhrase(bestMotifs[0])})` : '';
    s2 = `${preferredSan}${bestAlt} was slightly sharper (+${Math.round(drop)} pts).`;
  } else if (nnueNote) {
    s2 = nnueNote;
  } else if (endgame?.notes?.[0]) {
    s2 = capitalizeSentence(endgame.notes[0]);
  } else if (maia && Math.abs(maia.practicalGap ?? 0) >= 14) {
    s2 = maia.practicalGap > 0
      ? `Practically strong: ~${maia.referenceElo} players score well from this position.`
      : `Tricky to handle in practice despite Stockfish's evaluation.`;
  }

  return [s1, s2].filter(Boolean).join(' ');
}

/**
 * Generates an insightful NNUE attribution summary from before/after Stockfish 19 `eval` traces.
 */
export function summarizeNnueShift(beforeTrace, afterTrace, color, moveToSq) {
  if (!beforeTrace || !afterTrace) return null;
  const sign = color === 'white' ? 1 : -1;

  // Check Material (PSQT) vs Positional (Layers) compensation
  if (afterTrace.psqt !== null && afterTrace.positional !== null) {
    const psqt = afterTrace.psqt * sign;
    const pos = afterTrace.positional * sign;
    if (psqt <= -1.5 && pos >= 1.8) {
      return `NNUE shows strong positional compensation (${pos >= 0 ? '+' : ''}${pos.toFixed(1)} positional vs. ${psqt.toFixed(1)} material).`;
    }
  }

  // Check if the moved piece gained big contextual value on its new square
  const destInfo = afterTrace.pieceValues?.[moveToSq];
  if (destInfo) {
    const nominal = { p: 1, n: 3, b: 3, r: 5, q: 9 }[destInfo.piece.toLowerCase()];
    const ctxVal = destInfo.value * sign;
    if (nominal && ctxVal - nominal >= 1.35) {
      const roleWord = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' }[destInfo.piece.toLowerCase()];
      return `Stockfish's NNUE rates this ${roleWord} on ${moveToSq} at +${ctxVal.toFixed(1)} (+${(ctxVal - nominal).toFixed(1)} above base value).`;
    }
  }

  return null;
}

export function buildPracticeHint(row) {
  if (!row) return '';
  const goodGrades = new Set(['Book', 'Forced', 'Brilliant', 'Great', 'Best move']);
  const usePlayed = goodGrades.has(row.grade);
  const candidate = usePlayed ? row : (row.alternatives?.[0] ?? row);
  const detail = candidate.explanation ?? candidate.idea ?? row.explanation ?? row.idea ?? '';
  return candidate.san ? `${candidate.san}. ${detail}` : detail;
}
