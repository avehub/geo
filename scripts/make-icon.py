#!/usr/bin/env python3
"""从品牌源图派生全部桌面图标（Windows ICO / macOS ICNS / Tauri PNG / Store 磁贴）。

源图：`brand/icon-source.jpg`（设计交付原图，2048×2048，四角为白色圆角外区域）
母版：`brand/icon-source.png`（1024×1024，圆角外侧透明）
产物：`apps/desktop/src-tauri/icons/` 下各平台尺寸

两处不能省的细节：

1. **圆角外必须透明**。原图是在白底上画的蓝色圆角方块；直接缩到 32×32 会在
   Windows 任务栏 / 标题栏留下一个白方块。这里按原图检测圆角半径，重建 alpha，
   并把圆角外侧整片置为透明（内缩 1px 顺带抹掉 JPEG 边缘白晕）。
2. **ICO 第一帧必须是 256×256**。`tauri-codegen` 在 Windows 上把 `icon.ico` 的
   **第 0 个 entry** 解成窗口图标（也就是任务栏图标），它不挑最大帧。旧图标第 0 帧
   只有 32×32，高 DPI 任务栏只能把 32px 放大成糊图。这里按 256 → 16 降序写帧，
   并且全部用未压缩的 BMP 帧，绕开 PNG-in-ICO 的兼容问题。

用法（仅开发期，需要 Pillow）：`python3 scripts/make-icon.py`
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "icon-source.jpg"
MASTER = ROOT / "brand" / "icon-source.png"
ICONS = ROOT / "apps" / "desktop" / "src-tauri" / "icons"

MASTER_SIZE = 1024
ICO_SIZES = (256, 128, 64, 48, 40, 32, 24, 20, 16)  # 降序：第 0 帧给 Windows 窗口图标
PNG_SIZES = (32, 64, 128)  # 与历史产物保持一致；更小的尺寸只进 ICO，不单独落盘
STORE_LOGOS = {"StoreLogo": 50, "Square30x30Logo": 30, "Square44x44Logo": 44,
               "Square71x71Logo": 71, "Square89x89Logo": 89, "Square107x107Logo": 107,
               "Square142x142Logo": 142, "Square150x150Logo": 150,
               "Square284x284Logo": 284, "Square310x310Logo": 310}

# 移动端产物桌面构建不引用，但它们是 `tauri icon` 的历史产物，一并刷新避免仓库里留着旧 logo。
# 键 = android 密度目录，值 = (launcher, foreground)
ANDROID = {"mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216),
           "xxhdpi": (144, 324), "xxxhdpi": (192, 432)}
# iOS AppIcon 文件名 → 像素边长
IOS = {"AppIcon-20x20@1x": 20, "AppIcon-20x20@2x": 40, "AppIcon-20x20@2x-1": 40,
       "AppIcon-20x20@3x": 60, "AppIcon-29x29@1x": 29, "AppIcon-29x29@2x": 58,
       "AppIcon-29x29@2x-1": 58, "AppIcon-29x29@3x": 87, "AppIcon-40x40@1x": 40,
       "AppIcon-40x40@2x": 80, "AppIcon-40x40@2x-1": 80, "AppIcon-40x40@3x": 120,
       "AppIcon-60x60@2x": 120, "AppIcon-60x60@3x": 180, "AppIcon-76x76@1x": 76,
       "AppIcon-76x76@2x": 152, "AppIcon-83.5x83.5@2x": 167, "AppIcon-512@2x": 1024}


def _is_blue(px: tuple[int, int, int]) -> bool:
    r, g, b = px
    return b > 110 and b - r > 40 and b - g > 10


def detect_radius(image: Image.Image) -> float:
    """用左上角弧线拟合圆角半径；失败时回落到画布的 12.5%。"""
    width, height = image.size
    px = image.load()
    points: list[tuple[int, int]] = []
    for y in range(0, height // 5, max(1, height // 200)):
        for x in range(0, width // 2):
            if _is_blue(px[x, y]):
                if y > 0 and x > 0:
                    points.append((x, y))
                break
    radii = []
    for x, y in points:
        # 圆心 (r, r) 过 (x, y)：r² - 2r(x+y) + x² + y² = 0
        a, b, c = 1.0, -2.0 * (x + y), float(x * x + y * y)
        disc = b * b - 4 * a * c
        if disc < 0:
            continue
        r = (-b + math.sqrt(disc)) / 2
        if 0.03 * width < r < 0.35 * width:
            radii.append(r)
    if len(radii) < 8:
        return 0.125 * width
    radii.sort()
    return radii[len(radii) // 2]


def build_master() -> tuple[Image.Image, float]:
    source = Image.open(SRC).convert("RGB")
    width, height = source.size
    radius = detect_radius(source)
    inset = 2.0  # 抹掉 JPEG 边缘白晕，1024 下约 1px
    ss = 2
    canvas = Image.new("L", (width * ss, height * ss), 0)
    ImageDraw.Draw(canvas).rounded_rectangle(
        [inset * ss, inset * ss, (width - 1 - inset) * ss, (height - 1 - inset) * ss],
        radius=max(0.0, radius - inset) * ss,
        fill=255,
    )
    alpha = canvas.resize((width, height), Image.LANCZOS)
    rgba = source.convert("RGBA")
    rgba.putalpha(alpha)
    master = rgba.resize((MASTER_SIZE, MASTER_SIZE), Image.LANCZOS)
    master.save(MASTER)
    print(f"母版 {MASTER.relative_to(ROOT)}  {master.size[0]}×{master.size[1]}  圆角半径≈{radius / width:.1%}")
    return master, radius * MASTER_SIZE / width


def resize(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def write_ico(master: Image.Image, path: Path) -> None:
    """写 32bpp BMP 帧的 ICO（每帧 = BITMAPINFOHEADER + BGRA + AND 掩码）。"""
    frames = []
    for size in ICO_SIZES:
        image = resize(master, size)
        header = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, 0, 0, 0, 0, 0)
        pixels = bytearray()
        for y in range(size - 1, -1, -1):  # BMP 自下而上
            row = image.load()
            for x in range(size):
                r, g, b, a = row[x, y]
                pixels += bytes((b, g, r, a))
        mask_row = ((size + 31) // 32) * 4
        mask = b"\x00" * (mask_row * size)
        frames.append(header + bytes(pixels) + mask)

    offset = 6 + 16 * len(frames)
    directory = struct.pack("<HHH", 0, 1, len(frames))
    entries = b""
    for size, data in zip(ICO_SIZES, frames):
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32,
                               len(data), offset)
        offset += len(data)
    path.write_bytes(directory + entries + b"".join(frames))
    print(f"ICO   {path.relative_to(ROOT)}  帧={','.join(str(s) for s in ICO_SIZES)}")


def write_icns(master: Image.Image, path: Path) -> None:
    """macOS ICNS：PNG 载荷。icp4/5/6 = 16/32/64，ic07..ic14 = 128..512(2x)。"""
    chunks = [(b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128),
              (b"ic08", 256), (b"ic09", 512), (b"ic11", 32), (b"ic12", 64),
              (b"ic13", 256), (b"ic14", 512), (b"ic10", 1024)]
    body = b""
    cache: dict[int, bytes] = {}
    for kind, size in chunks:
        if size not in cache:
            buffer = _png_bytes(resize(master, size))
            cache[size] = buffer
        payload = cache[size]
        body += kind + struct.pack(">I", len(payload) + 8) + payload
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print(f"ICNS  {path.relative_to(ROOT)}")


def _png_bytes(image: Image.Image) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def square_bleed(master: Image.Image, radius: float) -> Image.Image:
    """把圆角外的透明区填成同色蓝：iOS/Android 需要满幅方块，系统自己切圆角。

    原图圆角处的抗锯齿像素是「蓝→白」混合（alpha 仍是 255），只按 alpha 补底会留一圈
    浅色接缝。这里把「比图形小 3px」的圆角矩形之外整片刷成品牌蓝，接缝一并盖掉。
    """
    blue = master.getpixel((master.width // 40, master.height // 2))[:3]
    width, height = master.size
    ss, inset = 4, 3
    mask = Image.new("L", (width * ss, height * ss), 255)
    ImageDraw.Draw(mask).rounded_rectangle(
        [inset * ss, inset * ss, (width - inset) * ss - 1, (height - inset) * ss - 1],
        radius=max(0.0, radius - inset) * ss,
        fill=0,
    )
    mask = mask.resize((width, height), Image.LANCZOS)
    canvas = master.convert("RGBA")
    canvas.paste(Image.new("RGBA", master.size, blue + (255,)), (0, 0), mask)
    return canvas


def write_mobile(master: Image.Image, radius: float) -> None:
    square = square_bleed(master, radius)
    for density, (size, fg_size) in ANDROID.items():
        folder = ICONS / "android" / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        resize(square, size).convert("RGB").save(folder / "ic_launcher.png", optimize=True)
        round_art = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
        round_art.paste(resize(square, size), (0, 0), mask.resize((size, size), Image.LANCZOS))
        round_art.save(folder / "ic_launcher_round.png", optimize=True)
        fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        inner = int(fg_size * 0.66)
        fg.paste(resize(master, inner), ((fg_size - inner) // 2, (fg_size - inner) // 2), resize(master, inner))
        fg.save(folder / "ic_launcher_foreground.png", optimize=True)

    # 自适应图标底色跟随品牌蓝（原来是 #fff，新 logo 的圆角会露出白角）
    bg = square.getpixel((square.width // 40, square.height // 2))[:3]
    values = ICONS / "android" / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'  <color name="ic_launcher_background">#{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )

    ios_dir = ICONS / "ios"
    ios_dir.mkdir(parents=True, exist_ok=True)
    for name, size in IOS.items():
        resize(square, size).convert("RGB").save(ios_dir / f"{name}.png", optimize=True)
    print(f"移动端 {len(ANDROID)} 个 android 密度 + {len(IOS)} 个 iOS 尺寸已刷新")


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    master, radius = build_master()

    for size in PNG_SIZES:
        resize(master, size).save(ICONS / f"{size}x{size}.png", optimize=True)
    # Tauri 约定：icon.png 是默认窗口图标 / AppImage 图标（512）
    resize(master, 512).save(ICONS / "icon.png", optimize=True)
    resize(master, 256).save(ICONS / "128x128@2x.png", optimize=True)
    write_ico(master, ICONS / "icon.ico")
    write_icns(master, ICONS / "icon.icns")

    for name, size in STORE_LOGOS.items():
        resize(master, size).save(ICONS / f"{name}.png", optimize=True)
    write_mobile(master, radius)
    print(f"PNG   {len(PNG_SIZES) + 2 + len(STORE_LOGOS)} 个文件已写入 {ICONS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
