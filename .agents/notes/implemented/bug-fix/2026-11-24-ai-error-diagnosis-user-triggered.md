# Agent Note: Make AI error diagnosis user-triggered and privacy-gated

Status: implemented

English | [中文](2026-11-24-ai-error-diagnosis-user-triggered.zh.md)

## Problem

`ErrorBlock` started an AI diagnosis automatically from `useEffect`, sent every request to the managed `cherryai::qwen` model, and never checked `app.privacy.data_collection.enabled`. A user who configured only their own provider and turned off data collection still had the failed message's error body sent to CherryAI when a failure arrived ([#25217](https://github.com/CherryHQ/cherry-studio/issues/25217), related to [#18788](https://github.com/CherryHQ/cherry-studio/issues/18788) and [#13419](https://github.com/CherryHQ/cherry-studio/issues/13419)).

## Decision

Run a diagnosis only after the user clicks the button, and send it to the user's default model through the main-process `ai.text.generate` route with `disableTools` and `maxRetries: 0`. When data collection is off, the entry point is not rendered, and `errorDiagnosis` checks the privacy switch before and after resolving the model, failing closed. The one-hour diagnosis cache is removed so that a click cannot hit a stale summary and bypass the switch.

## Alternatives considered

- Keep automatic diagnosis and only change the model. It still sends a request the user did not ask for.
- Add only the privacy switch. The request still goes to CherryAI, which conflicts with #13419.
- Keep using a separate login-free model. Not chosen because this change adds no server-side dependency.

## Consequences

The default model often belongs to the provider that just failed, so the diagnosis may fail exactly when it is most needed. This is the accepted result of adopting the default model, as #13419 asks. Diagnosis no longer consumes `cherryai::qwen` usage. `diagnoseError` has no production caller, and its hardcoded sender is removed as well.

## Verification

- Regression — `ErrorBlock.test.tsx` covers the privacy and click matrix, the in-flight state, and hiding an existing summary once data collection is off; `errorDiagnosis.test.ts` covers the privacy check before and after model resolution and the missing or disabled model and provider branches.
- Regression — An Electron probe observed no entry point and zero requests with data collection off, and with it on, zero requests during 12 idle seconds followed by exactly one request to the default model after a click.
