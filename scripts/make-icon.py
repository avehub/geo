#!/usr/bin/env python3
"""生成 `brand/icon-source.png`（1024×1024，透明背景圆角方块）。

只用标准库（zlib + struct）手写 PNG，避免为了一个图标引入 Pillow。
改完样式重跑：`python3 scripts/make-icon.py`，然后用
`pnpm --dir apps/desktop/ui run tauri icon ../../brand/icon-source.png`
重新生成 `apps/desktop/src-tauri/icons/` 下的各尺寸产物。

图形语义：雷达扫描弧（GEO = 在生成式引擎里被"看见"）+ 三根上升柱（可见度提升），
不含任何绝对化用语或排名承诺（AGENTS.md 规则 6）。
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 1024
RADIUS = 190  # 圆角半径
OUTPUT = Path(__file__).resolve().parent.parent / "brand" / "icon-source.png"

# 背景渐变（上→下）与前景色
TOP = (22, 104, 220)
BOTTOM = (11, 47, 110)
FOREGROUND = (255, 255, 255)
ACCENT = (105, 220, 190)


def background_gradient(y: int) -> tuple[int, int, int]:
    ratio = y / (SIZE - 1)
    return tuple(round(top + (bottom - top) * ratio) for top, bottom in zip(TOP, BOTTOM))  # type: ignore[return-value]


def inside_rounded_square(x: int, y: int) -> bool:
    margin = 8
    left, right = margin, SIZE - 1 - margin
    top, bottom = margin, SIZE - 1 - margin
    if not (left <= x <= right and top <= y <= bottom):
        return False
    for corner_x, corner_y in (
        (left + RADIUS, top + RADIUS),
        (right - RADIUS, top + RADIUS),
        (left + RADIUS, bottom - RADIUS),
        (right - RADIUS, bottom - RADIUS),
    ):
        outside_x = x < corner_x if corner_x < SIZE // 2 else x > corner_x
        outside_y = y < corner_y if corner_y < SIZE // 2 else y > corner_y
        if outside_x and outside_y:
            return (x - corner_x) ** 2 + (y - corner_y) ** 2 <= RADIUS**2
    return True


def in_ring(x: int, y: int, cx: float, cy: float, radius: float, thickness: float) -> bool:
    distance = math.hypot(x - cx, y - cy)
    return abs(distance - radius) <= thickness / 2


def in_arc(x: int, y: int, cx: float, cy: float, radius: float, thickness: float) -> bool:
    """只画右上 100° 的弧，形成雷达扫描的缺口。"""
    if not in_ring(x, y, cx, cy, radius, thickness):
        return False
    angle = math.degrees(math.atan2(cy - y, x - cx)) % 360
    return 350 >= angle >= 250 or angle <= 80


def in_bar(x: int, y: int, index: int, bars: list[tuple[int, int, int, int]]) -> bool:
    left, top, width, bottom = bars[index]
    return left <= x < left + width and top <= y <= bottom


def build_rows() -> list[bytes]:
    cx, cy = SIZE * 0.5, SIZE * 0.44
    # 三根上升柱（可见度提升），底部对齐
    baseline = int(SIZE * 0.80)
    bar_width = 92
    gap = 46
    heights = [150, 232, 318]
    total = len(heights) * bar_width + (len(heights) - 1) * gap
    start_x = int((SIZE - total) / 2)
    bars = [
        (start_x + i * (bar_width + gap), baseline - height, bar_width, baseline)
        for i, height in enumerate(heights)
    ]

    rows: list[bytes] = []
    for y in range(SIZE):
        row = bytearray([0])  # PNG filter type 0
        base = background_gradient(y)
        for x in range(SIZE):
            if not inside_rounded_square(x, y):
                row += bytes((0, 0, 0, 0))
                continue
            red, green, blue = base
            alpha = 255
            # 雷达弧：由内到外三条，最外圈用点缀色
            rings = ((150, 26, FOREGROUND), (232, 24, FOREGROUND), (314, 22, ACCENT))
            for radius, thickness, color in rings:
                if in_arc(x, y, cx, cy, radius, thickness):
                    red, green, blue = color
                    break
            else:
                # 中心圆点
                if math.hypot(x - cx, y - cy) <= 34:
                    red, green, blue = ACCENT
                else:
                    for index in range(len(bars)):
                        if in_bar(x, y, index, bars):
                            # 柱子留一点内边距，避免和弧糊在一起
                            red, green, blue = (255, 255, 255) if index < 2 else ACCENT
                            alpha = 235
                            break
            row += bytes((red, green, blue, alpha))
        rows.append(bytes(row))
    return rows


def write_png(path: Path, rows: list[bytes]) -> None:
    raw = b"".join(rows)

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8bit RGBA
    data = chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + data)


def main() -> None:
    write_png(OUTPUT, build_rows())
    size_kb = OUTPUT.stat().st_size / 1024
    print(f"已生成 {OUTPUT}（{SIZE}×{SIZE}，{size_kb:.0f} KB）")


if __name__ == "__main__":
    main()
