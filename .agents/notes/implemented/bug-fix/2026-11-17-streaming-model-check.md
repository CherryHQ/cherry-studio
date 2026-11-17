# Agent Note: Model checks use the declared streaming capability

Status: implemented

English | [中文](2026-11-17-streaming-model-check.zh.md)

## Problem

Text-model checks always used non-streaming generation. A proxy that serves a valid stream can therefore fail the check even when streaming clients work. The response alone must still be validated: HTTP success or an initial text chunk does not establish a completed model response. Issue #22889 motivated the investigation; its original proxy response remains unavailable.

## Decision

Text checks use streaming when the existing model supportsStreaming flag is true and otherwise retain non-streaming generation. They reuse the normal provider, credential, parameter and usage pipeline. The internal Agent aggregation mode consumes the complete stream and accepts non-empty text with a stop or length finish. Errors, empty output, incomplete termination and cancellation fail the check.

The default 15-second deadline covers the whole probe, including an actively producing stream. Terminal cleanup aborts the internal controller to release unfinished transport. The IPC result remains a latency value. Settings, renderer cancellation, non-text probes and the Ollama-specific probe retain their existing behavior.

## Alternatives considered

- Retrying streaming after a non-streaming parse error can duplicate requests and hide endpoint mismatch.
- Reporting success on the first text chunk hides later errors and changes latency into time to first token.
- Adding separate streaming and non-streaming controls expands the UI beyond this compatibility repair.

## Consequences

The saved model capability selects the probe protocol; the check does not autodetect or rewrite it. Latency still measures full completion. Streaming checks do not create chat history. A passing synthetic proxy fixture does not establish the cause of the original reporter's failure.

## Verification

- Regression — AiService.test.ts covers both capability-selected wire modes, credential and reasoning forwarding, non-text dispatch, total timeout and failed-transport cleanup.
- Regression — successfulResponse.test.ts uses real OpenAI-compatible and Anthropic adapters with captured fetch to cover completion, length, HTTP failures, malformed and truncated streams, late errors, empty output and cancellation.
- Regression — agentLoop.test.ts covers the shared execution and lifecycle consumers.

Validation is on Windows with synthetic responses. The original proxy, old installation and native desktop UI are not exercised.
