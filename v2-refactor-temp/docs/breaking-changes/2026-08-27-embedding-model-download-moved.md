---
title: Local embedding model downloads now use the app's own network settings
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-08-27
---

## What changed

The knowledge-base embedding model is now downloaded by the app itself instead of by the
machine-learning library that loads it. Every file is checksum-verified as it arrives, and
a download that is interrupted keeps whatever already finished instead of starting over.

## Why this matters to the user

Downloads follow the app's configured proxy exactly as every other download does, so a user
whose proxy worked for model downloads elsewhere in the app but not for the embedding model
should now see it work. A corrupted or intercepted download is rejected on arrival rather
than surfacing later as a model that fails to load. Resuming after a failure only fetches
what is still missing, not the full ~614MB again.

## What the user should do

Nothing — automatic. An embedding model already downloaded stays installed and is not
re-downloaded; where its files sit in a superseded layout, the app moves them itself on
first use.

## Notes for release manager

Users who downloaded the model from the ModelScope mirror have it under an extra `master/`
directory. That copy is relocated automatically; if the move cannot complete (e.g. the files
are momentarily in use), the model keeps working from where it is and the app retries later.
Nothing is ever deleted or re-downloaded as a result.
