import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, validateBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { solve } from '../src/core/solver.js';
import { STAGES } from '../src/core/stages.js';

function boardFor(stage) {
  return parseBoard(stage.text);
}

function assertSizeLimit(stage, board) {
  assert.ok(board.boxes.size <= 5, `${stage.id}: boxes=${board.boxes.size}`);
  assert.ok(board.width <= 12, `${stage.id}: width=${board.width}`);
  assert.ok(board.height <= 10, `${stage.id}: height=${board.height}`);
}

test('T-01: all embedded stages pass validateBoard', () => {
  assert.equal(STAGES.length, 10);
  for (const stage of STAGES) {
    const board = boardFor(stage);
    const validation = validateBoard(board);
    assert.equal(validation.ok, true, `${stage.id}: ${JSON.stringify(validation.errors)}`);
  }
});

for (const stage of STAGES) {
  test(`T-02/T-03: ${stage.id} is solvable and minMoves is solver-derived`, { timeout: 5000 }, () => {
    const board = boardFor(stage);
    const solved = solve(board);
    assert.equal(solved.solvable, true, `${stage.id}: solvable`);
    assert.equal(stage.minMoves, solved.minMoves, `${stage.id}: minMoves`);
  });
}

test('T-04: difficulty curve is roughly monotonic', () => {
  const moves = STAGES.map((stage) => stage.minMoves);
  assert.equal(moves[0], Math.min(...moves), 'stage01 should be easiest');
  assert.equal(moves.at(-1), Math.max(...moves), 'stage10 should be hardest');

  let inversions = 0;
  for (let i = 1; i < moves.length; i += 1) {
    if (moves[i] < moves[i - 1]) {
      inversions += 1;
    }
  }
  assert.ok(inversions <= 1, `too many inversions: ${moves.join(',')}`);
});

test('T-05: stage ids and names are unique', () => {
  assert.equal(new Set(STAGES.map((stage) => stage.id)).size, STAGES.length);
  assert.equal(new Set(STAGES.map((stage) => stage.name)).size, STAGES.length);
});

test('T-06: all embedded stages stay within solver size limits', () => {
  for (const stage of STAGES) {
    assertSizeLimit(stage, boardFor(stage));
  }
});

for (const stage of STAGES) {
  test(`embedded solver solution for ${stage.id} replays through Game.applyMoves`, { timeout: 5000 }, () => {
    const board = boardFor(stage);
    const solved = solve(board);
    const game = new Game(board);
    game.applyMoves(solved.solution);
    assert.equal(game.won, true, `${stage.id}: replay won`);
    assert.equal(game.log, solved.solution, `${stage.id}: replay log`);
  });
}
