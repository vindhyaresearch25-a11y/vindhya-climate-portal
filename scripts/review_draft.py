"""
review_draft.py — independent review of a research draft.

Sends a draft through two independent checkers and prints one merged report:

  1. Gemini      — scientific/technical review: claims, logic, structure,
                   missing citations, overstatement
  2. LanguageTool — grammar, style, spelling (free, no key, open source)

Grammarly has no public API outside its Enterprise tier, so LanguageTool
stands in for the grammar pass. Run Grammarly manually in the browser for a
final polish if you want a third opinion.

Usage:
    export GEMINI_API_KEY=...            # get one at aistudio.google.com
    python scripts/review_draft.py docs/my_paper.md
    python scripts/review_draft.py docs/my_paper.md --lang en-GB
    python scripts/review_draft.py docs/my_paper.md --skip-gemini

Output goes to stdout and to <draft>_review.md next to the draft.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LANGUAGETOOL_URL = "https://api.languagetool.org/v2/check"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent?key={key}"
)
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

TIMEOUT = 120
RETRIES = 3

REVIEW_PROMPT = """You are reviewing a draft research paper for an Indian
agricultural climate research platform. Be a demanding but fair reviewer.

Report under exactly these headings, and be specific — quote the sentence you
are objecting to:

1. FACTUAL ERRORS
   Anything stated as fact that is wrong, outdated, or unverifiable.

2. OVERSTATEMENT
   Claims stronger than the evidence supports. Flag every "proves",
   "demonstrates", "significant" that is not backed by a stated test.

3. MISSING CITATIONS
   Statements that need a source and do not have one. Say what kind of
   source is needed.

4. METHODOLOGICAL GAPS
   Missing sample sizes, undefined thresholds, unstated assumptions,
   absent uncertainty, base periods not specified.

5. STRUCTURE AND FLOW
   Sections out of order, repetition, buried conclusions.

6. WHAT A REVIEWER WILL ATTACK FIRST
   The single weakest point. Be blunt.

7. WHAT IS GOOD
   Genuine strengths, briefly. Do not pad this.

Do not rewrite the paper. Do not be polite about weak arguments.

--- DRAFT BEGINS ---
{text}
--- DRAFT ENDS ---
"""


def post_json(url: str, payload: dict | None = None,
              form: dict | None = None) -> dict:
    """POST with retries. Either JSON body or form-encoded body."""
    last = None
    for attempt in range(RETRIES):
        try:
            if form is not None:
                data = urllib.parse.urlencode(form).encode()
                headers = {"Content-Type": "application/x-www-form-urlencoded"}
            else:
                data = json.dumps(payload).encode()
                headers = {"Content-Type": "application/json"}
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read())
        except Exception as exc:
            last = exc
            if attempt < RETRIES - 1:
                time.sleep(3)
    raise RuntimeError(str(last))


# ---------------------------------------------------------------------------
# LanguageTool
# ---------------------------------------------------------------------------
def languagetool_check(text: str, lang: str) -> str:
    """Grammar and style. Free public endpoint, rate-limited by size."""
    # The public endpoint caps request size; review in chunks on paragraph
    # boundaries so no sentence is split across chunks.
    chunks, cur = [], ""
    for para in text.split("\n\n"):
        if len(cur) + len(para) > 18000:
            chunks.append(cur)
            cur = para
        else:
            cur += ("\n\n" if cur else "") + para
    if cur:
        chunks.append(cur)

    lines = []
    total = 0
    for i, chunk in enumerate(chunks):
        try:
            res = post_json(LANGUAGETOOL_URL,
                            form={"text": chunk, "language": lang})
        except Exception as exc:
            lines.append(f"  (chunk {i + 1} failed: {exc})")
            continue
        for m in res.get("matches", []):
            total += 1
            ctx = m.get("context", {})
            snippet = ctx.get("text", "")
            off, ln = ctx.get("offset", 0), ctx.get("length", 0)
            marked = snippet[:off] + "[[" + snippet[off:off + ln] + "]]" + \
                snippet[off + ln:]
            repl = ", ".join(r["value"] for r in m.get("replacements", [])[:3])
            lines.append(
                f"  - {m.get('message', '')}\n"
                f"      {marked.strip()}\n"
                + (f"      suggested: {repl}\n" if repl else "")
            )
        if i < len(chunks) - 1:
            time.sleep(2)  # be polite to the free endpoint

    header = f"{total} grammar/style issues found by LanguageTool ({lang})"
    return header + "\n\n" + ("\n".join(lines) if lines else "  None.")


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------
def gemini_review(text: str, model: str) -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return ("SKIPPED — GEMINI_API_KEY is not set.\n"
                "  Get a free key at https://aistudio.google.com/apikey\n"
                "  then:  export GEMINI_API_KEY=your-key")

    url = GEMINI_URL.format(model=model, key=key)
    payload = {
        "contents": [{"parts": [{"text": REVIEW_PROMPT.format(text=text)}]}],
        "generationConfig": {"temperature": 0.2},
    }
    try:
        res = post_json(url, payload=payload)
    except Exception as exc:
        return (f"FAILED — {exc}\n"
                f"  Model tried: {model}. Set GEMINI_MODEL to another model "
                f"name if this one is unavailable on your key.")

    try:
        return res["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return "FAILED — unexpected response shape:\n" + json.dumps(res)[:800]


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("draft", help="path to the draft (.md or .txt)")
    ap.add_argument("--lang", default="en-GB",
                    help="LanguageTool language code (en-GB, en-US, hi)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--skip-gemini", action="store_true")
    ap.add_argument("--skip-grammar", action="store_true")
    args = ap.parse_args()

    path = Path(args.draft)
    if not path.exists():
        print(f"No such file: {path}", file=sys.stderr)
        return 1

    text = path.read_text(encoding="utf-8")
    words = len(text.split())
    print(f"Reviewing {path.name} — {words:,} words, {len(text):,} characters\n")

    parts = [
        f"# Review of `{path.name}`",
        f"\n{words:,} words. Generated {time.strftime('%Y-%m-%d %H:%M')}.\n",
    ]

    if not args.skip_gemini:
        print("Running Gemini scientific review...")
        parts += ["\n---\n\n## 1. Scientific review (Gemini)\n",
                  gemini_review(text, args.model)]

    if not args.skip_grammar:
        print("Running LanguageTool grammar check...")
        parts += ["\n---\n\n## 2. Grammar and style (LanguageTool)\n",
                  languagetool_check(text, args.lang)]

    parts += [
        "\n---\n\n## 3. Final polish\n",
        "LanguageTool covers grammar and style. Grammarly has no public API "
        "outside its Enterprise tier, so for a third opinion paste the draft "
        "into the Grammarly editor manually before submission.\n",
    ]

    report = "\n".join(parts)
    out = path.with_name(path.stem + "_review.md")
    out.write_text(report, encoding="utf-8")

    print("\n" + report)
    print(f"\n\nSaved: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
