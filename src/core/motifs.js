export const MOTIFS = Object.freeze({
  packingRoom: 'packingRoom',
  plug: 'plug',
  swapPocket: 'swapPocket',
  uTurn: 'uTurn',
});

const MOTIF_ROWS = Object.freeze({
  [MOTIFS.packingRoom]: [
    '#########',
    '#   #   #',
    '#   #   #',
    '#...    #',
    '#   #   #',
    '#       #',
    '#########',
  ],
  [MOTIFS.plug]: [
    '#########',
    '#   #   #',
    '#   #   #',
    '#...    #',
    '#   #   #',
    '#       #',
    '#########',
  ],
  [MOTIFS.swapPocket]: [
    '#########',
    '#       #',
    '# ## ## #',
    '# .   . #',
    '#   #   #',
    '#   .   #',
    '#########',
  ],
  [MOTIFS.uTurn]: [
    '#########',
    '#.      #',
    '#.#     #',
    '#.   #  #',
    '#    #  #',
    '#       #',
    '#########',
  ],
});

export function listMotifs() {
  return Object.values(MOTIFS);
}

export function buildMotifSkeleton(name, params = {}) {
  if (!Object.hasOwn(MOTIF_ROWS, name)) {
    throw new RangeError(`buildMotifSkeleton: unknown motif '${name}'`);
  }
  const rows = shouldMirrorX(params) ? mirrorRows(MOTIF_ROWS[name]) : MOTIF_ROWS[name];
  const width = rows[0].length;
  const height = rows.length;
  if ((params.width !== undefined && params.width !== width)
    || (params.height !== undefined && params.height !== height)) {
    throw new RangeError(`buildMotifSkeleton: motif '${name}' requires ${width}x${height}`);
  }

  const walls = new Set();
  const goals = new Set();
  const floors = [];
  const targetRoute = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ch = rows[y][x];
      const idx = toIndex(x, y, width);
      if (ch === '#') {
        walls.add(idx);
      } else {
        floors.push(idx);
        if (ch === '.') {
          goals.add(idx);
        }
      }
    }
  }

  for (const goal of goals) {
    const gx = goal % width;
    const gy = Math.floor(goal / width);
    for (const [, dx, dy] of DIRS) {
      for (let step = 1; step <= 4; step += 1) {
        const x = gx + dx * step;
        const y = gy + dy * step;
        const idx = toIndex(x, y, width);
        if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1 || walls.has(idx)) {
          break;
        }
        targetRoute.add(idx);
      }
    }
  }

  return {
    name,
    width,
    height,
    boxCount: goals.size,
    walls,
    goals,
    floors,
    targetRoute,
  };
}

function shouldMirrorX(params) {
  return params.mirrorX === true || (params.mirrorX !== false && Number.isInteger(params.seed) && (params.seed & 1) === 1);
}

function mirrorRows(rows) {
  return rows.map((row) => row.split('').reverse().join(''));
}

const DIRS = [
  ['U', 0, -1],
  ['D', 0, 1],
  ['L', -1, 0],
  ['R', 1, 0],
];

function toIndex(x, y, width) {
  return y * width + x;
}
