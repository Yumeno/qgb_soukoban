import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeBoard } from '../src/core/board.js';
import { generateStage, GeneratorError } from '../src/core/generator.js';
import { checkStageQuality } from '../src/core/quality.js';
import { solve } from '../src/core/solver.js';
import { PARAM_LAYERS } from './param-layers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'src/core/stages.js');

// D3 provisional score. Calibrate these weights with test play feedback.
const SCORE_WEIGHTS = {
  minPushes: 1,
  boxChanges: 2,
  maxPhiBarrier: 5,
  dependencyDepth: 4,
  dependencyCount: 3,
  mutualDependency: 15,
  constrainedGoalDegree: 2,
  constrainedGoalDegreeBase: 3,
  ratioPenaltyThreshold: 3,
  ratioPenalty: 2,
};

const MASTER_SEEDS = Array.from({ length: 12 }, (_, i) => 0x5A17E000 + i * 0x101);
const SUPPLEMENTAL_LAYERS = [
  {
    width: 9,
    height: 7,
    boxCount: 4,
    pullSteps: 28,
    minPushesFloor: 5,
    maxPhiBarrierFloor: 0,
    wallDensity: 0.04,
    goalClustering: true,
    maxAttempts: 40,
    seedValues: [1258295352],
  },
  {
    width: 9,
    height: 7,
    boxCount: 4,
    pullSteps: 56,
    minPushesFloor: 8,
    maxPhiBarrierFloor: 1,
    wallDensity: 0.08,
    goalClustering: false,
    maxAttempts: 240,
    seedValues: [1258299487],
  },
];
const CURATION_LAYERS = PARAM_LAYERS.concat(SUPPLEMENTAL_LAYERS);

const generated = [];
const seenBoards = new Set();
let failures = 0;
const layerStats = CURATION_LAYERS.map(() => ({
  generated: 0,
  qualityPass: 0,
  generatorErrors: 0,
}));

for (let layerIndex = 0; layerIndex < CURATION_LAYERS.length; layerIndex += 1) {
  const { seedIndexes, seedValues, ...layer } = CURATION_LAYERS[layerIndex];
  const seedSource = seedValues ?? seedIndexes ?? MASTER_SEEDS.map((_, index) => index);
  for (const seedEntry of seedSource) {
    const seed = seedValues ? seedEntry : (MASTER_SEEDS[seedEntry] + layerIndex * 0x10000) >>> 0;
    const params = { seed, maxAttempts: layer.maxAttempts ?? 200, ...layer };
    try {
      const stage = generateStage(params);
      layerStats[layerIndex].generated += 1;
      const text = serializeBoard(stage.board);

      const quality = layer.motif ? { ok: true } : checkStageQuality({ ...stage, solution: undefined });
      if (!quality.ok) {
        continue;
      }
      layerStats[layerIndex].qualityPass += 1;
      if (seenBoards.has(text)) {
        continue;
      }
      seenBoards.add(text);
      const score = scoreMetrics(stage.metrics);
      generated.push({ ...stage, text, score });
    } catch (error) {
      if (!(error instanceof GeneratorError)) {
        throw error;
      }
      failures += 1;
      layerStats[layerIndex].generatorErrors += 1;
    }
  }
}

const emptyQualityLayers = layerStats
  .map((stats, index) => ({ stats, index }))
  .filter(({ stats }) => stats.qualityPass === 0);
if (emptyQualityLayers.length > 0) {
  printLayerStats(layerStats);
  console.error(`curate-stages: quality pass is zero for layer(s): ${emptyQualityLayers.map(({ index }) => index).join(', ')}`);
  process.exit(1);
}

const selected = selectStages(generated);
writeFileSync(OUT_FILE, renderStages(selected), 'utf8');
printSummary(generated, selected, failures, layerStats);

function selectStages(candidates) {
  const sorted = [...candidates].sort(compareCandidate);
  const depPool = sorted.filter((candidate) => candidate.metrics.dependencyDepth >= 1);
  const phiDepPool = sorted.filter((candidate) => candidate.metrics.maxPhiBarrier >= 1 && candidate.metrics.dependencyDepth >= 1);
  const stage10Pool = sorted.filter(satisfiesStage10);
  if (depPool.length < 2) {
    throw new Error(`curate-stages: need at least 2 dependencyDepth>=1 candidates, got ${depPool.length}`);
  }
  if (phiDepPool.length < 2) {
    throw new Error(`curate-stages: need at least 2 phi+dependency candidates, got ${phiDepPool.length}`);
  }
  if (stage10Pool.length < 1) {
    throw new Error('curate-stages: no stage10 dependency candidate');
  }

  const finalStages = buildDiverseSequence(sorted);
  if (finalStages.length !== 10) {
    throw new Error(`curate-stages: selected ${finalStages.length} stages`);
  }
  for (let i = 1; i < finalStages.length; i += 1) {
    if (finalStages[i].score <= finalStages[i - 1].score) {
      throw new Error(`curate-stages: selected score curve is not strictly increasing (${finalStages.map((stage) => roundMetric(stage.score)).join(',')})`);
    }
  }
  if (finalStages[0].board.boxes.size !== 1) {
    throw new Error('curate-stages: stage01 is not a one-box intro stage');
  }
  assertDiversityConstraints(finalStages);
  assertRankConstraints(finalStages);
  return finalStages;
}

function buildDiverseSequence(sorted) {
  const pools = Array.from({ length: 10 }, (_, index) => {
    if (index === 0) {
      return sorted.filter((candidate) => candidate.board.boxes.size === 1);
    }
    if (index >= 5 && index <= 6) {
      return sorted.filter((candidate) => candidate.metrics.dependencyDepth >= 1);
    }
    if (index >= 7 && index <= 8) {
      return sorted.filter((candidate) => candidate.metrics.maxPhiBarrier >= 1 && candidate.metrics.dependencyDepth >= 1);
    }
    if (index === 9) {
      return sorted.filter(satisfiesStage10);
    }
    return sorted;
  });

  const result = visit(0, [], {
    texts: new Set(),
    signatures: new Set(),
    policyCounts: new Map(),
    upperScatteredCount: 0,
  });
  if (result === null) {
    throw new Error('curate-stages: diversity constraints conflict with rank/score constraints');
  }
  return result;

  function visit(index, picks, state) {
    if (index === pools.length) {
      return picks;
    }

    const previous = picks.at(-1);
    const preferredGap = previous === undefined ? -Infinity : previous.score + 2;
    const candidates = orderByPreferredGap(pools[index], preferredGap);
    for (const candidate of candidates) {
      if (!canAppend(candidate, previous, state, index)) {
        continue;
      }
      const nextState = appendState(candidate, state, index);
      const result = visit(index + 1, picks.concat(candidate), nextState);
      if (result !== null) {
        return result;
      }
    }
    return null;
  }
}

function assertRankConstraints(stages) {
  for (let i = 5; i <= 6; i += 1) {
    if (stages[i].metrics.dependencyDepth < 1) {
      throw new Error(`curate-stages: stage${String(i + 1).padStart(2, '0')} dependencyDepth < 1`);
    }
  }
  for (let i = 7; i <= 8; i += 1) {
    const metrics = stages[i].metrics;
    if (metrics.maxPhiBarrier < 1 || metrics.dependencyDepth < 1) {
      throw new Error(`curate-stages: stage${String(i + 1).padStart(2, '0')} requires phi>=1 and dependencyDepth>=1`);
    }
  }
  if (!satisfiesStage10(stages[9])) {
    throw new Error('curate-stages: stage10 dependency condition failed');
  }
}

function satisfiesStage10(candidate) {
  const metrics = candidate.metrics;
  return metrics.maxPhiBarrier >= 1
    && (metrics.dependencyDepth >= 2 || metrics.mutualDependency || metrics.dependencyCount >= 2);
}

function canAppend(candidate, previous, state, index) {
  if (previous !== undefined && candidate.score <= previous.score) {
    return false;
  }
  if (state.texts.has(candidate.text) || state.signatures.has(structuralSignature(candidate))) {
    return false;
  }
  const policy = policyKey(candidate);
  if (policy === 'scattered') {
    if (index >= 5 && state.upperScatteredCount >= 1) {
      return false;
    }
  } else {
    if ((state.policyCounts.get(policy) ?? 0) >= 2) {
      return false;
    }
    if (previous !== undefined && policyKey(previous) === policy) {
      return false;
    }
  }
  if (index >= 6 && previous !== undefined) {
    if (policyKey(previous) === policy) {
      return false;
    }
    if (upperFeelSignature(previous) === upperFeelSignature(candidate)) {
      return false;
    }
  }
  return true;
}

function appendState(candidate, state, index) {
  const next = {
    texts: new Set(state.texts),
    signatures: new Set(state.signatures),
    policyCounts: new Map(state.policyCounts),
    upperScatteredCount: state.upperScatteredCount,
  };
  next.texts.add(candidate.text);
  next.signatures.add(structuralSignature(candidate));
  const policy = policyKey(candidate);
  if (policy === 'scattered') {
    if (index >= 5) {
      next.upperScatteredCount += 1;
    }
  } else {
    next.policyCounts.set(policy, (next.policyCounts.get(policy) ?? 0) + 1);
  }
  return next;
}

function orderByPreferredGap(pool, preferredGap) {
  const preferred = [];
  const fallback = [];
  for (const candidate of pool) {
    if (candidate.score >= preferredGap) {
      preferred.push(candidate);
    } else {
      fallback.push(candidate);
    }
  }
  return preferred.concat(fallback);
}

function assertDiversityConstraints(stages) {
  const signatures = new Set();
  const policyCounts = new Map();
  let upperScatteredCount = 0;
  for (const [index, stage] of stages.entries()) {
    const signature = structuralSignature(stage);
    if (signatures.has(signature)) {
      throw new Error(`curate-stages: duplicate structural signature ${signature}`);
    }
    signatures.add(signature);

    const policy = policyKey(stage);
    if (policy === 'scattered') {
      if (index >= 5) {
        upperScatteredCount += 1;
        if (upperScatteredCount > 1) {
          throw new Error(`curate-stages: scattered selected ${upperScatteredCount} times in stage06-stage10`);
        }
      }
    } else {
      const count = (policyCounts.get(policy) ?? 0) + 1;
      if (count > 2) {
        throw new Error(`curate-stages: policy '${policy}' selected ${count} times`);
      }
      if (index > 0 && policyKey(stages[index - 1]) === policy) {
        throw new Error(`curate-stages: adjacent policy '${policy}'`);
      }
      policyCounts.set(policy, count);
    }
    if (index >= 6) {
      const previous = stages[index - 1];
      if (policyKey(previous) === policy) {
        throw new Error(`curate-stages: adjacent upper policy '${policy}'`);
      }
      if (upperFeelSignature(previous) === upperFeelSignature(stage)) {
        throw new Error(`curate-stages: adjacent upper feel signature ${upperFeelSignature(stage)}`);
      }
    }
  }
}

function structuralSignature(stage) {
  const metrics = stage.metrics;
  return [
    metrics.minPushes,
    metrics.boxChanges,
    metrics.maxPhiBarrier,
    metrics.dependencyCount,
    metrics.dependencyDepth,
    metrics.mutualDependency,
    metrics.minGoalPushDegree,
    stage.board.width,
    stage.board.height,
    stage.board.boxes.size,
  ].join('|');
}

function policyKey(stage) {
  if (typeof stage.policy === 'string' && stage.policy.length > 0) {
    return stage.policy;
  }
  if (stage.motif !== null && stage.motif !== undefined) {
    return `motif:${stage.motif}`;
  }
  return 'scattered';
}

function upperFeelSignature(stage) {
  return [
    stage.board.boxes.size,
    stage.metrics.mutualDependency,
  ].join('|');
}

function compareCandidate(a, b) {
  return a.score - b.score
    || a.metrics.minPushes - b.metrics.minPushes
    || b.metrics.boxChanges - a.metrics.boxChanges
    || b.metrics.maxPhiBarrier - a.metrics.maxPhiBarrier
    || a.board.boxes.size - b.board.boxes.size
    || a.board.width - b.board.width
    || a.board.height - b.board.height
    || a.seed - b.seed
    || a.params.pullSteps - b.params.pullSteps
    || compareOrdinal(a.text, b.text);
}

function spreadPick(pool, count) {
  if (count <= 0) {
    return [];
  }
  if (pool.length < count) {
    return pool.slice();
  }
  const picks = [];
  const used = new Set();
  for (let i = 0; i < count; i += 1) {
    const target = count === 1 ? pool.length - 1 : Math.round((i * (pool.length - 1)) / (count - 1));
    let index = target;
    while (index < pool.length && used.has(index)) {
      index += 1;
    }
    if (index >= pool.length) {
      index = target - 1;
      while (index >= 0 && used.has(index)) {
        index -= 1;
      }
    }
    if (index >= 0) {
      used.add(index);
      picks.push(pool[index]);
    }
  }
  return picks;
}

function scoreMetrics(metrics) {
  return SCORE_WEIGHTS.minPushes * metrics.minPushes
    + SCORE_WEIGHTS.boxChanges * metrics.boxChanges
    + SCORE_WEIGHTS.maxPhiBarrier * metrics.maxPhiBarrier
    + SCORE_WEIGHTS.dependencyDepth * metrics.dependencyDepth
    + SCORE_WEIGHTS.dependencyCount * metrics.dependencyCount
    + SCORE_WEIGHTS.mutualDependency * (metrics.mutualDependency ? 1 : 0)
    + SCORE_WEIGHTS.constrainedGoalDegree * (SCORE_WEIGHTS.constrainedGoalDegreeBase - Math.min(SCORE_WEIGHTS.constrainedGoalDegreeBase, metrics.minGoalPushDegree))
    - SCORE_WEIGHTS.ratioPenalty * Math.max(0, metrics.movesPushesRatio - SCORE_WEIGHTS.ratioPenaltyThreshold);
}

function compareOrdinal(a, b) {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) {
      return diff;
    }
  }
  return a.length - b.length;
}

function renderStages(stages) {
  const entries = stages.map((stage, index) => {
    const id = `stage${String(index + 1).padStart(2, '0')}`;
    const solved = solve(stage.board);
    if (solved.solvable !== true) {
      throw new Error(`curate-stages: selected ${id} is not solvable`);
    }
    return `  {
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(`Stage ${index + 1}`)},
    text: ${JSON.stringify(stage.text)},
    minMoves: ${stage.minMoves},
    optimalSolution: ${JSON.stringify(solved.solution)},
    metrics: ${JSON.stringify(renderedMetrics(stage))},
    policy: ${JSON.stringify(stage.policy)},
    seed: ${stage.seed},
    params: ${JSON.stringify(stage.params)},
  }`;
  }).join(',\n');

  return `// GENERATED by tools/curate-stages.mjs
// Regenerate with: node tools/curate-stages.mjs
// Do not edit by hand.

export const STAGES = [
${entries},
];
`;
}

function renderedMetrics(stage) {
  return {
    minPushes: stage.metrics.minPushes,
    boxChanges: stage.metrics.boxChanges,
    maxPhiBarrier: stage.metrics.maxPhiBarrier,
    dependencyCount: stage.metrics.dependencyCount,
    dependencyDepth: stage.metrics.dependencyDepth,
    mutualDependency: stage.metrics.mutualDependency,
    minGoalPushDegree: stage.metrics.minGoalPushDegree,
    forcedPushRatio: roundMetric(stage.metrics.forcedPushRatio),
    movesPushesRatio: roundMetric(stage.metrics.movesPushesRatio),
    score: roundMetric(stage.score),
  };
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

function printSummary(candidates, selected, failures, stats) {
  console.log('qgb stage curation');
  console.log(`candidates=${candidates.length} failures=${failures} selected=${selected.length}`);
  printLayerStats(stats);
  console.log('id      pushes changes phi depC depD mutual deg ratio score policy         moves boxes size   seed       attempt');
  console.log('------  ------ ------- --- ---- ---- ------ --- ----- ----- -------------- ----- ----- ------ ---------- -------');
  selected.forEach((stage, index) => {
    const id = `stage${String(index + 1).padStart(2, '0')}`;
    const size = `${stage.board.width}x${stage.board.height}`;
    console.log(`${id}  ${pad(stage.metrics.minPushes, 6)} ${pad(stage.metrics.boxChanges, 7)} ${pad(stage.metrics.maxPhiBarrier, 3)} ${pad(stage.metrics.dependencyCount, 4)} ${pad(stage.metrics.dependencyDepth, 4)} ${pad(stage.metrics.mutualDependency ? 1 : 0, 6)} ${pad(stage.metrics.minGoalPushDegree, 3)} ${pad(roundMetric(stage.metrics.movesPushesRatio), 5)} ${pad(roundMetric(stage.score), 5)} ${padRight(stage.policy, 14)} ${pad(stage.minMoves, 5)} ${pad(stage.board.boxes.size, 5)} ${pad(size, 6)} ${pad(stage.seed, 10)} ${pad(stage.attempt, 7)}`);
  });
}

function printLayerStats(stats) {
  console.log('layer generated qualityPass generatorErrors params');
  console.log('----- --------- ----------- --------------- ------------------------------');
  stats.forEach((row, index) => {
    const { seedIndexes, seedValues, ...layer } = CURATION_LAYERS[index];
    const params = `${layer.width}x${layer.height} boxes=${layer.boxCount} pullSteps=${layer.pullSteps} pushFloor=${layer.minPushesFloor} wallDensity=${layer.wallDensity ?? 0.16} policy=${layer.motif ? `motif:${layer.motif}` : layer.goalClustering ? 'goal-clustered' : 'scattered'}`;
    console.log(`${pad(index, 5)} ${pad(row.generated, 9)} ${pad(row.qualityPass, 11)} ${pad(row.generatorErrors, 15)} ${params}`);
  });
}

function pad(value, width) {
  return String(value).padStart(width, ' ');
}

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}
