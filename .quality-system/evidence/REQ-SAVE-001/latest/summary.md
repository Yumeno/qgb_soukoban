# REQ-SAVE-001 採用判定サマリ

## 判定結果

**ALLOW**

> Defined checks passed. This is not proof of total correctness.

## 実行情報

| 項目 | 値 |
|---|---|
| REQ ID | REQ-SAVE-001 |
| Phase | verify |
| 実行日時 (UTC) | 2026-07-12T125521Z |
| 実行日時 (RFC3339) | 2026-07-12T12:55:21Z |
| run_id | `r0001` |
| Runner | qgb 0.1.5 |
| run_dir | `.quality-system/artifacts/REQ-SAVE-001/runs/2026-07-12T125521Z-r0001` |
| curated_latest_dir | `.quality-system/evidence/REQ-SAVE-001/latest` |

## 段階別結果

| 段階 | 名前 | 結果 | verification_type |
|---|---|---|---|
| S1-static | 静的成立 | passed | command |
| S2-unit | 単体テスト | passed | command |

すべての必須段階が通過したため、status=ALLOW。

## 採用根拠 (basis)

- REQ-SAVE-001
- POLICY-default
- CONTRACT-REQ-SAVE-001-S1-static
- CONTRACT-REQ-SAVE-001-S2-unit

## 注意 (思想 P5, P11)

- 本判定は「定義済み検査に通過した」ことのみを意味する。完全な正しさ・業務妥当性・将来の保証は意味しない
- 本判定は当該プロジェクト内の policy と contract に対する局所判定であり、他プロジェクトとの品質水準比較には使えない
