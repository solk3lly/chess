import { Maia3 } from 'https://esm.sh/maia3-js@0.2.0/dist/web/index.js?bundle&deps=chess.js@1.4.0';
import { env, InferenceSession, Tensor } from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs';

const MODEL_URL = 'https://huggingface.co/cstr/maia3-onnx-int32/resolve/032064923ede496a0c2b7ef229c993768e891cc7/maia3_5m_int32.onnx';

env.wasm.numThreads = 1;
env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

async function openSession() {
  const cache = await globalThis.caches?.open('chess-studio-models').catch(() => null);
  const cached = await cache?.match(MODEL_URL).catch(() => null);
  const response = cached ?? await fetch(MODEL_URL);
  if (response.status !== 200) throw new Error(`Model download failed with HTTP ${response.status}.`);
  const cacheCopy = cache && !cached ? response.clone() : null;
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const session = await InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    if (cacheCopy) void cache.put(MODEL_URL, cacheCopy).catch(() => {});
    return session;
  } catch (error) {
    if (cached) await cache.delete(MODEL_URL).catch(() => {});
    throw error;
  }
}

function createModel() {
  let session;

  async function infer(tokens, selfElo, oppoElo) {
    // This ONNX export keeps the eight history positions and accepts int32 rating inputs.
    const { logits_move, logits_value } = await session.run({
      tokens: new Tensor('float32', tokens, [1, 64, 96]),
      self_elo: new Tensor('int32', Int32Array.of(selfElo), [1]),
      oppo_elo: new Tensor('int32', Int32Array.of(oppoElo), [1]),
    });
    return { logitsMove: logits_move.data, logitsValue: logits_value.data };
  }

  return {
    isLoaded: () => Boolean(session),
    async load() {
      session = await openSession();
    },
    infer,
    // ONNX Runtime Web WASM sessions must run sequentially, not via Promise.all.
    async inferBatch(tokens, selfElos, oppoElos) {
      const outputs = [];
      for (let index = 0; index < tokens.length; index++) {
        outputs.push(await infer(tokens[index], selfElos[index], oppoElos[index]));
      }
      return outputs;
    },
  };
}

const maia = new Maia3(createModel, { temperature: 1, topK: 0 });

function serializePrediction(result) {
  if (!result || result instanceof Error) return null;
  const moves = Object.fromEntries(result.moves);
  return {
    bestMove: result.bestMove,
    wdl: result.wdl,
    winProbability: result.winProbability,
    moves,
  };
}

self.onmessage = async ({ data }) => {
  // Structured review / preload requests
  if (data && typeof data === 'object' && data.type) {
    const { type, id } = data;
    try {
      await maia.load();
      if (type === 'preload') {
        self.postMessage({ type: 'ready', id });
        return;
      }
      if (type === 'analyzeBatch') {
        const items = Array.isArray(data.items) ? data.items : [];
        const raw = await maia.predictBatch(items, { topK: 0, maxBatchSize: 24, onError: 'collect' });
        self.postMessage({ type: 'batchResult', id, results: raw.map(serializePrediction) });
        return;
      }
      throw new Error(`Unknown Maia-3 request type: ${type}`);
    } catch (error) {
      console.error('Maia-3', error);
      const message = maia.isLoaded() ? 'Maia-3 could not analyze this game.' :
        'Maia-3 could not download or load. Check your connection and retry.';
      self.postMessage({ type: 'error', id, message });
    }
    return;
  }

  // Legacy Rookie bot single-move request
  try {
    await maia.load();
    const { bestMove } = await maia.predict(data);
    self.postMessage(`bestmove ${bestMove}`);
  } catch (error) {
    console.error('Maia-3', error);
    const message = maia.isLoaded() ? 'Maia-3 could not play this position.' :
      'Maia-3 could not load. Check your connection and retry.';
    self.postMessage(`error ${message}`);
  }
};
