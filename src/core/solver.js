const DIRS = [
  ['U', 0, -1],
  ['D', 0, 1],
  ['L', -1, 0],
  ['R', 1, 0],
];

/**
 * @param {number} player
 * @param {Set<number>|number[]} boxes
 * @returns {string}
 */
export function stateKey(player, boxes) {
  const sorted = [...boxes].sort((a, b) => a - b);
  return `${player}:${sorted.join(',')}`;
}

/**
 * 現在盤面から合法な 1 手を列挙する。デッドロック枝刈りは行わない。
 * @param {{width:number,height:number,walls:Set<number>,goals:Set<number>,boxes:Set<number>,player:number}} board
 * @returns {Array<{dir:'U'|'D'|'L'|'R', pushed:boolean, next:object}>}
 */
export function legalMoves(board) {
  const context = sharedContext(board);
  const state = { player: board.player, boxes: board.boxes };
  return legalMovesForState(context, state).map((move) => ({
    dir: move.dir,
    pushed: move.pushed,
    next: boardFromState(context, move.next),
  }));
}

/**
 * 入力 board は validateBoard 済みを前提とし、不正 board の挙動は未定義。
 * maxStates は展開 (dequeue) 数の上限。上限到達時は解が enqueue 済みでも limit を返す。
 * @param {{width:number,height:number,walls:Set<number>,goals:Set<number>,boxes:Set<number>,player:number}} board
 * @param {{maxStates?:number}} options
 */
export function solve(board, options = {}) {
  const maxStates = options.maxStates ?? 1000000;
  const context = sharedContext(board);
  const start = {
    player: board.player,
    boxes: new Set(board.boxes),
  };
  const stats = { expanded: 0, visited: 1 };
  const visited = new Set([stateKey(start.player, start.boxes)]);
  const nodes = [{ state: start, parent: -1, move: '' }];
  let head = 0;

  while (head < nodes.length) {
    if (stats.expanded >= maxStates) {
      return {
        solvable: null,
        reason: 'limit',
        minMoves: null,
        solution: null,
        stats,
      };
    }

    const currentIndex = head;
    const current = nodes[currentIndex];
    head += 1;
    stats.expanded += 1;

    if (isSolved(context, current.state)) {
      const solution = reconstructSolution(nodes, currentIndex);
      return {
        solvable: true,
        minMoves: solution.length,
        solution,
        stats,
      };
    }

    for (const move of legalMovesForState(context, current.state)) {
      if (move.pushed && hasStaticCornerDeadlock(context, move.next)) {
        continue;
      }
      const key = stateKey(move.next.player, move.next.boxes);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      stats.visited = visited.size;
      nodes.push({ state: move.next, parent: currentIndex, move: move.dir });
    }
  }

  return {
    solvable: false,
    minMoves: null,
    solution: null,
    stats,
  };
}

function sharedContext(board) {
  return {
    width: board.width,
    height: board.height,
    walls: board.walls,
    goals: board.goals,
  };
}

function boardFromState(context, state) {
  return {
    width: context.width,
    height: context.height,
    walls: context.walls,
    goals: context.goals,
    boxes: state.boxes,
    player: state.player,
  };
}

function legalMovesForState(context, state) {
  const moves = [];
  for (const [dir, dx, dy] of DIRS) {
    const next = moveState(context, state, dx, dy);
    if (next !== null) {
      moves.push({ dir, pushed: next.pushed, next: next.state });
    }
  }
  return moves;
}

function moveState(context, state, dx, dy) {
  const { width, height, walls } = context;
  const { boxes, player } = state;
  const px = player % width;
  const py = Math.floor(player / width);
  const nx = px + dx;
  const ny = py + dy;
  if (!isInside(nx, ny, width, height)) {
    return null;
  }

  const nextPlayer = ny * width + nx;
  if (walls.has(nextPlayer)) {
    return null;
  }

  const nextBoxes = new Set(boxes);
  let pushed = false;
  if (boxes.has(nextPlayer)) {
    const bx = nx + dx;
    const by = ny + dy;
    if (!isInside(bx, by, width, height)) {
      return null;
    }
    const nextBox = by * width + bx;
    if (walls.has(nextBox) || boxes.has(nextBox)) {
      return null;
    }
    nextBoxes.delete(nextPlayer);
    nextBoxes.add(nextBox);
    pushed = true;
  }

  return {
    pushed,
    state: {
      boxes: nextBoxes,
      player: nextPlayer,
    },
  };
}

function isSolved(context, state) {
  if (state.boxes.size === 0) {
    return false;
  }
  for (const box of state.boxes) {
    if (!context.goals.has(box)) {
      return false;
    }
  }
  return true;
}

function hasStaticCornerDeadlock(context, state) {
  for (const box of state.boxes) {
    if (context.goals.has(box)) {
      continue;
    }
    if (isStaticCorner(context, box)) {
      return true;
    }
  }
  return false;
}

export function isStaticCorner(board, idx) {
  const { width, height, walls } = board;
  const x = idx % width;
  const y = (idx / width) | 0;
  const isWallAt = (nx, ny) => {
    if (!isInside(nx, ny, width, height)) {
      return true;
    }
    return walls.has(ny * width + nx);
  };
  return (
    (isWallAt(x, y - 1) && isWallAt(x - 1, y)) ||
    (isWallAt(x, y - 1) && isWallAt(x + 1, y)) ||
    (isWallAt(x, y + 1) && isWallAt(x - 1, y)) ||
    (isWallAt(x, y + 1) && isWallAt(x + 1, y))
  );
}

function isInside(x, y, width, height) {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function reconstructSolution(nodes, index) {
  const moves = [];
  for (let i = index; nodes[i].parent !== -1; i = nodes[i].parent) {
    moves.push(nodes[i].move);
  }
  return moves.reverse().join('');
}
