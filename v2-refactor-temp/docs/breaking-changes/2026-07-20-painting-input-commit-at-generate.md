---
title: Painting input images now commit at generate, not on edit
category: changed
severity: notice
introduced_in_pr: '#16727'
date: 2026-07-20
---

## What changed

In the painting composer, adding or removing an input image now takes effect (persists) only when you **generate**, not continuously as you edit. A brand-new draft that is never generated already did not persist its inputs; the observable change is for an already-generated painting you re-open and edit — changing its input images without regenerating no longer autosaves those input edits, so navigating away and back restores the inputs the painting was last generated with. Prompt and parameter edits still autosave as before.

## Why this matters to the user

A user who re-opens a finished painting, swaps or removes an input image, then leaves without regenerating will find the input reverted (to the images that produced the current result) on return. This keeps a painting's stored inputs consistent with its output. It only affects input images of already-generated paintings; the normal "add inputs → generate" flow, prompts, and parameters are unchanged.

## What the user should do

Nothing — generate to commit input changes, which is what you would do anyway to see them take effect.

## Notes for release manager

- Minor. Consequence of moving painting input materialization to generate time (mirroring chat's send-time file handling) and removing the draft-window temp-session hold — same PR.
- Known asymmetry, intentionally out of scope for this PR: a persisted painting's prompt/parameters still commit on edit, while its input images commit at generate.
- Design/spec: `docs/references/file/file-entry-cleanup.md` §4.1.
