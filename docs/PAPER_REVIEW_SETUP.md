# Research paper workflow: draft → Gemini review → Claude verification → final

Four stages, one command. The point of the fourth stage is that **Gemini's
criticism is treated as a claim to be checked, not as an instruction to
obey.** Reviewers are wrong often enough that accepting their findings
unverified would introduce errors rather than remove them.

```
1. DRAFT        Claude Code writes docs/papers/<name>.md
2. REVIEW       Gemini reads it and lists problems
                LanguageTool lists grammar issues
3. VERIFY       Claude Code checks EVERY Gemini finding against the
                repository's actual data and marks each one
                CONFIRMED / REJECTED / NEEDS-SOURCE
4. FINAL        Only CONFIRMED findings are applied. The rejected ones
                are recorded with the reason, so the record is auditable.
```

Grammarly is not in the pipeline: it has no public API outside its
Enterprise tier. LanguageTool is the open substitute. Paste the final draft
into the Grammarly editor by hand if you want a third opinion.

## One-time setup

Free Gemini key at <https://aistudio.google.com/apikey>, then:

```bash
echo 'export GEMINI_API_KEY=your-key-here' >> ~/.zprofile
source ~/.zprofile
```

LanguageTool needs no key.

## Usage

```bash
python scripts/review_draft.py docs/papers/my_paper.md
```

That runs stages 2 and 3's input. Stage 3 (verification) and stage 4 (final)
are done by Claude Code using the `/paper` command below, because verifying a
claim means reading the repository's data files — which the script cannot do.

Options: `--lang en-GB|en-US|hi`, `--model <name>`, `--skip-gemini`,
`--skip-grammar`.

The report is printed and saved as `<file>_review.md`.

## What each stage covers

| Stage | Who | Checks |
|---|---|---|
| Draft | Claude Code | writing, structure, using only real repository data |
| Review | Gemini | factual errors, overstatement, missing citations, methodological gaps, structure, the weakest point |
| Review | LanguageTool | grammar, spelling, style |
| **Verify** | **Claude Code** | **is each Gemini finding actually true, checked against `dashboard/data/`, `outputs/`, `docs/METHODOLOGY.md`** |
| Final | Claude Code | applies confirmed findings only; records rejected ones with reasons |

## Claude Code slash command

Create `.claude/commands/paper.md` in this repository with the content
below. Then `/paper <topic>` runs all four stages.

````markdown
---
description: Draft a paper, review with Gemini, verify every finding, then finalise
argument-hint: <topic or existing draft path>
---

Four stages. Do not skip stage 3.

`$ARGUMENTS` is a topic to write about, or the path to an existing draft.

## Stage 1 — Draft

Write to `docs/papers/<slug>.md`, or revise the given file in place.

Project data rules apply and are not optional:
- Every number traces to a real dataset in this repository or a cited
  external source. Never invent a figure, a percentage, or a citation.
- Where data does not exist, say so plainly rather than estimating.
- State sample sizes, thresholds, base periods and units explicitly.
- Use `[Citation Required]` where a source is needed but not yet found.
- One variety of English throughout. Formal, direct, no filler.

## Stage 2 — Independent review

```bash
python scripts/review_draft.py docs/papers/<file>.md
```

If `GEMINI_API_KEY` is unset, tell the user to get a free key at
https://aistudio.google.com/apikey. Do not skip the review silently.

## Stage 3 — Verify every finding (this is the important stage)

Gemini's review is a set of **claims to be checked**, not instructions.
Take each finding one at a time and check it against the repository's actual
data — `dashboard/data/*.json`, `outputs/`, `docs/METHODOLOGY.md`,
`docs/DATA_SOURCES.md` — and against the source the draft cites.

Mark every finding as exactly one of:

- **CONFIRMED** — the objection is correct. Quote the evidence.
- **REJECTED** — the objection is wrong. Say why, with the file and value
  that disproves it. Gemini does not have access to this repository and
  will sometimes object to figures that are in fact correct.
- **NEEDS-SOURCE** — the objection is fair but resolving it requires a
  citation or dataset that does not exist yet. Leave a
  `[Citation Required]` marker; do not invent one.

Write the verdicts to `docs/papers/<file>_verified.md` as a table:

| # | Gemini's finding | Verdict | Evidence |

Do the same for LanguageTool: it over-flags technical terms, Indian place
names and transliterated words. Reject those explicitly rather than
"fixing" correct text.

## Stage 4 — Final

Apply **only** the CONFIRMED findings to the draft. Do not apply rejected
ones. Leave NEEDS-SOURCE markers in place.

Then report to the user:
- how many findings Gemini raised, and the confirmed / rejected /
  needs-source split
- the single most serious CONFIRMED problem and how it was fixed
- the most notable REJECTED finding, and why Gemini was wrong
- what still carries a `[Citation Required]` marker

## Rules

- Never fabricate a citation to clear a `[Citation Required]` marker.
- Never change a correct number because a reviewer objected to it. Show the
  evidence and reject the finding.
- Keep three files distinct: the draft, `_review.md` (raw reviewer output),
  `_verified.md` (your verdicts). Never overwrite the raw review — it is the
  audit trail.
- If Gemini and the repository data disagree, the repository data wins, and
  you say so explicitly.
````

## Why the verification stage exists

Gemini has no access to this repository. It cannot see that Bhopal's annual
rainfall really is 1,118 mm in `mp_climate_data.json`, or that the ETCCDI
base period really is 2000–2014 as `docs/METHODOLOGY.md` states. It will
sometimes flag a correct figure as unsupported.

Accepting every finding unchecked would mean editing correct values out of
the paper to satisfy a reviewer who could not verify them. Stage 3 prevents
that, and leaves a written record of what was rejected and why — which is
itself useful when a real journal reviewer asks the same question later.
