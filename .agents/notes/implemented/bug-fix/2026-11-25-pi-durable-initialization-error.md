# Agent Note: Preserve Pi Durable initialization diagnostics

Status: implemented

English | [中文](2026-11-25-pi-durable-initialization-error.zh.md)

## Problem

When Pi Durable cannot initialize native storage or the Harness, the runtime reports the cause to diagnostics and returns a generic initialization failure. Work turns surface that failure after stream setup, so the chat error classifier can suggest checking the network. [Issue #25353](https://github.com/CherryHQ/cherry-studio/issues/25353)

## Decision

Preserve the `initialize` operation, `native-error` code and available cause text in the runtime result. The desktop backend redacts credentials and bounds the message before throwing a named initialization error. Chat uses that error name to keep the existing generic heading and show the diagnostic beside it.

## Alternatives considered

- Classifying the prose would couple the renderer to a particular message and allow words like “timed out” to redirect users to network settings.
- Changing the response-stream fallback for all unknown errors would affect unrelated provider interruptions.

## Consequences

A local initialization failure displays its operation, code and available cause in Work.

## Verification

- Regression — A failing storage factory verifies that the runtime preserves the operation, code and cause text. The test covers Error and string causes and an opaque cause.
- Regression — Renderer classification and error-card tests verify that the diagnostic stays visible without network or response-stream guidance.
