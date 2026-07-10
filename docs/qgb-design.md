# qgb 品質ゲート設計書 (qgb_soukoban)

- 版: v0.2 (Codex セカンドオピニオン反映済み 2026-07-11)
- 関連: [design.md](design.md) / [test-design.md](test-design.md)
- 準拠: qgb スキル v0.1.5 / 段階設計パターン B (proposal/adopt 経路)

## 1. 設計方針: TDD と qgb の役割分担

TDD(node:test)は**開発中の即時フィードバック**、qgb は**採用判定の機械証跡化**を担う。同じテストを両方が実行するが、目的が違う:

- 開発中: `node --test tests/` を随時回す(Red→Green→Refactor)
- 採用判定: `qgb run --yes` が同じ検査を**契約として**実行し、gate.json + stage log という再現可能な証跡を残す(P7)

ALLOW の意味は「定義済みの機械検査に通過した」だけであり、面白さ・見た目の良さ・出荷可否を意味しない(P5)。見た目・操作感の確認は人間の目視で行い、**qgb の判定根拠には入れない**(P6)。

## 2. 段階設計案 (policy.json#stages)

4 段階の線形 + 分岐 DAG:

```
S1-static ──→ S2-unit ──→ S3-solvability
    └────────→ S4-artifact
```

| id | name | responsibility (一文) | verification_type | depends_on |
|---|---|---|---|---|
| S1-static | 静的成立 | 全 JS モジュールが構文検査に合格する | command | [] |
| S2-unit | 単体テスト | node:test の全テストが成功する | command | [S1-static] |
| S3-solvability | 可解性証跡 | 同梱全ステージと固定シード生成ステージの可解性・最短手数整合が独立スクリプトで検証される | command | [S2-unit] |
| S4-artifact | 配布物整合 | 配布物の参照整合と層分離が静的検査で確認できる | command | [S1-static] |

### 設計判断(採らなかった案と理由)

- **S2 と S3 の統合案**: stages.test.mjs にも可解性テストがあるため統合可能だが、不採用。S3 は「プロダクトデータ(ステージ)の可解性」という本プロジェクトの中核保証であり、per-stage の検証結果表を stage log に残す独立証跡としての価値が高い(P7)。テスト失敗の場所を探すのではなく、gate.json → S3 log だけで「どの面が・何手で可解か」を後から監査できる。
- **manual_check 段階(目視確認)の追加案**: 不採用。manual_check を required で含む REQ は run 不能(P6)。見た目確認は qgb の外(ユーザーへの動作確認依頼)で行う。
- **8 段階案(パース/移動/undo/... を段階分割)**: 不採用。テストファイルの分割はテスト設計の関心事であり、段階の単一責任(P9)では「単体テスト成功」で 1 責務。

## 3. REQ 構成

| REQ ID | 守りたい約束 | stages |
|---|---|---|
| REQ-CORE-001 | 倉庫番の標準ルール(移動・押し・undo・勝利・リプレイ)が正しく動く | S1-static, S2-unit |
| REQ-SOLV-001 | 同梱 10 面は全数ソルバー検証でクリア可能であり、生成面は合法 push の逆写像による構成的保証と固定シード代表集合の回帰検査で担保される | S1-static, S2-unit, S3-solvability |
| REQ-DIST-001 | 配布物一式が欠損なく起動可能な形で揃っている | S1-static, S4-artifact |

REQ 本文 (`.md`) には acceptance criteria として test-design.md のケース ID を参照で紐付ける。

注(Codex 指摘): 「全生成面がクリア可能」という全称主張は qgb の機械検査では証明できない。機械検査が示すのは (i) 固定シード代表集合の全数通過、(ii) 構成的保証の実装(pull = 合法 push の逆写像)が代表集合上で forward 解を実際に再生できること、の 2 点であり、REQ 文言・gate.json の解釈もこれに限定する(P5 と同型の限定)。

## 4. contract 設計 (verification_type=command / Node ランタイム規律)

command authoring protocol(スキル §6.5)+ Node checklist(design-stages §5.5)に従う:

| 観点 | 決定 |
|---|---|
| runtime | Node.js v22.16.0(利用者環境で確認済み)。ESM、`.mjs` 拡張子 |
| script encoding | UTF-8 BOM なし、改行 LF |
| argv | `node <script.mjs>` 形式で完全明示(node は PATH 解決。検査スクリプトのパスは OS ネイティブ区切り) |
| exit code | スクリプト側で `process.exit(0/1)` を明示 |
| 文字化け | check 後に stage log の U+FFFD を確認(κ sentinel)。検査スクリプトの出力は ASCII + 英語を基本とし化けの余地を減らす |
| lint | contract 起草直後に同梱 `lint/check-command-contract.py` を実行 |

### 各段階のコマンド(案)

| stage | command (案) | 期待 |
|---|---|---|
| S1-static | `node tools\check-syntax.mjs` (src/ と tools/ の全 .js/.mjs の構文検査。import 解決・実行時 API は対象外) | exit 0 |
| S2-unit | `node --test tests/` | exit 0(全 pass) |
| S3-solvability | `node tools\verify-stages.mjs --all` | exit 0 + per-stage 結果表を stdout(= stage log)に出力 |
| S4-artifact | `node tools\check-artifacts.mjs` — ①index.html の script/link 参照の存在 ②相対 import graph の解決 ③**層分離検査: src/core が src/ui・document・window・localStorage を参照しないこと**(依存方向は ui→core のみ。Codex 指摘) | exit 0 |

timeout_seconds: S3 は余裕を持って 300、他は 120(既定)。

## 5. 証跡・履歴の方針(スキル §6.1 step 9 の設計分岐)

- `evidence/<REQ>/latest/` は run のたびに上書きされる。**過去の判定履歴は git コミットで固定する**(マイルストーンごとに commit/push。ユーザー指示 2026-07-11)。
- `artifacts/` は揮発(.gitignore)。
- この方針は knowledge.jsonl に設計分岐として記録する(§6.6 トリガ 1)。

## 6. 運用フロー(TDD とゲートの回し方)

1. 実装サブエージェントが TDD で機能を完成(`node --test` Green)
2. `qgb check <REQ>` でリハーサル(揮発出力、curated evidence 不変)
3. 問題なければ `qgb run <REQ> --yes` で本実行 → gate.json 生成
4. マイルストーン: evidence を含めて git commit/push
5. DENY が出たら: 修正 → 再 check → 再 run(DENY は失敗ではなく揺らぎの受け止め。gate.json と stage log から原因を辿る)

## 7. LLM レビュー(Codex セカンドオピニオン)の位置づけ

- Codex CLI のレビューは **advisory**。qgb の ALLOW 根拠にしない(P6)。
- レビュー指摘の反映は通常の TDD サイクル(テスト追加 → 修正)で行い、結果は機械検査に反映される。
- レビュー実施の記録が必要な判断(設計分岐の変更等)は knowledge.jsonl に残す。

## 8. project-context 方針

- `project-context.md`(人間正本): 本プロジェクトの目的・対象範囲・採用しない方式(npm 依存、jsdom、CI サービス連携は当面なし等)を記述。
- `project-context.json`(機械正本): スキーマを Read してから起草。`generated_by: "agent-assisted"`、`human_reviewed: false` で起草し、**true 化はユーザー確認後のみ**。
- 段階 proposal の `source_metadata.basis[]` に本書 §2 の設計判断を記録する。
