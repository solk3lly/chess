const SOURCES = ['unpkg', 'esm.sh'];
const STARTUP_TIMEOUT = 15_000;
export const MAIA_MODEL_URL = 'https://huggingface.co/cstr/maia3-onnx-int32/resolve/032064923ede496a0c2b7ef229c993768e891cc7/maia3_5m_int32.onnx';
export const MAIA_CACHE_NAME = 'chess-studio-models';

export function parseLine(message) {
  if (!message.startsWith('info ') || /\b(?:upperbound|lowerbound)\b/.test(message)) return null;
  const parsed = message.match(/\bdepth (\d+).*?\bscore (cp|mate) (-?\d+) .*?\bpv (.+)$/);
  if (!parsed) return null;
  const wdlMatch = message.match(/\bwdl (\d+) (\d+) (\d+)\b/);
  const nodesMatch = message.match(/\bnodes (\d+)\b/);
  const seldepthMatch = message.match(/\bseldepth (\d+)\b/);
  return {
    depth: Number(parsed[1]),
    seldepth: seldepthMatch ? Number(seldepthMatch[1]) : null,
    rank: Number(message.match(/\bmultipv (\d+)/)?.[1] ?? 1),
    score: { type: parsed[2], value: Number(parsed[3]) },
    wdl: wdlMatch ? { win: Number(wdlMatch[1]), draw: Number(wdlMatch[2]), loss: Number(wdlMatch[3]) } : null,
    nodes: nodesMatch ? Number(nodesMatch[1]) : null,
    pv: parsed[4].trim().split(/\s+/),
  };
}

/**
 * Parses Stockfish 19's `eval` output:
 * - Leave-one-out NNUE derived piece values per square (White POV, pawns)
 * - Active NNUE bucket Material (PSQT) vs Positional (Layers) breakdown (normalized to White POV)
 */
export function parseEvalTrace(rawLines) {
  if (!rawLines?.length) return null;
  if (rawLines.some(line => line.includes('none (in check)'))) return null;

  const pieceValues = {};
  const boardHeaderIdx = rawLines.findIndex(line => line.includes('NNUE derived piece values'));
  if (boardHeaderIdx >= 0) {
    let rank = 7;
    for (let i = boardHeaderIdx + 1; i < rawLines.length && rank >= 0; i++) {
      const line = rawLines[i];
      if (!line.startsWith('|')) continue;
      const valLine = rawLines[i + 1];
      if (!valLine || !valLine.startsWith('|')) continue;
      const pieceCells = line.split('|').slice(1, 9);
      const valCells = valLine.split('|').slice(1, 9);
      if (pieceCells.length === 8 && valCells.length === 8) {
        for (let file = 0; file < 8; file++) {
          const pieceChar = pieceCells[file].trim();
          const num = parseFloat(valCells[file].trim());
          if (pieceChar && Number.isFinite(num)) {
            const sq = 'abcdefgh'[file] + (rank + 1);
            pieceValues[sq] = { piece: pieceChar, value: num };
          }
        }
        rank--;
        i++; // skip value row
      }
    }
  }

  let stmWhite = true;
  const heading = rawLines.find(line => line.includes('NNUE network contributions'));
  if (heading && heading.includes('Black to move')) stmWhite = false;
  const sign = stmWhite ? 1 : -1;

  let psqt = null;
  let positional = null;
  let total = null;
  const activeBucket = rawLines.find(line => line.includes('<-- this bucket is used'));
  if (activeBucket) {
    const nums = activeBucket.match(/[+-]?\d+\.\d+/g);
    if (nums && nums.length >= 3) {
      psqt = Number((parseFloat(nums[0]) * sign).toFixed(2));
      positional = Number((parseFloat(nums[1]) * sign).toFixed(2));
      total = Number((parseFloat(nums[2]) * sign).toFixed(2));
    }
  }

  if (!Object.keys(pieceValues).length && psqt === null) return null;
  return { pieceValues, psqt, positional, total };
}

function waitFor(worker, command, read, { timeout = STARTUP_TIMEOUT, signal, engine = 'Stockfish' }) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }
    function fail(error) {
      cleanup();
      reject(error);
    }
    const onAbort = () => fail(signal.reason);
    const onError = event => {
      event.preventDefault();
      fail(new Error(`The ${engine} worker stopped.`));
    };
    const onMessage = event => {
      const payload = typeof event.data === 'string' ? event.data.trim() : event.data;
      const result = read(payload);
      if (result === undefined) return;
      cleanup();
      resolve(result);
    };
    const timer = setTimeout(() => fail(new Error(`${engine} took too long to respond.`)), timeout);

    signal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    if (signal?.aborted) onAbort();
    else {
      try {
        worker.postMessage(command);
      } catch (error) {
        fail(error);
      }
    }
  });
}

function collectSearch(worker, { time = null, depth = null, nodes = null, searchmoves = null, lines: requestedLines }, signal) {
  const searches = new Map();
  const bestByDepth = new Map();
  const parts = ['go'];
  if (nodes) parts.push('nodes', String(nodes));
  if (depth) parts.push('depth', String(depth));
  if (time && !nodes) parts.push('movetime', String(time));
  if (!nodes && !depth && !time) parts.push('movetime', '200');
  if (searchmoves?.length) parts.push('searchmoves', ...searchmoves);
  const go = parts.join(' ');
  const timeout = nodes
    ? Math.max(25_000, Math.round(nodes / 6))
    : 12_000 + (time ?? 2000);

  return waitFor(worker, go, message => {
    if (typeof message !== 'string') return;
    if (message.startsWith('bestmove ')) {
      const move = message.split(/\s+/)[1];
      // Use alternatives from a single depth. Stockfish may stop mid-iteration.
      const byCompleteness = ([depthA, a], [depthB, b]) => b.size - a.size || depthB - depthA;
      const [bestDepth, complete] = [...searches].sort(byCompleteness)[0] ?? [];
      const lines = [...(complete?.values() ?? [])].sort((a, b) => a.rank - b.rank);
      const topMove = lines[0]?.pv[0] ?? move;

      // Determine the depth at which the final best move emerged and stabilized.
      let emergedAtDepth = 1;
      const sortedDepths = [...bestByDepth.keys()].sort((a, b) => a - b);
      for (const d of sortedDepths) {
        if (bestByDepth.get(d) !== topMove) {
          emergedAtDepth = d + 1;
        }
      }
      const totalNodes = lines.reduce((max, l) => Math.max(max, l.nodes ?? 0), 0);
      const iterations = [...searches].sort(([a], [b]) => b - a)
        .map(([, ranks]) => [...ranks.values()].sort((a, b) => a.rank - b.rank))
        .filter(group => group.length === requestedLines &&
          group.every((line, index) => line.rank === index + 1) &&
          new Set(group.map(line => line.pv[0])).size === group.length)
        .slice(0, 3);
      return { move, lines, depth: bestDepth ?? 0, nodes: totalNodes, emergedAtDepth, iterations };
    }
    const line = parseLine(message);
    if (!line) return;
    if (!searches.has(line.depth)) searches.set(line.depth, new Map());
    searches.get(line.depth).set(line.rank, line);
    if (line.rank === 1 && line.pv[0]) bestByDepth.set(line.depth, line.pv[0]);
  }, { timeout, signal });
}

export class Engine {
  #worker = null;
  #busy = false;
  #strengthKey = null;
  #hashMb = 16;
  #wdlEnabled = false;
  #openWorker;

  constructor(openWorker = source => new Worker(new URL('./stockfish-worker.js?source=' + source, import.meta.url))) {
    this.#openWorker = openWorker;
  }

  async #connect(signal) {
    if (this.#worker) return this.#worker;
    for (const source of SOURCES) {
      signal?.throwIfAborted();
      let worker;
      try {
        worker = this.#openWorker(source);
        await waitFor(worker, 'uci', line => line === 'uciok' || undefined, { signal });
        this.#worker = worker;
        this.#hashMb = 16;
        this.#wdlEnabled = false;
        return worker;
      } catch {
        worker?.terminate();
      }
    }
    signal?.throwIfAborted();
    throw new Error('Stockfish could not load. Check your connection and retry.');
  }

  async search(position, {
    time = null, skill = 20, elo = null, depth = null, nodes = null,
    lines = 1, hash = 16, showWdl = false, searchmoves = null, fresh = false, signal,
  }) {
    if (this.#busy) throw new Error('A Stockfish search is already running.');
    this.#busy = true;
    try {
      const worker = await this.#connect(signal);
      const strengthKey = `${skill}:${elo ?? ''}`;
      if (fresh || (this.#strengthKey !== null && this.#strengthKey !== strengthKey)) {
        worker.postMessage('ucinewgame');
      }
      this.#strengthKey = strengthKey;
      if (hash && hash !== this.#hashMb) {
        worker.postMessage('setoption name Hash value ' + hash);
        this.#hashMb = hash;
      }
      if (showWdl !== this.#wdlEnabled) {
        worker.postMessage('setoption name UCI_ShowWDL value ' + (showWdl ? 'true' : 'false'));
        this.#wdlEnabled = showWdl;
      }
      if (elo) {
        worker.postMessage('setoption name UCI_LimitStrength value true');
        worker.postMessage('setoption name UCI_Elo value ' + elo);
      } else {
        worker.postMessage('setoption name UCI_LimitStrength value false');
        worker.postMessage('setoption name Skill Level value ' + skill);
      }
      worker.postMessage('setoption name MultiPV value ' + lines);
      await waitFor(worker, 'isready', line => line === 'readyok' || undefined, { signal });
      worker.postMessage('position ' + position);
      return await collectSearch(worker, { time, depth, nodes, searchmoves, lines }, signal);
    } catch (error) {
      this.terminate();
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  async evalTrace(position, signal) {
    if (this.#busy) throw new Error('A Stockfish search is already running.');
    this.#busy = true;
    try {
      const worker = await this.#connect(signal);
      worker.postMessage('position ' + position);
      worker.postMessage('eval');
      const captured = [];
      await waitFor(worker, 'isready', line => {
        if (typeof line !== 'string') return;
        if (line === 'readyok') return true;
        captured.push(line);
      }, { timeout: 6_000, signal });
      return parseEvalTrace(captured);
    } catch (error) {
      if (signal?.aborted) this.terminate();
      return null;
    } finally {
      this.#busy = false;
    }
  }

  terminate() {
    this.#worker?.terminate();
    this.#worker = null;
    this.#strengthKey = null;
    this.#hashMb = 16;
    this.#wdlEnabled = false;
  }
}

export class EnginePool {
  #engines;

  constructor(size = Math.min(3, Math.max(1, (globalThis.navigator?.hardwareConcurrency || 2) - 1)), openWorker) {
    const count = Math.max(1, size);
    this.#engines = Array.from({ length: count }, () => new Engine(openWorker));
  }

  get size() {
    return this.#engines.length;
  }

  get primary() {
    return this.#engines[0];
  }

  async runTasks(tasks, signal, onItemComplete) {
    if (!tasks.length) return [];
    const results = new Array(tasks.length);
    let cursor = 0;

    const workerLoop = async engine => {
      while (cursor < tasks.length) {
        signal?.throwIfAborted();
        const index = cursor++;
        if (index >= tasks.length) break;
        const value = await tasks[index](engine);
        signal?.throwIfAborted();
        results[index] = value;
        onItemComplete?.(index, value);
      }
    };

    const activeCount = Math.min(this.#engines.length, tasks.length);
    await Promise.all(this.#engines.slice(0, activeCount).map(workerLoop));
    return results;
  }

  terminate() {
    for (const engine of this.#engines) engine.terminate();
  }
}

export async function isMaiaModelCached() {
  try {
    const cache = await globalThis.caches?.open(MAIA_CACHE_NAME);
    const hit = await cache?.match(MAIA_MODEL_URL);
    return Boolean(hit);
  } catch {
    return false;
  }
}

export class MaiaEngine {
  #worker = null;
  #openWorker;
  #nextId = 1;

  constructor(openWorker = () => new Worker(new URL('./maia-worker.js', import.meta.url), { type: 'module' })) {
    this.#openWorker = openWorker;
  }

  async move(position, signal) {
    signal?.throwIfAborted();
    const worker = this.#worker ??= this.#openWorker();
    try {
      const reply = await waitFor(worker, position, line => (typeof line === 'string' ? line : undefined), {
        timeout: 60_000, signal, engine: 'Maia-3',
      });
      if (reply.startsWith('bestmove ')) return reply.slice(9);
      if (reply.startsWith('error ')) throw new Error(reply.slice(6));
      throw new Error('Maia-3 returned an unexpected response.');
    } catch (error) {
      if (this.#worker === worker) this.terminate();
      throw error;
    }
  }

  async preload(signal) {
    signal?.throwIfAborted();
    const worker = this.#worker ??= this.#openWorker();
    const id = this.#nextId++;
    try {
      const reply = await waitFor(worker, { type: 'preload', id }, msg => {
        if (!msg || typeof msg !== 'object' || msg.id !== id) return;
        return msg;
      }, { timeout: 90_000, signal, engine: 'Maia-3' });
      if (reply.type === 'error') throw new Error(reply.message);
      return true;
    } catch (error) {
      if (this.#worker === worker) this.terminate();
      throw error;
    }
  }

  async analyzeBatch(items, signal) {
    signal?.throwIfAborted();
    if (!items.length) return [];
    const worker = this.#worker ??= this.#openWorker();
    const id = this.#nextId++;
    try {
      const reply = await waitFor(worker, { type: 'analyzeBatch', id, items }, msg => {
        if (!msg || typeof msg !== 'object' || msg.id !== id) return;
        return msg;
      }, { timeout: Math.max(90_000, items.length * 1500), signal, engine: 'Maia-3' });
      if (reply.type === 'error') throw new Error(reply.message);
      return reply.results;
    } catch (error) {
      if (this.#worker === worker) this.terminate();
      throw error;
    }
  }

  terminate() {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
