export function buildResetConfirmation(kind) {
  if (kind === 'clears') {
    return {
      requiredConfirms: 1,
      steps: [
        'クリア記録を削除します。模範リプレイの視聴フラグは残ります。特の制限は解除されません',
      ],
    };
  }
  if (kind === 'all') {
    return {
      requiredConfirms: 2,
      steps: [
        '記録を全消去します。模範解の視聴履歴・ランダム履歴も削除します',
        '本当にすべての記録を削除しますか。模範解の視聴履歴・ランダム履歴も削除します',
      ],
    };
  }
  throw new RangeError(`unknown reset confirmation kind: ${kind}`);
}
