# REQ-DIST-001: 配布物一式の整合

## 守りたい約束

配布物一式が欠損なく起動可能な形で揃っている(qgb-design.md §3)。

具体的には以下がすべて成立する:

- `index.html` が参照する script/link の対象ファイルが実在する(参照整合)
- 相対 import graph がすべて解決できる(モジュール欠損がない)
- 層分離: `src/core` が `src/ui`・`document`・`window`・`localStorage` を参照しない(依存方向は `ui → core` の一方向のみ。design.md §3)

## acceptance criteria (test-design.md 参照)

test-design.md にはビルド工程・配布物整合を対象にした専用の node:test ファイルは存在しない(NF-01: ビルド工程なし、npm 依存ゼロの方針のため、配布物検証は node:test ではなく独立の静的検査スクリプトで行う)。本 REQ の acceptance criteria は S4-artifact ゲートの検査 3 点に対応する:

1. `index.html` の script/link 参照の存在検査
2. 相対 import graph の解決検査
3. 層分離検査(`src/core` が `src/ui`・`document`・`window`・`localStorage` を参照しないこと)

いずれも `tools/check-artifacts.mjs`(qgb-design.md §4)の exit code 0 で判定する。

## 関連する段階と理由

| 段階 | 理由 |
|---|---|
| S1-static | 対象となる `.js`/`.mjs` ファイル(`tools/check-artifacts.mjs` 自身を含む)が構文検査に合格しなければ後続の検証が実行不能なため前提として必須 |
| S4-artifact | 「配布物として欠損なく起動可能である」という約束は、参照整合・import 解決・層分離という静的検査でのみ検証可能であり、これが本 REQ の中核的な検証段階 |

S2-unit(単体テスト)・S3-solvability(可解性証跡)は本 REQ の対象外(それぞれ REQ-CORE-001・REQ-SOLV-001 の責務。単一責任、qgb philosophy P9)。

## 限定(P5)

ALLOW は「S1-static・S4-artifact の機械検査に通過した」ことのみを意味する。実際にブラウザで開いて操作感を確認した結果ではない。目視での起動確認はユーザーが別途実施する。
