# Agent Note: Resolve Plan Mode hint imports on case-insensitive filesystems

Status: implemented

English | [中文](2026-11-07-plan-hint-import-resolution.zh.md)

## Problem

The Plan Mode component was named `PlanModeHint.tsx`, while its hook lived in `planModeHint.ts`. On a case-insensitive filesystem, resolving the component import tried `.ts` first and selected the hook. The macOS renderer build failed because that module does not export `PlanModeHint`.

## Decision

Name the hook module `usePlanModeHint.ts` and update its consumers. Its basename follows the hook naming convention and differs from the component beyond letter case. The follow-up history work (#23904, specified in Step A of the [history-operation proposal](../../proposed/architecture/2026-11-08-agent-history-operation-boundaries.md)) later removed the draft-hint path entirely — `PlanModeHint.tsx`, `usePlanModeHint.ts`, the dedicated test and the `AgentComposer.tsx` wiring are gone in favor of explicit Plan/Goal Quick Panel entries — so no case-colliding module pair remains.

## Alternatives considered

Adding an explicit `.tsx` extension to the component import would leave the ambiguous module names in place. Distinct basenames fix resolution for every consumer.

## Consequences

The renderer has no hint modules left to misresolve: Plan Mode eligibility, draft state and presentation are unchanged, and extensionless `./agent/*` imports can no longer collapse two stems by letter case. `pnpm check:case-collisions` (wired into `pnpm lint`) guards this pattern on Linux CI, where the original collision was invisible.

## Verification

- Regression — The macOS Electron build failed with the original names and passes after the rename. All 173 focused composer, token and plan-intent tests pass. Hosted macOS and Windows desktop acceptance remains tracked by the PR.
- Regression — `tsrs --noEmit -p tsconfig.web.json --composite false` and `tsrs --noEmit -p tsconfig.e2e.json` pass on Windows; `tests/e2e/smoke/resourceCreateWizardActivity.test.ts` imports `selectVisibleModel` from `../regression/helpers/models`.
- Regression — `pnpm check:case-collisions` reports no TypeScript-resolvable case-only stem collisions, and `scripts/__tests__/check-case-sensitive-collisions.test.ts` covers the original `PlanModeHint.tsx`/`planModeHint.ts` pair.
