// クリア記録の純粋直列化モジュールのテスト (docs/test-design.md §3.6 R-04/R-05)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProgress,
  serializeProgress,
  deserializeProgress,
  mergeClearRecord,
} from '../src/core/progress.js';

// R-04: serialize → deserialize 往復
test('R-04: serialize→deserialize 往復で bestMoves/replay/clearedAt が保存される', () => {
  const empty = createEmptyProgress();
  assert.deepEqual(empty, { version: 1, stages: {} });

  const progress = mergeClearRecord(empty, 'stage1', {
    moves: 42,
    replay: 'UDLR',
    clearedAt: '2026-07-11T00:00:00Z',
  });
  const json = serializeProgress(progress);
  assert.equal(typeof json, 'string');

  const restored = deserializeProgress(json);
  assert.equal(restored.version, 1);
  assert.equal(restored.stages.stage1.cleared, true);
  assert.equal(restored.stages.stage1.bestMoves, 42);
  assert.equal(restored.stages.stage1.replay, 'UDLR');
  assert.equal(restored.stages.stage1.clearedAt, '2026-07-11T00:00:00Z');
});

test('R-04: 壊れた JSON は初期状態を返す (throw しない)', () => {
  const restored = deserializeProgress('{broken json!!');
  assert.deepEqual(restored, { version: 1, stages: {} });
});

test('R-04: version 不一致は初期状態を返す', () => {
  const restored = deserializeProgress(JSON.stringify({ version: 999, stages: { s: { cleared: true } } }));
  assert.deepEqual(restored, { version: 1, stages: {} });
});

test('R-04: null や非オブジェクトの JSON は初期状態を返す', () => {
  assert.deepEqual(deserializeProgress('null'), { version: 1, stages: {} });
  assert.deepEqual(deserializeProgress('"text"'), { version: 1, stages: {} });
  assert.deepEqual(deserializeProgress(null), { version: 1, stages: {} });
});

// R-05: mergeClearRecord のベスト記録更新規則
test('R-05: 未クリアのステージは記録が新規作成され cleared: true が立つ', () => {
  const progress = mergeClearRecord(createEmptyProgress(), 'stage1', {
    moves: 50,
    replay: 'RRRR',
    clearedAt: '2026-07-11T01:00:00Z',
  });
  const rec = progress.stages.stage1;
  assert.equal(rec.cleared, true);
  assert.equal(rec.bestMoves, 50);
  assert.equal(rec.replay, 'RRRR');
  assert.equal(rec.clearedAt, '2026-07-11T01:00:00Z');
});

test('R-05: bestMoves は改善時のみ更新され、replay/clearedAt も同時更新される', () => {
  let progress = mergeClearRecord(createEmptyProgress(), 'stage1', {
    moves: 50,
    replay: 'RRRR',
    clearedAt: '2026-07-11T01:00:00Z',
  });
  // 改善 (50 → 40): bestMoves/replay/clearedAt すべて更新
  progress = mergeClearRecord(progress, 'stage1', {
    moves: 40,
    replay: 'UUUU',
    clearedAt: '2026-07-11T02:00:00Z',
  });
  assert.equal(progress.stages.stage1.bestMoves, 40);
  assert.equal(progress.stages.stage1.replay, 'UUUU');
  assert.equal(progress.stages.stage1.clearedAt, '2026-07-11T02:00:00Z');
});

test('R-05: 悪化時は既存の bestMoves/replay/clearedAt を維持する', () => {
  let progress = mergeClearRecord(createEmptyProgress(), 'stage1', {
    moves: 40,
    replay: 'UUUU',
    clearedAt: '2026-07-11T02:00:00Z',
  });
  // 悪化 (40 → 60): 既存を維持
  progress = mergeClearRecord(progress, 'stage1', {
    moves: 60,
    replay: 'DDDD',
    clearedAt: '2026-07-11T03:00:00Z',
  });
  assert.equal(progress.stages.stage1.bestMoves, 40);
  assert.equal(progress.stages.stage1.replay, 'UUUU');
  assert.equal(progress.stages.stage1.clearedAt, '2026-07-11T02:00:00Z');
  assert.equal(progress.stages.stage1.cleared, true);
});

test('R-05: 同値 (moves == bestMoves) の場合も既存を維持する(改善時のみ更新)', () => {
  let progress = mergeClearRecord(createEmptyProgress(), 'stage1', {
    moves: 40,
    replay: 'UUUU',
    clearedAt: '2026-07-11T02:00:00Z',
  });
  progress = mergeClearRecord(progress, 'stage1', {
    moves: 40,
    replay: 'LLLL',
    clearedAt: '2026-07-11T04:00:00Z',
  });
  assert.equal(progress.stages.stage1.replay, 'UUUU');
  assert.equal(progress.stages.stage1.clearedAt, '2026-07-11T02:00:00Z');
});

test('R-05: mergeClearRecord は immutable(元の progress を変更しない)', () => {
  const before = mergeClearRecord(createEmptyProgress(), 'stage1', {
    moves: 50,
    replay: 'RRRR',
    clearedAt: '2026-07-11T01:00:00Z',
  });
  const beforeJson = serializeProgress(before);
  const after = mergeClearRecord(before, 'stage1', {
    moves: 10,
    replay: 'UU',
    clearedAt: '2026-07-11T05:00:00Z',
  });
  assert.equal(serializeProgress(before), beforeJson, '元の progress は不変');
  assert.equal(after.stages.stage1.bestMoves, 10);
  assert.notEqual(before, after);
});

test('R-05: 別ステージの記録は影響を受けない', () => {
  let progress = mergeClearRecord(createEmptyProgress(), 'stage1', {
    moves: 30,
    replay: 'RR',
    clearedAt: '2026-07-11T01:00:00Z',
  });
  progress = mergeClearRecord(progress, 'stage2', {
    moves: 99,
    replay: 'DDDD',
    clearedAt: '2026-07-11T02:00:00Z',
  });
  assert.equal(progress.stages.stage1.bestMoves, 30);
  assert.equal(progress.stages.stage2.bestMoves, 99);
});
