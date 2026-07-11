# REQ-DIST-001 採用判定サマリ

## 判定結果

**ALLOW**

> Defined checks passed. This is not proof of total correctness.

## 実行情報

| 項目 | 値 |
|---|---|
| REQ ID | REQ-DIST-001 |
| Phase | verify |
| 実行日時 (UTC) | 2026-07-11T081547Z |
| 実行日時 (RFC3339) | 2026-07-11T08:15:47Z |
| run_id | `r0001` |
| Runner | qgb 0.1.5 |
| run_dir | `.quality-system/artifacts/REQ-DIST-001/runs/2026-07-11T081547Z-r0001` |
| curated_latest_dir | `.quality-system/evidence/REQ-DIST-001/latest` |

## 段階別結果

| 段階 | 名前 | 結果 | verification_type |
|---|---|---|---|
| S1-static | 静的成立 | passed | command |
| S4-artifact | 配布物整合 | passed | command |

すべての必須段階が通過したため、status=ALLOW。

## 採用根拠 (basis)

- REQ-DIST-001
- POLICY-default
- CONTRACT-REQ-DIST-001-S1-static
- CONTRACT-REQ-DIST-001-S4-artifact

## 注意 (思想 P5, P11)

- 本判定は「定義済み検査に通過した」ことのみを意味する。完全な正しさ・業務妥当性・将来の保証は意味しない
- 本判定は当該プロジェクト内の policy と contract に対する局所判定であり、他プロジェクトとの品質水準比較には使えない
