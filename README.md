# qgb_soukoban

テキストアートグラフィックの倉庫番ゲーム(ブラウザ / vanilla HTML/CSS/JS)。
TDD (node:test) と [qgb (quality-gate-builder)](https://github.com/Yumeno/Quality-gate-builder) の機械品質ゲートで開発する。

## 遊び方

ESM を使うためローカル HTTP サーバ経由で開く:

```powershell
.\serve.ps1
# または
py -3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開く。

| キー | 動作 |
|---|---|
| ↑↓←→ / WASD | 移動 |
| Z / Backspace | undo |
| R | リセット |
| Esc | メニューへ戻る |

## 特徴

- 手作り 10 ステージ(難易度カーブ)+ ランダム生成モード
- **全ステージのクリア可能性を BFS ソルバーで機械検証**(生成面は逆押し生成で構成的にも保証)
- 歩数カウントと最短手数表示、undo、リプレイ記録・再生、クリア記録の保存

## 開発

- 設計文書: [docs/design.md](docs/design.md) / [docs/test-design.md](docs/test-design.md) / [docs/qgb-design.md](docs/qgb-design.md)
- テスト: `node --test tests/`(Node 22+、npm 依存ゼロ)
- 品質ゲート: `.venv\Scripts\python.exe -m qgb run <REQ-ID> --yes`(証跡は `.quality-system/evidence/`)
