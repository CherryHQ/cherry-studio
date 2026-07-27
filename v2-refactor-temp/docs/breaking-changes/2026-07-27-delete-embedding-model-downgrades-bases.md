---
title: Deleting an embedding model now downgrades the knowledge bases using it to keyword search
category: changed
severity: notice
introduced_in_pr: #17482
date: 2026-07-27
---

## What changed

Deleting an embedding model in Settings → Model Service used to fail outright when any knowledge base still used it. It now opens a confirmation dialog listing the affected knowledge bases, and confirming switches those bases to BM25 keyword retrieval — discarding their stored vectors — before the model is removed.

## Why this matters to the user

Previously there was no way to delete such a model at all; the only escape was to delete or rebuild every knowledge base that referenced it. Now the deletion goes through, but the affected bases stop answering semantically: they keep every document and still return keyword matches, and their results will read as less relevant than before. Bases already in a failed state are downgraded too so the deletion can proceed, but they stay failed and still need a manual restore.

## What the user should do

Nothing is required — the dialog states which bases are affected before anything happens, and cancelling leaves everything untouched. To bring semantic search back on a downgraded base, configure an embedding model on it again and let it re-index; the vectors are not recoverable, so this is a full re-embed rather than a resume.

## Notes for release manager

Worth pairing with a screenshot of the confirmation dialog — the list of affected bases is the part that makes the consequence legible. Note that a different-dimension model can safely be chosen afterwards; that is precisely why the old vectors are discarded rather than kept.
