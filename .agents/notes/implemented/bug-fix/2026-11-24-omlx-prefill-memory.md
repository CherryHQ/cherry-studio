# Agent Note: Classify oMLX prefill memory rejections

Status: implemented

English | [中文](2026-11-24-omlx-prefill-memory.zh.md)

## Problem

The oMLX rejection in [#25181](https://github.com/CherryHQ/cherry-studio/issues/25181) includes a memory safety margin. The shared classifier reads the word “safety” as a content-policy signal, so Work asks users to change their prompt.

## Decision

Recognize the reported diagnostic and its explicit provider code in the shared classifier as a prefill memory limit. The existing error presentation explains the capacity issue and suggests shortening the conversation or using a smaller model. Details keep the original diagnostic.

## Alternatives considered

- A generic HTTP 400 heading loses the recovery guidance.
- The context-window category can direct users toward automatic context recovery even when the request is within the model's window. oMLX enforces a separate memory budget.

## Consequences

The desktop has a distinct diagnosis for this capacity failure. The remote schema keeps its existing generic fallback with the provider message and HTTP status. Explicit content-policy outcomes retain their precedence.

## Verification

- Regression — Windows Electron Work renders the corrected headline for the reported HTTP 400, the legacy wording, and the code-only envelope. Genuine content blocks and generic 400s retain their labels.
- Regression — The shared classifier tests cover structured status precedence and a validation error that mentions the code in prose.
