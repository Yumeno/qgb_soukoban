import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRank } from '../src/core/rank.js';

function expected(grade, label, nextGrade) {
  return { grade, label, nextGrade };
}

test('RK-01: rank boundaries cover each grade at threshold +/- 1', () => {
  const minMoves = 20;

  assert.deepEqual(computeRank(20, minMoves), expected('S', '特', null));

  assert.deepEqual(
    computeRank(21, minMoves),
    expected('A', '優', { grade: 'S', label: '特', maxMoves: 20 }),
  );
  assert.deepEqual(
    computeRank(22, minMoves),
    expected('A', '優', { grade: 'S', label: '特', maxMoves: 20 }),
  );

  assert.deepEqual(
    computeRank(23, minMoves),
    expected('B', '良', { grade: 'A', label: '優', maxMoves: 22 }),
  );
  assert.deepEqual(
    computeRank(25, minMoves),
    expected('B', '良', { grade: 'A', label: '優', maxMoves: 22 }),
  );
  assert.deepEqual(
    computeRank(26, minMoves),
    expected('B', '良', { grade: 'A', label: '優', maxMoves: 22 }),
  );

  assert.deepEqual(
    computeRank(27, minMoves),
    expected('C', '可', { grade: 'B', label: '良', maxMoves: 26 }),
  );
});

test('RK-01: small minMoves use absolute relaxation for A and B', () => {
  assert.deepEqual(computeRank(1, 1), expected('S', '特', null));
  assert.deepEqual(
    computeRank(2, 1),
    expected('A', '優', { grade: 'S', label: '特', maxMoves: 1 }),
  );
  assert.deepEqual(
    computeRank(3, 1),
    expected('A', '優', { grade: 'S', label: '特', maxMoves: 1 }),
  );
  assert.deepEqual(
    computeRank(4, 1),
    expected('B', '良', { grade: 'A', label: '優', maxMoves: 3 }),
  );
  assert.deepEqual(
    computeRank(6, 1),
    expected('B', '良', { grade: 'A', label: '優', maxMoves: 3 }),
  );
  assert.deepEqual(
    computeRank(7, 1),
    expected('C', '可', { grade: 'B', label: '良', maxMoves: 6 }),
  );

  assert.deepEqual(computeRank(3, 3), expected('S', '特', null));
  assert.deepEqual(
    computeRank(5, 3),
    expected('A', '優', { grade: 'S', label: '特', maxMoves: 3 }),
  );
  assert.deepEqual(
    computeRank(6, 3),
    expected('B', '良', { grade: 'A', label: '優', maxMoves: 5 }),
  );
  assert.deepEqual(
    computeRank(8, 3),
    expected('B', '良', { grade: 'A', label: '優', maxMoves: 5 }),
  );
  assert.deepEqual(
    computeRank(9, 3),
    expected('C', '可', { grade: 'B', label: '良', maxMoves: 8 }),
  );
});

test('RK-02: nextGrade points to the immediate higher grade limit', () => {
  assert.equal(computeRank(10, 10).nextGrade, null);
  assert.deepEqual(computeRank(11, 10).nextGrade, { grade: 'S', label: '特', maxMoves: 10 });
  assert.deepEqual(computeRank(14, 10).nextGrade, { grade: 'A', label: '優', maxMoves: 12 });
  assert.deepEqual(computeRank(99, 10).nextGrade, { grade: 'B', label: '良', maxMoves: 15 });
});

test('RK-03: invalid input throws TypeError', () => {
  const cases = [
    [0, 1],
    [9, 10],
    [10.5, 10],
    [10, 10.5],
    [10, 0],
    [Number.NaN, 10],
    [10, Number.NaN],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [10, Number.MAX_SAFE_INTEGER + 1],
    ['10', 10],
    [10, '10'],
  ];

  for (const args of cases) {
    assert.throws(() => computeRank(...args), TypeError, JSON.stringify(args));
  }
});

test('RK-04: viewed solution caps perfect clear at A', () => {
  assert.deepEqual(computeRank(20, 20, { solutionViewed: true }), {
    grade: 'A',
    label: '優',
    nextGrade: { grade: 'S', label: '特', maxMoves: 20 },
    cappedByViewing: true,
  });
  assert.equal(computeRank(20, 20, { solutionViewed: false }).grade, 'S');
});
