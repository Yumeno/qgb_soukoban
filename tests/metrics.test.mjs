import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard } from '../src/core/board.js';
import { STAGES } from '../src/core/stages.js';
import { computeStageMetrics } from '../src/core/metrics.js';
import { solvePushes } from '../src/core/pushsolver.js';

function boardFromLines(lines) {
  return parseBoard(lines.join('\n'));
}

function assertFiniteMetricSet(metrics, label) {
  const fields = [
    'minPushes',
    'movesOfSolution',
    'boxChanges',
    'maxPhiBarrier',
    'nonDescendingPushes',
    'cumulativeRise',
    'goalRelodges',
    'assignmentChanges',
    'boxLines',
    'twoDecompositionLight',
    'movesPushesRatio',
    'expanded',
    'dependencyCount',
    'dependencyDepth',
    'minGoalPushDegree',
    'forcedPushRatio',
  ];
  for (const field of fields) {
    assert.equal(typeof metrics[field], 'number', `${label}: ${field} type`);
    assert.equal(Number.isFinite(metrics[field]), true, `${label}: ${field} finite`);
  }
  assert.equal(typeof metrics.mutualDependency, 'boolean', `${label}: mutualDependency type`);
  assert.equal(Array.isArray(metrics.goalPushDegrees), true, `${label}: goalPushDegrees array`);
  for (const degree of metrics.goalPushDegrees) {
    assert.equal(typeof degree, 'number', `${label}: goalPushDegrees item type`);
    assert.equal(Number.isFinite(degree), true, `${label}: goalPushDegrees item finite`);
  }
}

test('MT-01: straight one-box corridor has no box changes and no phi barrier', () => {
  // #######
  // #@ $ .#
  // #######
  // 手計算: 右へ2 push。箱は1個なので切替0。goal へ単調接近し Φ は 2 -> 1 -> 0。
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#######',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.equal(metrics.minPushes, 2);
  assert.equal(metrics.boxChanges, 0);
  assert.equal(metrics.maxPhiBarrier, 0);
  assert.ok(metrics.movesPushesRatio > 1);
});

test('MT-02: a necessary detour away from the goal creates the expected phi barrier', () => {
  // #######
  // #  #. #
  // #   $@#
  // # ## ##
  // #     #
  // #######
  // 手計算: 代表解の push は L,R,U。Φ は 1 -> 2 -> 1 -> 0 で、最大障壁は1。
  const board = boardFromLines([
    '#######',
    '#  #. #',
    '#   $@#',
    '# ## ##',
    '#     #',
    '#######',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.equal(metrics.maxPhiBarrier, 1);
  assert.equal(metrics.cumulativeRise, 1);
});

test('MT-03: two boxes that must be alternated report box changes', () => {
  // #######
  // #@ $ .#
  // #  $ .#
  // #######
  // 手計算: 2箱とも右へ2 push。代表解は少なくとも一度は押す箱を切り替える。
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#  $ .#',
    '#######',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.ok(metrics.boxChanges >= 1);
});

test('MT-04: moving a box off a goal is counted as a goal relodge', () => {
  // #######
  // #   *@#
  // ##  $ #
  // #    .#
  // ##   ##
  // #######
  // 手計算: 上の箱は開始時に goal 上。通路確保のため一度左へ押し出す。
  const board = boardFromLines([
    '#######',
    '#   *@#',
    '##  $ #',
    '#    .#',
    '##   ##',
    '#######',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.ok(metrics.goalRelodges >= 1);
});

test('MT-05: two-decomposition light separates independent and interleaved traces', () => {
  // 独立: 上下2本の廊下で各箱をまとめて処理できるためグループ切替は1以下。
  const independent = boardFromLines([
    '########',
    '#@ $ . #',
    '#      #',
    '#  $ . #',
    '########',
  ]);
  const independentMetrics = computeStageMetrics(independent);
  assert.equal(independentMetrics.solvable, true);
  assert.ok(independentMetrics.twoDecompositionLight <= 1);

  // 交互依存の近似例: 最短歩数代表解では上箱を1回、下箱を2回、上箱を1回押す。
  const interleaved = boardFromLines([
    '#######',
    '#@ $ .#',
    '#  $ .#',
    '#######',
  ]);
  const interleavedMetrics = computeStageMetrics(interleaved);
  assert.equal(interleavedMetrics.solvable, true);
  assert.ok(interleavedMetrics.twoDecompositionLight > independentMetrics.twoDecompositionLight);
});

test('MT-06: metrics are deterministic for identical input', () => {
  const board = parseBoard(STAGES[4].text);
  assert.deepEqual(computeStageMetrics(board), computeStageMetrics(board));
});

test('MT-07: all embedded stages are solvable and all numeric fields are finite', { timeout: 10000 }, () => {
  assert.equal(STAGES.length, 10);
  for (const stage of STAGES) {
    const metrics = computeStageMetrics(parseBoard(stage.text));
    assert.equal(metrics.solvable, true, stage.id);
    assertFiniteMetricSet(metrics, stage.id);
  }
});

test('MT-08: spacious walking-heavy one-box board has a high moves/pushes ratio', () => {
  // ############
  // #@       $.#
  // ############
  // 手計算: push は1回。押し位置まで7歩歩いてから1 push なので ratio は8。
  const board = boardFromLines([
    '############',
    '#@       $.#',
    '############',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.ok(metrics.movesPushesRatio >= 8);
});

test('MD-01: independent two-box routes have no structural dependencies', () => {
  // ########
  // #@ $ . #
  // #      #
  // #  $ . #
  // ########
  const board = boardFromLines([
    '########',
    '#@ $ . #',
    '#      #',
    '#  $ . #',
    '########',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.equal(metrics.dependencyCount, 0);
  assert.equal(metrics.dependencyDepth, 0);
  assert.equal(metrics.mutualDependency, false);
});

test('MD-02: plug box on the only route creates at least one dependency layer', () => {
  // ########
  // #@$  . #
  // # $ #  #
  // # #.   #
  // ########
  const board = boardFromLines([
    '########',
    '#@$  . #',
    '# $ #  #',
    '# #.   #',
    '########',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.ok(metrics.dependencyCount >= 1);
  assert.ok(metrics.dependencyDepth >= 1);
  assert.equal(metrics.mutualDependency, false);
});

test('MD-03: chained dependencies require at least two peeling rounds', () => {
  // #########
  // #       #
  // ## # #+ #
  // #  . $$ #
  // ##   .$ #
  // #   #   #
  // #########
  const board = boardFromLines([
    '#########',
    '#       #',
    '## # #+ #',
    '#  . $$ #',
    '##   .$ #',
    '#   #   #',
    '#########',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.ok(metrics.dependencyCount >= 2);
  assert.ok(metrics.dependencyDepth >= 2);
  assert.equal(metrics.mutualDependency, false);
});

test('MD-04: mutually blocking boxes are detected after solvability is confirmed', () => {
  // ########
  // #.#    #
  // #$     #
  // # $ @  #
  // ## .  ##
  // ########
  const board = boardFromLines([
    '########',
    '#.#    #',
    '#$     #',
    '# $ @  #',
    '## .  ##',
    '########',
  ]);
  const solved = solvePushes(board);
  assert.equal(solved.solvable, true);

  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.equal(metrics.mutualDependency, true);
});

test('MD-05: goal push degree distinguishes cornered and open goals', () => {
  // #####
  // #@$.#
  // #####
  const cornered = boardFromLines([
    '#####',
    '#@$.#',
    '#####',
  ]);
  const corneredMetrics = computeStageMetrics(cornered);
  assert.equal(corneredMetrics.minGoalPushDegree, 1);
  assert.deepEqual(corneredMetrics.goalPushDegrees, [1]);

  // #######
  // #     #
  // #  @  #
  // #  $  #
  // #  .  #
  // #     #
  // #######
  const open = boardFromLines([
    '#######',
    '#     #',
    '#  @  #',
    '#  $  #',
    '#  .  #',
    '#     #',
    '#######',
  ]);
  const openMetrics = computeStageMetrics(open);
  assert.ok(openMetrics.minGoalPushDegree >= 3);
});

test('MD-06: a one-wide corridor has a fully forced push trace', () => {
  // #######
  // #@ $ .#
  // #######
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#######',
  ]);
  const metrics = computeStageMetrics(board);
  assert.equal(metrics.solvable, true);
  assert.equal(metrics.minPushes, 2);
  assert.equal(metrics.forcedPushRatio, 1);
});

test('MD-07: embedded stages expose finite D4a metrics', { timeout: 10000 }, () => {
  assert.equal(STAGES.length, 10);
  for (const stage of STAGES) {
    const board = parseBoard(stage.text);
    const metrics = computeStageMetrics(board);
    assert.equal(metrics.solvable, true, stage.id);
    assert.equal(typeof metrics.dependencyCount, 'number', stage.id);
    assert.equal(typeof metrics.dependencyDepth, 'number', stage.id);
    assert.equal(typeof metrics.mutualDependency, 'boolean', stage.id);
    assert.equal(typeof metrics.minGoalPushDegree, 'number', stage.id);
    assert.equal(typeof metrics.forcedPushRatio, 'number', stage.id);
    assert.equal(Number.isFinite(metrics.dependencyCount), true, stage.id);
    assert.equal(Number.isFinite(metrics.dependencyDepth), true, stage.id);
    assert.equal(Number.isFinite(metrics.minGoalPushDegree), true, stage.id);
    assert.equal(Number.isFinite(metrics.forcedPushRatio), true, stage.id);
    assert.equal(metrics.goalPushDegrees.length, board.goals.size, stage.id);
  }
});

test('MD-08: D4a metrics are deterministic for identical input', () => {
  const board = parseBoard(STAGES[9].text);
  const first = computeStageMetrics(board);
  const second = computeStageMetrics(board);
  assert.deepEqual(
    {
      dependencyCount: first.dependencyCount,
      dependencyDepth: first.dependencyDepth,
      mutualDependency: first.mutualDependency,
      goalPushDegrees: first.goalPushDegrees,
      minGoalPushDegree: first.minGoalPushDegree,
      forcedPushRatio: first.forcedPushRatio,
    },
    {
      dependencyCount: second.dependencyCount,
      dependencyDepth: second.dependencyDepth,
      mutualDependency: second.mutualDependency,
      goalPushDegrees: second.goalPushDegrees,
      minGoalPushDegree: second.minGoalPushDegree,
      forcedPushRatio: second.forcedPushRatio,
    },
  );
});
