# AGENTS.md

このリポジトリで作業するすべてのエージェント(Claude Code に限らない)向けの共通運用要点。
Claude Code 固有の差分は [CLAUDE.md](CLAUDE.md) を参照。

## プロジェクト概要

`qgb_soukoban` は、夜の倉庫を舞台にした絵文字グリッドグラフィックの倉庫番(ソコバン)ゲーム。vanilla HTML/CSS/JS(ビルド工程なし・npm 依存ゼロ)で実装し、ブラウザの ESM のみで動く。収録 10 ステージ(逆押し生成器の候補群から難易度カーブ・多様性制約を満たすものを機械選抜)に加え、いつでも新しい面を作れるランダムモード(easy/normal/hard、各 50 件の検証済みシードプール)を持つ。品質保証は qgb (quality-gate-builder) の機械ゲートで担保し、見た目・操作感の確認はユーザーのテストプレイに委ねる(理念駆動開発: 機械化できる部分は指標化し、機械化できない最終判定はユーザーに残す)。

## docs/ 文書マップ

| 文書 | 版 | 役割 |
|---|---|---|
| [docs/design.md](docs/design.md) | v0.4.2 | 要件(F-01〜F-09・NF-01〜04)・アーキテクチャ・モジュール構成・品質保証方針の正本。他の設計文書はここから参照される |
| [docs/test-design.md](docs/test-design.md) | v0.3.5 | テスト方針。テストファイル構成とケース ID(B/G/S/N/T/Q/R/RK/SV 系)の一覧。qgb の S2-unit 段階はここに載る全ケースを機械検査対象とする |
| [docs/qgb-design.md](docs/qgb-design.md) | v0.3.2 | qgb 品質ゲートの契約設計。段階設計(S1〜S4)・REQ 構成・contract の command 仕様・timeout_seconds の現行値と変更履歴 |
| [docs/ui-design.md](docs/ui-design.md) | 最終更新日方式(下記参照) | 「夜の倉庫 × 絵文字」の世界観・配色・画面レイアウト・演出の視覚設計。design.md §8 の視覚方針を実装粒度まで具体化。機能仕様は design.md が正、本書は見た目のみ |
| [docs/difficulty-theory.md](docs/difficulty-theory.md) | v0.3.2 | 難易度スコアリングの理論検討ノート。採用された結論のみが design.md に反映される。状態ラベル(【仮説】【承認済み】【実装済み】【校正済み】【見送り】)で各項目の現状を示す |

## 環境の癖

- **テスト実行**: `node --test`(引数なし)。この環境では `node --test tests/` のようなディレクトリ指定は `ERR_MODULE_NOT_FOUND` になるため使わない。組込の自動検出(`tests/**/*.test.mjs`)に任せる。
- **qgb の実行**: `.venv\Scripts\python.exe -m qgb <command>`(例: `.venv\Scripts\python.exe -m qgb run REQ-CORE-001 --yes`)。venv の python を直接指定すること。

## 品質ゲート運用(qgb)

- **REQ は 4 件**: REQ-CORE-001(標準ルール)/ REQ-SAVE-001(保存記録の整合性・初期化操作の選択性)/ REQ-SOLV-001(収録・生成ステージの可解性)/ REQ-DIST-001(配布物整合)。詳細は [docs/qgb-design.md](docs/qgb-design.md) §3、REQ 本文は `.quality-system/req/*.md`。
- **フロー**: `qgb check <REQ>` でリハーサル(揮発出力、curated evidence は不変)→ 問題なければ `qgb run <REQ> --yes` で本実行し gate.json を生成。
- **証跡の履歴固定**: `evidence/<REQ>/latest/` は run のたびに上書きされる揮発領域。過去の判定履歴は git commit で固定する(マイルストーンごとに commit/push)。`artifacts/` は `.gitignore` 対象で完全に揮発。
- **所要感**: S2-unit(単体テスト)がおおむね 6 分・S3-solvability(可解性証跡)がおおむね 4 分程度の実行時間感覚(実測はプリセット引き上げ時点で S2≈87 秒・S3≈218 秒だったが、以後のワークロード増大を踏まえた体感目安として記録。実測値と contract の timeout_seconds は [docs/qgb-design.md](docs/qgb-design.md) §4 表が正)。
- **DENY 時の対応**: DENY は失敗ではなく揺らぎの受け止めとして扱う。`gate.json` → 対応する stage log(S3 なら `tools/verify-stages.mjs` の出力等)の順に辿って原因を特定し、修正 → 再 `check` → 再 `run` のループで収束させる。
- **LLM レビューは advisory**: Codex 等のレビュー指摘は qgb の ALLOW 根拠にしない。反映は通常の TDD サイクル(テスト追加 → 修正)で行い、結果は機械検査に反映される。

## 生成データの再生成

以下は生成ツールの出力であり、**手で編集しない**:

| 生成物 | 再生成コマンド | 内容 |
|---|---|---|
| `src/core/stages.js` | `node tools/curate-stages.mjs` | 収録 10 ステージ。生成器の候補群から難易度カーブ・多様性制約(構造署名一意性・policy 分散・upperFeelSignature)を満たすものを選抜し焼き込む |
| `src/core/seedpools.js` | `node tools/build-seed-pools.mjs` | ランダムモードの難易度別(easy/normal/hard)検証済みシードプール(各 50 件) |

再生成後は必ず対応するテスト(`stages.test.mjs` / `quality.test.mjs` 等)と S3-solvability を通し直すこと。

## 開発体制の要点

- **実装**: Codex(gpt-5.6-terra 定例)。
- **作文**(docs・REQ 本文・knowledge): Sonnet が執筆 → Codex がレビュー。
- **実装のレビュー**: Codex による敵対的レビュー(実装とは別セッション)+ Sonnet による異観点レビュー(仕様適合・テスト妥当性・層分離/API 契約)のダブルレビュー。Major/Critical が残る限り収束するまで回す。
- **knowledge.jsonl は必ず `qgb add-knowledge` 経由で追記する**。直接編集・空行混入は禁止(append-only・schema 検証・all-or-nothing の追記を保証するのはこのコマンドのみ)。

## 判断履歴の一次資料

過去の設計判断・テストプレイフィードバック対応の経緯を確認する際は、要約された docs だけでなく以下の一次資料を確認すること:

- `.quality-system/knowledge/knowledge.jsonl` — 設計分岐・ユーザー判断の記録(append-only)
- [docs/difficulty-theory.md](docs/difficulty-theory.md) — 難易度指標の検討過程・採否の根拠・不成立と判明した仮説の記録
