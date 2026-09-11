# 蔵書スキャナ

自宅の蔵書を iPhone のカメラで ISBN バーコードから連続登録し、
最終的に Word（.docx）の蔵書目録として書き出すための静的 Web アプリ。
外部サーバーは持たず、GitHub Pages で配信する。

仕様の詳細は [`SPEC.md`](SPEC.md) を参照。

## 現在の状態

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | カメラとバーコード読取 | 完了（実機確認済み） |
| 2 | 書誌取得（openBD → Google Books） | 実装済み（実機確認待ち） |
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

## 書誌 API について（実地で確認した結果）

いずれも API キー不要・CORS 許可済み。`Origin` 付きのリクエストに対して
`access-control-allow-origin: *` が返ることを確認済み。

### openBD — `https://api.openbd.jp/v1/get?isbn=<ISBN13>`

未収録の場合は `[null]` が返る。現在のデータは NDL 由来のレコードが主体で、次の癖がある。
アプリ側で正規化している。

| 返ってくる形 | 正規化後 |
|---|---|
| `"夏目, 漱石, 1867-1916"` | `夏目漱石`（生没年を落とし、和名は姓名を繋ぐ。欧文は並べ替えず `Cherny, Boris` のまま） |
| `"本題 = Parallel title : サブタイトル"` | 本題とサブタイトルに分割（`" : "` を区切りとする） |
| `"200306"` | `2003-06` |
| `summary.cover` が空 | 書影なし（現状ほぼ全件が空） |

### Google Books — `https://www.googleapis.com/books/v1/volumes?q=isbn:<ISBN13>`

**注意: APIキー無しのリクエストは全利用者で1日のクォータを共有しており、
枯渇していると常に HTTP 429 を返す。**

```
"message": "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'
            of service 'books.googleapis.com' for consumer 'project_number:624717413613'"
```

開発時点では終日 429 だった。時間帯や回線で復活するので、アプリ側は 429 を
「見つからなかった」ではなく「取得失敗」として扱い、あとから「未取得を再取得」で
やり直せるようにしてある。恒久的に必要なら API キーを取るしかないが、
キーを静的ページに置くと誰でも使えてしまうので今は入れていない。

書影 URL は `http://` で返ることがあるため `https://` に書き換え、`&edge=curl`
（ページがめくれた装飾）を外して使う。

### 採用しなかったもの

- **国立国会図書館サーチ API** — CORS は通るが、データ源が openBD と同じ NDL なので
  フォールバックとして機能しない（openBD で見つからない本は NDL でも見つからない）
- **Amazon PA-API** — 署名鍵が必要でブラウザに置けない。CORS も通らない

## フェーズ1 の実装内容

- リアカメラ（`facingMode: environment`）のライブプレビューを表示し、連続でデコードし続ける
- 画面の白い枠の内側だけを切り出してデコードする（見えている範囲＝読取対象）
- `978` / `979` で始まる EAN-13 のみ採用。日本の書籍の2段バーコードの下段（`192...` の分類・価格コード）は捨てる
- EAN-13 のチェックディジットを検証してから採用
- 読取成功でビープ＋バイブ（対応端末のみ）＋画面上部にトースト
- 同じ ISBN は 2.5 秒クールダウンして二重読取を防ぐ
- このセッションで既読の ISBN は「読取済み」と表示してスキップ（フェーズ3で IndexedDB 判定に差し替え）
- 「情報」ボタンで解像度・fps・最後にデコードした生の文字列を表示（実機での切り分け用）

## フェーズ2 の実装内容

- 読取と同時にレコードを作り、書誌取得は**1件ずつのキューで裏に流す**。スキャンは止まらない
- openBD → 見つからなければ Google Books の順。どちらも見つからなければ
  「書誌が見つかりません（手入力が必要）」として ISBN だけ保持する
- **「見つからなかった」と「通信に失敗した」を区別する**。
  429 / タイムアウト / オフラインは「取得失敗」で、エラー内容を行に表示し再取得できる
- トーストは読取直後は ISBN ＋「照会中…」、取得できたら書名に差し替わる
  （その間に別の本を読むと、そちらのトーストが優先される）
- 一覧は 書影 / 書名・サブタイトル / 著者・出版社・出版年 / ISBN ・取得元バッジ
- 「未取得を再取得」で、失敗・未発見のものだけまとめて再試行
- fetch は 9 秒でタイムアウト。API に連打しないようキューの間に 200ms 空ける

まだ保存はしていないので、リロードすると消える（IndexedDB はフェーズ3）。

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
