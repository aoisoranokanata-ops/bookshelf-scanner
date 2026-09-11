// =============================================================
// 蔵書スキャナ Service Worker
//
//   方針
//     - アプリ本体(index.html)は「ネットワーク優先・失敗したらキャッシュ」。
//       キャッシュ優先にすると更新が端末に届かなくなるため。
//     - CDN の資産はバージョン固定 URL なので中身が変わらない。
//       こちらは「キャッシュ優先」で構わない（オフラインでも読取エンジンが動く）。
//     - 書誌 API は一切キャッシュしない。古い応答を返すと登録内容が狂う。
//     - 新しい版を見つけても勝手に切り替えず、画面から「更新」を押されたら
//       skipWaiting する。スキャン中に突然リロードされるのを防ぐため。
// =============================================================

const VERSION    = "v5.0.0";
const SHELL_CACHE = "bookshelf-shell-" + VERSION;
const CDN_CACHE   = "bookshelf-cdn-v1";     // URL にバージョンが入るので使い回せる

// アプリ本体一式
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon-180.png",
];

// キャッシュしてよい CDN（バージョン固定の URL しか読まない）
const CDN_HOSTS = ["cdn.jsdelivr.net"];

// 絶対にキャッシュしない相手（書誌 API と書影）
const NEVER_CACHE_HOSTS = ["api.openbd.jp", "www.googleapis.com", "books.google.com"];

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 1つでも失敗すると addAll 全体が落ちるので個別に入れる
    await Promise.all(SHELL_FILES.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: "reload" }));
      } catch (e) {
        console.warn("[sw] precache 失敗", url, e);
      }
    }));
  })());
  // ここでは skipWaiting しない。ページから指示が来るまで待つ。
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    const keep = [SHELL_CACHE, CDN_CACHE];
    const names = await caches.keys();
    await Promise.all(names.map((n) => (keep.includes(n) ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (ev) => {
  if (ev.data && ev.data.type === "SKIP_WAITING") self.skipWaiting();
  if (ev.data && ev.data.type === "GET_VERSION") {
    ev.source && ev.source.postMessage({ type: "VERSION", version: VERSION });
  }
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // 書誌 API・書影は素通し
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return;

  // CDN: キャッシュ優先
  if (CDN_HOSTS.includes(url.hostname)) {
    ev.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // 自分のオリジン
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html")) {
      ev.respondWith(networkFirst(req, SHELL_CACHE));
    } else {
      ev.respondWith(cacheFirst(req, SHELL_CACHE, true));
    }
  }
});

/** キャッシュにあれば返す。無ければ取りに行って入れる */
async function cacheFirst(req, cacheName, revalidate) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) {
    // アイコンなど自オリジンの資産は裏で更新しておく
    if (revalidate) {
      fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
    }
    return hit;
  }
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) {
    try { await cache.put(req, res.clone()); } catch (_) {}
  }
  return res;
}

/** まずネットワーク。落ちたらキャッシュ（オフライン時の起動用） */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) { try { await cache.put(req, res.clone()); } catch (_) {} }
    return res;
  } catch (e) {
    const hit = (await cache.match(req)) || (await cache.match("./index.html")) || (await cache.match("./"));
    if (hit) return hit;
    throw e;
  }
}
