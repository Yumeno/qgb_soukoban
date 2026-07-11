import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeBoard, validateBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { solve } from '../src/core/solver.js';
import {
  DIFFICULTY_PRESETS,
  GeneratorError,
  generateStage,
} from '../src/core/generator.js';

const FIXED_SEEDS = Array.from({ length: 20 }, (_, i) => 0x51f15e00 + i);
const DIFFICULTIES = ['easy', 'normal', 'hard'];

function generatePreset(seed, name) {
  return generateStage({ seed, ...DIFFICULTY_PRESETS[name] });
}

function fingerprint(stage) {
  return JSON.stringify({
    board: serializeBoard(stage.board),
    solution: stage.solution,
    minMoves: stage.minMoves,
    seed: stage.seed,
    params: stage.params,
    attempt: stage.attempt,
  });
}

test('N-01: 固定シード20個 x 3プリセットは validateBoard 合格かつ solve で可解', () => {
  for (const difficulty of DIFFICULTIES) {
    const boards = new Set();
    for (const seed of FIXED_SEEDS) {
      const stage = generatePreset(seed, difficulty);
      boards.add(serializeBoard(stage.board));
      const validation = validateBoard(stage.board);
      assert.equal(validation.ok, true, `${difficulty} seed=${seed}: ${JSON.stringify(validation.errors)}`);

      const solved = solve(stage.board);
      assert.equal(solved.solvable, true, `${difficulty} seed=${seed}`);
      assert.equal(stage.minMoves, solved.minMoves);
    }
    // Fixed seeds should keep producing 20 distinct boards per difficulty.
    assert.equal(boards.size, FIXED_SEEDS.length, `${difficulty}: generated boards degenerated`);
  }
});

test('N-02: 同一 seed と同一パラメータは完全に同一結果を返す', () => {
  const params = { seed: 123456789, ...DIFFICULTY_PRESETS.normal };
  const first = generateStage(params);
  const second = generateStage(params);
  assert.equal(fingerprint(first), fingerprint(second));
});

test('N-03: 異なる seed で少なくとも1面は異なる', () => {
  const a = [];
  const b = [];
  for (let i = 0; i < 8; i += 1) {
    a.push(fingerprint(generatePreset(7000 + i, 'easy')));
    b.push(fingerprint(generatePreset(8000 + i, 'easy')));
  }
  assert.ok(a.some((value, i) => value !== b[i]));
});

test('N-04: 各難易度は minMovesFloor を満たし、easy < normal < hard', () => {
  assert.ok(DIFFICULTY_PRESETS.easy.minMovesFloor < DIFFICULTY_PRESETS.normal.minMovesFloor);
  assert.ok(DIFFICULTY_PRESETS.normal.minMovesFloor < DIFFICULTY_PRESETS.hard.minMovesFloor);

  for (const difficulty of DIFFICULTIES) {
    const stage = generatePreset(0x0f04cafe, difficulty);
    assert.ok(
      stage.minMoves >= DIFFICULTY_PRESETS[difficulty].minMovesFloor,
      `${difficulty}: minMoves=${stage.minMoves}`,
    );
  }
});

test('N-05: 生成面の箱数と盤面サイズはパラメータ通り', () => {
  const params = { seed: 424242, width: 9, height: 7, boxCount: 3, pullSteps: 18, minMovesFloor: 4 };
  const stage = generateStage(params);
  assert.equal(stage.board.width, params.width);
  assert.equal(stage.board.height, params.height);
  assert.equal(stage.board.boxes.size, params.boxCount);
  assert.equal(stage.board.goals.size, params.boxCount);
});

test('N-06: solution を applyMoves すると固定シード全件で勝利到達する', () => {
  for (const difficulty of DIFFICULTIES) {
    for (const seed of FIXED_SEEDS) {
      const stage = generatePreset(seed, difficulty);
      const game = new Game(stage.board);
      game.applyMoves(stage.solution);
      assert.equal(game.won, true, `${difficulty} seed=${seed}`);
      assert.equal(game.log, stage.solution, `${difficulty} seed=${seed}`);
      assert.equal(game.moves, stage.solution.length, `${difficulty} seed=${seed}`);
    }
  }
});

test('N-07: 充足不能パラメータは maxAttempts 到達で GeneratorError', () => {
  assert.throws(
    () => generateStage({
      seed: 1,
      width: 5,
      height: 5,
      boxCount: 5,
      pullSteps: 1,
      maxAttempts: 3,
      minMovesFloor: 999,
    }),
    GeneratorError,
  );
});
