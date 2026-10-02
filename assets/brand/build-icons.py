"""Builds Domino's icon SVGs. Run: python3 assets/brand/build-icons.py

The mark: three dominoes in a cascade. The amber tile (Domino's critical-path color) tips first
and falls onto the next, which leans onto the last: the chain reaction the app makes visible, and
"finish this first". Geometry is physical: each tile pivots on its bottom-right corner and rests on
its neighbour's face.

  icon.svg        full app icon (48px and up)
  icon-small.svg  pip-less variant that stays legible at 16-32px
  mark.svg        the tiles alone, no background, accent-blue tiles (README, docs)
  public/favicon.svg  copy of icon-small.svg for the browser tab (dev:web)

Then regenerate the app icons: see README "App icon".
"""
import math
from pathlib import Path

OUT = Path(__file__).parent
NAVY, AMBER, AMBER_EDGE, NAVY_EDGE = "#1d3fb8", "#f59e0b", "#a35f04", "#132f7c"


def tiles(W, H, a2, a1, R, pip_r, detail, light="#ffffff"):
    def rot(p, c, deg):
        a = math.radians(deg)
        x, y = p[0] - c[0], p[1] - c[1]
        return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))

    # Tile 3 upright; tile 2 leans until its top-right corner meets tile 3; tile 1 meets tile 2's face.
    x3 = 0.0
    p2 = (x3 - W) - H * math.sin(math.radians(a2))
    bl2, tl2 = rot((p2 - W, 0), (p2, 0), a2), rot((p2 - W, -H), (p2, 0), a2)
    top1 = (H * math.sin(math.radians(a1)), -H * math.cos(math.radians(a1)))
    t = (top1[1] - bl2[1]) / (tl2[1] - bl2[1])
    # Rounded corners recede from the true corner, so nudge tile 1 in until it visibly touches.
    p1 = bl2[0] + t * (tl2[0] - bl2[0]) - top1[0] + R * (1 - 1 / math.sqrt(2))

    def tile(px, angle, fill, pip, divider, edge):
        x, y = px - W, -H
        s = f'<g transform="rotate({angle} {px:.1f} 0)">'
        if detail:
            s += f'<rect x="{x + 9:.1f}" y="{y + 9}" width="{W}" height="{H}" rx="{R}" fill="{edge}"/>'
        s += f'<rect x="{x:.1f}" y="{y}" width="{W}" height="{H}" rx="{R}" fill="{fill}"/>'
        if detail:
            s += f'<rect x="{x + 30:.1f}" y="{y + H / 2 - 6}" width="{W - 60}" height="12" rx="6" fill="{divider}"/>'
            s += "".join(f'<circle cx="{x + W / 2:.1f}" cy="{y + H * f:.1f}" r="{pip_r}" fill="{pip}"/>' for f in (0.27, 0.73))
        return s + "</g>"

    body = tile(p1, a1, AMBER, "#ffffff", "#ffd38a", AMBER_EDGE) + tile(p2, a2, light, NAVY, "#d5defb", NAVY_EDGE) + tile(x3, 0, light, NAVY, "#d5defb", NAVY_EDGE)
    pts = [rot(q, (p, 0), a) for (p, a) in [(p1, a1), (p2, a2), (x3, 0)] for q in [(p - W, 0), (p, 0), (p - W, -H), (p, -H)]]
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    return body, (min(xs), min(ys), max(xs), max(ys))


BACKGROUND = """<defs>
<linearGradient id="bg" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#4176f7"/><stop offset="1" stop-color="#1b39a8"/></linearGradient>
<linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="drop" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#0b1440" flood-opacity="0.28"/></filter>
</defs>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#drop)"/>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#gloss)"/>"""


def icon(name, W, H, a2, a1, R, pip_r, detail):
    body, (x0, y0, x1, y1) = tiles(W, H, a2, a1, R, pip_r, detail)
    tx, ty = 512 - (x0 + x1) / 2, 512 - (y0 + y1) / 2 + 8
    bg = BACKGROUND if detail else BACKGROUND.replace(' filter="url(#drop)"', "")
    (OUT / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{bg}<g transform="translate({tx:.1f} {ty:.1f})">{body}</g></svg>\n')


def mark(name):
    # White tiles vanish on light surfaces, so the bare mark uses the app's accent blue.
    body, (x0, y0, x1, y1) = tiles(170, 380, 13, 34, 44, 0, detail=False, light="#2563eb")
    pad = 8
    (OUT / name).write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - pad:.1f} {y0 - pad:.1f} {x1 - x0 + 2 * pad:.1f} {y1 - y0 + 2 * pad:.1f}">{body}</svg>\n'
    )


icon("icon.svg", W=136, H=360, a2=13, a1=38, R=36, pip_r=25, detail=True)
icon("icon-small.svg", W=170, H=380, a2=13, a1=34, R=44, pip_r=0, detail=False)
mark("mark.svg")
(OUT.parent.parent / "public").mkdir(exist_ok=True)
(OUT.parent.parent / "public" / "favicon.svg").write_text((OUT / "icon-small.svg").read_text())
print("wrote icon.svg, icon-small.svg, mark.svg, public/favicon.svg")
