// リプレイ適用のテスト (docs/test-design.md §3.6 R-01〜R-03。R-04 は対象外/後続フェーズ)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard } from '../src/core/board.js';
import { Game } from '../src/core/game.js';

function makeBoard() {
  // #######
  // #@ $ .#
  // #######
  const text = [
    '#######',
    '#@ $ .#',
    '#######',
  ].join('\n');
  return parseBoard(text);
}

// R-01: クリアまでの操作列のログをリセット後に適用 → 勝利状態に到達、moves一致
test('R-01: クリアまでのログをリセット後に適用すると勝利状態に到達し moves が一致する', () => {
  const game = new Game(makeBoard());
  game.move('R'); // (1,1)->(2,1)
  game.move('R'); // (2,1)->(3,1) 箱を押す (3,1)->(4,1)
  game.move('R'); // (3,1)->(4,1) 箱を押す (4,1)->(5,1) = ゴール
  assert.equal(game.won, true);
  const replayLog = game.log;
  const expectedMoves = game.moves;

  game.reset();
  assert.equal(game.won, false);
  assert.equal(game.moves, 0);

  game.applyMoves(replayLog);
  assert.equal(game.won, true);
  assert.equal(game.moves, expectedMoves);
});

// R-02: undoを挟んだプレイのログ → undo後の実効手順のみが残り、適用で同一終局
test('R-02: undoを挟んだプレイでもログは実効手順のみを保持し、適用で同一終局になる', () => {
  const game = new Game(makeBoard());
  game.move('R'); // (1,1)->(2,1)
  game.move('L'); // (2,1)->(1,1) 押し戻し(箱には触れていない、単なる移動)
  game.undo();     // 上のLをundo → (2,1)に戻る
  game.move('R'); // (2,1)->(3,1)
  game.move('R'); // (3,1)->(4,1) 箱を押す (4,1)->(5,1) = ゴール
  assert.equal(game.won, true);

  const replayLog = game.log;
  const expectedBoxes = [...game.board.boxes].sort();
  const expectedPlayer = game.board.player;
  const expectedMoves = game.moves;

  // 別のGameインスタンスで再現できることを確認(初期状態からログ適用)
  const replayGame = new Game(makeBoard());
  replayGame.applyMoves(replayLog);

  assert.equal(replayGame.won, true);
  assert.equal(replayGame.moves, expectedMoves);
  assert.equal(replayGame.board.player, expectedPlayer);
  assert.deepEqual([...replayGame.board.boxes].sort(), expectedBoxes);
});

// R-03: 不正文字を含むリプレイ文字列の適用 → 明示エラー(黙って無視しない)
test('R-03: 不正文字を含むリプレイ文字列を適用すると明示的にエラーになる', () => {
  const game = new Game(makeBoard());
  assert.throws(() => game.applyMoves('RRX'), TypeError);
});
