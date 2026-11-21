# Agent Note: Gemini agent tool validation and native Pi recovery

Status: proposed

English | [中文](2026-11-13-gemini-agent-recovery.zh.md)

## Problem

Gemini can terminate generation with `MALFORMED_FUNCTION_CALL`. Reporting that outcome as success hides the failure; preserving the failure alone does not reduce its occurrence or recover an interrupted agent step. Explicit Gemini function-calling policy must survive SDK conversion before changing any default.

Cherry's Pi runtime currently forces `retry.enabled: false`. The installed Pi 1.5.2 session already owns retry budgets, abortable backoff, failed-attempt history omission, and continuation. Its classifier recognizes transient status text but does not recognize `Provider stopped with: MALFORMED_FUNCTION_CALL` or the generic `error`/`other` finish text in PR #24442. Enabling retry alone therefore does not establish recovery for this incident.

The existing [gateway SDK forwarding decision](../../implemented/architecture/2026-11-09-gateway-sdk-forwarding.md) remains authoritative: the gateway performs one SDK invocation and never owns an Agent loop or generation retries.

## Proposal

### Default policy

For Cherry-managed Pi Agent requests targeting a Google Gemini generation endpoint and carrying function tools, select `VALIDATED` only when the caller did not specify a mode or supplied `MODE_UNSPECIFIED`. Preserve explicit `AUTO`, `NONE`, `ANY`, `VALIDATED`, and allowed-function restrictions. External gateway callers, ordinary chat, other providers, Claude, ACP, and Pi Durable retain their current defaults.

Place this policy at the managed Pi request owner; use existing SDK tool-choice and strict-schema capabilities through the gateway. Do not overwrite raw HTTP bodies, rewrite schemas to make them stricter, drop tools from historical validation, or silently fall back to `AUTO` when the provider rejects validation mode. No new user setting is required for the initial scope.

### Native runtime recovery

Use Pi's native AgentSession retry machinery, not a second prompt loop in Cherry or an HTTP retry wrapper. Keep gateway and provider HTTP retries at zero. Configure at most one retry per failed generation, with a one-second abortable delay. Successful model steps reset that budget; a continuous sequence of failed generations cannot reset it.

Enable native transient-error recovery for managed Pi sessions using Gemini. Preserve Pi's existing non-retryable quota/billing exclusions and context-overflow compaction path. Other models and runtimes retain their current retry settings.

Add narrowly classified malformed-function-call recovery at the native SDK classification boundary. Preserve the provider-native terminal cause through provider normalization, the gateway error frame, and Pi's error representation. Prefer an upstream-supported classification hook; if unavailable, maintain a focused dependency patch at that owner with tests. Do not modify private AgentSession methods, classify every `other` as transient, or manufacture a status code merely to match a retry regex. The emitted provider error must remain distinguishable from authentication, schema, quota, safety, and unclassified terminal failures.

Pi's inspected low-level loop checks `error`/`aborted` before executing that response's tool calls. Verify this ordering with the pinned SDK: failed-response calls must never run, while tools completed in earlier successful steps remain in native history and are not replayed. Preserve failed-attempt diagnostics and usage even when the attempt is omitted from future model input. User cancellation, shutdown, and detach ownership must not launch a new attempt. Publish one final run outcome after recovery, without a transient failed attempt prematurely settling the run.

### Delivery and evidence

Land explicit tool-policy forwarding first. Implement the managed default and native recovery as separate reviewable changes against this Spec. Inspect existing SDK patches before modifying them. Verify each dependency patch against the pinned package and cover streaming and non-streaming gateway error conversion. These checks demonstrate the recovery contract, not a claim that malformed generation is eliminated.

A real-provider A/B run with the same failing request, model, tools, and history compares default generation against `VALIDATED`; report attempts, failures, token usage, and latency separately from deterministic fixtures. If the original request or provider access is unavailable, record the gap and do not claim incident reproduction or a measured reliability improvement.

## Alternatives considered

- Enable retry without repairing classification: generic terminal errors and native malformed-function errors currently miss the retry classifier.
- Retry in the gateway: it cannot safely own tool execution or caller history and violates the existing forwarding decision.
- Implement a second Cherry retry loop: duplicates Pi's cancellation, history, and settlement ownership.
- Force `VALIDATED` for every Gemini caller: changes external API defaults and overrides explicit caller intent.
- Retry all `other` outcomes or all validation failures: conflates unknown/benign provider states, deterministic invalid requests, and transient generation failures.

## Acceptance criteria

- AC1 — Managed Pi Gemini requests with function tools use `VALIDATED` only when mode is absent or unspecified; explicit modes and function restrictions survive to the provider wire, and external/non-Gemini requests keep their defaults. (verification: unit)
- AC2 — A malformed first generation followed by a valid generation makes exactly two model requests in one native Pi run, emits one final successful outcome, and preserves both attempts' usage. (verification: unit)
- AC3 — Two consecutive malformed generations produce exactly two requests and one final failed outcome; unrelated terminal reasons and deterministic/authentication/quota errors are not newly retried. (verification: unit)
- AC4 — Cancellation during backoff or before the next request prevents recovery dispatch and leaves one cancelled outcome. (verification: unit)
- AC5 — Calls in a failed response are never executed; a tool completed before a later failed generation runs once and its result survives the retry and session reload. (verification: unit)
- AC6 — Native Pi history, projection, queued input, and shutdown retain their ownership through retry; no gateway/HTTP retry or new prompt replay is introduced. (verification: unit)
- AC7 — The implementation report separates deterministic wire/runtime tests from real-provider A/B evidence, explicitly identifying any missing incident reproduction. (verification: docs gate)

## Risks

`VALIDATED` can reject schemas or be unsupported by a compatible gateway; that failure remains explicit. Retrying adds billed generation and latency. Native Pi classifies errors using message text in the pinned version, so transporting an exact cause and testing provider error envelopes are prerequisites. SDK patch updates can change retry, history, and settlement behavior; tests must exercise the pinned native runtime rather than mocked retry callbacks. Pi Durable requires its own journal/metering design and is outside this change.
