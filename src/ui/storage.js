import {
  createEmptyProgress,
  deserializeProgress,
  mergeClearRecord,
  serializeProgress,
} from '../core/progress.js';

export const STORAGE_KEY = 'qgb-soukoban/v2';

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
    return deserializeProgress(storageAdapter.getItem(STORAGE_KEY));
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

export function saveProgressState(progress) {
  return {
    saved: saveProgress(progress),
    storageDisabled: storageAdapter.disabled,
  };
}

export function saveClearRecord(progress, stageId, record) {
  const next = mergeClearRecord(progress, stageId, record);
  return {
    progress: next,
    saved: saveProgress(next),
    storageDisabled: storageAdapter.disabled,
  };
}
