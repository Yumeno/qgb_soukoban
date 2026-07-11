import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardHash,
  clearAllProgress,
  createEmptyProgress,
  deserializeProgress,
  filterValidRandomHistory,
  invalidateStaleRecords,
  markSolutionViewed,
  mergeClearRecord,
  recordRandomPlay,
  resetClearRecords,
  serializeProgress,
} from '../src/core/progress.js';

const BOARD_A = '#####\n#@$.#\n#####';
const BOARD_B = '#####\n#@ $.#\n#####';

test('progress v2 serializes and deserializes stages plus random history', () => {
  const empty = createEmptyProgress();
  assert.deepEqual(empty, { version: 2, stages: {}, randomHistory: [] });

  const hash = boardHash(BOARD_A);
  const progress = mergeClearRecord(empty, 'stage1', {
    moves: 4,
    replay: 'RRRR',
    clearedAt: '2026-07-11T00:00:00Z',
    boardHash: hash,
  });
  const restored = deserializeProgress(serializeProgress(progress));
  assert.equal(restored.version, 2);
  assert.equal(restored.stages.stage1.cleared, true);
  assert.equal(restored.stages.stage1.bestMoves, 4);
  assert.equal(restored.stages.stage1.replay, 'RRRR');
  assert.equal(restored.stages.stage1.boardHash, hash);
  assert.deepEqual(restored.randomHistory, []);
});

test('v1, broken JSON and unknown versions return initial v2 state', () => {
  const empty = { version: 2, stages: {}, randomHistory: [] };
  assert.deepEqual(deserializeProgress('{broken'), empty);
  assert.deepEqual(deserializeProgress(JSON.stringify({ version: 1, stages: { s: {} } })), empty);
  assert.deepEqual(deserializeProgress(JSON.stringify({ version: 999, stages: {} })), empty);
  assert.deepEqual(deserializeProgress(null), empty);
});

test('boardHash is deterministic and distinguishes board text', () => {
  assert.equal(boardHash(BOARD_A), boardHash(BOARD_A));
  assert.notEqual(boardHash(BOARD_A), boardHash(BOARD_B));
});

test('invalidateStaleRecords removes only mismatched stage records', () => {
  let progress = createEmptyProgress();
  progress = markSolutionViewed(progress, 'stage1', boardHash(BOARD_A));
  progress = mergeClearRecord(progress, 'stage1', {
    moves: 4,
    replay: 'RRRR',
    clearedAt: '2026-07-11T00:00:00Z',
    boardHash: boardHash(BOARD_A),
  });
  progress = markSolutionViewed(progress, 'stage2', boardHash(BOARD_B));

  const next = invalidateStaleRecords(progress, [
    { id: 'stage1', text: BOARD_B },
    { id: 'stage2', text: BOARD_B },
  ]);

  assert.equal(next.stages.stage1, undefined);
  assert.equal(next.stages.stage2.solutionViewed, true);
});

test('resetClearRecords preserves solutionViewed and random history, clearAllProgress removes all', () => {
  let progress = createEmptyProgress();
  progress = markSolutionViewed(progress, 'stage1', boardHash(BOARD_A));
  progress = mergeClearRecord(progress, 'stage1', {
    moves: 4,
    replay: 'RRRR',
    clearedAt: '2026-07-11T00:00:00Z',
    boardHash: boardHash(BOARD_A),
  });
  progress = recordRandomPlay(progress, {
    seed: 123,
    difficulty: 'easy',
    params: { width: 5 },
    boardHash: boardHash(BOARD_B),
    minMoves: 2,
    cleared: true,
    bestMoves: 2,
    replay: 'RR',
    clearedAt: '2026-07-11T01:00:00Z',
  });

  const reset = resetClearRecords(progress);
  assert.deepEqual(reset.stages.stage1, { solutionViewed: true, boardHash: boardHash(BOARD_A) });
  assert.equal(reset.randomHistory.length, 1);
  assert.equal(reset.randomHistory[0].cleared, undefined);
  assert.equal(reset.randomHistory[0].bestMoves, undefined);
  assert.deepEqual(clearAllProgress(progress), createEmptyProgress());
});

test('mergeClearRecord and recordRandomPlay preserve solutionViewed', () => {
  let progress = markSolutionViewed(createEmptyProgress(), 'stage1', boardHash(BOARD_A));
  progress = mergeClearRecord(progress, 'stage1', {
    moves: 4,
    replay: 'RRRR',
    clearedAt: '2026-07-11T00:00:00Z',
    boardHash: boardHash(BOARD_A),
  });
  assert.equal(progress.stages.stage1.solutionViewed, true);

  progress = recordRandomPlay(progress, {
    seed: 123,
    difficulty: 'easy',
    params: { width: 5 },
    boardHash: boardHash(BOARD_B),
    minMoves: 3,
    solutionViewed: true,
  });
  progress = recordRandomPlay(progress, {
    seed: 123,
    difficulty: 'easy',
    params: { width: 5 },
    boardHash: boardHash(BOARD_B),
    minMoves: 3,
    cleared: true,
    bestMoves: 3,
    replay: 'RRR',
    clearedAt: '2026-07-11T01:00:00Z',
  });
  assert.equal(progress.randomHistory.length, 1);
  assert.equal(progress.randomHistory[0].solutionViewed, true);
  assert.equal(progress.randomHistory[0].bestMoves, 3);
});

test('filterValidRandomHistory keeps entries whose regenerated board hash matches', () => {
  let progress = createEmptyProgress();
  progress = recordRandomPlay(progress, {
    seed: 1,
    difficulty: 'easy',
    params: { width: 5 },
    boardHash: boardHash(BOARD_A),
    minMoves: 4,
  });
  progress = recordRandomPlay(progress, {
    seed: 2,
    difficulty: 'easy',
    params: { width: 5 },
    boardHash: boardHash(BOARD_B),
    minMoves: 5,
  });

  const valid = filterValidRandomHistory(progress, (entry) => (entry.seed === 1 ? BOARD_A : BOARD_A));
  assert.deepEqual(valid.map((entry) => entry.seed), [1]);
});
