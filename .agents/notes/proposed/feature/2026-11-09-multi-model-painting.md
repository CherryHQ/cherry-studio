# Agent Note: Multi-model parallel image generation in Painting

Status: proposed

English | [中文](2026-11-09-multi-model-painting.zh.md)

## Problem

The Painting page sends one prompt to one provider and model. A painting row stores a single `providerId` and `modelId`, and its parameters are draft-only, so none of the state needed to compare several models survives a send or a restart. Comparing FLUX, gpt-image-1, and Imagen today means re-entering the prompt for each model and switching between results by hand. The request is tracked in [Issue #15014](https://github.com/CherryHQ/cherry-studio/issues/15014). The v2 Painting refactor it depends on, [Issue #14207](https://github.com/CherryHQ/cherry-studio/issues/14207), is closed.

## Proposal

A painting draft holds one or more **targets**. A target is a `providerId` and `modelId` plus optional per-target parameter overrides. A draft with one target follows exactly today's path.

Submitting a draft with N targets starts N independent generations, all concurrent. Each target creates its own `painting` row, which keeps its own provider, model, parameters, output files, and generation state, and failure stays local to that row. All N rows share a nullable `batch_id`, added by an appended migration. The shared prompt is stored on each row, so no separate batch table is needed.

The UI is one column per target, in a horizontally scrollable grid. Each column shows the model name, its images, its status (pending, generating, done, or failed), and the parameters it used. The column's existing actions (save, remix, copy prompt, regenerate this target, delete) act on that row only. Target selection is a multi-select in the existing model selector. The chat-side `@` mention is out of scope for this Spec.

Reference images are sent to targets whose model accepts image input. Other targets generate from the prompt alone, and their column shows a notice that references are unsupported. The single-target path keeps its current reference behavior.

The history strip shows each `batch_id` group as one entry with its output thumbnails. Opening the entry restores the grid from the stored rows.

## Alternatives considered

- **One row holding a `results` array.** Rejected: per-column regenerate, delete, and file-reference ownership would all have to be reimplemented inside one row.
- **A separate `painting_batch` table.** Rejected for now: the only batch-level data is the shared prompt and a group id, which a column on the row already holds.
- **Client-only grouping with no persistence.** Rejected: batches would vanish on restart, which the history requirement excludes.
- **Moving fan-out into the main-process generation service.** Deferred: it would fix the renderer-side abort bookkeeping noted in `paintingAbortControllerStore.ts`, but that refactor is larger than this feature and should be its own Spec.

## Acceptance criteria

- AC1 — A single-target draft submits exactly one row with no `batch_id` and shows no grid chrome (verification: renderer)
- AC2 — N targets start N concurrent requests, each with the shared prompt and its own provider, model, and parameters, all sharing one `batch_id` (verification: unit)
- AC3 — A failing target shows its error and a retry action in its own column while the other targets run to completion (verification: renderer)
- AC4 — A per-target parameter override reaches only that target's request; untouched parameters use that target's defaults (verification: unit)
- AC5 — Regenerating one column replaces only that row's output and leaves the other columns unchanged (verification: renderer)
- AC6 — Reference images reach image-input targets; other targets generate from the prompt and show a notice in their column (verification: unit, renderer)
- AC7 — Reopening a batch from history restores one grouped entry and the same grid, with each column's stored parameters (verification: renderer, Electron)
- AC8 — The appended migration adds the nullable `batch_id` column and migrates forward on a populated database (verification: unit)
- AC9 — Four columns fit without horizontal scrolling at a standard desktop width, and narrower windows scroll horizontally instead of wrapping (verification: renderer, Electron)
- AC10 — The Spec note and its Chinese pair pass the docs gate (verification: docs gate)

## Risks

- **Cost.** One send becomes N paid requests. The draft should show the target count before submit.
- **Renderer-held abort controllers.** Batches interrupted by a reload leave rows in `running`. The existing recovery path must cover every row in a batch, not only the visible draft.
- **Provider rate limits** can fail several targets at once. Each failure stays local to its column, per AC3.
- **Conflict with pending reference-image guard work.** [PR #22541](https://github.com/CherryHQ/cherry-studio/pull/22541) rejects reference images on models without image input. AC6 requires a per-column notice instead, so one of the two must give way.

## Decisions

Approved by the maintainer on 2026-11-09.

- **D1 — Phasing.** Two layers. Layer 1 covers AC1–AC6, AC8, AC9 and the schema from AC8: fan-out, per-column state, the grid, and the shared migration. Layer 2 covers AC7 (grouped history entry and restore) and moves this note to implemented.
- **D2 — Persisting parameters.** The `painting` row gains a parameters snapshot column in the same migration as `batch_id`. Reopened batches show each column's stored parameters.
- **D3 — Reference images.** In multi-target drafts, non-image targets generate from the prompt with a per-column notice. This supersedes the rejection in PR #22541 for multi-target drafts only; the single-target path is unchanged.
- **D4 — Target cap.** No cap. Columns beyond four scroll horizontally.
