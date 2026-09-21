---
type: SessionRecord
id: karpathy-session-c4b22a71f7964a54
title: Karpathy session c4b22a71f796
tags:
- karpathy
- session-learning
sources:
- session:4141ece4-2ce1-4151-8def-3102b43ff3fd
timestamp: 2026-09-21T10:43:37.661012+00:00
created_at: 2026-09-21T10:43:37.661012+00:00
updated_at: 2026-09-21T10:43:37.661012+00:00
revision: 0
---

## Delta

## Implementation Complete

**Change:** rebrand-002-branding-module
**Schema:** spec-driven
**Progress:** 3/3 tasks complete ✓ · Commit `8e4e03d`

### Completed This Session
- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

### What landed

`src/shared/utils/branding.ts` — a pure leaf module (**zero imports**) holding `PRODUCT_NAME`, `APP_ID`, `COMPANY_NAME`, `APP_SLUG`, `HOME_DIRNAME`, and the attribution pair.

Two call sites migrated as proof of concept: `http.ts` (the `HTTP-Referer`/`X-Title` headers sent to every AI provider) and `openapiDocs.ts` (both API titles).

**Verification:** `pnpm test:main` → **1031 files / 16,381 tests passed, 0 failed** · `pnpm lint` → exit 0.

### Two deviations worth knowing about

**Module location changed.** The plan said `src/shared/branding/`, but `shared-layer.md:56` is categorical — *"a new capability never earns a new top-level dir"*. I put it in `utils/`, which also turned out to be where `APP_NAME = 'Cherry Studio'` already lived. There was a partial indirection to extend rather than a greenfield.

**`CHERRY_HOME_DIRNAME` stayed duplicated**, per your choice. Reciprocal comments now link the preboot constant and the branding module so the coupling is visible from both sides. `rebrand-003` owns the actual move.

### On the tests

Four test files asserted the brand as a literal. Rather than swap `'Cherry Studio'` → `'The Boss'` — which would just re-pin a new brand — I repointed them at the constants. They now assert *"attribution headers are sent"*, which is the actual contract, and will survive the next rename.

I also regenerated 11 inline snapshots, but only after confirming the diff was **exclusively** the two attribution headers. Two further failures turned out not to be snapshots at all but `toEqual` literals that `-u` can't touch.

One test, `builder.test.ts`, timed out under full-suite load. I checked it against a stashed baseline and in isolation with my changes — passes both ways, and passed in the final full run. Flaky watcher timing, not a regression.

Next: `/opsx:apply rebrand-003-explicit-userdata` — the **critical** one. It pins `userData` explicitly so the rename in 004 can't silently orphan user profiles.

## Root Cause

No explicit root-cause section was captured; preserve this as a session record, not an inferred diagnosis.

## Corrective Actions

Review and promote only reusable findings.

## Session Metadata

- Harness: claude-code
- Session: 4141ece4-2ce1-4151-8def-3102b43ff3fd
- Captured: 2026-09-21T10:43:22.104792Z
- Project: /Users/gqadonis/Projects/prometheus/the-boss

## Changed Paths

- No changed paths detected.
