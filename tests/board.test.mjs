// 盤面パース/シリアライズ/検証のテスト (docs/test-design.md §3.1 B-01〜B-07)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, serializeBoard, validateBoard } from '../src/core/board.js';

// B-01: 標準記法のパース → 内部表現 → シリアライズの往復
test('B-01: パース→シリアライズの往復が元の文字列と一致する', () => {
  const text = [
    '#####',
    '#@$.#',
    '#####',
  ].join('\n');
  const board = parseBoard(text);
  const out = serializeBoard(board);
  assert.equal(out, text);
});

// B-02: '+'(プレイヤーonゴール)/'*'(箱onゴール)の分解
test('B-02: + と * が正しくゴール集合と動体に分離される', () => {
  const text = [
    '#####',
    '#*+.#',
    '#####',
  ].join('\n');
  const board = parseBoard(text);
  assert.equal(board.width, 5);
  assert.equal(board.height, 3);
  // 行1: '#','*','+','.','#' → index = y*width + x
  const idxBox = 1 * 5 + 1; // '*' 位置
  const idxPlayer = 1 * 5 + 2; // '+' 位置
  const idxGoal = 1 * 5 + 3; // '.' 位置
  assert.ok(board.goals.has(idxBox), '* の位置はゴール集合に含まれる');
  assert.ok(board.boxes.has(idxBox), '* の位置は箱集合に含まれる');
  assert.ok(board.goals.has(idxPlayer), '+ の位置はゴール集合に含まれる');
  assert.equal(board.player, idxPlayer, '+ の位置はプレイヤー位置になる');
  assert.ok(board.goals.has(idxGoal), '. の位置はゴール集合に含まれる');
  assert.equal(board.boxes.size, 1);
});

// B-03: プレイヤー0人/2人
test('B-03: プレイヤーが0人だと validate() が no_player で不合格', () => {
  const text = [
    '#####',
    '#.$ #',
    '#####',
  ].join('\n');
  const board = parseBoard(text);
  const result = validateBoard(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'no_player'));
});

test('B-03: プレイヤーが2人だと validate() が multiple_players で不合格', () => {
  const text = [
    '#####',
    '#@$.#',
    '#@  #',
    '#####',
  ].join('\n');
  const board = parseBoard(text);
  const result = validateBoard(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'multiple_players'));
});

// B-04: 箱数 != ゴール数 / 箱0個
test('B-04: 箱数とゴール数が不一致だと box_goal_mismatch で不合格', () => {
  const text = [
    '######',
    '#@$$.#',
    '######',
  ].join('\n');
  const board = parseBoard(text);
  const result = validateBoard(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'box_goal_mismatch'));
});

test('B-04: 箱が0個だと no_boxes で不合格', () => {
  const text = [
    '#####',
    '#@ .#',
    '#####',
  ].join('\n');
  const board = parseBoard(text);
  const result = validateBoard(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'no_boxes'));
});

// B-05: 壁で閉じていない盤面 (flood fill が外周に達する)
test('B-05: 壁で閉じていない盤面は not_enclosed で不合格', () => {
  const text = [
    '#####',
    '#@$.',
    '#####',
  ].join('\n');
  const board = parseBoard(text);
  const result = validateBoard(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'not_enclosed'));
});

// B-06: 不正文字を含む
test('B-06: 不正文字を含む盤面は parseBoard が即エラーを投げる', () => {
  const text = [
    '#####',
    '#@$X#',
    '#####',
  ].join('\n');
  assert.throws(() => parseBoard(text));
});

// B-07: 開始時点で全箱がゴール上
test('B-07: 開始時点で全箱がゴール上だと already_solved で不合格', () => {
  // 箱2個・ゴール2個で、両方とも '*'(箱onゴール)になっている = 開始即クリア
  const solvedText = [
    '######',
    '#@** #',
    '######',
  ].join('\n');
  const board = parseBoard(solvedText);
  const result = validateBoard(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'already_solved'));
});

// B-08: 行長不一致の盤面は右側パディングで矩形化されパース成功
test('B-08: 行長不一致の盤面は右側を床でパディングして矩形化しパース成功する', () => {
  const text = [
    '#######',
    '#@ $ .#',
    '###',
  ].join('\n');
  const board = parseBoard(text);
  assert.equal(board.width, 7);
  assert.equal(board.height, 3);
  // パディングされたマスは床(壁でも箱でもゴールでもない)
  const paddedIdx = 2 * 7 + 5; // 3行目の右側
  assert.ok(!board.walls.has(paddedIdx));
  assert.ok(!board.boxes.has(paddedIdx));
  assert.ok(!board.goals.has(paddedIdx));
  // 往復は正規化後表現と一致(行末空白は除去されるので元テキストに戻る)
  assert.equal(serializeBoard(board), text);
});

test('B-08: 空行を含む盤面は即エラー', () => {
  const text = [
    '#####',
    '',
    '#####',
  ].join('\n');
  assert.throws(() => parseBoard(text));
});

// B-09: プレイヤーから到達不能な位置に箱またはゴールがあると不合格
test('B-09: プレイヤーから到達不能な箱・ゴールは unreachable_entity で不合格', () => {
  // 壁で仕切られた右の部屋に箱とゴール。全体は壁で閉じている(not_enclosed ではない)
  const text = [
    '########',
    '#@  #$ #',
    '#   #..#',
    '#   #$ #',
    '########',
  ].join('\n');
  const board = parseBoard(text);
  const result = validateBoard(board);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'unreachable_entity'));
  // 独立性: 壁で閉じているので not_enclosed は出ない
  assert.ok(!result.errors.some((e) => e.code === 'not_enclosed'));
});

test('B-09: 全ての箱・ゴールがプレイヤーから到達可能なら unreachable_entity は出ない', () => {
  const text = [
    '#######',
    '#@ $ .#',
    '#######',
  ].join('\n');
  const board = parseBoard(text);
  const result = validateBoard(board);
  assert.ok(!result.errors.some((e) => e.code === 'unreachable_entity'));
});
