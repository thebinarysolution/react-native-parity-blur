#!/usr/bin/env python3
"""Generate the deterministic M5 calibration fixture images (MASTER_PLAN §38, PIPELINE_SPEC §11).

All fixtures are 720x1280 sRGB PNGs, displayed stretched to the full screen on both platforms so
identical logical content sits behind the blur strips. Regenerate with:
  python3 scripts/generate-calibration-fixtures.py
"""
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "example", "src", "assets", "calibration")
W, H = 720, 1280


def save(img, name):
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, name), "PNG")
    print("wrote", name)


def gradient(name, left, right):
    img = Image.new("RGB", (W, H))
    px = img.load()
    for x in range(W):
        t = x / (W - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(left, right))
        for y in range(H):
            px[x, y] = c
    save(img, name)


def checkerboard(name, cell=16):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(0, H, cell):
        for x in range(0, W, cell):
            on = ((x // cell) + (y // cell)) % 2 == 0
            d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(255, 255, 255) if on else (0, 0, 0))
    save(img, name)


def photo(name):
    """Synthetic 'photographic' scene: overlapping shapes, gradients, and fine detail."""
    img = Image.new("RGB", (W, H), (24, 32, 48))
    d = ImageDraw.Draw(img)
    # sky gradient
    for y in range(H // 2):
        t = y / (H / 2)
        d.line([(0, y), (W, y)], fill=(round(90 + 100 * t), round(140 + 60 * t), round(210 - 40 * t)))
    # sun
    d.ellipse([W - 260, 80, W - 100, 240], fill=(255, 214, 90))
    # mountains
    d.polygon([(0, 640), (220, 340), (430, 640)], fill=(70, 90, 110))
    d.polygon([(260, 640), (500, 300), (720, 640)], fill=(52, 68, 88))
    # foreground bands
    d.rectangle([0, 640, W, 900], fill=(46, 120, 70))
    d.rectangle([0, 900, W, 1120], fill=(160, 82, 45))
    d.rectangle([0, 1120, W, H], fill=(200, 60, 60))
    # fine detail: text-like tick rows
    for row in range(10):
        y = 660 + row * 44
        for x in range(20, W - 20, 26):
            d.rectangle([x, y, x + 14, y + 18], fill=(240, 240, 240) if (x // 26 + row) % 3 else (10, 10, 10))
    save(img, name)


def alpha_edge(name):
    """Opaque shapes over a mid-gray field: hard edges for edge/clamp inspection."""
    img = Image.new("RGB", (W, H), (128, 128, 128))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W // 2, H], fill=(0, 0, 0))
    d.ellipse([W // 2 - 180, H // 2 - 180, W // 2 + 180, H // 2 + 180], fill=(255, 255, 255))
    save(img, name)


gradient("bw-gradient.png", (0, 0, 0), (255, 255, 255))
gradient("rg-gradient.png", (230, 30, 30), (30, 200, 60))
gradient("by-gradient.png", (40, 60, 230), (250, 220, 40))
checkerboard("checkerboard.png")
photo("photo.png")
alpha_edge("alpha-edge.png")
print("done")
