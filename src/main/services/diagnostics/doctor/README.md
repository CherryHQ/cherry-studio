# System Doctor

Runs health checks in main and publishes progress + terminal state on the shared cache key returned by
`doctorStateCacheKey(scope)`. Product spec (Feishu): System Doctor PRD.

## Layout

| File | Role |
|------|------|
| `@shared/types/doctor.ts` | **Source of truth.** `DOCTOR_CHECK_CATALOG` declares every check (domain, tier, scope, execution policy, fixes, detail variants, prerequisites); all other types derive from it |
| `@shared/ipc/schemas/doctor.ts` | Routes `diagnostics.doctor.run` / `.run_contextual` / `.cancel` / `.fix` / `.connectivity` / `.confirm_check` |
| `types.ts` | `DoctorCheckDefinition<Id>` — what a check implementation must provide |
| `checks/<domain>.ts` | One file per domain, `defineDoctorCheck({...})` per check |
| `registry.ts` | `{ [Id in DoctorCheckId]: DoctorCheckDefinition<Id> }` — exhaustive and closed |
| `engine.ts` | Pure runner: prerequisite layering, timeout, cancel, skip cascade, lane concurrency |
| `execution.ts` | Per-run results, prepared confirmations and engine admission |
| `DoctorService.ts` | Lifecycle service: run / contextual diagnosis / cancel / fix, publishes shared state |

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
`skip` may carry a declared detail for an inapplicable check; dependency skips and `error` belong to the engine; every declared fix needs a handler.

## Data classes

Every evidence item and basics field carries a `dataClass`. `projectDoctorReport(report, view)` builds the
`display` / `copy` / `export` / `upload` views; `consent_required` items only travel on explicit opt-in.
Paths and hostnames are `local_only`; raw error bodies are `consent_required`.

## Consuming from the renderer

```ts
const subject = { kind: 'chat', providerId, modelId } as const // or { kind: 'global' } / { kind: 'agent', agentId }
const scope = doctorScopeKey(subject)
const state = useSharedCacheValue(doctorStateCacheKey(scope))
await ipcApi.request('diagnostics.doctor.run', { tier: 'quick', subject })
await ipcApi.request('diagnostics.doctor.run', { tier: 'live', subject })
await ipcApi.request('diagnostics.doctor.run_contextual', { subject })
await ipcApi.request('diagnostics.doctor.cancel', { scope, runId })
await ipcApi.request('diagnostics.doctor.fix', { scope, runId, checkId: 'mcp-servers-connected', fixId: 'restart', target: serverId })
```

`run_contextual` selects the applicable quick checks and contextual connectivity checks in main; generic `run`
does not carry domain-selection flags. Running and terminal states expose Main's authoritative selected check IDs.
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

## Execution confirmation

A catalog entry can declare `execution: 'confirmation'` (omission means `automatic`). Its main-process
check definition must implement `getConfirmation(ctx)` as well as the existing `run(ctx)`; the registry
and factory enforce this at compile time. The callback prepares localized prompt data plus an
`isCurrent()` validator that remains in main. It must not execute the operation. If the operation is
inapplicable, it can return a normal outcome instead, such as `skip` for a non-chat model.

`DoctorExecution` is per-run state owned by DoctorService, not a lifecycle service. It retains the
completed results, shared prepared inputs and pending request IDs. The engine defers a check and its
dependents until admission succeeds, then continues from completed results without rerunning them.
Each confirmation admits only its own check; other gated prerequisites require separate confirmation.
The final dispatch validates the captured target again, including after queueing.

Automatic work completes without holding a timer or active execution slot while the user decides.
The report's optional `pendingChecks` is separate from health outcomes. Each prompt carries its check
ID, a Main-generated request UUID, a check-specific i18n key and interpolation values. Prompts and
request IDs are display-only; copy/export/upload projections omit them even with sensitive-data consent.

`diagnostics.doctor.confirm_check` takes `{ scope, runId, requestId }`. Main validates the run and its
expiry, claims the request before awaiting, then calls the registered check's `run`. Duplicate calls
return `busy` during execution and `stale` after consumption; failure never renews consent. A changed
Agent model, provider configuration or global default invalidates the original target. A new run,
cancellation or service shutdown invalidates pending decisions. Existing cancel routes also cancel
confirmed work. Normal reports are patched under the same run; connectivity results are returned directly.
Fix pre/post-checks use the same admission policy and refuse to proceed if explicit confirmation is needed.

## Contextual model connectivity (backend API)

`diagnostics.doctor.connectivity` accepts a Chat or Agent `subject` and a caller-generated UUID `runId`.
Its report contains `uniqueModelId`, `expiresAt`, `results` and `pendingChecks`. These are catalog checks:

- `network-model-endpoint`: automatically measures the selected model's Base URL; HTTP 404 still proves reachability.
- `provider-model-list`: automatically reads the remote list without merging the registry; skips unsupported or
  unavailable (404/405/501) listing endpoints and warns when the selected wire model is absent.
- `provider-model-conversation`: requests confirmation before a minimal conversation, since it may incur usage fees.

The entries use `includeByDefault: false`, so an existing full-system sweep does not start these new
contextual checks. Explicit subsets still pass through the same policy. Every probe has a 15-second
deadline. Listing failure never implicitly prevents an independently confirmed conversation.

`AiService.prepareModelCheck` captures the model/provider configuration and exposes model operations,
resolved target information and snapshot validity. It imports no Doctor contracts. Conversation reuses
`AiService.checkModel` in chat-only mode without history, tools, retry or fallback. Ollama sends a real
chat request; non-chat models skip without prompting. NetworkService retains ownership of reachability.

The contextual API does not replace the existing Doctor report cache. Error Details uses the contextual run route,
renders the three connectivity steps, supports confirmation, cancellation and in-place retry, and can open the
separate global full-system Doctor without replacing the contextual report.
