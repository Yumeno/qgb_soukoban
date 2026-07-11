const CURRENT_VERSION = 2;
const REPLAY_PATTERN = /^[UDLR]*$/;

export function createEmptyProgress() {
  return { version: CURRENT_VERSION, stages: {}, randomHistory: [] };
}

export function serializeProgress(progress) {
  return JSON.stringify(normalizeProgress(progress));
}

export function deserializeProgress(json) {
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return createEmptyProgress();
  }
  return normalizeProgress(obj);
}

export function boardHash(text) {
  if (typeof text !== 'string') {
    throw new TypeError('boardHash: text must be a string');
  }
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

export function mergeClearRecord(progress, stageId, { moves, replay, clearedAt, boardHash: hash }) {
  const base = normalizeProgress(progress);
  const existing = base.stages[stageId];
  const keep = preservedViewFields(existing, hash);
  let nextRecord;
  if (!existing?.cleared || moves < existing.bestMoves) {
    nextRecord = {
      ...keep,
      cleared: true,
      bestMoves: moves,
      replay,
      clearedAt,
      boardHash: hash ?? existing?.boardHash,
    };
  } else {
    nextRecord = { ...existing, ...keep, cleared: true, boardHash: hash ?? existing.boardHash };
  }
  return {
    ...base,
    stages: {
      ...base.stages,
      [stageId]: cleanUndefined(nextRecord),
    },
  };
}

export function markSolutionViewed(progress, stageId, hash) {
  const base = normalizeProgress(progress);
  const existing = base.stages[stageId] ?? {};
  return {
    ...base,
    stages: {
      ...base.stages,
      [stageId]: cleanUndefined({ ...existing, solutionViewed: true, boardHash: hash ?? existing.boardHash }),
    },
  };
}

export function resetClearRecords(progress) {
  const base = normalizeProgress(progress);
  const stages = {};
  for (const [stageId, record] of Object.entries(base.stages)) {
    if (record.solutionViewed === true) {
      stages[stageId] = cleanUndefined({
        solutionViewed: true,
        boardHash: record.boardHash,
      });
    }
  }
  return { ...base, stages, randomHistory: base.randomHistory.map(resetRandomClearRecord) };
}

export function clearAllProgress() {
  return createEmptyProgress();
}

export function invalidateStaleRecords(progress, stagesLike) {
  const base = normalizeProgress(progress);
  const expected = stageHashMap(stagesLike);
  const stages = {};
  for (const [stageId, record] of Object.entries(base.stages)) {
    const hash = expected.get(stageId);
    if (hash === undefined || record.boardHash === hash) {
      stages[stageId] = record;
    }
  }
  return { ...base, stages };
}

export function recordRandomPlay(progress, entry) {
  const base = normalizeProgress(progress);
  const existing = base.randomHistory.find((item) => sameRandomStage(item, entry));
  const merged = mergeRandomEntry(existing, entry);
  const rest = base.randomHistory.filter((item) => !sameRandomStage(item, entry));
  return {
    ...base,
    randomHistory: [merged, ...rest].slice(0, 50),
  };
}

export function markRandomSolutionViewed(progress, seed, difficulty, hash = undefined) {
  const base = normalizeProgress(progress);
  return {
    ...base,
    randomHistory: base.randomHistory.map((entry) => (
      entry.seed === seed && entry.difficulty === difficulty
        ? cleanUndefined({ ...entry, solutionViewed: true, boardHash: hash ?? entry.boardHash })
        : entry
    )),
  };
}

export function filterValidRandomHistory(progress, regenerateBoardText) {
  const base = normalizeProgress(progress);
  const valid = [];
  for (const entry of base.randomHistory) {
    try {
      const text = regenerateBoardText(entry);
      if (typeof text === 'string' && boardHash(text) === entry.boardHash) {
        valid.push(entry);
      }
    } catch {
      // Invalid generated entries are omitted from the display list.
    }
  }
  return valid;
}

function normalizeProgress(obj) {
  if (
    obj === null ||
    typeof obj !== 'object' ||
    Array.isArray(obj) ||
    obj.version !== CURRENT_VERSION ||
    obj.stages === null ||
    typeof obj.stages !== 'object' ||
    Array.isArray(obj.stages)
  ) {
    return createEmptyProgress();
  }

  const stages = {};
  for (const [stageId, record] of Object.entries(obj.stages)) {
    if (typeof stageId === 'string' && isValidStageRecord(record)) {
      stages[stageId] = normalizeStageRecord(record);
    }
  }

  const randomHistory = Array.isArray(obj.randomHistory)
    ? obj.randomHistory.filter(isValidRandomEntry).map(normalizeRandomEntry)
    : [];

  return { version: CURRENT_VERSION, stages, randomHistory };
}

function isValidStageRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }
  if (record.solutionViewed !== undefined && record.solutionViewed !== true) {
    return false;
  }
  if (record.boardHash !== undefined && typeof record.boardHash !== 'string') {
    return false;
  }
  if (record.cleared === undefined) {
    return record.solutionViewed === true;
  }
  return (
    record.cleared === true &&
    Number.isSafeInteger(record.bestMoves) &&
    record.bestMoves >= 0 &&
    typeof record.replay === 'string' &&
    REPLAY_PATTERN.test(record.replay) &&
    typeof record.clearedAt === 'string'
  );
}

function normalizeStageRecord(record) {
  return cleanUndefined({
    cleared: record.cleared === true ? true : undefined,
    bestMoves: record.cleared === true ? record.bestMoves : undefined,
    replay: record.cleared === true ? record.replay : undefined,
    clearedAt: record.cleared === true ? record.clearedAt : undefined,
    boardHash: record.boardHash,
    solutionViewed: record.solutionViewed === true ? true : undefined,
  });
}

function isValidRandomEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }
  if (!Number.isSafeInteger(entry.seed) || typeof entry.difficulty !== 'string') {
    return false;
  }
  if (entry.params === null || typeof entry.params !== 'object' || Array.isArray(entry.params)) {
    return false;
  }
  if (typeof entry.boardHash !== 'string' || !Number.isSafeInteger(entry.minMoves) || entry.minMoves < 1) {
    return false;
  }
  if (entry.solutionViewed !== undefined && entry.solutionViewed !== true) {
    return false;
  }
  if (entry.cleared === undefined) {
    return true;
  }
  return (
    entry.cleared === true &&
    Number.isSafeInteger(entry.bestMoves) &&
    entry.bestMoves >= entry.minMoves &&
    typeof entry.replay === 'string' &&
    REPLAY_PATTERN.test(entry.replay) &&
    typeof entry.clearedAt === 'string'
  );
}

function normalizeRandomEntry(entry) {
  return cleanUndefined({
    seed: entry.seed,
    difficulty: entry.difficulty,
    params: { ...entry.params },
    boardHash: entry.boardHash,
    minMoves: entry.minMoves,
    cleared: entry.cleared === true ? true : undefined,
    bestMoves: entry.cleared === true ? entry.bestMoves : undefined,
    replay: entry.cleared === true ? entry.replay : undefined,
    clearedAt: entry.cleared === true ? entry.clearedAt : undefined,
    solutionViewed: entry.solutionViewed === true ? true : undefined,
    playedAt: typeof entry.playedAt === 'string' ? entry.playedAt : undefined,
  });
}

function mergeRandomEntry(existing, entry) {
  const keepViewed = existing?.solutionViewed === true || entry.solutionViewed === true;
  const clearedUpdate = entry.cleared === true && (
    existing?.cleared !== true || entry.bestMoves < existing.bestMoves
  );
  return cleanUndefined({
    ...(existing ?? {}),
    seed: entry.seed,
    difficulty: entry.difficulty,
    params: { ...entry.params },
    boardHash: entry.boardHash ?? existing?.boardHash,
    minMoves: entry.minMoves ?? existing?.minMoves,
    cleared: clearedUpdate ? true : existing?.cleared,
    bestMoves: clearedUpdate ? entry.bestMoves : existing?.bestMoves,
    replay: clearedUpdate ? entry.replay : existing?.replay,
    clearedAt: clearedUpdate ? entry.clearedAt : existing?.clearedAt,
    solutionViewed: keepViewed ? true : undefined,
    playedAt: entry.playedAt ?? new Date().toISOString(),
  });
}

function resetRandomClearRecord(entry) {
  return cleanUndefined({
    seed: entry.seed,
    difficulty: entry.difficulty,
    params: { ...entry.params },
    boardHash: entry.boardHash,
    minMoves: entry.minMoves,
    solutionViewed: entry.solutionViewed === true ? true : undefined,
    playedAt: entry.playedAt,
  });
}

function sameRandomStage(left, right) {
  return left.seed === right.seed && left.difficulty === right.difficulty;
}

function preservedViewFields(existing, hash) {
  return cleanUndefined({
    solutionViewed: existing?.solutionViewed === true ? true : undefined,
    boardHash: hash ?? existing?.boardHash,
  });
}

function stageHashMap(stagesLike) {
  const map = new Map();
  if (Array.isArray(stagesLike)) {
    for (const stage of stagesLike) {
      if (stage?.id && typeof stage.text === 'string') {
        map.set(stage.id, boardHash(stage.text));
      }
    }
    return map;
  }
  if (stagesLike !== null && typeof stagesLike === 'object') {
    for (const [id, value] of Object.entries(stagesLike)) {
      if (typeof value === 'string') {
        map.set(id, boardHash(value));
      } else if (value?.text && typeof value.text === 'string') {
        map.set(id, boardHash(value.text));
      }
    }
  }
  return map;
}

function cleanUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}
