---
title: Large tool outputs are now trimmed relative to the model's context window
category: changed
severity: notice
introduced_in_pr: feat/context-build-truncation
date: 2026-08-04
---

## What changed

The in-flight tool-output trim threshold is no longer the raw character setting. It is now `min(configured chars, 10% of the model's context window)`, floored at 2000 chars. The persist-time threshold (what gets written to the database) still uses the plain character setting — it guards database size and reload cost, which do not depend on the window.

`fs_read`'s per-call output cap also follows the resolved setting now, instead of staying pinned to the 100 000-character compile-time default.

## Why this matters to the user

A fixed character threshold meant very different things per model: the 100 000-char default is about 3% of a 1M-token window but several times a 16k one. On small-window models it therefore never fired, and a single large tool result could consume most of the request — which showed up as tool-heavy conversations degrading much faster on small models than on large ones.

With the change, the same conversation on a 16k-window model trims tool results at ~4800 chars, while a 200k-window model trims at ~60 000 — both roughly 10% of the window. Users on small-window models will see `<persisted-output>` markers (with `fs_read` read-back) appear on outputs that previously passed through whole; users on large-window models see little or no change. Nothing is lost — the full output is still retrievable via `fs_read`.

## What the user should do

Nothing. To trim more or less aggressively, adjust the tool-output threshold in the context-management settings (globally, or per assistant); it still acts as the upper bound.

## Notes for release manager

Motivation came from a long-horizon runtime test: across 2697 real tool results, the 100 000-char threshold caught only 0.1% (2 results), so the persistence path effectively never engaged, while p99 was 57 301 chars — roughly 14–17k tokens, which is most of a 16k window in a single result.

The character-to-token conversion uses a deliberately conservative 3 chars/token (`APPROX_CHARS_PER_TOKEN`). Tool outputs are overwhelmingly code/JSON/logs, so the English-ish ratio is the right base case; CJK-heavy output gets a somewhat larger token share than nominal, bounded by the explicit character setting.
