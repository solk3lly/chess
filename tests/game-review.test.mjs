import test from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../review.js';
import { newGame, playMove, resign } from '../studio-game.js';

const game = resign(playMove(newGame({ color: 'white', difficulty: 'standard' }), 'e2e4'));
const line = (uci, cp, depth = 10, tail = []) => ({ score: { type: 'cp', value: cp }, pv: [uci, ...tail], depth });
const batch = (...lines) => ({ lines, depth: lines[0]?.depth ?? 0, iterations: [lines, lines] });
const candidateLines = () => batch(line('d2d4', 90, 10, ['d7d5']), line('e2e4', 20, 10, ['c7c5']));

test('WDL fallback matches the browser engine fit', () => {
  assert.deepEqual(review.stockfishWdlFromCp(75, 58), { win: 222, draw: 778, loss: 0 });
});

test('only settled decisions contribute to accuracy', () => {
  const rows = [
    { ply: 1, color: 'white', accuracy: 100, whiteChance: 60 },
    { ply: 3, color: 'white', accuracy: 10, whiteChance: 40, provisional: true },
  ];
  assert.equal(review.computeSideAccuracy(rows, 'white'), 100);
  assert.equal(review.computeSideAccuracy(rows.slice(1), 'white'), null);
});

test('Maia risk retains uncertainty for unevaluated choices', () => {
  const row = review.buildMoveRow({
    game, ply: 1, phase: 'opening',
    beforeSearch: candidateLines(),
    maiaData: { moves: { d2d4: 0.5, e2e4: 0.1, g1f3: 0.4 }, winProbability: 0.5 },
  });
  assert.deepEqual(row.maia.risk, { low: 0.1, high: 0.5, coverage: 0.6 });
});

test('the score and refutation of a compared move come from the same root lines', async () => {
  assert.equal(typeof review.compareGameMove, 'function');
  const engine = { search: async () => candidateLines() };
  const row = await review.compareGameMove(game, { ply: 1, engine, preset: 'quick' });
  assert.equal(row.provisional, false);
  assert.equal(row.comparison.played.continuation[0].uci, 'c7c5');
  assert.equal(row.comparison.recommended.uci, 'd2d4');
  assert.equal(row.threat.uci, 'c7c5');
  assert.equal(row.deepened, true);
});

test('a completed saved scan resumes without searching the same positions', async () => {
  let checkpoint;
  const engine = { search: async position => position.includes('moves')
    ? batch(line('c7c5', -15)) : batch(line('e2e4', 15)) };
  const pool = { primary: engine };
  const opts = { pool, openingsDb: {} };
  await review.analyzeGame(game, opts, { onCheckpoint: value => { checkpoint = value; } });
  assert.ok(checkpoint);
  const resumed = await review.analyzeGame(game, {
    ...opts, checkpoint, pool: { primary: { search() { assert.fail('saved searches should be reused'); } } },
  });
  assert.equal(resumed.rows[0].san, 'e4');
});

test('a search that reaches its time limit preserves the last comparison without retrying', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  let searches = 0;
  const engine = {
    async search() {
      searches++;
      now = 13_000;
      return candidateLines();
    },
  };
  const row = await review.compareGameMove(game, { ply: 1, engine, preset: 'quick' });
  assert.equal(searches, 1);
  assert.equal(row.deepened, true);
  assert.equal(row.provisional, true);
  assert.equal(row.comparison.played.uci, 'e2e4');
});

test('a cancelled comparison rejects without publishing a completed result', async () => {
  const controller = new AbortController();
  const engine = {
    async search() {
      controller.abort();
      return candidateLines();
    },
  };
  await assert.rejects(
    review.compareGameMove(game, { ply: 1, engine, preset: 'quick', signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('key decisions are capped and nearby turns are grouped', () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    ply: i + 1, color: 'white', drop: 40 - i, lesson: 'e4', comparison: { played: {}, recommended: {} },
  }));
  assert.deepEqual(review.keyReviewRows(rows, 'white').map(row => row.ply), [1, 4, 7, 10, 13]);
});

test('the compared line identifies a concrete target the other move does not attack', async () => {
  let example = newGame({ color: 'white', difficulty: 'standard' });
  for (const uci of ['e2e4', 'e7e5', 'f2f3', 'b8c6']) example = playMove(example, uci);
  const engine = { search: async () =>
    batch(line('g8f6', 75, 10, ['b1c3']), line('b8c6', 20, 10, ['b1c3'])) };
  const row = await review.compareGameMove(resign(example), { ply: 4, engine, preset: 'quick' });
  assert.equal(row.comparison.recommended.evidenceIndex, 1);
  assert.equal(row.comparison.recommended.target, 'e4');
  assert.match(row.comparison.recommended.evidence, /pawn on e4/);
});

test('adding human insights preserves completed engine comparisons', async () => {
  assert.equal(typeof review.analyzeReviewHuman, 'function');
  assert.equal(typeof review.applyReviewHuman, 'function');
  const compared = await review.compareGameMove(game, { ply: 1, engine: { search: async () => candidateLines() } });
  const maia = {
    analyzeBatch: async items => items.map(({ fen }) => ({
      moves: fen.includes(' b ') ? { c7c5: 1 } : { d2d4: 0.5, e2e4: 0.1, g1f3: 0.4 },
      winProbability: 0.5,
    })),
  };
  const model = await review.analyzeReviewHuman(game, maia, null, {});
  const [enriched] = review.applyReviewHuman([compared], game, model);
  assert.deepEqual(enriched.comparison, compared.comparison);
  assert.equal(enriched.grade, compared.grade);
  assert.equal(enriched.deepened, true);
  assert.deepEqual(enriched.maia.likelyReply, { san: 'c5', probability: 1 });
});

test('cancelling a scan preserves searches that completed before cancellation', async () => {
  const controller = new AbortController();
  let checkpoint;
  const engine = { search: async () => batch(line('c7c5', -15)) };
  await assert.rejects(review.analyzeGame(game, {
    pool: { primary: engine }, openingsDb: {}, signal: controller.signal,
  }, {
    onCheckpoint(value) {
      checkpoint = structuredClone(value);
      if (value.scans[1]) controller.abort();
    },
  }), { name: 'AbortError' });
  assert.equal(checkpoint.scans[1].lines[0].pv[0], 'c7c5');
  assert.equal(checkpoint.scans[0], undefined);
  const reopened = await review.analyzeGame(game, {
    openingsDb: {}, checkpoint, pool: { primary: { async search(position) {
      assert.equal(position, 'startpos');
      return batch(line('e2e4', 15));
    } } },
  });
  assert.equal(reopened.rows[0].san, 'e4');
});

test('a played checkmate remains settled even without engine search lines', () => {
  let mate = newGame({ color: 'white', difficulty: 'standard' });
  for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) mate = playMove(mate, uci);
  const row = review.buildMoveRow({ game: mate, ply: 4, phase: 'opening' });
  assert.equal(row.provisional, false);
  assert.equal(row.after, 100);
  assert.equal(row.preferredUci, 'd8h4');
});

test('a costly move retains its opening label context and receives a chess grade', () => {
  const search = candidateLines();
  const row = review.buildMoveRow({
    game, ply: 1, phase: 'opening', isBook: true, beforeSearch: search, comparedSearch: search,
  });
  assert.equal(row.bookKnown, true);
  assert.equal(row.isBook, false);
  assert.ok(row.drop > 5.5);
  assert.equal(row.provisional, false);
});

test('compared moves preserve concrete tactical explanations instead of generic fallback', async () => {
  // 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? allows Qxf7# (hanging f7 / missed defense)
  let tactical = newGame({ color: 'white', difficulty: 'standard' });
  for (const uci of ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6']) tactical = playMove(tactical, uci);
  const engine = {
    search: async () => batch(
      line('g7g6', 30, 12, ['h5f3']),
      { score: { type: 'mate', value: -1 }, pv: ['g8f6', 'h5f7'], depth: 12 },
    ),
  };
  const row = await review.compareGameMove(resign(tactical), { ply: 6, engine, preset: 'quick' });
  assert.equal(row.provisional, false);
  assert.ok(row.comparison);
  assert.doesNotMatch(row.explanation, /^Stockfish favors .* in the compared lines\.$/);
  assert.match(row.comparison.played.evidence, /checkmate with Qxf7#/);
});

test('compared material evidence names White or Black instead of generic mover labels', async () => {
  // 1. e4 e5 2. Nf3 f6 3. Bc4 Nc6 4. Ng5?? allows fxg5 winning a knight (+3 for Black)
  let hangKnight = newGame({ color: 'white', difficulty: 'standard' });
  for (const uci of ['e2e4', 'e7e5', 'g1f3', 'f7f6', 'f1c4', 'b8c6', 'f3g5']) hangKnight = playMove(hangKnight, uci);
  const hangEngine = {
    search: async () => batch(
      line('d2d4', 120, 10, ['e5d4']),
      line('f3g5', -280, 10, ['f6g5']),
    ),
  };
  const row = await review.compareGameMove(resign(hangKnight), { ply: 7, engine: hangEngine, preset: 'quick' });
  assert.match(row.comparison.played.evidence, /Black is up 3 in material/);
  assert.doesNotMatch(row.comparison.played.evidence, /the mover|the opponent/i);
});

test('applyReviewHuman enriches Maia insight chips and analyzeReviewHuman computes finalChance', async () => {
  const compared = await review.compareGameMove(game, {
    ply: 1,
    engine: { search: async () => batch(line('d2d4', 220, 10, ['d7d5']), line('e2e4', -40, 10, ['c7c5'])) },
  });
  const maia = {
    analyzeBatch: async items => items.map(({ fen }) => ({
      moves: fen.includes(' b ') ? { c7c5: 0.9 } : { d2d4: 0.08, e2e4: 0.45, g1f3: 0.47 },
      winProbability: fen.includes(' b ') ? 0.42 : 0.55,
    })),
  };
  const model = await review.analyzeReviewHuman(game, maia, null, {});
  // After 1. e4, it is Black's turn with winProbability 0.42 -> White POV finalChance = 58
  assert.equal(model.finalChance, 58);
  const [enriched] = review.applyReviewHuman([compared], game, model);
  assert.deepEqual(enriched.comparison, compared.comparison);
  assert.equal(enriched.grade, compared.grade);
  assert.equal(enriched.deepened, true);
  assert.ok(enriched.chips.some(chip => chip.label === 'Common human trap'));
});
