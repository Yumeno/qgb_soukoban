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
  return `sha256:${sha256Hex(utf8Bytes(text))}`;
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
    if (hash !== undefined && record.boardHash === hash) {
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
      entry.seed === seed && entry.difficulty === difficulty && (hash === undefined || entry.boardHash === hash)
        ? cleanUndefined({ ...entry, solutionViewed: true, boardHash: hash ?? entry.boardHash })
        : entry
    )),
  };
}

export function filterValidRandomHistory(progress, regenerateBoardText) {
  const base = normalizeProgress(progress);
  const valid = [];
  const seen = new Set();
  for (const entry of base.randomHistory) {
    try {
      const generated = regenerateBoardText(entry);
      const text = typeof generated === 'string' ? generated : generated?.text;
      const minMoves = typeof generated === 'string' ? entry.minMoves : generated?.minMoves;
      const optimalSolution = typeof generated === 'string' ? entry.optimalSolution : generated?.optimalSolution;
      const solutionWins = typeof generated === 'string' ? true : generated?.solutionWins;
      const key = randomEntryKey(entry);
      if (
        !seen.has(key) &&
        typeof text === 'string' &&
        boardHash(text) === entry.boardHash &&
        minMoves === entry.minMoves &&
        optimalSolution === entry.optimalSolution &&
        solutionWins === true
      ) {
        seen.add(key);
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
    ? dedupeRandomHistory(obj.randomHistory.filter(isValidRandomEntry).map(normalizeRandomEntry))
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
  if (
    typeof entry.boardHash !== 'string' ||
    !entry.boardHash.startsWith('sha256:') ||
    !Number.isSafeInteger(entry.minMoves) ||
    entry.minMoves < 1 ||
    typeof entry.optimalSolution !== 'string' ||
    !REPLAY_PATTERN.test(entry.optimalSolution) ||
    typeof entry.playedAt !== 'string'
  ) {
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
    optimalSolution: entry.optimalSolution,
    cleared: entry.cleared === true ? true : undefined,
    bestMoves: entry.cleared === true ? entry.bestMoves : undefined,
    replay: entry.cleared === true ? entry.replay : undefined,
    clearedAt: entry.cleared === true ? entry.clearedAt : undefined,
    solutionViewed: entry.solutionViewed === true ? true : undefined,
    playedAt: entry.playedAt,
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
    optimalSolution: entry.optimalSolution ?? existing?.optimalSolution,
    cleared: clearedUpdate ? true : existing?.cleared,
    bestMoves: clearedUpdate ? entry.bestMoves : existing?.bestMoves,
    replay: clearedUpdate ? entry.replay : existing?.replay,
    clearedAt: clearedUpdate ? entry.clearedAt : existing?.clearedAt,
    solutionViewed: keepViewed ? true : undefined,
    playedAt: entry.playedAt ?? existing?.playedAt,
  });
}

function resetRandomClearRecord(entry) {
  return cleanUndefined({
    seed: entry.seed,
    difficulty: entry.difficulty,
    params: { ...entry.params },
    boardHash: entry.boardHash,
    minMoves: entry.minMoves,
    optimalSolution: entry.optimalSolution,
    solutionViewed: entry.solutionViewed === true ? true : undefined,
    playedAt: entry.playedAt,
  });
}

function sameRandomStage(left, right) {
  return randomEntryKey(left) === randomEntryKey(right);
}

function randomEntryKey(entry) {
  return [
    entry.seed,
    entry.difficulty,
    sha256Hex(utf8Bytes(canonicalJson(entry.params))),
    entry.boardHash,
  ].join('|');
}

function dedupeRandomHistory(entries) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = randomEntryKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }
  return deduped;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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

function utf8Bytes(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    let codePoint = text.codePointAt(i);
    if (codePoint > 0xffff) {
      i += 1;
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function sha256Hex(bytes) {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const data = bytes.slice();
  const bitLength = data.length * 8;
  data.push(0x80);
  while ((data.length % 64) !== 56) {
    data.push(0);
  }
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  data.push(
    (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
    (low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff,
  );

  const w = new Array(64);
  for (let chunk = 0; chunk < data.length; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      const offset = chunk + i * 4;
      w[i] = ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function rotr(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
