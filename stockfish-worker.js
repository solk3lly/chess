const STOCKFISH_VERSION = '19.0.1';
const STOCKFISH_ASSET = 'stockfish-19-lite-single';
const STOCKFISH_SOURCES = {
  unpkg: {
    js: `https://unpkg.com/stockfish@${STOCKFISH_VERSION}/bin/${STOCKFISH_ASSET}.js`,
    wasm: `https://unpkg.com/stockfish@${STOCKFISH_VERSION}/bin/${STOCKFISH_ASSET}.wasm`,
  },
  'esm.sh': {
    js: `https://esm.sh/stockfish@${STOCKFISH_VERSION}/bin/${STOCKFISH_ASSET}.js?raw`,
    wasm: `https://esm.sh/stockfish@${STOCKFISH_VERSION}/bin/${STOCKFISH_ASSET}.wasm?raw`,
  },
};

const sourceId = new URL(self.location.href).searchParams.get('source') || 'unpkg';
const source = Object.hasOwn(STOCKFISH_SOURCES, sourceId) ? STOCKFISH_SOURCES[sourceId] : null;
if (!source) throw new Error('Unknown Stockfish asset source.');

function needsWasmRewrite(url) {
  const raw = String(url || '').toLowerCase();
  if (!raw || raw.includes('.wasm.map')) return false;
  if (raw.includes('stockfish-worker.wasm') || raw.includes('stockfish.wasm')) return true;
  return /\.wasm(?:$|[?#])/.test(raw);
}

const originalFetch = typeof self.fetch === 'function' ? self.fetch.bind(self) : null;
if (originalFetch) {
  self.fetch = (input, init) => {
    const requestUrl = input?.url ?? String(input || '');

    if (needsWasmRewrite(requestUrl)) {
      return originalFetch(source.wasm, init);
    }

    return originalFetch(input, init);
  };
}

const OriginalXHR = typeof self.XMLHttpRequest === 'function' ? self.XMLHttpRequest : null;
const originalXhrOpen = OriginalXHR && OriginalXHR.prototype ? OriginalXHR.prototype.open : null;
if (originalXhrOpen) {
  OriginalXHR.prototype.open = function patchedOpen(method, url, ...rest) {
    const nextUrl = needsWasmRewrite(url) ? source.wasm : url;
    return originalXhrOpen.call(this, method, nextUrl, ...rest);
  };
}

importScripts(source.js);
postMessage('info string stockfish-version ' + STOCKFISH_VERSION);
postMessage('info string stockfish-source ' + sourceId);

