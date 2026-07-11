import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateBoard } from '../src/core/board.js';
import { generateStage, DIFFICULTY_PRESETS } from '../src/core/generator.js';
import { solve } from '../src/core/solver.js';
import { computeStageMetrics } from '../src/core/metrics.js';
import { checkStageQuality } from '../src/core/quality.js';
import { solvePushes } from '../src/core/pushsolver.js';
import { SEED_POOLS, SEED_POOL_HASH } from '../src/core/seedpools.js';

const DIFFICULTIES = ['easy', 'normal', 'hard'];
const SAMPLE_COUNT = 10;

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

function sampleEntries(entries) {
  if (entries.length <= SAMPLE_COUNT) {
    return entries;
  }
  const last = entries.length - 1;
  const indexes = new Set();
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    indexes.add(Math.round((i * last) / (SAMPLE_COUNT - 1)));
  }
  return [...indexes].sort((a, b) => a - b).map((index) => entries[index]);
}

test('SP-01: each difficulty has 50 pooled seeds', () => {
  assert.deepEqual(Object.keys(SEED_POOLS).sort(), DIFFICULTIES.toSorted());
  for (const difficulty of DIFFICULTIES) {
    assert.equal(SEED_POOLS[difficulty].length, 50, difficulty);
  }
});

test('SP-02: sampled entries regenerate and match baked metrics', { timeout: 120000 }, () => {
  for (const difficulty of DIFFICULTIES) {
    for (const entry of sampleEntries(SEED_POOLS[difficulty])) {
      const stage = generateStage({ ...entry.params, seed: entry.seed });
      const validation = validateBoard(stage.board);
      assert.equal(validation.ok, true, `${difficulty} seed=${entry.seed}`);

      const solved = solve(stage.board);
      assert.equal(solved.solvable, true, `${difficulty} seed=${entry.seed}`);
      assert.equal(solved.minMoves, entry.minMoves, `${difficulty} seed=${entry.seed}`);

      const pushSolved = solvePushes(stage.board);
      assert.equal(pushSolved.solvable, true, `${difficulty} seed=${entry.seed}`);
      assert.equal(pushSolved.minPushes, entry.minPushes, `${difficulty} seed=${entry.seed}`);

      const metrics = computeStageMetrics(stage.board);
      assert.equal(metrics.minPushes, entry.minPushes, `${difficulty} seed=${entry.seed}`);
      assert.equal(metrics.maxPhiBarrier, entry.maxPhiBarrier, `${difficulty} seed=${entry.seed}`);
      assert.ok(metrics.minPushes >= DIFFICULTY_PRESETS[difficulty].minPushesFloor);
      assert.ok(metrics.maxPhiBarrier >= (DIFFICULTY_PRESETS[difficulty].maxPhiBarrierFloor ?? 0));
      assert.equal(checkStageQuality(stage).ok, true, `${difficulty} seed=${entry.seed}`);
    }
  }
});

test('SP-03: pooled seeds are unique globally', () => {
  const seeds = DIFFICULTIES.flatMap((difficulty) => SEED_POOLS[difficulty].map((entry) => entry.seed));
  assert.equal(new Set(seeds).size, seeds.length);
});

test('SP-04: baked pool hash is deterministic', () => {
  assert.equal(hashPools(SEED_POOLS), SEED_POOL_HASH);
});

test('SP-05: sampled entries have baked solver-derived optimalSolution', { timeout: 120000 }, () => {
  for (const difficulty of DIFFICULTIES) {
    for (const entry of sampleEntries(SEED_POOLS[difficulty])) {
      const stage = generateStage({ ...entry.params, seed: entry.seed });
      const solved = solve(stage.board);
      assert.equal(solved.solvable, true, `${difficulty} seed=${entry.seed}`);
      assert.equal(entry.optimalSolution, solved.solution, `${difficulty} seed=${entry.seed}`);
      assert.equal(entry.optimalSolution.length, solved.minMoves, `${difficulty} seed=${entry.seed}`);
    }
  }
});
