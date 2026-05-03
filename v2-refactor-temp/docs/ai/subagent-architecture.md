# Sub-agent / multi-agent foundation

Status: in design + early implementation. Primitives shipped (`Agent.executeAsTool`, `createAgentTool`, `AsyncAgentTaskRegistry`, `createExploreAgent`). Wire-up to AiService deferred — to be redone via `RequestFeature` instead of inline in `AiService.streamText`.

## Cherry product position

Cherry is **not a chat-only product**. Cherry is an *open-ended agentic platform with a chat UI*. Users compose capabilities by attaching MCP servers — anything from read-only web search to filesystem mutation, shell execution, design-tool control (Blender / Figma), or arbitrary HTTP APIs. The agent loop, ToolProfile capability classification, and sub-agent infrastructure exist precisely because Cherry needs to safely orchestrate user-installed tools that may be destructive.

Implications for design decisions in this doc:

- **Destructive operations are first-class**, not edge cases. Plan mode (preview-before-execute), `AskUserQuestion` (structured clarification), and `needsApproval` gates are core primitives, not optional polish.
- **Long-running agentic workflows are expected**, not exceptional. Sub-agent persistence, resumable sessions, and cross-restart recovery serve real users (coding agents, research agents, design agents).
- **Product safety floor is high**: any framing of "agent runs free, user catches problems after" is wrong. UX must keep user in the loop on destructive paths.

Where the survey of reference codebases (see `agent-architecture-references.md`) found patterns we previously deemed "Cherry won't need" (plan mode, structured ask-user, conversational delegation), those judgments need re-examination through this lens. Cherry should NOT replicate everything, but the bar for rejecting them is higher than "Cherry is a chat product."

## Goal

Let a parent agent spawn child agents (sub-agents) to delegate sub-tasks. Two execution modes:
- **Sync** — parent waits, child's text streams back as preliminary tool results, final text is the tool result the parent's LLM consumes.
- **Async** — parent gets `{taskId, status: 'started'}` immediately, child runs detached, final text is delivered later as a synthetic user message injected into the parent's conversation.

The foundation should support, by Phase 7, multiple named sub-agents (`explore` / `researcher` / `code-reviewer` / user-defined), depth-limited recursion, and (eventually) cross-session task persistence.

## Decisions

### D1. Context mode is binary: `isolated` | `fork`

Arkloop has 5 modes (`isolated` / `fork_recent` / `fork_thread` / `fork_selected` / `shared_workspace_only`). Three of them are over-design — vague semantics, require UI to specify, hard to choose between. Cherry settles on **two**:

| mode | child sees |
|---|---|
| `isolated` (default) | `[user(prompt)]` only |
| `fork` | parent's full `UIMessage[]` + synthesized placeholder + directive |

`isolated` is the safer default (no parent-context leak to a possibly-different-model child) and matches today's `Agent.executeAsTool` behavior.

### D2. Fork is more than copying parent messages

Claude Code's `forkSubagent.ts:107-169` taught us:

When parent's last assistant turn called the `agent` tool, that turn contains a `tool_use` block. **An unmatched `tool_use` is invalid conversation** — the LLM provider rejects the messages array. Cherry's fork mode must:

1. Take parent's messages including the assistant turn that triggered the agent tool
2. Synthesize a **placeholder `tool_result`** for the agent meta-tool's own `toolCallId` (e.g. text "Fork started")
3. Append the directive in the same user message
4. Inherit parent's system prompt verbatim (NOT child's; child's system gets prepended as a short fork directive)

If the parent's last assistant called multiple tools in parallel, each `tool_use` needs its own placeholder. MVP can assume single tool_use; multi-tool fork is Phase 2.5.

### D3. `agent` meta-tool is a `RequestFeature`, not an `AiService` injection

Initial wire-up in `AiService.streamText` was wrong — it injected `agent` unconditionally on every chat. Correct integration is a `RequestFeature` gated on `assistant.settings.enableSubAgents`, alongside the existing 14 INTERNAL_FEATURES (anthropicCache / pdfCompatibility / etc.).

`RequestScope` already carries `assistant`, `request.chatId` (= topicId), `sdkConfig`, `provider`, `model` — everything the feature needs. `application.get('AiStreamManager')` is reachable from feature closures. `AsyncAgentTaskRegistry` instance shared between `contributeTools` and `contributeHooks` via `requestContext` — minor wart, can be cleaned up by adding per-request closure to `RequestFeature` API.

### D4. Sub-agent definition ≈ `Assistant` record

Cherry's existing `Assistant` table already has every field a sub-agent needs: `prompt`, `modelId`, `mcpServerIds`, `knowledgeBaseIds`, `settings.{temperature,maxToolCalls,...}`. Adding two fields makes any assistant a potential sub-agent:

- `subAgentIds?: string[]` — parent declares which other assistants it can spawn
- `usableAsSubAgent?: boolean` — UI filter; assistants opt-in to being spawnable

Built-in sub-agents (`explore`, future `plan` / `summarize`) bypass the table and are hardcoded factories. The `agent` meta-tool dispatches by `subagent_type` — checks built-in registry first, then the parent assistant's `subAgentIds`.

### D5. Tool filtering = `ToolProfile` + safety blocklist

`ToolProfile` (`tools/profile.ts`) is the capability-based filter abstraction. `READ_ONLY_PROFILE` is its first instance. Any sub-agent's tools = `applyToolProfile(parentTools, registry, profile) - blockedNames`.

Always-blocked for any child:
- `agent` itself (recursion bomb)
- `tool_exec` (sandbox escape)

Plus profile-specific filters (`READ_ONLY_PROFILE` blocks all writes).

### D6. Async result delivery = `injectMessage` + `pendingMessages`

When async sub-agent completes, drainer calls `AiStreamManager.injectMessage(topicId, syntheticUserMessage)`. Steering observer drains the `pendingMessages` queue at parent's next `prepareStep`; tail-recheck catches the post-final-step race.

If parent stream is dead by the time async completes → result is silently dropped (with warn log). Phase 6 adds DB persistence so dropped results survive to next session.

Synthetic message format:
- `<async-task-result task="agent-${id}">...text...</async-task-result>` for success
- `<async-task-error task="agent-${id}">...text...</async-task-error>` for failure

### D7. What we deliberately do NOT borrow

- **Lua orchestration** (Arkloop): user-editable scripts for multi-step coordination. Engineering cost (sandbox + bindings + i18n + maintenance) far exceeds the value when our LLM can just compose multi-step tool calls itself.
- **`soul.md` vs `prompt.md` split** (Arkloop): two-file persona definition. Cherry users maintain a single prompt; behavior rules can live in user preferences if needed.
- **Event-sourced run history** (Arkloop): `run_events` immutable log. Powerful but requires schema migration + persistence rewrite. Track separately from multi-agent.
- **5-mode `context_mode`** (Arkloop): see D1. Two modes is enough.
- **Byte-exact prompt-cache continuation** (Claude Code): the elaborate `useExactTools` + thinking config inheritance for cache reuse is for CLI scale. Cherry's chat sessions don't have the same cache-hit ROI; correctness over optimization.
- **`soul.md` per-persona behavior rules** with XML tags: belongs to CLI agent culture, not Cherry's UX.

### D8. Recursion guard = depth tracking via `experimental_context`

Hardcoded `blockNames: [Agent]` in `READ_ONLY_PROFILE` (current MVP) is too coarse — blocks legitimate "researcher uses fact-check sub-agent" cases. Real fix: thread `forkDepth` (or `subagentDepth`) through `ToolExecutionOptions.experimental_context`. Each spawn increments; spawn fails when `>= MAX_DEPTH` (e.g. 3).

Single-layer guard (depth in context) is enough for Cherry; Claude Code's dual guard (querySource flag + message scan for `<fork-boilerplate>` marker) is overkill for our scale.

## Architecture sketch

```
RequestScope (assistant, request.chatId, sdkConfig, ...)
        │
        ▼
agentToolFeature: RequestFeature  ← Phase 2
  applies(scope) = scope.assistant?.settings?.enableSubAgents && hasAnySubAgents
  contributeTools(scope) =
    {
      [AGENT_TOOL_NAME]: createAgentTool({
        buildChild: (input) => resolveChildAgent(input.subagent_type, scope),
        streamManager: application.get('AiStreamManager'),
        topicId: scope.request.chatId,
        asyncTasks: scope.requestContext.__agentToolAsyncTasks ??= new AsyncAgentTaskRegistry()
      })
    }
  contributeHooks(scope) =
    { onFinish: () => scope.requestContext.__agentToolAsyncTasks?.abortAll('parent-finish') }


resolveChildAgent(subagentId, parentScope):
  if subagentId in BUILTIN_SUBAGENT_IDS:
    return BUILTIN_SUBAGENT_FACTORIES[subagentId](parentScope)   // hardcoded explore/plan/...
  // Custom: another Assistant record
  childAssistant = await assistantDataService.getById(subagentId)
  childScope = deriveChildScope(parentScope, childAssistant)
  childParams = await buildAgentParams(childScope)
  return new Agent(childParams)


createAgentTool(deps): Tool
  inputSchema:
    {
      subagent_type: enum(parent's subAgentIds + builtin),
      description: string,
      prompt: string,
      context_mode: 'isolated' | 'fork' (default 'isolated'),
      run_in_background: boolean (default false)
    }
  execute = async generator:
    if run_in_background and asyncSupported:
      register task → fire-and-forget drainAndInject → return JSON.stringify(ack)
    else:
      yield* deps.buildChild().executeAsTool(initialMessages, signal)


Agent.executeAsTool(initialMessages, signal): AsyncGenerator<string, string>
  // Construct depends on context_mode (caller decides; this primitive just runs)
  stream = this.stream(initialMessages, signal)
  yield text deltas via readUIMessageStream({ stream, terminateOnError: true })
  return final text
```

## Phasing

| Phase | Content | Status |
|---|---|---|
| 1 | Primitives: `Agent.executeAsTool` / `createAgentTool` / `AsyncAgentTaskRegistry` / `createExploreAgent` / `ToolProfile` + `READ_ONLY_PROFILE` | DONE |
| 2 | `agentToolFeature` as RequestFeature; built-in `explore` only; `enableSubAgents` flag on assistant; `context_mode: 'isolated'` only (`fork` throws "not implemented") | next |
| 2.5 | `fork` mode implementation: placeholder tool_result synthesis, fork directive prefix, depth guard via `experimental_context.forkDepth` | next + 1 |
| 3 | `Assistant.subAgentIds` schema + `resolveChildAgent` recursion through `buildAgentParams`; UI to pick child assistants | data + UI work |
| 4 | Companion lifecycle tools: `agent_status(taskId)`, `agent_interrupt(taskId)` | small |
| 5 | Depth + concurrency governance (replace hardcoded `blockNames: [Agent]`) | small, rolled into 2.5 |
| 6 | DB-backed task persistence (`async_agent_tasks` table, cross-session resume) | larger |
| 7 | Plugin / dir-loaded agent definitions (à la Claude Code's `.claude/agents/`); MCP server trust levels | larger |

## D9. No `state` object on `Agent` class — status lives in layered owners

Pi/Tyler's `Agent` exposes `MutableAgentState` (messages / isStreaming / streamingMessage / pendingToolCalls / errorMessage) + `subscribe(listener)`. Tempting to copy. We deliberately don't.

**Three-codebase comparison:**

| Codebase | State on agent class? | Where status actually lives |
|---|---|---|
| Pi/Tyler | YES (`MutableAgentState`) | Agent instance |
| Claude Code | NO (generator-based) | React `useState` + `LocalAgentTaskState` registry + per-tool `setInProgressToolUseIDs` callbacks |
| Arkloop | NO (event emitter) | `sub_agents.status` DB column + `run_events` immutable log |
| Cherry (current) | NO | stream chunks + observer closures |

Pi is the outlier. CC + Arkloop both deliberately reject class-held state because:
- Pi's `MutableAgentState` is tied to its **transcript-owner** model (`agent.prompt(msg)` — agent owns messages). Cherry rejected transcript ownership (D4: transcript lives in useChat / DB, agent receives it as parameter), so the dependent state object becomes pointless.
- Class fields can't survive process restart / worker migration — Arkloop's truth is in DB.
- Subscribing to in-process state forces same-process listeners — CC threads UI state through React component callbacks instead.

**Cherry's state lives in four layers, by lifecycle:**

| Lifecycle | State kind | Owner |
|---|---|---|
| per-step ephemeral | "currently calling tool X" | stream chunks (read by `readUIMessageStream`) |
| per-stream accumulator | cumulative usage, error trace | observer closures (e.g. `attachUsageObserver`) |
| per-task observable | async sub-agent status enum (`running` / `completed` / `failed` / `cancelled` / `orphaned`) | `AsyncAgentTaskRegistry` (Arkloop-style status enum) |
| cross-session durable | persisted task results, transcripts | DB (Phase 6) |

`Agent` itself is the temporary orchestrator that emits events — never the source of truth.

**Concrete consequences:**
- Don't add `Agent.state` / `Agent.subscribe()`.
- Companion tools like `agent_status(taskId)` (Phase 4) read from `AsyncAgentTaskRegistry`, not from `Agent`.
- UI progress panel (future) subscribes to stream chunks or task registry, not to `Agent`.
- If new state is ever needed on `Agent`, it MUST be derivable from existing observer events (`onStart` / `prepareStep` / `onStepFinish` / `onTool*` / `onFinish` / `onError`) via a fresh observer that maintains a closure-private state — not via mutable class fields with separate update paths.

## D10. Subagent vs team — different topologies, separate primitives

The reference codebases (see `agent-architecture-references.md`) ship 4 of 4 subagent + 1 of 4 team. Empirical study (Mieczkowski et al. 2026, "LLM Teams as Distributed Systems") shows centralized (subagent) outperforms decentralized (team) on speedup AND token cost across most task structures: at N=5 with highly parallel work, decentralized teams produce 0.83× slowdown for 4.65× token cost vs single-agent baseline. 45% of decentralized-team messages are "cheerleading" wasted by RLHF helpfulness bias.

**Cherry locks subagent (centralized topology) as the only primitive through Phase 7.** Team mode is Phase 10+ if ever, requires upfront design for: anti-cheerleading prompts, structured task assignment (no self-claiming), explicit dependency enforcement.

**`AsyncAgentTaskRegistry` is for subagent. Don't grow it toward team:**
- ✓ add `status` enum (`running` / `completed` / `failed` / `cancelled` / `orphaned`) — passive observability
- ✗ add `sendInput(taskId, msg)` — peer-style
- ✗ add `agent_status_query` from non-parent caller — peer-style
- ✗ add named addressing — team-style identity space

Subagent registry is anonymous + parent-scoped + ephemeral; team would need a separate primitive with named identities, persistent lifetime, and message routing.

## D11. Three subagent execution models — Cherry locks function-call

| Model | child shape | Examples | Resume |
|---|---|---|---|
| **Function-call** | child is one-shot `prompt → result → die` | Hermes `delegate_task`, Cherry today | None |
| **Resumable session** | each spawn is a sub-session with stable id; new spawn can pass `task_id` to continue prior session | opencode `task` tool | Pass `task_id` to spawn |
| **Conversational state-machine** | child is long-lived stateful entity; can pause in `waiting_input`, parent uses `send_input` / `wait` / `resume` / `close` / `interrupt` | Arkloop | Full state machine + ContextSnapshot |

Cherry locks **function-call** for Phases 2-5. Phase 6 should adopt **resumable session** by treating each async sub-agent run as a sub-topic (parent topic id is the resume handle) — minimal new infrastructure since `Topic` + `Message` tables already do everything. Resumable session is more important than initially scoped: agentic-platform users running coding / research / design sub-agents through MCP are exactly the audience that benefits from "this researcher remembers what we found yesterday, continue from there."

**Resumable subagent is not a separate primitive from resumable parent conversation.** Both reduce to "load topic messages → LLM API call → append response." The "sub" only marks the relationship (`parentTopicId`) and changes what triggers resume (parent's LLM via `task_id` vs user opening a topic) and where the result lands (parent topic's tool result vs user's next message). The execution mechanism is shared. Once Cherry's topic-level resume works, sub-topic resume is wiring (a `task_id` parameter and a `parentTopicId` field), not new machinery.

**Conversational state-machine is rejected**: not because state machine is impossible in Cherry, but because the product UX questions it implies aren't answered:

- When child pauses asking "A or B?", who sees the question — parent's LLM (which is blocked in a sync `agent` tool call), the user (which UI panel?), or both?
- In sync mode, parent's LLM is blocked waiting for the `agent` tool to return. It can't actively answer. Yielding the question as preliminary tool output works but breaks the "tool returns once" mental model.
- In async mode, parent's LLM has already moved on. Where does the question land? Multi-child concurrent: how is queue / ordering surfaced?

Note: **state machine is one implementation of waiting_input, not the only one.** A pure tool-call approach (child has an `ask_parent(question, options)` tool whose `execute` blocks awaiting an injection from parent or user) achieves the same feature without status enum or pending-input queue table — status is derivable from "last message has unmatched `ask_parent` tool-call." State machine accelerates queries and provides explicit transition semantics, but doesn't enable the feature itself.

The blocker for Cherry isn't engineering capability — it's the unanswered UX questions. State-machine engine + 4 tables (1-2 weeks engineering) is overhead with no payoff until those questions have answers.

## D12. Persist async sub-agent state via `messages` table — no dedicated `async_agent_tasks` table

Async tool calls already become `tool-call` parts on assistant messages. Completion results are user messages (synthetic `<async-task-result task="X">...</async-task-result>` text). Status / orphan detection is **derived from message-level pattern matching**: find tool-calls without matching `<async-task-result>` user messages.

**Drainer writes results directly via `messageService.append(topicId, ...)`, not via `streamManager.injectMessage`.** The latter is for *live-stream injection* into the in-flight UI; persistence is independent. If the parent stream is alive, also call `injectMessage` for immediate UI update; if dead, the message is still in DB and loads next time the topic is opened.

**App-startup orphan sweep**: scan recently-active topics for unmatched task-calls, append `<async-task-orphaned task="X">App restarted while this task was running.</async-task-orphaned>` synthetic user messages.

Rejected alternatives:
- **`async_agent_tasks` table** — redundant with messages table; introduces dual source of truth; no query messages can't answer.
- **`sub_agents` table (Arkloop-style)** — only justified if we adopt state-machine subagent (D11 rejects this).

### Granularity: terminal write, not per-step / per-message streaming

Claude Code persists every yielded sub-agent message as a JSONL line (`recordSidechainTranscript([msg], agentId, lastRecordedUuid)` in `runAgent.ts:792-805`): assistant turn, user/tool_result, progress, compact_boundary — each gets its own file row, parent-pointer chained.

Cherry **deliberately does not**. Three things make Claude Code's granularity load-bearing — none apply to cherry:

| Claude Code concern | Cherry equivalent | Why we don't need it |
| --- | --- | --- |
| SDK subprocess crash mid-run → resume from disk | Single-process Electron — process crash kills everything in memory, child included | D13: re-spawn from prompt on next launch, not resume |
| Sub-agent transcript viewable as standalone file | UI surfaces sub-agent via `parentTopicId` join on messages table | One source of truth — no parallel transcript dir |
| Long-running async task (hours) — losing in-flight work is expensive | Today async ≈ seconds–tens of seconds (drainer awaits) | Re-spawning short tasks is fine; revisit only when long async lands |

So the cherry write strategy is **one synthetic user message per sub-agent invocation, written at completion** — not per step, not per LLM turn, not per tool call. Sub-agent intermediate state (its tool_calls, its reasoning, its errors) is intentionally a black box to the parent topic. If the user wants to see inside, they open the sub-topic (D14's `parentTopicId`) and see the child's own conversation thread, persisted at the same turn-end granularity as any other topic.

When this would change:
- Async tasks that legitimately run >10 min → losing in-flight work justifies per-step writes
- Cross-window sub-agent transcript viewer → may want denser timeline events
- Audit / compliance requirement → full event log

None present today. Don't pre-build.

## D13. Cross-restart "resume" is *re-create from saved state*, not literal continuation

Single-process desktop apps cannot keep child agents running while the app is closed. App quit kills the main process — all in-memory async work, in-flight HTTP requests, and tool subprocesses die. SQLite persistence lets the *next* app launch re-create execution from saved state, but child does not progress during the closed gap.

Three engineering paths exist for "child survives app closed":

| Path | What it actually does | Cherry suitability |
|---|---|---|
| **A. Resume from snapshot** (opencode / Arkloop Desktop) | App reopens → load saved messages/tools → make a fresh LLM API call to continue → in-flight work from before is lost, child restarts from last persisted point | ✓ ~1 week eng. Use messages table as the snapshot (D12). |
| **B. Detached OS subprocess** | `spawn(..., {detached: true})` a Node helper that lives past Electron quit | ✗ ~6-12 weeks. IPC, credential migration, multi-platform packaging, zombie cleanup. |
| **C. User-mode service** | LaunchAgent / Windows Service / systemd helper service | ✗ Even larger. Multi-platform service install/upgrade is a deployment nightmare. |

**Path A actually handles "long-running" agents fine — common misconception otherwise.** LLM agents' work is *stateless between API calls*. A 2-hour deep-research agent decomposes into hundreds of small ticks (each ~5s LLM API + a few seconds of tool execution). Between ticks, all state is persisted to `messages`. When app quits:

- In-flight tick (LLM HTTP call or running tool subprocess) dies; ~5-60s of work lost.
- All previously completed ticks remain in DB.
- On app reopen: load messages → fresh LLM API call → from model's perspective the conversation resumes seamlessly, just with a wall-clock gap.

This is fundamentally different from CPU-bound long jobs (compile / train / render) where in-process state is real and irrecoverable. **LLM agents externalize their entire state to the message log on every tick** — that's why path A works so well.

**Path B/C only justify use cases with time-sensitive external interaction:**

| Scenario | Why path A is insufficient |
|---|---|
| Agent monitors email/webhooks while app closed | Polling needs an active process |
| Process holds non-serializable state (10GB Python kernel data, persistent network connections) | Reload cost > resume cost |
| Must respond to external events in real time | Missed events = missed work |
| Background batch job runs overnight without user present | App closes when user sleeps |

For Cherry's product position (chat assistant + sub-agents for research / explore / summarize), none of these are common. Path A covers ~95% of "long task" use cases.

**Cherry walks path A only.** "Resume" on Phase 6 means: on app reopen, orphan sweep injects `<async-task-orphaned>` markers and the user can re-prompt. Phase 7+ (D15 persistent delegate mode) extends this with `task_id` resume, still on path A. Path B/C only relevant if Cherry expands into time-sensitive monitoring agents (Phase 10+, separate helper-service product).

## D15. Persistent delegation vs ephemeral function-call — Cherry locks ephemeral

Arkloop's snapshot + state-machine infrastructure isn't intrinsic to "sub-agent" as a data model — it's the product of a deliberate **persistent delegation** design choice. Verified in `factory.go:16` (`childThreadTTL = 7 * 24 * time.Hour`) and `planner.go:82-88` (SendInput allowed on terminal states `completed / failed / cancelled / resumable / waiting_input`, only `closed` rejects). Sub-agents survive parent run completion by default; parent can re-engage via `send_input` for up to 7 days.

This is a design choice, not a structural necessity. If Arkloop chose synchronous-only sub-agent calls, all 4 tables (`sub_agents` / `sub_agent_events` / `sub_agent_pending_inputs` / `sub_agent_context_snapshots`) would be unnecessary — every piece of state lives in parent's run-local memory.

**Two paradigms:**

| | Synchronous function-call | Persistent delegate |
|---|---|---|
| Sub-agent is | Temporary call frame | Long-lived employee |
| When parent run ends | Child dies | Child continues to exist |
| Multiple interactions | Not supported | Parent can `send_input` repeatedly |
| Default survival | Parent run | Explicit TTL (Arkloop: 7 days) |
| Status state | Not needed (call stack handles) | Required (`waiting_input` etc.) |
| Snapshot table | Not needed | Required (must reload across runs) |

**Cherry's `parentTopicId` schema is paradigm-neutral and zero-overhead for both modes** — it supports synchronous AND persistent without a single additional column. Verified against Arkloop's 4 tables:

| Arkloop table | What it stores | Cherry's equivalent |
|---|---|---|
| `sub_agents` (status, depth, run ids) | Sub-agent metadata + state | **Derived**: status from latest message pattern (matched `<async-task-result>` / `<async-task-error>` / unmatched `agent` tool-call); depth from `parentTopicId` chain length |
| `sub_agent_events` | Immutable audit log | **Existing**: `messages` table is already immutable + ordered |
| `sub_agent_pending_inputs` | Queue for SendInput on running child | **Not needed**: Cherry's single-LLM parent stream is serial; if async mode hits a still-running child, meta-tool rejects with error |
| `sub_agent_context_snapshots` | Frozen execution environment at spawn | **Not needed**: messages already are the full transcript; resume = load messages + LLM call. Tools/model are reconstructed from the child Agent factory, not from a frozen snapshot |

**4 tables → 0 new tables**, both modes. Even `topic.status` is unnecessary — derive it from messages, optionally accelerated by an index later if profiling shows hot-path scans.

The only field optionally worth adding (Phase 7+, persistent delegate mode only): `topic.expiresAt` for explicit TTL cleanup of stale sub-topics. Alternative: query `WHERE updatedAt < datetime('now', '-7 days')` on existing column. Both work; pick when the cleanup job ships.

The difference between modes is at the `agent` meta-tool input schema layer:

```ts
// Synchronous (Cherry MVP, Phase 6)
agent({ description, prompt }) → always create new sub-topic
// task_id is never exposed to the LLM

// Persistent delegate (Phase 7+ optional)
agent({ description, prompt, task_id?: string })
// LLM decides per call: omit task_id for fresh sub-agent, supply prior task_id to continue
```

**Cherry defaults to synchronous for Phase 6, persistent delegation lands Phase 7.** Tradeoffs:

| Reason synchronous wins for Phase 6 | Reason persistent matters for Phase 7+ |
|---|---|
| Stale context risk if delegate remembers old data | Coding / research workflows naturally accumulate context across multiple parent invocations |
| Transcript bloat (each `send_input` re-includes history) | Mitigatable via context compaction (Cherry already has primitives for this) |
| LLM "reuse vs fresh" judgment is unreliable | Mitigatable via tool description + few-shot in agent system prompts |
| No "your sub-agents" panel UI yet | Build the UI as part of Phase 7 — sub-topics already render in existing message system, just need a parent-topic side panel listing active delegates |

Persistent delegation is gated behind an assistant config flag (`allowPersistentSubagents: true`) so users with simple chat use cases don't deal with the complexity. For agentic-platform users (coding / design / research), it's a real value-add. Storage is shared (D14 single-field schema), so Phase 7 unlock is in the meta-tool schema + tool description + UI panel, not in DB migration.

## D16. Two-tier message model — persisted vs runtime-augmented

The agent loop sees a wider set of messages than what gets persisted. Loop-internal augmentations (fork placeholders, system context injection, cache hints, prepareStep mutations) flow into LLM API calls but should NOT live in the `messages` table. Conversely, anything that influences future conversation turns (user input, async-result injections) MUST be persisted.

**Three categories:**

| Source | Example | Persisted? |
|---|---|---|
| **Real user / assistant turns** | User message; LLM output (text / tool_call / tool_result parts) | ✓ Always (PersistenceListener) |
| **Loop-internal injections that affect future turns** | `<async-task-result>` from drainer; `<async-task-orphaned>` from app-restart sweep; user steering messages mid-stream | ✓ Always — write via `messageService.append` |
| **Loop-internal augmentations consumed once** | Fork placeholder tool_result; fork directive prefix; `prepareStep`-injected system context; cache breakpoints | ✗ Not persisted — reconstructed from persisted state at runtime |

**Core invariant:**

> Anything that enters the LLM's view AND affects subsequent conversation semantics is either persisted directly OR deterministically reconstructible from persisted state.

This split is what lets Phase 6 resume work: load `messages` → apply standard augmentations (same code path as fresh runs) → LLM API call → output appears continuous from LLM's view. Augmentations that read non-deterministic state (e.g., "current time is X") are allowed but only because resume-time augmentation reads the *current* time — drift is by design, not a bug.

**Risk points to watch:**

- **`pendingMessages` queue**: today only sourced from real user input + drainer's persisted messages. Don't let features push runtime-only augmentations through it; they'd enter LLM view without persistence.
- **Tail recheck**: resumes the loop using the same `pendingMessages.drain()`. Same constraint.
- **Fork mode placeholder synthesis** (D2): keep this 100% in-memory, sourced from parent's last assistant message + tool_use id; never write to `messages`.
- **Sub-topic resume** (D11): child's reconstructable augmentations (system prompt, tools, fork directive) must be pure functions of child Agent config + persisted messages. Don't bind non-determinism (like spawn-time timestamps) into augmentation logic if resume should be byte-stable.

**For new features**: when designing anything that adds content to the LLM's `messages` array, classify it explicitly into one of the three categories above. If it's category 2 (affects future turns), it must persist. If it's category 3 (reconstructable), document the reconstruction logic.

### Three views, not two: UI / DB / LLM are independently shaped

The persisted `messages` table is shared input for both rendering and LLM-call assembly, but the two consumers see different things:

```
DB messages
  ├── load + render verbatim ──→ UI (what user sees)
  └── load + augment ──────────→ LLM (what model sees)
                augmentation = prepareStep mutations + system reminders + compaction summaries + cache hints + fork placeholders + ...
```

**Invariant**: UI renders DB verbatim. No regex stripping, no "is_user_facing" flags, no runtime filtering. If LLM-only content reaches UI, it's a *write-time bug* — something polluted DB that shouldn't have. Don't try to clean it up at render time.

This means at write-time, every feature must classify explicitly:

| Question | Answer | DB action |
|---|---|---|
| Should the user see this? | Yes → persist as a `Message` part / No → runtime only | Decide whether to write |
| Is it reconstructable from existing persisted state? | Yes → safe to keep runtime only / No → must persist | Decide if augmentation is allowed |
| Does it affect subsequent conversation semantics? | Yes → must persist / No → runtime only is fine | Decide injection layer |

### Concrete patterns and how each handles the split

**System reminders** (e.g. `<system-reminder>` blocks Claude Code prepends to user messages):
- Reminder content is runtime-derived (current state-of-app, recent flags, etc.).
- Apply via `prepareStep` augmentation that prefixes the last user message in LLM's view.
- DB stores user's actual typed content.
- UI shows user's actual typed content.
- **Never put reminders in DB even with a "hidden" flag** — that's the regex-stripping anti-pattern.

If a "reminder" is actually stable across the assistant's lifetime, it's not a reminder — it belongs in `Assistant.systemPrompt` or assistant-config, not in messages.

**Compaction summaries** (LLM context window fills up, old messages collapse into a summary):
- Two views diverge: LLM sees `[summary, recent_messages]`; UI sees full transcript.
- Recommended implementation: store summary as a `parts: [{ type: 'compaction-summary', source: ..., text: '...' }]` ON a designated message in DB.
- UI renders that part as a collapsed block (`[12 older messages summarized]`, click to expand).
- `prepareStep` augmentation: when assembling LLM view, replace messages older than the compaction-summary's `source` cutoff with the summary text.
- Persistence is justified because summarization is expensive (extra LLM call); cache via DB rather than recompute every turn.
- Original messages remain in DB untouched — full transcript is recoverable, resume from any point works.

**Cache breakpoints / provider-specific control hints**: pure LLM API metadata. Inject in `prepareStep` or provider middleware. Never written to DB.

**Tool result placeholders** (fork mode, D2): runtime-synthesized, never persisted. Reconstructable from parent's tool_use_id.

### Why renderer doesn't need any filtering

If the write-time classification is enforced, the part-type list in DB is fully user-facing:
- `text`, `tool-call`, `tool-result`, `file`, `reasoning`, `compaction-summary`, ...

UI just renders each part-type with its dedicated component. There's no `if (part.isUserFacing)` check because *everything in DB is user-facing by definition*. Any part that shouldn't be shown is a write-time mistake to be fixed at the source, not patched in render code.

This is what protects UI cleanliness: the discipline lives at the write boundary, not at the read boundary.

## D14. Sub-topic schema = single `parentTopicId` field on `topic` table

When Phase 6 (resumable sub-agent via sub-topic) lands, the entire schema migration is **one nullable FK column**:

```ts
// src/main/data/db/schemas/topic.ts
export const topicTable = sqliteTable('topic', {
  // ... existing fields ...
  parentTopicId: text().references(() => topicTable.id, { onDelete: 'cascade' }),
  // ... rest ...
}, (t) => [
  // ... existing indexes ...
  index('topic_parent_id_idx').on(t.parentTopicId)
])
```

The field does double duty:
- **Relational link**: connects sub-topic to parent topic (`onDelete: 'cascade'` — sub-topic dies with parent).
- **Visibility flag**: `parentTopicId IS NULL` ≡ "user-level top-level topic." Existing topic list queries add this filter; no separate `hidden` boolean needed.

What's NOT needed:
- ✗ A new `async_agent_tasks` / `sub_agents` / `sub_agent_events` / `sub_agent_pending_inputs` table — the topic + messages tables already cover everything.
- ✗ A `topic.kind` enum (`'primary' | 'subagent'`) — `parentTopicId IS NULL` carries the same information.
- ✗ A `topic.hidden` boolean — same reason.
- ✗ Separate `task_id` storage — sub-topic id IS the `task_id` (opencode pattern).
- ✗ A `topic.status` enum — derive from messages (latest assistant message + whether it's complete).

### Query changes

Add `WHERE parentTopicId IS NULL` to:
- Main topic list (and group views)
- Global topic search
- Recent topics list

Concentrated in `TopicService` / `topicDataApi` query helpers — small, surgical refactor.

### Open: cleanup policy for orphaned sub-topics

If a parent topic exists but its sub-topic spawned via async meta-tool was never completed (app quit mid-run), the sub-topic stays in DB. Decide in Phase 6 whether to:
- Auto-cleanup sub-topics whose `updatedAt` is stale by N days
- Auto-mark them `<async-task-orphaned>` on next parent-topic open and let user decide
- Leave indefinitely (debug value)

Default to "auto-mark orphan + leave in DB" — easy to reverse if it bloats.

## D17. `AsyncAgentTaskRegistry` is too thick — collapse to abort-only

The first cut of `AsyncAgentTaskRegistry` stored `{ taskId, description, agent, abortController, startedAt }` and exposed `register` / `unregister` / `abort(taskId)` / `abortAll` / `list`. Reviewing this against D9 (no `state` object on Agent) and D12 (status lives in messages table), it's overbuilt:

**The asymmetry the user pointed at**

Sync child agents have no registry — they don't need one. AI SDK's `tool({ execute })` already supplies `abortSignal`, and the parent stream's signal cascades through it. The detached drainer in async mode breaks that cascade, which is why we re-invent abort plumbing. **That's a real lifecycle difference, not a bad design.** The mistake is that the registry pretends to be more than abort plumbing.

**Two-source-of-truth with D12**

Once async tasks are written to messages table per D12, every non-runtime field has a DB-side counterpart:

| Registry field     | D12 messages-table source                                                              |
| ------------------ | --------------------------------------------------------------------------------------- |
| `taskId`           | `<async-task-pending task="…">` part attribute                                          |
| `description`      | the message text itself                                                                 |
| `startedAt`        | `message.createdAt`                                                                     |
| status / "running" | `message.status === 'in_progress'` + tag scan                                           |
| `list()` of tasks  | `SELECT … FROM messages WHERE topicId=? AND status='in_progress' AND parts LIKE '<async-task-pending%'` |

Only `AbortController` is genuinely runtime-only — it can't be persisted, can't be derived.

**Speculative API (violates "present-tense consumers only")**

`abort(taskId)` and `list()` have zero callers. `description` / `agent` / `startedAt` are written but never read. Per the standing rule, all of them should be removed until a real consumer arrives.

### Decision

Shrink the registry to abort plumbing — nothing more:

```ts
class AsyncAgentAbortMap {
  private readonly map = new Map<string, AbortController>()
  set(taskId: string, ac: AbortController): void
  delete(taskId: string): void
  abortAll(reason: string): void  // bound to parent stream end
}
```

(Or even just `Map<string, AbortController>` directly without a class — `abortAll` is the only method that earns its keep.)

Symmetry restored: **sync mode delegates abort to AI SDK's `abortSignal`; async mode delegates abort to this Map keyed by `taskId`.** Both are abort fan-out, neither is a state store. All queryable state — identity, description, timestamps, running-task list — lives in the messages table per D12.

When a real "cancel this background task" UI lands later: read `taskId` from the message DB, call `map.get(taskId)?.abort('user-cancel')`, mark the message row failed. No new field on the registry.

### Migration

1. Rename `AsyncAgentTaskRegistry` → `AsyncAgentAbortMap`. Drop `register(task)` / `unregister` / `abort(taskId)` / `list` / the `AsyncAgentTask` interface entirely.
2. Update `agentTool.ts` to call `abortMap.set(taskId, ac)` and `abortMap.delete(taskId)` directly.
3. Defer "cancel by id" until a UI actually wires a button — at that point add a thin `cancel(taskId)` that does the abort + (eventually) a message-status patch.

## D18. Synthetic-message helper — extract + plan for system-reminder unification

`agentTool.ts` ships four local helpers (`syntheticResultMessage` / `syntheticErrorMessage` / `baseMessage` / `wrapInXmlTag`-shape inline) that build XML-tagged user `Message` objects for `injectMessage`. This shape isn't unique to async sub-agent results — it's the same shape Claude Code uses for `<system-reminder>`, `<command-name>`, `<bash-stdout>`, `<task-notification>`, and ~12 other tags. Today there's only one call site (the async drainer). Real future callers:

- **`<system-reminder>`** — compaction notices, plan-mode entry/exit, mid-flight steering ("用中文 thereafter"), tool-policy reminders.
- **`<async-task-pending task="…">`** — D12 placeholder before the result lands (D14 sub-topics).
- **`<compaction-summary>`** — D16 mentions; produced by future compaction service.
- **slash-command echoes** — `<command-name>` / `<command-message>` / `<command-args>` if cherry adopts Claude Code's slash UX.

### Reference survey

| Source | Tag set | Trigger model | Decoupling | Idempotent re-wrap |
| --- | --- | --- | --- | --- |
| Claude Code | hardcoded ~16 enum (`xml.ts`) | wrap at message-creation time, post-merge `smooshSystemReminderSiblings` | low — producer-side wrappers scattered | yes (`ensureSystemReminderWrap`) |
| pi-system-reminders | single `<system-reminder>` | **event + `when()` predicate per producer file** | **high — producer subscribes to lifecycle events, bus delivers** | n/a (pure string) |
| Cherry today | 2 ad-hoc tags inline in agentTool | producer calls `injectMessage` directly | low — producer knows `streamManager` / `topicId` | no |

**Re-reading pi after the user pushed back**: pi's architectural value is **not** the `.ts` rule-file user surface — that's an end-user authoring shell. The value is the **producer-bus pattern underneath it**:

- Producer declares: "I subscribe to event `X`, when predicate `Y`, emit message `Z`."
- Bus owns delivery: holds `topicId`, calls `injectMessage`, applies `cooldown` / `once`.
- Producer doesn't touch `AiStreamManager`, doesn't know about parent-stream lifecycle, doesn't manage own dedup state.

Cherry's existing `Agent.on(hookKey, fn)` is ~80% of this. It carries the event-subscription part but **not** the delivery decoupling — every producer still has to import `streamManager`, know `topicId`, format the `Message` shape, and handle "is the parent stream still live".

**Claude Code's tag enum doesn't fit yet** — 16 tags for 16 call sites. Cherry has 2 sites. Don't pre-build the enum; add tags inline as callers land. Re-evaluate at 4–5 distinct tags whether a registry pays for itself.

### Decision: 3-layer helper, ship layers with present-tense consumers only

Location: `src/main/ai/messages/syntheticUserMessage.ts` (next to `messageConverter.ts`).

```ts
// L1 — pure string XML wrapper. Idempotent: if `content` already starts with
// the same open-tag, return as-is. Costs 3 lines, defends future re-wrap
// scenarios (compaction merging system-reminders into adjacent blocks).
export function wrapInXmlTag(
  name: string,
  attrs: Record<string, string> | undefined,
  content: string
): string

// L2 — wrap any text into a Message ready for `AiStreamManager.injectMessage`
// or future direct DB write (D12).
export function buildSyntheticUserMessage(topicId: string, text: string): Message

// L3 — current callers. ONE FACTORY PER ACTUAL CALL SITE. Add new factories
// here as new tags arrive; do not pre-build a registry.
export function buildAsyncTaskResultMessage(topicId: string, taskId: string, text: string): Message
export function buildAsyncTaskErrorMessage(topicId: string, taskId: string, errorText: string): Message
```

L3 example body (one line each):
```ts
buildAsyncTaskResultMessage = (topicId, taskId, text) =>
  buildSyntheticUserMessage(topicId, wrapInXmlTag('async-task-result', { task: taskId }, text))
```

### Why ship L1 + L2 generically even though only L3 has callers today

L1 + L2 are the smallest amount of glue that makes adding the next factory a one-liner. Without them, every future tag (system-reminder, compaction-summary, ...) re-implements `baseMessage` boilerplate. With them, adding `<system-reminder>` becomes:

```ts
export function buildSystemReminderMessage(topicId: string, content: string): Message {
  return buildSyntheticUserMessage(topicId, wrapInXmlTag('system-reminder', undefined, content))
}
```

That's the unification — one builder, N tag-specific factories, no enum gating, no registry. Claude Code's `wrapInSystemReminder(content) → string` is the same shape as our L1+L2 chain; we just don't bake the tag name into a top-level helper.

### What's NOT in scope (deferred until consumer lands)

- **`buildSystemReminderMessage`** — no caller yet. Add when first reminder source ships (likely compaction service or D12 pending placeholder).
- **Tag enum / registry** — premature at 2 tags. Revisit at ~5.
- **Renderer-side stripping of `<async-task-result>` / `<system-reminder>`** in chat UI. Today these would render raw if a user opened the topic mid-async-run. Decide alongside D12 (write-time part-type classification): either the renderer skips known LLM-only tags, or D16's "everything in DB is user-facing" discipline forces a different part-type at write time. Track as a Phase 6 task, not part of this extraction.
- **Tagging metadata as a `Message.data` field** instead of inline XML — would let UI hide tags structurally rather than by regex. Considered, rejected for now: the LLM consumes XML, not part metadata, so the wrapping is load-bearing for prompt content. UI hide can come from a parallel field if needed.

### Migration

1. Create `src/main/ai/messages/syntheticUserMessage.ts` with L1 + L2 + the 2 current factories.
2. Tests in `src/main/ai/messages/__tests__/syntheticUserMessage.test.ts`: `wrapInXmlTag` with/without attrs, idempotency (don't double-wrap), L3 factories produce text that matches `agentTool.test.ts`'s existing assertions (`<async-task-result task="…">` / `<async-task-error task="…">`).
3. `agentTool.ts`: delete `syntheticResultMessage` / `syntheticErrorMessage` / `baseMessage`. Replace 2 call sites with `buildAsyncTaskResultMessage` / `buildAsyncTaskErrorMessage`. Existing `agentTool.test.ts` should pass unchanged — text format identical.
4. Future: when `<system-reminder>` is needed, add `buildSystemReminderMessage` to the same file. One-line change.

### Decoupling: `Agent.injectReminder` (shipped together with helpers)

Helpers alone solve the boilerplate problem. They don't solve the **delivery-coupling** problem — every producer still has to import `streamManager`, know `topicId`, handle dead-stream returns. Pi's architectural value (separated from its user-rule shell) is precisely the producer-bus pattern that hides delivery.

After re-evaluating: cherry's existing `Agent.on(hookKey, fn)` covers the subscription half. The delivery half is **one method**, not a bus class:

```ts
// AgentLoopParams (new field)
inject?: (message: Message) => boolean

// Agent class (new method)
injectReminder(message: Message): boolean {
  return this.params.inject?.(message) ?? false
}
```

The wirer (AiService / RequestFeature) sets `inject: (msg) => streamManager.injectMessage(topicId, msg)` once at Agent construction. Producers from then on:

**In-loop producer (observer):**
```ts
agent.on('onStepFinish', ({ usage }) => {
  if (usage.totalTokens > 100_000) {
    agent.injectReminder(buildSystemReminderMessage(topicId, 'approaching context limit'))
  }
})
```

**Out-of-loop producer (drainer / IPC / timer):**
```ts
const result = await consume(handle)
agent.injectReminder(buildAsyncTaskResultMessage(topicId, taskId, result))
// or, when the producer doesn't have an Agent reference:
deps.inject(buildAsyncTaskResultMessage(...))   // same callback, called directly
```

Neither side touches `streamManager` / dead-stream check. **`cooldown` / `once` are 2-line closure idioms** (`let fired = false`, `let lastFiredAt`), not framework features.

### Why no `Reminders` bus class

A `Reminders` facade (`add({on, when, message, cooldown, once})`) was sketched and rejected. At cherry's scale it adds an indirection without earning back the cost:

- `cooldown` / `once` are trivial closures over let bindings — encoding them as fields is style, not capability.
- The bus would re-export `agent.on(hookKey, fn)` plus auto-injection of return value — that's two existing primitives composed, not a missing primitive.
- Pi has `cooldown` / `once` because it ships **13 reference rule files** for end-users; the API shape was driven by 13 cases. Cherry has 1 producer today.

If 5+ producers ever land with shared dedup needs that closures can't express cleanly, revisit. Until then: `agent.on()` + `agent.injectReminder()` covers everything.

### Migration (code change shipped this PR)

1. Create `src/main/ai/messages/syntheticUserMessage.ts` with `wrapInXmlTag` + `buildSyntheticUserMessage` + L3 factories.
2. Tests for the helper.
3. Add `inject?: (message: Message) => boolean` to `AgentLoopParams`.
4. Add `Agent.injectReminder(message): boolean` method.
5. Refactor `agentTool.ts`: drop `streamManager` dep in favor of `inject`; drainer calls `deps.inject(message)` after building via L3 factories.
6. Update `agentTool.test.ts` fixtures from `streamManager.injectMessage` → `inject` callback.

### Future producers (each is a 5-line struct, no framework)

| Producer | Status | Hook / trigger |
| --- | --- | --- |
| Async sub-agent drainer | shipped | out-of-loop (drainer Promise) |
| D12 pending placeholder | planned | `onChildSpawn` (or inline at drainer start) |
| Compaction summary | future | `onStepFinish` + usage threshold |
| Token-budget warning | future | `onStepFinish` + usage threshold |
| Plan-mode entry/exit | future | `onStart` / explicit |

### Open

- Should Cherry adopt Claude Code's `smooshSystemReminderSiblings` post-merge step (collapse adjacent reminders into one block)? Defer — Claude Code does this because it wraps at creation and may emit reminders next to tool results; Cherry's producers `injectReminder` once per event, no merging pressure yet.

## D19. Sub-agent ↔ `AiStreamManager` interaction — pure fan-out + in-band metadata chunk

Sub-agent execution today goes only through the LLM-context channel: `executeAsTool` reads the child's `UIMessageStream`, picks `text` parts, returns the cumulative string as the parent's tool result. **Everything else** — child's reasoning, tool calls, tool results, file reads — is dropped before reaching the renderer. The parent UI sees only the final flat text. For sync sub-agents this means the user can't observe what the child is doing; for async it means the child's progress is invisible until the result lands.

The fix needs two channels:

| Channel | Consumer | Content | Today |
| --- | --- | --- | --- |
| **LLM-context** | parent agent's next LLM request | final text only (black box) | shipped via `executeAsTool` |
| **UI-render** | renderer | child's full chunk stream (reasoning / tool / text) | **missing** |

### Reject: pollute `StreamExecution` with composition fields

The first sketch added `kind` / `parentExecutionId` / `parentToolCallId` / `agentType` to `StreamExecution`. **Wrong**: `AiStreamManager` is "topic → multiple concurrent stream executions, fan chunks to listeners by `executionId`." Multi-model fan-out already lives there; sub-agent is just another producer. Composition concepts (parent linkage, agent type) belong at the agent layer, not in stream management.

### Decision: minimal `attachExecution` API + in-band `data-execution-meta` chunk

**Layer 1: `AiStreamManager.attachExecution`** — one new method, zero new fields.

```ts
class AiStreamManager {
  /**
   * Attach an additional execution to a live topic. Used for any concurrent
   * stream that wants to share the topic's listeners — multi-model fan-out
   * is the existing case; agent-as-tool, future background summarizers,
   * preview renders are new ones. Returns false if the topic has no live
   * stream to attach to.
   */
  attachExecution(topicId: string, executionId: string): false | {
    pumpChunk: (c: UIMessageChunk) => void
    abortSignal: AbortSignal
    detach: () => void
  }
}
```

`StreamExecution` shape unchanged. `AiStreamManager` doesn't know — and doesn't need to know — that a given execution is a child agent.

**Layer 2: `data-execution-meta` chunk** — composition metadata rides in-band on the stream.

```ts
// Emitted by the agent layer as the FIRST chunk on a child execution.
{
  type: 'data-execution-meta',
  data: {
    kind: 'child-agent',
    parentExecutionId: string,
    parentToolCallId: string,    // which parent tool-call to nest under in UI
    agentType: string            // 'explore' / 'researcher' — UI label
  }
}
```

AI SDK's `data-*` chunk type is the legitimate channel for app-level structured payloads. Renderer maintains a local `executionId → metadata` map: first time it sees a new `executionId`'s chunks, it expects a `data-execution-meta` chunk; subsequent chunks render nested under `parentToolCallId` according to the metadata.

**Layer 3: agent-tool wirer** — the only place that knows about parent-child relationships.

```ts
// Inside agentTool's execute / drainer:
const childExecId = `child:${taskId}`
const handle = streamManager.attachExecution(topicId, childExecId)
if (!handle) {
  // No live topic → fall back to text-only relay (current behavior)
} else {
  handle.pumpChunk({
    type: 'data-execution-meta',
    data: { kind: 'child-agent', parentExecutionId, parentToolCallId, agentType }
  })
  for await (const chunk of childAgent.stream(messages, handle.abortSignal)) {
    handle.pumpChunk(chunk)
    // also accumulate text-delta chunks → final string for LLM-context channel
  }
  handle.detach()
}
```

### Sync and async use the same plumbing — no rendering split needed for desktop

Claude Code splits sync (inline transcript) and async (separate task panel) because terminal UI has only linear scrollback — async tasks scroll out of sight and the user loses track. **Cherry is desktop**: existing chrome already absorbs the "is something running elsewhere" affordance:

| CLI worry | Desktop chrome that handles it |
| --- | --- |
| Async task scrolls off-screen | Topic-list badge / unread indicator |
| User doesn't know background tasks exist | Topic IS the task context container |
| Terminal completion notification | Native OS notification / dock badge |
| Cross-session persistent tasks | Sub-topic via D14 — appears in topic list as its own row |

Sync and async sub-agents render the same way: chunks fan to listeners, renderer nests them under `parentToolCallId`. When the async result lands as a synthetic user message, normal scroll-to-bottom + topic badge bring the user's attention back. **No separate task panel.** No `mode: 'sync' | 'async'` field on the metadata chunk. Revisit only if real users complain that a long-running async task is invisible mid-flight.

### Persistence interaction with D12 / D14

UI-render channel is **fan-out only** — chunks reach listeners and replay buffer, not the messages table:

- **Short async (drainer seconds)**: child chunks live in listener buffer until topic-close. Final text goes to messages table via D12 (one synthetic user message). Intermediate state is ephemeral. **No DB writes for child's reasoning / tool calls.**
- **Long async or "I want to inspect child's full conversation later"**: open a sub-topic (D14 `parentTopicId`). The child's stream then runs as the sub-topic's primary execution and persists at the standard turn-end granularity. The sub-topic appears in the topic list; user opens it to see the full thread.

The minimum-DB choice (terminal write, D12) and the rich-UI choice (live chunk fan-out, D19) are independent — they ride two different channels.

### Files this would touch (when implemented)

- `src/main/ai/stream-manager/AiStreamManager.ts` — add `attachExecution`
- `src/main/ai/tools/agent/agentTool.ts` — wire `streamManager` dep; relay child stream via `attachExecution`; emit `data-execution-meta` first
- `src/main/ai/AiService.ts` — pass `streamManager` reference into `createAgentTool` deps (already has it)
- `src/renderer/.../*.tsx` — listener handles `data-execution-meta` chunks, maintains executionId metadata map, renders nested under `parentToolCallId`

### Out of scope / open

- **`attachExecution` for non-agent producers** (background summarizer, preview render) — designed-in but no concrete consumer yet. Don't pre-wire.
- **Replay-buffer overflow for long-running child** — child chunks share the topic's `maxBufferChunks`. May need per-execution buffer limits if a runaway child fills the topic. Revisit if observed.
- **Renderer-side abort UX for child execution** — should clicking "stop" on a nested child only abort it, or abort the whole topic? Decide alongside the renderer implementation.

## Open questions

1. **MCP server allowlist for read-only sub-agents**: today `READ_ONLY_PROFILE.allowMcpServers` is empty (conservative — no MCP for explore). UX: per-server `'trustedForReadOnlySubagents'` flag in MCP config? Or per-assistant override matrix? Decide in Phase 3 alongside subAgentIds UI.

2. **Per-call model override**: Claude Code lets parent specify `model: 'sonnet' | 'opus' | 'haiku'` per agent call. Cherry's models are arbitrary cross-provider — supporting `model` in input schema requires picking a model id space (assistant id? unique model id?). Defer until concrete user request.

3. **`RequestFeature` per-request state**: `agentToolFeature` shares `AsyncAgentTaskRegistry` between `contributeTools` and `contributeHooks` via `requestContext` mutation. Clean fix: extend `RequestFeature` API with a per-request `prepare(scope) → state` step that contributions can read. Defer until 2-3 features need it.

4. **Orphan sweep strategy**: on app start, scan all topics or only "recent" ones? Cap by time window (last 30 days) vs scanning every topic. Decide in Phase 6.

## References

- Claude Code: `manila-v1/src/tools/AgentTool/forkSubagent.ts:107-169` (placeholder + directive build), `AgentTool.tsx:495-511` (system prompt inheritance), `runAgent.ts:262-328` (fork run params)
- Arkloop: `cambridge-v2/src/services/worker/internal/executor/lua.go:145-184` (Lua bindings), `subagentctl/control.go:26-36` (companion lifecycle), `subagentctl/governance.go` (depth + backpressure)
- Cherry primitives: `src/main/ai/agent/Agent.ts` (`executeAsTool` / `injectReminder`), `src/main/ai/tools/agent/agentTool.ts` (`createAgentTool`), `src/main/ai/tools/agent/AsyncChildAbortMap.ts`, `src/main/ai/tools/agent/explore.ts` (sub-agent profile factory), `src/main/ai/tools/profile.ts` (`applyToolProfile`), `src/main/ai/tools/profiles/readOnly.ts`, `src/main/ai/messages/syntheticUserMessage.ts`
