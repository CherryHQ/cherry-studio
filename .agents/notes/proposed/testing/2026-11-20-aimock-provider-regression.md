# Agent Note: Extend provider protocol regression with AIMock

Status: proposed

English | [中文](2026-11-20-aimock-provider-regression.zh.md)

## Problem

The [desktop regression controller](../../../../scripts/e2e/regression/README.md) uses a shared strict AIMock worker for model fixtures. Several failure scenarios use case-owned HTTP servers. The [streaming failure case](../../../../tests/e2e/regression/README.md#local-streaming-failure-regression) verifies persistence after a disconnected OpenAI-compatible chat response. It leaves open how other provider adapters behave when data stops arriving, and whether AIMock can reproduce the same disconnect with equivalent timing guarantees.

## Proposal

Keep the existing controller and case IDs as the baseline. Start with C-03 for stream interruption and MP-17 for manual retry on hosted macOS and Windows. Record the app SHA, each case result and duration, and its provider or fixture source.

Add case-owned AIMock instances for deterministic failures. The shared worker currently marks every HTTP status of 400 or higher as an unexpected request. Case-owned instances must verify the expected failed request and the subsequent request, reject unexpected requests, and close through case cleanup. Use typed fixtures where they express the contract and raw events where a provider-specific shape matters. Retain a case-owned HTTP server when the case needs to coordinate disconnect with an observed UI state and AIMock cannot provide equivalent control.

Exercise Chat Completions and Claude Messages first through the existing desktop UI and provider selection. Add one success and one protocol-specific boundary for Responses and Gemini after the first two protocols pass. Follow with multi-turn MCP and agent runtime outcomes, then targeted knowledge, translation, and image scenarios. Select only provider and scenario combinations that exercise distinct product behavior.

Keep the existing hosted regression workflow and phase ordering. Use focused tasks for verification on both platforms and record protocol, scenario, fixture version and observed outcomes in existing evidence. The mock suite verifies application behavior with scripted inputs. Live provider checks remain the evidence for current upstream compatibility.

## Alternatives considered

- Replace all local fixture servers at once. This would remove case-specific control before checking equivalent timing and product assertions.
- Run every scenario on every provider. Broad repetition would increase hosted runtime while adding little evidence where the same product path handles the response.

## Acceptance criteria

- AC1 — Hosted baseline evidence identifies the exact app revision, both platforms, and individual C-03 and MP-17 outcomes and durations. (verification: hosted regression reports; owner: E2E workflow maintainers)
- AC2 — OpenAI-compatible chat and Claude Messages retain partial text after a disconnect, persist an error that survives restart, and complete a new turn. (verification: hosted desktop E2E on macOS and Windows; owner: Chat maintainers)
- AC3 — User stop prevents late content from appearing or persisting, and a scripted rate limit followed by manual retry yields one completed reply. An unexpected request fails the scenario independently of the expected fault. (verification: hosted desktop E2E and focused controller tests; owner: Chat and E2E maintainers)
- AC4 — Responses and Gemini exercise their own wire protocols through product configuration, with a successful persisted reply and assertions for an exercised protocol-specific boundary such as usage, catalog, or error handling. (verification: hosted desktop E2E; owner: provider maintainers)
- AC5 — A scripted tool round consumes the actual result, a denied or failed tool is reported as such, and cancellation prevents further tool execution. Reopening the conversation preserves tool outcomes. (verification: hosted MCP and agent desktop E2E; owner: agent runtime maintainers)
- AC6 — Targeted knowledge, translation, and image scenarios verify a real retrieved citation, persisted translation history or usage, and a displayed and saved image or a visible generation failure. (verification: hosted desktop E2E; owner: respective feature maintainers)

## Risks

A fixed delay may fire before partial text becomes visible on a slower runner. Gate disconnect on an observable event when necessary. Fixture drift can hide changes in a live provider, so preserve real-provider checks. Record failures and missing platform evidence explicitly. Keep fixture transcripts synthetic and retain existing report redaction.
