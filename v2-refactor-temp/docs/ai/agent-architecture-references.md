# Multi-agent architecture survey — reference codebases + literature

Reference material informing Cherry's `subagent-architecture.md` decisions. Survey of four production codebases plus one empirical study, with engineering details (file:line refs, key patterns, tradeoffs).

Read alongside `subagent-architecture.md` — that doc states *what* Cherry decides; this one shows *why* by laying out what others built and what experimental data supports.

## TL;DR

| | subagent | resumable subagent | session-state-machine | team / peers | multi-worker |
|---|---|---|---|---|---|
| **Hermes (rabat-v1)** | ✓ | | | | |
| **Cherry (current)** | ✓ | | | | |
| **opencode (memphis)** | ✓ | ✓ | | | |
| **Arkloop Desktop (cambridge-v2)** | ✓ | ✓ | ✓ | | |
| **Arkloop Cloud (puebla-v1)** | ✓ | ✓ | ✓ | | ✓ |
| **Claude Code (manila-v1)** | ✓ | ✓ | | ✓ | |

4 of 4 production codebases implement subagent. Only 1 (Claude Code) implements team — and it does so as an *explicitly separate* mode, not a generalization of subagent.

The empirical paper (Mieczkowski et al. 2026, "LLM Teams as Distributed Systems") provides experimental evidence that decentralized teams *empirically underperform* centralized subagent delegation on most task structures, including 4.65× higher token cost for highly parallel work.

## 1. Hermes (`hermes-agent/rabat-v1`)

Python agentic chatbot. Subagent only.

### Architecture

- **`tools/delegate_tool.py`** — the only sub-agent path
- Hierarchical, function-call semantics: parent → child → result → die
- No team / peer messaging (`tools/send_message_tool.py` is for *external* chat platforms — Telegram / Discord / Slack — not inter-agent)

### Key design parameters

```python
# delegate_tool.py:32-38
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",   # no recursive delegation
    "clarify",         # no user interaction
    "memory",          # no writes to shared MEMORY.md
    "send_message",    # no cross-platform side effects
    "execute_code",    # children should reason, not script
])

# delegate_tool.py:53
MAX_DEPTH = 2  # parent (0) -> child (1) -> grandchild rejected (2)

# delegate_tool.py:52
_DEFAULT_MAX_CONCURRENT_CHILDREN = 3
```

### Toolset model (`toolsets.py`)

Hermes groups tools into named **toolsets** (`web` / `file` / `terminal` / `memory` / `safe` / `delegation` / ...) and lets agents declare which toolsets are enabled. A scenario profile like `"safe"` is a toolset that includes `[web, vision, image_gen]` — no terminal access.

When a parent delegates, child's toolsets = `(parent's enabled toolsets) ∩ (delegate-allowed toolsets) - DELEGATE_BLOCKED_TOOLS`. This is the "intersection rule" — child can never gain a tool the parent didn't have.

### Engineering takeaways

- **Hard depth cap (2)** is a strict but effective recursion guard. No need for runtime tracking infrastructure — just check `depth` arg.
- **Always-blocked-for-children** list is short and explicit. Each name has a documented rationale (`# no recursive delegation`).
- **Toolsets as named groups** is simpler than per-tool capability tags (Hermes doesn't have a `read | write | compute` taxonomy). For homogeneous tool sets this works fine.

### What Cherry already mirrors

- Cherry's `READ_ONLY_PROFILE.blockNames` plays the role of `DELEGATE_BLOCKED_TOOLS`
- Cherry's `applyToolProfile` enforces "intersection with parent" because it iterates over `parentTools`

## 2. opencode (`opencode/memphis`)

TypeScript via Effect-TS. Each sub-agent run is a **session**.

### Two-layer architecture

**Registry layer** (`packages/opencode/src/agent/agent.ts:28-235`):
- Agents are declared (built-in + user-config-overridable) with:
  - `name` / `description` / `prompt` / `model`
  - `mode: 'subagent' | 'primary' | 'all'`
  - `permission: Permission.Ruleset` (per-tool allow/deny/ask)
  - `temperature` / `topP` / `steps` / `hidden` / `native`
- Native agents shipped: `build` / `plan` / `general` (subagent) / `explore` (subagent) / `compaction` / `title` / `summary`
- `Service` exposes `get(name)` / `list()` / `defaultAgent()` — pure registry, no spawn API

**Execution layer** (`packages/opencode/src/tool/task.ts:30-180`):
- The `task` tool is what spawns a subagent
- Each sub-agent run = a **new Session** parented to the caller (`sessions.create({ parentID: ctx.sessionID, ... })`)
- Returns `task_id: ${nextSession.id}` so the model can resume by passing the same `task_id` in a future call

### Resumability

```ts
// task.ts:62-66
const session = taskID
  ? yield* sessions.get(SessionID.make(taskID))
  : yield* sessions.create({ parentID: ctx.sessionID, ... })
```

`taskID` is opencode's elegant resume mechanism: every sub-agent's identity *is* a session id, and sessions are first-class persistent entities in opencode's data model. No separate "subagent registry"; the existing session table tracks everything.

### Permission cascade (deny-only inheritance)

```ts
// task.ts:73-94
const nextSession = yield* sessions.create({
  permission: [
    ...(parent.permission ?? []).filter(  // inherit parent's denies only
      (rule) => rule.permission === "external_directory" || rule.action === "deny"
    ),
    ...(canTodo ? [] : [{ permission: "todowrite", pattern: "*", action: "deny" }]),
    ...(canTask ? [] : [{ permission: id, pattern: "*", action: "deny" }]),
    ...
  ],
})
```

Child only inherits parent's *deny* rules (so child can't escalate to allowed-by-parent). Then explicitly denies `todowrite` / `task` if the agent definition doesn't grant those.

### Abort propagation

```ts
// task.ts:128-130, 167-169
ctx.abort.addEventListener("abort", cancel)  // setup
ctx.abort.removeEventListener("abort", cancel)  // teardown
```

Parent abort propagates synchronously to child via signal listener.

### Engineering takeaways

- **Subagent = sub-session** is a powerful unification: subagent-tracking, resume, permission, UI rendering all reuse the existing session machinery. No new data type.
- **Mode field** (`subagent | primary | all`) is a simple constraint that a `subagent`-mode agent can't be picked as a top-level agent and vice versa. Nice typing of intended use.
- **`task_id` parameter** for resume is the simplest possible API for "continue prior subagent." Single string handle.
- **Deny-only permission inheritance** prevents privilege escalation without forcing child to inherit parent's allows.

### Relevance to Cherry

Cherry's `Topic` table is structurally similar to opencode's Session — already persistent, already has parent-child semantics potential (via parent-message linking). For Phase 6 persistence, the cleanest model is to treat each async sub-agent run as a sub-topic with `parentTopicId = parent's topicId`, and use the topic id as the `task_id` resume handle. Reuses existing infrastructure entirely.

## 3. Arkloop

Two parallel deployments share most of the codebase but ship different storage adapters:

- **Desktop** (`arkloop/cambridge-v2`): Go binary + SQLite + single-process worker (in-memory channel queue). Code is gated by `//go:build desktop`.
- **Cloud** (`arkloop/puebla-v1`): Go services + PostgreSQL + Redis + multi-worker pool. Gated by `//go:build !desktop`.

Both share `data.SubAgentRepository`, the `sub_agents` / `sub_agent_events` / `sub_agent_pending_inputs` / `sub_agent_context_snapshots` schema, and the state machine (status enum + transitions). Difference is the queue layer (channel vs PostgreSQL) and worker count (1 vs N).

### 3a. Cloud variant — multi-worker, lease-based job claiming

Evidence in `puebla-v1/src/services/worker/internal/queue/pg_queue.go`:

```go
//go:build !desktop                                   // line 1: cloud-only file

func (q *PgQueue) Lease(ctx, leaseSeconds, jobTypes) (*JobLease, error)         // line 260
func (q *PgQueue) Heartbeat(ctx, lease, leaseSeconds) error                     // line 291
func (q *PgQueue) Ack(ctx, lease) error                                         // line 318
func (q *PgQueue) Nack(ctx, lease, delaySeconds *int) error                     // line 343
```

Lease/heartbeat/ack/nack is **the** distributed-job-queue pattern. Single-worker doesn't need any of this. The actual lease query (line 402-408):

```sql
SELECT ... FROM jobs
WHERE status = 'queued'
   OR (status = 'leased' AND leased_until <= now())
ORDER BY available_at, created_at
LIMIT 1
FOR UPDATE SKIP LOCKED
```

`FOR UPDATE SKIP LOCKED` is the canonical Postgres pattern for **N concurrent workers each picking different jobs without blocking each other**. Existence of this code = the design assumes N>1 workers.

Lease-expiry recovery: if a worker dies mid-execution, `leased_until` passes; the job re-enters the eligible set; another worker re-claims. Snapshot infrastructure (ContextSnapshot, sub_agent_events) is what enables the new worker to reconstruct the run from saved state.

### 3b. Desktop variant — single-process, in-memory queue

`channel_queue.go` (in `cambridge-v2`) implements the same `JobQueue` interface as PgQueue but uses an in-process Go channel. No leases, no heartbeats — there's only one consumer, so there's nothing to coordinate.

Critically, **Desktop still uses the same `sub_agents` / `sub_agent_events` / `sub_agent_context_snapshots` schema** (`migrations/00026_sub_agents.sql`). Why a single-process desktop app needs all this state-machine + snapshot infrastructure is the interesting question — it's NOT for distributed coordination.

### Six lifecycle operations on a sub-agent

```go
// src/services/worker/internal/tools/builtin/spawn_agent/executor.go:28-86
spawn_agent(persona_id, context_mode, input)  → {sub_agent_id}
send_input(sub_agent_id, input)                // append a follow-up to existing child
wait_agent(sub_agent_id)                        // block until child reaches a state
resume_agent(sub_agent_id)                      // pull paused child back to running
close_agent(sub_agent_id)                       // graceful terminate
interrupt_agent(sub_agent_id)                   // force-cancel
```

**All six are parent → child**. No peer-to-peer messaging. Arkloop is *richer* sub-agent, not team.

### Why so many ops? Sub-agent is a *long-lived stateful entity*

Arkloop's sub-agent isn't a function call — it's a stateful entity that:
- Pauses mid-execution (status `waiting_input`) to ask parent for clarification
- Resumes after parent provides more context via `send_input`
- Persists across worker process boundaries (lease expiry → another worker takes over) — Cloud only
- Persists across desktop app restart (rehydrated from DB on launch) — Desktop too

The verbs model conversation state transitions, not function-call lifecycle.

### Status state machine

```sql
-- src/services/shared/database/sqliteadapter/migrations/00026_sub_agents.sql
sub_agents.status ∈ {
  'created', 'queued', 'running', 'waiting_input',
  'resumable', 'completed', 'failed', 'cancelled', 'closed'
}
```

The states model conversation phases, not just `running` / `done`.

### Event-sourced lifecycle

```sql
runs(id, status, resume_from_run_id, next_event_seq)
run_events(run_id, seq, type, data_json)  -- immutable, monotonic per (run_id)
```

Every state change emits an immutable event. Worker process reconstructs state by replaying events on startup. `resume_from_run_id` explicitly links a new run to its predecessor, supporting crash recovery.

### `context_mode` enum

```yaml
# spawn_agent input
context_mode: 'isolated' | 'fork_recent' | 'fork_thread' | 'fork_selected' | 'shared_workspace_only'
```

5 modes. We deemed this over-design; Cherry simplifies to 2 (`isolated` | `fork`).

### Lua orchestration layer

`src/services/worker/internal/executor/lua.go:145-184` exposes:
```
agent.spawn(req)
agent.loop_capture(prompt, msgs)
agent.wait(child_id)
agent.send(id, input)
tools.call(name, args)
tools.call_parallel(calls)
memory.search() / memory.write()
```

Personas declared with `executor_type: agent.lua` run a Lua script that orchestrates multi-step workflows (e.g. extended-search persona: parent loop → spawn child → wait → set output). Lua is user-editable; ships in `personas/<id>/agent.lua`.

### Sub-agent governance

```go
// subagentctl/governance.go
- Depth tracking (parent depth + 1)
- Concurrent spawn count per thread
- Pause strategy under critical backpressure (delay spawn 5s)
```

### Three snapshot types

Arkloop's subagentctl/types.go defines three distinct snapshot concepts, each for a different problem:

| Snapshot | What it captures | Where it lives | When built / used |
|---|---|---|---|
| **`StatusSnapshot`** | current status + depth + run ids + last output / error / timestamps | not in DB; built on read | query-time view for `wait_agent` / status APIs |
| **`ContextSnapshot`** | child's frozen execution environment: messages + skills + runtime + routing + memory + workspace + prompt cache | `sub_agent_context_snapshots` table | **built at spawn time** → DB → loaded on resume |
| **`PromptCacheSnapshot`** | LLM API request prefix: messages + tools + model + max_tokens + temperature + tool_choice (byte-stable) | nested inside ContextSnapshot | reused across multiple LLM calls of the same child to maximize provider-side cache hits |

**ContextSnapshot is the key**: it freezes parent's state at the spawn moment. Even if parent's thread keeps moving forward, child's view is immutable — locked to spawn-time. Like git checkout / a docker image / functional immutable data. Resume from any state-machine pause point reconstructs the execution environment from this snapshot.

### Why Desktop (single-process) still needs snapshots

The natural question — if Desktop has no distributed coordination, why ship the same snapshot infrastructure as Cloud?

The answer is **NOT "code reuse with Cloud"** (though that's a side benefit). Snapshots serve four real Desktop functions:

1. **`waiting_input` state requires it.** Child paused waiting for `send_input` must persist its execution context. Alternative is keeping all paused children's full LLM context in process memory; with N concurrent paused children, that's N × MB of held memory. Snapshots = serialize-to-disk, release memory, reload on resume.
2. **Multi-concurrent child management.** Listing / aborting / status-querying multiple children running in parallel — needs an indexed table. Cherry's in-memory `AsyncAgentTaskRegistry` does the lighter version of this.
3. **App restart resume.** When Desktop app reopens, lifecycle service scans `status='running'` rows, loads their ContextSnapshots, makes a fresh LLM API call to continue. Note: **child does not progress while app is closed** (single-process can't keep workers alive across quit). "Resume" means re-creating execution from saved state, not literal continuation.
4. **Audit / replay.** Immutable `sub_agent_events` log lets dev tools replay what a child did, useful for debugging.

So snapshots aren't "for distributed" — they support *stateful child agents that outlive their spawning frame* (parent run, parent stream, OS process). That requirement exists in single-process desktop too, just for different reasons (waiting_input, restart resume) than in distributed cloud (lease-expiry recovery, cache prefix sharing across workers).

Cloud benefits from snapshots for the additional reasons:
5. **Lease expiry → another worker resumes.** Worker A dies mid-run; worker B picks up via the lease/event-replay mechanism using ContextSnapshot.
6. **Prompt cache prefix sharing.** PromptCacheSnapshot is byte-stable so multiple workers calling the same provider produce hashable identical request prefixes → provider-side cache hits.

### Engineering takeaways

- **Conversation-state subagent** is a fundamentally different shape than function-call subagent. Don't mix them.
- **Snapshots support state-machine subagent** even in single-process — the key driver is `waiting_input` paused children, not distribution.
- **Event-sourced runs** enable replay / audit / rollback / cross-process recovery. Powerful but heavy schema.
- **Lua for user-extensible orchestration** is a real product differentiator.
- **`resume_from_run_id`** is a crash-recovery primitive for distributed worker pools (Cloud).

### What Cherry shouldn't borrow

- **Lua**: requires sandbox + bindings + i18n + maintenance. Cost > value when our LLM can compose tool calls directly.
- **5-mode context_mode**: 3 of them are vague semantics. Use 2 (`isolated` | `fork`).
- **Full state-machine subagent**: requires `waiting_input` UX surface (child pauses to ask parent for clarification, parent uses `send_input` to respond). Cherry's chat product treats parent as the user-facing entity; child paused-waiting-for-input has no natural UI placement. Without a real product driver for conversational subagent, the 4-table state machine is overhead with no payoff.
- **Event-sourced `run_events` history**: huge schema migration cost; messages table covers most audit needs derivatively.
- **PromptCacheSnapshot byte-stability work**: provider-side cache hits in Cherry are managed by middleware (anthropicCache plugin), not by us serializing exact LLM API request prefixes.

### What Cherry should consider

- **Status enum on `AsyncAgentTask`**: `running / completed / failed / cancelled / orphaned`. Simpler than Arkloop's 9-state set but same idea — passive observability for future `agent_status` companion tool. Free addition.
- **Depth + concurrency soft limits** instead of Cherry's current `blockNames: [Agent]` hard block: more flexible (allows legitimate "researcher uses fact-checker subagent" 2-level cases). Threaded via `experimental_context.forkDepth`.
- **Sub-topic as resume handle** (path A from `subagent-architecture.md` D13): if Phase 6 persistence ever lands, a sub-agent run = a sub-topic; the topic id IS the resume handle (opencode pattern). Reuses messages table entirely; no new schema needed.

### What's NOT a reason for Cherry to skip Arkloop's design

For honesty: earlier framings claimed "Electron app can't do X" or "Cherry's single-process can't survive worker death." These are technically wrong:

- Cherry's main process can perfectly well act as a single Arkloop-style worker, scan `sub_agents WHERE status='running'` on app start, mark orphans, optionally resume.
- SQLite + Drizzle + lifecycle services + AbortController + state machine is implementable in ~1-2 weeks of engineering.
- The blocker is **product fit**, not technical capability:
  - Cherry's user paradigm is single user → single primary assistant → assistant delegates internally. There's no UI surface for "your child agent is paused waiting for your input on whether to use approach A or B."
  - Cherry's typical sub-agent task duration is 30s-5min, not 30min+. Users don't close app mid-task often enough to justify resume infrastructure.
  - Auto-resume after restart is risky for tasks with side effects (sub-agent already wrote files, ran subprocess, made API call). Re-running from snapshot duplicates work.

Arkloop made the bet that conversational subagent + cross-restart durability is worth the schema cost. Cherry's product position doesn't justify that bet today.

## 4. Claude Code (`claude-code/manila-v1`)

Has both subagent and team — only codebase in the survey to do so.

### Subagent path

`src/tools/AgentTool/AgentTool.tsx` + `runAgent.ts`. Standard tool-call: parent invokes `Agent({subagent_type: 'explore', ...})`, child runs, parent gets summary.

Key features:
- **Built-in agents** (`built-in/`) loaded via `getBuiltInAgents()` (line 22-72 of `builtInAgents.ts`)
- **Custom agents** loaded from `~/.claude/agents/` markdown files (`loadAgentsDir.ts:296-393`)
- **Agent definition** (`loadAgentsDir.ts:106-184`): `agentType` / `whenToUse` / `tools[]` / `disallowedTools[]` / `permissionMode` / `memory` / `mcpServers` / `model` / `effort` / `hooks` / `skills`

### Fork mode (special subagent path)

When `subagent_type` is omitted and `FORK_SUBAGENT` flag is on (`forkSubagent.ts:32-39`), Claude Code uses a "fork" pattern that **inherits parent's full context byte-exactly** for prompt cache reuse:

```ts
// forkSubagent.ts:107-169 — buildForkedMessages
function buildForkedMessages(directive, assistantMessage):
  - Clone parent's last assistant message (with all tool_use blocks)
  - Synthesize tool_result placeholders for each tool_use ("Fork started — processing in background")
  - Append user message with directive wrapped in <fork-boilerplate> XML tags
  - Inherit parent's exact rendered system prompt + thinkingConfig + tool definitions
```

Result: child's API request prefix is byte-identical to parent's → prompt cache hit → fork is cheap.

Recursion guard:
```ts
// AgentTool.tsx:332 — primary check via querySource flag
if (toolUseContext.options.querySource === 'agent:builtin:fork') throw

// forkSubagent.ts:78-89 — fallback: scan messages for marker
function isInForkChild(messages): boolean
```

Dual guard because `querySource` lives on context.options (survives autocompact); message scan catches rewrite paths where it didn't propagate.

### Team mode (peer agents)

Triggered when `Agent({team_name: 'project-x', name: 'researcher', ...})` is called. Activates a *different* code path:

**Team registry** (`teamDiscovery.ts:1-82`):
- Stored at `~/.claude/teams/{team-name}/` on disk
- Each teammate has a `name` + agentId + status
- Other teammates discover peers by reading the team file

**Peer messaging** (`SendMessageTool.ts:1-100`):
```ts
SendMessage({ to: 'researcher', content: '...' })
SendMessage({ to: '*', content: '...' })  // broadcast
```

The to-name is resolved against the team registry. Messages are queued in the recipient's mailbox.

**Long-lived state** (`teammate.ts:125-131, 205-231`):
- Teammate runs as a background task
- System waits for "working teammates" to be idle before shutdown
- Teammate registers in team file → externally addressable by name

### Persistence

Subagents store transcripts to `~/.claude/<sessionId>/subagents/agent-<id>.jsonl` (one line per message) plus `agent-<id>.meta.json`. Lightweight — filesystem only, no database. Resume works by loading the JSONL and continuing the LLM with new prompt.

### Engineering takeaways

- **Two modes in one tool** (subagent vs teammate) via `team_name` toggle. The user-facing API is unified, but **internal code paths are separate** — same tool surface, two completely different implementations.
- **Fork is a cache-aware specialization** of subagent. The cleverness is structural: synthesizing placeholder tool_results so the conversation is valid, then the child proceeds from a known point with parent's full state.
- **Filesystem persistence** is simple and works for CLI scope. Doesn't scale to multi-machine but doesn't need to.
- **Team registry on disk** is shared state that any teammate process can read. No central coordinator; coordination is via the file.

### What Cherry should learn

- **Fork's placeholder-tool_result trick** is required for any "child sees parent's history" mode. The conversation is invalid otherwise.
- **Two modes / two code paths** even when surface looks unified — don't try to make team and subagent share a "smart switching" implementation.
- **Filesystem transcript** isn't right for Cherry (we have SQLite + DataApi); but the *structure* (one transcript file per agent + small metadata) maps to "one sub-topic per agent, with messages in the messages table".

## 5. Mieczkowski et al. 2026 — empirical study

> "Language Model Teams as Distributed Systems" (arXiv:2603.12229v1, March 2026)

Princeton + MIT + NYU + Cambridge. Frames LLM teams as distributed systems and tests whether classical distributed-systems tradeoffs (Amdahl's Law, consistency conflicts, communication overhead, stragglers) actually arise in LLM teams.

### Four shared properties (Section 3.1)

LLM teams = distributed systems share:
1. **Independence**: local context, partial observability — agents (or nodes) lack global state access
2. **Communication**: message passing (not shared state)
3. **Concurrency**: simultaneous execution introduces stale-info / conflict / overwrite problems
4. **Fallibility**: agents (or nodes) can produce errors / hallucinate / stall

### Architectural taxonomy

- **Centralized**: one coordinator delegates + integrates results. Reduces overhead via fewer channels. Vulnerable to stragglers (slow node delays whole team).
- **Decentralized**: peers self-coordinate via direct communication. Robust against stragglers, more parallelism. But coordination overhead, communication bottlenecks, conflicting decisions.

This is the classical distinction. **Subagent ↔ centralized; team ↔ decentralized.**

### Empirical results (Sections 4.1-4.6)

Three coding tasks (math utils, data analysis pipeline, SVG rendering) × three task structures (highly parallel p=0.9 / mixed p=0.5 / highly serial p=0.2) × team sizes 1-5 × three models (Claude Sonnet 4.6, Gemini 3 Flash, GPT-5.2).

**Speedup vs Amdahl's bound** (Figure 2):
- Highly parallel: teams scale up to 3.35× at N=5 — close to Amdahl bound ~3.6×
- Mixed: teams plateau ~1.3-1.5×
- Highly serial: teams plateau ~1× (no improvement)

**Centralized vs decentralized** (Section 4.2 + Figure 3):
- Centralized (preassigned tasks) median speedup = 1.36×
- Decentralized (self-claiming) median speedup = 0.88× — **slower than single agent**
- Mann-Whitney U=155523, p<0.001 — robustly significant across all task types and models

**Failure modes of decentralization** (Section 4.3):
- Concurrent writes (multiple agents editing same file): 2-58 events/run by model
- Rewrites (overwriting peers' work): substantial across all models
- Temporal violations (skipping dependencies)
- Failed test cases: median 19 in decentralized vs 4 in centralized (p<0.001)

**Communication overhead** (Section 4.4 + Figure 4):
- Decentralized teams generate ~150 extra messages by N=5
- ~30 extra idle rounds (peer coordination delays)
- Decentralized has O(n²) channels vs centralized O(n)

**Straggler analysis** (Section 4.5 + Figure 5):
- Stragglers = agents taking unusually long
- Centralized straggler delay: median 2.64s
- Decentralized: 1.42s
- **This is the only metric where decentralized wins.** Decentralized can dynamically reroute around slow peers.

**Token cost** (Table 1):
- Highly parallel + N=5:
  - Preassigned: 3.35× speedup, 1.33× tokens
  - Decentralized: **0.83× slowdown, 4.65× tokens**
- Decentralized teams: cost grows superlinearly with N (Spearman ρ=0.40, p<0.001) without speedup gains

### Failure transcripts (Appendix A.2)

Real Gemini-3-Flash decentralized run, mixed task: **45% of replies were "wasted cheerleading messages"**:

```
R15: I am currently idle and waiting for tasks. Let me know if you reassign...
R25: I am still idle since there are no unassigned tasks available...
R48: Great job Dev1 on completing task-9!
R52: Great job Dev1 on completing task-10!
R56: I see that task-15 is now complete! Great job, Dev1!
R57: Looks like Dev1 is working on the final task (task-20)! I'll stand by to cheer...
```

Or 3 agents simultaneously claiming the same task with slight variations:
```
Dev1: I have claimed task-1: Implement fmtnum (rounding to 2 decimal places)...
Dev2: I have claimed task-1: Implement fmtnum (for SVG attributes)...
Dev3: I have claimed task-1: Implement fmtnum (rounding to 3 decimal places)...
```

This is **RLHF-induced helpfulness bias** showing up as coordination failure. Not solvable by prompt engineering — it's baked into base-model behavior.

### Engineering takeaways for Cherry

1. **Centralized (subagent) wins on speedup AND cost across most task structures** — 4.65× token cost for 0.83× slowdown in decentralized parallel is brutal.
2. **Decentralized (team) only wins on stragglers** — useful when one agent has unpredictable latency. Narrow use case.
3. **45% cheerleading is a real failure mode** — LLM coordination chatter eats tokens with no productivity. Any team design must handle this.
4. **Distributed systems theory transfers** — consistency conflicts, communication O(n²), straggler effects all show up in LLM teams. Borrow from CS literature when designing.
5. **Empirical justification for "subagent first"** — paper validates that centralized hierarchy is the right starting topology.

## 6. Cross-codebase comparison matrix

### Subagent execution model

| | Function-call | Resumable session | Conversational state-machine |
|---|---|---|---|
| Hermes | ✓ | | |
| Cherry (current) | ✓ | | |
| Claude Code | ✓ + fork variant | | |
| opencode | | ✓ | |
| Arkloop | | | ✓ |

### Persistence

| | Storage | Resume mechanism |
|---|---|---|
| Hermes | None | None |
| Cherry (current) | None | None |
| Claude Code | Filesystem JSONL | Load transcript + new prompt |
| opencode | Database (sessions table) | `task_id` parameter |
| Arkloop | PostgreSQL (runs + run_events tables, event-sourced) | `resume_from_run_id` + event replay |

### Tool filtering for children

| | Mechanism |
|---|---|
| Hermes | Toolset names + `DELEGATE_BLOCKED_TOOLS` blacklist |
| Cherry | `ToolProfile` (capability + namespace + MCP server allowlist + blockNames) |
| Claude Code | `tools[]` allowlist + `disallowedTools[]` + `permissionMode` |
| opencode | Per-agent `Permission.Ruleset` (allow / deny / ask per tool pattern) |
| Arkloop | YAML `core_tools` / `tool_allowlist` / `tool_denylist` / `conditional_tools` |

### Communication

| | Parent → child | Child → parent | Peer ↔ peer |
|---|---|---|---|
| Hermes | tool call invoke | tool call return | ✗ |
| Cherry | tool call invoke | tool call return + async injectMessage | ✗ |
| Claude Code (subagent) | tool call invoke | tool call return | ✗ |
| Claude Code (team) | spawn into team | message via SendMessage | ✓ named addressing + broadcast |
| opencode | tool call invoke | tool call return | ✗ |
| Arkloop | spawn / send_input / resume / close / interrupt | wait_agent observes status | ✗ |

### Recursion / depth guard

| | Mechanism |
|---|---|
| Hermes | `MAX_DEPTH = 2` hardcoded check on `depth` arg |
| Cherry (current) | Hardcoded `blockNames: [Agent]` in `READ_ONLY_PROFILE` |
| Claude Code | Dual: `querySource` flag on context.options + scan messages for `<fork-boilerplate>` marker |
| opencode | Per-agent `permission` ruleset can deny `task` tool |
| Arkloop | `governance.go` tracks depth + concurrent count + backpressure |

### Concurrency control

| | Mechanism |
|---|---|
| Hermes | `ThreadPoolExecutor`, max 3 concurrent children per parent |
| Cherry (current) | None (any number of async tasks per parent) |
| Claude Code | Per-task abort signal hierarchy |
| opencode | Per-session abort + permission rules |
| Arkloop | Job queue + worker pool + governance backpressure |

## 7. What this means for Cherry

**Cherry's product position correction**: earlier drafts of this doc (and `subagent-architecture.md`) framed Cherry as a "chat product where most operations are read-only / non-destructive." That framing was wrong. Cherry is an **open-ended agentic platform with chat UI** — users compose capabilities via MCP, including filesystem mutation, shell execution, design-tool control, and arbitrary HTTP APIs. The agent loop, ToolProfile, sub-agent infrastructure, and async task lifecycle are all because Cherry needs to safely orchestrate user-installed destructive tools.

Several judgments below have been re-examined in this light. Specifically: plan mode, structured ask-user, and persistent delegation become *more* relevant under the agentic-platform framing than under "chat product."

The survey lands on three converging conclusions:

### 7.1 Subagent is the right primitive; team is rare

4 of 4 codebases ship subagent. Only 1 (CC) ships team, and it's a separate code path. The paper provides empirical evidence that centralized (subagent) outperforms decentralized (team) on speedup AND cost in most task structures.

→ Cherry locks subagent as Phase 1-7 priority; team is Phase 10+ if it ever lands.

### 7.2 Sub-session model (opencode-style) is the right persistence pattern

Cherry already has `Topic` + `messages`. Sub-agent runs as sub-topics — natural data-model fit:
- Each async sub-agent run = a sub-topic with `parentTopicId`
- `task_id` = sub-topic id
- Resume = continue the sub-topic with new prompt
- Messages already render via existing UI

This is opencode's exact pattern adapted to Cherry's data model. No new "subagent" data type needed.

**"Resumable subagent" is not a separate primitive from "resumable agent" — it's the same mechanism with different wiring.** Both reduce to:

1. Conversation messages persisted in DB
2. On resume: load messages → LLM API call → append new response
3. From LLM's view: continuous conversation. From code's view: a fresh API call with all the prior messages.

Differences are external, not mechanical:

| | Resumable parent agent | Resumable sub-agent |
|---|---|---|
| Who triggers resume | User (opens topic, sends message) | Parent's LLM (calls `agent({ task_id: 'X', ... })`) |
| Where result lands | User's next assistant message | Tool result in parent topic |
| Identity assignment | User implicit (opens new topic) | Parent's LLM explicit (passes `task_id`); first-spawn id system-generated |

→ Phase 6 persistence: sub-session via topic reuse, not a new `async_agent_tasks` table. The same topic resume mechanism that already serves user conversations gets sub-agent resume "for free" — wire `parentTopicId` + a `hidden` flag + the `task_id` parameter on the `agent` meta-tool.

### 7.3 Conversational state-machine — buildable, partially relevant

Earlier this section called state-machine "overkill." Re-examined under the agentic-platform position:

**Cherry CAN technically build it** (~1-2 weeks). SQLite + Drizzle + 4 tables + lifecycle service + state transition machinery is straightforward.

**Some of the conversational-delegate features ARE relevant** for agentic-platform users:

- **Persistent delegate** (D15): coding / research / design sub-agents that retain context across multiple parent invocations — high value for agentic-platform users. **Phase 7** when the schema unlock is just an `agent({task_id})` parameter (D14 single field).
- **`waiting_input` pause-to-ask**: mid-task clarification IS useful for long workflows. But the *implementation* doesn't need state machine — see D11's note on tool-call-based alternative. Phase 8+ once the UX questions are answered (see D11).

**Some still don't fit:**

- **Full Arkloop state-machine engine** (4 tables, transition functions, event sourcing) is more than Cherry needs. Cherry's messages-table-derived approach (D14) covers the same product surface at a fraction of the schema.
- **Multi-worker lease coordination** is unambiguously irrelevant — single-process desktop app.
- **Lua user-extensible orchestration** is over-engineered for Cherry's user base.

→ Cherry walks: function-call (Phase 2-5) → opencode-style resumable sub-session (Phase 6) → persistent-delegate config option (Phase 7) → optionally `waiting_input` via tool-call pattern (Phase 8+). State-machine engine itself is rejected; product features it enables are reached through simpler implementations.

### 7.4 Fork is non-trivial and requires the placeholder trick

If Cherry adds `context_mode: 'fork'`, it must implement the synthesized tool_result placeholder (Claude Code `forkSubagent.ts:107-169` pattern). Naive "copy parent messages" produces invalid conversations (unmatched tool_use blocks, model rejects).

→ Phase 2.5 fork implementation is real engineering, not a 5-line addition.

### 7.5 Team mode would face known empirical failure modes

If Cherry ever adds team mode, the paper warns of:
- 4.65× token cost for marginal speedup (often negative)
- 45% wasted "cheerleading" messages from RLHF helpfulness bias
- O(n²) communication channels
- Concurrent writes / temporal violations

These are not solved problems. Adding team mode without addressing them = burning user tokens.

→ Team mode requires upfront design for: anti-cheerleading prompts, structured task assignment (not self-claiming), explicit dependency enforcement. Don't ship without these.

### 7.6 Cross-restart "resume" is re-creation, not literal continuation (single-process reality)

For honesty about what cross-restart actually means in single-process desktop apps (Cherry, Arkloop Desktop, opencode):

**App quit kills the main process. Period.** All in-memory async work, in-flight LLM HTTP requests, tool subprocess pipes, and timers die. SQLite persistence captures *state at the moment of quit*, not running computation. There is no "the agent kept thinking while the app was closed."

What "resume on next launch" actually does:

1. App reopens → main process restarts
2. Lifecycle service queries DB for runs/sub_agents in non-terminal status
3. For each: load saved snapshot/messages → make a fresh LLM API call with "continue this conversation" framing → child appears to continue from a coherent state
4. Any *in-flight* work that was happening at quit time is lost — the LLM may need to redo it

**Three engineering options for "child stays alive while app closed":**

| Path | Description | Suitable for Cherry? |
|---|---|---|
| **A. Resume from snapshot** (opencode / Arkloop Desktop) | App reopens → re-create execution from DB → fresh LLM call continues. In-flight work lost. ~1 week eng. | ✓ if Phase 6 lands |
| **B. Detached OS subprocess** | `spawn(..., {detached: true})` of a Node.js helper that survives Electron quit | ✗ ~6-12 weeks. IPC + credential migration + multi-platform packaging + zombie cleanup. |
| **C. User-mode service** | macOS LaunchAgent / Windows Service / systemd helper, separate process, separate update channel | ✗ Even larger. Multi-platform service deployment is a project unto itself. |

Cherry, when ready, picks path A (and even that's optional — see `subagent-architecture.md` D13). Path B/C are major architectural decisions tied to specific product needs (e.g., a deep-research agent that genuinely needs to keep running unattended for an hour). Phase 10+ if ever.

This was muddled in earlier drafts of this doc — "Electron can't" is the wrong framing. **Single-process** can't keep workers alive across quit, regardless of runtime (Electron / native / Web / etc.). The choice is: build a B-style sidecar process, or accept "child progresses only when app is open."

## References

### Codebases

- Hermes: `/Users/suyao/conductor/workspaces/hermes-agent/rabat-v1/`
  - `tools/delegate_tool.py:32-1200`
  - `toolsets.py:68-379`
- opencode: `/Users/suyao/conductor/workspaces/opencode/memphis/`
  - `packages/opencode/src/agent/agent.ts:28-413`
  - `packages/opencode/src/tool/task.ts:1-180`
- Arkloop Desktop: `/Users/suyao/conductor/workspaces/arkloop/cambridge-v2/`
  - `src/services/worker/internal/tools/builtin/spawn_agent/executor.go:28-726`
  - `src/services/worker/internal/executor/lua.go:25-184`
  - `src/services/worker/internal/subagentctl/types.go:102-194` (StatusSnapshot / ContextSnapshot / PromptCacheSnapshot)
  - `src/services/worker/internal/subagentctl/control.go:26-36`
  - `src/services/worker/internal/subagentctl/projector.go:78-220` (state transitions)
  - `src/services/shared/database/sqliteadapter/migrations/00026_sub_agents.sql`
- Arkloop Cloud: `/Users/suyao/conductor/workspaces/arkloop/puebla-v1/`
  - `src/services/worker/internal/queue/pg_queue.go:1, 260-437` (`//go:build !desktop`, lease/heartbeat/ack/nack, `FOR UPDATE SKIP LOCKED`)
  - `src/services/api/internal/data/runs_repo.go` (`resume_from_run_id`)
- Claude Code: `/Users/suyao/conductor/workspaces/claude-code/manila-v1/`
  - `src/tools/AgentTool/AgentTool.tsx`
  - `src/tools/AgentTool/forkSubagent.ts:32-211`
  - `src/tools/AgentTool/runAgent.ts:248-694`
  - `src/utils/teammate.ts:1-293`
  - `src/utils/teamDiscovery.ts:1-82`
  - `src/tools/SendMessageTool/SendMessageTool.ts:1-100`

### Paper

- Mieczkowski, Collins, Sucholutsky, Vélez, Griffiths. "Language Model Teams as Distributed Systems." arXiv:2603.12229v1, March 2026. Princeton / MIT / NYU / Cambridge.
- Code: `https://github.com/emieczkowski/distributed-llm-teams`
- Key sections: §3.1 (four shared properties), §4.2-4.6 (empirical results), Appendix A.2 (failure transcripts), Table 1 (cost-efficiency tradeoffs)
