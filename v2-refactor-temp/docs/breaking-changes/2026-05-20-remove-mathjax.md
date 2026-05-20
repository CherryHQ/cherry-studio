---
title: MathJax math rendering removed
category: removed
severity: notice
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

MathJax is no longer available as a message math rendering engine. KaTeX is now the only enabled math renderer, or users can choose to disable math rendering.

## Why this matters to the user

Users who previously selected MathJax will see formulas rendered with KaTeX instead. The math engine setting no longer shows a MathJax option.

## What the user should do

Nothing — automatic.

## Notes for release manager

This change is part of the Markdown renderer migration from ReactMarkdown to Streamdown.
