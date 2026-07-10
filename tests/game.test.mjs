// ゲーム状態機械のテスト (docs/test-design.md §3.2 G-01〜G-10)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';

// 共通のテスト盤面:
// #######
// #@ $ .#
// #######
// プレイヤーは (1,1)、箱は (3,1)、ゴールは (5,1)
function makeBoard() {
  const text = [
    '#######',
    '#@ $ .#',
    '#######',
  ].join('\n');
  return parseBoard(text);
}

// G-01: 床への移動
test('G-01: 床への移動で位置更新・moves+1・ログ追加', () => {
  const game = new Game(makeBoard());
  const result = game.move('R');
  assert.equal(result.moved, true);
  assert.equal(result.pushed, false);
  assert.equal(result.won, false);
  assert.equal(game.moves, 1);
  assert.equal(game.log, 'R');
  assert.equal(game.board.player, 1 * 7 + 2); // (2,1)
});

// G-02: 壁への移動
test('G-02: 壁への移動は状態不変', () => {
  const game = new Game(makeBoard());
  const before = game.board;
  const result = game.move('U'); // 上は壁
  assert.equal(result.moved, false);
  assert.equal(game.moves, 0);
  assert.equal(game.log, '');
  assert.equal(game.board.player, before.player);
});

// G-03: 箱押し(先が床/ゴール)
test('G-03: 箱押しで箱・プレイヤー両方移動、moves+1', () => {
  const game = new Game(makeBoard());
  // プレイヤー(1,1) → (2,1) → (3,1)は箱がある。箱を押すには箱の先(4,1)が床である必要がある。
  game.move('R'); // (1,1)->(2,1)
  const result = game.move('R'); // (2,1)->(3,1) で箱(3,1)->(4,1)へ押す
  assert.equal(result.moved, true);
  assert.equal(result.pushed, true);
  assert.equal(game.moves, 2);
  assert.equal(game.board.player, 1 * 7 + 3); // (3,1)
  assert.ok(game.board.boxes.has(1 * 7 + 4)); // 箱は(4,1)へ
  assert.ok(!game.board.boxes.has(1 * 7 + 3));
});

// G-04: 箱押し不可(先が壁/箱)
test('G-04: 箱の先が壁の場合は押せず状態不変', () => {
  const text = [
    '######',
    '#@$# #',
    '######',
  ].join('\n');
  const board = parseBoard(text);
  const game = new Game(board);
  const beforePlayer = game.board.player;
  const result = game.move('R'); // 箱の先(#)が壁
  assert.equal(result.moved, false);
  assert.equal(game.moves, 0);
  assert.equal(game.board.player, beforePlayer);
  assert.ok(game.board.boxes.has(beforePlayer + 1)); // 箱は動いていない(プレイヤーの右隣のまま)
});

test('G-04: 箱の先が箱の場合は押せず状態不変', () => {
  const text = [
    '#######',
    '#@$$  #',
    '#######',
  ].join('\n');
  const board = parseBoard(text);
  const game = new Game(board);
  const beforePlayer = game.board.player;
  const result = game.move('R'); // 箱の先も箱
  assert.equal(result.moved, false);
  assert.equal(game.moves, 0);
  assert.equal(game.board.player, beforePlayer);
});

// G-05: 勝利判定
test('G-05: 最後の箱をゴールに押すとwon=true、以降のmoveは無視', () => {
  const text = [
    '######',
    '#@$.#',
    '######',
  ].join('\n');
  const board = parseBoard(text);
  const game = new Game(board);
  const result = game.move('R'); // 箱を押してゴールへ
  assert.equal(result.won, true);
  assert.equal(game.won, true);
  const movesAfterWin = game.moves;
  const logAfterWin = game.log;
  const result2 = game.move('L'); // 勝利後は無視
  assert.equal(result2.moved, false);
  assert.equal(game.moves, movesAfterWin);
  assert.equal(game.log, logAfterWin);
});

// G-06: undo 1回
test('G-06: undo 1回で直前状態に完全復帰', () => {
  const game = new Game(makeBoard());
  const beforePlayer = game.board.player;
  game.move('R');
  const undone = game.undo();
  assert.equal(undone, true);
  assert.equal(game.board.player, beforePlayer);
  assert.equal(game.moves, 0);
  assert.equal(game.log, '');
});

// G-07: undo 多段(押しを含む)
test('G-07: undo多段(押しを含む複数手)で初期状態に完全一致', () => {
  const game = new Game(makeBoard());
  const initialBoard = game.board;
  game.move('R'); // 移動
  game.move('R'); // 箱押し
  game.move('L'); // 移動(箱は押し戻せない=単なる移動)
  assert.ok(game.moves > 0);
  let undone = game.undo();
  while (undone) {
    undone = game.undo();
  }
  assert.equal(game.moves, 0);
  assert.equal(game.log, '');
  assert.equal(game.board.player, initialBoard.player);
  assert.deepEqual([...game.board.boxes].sort(), [...initialBoard.boxes].sort());
});

// G-08: 初期状態でのundo
test('G-08: 初期状態でのundoは不発(エラーにしない)', () => {
  const game = new Game(makeBoard());
  const result = game.undo();
  assert.equal(result, false);
  assert.equal(game.moves, 0);
});

// G-09: リセット
test('G-09: リセットで初期状態に完全復帰、ログ空', () => {
  const game = new Game(makeBoard());
  const initialBoard = game.board;
  game.move('R');
  game.move('R');
  game.reset();
  assert.equal(game.moves, 0);
  assert.equal(game.log, '');
  assert.equal(game.board.player, initialBoard.player);
  assert.deepEqual([...game.board.boxes].sort(), [...initialBoard.boxes].sort());
});

// G-10: 不発移動はログに記録されない
test('G-10: 不発移動はログに記録されない', () => {
  const game = new Game(makeBoard());
  game.move('U'); // 壁で不発
  game.move('R'); // 有効
  game.move('U'); // 壁で不発
  assert.equal(game.log, 'R');
  assert.equal(game.moves, 1);
});

// Game.board は外部から書き換えても内部状態に影響しないスナップショットであること
test('Game.board はスナップショットであり外部変更が内部状態に影響しない', () => {
  const game = new Game(makeBoard());
  const snapshot = game.board;
  snapshot.boxes.add(9999);
  snapshot.player = -1;
  const snapshot2 = game.board;
  assert.ok(!snapshot2.boxes.has(9999));
  assert.notEqual(snapshot2.player, -1);
});

// applyMoves: 不正文字が含まれたら適用前にTypeErrorを投げる
test('applyMoves: 不正文字を含む場合は適用前にTypeErrorを投げ、状態も変化しない', () => {
  const game = new Game(makeBoard());
  const beforePlayer = game.board.player;
  assert.throws(() => game.applyMoves('RRX'), TypeError);
  assert.equal(game.board.player, beforePlayer);
  assert.equal(game.moves, 0);
});

test('applyMoves: 正常な文字列は順にmoveを適用する', () => {
  const text = [
    '######',
    '#@$.#',
    '######',
  ].join('\n');
  const board = parseBoard(text);
  const game = new Game(board);
  game.applyMoves('R');
  assert.equal(game.won, true);
  assert.equal(game.moves, 1);
  assert.equal(game.log, 'R');
});
