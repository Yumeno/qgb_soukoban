import { validateBoard } from './board.js';
import { Game } from './game.js';
import { solve } from './solver.js';
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
  easy: { width: 7, height: 5, boxCount: 1, pullSteps: 8, minMovesFloor: 2 },
  normal: { width: 8, height: 6, boxCount: 2, pullSteps: 14, minMovesFloor: 5 },
  hard: { width: 10, height: 7, boxCount: 3, pullSteps: 22, minMovesFloor: 8 },
};

export function generateStage(params) {
  const normalized = normalizeParams(params);
  for (let attempt = 1; attempt <= normalized.maxAttempts; attempt += 1) {
    const rng = mulberry32(deriveSeed(normalized, attempt));
    const candidate = buildCandidate(normalized, rng);
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

    return {
      board: candidate.board,
      solution: candidate.solution,
      minMoves: solved.minMoves,
      seed: normalized.seed,
      params: { ...normalized },
      attempt,
    };
  }

  throw new GeneratorError(`generateStage: maxAttempts exceeded (${normalized.maxAttempts})`);
}

function normalizeParams(params) {
  const normalized = {
    maxAttempts: 100,
    minMovesFloor: 0,
    ...params,
  };
  for (const key of ['seed', 'width', 'height', 'boxCount', 'pullSteps', 'maxAttempts', 'minMovesFloor']) {
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
  if (normalized.pullSteps < 0 || normalized.maxAttempts < 1 || normalized.minMovesFloor < 0) {
    throw new RangeError('generateStage: pullSteps, maxAttempts and minMovesFloor must be non-negative');
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

  shuffle(floors, rng);
  const goals = new Set(floors.slice(0, params.boxCount));
  const boxes = new Set(goals);
  const player = floors.find((idx) => !boxes.has(idx));
  if (player === undefined) {
    return null;
  }

  const state = { width: params.width, height: params.height, walls, goals, boxes, player };
  const reverseSteps = [];
  let movedAnyBox = false;

  for (let step = 0; step < params.pullSteps; step += 1) {
    const moves = reverseMoves(state);
    if (moves.length === 0) {
      break;
    }
    const move = moves[Math.floor(rng() * moves.length)];
    applyReverseMove(state, move);
    reverseSteps.push(move);
    movedAnyBox ||= move.kind === 'pull';
  }

  const firstPullIndex = reverseSteps.findIndex((move) => move.kind === 'pull');
  const effectiveReverseSteps = firstPullIndex === -1 ? [] : reverseSteps.slice(firstPullIndex);

  return {
    board: cloneBoard(state),
    solution: effectiveReverseSteps.map((move) => move.forwardDir).reverse().join(''),
    movedAnyBox,
  };
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
    Math.floor(interiorArea * 0.16),
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
      && isFree(backX, backY, width, height, walls, boxes)) {
      moves.push({
        kind: 'pull',
        dx,
        dy,
        boxFrom: boxIdx,
        boxTo: player,
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
  h = mix(h ^ Math.imul(attempt, 0x9E3779B1));
  return h >>> 0;
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
