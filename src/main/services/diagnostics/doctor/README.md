# System Doctor

Runs health checks in main and publishes progress + the final report on the shared cache key
`doctor.state.${scope}`. Product spec (Feishu): System Doctor PRD.

## Layout

| File | Role |
|------|------|
| `@shared/types/doctor.ts` | **Source of truth.** `DOCTOR_CHECK_CATALOG` declares every check (domain, tier, fixes, detail variants, prerequisites); all other types derive from it |
| `@shared/ipc/schemas/doctor.ts` | Routes `diagnostics.doctor.run` / `.cancel` / `.fix` |
| `types.ts` | `DoctorCheckDefinition<Id>` — what a check implementation must provide |
| `checks/<domain>.ts` | One file per domain, `defineDoctorCheck({...})` per check |
| `registry.ts` | `{ [Id in DoctorCheckId]: DoctorCheckDefinition<Id> }` — exhaustive and closed |
| `engine.ts` | Pure runner: prerequisite layering, timeout, cancel, skip cascade, lane concurrency |
| `DoctorService.ts` | Lifecycle service: run / cancel / fix, publishes `doctor.state.${scope}` |

## Adding a check (three edits, all compile-checked)

1. **Catalog** — add the id to `DOCTOR_CHECK_IDS` and an entry to `DOCTOR_CHECK_CATALOG`:
   ```ts
   'network-proxy-applied': {
     domain: 'network',            // must equal the id prefix
     scope: ['providerId'],       // facts this check reads; global runs use system defaults
     tier: 'live',                 // quick ≤ 1 s local | live = network | deep = opt-in
     fixes: [],                    // or [{ id: 'restart', reversible: true, relaunch: false }]
     details: ['custom_without_url'],
     requires: []                  // other check ids; on their fail/error this check is skipped
   }
   ```
2. **Implementation** — `checks/network.ts`:
   ```ts
   export const proxyApplied = defineDoctorCheck({
     id: 'network-proxy-applied',
     async run({ signal }) {
       // return { status: 'pass' } or
       return {
         status: 'warn',
         attribution: 'user-fixable',
         detail: { variant: 'custom_without_url' },           // only declared variants compile
         actions: [{ kind: 'navigate', target: '/settings/general' }],
         evidence: [{ key: 'mode', value: 'custom', dataClass: 'public' }]
       }
     },
     fixes: {}                                                  // one handler per declared fix
   })
   ```
   `ctx.share(key, factory)` memoizes a probe for the current run, so checks in different layers (all the
   network checks, for instance) reuse one pass instead of probing again.
3. **Registry** — add the line in `registry.ts`. Until you do, the build fails.

Reference implementations: `checks/config.ts` (a check with a fix) and `checks/storage.ts` (a silent-fallback
detector). A check must be able to fail at runtime — anything preboot already guarantees is a dead check.

Then add i18n keys `settings.doctor.checks.<id>.title` and `.detail.<variant>` to `en-us.json` and run `pnpm i18n:sync`.

Rules the types enforce: a `fix` action can only name a fix the catalog declares; `detail.variant` must be declared;
`skip` and `error` are engine-only statuses; every declared fix needs a handler.

## Data classes

Every evidence item and basics field carries a `dataClass`. `projectDoctorReport(report, view)` builds the
`display` / `copy` / `export` / `upload` views; `consent_required` items only travel on explicit opt-in.
Paths and hostnames are `local_only`; raw error bodies are `consent_required`.

## Consuming from the renderer

```ts
const subject = { kind: 'chat', providerId, modelId } as const // or { kind: 'global' } / { kind: 'agent', agentId }
const scope = doctorScopeKey(subject)
const state = useSharedCacheValue(`doctor.state.${scope}`)
await ipcApi.request('diagnostics.doctor.run', { tier: 'quick', subject })
await ipcApi.request('diagnostics.doctor.run', { tier: 'live', subject })
await ipcApi.request('diagnostics.doctor.cancel', { scope, runId })
await ipcApi.request('diagnostics.doctor.fix', { scope, runId, checkId: 'mcp-servers-connected', fixId: 'restart', target: serverId })
```

`run` returns `busy` with the in-flight `runId` while a run is active. `fix` is bound to the report's `runId`
and re-probes before executing; it answers `stale` when the run was superseded or the finding changed.
Only MCP restart requires a target; other fixes reject one. Passing checks never offer actions.
Runs and fixes are mutually exclusive and refused before all services have initialized. Selected checks
include their transitive prerequisites. Fixes revalidate identity, expiry and the offered action after
re-probing; only the original report is updated. Expired reports require another run.

## Ownership

Business adapters provide the subject: Chat uses the producing message's saved model identity;
Agent uses its Agent ID. Error components never infer a subject from optional exception fields.
A missing target leaves diagnostics unavailable; only an explicit global subject runs system checks.
Opening report/export panels does not start health checks. The explicit full-system action opens
its own global Doctor, preserving the contextual report.

DoctorService resolves Agents through AgentService, captures the default model once per execution,
and owns runs and report validity. Contextual DNS/TLS/proxy checks share the selected provider's
endpoint diagnosis; global checks use the built-in endpoints. CacheService transports reports and
does not select their subject. Run metadata is retained with its run ID and expired scopes are
pruned on subsequent runs. Fixes revalidate Agent existence and MCP membership before acting.
MCP connection ownership and resource-level operation coordination remain with McpRuntimeService.

## Contextual model connectivity (backend API)

`diagnostics.doctor.connectivity` accepts a Chat or Agent `subject` and a caller-generated UUID `runId`.
It returns three independent results: Base URL reachability, remote model listing, and a minimal
conversation. Global subjects are rejected. `diagnostics.doctor.cancel_connectivity` requires both
the scope key and run ID, so a stale caller cannot cancel a newer run. A second call in the same
scope returns `busy`; different scopes run independently. Service shutdown cancels pending work.

Ownership follows `DoctorService → AiService / NetworkService`. Doctor's `connectivity.ts` owns
the three check definitions and the model-list skip policy. The existing Doctor engine owns
sequencing, deadlines, cancellation and timing; provider errors use the shared error classification. `AiService.prepareModelCheck` captures
the selected model/provider configuration and exposes the resolved Base URL, normalized wire model
ID, remote listing capability, and cancellable list/conversation operations. The AI layer has no
dependency on Doctor result types, scope, cache, or run IDs. NetworkService owns network probes.

The Base URL probe uses the selected model's endpoint configuration; an HTTP 404 there still proves
reachability. Model listing uses the provider's remote API, without merging the registry catalog.
Registry-only providers skip this step. HTTP 404/405/501 means the configured listing endpoint is
unavailable and is reported as skipped; authentication failures remain failures. An unlisted model
is a warning, since successful conversation is stronger evidence than catalog membership. Failures use the shared `ErrorCategory`; engine timeouts remain `error` results. Every
step runs even when a previous step fails, with a 15-second deadline per step.

Conversation reuses `AiService.checkModel` in chat-only mode, without history or tools and without
retry or model fallback. Ollama performs a real chat request here; its existing metadata-only
settings check remains available. Dedicated non-chat models skip conversation. Configuration is
captured for one execution; credentials continue to follow the provider's serving policy.

This API returns its result directly and does not publish to the existing Doctor report cache or replace its report. Renderer integration and context-based AI error analysis are separate work.
