# Agent Note: Preserve Google signatures across Pi connection identities

Status: implemented

English | [中文](2026-10-29-pi-google-replay-identity.zh.md)

## Problem

Cherry registers each Pi connection under a session/generation-scoped provider and API. The native Google adapter stamps assistant messages with `google-generative-ai`. Pi compares provider, API, and model when replaying history; the dispatch API alias therefore makes a same-model tool response look foreign and strips its `thoughtSignature`. Reconnecting also changes the provider namespace. This explains the native Google tool-continuation failure tracked in [#22810](https://github.com/CherryHQ/cherry-studio/issues/22810), even when the original signature remains in the native session file.

## Decision

[The Google stream boundary](../../../../src/main/ai/runtime/pi/piGoogleReplay.ts) passes the native API identity to Pi's Google adapter. For replay only, it maps previous Cherry connection providers to the current connection provider when the native API and model match and the provider consists of the exact configured provider ID followed by a session UUID and a generation UUID. It leaves the persisted history unchanged.

The registry retains its connection-scoped provider/API names and credential lookup. Other protocols retain their existing streams. Real signatures, tool IDs, call ordering, and parallel-call grouping remain owned by Pi; the boundary neither generates signatures nor relaxes cross-model checks.

## Alternatives considered

- Remove the isolated API/provider registration: rejected because concurrent connections and replacement generations must not overwrite one another's stream bindings.
- Disable Pi's foreign-history filtering or relabel every assistant message: rejected because signatures from another provider or model must remain foreign.
- Insert a validation-bypass signature: rejected because these native responses already have real signatures that can be preserved.
- Rewrite stored sessions: unnecessary; connection identity is a replay projection, not a migration of the original response.

## Consequences

Existing Cherry Google histories with the scoped UUID naming format can resume without editing their files. Matching is limited to the same configured provider ID, native API, and model. Unknown provider formats and genuinely foreign histories retain Pi's existing behavior; this change does not solve arbitrary cross-provider history imports or OpenAI-compatible Gemini signature handling.

## Verification

- Regression — `pnpm test:main src/main/ai/runtime/pi/piGoogleReplay.test.ts`: native Google request serialization preserves parallel/sequential call signatures, signed text, and serialized history across connection generations; foreign identities remain foreign and unsigned calls stay unsigned.
- Regression — `pnpm test:main src/main/ai/runtime/pi/modelInjection.test.ts`: the production materializer preserves a tool signature behind a dispatch alias and leaves other protocol streams unchanged.
- Regression — `pnpm test:main src/main/ai/runtime/pi/PiRuntimeConnection.test.ts src/main/ai/runtime/pi/PiRuntimeConnection.sdkContract.test.ts src/main/ai/runtime/pi/piGoogleReasoning.test.ts`: connection isolation, existing session behavior, and Google reasoning configuration remain covered.
