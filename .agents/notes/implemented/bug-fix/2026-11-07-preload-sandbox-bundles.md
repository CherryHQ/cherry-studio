# Agent Note: Bundle standalone sandbox preloads

Status: implemented

English | [中文](2026-11-07-preload-sandbox-bundles.zh.md)

## Problem

MP-123 loads its page but cannot enable annotations. The generated webview preload requires zod at runtime, while external websites correctly run with sandbox enabled. Electron's sandbox cannot load that module, so the annotation bridge never starts.

## Decision

Use electron-vite's built-in isolatedEntries and disable dependency externalization for preloads. Each entry bundles its JavaScript dependencies without shared chunks. Preserve the separate webview bridge, context isolation and external-site sandbox; keep trusted application window policies unchanged.

## Alternatives considered

- Disabling the website sandbox would weaken the untrusted-page boundary.
- Copying individual modules beside preload files cannot make sandbox require load them.

## Consequences

Preload outputs may duplicate dependencies across entries. The built-output test executes the real webview bundle with only Electron imports permitted and verifies its session-state reply.

## Verification

- Regression — the built-output test failed with Sandbox cannot load zod before the fix.
- Regression — the sandbox contract and existing Sentry build checks passed (8 tests).
- Electron MP-123 remains pending.
