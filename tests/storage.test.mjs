import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, loadProgress, saveProgress, storageAdapter } from '../src/ui/storage.js';
import { boardHash, createEmptyProgress, mergeClearRecord, serializeProgress } from '../src/core/progress.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.failSet = false;
  }
  getItem(key) {
    return this.map.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.failSet) {
      throw new Error('quota');
    }
    this.map.set(key, value);
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

let localStorage;

beforeEach(() => {
  localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  storageAdapter.disabled = false;
});

afterEach(() => {
  delete globalThis.window;
  storageAdapter.disabled = false;
});

test('storage uses v2 key and ignores v1 key', () => {
  localStorage.setItem('qgb-soukoban/v1', JSON.stringify({ version: 1, stages: { old: {} } }));
  assert.equal(STORAGE_KEY, 'qgb-soukoban/v2');
  assert.deepEqual(loadProgress(), createEmptyProgress());
});

test('saveProgress reports setItem failure and preserves existing stored data', () => {
  const progress = mergeClearRecord(createEmptyProgress(), 'stage1', {
    moves: 4,
    replay: 'RRRR',
    clearedAt: '2026-07-11T00:00:00Z',
    boardHash: boardHash('a'),
  });
  localStorage.setItem(STORAGE_KEY, serializeProgress(progress));
  localStorage.failSet = true;

  const changed = mergeClearRecord(progress, 'stage1', {
    moves: 3,
    replay: 'RRR',
    clearedAt: '2026-07-11T01:00:00Z',
    boardHash: boardHash('a'),
  });
  assert.equal(saveProgress(changed), false);
  assert.equal(storageAdapter.disabled, true);
  assert.equal(localStorage.getItem(STORAGE_KEY), serializeProgress(progress));
});
