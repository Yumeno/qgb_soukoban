# REQ-SAVE-001 検討ドラフト(issue #1 対応)

- 状態: 原案(Fable 5 起草 2026-07-12 / Codex レビュー待ち)
- 対象 issue: https://github.com/Yumeno/qgb_soukoban/issues/1

## 1. なぜ新 REQ が必要か

issue #1 の機能群は「**利用者の保存データを壊さない**」という約束を初めて導入する:

- 保存スキーマが v1 → v2 に変わる(視聴フラグ・ランダム履歴の追加)
- 現行実装は「版不一致は初期化」なので、**このまま出すと既存プレイヤーのクリア記録が全消滅する**
- リセット2系統は破壊的操作であり、「消すべきものだけ消す」選択性が約束になる

これは既存 3 REQ(CORE=ルール、SOLV=可解性、DIST=配布物)のどれにも属さない persistence の約束。機械検査可能(単体テスト)なので REQ 化に適する。

## 2. REQ-SAVE-001 案

- **守りたい約束**: 保存された記録は参照先の盤面と常に整合し、初期化操作は宣言した範囲だけを消す
- **stages**: S1-static, S2-unit(新しい段階は不要)
- **改訂(2026-07-12 ユーザー判断)**: 現行 v1 データは「ステージ再生成のたびに不整合になっている」ため**破棄してよい**(移行処理は実装しない)。代わりに恒久対策として、v2 の記録を**盤面内容に紐付ける**:
- **acceptance criteria(テストケース対応)**:
  1. v2 の各ステージ記録は盤面ハッシュ(stage text の sha-256 等)を保持し、ロード時に現行 STAGES の盤面とハッシュ不一致の記録は**その記録だけ**無効化される(選択的失効。他の記録・視聴フラグ・ランダム履歴は保持)
  2. ランダム履歴のエントリは seed+params から再生成した盤面と整合することを検証してから表示に使う(再生成失敗・不一致エントリは表示から除外)
  3. v1 データ・壊れた JSON・未知版は安全に初期状態(throw しない)
  4. resetClearRecords: クリア記録のみ消去、**solutionViewed とランダム履歴の存在は保持**
  5. clearAllProgress: 完全初期化
  6. mergeClearRecord / recordRandomPlay が solutionViewed を破壊しない
  7. (将来の約束)v2 以降の版移行は無損失で行う

## 3. REQ-SOLV-001 の修正案

- acceptance criteria に追加: **模範解の真正性** — 焼き込み optimalSolution が (a) 適用で勝利到達 (b) 長さ === minMoves(=本当に最短)。収録面(T-13)とシードプール(SP-05)の両方
- S3(tools/verify-stages.mjs)の検査項目に optimalSolution の再検証を追加(per-stage 表に optLen==minMoves 列)

## 4. contract への影響

- 既存 contract のコマンドは変更不要(S2 は node --test で新テストを自動的に包含、S3 は verify-stages の内部拡張)
- REQ-SAVE-001 の contract: S1 は既存と同一(node tools\check-syntax.mjs)、S2 は node --test(いずれも実績ある形の再利用)

## 5. レビューで見てほしい点(Codex 向け)

1. REQ の切り方: persistence を独立 REQ にするのは過剰か、REQ-CORE-001 への統合が妥当か
2. acceptance criteria の抜け(特に移行の端ケース: v2 に既に移行済みのデータの再読込、部分的に壊れた v1 等)
3. 「クリア記録初期化は視聴フラグを保持する」仕様の妥当性(ユーザー意図「リセットしない限り特が取れない」との整合。全消去のみが視聴フラグを解除する設計でよいか)
4. 模範解の真正性検証を S3 に足すことの是非(S2 のテストと重複するが、収録データの監査証跡としての価値)
