import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { DIFFICULTY_PRESETS, generateStage } from '../src/core/generator.js';
import { solve as solveMoves } from '../src/core/solver.js';
import { pushStateKey, solvePushes } from '../src/core/pushsolver.js';

function boardFromLines(lines) {
  return parseBoard(lines.join('\n'));
}

function countPushes(board, solution) {
  const game = new Game(board);
  let pushes = 0;
  for (const dir of solution) {
    const result = game.move(dir);
    assert.equal(result.moved, true, `illegal move ${dir} in ${solution}`);
    if (result.pushed) pushes += 1;
  }
  return pushes;
}

function assertSolutionWins(board, result) {
  assert.equal(result.solvable, true);
  const game = new Game(board);
  game.applyMoves(result.solution);
  assert.equal(game.won, true);
  assert.equal(game.log, result.solution);
  assert.equal(game.moves, result.movesOfSolution);
}

test('P-01: known tiny board 1 has minPushes=1 and movesOfSolution=1', () => {
  const board = boardFromLines([
    '######',
    '#@$.#',
    '######',
  ]);
  const result = solvePushes(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minPushes, 1);
  assert.equal(result.movesOfSolution, 1);
});

test('P-01: known tiny board 2 has minPushes=2 and movesOfSolution=3', () => {
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#######',
  ]);
  const result = solvePushes(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minPushes, 2);
  assert.equal(result.movesOfSolution, 3);
});

test('P-01: known tiny board 3 has minPushes=1 and movesOfSolution=2', () => {
  const board = boardFromLines([
    '#####',
    '#@  #',
    '# $ #',
    '# . #',
    '#####',
  ]);
  const result = solvePushes(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minPushes, 1);
  assert.equal(result.movesOfSolution, 2);
});

test('P-02/P-06: unsolvable dead-square board returns solvable=false', () => {
  const board = boardFromLines([
    '#####',
    '#@  #',
    '#$ .#',
    '#####',
  ]);
  const result = solvePushes(board);
  assert.equal(result.solvable, false);
  assert.equal(result.minPushes, null);
  assert.equal(result.movesOfSolution, null);
  assert.equal(result.solution, null);
  assert.equal(result.pushSequence, null);
});

test('API: maxStates is an expansion limit and returns solvable=null on limit', () => {
  const board = boardFromLines([
    '######',
    '#@$.#',
    '######',
  ]);
  const result = solvePushes(board, { maxStates: 0 });
  assert.equal(result.solvable, null);
  assert.equal(result.reason, 'limit');
  assert.equal(result.minPushes, null);
  assert.equal(result.movesOfSolution, null);
  assert.equal(result.solution, null);
  assert.equal(result.pushSequence, null);
  assert.equal(result.stats.expanded, 0);
  assert.equal(result.stats.visited, 1);
});

test('P-03: representative solution is playable by Game.applyMoves', () => {
  const boards = [
    boardFromLines(['######', '#@$.#', '######']),
    boardFromLines(['#######', '#@ $ .#', '#######']),
    boardFromLines(['#####', '#@  #', '# $ #', '# . #', '#####']),
    boardFromLines(['#######', '#* @$.#', '#######']),
  ];
  for (const board of boards) {
    assertSolutionWins(board, solvePushes(board));
  }
});

test('P-04: pushSequence length matches minPushes and pushed moves in solution', () => {
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#  $ .#',
    '#######',
  ]);
  const result = solvePushes(board);
  assertSolutionWins(board, result);
  assert.equal(result.pushSequence.length, result.minPushes);
  assert.equal(countPushes(board, result.solution), result.minPushes);
  for (const push of result.pushSequence) {
    assert.equal(typeof push.dir, 'string');
    assert.equal(typeof push.boxFrom, 'number');
    assert.equal(typeof push.boxTo, 'number');
  }
});

test('P-05/P-06: fixed generated boards agree with move-BFS solvability and bounds', () => {
  const params = { ...DIFFICULTY_PRESETS.easy, minPushesFloor: 0, maxAttempts: 2000 };
  const samples = [];
  for (let i = 0; i < 20; i += 1) {
    const stage = generateStage({ seed: 0x0ddba5e0 + i, ...params });
    const moveResult = solveMoves(stage.board);
    const pushResult = solvePushes(stage.board);
    assert.equal(pushResult.solvable, moveResult.solvable, `seed offset ${i}`);
    if (pushResult.solvable) {
      assert.ok(pushResult.minPushes <= countPushes(stage.board, moveResult.solution), `seed offset ${i}`);
      assert.ok(pushResult.movesOfSolution >= moveResult.minMoves, `seed offset ${i}`);
      if (samples.length < 3) {
        samples.push({
          i,
          moveExpanded: moveResult.stats.expanded,
          pushExpanded: pushResult.stats.expanded,
        });
      }
    }
  }
  globalThis.__pushSolverStatsSamples = samples;
});

test('P-07: solvePushes is deterministic for identical input', () => {
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#  $ .#',
    '#######',
  ]);
  const first = solvePushes(board);
  const second = solvePushes(board);
  assert.equal(first.solution, second.solution);
  assert.deepEqual(first.pushSequence, second.pushSequence);
  assert.deepEqual(first.stats, second.stats);
});

test('P-08: canonical key normalizes player positions inside the same reachable component', () => {
  const walls = new Set([0, 1, 2, 3, 4, 5, 6, 7, 13, 14, 20, 21, 22, 23, 24, 25, 26, 27]);
  const goals = new Set([11]);
  const boxes = new Set([10]);
  const boardA = { width: 7, height: 4, walls, goals, boxes, player: 8 };
  const boardB = { width: 7, height: 4, walls, goals, boxes, player: 9 };
  assert.equal(pushStateKey(boardA, boxes, boardA.player), pushStateKey(boardB, boxes, boardB.player));
});

test('P-05 stats samples are available for completion report', () => {
  assert.ok(Array.isArray(globalThis.__pushSolverStatsSamples));
  assert.ok(globalThis.__pushSolverStatsSamples.length > 0);
});
