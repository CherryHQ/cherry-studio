# Agent Note: Route Poe bots by their declared chat endpoints

Status: implemented

English | [中文](2026-10-28-poe-chat-endpoint-routing.zh.md)

## Problem

Poe listing discarded `supported_endpoints`. Models without registry endpoint overrides inherited Responses, including `perplexity-adv-deep-research`, reported to fail with HTTP 400 and `invalid_request_error: Model does not support responses method`.

The supplied 2026-10-28 snapshot contains 301 rows: 244 empty declarations, 26 Responses plus Chat Completions, 14 Chat Completions only, seven Messages plus Responses plus Chat Completions, two Responses only, and eight video only. Declarations do not prove authenticated request acceptance. Model pulls add missing rows without refreshing retained rows.

## Decision

The Poe fetcher uses the configured host and credentials, including for pinned clones. It preserves raw API IDs and maps the three recognized chat paths. It intersects registry endpoint preferences with declarations, retaining registry order; without a usable preference, it orders Messages, Responses, Chat Completions. Missing or empty declarations use registry endpoints when available, otherwise the documented Chat Completions compatibility fallback. Malformed declarations skip only their item. Nonempty video-only or unknown-only declarations receive no endpoint hints or new capabilities.

After `PresetProviderSeeder`, `PoeChatEndpointUpgradeSeeder` repairs exactly the frozen 15-ID correction set: the 14 snapshot chat-only IDs plus the reported bot. It writes Chat Completions only for canonical `poe` rows with a null stored provider default and null or empty model endpoints. Exact stored `modelId` values are compared; this column is exposed as `apiModelId`. Explicit choices, clones, IDs, model state, pins, ordering and names remain intact. Selection and writes share one synchronous transaction. `hashObject` derives the version from correction data. Normal startup seeds after migrations, while v1 import deliberately skips seeds, so imported rows are repaired on normal startup.

[PR #14144](https://github.com/CherryHQ/cherry-studio/pull/14144) established the Responses default. This fix retains it and the Claude registry endpoint lists, including their exclusion of Responses. Reasoning contracts, serializers, endpoint configuration and gateway routing remain unchanged.

## Alternatives considered

- Flip the provider default: rejected because dual-endpoint models lose their existing Responses route and Responses-only models receive an undeclared method.
- Fetcher alone: rejected because retained rows remain broken without removal and re-addition.
- Repair all 301 rows or add family routing: rejected because it pins unrelated inherited configuration and creates a maintained capability catalog.
- Retry HTTP 400 or classify videos: deferred because replay and generation transport need separate contracts.

## Consequences

Retained rows outside the 15-ID set are not repaired. Pulling supplies routing for fetched additions but does not refresh retained rows; replacing such rows uses the newly fetched metadata. This historical repair is not a capability-refresh mechanism to extend over time. Empty declarations imply no modalities, tools, reasoning support or pricing.

Offline mapping of 301 rows calls `resolveModel` once per unique model. The cold pass measured 58.14 ms; warm passes measured 3.01–5.40 ms (median 3.56 ms), excluding transport and response parsing. Resolution uses cached registry data with lazy local-file loading, without SQLite or network access.

## Verification

- Regression — `listModels.test.ts`: endpoint assertions fail before the fix; declared ordering, Claude intersection, missing/empty fallback, malformed-item isolation, duplicates, raw IDs and configured clone transport pass afterward.
- Regression — `endpoint.test.ts`: the endpoint-less reported bot inherits Responses before repair; mapped research selects Chat Completions, GPT-5.2 retains Responses, and Claude retains Messages while declining a Responses preference.
- Regression — `PoeChatEndpointUpgradeSeeder.test.ts`: the only pre-fix RED evidence is module absence; production-migrated SQLite verifies all 15 IDs, preservation predicates, ModelService readback, pins/state/order, idempotency and rollback on an injected write failure.
- Regression — `modelSync.test.ts` and `doctorContent.test.ts`: fetched Poe endpoints survive enrichment and DTO conversion; all 20 categories resolve through all 15 real renderer catalogs. Every catalog includes a real translation of the independent `bad_request` key.
- Regression — direct Vitest runs pass 161 main and 22 renderer tests; i18n validation passes 96416 translations; node typechecking passes with `NODE_OPTIONS=--max-old-space-size=16384` after the default heap exhausted memory.

Authenticated Poe acceptance and useful streaming output for the reported bot remain unverified because no Poe API key is available. No Electron startup or live provider request is claimed.
