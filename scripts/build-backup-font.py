"""Build the licensed static PDF font from the pinned Google Fonts source.

Usage: python scripts/build-backup-font.py PATH_TO_SOURCE_TTF
Requires fonttools; does not download or modify the source font.
"""

import argparse
import hashlib
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE_SHA256 = "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != SOURCE_SHA256:
        parser.error("Source SHA-256 does not match the pinned Noto Sans SC source")
    font = TTFont(args.source, recalcTimestamp=False)
    font = instantiateVariableFont(font, {"wght": 400}, inplace=True)
    # Use a distinct family name for this derived static build.
    names = {1: "Yantu PDF SC", 2: "Regular", 3: "Yantu PDF SC Regular 1.0",
             4: "Yantu PDF SC Regular", 6: "YantuPDFSC-Regular",
             16: "Yantu PDF SC", 17: "Regular"}
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    font.recalcTimestamp = False
    target = Path(__file__).resolve().parents[1] / "public/fonts/yantu-pdf/YantuPdfSC-Regular.ttf"
    target.parent.mkdir(parents=True, exist_ok=True)
    font.save(target)
    print(f"{target}\nSHA-256: {hashlib.sha256(target.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
