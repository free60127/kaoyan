#!/usr/bin/env python3
"""OCR the six source PDFs into a private, page-addressable JSONL cache.

The PDFs and OCR output stay outside the repository. This script reads PDFs
only; it never edits or copies them into the site.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pymupdf
from rapidocr_onnxruntime import RapidOCR


DEFAULT_PDF_DIR = Path(r"D:\kao yan\825\27版高分笔记\英美文学")
DEFAULT_CACHE_DIR = Path(r"D:\kao yan\ocr-825-cache\literature")
EXPECTED_PDFS = 6
EXPECTED_PAGES = 307
RENDER_SCALE = 2.5
LOW_CONFIDENCE = 0.60


def safe_name(filename: str) -> str:
    return re.sub(r"[<>:\"/\\|?*]", "_", Path(filename).stem)


def decode_result(items: Any) -> tuple[list[dict[str, Any]], str]:
    lines: list[dict[str, Any]] = []
    for item in items or []:
        if not item or len(item) < 3:
            continue
        polygon, text, raw_score = item[:3]
        text = str(text).strip()
        if not text:
            continue
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0
        points = [[float(point[0]), float(point[1])] for point in polygon]
        lines.append({"text": text, "confidence": round(score, 4), "polygon": points})

    # RapidOCR already orders most Chinese page lines. Sorting by vertical
    # position and then x keeps a stable reading order for these single-column
    # notes while retaining the box coordinates for manual inspection.
    lines.sort(key=lambda item: (min(point[1] for point in item["polygon"]), min(point[0] for point in item["polygon"])))
    text = "\n".join(item["text"] for item in lines)
    return lines, text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf-dir", type=Path, default=DEFAULT_PDF_DIR)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--scale", type=float, default=RENDER_SCALE)
    parser.add_argument("--expected-pages", type=int, default=EXPECTED_PAGES)
    args = parser.parse_args()

    pdfs = sorted(args.pdf_dir.glob("*.pdf"))
    if len(pdfs) != EXPECTED_PDFS:
        raise SystemExit(f"Expected {EXPECTED_PDFS} PDFs in {args.pdf_dir}; found {len(pdfs)}")
    page_total = sum(len(pymupdf.open(pdf)) for pdf in pdfs)
    if args.expected_pages and page_total != args.expected_pages:
        raise SystemExit(f"Expected {args.expected_pages} pages; found {page_total}")

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    engine = RapidOCR()
    manifest: list[dict[str, Any]] = []
    pages_done = 0
    for pdf_path in pdfs:
        doc = pymupdf.open(pdf_path)
        output_path = args.cache_dir / f"{safe_name(pdf_path.name)}.jsonl"
        low_page_count = 0
        empty_page_count = 0
        with output_path.open("w", encoding="utf-8", newline="\n") as output:
            for index, page in enumerate(doc):
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(args.scale, args.scale), alpha=False)
                image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
                result, _elapsed = engine(image)
                lines, text = decode_result(result)
                confidences = [line["confidence"] for line in lines]
                low = [line["text"] for line in lines if line["confidence"] < LOW_CONFIDENCE]
                avg_confidence = round(sum(confidences) / len(confidences), 4) if confidences else 0.0
                if not text.strip():
                    empty_page_count += 1
                if avg_confidence < LOW_CONFIDENCE or low:
                    low_page_count += 1
                row = {
                    "sourceFile": pdf_path.name,
                    "sourcePage": index + 1,
                    "pageCount": len(doc),
                    "text": text,
                    "lineCount": len(lines),
                    "averageConfidence": avg_confidence,
                    "lowConfidenceLines": low,
                    "lines": lines,
                    "ocrScale": args.scale,
                    "ocrEngine": "RapidOCR ONNX Runtime",
                }
                output.write(json.dumps(row, ensure_ascii=False) + "\n")
                pages_done += 1
                if pages_done % 10 == 0 or pages_done == page_total:
                    print(f"{pages_done}/{page_total} pages: {pdf_path.name}, page {index + 1}/{len(doc)}", flush=True)
        manifest.append({
            "sourceFile": pdf_path.name,
            "sourcePath": str(pdf_path),
            "pageCount": len(doc),
            "ocrFile": output_path.name,
            "ocrPages": len(doc),
            "lowConfidencePages": low_page_count,
            "emptyPages": empty_page_count,
        })
        doc.close()

    index = {
        "book": "英美文学",
        "sourceDirectory": str(args.pdf_dir),
        "pdfCount": len(pdfs),
        "pageCount": page_total,
        "completedPages": pages_done,
        "renderScale": args.scale,
        "lowConfidenceThreshold": LOW_CONFIDENCE,
        "files": manifest,
    }
    (args.cache_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OCR complete: {pages_done}/{page_total} pages; cache: {args.cache_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
