import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeBoard } from '../src/core/board.js';
import { generateStage, GeneratorError } from '../src/core/generator.js';
import { checkStageQuality } from '../src/core/quality.js';
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
  mutualDependency: 6,
  constrainedGoalDegree: 2,
  constrainedGoalDegreeBase: 3,
  ratioPenaltyThreshold: 3,
  ratioPenalty: 2,
};

const MASTER_SEEDS = Array.from({ length: 12 }, (_, i) => 0x5A17E000 + i * 0x101);

const generated = [];
const seenBoards = new Set();
let failures = 0;
const layerStats = PARAM_LAYERS.map(() => ({
  generated: 0,
  qualityPass: 0,
  generatorErrors: 0,
}));

for (let layerIndex = 0; layerIndex < PARAM_LAYERS.length; layerIndex += 1) {
  const { seedIndexes, seedValues, ...layer } = PARAM_LAYERS[layerIndex];
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
  const intro = sorted.find((candidate) => candidate.board.boxes.size === 1);
  if (!intro) {
    throw new Error('curate-stages: no one-box intro candidate found');
  }

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

  const pickedTexts = new Set();
  const picks = [];
  const addPick = (candidate) => {
    if (pickedTexts.has(candidate.text)) {
      return false;
    }
    picks.push(candidate);
    pickedTexts.add(candidate.text);
    return true;
  };

  const stage10 = stage10Pool.at(-1);
  const boundedPhiDepPool = phiDepPool.filter((candidate) => candidate.score <= stage10.score);
  const stage09 = highestDistinct(boundedPhiDepPool, [stage10.text]);
  const stage08 = highestDistinct(boundedPhiDepPool, [stage10.text, stage09.text]);
  const boundedDepPool = depPool.filter((candidate) => candidate.score <= Math.min(stage08.score, stage09.score));
  const stage07 = highestDistinct(boundedDepPool, [stage10.text, stage09.text, stage08.text]);
  const stage06 = highestDistinct(boundedDepPool, [stage10.text, stage09.text, stage08.text, stage07.text]);
  const constrainedTail = [stage06, stage07, stage08, stage09].sort(compareCandidate).concat(stage10);
  const hardFloorScore = constrainedTail[0].score;

  addPick(intro);
  const tailTexts = new Set(constrainedTail.map((candidate) => candidate.text));
  const lowPool = sorted.filter((candidate) => candidate.score <= hardFloorScore && candidate.text !== intro.text && !tailTexts.has(candidate.text));
  const lowTargets = Math.max(0, 5 - picks.length);
  const lowPicks = spreadPick(lowPool, lowTargets);
  for (const candidate of lowPicks.sort(compareCandidate)) {
    addPick(candidate);
  }

  if (picks.length < 5) {
    for (const candidate of sorted) {
      if (picks.length >= 5) {
        break;
      }
      if (candidate.score <= hardFloorScore && !tailTexts.has(candidate.text)) {
        addPick(candidate);
      }
    }
  }
  if (picks.length < 5) {
    throw new Error(`curate-stages: need 5 lower-score picks before constrained tail, got ${picks.length}`);
  }

  for (const candidate of constrainedTail) {
    addPick(candidate);
  }

  if (picks.length < 10) {
    for (let i = sorted.length - 1; i >= 0 && picks.length < 10; i -= 1) {
      addPick(sorted[i]);
    }
  }

  const finalStages = picks.slice(0, 10);
  if (finalStages.length !== 10) {
    throw new Error(`curate-stages: selected ${finalStages.length} stages`);
  }
  for (let i = 1; i < finalStages.length; i += 1) {
    if (finalStages[i].score < finalStages[i - 1].score) {
      throw new Error(`curate-stages: selected score curve is not monotonic (${finalStages.map((stage) => roundMetric(stage.score)).join(',')})`);
    }
  }
  if (finalStages[0].board.boxes.size !== 1) {
    throw new Error('curate-stages: stage01 is not a one-box intro stage');
  }
  assertRankConstraints(finalStages);
  return finalStages;
}

function highestDistinct(pool, usedTexts) {
  const used = new Set(usedTexts);
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    if (!used.has(pool[i].text)) {
      return pool[i];
    }
  }
  throw new Error('curate-stages: not enough distinct constrained candidates');
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
  return metrics.dependencyDepth >= 2 || metrics.mutualDependency || metrics.dependencyCount >= 2;
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
    return `  {
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(`Stage ${index + 1}`)},
    text: ${JSON.stringify(stage.text)},
    minMoves: ${stage.minMoves},
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
    const { seedIndexes, seedValues, ...layer } = PARAM_LAYERS[index];
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
