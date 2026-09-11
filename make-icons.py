#!/usr/bin/env python3
"""icons/ の PNG を生成する。

図案は「背表紙が3冊並び、その手前をバーコードの走査線が横切る」。
Pillow があれば動く:  python make-icons.py
"""

from PIL import Image, ImageDraw

BG    = (15, 17, 21)
PAPER = (232, 236, 242)
SPINE = [(93, 160, 255), (232, 236, 242), (255, 192, 66)]
SCAN  = (61, 220, 132)


def render(size, pad_ratio):
    S = size * 4                      # 4倍で描いて縮小（アンチエイリアス代わり）
    img = Image.new("RGBA", (S, S), BG)
    d = ImageDraw.Draw(img)

    pad = int(S * pad_ratio)          # マスカブル用の安全余白
    box = S - pad * 2

    # --- 背表紙3冊 ---
    gap = int(box * 0.045)
    n = 3
    bw = (box - gap * (n - 1)) // n
    top = pad + int(box * 0.14)
    bottom = pad + int(box * 0.86)
    for i in range(n):
        x0 = pad + i * (bw + gap)
        # 真ん中の本だけ少し背を高くして単調さを消す
        t = top - (int(box * 0.06) if i == 1 else 0)
        d.rounded_rectangle([x0, t, x0 + bw, bottom],
                            radius=int(bw * 0.18), fill=SPINE[i])
        # 背表紙の飾り罫
        ly = t + int((bottom - t) * 0.16)
        d.rectangle([x0 + int(bw * 0.22), ly,
                     x0 + bw - int(bw * 0.22), ly + max(2, int(S * 0.008))], fill=BG)

    # --- バーコードの走査線 ---
    y = pad + int(box * 0.60)
    h = max(3, int(S * 0.018))
    d.rounded_rectangle([pad - int(box * 0.02), y, pad + box + int(box * 0.02), y + h],
                        radius=h // 2, fill=SCAN)

    # --- 手前のバーコード ---
    bars = [3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1]
    bx = pad + int(box * 0.16)
    by = pad + int(box * 0.66)
    bh = int(box * 0.17)
    unit = (box * 0.68) / sum(bars) / 2
    d.rounded_rectangle([bx - int(unit * 3), by - int(unit * 3),
                         bx + int(box * 0.68) + int(unit * 3), by + bh + int(unit * 3)],
                        radius=int(unit * 3), fill=PAPER)
    cx = bx
    for i, w in enumerate(bars):
        if i % 2 == 0:
            d.rectangle([cx, by, cx + w * unit * 2, by + bh], fill=BG)
        cx += w * unit * 2

    return img.resize((size, size), Image.LANCZOS).convert("RGB")


if __name__ == "__main__":
    for size, pad, name in [
        (180, 0.10, "icons/apple-touch-icon-180.png"),
        (192, 0.10, "icons/icon-192.png"),
        (512, 0.10, "icons/icon-512.png"),
        (512, 0.20, "icons/icon-512-maskable.png"),   # マスカブルは安全余白を多めに
    ]:
        render(size, pad).save(name, optimize=True)
        print(name)
