---
title: MathJax math rendering removed
category: removed
severity: notice
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

MathJax is no longer available as a message math rendering engine. Message math rendering now uses KaTeX, and the math renderer selector has been removed from settings.

## Why this matters to the user

Users who previously selected MathJax will see formulas rendered with KaTeX instead. The old math engine preference is not migrated, and settings no longer expose a math rendering engine selector.

## What the user should do

Nothing — automatic.

## Notes for release manager

This change is part of the Markdown renderer migration from ReactMarkdown to Streamdown.
