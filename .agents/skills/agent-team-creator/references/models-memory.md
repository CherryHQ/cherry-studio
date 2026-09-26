# Models and optional memory

These are source-based adapter contracts, not live server certification. The packaged runtime requires Node >=22, no runtime dependencies and no extra resident service. Discovery never starts inference; memory publication only sends explicitly queued content to the configured endpoint.

## Discovery API

`discoverModels(input: ObjectValue): Promise<Json>` accepts `kind: "openai" | "uar" | "bossfang"`, `discoveryUrl`, optional `auth`, `timeoutMs`, `catalog`, `aliases`, `tiers`, and `maxCatalogAgeDays`.

For OpenAI-compatible discovery, `baseUrl` may replace `discoveryUrl`; it appends `/v1/models` without duplicating a trailing `/v1`. UAR and BossFang require the exact configured discovery URL: UAR's provider-specific `/api/uar/providers/<id>/models` or BossFang's `/api/models`. Responses are respectively `{data:[...]}`, a model array, and `{models:[...]}`. Native capability flags are configured metadata; availability is not proof of successful inference.

Authentication uses environment references, never literal values:

```json
{"kind":"openai","baseUrl":"http://127.0.0.1:8000","auth":{"env":"GATEWAY_API_KEY"},"timeoutMs":10000}
```

`auth.header` supports `Authorization` (default) or `X-API-Key`; `auth.scheme` supports `Bearer` (Authorization default) or `raw` (X-API-Key default). URLs reject userinfo, fragments and credential query parameters; HTTP is allowed only for loopback hosts. Redirects are refused. Timeouts are 1–60,000 ms; JSON responses are limited to 8 MiB. Remote error bodies and raw fetch errors are not logged or persisted.

Supply the actual liter-llm schema-1 document under `catalog`; it has `$schema_version: 1`, `$provenance`, and provider/model maps. Gateway aliases require explicit mappings:

```json
{"aliases":{"gateway-alias":{"provider":"catalog-provider","model":"catalog-model-id"}},"tiers":{"gateway-alias":"medium"},"maxCatalogAgeDays":30}
```

Every mapped catalog model must exist. Similar names and provider prefixes never establish identity. Unmapped aliases retain unknown catalog metadata. Strength tiers are only the operator's `low`, `medium`, or `hard`; native routing tiers are not reinterpreted.

The result is `{schemaVersion:1, models, catalogProvenance, catalogFreshness, diagnostics}`. Models retain exact IDs, nullable declared tier, known capability booleans, nullable prices, provenance and freshness. OpenAI-compatible aliases are discovery-listed; UAR `enabled` and BossFang `available` determine configured eligibility. None certifies live inference.

liter-llm prices are USD **per token**. Conversion multiplies by 1,000,000. A ceiling compares the maximum base/context-tier price; any unknown tier price leaves that side unknown. BossFang's own costs are already per million and are labeled configured base prices. These are text input/output comparisons, not bounds on entire bills, cache, audio, image, reasoning or future rates. Provenance retains source/hash/fetch date/library version; missing or future fetch dates yield unknown staleness. Stale catalog metadata is reported, not silently refreshed.

## Selection API

`selectModel(team, roleId, skills: string[], taskPolicy: ModelPolicy, catalog: unknown): Json` accepts the discovery result or `{catalog, availableModels:["gateway-alias"], aliases, tiers, maxCatalogAgeDays}`. This second form is explicitly **operator-declared availability**, not live discovery. A catalog alone does not prove availability.

Policies resolve team → role → ordered skills → task. Scalars override earlier values; capabilities accumulate and every required capability must be explicitly true. Empty task capabilities do not erase team requirements. Shared strict policy validation rejects unknown fields and invalid ceilings. Required tiers match exactly; prices of unknown value cannot satisfy a ceiling.

Eligible models sort by lowest known input+output per-million price, then exact identifier. Unknown prices sort last when no ceiling excludes them. This is deterministic comparison, not a workload cost prediction. Output includes `selected` (null if none), effective `policy`, `appliedLayers`, rejections with reasons, explanation and warnings. Selected stale/unknown price freshness generates an explicit warning that ceilings do not guarantee current rates.

## Memory APIs and persistence

`queueMemory(state, input): MemoryEntry` accepts `{content, scope, provenance?, id?}`. The caller must commit its mutation using the state's lock/revision transaction **before** publication. An omitted ID is a stable content/scope/provenance digest. Repeating identical input returns the existing entry; an ID collision with different content fails. Published entries remain in the outbox.

`publishMemory(state, input): Promise<Json>` requires a persisted queued `id`. It mutates the receipt and status in the supplied state; it does not write the file itself. Missing endpoint or remote failure returns `status: "queued"`; the caller must commit that receipt. Repeated publication of a published entry returns its recorded receipt without another request.

The verified surreal-memory REST adapter accepts:

```json
{"id":"memory-example","provider":"surreal-memory","url":"http://127.0.0.1:8001/api/v1/memory/","scopeMapping":{"scope":"team:example","agentId":"example-team","userId":"anonymous"},"auth":{"env":"MEMORY_API_KEY"}}
```

The port is operator configuration. `scopeMapping.scope` must exactly equal the queued logical scope; `agentId` is required, `userId` and `sessionId` optional. The actual request has `content`, `agent_id`, `user_id`, `session_id`, and `categories`. No metadata/idempotency field is invented: content contains an envelope preserving local ID, scope, provenance and original content.

**Scope limitation:** identity fields are retrieval filters, not an authorization guarantee. The inspected REST constructor defaults the stored scope enum to global. This adapter does not claim private server scope; use an appropriately authorized deployment or explicitly mapped API when enforced isolation is needed.

Other providers use `provider: "mapped-http"` and an explicit mapping:

```json
{"source":"https://memory.example/docs/store","version":"deployed-version","method":"POST","contentField":"text","scopeField":"scope","provenanceField":"provenance","idempotencyField":"request_id","idempotencyHeader":"Idempotency-Key","responseIdField":"id","constants":{}}
```

Mapping fields are top-level JSON properties; collisions fail. POST/PUT are supported. Scope/provenance mappings are mandatory. Idempotency field/header are optional and do not certify a remote guarantee. No unspecified MCP tool is invented. Endpoint and mapping are fingerprinted, so retries cannot silently change destinations.

Receipts retain local ID, payload fingerprint, target contract, HTTP status when known, remote ID on success, and uncertainty. **Exactly-once delivery is not guaranteed.** The verified surreal-memory implementation performs similarity deduplication, not request-key deduplication. Failed transports, invalid success responses and server errors can hide committed remote work; reconcile before setting `retryUncertain: true`. A process crash after remote commit but before local persistence also requires reconciliation.

Literal credential fields and known secret environment values are rejected from persisted structures. This is not a general secret scanner: do not place credentials in content/provenance/aliases. Unavailable services do not prevent local queuing or other team work.

## KBD and Karpathy boundaries

Optional `provenance.kbd` must exactly match a linked team task's five-part identity. This validates the local reference only; it is labeled an unverified mirror. Neither memory API emits Karpathy boundaries, completes KBD tasks, or writes knowledge bundles. Validate canonical identity and complete a real KBD boundary through its actual CLI, then use the existing Karpathy procedure and real receipt. `pk` remains the sole knowledge-bundle writer.

## Primary source contracts

- [liter-llm schema-1 catalog](https://github.com/GQAdonis/liter-llm/blob/c5c6caac617eb931cd5009146a70831422ec236c/schemas/catalog.json), [price transformation](https://github.com/GQAdonis/liter-llm/blob/c5c6caac617eb931cd5009146a70831422ec236c/crates/liter-llm-catalog-gen/src/transform.rs), and [configured alias discovery](https://github.com/GQAdonis/liter-llm/blob/c5c6caac617eb931cd5009146a70831422ec236c/crates/liter-llm-proxy/src/routes/models.rs).
- [UAR provider route](https://github.com/Prometheus-AGS/universal-agent-runtime/blob/ba12845138104d3c8c3b8bca8bc7c5be24004e91/src/uar/api/providers.rs) and [ModelConfig](https://github.com/Prometheus-AGS/universal-agent-runtime/blob/ba12845138104d3c8c3b8bca8bc7c5be24004e91/src/llm/registry.rs).
- BossFang: local fork `crates/librefang-api/src/routes/providers.rs`, `list_models`; retain the deployment source/version with registration artifacts.
- [surreal-memory request](https://github.com/Prometheus-AGS/surreal-memory-server/blob/dd7fdcd6d8974af4059d1d51401bd33ae29f65db/src/contracts.rs), [HTTP handler](https://github.com/Prometheus-AGS/surreal-memory-server/blob/dd7fdcd6d8974af4059d1d51401bd33ae29f65db/src/api/memory.rs), [scope constructor](https://github.com/Prometheus-AGS/surreal-memory-server/blob/dd7fdcd6d8974af4059d1d51401bd33ae29f65db/crates/surreal-memory/src/memory.rs), and [similarity deduplication](https://github.com/Prometheus-AGS/surreal-memory-server/blob/dd7fdcd6d8974af4059d1d51401bd33ae29f65db/crates/surreal-memory/src/storage/surreal.rs).
