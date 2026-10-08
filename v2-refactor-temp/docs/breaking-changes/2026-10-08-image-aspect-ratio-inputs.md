---
title: Image aspect ratios use one canonical format
category: changed
severity: breaking
introduced_in_pr: '#20140'
date: '2026-10-08'
---

## What changed

Image aspect ratios use `width:height`, such as `16:9`, across the model catalog,
painting controls and image tool requests. Legacy aliases such as `ASPECT_16_9`
and `16x9` are rejected, and the `size` field no longer supplies a missing ratio.
Automatic selection is available only where the model explicitly supports it.

## Why this matters to the user

A ratio selected from the model's supported options must reach generation without
being silently changed or dropped. Existing custom requests using legacy aliases
need to use `aspectRatio` with the canonical value instead.

## What the user should do

Use the model's offered ratio choices, or pass a supported value such as
`aspectRatio: '16:9'` in image requests. Omit the field to leave it unspecified;
use `auto` only when it is offered. Do not put a ratio in `size`.

## Notes for release manager

Publication remains blocked on the registry schema/frozen-validator and
first-compatible-app decisions recorded in the image-generation contract.
The new client rejects legacy catalog aliases; the coordinated release/cache
handling is TBD. Do not publish this as an already accepted compatibility rollout.
