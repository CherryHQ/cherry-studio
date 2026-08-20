---
title: Translated PDFs are kept in translation history and the file manager
category: changed
severity: notice
introduced_in_pr: "#17980"
date: 2026-08-06
---

## What changed

A layout-preserving PDF translation now records itself in Translation History like a text translation does, and the generated PDF is handed to the file manager instead of living in a temporary folder that was deleted as soon as the pane closed. The history entry shows the two file names, and opening it offers the translated PDF (open, show in folder, save as) plus a "Side-by-side preview" action that reopens the original and the translation in the Translate page. The source PDF is only referenced by path — it is never copied and never deleted.

## Why this matters to the user

Before this change, a translation that was not exported immediately was lost, along with the tokens it cost. Now every finished translation is browsable, re-openable, and appears under Files. The retention rule is the flip side: deleting a PDF history entry also reclaims its translated PDF, and Clear History reclaims all of them. Translating the same PDF twice keeps both runs as separate entries.

## What the user should do

Nothing — automatic. Use "Save as" first if a translated PDF should outlive its history entry.

## Notes for release manager

Extends [2026-07-13-pdf-layout-translation.md](./2026-07-13-pdf-layout-translation.md) (#17007) — merge the two entries at release time. Reclaiming a translated PDF is not instantaneous: it goes through the normal unreferenced-file cleanup pass. An older entry may disappear almost immediately; a new one typically lingers for up to about 90 minutes, and active use can defer the idle-gated cleanup longer.
