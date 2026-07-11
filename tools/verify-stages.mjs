import { parseBoard, validateBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { DIFFICULTY_PRESETS, generateStage, GeneratorError } from '../src/core/generator.js';
import { solve } from '../src/core/solver.js';
import { STAGES } from '../src/core/stages.js';
import { PARAM_LAYERS } from './param-layers.mjs';

const DIFFICULTY_SEEDS = Array.from({ length: 20 }, (_, i) => 0x51f15e00 + i);
const LAYER_SEEDS = Array.from({ length: 5 }, (_, i) => 0x5A17E500 + i * 0x101);
const DIFFICULTIES = ['easy', 'normal', 'hard'];

if (!process.argv.includes('--all')) {
  console.log('usage: node tools/verify-stages.mjs --all');
  process.exit(1);
}

const stageRows = [];
let failures = 0;
const overallStarted = Date.now();

for (const stage of STAGES) {
  const started = Date.now();
  const row = {
    group: 'embedded',
    id: stage.id,
    seed: stage.seed,
    minMoves: '-',
    expected: stage.minMoves,
    status: 'PASS',
    reason: '',
    ms: 0,
  };

  try {
    const board = parseBoard(stage.text);
    row.minMoves = verifyBoard(board, stage.minMoves);
  } catch (error) {
    row.status = 'FAIL';
    row.reason = reasonFromError(error);
    failures += 1;
  } finally {
    row.ms = Date.now() - started;
    stageRows.push(row);
  }
}

const representativeRows = [];

for (const difficulty of DIFFICULTIES) {
  for (const seed of DIFFICULTY_SEEDS) {
    representativeRows.push(runGeneratedRepresentative({
      group: `difficulty:${difficulty}`,
      seed,
      params: { seed, ...DIFFICULTY_PRESETS[difficulty] },
    }));
  }
}

for (let layerIndex = 0; layerIndex < PARAM_LAYERS.length; layerIndex += 1) {
  const layer = PARAM_LAYERS[layerIndex];
  for (const baseSeed of LAYER_SEEDS) {
    const seed = (baseSeed + layerIndex * 0x10000) >>> 0;
    representativeRows.push(runGeneratedRepresentative({
      group: `layer:${layerIndex}`,
      seed,
      params: { seed, ...layer, maxAttempts: 120 },
    }));
  }
}

for (const row of representativeRows) {
  if (row.status !== 'PASS') {
    failures += 1;
  }
}

const representativePass = representativeRows.filter((row) => row.status === 'PASS').length;
const representativeFail = representativeRows.length - representativePass;
const elapsedSeconds = (Date.now() - overallStarted) / 1000;

printStageTable('embedded per-stage', stageRows);
console.log('');
printStageTable('representative per-stage', representativeRows);
console.log('');
console.log(`representative total=${representativeRows.length} pass=${representativePass} fail=${representativeFail} elapsed=${elapsedSeconds.toFixed(3)}s`);
console.log(`overall ${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);

function runGeneratedRepresentative({ group, seed, params }) {
  const started = Date.now();
  const row = {
    group,
    id: '-',
    seed,
    minMoves: '-',
    expected: '-',
    status: 'PASS',
    reason: '',
    ms: 0,
  };

  try {
    const stage = generateStage(params);
    row.minMoves = verifyBoard(stage.board, stage.minMoves);
    row.expected = stage.minMoves;
  } catch (error) {
    row.status = 'FAIL';
    row.reason = reasonFromError(error);
  } finally {
    row.ms = Date.now() - started;
  }

  return row;
}

function verifyBoard(board, expectedMinMoves) {
  const validation = validateBoard(board);
  if (!validation.ok) {
    throw new VerifyError('validate_failed', validation.errors.map((error) => error.code).join(','));
  }

  const solved = solve(board);
  if (solved.solvable !== true) {
    throw new VerifyError(solved.reason === 'limit' ? 'limit' : 'unsolvable', solved.reason ?? 'unsolved');
  }
  if (solved.minMoves !== expectedMinMoves) {
    throw new VerifyError('minmoves_mismatch', `${solved.minMoves} != ${expectedMinMoves}`);
  }

  const game = new Game(board);
  try {
    game.applyMoves(solved.solution);
  } catch (error) {
    throw new VerifyError('apply_failed', error.message);
  }
  if (!game.won || game.log !== solved.solution) {
    throw new VerifyError('apply_failed', 'replay_mismatch');
  }

  return solved.minMoves;
}

function reasonFromError(error) {
  if (error instanceof VerifyError) {
    return error.detail ? `${error.reason}:${error.detail}` : error.reason;
  }
  if (error instanceof GeneratorError) {
    return 'limit';
  }
  return error?.message ?? 'unknown';
}

class VerifyError extends Error {
  constructor(reason, detail = '') {
    super(detail ? `${reason}:${detail}` : reason);
    this.reason = reason;
    this.detail = detail;
  }
}

function printStageTable(title, rows) {
  console.log(title);
  console.log('group             id      seed       minMoves expected status reason ms');
  console.log('----------------  ------  ---------  -------- -------- ------ ------ ---');
  for (const row of rows) {
    console.log([
      padRight(row.group, 16),
      padRight(row.id, 6),
      padLeft(row.seed, 9),
      padLeft(row.minMoves, 8),
      padLeft(row.expected, 8),
      padRight(row.status, 6),
      padRight(row.reason, 6),
      padLeft(row.ms, 3),
    ].join('  '));
  }
}

function padLeft(value, width) {
  return String(value).padStart(width, ' ');
}

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}
