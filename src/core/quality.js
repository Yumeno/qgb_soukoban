import { solve } from './solver.js';

const DIRS = {
  U: { dx: 0, dy: -1 },
  D: { dx: 0, dy: 1 },
  L: { dx: -1, dy: 0 },
  R: { dx: 1, dy: 0 },
};

/**
 * Replay a move string while preserving box identities assigned from the
 * initial box positions. A push is redundant when the pushed box returns to
 * any square already occupied by that same box.
 *
 * @param {{width:number,height:number,walls:Set<number>,boxes:Set<number>,player:number}} board
 * @param {string} solution
 * @returns {boolean}
 */
export function hasRedundantBoxMovement(board, solution) {
  const width = board.width;
  const height = board.height;
  let player = board.player;

  const boxAt = new Map();
  const visitedByBox = new Map();
  const initialBoxes = [...board.boxes].sort((a, b) => a - b);
  for (let id = 0; id < initialBoxes.length; id += 1) {
    const pos = initialBoxes[id];
    boxAt.set(pos, id);
    visitedByBox.set(id, new Set([pos]));
  }

  for (const ch of solution) {
    const dir = DIRS[ch];
    if (!dir) {
      throw new TypeError(`hasRedundantBoxMovement: invalid move '${ch}'`);
    }

    const nextPlayer = neighbor(player, dir, width);
    if (!isInside(nextPlayer, width, height) || board.walls.has(nextPlayer)) {
      continue;
    }

    if (boxAt.has(nextPlayer)) {
      const nextBox = neighbor(nextPlayer, dir, width);
      if (!isInside(nextBox, width, height) || board.walls.has(nextBox) || boxAt.has(nextBox)) {
        continue;
      }

      const boxId = boxAt.get(nextPlayer);
      const history = visitedByBox.get(boxId);
      if (history.has(nextBox)) {
        return true;
      }
      boxAt.delete(nextPlayer);
      boxAt.set(nextBox, boxId);
      history.add(nextBox);
    }

    player = nextPlayer;
  }

  return false;
}

/**
 * Count how often consecutive pushes switch from one box identity to another.
 * Box identities are assigned from initial box positions in ascending order.
 *
 * @param {{width:number,height:number,walls:Set<number>,boxes:Set<number>,player:number}} board
 * @param {string} solution
 * @returns {number}
 */
export function countBoxSwitches(board, solution) {
  const width = board.width;
  const height = board.height;
  let player = board.player;
  let lastPushedBox = null;
  let switches = 0;

  const boxAt = new Map();
  const initialBoxes = [...board.boxes].sort((a, b) => a - b);
  for (let id = 0; id < initialBoxes.length; id += 1) {
    boxAt.set(initialBoxes[id], id);
  }

  for (const ch of solution) {
    const dir = DIRS[ch];
    if (!dir) {
      throw new TypeError(`countBoxSwitches: invalid move '${ch}'`);
    }

    const nextPlayer = neighbor(player, dir, width);
    if (!isInside(nextPlayer, width, height) || board.walls.has(nextPlayer)) {
      continue;
    }

    if (boxAt.has(nextPlayer)) {
      const nextBox = neighbor(nextPlayer, dir, width);
      if (!isInside(nextBox, width, height) || board.walls.has(nextBox) || boxAt.has(nextBox)) {
        continue;
      }

      const boxId = boxAt.get(nextPlayer);
      if (lastPushedBox !== null && lastPushedBox !== boxId) {
        switches += 1;
      }
      lastPushedBox = boxId;
      boxAt.delete(nextPlayer);
      boxAt.set(nextBox, boxId);
    }

    player = nextPlayer;
  }

  return switches;
}

/**
 * @param {{board:object,solution:string,minMoves:number}} stage
 * @returns {{ok:boolean,reasons:string[]}}
 */
export function checkStageQuality(stage) {
  const result = solve(stage.board);
  const reasons = [];

  if (result.minMoves !== stage.minMoves) {
    reasons.push('minmoves_mismatch');
  }

  const solution = typeof stage.solution === 'string' ? stage.solution : result.solution;
  if (typeof solution === 'string' && hasRedundantBoxMovement(stage.board, solution)) {
    reasons.push('redundant_box_movement');
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function neighbor(idx, dir, width) {
  const x = idx % width;
  const y = (idx / width) | 0;
  return (y + dir.dy) * width + x + dir.dx;
}

function isInside(idx, width, height) {
  const x = idx % width;
  const y = (idx / width) | 0;
  return x >= 0 && x < width && y >= 0 && y < height;
}
