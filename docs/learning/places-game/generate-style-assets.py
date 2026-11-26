# /// script
# requires-python = ">=3.10"
# dependencies = ["brotli==1.2.1", "fonttools==4.69.1", "tinycss2==1.5.1"]
# ///

import argparse
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
from itertools import groupby
from pathlib import Path
import re

from fontTools import subset
from fontTools.ttLib import TTFont
from tinycss2 import parse_rule_list, parse_stylesheet, serialize
from tinycss2.ast import LiteralToken

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
FONT_PATH = Path("fontawesome/webfonts/place-naming-icons.woff2")
CSS_PATH = Path("vendor/game-vendor.min.css")
FONT_FAMILY = "Place Naming Icons"


class GameClasses(HTMLParser):
    def __init__(self):
        super().__init__()
        self.names = set()

    def handle_starttag(self, tag, attrs):
        self.names.update(dict(attrs).get("class", "").split())


def keep_used_rules(rules, classes):
    for rule in rules:
        if rule.type == "qualified-rule":
            selectors = []
            for comma, tokens in groupby(rule.prelude, key=lambda token: token == ","):
                if comma:
                    continue
                selector = list(tokens)
                # Only top-level classes are required. Keep resets, attributes and
                # optional classes inside :not(), :is(), and other pseudo-classes.
                required = {
                    name.value for dot, name in zip(selector, selector[1:])
                    if dot == "." and name.type == "ident"
                }
                if required <= classes:
                    if selectors:
                        selectors.append(LiteralToken(0, 0, ","))
                    selectors.extend(selector)
            if not selectors:
                continue
            rule.prelude = selectors
        elif rule.type == "at-rule" and rule.lower_at_keyword == "media":
            rule.content = list(keep_used_rules(parse_rule_list(rule.content), classes))
            if not rule.content:
                continue
        yield rule


def subset_icons(codepoints):
    # Subset the original outlines from the vendored TrueType face.
    font = TTFont(VENDOR / "fontawesome/webfonts/fa-solid-900.ttf", recalcTimestamp=False)
    options = subset.Options()
    options.ignore_missing_unicodes = False
    options.name_IDs.extend([13, 14])
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)

    # The original family name is reserved under the font's license.
    names = {
        1: FONT_FAMILY + " Solid",
        3: "PlaceNamingIcons-Solid",
        4: FONT_FAMILY + " Solid",
        6: "PlaceNamingIcons-Solid",
        16: FONT_FAMILY,
    }
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID]
    font.flavor = "woff2"
    output = BytesIO()
    font.save(output)
    return output.getvalue()


def versioned(path, data):
    return f"{path.as_posix()}?v={sha256(data).hexdigest()[:16]}"


def main():
    cli = argparse.ArgumentParser(description="Build the game's Bootstrap and icon assets.")
    cli.add_argument("--check", action="store_true", help="Check that generated files are current.")
    check = cli.parse_args().check

    index_path = ROOT / "index.html"
    html = index_path.read_text(encoding="utf-8")
    classes = GameClasses()
    classes.feed(html)
    # Include literal classes added by the game, including inside HTML strings.
    classes.names.update(re.findall(r"[\w-]+", (ROOT / "places-game.js").read_text(encoding="utf-8")))

    def retained(path):
        source = parse_stylesheet((VENDOR / path).read_text(encoding="utf-8"), skip_whitespace=True)
        return serialize(keep_used_rules(source, classes.names))

    bootstrap = retained("bootstrap/bootstrap.min.css")
    icons = retained("fontawesome/css/fontawesome.min.css").replace("Font Awesome 6 Free", FONT_FAMILY)
    codepoints = {ord(char) for char in re.findall(r'content:"([\ue000-\uf8ff])"', icons)}
    if not codepoints:
        raise SystemExit("Expected icon glyphs in the retained Font Awesome stylesheet")
    font = subset_icons(codepoints)
    face = (
        f'@font-face{{font-family:"{FONT_FAMILY}";font-style:normal;font-weight:900;'
        f'font-display:block;src:url("{versioned(FONT_PATH, font)}") format("woff2")}}'
        f'.fa-solid,.fas{{font-family:"{FONT_FAMILY}";font-weight:900}}'
    )
    css = (bootstrap + "\n" + icons + face + "\n").encode("utf-8")
    html, count = re.subn(
        rf'href="{re.escape(CSS_PATH.as_posix())}(?:\?v=[a-f0-9]+)?"',
        f'href="{versioned(CSS_PATH, css)}"',
        html,
    )
    if count != 1:
        raise SystemExit("Expected one game-vendor.min.css link in index.html")

    for target, data in {
        VENDOR / FONT_PATH: font,
        ROOT / CSS_PATH: css,
        index_path: html.encode("utf-8"),
    }.items():
        if target.exists() and target.read_bytes() == data:
            continue
        if check:
            raise SystemExit(f"Outdated assets at {target.relative_to(ROOT)}. Run uv run generate-style-assets.py")
        target.write_bytes(data)


if __name__ == "__main__":
    main()
