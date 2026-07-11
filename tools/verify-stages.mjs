import { parseBoard, validateBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { DIFFICULTY_PRESETS, generateStage, GeneratorError } from '../src/core/generator.js';
import { computeStageMetrics } from '../src/core/metrics.js';
import { solve } from '../src/core/solver.js';
import { STAGES } from '../src/core/stages.js';
import { PARAM_LAYERS } from './param-layers.mjs';

const DIFFICULTY_SEEDS = Array.from({ length: 5 }, (_, i) => 0x51f15e00 + i);
const LAYER_SEEDS = Array.from({ length: 2 }, (_, i) => 0x5A17E500 + i * 0x101);
const DIFFICULTIES = ['easy', 'normal', 'hard'];

class VerifyError extends Error {
  constructor(reason, detail = '') {
    super(detail ? `${reason}:${detail}` : reason);
    this.reason = reason;
    this.detail = detail;
  }
}

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
    minPushes: '-',
    boxChanges: '-',
    maxPhiBarrier: '-',
    ratio: '-',
    score: stage.metrics?.score ?? '-',
    expected: stage.minMoves,
    attempts: '-',
    status: 'PASS',
    reason: '',
    ms: 0,
  };

  try {
    const board = parseBoard(stage.text);
    const result = verifyBoard(board, stage.minMoves, stage.metrics);
    Object.assign(row, result);
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
  const { seedIndexes, ...layer } = PARAM_LAYERS[layerIndex];
  for (const baseSeed of LAYER_SEEDS) {
    const seed = (baseSeed + layerIndex * 0x10000) >>> 0;
    representativeRows.push(runGeneratedRepresentative({
      group: `layer:${layerIndex}`,
      seed,
      params: { seed, maxAttempts: layer.maxAttempts ?? 200, ...layer },
    }));
  }
}

for (const row of representativeRows) {
  if (row.status === 'FAIL') {
    failures += 1;
  }
}

const representativePass = representativeRows.filter((row) => row.status === 'PASS').length;
const representativeWarn = representativeRows.filter((row) => row.status === 'WARN').length;
const representativeFail = representativeRows.filter((row) => row.status === 'FAIL').length;
const elapsedSeconds = (Date.now() - overallStarted) / 1000;

printStageTable('embedded per-stage', stageRows);
console.log('');
printStageTable('representative per-stage', representativeRows);
console.log('');
console.log(`representative total=${representativeRows.length} pass=${representativePass} warn=${representativeWarn} fail=${representativeFail} elapsed=${elapsedSeconds.toFixed(3)}s`);
console.log(`overall ${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);

function runGeneratedRepresentative({ group, seed, params }) {
  const started = Date.now();
  const row = {
    group,
    id: '-',
    seed,
    minMoves: '-',
    minPushes: '-',
    boxChanges: '-',
    maxPhiBarrier: '-',
    ratio: '-',
    score: '-',
    expected: '-',
    attempts: '-',
    status: 'PASS',
    reason: '',
    ms: 0,
  };

  try {
    const stage = generateStage(params);
    row.attempts = formatAttempts(stage.attempt, params.maxAttempts);
    if (stage.attempt > params.maxAttempts * 0.5) {
      row.status = 'WARN';
    }
    const result = verifyBoard(stage.board, stage.minMoves);
    Object.assign(row, result);
    row.score = stage.metrics?.score ?? '-';
    row.expected = stage.minMoves;
  } catch (error) {
    row.status = 'FAIL';
    row.reason = reasonFromError(error);
    if (error instanceof GeneratorError) {
      row.attempts = formatAttempts(params.maxAttempts, params.maxAttempts);
    }
  } finally {
    row.ms = Date.now() - started;
  }

  return row;
}

function verifyBoard(board, expectedMinMoves, expectedMetrics = null) {
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

  const metrics = computeStageMetrics(board);
  if (metrics.solvable !== true) {
    throw new VerifyError('metrics_unsolved', metrics.reason ?? 'unsolved');
  }
  if (expectedMetrics !== null && expectedMetrics !== undefined) {
    assertMetric('minPushes', metrics.minPushes, expectedMetrics.minPushes);
    assertMetric('boxChanges', metrics.boxChanges, expectedMetrics.boxChanges);
    assertMetric('maxPhiBarrier', metrics.maxPhiBarrier, expectedMetrics.maxPhiBarrier);
    assertMetric('movesPushesRatio', roundMetric(metrics.movesPushesRatio), expectedMetrics.movesPushesRatio);
  }

  return {
    minMoves: solved.minMoves,
    minPushes: metrics.minPushes,
    boxChanges: metrics.boxChanges,
    maxPhiBarrier: metrics.maxPhiBarrier,
    ratio: roundMetric(metrics.movesPushesRatio),
  };
}

function assertMetric(name, actual, expected) {
  if (actual !== expected) {
    throw new VerifyError('metrics_mismatch', `${name} ${actual} != ${expected}`);
  }
}

function reasonFromError(error) {
  if (error instanceof VerifyError) {
    return error.detail ? `${error.reason}:${error.detail}` : error.reason;
  }
  if (error instanceof GeneratorError) {
    return 'generator_max_attempts';
  }
  return error?.message ?? 'unknown';
}

function printStageTable(title, rows) {
  console.log(title);
  console.log('group             id      seed       moves pushes changes phi ratio score attempts            status reason ms');
  console.log('----------------  ------  ---------  ----- ------ ------- --- ----- ----- ------------------ ------ ------ ---');
  for (const row of rows) {
    console.log([
      padRight(row.group, 16),
      padRight(row.id, 6),
      padLeft(row.seed, 9),
      padLeft(row.minMoves, 5),
      padLeft(row.minPushes, 6),
      padLeft(row.boxChanges, 7),
      padLeft(row.maxPhiBarrier, 3),
      padLeft(row.ratio, 5),
      padLeft(row.score, 5),
      padRight(row.attempts, 18),
      padRight(row.status, 6),
      padRight(row.reason, 6),
      padLeft(row.ms, 3),
    ].join('  '));
  }
}

function formatAttempts(attempt, maxAttempts) {
  return `attempts ${attempt}/${maxAttempts}`;
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

function padLeft(value, width) {
  return String(value).padStart(width, ' ');
}

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}
