# Agent Note: Preserve safe evidence from unprocessable successful responses

Status: implemented

English | [中文](2026-11-06-successful-response-diagnostics.zh.md)

## Problem

Issue #23706 exposes diagnostic loss at the provider serialization boundary. The SDK can throw `APICallError` with HTTP 200 and `Failed to process successful response` when response processing fails. Clearing its cause and body protects privacy, but previously discarded the evidence distinguishing empty bodies, invalid JSON, unexpected structure, and terminated readers. The wrapper then classified as `unknown`.

Direct SDK `JSONParseError` and `TypeValidationError` also escaped through the generic application-error serializer, retaining parser text, validation values, stacks, and causes. These fields can contain prompts, credentials, or entire responses.

## Decision

The shared serializer emits fixed, payload-free English descriptions selected using the SDK's `EmptyResponseBodyError`, `JSONParseError`, and `TypeValidationError` identity guards. Wrapper diagnosis requires a live SDK `APICallError`, a successful status, and the exact case-insensitive outer message `Failed to process successful response` or `Invalid JSON response`. Only the latter handler's original `responseBody === ''` establishes emptiness without a live empty-body cause; absent bodies and whitespace do not.

A recognised wrapper with exactly `TypeError('terminated')` gets conservative response-processing guidance. Unsupported causes get fixed generic recovery guidance. Bounded decoding of Anthropic's synthetic-500 parser record recognises its `AI_JSONParseError` name and string `text`, emits the fixed JSON description, and preserves `server → provider_unavailable`. No record fields are copied. Stronger classifications are retained before replacing the description.

The shared classifier recognises the successful-response wrapper in its existing parse branch, below stronger diagnoses. Main routes only direct SDK parser/validation identities into the safe serializer in addition to its existing API-call route. Raw API-call fields remain null, `url` remains an empty string, and status/retryability remain intact. Existing input, decode, output, nesting, redaction, and SDK field limits still apply. Missing-finish normalization and partial-content preservation remain unchanged.

The request-body classification decision in `2026-10-25-request-body-parse-classification.md` continues to own request-side rejection precedence; this response-side decision does not supersede it.

## Alternatives considered

- Pass through raw cause messages: rejected because even recognised SDK errors can echo arbitrary parser input, validation values, or custom messages.
- Treat every 2xx error as parse: rejected because HTTP success alone does not identify the failed operation and must not override stronger evidence.
- Add renderer-specific mapping or a new localized headline: rejected because existing parse headlines and provider/model composition already present the normalized error.
- Patch adapters or reject responses by MIME: rejected because protocol validation is a separate policy; valid JSON served as `text/html` currently succeeds.

## Consequences

New failures retain actionable diagnostic meaning without retaining their payloads. English protocol descriptions inside `message` are an accepted cost; existing localized headlines remain unchanged. Existing stored failure snapshots and explicit `unknown` categories are not rewritten.

Anthropic streams silently accepted after incomplete EOF still have no error to diagnose. Wrong-MIME responses are not detected or rejected. This repair adds no automatic retry or dedicated Work Retry action. The gateway continues mapping successful HTTP statuses attached to errors to 502.

## Verification

- Regression — `src/shared/ai/__tests__/providerError.test.ts`: fixed descriptions, SDK identity gates, exact emptiness, stronger categories, bounded Anthropic decoding, privacy sentinels, redaction, output/input limits, depth limits, and cycles.
- Regression — `src/shared/utils/__tests__/errorCategory.test.ts` and `src/shared/ai/__tests__/executionFailure.test.ts`: response-wrapper parse recognition, status-only and request-side negatives, classification precedence, and existing failure conversion; all 3 shared files pass all 245 tests.
- Regression — `src/main/ai/utils/__tests__/successfulResponse.test.ts`: real compatible/Anthropic SDK failures with zero retries, original-error capture through Agent, terminal persistence/projection, consumed partial text before reader termination, missing-finish metadata, safe gateway 502 output, valid JSON/SSE/empty-text/tool-only controls, and cancellation.
- Regression — `src/main/ai/utils/__tests__/serializeError.test.ts`: the existing direct API-call shape, including empty-string URL and null raw fields, passes unchanged.
- Regression — `src/main/ai/runtime/aiSdk/loop/__tests__/agentLoop.test.ts`, `src/main/ai/streamManager/__tests__/pipeStreamLoop.test.ts`, `src/main/ai/streamManager/listeners/__tests__/PersistenceListener.test.ts`, and `src/main/ai/streamManager/__tests__/TopicMessageProjection.test.ts`: existing terminal-error capture, accumulation, persistence, and projection contracts; these 4 files and the 2 serializer files pass all 124 tests.
- Regression — `src/main/features/apiGateway/__tests__/errors.http.test.ts`: the fixture and case-table expectations assert the new structure description while retaining the raw SDK message and gateway 502 status. Exact byte-length assertions for `sdk-anthropic-200-non-message` use 147 / 159 / 159 / 144 bytes for Anthropic / OpenAI / OpenAI Responses / Gemini. All 1,015 tests execute and pass, with none skipped; no stale byte-length expectations remain.
- Regression — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`, `src/renderer/utils/__tests__/errorClassifier.test.ts`, `src/renderer/services/__tests__/toast.test.ts`, and `src/renderer/pages/home/hooks/__tests__/useChatWriteActions.test.tsx`: existing error presentation, classification, toast, and chat-write contracts; all 4 renderer files pass all 213 tests.

All reported suites use the repository Vitest configuration. The final runs pass all 1,015 tests in the gateway file alone, all 1,139 tests in 7 combined main files, and all 245 tests in 3 shared files, with zero failures or skipped tests. The preceding fixup also passed all 213 tests in 4 renderer files and Node TypeScript checking with no diagnostics; those checks were not rerun for the final byte-length expectation edit. Electron and native Agent sessions were not exercised.
