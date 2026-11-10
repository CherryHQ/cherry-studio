# Agent Note: Resolve Plan Mode hint imports on case-insensitive filesystems

Status: implemented

English | [中文](2026-11-07-plan-hint-import-resolution.zh.md)

## Problem

The Plan Mode component was named `PlanModeHint.tsx`, while its hook lived in `planModeHint.ts`. On a case-insensitive filesystem, resolving the component import tried `.ts` first and selected the hook. The macOS renderer build failed because that module does not export `PlanModeHint`.

## Decision

Name the hook module `usePlanModeHint.ts` and update its consumers. Its basename now follows the hook naming convention and differs from the component beyond letter case.

## Alternatives considered

Adding an explicit `.tsx` extension to the component import would leave the ambiguous module names in place. Distinct basenames fix resolution for every consumer.

## Consequences

The renderer can resolve both modules without changing Plan Mode eligibility, draft state or presentation.

## Verification

- Regression — The macOS Electron build failed with the original names and passes after the rename. All 173 focused composer, token and plan-intent tests pass. Hosted macOS and Windows desktop acceptance remains tracked by the PR.
