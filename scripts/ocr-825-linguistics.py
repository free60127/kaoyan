#!/usr/bin/env python3
"""OCR the five scanned linguistics note PDFs into the external audit cache."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pymupdf


SOURCE_DIR = Path(r"D:\kao yan\825\27版高分笔记\语言学")
CACHE_DIR = Path(r"D:\kao yan\ocr-825-cache\linguistics")
RAPIDOCR_RUNTIME = CACHE_DIR / "runtime"
EXPECTED_PAGES = 123


def make_engine():
    if RAPIDOCR_RUNTIME.exists():
        sys.path.insert(0, str(RAPIDOCR_RUNTIME))
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def page_ocr(engine, page: pymupdf.Page, dpi: int) -> tuple[list[dict], tuple[int, int]]:
    pix = page.get_pixmap(matrix=pymupdf.Matrix(dpi / 72, dpi / 72), alpha=False)
    import numpy as np

    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    result, _ = engine(image)
    lines = []
    if result:
        for item in result:
            box, text, score = item
            points = [[round(float(x), 1), round(float(y), 1)] for x, y in box]
            lines.append({"text": str(text), "confidence": round(float(score), 4), "box": points})
        lines.sort(key=lambda line: (min(p[1] for p in line["box"]), min(p[0] for p in line["box"])))
    return lines, (pix.width, pix.height)


def run(source_dir: Path, cache_dir: Path, dpi: int, force: bool) -> None:
    pdfs = sorted(source_dir.glob("*.pdf"), key=lambda p: p.name)
    if len(pdfs) != 5:
        raise SystemExit(f"Expected exactly five source PDFs in {source_dir}; found {len(pdfs)}")

    page_counts = [len(pymupdf.open(pdf)) for pdf in pdfs]
    if sum(page_counts) != EXPECTED_PAGES:
        raise SystemExit(f"Expected {EXPECTED_PAGES} pages; found {sum(page_counts)}: {page_counts}")

    cache_dir.mkdir(parents=True, exist_ok=True)
    engine = make_engine()
    manifest = []
    processed = 0

    for pdf_path, page_count in zip(pdfs, page_counts):
        output_path = cache_dir / f"{pdf_path.stem}.jsonl"
        if output_path.exists() and not force:
            existing = output_path.read_text(encoding="utf-8").splitlines()
            cached_pages = [json.loads(line) for line in existing if line.strip()]
            if len(cached_pages) == page_count:
                manifest.append({"sourceFile": pdf_path.name, "pageCount": page_count, "cacheFile": output_path.name, "cached": True})
                processed += page_count
                print(f"cached {processed}/{EXPECTED_PAGES}: {pdf_path.name} ({page_count} pages)", flush=True)
                continue

        document = pymupdf.open(pdf_path)
        with output_path.open("w", encoding="utf-8", newline="\n") as stream:
            for page_index, page in enumerate(document):
                lines, dimensions = page_ocr(engine, page, dpi)
                # A sparse detection pass can miss small footnotes or low contrast text.
                # Retry those pages at a higher raster resolution and keep the stronger pass.
                if len(lines) < 8:
                    retry_lines, retry_dimensions = page_ocr(engine, page, max(dpi + 80, 300))
                    if len(retry_lines) > len(lines):
                        lines, dimensions = retry_lines, retry_dimensions
                text = "\n".join(line["text"] for line in lines)
                record = {
                    "sourceFile": pdf_path.name,
                    "sourcePage": page_index + 1,
                    "pageCount": page_count,
                    "dpi": dpi,
                    "imageSize": list(dimensions),
                    "lineCount": len(lines),
                    "text": text,
                    "lines": lines,
                }
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                stream.flush()
                processed += 1
                if page_index == 0 or processed % 10 == 0 or processed == EXPECTED_PAGES:
                    print(f"OCR {processed}/{EXPECTED_PAGES}: {pdf_path.name} page {page_index + 1}/{page_count}, {len(lines)} lines", flush=True)
        document.close()
        manifest.append({"sourceFile": pdf_path.name, "pageCount": page_count, "cacheFile": output_path.name, "cached": False})

    summary = {
        "sourceDirectory": str(source_dir),
        "expectedPages": EXPECTED_PAGES,
        "ocrCoveredPages": processed,
        "dpi": dpi,
        "files": manifest,
    }
    (cache_dir / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=SOURCE_DIR)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--dpi", type=int, default=220)
    parser.add_argument("--force", action="store_true", help="replace complete existing OCR page caches")
    args = parser.parse_args()
    run(args.source_dir, args.cache_dir, args.dpi, args.force)


if __name__ == "__main__":
    main()
