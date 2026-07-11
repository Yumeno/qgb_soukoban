const DIRS = [
  ['U', 0, -1],
  ['D', 0, 1],
  ['L', -1, 0],
  ['R', 1, 0],
];

/**
 * Canonical push-space key: sorted box indexes plus the minimum index in the
 * player's reachable component under the current box placement.
 * @param {{width:number,height:number,walls:Set<number>}} board
 * @param {Set<number>|number[]} boxes
 * @param {number} player
 * @returns {string}
 */
export function pushStateKey(board, boxes, player) {
  const boxSet = boxes instanceof Set ? boxes : new Set(boxes);
  const boxList = sortedBoxes(boxSet);
  const reachable = floodReachable(board, boxSet, player);
  return `${boxList.join(',')}:${reachable.min}`;
}

/**
 * Solve in push space, optimizing lexicographically by push count and then
 * total move count.
 * @param {{width:number,height:number,walls:Set<number>,goals:Set<number>,boxes:Set<number>,player:number}} board
 * @param {{maxStates?:number}} options
 */
export function solvePushes(board, options = {}) {
  const maxStates = options.maxStates ?? 1000000;
  const deadSquares = computeStaticDeadSquares(board);
  const startBoxes = new Set(board.boxes);
  const startKey = pushStateKey(board, startBoxes, board.player);
  const start = {
    boxes: startBoxes,
    player: board.player,
    pushes: 0,
    moves: 0,
    solution: '',
    pushSequence: [],
    key: startKey,
  };
  const visited = new Set([startKey]);
  const stats = { expanded: 0, visited: 1 };
  let currentLayer = [start];

  while (currentLayer.length > 0) {
    const solved = bestSolvedNode(board, currentLayer);
    if (solved !== null) {
      return solvedResult(solved, stats);
    }

    const nextByKey = new Map();
    for (const node of currentLayer) {
      if (stats.expanded >= maxStates) {
        return limitResult(stats);
      }
      stats.expanded += 1;

      const reachable = floodReachable(board, node.boxes, node.player, true);
      const boxes = sortedBoxes(node.boxes);
      for (const boxFrom of boxes) {
        const bx = boxFrom % board.width;
        const by = Math.floor(boxFrom / board.width);
        for (const [dir, dx, dy] of DIRS) {
          const pushX = bx - dx;
          const pushY = by - dy;
          const toX = bx + dx;
          const toY = by + dy;
          if (!isInside(pushX, pushY, board.width, board.height)
            || !isInside(toX, toY, board.width, board.height)) {
            continue;
          }

          const pushFrom = toIndex(pushX, pushY, board.width);
          const boxTo = toIndex(toX, toY, board.width);
          if (!reachable.visited.has(pushFrom)) {
            continue;
          }
          if (board.walls.has(boxTo) || node.boxes.has(boxTo)) {
            continue;
          }
          if (!board.goals.has(boxTo) && deadSquares.has(boxTo)) {
            continue;
          }

          const nextBoxes = new Set(node.boxes);
          nextBoxes.delete(boxFrom);
          nextBoxes.add(boxTo);
          const nextPlayer = boxFrom;
          const key = pushStateKey(board, nextBoxes, nextPlayer);
          if (visited.has(key)) {
            continue;
          }

          const walkPath = reachable.paths.get(pushFrom);
          const segment = `${walkPath}${dir}`;
          const candidate = {
            boxes: nextBoxes,
            player: nextPlayer,
            pushes: node.pushes + 1,
            moves: node.moves + segment.length,
            solution: node.solution + segment,
            pushSequence: node.pushSequence.concat([{ dir, boxFrom, boxTo }]),
            key,
          };
          const previous = nextByKey.get(key);
          if (previous === undefined || isBetterCandidate(candidate, previous)) {
            nextByKey.set(key, candidate);
          }
        }
      }
    }

    const nextLayer = [...nextByKey.values()].sort(compareNodes);
    for (const node of nextLayer) {
      visited.add(node.key);
    }
    stats.visited = visited.size;
    currentLayer = nextLayer;
  }

  return unsolvedResult(stats);
}

function bestSolvedNode(board, layer) {
  let best = null;
  for (const node of layer) {
    if (!isSolved(board, node.boxes)) {
      continue;
    }
    if (best === null || isBetterCandidate(node, best)) {
      best = node;
    }
  }
  return best;
}

function solvedResult(node, stats) {
  return {
    solvable: true,
    minPushes: node.pushes,
    movesOfSolution: node.moves,
    solution: node.solution,
    pushSequence: node.pushSequence,
    stats,
  };
}

function unsolvedResult(stats) {
  return {
    solvable: false,
    minPushes: null,
    movesOfSolution: null,
    solution: null,
    pushSequence: null,
    stats,
  };
}

function limitResult(stats) {
  return {
    solvable: null,
    reason: 'limit',
    minPushes: null,
    movesOfSolution: null,
    solution: null,
    pushSequence: null,
    stats,
  };
}

function isBetterCandidate(a, b) {
  if (a.moves !== b.moves) return a.moves < b.moves;
  if (a.solution !== b.solution) return a.solution < b.solution;
  return a.key < b.key;
}

function compareNodes(a, b) {
  if (a.moves !== b.moves) return a.moves - b.moves;
  if (a.solution !== b.solution) return a.solution < b.solution ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return 0;
}

function isSolved(board, boxes) {
  if (boxes.size === 0) {
    return false;
  }
  for (const box of boxes) {
    if (!board.goals.has(box)) {
      return false;
    }
  }
  return true;
}

function floodReachable(board, boxes, start, includePaths = false) {
  const visited = new Set();
  const distances = includePaths ? new Map() : null;
  const paths = includePaths ? new Map() : null;
  const queue = [start];
  let head = 0;
  let min = start;
  visited.add(start);
  if (includePaths) {
    distances.set(start, 0);
    paths.set(start, '');
  }

  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    if (idx < min) min = idx;
    const x = idx % board.width;
    const y = Math.floor(idx / board.width);
    const basePath = includePaths ? paths.get(idx) : '';
    for (const [dir, dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isInside(nx, ny, board.width, board.height)) {
        continue;
      }
      const next = toIndex(nx, ny, board.width);
      if (visited.has(next) || board.walls.has(next) || boxes.has(next)) {
        continue;
      }
      visited.add(next);
      if (includePaths) {
        distances.set(next, distances.get(idx) + 1);
        paths.set(next, basePath + dir);
      }
      queue.push(next);
    }
  }

  return { visited, min, distances, paths };
}

function computeStaticDeadSquares(board) {
  const alive = new Set();
  const queue = [];
  for (const goal of board.goals) {
    alive.add(goal);
    queue.push(goal);
  }

  let head = 0;
  while (head < queue.length) {
    const box = queue[head];
    head += 1;
    const x = box % board.width;
    const y = Math.floor(box / board.width);
    for (const [, dx, dy] of DIRS) {
      const prevX = x - dx;
      const prevY = y - dy;
      const standX = prevX - dx;
      const standY = prevY - dy;
      if (!isFloor(board, prevX, prevY) || !isFloor(board, standX, standY)) {
        continue;
      }
      const prev = toIndex(prevX, prevY, board.width);
      if (!alive.has(prev)) {
        alive.add(prev);
        queue.push(prev);
      }
    }
  }

  const dead = new Set();
  for (let y = 0; y < board.height; y += 1) {
    for (let x = 0; x < board.width; x += 1) {
      const idx = toIndex(x, y, board.width);
      if (!board.walls.has(idx) && !alive.has(idx)) {
        dead.add(idx);
      }
    }
  }
  return dead;
}

function isFloor(board, x, y) {
  if (!isInside(x, y, board.width, board.height)) {
    return false;
  }
  return !board.walls.has(toIndex(x, y, board.width));
}

function sortedBoxes(boxes) {
  return [...boxes].sort((a, b) => a - b);
}

function isInside(x, y, width, height) {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function toIndex(x, y, width) {
  return y * width + x;
}
