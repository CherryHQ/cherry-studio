---
description: Post-SDK-upgrade Tool Search and Code Mode implementation phases, replacement maps, approval gaps, and black-box acceptance
sources:
  - src/main/ai/tools
  - src/main/ai/runtime/aiSdk
  - src/main/ai/runtime/pi
  - src/renderer/components/chat/messages/tools
  - src/shared/ai/piBuiltinTools.ts
---

# Phases 2–3 — Tool Search and Code Mode

> Written 2026-10-02 against Cherry `1b799934263`; upstream comparison `ai@7.0.123` and
> `@ai-sdk/code-mode@1.0.80`. **Planned; no migration or black-box test has run.**

Both phases require the [SDK upgrade gate](./sdk-upgrade-plan.md#14-verification-and-exit-gate).
They replace duplicated execution/discovery machinery while preserving Cherry's tool catalog,
request eligibility, approval authority, domain implementations, and durable UI results. They do not
assume that AI SDK Core tool callers are automatically available in every Harness adapter.

## Current implementation and replacement boundaries

Paths below are relative to `src/main/ai/` unless marked otherwise.

| Current surface | Role today | Proposed disposition |
|---|---|---|
| `tools/adapters/aiSdk/registry.ts`, `types.ts`, built-ins and MCP adapters | Registration, request-specific `buildTool`/`applies`, selected servers, native execute/formatters | Retain domain ownership; materialize only eligible tools into v7 |
| `tools/adapters/aiSdk/exposition/shouldDefer.ts` | `always`/`never`/`auto`; 10% context threshold, minimum pool and overhead gates | Initially preserve selection policy; recalibrate measured overhead for native discovery before changing thresholds |
| `exposition/applyDeferExposition.ts` | Removes deferred tools and injects three Cherry meta-tools | Replace on the aiSdk path with full eligible tool set plus `deferLoading` and native `toolSearch()` |
| `meta/toolSearch.ts`, `toolInspect.ts`, `toolInvoke.ts`, `schemaStub.ts` | Namespace browsing, schema inspection, guarded dispatch and inner formatter forwarding | Remove live dispatch only after native search/direct execution covers applicable behavior and all consumers are audited |
| `runtime/aiSdk/prompts/deferredTools.ts`, prompt/parameter assembly | Instructs the model to inspect/invoke deferred names | Replace old instructions at cutover; prevent duplicate/stale discovery catalogs |
| `meta/toolExec.ts`, `meta/exec/runtime.ts` | aiSdk code tool exists but is **not injected** | Retire only after reference audit; adding model-visible code execution to chat is a separate feature decision |
| `tools/codeMode/runtime.ts`, `worker.ts` | Node worker + `new Function`, timeout/cancellation; explicitly not a security sandbox | Replace execution engine with upstream QuickJS after Code Mode parity; retain no second worker implementation after all callers migrate |
| `runtime/pi/piCodeMode.ts` | Pi-specific search/describe/call/exec over mounted MCP tools; nested approvals pause the worker timeout | Migrate separately; plain Core `toolSearch()` is not a drop-in Pi `ToolDefinition` |
| `tools/codeMode/schemaToTypeScript.ts` | Generates signatures for Pi discovery | Remove only when upstream discovery actually supplies Pi's needed signatures |
| Renderer `MessageMetaTool.tsx`, `metaToolNames.ts`, shared tool identifiers | Displays existing/persisted meta-tool messages | Preserve readers for old persisted records; add native result handling without requiring database rewrites |

## Phase 2 — Native Tool Search on the aiSdk path

### 2.1 Bind discovery to request eligibility

1. Continue selecting tools through `registry.selectActive` and the current request-materialized registry
   in `runtime/aiSdk/params/buildAgentParams.ts`. Preserve client-tool overrides, knowledge selection,
   browser preference, MCP tool IDs, and cache-only catalog access.
2. Keep every eligible tool in the v7 tool set. Map existing defer policy to `deferLoading`; register the
   native search tool under the chosen public name (`tool_search` can remain). Never defer the search tool
   itself. A name collision with a client tool must be handled explicitly before assembling the set.
3. Preserve force-prompt tools on the direct path initially. Verify their central approval mapping before
   considering deferred approval tools; deferred discovery must not become a route around authorization.
4. Keep `activeTools` and caller permissions consistent with the selected set on every eligible boundary.
   Discovery results are advisory; a tool removed or disabled after discovery must still be denied at
   execution. Do not resolve guessed names through an unfiltered process-wide registry.

### 2.2 Account for changed discovery semantics

Native `toolSearch()` requires a nonempty query and returns up to five name/description matches, made
available on the **next model step**. Cherry's chat search supports optional browsing, namespace filters,
and verbose schemas; Pi search uses BM25 with up to 20 results. These are not equivalent algorithms or
output schemas. The native search implementation binds inside a Core generation and cannot be executed
standalone as a generic search service.

For the aiSdk migration, adopt native ranked search and direct calls. Test representative tools for
reachability, including Chinese queries, near-duplicate MCP descriptions, and similarly named tools from
different servers. No arbitrary percentage of “search parity” suffices: designated task-critical tools
must be discoverable and callable. If namespace/full-catalog discovery is required but unreachable,
record the gap and propose an upstream search improvement before adding another local search layer.

Remove the inspect-before-invoke ledger only when native schema delivery/validation replaces its purpose.
Keep signature/default/coercion and `toModelOutput` semantics through direct SDK dispatch. The model must
wait for discovered definitions; searching and invoking a previously unavailable tool inside the same
step/program is not a supported shortcut.

Update new search-result projection (`{ tools: [...] }`) while retaining readers for historical Cherry
`matchedNamespaces` results. Persist actual executed tool identity rather than synthesizing old
`tool_invoke` wrappers. Remove the old deferred prompt instructions only for the migrated route.
A saved conversation containing old meta-tool calls must remain renderable and resumable without
replaying completed tools or rewriting stored records.

Sources: [native tool contract](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/tool-search/tool-search.ts),
[eligibility, matching, and next-step binding](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/tool-search/prepare-tool-search.ts).

### 2.3 Black-box acceptance and cutover

Run real v7 `ToolLoopAgent`/streaming dispatch through Cherry with a controlled model HTTP endpoint and
real local MCP/domain fixture tools. Inspect provider-visible schemas, execution effects, stored output,
and rendered cards. Compare task success and prompt cost against the same v6 baseline, not exact rankings.

| ID | Scenario | Required result |
|---|---|---|
| TS-01 | Inline, always-deferred, auto-deferred, empty catalogs | Correct first-step schemas; search only when needed; no regression for a small tool set |
| TS-02 | Search then direct call; premature same-step call | Discovered schema appears next step; unavailable call has no effect; valid later call runs once |
| TS-03 | Unselected MCP server, disabled browser/knowledge tool, guessed name | Absent from discovery and execution; no cross-request or cross-session access |
| TS-04 | Schema defaults/transforms, invalid arguments, repair | Only validated transformed input executes; error recovery cannot bypass policy |
| TS-05 | Approval-required tool, deny/cancel, disable after search | Correct approval card; zero denied effects; stale discovery cannot grant access |
| TS-06 | Similar names, non-ASCII queries, renamed/removed MCP tool | Critical tools remain reachable; cached catalog updates are reflected at the documented refresh boundary |
| TS-07 | Fresh generation/resume, two concurrent requests, old history | No leaked discovery state; rediscovery works; old and new cards render and completed tools stay completed |
| TS-08 | Large catalog with a representative task set | Record task success, extra model turns, input tokens, first-tool latency and total latency; explicit budgets agreed before cutover |

**Exit:** SDK gate plus TS-01–08, real-provider search smoke, and Electron UI/history validation pass.
Switch only the aiSdk route, then remove unused live search/inspect/invoke wiring after reference audit.
Keep Pi-native discovery until its own migration passes. Do not delete historical renderers with live
executors. Roll back the route as a whole; never expose both discovery systems under the same name.

## Phase 3 — Replace Code Mode execution, then integrate discovery

### 3.1 Resolve the approval contract from the published package

The previous assessment stated that Code Mode could not pause nested tools for approval. That was too
broad: the live guide still says this, but the published `@ai-sdk/code-mode@1.0.80` package exports
`approval.onApprovalRequired`, callback/interrupt modes, signed continuations, and
`experimental_continueCodeModeApproval`. Its changelog introduces signed interruption/replay at `1.0.7`.
The source checks per-tool `needsApproval`; this does **not** prove that Core `toolApproval`, Harness
approval, and Cherry's persisted approval flow are automatically connected.

Treat package behavior as the hypothesis to test. Initially keep approval-required tools directly
callable on a new Core Code Mode route. Pi already supports nested approval: its replacement must
preserve that behavior through the public callback/continuation API, or remain blocked. Do not silently
remove Pi's approval support because the guide describes a narrower route.

Evidence: [published package metadata](https://registry.npmjs.org/@ai-sdk/code-mode/1.0.80),
[public options](https://github.com/vercel/ai/blob/ai%407.0.123/packages/code-mode/src/types.ts),
[nested invocation/approval](https://github.com/vercel/ai/blob/ai%407.0.123/packages/code-mode/src/tool-invocation.ts),
[continuation API](https://github.com/vercel/ai/blob/ai%407.0.123/packages/code-mode/src/approval-continuation.ts),
[changelog](https://github.com/vercel/ai/blob/ai%407.0.123/packages/code-mode/CHANGELOG.md), and
[conflicting guide](https://ai-sdk.dev/docs/ai-sdk-core/code-mode#tool-approval).
No runtime approval test was performed during this documentation update.

### 3.2 Replace the engine at its current owner

1. Add the pinned Code Mode package only after the SDK upgrade. Verify its `ai` peer and `run`/QuickJS
   dependency closure; the inspected package peers on exactly `ai@7.0.123`. Check actual worker/assets
   loading in packaged Electron, not only Node's version number.
2. Prototype `experimental_runCodeMode` behind the existing `tools/codeMode/runtime.ts` boundary, with
   tools materialized from the authorized caller's catalog. Never pass the process-wide registry.
   Carry abort, validated input, request attribution, and child call identity into host execution.
3. Map the old contract deliberately: JS body and explicit result, `tools.invoke(name, params)`, logging,
   `parallel`/`settle`, errors, JSON serialization, and detached calls versus upstream `tools.<name>` API.
   Prefer updated tool descriptions/generated programs; retain compatibility only where real callers or
   persisted pending work need it. Do not rewrite model programs with regex or create another JS engine.
4. Choose explicit execution limits for timeout, heap/stack, source, result, console, each tool payload,
   total calls, and concurrent calls. Current worker timeout is 60 seconds and pauses for Pi approvals;
   upstream defaults are different. Record the intended budget and approval-wait behavior before rollout.
5. Map upstream interruption results to the existing Main-owned approval interaction. Correlate outer and
   nested call IDs, serialize parallel approval requests, and prevent duplicate consumption. A signed token
   authenticates data; it is not a one-time-use authorization or a cross-session permission grant.
6. If durable continuation is used, use an application-owned stable signing key and scoped persisted
   envelope with expiry/session/call identity, current policy/schema validation, and atomic consumption.
   Follow current schema rules: any needed persistence change is an appended migration tested on populated
   data. Callback-only first adoption need not add a new durable subsystem; explicitly test its restart
   behavior against the existing contract.
7. Preserve raw MCP results and user-visible text/images/artifacts. JSON-only code results must not lose
   a screenshot or duplicate large binary payloads. Test current result projection and selected limits;
   do not import behavior from a different Cherry branch without checking this baseline.

For Pi, keep its search/describe/direct-call interface until a verified upstream replacement exists.
Replacing its worker is one deliverable; replacing its native tool discovery is another. For the aiSdk
chat path, Code Mode is currently not exposed: enabling `code_mode` is a separately reviewed feature
change, with explicit eligible tools and product policy, not cleanup of an existing enabled feature.

### 3.3 Integrate native search and Code Mode on supported routes

On a Core route that adopts Code Mode, use `experimental_codeModeTool`, explicit
`experimental_toolCallers`, and `toolDiscovery: 'conversation'` when combining deferred search with
code execution. Keep required direct tools available through `DIRECT_TOOL_CALL`; never treat caller
routing as the sole authorization boundary. Announce updated catalogs without persisting synthetic
catalog messages as user-authored messages or leaking context between requests.

Verify whether the targeted Harness adapter exposes the necessary host tools and event projection.
Harness adoption does not itself move a native Pi/Claude model loop into Core `ToolLoopAgent`, so Core
caller configuration cannot be presumed to migrate those runtime-native features.

### 3.4 Black-box acceptance and cutover

Use the installed Code Mode engine and actual host-tool boundaries. Controlled tools write files and
append effect IDs to a durable fixture journal; the oracle reads these outputs independently. Add a
real-model smoke to cover generated programs and actual tool-selection behavior.

| ID | Scenario | Required result |
|---|---|---|
| CM-01 | Serial and parallel composition, schemas/defaults, JSON result | Intended values/artifacts; correct child attribution; no invalid-input execution |
| CM-02 | Guessed tool, disabled tool, host global/process/filesystem escape attempts | No access outside the authorized tool surface; no unintended host file/network effect |
| CM-03 | Nested allow/deny, callback failure, simultaneous approval requests | Main remains authoritative; denied tool has zero effects; approval binds to the precise nested input |
| CM-04 | Interrupt after one completed effect; resume; duplicate/stale/forged decision | Completed effect is not repeated; pending effect runs only once; malformed or cross-session continuation fails |
| CM-05 | Reopen after process death, changed schema/policy/key, expired continuation | Defined recovery or explicit failure, no silent permission widening or blind non-idempotent replay |
| CM-06 | Infinite loop, large source/result/logs/payloads, concurrency limit | Bounded failure and cleanup; recorded limits hold without hanging Electron |
| CM-07 | Stop during execution/approval, detached calls, tool ignores abort | No further dispatch after cancellation; terminal state and cleanup settle; uncertain in-flight effects are reported accurately |
| CM-08 | Nested tool error, text/image/file output, old stored tool_exec messages | Results/errors and artifacts remain visible and readable; no duplicate binary projection |
| CM-09 | Tool search then code call, refreshed catalog, multiple sessions | Next-step discovery respected, catalog isolation preserved, disabled tools not callable |
| CM-10 | Packaged runtime and real model | Worker/assets/ESM resolve; no dependency on dev checkout; supported platform smoke passes |

**Exit:** applicable CM cases pass, approval/projection gaps resolved, and budgets documented. Cut over
Pi's engine independently of enabling chat Code Mode. Retire worker/signature/meta-exec modules only
when their last live caller migrates; keep historical readers. Do not rerun a failed code program through
the old engine automatically: earlier host calls may already have committed effects.

## Evidence record per implementation phase

Update the [phase tracker](./migration-plan.md#implementation-sequence) with implementation PR/SHA,
package lock versions, changed/deleted/retained surfaces, test commands, protocol fixtures, real-provider
and packaged results, unresolved upstream issues, and rollback verification. Use explicit states:
`planned`, `implementing`, `blocked on capability`, `validated`, `rolled out`. A skipped required case
cannot become `validated`; upstream tests and passing CI are separate evidence from Cherry black-box runs.
