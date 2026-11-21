import { Search } from './search.js';

const LEVELS = {
  1: { maxDepth: 2, timeLimit: 1100, randomness: 90 },
  2: { maxDepth: 4, timeLimit: 2100, randomness: 0 },
  3: { maxDepth: 5, timeLimit: 4600, randomness: 0 },
};

self.onmessage = (event) => {
  const { type, state, level, id, key } = event.data || {};
  if (type !== 'search') return;
  const config = LEVELS[level] || LEVELS[2];
  try {
    const search = new Search(config);
    const result = search.run(state);
    self.postMessage({ type: 'result', id, key, ...result });
  } catch (err) {
    self.postMessage({ type: 'error', id, key, message: String(err && err.message ? err.message : err) });
  }
};
