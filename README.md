# 蔵書スキャナ

自宅の蔵書を iPhone のカメラで ISBN バーコードから連続登録し、
最終的に Word（.docx）の蔵書目録として書き出すための静的 Web アプリ。
外部サーバーは持たず、GitHub Pages で配信する。

仕様の詳細は [`SPEC.md`](SPEC.md) を参照。

## 現在の状態

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | カメラとバーコード読取 | 完了（実機確認済み） |
| 2 | 書誌取得（openBD → Google Books） | 完了（実機確認済み） |
| 3 | IndexedDB と一覧画面・手入力・JSON 入出力 | 完了（実機確認済み） |
| 4 | Word 出力 | 実装済み（実機確認待ち） |
| 5 | 共有と PWA 化 | 未着手 |

## 依存ライブラリ（バージョン固定）

| ライブラリ | バージョン | 用途 | 読み込み元 |
|---|---|---|---|
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) | **3.1.4** | バーコード（EAN-13）読取 | `https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/es/reader/index.js`<br>wasm 本体: `https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/reader/zxing_reader.wasm`（約 930KB、初回のみ取得） |
| [docx](https://github.com/dolanmiu/docx) | **9.7.1** | Word (.docx) 生成 | `https://cdn.jsdelivr.net/npm/docx@9.7.1/dist/index.mjs`（約 1.0MB、Word 出力を押したときだけ読み込む） |

### docx を UMD ではなく ESM で読む理由

仕様では UMD を想定していたが、jsDelivr は `dist/index.umd.cjs` を
`Content-Type: application/node` ＋ `X-Content-Type-Options: nosniff` で返すため、
`<script src>` ではブラウザが実行を拒否する。
ESM 版 `dist/index.mjs` は `application/javascript` で返り、外部への bare import も
持たないのでそのまま `import()` できる。

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

## フェーズ3 の実装内容

### 保存

IndexedDB（DB名 `bookshelf` / store `books` / keyPath `isbn13`）。
起動時に全件をメモリへ読み込み、以後は書き込みのたびに両方を更新する。
家庭の蔵書規模なら全件メモリで十分なので、検索・並べ替えはメモリ上で行う。

**読み取った時点で ISBN だけの行をまず保存する。** 書誌取得はそのあと。
そうしておけば通信に失敗しても読んだ事実は残る。

保存されるのは仕様 2. のデータモデルそのままの12項目だけ。
実行時の状態（照会中・エラー内容など）は `_` 始まりの別フィールドで持ち、保存しない。

### 一覧

- 書影 / 書名・サブタイトル / 著者・出版社・出版年 / ISBN・取得元・配置場所
- 絞り込み検索：書名・サブタイトル・著者・出版社・ISBN・配置場所・タグ・メモ を対象。
  空白区切りは AND 条件。大文字小文字は無視
- 並べ替え：登録日（新しい順）／書名／著者／出版社（`localeCompare(..., "ja")`）
- 行をタップで編集。配置場所・タグ・メモもここで入れる
- 蔵書ビューを開いている間はデコードを止める（気付かないうちに登録されるのを防ぐ）

### 手入力（仕様 3-2）

フェーズ割り当ての指定が無かったが、保存の仕組みが無いと成立しないためここに入れた。

- ISBN を手で打って「照会」で書誌を引ける（既に入っている欄は上書きしない）
- **ISBN が無い本も登録できる。** バーコードの無い古書・非売品用に
  `NOISBN-<日時>-<乱数>` という内部キーを振り、一覧では「ISBNなし」と表示する
  （keyPath が `isbn13` なので主キーは必ず要る、という都合による）
- 不正な ISBN（チェックディジット違い）と登録済み ISBN は保存前に弾く

### 重複判定

登録済みの ISBN を読むと「登録済み（配置場所）— 上書きしません」と出してスキップする。
配置場所を出すのは、重複購入チェックのときに「どこに挿したか」がすぐ分かるようにするため。

### JSON エクスポート / インポート

iOS の ITP で IndexedDB が消えうるため必須（仕様 4-6）。

- 書き出し：`bookshelf-YYYYMMDD-HHmm.json`。`{app, format, exportedAt, count, books[]}`
- 読み込みは3モードから選ぶ
  - 重複はそのまま・新規だけ追加
  - 重複はファイルの内容で上書き
  - 現在の蔵書を全部消して置き換え（もう一度確認を挟む）
- 壊れた JSON・`books` 配列が無いファイルは読み込まず、現在のデータに触れない
- 蔵書画面に最終バックアップ日と「その後 N 冊増えています」を表示。
  10冊以上増えた／14日以上経った場合は色を変えて促す
- 初回起動時に「ホーム画面に追加して使ってください」の案内を一度だけ出す
  （ホーム画面から開いている場合は出さない）

## フェーズ4 の実装内容

### Word 目録

- A4 縦・左右15mm/上下18mm 余白（本文幅 180mm）
- 1ページ目に「蔵書目録」見出し、出力日時、総冊数
- 表：`No. / 書名 / 著者 / 出版社 / 出版年 / ISBN / 配置場所`（幅 10/52/32/26/16/26/18 mm）
- ヘッダ行は `tableHeader: true`。ページをまたいでも繰り返される
- 書名セルはサブタイトルを2行目に小さく添える。並列書名は出さない
- ISBN の無い本は `—` と表示
- フッタ中央にページ番号（`PAGE` フィールド）
- 並び順は蔵書画面で選んでいる順をそのまま使う
- 出力前に、絞り込み中なら「絞り込み結果だけ / 全件 / やめる」を選ばせる
- 本文フォントは `Yu Gothic`。文字列で指定するだけで `w:eastAsia` まで入るため
  日本語も同じ書体で出る（別の書体にしたい場合は `DOC_FONT` を変える）

### 並列書名を別項目へ（`altTitle`）

openBD のタイトルには `本題 = Parallel title : サブタイトル` の形で
並列書名（欧文タイトルなど）が混ざる。目録では邪魔なので `altTitle` に分ける。

ただし `ぎゃるアシ = Gal Assistant. 3` のように**巻数が並列書名の末尾に付く**本があるため、
末尾の数字だけは本題側へ戻す。

| 元のタイトル | title | altTitle | subtitle |
|---|---|---|---|
| `ハイパーインフレーション = Hyper inflation 05` | ハイパーインフレーション **05** | Hyper inflation | |
| `プロを目指す人のためのTypeScript入門 = Introduction to TypeScript for future professionals : 安全なコードの書き方から高度な型の使い方まで` | プロを目指す人のためのTypeScript入門 | Introduction to TypeScript for future professionals | 安全なコードの書き方から高度な型の使い方まで |

既存データは起動時に一度だけ自動で分割し、その旨を画面に出す。
判定を誤った本は蔵書一覧から直せる。

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
