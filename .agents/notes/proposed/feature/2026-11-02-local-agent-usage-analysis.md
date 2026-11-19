# Agent Note: Local Agent usage analysis

Status: proposed

English | [中文](2026-11-02-local-agent-usage-analysis.zh.md)

## Problem

ACP `session/prompt.usage` describes a prompt turn, while `ai_usage_record` describes observable provider invocations. One turn can contain several provider calls. `AcpConnection` previously assigned every route to `agent-sdk` capture and generates a new invocation identity for each reported turn. When the CLI uses Cherry's gateway, the gateway can also capture the underlying requests. Adding those observations counts the same work twice and misstates the request count.

The gateway configuration saved to a CLI is shared by terminal and chat launches. It does not establish a trustworthy connection between a particular HTTP request and a Cherry assistant message. An Agent's selected source model alone is insufficient proof of the model or credential that served a request.

Native session costs have a different scope again. Their amounts are cumulative, can decrease, and may use currencies outside Cherry's invocation ledger. The existing [ACP session cost decision](../../implemented/feature/2026-10-22-acp-session-cost.md) deliberately keeps these values separate.

## Proposal

### Three observation scopes

| Scope | Fact source | Counting rule |
|---|---|---|
| Provider request | Existing `ai_usage_record` | Each observable invocation once; retain real provider, model, credential and pricing snapshots |
| Agent turn | Typed Main-owned local usage summary in existing message JSON | Each reported turn once; never describe it as a provider-request count |
| Native session | Existing `localSessionCost` snapshot | Latest amount for each native session; never add successive snapshots |

Keep invocation billing and message statistics under their existing owners. Introduce no database table or column in this first phase. A typed local turn summary may retain native session identity, native model identity, reported tokens and report time in message JSON. It must not overwrite invocation-derived `MessageStats` or use a made-up provider price.

New ACP turn summaries stop producing synthetic invocation records. Existing immutable records remain unchanged; historical CLI aggregates must be identified separately in read models rather than silently treated as new request-level evidence. Historical duplication is not automatically repaired without reliable attribution.

### Capture and attribution

Gateway requests retain provider-call ownership. Where a supported CLI accepts connection-local overrides, reuse the internal gateway and scoped credentials to bind the connection to its Agent session and model. Revoke the credential when the connection closes. Do not write session IDs or temporary credentials into global CLI configuration, and do not create a new proxy or installation manager.

A connection-local override must preserve the user's selected global model and native configuration ownership. If an adapter cannot reliably apply an override, keep provider-request records available without inventing message attribution; mark the correlation as unknown. A configured source model, matching timestamps or similar token counts cannot establish a correlation.

Native turn summaries can still be shown for diagnosis when provider-call capture is available, but cannot be added to those request totals. Reports without usage remain unknown. Context-window occupancy is not a measure of consumed tokens.

### Analysis surfaces

Reuse the existing Usage settings page and chat usage details. Show provider requests and CLI turn summaries as explicitly distinct observation types. Expose Agent identity when captured, and let the user inspect native usage without pretending that the external CLI is a Cherry model provider.

Provider-request totals remain based on the invocation ledger. Native token summaries and native session costs remain separately labelled totals/details; do not introduce a grand total that adds overlapping observations. Native cumulative costs are not attributed to individual requests or dates that the protocol did not report. Preserve their original currency and distinguish unknown values from explicit zero. Do not convert currencies or infer charges from a selected model's catalog pricing.

Keep internal model identity for persistence and API model identity for wire/telemetry consumers. Changes to current Agent or provider settings must not rewrite historical attribution snapshots.

## Delivery

1. Add the typed native-turn read model, persistence protection and counting rules; remove synthetic ACP invocation capture for new turns.
2. Establish reliable gateway correlation for supported connection-local overrides; keep unsupported correlation explicitly unknown.
3. Reuse analysis and message-detail components for the separate scopes, complete translations and perform Electron acceptance.

Do not import CLI history, alter native credentials, recalculate old bills or extend this batch to non-ACP protocols.

## Alternatives considered

- Add native usage to gateway usage: duplicates tokens and makes one turn appear to contain extra requests.
- Convert cumulative session costs into invocation deltas: fails on resumed native history, downward corrections and missing observations.
- Change `ai_usage_record` to represent turns or sessions: broadens the existing immutable invocation contract and requires a separate schema decision.
- Correlate requests by global CLI configuration or time: concurrent sessions and terminal launches make the association unreliable.

## Acceptance criteria

- AC1 — A gateway-backed turn with several provider requests and an ACP usage summary counts provider requests and tokens once; the native summary remains separately inspectable (verification: protocol fixture and production-migrated database tests)
- AC2 — A native-only turn preserves exactly the reported usage, with an observed-turn count rather than an invented provider-request count; absent usage stays unknown (verification: protocol and database tests)
- AC3 — Repeated, downward, zero and currency-changing session-cost reports replace snapshots without changing invocation billing or inventing per-turn costs (verification: existing cost tests and new affected consumers)
- AC4 — Concurrent chat sessions cannot exchange attribution; closing a connection revokes its scoped credential, and terminal/global configuration is unchanged (verification: gateway lifecycle and supported-adapter tests)
- AC5 — Usage settings and chat details distinguish provider requests, native turns, context occupancy and cumulative costs in Chinese and English; currencies are not silently combined (verification: renderer tests, i18n gate and Electron)
- AC6 — Existing records and user history are not rewritten; the typed JSON data survives restart and remains protected from renderer message writes (verification: production-migrated database tests and Electron)
- AC7 — Unsupported correlation is shown as unknown, without silently dropping provider records or claiming per-message completeness (verification: adapter failure/unsupported tests and Electron)

## Risks

Third-party Agents vary in their token semantics and support for connection-local configuration. The first implementation must record which adapters have verified correlation, without treating every preset as verified. Large JSON-backed summaries also need a date-bounded, paginated read path so opening Usage does not scan or return every message.

This proposal changes which observations participate in usage totals. Implementation starts only after review of this counting contract; this note is not a claim that the capability has shipped.

## Working-tree verification

The user approved this contract in the implementation conversation. The code is
implemented locally; this proposed note remains pending the PR review lifecycle.

- Production-migrated database tests verify three provider calls plus one native
  summary without double counting, legacy separation, keyset pagination, protected
  JSON writes, fork exclusion and cumulative zero/unknown/currency snapshots.
- Protocol and runtime tests cover prompt summaries, missing usage, turn reset,
  persistence and existing invocation consumers. Scoped-credential tests cover
  concurrent sessions, spoofed headers, revocation and unsupported overrides.
- OpenCode 2.0.29 and Kilo 7.8.8 completed real ACP prompts against a controlled
  loopback backend through process-local configuration. OpenCode issued two HTTP
  requests while reporting one turn summary; Kilo issued one. These probes did
  not modify native global configuration or Cherry conversation history.
- Renderer tests cover Chinese/English scope switching, pagination, original
  currency, tiny positive costs and unknown values. Electron reads existing
  legacy observations and cost snapshots through DataApi without creating user
  records. New-summary message details use controlled renderer and protocol tests.

The first verified live adapter route is OpenAI-compatible chat completions.
Other SDK endpoint mappings are covered by the scoped gateway contract but do
not yet have real-CLI endpoint-specific acceptance evidence. Unsupported or
user-overridden routes remain uncorrelated.
