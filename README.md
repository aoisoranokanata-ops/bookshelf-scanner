# 蔵書スキャナ

自宅の蔵書を iPhone のカメラで ISBN バーコードから連続登録し、
最終的に Word（.docx）の蔵書目録として書き出すための静的 Web アプリ。
外部サーバーは持たず、GitHub Pages で配信する。

仕様の詳細は [`SPEC.md`](SPEC.md) を参照。

## 現在の状態

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | カメラとバーコード読取 | 実装済み（実機確認待ち） |
| 2 | 書誌取得（openBD → Google Books） | 未着手 |
| 3 | IndexedDB と一覧画面 | 未着手 |
| 4 | Word 出力 | 未着手 |
| 5 | 共有と PWA 化 | 未着手 |

## 依存ライブラリ（バージョン固定）

| ライブラリ | バージョン | 用途 | 読み込み元 |
|---|---|---|---|
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) | **3.1.4** | バーコード（EAN-13）読取 | `https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/es/reader/index.js`<br>wasm 本体: `https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/reader/zxing_reader.wasm`（約 930KB、初回のみ取得） |

フェーズ 4 で `docx` を追加予定。

### zxing-wasm 3.x の API メモ

v2 系から名前が変わっているので注意。

- 読取関数は `readBarcodes(input, readerOptions)`。`input` に `ImageData` をそのまま渡せる。
- wasm の取得先は `prepareZXingModule({ overrides: { locateFile }, fireImmediately: true })` で指定する。
  指定しない場合は `fastly.jsdelivr.net` の同バージョンを自動で取りに行く。
- フォーマット名は **`"EAN13"`**（ハイフンなし）。`ReadResult.format` 側は表示用ラベル `"EAN-13"` になる。
- `ReadResult` の主なフィールド: `text` / `format` / `symbology` / `isValid` / `error` / `position` / `orientation`。

## フェーズ1 の実装内容

- リアカメラ（`facingMode: environment`）のライブプレビューを表示し、連続でデコードし続ける
- 画面の白い枠の内側だけを切り出してデコードする（見えている範囲＝読取対象）
- `978` / `979` で始まる EAN-13 のみ採用。日本の書籍の2段バーコードの下段（`192...` の分類・価格コード）は捨てる
- EAN-13 のチェックディジットを検証してから採用
- 読取成功でビープ＋バイブ（対応端末のみ）＋画面上部にトースト
- 同じ ISBN は 2.5 秒クールダウンして二重読取を防ぐ
- このセッションで既読の ISBN は「読取済み」と表示してスキップ（フェーズ3で IndexedDB 判定に差し替え）
- 「情報」ボタンで解像度・fps・最後にデコードした生の文字列を表示（実機での切り分け用）

### iOS 対応として入れてあること

- `<video playsinline muted autoplay>`
- カメラ起動はボタンのタップ起点のみ
- `visibilitychange` / `pagehide` で `track.stop()` してカメラを解放
- `screen.wakeLock` を試行（未対応なら無視）
- カメラ権限拒否やネットワークエラーは画面下部の赤い帯に理由を表示する

## 動かし方

`getUserMedia` は HTTPS（または `localhost`）でしか動かないため、
`file://` で開いてもカメラは起動しない。

- 本番: GitHub Pages にこのリポジトリを公開し、iPhone の Safari で開く
- 手元確認: 任意の静的サーバで `localhost` 配信する

```bash
python -m http.server 8000
```

## スコープ外

Amazon 連携 / 価格取得 / Google Drive API 直接アップロード / 複数端末同期 / ログイン。
