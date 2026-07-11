import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateBoard } from '../src/core/board.js';
import { generateStage, DIFFICULTY_PRESETS } from '../src/core/generator.js';
import { solve } from '../src/core/solver.js';
import { solvePushes } from '../src/core/pushsolver.js';
import { computeStageMetrics } from '../src/core/metrics.js';
import { checkStageQuality } from '../src/core/quality.js';

const DIFFICULTIES = ['easy', 'normal', 'hard'];
const TARGET_PER_DIFFICULTY = 50;
const DEFAULT_BATCH_PER_WORKER = 4;
const SEED_BASES = {
  easy: 0x5eed0000,
  normal: 0x6eed0000,
  hard: 0x7eed0000,
};

if (isMainThread) {
  await main();
} else {
  runWorker();
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outPath = path.join(rootDir, 'src', 'core', 'seedpools.js');
  const workerCount = Math.max(1, Math.min(availableParallelism() - 1, 32));
  const batchSize = workerCount * DEFAULT_BATCH_PER_WORKER;
  const startedAt = performance.now();
  const pools = {};
  const report = {};

  for (const difficulty of DIFFICULTIES) {
    const difficultyStartedAt = performance.now();
    const result = await buildPoolForDifficulty(difficulty, workerCount, batchSize);
    pools[difficulty] = result.entries;
    report[difficulty] = {
      seconds: elapsedSeconds(difficultyStartedAt),
      attempts: result.attempts,
      accepted: result.entries.length,
    };
  }

  const hash = hashPools(pools);
  writeFileSync(outPath, renderSeedPoolsModule(pools, hash), 'utf8');

  const totalSeconds = elapsedSeconds(startedAt);
  console.log(`seed pools built in ${totalSeconds.toFixed(3)}s with ${workerCount} workers`);
  for (const difficulty of DIFFICULTIES) {
    const item = report[difficulty];
    console.log(`${difficulty}: ${item.accepted}/${TARGET_PER_DIFFICULTY} accepted, attempts=${item.attempts}, seconds=${item.seconds.toFixed(3)}`);
  }
  console.log(`output: ${path.relative(rootDir, outPath).split(path.sep).join('/')}`);
}

async function buildPoolForDifficulty(difficulty, workerCount, batchSize) {
  const accepted = [];
  let attempts = 0;
  let cursor = SEED_BASES[difficulty];

  while (accepted.length < TARGET_PER_DIFFICULTY) {
    const ranges = [];
    const rangeSize = Math.ceil(batchSize / workerCount);
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      const start = cursor + workerIndex * rangeSize;
      const end = Math.min(cursor + batchSize, start + rangeSize);
      if (start < end) {
        ranges.push({ start, end });
      }
    }

    const results = await Promise.all(ranges.map((range) => runRangeWorker(difficulty, range)));
    for (const result of results) {
      attempts += result.attempts;
      accepted.push(...result.entries);
    }
    accepted.sort(compareEntries);
    cursor += batchSize;
  }

  return {
    entries: accepted.slice(0, TARGET_PER_DIFFICULTY),
    attempts,
  };
}

function runRangeWorker(difficulty, range) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: { difficulty, range },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited with code ${code}`));
      }
    });
  });
}

function runWorker() {
  const { difficulty, range } = workerData;
  const entries = [];
  let attempts = 0;
  for (let seed = range.start; seed < range.end; seed += 1) {
    attempts += 1;
    const entry = verifySeed(difficulty, seed >>> 0);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  parentPort.postMessage({ attempts, entries });
}

function verifySeed(difficulty, seed) {
  const preset = DIFFICULTY_PRESETS[difficulty];
  const params = { ...preset };
  let stage;
  try {
    stage = generateStage({ ...params, seed });
  } catch {
    return null;
  }

  if (!validateBoard(stage.board).ok) {
    return null;
  }

  const solved = solve(stage.board);
  if (solved.solvable !== true || solved.minMoves !== stage.minMoves) {
    return null;
  }

  const pushSolved = solvePushes(stage.board);
  if (pushSolved.solvable !== true) {
    return null;
  }

  const metrics = computeStageMetrics(stage.board);
  if (metrics.solvable !== true) {
    return null;
  }
  if (metrics.minPushes < preset.minPushesFloor) {
    return null;
  }
  if (metrics.maxPhiBarrier < (preset.maxPhiBarrierFloor ?? 0)) {
    return null;
  }
  if (pushSolved.minPushes !== metrics.minPushes) {
    return null;
  }
  if (!checkStageQuality(stage).ok) {
    return null;
  }

  return {
    seed,
    params,
    minPushes: metrics.minPushes,
    maxPhiBarrier: metrics.maxPhiBarrier,
    minMoves: stage.minMoves,
    optimalSolution: solved.solution,
  };
}

function renderSeedPoolsModule(pools, hash) {
  return `// GENERATED FILE - do not edit by hand.
// Regenerate with: node tools/build-seed-pools.mjs

export const SEED_POOLS = ${JSON.stringify(pools, null, 2)};

export const SEED_POOL_HASH = ${JSON.stringify(hash)};
`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashPools(pools) {
  return createHash('sha256').update(stableJson(pools)).digest('hex');
}

function compareEntries(left, right) {
  return left.seed - right.seed;
}

function elapsedSeconds(startedAt) {
  return (performance.now() - startedAt) / 1000;
}
