import { BOT_PROFILES, DIFFICULTY_ORDER } from './studio-game.js';

export const DEFAULT_SETTINGS = {
  color: 'white',
  difficulty: 'standard',
  bot: 'default',
  theme: 'system',
  board: 'brown',
  pieces: '2d',
  sound: true,
};

const SETTINGS_KEY = 'chess-studio-preferences-v1';
const SETTINGS_OPTIONS = {
  color: ['white', 'black'],
  difficulty: DIFFICULTY_ORDER,
  bot: Object.keys(BOT_PROFILES),
  theme: ['system', 'light', 'dark'],
  board: ['brown', 'wood', 'blue'],
  pieces: ['2d', '3d'],
  sound: [true, false],
};

export function preferences(storage = globalThis.localStorage) {
  const data = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}');
  return Object.fromEntries(Object.entries(SETTINGS_OPTIONS).map(([key, options]) => [
    key, options.includes(data?.[key]) ? data[key] : DEFAULT_SETTINGS[key],
  ]));
}

export function savePreferences(settings, storage = globalThis.localStorage) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function openStore(idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const request = idb.open('chess-studio', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['active', 'games', 'reviews', 'practice']) db.createObjectStore(name);
    };
    request.onblocked = () => reject(new Error('Close other Chess Studio tabs to enable local storage.'));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export function readLocal(db, collection, key) {
  return new Promise((resolve, reject) => {
    const store = db.transaction(collection).objectStore(collection);
    const request = key === undefined ? store.getAll() : store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function write(db, collections, update) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(collections, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    update(transaction);
  });
}

export function saveGame(db, game) {
  return write(db, ['active', 'games'], transaction => {
    transaction.objectStore('active').put(game, 'match');
    if (game.outcome) transaction.objectStore('games').put(game, game.id);
  });
}

export function writeLocal(db, collection, key, value) {
  return write(db, [collection], transaction => transaction.objectStore(collection).put(value, key));
}
