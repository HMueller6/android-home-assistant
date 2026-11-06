#!/usr/bin/env python3
"""Builds dist/habitat.html: the whole dashboard (page, styles, scripts, icon) in one file.

A single file is easier to put on Home Assistant than a folder: upload it to config/www/ or fetch it
with one command, then open /local/habitat.html. Run this again after changing any source file:

    python3 dashboard/tools/build_single_file.py
"""
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "dist" / "habitat.html"


def build() -> str:
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "css" / "habitat.css").read_text(encoding="utf-8")
    scripts = re.findall(r'<script src="(js/[^"?]+)', page)
    js = "\n".join((ROOT / name).read_text(encoding="utf-8") for name in scripts)
    if "</script" in js or "</style" in css:
        sys.exit("A source file contains a closing script/style tag; it cannot be inlined.")
    icon = "data:image/svg+xml," + urllib.parse.quote((ROOT / "icon.svg").read_text(encoding="utf-8").strip())

    page = page.replace('  <link rel="manifest" href="manifest.webmanifest">\n', "")
    page = page.replace('href="icon.svg"', f'href="{icon}"')
    page = re.sub(r'  <link rel="stylesheet" href="css/habitat\.css[^"]*">', lambda _: f"  <style>\n{css}\n  </style>", page)
    page = re.sub(r'  <script src="js/[^"]+"></script>\n', "", page)
    page = page.replace("</body>", f"  <script>\n{js}\n  </script>\n</body>")
    if 'src="js/' in page or "css/habitat.css" in page:
        sys.exit("Inlining failed: the page still references external css/js files.")
    return page


if __name__ == "__main__":
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(build(), encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT.parent)} ({OUTPUT.stat().st_size // 1024} KB)")
