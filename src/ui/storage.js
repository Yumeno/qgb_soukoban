import {
  createEmptyProgress,
  deserializeProgress,
  mergeClearRecord,
  serializeProgress,
} from '../core/progress.js';

export const STORAGE_KEY = 'qgb-soukoban/v1';
const REPLAY_PATTERN = /^[UDLR]*$/;

export const storageAdapter = {
  disabled: false,
  getItem(key) {
    if (!storageAvailable() || this.disabled) {
      return null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch {
      this.disabled = true;
      return null;
    }
  },
  setItem(key, value) {
    if (!storageAvailable() || this.disabled) {
      return false;
    }
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      this.disabled = true;
      return false;
    }
  },
};

function storageAvailable() {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadProgress() {
  if (!storageAvailable()) {
    return createEmptyProgress();
  }
  try {
    return validateProgressRecords(deserializeProgress(storageAdapter.getItem(STORAGE_KEY)));
  } catch {
    return createEmptyProgress();
  }
}

export function saveProgress(progress) {
  if (!storageAvailable()) {
    return false;
  }
  return storageAdapter.setItem(STORAGE_KEY, serializeProgress(progress));
}

export function saveClearRecord(progress, stageId, record) {
  const next = mergeClearRecord(progress, stageId, record);
  return {
    progress: next,
    saved: saveProgress(next),
    storageDisabled: storageAdapter.disabled,
  };
}

function validateProgressRecords(progress) {
  const next = createEmptyProgress();
  for (const [stageId, record] of Object.entries(progress.stages)) {
    if (isValidRecord(record)) {
      next.stages[stageId] = record;
    }
  }
  return next;
}

function isValidRecord(record) {
  return (
    record !== null &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    record.cleared === true &&
    Number.isSafeInteger(record.bestMoves) &&
    record.bestMoves >= 0 &&
    typeof record.replay === 'string' &&
    REPLAY_PATTERN.test(record.replay) &&
    typeof record.clearedAt === 'string'
  );
}
