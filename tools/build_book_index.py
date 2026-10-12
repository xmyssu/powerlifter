#!/usr/bin/env python3
"""Turn a book PDF into a passage index the coach can search.

    python3 tools/build_book_index.py BOOK.pdf --title "..." --authors "..." \
        [--edition "2nd ed."] [--year 2019] [--out private/NAME.json]

The output is the book's own text, so it is copyrighted: it goes in `private/`
(git-ignored) and from there into the "Powerlifter library" folder on your
Google Drive, never into this public repository. The Apps Script searches it
there (Code.gs › book_) and returns a few passages per question.

Each passage keeps the page number printed on the page and the chapter from
the running header, so the coach can cite "p. 121" the same way the app does.
Needs pypdf (`pip install pypdf`).
"""
import argparse
import json
import os
import re
import sys

from pypdf import PdfReader

WORDS_PER_PASSAGE = 170
OVERLAP = 40


def clean_page(text, book_header):
    """Split a page into (chapter, printed page, body) using its running header."""
    lines = [l.rstrip() for l in text.splitlines()]
    chapter, page = None, None
    # Running header: CHAPTER / page number / book title, in that order.
    if len(lines) >= 3 and re.fullmatch(r"\d{1,4}", lines[1].strip()):
        chapter, page = lines[0].strip(), int(lines[1].strip())
        lines = lines[2:]
        if lines and book_header and lines[0].strip().upper() == book_header:
            lines = lines[1:]
    body = "\n".join(lines)
    body = re.sub(r"(\w)-\n(\w)", r"\1\2", body)          # hyphenated line breaks
    body = re.sub(r"[ \t]*\n[ \t]*", " ", body)
    body = re.sub(r"\s{2,}", " ", body).strip()
    return chapter, page, body


def looks_like_references(words):
    """Bibliography pages: numbered entries, years and journal abbreviations."""
    text = " ".join(words)
    return len(re.findall(r"\b(19|20)\d\d\b", text)) > len(words) / 25


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--title", required=True)
    ap.add_argument("--authors", required=True)
    ap.add_argument("--edition", default="")
    ap.add_argument("--year", type=int, default=None)
    ap.add_argument("--header", default="", help="Running title to strip from each page, e.g. the book title.")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    reader = PdfReader(args.pdf)
    header = args.header.strip().upper()
    passages = []
    for i, p in enumerate(reader.pages):
        chapter, page, body = clean_page(p.extract_text() or "", header)
        if page is None:
            page = i + 1
        words = body.split()
        if len(words) < 25 or "...." in body:      # covers, blank pages, contents
            continue
        if body.lower().startswith("references") or looks_like_references(words):
            continue
        step = WORDS_PER_PASSAGE - OVERLAP
        for start in range(0, len(words), step):
            chunk = words[start:start + WORDS_PER_PASSAGE]
            if len(chunk) < 25 and start > 0:
                break
            passages.append({"id": len(passages), "page": page, "chapter": chapter, "text": " ".join(chunk)})
            if start + WORDS_PER_PASSAGE >= len(words):
                break

    slug = re.sub(r"[^a-z0-9]+", "-", args.title.lower()).strip("-")[:60]
    out = args.out or os.path.join("private", f"{slug}.json")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({
            "v": 1,
            "title": args.title,
            "authors": args.authors,
            "edition": args.edition or None,
            "year": args.year,
            "passages": passages,
        }, f, ensure_ascii=False)
    print(f"{len(passages)} passages from {len(reader.pages)} pages -> {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
