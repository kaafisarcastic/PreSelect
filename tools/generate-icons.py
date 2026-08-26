"""
Render the PreSelect mark to PNG at the sizes Chrome asks for.

The mark: two account rings, one behind the other, with a chevron in the front
one. The chevron is the "open this and choose" affordance every account menu
uses, and the second ring says there is more than one to choose from. Deliberately
not a Google G - imitating Google's own mark in an extension icon implies an
affiliation that does not exist, and reads as a plain G at toolbar size anyway.

Pure geometry, so it survives 16px, where the second ring is dropped and the
chevron carries the meaning on its own.

Keep this in sync with assets/logo.svg: both describe the same coordinates.
"""

import math
import struct
import zlib
from pathlib import Path

# Run from anywhere: paths are resolved relative to this file.
OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"

ACCENT = (0x3B, 0x63, 0xE0)
GHOST = (0x8E, 0x9B, 0xB8)

# Geometry in a 0..1 unit square.
FRONT_C = (0.60, 0.5)
FRONT_R = 0.30
FRONT_W = 0.095
BACK_C = (0.29, 0.5)
BACK_R = 0.255
BACK_W = 0.080
# Everything nearer than this to the front ring's centre is cut out of the ring
# behind it, which is what keeps the two shapes reading as separate.
BACK_CLEARANCE = 0.405
CHEVRON = [(0.495, 0.455), (0.60, 0.575), (0.705, 0.455)]
CHEVRON_W = 0.095


def ring_sd(p, c, r, w):
    return abs(math.hypot(p[0] - c[0], p[1] - c[1]) - r) - w / 2


def segment_sd(p, a, b, w):
    px, py = p[0] - a[0], p[1] - a[1]
    bx, by = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, (px * bx + py * by) / (bx * bx + by * by)))
    return math.hypot(px - bx * t, py - by * t) - w / 2


def coverage(sd, scale):
    """Antialiased fill from a signed distance, roughly one pixel of softness."""
    return max(0.0, min(1.0, 0.5 - sd * scale))


def over(dst, src, alpha):
    return tuple(round(s * alpha + d * (1 - alpha)) for d, s in zip(dst, src))


def render(size, with_back_ring=True):
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            p = ((x + 0.5) / size, (y + 0.5) / size)
            rgb, alpha = (255, 255, 255), 0.0

            if with_back_ring:
                a = coverage(ring_sd(p, BACK_C, BACK_R, BACK_W), size)
                gap = math.hypot(p[0] - FRONT_C[0], p[1] - FRONT_C[1]) - BACK_CLEARANCE
                a *= max(0.0, min(1.0, 0.5 + gap * size))
                if a > 0:
                    rgb, alpha = GHOST, a

            front = coverage(ring_sd(p, FRONT_C, FRONT_R, FRONT_W), size)
            for a_pt, b_pt in zip(CHEVRON, CHEVRON[1:]):
                front = max(front, coverage(segment_sd(p, a_pt, b_pt, CHEVRON_W), size))

            if front > 0:
                rgb = over(rgb, ACCENT, front) if alpha > 0 else ACCENT
                alpha = alpha + front * (1 - alpha)

            row += bytes((*rgb, round(alpha * 255)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


OUT.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    # At 16px the second ring would only add noise, so the mark simplifies.
    write_png(OUT / f"icon-{size}.png", size, render(size, with_back_ring=size >= 32))
    print("wrote", OUT / f"icon-{size}.png")
