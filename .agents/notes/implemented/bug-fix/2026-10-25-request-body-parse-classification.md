# Agent Note: A rejected request body was diagnosed as invalid AI content

Status: implemented

English | [中文](2026-10-25-request-body-parse-classification.zh.md)

## Problem

`classifyErrorCategory` in `src/shared/utils/errorCategory.ts` matched the bare substring `failed to parse` anywhere in the joined message/response-body/data text and returned `parse`. `parse` is a response-side diagnosis: the renderer maps it to `error.diagnosis.parse`, "AI returned an invalid response, please retry or switch model".

An upstream that rejects the request body therefore landed in that bucket. Reported as #22164 with `openai:gpt-5.6-sol`: the underlying error was `Failed to parse request body`, but the chat block told the user the AI had returned invalid content. The failure was also mis-attributed sideways rather than forward — the user is sent to switch models for a request-side failure, and the `bad_request` recovery action (provider settings) is lost, because `parse` has no `navTarget`.

The wording originates upstream. `Failed to parse request body` has no hits in `src/` or `packages/`, so it comes from a provider or gateway rejecting the request body, and it also arrives alongside an HTTP 400 — a status the classifier already routes to `bad_request` for every other cause.

## Decision

A `failed to parse` that names the request is excluded from the response-parse branch, so it falls through to the existing terminal `return status === 400 ? 'bad_request' : 'unknown'`:

```ts
const requestParseFailure = msg.includes('failed to parse') && msg.includes('request')
...
(!requestParseFailure && msg.includes('failed to parse')) ||
```

The keyword stays broad for every other wording. Scoping it to a response-noun list instead would have regressed a real message: `@ai-sdk/gateway` throws `Failed to parse video SSE event`, which the app reaches through `createGatewayWithImageModel` and which would have become `unknown`. Gate on the request side, not the response side, because the response vocabulary is open-ended and the request side is not.

## Alternatives considered

- Remove the `failed to parse` phrase entirely: rejected because response-side failures that use it (notably the gateway provider's `Failed to parse video SSE event`) would fall through to `unknown`, losing the existing parse diagnosis.
- Scope the keyword to a response-noun list (`response`/`output`/`stream`/`json`/...): rejected for the same reason — a response-side wording outside the list silently becomes `unknown`.
- Special-case the exact string `Failed to parse request body`: rejected because upstream wording varies (`We could not parse the JSON body of your request.`, `request failed to parse`) and the classifier deliberately classifies by signal, not by exact upstream phrasing.
- Handle it in the renderer's `classifyError` instead: rejected because `classifyErrorCategory` is the single shared source that the main process (`processExitDiagnostics`, connectivity doctor checks, `serializeNestedProviderError`) also classifies through; fixing it only in the renderer would leave those paths wrong.

## Consequences

A rejected request body now reports "Provider request failed (HTTP 400)" with the provider-settings recovery action, and the provider's own text remains in the error detail. Genuine response-parse failures are unaffected. `classifyErrorCategory` still classifies from free text without a structured request/response discriminator, so a message that names both the request and a response parse remains ambiguous; the request side wins, which is the safer default because a retry cannot fix a rejected request body.

## Verification

- Regression — `pnpm test:shared src/shared/utils/__tests__/errorCategory.test.ts`: 54 tests pass. Added: four request-body rejection wordings classify as `bad_request` (direct, JSON-wrapped, upstream phrasing, reversed word order); five response-side parse failures including the gateway `Failed to parse video SSE event` still classify as `parse`; and the same phrase without a status stays `unknown`.
- Regression — `pnpm test:renderer src/renderer/utils/__tests__/errorClassifier.test.ts src/renderer/components/ErrorDetailModal/__tests__/isDiagnosticReportEligible.test.ts src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`: 150 tests pass, including a new end-to-end case asserting a 400 with `Failed to parse request body` yields `error.diagnosis.bad_request` and `navTarget` `/settings/provider?id=openai` — the user-visible symptom from the issue.
- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/processExitDiagnostics.test.ts src/main/services/diagnostics/scan/__tests__/rules.fixtures.test.ts src/main/services/diagnostics/doctor/checks/__tests__/connectivity.test.ts src/main/ai/utils/__tests__/serializeError.test.ts`: 79 tests pass, covering the main-process classifiers that share this ladder.
- `oxlint`, `eslint`, and `oxfmt --check` pass on the three changed files; `tsc --noEmit` reports no error in them.
