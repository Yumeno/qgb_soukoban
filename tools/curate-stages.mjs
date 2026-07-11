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
  minPushes: 2,
  boxChanges: 3,
  maxPhiBarrier: 5,
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
  const { seedIndexes, ...layer } = PARAM_LAYERS[layerIndex];
  const seedSource = seedIndexes ?? MASTER_SEEDS.map((_, index) => index);
  for (const seedIndex of seedSource) {
    const seed = (MASTER_SEEDS[seedIndex] + layerIndex * 0x10000) >>> 0;
    const params = { seed, maxAttempts: layer.maxAttempts ?? 200, ...layer };
    try {
      const stage = generateStage(params);
      layerStats[layerIndex].generated += 1;
      const text = serializeBoard(stage.board);

      const quality = checkStageQuality(stage);
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

  const hardPool = sorted.filter((candidate) => candidate.metrics.maxPhiBarrier >= 1);
  if (hardPool.length < 3) {
    throw new Error(`curate-stages: need at least 3 maxPhiBarrier>=1 candidates, got ${hardPool.length}`);
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

  const hardPicks = [];
  for (let i = hardPool.length - 1; i >= 0 && hardPicks.length < 3; i -= 1) {
    hardPicks.push(hardPool[i]);
  }
  hardPicks.reverse();
  const hardFloorScore = hardPicks[0].score;

  addPick(intro);
  const lowPool = sorted.filter((candidate) => candidate.score <= hardFloorScore && candidate.text !== intro.text);
  const lowTargets = Math.max(0, 7 - picks.length);
  const lowPicks = spreadPick(lowPool, lowTargets);
  for (const candidate of lowPicks) {
    addPick(candidate);
  }

  if (picks.length < 7) {
    for (const candidate of sorted) {
      if (picks.length >= 7) {
        break;
      }
      if (candidate.score <= hardFloorScore) {
        addPick(candidate);
      }
    }
  }
  if (picks.length < 7) {
    throw new Error(`curate-stages: need 7 lower-score picks before hard tail, got ${picks.length}`);
  }

  for (const candidate of hardPicks) {
    addPick(candidate);
  }

  if (picks.length < 10) {
    for (let i = hardPool.length - 1; i >= 0 && picks.length < 10; i -= 1) {
      addPick(hardPool[i]);
    }
  }

  const finalStages = picks.sort(compareCandidate).slice(0, 10);
  if (finalStages.length !== 10) {
    throw new Error(`curate-stages: selected ${finalStages.length} stages`);
  }
  for (let i = 1; i < finalStages.length; i += 1) {
    if (finalStages[i].score < finalStages[i - 1].score) {
      throw new Error('curate-stages: selected score curve is not monotonic');
    }
  }
  if (finalStages[0].board.boxes.size !== 1) {
    throw new Error('curate-stages: stage01 is not a one-box intro stage');
  }
  for (let i = 7; i < 10; i += 1) {
    if (finalStages[i].metrics.maxPhiBarrier < 1) {
      throw new Error(`curate-stages: stage${String(i + 1).padStart(2, '0')} maxPhiBarrier < 1`);
    }
  }
  return finalStages;
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
  console.log('id      pushes changes phi ratio score policy         moves boxes size   seed       attempt');
  console.log('------  ------ ------- --- ----- ----- -------------- ----- ----- ------ ---------- -------');
  selected.forEach((stage, index) => {
    const id = `stage${String(index + 1).padStart(2, '0')}`;
    const size = `${stage.board.width}x${stage.board.height}`;
    console.log(`${id}  ${pad(stage.metrics.minPushes, 6)} ${pad(stage.metrics.boxChanges, 7)} ${pad(stage.metrics.maxPhiBarrier, 3)} ${pad(roundMetric(stage.metrics.movesPushesRatio), 5)} ${pad(roundMetric(stage.score), 5)} ${padRight(stage.policy, 14)} ${pad(stage.minMoves, 5)} ${pad(stage.board.boxes.size, 5)} ${pad(size, 6)} ${pad(stage.seed, 10)} ${pad(stage.attempt, 7)}`);
  });
}

function printLayerStats(stats) {
  console.log('layer generated qualityPass generatorErrors params');
  console.log('----- --------- ----------- --------------- ------------------------------');
  stats.forEach((row, index) => {
    const { seedIndexes, ...layer } = PARAM_LAYERS[index];
    const params = `${layer.width}x${layer.height} boxes=${layer.boxCount} pullSteps=${layer.pullSteps} pushFloor=${layer.minPushesFloor} wallDensity=${layer.wallDensity ?? 0.16} policy=${layer.goalClustering ? 'goal-clustered' : 'scattered'}`;
    console.log(`${pad(index, 5)} ${pad(row.generated, 9)} ${pad(row.qualityPass, 11)} ${pad(row.generatorErrors, 15)} ${params}`);
  });
}

function pad(value, width) {
  return String(value).padStart(width, ' ');
}

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}
