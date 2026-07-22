# Cherry Unified Runtime — Architecture Proposal (v2)

> Supersedes the 2026-04 `cherry-agent-runtime-design` draft (written before the `runtime/aiSdk` stack existed).
> Grounded in current `main` (ec9e9bd324). Version stance: build on **`ai@6`** (current); do not adopt v7 or HarnessAgent yet — see [`aisdk-v7-research.md`](./aisdk-v7-research.md).

## 0. The one-paragraph thesis

The transcript converged on a formal model: **a runtime is an *environment*, not a *controller*.** It has exactly two levers — `C` (what context goes in) and `G` (which side-effecting actions are gated) — and the agent loop is *emergent*, not driven. Cherry has **already implemented the loop** (`src/main/ai/runtime/aiSdk/`, model-agnostic, on AI SDK `ToolLoopAgent`). What remains is not building a runtime — it's **collapsing the two parallel stacks that still exist into that one**, and writing the `(C, G)` discipline down as a hard contract so we stop re-forking.

## 1. Current state (measured, not assumed)

Two stacks run in parallel, both real:

| | Chat stack | Agent stack |
|---|---|---|
| Entry | `AiStreamManager` → `AiService.streamText()` | `AgentSessionRuntimeService` → `runtimeDriverRegistry` |
| Loop | `runtime/aiSdk/` (`Agent.ts`, `loop/`, `params/`) — **AI SDK, model-agnostic** | `runtime/claudeCode/ClaudeCodeRuntimeDriver` — **CLI black box, Anthropic-only** |
| Data | `schemas/message.ts` via `streamManager/persistence/backends/MessageServiceBackend` | `schemas/agentSessionMessage.ts` via `agentSession/persistence/AgentSessionMessageBackend` |
| Safety (`G`) | (none / per-tool) | `runtime/claudeCode/ToolApprovalRegistry.ts` — **trapped inside the claudeCode driver** |

Key facts that change the old plan:
- The model-agnostic loop **already exists and ships** — `runtime/aiSdk` has the ToolLoopAgent loop, the param/feature pipeline (`buildAgentParams`, `assembleSystemPrompt`, 15+ features), telemetry, deferred-tool prompts, and a `steerYield` feature. We are **not** building this.
- `runtimeDriverRegistry` is already the pluggable seam — but `aiSdk` is **not registered as an agent-session driver**; only `claudeCode` is. Chat uses `aiSdk` directly, agents use `claudeCode`. That asymmetry *is* the fork.
- `ToolApprovalRegistry` (our `G`) lives **inside** `claudeCode/`, so it can't serve the aiSdk path.

So the fork the April doc described is intact, but the bridge is one registration away.

## 2. The formal contract `(C, G)` — and where it lives in code

```
Runtime = environment over an unobservable agent.
  C : History → Messages          // the ONLY input-side lever
  G : Action  → {pass, ask, block} // the ONLY output-side lever, side-effecting actions only
  loop                             // emergent from the model's implicit state machine; runtime does not steer it
```

| Object | Meaning | Cherry module (target) |
|---|---|---|
| `C` | Context engineering: system prompt, history, tool set, knowledge injection, **compaction** | `runtime/aiSdk/params/` (exists) + a `context/compaction` layer (to add) |
| `G` | Safety gate on side-effecting actions only | `runtime/permission/` (lift out of `claudeCode/`) → consumed via native `toolApproval` |
| loop | `while(toolCalls)` to fixpoint | `runtime/aiSdk/loop/` (exists — **do not add control logic**) |

There is **no `mode: 'chat' | 'agent'` anywhere.** Chat and Agent are the same runtime with different `C`:
- **Chat** = `C` assembled *live by the user* (toggles: web search, knowledge, MCP, memory, model params).
- **Agent** = `C` from a *saved preset* (`AgentDefinition` = a packaged `C` + `G` defaults).

`maxSteps` exists only as a **watchdog** (OOM-killer semantics), never as a feature knob.

### The `prepareStep` red line (the load-bearing rule)

`prepareStep` may do **only**:
1. context-quality maintenance (compact / trim / summarize history) — that's `C`;
2. safety-driven tool removal (drop `bash` after step N for risk) — that's `G`.

It must **never** do `toolChoice`, phased workflow orchestration, or any "I know the next step better than the model" logic. Rationale (transcript): the model's state transitions are unobservable, so steering them fights a black box and degrades output. This is the discipline that keeps the runtime an environment.

## 3. The proposal: three collapses (mostly deletion)

### Collapse 1 — Runtime: one driver, model-agnostic
Implement `AiSdkRuntimeDriver` against the existing `AgentSessionRuntimeDriver` interface and `register()` it. Agents then run through the same loop chat uses → **any model, not just Anthropic**. `ClaudeCodeRuntimeDriver` becomes **one optional driver behind the same registry** (kept for "run real Claude Code" power users, or deleted if unused) — not the only agent path. This is exactly what `runtimeDriverRegistry` was built for; no new abstraction.

### Collapse 2 — Data: one message store
Merge `agentSessionMessage` into `message` (or make `agentSession` reference `message`). Store in **ModelMessage** shape (AI SDK native); `blocks[]` become derived UI projection, FTS text derived. The two persistence backends (`MessageServiceBackend` + `AgentSessionMessageBackend`) collapse to one. Payoff: one history = one persistence = one restore = one search, and "chat vs agent" disappears at the data layer too. (Aligns with v2 DataApi: business data in ModelMessage form, UI data derived.)

### Collapse 3 — Safety: one driver-agnostic `G`
Centralize the approval *decision* into one driver-agnostic `PermissionEngine` (`G : Action → {pass, ask, block}`), folding the scattered logic (claudeCode `toolRules`, MCP `mcpSourcePolicy`, per-tool `needsApproval`). Wire it to AI SDK's native approval — **v6:** per-tool `needsApproval` (delegation shim) + the message-based request/response flow; **v7:** the centralized `toolApproval` setting (`needsApproval` deprecated). Then every driver and model gets the same safety boundary, and the `ask` verdict is the single human-in-the-loop point the GUI renders. Full scheme: `unified-runtime/tool-approval-refactor.md`.

**Net LOC direction: down.** Two loops → one, two schemas → one, two persistence backends → one, `G` moves rather than duplicates.

## 4. The `C` surface — context & call-options model (robust usage)

`C` (context engineering) decomposes into **three orthogonal injection layers**, all present in **`ai@6`**
(the `experimental_context`→`runtimeContext` rename is the only v7 delta — verified in
`node_modules/ai`). Cherry today conflates them into one `RequestContext` blob passed via
`experimental_context`, covering only the middle layer.

### 4.1 The three layers

| Layer | What it is | When | Validation | Cherry today |
|---|---|---|---|---|
| **`CALL_OPTIONS`** (`callOptionsSchema` + `prepareCall`) | typed, validated **arguments to a parameterized agent preset** → expanded into prompt/settings | once, **before** the loop | `callOptionsSchema` (zod) | absent — imperative `buildAgentParams` |
| **`runtimeContext`** | ambient **request/session state**, readable by every tool + callback, mutable per-step | **during** the loop | — (typed generic) | `RequestContext{requestId,topicId?,assistant?,abortSignal?}` via `experimental_context` |
| **`toolsContext`** | **per-tool isolated dependencies**, a map keyed by tool | at **tool execute** | per-tool `contextSchema` | absent — MCP tools reach `application.get()` singletons |

Real shapes: `ToolLoopAgent<CALL_OPTIONS, TOOLS, RUNTIME_CONTEXT, OUTPUT>`;
`ToolExecutionOptions = { toolCallId, messages, abortSignal, context /* per-tool */, experimental_sandbox }`.
The three are the sub-faces of `C`: **CALL_OPTIONS** = preset parameterization · **runtimeContext** =
environment state · **toolsContext** = tool dependency injection + isolation.

### 4.2 Robustness frame — one construction point, one trust boundary

```
renderer ──IPC (only serializable, schema-validated data)──▶ main
                                                              │
                     ┌─────────────────────────────────────────┘
                     ▼  SINGLE construction point (buildAgentParams' successor)
   non-serializable capabilities injected here in main, NEVER cross IPC:
     runtimeContext ← validated request payload + abortSignal + service handles
     toolsContext   ← per-tool scoped capability handles (scoped MCP handle / workspace)
     CALL_OPTIONS   ← callOptionsSchema.parse(renderer-supplied options)
                     │
                     ▼  tools run in-main, read options.context directly — never construct, never throw
```

This boundary *is* a security property: the untrusted renderer can only influence **validated data**;
**capabilities** (which service a tool may call, which dir it may touch) are injected by main and never
serialize. Pairs with [`stream-ipc-validation.md`](../stream-ipc-validation.md).

### 4.3 Per-layer robust wiring

- **`runtimeContext` — kill the current throw-fragility.** Today `getToolCallContext(options)` **throws**
  when `experimental_context` is missing/misshapen (`tools/adapters/aiSdk/context.ts`), pushing
  validation down into every tool execute as a runtime crash. Robust: validate **once at the construction
  point** (no topicId/sessionId → refuse to build the request), and let the typed `runtimeContext` generic
  guarantee presence so per-tool `isRequestContext` guards are deleted. Enrich it to close the gaps the
  research found — `sessionId` and `workspace` live only in the claudeCode driver today and never reach
  tools:
  ```ts
  interface CherryRuntimeContext {
    requestId: string
    topicId?: string              // chat
    sessionId?: string            // agent session   ← was claudeCode-only
    workspace?: { path: string }  // agent cwd        ← was claudeCode-only
    assistant?: Assistant
    // drop abortSignal — ToolExecutionOptions.abortSignal already provides it
  }
  ```
  Mutability: `prepareStep` may change it, but **freeze identity fields** (requestId/sessionId/topicId/
  workspace) and only let a mutable slice (e.g. compaction state) change — one stray drop of sessionId
  breaks every downstream tool. (Same red line as §2.)
- **`toolsContext` — isolation must actually hold.** Build a **scoped capability handle per tool at
  registration**, keyed by stable `mcpToolIds` (not display name — names collide/rename), placed in
  `toolsContext`; the tool's execute gets only `options.context` = its own handle. **Don't force every
  tool into a schema** — simple built-ins (web search, knowledge) keep reading `runtimeContext`; only
  privileged/isolated tools (MCP, workspace FS) declare `contextSchema`. Validate at assembly, not
  mid-execution.
- **`CALL_OPTIONS` — the typed entry for parameterized presets.** `callOptionsSchema` doubles as the
  **IPC-boundary validator** for renderer-supplied options (validate once, use twice). `prepareCall` must
  be **pure, deterministic, non-throwing** (inputs already validated; no failing service calls inside).
  Chat path keeps `CALL_OPTIONS = never` → no options, no added complexity. This is the SDK-native home
  for "**Agent = a packaged `C` preset with a few typed knobs**" (e.g. a translate agent with
  `{ targetLang }` — directly maps to `translate-on-main.md`).

  Division of labour, so it doesn't fight `buildAgentParams`:

  | Mechanism | Owns | Level |
  |---|---|---|
  | `buildAgentParams` + RequestFeature pipeline | **cross-cutting** `C`: provider quirks, reasoning, telemetry, cache — shared by all agents | runtime |
  | `prepareCall` + `callOptionsSchema` | **preset-specific** `C`: this preset's instruction template + accepted args | preset |

  They compose (features at runtime level, template expansion in `prepareCall`); don't run both for the
  same concern.

### 4.4 Three landmines (Cherry-specific)

1. **⚠️ Subagent `...options` forwarding is an isolation breach waiting to happen.** `tool_invoke` /
   `tool_exec` forward `{...options, toolCallId}` (`tools/adapters/aiSdk/meta/toolInvoke.ts`,
   `meta/exec/runtime.ts`). Once `toolsContext` exists, `options.context` is the **parent tool's** context;
   spreading it to a child tool hands the child the wrong tool's context (isolation broken). Robust:
   child runtime/tool **re-resolves context by the child tool name**, never spreads. Inherit
   `runtimeContext`, **narrow** `toolsContext` to the granted tool subset.
2. **Both drivers must share one context shape.** The claudeCode driver's separate `ClaudeToolContext{cwd,
   channels}` + session holders must map *from* the unified `runtimeContext` (one source of truth), not
   maintain a parallel one — else the context fork persists alongside the runtime fork.
3. **Don't break existing tools mid-migration.** `experimental_context`→`runtimeContext` is a mechanical
   rename, but `getToolCallContext` reads `experimental_context`. Robust migration: `runtimeContext` first
   carries the **same fields** as today's `RequestContext`, `getToolCallContext` reads `options.context`
   (behavior unchanged); introduce `toolsContext` **incrementally** (MCP + workspace tools first), leave
   simple built-ins untouched.

### 4.5 End-to-end tool typing comes free with `toolsContext`

A `contextSchema`-bearing tool gets a typed `options.context`, and the same `InferUITool` chain
(`InferAgentUIMessage`) types tool parts at compile time — change a built-in tool's schema → renderer's
tool card fails to compile. **Static for built-ins, dynamic for MCP**: runtime-registered MCP tools can't
carry a static `contextSchema`, so they fall back to an untyped handle / `dynamic-tool` part — the same
boundary AI SDK itself draws. Crossing Cherry's IPC works because the typing is compile-time only (types
erased at runtime); just export the built-in `ToolSet` type from `@shared` and `import type` it in the
renderer. Decision for Collapse 2 (§3): the derived `blocks[]` types should be parameterized by the
built-in `ToolSet` to preserve this.

### 4.6 Minimal first step (ordering)

Don't lay all three at once. By risk/payoff:

1. **Enrich `runtimeContext` + fail-fast** (add `sessionId`/`workspace`, delete per-tool throw guards) —
   pure v6, removes today's fragility, and closes the claudeCode/aiSdk context fork. Ships independently.
2. **Add `toolsContext` isolation for MCP + workspace tools** — biggest security win, concentrated change;
   fix landmine #1 (subagent re-resolution) in the same pass.
3. **Introduce `CALL_OPTIONS` only when building parameterized presets** (translate / named assistants) —
   on demand, never touches chat.

Where it sits in §5: step 1 rides **Phase 2** (it's prerequisite to the unified driver and closes the
context fork); step 2 is its own work item gated by the `G`/permission work (Phase 1); step 3 is
opportunistic.

### 4.7 Worked example — `tools/adapters/aiSdk/builtin/` (PLAN ONLY, not yet applied)

> **Do not cut yet.** Recorded as the concrete target for Phase 2a; apply when Phase 2a lands.

The four builtin tools (`WebSearchTool`, `WebFetchTool`, `KnowledgeSearchTool`, `KnowledgeListTool`)
hand-roll a context pipeline on top of what the SDK already provides. Context flows three ways, two of
them redundant:
1. `ToolApplyScope` → `applies()` — build-time inclusion (legit `C`: which tools). **Keep.**
2. `experimental_context: RequestContext` → `getToolCallContext()` — a **fat blob + runtime guard +
   throw** (`tools/adapters/aiSdk/context.ts`). Threads the whole `Assistant`, but execute reads only
   `knowledgeBaseIds`.
3. native `options.abortSignal` / `options.messages` — **ignored**; the web tools reach back through the
   blob (`request.abortSignal`) for a field the SDK gives natively.

Verified surface: v6 `ToolExecutionOptions` already has `toolCallId/messages/abortSignal/
experimental_context`; **`contextSchema`/`toolsContext` are v7-only** (absent in v6 `provider-utils`).

**v6-now (no upgrade):**

- Web tools need **zero** request context — their only use is `abortSignal`, which is native:
  ```ts
  // WebSearchTool.ts / WebFetchTool.ts — now
  import { getToolCallContext } from '../context'
  execute: async ({ query }, options) => searchWeb(query, getToolCallContext(options).request.abortSignal)
  // → becomes (drop the import entirely)
  execute: async ({ query }, { abortSignal }) => searchWeb(query, abortSignal)
  ```
  (Verify: `options.abortSignal` is call-level, derived from the request signal — request-abort
  propagates, so equivalent. Construction point must pass the request signal as the call signal.)
- Stop threading the whole `Assistant`; inject only `knowledgeBaseIds`. The `isRequestContext` + throw in
  `context.ts` exists only because `experimental_context` is `unknown`-typed — with one construction
  point owning the shape, it degrades to a build-time guarantee.

**v7 (toolsContext + contextSchema):**

```ts
// KnowledgeSearchTool.ts — now
import { getToolCallContext } from '../context'
execute: async ({ query, baseIds }, options) => {
  const { request } = getToolCallContext(options)
  return searchKnowledge(query, baseIds, request.assistant?.knowledgeBaseIds ?? [])
}
// → v7
const kbSearchTool = tool({
  contextSchema: z.object({ scopedBaseIds: z.array(z.string()) }),       // declared once
  execute: async ({ query, baseIds }, { context }) =>
    searchKnowledge(query, baseIds, context.scopedBaseIds),              // typed, no throw, no `?? []`
})
```
At this point **`context.ts` is deleted** (`getToolCallContext`/`isRequestContext`/`ToolCallContext`);
`requestId`/`topicId` move to `runtimeContext` (telemetry consumer, not tools). `?? []` is dead code —
`applies: knowledgeBaseIds.length > 0` already guarantees non-empty.

**Net deletion:**

| Change | Tier | Deletes |
|---|---|---|
| Web tools use `options.abortSignal` | v6 now | 2× `getToolCallContext` import + blob detour |
| Inject only `knowledgeBaseIds`, not whole `Assistant` | v6 now | fat blob; guard degrades |
| KB tools `contextSchema` + typed `context` | v7 | all of `context.ts`; the `?? []` dead branch |
| `requestId`/`topicId` → `runtimeContext` | v6 now | tools stop touching request-level ambient |

Structural takeaway: **the runtime should hand each tool its declared inputs (the way it hands `applies`
its scope), not a god-object every tool reaches into and guards against.** Today two context objects
(`ToolApplyScope` + `RequestContext`) both carry `assistant`; collapse to one construction point that,
from one `assistant` read, produces (a) the `applies` build scope and (b) each tool's execute context.

## 5. Migration phases (mapped to real modules)

```
Phase 1 — Lift G (no behavior change)
  runtime/claudeCode/ToolApprovalRegistry.ts → runtime/permission/{engine,registry}.ts
  Both drivers consume it. Verify: existing ToolApprovalRegistry tests pass against the new path.

Phase 2 — Register aiSdk as an agent-session driver
  New runtime/aiSdk/AgentSessionDriver.ts implements AgentSessionRuntimeDriver.
  Feature-flag: route a new agent through aiSdk driver instead of claudeCode.
  Verify: an agent session runs a tool loop on a non-Anthropic model end-to-end.

Phase 3 — Unify the data model
  Merge agentSessionMessage ⊂ message (ModelMessage canonical, blocks derived).
  Collapse the two persistence backends. Migrator for existing agent_session rows.
  Verify: load/restore/search identical for a chat topic and an agent session.

Phase 4 — Compaction (the missing piece of C)
  Add runtime/aiSdk/context/compaction (micro-trim + summarize) inside prepareStep ONLY.
  Verify: a >context-window session stays coherent; prepareStep does no toolChoice.

Phase 5 — Demote/remove claudeCode driver
  Once aiSdk driver reaches parity, claudeCode is opt-in (power feature) or deleted.
```

Each phase ships independently and is reversible behind the registry/flag.

## 6. Decisions

| Decision | Choice | Why |
|---|---|---|
| Build vs adopt loop | **Use existing `runtime/aiSdk`** | The 80% is already shipped and model-agnostic |
| AI SDK version | **Stay on `ai@6`** | v6 has Agent/ToolLoopAgent/`toolApproval`/deferred tools — sufficient; v7 = provider-major churn + 6 patches |
| HarnessAgent (v7) | **No** | It's the black-box-wrapper path we rejected; `claudeCode` driver already fills that niche if ever needed |
| Chat/Agent type flag | **None** | They differ only in how `C` is assembled (live toggles vs preset) |
| `prepareStep` scope | **C + safety-G only** | Steering an unobservable state machine degrades it |
| `G` location | **Driver-agnostic `runtime/permission/`** | One safety boundary for all models/drivers |
| Message format | **ModelMessage canonical, blocks derived** | One store; aligns v2 DataApi |
| Context model | **Three layers: `CALL_OPTIONS` + `runtimeContext` + `toolsContext`** (all v6) | Cherry's single `RequestContext` blob conflates them; split = preset-args / env-state / tool-isolation (§4) |
| Context construction | **One point in main; capabilities never cross IPC** | Untrusted renderer sends validated data only; main injects handles/scoped capabilities (§4.2) |
| Tool dependencies | **`toolsContext` scoped handle per privileged tool, not `application.get()`** | MCP isolation: a tool reaches only its own capability, validated by `contextSchema` (§4.3) |

## 7. Why this clears the "can't match Anthropic" bar
The hard part was never the loop (≈100 lines; we already have it). Quality lives in four places, all of which this architecture *localizes* instead of scattering: tool descriptions, modular system prompt (`assembleSystemPrompt`), the precision of `G` (one registry), and compaction precision (one `C` layer). Cherry then keeps what Claude Code can't: model-agnostic, GUI-native approval/branching, MCP + knowledge ecosystem.

## Sources / anchors
- Current code: `src/main/ai/runtime/{aiSdk,claudeCode}`, `runtime/registry.ts`, `agentSession/`, `streamManager/`, `schemas/{message,agentSessionMessage}.ts`
- Formal `(C,G)` model + prepareStep red line: the design-discussion transcript (session scratch, not in repo)
- Version constraints: [`aisdk-v7-research.md`](./aisdk-v7-research.md)
