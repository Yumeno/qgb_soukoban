// クリア記録の純粋直列化モジュール (docs/test-design.md §3.6 R-04/R-05)
// DOM/localStorage 非依存の純粋 ESM。localStorage への接続は ui/storage.js (後続) が担う。

const CURRENT_VERSION = 1;

/**
 * 空の進捗オブジェクトを生成する。
 * @returns {{version: 1, stages: object}}
 */
export function createEmptyProgress() {
  return { version: CURRENT_VERSION, stages: {} };
}

/**
 * progress → JSON 文字列。
 * @param {object} progress
 * @returns {string}
 */
export function serializeProgress(progress) {
  return JSON.stringify(progress);
}

/**
 * JSON 文字列 → progress。
 * 壊れた JSON・version 不一致・null・非オブジェクトは createEmptyProgress() を返す (throw しない)。
 * @param {string|null} json
 * @returns {object}
 */
export function deserializeProgress(json) {
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return createEmptyProgress();
  }
  if (
    obj === null ||
    typeof obj !== 'object' ||
    Array.isArray(obj) ||
    obj.version !== CURRENT_VERSION ||
    obj.stages === null ||
    typeof obj.stages !== 'object' ||
    Array.isArray(obj.stages)
  ) {
    return createEmptyProgress();
  }
  return obj;
}

/**
 * クリア記録をマージした新しい progress を返す (immutable。引数の progress は変更しない)。
 * - 未クリアなら記録を新規作成
 * - クリア済みなら bestMoves は moves < bestMoves のときのみ更新し、そのとき replay/clearedAt も同時更新
 * - 悪化・同値時は既存を維持
 * - cleared: true を必ず立てる
 * @param {object} progress
 * @param {string} stageId
 * @param {{moves: number, replay: string, clearedAt: string}} record
 * @returns {object} 新しい progress
 */
export function mergeClearRecord(progress, stageId, { moves, replay, clearedAt }) {
  const existing = progress.stages[stageId];
  let nextRecord;
  if (!existing || !existing.cleared || moves < existing.bestMoves) {
    nextRecord = { cleared: true, bestMoves: moves, replay, clearedAt };
  } else {
    nextRecord = { ...existing, cleared: true };
  }
  return {
    ...progress,
    stages: {
      ...progress.stages,
      [stageId]: nextRecord,
    },
  };
}
