# Agent Note: Unified web search and fetch usage capture

Status: proposed

English | [中文](2026-10-18-web-search-usage.zh.md)

## Problem

Search and page reading need a common usage contract before their costs can be calculated consistently. This proposal covers both `web_search` and `web_fetch`, including provider-native `serverTools`. Its first deliverable includes observable usage, attribution, persistence, compatible read APIs, and a local records Tab in the existing usage page. Provider-settings and message-footer extensions, a web dashboard, price editors, scheduled multipliers for search, balance deduction, and quota reconciliation require follow-up work.

The inspected baseline is `46ef0b8ce375eae15a62daefa5df2d0ca76f1eed`. No existing active Agent Note owns this decision; this is a new architecture Spec. The following are current implementation facts, not proposed behavior:

| Boundary | Current behavior | Missing information |
| --- | --- | --- |
| [Portable protocols](../../../../packages/web-search/src/types.ts) | Provider modules return result arrays; the client adds provider and capability identity. | Metering, request identity, and web-specific cost evidence are lost. |
| [Desktop execution](../../../../src/main/services/webSearch/WebSearchService.ts) | Inputs fan out; fallback results merge before filtering and truncation. [Jina](../../../../src/main/services/webSearch/providers/api/JinaProvider.ts) also retries an alternate host inside its driver. | The final result cannot reconstruct every completed invocation. |
| [Native tool routing](../../../../src/main/ai/provider/__tests__/serverToolDelivery.test.ts) | Factories, provider options, body transforms, implicit search, and gateways all deliver `serverTools`. | Capability declarations do not establish a metering format. |
| [Language capture](../../../../src/main/ai/hooks/billingHook.ts) | Each completed `doGenerate` or `doStream` produces one immutable usage record from token usage. | Capture does not inspect provider metadata or completed native tool results. |
| [Runtime capture](../../../../src/main/ai/runtime/types.ts) | Direct Agent SDK routes emit per-invocation token usage; gateway routes use provider-call capture. | The runtime-neutral event does not carry web usage. |
| [Client tools](../../../../src/main/ai/tools/webLookup.ts) | AI SDK and [Cherry MCP](../../../../src/main/ai/mcp/servers/cherryBuiltinTools.ts) share search/fetch execution. | They currently pass cancellation without a frozen message/source attribution context. |

The owning [usage-record contract](../../../../docs/references/ai/ai-usage-records.md) remains best-effort analytics. A successful local tool call, a provider search query, a credit, a page, and a monetary charge are different facts. Citation count, result count, tool availability, and the configured result limit cannot substitute for billable usage.

## Proposal

### One portable contract

Define and export `WebSearchUsage` from `@cherrystudio/web-search`. The application reuses this type at its shared data boundary. Native adapters live in `src/main/ai/provider/` and import the contract; aiCore does not acquire a web-search dependency or an application-specific metering registry.

```ts
export type WebSearchUsage = Readonly<{
  operations: readonly Readonly<{
    operation: 'search' | 'fetch'
    calls?: number
    meters: readonly Readonly<{
      unit: 'request' | 'query' | 'credit' | 'token' | 'page'
      quantity: number
      source: 'provider' | 'observed'
    }>[]
  }>[]
  reportedCost?: Readonly<{
    amount: number
    currency: string
    kind: 'actual' | 'estimate'
  }>
}>
```

`calls` counts completed, observable executions of an operation. A standalone search request normally supplies one; Gemini query metadata does not establish a native tool-call count. `meters` preserves the provider's charging unit. `provider` means a validated response field; `observed` means an exact observation mapped by a documented endpoint-specific rule. Observing one HTTP request does not automatically produce one billable `request` meter.

Missing values mean unknown. Zero is retained only with affirmative evidence. An operation with omitted `calls` and empty `meters` explicitly says that usage is unavailable. An absent `webUsage` field on a historical record means that capture did not exist. An empty `operations` array is reserved for a complete observation proving no web activity; enabling a tool without seeing its usage does not prove zero. Each operation and meter unit occurs at most once in a normalized invocation.

Counts and integer-valued meters must be finite, safe, nonnegative integers. Credits may be finite nonnegative fractions. Invalid optional metering is omitted and logged without failing a successful search or model response. Preserve any independently valid facts.

`reportedCost` is optional evidence scoped to this web invocation, or to an explicitly identified web subtotal inside a model invocation. It never carries the entire model response cost. An amount without a reliable currency is unavailable. Provider estimates remain `estimate`; for example, Exa documents `costDollars` as an estimated cost. Do not relabel it as an actual invoice charge. A search request that includes content extraction owns its bundled amount once; do not invent a second fetch charge or a breakdown.

This phase records cost evidence without adding a new search price calculation or changing existing monetary totals. A later pricing change must define completeness and avoid adding web subtotals to a model total that already includes them. Tokens used to bill a web API stay in its meter; they do not increase model Token usage, context size, or generation TPS.

### Expose usage at the provider boundary

Change `WebSearchProviderModule.execute` to return `{ results, usage, providerRequestId? }`. `WebSearchResultSet` preserves those fields. Providers parse usage before result slicing, blacklist filtering, or content truncation. This changes the portable provider-module API and requires the package's normal release compatibility handling.

For native model calls, expose the same contract at `providerMetadata.cherry.webUsage` on the non-streaming result and streaming terminal part. The existing language usage middleware owns normalization and record creation; it forwards existing content, metadata, and chunk order. It does not mutate `usage.raw` or the AI SDK token-usage type, and it does not add another independently persisting observer.

The normalizer accepts the resolved endpoint family, provider preset, actual serving identity, raw usage, provider metadata, and completed provider-executed tool evidence. Select the adapter at the invocation boundary. A copied provider preserves its configured identity while using its preset's parser. A gateway uses only the actual response format delivered by its selected endpoint; an OpenAI-shaped request alone does not authorize OpenAI billing assumptions.

Streaming tool evidence is invocation-local and deduplicated by provider tool-call/item ID. Capture accepts only tools resolved as provider-executed; the wire name `web_search` also names Cherry's client tool. Repeated cumulative counters replace or reconcile the same snapshot according to that protocol; they are not summed as deltas. Distinct completed model steps remain distinct invocations.

### Adapter coverage and evidence

Every enabled provider/capability and every declared native web tool must have a fixture-backed adapter or an explicit unavailable-usage result. Extend the existing native delivery-coverage approach to metering so a new capability cannot silently evade this classification. Raw response keys alone do not prove the SDK preserves them: inspect and test the installed, patched SDK boundary.

| Standalone provider | Initial adaptation |
| --- | --- |
| Tavily | Request `include_usage: true`; preserve `usage.credits` and `request_id`. A completed request supplies `calls = 1` even with zero results. |
| Exa | Preserve `requestId` and estimated `costDollars.total`; a request with inline contents remains one web invocation. No credit/query count is invented. |
| Jina, Firecrawl | Preserve validated token/credit evidence when supplied by the supported response format. Until its field and scope have a fixture and authoritative source, expose the completed call with unavailable meters. |
| Zhipu, Bocha, Querit, Parallel, Serply, DeepSeek, Crawl4AI | Expose completed calls and any documented, fixture-verified metering. Missing monetary or billable-unit evidence remains unknown. |
| SearXNG, Exa MCP | Expose completed observable operations. A missing usage field or a self-hosted endpoint does not establish a zero price. |
| Desktop DuckDuckGo and local Fetch | Expose local operation counts with unavailable vendor billing meters; local extraction is not a remote provider request. |

The [Tavily response contract](https://docs.tavily.com/documentation/api-reference/endpoint/search) and [Exa response contract](https://exa.ai/docs/reference/search) establish the first two adapters. The remaining richer meter mappings require their own sources and fixtures in implementation; this Spec does not assert nonexistent fields.

| Native route | Metering boundary and interpretation |
| --- | --- |
| Anthropic Messages | Normalize `usage.raw.server_tool_use.web_search_requests` and `web_fetch_requests` where preserved. Completed server-tool blocks provide observable execution evidence, not a second additive counter. |
| OpenAI Responses | Deduplicate completed `web_search_call` results. SDK output uses `action.type` values `search`, `openPage`, and `findInPage`: normalize search separately from page reading; finding text within a page is not another fetch. Only an endpoint-specific documented rule produces billing meters. |
| Gemini and Gemini on Vertex | Read `groundingMetadata.webSearchQueries` and `urlContextMetadata` under the actual metadata namespace. Report distinct nonempty query observations and successful URL retrievals; preserve unknown native call counts. Model-specific billing may use queries or grounded requests and is never inferred just from the Gemini brand. |
| xAI Responses | Count only identifiable completed web operations. `num_server_side_tools_used` includes other tools and cannot be copied into web-search usage. `x_search` remains distinct from web search. |
| Perplexity | Preserve `providerMetadata.perplexity.usage.numSearchQueries` when supplied; keep absent query counts unknown. Request/model costs are not automatically search-only costs. |
| Kimi / Moonshot | The declared server route executes a [formula fiber](../../../../src/main/ai/provider/custom/moonshotProvider.ts) on the host. Capture at `runFormulaFiber`, not in language middleware and not in Cherry's `WebSearchService`. |
| Zhipu, DashScope, Doubao, DeepSeek, Poe | Use the vendor-and-endpoint response contract. Enabling native search or receiving citations does not establish a usage count. Explicitly classify unavailable meters until a fixture proves otherwise. |
| Bedrock, Azure, Vertex Anthropic, CherryIN, New API, AIHubMix, OpenRouter | Reuse a parser only when the delivered response preserves its evidence. Otherwise record unavailable web usage. OpenRouter's response-wide reported cost keeps its existing model-invocation owner. |

The [Claude search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) and [fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) contracts report separate counters; fetch has no separate tool fee under the documented direct API terms. [OpenAI's web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search) distinguishes search, opening a page, and finding page text. [Gemini's grounding contract](https://ai.google.dev/gemini-api/docs/google-search) distinguishes query billing from older prompt billing. These facts justify separate observations and meters; this Spec freezes no prices.

### Capture owners and attribution

| Path | Sole durable capture owner | Record granularity |
| --- | --- | --- |
| Independent search/fetch | `RemoteWebSearchProvider.executeRemote`, plus equivalent local-driver boundaries | One row per completed actual execution, before host retries, fallback, or response merging. |
| Provider-executed native tools through AI SDK | Existing `billingHook` language middleware | `webUsage` on the existing language invocation row; no additional model request. |
| Host-executed Kimi formula | Formula execution boundary | A standalone search row linked to the owning message; language calls keep only their model usage. |
| Direct/external Claude Agent SDK | Driver's existing pending-invocation collector and runtime `usage` event | Extend the event with `webUsage` and persist it once with its model invocation. |
| Gateway Agent traffic | Provider-call middleware | SDK/runtime usage remains a reconciliation view and does not persist duplicates. |
| Cherry MCP and Pi client tools | Underlying Cherry web-operation owner | The bridge threads attribution but does not independently insert a second usage record. |

Generate `web-search:<uuid>` before each actual standalone execution. A replay of the same normalized capture uses that same ID; a new network attempt gets a new ID even if the tool-call ID is unchanged. Retain the provider request ID separately. Native usage uses its existing model invocation ID. Never deduplicate different requests by query, URL, result, or parent message.

At tool entry, freeze `messageRef` and `source` using the owning dispatch. Thread them through AI SDK `RequestContext`, `webLookup`, `WebSearchService`, and the formula executor. The MCP connection must obtain an invocation-specific context from its host when the tool begins; freezing one message when a long-lived server is created would attribute later turns incorrectly. A tool already running keeps its original message across steer or continuation. Settings checks and stateless calls explicitly use a null message reference.

Freeze the selected provider, endpoint, and credential receipt before sending. A fallback creates a new capture for the provider/key that actually serves it. Search keys are currently string arrays without stable IDs; use unknown credential attribution unless the selection owner can supply an existing stable non-secret identity. Do not fabricate a model key ID, persist raw keys, or add a search-key migration for this phase.

Record a completed standalone invocation before post-processing, including a successful empty search. If upstream completion and valid metering are known but local result validation fails, attach only `completedInvocation: { usage, providerRequestId? }` to the typed `WebSearchError` and let the same owner record it before rethrowing. Timeout, cancellation, or provider failure without completion evidence creates no successful usage fact and never establishes zero consumption. Keep previously completed parallel inputs even if another input aborts the outer call.

Native collection commits with the existing completed model invocation. Reconcile repeated final snapshots before the single insert; late conflicting repeats keep the first record and log an integrity warning. Abort without model-invocation completion does not manufacture a successful language row. This first phase therefore cannot guarantee retention of native tool work completed before an otherwise incomplete model invocation. Previously completed steps remain recorded. SDK-internal retries or automatic continuations whose separate web evidence is hidden are also outside observable coverage; expose the limitation rather than reconstructing counts from final citations.

### Persistence and read contract

Extend `ai_usage_record` with nullable `webUsage` JSON, nullable `providerRequestId`, and standalone `web-search` / `web-fetch` modalities. Among new invocation rows, permit a null `modelId` only for those standalone modalities; language/image/embedding/rerank invocations and legacy aggregates retain their existing identity requirements and exceptions. Standalone rows store `providerId = web-search:<configured-provider-id>`, including host-executed formulas; display names remain the frozen provider names. Read scopes preserve this namespace so `web-search:deepseek` cannot collide with the language provider `deepseek`. Native usage retains the model provider identity.

Keep insert-only request-ID deduplication, frozen snapshots, and best-effort write failure behavior. Add a new migrate-forward migration; existing rows retain `webUsage = null` and are not backfilled from old message content. Observe existing message projection ownership: runtime finalization never writes usage or repairs records.

Expose `webUsage` through the existing read-only usage-record DataApi at record granularity. Historical null values remain uncaptured; they do not establish an unknown search/fetch operation. Do not mix credit/token/page/query units or sum provider credits across providers. Standalone web records do not increase model request counts, unknown model-price counts, context Token usage, or TPS. Native web activity does not add a second request count. Define the compatible read scopes below; no separate ledger or web aggregate endpoint is introduced.

Do not persist query strings, URLs, result text, raw headers, or unfiltered provider metadata in the usage record. Usage capture failure logs through `loggerService` and does not fail the search or model response. The model-facing result remains search/page content; usage metadata is for application consumers.

### Compatibility with existing usage consumers

Keep one durable fact source, `ai_usage_record`, while exposing two read scopes. The existing model-oriented metrics cannot be generalized by adding a renderer Tab: [AiUsageRecordService](../../../../src/main/data/services/AiUsageRecordService.ts) currently sums requests and unpriced records across every matching row, and its message projection does the same. Extend this upstream boundary before enabling standalone web inserts.

| Read surface | Scope and compatibility rule |
| --- | --- |
| Existing AI records | Add optional `scope: 'ai' | 'web'` to the list query, defaulting to `ai`. AI scope contains the existing language/embedding/image/rerank records, including legacy aggregates with unknown model identity. Native web metadata remains attached to its language row. |
| Web records | `scope: 'web'` returns standalone web rows and existing model rows with nonempty `webUsage.operations`. Preserve the original row ID and invocation granularity. Unknown counters and explicit zero remain eligible; historical null and confirmed empty operations do not synthesize web activity. |
| Statistics and timeline | Retain the existing AI scope, including currency totals, ranked groups, remainder, activity days, and comparisons. This phase adds no web dashboard aggregation API. |
| Message usage projection | Calculate existing requests, unpriced requests, model Tokens, costs, and performance from AI rows only. Web facts remain readable through the list query with the existing message filter; runtime finalization gains no second write owner. |

Apply the list scope before sorting, cursor pagination, and total counting. Include scope in read-cache identity. Web scope accepts only `createdAt` sorting; existing AI sorting remains unchanged. Do not fetch a page of mixed records and filter it in the renderer. A native model row may appear in both read scopes as two views of the same fact; it is never inserted twice. A row containing search and fetch appears once and retains both operations and any bundled monetary evidence.

Standalone rows retain `requestCount = 1`; their provider meters live only in `webUsage`. Keep model token, pricing, and monetary fields null, including when a web provider reports an estimated amount. Preserve web amounts and their currency/kind inside `webUsage.reportedCost`; do not copy them into the existing model cost ledger or invent zero-priced model requests. Preserve all existing legacy identity exceptions when extending schema checks.

### Minimal records UI

Unify storage and attribution, and use local Tabs for columns whose meanings differ. Add “AI invocations / Web operations” only inside the existing records area of [UsageSettings](../../../../src/renderer/pages/settings/UsageSettings/UsageSettings.tsx). The page overview, heatmap, distribution chart, and their AI accounting scope remain in place. Provider reporting summaries, new message-footer controls, web summary cards, and new pricing controls are follow-up scope.

| Records Tab | Presentation | Query and state |
| --- | --- | --- |
| AI invocations, initially selected | Reuse [UsageEntriesTable](../../../../src/renderer/pages/settings/UsageSettings/UsageEntriesTable.tsx) with its existing model/source/date/Tokens/cost/TTFT/TPS columns. | Default AI scope; retain existing persisted sort keys and all `settings.usage.*` selections. |
| Web operations | Use the existing shared table primitives for frozen provider/ownership, operation, observed calls, provider meters, monetary evidence, source, and time. No model-token or performance placeholders are introduced. | Explicit web scope; reuse the date range and 25-row pagination, initially newest first. Web ordering and cursor state are component-local and never overwrite AI sort preferences. |

The Tab switch affects only record content and its total. It does not switch the page's metrics, charts, currency, grouping, or analysis period. The web table displays each amount in its captured currency; the model currency selector does not convert or hide web monetary evidence. Initial web sorting is by time only. No provider/operation filters or web cost totals are added in this phase.

[useUsageData](../../../../src/renderer/pages/settings/UsageSettings/useUsageData.ts) continues to read the existing AI aggregates. Mount/fetch the active records scope independently, reset its cursor on a scope change, and prevent previous-scope rows from flashing under the other Tab's columns. Preserve existing rows while refreshing or sorting within the same scope. Keep the page-wide selections and AI sort preferences when returning from the web Tab. Returning to the page initially selects AI; no new persisted Tab preference is required.

The current analysis section hides records when AI `hasUsage` is false. Separate record-area visibility from that gate: a database containing only web records must still show both Tabs and allow web records to be opened. Keep the existing AI empty overview and analysis behavior. The AI Tab may be empty while the web Tab has records.

Native entries identify “Model invocation” and the owning model in secondary text without adding its whole model cost as a web amount. Standalone entries identify “Independent invocation”. Render search and fetch separately within a mixed-operation row, and retain the bundled amount once at record level. Frozen provider/source names remain readable after configuration deletion. The first delivery does not add message navigation or a new detail-dialog flow.

Show explicit zero with its unit, absent counters/meters as “Not provided”, and absent native web amounts as “Not itemized”. Estimates visibly say “Estimated”; local vendor billing is “Not applicable”. Never label missing evidence “Free”. Unknown call counts do not erase known query/credit evidence. Preserve the small-positive-amount floor. Each Tab has its own loading, empty, and refresh-error state; a web read failure never blanks the existing AI metrics. No usage read initiates a search or a page read.

Follow [DESIGN.md](../../../../DESIGN.md) and better-ui's preference for existing components and density. Use `@cherrystudio/ui` Tabs/Table primitives, semantic tokens, i18next labels, and existing number/time formatters. Keep the existing responsive column and table overflow behavior; make the Tab controls and web table usable with keyboard and at 400px in both themes. Use visible text for estimates and unavailable values. Do not add page-local animation or a parallel design system.

### Implementation slices after Spec approval

1. Portable contract and provider adaptation: change the provider return envelope, preserve metering, define completed-error evidence, and cover every standalone provider/capability with fixtures. Verify with explicit paths under `packages/web-search/src/__tests__/`.
2. Native normalization: enrich generate/stream metadata and extend the direct Agent SDK invocation event. Cover protocol-specific snapshots, item-ID deduplication, copied providers, gateways, and Kimi's actual execution owner with explicit main-process test paths.
3. Durable capture and compatible reads: append the schema migration, thread invocation-scoped attribution through client tools/MCP, and add list scopes while isolating existing AI aggregates/message projections. Use `setupTestDatabase()` to verify insert, deduplication, scoped pagination, old-read equivalence, and migrate-forward behavior with populated legacy rows before enabling standalone inserts.
4. Records Tab: retain the existing usage page and add only the local AI/web records switch. Verify `UsageSettings.test.tsx`, `UsageEntriesTable.test.tsx`, `useUsageData.test.ts`, affected analytics tests, and new web-table tests with explicit renderer paths. Manually verify the Tab, keyboard, 400px layout, and both themes in a tracked Electron instance.

The final implementation layer updates the owning usage reference and package README, adds the required package release metadata, and transitions this bilingual Spec only when every acceptance criterion has actual evidence. Planned tests below have not been run as implementation verification.

## Alternatives considered

- Count tool invocations or citations at the renderer: cannot observe native loops, provider meters, failed post-processing, or the actual serving credential.
- Add fields to `usage.raw` or maintain separate client/native usage shapes: overloads opaque provider data and forces every consumer to understand provider formats.
- Treat all declared `serverTools` as server-executed: misses Kimi's host-side network operation and double-counts language/tool lifecycle events.
- Add a separate usage table or a generic billable-operation framework now: introduces another message projection owner or a broader abstraction before this web-specific contract is proven.
- Store native tools as extra language requests: inflates request counts and risks adding an already-included subtotal to a provider's total.
- Put every operation into the existing model columns, or replace the whole page with an AI/web switch: mixed units and absent model identity make the first misleading; the second expands the dashboard scope unnecessarily. Shared facts with local records Tabs preserve both accounting meanings.
- Filter web rows only in the renderer: leaves totals, pagination, ranked groups, timelines, and message projections contaminated upstream.
- Promise invoice-complete capture or invent zero for unsupported providers: cannot account for hidden retries, account-wide quotas, or incomplete native invocations.

## Acceptance criteria

- AC1 — Search and fetch expose the same serializable contract through portable results, AI SDK terminal metadata, runtime usage events, and the read-only usage-record API without changing model-facing tool output. (verification: unit; owner: web-search, billingHook, runtime-contract and DataApi tests)
- AC2 — Every current standalone provider/capability and declared native web-tool route is classified by a fixture-backed adapter or an explicit unknown-usage case; adding an unclassified route fails coverage. (verification: unit; owner: protocol and provider delivery/metering coverage tests)
- AC3 — Reported zero, missing usage, malformed counters, fractional credits, and a confirmed unused tool remain distinguishable; unsupported metering never fails an otherwise successful invocation. (verification: unit; owner: shared usage schema and adapter tests)
- AC4 — Tavily credits, Exa estimated cost, Anthropic search/fetch counters, OpenAI action kinds, Gemini query/URL evidence, and Perplexity query counts retain their distinct meanings in streaming and non-streaming fixtures. (verification: unit; owner: provider usage adapter tests)
- AC5 — Duplicate tool events and cumulative native snapshots do not add usage twice; a completed second model step does add its own usage, and client tools sharing the native wire name are excluded from native capture. (verification: unit; owner: billingHook and runtime-driver tests)
- AC6 — Multiple inputs, Jina host retry, provider fallback, successful empty results, and post-processing failure retain every evidenced completed standalone execution exactly once under its actual provider identity. (verification: unit; owner: WebSearchService and provider-driver tests)
- AC7 — A tool that crosses a steer boundary keeps its original message/source association; a later MCP call uses the later turn, and settings/stateless calls create no invented message association. (verification: unit; owner: webLookup, builtin MCP and Agent runtime tests)
- AC8 — Kimi formula calls have one standalone search capture, while gateway-backed Agent requests have one provider-call capture and no duplicate SDK record. (verification: unit; owner: moonshotProvider and Agent usage ownership tests)
- AC9 — A populated pre-change database migrates forward with all existing usage rows unchanged; new standalone rows permit no model and remain isolated from same-named model-provider identities. (verification: unit; owner: setupTestDatabase migration and AiUsageRecordService tests)
- AC10 — Record replay is idempotent, native usage does not increase model request count, and standalone web usage does not alter model Tokens/TPS or unknown model-price counts; web evidence preserves provider and unit boundaries. (verification: unit; owner: AiUsageRecordService, message projection and usage API tests)
- AC11 — Cancellation or timeout without completion does not become zero or a successful invocation; prior completed work survives, and failing usage persistence leaves the actual search/model result unchanged. (verification: unit; owner: protocol, billingHook and usage-record failure tests)
- AC12 — Usage records expose no raw keys, queries, URLs, results, or unrestricted provider metadata; English/Chinese notes, affected references, package documentation and release metadata pass their applicable gates. (verification: unit and docs gate; owner: serialization/security fixtures and implementation author)
- AC13 — Omitted list scope retains existing AI records including legacy identity gaps; web scope includes standalone and native evidence, excludes uncaptured/confirmed-empty activity, and preserves original record IDs. Scope applies before cursor pagination and total counting. (verification: unit; owner: usage query-schema and setupTestDatabase service tests)
- AC14 — Given the same historical AI rows plus new standalone web rows, existing statistics, timeline currency totals/rankings/remainders, activity-day inputs, and message AI projections equal the AI-only baseline. Web estimates remain web evidence without changing model monetary fields. (verification: unit; owner: AiUsageRecordService aggregate and message projection compatibility tests)
- AC15 — The record-area Tabs initially select AI and preserve all page-wide selections and AI sorting. Switching to web changes only records, isolates query/cursor/cache state, never flashes AI rows under web columns, and remains accessible when AI usage is empty. (verification: renderer; owner: UsageSettings, UsageEntriesTable and useUsageData tests)
- AC16 — The web table preserves search/fetch, native/independent ownership, mixed-operation record granularity, provider units, zero/unknown distinctions, estimate currencies, local billing applicability, and small positive amounts. Each scope retains its own loading/empty/refresh state without affecting AI metrics. (verification: renderer; owner: web records table and scoped list consumer tests)
- AC17 — The local record Tabs and web table support keyboard navigation, long translations, a 400px layout and both themes through shared UI primitives and i18next. Existing AI overview, heatmap, analysis, and table behavior remain intact. (verification: Electron; owner: tracked Electron verification report)

## Risks

The portable provider return change needs coordinated package consumers. SDK response schemas may strip vendor fields, and provider tool events may omit status or action details. Such gaps require a narrow SDK/upstream improvement with fixtures; they do not justify inferring billable usage from citations or intercepting every HTTP/SSE body. No SDK patch is authorized by this Spec alone.

Google's installed adapter can aggregate internal continuations while retaining only the latest grounding metadata. A middleware at `doStream`/`doGenerate` cannot promise per-network-search completeness in that case. Direct/external runtimes may expose only aggregate usage; keep that ownership granularity and state unavailable dimensions.

Adding standalone web records changes assumptions in existing model-oriented aggregates, filters, and message projections. Tests must prove separation before these records are enabled. Historical rows remain unknown, and best-effort analytics cannot replace provider billing.

Human approval is required on the current Spec PR head before implementation under the [Agent Note workflow](../../README.md). Material changes to these capture boundaries, unknown-value semantics, or acceptance criteria require renewed approval.
