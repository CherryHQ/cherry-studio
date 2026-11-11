# Agent Note: Prebundle UI date dependencies in DOM tests

Status: implemented

English | [中文](2026-11-11-ui-test-dependency-prebundling.zh.md)

## Problem

Importing the UI public entry also loads its date picker. Isolated DOM test files repeatedly load the `react-day-picker` and `date-fns` module trees even when their subject is another component. In a six-file collection-only profile, import evaluation took 6.81–7.41 seconds; test cases were deliberately skipped for this measurement.

## Decision

Enable Vitest's client dependency optimizer in the shared test configuration for `@cherrystudio/ui > date-fns` and `@cherrystudio/ui > react-day-picker`. The nested dependency identifiers resolve through the UI workspace's declared dependencies under pnpm. Keep workspace UI sources outside the optimizer so component mocks retain their source boundaries. Node projects retain their existing SSR dependency handling.

Use the built-in optimizer cache inside the workspace's `node_modules`. Do not add CI cache actions, replace real components with mocks, disable test isolation, or change worker limits and shard counts.

## Alternatives considered

- Redirecting `date-fns` to its CommonJS entry improved the collection-only command less than prebundling and changed the selected module variant.
- Node compile caching did not show a stable benefit in the earlier fixed-file experiment and does not collapse these import trees.
- Rewriting UI public exports or consumer imports expands a test-runtime optimization into a package API change.
- Disabling isolation would share module and mock state across test files.

## Consequences

Dependencies are bundled once per test project before workers import them. A cold six-file collection-only run took 7.80 seconds end to end, versus 12.01–13.78 seconds without optimization; its import evaluation took 2.26 seconds, with 2.69 seconds in a repeated run. These local measurements are not a full-CI speedup claim. Browser application builds, UI public exports, test inventories, and native worker pools remain unchanged.

## Verification

- Regression — `SessionHoverPreview`, `AgentSelector`, `AssistantSelector`, `ResourceSelectorShell`, `DiagnosticUploadPanel`, and `ModelDrawer` pass all 110 existing renderer cases, exercising real UI components alongside partial component mocks.
- Regression — `packages/ui/src/components/composites/date-time-picker/__tests__/date-time-picker.test.tsx` passes all three existing cases, including formatting and controlled time edits through the real calendar component.
- Regression — `PreviewOptions.test.tsx` and `PreviewLimits.test.tsx` pass all eight file-preview cases with the shared DOM optimizer configuration.
- Regression — `scripts/__tests__/validationWorkflow.test.ts` passes all 23 cases in the unchanged Node test environment.
