"""
Regenerate web/lib/og/mascot.ts from brand/begfi-logo-512.png.

Satori (Next's Open Graph renderer) cannot fetch images over the network at
runtime, so the mascot is baked into a generated module as a base64 data URL.
Run this whenever the source artwork changes:

    python scripts/gen-mascot-og.py
"""

import base64
import io
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "begfi-logo-512.png"
OUT = ROOT / "web" / "lib" / "og" / "mascot.ts"

HEADER = """\
/**
 * The mascot, as a base64 data URL. Satori (which renders the Open Graph cards)
 * cannot fetch web fonts or images over the network at runtime, so the image is
 * baked directly into this generated module. Regenerate by rerunning:
 *   python scripts/gen-mascot-og.py
 */
export const MASCOT_BASE64 = "data:image/png;base64,"""


def main() -> None:
    img = Image.open(SRC).convert("RGB")
    img = img.resize((200, 200), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(f'{HEADER}{encoded}";\n')
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
