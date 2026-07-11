const RANKS = {
  S: { grade: 'S', label: '特' },
  A: { grade: 'A', label: '優' },
  B: { grade: 'B', label: '良' },
  C: { grade: 'C', label: '可' },
};

export function computeRank(moves, minMoves, { solutionViewed = false } = {}) {
  validateInput(moves, minMoves);

  const thresholds = {
    S: minMoves,
    A: minMoves + Math.max(2, Math.ceil(minMoves * 0.10)),
    B: minMoves + Math.max(5, Math.ceil(minMoves * 0.30)),
  };

  if (moves === thresholds.S && solutionViewed) {
    return { ...rankResult('A', { ...RANKS.S, maxMoves: thresholds.S }), cappedByViewing: true };
  }
  if (moves === thresholds.S) {
    return rankResult('S', null);
  }
  if (moves <= thresholds.A) {
    return rankResult('A', { ...RANKS.S, maxMoves: thresholds.S });
  }
  if (moves <= thresholds.B) {
    return rankResult('B', { ...RANKS.A, maxMoves: thresholds.A });
  }
  return rankResult('C', { ...RANKS.B, maxMoves: thresholds.B });
}

function validateInput(moves, minMoves) {
  if (
    !Number.isSafeInteger(moves) ||
    !Number.isSafeInteger(minMoves) ||
    minMoves < 1 ||
    moves < minMoves
  ) {
    throw new TypeError('moves and minMoves must be safe integers with moves >= minMoves >= 1');
  }
}

function rankResult(grade, nextGrade) {
  const rank = RANKS[grade];
  return {
    grade: rank.grade,
    label: rank.label,
    nextGrade,
  };
}
