import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';
import { isStaticCorner, legalMoves, solve, stateKey } from '../src/core/solver.js';

function boardFromLines(lines) {
  return parseBoard(lines.join('\n'));
}

function sortedBoxList(boxes) {
  return [...boxes].sort((a, b) => a - b);
}

function transitionSetFromLegalMoves(board) {
  return new Set(legalMoves(board).map((move) => {
    return `${move.dir}:${move.pushed}:${stateKey(move.next.player, move.next.boxes)}`;
  }));
}

function transitionSetFromGame(board) {
  const set = new Set();
  for (const dir of ['U', 'D', 'L', 'R']) {
    const game = new Game(board);
    const result = game.move(dir);
    if (result.moved) {
      set.add(`${dir}:${result.pushed}:${stateKey(game.board.player, game.board.boxes)}`);
    }
  }
  return set;
}

function assertLegalMovesMatchGame(board, label) {
  assert.deepEqual(
    [...transitionSetFromLegalMoves(board)].sort(),
    [...transitionSetFromGame(board)].sort(),
    label,
  );
}

test('S-01: 極小面1は手計算どおり最短1手', () => {
  const board = boardFromLines([
    '######',
    '#@$.#',
    '######',
  ]);
  const result = solve(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minMoves, 1);
  assert.equal(result.solution.length, 1);
});

test('S-01: 極小面2は手計算どおり最短3手', () => {
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#######',
  ]);
  const result = solve(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minMoves, 3);
});

test('S-01: 極小面3は手計算どおり最短2手', () => {
  const board = boardFromLines([
    '#####',
    '#@  #',
    '# $ #',
    '# . #',
    '#####',
  ]);
  const result = solve(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minMoves, 2);
});

test('S-02: ゴールでない凹角に固定された箱は解なし', () => {
  const board = boardFromLines([
    '#####',
    '#@  #',
    '#$ .#',
    '#####',
  ]);
  const result = solve(board);
  assert.equal(result.solvable, false);
  assert.equal(result.minMoves, null);
  assert.equal(result.solution, null);
});

test('S-03: solve の solution は Game.applyMoves で勝利状態に到達する', () => {
  const boards = [
    boardFromLines(['######', '#@$.#', '######']),
    boardFromLines(['#######', '#@ $ .#', '#######']),
    boardFromLines(['#####', '#@  #', '# $ #', '# . #', '#####']),
  ];
  for (const board of boards) {
    const result = solve(board);
    assert.equal(result.solvable, true);
    const game = new Game(board);
    game.applyMoves(result.solution);
    assert.equal(game.won, true);
    assert.equal(game.moves, result.minMoves);
  }
});

test('S-04: ゴール上の箱が凹角にあってもデッドロック扱いしない', () => {
  const board = boardFromLines([
    '#######',
    '#* @$.#',
    '#######',
  ]);
  const result = solve(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minMoves, 1);
});

test('S-05: 展開上限を超えたら例外ではなく limit を返す', () => {
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#######',
  ]);
  const result = solve(board, { maxStates: 0 });
  assert.equal(result.solvable, null);
  assert.equal(result.reason, 'limit');
  assert.equal(result.minMoves, null);
  assert.equal(result.solution, null);
});

test('S-05: maxStates は dequeue 数の境界で判定される', () => {
  const board = boardFromLines([
    '######',
    '#@$.#',
    '######',
  ]);

  const limit = solve(board, { maxStates: 1 });
  assert.equal(limit.solvable, null);
  assert.equal(limit.reason, 'limit');
  assert.equal(limit.stats.expanded, 1);
  assert.equal(limit.stats.visited, 2);

  const solved = solve(board, { maxStates: 2 });
  assert.equal(solved.solvable, true);
  assert.equal(solved.minMoves, 1);
  assert.equal(solved.stats.expanded, 2);
  assert.equal(solved.stats.visited, 2);
});

test('S-06: 2箱の既知面は最短8手', () => {
  const board = boardFromLines([
    '#######',
    '#@ $ .#',
    '#  $ .#',
    '#######',
  ]);
  const result = solve(board);
  assert.equal(result.solvable, true);
  assert.equal(result.minMoves, 8);
  const game = new Game(board);
  game.applyMoves(result.solution);
  assert.equal(game.won, true);
});

test('S-06: 4箱と内壁を含む決定的なやや重い盤面を既定上限内で解ける', () => {
  const board = boardFromLines([
    '##########',
    '#@ $ .   #',
    '#  #     #',
    '#  $ .   #',
    '#        #',
    '#  $ .   #',
    '#  #     #',
    '#  $ .   #',
    '##########',
  ]);
  const result = solve(board);
  assert.equal(result.solvable, true);
  assert.ok(result.minMoves > 0);
  const game = new Game(board);
  game.applyMoves(result.solution);
  assert.equal(game.won, true);
});

test('S-07: stateKey は箱集合の列挙順に依存しない', () => {
  assert.equal(stateKey(10, [30, 12, 20]), stateKey(10, [20, 30, 12]));
  assert.equal(stateKey(10, new Set([30, 12, 20])), '10:12,20,30');
});

test('S-07: isStaticCorner は左右端の列で行をまたがず盤外を壁相当として扱う', () => {
  const board = {
    width: 4,
    height: 3,
    walls: new Set([1, 7]),
    goals: new Set(),
    boxes: new Set(),
    player: 0,
  };
  assert.equal(isStaticCorner(board, 0), true);
  assert.equal(isStaticCorner(board, 4), false);
});

test('S-08: legalMoves は Game.move の合法遷移集合と一致する', () => {
  const deterministicCases = [
    {
      name: '箱2連続で押せない',
      board: boardFromLines([
        '#######',
        '#@$$ .#',
        '#######',
      ]),
    },
    {
      name: '箱を壁へ押せない',
      board: boardFromLines([
        '######',
        '#@ $#',
        '#   .#',
        '######',
      ]),
    },
    {
      name: '盤端(壁際)での移動',
      board: boardFromLines([
        '#####',
        '#@  #',
        '# $ #',
        '# . #',
        '#####',
      ]),
    },
    {
      name: 'ゴール上の箱を押すケース',
      board: boardFromLines([
        '#######',
        '# @* .#',
        '#  $  #',
        '#######',
      ]),
    },
    {
      name: '箱5個と内壁のある盤面',
      board: boardFromLines([
        '##########',
        '#@ $ .   #',
        '#  # $ . #',
        '#        #',
        '# $ # $ .#',
        '#   . $ .#',
        '##########',
      ]),
    },
  ];
  for (const { name, board } of deterministicCases) {
    assertLegalMovesMatchGame(board, name);
  }

  const rng = mulberry32(0x5eed1234);
  for (let caseNo = 0; caseNo < 120; caseNo += 1) {
    const width = 4 + Math.floor(rng() * 4);
    const height = 4 + Math.floor(rng() * 4);
    const walls = new Set();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          walls.add(y * width + x);
        }
      }
    }

    const interior = [];
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        if (rng() < 0.12) {
          walls.add(idx);
        } else {
          interior.push(idx);
        }
      }
    }
    assert.ok(interior.length >= 2);

    shuffle(interior, rng);
    const player = interior[0];
    const boxes = new Set(interior.slice(1, 1 + Math.min(2, interior.length - 1)));
    const boxList = [...boxes];
    const goals = new Set(rng() < 0.5 ? [boxList[0]] : []);
    for (const idx of interior.slice(1 + boxes.size)) {
      if (goals.size >= boxes.size) break;
      if (!boxes.has(idx)) goals.add(idx);
    }
    // 勝利済み盤面は S-08 の対象外。Game は勝利ガードで move を拒否するが、
    // legalMoves は盤面遷移のみを扱う設計差があるため除外する。
    if ([...boxes].every((box) => goals.has(box))) {
      goals.delete(boxList[boxList.length - 1]);
    }

    const board = { width, height, walls, goals, boxes, player };
    assertLegalMovesMatchGame(
      board,
      `case ${caseNo}: player=${player}, boxes=${sortedBoxList(boxes).join(',')}`,
    );
  }
});

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
