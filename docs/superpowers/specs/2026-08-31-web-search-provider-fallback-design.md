---
description: Add fixed provider-level fallbacks for configured web search and URL retrieval without changing source-priority preferences
sources:
  - src/main/services/webSearch
  - src/main/ai/runtime/aiSdk/params/buildAgentParams.ts
  - src/renderer/components/composer/tools/components/WebSearchButton.tsx
  - src/shared/data/presets/webSearchProviders.ts
---

# Web Search Provider Fallback

## Context

Cherry Studio selects keyword-search and URL-retrieval sources independently. For each capability, request routing first
chooses either a model-native server tool or a configured client tool. Once a request enters the configured client tool,
the selected Web Search provider owns execution.

URL retrieval already has a provider-level fallback inside `WebSearchService`: Cherry Fetch and Jina retry only failed
inputs through each other, preserve partial successes and input order, propagate caller cancellation, and aggregate
primary and fallback errors. Keyword search has no equivalent. A configured provider that requires an API key is also
reported as unavailable before client tools are injected, even though ExaMCP search and Cherry Fetch are usable without
keys.

## Goals

- Fall back from a configured keyword-search provider to ExaMCP when the primary provider lacks required configuration
  or its execution fails.
- Fall back from a configured URL-retrieval provider to Cherry Fetch under the same conditions.
- Keep partial batch successes and retry only failed inputs.
- Make fallback-backed client capability availability visible to both Main request routing and Renderer controls.
- Keep provider connection checks strict so a successful fallback cannot validate a broken primary provider.
- Preserve the existing Cherry Fetch and Jina recovery behavior.

## Non-goals

- Falling back from a model-native server tool after a model request has started or failed.
- Adding user-configurable fallback provider lists, retry counts, backoff, persistence, or new IPC fields.
- Retrying invalid input, caller cancellation, empty successful results, blacklist filtering, or compression failures.
- Creating a repository-wide fallback abstraction.
- Changing API-key storage, rotation, provider presets, or source-priority preferences.

## Considered approaches

### Recommended: generalize the existing WebSearch service executor

Keep fallback ownership in `WebSearchService`. Generalize its existing URL-only compensation into a capability-aware,
single-hop executor. It continues to use the current provider factory, runtime configuration, settled-result merge,
abort handling, URL safety guard, logging, and aggregate diagnostics.

This is the smallest change because the service already owns provider selection, API-key rotation, batch execution and
response normalization. It also gives every in-process caller the same behavior unless that caller explicitly requests
a strict provider check.

### Alternative: wrap individual provider drivers

Each provider could catch failures and invoke ExaMCP or Cherry Fetch directly. This duplicates policy across drivers,
couples providers to one another, cannot efficiently preserve partial batch results, and bypasses service-owned API-key
rotation and diagnostics.

### Alternative: introduce a generic fallback utility

The model retry wrapper, MCP transport fallback, and download mirror loops all sequence alternatives, but their failure
contracts differ materially. A shared executor would need capability-specific hooks for partial results, URL safety,
abort semantics and response rewriting. That abstraction would be broader than the requested behavior and would not be
independently useful to those existing consumers.

## Fallback policy

The service resolves one primary provider and at most one provider-level fallback for each request:

| Capability | Primary provider | Fallback |
|---|---|---|
| `searchKeywords` | any provider except `exa-mcp` | `exa-mcp` |
| `searchKeywords` | `exa-mcp` | none |
| `fetchUrls` | any provider except `fetch` | `fetch` |
| `fetchUrls` | `fetch` | `jina` (existing behavior) |

The fallback attempt is single-hop. In particular, a failed Querit URL fetch may try Cherry Fetch, but a failure in that
fallback does not continue to Jina. This prevents recursive chains and bounds latency. Direct Cherry Fetch requests retain
their existing Jina fallback so current behavior and Knowledge ingestion recovery do not regress.

An explicit `providerId` does not disable fallback during normal execution. Knowledge ingestion currently explicitly
selects Jina and relies on the existing Jina-to-Cherry-Fetch recovery. Strictness belongs to the settings check operation,
not to whether a provider ID was explicit.

## Failure classification

Fallback starts for:

- a missing required API key;
- a missing or invalid required API host;
- network and provider timeout failures;
- non-success HTTP responses, including authentication and rate-limit responses;
- response body, JSON, schema or MCP payload parsing failures;
- a rejected provider execution for an individual batch input.

Fallback does not start for:

- an invalid or unsupported requested provider/capability combination;
- normalized input validation failures;
- caller cancellation or an already-aborted signal;
- a fulfilled response with zero results;
- blacklist or post-processing/compression failures after provider execution;
- a fallback provider equal to the primary provider.

Configuration failures that apply to the provider as a whole send all normalized inputs directly to the fallback without
first invoking the primary driver. Execution failures use the existing settled-result behavior and retry only rejected
input indexes.

## Execution and response semantics

`WebSearchService` remains the owner of the complete flow:

1. Normalize inputs before entering provider fallback logic.
2. Resolve the primary provider, runtime configuration and driver.
3. Preflight the primary capability with the shared readiness rules. In strict mode, surface an actionable typed
   configuration error; in normal mode, skip an unusable primary and execute the fixed fallback.
4. Otherwise execute all inputs through the primary using `Promise.allSettled`.
5. Stop immediately if the caller's signal is aborted.
6. Execute only rejected inputs through the fallback provider.
7. Merge recovered results into their original indexes and retain both errors for unrecovered inputs.
8. Run blacklist and compression processing once, after provider execution is complete.

The top-level response keeps the requested primary provider ID for compatibility, including mixed primary/fallback
batches. Recovered result items keep the original `sourceInput`. Structured logs record capability, primary provider,
fallback provider and recovered input count so the actual execution path remains observable.

If every input still fails, the service throws an `AggregateError` containing both primary and fallback failures. If at
least one input succeeds, it returns the successful results and logs the unrecovered inputs using the existing partial
failure behavior.

## Strict provider checks

The Web Search settings IPC routes validate the provider selected by the user. They must call the service with fallback
disabled. A missing key, invalid host or provider execution failure therefore remains visible to the settings UI instead
of being masked by ExaMCP or Cherry Fetch.

Strictness is an optional Main-only execution option. It does not alter shared IPC request schemas or persisted data.
Normal AI tools and Knowledge URL ingestion use fallback-enabled execution.

## Availability and routing

`resolveWebToolRoutes` already falls back between model-native and client sources at request-build time. It should remain
unchanged. Its `clientSearchAvailable` and `clientFetchAvailable` inputs must instead describe the effective configured
capability:

- ready primary provider, or
- ready fixed provider-level fallback.

The same pure availability rule must be used by Main and Renderer. Otherwise the renderer may disable Web Search, or
Main may omit the client tools, before `WebSearchService` can perform its runtime fallback.

When the selected primary is not ready but a fallback is, the composer should identify the effective fallback provider
for its client-provider icon. Saved provider selection and settings UI remain unchanged; fallback does not silently
rewrite user preferences.

## Security and operational boundaries

- Caller abort always wins and is never converted into a provider failure.
- Cherry Fetch-to-Jina external fallback retains `sanitizeRemoteUrl` and `app.fetch.allow_private_network` behavior.
- Jina-to-Cherry-Fetch and other provider-to-Cherry-Fetch transitions do not weaken Cherry Fetch's own remote URL safety.
- No credentials, request contents or full provider response bodies are added to logs.
- Fallback adds at most one provider attempt per failed input, keeping worst-case latency bounded by the two providers'
  existing timeouts.

## Verification

Service tests must prove:

- missing-key keyword search skips the primary and succeeds through ExaMCP;
- runtime keyword-search failure retries only failed keywords through ExaMCP and preserves order;
- missing-key and runtime URL-fetch failures use Cherry Fetch;
- direct Cherry Fetch still falls back to Jina;
- a fallback failure retains primary and fallback diagnostics;
- caller cancellation, invalid inputs, empty successful results and post-processing failures do not trigger fallback;
- fallback never recursively starts another fallback;
- strict settings checks surface the primary provider failure.

Shared/Main/Renderer tests must prove that fallback readiness makes the client capability available without changing the
saved primary provider, and that the effective fallback provider is used for the composer icon when the primary is not
ready.

Targeted verification consists of the Web Search service and IPC handler tests, shared provider preset tests, AI SDK
parameter tests, composer Web Search button tests, `pnpm lint`, and `pnpm docs:check` while this implementation note is
present.
