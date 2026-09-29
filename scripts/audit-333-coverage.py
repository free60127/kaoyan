#!/usr/bin/env python3
"""Read-only coverage audit for the 2027 KC 333 website cards.

Reads the generated flashcard manifest, OCR JSONL cache, PDF directory, website
knowledge cards, and an Anki package. The Anki SQLite database is opened from
memory; source files are never modified and no input corpus is copied into the
repository. Paths can be overridden for reruns on another machine.
"""

from __future__ import annotations

import argparse
import ast
import collections
import html
import json
import os
import re
import sqlite3
import sys
import unicodedata
import zipfile
from pathlib import Path
from typing import Any


BOOK_NAMES = {
    "principles": "教育学原理",
    "china": "中国教育史",
    "foreign": "外国教育史",
    "psychology": "教育心理学",
}
OCR_PATTERNS = {
    "principles": "*教育学原理*.jsonl",
    "china": "*中国教育史*.jsonl",
    "foreign": "*外国教育史*.jsonl",
    "psychology": "*教育心理学*.jsonl",
}
APKG_BOOK_MARKERS = {
    "principles": "1教育学原理",
    "china": "2中国教育史",
    "foreign": "3外国教育史",
    "psychology": "4教育心理学",
}
PAGE_RE = re.compile(r"PDF\s*第\s*(\d+)(?:\s*[-–—~至]\s*(\d+))?\s*页")
LABEL_RE = re.compile(r"〔([^〕]+)〕")
LABEL_PREFIX_RE = re.compile(r"^\s*(?:第[一二三四五六七八九十百零〇两\d]+节|考点[一二三四五六七八九十百零〇两\d]+)\s*")
CHAPTER_RE = re.compile(r"第([一二三四五六七八九十百零〇两\d]+)章\s*([^<\n\r]+)")
HTML_TAG_RE = re.compile(r"<[^>]*>")
PAGE_SPAN_REVIEWS = (
    {
        "id": "china-k2-001",
        "book": "china",
        "cited_page": 19,
        "follow_page": 20,
        "follow_marker": "阶层方面",
    },
    {
        "id": "principles-k9-001",
        "book": "principles",
        "cited_page": 184,
        "follow_page": 185,
        "follow_marker": "教师的类别",
    },
)


def unique_match(directory: Path, pattern: str, what: str) -> Path:
    matches = sorted(directory.glob(pattern))
    if len(matches) != 1:
        raise ValueError(f"期望在 {directory} 找到一个{what}（{pattern}），实际 {len(matches)} 个")
    return matches[0]


def environment_path(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value).expanduser() if value else None


def configured_directory(path: Path | None, repo: Path, dirname: str) -> Path:
    """Resolve a supplied input directory or find its conventional sibling."""
    if path is not None:
        return path.expanduser().resolve()
    for parent in (repo, *repo.parents):
        candidate = parent / dirname
        if candidate.is_dir():
            return candidate.resolve()
    return (repo / dirname).resolve()


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return "".join(ch for ch in value if ch.isalnum())


def comparable_title(value: str) -> str:
    """Normalize punctuation/dash OCR variants common in Chinese book headings."""
    value = unicodedata.normalize("NFKC", value).casefold()
    value = re.sub(r"(?<=\d)一(?=\d)", "", value)
    value = value.replace("的", "")
    return "".join(ch for ch in value if ch.isalnum())


def parse_outline_catalog(outlines_path: Path) -> dict[str, list[list[str]]]:
    """Read the string arrays from lib/outlines.ts without importing TypeScript."""
    source = outlines_path.read_text(encoding="utf-8")
    result: dict[str, list[list[str]]] = {}
    for book in BOOK_NAMES:
        marker = re.search(rf"\b{re.escape(book)}\s*:", source)
        if marker is None:
            raise ValueError(f"{outlines_path} 缺少 {book} 大纲")
        start = source.find("[", marker.end())
        if start < 0:
            raise ValueError(f"{outlines_path} 的 {book} 大纲格式不可读")
        depth = 0
        in_string = False
        escaped = False
        end = -1
        for index in range(start, len(source)):
            char = source[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
            elif char == '"':
                in_string = True
            elif char == "[":
                depth += 1
            elif char == "]":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        if end < 0:
            raise ValueError(f"{outlines_path} 的 {book} 大纲数组未闭合")
        value = ast.literal_eval(source[start:end])
        if not isinstance(value, list) or any(not isinstance(chapter, list) for chapter in value):
            raise ValueError(f"{outlines_path} 的 {book} 大纲不是章节字符串数组")
        result[book] = value
    return result


def read_jsonl_pages(path: Path) -> dict[int, str]:
    pages: dict[int, str] = {}
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            try:
                item = json.loads(line)
                page = int(item["page"])
                text = str(item.get("text", ""))
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"OCR JSONL {path.name}:{line_number} 无法读取：{error}") from error
            if page in pages:
                raise ValueError(f"OCR JSONL {path.name} 重复页码 {page}")
            pages[page] = text
    return pages


def strip_markup(value: str) -> str:
    return html.unescape(HTML_TAG_RE.sub(" ", value)).replace("\x1f", " ")


def normalized_label_topic(value: str) -> str:
    """Remove a card's leading section/knowledge-point ordinal before matching."""
    return comparable_title(LABEL_PREFIX_RE.sub("", value))


def label_matches_section(label: str, section_norm: str) -> bool:
    topic = normalized_label_topic(label)
    return bool(topic and section_norm and (section_norm in topic or topic in section_norm))


def cited_pages(source: str) -> list[int] | None:
    """Expand one PDF page or an inclusive page range in a card citation."""
    match = PAGE_RE.search(source)
    if not match:
        return None
    first = int(match.group(1))
    last = int(match.group(2)) if match.group(2) else first
    if last < first:
        return None
    return list(range(first, last + 1))


def audit_apkg(path: Path, outlines: dict[str, list[list[str]]]) -> dict[str, Any]:
    if not zipfile.is_zipfile(path):
        raise ValueError(f"APKG 不是有效 ZIP 文件：{path}")
    with zipfile.ZipFile(path) as archive:
        if "collection.anki2" not in archive.namelist():
            raise ValueError("APKG 中未找到 collection.anki2")
        database = sqlite3.connect(":memory:")
        try:
            database.deserialize(archive.read("collection.anki2"))
            deck_data = database.execute("SELECT decks FROM col LIMIT 1").fetchone()
            model_data = database.execute("SELECT models FROM col LIMIT 1").fetchone()
            if not deck_data or not model_data:
                raise ValueError("Anki collection 缺少牌组或笔记类型元数据")
            decks = json.loads(deck_data[0])
            models = json.loads(model_data[0])
            note_count = int(database.execute("SELECT COUNT(*) FROM notes").fetchone()[0])
            card_count = int(database.execute("SELECT COUNT(*) FROM cards").fetchone()[0])
            rows = database.execute(
                "SELECT n.id, n.mid, n.flds, c.did FROM notes n JOIN cards c ON c.nid=n.id"
            ).fetchall()
            if len(rows) != note_count or len(rows) != card_count:
                raise ValueError("Anki notes/cards 存在一对多或孤儿关系，无法按卡数直接比较")

            knowledge_rows: dict[str, list[str]] = {book: [] for book in BOOK_NAMES}
            knowledge_counts = collections.Counter()
            other_model_counts = collections.Counter()
            toc_chapter_counts = collections.Counter()
            for _note_id, model_id, fields_raw, deck_id in rows:
                deck_name = decks.get(str(deck_id), {}).get("name", "")
                model_name = models.get(str(model_id), {}).get("name", "")
                fields = fields_raw.split("\x1f")
                plain_fields = [strip_markup(field) for field in fields]
                if "1知识点解析" in deck_name:
                    for book, marker in APKG_BOOK_MARKERS.items():
                        if marker in deck_name:
                            knowledge_counts[book] += 1
                            knowledge_rows[book].extend(plain_fields)
                            chapter_items = {
                                (number, title.strip(" \u3000:：、.-"))
                                for field in fields
                                for number, title in CHAPTER_RE.findall(field)
                            }
                            if chapter_items:
                                toc_chapter_counts[book] = max(
                                    toc_chapter_counts[book], len(chapter_items)
                                )
                            break
                else:
                    other_model_counts[model_name] += 1

            book_title_matches: dict[str, tuple[int, int]] = {}
            for book in BOOK_NAMES:
                sections = [section for chapter in outlines[book] for section in chapter]
                searchable = normalized(" ".join(knowledge_rows[book]))
                hits = sum(1 for section in sections if normalized(section) in searchable)
                book_title_matches[book] = (hits, len(sections))
            knowledge_total = sum(knowledge_counts.values())
            return {
                "notes": note_count,
                "cards": card_count,
                "knowledge_total": knowledge_total,
                "knowledge_counts": dict(knowledge_counts),
                "other_cards": card_count - knowledge_total,
                "other_models": dict(other_model_counts),
                "toc_chapter_counts": dict(toc_chapter_counts),
                "title_matches": book_title_matches,
            }
        finally:
            database.close()


def build_audit(args: argparse.Namespace) -> dict[str, Any]:
    repo = args.repo.resolve()
    source_root = configured_directory(args.source_root, repo, "flashcards-src")
    ocr_dir = configured_directory(args.ocr_dir, repo, "ocr-333-cache")
    pdf_dir = configured_directory(args.pdf_dir, repo, "27KC《333应试解析》(1)")
    apkg_path = args.apkg.expanduser().resolve()
    cards_path = repo / "lib" / "knowledge-cards.json"
    manifest_path = source_root / "manifest.json"
    outlines_path = repo / "lib" / "outlines.ts"
    for path in (cards_path, manifest_path, outlines_path, apkg_path):
        if not path.is_file():
            raise ValueError(f"输入文件不存在：{path}")

    cards = json.loads(cards_path.read_text(encoding="utf-8"))
    chapters = json.loads(manifest_path.read_text(encoding="utf-8"))
    outlines = parse_outline_catalog(outlines_path)
    if len(chapters) != 43:
        raise ValueError(f"源 manifest 应含 43 章，当前含 {len(chapters)} 章")

    ocr = {
        book: read_jsonl_pages(unique_match(ocr_dir, pattern, f"{BOOK_NAMES[book]} OCR 缓存"))
        for book, pattern in OCR_PATTERNS.items()
    }
    pdfs = {
        book: unique_match(pdf_dir, pattern.replace("jsonl", "pdf"), f"{BOOK_NAMES[book]} PDF")
        for book, pattern in OCR_PATTERNS.items()
    }

    cards_by_chapter: dict[tuple[str, int], list[dict[str, Any]]] = collections.defaultdict(list)
    by_id = collections.Counter()
    duplicate_fronts = collections.Counter()
    empty_cards: list[str] = []
    unparsed_source: list[str] = []
    page_outside_chapter: list[dict[str, Any]] = []
    page_missing_ocr: list[dict[str, Any]] = []
    cards_by_id: dict[str, dict[str, Any]] = {}
    for card in cards:
        card_id = str(card.get("id", "<无 ID>"))
        by_id[card_id] += 1
        cards_by_id[card_id] = card
        front = str(card.get("front", "")).strip()
        back = str(card.get("back", "")).strip()
        if not front or not back:
            empty_cards.append(card_id)
        duplicate_fronts[normalized(front)] += 1
        book = str(card.get("book", ""))
        try:
            chapter = int(card.get("chapter"))
        except (ValueError, TypeError):
            chapter = -1
        if book not in BOOK_NAMES or chapter < 1:
            continue
        cards_by_chapter[(book, chapter)].append(card)
        pages = cited_pages(str(card.get("source", "")))
        if not pages:
            unparsed_source.append(card_id)
            continue
        chapter_meta = next(
            (entry for entry in chapters if entry.get("book") == book and int(entry.get("chapter", -1)) == chapter),
            None,
        )
        if chapter_meta:
            low, high = (int(value) for value in str(chapter_meta["pages"]).split("-", 1))
            outside = [page for page in pages if page < low or page > high]
            if outside:
                page_outside_chapter.append({"id": card_id, "pages": outside, "expected": f"{low}-{high}"})
        missing = [page for page in pages if page not in ocr.get(book, {})]
        if missing:
            page_missing_ocr.append({"id": card_id, "pages": missing})
    duplicate_front_ids = [front for front, count in duplicate_fronts.items() if front and count > 1]
    duplicate_id_values = [card_id for card_id, count in by_id.items() if count > 1]

    matrix: list[dict[str, Any]] = []
    empty_outline_chapters: list[dict[str, Any]] = []
    missing_sections: list[dict[str, Any]] = []
    exact_ocr_misses: list[dict[str, Any]] = []
    expected_section_total = 0
    section_card_hits = 0
    exact_ocr_hits = 0
    all_chapter_pages_available = 0
    unoutlined_label_total = 0
    unoutlined_label_ocr_hits = 0
    for chapter_meta in chapters:
        book = str(chapter_meta["book"])
        chapter = int(chapter_meta["chapter"])
        start_page, end_page = (int(value) for value in str(chapter_meta["pages"]).split("-", 1))
        rows = cards_by_chapter.get((book, chapter), [])
        source_pages = [
            page
            for card in rows
            if (pages := cited_pages(str(card.get("source", ""))))
            for page in pages
        ]
        section_names = outlines[book][chapter - 1] if chapter <= len(outlines[book]) else []
        labels = [match.group(1).strip() for card in rows for match in LABEL_RE.finditer(str(card.get("front", "")))]
        page_texts = [ocr[book].get(page, "") for page in range(start_page, end_page + 1)]
        pages_available = sum(1 for page in range(start_page, end_page + 1) if page in ocr[book])
        if pages_available == end_page - start_page + 1:
            all_chapter_pages_available += 1
        section_info: list[dict[str, Any]] = []
        chapter_missing: list[str] = []
        chapter_ocr_misses: list[str] = []
        for section in section_names:
            section_norm = comparable_title(section)
            section_labels = [
                label for label in labels
                if label_matches_section(label, section_norm)
            ]
            count = sum(
                1 for card in rows
                if any(
                    label_matches_section(label, section_norm)
                    for label in LABEL_RE.findall(str(card.get("front", "")))
                )
            )
            card_covered = count > 0
            ocr_covered = bool(section_norm and section_norm in comparable_title(" ".join(page_texts)))
            expected_section_total += 1
            section_card_hits += int(card_covered)
            exact_ocr_hits += int(ocr_covered)
            section_info.append({"name": section, "cards": count, "labels": section_labels, "ocr": ocr_covered})
            if not card_covered:
                chapter_missing.append(section)
                missing_sections.append({"book": book, "chapter": chapter, "section": section})
            if not ocr_covered:
                chapter_ocr_misses.append(section)
                exact_ocr_misses.append({"book": book, "chapter": chapter, "section": section})
        label_counts = collections.Counter(labels)
        observed_labels = [
            {
                "name": label,
                "cards": count,
                "ocr": bool(normalized_label_topic(label) and normalized_label_topic(label) in comparable_title(" ".join(page_texts))),
            }
            for label, count in label_counts.items()
        ]
        if not section_names:
            unoutlined_label_total += len(observed_labels)
            unoutlined_label_ocr_hits += sum(item["ocr"] for item in observed_labels)
            empty_outline_chapters.append(
                {"book": book, "chapter": chapter, "labels": dict(label_counts), "label_details": observed_labels}
            )
        matrix.append(
            {
                "book": book,
                "chapter": chapter,
                "pages": f"{start_page}-{end_page}",
                "cards": len(rows),
                "card_pages": f"{min(source_pages)}-{max(source_pages)}" if source_pages else "无",
                "sections": section_info,
                "missing_sections": chapter_missing,
                "ocr_misses": chapter_ocr_misses,
                "outline_missing": not section_names,
                "labels": dict(collections.Counter(labels)),
                "label_details": observed_labels,
                "ocr_range_pages": f"{pages_available}/{end_page-start_page+1}",
            }
        )

    apkg = audit_apkg(apkg_path, outlines)
    page_span_reviews = []
    for review in PAGE_SPAN_REVIEWS:
        card = cards_by_id.get(review["id"])
        actual_source = cited_pages(str(card.get("source", ""))) if card else None
        follow_text = ocr[review["book"]].get(review["follow_page"], "")
        page_span_reviews.append(
            {
                **review,
                "found": card is not None,
                "source_page": actual_source,
                "follow_page_cited": bool(actual_source and review["follow_page"] in actual_source),
                "follow_page_marker_found": normalized(review["follow_marker"]) in normalized(follow_text),
            }
        )
    return {
        "card_total": len(cards),
        "matrix": matrix,
        "chapter_count": len(chapters),
        "book_chapter_counts": dict(collections.Counter(str(item["book"]) for item in chapters)),
        "book_card_counts": dict(collections.Counter(str(card.get("book")) for card in cards)),
        "expected_section_total": expected_section_total,
        "section_card_hits": section_card_hits,
        "exact_ocr_hits": exact_ocr_hits,
        "all_chapter_pages_available": all_chapter_pages_available,
        "unoutlined_label_total": unoutlined_label_total,
        "unoutlined_label_ocr_hits": unoutlined_label_ocr_hits,
        "label_total": sum(len(chapter["label_details"]) for chapter in matrix),
        "label_ocr_hits": sum(
            item["ocr"] for chapter in matrix for item in chapter["label_details"]
        ),
        "empty_outline_chapters": empty_outline_chapters,
        "missing_sections": missing_sections,
        "exact_ocr_misses": exact_ocr_misses,
        "empty_cards": empty_cards,
        "duplicate_front_count": len(duplicate_front_ids),
        "duplicate_ids": duplicate_id_values,
        "unparsed_source": unparsed_source,
        "page_outside_chapter": page_outside_chapter,
        "page_missing_ocr": page_missing_ocr,
        "page_span_reviews": page_span_reviews,
        "pdf_count": len(pdfs),
        "apkg": apkg,
    }


def print_summary(result: dict[str, Any]) -> None:
    print("333 闪卡覆盖审计")
    print(f"网站卡片：{result['card_total']}；章节：{result['chapter_count']}/43")
    print(
        f"已列节位卡片标签覆盖：{result['section_card_hits']}/{result['expected_section_total']}；"
        f"OCR 节标题精确字串命中：{result['exact_ocr_hits']}/{result['expected_section_total']}；"
        f"OCR 章节页范围完整：{result['all_chapter_pages_available']}/43"
    )
    print(
        f"目录未列节的章节：网站标签 {result['unoutlined_label_ocr_hits']}/"
        f"{result['unoutlined_label_total']} 类可在该章 OCR 页找到同名词串"
    )
    print(
        f"全部章内网站标签：{result['label_ocr_hits']}/{result['label_total']} 类可在本章 OCR 页找到"
        "同名词串（忽略编号、标点、常见 OCR 横线与‘的’字差异）"
    )
    print(
        f"空卡：{len(result['empty_cards'])}；重复题面：{result['duplicate_front_count']}；"
        f"重复 ID：{len(result['duplicate_ids'])}；未解析页码：{len(result['unparsed_source'])}；"
        f"越出章节页范围：{len(result['page_outside_chapter'])}；引用页不在 OCR：{len(result['page_missing_ocr'])}"
    )
    verified_spans = sum(
        item["found"]
        and item["source_page"]
        and item["source_page"][0] == item["cited_page"]
        and item["follow_page_cited"]
        and item["follow_page_marker_found"]
        for item in result["page_span_reviews"]
    )
    print(f"人工跨页出处复核：引用覆盖首尾页且后页 OCR 有对应内容 {verified_spans}/{len(result['page_span_reviews'])} 张")
    apkg = result["apkg"]
    print(
        f"APKG：{apkg['cards']} 卡；知识点解析 {apkg['knowledge_total']} 卡；"
        f"其他题组 {apkg['other_cards']} 卡"
    )
    print("APKG 与网站卡片数（仅说明体量，不能据此判定缺卡）：")
    for book in BOOK_NAMES:
        title_hits, title_total = apkg["title_matches"].get(book, (0, 0))
        print(
            f"  {BOOK_NAMES[book]}：网站 {result['book_card_counts'].get(book, 0)}；"
            f"APKG {apkg['knowledge_counts'].get(book, 0)}；"
            f"APKG 字段章标题数（启发式）{apkg['toc_chapter_counts'].get(book, 0)}；"
            f"同名节标题 {title_hits}/{title_total}"
        )
    print("43 章矩阵：每章卡数 / 已列节位卡片覆盖 / OCR 精确标题命中 / 引用页范围")
    for chapter in result["matrix"]:
        section_count = len(chapter["sections"])
        covered = sum(section["cards"] > 0 for section in chapter["sections"])
        ocr_hits = sum(section["ocr"] for section in chapter["sections"])
        section_status = f"{covered}/{section_count}" if section_count else f"未列节（{len(chapter['labels'])}类卡片标签）"
        ocr_status = f"{ocr_hits}/{section_count}" if section_count else "—"
        print(
            f"  {BOOK_NAMES[chapter['book']]} 第{chapter['chapter']}章：{chapter['cards']} 卡；"
            f"节位 {section_status}；OCR {ocr_status}；卡片 PDF 页 {chapter['card_pages']}"
        )
    if result["missing_sections"]:
        print(f"节位无卡片标签：{result['missing_sections']}")
    if result["page_outside_chapter"]:
        print(f"页码越界卡片：{result['page_outside_chapter']}")
    if result["exact_ocr_misses"]:
        print(
            "提示：OCR 精确标题未命中的节位逐项列在 docs/audits/333-coverage.md；"
            "不能仅据 OCR 未命中判定内容缺失。"
        )
    print("详细章节与节标题矩阵见 docs/audits/333-coverage.md。")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--source-root",
        type=Path,
        default=environment_path("AUDIT_333_SOURCE_ROOT"),
        help="源 manifest 目录；默认从仓库目录及其上级查找 flashcards-src，或设置 AUDIT_333_SOURCE_ROOT",
    )
    parser.add_argument(
        "--ocr-dir",
        type=Path,
        default=environment_path("AUDIT_333_OCR_DIR"),
        help="OCR JSONL 缓存目录；默认从仓库目录及其上级查找 ocr-333-cache，或设置 AUDIT_333_OCR_DIR",
    )
    parser.add_argument(
        "--pdf-dir",
        type=Path,
        default=environment_path("AUDIT_333_PDF_DIR"),
        help="PDF 输入目录；默认从仓库目录及其上级查找 27KC《333应试解析》(1)，或设置 AUDIT_333_PDF_DIR",
    )
    parser.add_argument(
        "--apkg",
        type=Path,
        default=environment_path("AUDIT_333_APKG"),
        help="Anki package 路径；也可设置 AUDIT_333_APKG",
    )
    parser.add_argument("--details", action="store_true", help="在43章摘要后列出每章各卡片节标签及OCR同名命中")
    args = parser.parse_args()
    if args.apkg is None:
        parser.error("请通过 --apkg 或 AUDIT_333_APKG 指定 Anki package 路径")
    try:
        result = build_audit(args)
        print_summary(result)
        if args.details:
            print("每章网站节标签明细（×卡数；✓=OCR章页有同名词串，△=未精确匹配）：")
            for chapter in result["matrix"]:
                labels = "；".join(
                    f"{item['name']}×{item['cards']}{'✓' if item['ocr'] else '△'}"
                    for item in chapter["label_details"]
                ) or "无标签"
                print(f"  {BOOK_NAMES[chapter['book']]} 第{chapter['chapter']}章：{labels}")
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, sqlite3.Error, json.JSONDecodeError) as error:
        print(f"审计失败：{error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
