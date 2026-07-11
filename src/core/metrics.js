import { solvePushes } from './pushsolver.js';

const DIRS = [
  ['U', 0, -1],
  ['D', 0, 1],
  ['L', -1, 0],
  ['R', 1, 0],
];

/**
 * Compute D2 difficulty metrics on the lexicographic representative solution
 * produced by solvePushes: minPushes first, minMoves second.
 *
 * @param {{width:number,height:number,walls:Set<number>,goals:Set<number>,boxes:Set<number>,player:number}} board
 * @param {{maxStates?:number}} options
 */
export function computeStageMetrics(board, options = {}) {
  const solved = solvePushes(board, options);
  if (solved.solvable !== true) {
    return { solvable: solved.solvable };
  }

  const goals = sorted(board.goals);
  const initialBoxes = sorted(board.boxes);
  const pullDistances = computeReversePullDistances(board, goals);
  const trace = tracePushes(board, solved.pushSequence, initialBoxes);
  const phiTrace = computePhiTrace(trace.boxesByStep, goals, pullDistances);
  const phiStats = computePhiStats(phiTrace.values);
  const boxIds = trace.pushes.map((push) => push.boxId);
  const dependencyMetrics = computeDependencyMetrics(board, initialBoxes);
  const goalPushDegrees = computeGoalPushDegrees(board, goals);

  return {
    solvable: true,
    minPushes: solved.minPushes,
    movesOfSolution: solved.movesOfSolution,
    boxChanges: countBoxChanges(boxIds),
    maxPhiBarrier: phiStats.maxPhiBarrier,
    nonDescendingPushes: phiStats.nonDescendingPushes,
    cumulativeRise: phiStats.cumulativeRise,
    goalRelodges: countGoalRelodges(board.goals, trace.pushes),
    assignmentChanges: countAssignmentChanges(phiTrace.assignments),
    boxLines: countBoxLines(trace.pushes),
    twoDecompositionLight: computeTwoDecompositionLight(boxIds, initialBoxes.length),
    movesPushesRatio: solved.movesOfSolution / Math.max(1, solved.minPushes),
    expanded: solved.stats.expanded,
    dependencyCount: dependencyMetrics.dependencyCount,
    dependencyDepth: dependencyMetrics.dependencyDepth,
    mutualDependency: dependencyMetrics.mutualDependency,
    goalPushDegrees,
    minGoalPushDegree: Math.min(...goalPushDegrees),
    forcedPushRatio: computeForcedPushRatio(board, solved.pushSequence),
  };
}

/**
 * Conservative structural dependency estimate.  For each remaining box, the
 * test treats every other remaining box as a wall and asks whether that single
 * box can be pushed from the initial player position to any goal.  Removed
 * boxes are floor.  This can count boxes as dependent even when the real
 * multi-box solution could move a non-blocking box out of the way.
 *
 * @param {{width:number,height:number,walls:Set<number>,goals:Set<number>,boxes:Set<number>,player:number}} board
 * @param {number[]} initialBoxes
 * @returns {{dependencyCount:number,dependencyDepth:number,mutualDependency:boolean}}
 */
function computeDependencyMetrics(board, initialBoxes) {
  const initiallySolvable = findSingleSolvableBoxes(board, initialBoxes);
  const dependencyCount = initialBoxes.length - initiallySolvable.size;
  if (dependencyCount === 0) {
    return { dependencyCount, dependencyDepth: 0, mutualDependency: false };
  }

  const remaining = new Set(initialBoxes.filter((box) => !initiallySolvable.has(box)));
  let dependencyDepth = 0;
  let mutualDependency = false;

  while (remaining.size > 0) {
    dependencyDepth += 1;
    const newlySolvable = findSingleSolvableBoxes(board, [...remaining]);
    if (newlySolvable.size === 0) {
      mutualDependency = true;
      break;
    }
    if (newlySolvable.size === remaining.size) {
      break;
    }
    for (const box of newlySolvable) {
      remaining.delete(box);
    }
  }

  return { dependencyCount, dependencyDepth, mutualDependency };
}

function findSingleSolvableBoxes(board, boxes) {
  const boxSet = new Set(boxes);
  const solvable = new Set();
  for (const box of boxes) {
    const blockers = new Set(boxSet);
    blockers.delete(box);
    if (canSolveSingleBox(board, box, blockers)) {
      solvable.add(box);
    }
  }
  return solvable;
}

function canSolveSingleBox(board, startBox, blockers) {
  if (board.goals.has(startBox)) {
    return true;
  }

  const startKey = `${startBox}:${board.player}`;
  const visited = new Set([startKey]);
  const queue = [{ box: startBox, player: board.player }];
  let head = 0;

  while (head < queue.length) {
    const state = queue[head];
    head += 1;
    const reachable = floodReachableWithBoxes(board, state.player, blockers, state.box);
    const bx = state.box % board.width;
    const by = Math.floor(state.box / board.width);

    for (const [, dx, dy] of DIRS) {
      const stand = toIndex(bx - dx, by - dy, board.width);
      const boxTo = toIndex(bx + dx, by + dy, board.width);
      if (!reachable.has(stand) || !isFloorIndex(board, boxTo) || blockers.has(boxTo)) {
        continue;
      }
      if (board.goals.has(boxTo)) {
        return true;
      }
      const nextKey = `${boxTo}:${state.box}`;
      if (visited.has(nextKey)) {
        continue;
      }
      visited.add(nextKey);
      queue.push({ box: boxTo, player: state.box });
    }
  }

  return false;
}

function computeGoalPushDegrees(board, goals) {
  return goals.map((goal) => {
    const gx = goal % board.width;
    const gy = Math.floor(goal / board.width);
    let degree = 0;
    for (const [, dx, dy] of DIRS) {
      const boxFrom = toIndex(gx - dx, gy - dy, board.width);
      const stand = toIndex(gx - 2 * dx, gy - 2 * dy, board.width);
      if (isFloorIndex(board, boxFrom) && isFloorIndex(board, stand)) {
        degree += 1;
      }
    }
    return degree;
  });
}

function computeForcedPushRatio(board, pushSequence) {
  if (pushSequence.length === 0) {
    return 0;
  }

  const boxes = new Set(board.boxes);
  let player = board.player;
  let forced = 0;

  for (const push of pushSequence) {
    if (countLegalPushDirections(board, boxes, player, push.boxFrom) === 1) {
      forced += 1;
    }
    boxes.delete(push.boxFrom);
    boxes.add(push.boxTo);
    player = push.boxFrom;
  }

  return forced / pushSequence.length;
}

function countLegalPushDirections(board, boxes, player, box) {
  const reachable = floodReachableWithBoxes(board, player, boxes, null);
  const bx = box % board.width;
  const by = Math.floor(box / board.width);
  let count = 0;

  for (const [, dx, dy] of DIRS) {
    const stand = toIndex(bx - dx, by - dy, board.width);
    const boxTo = toIndex(bx + dx, by + dy, board.width);
    if (reachable.has(stand) && isFloorIndex(board, boxTo) && !boxes.has(boxTo)) {
      count += 1;
    }
  }
  return count;
}

function floodReachableWithBoxes(board, start, boxes, movingBox) {
  const visited = new Set();
  if (!isFloorIndex(board, start) || boxes.has(start) || start === movingBox) {
    return visited;
  }

  const queue = [start];
  let head = 0;
  visited.add(start);

  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    const x = idx % board.width;
    const y = Math.floor(idx / board.width);
    for (const [, dx, dy] of DIRS) {
      const next = toIndex(x + dx, y + dy, board.width);
      if (visited.has(next) || next === movingBox || boxes.has(next) || !isFloorIndex(board, next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function computeReversePullDistances(board, goals) {
  return goals.map((goal) => reversePullFromGoal(board, goal));
}

function reversePullFromGoal(board, goal) {
  const distances = new Map();
  const stateDistances = new Map();
  const queue = [];

  for (let side = 0; side < DIRS.length; side += 1) {
    const [, dx, dy] = DIRS[side];
    const stand = goal + dy * board.width + dx;
    if (isFloorIndex(board, stand)) {
      const key = stateKey(goal, side);
      stateDistances.set(key, 0);
      queue.push({ box: goal, side });
    }
  }
  distances.set(goal, 0);

  while (queue.length > 0) {
    const state = queue.shift();
    const dist = stateDistances.get(stateKey(state.box, state.side));

    for (const nextSide of reachableSides(board, state.box, state.side)) {
      const nextKey = stateKey(state.box, nextSide);
      if (!stateDistances.has(nextKey) || dist < stateDistances.get(nextKey)) {
        stateDistances.set(nextKey, dist);
        queue.unshift({ box: state.box, side: nextSide });
      }
    }

    const [, dx, dy] = DIRS[state.side];
    const nextBox = state.box + dy * board.width + dx;
    const nextStand = nextBox + dy * board.width + dx;
    if (!isFloorIndex(board, nextBox) || !isFloorIndex(board, nextStand)) {
      continue;
    }
    const nextKey = stateKey(nextBox, state.side);
    const nextDist = dist + 1;
    if (!stateDistances.has(nextKey) || nextDist < stateDistances.get(nextKey)) {
      stateDistances.set(nextKey, nextDist);
      if (!distances.has(nextBox) || nextDist < distances.get(nextBox)) {
        distances.set(nextBox, nextDist);
      }
      queue.push({ box: nextBox, side: state.side });
    }
  }

  return distances;
}

function reachableSides(board, box, startSide) {
  const [, startDx, startDy] = DIRS[startSide];
  const start = box + startDy * board.width + startDx;
  const visited = floodWithBlockedBox(board, start, box);
  const sides = [];
  for (let side = 0; side < DIRS.length; side += 1) {
    const [, dx, dy] = DIRS[side];
    const stand = box + dy * board.width + dx;
    if (visited.has(stand)) {
      sides.push(side);
    }
  }
  return sides;
}

function floodWithBlockedBox(board, start, blockedBox) {
  const visited = new Set();
  if (!isFloorIndex(board, start) || start === blockedBox) {
    return visited;
  }
  const queue = [start];
  let head = 0;
  visited.add(start);

  while (head < queue.length) {
    const idx = queue[head];
    head += 1;
    const x = idx % board.width;
    const y = (idx / board.width) | 0;
    for (const [, dx, dy] of DIRS) {
      const next = (y + dy) * board.width + x + dx;
      if (visited.has(next) || next === blockedBox || !isFloorIndex(board, next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function tracePushes(board, pushSequence, initialBoxes) {
  const boxAt = new Map();
  const positions = initialBoxes.slice();
  const boxesByStep = [positions.slice()];
  const pushes = [];

  for (let id = 0; id < initialBoxes.length; id += 1) {
    boxAt.set(initialBoxes[id], id);
  }

  for (const push of pushSequence) {
    const boxId = boxAt.get(push.boxFrom);
    if (boxId === undefined) {
      throw new Error(`computeStageMetrics: pushSequence references missing box ${push.boxFrom}`);
    }
    boxAt.delete(push.boxFrom);
    boxAt.set(push.boxTo, boxId);
    positions[boxId] = push.boxTo;
    pushes.push({ ...push, boxId });
    boxesByStep.push(positions.slice());
  }

  return { pushes, boxesByStep };
}

function computePhiTrace(boxesByStep, goals, pullDistances) {
  let previous = null;
  const values = [];
  const assignments = [];

  for (const boxes of boxesByStep) {
    const result = computePhi(boxes, goals, pullDistances, previous);
    values.push(result.value);
    assignments.push(result.assignment);
    previous = result.assignment;
  }

  return { values, assignments };
}

function computePhi(boxes, goals, pullDistances, previous) {
  const n = boxes.length;
  const used = new Array(goals.length).fill(false);
  let bestValue = Infinity;
  let bestAssignments = [];
  const current = [];

  function visit(boxIndex, sum) {
    if (sum > bestValue) {
      return;
    }
    if (boxIndex === n) {
      if (sum < bestValue) {
        bestValue = sum;
        bestAssignments = [current.slice()];
      } else if (sum === bestValue) {
        bestAssignments.push(current.slice());
      }
      return;
    }
    for (let goalIndex = 0; goalIndex < goals.length; goalIndex += 1) {
      if (used[goalIndex]) {
        continue;
      }
      const d = pullDistances[goalIndex].get(boxes[boxIndex]) ?? Infinity;
      used[goalIndex] = true;
      current.push(goalIndex);
      visit(boxIndex + 1, sum + d);
      current.pop();
      used[goalIndex] = false;
    }
  }

  visit(0, 0);
  if (bestAssignments.length === 0) {
    return { value: Infinity, assignment: null };
  }
  if (previous !== null) {
    for (const assignment of bestAssignments) {
      if (sameAssignment(assignment, previous)) {
        return { value: bestValue, assignment };
      }
    }
  }
  bestAssignments.sort(compareAssignment);
  return { value: bestValue, assignment: bestAssignments[0] };
}

function computePhiStats(values) {
  let minSoFar = values[0];
  let maxPhiBarrier = 0;
  let nonDescendingPushes = 0;
  let cumulativeRise = 0;

  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const curr = values[i];
    if (curr >= prev) {
      nonDescendingPushes += 1;
    }
    if (curr > prev) {
      cumulativeRise += curr - prev;
    }
    if (curr < minSoFar) {
      minSoFar = curr;
    }
    const barrier = curr - minSoFar;
    if (barrier > maxPhiBarrier) {
      maxPhiBarrier = barrier;
    }
  }

  return { maxPhiBarrier, nonDescendingPushes, cumulativeRise };
}

function countBoxChanges(boxIds) {
  let count = 0;
  for (let i = 1; i < boxIds.length; i += 1) {
    if (boxIds[i] !== boxIds[i - 1]) {
      count += 1;
    }
  }
  return count;
}

function countGoalRelodges(goals, pushes) {
  let count = 0;
  for (const push of pushes) {
    if (goals.has(push.boxFrom) && !goals.has(push.boxTo)) {
      count += 1;
    }
  }
  return count;
}

function countAssignmentChanges(assignments) {
  let count = 0;
  for (let i = 1; i < assignments.length; i += 1) {
    if (!sameAssignment(assignments[i], assignments[i - 1])) {
      count += 1;
    }
  }
  return count;
}

function countBoxLines(pushes) {
  if (pushes.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let i = 1; i < pushes.length; i += 1) {
    if (pushes[i].boxId !== pushes[i - 1].boxId || pushes[i].dir !== pushes[i - 1].dir) {
      lines += 1;
    }
  }
  return lines;
}

function computeTwoDecompositionLight(boxIds, boxCount) {
  if (boxCount < 2 || boxIds.length === 0) {
    return 0;
  }

  let best = Infinity;
  const maxMask = 1 << boxCount;
  for (let mask = 1; mask < maxMask - 1; mask += 1) {
    if ((mask & 1) === 0) {
      continue;
    }
    let switches = 0;
    let previousGroup = groupFor(boxIds[0], mask);
    for (let i = 1; i < boxIds.length; i += 1) {
      const group = groupFor(boxIds[i], mask);
      if (group !== previousGroup) {
        switches += 1;
      }
      previousGroup = group;
    }
    if (switches < best) {
      best = switches;
    }
  }
  return best;
}

function groupFor(boxId, mask) {
  return (mask & (1 << boxId)) === 0 ? 0 : 1;
}

function compareAssignment(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

function sameAssignment(a, b) {
  if (a === null || b === null || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function sorted(values) {
  return [...values].sort((a, b) => a - b);
}

function stateKey(box, side) {
  return `${box}:${side}`;
}

function toIndex(x, y, width) {
  return y * width + x;
}

function isFloorIndex(board, idx) {
  const x = idx % board.width;
  const y = (idx / board.width) | 0;
  return x >= 0 && x < board.width && y >= 0 && y < board.height && !board.walls.has(idx);
}
