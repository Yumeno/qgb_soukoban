import { validateBoard } from './board.js';
import { Game } from './game.js';
import { solve } from './solver.js';
import { computeStageMetrics } from './metrics.js';
import { mulberry32 } from './rng.js';

const DIRS = [
  ['U', 0, -1],
  ['D', 0, 1],
  ['L', -1, 0],
  ['R', 1, 0],
];

const OPPOSITE = { U: 'D', D: 'U', L: 'R', R: 'L' };

export class GeneratorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeneratorError';
  }
}

export const DIFFICULTY_PRESETS = {
  easy: { width: 7, height: 5, boxCount: 1, pullSteps: 18, minPushesFloor: 4, wallDensity: 0.12, goalClustering: false, maxAttempts: 6000 },
  normal: { width: 9, height: 7, boxCount: 3, pullSteps: 42, minPushesFloor: 7, wallDensity: 0.14, goalClustering: true, maxAttempts: 2500 },
  hard: { width: 9, height: 7, boxCount: 3, pullSteps: 36, minPushesFloor: 8, maxPhiBarrierFloor: 1, wallDensity: 0.08, goalClustering: true, maxAttempts: 1000 },
};

export function generateStage(params) {
  const normalized = normalizeParams(params);
  for (let attempt = 1; attempt <= normalized.maxAttempts; attempt += 1) {
    const rng = mulberry32(deriveSeed(normalized, attempt));
    const candidate = normalized.goalClustering && rng() < 0.75
      ? buildPlacementCandidate(normalized, rng)
      : buildCandidate(normalized, rng);
    if (candidate === null) {
      continue;
    }

    const validation = validateBoard(candidate.board);
    if (!validation.ok) {
      continue;
    }

    const game = new Game(candidate.board);
    game.applyMoves(candidate.solution);
    if (!game.won || game.log !== candidate.solution || game.moves !== candidate.solution.length) {
      continue;
    }
    if (candidate.solution.length < normalized.minMovesFloor) {
      continue;
    }

    const solved = solve(candidate.board);
    if (solved.solvable !== true) {
      continue;
    }
    if (solved.minMoves < normalized.minMovesFloor) {
      continue;
    }
    if (!candidate.movedAnyBox) {
      continue;
    }
    if (!candidate.movedAllBoxesFromGoals) {
      continue;
    }
    if (hasAnyBoxOnGoal(candidate.board)) {
      continue;
    }

    const metrics = computeStageMetrics(candidate.board);
    if (metrics.solvable !== true) {
      continue;
    }
    if (metrics.minPushes < normalized.minPushesFloor) {
      continue;
    }
    if (metrics.maxPhiBarrier < normalized.maxPhiBarrierFloor) {
      continue;
    }

    return {
      board: candidate.board,
      solution: candidate.solution,
      minMoves: solved.minMoves,
      metrics,
      seed: normalized.seed,
      params: { ...normalized },
      policy: normalized.goalClustering ? 'goal-clustered' : 'scattered',
      attempt,
    };
  }

  throw new GeneratorError(`generateStage: maxAttempts exceeded (${normalized.maxAttempts})`);
}

function normalizeParams(params) {
  const normalized = {
    maxAttempts: 100,
    minMovesFloor: 0,
    minPushesFloor: 0,
    maxPhiBarrierFloor: 0,
    wallDensity: 0.16,
    goalClustering: false,
    ...params,
  };
  for (const key of ['seed', 'width', 'height', 'boxCount', 'pullSteps', 'maxAttempts', 'minMovesFloor', 'minPushesFloor', 'maxPhiBarrierFloor']) {
    if (!Number.isInteger(normalized[key])) {
      throw new TypeError(`generateStage: ${key} must be an integer`);
    }
  }
  if (normalized.width < 5 || normalized.height < 5) {
    throw new RangeError('generateStage: width and height must be at least 5');
  }
  if (normalized.width > 12 || normalized.height > 10) {
    throw new RangeError('generateStage: board size must be at most 12x10');
  }
  if (normalized.boxCount < 1 || normalized.boxCount > 5) {
    throw new RangeError('generateStage: boxCount must be between 1 and 5');
  }
  if (normalized.pullSteps < 0
    || normalized.maxAttempts < 1
    || normalized.minMovesFloor < 0
    || normalized.minPushesFloor < 0
    || normalized.maxPhiBarrierFloor < 0) {
    throw new RangeError('generateStage: pullSteps, maxAttempts, minMovesFloor, minPushesFloor and maxPhiBarrierFloor must be non-negative');
  }
  if (typeof normalized.wallDensity !== 'number' || !Number.isFinite(normalized.wallDensity)) {
    throw new TypeError('generateStage: wallDensity must be a finite number');
  }
  if (normalized.wallDensity < 0 || normalized.wallDensity > 0.45) {
    throw new RangeError('generateStage: wallDensity must be between 0 and 0.45');
  }
  if (typeof normalized.goalClustering !== 'boolean') {
    throw new TypeError('generateStage: goalClustering must be a boolean');
  }
  return normalized;
}

function buildCandidate(params, rng) {
  const walls = generateConnectedRoom(params, rng);
  const floors = [];
  for (let y = 1; y < params.height - 1; y += 1) {
    for (let x = 1; x < params.width - 1; x += 1) {
      const idx = toIndex(x, y, params.width);
      if (!walls.has(idx)) {
        floors.push(idx);
      }
    }
  }
  if (floors.length < params.boxCount + 1) {
    return null;
  }

  const goals = selectGoals(params, floors, rng);
  const boxes = new Set(goals);
  const player = floors.find((idx) => !boxes.has(idx));
  if (player === undefined) {
    return null;
  }

  const boxIds = new Map();
  const initialBoxes = [...boxes].sort((a, b) => a - b);
  for (let id = 0; id < initialBoxes.length; id += 1) {
    boxIds.set(initialBoxes[id], id);
  }

  const state = { width: params.width, height: params.height, walls, goals, boxes, boxIds, player };
  const reverseSteps = [];
  let movedAnyBox = false;
  const unpulledBoxIds = new Set([...boxIds.values()]);

  for (let step = 0; step < params.pullSteps; step += 1) {
    const moves = reverseMoves(state);
    if (moves.length === 0) {
      break;
    }
    const priorityPulls = moves.filter((move) => move.kind === 'pull' && unpulledBoxIds.has(move.boxId));
    const pool = priorityPulls.length > 0 ? priorityPulls : moves;
    const move = pool[Math.floor(rng() * pool.length)];
    applyReverseMove(state, move);
    reverseSteps.push(move);
    if (move.kind === 'pull') {
      movedAnyBox = true;
      unpulledBoxIds.delete(move.boxId);
    }
  }

  const firstPullIndex = reverseSteps.findIndex((move) => move.kind === 'pull');
  const effectiveReverseSteps = firstPullIndex === -1 ? [] : reverseSteps.slice(firstPullIndex);

  return {
    board: cloneBoard(state),
    solution: effectiveReverseSteps.map((move) => move.forwardDir).reverse().join(''),
    movedAnyBox,
    movedAllBoxesFromGoals: unpulledBoxIds.size === 0,
  };
}

function buildPlacementCandidate(params, rng) {
  const walls = generateConnectedRoom(params, rng);
  const floors = [];
  for (let y = 1; y < params.height - 1; y += 1) {
    for (let x = 1; x < params.width - 1; x += 1) {
      const idx = toIndex(x, y, params.width);
      if (!walls.has(idx)) {
        floors.push(idx);
      }
    }
  }
  if (floors.length < params.boxCount * 2 + 1) {
    return null;
  }

  const goals = selectGoals(params, floors, rng);
  const candidates = floors.filter((idx) => !goals.has(idx));
  shuffle(candidates, rng);
  const boxes = new Set(candidates.slice(0, params.boxCount));
  const player = candidates.find((idx) => !boxes.has(idx));
  if (player === undefined) {
    return null;
  }

  const board = { width: params.width, height: params.height, walls, goals, boxes, player };
  const solved = solve(board);
  if (solved.solvable !== true) {
    return null;
  }

  return {
    board,
    solution: solved.solution,
    movedAnyBox: solved.solution.length > 0,
    movedAllBoxesFromGoals: true,
  };
}

function selectGoals(params, floors, rng) {
  if (!params.goalClustering) {
    const shuffled = floors.slice();
    shuffle(shuffled, rng);
    return new Set(shuffled.slice(0, params.boxCount));
  }

  const floorSet = new Set(floors);
  const starts = floors.slice();
  shuffle(starts, rng);

  for (const start of starts) {
    const cluster = growGoalCluster(params, floorSet, start, rng);
    if (cluster.length >= params.boxCount) {
      return new Set(cluster.slice(0, params.boxCount));
    }
  }

  const fallback = floors.slice();
  shuffle(fallback, rng);
  return new Set(fallback.slice(0, params.boxCount));
}

function growGoalCluster(params, floorSet, start, rng) {
  const cluster = [start];
  const clusterSet = new Set(cluster);
  const frontier = neighbors(start, params.width).filter((idx) => floorSet.has(idx));
  shuffle(frontier, rng);

  while (cluster.length < params.boxCount && frontier.length > 0) {
    const next = frontier.shift();
    if (clusterSet.has(next) || !floorSet.has(next)) {
      continue;
    }
    cluster.push(next);
    clusterSet.add(next);
    const nextNeighbors = neighbors(next, params.width).filter((idx) => floorSet.has(idx) && !clusterSet.has(idx));
    shuffle(nextNeighbors, rng);
    frontier.push(...nextNeighbors);
  }

  return cluster;
}

function generateConnectedRoom(params, rng) {
  const { width, height } = params;
  const walls = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        walls.add(toIndex(x, y, width));
      }
    }
  }

  const candidates = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      candidates.push(toIndex(x, y, width));
    }
  }
  shuffle(candidates, rng);

  const interiorArea = (width - 2) * (height - 2);
  const targetWalls = Math.min(
    Math.floor(interiorArea * params.wallDensity),
    Math.max(0, interiorArea - params.boxCount - 8),
  );
  let added = 0;
  for (const idx of candidates) {
    if (added >= targetWalls) {
      break;
    }
    if (rng() > 0.65) {
      continue;
    }
    walls.add(idx);
    if (isFloorConnected(width, height, walls)) {
      added += 1;
    } else {
      walls.delete(idx);
    }
  }
  return walls;
}

function reverseMoves(board) {
  const moves = [];
  const { width, height, walls, boxes, player } = board;
  const px = player % width;
  const py = Math.floor(player / width);

  for (const [dir, dx, dy] of DIRS) {
    const nx = px + dx;
    const ny = py + dy;
    if (isFree(nx, ny, width, height, walls, boxes)) {
      moves.push({
        kind: 'walk',
        dir,
        forwardDir: OPPOSITE[dir],
      });
    }

    const boxX = px + dx;
    const boxY = py + dy;
    const backX = px - dx;
    const backY = py - dy;
    const boxIdx = toIndex(boxX, boxY, width);
    if (isInside(boxX, boxY, width, height)
      && boxes.has(boxIdx)
      && !board.goals.has(player)
      && isFree(backX, backY, width, height, walls, boxes)) {
      moves.push({
        kind: 'pull',
        dx,
        dy,
        boxFrom: boxIdx,
        boxTo: player,
        boxId: board.boxIds.get(boxIdx),
        playerTo: toIndex(backX, backY, width),
        forwardDir: dir,
      });
    }
  }

  return moves;
}

function applyReverseMove(board, move) {
  if (move.kind === 'walk') {
    const d = DIRS.find(([dir]) => dir === move.dir);
    board.player = board.player + d[1] + d[2] * board.width;
    return;
  }
  board.boxes.delete(move.boxFrom);
  board.boxes.add(move.boxTo);
  board.boxIds.delete(move.boxFrom);
  board.boxIds.set(move.boxTo, move.boxId);
  board.player = move.playerTo;
}

function isFloorConnected(width, height, walls) {
  let start = null;
  let floorCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = toIndex(x, y, width);
      if (!walls.has(idx)) {
        start ??= idx;
        floorCount += 1;
      }
    }
  }
  if (start === null) {
    return false;
  }

  const visited = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const idx = stack.pop();
    if (visited.has(idx) || walls.has(idx)) {
      continue;
    }
    visited.add(idx);
    const x = idx % width;
    const y = Math.floor(idx / width);
    for (const [, dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1) {
        const next = toIndex(nx, ny, width);
        if (!visited.has(next) && !walls.has(next)) {
          stack.push(next);
        }
      }
    }
  }
  return visited.size === floorCount;
}

function deriveSeed(params, attempt) {
  let h = params.seed >>> 0;
  h = mix(h ^ params.width);
  h = mix(h ^ (params.height << 4));
  h = mix(h ^ (params.boxCount << 8));
  h = mix(h ^ (params.pullSteps << 12));
  h = mix(h ^ (params.minMovesFloor << 16));
  h = mix(h ^ (params.minPushesFloor << 18));
  h = mix(h ^ (params.maxPhiBarrierFloor << 20));
  h = mix(h ^ Math.floor(params.wallDensity * 1000));
  h = mix(h ^ (params.goalClustering ? 0xA5A5A5A5 : 0));
  h = mix(h ^ Math.imul(attempt, 0x9E3779B1));
  return h >>> 0;
}

function neighbors(idx, width) {
  const x = idx % width;
  const y = Math.floor(idx / width);
  return DIRS.map(([, dx, dy]) => toIndex(x + dx, y + dy, width));
}

function hasAnyBoxOnGoal(board) {
  for (const box of board.boxes) {
    if (board.goals.has(box)) {
      return true;
    }
  }
  return false;
}

function mix(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7FEB352D);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846CA68B);
  x ^= x >>> 16;
  return x >>> 0;
}

function isFree(x, y, width, height, walls, boxes) {
  if (!isInside(x, y, width, height)) {
    return false;
  }
  const idx = toIndex(x, y, width);
  return !walls.has(idx) && !boxes.has(idx);
}

function isInside(x, y, width, height) {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function toIndex(x, y, width) {
  return y * width + x;
}

function cloneBoard(board) {
  return {
    width: board.width,
    height: board.height,
    walls: new Set(board.walls),
    goals: new Set(board.goals),
    boxes: new Set(board.boxes),
    player: board.player,
  };
}

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
