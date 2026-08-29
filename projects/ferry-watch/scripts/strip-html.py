"""Prints the readable prose of an HTML file, dropping style and script blocks.

Used by the probe workflow to read a page's actual text out of CI logs.
"""

import re
import sys
from pathlib import Path

LIMIT = 6000


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: strip-html.py <file>", file=sys.stderr)
        return 2

    html = Path(sys.argv[1]).read_text(errors="replace")
    # Remove style/script bodies before stripping tags, or their contents
    # survive as noise and drown the prose.
    html = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", "\n", html)
    text = re.sub(r"[ \t]+", " ", text)

    lines, blank = [], False
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            blank = True
            continue
        if blank and lines:
            lines.append("")
        blank = False
        lines.append(line)

    print("\n".join(lines)[:LIMIT])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
