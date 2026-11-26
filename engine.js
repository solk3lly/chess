const SOURCES = ['unpkg', 'esm.sh'];
const STARTUP_TIMEOUT = 15_000;

function parseLine(message) {
  if (!message.startsWith('info ') || /\b(?:upperbound|lowerbound)\b/.test(message)) return null;
  const parsed = message.match(/\bdepth (\d+).*?\bscore (cp|mate) (-?\d+) .*?\bpv (.+)$/);
  if (!parsed) return null;
  return {
    depth: Number(parsed[1]),
    rank: Number(message.match(/\bmultipv (\d+)/)?.[1] ?? 1),
    score: { type: parsed[2], value: Number(parsed[3]) },
    pv: parsed[4].trim().split(/\s+/),
  };
}

function waitFor(worker, command, read, { timeout = STARTUP_TIMEOUT, signal }) {
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
      fail(new Error('The Stockfish worker stopped.'));
    };
    const onMessage = event => {
      if (typeof event.data !== 'string') return;
      const result = read(event.data.trim());
      if (result === undefined) return;
      cleanup();
      resolve(result);
    };
    const timer = setTimeout(() => fail(new Error('Stockfish took too long to respond.')), timeout);

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

function collectSearch(worker, { time, depth = null }, signal) {
  const searches = new Map();
  const go = depth ? `go depth ${depth} movetime ${time}` : `go movetime ${time}`;
  return waitFor(worker, go, message => {
    if (message.startsWith('bestmove ')) {
      const move = message.split(/\s+/)[1];
      // Use alternatives from a single depth. Stockfish may stop mid-iteration.
      const byCompleteness = ([depthA, a], [depthB, b]) => b.size - a.size || depthB - depthA;
      const [, complete] = [...searches].sort(byCompleteness)[0] ?? [];
      const lines = [...(complete?.values() ?? [])].sort((a, b) => a.rank - b.rank);
      return { move, lines };
    }
    const line = parseLine(message);
    if (!line) return;
    if (!searches.has(line.depth)) searches.set(line.depth, new Map());
    searches.get(line.depth).set(line.rank, line);
  }, { timeout: 10_000 + time, signal });
}

export class Engine {
  #worker = null;
  #busy = false;
  #strengthKey = null;
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
        return worker;
      } catch {
        worker?.terminate();
      }
    }
    signal?.throwIfAborted();
    throw new Error('Stockfish could not load. Check your connection and retry.');
  }

  async search(position, { time, skill = 20, elo = null, depth = null, lines = 1, fresh = false, signal }) {
    if (this.#busy) throw new Error('A Stockfish search is already running.');
    this.#busy = true;
    try {
      const worker = await this.#connect(signal);
      const strengthKey = `${skill}:${elo ?? ''}:${depth ?? ''}:${time}`;
      if (fresh || (this.#strengthKey !== null && this.#strengthKey !== strengthKey)) {
        worker.postMessage('ucinewgame');
      }
      this.#strengthKey = strengthKey;
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
      return await collectSearch(worker, { time, depth }, signal);
    } catch (error) {
      this.terminate();
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  terminate() {
    this.#worker?.terminate();
    this.#worker = null;
    this.#strengthKey = null;
  }
}
