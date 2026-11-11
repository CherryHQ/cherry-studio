# Agent Note: Use CommonJS date dependencies in renderer tests

Status: implemented

English | [中文](2026-11-11-ui-test-dependency-entrypoints.zh.md)

## Problem

Importing the UI public entry also loads its date picker. Isolated renderer tests repeatedly link the `react-day-picker` and `date-fns` ESM dependency trees even when their subject is another component.

## Decision

Use exact renderer-only aliases for the public `date-fns` and `react-day-picker` package identifiers. Resolve their supported CommonJS exports with `createRequire` rooted at `packages/ui/package.json`, so pnpm selects the versions declared by the UI workspace. Preserve the existing renderer aliases and leave subpath imports unchanged.

Keep Vitest's dependency optimizer disabled. Other test projects, application builds, UI public exports, worker pools, test isolation and shard counts retain their existing behavior.

## Alternatives considered

- Vitest client dependency prebundling reduced import time but failed real editor and notification tests: CodeMirror constructor identity and Radix Dialog context identity split. Scoping it to renderer still reproduced the failures; it also eagerly initialized unused browser dependencies when enabled globally.
- Redirecting only `date-fns` left the native ESM `react-day-picker` tree expensive. Both CommonJS entries are needed.
- Rewriting UI public exports or disabling test isolation expands the scope or shares module/mock state between files.

## Consequences

The renderer tests select the CommonJS variant of the same installed dependency versions; production imports remain unchanged. A fixed six-file collection-only experiment reduced tracked import evaluation from 6.95–7.29 seconds to 2.64–2.65 seconds, with command elapsed time falling from 12.29–13.36 seconds to 7.92–7.95 seconds. The experiment deliberately skips test cases and is not a full-CI speedup claim. Dependency upgrades must retain these supported exports or config loading fails visibly.

## Verification

- Regression — the existing `LazyCodeEditor.theme`, `NotificationCenter`, `HtmlArtifactsPopup.session`, and `CliConfigEditor.format` files reproduce 21 failures with prebundling and pass all 21 cases with the exact package-entry aliases, preserving editor state, undo, formatting and dialog context behavior.
