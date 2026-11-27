# Agent Note: Finish each inline file rename once

Status: implemented

English | [中文](2026-11-27-inline-rename-single-submit.zh.md)

## Problem

Enter can submit a rename while the editor is still mounted and waiting for the file operation. A subsequent blur could submit the same name again. Blur could also confirm after Escape cancelled the edit.

## Decision

The inline field records its terminal action before invoking the callback. Enter, Escape, and blur share that guard.

## Alternatives considered

- Guarding only the request would still let a cancelled input confirm through blur.

## Consequences

Each mounted rename field emits one confirmation or cancellation. Enter that commits an IME composition remains an editing action.

## Verification

- Regression — `src/renderer/pages/files/__tests__/InlineRename.test.tsx`: Enter followed by blur submits once, and Escape followed by blur never submits.
