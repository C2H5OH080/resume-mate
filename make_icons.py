#!/usr/bin/env python3
# 生成插件图标（纯标准库，无 PIL 依赖）：圆角矩形 + 白色文档形状
import zlib, struct, os, math

def lerp(a, b, t):
    return a + (b - a) * t

def in_rounded_rect(x, y, w, h, r):
    # 圆角矩形判定（中心在 0,0，半宽 w/2, 半高 h/2）
    hx, hy = w / 2.0, h / 2.0
    cx, cy = abs(x), abs(y)
    if cx <= hx - r or cy <= hy - r:
        return cx <= hx and cy <= hy
    dx, dy = cx - (hx - r), cy - (hy - r)
    return dx * dx + dy * dy <= r * r

def make_icon(size):
    S = float(size)
    r = S * 0.22          # 圆角半径
    pad = S * 0.16        # 页面相对外框的内缩
    top = (0x4f, 0x46, 0xe5)     # #4f46e5
    bottom = (0x7c, 0x3a, 0xed)  # #7c3aed
    line = (0xc7, 0xd2, 0xfe)    # 文字条
    white = (255, 255, 255)

    # 页面（白色文档）区域
    px, py = pad, pad
    pw, ph = S - 2 * pad, S - 2 * pad
    fold = S * 0.16               # 折角边长
    lw = max(1.0, S * 0.07)       # 文字条高度
    gap = max(1.0, S * 0.075)     # 文字条间距
    x0 = px + S * 0.14
    x1 = px + pw - S * 0.14

    rows = []
    for yi in range(size):
        row = []
        for xi in range(size):
            r_, g_, b_, a_ = 0, 0, 0, 0
            if in_rounded_rect(xi - S/2, yi - S/2, S, S, r):
                # 渐变
                t = yi / max(1.0, S - 1)
                r_, g_, b_ = int(lerp(top[0], bottom[0], t)), int(lerp(top[1], bottom[1], t)), int(lerp(top[2], bottom[2], t))
                a_ = 255
                # 白色文档
                if px <= xi <= px + pw and py <= yi <= py + ph:
                    # 折角（右上角三角形，被挖掉，用浅色填充）
                    fx, fy = px + pw - fold, py
                    if xi >= fx and yi <= fy + fold and (xi - fx) + (yi - fy) <= fold:
                        # 折角三角，用淡紫填充
                        foldcol = (0xa5, 0xb4, 0xfc)
                        r_, g_, b_ = foldcol
                        a_ = 255
                    elif (xi - fx) + (yi - fy) <= fold and xi >= fx and yi >= fy:
                        # 折痕阴影线
                        r_, g_, b_ = (0xdd, 0xe3, 0xff)
                        a_ = 255
                    else:
                        r_, g_, b_ = white
                        a_ = 255
                        # 文字条
                        lh = py + ph * 0.24
                        for k in range(3):
                            yy = lh + k * (lw + gap)
                            if yy <= yi <= yy + lw and x0 <= xi <= x1:
                                r_, g_, b_ = line
                                a_ = 255
                                break
            row.append((r_, g_, b_, a_))
        rows.append(row)
    return rows

def write_png(path, size, rows):
    raw = b""
    for row in rows:
        raw += b"\x00"  # filter type 0
        for (r_, g_, b_, a_) in row:
            raw += struct.pack("BBBB", r_, g_, b_, a_)
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, os.path.getsize(path), "bytes")

icons_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(icons_dir, exist_ok=True)
for s in (16, 48, 128):
    write_png(os.path.join(icons_dir, f"icon{s}.png"), s, make_icon(s))
print("done")
