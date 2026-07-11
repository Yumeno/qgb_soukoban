import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResetConfirmation } from '../src/ui/confirmation.js';

test('buildResetConfirmation returns one step for clear-record reset', () => {
  const confirmation = buildResetConfirmation('clears');
  assert.equal(confirmation.requiredConfirms, 1);
  assert.equal(confirmation.steps.length, 1);
  assert.match(confirmation.steps[0], /模範リプレイの視聴フラグは残ります/);
});

test('buildResetConfirmation returns two destructive steps for all progress', () => {
  const confirmation = buildResetConfirmation('all');
  assert.equal(confirmation.requiredConfirms, 2);
  assert.equal(confirmation.steps.length, 2);
  assert.match(confirmation.steps[0], /模範解の視聴履歴・ランダム履歴も削除します/);
  assert.match(confirmation.steps[1], /模範解の視聴履歴・ランダム履歴も削除します/);
});
