import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard } from '../src/core/board.js';
import { solve } from '../src/core/solver.js';
import { computeStageMetrics } from '../src/core/metrics.js';
import { checkStageQuality, countBoxSwitches, hasRedundantBoxMovement } from '../src/core/quality.js';
import { STAGES } from '../src/core/stages.js';

function boardFromLines(lines) {
  return parseBoard(lines.join('\n'));
}

function checkedStage(board, overrides = {}) {
  const solved = solve(board);
  assert.equal(solved.solvable, true);
  return {
    board,
    solution: solved.solution,
    minMoves: solved.minMoves,
    ...overrides,
  };
}

test('Q-01: 品質チェックは同一入力に対して同一判定を返す', () => {
  const board = boardFromLines([
    '#######',
    '#     #',
    '#     #',
    '# @$ .#',
    '#     #',
    '#     #',
    '#######',
  ]);
  const stage = checkedStage(board);

  const results = Array.from({ length: 5 }, () => checkStageQuality(stage));
  for (const result of results) {
    assert.deepEqual(result, results[0]);
  }
});

test('Q-04: countBoxSwitches counts pushed box identity changes only', () => {
  const board = boardFromLines([
    '#######',
    '#@ $. #',
    '#  $ .#',
    '#######',
  ]);

  assert.equal(countBoxSwitches(board, 'RR'), 0, 'same box pushed twice');
  assert.equal(countBoxSwitches(board, 'RRLDR'), 1, 'pushes two different boxes');
});

test('Q-02: 冗長な箱移動を含む解は検出し、含まない解は検出しない', () => {
  /*
    Redundant case:

    #######
    #     #
    #     #
    # @$ .#
    #     #
    #     #
    #######

    solution = RUURRDDLUULLDDRR

    The first R pushes the only box from x=3 to x=4.
    After walking around, the L push moves that same box from x=4 back to x=3,
    a square already occupied by that box at the initial state. That L push is
    the redundant push.
  */
  const redundantBoard = boardFromLines([
    '#######',
    '#     #',
    '#     #',
    '# @$ .#',
    '#     #',
    '#     #',
    '#######',
  ]);
  assert.equal(hasRedundantBoxMovement(redundantBoard, 'RUURRDDLUULLDDRR'), true);

  const cleanBoard = boardFromLines([
    '######',
    '#@$.#',
    '######',
  ]);
  assert.equal(hasRedundantBoxMovement(cleanBoard, 'R'), false);
});

test('checkStageQuality は minMoves 不一致を reason で報告する', () => {
  const board = boardFromLines([
    '######',
    '#@$.#',
    '######',
  ]);
  const stage = checkedStage(board, { minMoves: 2 });

  assert.deepEqual(checkStageQuality(stage), {
    ok: false,
    reasons: ['minmoves_mismatch'],
  });
});

test('checkStageQuality は冗長な箱移動を reason で報告する', () => {
  const board = boardFromLines([
    '#######',
    '#     #',
    '#     #',
    '# @$ .#',
    '#     #',
    '#     #',
    '#######',
  ]);
  const stage = checkedStage(board, { solution: 'RUURRDDLUULLDDRR' });

  assert.deepEqual(checkStageQuality(stage), {
    ok: false,
    reasons: ['redundant_box_movement'],
  });
});

test('Q-03: selected embedded stages satisfy curation invariants', () => {
  assert.equal(STAGES.length, 10);
  assert.equal(new Set(STAGES.map((stage) => stage.id)).size, STAGES.length);
  assert.equal(new Set(STAGES.map((stage) => stage.name)).size, STAGES.length);

  const scores = STAGES.map((stage) => stage.metrics.score);
  assert.equal(scores[0], Math.min(...scores));
  assert.equal(scores.at(-1), Math.max(...scores));
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i] >= scores[i - 1], `score curve: ${scores.join(',')}`);
  }

  for (const stage of STAGES) {
    const board = parseBoard(stage.text);
    const metrics = computeStageMetrics(board);
    assert.ok(board.boxes.size <= 5, `${stage.id}: boxes=${board.boxes.size}`);
    assert.ok(board.width <= 12, `${stage.id}: width=${board.width}`);
    assert.ok(board.height <= 10, `${stage.id}: height=${board.height}`);
    if (!stage.policy?.startsWith('motif:')) {
      assert.equal(checkStageQuality({ ...stage, board }).ok, true, `${stage.id}: quality`);
    }
    assert.equal(stage.metrics.minPushes, metrics.minPushes, `${stage.id}: minPushes`);
  }
  for (const stage of STAGES.slice(7, 10)) {
    assert.ok(stage.metrics.maxPhiBarrier >= 1, `${stage.id}: maxPhiBarrier`);
  }
});
