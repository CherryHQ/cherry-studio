# Agent Note: Classify upstream tool-use concurrency refusals

Status: implemented

English | [中文](2026-11-26-tool-use-concurrency-refusal.zh.md)

## Problem

[#25031](https://github.com/CherryHQ/cherry-studio/issues/25031) reports a Work conversation failing on a model/channel that rejects parallel tool calls. The provider answers HTTP 400 with `400 due to tool use concurrency issues.`, and the app blamed the transport: the conversation showed “response interrupted, check network stability or retry” and offered a retry that cannot succeed. Two separate defects produced that: the shared classifier had no rule for this refusal, and when the HTTP status arrived only inside the flattened `API Error: 400 …` message the category stayed `unknown`, where the conversation toast fell back to the stream-interruption wording.

## Decision

Recognise the refusal class in the shared classifier as `tool_concurrency` through a narrow wording matcher (`tool use concurrency`, `parallel/concurrent tool calls are not supported`), and recover a flattened HTTP `4xx`/`5xx` status when no structured status survives — only for `response-stream` errors or messages beginning with `API Error:` — so a provider refusal is classified by its status instead of by the fallback. The diagnosis says the provider rejected parallel tool calls, states that retrying unchanged will not help, and points at provider settings. When a turn ends in error without any provider detail, the conversation toast now reports the neutral unknown diagnosis instead of asserting a stream interruption, and a provider error part is still forwarded verbatim when present.

## Alternatives considered

- Keep the generic `bad_request` heading: it loses the one actionable fact — a retry is pointless and the tool-call shape must change.
- Leave the failure in `stream`: the transport is healthy, so the advice (check your network, retry) is actively wrong.
- Detect the model's parallel-tool-call capability and serialise tool calls in the agent loop: that changes request behaviour for every model, needs a capability source the repository does not have, and is a product decision for a follow-up issue rather than part of this repair.

## Consequences

The desktop has a distinct, non-retryable diagnosis for this refusal; the remote failure schema is unchanged and still reports `invalid_input`, so no new protocol value is introduced. Status recovery is deliberately narrow: the token must start the message and be followed by a non-unit word, text recovery applies only to `response-stream` errors and `API Error:` envelopes, and AI SDK retry wrappers never take part in it. A bare quantity such as `500 ms` supplies no status even in a response-stream message. Unmarked prose keeps its own text, so provider setup can still show a plain `401 rejected <key>` with the key masked instead of collapsing it into a generic diagnosis. Recognising the category does not stop the app from sending parallel tool calls; the model capability marking requested in the issue is not implemented here.

## Verification

- Regression — Shared classifier tests cover the reported body with an explicit 400, the same body without a status, the flattened `API Error: 400 …` envelope, and the wording variants the matcher accepts; a generic 400 stays `bad_request` and stream, content-filter, and rate-limit signals keep their existing precedence.
- Regression — Renderer classifier and conversation-toast tests assert the new diagnosis key, the provider-settings target, and that a vision-provider refusal is still reported as `bad_request` rather than by the recovered status. They also pin the recovery boundary: a flattened status is recovered for a `response-stream` message, the same text without that marker stays `unknown` so provider setup keeps the masked detail, and a plain `401 rejected <key>` is not turned into an auth diagnosis.
- Regression — The toast test asserts the warning title, the upstream text in the details, and that no retry action is offered; the projection test asserts a turn that ends in error without a `data-error` part no longer reports a stream interruption and that a present `data-error` part is forwarded unchanged.
- Regression — Not reproduced against a live provider: the refusal needs an upstream aggregator to reject concurrent tool calls, so the evidence stops at the unit level above and no on-device claim is made for the live refusal.
