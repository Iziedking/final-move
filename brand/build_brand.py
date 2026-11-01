"""Render the Final Move brand kit to PNG with headless Chrome. Run from anywhere: python brand/build_brand.py"""
import pathlib
import subprocess
import tempfile

HERE = pathlib.Path(__file__).parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
INK, VIOLET, SKY, CLOUD, AMBER, MINT, CYAN, CORAL = "#171449", "#6C4CF1", "#EAEDFF", "#FFFFFF", "#FFB13C", "#1FD6A6", "#36C5FF", "#FF6B5C"
LIGHT_SQ, DARK_SQ, GLINT = "#F6F7FF", "#C8BCFA", "#8B70FF"
FONTS = '<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&family=Nunito:wght@700;800&display=block" rel="stylesheet">'


def plinth(detail, collar_y=30, collar_w=21):
    x = 22.5 - collar_w / 2
    return (
        f'<rect x="{x}" y="{collar_y}" width="{collar_w}" height="4.2" rx="2.1"/>'
        '<rect x="9" y="34" width="27" height="5.5" rx="2.75"/>'
        f'<path fill="none" stroke="{detail}" stroke-width="1.3" d="M{x + 2} {collar_y + 2.1}h{collar_w - 4}"/>'
    )


def king(d):
    return (
        '<path d="M21 3.4h3v3h3v3h-3v3.4h-3V9.4h-3v-3h3z"/>'
        '<path d="M13.2 30.2c-4.4-5.2-2.8-12.8 3.4-13.2 2.6-.2 4.6 1.2 5.9 3.6 1.3-2.4 3.3-3.8 5.9-3.6 6.2.4 7.8 8 3.4 13.2z"/>'
        '<path d="M20.2 18.4c0-2.2 1-4.6 2.3-5.6 1.3 1 2.3 3.4 2.3 5.6"/>'
        + plinth(d)
        + f'<path fill="none" stroke="{d}" stroke-width="1.3" d="M22.5 21.6v7.4"/>'
    )


def queen(d):
    return (
        '<path d="M10 30L8 15.6l4.6 7.8L15 12.6l4 9.6 3.5-10.6L26 22.2l4-9.6 2.4 10.8 4.6-7.8L35 30z"/>'
        '<circle cx="8" cy="13.2" r="2.5"/><circle cx="15" cy="10.2" r="2.5"/><circle cx="22.5" cy="9" r="2.5"/>'
        '<circle cx="30" cy="10.2" r="2.5"/><circle cx="37" cy="13.2" r="2.5"/>'
        + plinth(d, 29.6, 25)
        + f'<path fill="none" stroke="{d}" stroke-width="1.3" d="M12.4 26.4c6.8-1.8 13.4-1.8 20.2 0"/>'
    )


def knight(d):
    return (
        '<path d="M15 31c-.6-4.6 1.8-7.8 5.6-10.4l-7.1 3c-2.6 1.1-5.2-1-4-3.6l3.6-6.4c1.5-3.4 4.6-5.7 8-6.4l1.4-3.7 2.6 3.6c6.4 1.8 9.6 8.3 8.9 15.7-.3 3.3-1.1 6-1.8 8.2z"/>'
        + plinth(d)
        + f'<circle cx="18.6" cy="13.8" r="1.5" fill="{d}" stroke="none"/><circle cx="11.6" cy="20.6" r="0.95" fill="{d}" stroke="none"/>'
        + f'<path fill="none" stroke="{d}" stroke-width="1.3" d="M26.4 10.6c3.2 2.4 4.8 7 4.3 12.6"/>'
    )


def rook(d):
    return (
        '<rect x="13.5" y="15" width="18" height="16" rx="1.5"/><path d="M11 8.5h5v3.2h3.2V8.5h6.6v3.2H29V8.5h5v8.2H11z"/>'
        + plinth(d)
        + f'<path fill="none" stroke="{d}" stroke-width="1.3" d="M16 20h13M16 25.5h13"/>'
    )


def piece(kind, color, size):
    fill, detail = (CLOUD, INK) if color == "w" else (INK, GLINT)
    body = {"K": king, "Q": queen, "N": knight, "R": rook}[kind](detail)
    return (
        f'<svg viewBox="0 0 45 45" width="{size}" height="{size}" xmlns="http://www.w3.org/2000/svg" style="display:block">'
        f'<g fill="{fill}" stroke="{INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">{body}</g></svg>'
    )


def mark(size, tilt=-4):
    """The logo: a white king on a violet sticker tile."""
    r, line, pop = round(size * 0.27), max(3, round(size * 0.05)), max(3, round(size * 0.055))
    return (
        f'<div style="width:{size}px;height:{size}px;background:{VIOLET};border:{line}px solid {INK};border-radius:{r}px;'
        f'box-shadow:{pop}px {pop}px 0 {INK};transform:rotate({tilt}deg);display:flex;align-items:center;justify-content:center;box-sizing:border-box;flex:none">'
        f'{piece("K", "w", round(size * 0.8))}</div>'
    )


def wordmark(px, dark=False):
    first = CLOUD if dark else INK
    return (
        f'<div style="font:800 {px}px/1 \'Baloo 2\';white-space:nowrap;color:{first}">Final '
        f'<span style="color:{VIOLET if not dark else "#9B85FF"}">Move</span></div>'
    )


def board_fragment(sq):
    layout = {(0, 1): ("Q", "b"), (1, 2): ("K", "b"), (2, 0): ("N", "w"), (2, 3): ("R", "b"), (3, 2): ("K", "w")}
    cells = ""
    for r in range(4):
        for c in range(4):
            bg = LIGHT_SQ if (r + c) % 2 == 0 else DARK_SQ
            inner = piece(layout[(r, c)][0], layout[(r, c)][1], round(sq * 0.86)) if (r, c) in layout else ""
            extra = ""
            if (r, c) == (2, 0):
                bg = "#FFE3B5"
                extra = f'<span style="position:absolute;right:{round(sq*.07)}px;top:{round(sq*.07)}px;width:{round(sq*.17)}px;height:{round(sq*.17)}px;border-radius:50%;background:{MINT};border:{max(2,round(sq*.03))}px solid {INK}"></span>'
            cells += f'<div style="position:relative;width:{sq}px;height:{sq}px;background:{bg};display:flex;align-items:center;justify-content:center">{inner}{extra}</div>'
    line = round(sq * 0.05)
    return (
        f'<div style="display:grid;grid-template-columns:repeat(4,{sq}px);border:{line}px solid {INK};border-radius:{round(sq*.28)}px;overflow:hidden;'
        f'box-shadow:{round(sq*.1)}px {round(sq*.1)}px 0 {INK};transform:rotate(4deg);flex:none">{cells}</div>'
    )


def page(w, h, body, bg):
    return f'<!doctype html><meta charset="utf-8">{FONTS}<style>html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden;background:{bg}}}</style>{body}'


CENTER = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%'
ASSETS = {
    # Square app icon: filled background so it survives any avatar crop, including circles.
    "final-move-icon-1024.png": (1024, 1024, SKY, f'<div style="{CENTER}">{mark(660)}</div>'),
    "final-move-icon-400.png": (400, 400, SKY, f'<div style="{CENTER}">{mark(258)}</div>'),
    "final-move-mark-1024-transparent.png": (1024, 1024, "transparent", f'<div style="{CENTER}">{mark(860, 0)}</div>'),
    "final-move-logo-light.png": (1600, 480, SKY, f'<div style="{CENTER};gap:44px">{mark(250)}{wordmark(210)}</div>'),
    "final-move-logo-dark.png": (1600, 480, "#100E35", f'<div style="{CENTER};gap:44px">{mark(250)}{wordmark(210, True)}</div>'),
    "final-move-banner-1500x500.png": (
        1500, 500, SKY,
        f'<div style="{CENTER};gap:70px;box-sizing:border-box;padding:0 70px;justify-content:space-between">'
        f'<div style="display:flex;flex-direction:column;gap:22px"><div style="display:flex;align-items:center;gap:26px">{mark(120)}{wordmark(112)}</div>'
        f'<div style="font:800 40px/1.2 Nunito;color:{INK}">Chess where every move is final on Arc.</div>'
        f'<div style="font:700 26px/1.3 Nunito;color:#4A477E">Humans and AI agents on one board. No wallet popups.</div></div>'
        f'{board_fragment(92)}</div>',
    ),
    "final-move-og-1200x630.png": (
        1200, 630, SKY,
        f'<div style="{CENTER};gap:50px;box-sizing:border-box;padding:0 64px;justify-content:space-between">'
        f'<div style="display:flex;flex-direction:column;gap:26px;max-width:600px"><div style="display:flex;align-items:center;gap:20px">{mark(84)}{wordmark(74)}</div>'
        f'<div style="font:800 76px/1.02 \'Baloo 2\';color:{INK}">Chess where every move is <span style="display:inline-block;background:{VIOLET};color:#fff;border:6px solid {INK};border-radius:22px;padding:0 16px;box-shadow:7px 7px 0 {INK};transform:rotate(-2.5deg)">final</span></div>'
        f'<div style="font:800 28px/1.25 Nunito;color:#4A477E">Bots, people or AI agents. Every move is a transaction on Arc.</div></div>'
        f'{board_fragment(92)}</div>',
    ),
}

SVG_ICON = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    f'<rect x="3" y="3" width="58" height="58" rx="17" fill="{VIOLET}" stroke="{INK}" stroke-width="4"/>'
    f'<g transform="translate(9.5 10.5)" fill="{CLOUD}" stroke="{INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">{king(INK)}</g></svg>'
)


def render(name, w, h, bg, body):
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / "p.html"
        f.write_text(page(w, h, body, bg), encoding="utf-8")
        args = [
            CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
            f"--user-data-dir={d}/u", f"--window-size={w},{h}", "--virtual-time-budget=6000",
            f"--screenshot={HERE / name}", f.as_uri(),
        ]
        if bg == "transparent":
            args.insert(1, "--default-background-color=00000000")
        subprocess.run(args, check=True, capture_output=True, timeout=120)
    print(name)


(HERE / "final-move-icon.svg").write_text(SVG_ICON, encoding="utf-8")
for asset, (w, h, bg, body) in ASSETS.items():
    render(asset, w, h, bg, body)
