import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, validateBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { solve } from '../src/core/solver.js';
import { computeStageMetrics } from '../src/core/metrics.js';
import { STAGES } from '../src/core/stages.js';

function boardFor(stage) {
  return parseBoard(stage.text);
}

function assertSizeLimit(stage, board) {
  assert.ok(board.boxes.size <= 5, `${stage.id}: boxes=${board.boxes.size}`);
  assert.ok(board.width <= 12, `${stage.id}: width=${board.width}`);
  assert.ok(board.height <= 10, `${stage.id}: height=${board.height}`);
}

test('T-01: all embedded stages pass validateBoard', () => {
  assert.equal(STAGES.length, 10);
  for (const stage of STAGES) {
    const board = boardFor(stage);
    const validation = validateBoard(board);
    assert.equal(validation.ok, true, `${stage.id}: ${JSON.stringify(validation.errors)}`);
  }
});

for (const stage of STAGES) {
  test(`T-02/T-03: ${stage.id} is solvable and minMoves is solver-derived`, { timeout: 5000 }, () => {
    const board = boardFor(stage);
    const solved = solve(board);
    assert.equal(solved.solvable, true, `${stage.id}: solvable`);
    assert.equal(stage.minMoves, solved.minMoves, `${stage.id}: minMoves`);
  });
}

test('T-04: difficulty curve is monotonic by score', () => {
  const scores = STAGES.map((stage) => stage.metrics.score);
  assert.equal(scores[0], Math.min(...scores), 'stage01 should be easiest');
  assert.equal(scores.at(-1), Math.max(...scores), 'stage10 should be hardest');

  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i] > scores[i - 1], `score curve: ${scores.join(',')}`);
  }
});

test('T-05: stage ids and names are unique', () => {
  assert.equal(new Set(STAGES.map((stage) => stage.id)).size, STAGES.length);
  assert.equal(new Set(STAGES.map((stage) => stage.name)).size, STAGES.length);
});

test('T-06: all embedded stages stay within solver size limits', () => {
  for (const stage of STAGES) {
    assertSizeLimit(stage, boardFor(stage));
  }
});

test('T-07: no embedded stage starts with a box on a goal', () => {
  for (const stage of STAGES) {
    const board = boardFor(stage);
    for (const box of board.boxes) {
      assert.equal(board.goals.has(box), false, `${stage.id}: box=${box}`);
    }
    assert.equal(stage.text.includes('*'), false, stage.id);
  }
});

for (const stage of STAGES) {
  test(`T-08: ${stage.id} embedded metrics match recomputed metrics`, { timeout: 5000 }, () => {
    const board = boardFor(stage);
    const metrics = computeStageMetrics(board);
    assert.equal(metrics.solvable, true, `${stage.id}: metrics solvable`);
    assert.equal(stage.metrics.minPushes, metrics.minPushes, `${stage.id}: minPushes`);
    assert.equal(stage.metrics.boxChanges, metrics.boxChanges, `${stage.id}: boxChanges`);
    assert.equal(stage.metrics.maxPhiBarrier, metrics.maxPhiBarrier, `${stage.id}: maxPhiBarrier`);
    assert.equal(stage.metrics.dependencyCount, metrics.dependencyCount, `${stage.id}: dependencyCount`);
    assert.equal(stage.metrics.dependencyDepth, metrics.dependencyDepth, `${stage.id}: dependencyDepth`);
    assert.equal(stage.metrics.mutualDependency, metrics.mutualDependency, `${stage.id}: mutualDependency`);
    assert.equal(stage.metrics.minGoalPushDegree, metrics.minGoalPushDegree, `${stage.id}: minGoalPushDegree`);
    assert.equal(stage.metrics.movesPushesRatio, Math.round(metrics.movesPushesRatio * 1000) / 1000, `${stage.id}: movesPushesRatio`);
  });
}

test('T-09: stage08-stage10 require maxPhiBarrier >= 1', () => {
  for (const stage of STAGES.slice(7, 9)) {
    assert.ok(stage.metrics.maxPhiBarrier >= 1, `${stage.id}: maxPhiBarrier=${stage.metrics.maxPhiBarrier}`);
    assert.ok(stage.metrics.dependencyDepth >= 1, `${stage.id}: dependencyDepth=${stage.metrics.dependencyDepth}`);
  }
});

test('T-10: stage10 requires a strong dependency structure', () => {
  const stage10 = STAGES[9];
  assert.ok(
    stage10.metrics.dependencyDepth >= 2
      || stage10.metrics.mutualDependency
      || stage10.metrics.dependencyCount >= 2,
    `${stage10.id}: depDepth=${stage10.metrics.dependencyDepth} depCount=${stage10.metrics.dependencyCount} mutual=${stage10.metrics.mutualDependency}`,
  );
});

test('T-11: embedded stages have unique structural signatures', () => {
  const signatures = new Set();
  for (const stage of STAGES) {
    const board = boardFor(stage);
    const signature = structuralSignature(stage, board);
    assert.equal(signatures.has(signature), false, `${stage.id}: duplicate signature ${signature}`);
    signatures.add(signature);
  }
});

test('T-12: policies are dispersed', () => {
  const counts = new Map();
  let upperScatteredCount = 0;
  for (const [index, stage] of STAGES.entries()) {
    const policy = policyKey(stage);
    if (policy === 'scattered') {
      if (index >= 5) {
        upperScatteredCount += 1;
        assert.ok(upperScatteredCount <= 1, `scattered in stage06-stage10: count=${upperScatteredCount}`);
      }
    } else {
      const count = (counts.get(policy) ?? 0) + 1;
      assert.ok(count <= 2, `${policy}: count=${count}`);
      assert.notEqual(policy, policyKey(STAGES[index - 1]), `${stage.id}: adjacent policy ${policy}`);
      counts.set(policy, count);
    }
    if (index >= 6) {
      const previous = STAGES[index - 1];
      assert.notEqual(policy, policyKey(previous), `${stage.id}: adjacent upper policy ${policy}`);
      assert.notEqual(upperFeelSignature(stage), upperFeelSignature(previous), `${stage.id}: adjacent upper feel ${upperFeelSignature(stage)}`);
    }
  }
});

for (const stage of STAGES) {
  test(`embedded solver solution for ${stage.id} replays through Game.applyMoves`, { timeout: 5000 }, () => {
    const board = boardFor(stage);
    const solved = solve(board);
    const game = new Game(board);
    game.applyMoves(solved.solution);
    assert.equal(game.won, true, `${stage.id}: replay won`);
    assert.equal(game.log, solved.solution, `${stage.id}: replay log`);
  });
}

function structuralSignature(stage, board) {
  const metrics = stage.metrics;
  return [
    metrics.minPushes,
    metrics.boxChanges,
    metrics.maxPhiBarrier,
    metrics.dependencyCount,
    metrics.dependencyDepth,
    metrics.mutualDependency,
    metrics.minGoalPushDegree,
    board.width,
    board.height,
    board.boxes.size,
  ].join('|');
}

function policyKey(stage) {
  return typeof stage.policy === 'string' && stage.policy.length > 0
    ? stage.policy
    : 'scattered';
}

function upperFeelSignature(stage) {
  return [
    boardFor(stage).boxes.size,
    stage.metrics.mutualDependency,
  ].join('|');
}
