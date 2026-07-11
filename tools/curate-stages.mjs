import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeBoard } from '../src/core/board.js';
import { generateStage, GeneratorError } from '../src/core/generator.js';
import { checkStageQuality } from '../src/core/quality.js';
import { PARAM_LAYERS } from './param-layers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'src/core/stages.js');

const MASTER_SEEDS = Array.from({ length: 32 }, (_, i) => 0x5A17E000 + i * 0x101);

const generated = [];
const seenBoards = new Set();
let failures = 0;
const layerStats = PARAM_LAYERS.map(() => ({
  generated: 0,
  qualityPass: 0,
  generatorErrors: 0,
}));

for (let layerIndex = 0; layerIndex < PARAM_LAYERS.length; layerIndex += 1) {
  const layer = PARAM_LAYERS[layerIndex];
  for (let seedIndex = 0; seedIndex < MASTER_SEEDS.length; seedIndex += 1) {
    const seed = (MASTER_SEEDS[seedIndex] + layerIndex * 0x10000) >>> 0;
    const params = { seed, ...layer, maxAttempts: 120 };
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
      generated.push({ ...stage, text });
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

  const groups = new Map();
  for (const candidate of sorted) {
    if (candidate.minMoves < intro.minMoves) {
      continue;
    }
    const current = groups.get(candidate.minMoves);
    if (!current || compareCandidate(candidate, current) < 0) {
      groups.set(candidate.minMoves, candidate);
    }
  }

  const byMove = [...groups.values()].sort(compareCandidate);
  if (byMove.length < 10) {
    throw new Error(`curate-stages: need at least 10 distinct minMoves, got ${byMove.length}`);
  }

  const picks = [];
  const pickedMoves = new Set();
  const addPick = (candidate) => {
    if (!pickedMoves.has(candidate.minMoves)) {
      picks.push(candidate);
      pickedMoves.add(candidate.minMoves);
    }
  };

  addPick(intro);
  for (let i = 1; i < 9; i += 1) {
    const target = Math.round((i * (byMove.length - 1)) / 9);
    let index = target;
    while (index < byMove.length && pickedMoves.has(byMove[index].minMoves)) {
      index += 1;
    }
    if (index >= byMove.length) {
      index = target - 1;
      while (index >= 0 && pickedMoves.has(byMove[index].minMoves)) {
        index -= 1;
      }
    }
    if (index >= 0) {
      addPick(byMove[index]);
    }
  }
  addPick(byMove.at(-1));

  for (const candidate of byMove) {
    if (picks.length >= 10) {
      break;
    }
    addPick(candidate);
  }

  const finalStages = picks.sort(compareCandidate).slice(0, 10);
  if (finalStages.length !== 10) {
    throw new Error(`curate-stages: selected ${finalStages.length} stages`);
  }
  for (let i = 1; i < finalStages.length; i += 1) {
    if (finalStages[i].minMoves < finalStages[i - 1].minMoves) {
      throw new Error('curate-stages: selected curve is not monotonic');
    }
  }
  if (finalStages[0].board.boxes.size !== 1) {
    throw new Error('curate-stages: stage01 is not a one-box intro stage');
  }
  return finalStages;
}

function compareCandidate(a, b) {
  return a.minMoves - b.minMoves
    || a.board.boxes.size - b.board.boxes.size
    || a.board.width - b.board.width
    || a.board.height - b.board.height
    || a.seed - b.seed
    || a.params.pullSteps - b.params.pullSteps
    || compareOrdinal(a.text, b.text);
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

function printSummary(candidates, selected, failures, stats) {
  console.log('qgb stage curation');
  console.log(`candidates=${candidates.length} failures=${failures} selected=${selected.length}`);
  printLayerStats(stats);
  console.log('id      moves boxes size   seed       attempt');
  console.log('------  ----- ----- ------ ---------- -------');
  selected.forEach((stage, index) => {
    const id = `stage${String(index + 1).padStart(2, '0')}`;
    const size = `${stage.board.width}x${stage.board.height}`;
    console.log(`${id}  ${pad(stage.minMoves, 5)} ${pad(stage.board.boxes.size, 5)} ${pad(size, 6)} ${pad(stage.seed, 10)} ${pad(stage.attempt, 7)}`);
  });
}

function printLayerStats(stats) {
  console.log('layer generated qualityPass generatorErrors params');
  console.log('----- --------- ----------- --------------- ------------------------------');
  stats.forEach((row, index) => {
    const layer = PARAM_LAYERS[index];
    const params = `${layer.width}x${layer.height} boxes=${layer.boxCount} pullSteps=${layer.pullSteps} floor=${layer.minMovesFloor}`;
    console.log(`${pad(index, 5)} ${pad(row.generated, 9)} ${pad(row.qualityPass, 11)} ${pad(row.generatorErrors, 15)} ${params}`);
  });
}

function pad(value, width) {
  return String(value).padStart(width, ' ');
}
